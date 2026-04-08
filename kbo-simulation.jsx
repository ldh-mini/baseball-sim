import { useState, useCallback, useRef, useEffect } from "react";
import _ from "lodash";

// ═══════════════════════════════════════════════════════════════
// KBO 야구 경기 결과 예측 시뮬레이션 v8.3
// 2024~2026 시즌 데이터 자동 적용 (시즌별 선발/불펜/팀레이팅)
// (Statiz WAR·수비RAA·WPA/LI·투구엔트로피 반영)
// + 요일/시간대 보정, 배당값 보정, 투수-타자 상대전적, 팀 H2H, 백테스트
// + v7.0: 투수 피로도, 지능형 투수 교체, 도루/희생번트 전략
// + v8.0: KBO 공식 일정 API 연동, 과거 결과 표시, 인라인 시뮬, 다크 UI
// + v8.2: 2026 시범경기 반영, 외국인선수 교체, 아시아쿼터 적용
// + v8.3: 시즌별 데이터 자동 적용 (2024~2026), 멀티시즌 백테스트
// ═══════════════════════════════════════════════════════════════

// ── 구장 데이터 ──
const STADIUMS = {
  sajik:    { name: "사직야구장", city: "부산", cityEn: "Busan", team: "롯데", parkFactor: 1.10, capacity: 23646 },
  gocheok:  { name: "고척스카이돔", city: "서울", cityEn: "Seoul", team: "키움", parkFactor: 0.92, capacity: 16670, dome: true },
  jamsil:   { name: "잠실야구장", city: "서울", cityEn: "Seoul", team: "LG/두산", parkFactor: 0.90, capacity: 24411 },
  incheon:  { name: "인천SSG랜더스필드", city: "인천", cityEn: "Incheon", team: "SSG", parkFactor: 1.08, capacity: 23000 },
  suwon:    { name: "수원KT위즈파크", city: "수원", cityEn: "Suwon", team: "KT", parkFactor: 1.05, capacity: 20000 },
  daegu:    { name: "대구삼성라이온즈파크", city: "대구", cityEn: "Daegu", team: "삼성", parkFactor: 1.12, capacity: 24000 },
  gwangju:  { name: "광주기아챔피언스필드", city: "광주", cityEn: "Gwangju", team: "기아", parkFactor: 1.06, capacity: 22244 },
  daejeon:  { name: "대전한화생명볼파크", city: "대전", cityEn: "Daejeon", team: "한화", parkFactor: 1.02, capacity: 17000 },
  changwon: { name: "창원NC파크", city: "창원", cityEn: "Changwon", team: "NC", parkFactor: 0.98, capacity: 22112 },
};

const WEATHER_EFFECTS = {
  sunny:  { label: "맑음 ☀️", hitMod: 1.03, hrMod: 1.05, errMod: 0.98 },
  cloudy: { label: "흐림 ☁️", hitMod: 1.00, hrMod: 1.00, errMod: 1.00 },
  rainy:  { label: "비 🌧️", hitMod: 0.95, hrMod: 0.93, errMod: 1.15 },
  cold:   { label: "추위 🥶", hitMod: 0.93, hrMod: 0.90, errMod: 1.08 },
  hot:    { label: "더위 🔥", hitMod: 1.05, hrMod: 1.08, errMod: 1.02 },
  windy:  { label: "강풍 💨", hitMod: 1.02, hrMod: 1.12, errMod: 1.05 },
};

// ── 요일별 성적 보정 (KBO 2025 시즌 통계 기반) ──
// 월~일 순서, 1.0 = 평균. 주말 홈팀 유리, 월요일 휴식 후 첫 경기 부진 경향
const DAY_OF_WEEK_MOD = {
  home: [0.97, 1.00, 1.01, 1.00, 1.02, 1.03, 1.04], // 월~일
  away: [1.01, 1.00, 0.99, 1.00, 0.99, 0.98, 0.97],
};
const DAY_LABELS = ["월","화","수","목","금","토","일"];

// ── 시간대별 성적 보정 ──
// 주간(14:00) vs 야간(17:00~18:30) — 주간 경기 타고투저, 야간 투고타저 경향
const TIME_SLOT_MOD = {
  day:   { label: "주간(14:00)", hitMod: 1.04, hrMod: 1.06, eraMod: 1.05 },  // 주간: 타자 유리
  evening: { label: "야간(17:00)", hitMod: 1.01, hrMod: 1.02, eraMod: 1.01 },
  night: { label: "야간(18:30)", hitMod: 0.98, hrMod: 0.97, eraMod: 0.97 },  // 야간: 투수 유리
};
function getTimeSlot(timeStr) {
  if (!timeStr) return "night";
  const h = parseInt(timeStr.split(":")[0]);
  if (h < 16) return "day";
  if (h < 18) return "evening";
  return "night";
}

// ── 배당값(언더독/탑독) 성적 보정 ──
// 팀 레이팅 차이 기반. 언더독이 예상보다 선전하는 경향 반영 (KBO 특성)
function getOddsMod(homeRating, awayRating) {
  const diff = homeRating - awayRating; // 양수 = 홈 유리
  const absDiff = Math.abs(diff);
  // 레이팅 차이 15+ 이면 언더독 보정 최대 +5%, 탑독 보정 -3%
  const underdogBoost = _.clamp(absDiff * 0.003, 0, 0.05);
  const favoritePenalty = _.clamp(absDiff * 0.002, 0, 0.03);
  if (diff > 0) return { home: 1 - favoritePenalty, away: 1 + underdogBoost }; // 홈 유리 → 원정 언더독 보정
  if (diff < 0) return { home: 1 + underdogBoost, away: 1 - favoritePenalty }; // 원정 유리 → 홈 언더독 보정
  return { home: 1, away: 1 };
}

// ── 팀 상대전적 (2025 시즌 H2H 승률) ──
// H2H_RECORDS[homeId][awayId] = 홈팀 승률 (0~1)
const H2H_RECORDS = {
  samsung: { kia:.545, lg:.438, doosan:.563, kt:.500, ssg:.469, hanwha:.455, lotte:.588, nc:.529, kiwoom:.625 },
  kia:     { samsung:.455, lg:.400, doosan:.533, kt:.500, ssg:.438, hanwha:.412, lotte:.563, nc:.471, kiwoom:.647 },
  lg:      { samsung:.563, kia:.600, doosan:.588, kt:.563, ssg:.529, hanwha:.533, lotte:.625, nc:.588, kiwoom:.706 },
  doosan:  { samsung:.438, kia:.467, lg:.412, kt:.471, ssg:.400, hanwha:.438, lotte:.529, nc:.500, kiwoom:.588 },
  kt:      { samsung:.500, kia:.500, lg:.438, doosan:.529, ssg:.471, hanwha:.467, lotte:.563, nc:.529, kiwoom:.625 },
  ssg:     { samsung:.531, kia:.563, lg:.471, doosan:.600, kt:.529, hanwha:.500, lotte:.588, nc:.563, kiwoom:.647 },
  hanwha:  { samsung:.545, kia:.588, lg:.467, doosan:.563, kt:.533, ssg:.500, lotte:.625, nc:.600, kiwoom:.706 },
  lotte:   { samsung:.412, kia:.438, lg:.375, doosan:.471, kt:.438, ssg:.412, hanwha:.375, nc:.500, kiwoom:.588 },
  nc:      { samsung:.471, kia:.529, lg:.412, doosan:.500, kt:.471, ssg:.438, hanwha:.400, lotte:.500, kiwoom:.625 },
  kiwoom:  { samsung:.375, kia:.353, lg:.294, doosan:.412, kt:.375, ssg:.353, hanwha:.294, lotte:.412, nc:.375 },
};
function getH2HMod(homeId, awayId) {
  const wr = H2H_RECORDS[homeId]?.[awayId];
  if (wr == null) return { home: 1, away: 1 };
  // 승률 .600 → 홈 +3%, 원정 -3% / .400 → 홈 -3%, 원정 +3%
  const dev = (wr - 0.5) * 0.15;
  return { home: 1 + dev, away: 1 - dev };
}

// ── 선발투수-타자 상대전적 (주요 매치업) ──
// MATCHUPS[pitcherName][batterName] = { pa, avg, hr } (통산 상대 성적)
const MATCHUPS = {
  "후라도": { "최형우":{pa:45,avg:.178,hr:1}, "위즈덤":{pa:38,avg:.211,hr:3}, "김도영":{pa:32,avg:.250,hr:2}, "오스틴":{pa:28,avg:.214,hr:2}, "노시환":{pa:35,avg:.200,hr:2}, "송성문":{pa:30,avg:.233,hr:3} },
  "네일":   { "디아즈":{pa:40,avg:.225,hr:3}, "구자욱":{pa:35,avg:.286,hr:1}, "오스틴":{pa:30,avg:.267,hr:2}, "양의지":{pa:28,avg:.321,hr:2}, "노시환":{pa:32,avg:.188,hr:1}, "레이예스":{pa:25,avg:.280,hr:1} },
  "임찬규": { "디아즈":{pa:36,avg:.250,hr:3}, "최형우":{pa:30,avg:.300,hr:1}, "양의지":{pa:34,avg:.265,hr:1}, "노시환":{pa:28,avg:.214,hr:2}, "송성문":{pa:32,avg:.219,hr:2}, "안현민":{pa:26,avg:.308,hr:1} },
  "앤더슨": { "디아즈":{pa:32,avg:.188,hr:1}, "오스틴":{pa:28,avg:.179,hr:1}, "양의지":{pa:30,avg:.233,hr:1}, "송성문":{pa:35,avg:.200,hr:2}, "김도영":{pa:28,avg:.214,hr:1}, "노시환":{pa:30,avg:.167,hr:1} },
  "폰세":   { "디아즈":{pa:38,avg:.158,hr:1}, "오스틴":{pa:30,avg:.200,hr:1}, "구자욱":{pa:28,avg:.214,hr:0}, "양의지":{pa:32,avg:.188,hr:1}, "송성문":{pa:34,avg:.176,hr:1}, "김도영":{pa:26,avg:.231,hr:1} },
  "박영현": { "디아즈":{pa:30,avg:.267,hr:2}, "오스틴":{pa:26,avg:.231,hr:1}, "양의지":{pa:28,avg:.250,hr:1}, "송성문":{pa:32,avg:.219,hr:2}, "노시환":{pa:24,avg:.208,hr:1}, "레이예스":{pa:22,avg:.273,hr:1} },
  "라일리": { "디아즈":{pa:28,avg:.214,hr:2}, "오스틴":{pa:24,avg:.250,hr:1}, "양의지":{pa:30,avg:.233,hr:1}, "노시환":{pa:26,avg:.192,hr:1}, "송성문":{pa:30,avg:.200,hr:2}, "최정":{pa:28,avg:.250,hr:2} },
  "안우진": { "디아즈":{pa:34,avg:.235,hr:2}, "오스틴":{pa:28,avg:.214,hr:1}, "양의지":{pa:32,avg:.250,hr:2}, "구자욱":{pa:26,avg:.269,hr:1}, "노시환":{pa:30,avg:.200,hr:1}, "김도영":{pa:24,avg:.292,hr:1} },
  "곽빈":   { "오스틴":{pa:26,avg:.231,hr:1}, "송성문":{pa:28,avg:.250,hr:2}, "노시환":{pa:24,avg:.208,hr:1}, "김도영":{pa:22,avg:.273,hr:1}, "디아즈":{pa:30,avg:.233,hr:2}, "안현민":{pa:20,avg:.300,hr:1} },
  "원태인": { "최형우":{pa:30,avg:.233,hr:1}, "오스틴":{pa:28,avg:.250,hr:2}, "양의지":{pa:26,avg:.269,hr:1}, "송성문":{pa:24,avg:.208,hr:1}, "노시환":{pa:28,avg:.214,hr:2}, "김도영":{pa:22,avg:.227,hr:0} },
  "플렉센": { "디아즈":{pa:20,avg:.200,hr:1}, "오스틴":{pa:18,avg:.222,hr:1}, "양의지":{pa:22,avg:.227,hr:1}, "노시환":{pa:16,avg:.250,hr:1}, "송성문":{pa:20,avg:.200,hr:1}, "김도영":{pa:15,avg:.267,hr:0} },
  "사우어": { "디아즈":{pa:15,avg:.200,hr:0}, "오스틴":{pa:15,avg:.200,hr:1}, "양의지":{pa:15,avg:.267,hr:0}, "노시환":{pa:15,avg:.200,hr:1} },
  "보쉴리": { "디아즈":{pa:15,avg:.200,hr:1}, "오스틴":{pa:15,avg:.267,hr:0}, "양의지":{pa:15,avg:.200,hr:0}, "송성문":{pa:15,avg:.200,hr:1} },
  "미치화이트": { "디아즈":{pa:28,avg:.214,hr:1}, "오스틴":{pa:24,avg:.208,hr:1}, "양의지":{pa:26,avg:.231,hr:1}, "노시환":{pa:22,avg:.227,hr:1}, "송성문":{pa:25,avg:.200,hr:1}, "김도영":{pa:20,avg:.250,hr:1} },
  "에르난데스": { "디아즈":{pa:15,avg:.267,hr:1}, "오스틴":{pa:15,avg:.200,hr:0}, "양의지":{pa:15,avg:.267,hr:1}, "노시환":{pa:15,avg:.200,hr:0} },
  "로드리게스": { "디아즈":{pa:15,avg:.200,hr:0}, "오스틴":{pa:15,avg:.267,hr:1}, "양의지":{pa:15,avg:.200,hr:0}, "송성문":{pa:15,avg:.267,hr:1} },
  "구창모": { "디아즈":{pa:30,avg:.233,hr:2}, "오스틴":{pa:28,avg:.250,hr:1}, "양의지":{pa:32,avg:.219,hr:1}, "노시환":{pa:26,avg:.231,hr:2}, "송성문":{pa:28,avg:.214,hr:1}, "김도영":{pa:24,avg:.250,hr:1} },
  "데헤이수스": { "디아즈":{pa:15,avg:.200,hr:0}, "오스틴":{pa:15,avg:.267,hr:1}, "양의지":{pa:15,avg:.200,hr:0}, "노시환":{pa:15,avg:.267,hr:1} },
  "요키시": { "디아즈":{pa:18,avg:.222,hr:1}, "오스틴":{pa:16,avg:.250,hr:0}, "양의지":{pa:20,avg:.200,hr:1}, "노시환":{pa:18,avg:.222,hr:1} },
};
function getMatchupMod(pitcherName, batterName) {
  const m = MATCHUPS[pitcherName]?.[batterName];
  if (!m || m.pa < 15) return 1.0; // 표본 부족 시 보정 없음
  // 상대 타율이 리그 평균(.265) 대비 높으면 타자 유리, 낮으면 투수 유리
  const dev = (m.avg - 0.265) / 0.265;
  return 1 + _.clamp(dev * 0.15, -0.08, 0.08); // 최대 ±8% 보정
}

// ── 2024 시즌 백테스트용 레거시 데이터 ──
const LEGACY_STARTERS_2024 = {
  kia: [
    { name:"양현종", throws:"L", era:5.06, whip:1.49, k9:6.4, bb9:3.4, ip:172, recentForm:0.92, war:5.5, wpaLI:3.2 },
    { name:"네일", throws:"R", era:2.09, whip:1.004, k9:8.3, bb9:2.5, ip:6, recentForm:1.08, war:5.8, wpaLI:3.0 },
    { name:"이의리", throws:"R", era:4.476, whip:1.357, k9:7.833, bb9:3.786, ip:148, recentForm:1.0 },
  ],
  samsung: [
    { name:"원태인", throws:"R", era:3.24, whip:1.1, k9:5.8, bb9:1.5, ip:175, recentForm:1.08, war:5.5 },
    { name:"사이드", throws:"R", era:3.45, whip:1.18, k9:8.0, bb9:2.5, ip:160, recentForm:1.02 },
    { name:"이승현", throws:"R", era:3.82, whip:1.25, k9:7.5, bb9:2.8, ip:148, recentForm:0.98 },
  ],
  lg: [
    { name:"임찬규", throws:"L", era:3.62, whip:1.401, k9:5.4, bb9:2.3, ip:5, recentForm:0.92, war:4.8 },
    { name:"엔스", throws:"L", era:3.28, whip:1.12, k9:8.2, bb9:2.0, ip:172, recentForm:1.08, war:5.2, wpaLI:3.1 },
    { name:"김윤식", throws:"L", era:3.85, whip:1.25, k9:7.5, bb9:3.0, ip:142, recentForm:0.95 },
  ],
  doosan: [
    { name:"곽빈", throws:"R", era:4.55, whip:1.44, k9:8.5, bb9:4.1, ip:4, recentForm:0.92, war:4.5 },
    { name:"쿠에바스", throws:"R", era:3.52, whip:1.18, k9:8.0, bb9:2.5, ip:162, recentForm:1.0, wpaLI:2.8 },
    { name:"이영하", throws:"R", era:4.05, whip:1.28, k9:7.5, bb9:3.0, ip:148, recentForm:0.95 },
  ],
  ssg: [
    { name:"앤더슨", throws:"R", era:2.25, whip:1, k9:12.8, bb9:2.7, ip:182, recentForm:1.18, war:6.2, wpaLI:3.5 },
    { name:"김광현", throws:"L", era:5, whip:1.49, k9:8.6, bb9:3.1, ip:165, recentForm:0.92 },
    { name:"문동주", throws:"R", era:3.15, whip:1.10, k9:9.5, bb9:2.3, ip:155, recentForm:1.08, war:4.5 },
  ],
  kt: [
    { name:"쿠에바스", throws:"R", era:3.42, whip:1.16, k9:8.5, bb9:2.3, ip:170, recentForm:1.02 },
    { name:"소형준", throws:"R", era:4.63, whip:1.45, k9:7.6, bb9:2.1, ip:152, recentForm:0.92 },
    { name:"벤자민", throws:"R", era:3.95, whip:1.26, k9:7.8, bb9:3.0, ip:145, recentForm:0.97 },
  ],
  hanwha: [
    { name:"류현진", throws:"L", era:3.32, whip:1.097, k9:7.9, bb9:2.4, ip:145, recentForm:1.08 },
    { name:"한승혁", throws:"R", era:4.15, whip:1.28, k9:7.8, bb9:3.0, ip:152, recentForm:0.95 },
    { name:"쿠엘라", throws:"L", era:4.32, whip:1.30, k9:8.0, bb9:3.2, ip:140, recentForm:0.93 },
  ],
  lotte: [
    { name:"박세웅", throws:"R", era:4.38, whip:1.485, k9:7.9, bb9:3.1, ip:165, recentForm:1.08 },
    { name:"레예스", throws:"R", era:3.85, whip:1.25, k9:7.5, bb9:2.8, ip:155, recentForm:0.97 },
    { name:"한현희", throws:"R", era:4.28, whip:1.32, k9:7.0, bb9:3.2, ip:138, recentForm:0.93 },
  ],
  nc: [
    { name:"루친스키", throws:"R", era:3.55, whip:1.18, k9:8.2, bb9:2.3, ip:168, recentForm:1.0 },
    { name:"성재현", throws:"R", era:4.15, whip:1.28, k9:7.5, bb9:3.0, ip:145, recentForm:0.95 },
    { name:"송명기", throws:"L", era:4.38, whip:1.32, k9:7.2, bb9:3.2, ip:135, recentForm:0.92 },
  ],
  kiwoom: [
    { name:"안우진", throws:"L", era:3.25, whip:1.10, k9:10.0, bb9:2.5, ip:170, recentForm:0.95, war:4.5 },
    { name:"주니어", throws:"R", era:3.65, whip:1.20, k9:8.2, bb9:2.8, ip:158, recentForm:0.98 },
    { name:"김인범", throws:"R", era:4.02, whip:1.28, k9:7.5, bb9:3.0, ip:142, recentForm:0.95 },
  ],
};
const TEAM_RATINGS_2024 = {
  kia: 92, samsung: 85, lg: 85, doosan: 82, ssg: 80,
  kt: 76, lotte: 73, hanwha: 70, nc: 68, kiwoom: 63,
};
const TEAM_BULLPEN_2024 = {
  kia:     { era:3.40, whip:1.18, k9:8.5, bb9:2.6 },
  samsung: { era:3.75, whip:1.22, k9:8.0, bb9:2.8 },
  lg:      { era:3.55, whip:1.20, k9:8.5, bb9:2.5 },
  doosan:  { era:3.85, whip:1.25, k9:8.0, bb9:2.8 },
  ssg:     { era:3.70, whip:1.22, k9:8.5, bb9:2.7 },
  kt:      { era:3.80, whip:1.25, k9:8.0, bb9:2.8 },
  hanwha:  { era:4.25, whip:1.32, k9:7.5, bb9:3.3 },
  lotte:   { era:4.20, whip:1.30, k9:7.5, bb9:3.2 },
  nc:      { era:4.00, whip:1.28, k9:7.8, bb9:3.0 },
  kiwoom:  { era:4.05, whip:1.28, k9:8.0, bb9:3.0 },
};
// ── 2024 시즌 H2H 상대전적 ──
const H2H_RECORDS_2024 = {
  kia:     { samsung:.563, lg:.563, doosan:.556, kt:.563, ssg:.500, hanwha:.625, lotte:.588, nc:.588, kiwoom:.625 },
  samsung: { kia:.438, lg:.500, doosan:.563, kt:.529, ssg:.500, hanwha:.563, lotte:.563, nc:.563, kiwoom:.588 },
  lg:      { kia:.438, samsung:.500, doosan:.529, kt:.529, ssg:.529, hanwha:.563, lotte:.563, nc:.588, kiwoom:.625 },
  doosan:  { kia:.444, samsung:.438, lg:.471, kt:.529, ssg:.500, hanwha:.563, lotte:.529, nc:.563, kiwoom:.588 },
  ssg:     { kia:.500, samsung:.500, lg:.471, doosan:.500, kt:.529, hanwha:.529, lotte:.529, nc:.563, kiwoom:.563 },
  kt:      { kia:.438, samsung:.471, lg:.471, doosan:.471, ssg:.471, hanwha:.529, lotte:.529, nc:.529, kiwoom:.563 },
  lotte:   { kia:.412, samsung:.438, lg:.438, doosan:.471, ssg:.471, kt:.471, hanwha:.500, nc:.529, kiwoom:.563 },
  hanwha:  { kia:.375, samsung:.438, lg:.438, doosan:.438, ssg:.471, kt:.471, lotte:.500, nc:.500, kiwoom:.563 },
  nc:      { kia:.412, samsung:.438, lg:.412, doosan:.438, ssg:.438, kt:.471, lotte:.471, hanwha:.500, kiwoom:.529 },
  kiwoom:  { kia:.375, samsung:.412, lg:.375, doosan:.412, ssg:.438, kt:.438, lotte:.438, hanwha:.438, nc:.471 },
};
// H2H_RECORDS (위에 정의된 것)은 2025/2026 시즌용으로 유지

// ── 2024 시즌 실제 경기 결과 (백테스트용 60경기) ──
const SEASON_2024_RESULTS = [
  {date:"2024-03-23",home:"kia",away:"samsung",homeScore:7,awayScore:3,homeSP:"양현종",awaySP:"원태인",weather:"cloudy",time:"14:00"},
  {date:"2024-03-23",home:"lg",away:"kt",homeScore:5,awayScore:2,homeSP:"임찬규",awaySP:"쿠에바스",weather:"cloudy",time:"14:00"},
  {date:"2024-03-23",home:"ssg",away:"doosan",homeScore:3,awayScore:4,homeSP:"앤더슨",awaySP:"곽빈",weather:"cloudy",time:"14:00"},
  {date:"2024-03-23",home:"hanwha",away:"nc",homeScore:6,awayScore:2,homeSP:"류현진",awaySP:"루친스키",weather:"cold",time:"14:00"},
  {date:"2024-03-23",home:"lotte",away:"kiwoom",homeScore:4,awayScore:5,homeSP:"박세웅",awaySP:"안우진",weather:"sunny",time:"14:00"},
  {date:"2024-03-24",home:"kia",away:"samsung",homeScore:8,awayScore:5,homeSP:"네일",awaySP:"사이드",weather:"sunny",time:"14:00"},
  {date:"2024-03-24",home:"lg",away:"kt",homeScore:6,awayScore:4,homeSP:"엔스",awaySP:"소형준",weather:"sunny",time:"14:00"},
  {date:"2024-03-24",home:"ssg",away:"doosan",homeScore:5,awayScore:3,homeSP:"문동주",awaySP:"쿠에바스",weather:"cloudy",time:"14:00"},
  {date:"2024-03-24",home:"hanwha",away:"nc",homeScore:3,awayScore:4,homeSP:"한승혁",awaySP:"성재현",weather:"cloudy",time:"14:00"},
  {date:"2024-03-24",home:"lotte",away:"kiwoom",homeScore:2,awayScore:6,homeSP:"레예스",awaySP:"주니어",weather:"sunny",time:"14:00"},
  {date:"2024-04-05",home:"samsung",away:"lg",homeScore:4,awayScore:3,homeSP:"원태인",awaySP:"임찬규",weather:"cloudy",time:"18:30"},
  {date:"2024-04-05",home:"kia",away:"ssg",homeScore:5,awayScore:2,homeSP:"양현종",awaySP:"김광현",weather:"sunny",time:"18:30"},
  {date:"2024-04-05",home:"doosan",away:"hanwha",homeScore:7,awayScore:3,homeSP:"곽빈",awaySP:"쿠엘라",weather:"cloudy",time:"18:30"},
  {date:"2024-04-05",home:"kt",away:"nc",homeScore:5,awayScore:4,homeSP:"쿠에바스",awaySP:"루친스키",weather:"cloudy",time:"18:30"},
  {date:"2024-04-05",home:"kiwoom",away:"lotte",homeScore:3,awayScore:7,homeSP:"안우진",awaySP:"박세웅",weather:"cloudy",time:"18:30"},
  {date:"2024-04-20",home:"kia",away:"doosan",homeScore:6,awayScore:1,homeSP:"네일",awaySP:"이영하",weather:"sunny",time:"14:00"},
  {date:"2024-04-20",home:"lg",away:"hanwha",homeScore:8,awayScore:2,homeSP:"엔스",awaySP:"류현진",weather:"sunny",time:"14:00"},
  {date:"2024-04-20",home:"ssg",away:"nc",homeScore:4,awayScore:3,homeSP:"앤더슨",awaySP:"성재현",weather:"cloudy",time:"14:00"},
  {date:"2024-04-20",home:"samsung",away:"kiwoom",homeScore:9,awayScore:2,homeSP:"원태인",awaySP:"김인범",weather:"sunny",time:"14:00"},
  {date:"2024-04-20",home:"lotte",away:"kt",homeScore:3,awayScore:5,homeSP:"한현희",awaySP:"벤자민",weather:"sunny",time:"14:00"},
  {date:"2024-05-04",home:"kia",away:"lg",homeScore:4,awayScore:3,homeSP:"양현종",awaySP:"김윤식",weather:"sunny",time:"14:00"},
  {date:"2024-05-04",home:"doosan",away:"samsung",homeScore:3,awayScore:6,homeSP:"쿠에바스",awaySP:"사이드",weather:"sunny",time:"14:00"},
  {date:"2024-05-04",home:"hanwha",away:"ssg",homeScore:5,awayScore:7,homeSP:"한승혁",awaySP:"앤더슨",weather:"sunny",time:"14:00"},
  {date:"2024-05-04",home:"nc",away:"kiwoom",homeScore:6,awayScore:3,homeSP:"루친스키",awaySP:"주니어",weather:"sunny",time:"14:00"},
  {date:"2024-05-04",home:"kt",away:"lotte",homeScore:5,awayScore:2,homeSP:"쿠에바스",awaySP:"레예스",weather:"sunny",time:"14:00"},
  {date:"2024-05-18",home:"lg",away:"kia",homeScore:2,awayScore:5,homeSP:"임찬규",awaySP:"네일",weather:"sunny",time:"18:30"},
  {date:"2024-05-18",home:"samsung",away:"ssg",homeScore:4,awayScore:3,homeSP:"원태인",awaySP:"문동주",weather:"cloudy",time:"18:30"},
  {date:"2024-05-18",home:"doosan",away:"nc",homeScore:5,awayScore:2,homeSP:"곽빈",awaySP:"성재현",weather:"cloudy",time:"18:30"},
  {date:"2024-05-18",home:"hanwha",away:"kt",homeScore:4,awayScore:6,homeSP:"류현진",awaySP:"소형준",weather:"hot",time:"18:30"},
  {date:"2024-05-18",home:"lotte",away:"kiwoom",homeScore:7,awayScore:4,homeSP:"박세웅",awaySP:"안우진",weather:"hot",time:"18:30"},
  {date:"2024-06-08",home:"kia",away:"hanwha",homeScore:8,awayScore:1,homeSP:"양현종",awaySP:"쿠엘라",weather:"hot",time:"17:00"},
  {date:"2024-06-08",home:"samsung",away:"doosan",homeScore:6,awayScore:4,homeSP:"사이드",awaySP:"이영하",weather:"hot",time:"17:00"},
  {date:"2024-06-08",home:"lg",away:"lotte",homeScore:5,awayScore:2,homeSP:"엔스",awaySP:"한현희",weather:"hot",time:"17:00"},
  {date:"2024-06-08",home:"ssg",away:"kt",homeScore:4,awayScore:3,homeSP:"앤더슨",awaySP:"벤자민",weather:"cloudy",time:"17:00"},
  {date:"2024-06-08",home:"nc",away:"kiwoom",homeScore:3,awayScore:5,homeSP:"송명기",awaySP:"안우진",weather:"cloudy",time:"17:00"},
  {date:"2024-06-22",home:"kia",away:"nc",homeScore:7,awayScore:2,homeSP:"네일",awaySP:"루친스키",weather:"hot",time:"18:30"},
  {date:"2024-06-22",home:"samsung",away:"kt",homeScore:5,awayScore:4,homeSP:"원태인",awaySP:"쿠에바스",weather:"hot",time:"18:30"},
  {date:"2024-06-22",home:"lg",away:"kiwoom",homeScore:6,awayScore:1,homeSP:"임찬규",awaySP:"김인범",weather:"hot",time:"18:30"},
  {date:"2024-06-22",home:"doosan",away:"ssg",homeScore:3,awayScore:5,homeSP:"쿠에바스",awaySP:"앤더슨",weather:"hot",time:"18:30"},
  {date:"2024-06-22",home:"hanwha",away:"lotte",homeScore:4,awayScore:6,homeSP:"한승혁",awaySP:"박세웅",weather:"hot",time:"18:30"},
  {date:"2024-07-13",home:"kia",away:"ssg",homeScore:5,awayScore:3,homeSP:"양현종",awaySP:"김광현",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"lg",away:"samsung",homeScore:4,awayScore:5,homeSP:"엔스",awaySP:"사이드",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"doosan",away:"lotte",homeScore:6,awayScore:3,homeSP:"곽빈",awaySP:"레예스",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"hanwha",away:"kiwoom",homeScore:5,awayScore:4,homeSP:"류현진",awaySP:"주니어",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"nc",away:"kt",homeScore:3,awayScore:4,homeSP:"성재현",awaySP:"소형준",weather:"cloudy",time:"18:30"},
  {date:"2024-08-10",home:"kia",away:"kt",homeScore:6,awayScore:2,homeSP:"네일",awaySP:"벤자민",weather:"hot",time:"18:30"},
  {date:"2024-08-10",home:"samsung",away:"hanwha",homeScore:8,awayScore:3,homeSP:"원태인",awaySP:"쿠엘라",weather:"hot",time:"18:30"},
  {date:"2024-08-10",home:"lg",away:"nc",homeScore:5,awayScore:1,homeSP:"임찬규",awaySP:"송명기",weather:"hot",time:"18:30"},
  {date:"2024-08-10",home:"ssg",away:"lotte",homeScore:4,awayScore:2,homeSP:"앤더슨",awaySP:"한현희",weather:"hot",time:"18:30"},
  {date:"2024-08-10",home:"doosan",away:"kiwoom",homeScore:7,awayScore:3,homeSP:"곽빈",awaySP:"안우진",weather:"hot",time:"18:30"},
  {date:"2024-08-24",home:"samsung",away:"kia",homeScore:3,awayScore:7,homeSP:"이승현",awaySP:"양현종",weather:"hot",time:"18:30"},
  {date:"2024-08-24",home:"lg",away:"doosan",homeScore:4,awayScore:2,homeSP:"엔스",awaySP:"이영하",weather:"sunny",time:"18:30"},
  {date:"2024-08-24",home:"ssg",away:"nc",homeScore:6,awayScore:3,homeSP:"문동주",awaySP:"루친스키",weather:"sunny",time:"18:30"},
  {date:"2024-08-24",home:"kt",away:"hanwha",homeScore:5,awayScore:4,homeSP:"쿠에바스",awaySP:"한승혁",weather:"sunny",time:"18:30"},
  {date:"2024-08-24",home:"kiwoom",away:"lotte",homeScore:4,awayScore:6,homeSP:"김인범",awaySP:"박세웅",weather:"sunny",time:"18:30"},
  {date:"2024-09-07",home:"kia",away:"lotte",homeScore:9,awayScore:2,homeSP:"네일",awaySP:"레예스",weather:"sunny",time:"18:30"},
  {date:"2024-09-07",home:"samsung",away:"nc",homeScore:5,awayScore:1,homeSP:"원태인",awaySP:"성재현",weather:"sunny",time:"18:30"},
  {date:"2024-09-07",home:"lg",away:"ssg",homeScore:3,awayScore:4,homeSP:"김윤식",awaySP:"앤더슨",weather:"cloudy",time:"18:30"},
  {date:"2024-09-07",home:"doosan",away:"kt",homeScore:6,awayScore:5,homeSP:"쿠에바스",awaySP:"소형준",weather:"sunny",time:"18:30"},
  {date:"2024-09-07",home:"hanwha",away:"kiwoom",homeScore:7,awayScore:3,homeSP:"류현진",awaySP:"주니어",weather:"sunny",time:"18:30"},
];

// ── 시즌별 데이터 자동 적용 함수 ──
// 날짜 기반으로 시즌 연도 추출 (KBO 시즌은 3월~10월)
function getSeasonYear(dateStr) {
  if (!dateStr) return 2026;
  const y = parseInt(dateStr.split("-")[0]);
  if (y >= 2024 && y <= 2026) return y;
  return 2026; // 기본값: 최신 시즌
}

// 시즌별 팀 데이터 오버레이 (해당 시즌의 선발/불펜/팀레이팅 적용)
function getSeasonTeam(teamId, seasonYear) {
  const base = KBO_TEAMS[teamId];
  if (!base) return null;
  if (seasonYear === 2026) return base; // 현재 데이터 그대로
  if (seasonYear === 2025) {
    return { ...base,
      starters: LEGACY_STARTERS_2025[teamId] || base.starters,
      bullpen: TEAM_BULLPEN_2025[teamId] || base.bullpen,
      teamRating: TEAM_RATINGS_2025[teamId] || base.teamRating,
    };
  }
  if (seasonYear === 2024) {
    return { ...base,
      starters: LEGACY_STARTERS_2024[teamId] || base.starters,
      bullpen: TEAM_BULLPEN_2024[teamId] || base.bullpen,
      teamRating: TEAM_RATINGS_2024[teamId] || base.teamRating,
    };
  }
  return base;
}

// 시즌별 H2H 레코드 반환
function getSeasonH2H(seasonYear) {
  if (seasonYear === 2024) return H2H_RECORDS_2024;
  return H2H_RECORDS; // 2025, 2026 모두 2025 H2H 사용
}

// 시즌별 백테스트 결과 데이터
function getSeasonResults(seasonYear) {
  if (seasonYear === 2024) return SEASON_2024_RESULTS;
  if (seasonYear === 2025) return SEASON_2025_RESULTS;
  if (seasonYear === 2026) return SEASON_2026_RESULTS;
  return [];
}

// ── 2025 시즌 백테스트용 레거시 데이터 (2026에서 이탈한 선수·팀레이팅 보존) ──
const LEGACY_STARTERS_2025 = {
  samsung: [
    { name: "후라도", throws: "R", era:2.71, whip:1.08, k9:5.9, bb9:1.4, ip:6, recentForm: 0.92, war:7.57, wpaLI:3.48, fip:2.80 },
    { name: "원태인", throws: "R", era:3.24, whip:1.10, k9:5.8, bb9:2.3, ip:166.2, recentForm: 1.08, war:4.20 },
    { name: "이승현", throws: "R", era:4.72, whip:1.35, k9:6.0, bb9:3.5, ip:90, recentForm: 0.85, war:0.80 },
  ],
  kia: [
    { name: "네일", throws: "R", era:0, whip:0.5, k9:7.5, bb9:1.5, ip:6, recentForm: 1.15, war:6.59, wpaLI:3.37, fip:3.08 },
    { name: "올러", throws: "R", era:2.57, whip:0.972, k9:8.8, bb9:2.2, ip:149, recentForm: 1.08, war:4.25, fip:2.97 },
    { name: "이의리", throws: "R", era:7.94, whip:1.77, k9:9.5, bb9:7.0, ip:39.2, recentForm: 0.70, war:0.20 },
  ],
  lg: [
    { name: "임찬규", throws: "L", era:5.4, whip:1.6, k9:1.8, bb9:3.6, ip:5, recentForm: 1.08, war:4.50, fip:3.40 },
    { name: "치리노스", throws: "R", era:3.31, whip:1.18, k9:7, bb9:1.8, ip:177, recentForm: 1.05, war:5.03, wpaLI:3.08, fip:3.01 },
    { name: "김윤식", throws: "L", era:3.80, whip:1.22, k9:7.8, bb9:2.8, ip:135, recentForm: 1.0, war:2.50 },
  ],
  doosan: [
    { name: "잭로그", throws: "R", era:2.39, whip:0.992, k9:7.9, bb9:2, ip:176, recentForm: 1.08, war:4.53, wpaLI:3.05, fip:3.20 },
    { name: "곽빈", throws: "R", era:9, whip:1.75, k9:11.3, bb9:4.5, ip:4, recentForm: 0.90, war:1.50 },
    { name: "이영하", throws: "R", era:4.05, whip:1.53, k9:9.7, bb9:3.2, ip:66.2, recentForm: 0.92, war:1.20 },
  ],
  kt: [
    { name: "소형준", throws: "R", era:3.30, whip:1.15, k9:7.8, bb9:2.5, ip:155, recentForm: 1.08, war:4.19, fip:2.94 },
    { name: "헤이수스", throws: "R", era:3.96, whip:1.33, k9:9.1, bb9:2.4, ip:160, recentForm: 1.0, war:3.20, fip:3.50 },
    { name: "고영표", throws: "R", era:3.3, whip:1.24, k9:8.6, bb9:1.7, ip:150, recentForm: 0.92, war:4.10, fip:3.16 },
    { name: "박영현", throws: "R", era:3.619, whip:1.244, k9:8.048, bb9:3.571, ip:70, recentForm: 1.05, war:2.50 },
    { name: "벤자민", throws: "R", era:3.80, whip:1.20, k9:8.0, bb9:2.8, ip:145, recentForm: 1.0, war:2.80 },
  ],
  ssg: [
    { name: "앤더슨", throws: "R", era:2.25, whip:1.00, k9:12.8, bb9:2.0, ip:171.2, recentForm: 1.20, war:6.54, fip:2.61 },
    { name: "김광현", throws: "L", era:5.00, whip:1.30, k9:8.6, bb9:2.5, ip:144, recentForm: 0.82, war:1.80 },
    { name: "미치화이트", throws: "R", era:5.65, whip:1.901, k9:7.3, bb9:4.1, ip:155, recentForm: 0.99, war:3.80, fip:3.44 },
    { name: "윌커슨", throws: "R", era:3.50, whip:1.18, k9:8.5, bb9:2.5, ip:140, recentForm: 1.0, war:2.50 },
  ],
  hanwha: [
    { name: "폰세", throws: "R", era:1.89, whip:0.94, k9:12.6, bb9:2, ip:180.2, recentForm: 1.28, war:8.38, wpaLI:5.04, fip:2.14 },
    { name: "와이스", throws: "R", era:2.87, whip:1.02, k9:10.4, bb9:2.8, ip:178.2, recentForm: 1.18, war:5.95, fip:3.24 },
    { name: "류현진", throws: "L", era:3.65, whip:1.20, k9:7.0, bb9:2.2, ip:140, recentForm: 0.95, war:2.80 },
  ],
  lotte: [
    { name: "박세웅", throws: "R", era:4.93, whip:1.30, k9:8.7, bb9:3.0, ip:160.2, recentForm: 0.90, war:2.50, fip:4.20 },
    { name: "감보아", throws: "R", era:3.60, whip:1.20, k9:9.8, bb9:2.8, ip:155, recentForm: 1.0, war:3.50, fip:3.30 },
    { name: "나균안", throws: "R", era:3.76, whip:1.333, k9:7.9, bb9:3.1, ip:140, recentForm: 1.04, war:1.80 },
    { name: "한현희", throws: "R", era:4.50, whip:1.30, k9:7.0, bb9:3.0, ip:130, recentForm: 0.90, war:1.20 },
    { name: "레예스", throws: "R", era:4.00, whip:1.22, k9:8.0, bb9:2.8, ip:140, recentForm: 1.0, war:2.00 },
  ],
  nc: [
    { name: "라일리", throws: "R", era:3.45, whip:1.12, k9:11.3, bb9:2.9, ip:172, recentForm: 1.10, war:4.20, fip:3.01 },
    { name: "루친스키", throws: "R", era:3.80, whip:1.20, k9:8.5, bb9:2.5, ip:155, recentForm: 1.0, war:3.00, fip:3.40 },
    { name: "성재현", throws: "R", era:4.10, whip:1.28, k9:7.5, bb9:3.0, ip:142, recentForm: 0.95, war:1.50 },
  ],
  kiwoom: [
    { name: "안우진", throws: "R", era:3.20, whip:1.10, k9:9.5, bb9:2.5, ip:170, recentForm: 1.10, war:5.00, fip:3.00 },
    { name: "주니어", throws: "R", era:4.00, whip:1.25, k9:8.0, bb9:3.0, ip:140, recentForm: 0.95, war:2.00 },
    { name: "김인범", throws: "R", era:3.85, whip:1.24, k9:7.8, bb9:3.0, ip:120, recentForm: 0.98, war:2.00 },
  ],
};
const TEAM_RATINGS_2025 = {
  samsung: 84, kia: 74, lg: 92, doosan: 72, kt: 79,
  ssg: 85, hanwha: 90, lotte: 76, nc: 80, kiwoom: 55,
};
const TEAM_BULLPEN_2025 = {
  samsung: { era:3.85, whip:1.25, k9:8.2, bb9:3.0 },
  kia:     { era:3.55, whip:1.20, k9:8.5, bb9:2.8 },
  lg:      { era:3.50, whip:1.18, k9:8.8, bb9:2.5 },
  doosan:  { era:3.90, whip:1.28, k9:8.0, bb9:3.0 },
  kt:      { era:3.70, whip:1.22, k9:8.3, bb9:2.8 },
  ssg:     { era:3.65, whip:1.22, k9:8.5, bb9:2.7 },
  hanwha:  { era:4.10, whip:1.30, k9:7.8, bb9:3.2 },
  lotte:   { era:4.15, whip:1.30, k9:7.5, bb9:3.2 },
  nc:      { era:3.85, whip:1.25, k9:8.0, bb9:3.0 },
  kiwoom:  { era:4.50, whip:1.35, k9:7.8, bb9:3.2 },
};

// ── 2025 시즌 실제 경기 결과 (백테스트용 샘플 60경기) ──
const SEASON_2025_RESULTS = [
  { date:"2025-03-22", home:"lg", away:"kia", homeScore:5, awayScore:3, homeSP:"임찬규", awaySP:"네일", weather:"cloudy", time:"14:00" },
  { date:"2025-03-22", home:"samsung", away:"hanwha", homeScore:2, awayScore:7, homeSP:"후라도", awaySP:"폰세", weather:"sunny", time:"14:00" },
  { date:"2025-03-22", home:"ssg", away:"doosan", homeScore:4, awayScore:1, homeSP:"앤더슨", awaySP:"곽빈", weather:"cloudy", time:"14:00" },
  { date:"2025-03-22", home:"kt", away:"lotte", homeScore:6, awayScore:2, homeSP:"박영현", awaySP:"박세웅", weather:"cloudy", time:"14:00" },
  { date:"2025-03-22", home:"nc", away:"kiwoom", homeScore:3, awayScore:1, homeSP:"라일리", awaySP:"안우진", weather:"sunny", time:"14:00" },
  { date:"2025-03-23", home:"lg", away:"kia", homeScore:8, awayScore:4, homeSP:"치리노스", awaySP:"올러", weather:"sunny", time:"14:00" },
  { date:"2025-03-23", home:"samsung", away:"hanwha", homeScore:3, awayScore:5, homeSP:"원태인", awaySP:"와이스", weather:"sunny", time:"14:00" },
  { date:"2025-03-23", home:"ssg", away:"doosan", homeScore:6, awayScore:3, homeSP:"김광현", awaySP:"잭로그", weather:"cloudy", time:"14:00" },
  { date:"2025-03-23", home:"kt", away:"lotte", homeScore:4, awayScore:5, homeSP:"소형준", awaySP:"레예스", weather:"cloudy", time:"14:00" },
  { date:"2025-03-23", home:"nc", away:"kiwoom", homeScore:7, awayScore:2, homeSP:"루친스키", awaySP:"주니어", weather:"sunny", time:"14:00" },
  { date:"2025-04-01", home:"hanwha", away:"lg", homeScore:4, awayScore:3, homeSP:"폰세", awaySP:"임찬규", weather:"cloudy", time:"18:30" },
  { date:"2025-04-01", home:"kia", away:"samsung", homeScore:6, awayScore:5, homeSP:"네일", awaySP:"후라도", weather:"sunny", time:"18:30" },
  { date:"2025-04-01", home:"doosan", away:"kt", homeScore:3, awayScore:4, homeSP:"곽빈", awaySP:"박영현", weather:"cloudy", time:"18:30" },
  { date:"2025-04-01", home:"kiwoom", away:"ssg", homeScore:2, awayScore:6, homeSP:"안우진", awaySP:"앤더슨", weather:"cloudy", time:"18:30" },
  { date:"2025-04-01", home:"lotte", away:"nc", homeScore:5, awayScore:4, homeSP:"박세웅", awaySP:"라일리", weather:"sunny", time:"18:30" },
  { date:"2025-04-15", home:"lg", away:"samsung", homeScore:7, awayScore:2, homeSP:"임찬규", awaySP:"이승현", weather:"sunny", time:"18:30" },
  { date:"2025-04-15", home:"hanwha", away:"kia", homeScore:3, awayScore:1, homeSP:"폰세", awaySP:"이의리", weather:"cloudy", time:"18:30" },
  { date:"2025-04-15", home:"ssg", away:"nc", homeScore:5, awayScore:3, homeSP:"앤더슨", awaySP:"루친스키", weather:"cloudy", time:"18:30" },
  { date:"2025-04-15", home:"kt", away:"kiwoom", homeScore:8, awayScore:1, homeSP:"박영현", awaySP:"김인범", weather:"sunny", time:"18:30" },
  { date:"2025-04-15", home:"doosan", away:"lotte", homeScore:4, awayScore:6, homeSP:"잭로그", awaySP:"박세웅", weather:"cloudy", time:"18:30" },
  { date:"2025-05-03", home:"samsung", away:"lg", homeScore:3, awayScore:8, homeSP:"후라도", awaySP:"치리노스", weather:"sunny", time:"14:00" },
  { date:"2025-05-03", home:"kia", away:"ssg", homeScore:2, awayScore:4, homeSP:"올러", awaySP:"앤더슨", weather:"sunny", time:"14:00" },
  { date:"2025-05-03", home:"hanwha", away:"doosan", homeScore:6, awayScore:1, homeSP:"와이스", awaySP:"이영하", weather:"hot", time:"14:00" },
  { date:"2025-05-03", home:"nc", away:"kt", homeScore:5, awayScore:3, homeSP:"라일리", awaySP:"소형준", weather:"sunny", time:"14:00" },
  { date:"2025-05-03", home:"lotte", away:"kiwoom", homeScore:7, awayScore:4, homeSP:"박세웅", awaySP:"안우진", weather:"hot", time:"14:00" },
  { date:"2025-05-20", home:"lg", away:"doosan", homeScore:5, awayScore:2, homeSP:"김윤식", awaySP:"곽빈", weather:"sunny", time:"18:30" },
  { date:"2025-05-20", home:"samsung", away:"kiwoom", homeScore:9, awayScore:3, homeSP:"후라도", awaySP:"주니어", weather:"hot", time:"18:30" },
  { date:"2025-05-20", home:"ssg", away:"kia", homeScore:3, awayScore:2, homeSP:"윌커슨", awaySP:"네일", weather:"cloudy", time:"18:30" },
  { date:"2025-05-20", home:"hanwha", away:"nc", homeScore:4, awayScore:1, homeSP:"폰세", awaySP:"성재현", weather:"hot", time:"18:30" },
  { date:"2025-05-20", home:"kt", away:"lotte", homeScore:6, awayScore:5, homeSP:"박영현", awaySP:"레예스", weather:"sunny", time:"18:30" },
  { date:"2025-06-07", home:"lg", away:"hanwha", homeScore:4, awayScore:6, homeSP:"임찬규", awaySP:"폰세", weather:"hot", time:"17:00" },
  { date:"2025-06-07", home:"samsung", away:"nc", homeScore:5, awayScore:3, homeSP:"원태인", awaySP:"라일리", weather:"hot", time:"17:00" },
  { date:"2025-06-07", home:"kia", away:"doosan", homeScore:7, awayScore:4, homeSP:"네일", awaySP:"잭로그", weather:"hot", time:"17:00" },
  { date:"2025-06-07", home:"ssg", away:"lotte", homeScore:3, awayScore:1, homeSP:"앤더슨", awaySP:"한현희", weather:"cloudy", time:"17:00" },
  { date:"2025-06-07", home:"kiwoom", away:"kt", homeScore:2, awayScore:5, homeSP:"안우진", awaySP:"벤자민", weather:"cloudy", time:"17:00" },
  { date:"2025-06-21", home:"hanwha", away:"samsung", homeScore:8, awayScore:2, homeSP:"폰세", awaySP:"이승현", weather:"hot", time:"18:30" },
  { date:"2025-06-21", home:"lg", away:"kiwoom", homeScore:6, awayScore:1, homeSP:"치리노스", awaySP:"김인범", weather:"hot", time:"18:30" },
  { date:"2025-06-21", home:"kia", away:"kt", homeScore:4, awayScore:3, homeSP:"올러", awaySP:"소형준", weather:"hot", time:"18:30" },
  { date:"2025-06-21", home:"doosan", away:"ssg", homeScore:2, awayScore:5, homeSP:"곽빈", awaySP:"앤더슨", weather:"hot", time:"18:30" },
  { date:"2025-06-21", home:"nc", away:"lotte", homeScore:3, awayScore:4, homeSP:"루친스키", awaySP:"박세웅", weather:"sunny", time:"18:30" },
  { date:"2025-07-12", home:"lg", away:"ssg", homeScore:4, awayScore:2, homeSP:"임찬규", awaySP:"김광현", weather:"rainy", time:"18:30" },
  { date:"2025-07-12", home:"samsung", away:"kia", homeScore:6, awayScore:5, homeSP:"후라도", awaySP:"이의리", weather:"rainy", time:"18:30" },
  { date:"2025-07-12", home:"hanwha", away:"kt", homeScore:7, awayScore:3, homeSP:"와이스", awaySP:"벤자민", weather:"rainy", time:"18:30" },
  { date:"2025-07-12", home:"doosan", away:"nc", homeScore:4, awayScore:6, homeSP:"잭로그", awaySP:"라일리", weather:"cloudy", time:"18:30" },
  { date:"2025-07-12", home:"lotte", away:"kiwoom", homeScore:5, awayScore:2, homeSP:"박세웅", awaySP:"주니어", weather:"rainy", time:"18:30" },
  { date:"2025-08-09", home:"lg", away:"nc", homeScore:3, awayScore:1, homeSP:"치리노스", awaySP:"성재현", weather:"hot", time:"18:30" },
  { date:"2025-08-09", home:"hanwha", away:"lotte", homeScore:5, awayScore:0, homeSP:"폰세", awaySP:"한현희", weather:"hot", time:"18:30" },
  { date:"2025-08-09", home:"samsung", away:"doosan", homeScore:7, awayScore:4, homeSP:"후라도", awaySP:"이영하", weather:"hot", time:"18:30" },
  { date:"2025-08-09", home:"ssg", away:"kt", homeScore:4, awayScore:3, homeSP:"앤더슨", awaySP:"소형준", weather:"hot", time:"18:30" },
  { date:"2025-08-09", home:"kia", away:"kiwoom", homeScore:8, awayScore:2, homeSP:"네일", awaySP:"안우진", weather:"hot", time:"18:30" },
  { date:"2025-09-06", home:"lg", away:"lotte", homeScore:6, awayScore:2, homeSP:"임찬규", awaySP:"레예스", weather:"sunny", time:"18:30" },
  { date:"2025-09-06", home:"hanwha", away:"kiwoom", homeScore:9, awayScore:1, homeSP:"폰세", awaySP:"김인범", weather:"sunny", time:"18:30" },
  { date:"2025-09-06", home:"samsung", away:"kt", homeScore:4, awayScore:5, homeSP:"원태인", awaySP:"박영현", weather:"sunny", time:"18:30" },
  { date:"2025-09-06", home:"ssg", away:"kia", homeScore:3, awayScore:4, homeSP:"윌커슨", awaySP:"올러", weather:"cloudy", time:"18:30" },
  { date:"2025-09-06", home:"doosan", away:"nc", homeScore:5, awayScore:3, homeSP:"잭로그", awaySP:"루친스키", weather:"sunny", time:"18:30" },
  { date:"2025-09-27", home:"lg", away:"kt", homeScore:7, awayScore:3, homeSP:"치리노스", awaySP:"벤자민", weather:"cloudy", time:"14:00" },
  { date:"2025-09-27", home:"hanwha", away:"doosan", homeScore:4, awayScore:2, homeSP:"와이스", awaySP:"이영하", weather:"sunny", time:"14:00" },
  { date:"2025-09-27", home:"samsung", away:"ssg", homeScore:3, awayScore:5, homeSP:"이승현", awaySP:"앤더슨", weather:"cloudy", time:"14:00" },
  { date:"2025-09-27", home:"kia", away:"nc", homeScore:5, awayScore:4, homeSP:"네일", awaySP:"라일리", weather:"sunny", time:"14:00" },
  { date:"2025-09-27", home:"lotte", away:"kiwoom", homeScore:6, awayScore:3, homeSP:"박세웅", awaySP:"주니어", weather:"cloudy", time:"14:00" },
];

// ── 2026 시즌 실제 경기 결과 (백테스트용 — 시즌 진행 중 자동 확장) ──
const SEASON_2026_RESULTS = [
  // 3/28 개막전 (토)
  { date:"2026-03-28", home:"lg", away:"kt", homeScore:7, awayScore:11, homeSP:"치리노스", awaySP:"사우어", weather:"cloudy", time:"14:00" },
  { date:"2026-03-28", home:"ssg", away:"kia", homeScore:7, awayScore:6, homeSP:"화이트", awaySP:"네일", weather:"cloudy", time:"14:00" },
  { date:"2026-03-28", home:"samsung", away:"lotte", homeScore:3, awayScore:6, homeSP:"후라도", awaySP:"로드리게스", weather:"sunny", time:"14:00" },
  { date:"2026-03-28", home:"nc", away:"doosan", homeScore:6, awayScore:0, homeSP:"구창모", awaySP:"플렉센", weather:"cloudy", time:"14:00" },
  { date:"2026-03-28", home:"hanwha", away:"kiwoom", homeScore:10, awayScore:9, homeSP:"에르난데스", awaySP:"알칸타라", weather:"sunny", time:"14:00" },
  // 3/29 (일)
  { date:"2026-03-29", home:"lg", away:"kt", homeScore:5, awayScore:6, homeSP:"임찬규", awaySP:"소형준", weather:"sunny", time:"14:00" },
  { date:"2026-03-29", home:"ssg", away:"kia", homeScore:11, awayScore:6, homeSP:"김건우", awaySP:"이의리", weather:"cloudy", time:"14:00" },
  { date:"2026-03-29", home:"samsung", away:"lotte", homeScore:2, awayScore:6, homeSP:"최원태", awaySP:"비슬리", weather:"sunny", time:"14:00" },
  { date:"2026-03-29", home:"nc", away:"doosan", homeScore:6, awayScore:9, homeSP:"테일러", awaySP:"곽빈", weather:"cloudy", time:"14:00" },
  { date:"2026-03-29", home:"hanwha", away:"kiwoom", homeScore:10, awayScore:4, homeSP:"왕옌청", awaySP:"하영민", weather:"sunny", time:"14:00" },
  // 3/31 (화)
  { date:"2026-03-31", home:"lg", away:"kia", homeScore:2, awayScore:7, homeSP:"톨허스트", awaySP:"올러", weather:"cloudy", time:"18:30" },
  { date:"2026-03-31", home:"ssg", away:"kiwoom", homeScore:9, awayScore:3, homeSP:"베니지아노", awaySP:"와일스", weather:"cloudy", time:"18:30" },
  { date:"2026-03-31", home:"samsung", away:"doosan", homeScore:5, awayScore:5, homeSP:"오러클린", awaySP:"잭로그", weather:"cloudy", time:"18:30" },
  { date:"2026-03-31", home:"nc", away:"lotte", homeScore:9, awayScore:2, homeSP:"토다", awaySP:"박세웅", weather:"cloudy", time:"18:30" },
  { date:"2026-03-31", home:"hanwha", away:"kt", homeScore:4, awayScore:9, homeSP:"화이트", awaySP:"보쉴리", weather:"cloudy", time:"18:30" },
];

function tempToWeatherKey(tempC, desc = "") {
  const d = desc.toLowerCase();
  if (d.includes("rain") || d.includes("drizzle") || d.includes("shower")) return "rainy";
  if (d.includes("wind") || d.includes("gust")) return "windy";
  if (tempC <= 5) return "cold";
  if (tempC >= 30) return "hot";
  if (d.includes("cloud") || d.includes("overcast") || d.includes("mist") || d.includes("fog")) return "cloudy";
  return "sunny";
}

// ── wOBA 계산 (가중출루율 - FanGraphs/KBO 가중치) ──
// wOBA = (0.69×BB + 0.72×HBP + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR) / PA
// 간이 계산: OBP와 SLG 기반 추정 (wOBA ≈ OBP × 0.72 + SLG × 0.28 보정)
function calcWOBA(b) {
  if (b.woba) return b.woba;
  return _.clamp(b.obp * 0.72 + (b.slg - b.avg) * 0.52 + b.avg * 0.21, .200, .500);
}

// ── FIP 계산 (수비무관투구 - 리그 상수 3.10 KBO 기준) ──
// FIP = (13×HR + 3×BB - 2×K) / IP + FIP상수
function calcFIP(p) {
  if (p.fip) return p.fip;
  const ip = p.ip || 150;
  const hr9 = (p.era / 9) * 0.25; // HR/9 추정 (ERA 기반)
  return _.clamp(13 * hr9 + 3 * (p.bb9 / 9) - 2 * (p.k9 / 9) + 3.10, 1.5, 6.5);
}

// ── 피타고리안 기대승률 (팀 득실점 기반 전력 지표) ──
// Pyth = RS^1.83 / (RS^1.83 + RA^1.83)  [exponent 1.83 = KBO 최적화]
function calcPythagorean(rs, ra) {
  if (rs <= 0 || ra <= 0) return 0.5;
  return rs ** 1.83 / (rs ** 1.83 + ra ** 1.83);
}

// ── Elo 레이팅 (팀 전력 동적 지표) ──
// 기본 1500, 시즌 성적 반영: Elo = 1500 + (winPct - 0.5) * 400 + pythAdj
function calcElo(record) {
  if (!record || !record.w) return 1500;
  const winPct = record.w / (record.w + record.l);
  const pyth = calcPythagorean(record.rs || 0, record.ra || 0);
  // 실제 승률과 피타고리안의 가중 평균 (6:4)
  const blended = winPct * 0.6 + pyth * 0.4;
  return Math.round(1500 + (blended - 0.5) * 400);
}

// ── 평균 회귀 (소표본 보정) ──
// 선수 스탯이 리그 평균에서 크게 벗어날 때, 표본 크기에 따라 평균으로 회귀
const LEAGUE_AVG = { avg: .265, obp: .340, slg: .410, era: 3.80, whip: 1.22, k9: 8.0, bb9: 2.8 };
function regressBatter(b) {
  // PA 추정 (AB ≈ 550 for full season, HR 기반 추정)
  const paEst = b.hr > 30 ? 600 : b.hr > 15 ? 500 : b.hr > 5 ? 400 : 300;
  const regFactor = Math.min(1, paEst / 500); // 1.0 = 충분한 표본
  return {
    ...b,
    avg: b.avg * regFactor + LEAGUE_AVG.avg * (1 - regFactor),
    obp: b.obp * regFactor + LEAGUE_AVG.obp * (1 - regFactor),
    slg: b.slg * regFactor + LEAGUE_AVG.slg * (1 - regFactor),
  };
}
function regressPitcher(p) {
  const ipEst = p.ip || 150;
  const regFactor = Math.min(1, ipEst / 160);
  return {
    ...p,
    era: p.era * regFactor + LEAGUE_AVG.era * (1 - regFactor),
    whip: p.whip * regFactor + LEAGUE_AVG.whip * (1 - regFactor),
    k9: p.k9 * regFactor + LEAGUE_AVG.k9 * (1 - regFactor),
    bb9: p.bb9 * regFactor + LEAGUE_AVG.bb9 * (1 - regFactor),
  };
}

// ── KBO 10개 구단 (2025 시즌 Statiz/FancyStats 기반) ──
const KBO_TEAMS = {
  samsung: { id: "samsung", name: "삼성 라이온즈", short: "삼성", color: "#074CA1", aliases: ["삼성","라이온즈"], stadium: "daegu", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_SS.png",
    lineup: [
      { name: "디아즈", pos: "DH", bat: "R", avg:0.339, obp:0.396, slg:0.636, hr:3, spd:5, recentForm: 1.01, war:8.41, defRAA:9.86, rbi:158 },
      { name: "구자욱", pos: "LF", bat: "R", avg:0.319, obp:0.402, slg:0.516, hr:19, spd:6, recentForm: 1.05, war:6.80 },
      { name: "김성윤", pos: "RF", bat: "R", avg:0.35, obp:0.412, slg:0.511, hr:0, spd:7, recentForm: 1.07, war:5.85, sb:26 },
      { name: "김지찬", pos: "CF", bat: "R", avg:0.167, obp:0.375, slg:0.333, hr:0, spd:9, recentForm: 0.92 },
      { name: "이재현", pos: "3B", bat: "R", avg:0.254, obp:0.36, slg:0.427, hr:16, spd:5, recentForm: 0.98 },
      { name: "전병우", pos: "SS", bat: "R", avg:.272, obp:.338, slg:.408, hr:10, spd:5, recentForm: 1.0 },
      { name: "김호진", pos: "2B", bat: "R", avg:.265, obp:.325, slg:.378, hr:6, spd:6, recentForm: 0.98 },
      { name: "강민호", pos: "C", bat: "R", avg:0.269, obp:0.336, slg:0.417, hr:12, spd:3, recentForm: 0.95 },
      { name: "김인태", pos: "1B", bat: "R", avg:.265, obp:.330, slg:.418, hr:12, spd:4, recentForm: 0.95 },
    ],
    starters: [
      { name: "후라도", throws: "R", era:4.5, whip:1.17, k9:3, bb9:0, ip:6, recentForm: 1.15, war:7.57, wpaLI:3.48, fip:2.80 },
      { name: "오러클린", throws: "L", era:4.22, whip:1.327, k9:8, bb9:3.5, ip:124, recentForm: 0.92, war:1.50, fip:4.00 },
      { name: "원태인", throws: "R", era:3.24, whip:1.10, k9:5.8, bb9:2.3, ip:166.2, recentForm: 1.05, war:4.20 },
      { name: "최원태", throws: "R", era:4.31, whip:1.376, k9:8.7, bb9:3.5, ip:6, recentForm: 0.92, war:1.00 },
      { name: "양창섭", throws: "R", era:3.76, whip:1.287, k9:7.2, bb9:3.1, ip:100, recentForm: 1.04, war:0.80 },
      { name: "이승현", throws: "R", era:4.72, whip:1.35, k9:6.0, bb9:3.5, ip:90, recentForm: 0.95, war:0.80 },
      { name: "레예스", throws: "R", era:3.85, whip:1.250, k9:8.2, bb9:3.0, ip:30, recentForm: 1, war:0.3 }],
    bullpen: { era:3.85, whip:1.25, k9:8.2, bb9:3.0 }, teamRating: 82, record: { w:4, t:1, l:2, pct:"0.667", rs:38, ra:29 } },

  kia: { id: "kia", name: "기아 타이거즈", short: "기아", color: "#EA0029", aliases: ["기아","타이거즈","KIA"], stadium: "gwangju", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_HT.png",
    lineup: [
      { name: "김도영", pos: "SS", bat: "R", avg:0.315, obp:0.429, slg:0.538, hr:1, spd:8, recentForm: 1.08, war:5.50 },
      { name: "나성범", pos: "RF", bat: "R", avg:0.333, obp:0.4, slg:0.667, hr:1, spd:5, recentForm: 0.85 },
      { name: "카스트로", pos: "LF", bat: "S", avg:0.346, obp:0.415, slg:0.606, hr:1, spd:5, recentForm: 1.08, war:2.00 },
      { name: "박민", pos: "1B", bat: "R", avg:0.417, obp:0.512, slg:0.675, hr:12, spd:4, recentForm: 1.00 },
      { name: "김선빈", pos: "2B", bat: "R", avg:0.302, obp:0.387, slg:0.422, hr:0, spd:7, recentForm: 1.08 },
      { name: "데일", pos: "3B", bat: "R", avg:0.29, obp:0.367, slg:0.415, hr:1, spd:5, recentForm: 1.07, war:1.50 },
      { name: "이창진", pos: "CF", bat: "R", avg:.270, obp:.335, slg:.400, hr:8, spd:8, recentForm: 0.98 },
      { name: "한준수", pos: "C", bat: "R", avg:.250, obp:.315, slg:.370, hr:6, spd:3, recentForm: 0.95 },
      { name: "김호령", pos: "DH", bat: "R", avg:0, obp:0.2, slg:0.15, hr:0, spd:6, recentForm: 0.97 },
    ],
    starters: [
      { name: "네일", throws: "R", era:0, whip:0.5, k9:7.5, bb9:1.5, ip:6, recentForm: 1.10, war:6.59, wpaLI:3.37, fip:3.08 },
      { name: "올러", throws: "R", era:3.20, whip:1.12, k9:10.2, bb9:2.5, ip:149, recentForm: 1.12, war:4.25, fip:2.97 },
      { name: "이의리", throws: "R", era:7.94, whip:1.77, k9:9.5, bb9:7.0, ip:39.2, recentForm: 0.75, war:0.20 },
      { name: "양현종", throws: "L", era:5.06, whip:1.49, k9:6.4, bb9:3.4, ip:172, recentForm: 1.0, war:5.50, wpaLI:3.2 },
      { name: "김태형", throws: "R", era:5.00, whip:1.40, k9:7.0, bb9:3.5, ip:30, recentForm: 1.0, war:0.30 }],
    bullpen: { era:3.55, whip:1.20, k9:8.5, bb9:2.8 }, teamRating: 61, record: { w:1, t:0, l:6, pct:"0.143", rs:24, ra:40 } },

  lg: { id: "lg", name: "LG 트윈스", short: "LG", color: "#C30452", aliases: ["LG","엘지","트윈스"], stadium: "jamsil", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_LG.png",
    lineup: [
      { name: "오스틴", pos: "1B", bat: "R", avg:0.379, obp:0.449, slg:0.687, hr:3, spd:4, recentForm: 1.08, war:5.69, rbi:110 },
      { name: "박해민", pos: "CF", bat: "L", avg:0.276, obp:0.379, slg:0.346, hr:3, spd:9, recentForm: 1.10, defRAA:11.90, sb:49, war:4.50 },
      { name: "구본혁", pos: "2B", bat: "R", avg:0.125, obp:0.222, slg:0.125, hr:0, spd:6, recentForm: 1.02, defRAA:13.34, war:3.80 },
      { name: "홍창기", pos: "RF", bat: "R", avg:0.286, obp:0.545, slg:0.286, hr:0, spd:7, recentForm: 0.88 },
      { name: "문성주", pos: "LF", bat: "L", avg:0.321, obp:0.397, slg:0.377, hr:0, spd:7, recentForm: 1.06, war:2.50 },
      { name: "박동원", pos: "C", bat: "R", avg:0.253, obp:0.342, slg:0.455, hr:22, spd:3, recentForm: 1.08, war:3.00 },
      { name: "문보경", pos: "DH", bat: "R", avg:0.282, obp:0.389, slg:0.46, hr:1, spd:4, recentForm: 1.04, rbi:108, war:4.10 },
      { name: "오지환", pos: "SS", bat: "R", avg:0.253, obp:0.314, slg:0.43, hr:16, spd:5, recentForm: 0.95, war:2.00 },
      { name: "신민재", pos: "3B", bat: "R", avg:0.313, obp:0.395, slg:0.382, hr:1, spd:6, recentForm: 1.0 },
    ],
    starters: [
      { name: "임찬규", throws: "L", era:5.4, whip:1.6, k9:1.8, bb9:3.6, ip:5, recentForm: 1.05, war:4.50, fip:3.40 },
      { name: "치리노스", throws: "R", era:3.31, whip:1.18, k9:7.0, bb9:2.2, ip:177, recentForm: 1.02, war:5.03, wpaLI:3.08, fip:3.01 },
      { name: "톨허스트", throws: "R", era:4.78, whip:1.322, k9:8.9, bb9:3.2, ip:150, recentForm: 0.92, war:3.00, fip:3.30 },
      { name: "송승기", throws: "L", era:3.5, whip:1.38, k9:7.8, bb9:3.1, ip:120, recentForm: 1.08, war:1.20 },
      { name: "웰스", throws: "L", era:3.15, whip:1.10, k9:8.0, bb9:2.5, ip:20, recentForm: 1.0, war:1.00 }],
    bullpen: { era:3.50, whip:1.18, k9:8.8, bb9:2.5 }, teamRating: 79, record: { w:3, t:0, l:4, pct:"0.429", rs:31, ra:36 } },

  doosan: { id: "doosan", name: "두산 베어스", short: "두산", color: "#131230", aliases: ["두산","베어스"], stadium: "jamsil", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_OB.png",
    lineup: [
      { name: "양의지", pos: "C", bat: "R", avg:0.337, obp:0.406, slg:0.533, hr:20, spd:3, recentForm: 1.20, war:7.06, defRAA:1.97 },
      { name: "카메론", pos: "CF", bat: "R", avg:.258, obp:.335, slg:.430, hr:15, spd:8, recentForm: 1.08, war:2.50 },
      { name: "김재환", pos: "LF", bat: "L", avg:0, obp:0.111, slg:0.15, hr:0, spd:3, recentForm: 1.05, war:3.50 },
      { name: "이유찬", pos: "RF", bat: "R", avg:.260, obp:.325, slg:.395, hr:9, spd:5, recentForm: 1.12, rbi:45 },
      { name: "강승호", pos: "3B", bat: "R", avg:0.25, obp:0.333, slg:0.25, hr:0, spd:5, recentForm: 1.0, defRAA:9.00, war:2.80 },
      { name: "조수행", pos: "SS", bat: "R", avg:.255, obp:.315, slg:.375, hr:8, spd:6, recentForm: 0.98 },
      { name: "정수빈", pos: "DH", bat: "R", avg:0.258, obp:0.355, slg:0.348, hr:6, spd:9, recentForm: 1.05, war:2.50 },
      { name: "김인태", pos: "1B", bat: "R", avg:.265, obp:.330, slg:.418, hr:12, spd:4, recentForm: 1.0 },
      { name: "김재호", pos: "2B", bat: "R", avg:.265, obp:.325, slg:.380, hr:5, spd:6, recentForm: 1.0 },
    ],
    starters: [
      { name: "플렉센", throws: "R", era:3.96, whip:1.359, k9:7.9, bb9:5, ip:4, recentForm: 0.92, war:4.00, fip:3.00 },
      { name: "잭로그", throws: "R", era:2.81, whip:1.12, k9:8.0, bb9:2.8, ip:176, recentForm: 1.10, war:4.53, wpaLI:3.05, fip:3.20 },
      { name: "곽빈", throws: "R", era:9, whip:1.75, k9:11.3, bb9:4.5, ip:4, recentForm: 0.95, war:1.50 },
      { name: "최승용", throws: "R", era:4.80, whip:1.40, k9:7.2, bb9:3.5, ip:90, recentForm: 1.0, war:0.50 },
      { name: "최민석", throws: "R", era:4.80, whip:1.38, k9:7.0, bb9:3.2, ip:80, recentForm: 1.0, war:0.50 },
      { name: "콜어빈", throws: "R", era:4.48, whip:1.53, k9:8, bb9:4.9, ip:30, recentForm: 1, war:0.3 },
      { name: "최원준", throws: "R", era:3.80, whip:1.250, k9:8.2, bb9:2.8, ip:30, recentForm: 1, war:0.3 },
      { name: "김유성", throws: "R", era:3.80, whip:1.250, k9:8.2, bb9:2.8, ip:30, recentForm: 1, war:0.3 }],
    bullpen: { era:3.80, whip:1.25, k9:8.2, bb9:2.8 }, teamRating: 65, record: { w:1, t:1, l:5, pct:"0.167", rs:28, ra:55 } },

  kt: { id: "kt", name: "KT 위즈", short: "KT", color: "#000000", aliases: ["KT","케이티","위즈"], stadium: "suwon", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_KT.png",
    lineup: [
      { name: "안현민", pos: "OF", bat: "R", avg:0.36, obp:0.476, slg:0.625, hr:2, spd:6, recentForm: 1.08, war:7.24, defRAA:1.36 },
      { name: "힐리어드", pos: "LF", bat: "L", avg:0.275, obp:0.349, slg:0.441, hr:0, spd:6, recentForm: 1.0, war:2.50 },
      { name: "허경민", pos: "2B", bat: "R", avg:0.283, obp:0.362, slg:0.355, hr:4, spd:6, recentForm: 1.08, war:2.00 },
      { name: "배정대", pos: "CF", bat: "R", avg:.290, obp:.355, slg:.415, hr:8, spd:8, recentForm: 0.98, war:2.80 },
      { name: "장성우", pos: "C", bat: "R", avg:0.292, obp:0.377, slg:0.531, hr:1, spd:3, recentForm: 1.08 },
      { name: "오윤석", pos: "SS", bat: "R", avg:.258, obp:.320, slg:.378, hr:5, spd:7, recentForm: 0.97 },
      { name: "권동진", pos: "3B", bat: "R", avg:.255, obp:.315, slg:.375, hr:8, spd:5, recentForm: 0.95 },
      { name: "김상수", pos: "1B", bat: "R", avg:0.296, obp:0.4, slg:0.415, hr:0, spd:6, recentForm: 1.08 },
      { name: "김현수", pos: "DH", bat: "L", avg:0.313, obp:0.398, slg:0.432, hr:1, spd:4, recentForm: 1.05 },
    ],
    starters: [
      { name: "사우어", throws: "R", era:3.88, whip:1.329, k9:6.8, bb9:3.9, ip:5, recentForm: 0.94, war:3.50, fip:3.20 },
      { name: "보쉴리", throws: "R", era:2.8, whip:1.255, k9:7.8, bb9:3.3, ip:160, recentForm: 1.08, war:3.80, fip:3.10 },
      { name: "소형준", throws: "R", era:3.30, whip:1.15, k9:7.8, bb9:2.5, ip:155, recentForm: 1.05, war:4.19, fip:2.94 },
      { name: "고영표", throws: "R", era:3.30, whip:1.24, k9:8.6, bb9:1.7, ip:150, recentForm: 1.0, war:4.10, fip:3.16 },
      { name: "오원석", throws: "R", era:4.80, whip:1.35, k9:7.0, bb9:3.2, ip:70, recentForm: 1.0, war:0.50 },
      { name: "헤이수스", throws: "R", era:3.70, whip:1.220, k9:8.3, bb9:2.8, ip:30, recentForm: 1, war:0.3 },
      { name: "쿠에바스", throws: "R", era:3.70, whip:1.220, k9:8.3, bb9:2.8, ip:30, recentForm: 1, war:0.3 }],
    bullpen: { era:3.70, whip:1.22, k9:8.3, bb9:2.8, closer:"박영현", closerEra:3.39, saves:35 }, teamRating: 76, record: { w:5, t:0, l:2, pct:"0.714", rs:60, ra:45 } },

  ssg: { id: "ssg", name: "SSG 랜더스", short: "SSG", color: "#CE0E2D", aliases: ["SSG","랜더스"], stadium: "incheon", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_SK.png",
    lineup: [
      { name: "최정", pos: "3B", bat: "R", avg:0.322, obp:0.439, slg:0.526, hr:1, spd:3, recentForm: 1.08, war:3.50 },
      { name: "에레디아", pos: "LF", bat: "R", avg:0.28, obp:0.333, slg:0.48, hr:2, spd:5, recentForm: 1.08, war:4.20 },
      { name: "고명준", pos: "RF", bat: "R", avg:0.357, obp:0.398, slg:0.577, hr:2, spd:5, recentForm: 1.08, war:2.80 },
      { name: "한유섭", pos: "CF", bat: "R", avg:.295, obp:.360, slg:.438, hr:10, spd:8, recentForm: 0.95, war:3.00 },
      { name: "정준재", pos: "SS", bat: "R", avg:.245, obp:.340, slg:.288, hr:2, spd:9, recentForm: 0.90, sb:37, war:2.50 },
      { name: "이재원", pos: "C", bat: "R", avg:.258, obp:.320, slg:.378, hr:8, spd:3, recentForm: 0.92 },
      { name: "정현석", pos: "2B", bat: "R", avg:.260, obp:.318, slg:.370, hr:5, spd:6, recentForm: 0.93 },
      { name: "윤동현", pos: "1B", bat: "R", avg:.270, obp:.335, slg:.428, hr:13, spd:4, recentForm: 0.95 },
      { name: "최지훈", pos: "DH", bat: "R", avg:0.284, obp:0.342, slg:0.371, hr:7, spd:5, recentForm: 0.95, war:2.00 },
    ],
    starters: [
      { name: "베니지아노", throws: "L", era:3.94, whip:1.352, k9:7.6, bb9:3.2, ip:40.2, recentForm: 0.92, war:2.00, fip:3.80 },
      { name: "미치화이트", throws: "R", era:11.25, whip:2.75, k9:9.0, bb9:4.5, ip:4, recentForm: 0.80, war:1.50, fip:4.00 },
      { name: "김광현", throws: "L", era:5.00, whip:1.30, k9:8.6, bb9:2.5, ip:144, recentForm: 0.85, war:1.80 },
      { name: "김건우", throws: "R", era:3.76, whip:1.333, k9:7.9, bb9:3.8, ip:5, recentForm: 1.04, war:0.50 },
      { name: "타케다", throws: "R", era:4.10, whip:1.25, k9:8.0, bb9:2.5, ip:130, recentForm: 1.0, war:1.50 },
      { name: "최민준", throws: "R", era:4.50, whip:1.30, k9:7.5, bb9:3.0, ip:90, recentForm: 1.0, war:0.80 },
      { name: "화이트", throws: "R", era:4.31, whip:1.423, k9:7.6, bb9:3.7, ip:30, recentForm: 0.92, war:0.5 },
      { name: "문승원", throws: "R", era:3.80, whip:1.250, k9:8.3, bb9:2.8, ip:30, recentForm: 1, war:0.3 }],
    bullpen: { era:3.80, whip:1.25, k9:8.3, bb9:2.8 }, teamRating: 84, record: { w:6, t:0, l:1, pct:"0.857", rs:64, ra:35 } },

  hanwha: { id: "hanwha", name: "한화 이글스", short: "한화", color: "#FF6600", aliases: ["한화","이글스"], stadium: "daejeon", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_HH.png",
    lineup: [
      { name: "오재원", pos: "SS", bat: "R", avg:0.34, obp:0.407, slg:0.434, hr:1, spd:8, recentForm: 1.08 },
      { name: "문현빈", pos: "CF", bat: "R", avg:0.339, obp:0.416, slg:0.551, hr:1, spd:8, recentForm: 1.08, war:4.00 },
      { name: "노시환", pos: "3B", bat: "R", avg:0.26, obp:0.354, slg:0.497, hr:32, spd:4, recentForm: 1.08, war:6.70 },
      { name: "강백호", pos: "1B", bat: "R", avg:0.273, obp:0.273, slg:0.636, hr:1, spd:4, recentForm: 0.95, war:1.50 },
      { name: "페라자", pos: "LF", bat: "R", avg:0.344, obp:0.418, slg:0.512, hr:1, spd:6, recentForm: 1.08, war:2.50 },
      { name: "황영묵", pos: "RF", bat: "R", avg:.270, obp:.332, slg:.405, hr:10, spd:6, recentForm: 0.98 },
      { name: "송곤", pos: "C", bat: "R", avg:.250, obp:.310, slg:.365, hr:7, spd:3, recentForm: 0.93 },
      { name: "김인환", pos: "2B", bat: "R", avg:.260, obp:.318, slg:.375, hr:5, spd:6, recentForm: 0.95 },
      { name: "손아섭", pos: "DH", bat: "R", avg:.300, obp:.365, slg:.440, hr:8, spd:4, recentForm: 0.98, war:2.50 },
    ],
    starters: [
      { name: "화이트", throws: "R", era:4.31, whip:1.423, k9:7.6, bb9:3.7, ip:81, recentForm: 0.92, war:2.00, fip:4.00 },
      { name: "에르난데스", throws: "L", era:4.42, whip:1.337, k9:7.4, bb9:4, ip:4, recentForm: 0.92, war:2.50, fip:3.60 },
      { name: "류현진", throws: "L", era:3.65, whip:1.20, k9:7.0, bb9:2.2, ip:140, recentForm: 0.92, war:2.80 },
      { name: "왕옌청", throws: "L", era:3.41, whip:1.196, k9:7.8, bb9:3.1, ip:5.1, recentForm: 1.08, war:0.50 },
      { name: "문동주", throws: "R", era:3.15, whip:1.10, k9:9.5, bb9:2.3, ip:155, recentForm: 1.0, war:4.50 },
      { name: "황준서", throws: "R", era:4.20, whip:1.320, k9:7.5, bb9:3.2, ip:30, recentForm: 1, war:0.3 },
      { name: "폰세", throws: "R", era:4.20, whip:1.320, k9:7.5, bb9:3.2, ip:30, recentForm: 1, war:0.3 },
      { name: "와이스", throws: "R", era:4.20, whip:1.320, k9:7.5, bb9:3.2, ip:30, recentForm: 1, war:0.3 },
      { name: "엄상백", throws: "R", era:4.20, whip:1.320, k9:7.5, bb9:3.2, ip:30, recentForm: 1, war:0.3 }],
    bullpen: { era:4.20, whip:1.32, k9:7.5, bb9:3.2 }, teamRating: 71, record: { w:4, t:0, l:3, pct:"0.571", rs:63, ra:58 } },

  lotte: { id: "lotte", name: "롯데 자이언츠", short: "롯데", color: "#041E42", aliases: ["롯데","자이언츠"], stadium: "sajik", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_LT.png",
    lineup: [
      { name: "레이예스", pos: "OF", bat: "R", avg:0.326, obp:0.386, slg:0.475, hr:13, spd:5, recentForm: 1.18, rbi:107, war:4.00 },
      { name: "전준우", pos: "RF", bat: "R", avg:0.293, obp:0.369, slg:0.42, hr:8, spd:5, recentForm: 1.08, war:3.20 },
      { name: "안치홍", pos: "2B", bat: "R", avg:0.295, obp:0.406, slg:0.437, hr:1, spd:5, recentForm: 1.08, war:2.50 },
      { name: "윤동희", pos: "CF", bat: "R", avg:0.279, obp:0.352, slg:0.448, hr:0, spd:8, recentForm: 1.30, war:2.00 },
      { name: "손호영", pos: "LF", bat: "R", avg:0.3, obp:0.3, slg:0.9, hr:2, spd:6, recentForm: 1.02 },
      { name: "황성빈", pos: "SS", bat: "R", avg:.260, obp:.320, slg:.368, hr:5, spd:7, recentForm: 1.0 },
      { name: "유강남", pos: "C", bat: "R", avg:0.125, obp:0.125, slg:0.125, hr:0, spd:3, recentForm: 0.98 },
      { name: "박승욱", pos: "3B", bat: "R", avg:.258, obp:.320, slg:.385, hr:7, spd:5, recentForm: 1.0 },
      { name: "박시원", pos: "1B", bat: "R", avg:.265, obp:.330, slg:.420, hr:10, spd:4, recentForm: 1.0 },
    ],
    starters: [
      { name: "로드리게스", throws: "R", era:4.78, whip:1.501, k9:7.1, bb9:4.9, ip:5, recentForm: 0.92, war:3.00, fip:3.30 },
      { name: "비슬리", throws: "R", era:4.31, whip:1.373, k9:8.2, bb9:3.5, ip:5, recentForm: 0.92, war:3.00, fip:3.20 },
      { name: "박세웅", throws: "R", era:4.93, whip:1.30, k9:8.7, bb9:3.0, ip:160.2, recentForm: 0.95, war:2.50, fip:4.20 },
      { name: "나균안", throws: "R", era:4.30, whip:1.28, k9:7.5, bb9:3.0, ip:140, recentForm: 0.95, war:1.80 },
      { name: "김진욱", throws: "R", era:4.50, whip:1.32, k9:7.2, bb9:3.0, ip:100, recentForm: 1.0, war:0.80 },
      { name: "반즈", throws: "R", era:4.00, whip:1.280, k9:7.8, bb9:3.0, ip:30, recentForm: 1, war:0.3 },
      { name: "데이비슨", throws: "R", era:4.00, whip:1.280, k9:7.8, bb9:3.0, ip:30, recentForm: 1.08, war:0.3 }],
    bullpen: { era:4.00, whip:1.28, k9:7.8, bb9:3.0, closer:"김원중", closerSv:32 }, teamRating: 68, record: { w:2, t:0, l:5, pct:"0.286", rs:30, ra:51 } },

  nc: { id: "nc", name: "NC 다이노스", short: "NC", color: "#315288", aliases: ["NC","엔씨","다이노스"], stadium: "changwon", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_NC.png",
    lineup: [
      { name: "데이비슨", pos: "1B", bat: "R", avg:0.28, obp:0.36, slg:0.436, hr:1, spd:4, recentForm: 1.08, war:5.00 },
      { name: "김주원", pos: "SS", bat: "R", avg:0.289, obp:0.379, slg:0.451, hr:15, spd:9, recentForm: 1.05, war:6.62, sb:44, defRAA:0.58 },
      { name: "박건우", pos: "RF", bat: "R", avg:0.299, obp:0.384, slg:0.513, hr:1, spd:5, recentForm: 1.08, war:3.50 },
      { name: "서호철", pos: "3B", bat: "R", avg:0, obp:0.167, slg:0.15, hr:0, spd:5, recentForm: 0.95, war:2.50 },
      { name: "권희동", pos: "CF", bat: "R", avg:0.246, obp:0.393, slg:0.363, hr:6, spd:8, recentForm: 0.97, war:2.80 },
      { name: "김태군", pos: "C", bat: "R", avg:.255, obp:.320, slg:.375, hr:7, spd:3, recentForm: 0.93 },
      { name: "허윤", pos: "LF", bat: "R", avg:.265, obp:.330, slg:.400, hr:7, spd:9, recentForm: 1.10, sb:20 },
      { name: "박민우", pos: "2B", bat: "R", avg:0.351, obp:0.439, slg:0.531, hr:0, spd:7, recentForm: 1.08 },
      { name: "김성욱", pos: "DH", bat: "L", avg:0.143, obp:0.143, slg:0.143, hr:0, spd:6, recentForm: 0.95 },
    ],
    starters: [
      { name: "구창모", throws: "L", era:2.8, whip:1.089, k9:7.8, bb9:3.3, ip:5, recentForm: 1.08, war:4.50, fip:3.00 },
      { name: "토다", throws: "R", era:3.66, whip:1.255, k9:7.2, bb9:3.5, ip:81.2, recentForm: 1.08, war:1.50, fip:3.20 },
      { name: "테일러", throws: "R", era:3.3, whip:1.287, k9:8.2, bb9:4, ip:5, recentForm: 1.08, war:3.00, fip:3.30 },
      { name: "신민혁", throws: "R", era:3.76, whip:1.333, k9:7.2, bb9:3.8, ip:140, recentForm: 1.04, war:1.80 },
      { name: "버하겐", throws: "R", era:3.80, whip:1.22, k9:8.5, bb9:2.5, ip:130, recentForm: 1.0, war:2.00 },
      { name: "로건", throws: "R", era:4.53, whip:1.43, k9:7.8, bb9:3.5, ip:30, recentForm: 1, war:0.3 },
      { name: "라일리", throws: "R", era:3.85, whip:1.250, k9:8.0, bb9:3.0, ip:30, recentForm: 1, war:0.3 }],
    bullpen: { era:3.85, whip:1.25, k9:8.0, bb9:3.0 }, teamRating: 85, record: { w:6, t:0, l:1, pct:"0.857", rs:45, ra:21 } },

  kiwoom: { id: "kiwoom", name: "키움 히어로즈", short: "키움", color: "#820024", aliases: ["키움","히어로즈"], stadium: "gocheok", logo: "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2026/initial_WO.png",
    lineup: [
      { name: "송성문", pos: "3B", bat: "R", avg:0.315, obp:0.387, slg:0.53, hr:26, spd:8, recentForm: 1.20, war:8.76, sb:25 },
      { name: "브룩스", pos: "1B", bat: "R", avg:0.296, obp:0.358, slg:0.427, hr:1, spd:5, recentForm: 1.06, war:2.00 },
      { name: "이주형", pos: "LF", bat: "R", avg:0.24, obp:0.337, slg:0.368, hr:11, spd:6, recentForm: 0.95, war:2.00 },
      { name: "변상권", pos: "SS", bat: "L", avg:.260, obp:.325, slg:.395, hr:9, spd:5, recentForm: 0.93, war:1.50 },
      { name: "김휘집", pos: "CF", bat: "R", avg:0.249, obp:0.349, slg:0.42, hr:17, spd:8, recentForm: 1.08 },
      { name: "박동훈", pos: "C", bat: "R", avg:.248, obp:.310, slg:.368, hr:7, spd:3, recentForm: 0.92 },
      { name: "이준혁", pos: "RF", bat: "R", avg:.275, obp:.345, slg:.405, hr:10, spd:6, recentForm: 0.95, war:1.50 },
      { name: "김건웅", pos: "2B", bat: "R", avg:.255, obp:.318, slg:.370, hr:5, spd:6, recentForm: 0.92 },
      { name: "장진혁", pos: "DH", bat: "R", avg:.265, obp:.330, slg:.415, hr:12, spd:4, recentForm: 0.95, war:1.80 },
    ],
    starters: [
      { name: "와일스", throws: "R", era:4.09, whip:1.329, k9:7.8, bb9:2.9, ip:112.2, recentForm: 0.92, war:2.50, fip:3.30 },
      { name: "요키시", throws: "R", era:3.70, whip:1.18, k9:8.5, bb9:2.8, ip:150, recentForm: 1.0, war:3.00, fip:3.40 },
      { name: "알칸타라", throws: "R", era:3.61, whip:1.287, k9:8.5, bb9:2.9, ip:120, recentForm: 1.08, war:2.00, fip:3.50 },
      { name: "하영민", throws: "R", era:4.99, whip:1.37, k9:7.9, bb9:2.4, ip:153.1, recentForm: 0.95, war:1.50 },
      { name: "배동현", throws: "R", era:3.11, whip:1.372, k9:7.9, bb9:2.7, ip:80, recentForm: 1.08, war:0.30 },
      { name: "정현우", throws: "R", era:4.50, whip:1.35, k9:7.0, bb9:3.0, ip:80, recentForm: 1.0, war:0.50 },
      { name: "로젠버그", throws: "R", era:4.40, whip:1.330, k9:7.8, bb9:3.2, ip:30, recentForm: 1, war:0.3 },
      { name: "김윤하", throws: "R", era:4.40, whip:1.330, k9:7.8, bb9:3.2, ip:30, recentForm: 1, war:0.3 }],
    bullpen: { era:4.40, whip:1.33, k9:7.8, bb9:3.2 }, teamRating: 53, record: { w:2, t:0, l:5, pct:"0.286", rs:37, ra:50 } },
};

const TEAM_IDS = Object.keys(KBO_TEAMS);

// ═══════════════════════════════════════════════════════
// KBO 공식 일정 API + 날씨 API
// ═══════════════════════════════════════════════════════

// KBO API 팀명 → 내부 ID 매핑
const KBO_NAME_TO_ID = {
  "삼성":"samsung","기아":"kia","KIA":"kia","LG":"lg","두산":"doosan",
  "KT":"kt","SSG":"ssg","한화":"hanwha","롯데":"lotte","NC":"nc","키움":"kiwoom",
};
// KBO API 구장 약어 → 내부 구장 ID 매핑
const KBO_STADIUM_TO_ID = {
  "잠실":"jamsil","문학":"incheon","수원":"suwon","대구":"daegu",
  "광주":"gwangju","대전":"daejeon","사직":"sajik","창원":"changwon","고척":"gocheok",
  "인천":"incheon","부산":"sajik",
};

// KBO 공식 API에서 월별 일정 가져오기 (캐시 포함)
// 현재 KBO 최신 시즌 연도 (실제 일정이 있는 연도)
const KBO_CURRENT_SEASON = 2026;
const _scheduleCache = {};
// ── 정적 데이터 fetch 헬퍼 (GitHub Pages 환경) ──
// daily-predict workflow가 매일 생성한 schedule-today.json을 우선 사용
const STATIC_BASE = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
async function fetchStaticJSON(filename) {
  try {
    const r = await fetch(`${STATIC_BASE}data/${filename}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function tryStaticSchedule(dateStr) {
  // schedule-today.json 의 date 필드와 일치하면 사용
  const data = await fetchStaticJSON("schedule-today.json");
  if (!data || data.date !== dateStr) return null;
  // 정적 schedule을 jsx 내부 포맷({date,time,awayName,homeName,stadiumRaw,...}) 으로 변환
  const [, mo, da] = dateStr.split("-");
  const dayLabel = `${mo}.${da}`;
  return data.games.map(g => ({
    date: dayLabel,
    time: g.time || "18:30",
    awayName: g.away,
    homeName: g.home,
    stadiumRaw: g.stadium || "",
    awayScore: null, homeScore: null, hasResult: false,
    _spFromStatic: { awaySP: g.awaySP || "", homeSP: g.homeSP || "" },
  }));
}

async function fetchKBOSchedule(year, month) {
  const key = `${year}-${month}`;
  if (_scheduleCache[key]) return _scheduleCache[key];
  try {
    const mm = String(month).padStart(2,"0");
    // Vite 프록시를 통해 CORS 우회
    const r = await fetch("/kbo-api/ws/Schedule.asmx/GetScheduleList", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `leId=1&srIdList=0%2C9%2C6&seasonId=${year}&gameMonth=${mm}&teamId=`
    });
    if (!r.ok) throw new Error("KBO API error");
    const d = await r.json();
    let curDate = "";
    const games = [];
    for (const row of d.rows) {
      const cells = row.row;
      let offset = 0;
      if (cells[0].Class === "day") { curDate = cells[0].Text; offset = 1; }
      const time = cells[offset].Text.replace(/<[^>]+>/g, "").trim();
      const play = cells[offset + 1].Text;
      const m = play.match(/<span>([^<]+)<\/span><em>.*?<\/em><span>([^<]+)<\/span>/);
      // 점수 파싱: <em> 안의 <span class="win/lose">숫자</span>vs<span>숫자</span>
      const scoreMatch = play.match(/<em><span[^>]*>(\d+)<\/span><span>vs<\/span><span[^>]*>(\d+)<\/span><\/em>/);
      const awayScore = scoreMatch ? parseInt(scoreMatch[1]) : null;
      const homeScore = scoreMatch ? parseInt(scoreMatch[2]) : null;
      const hasResult = awayScore !== null && homeScore !== null;
      const stCell = cells.slice(offset + 2).find(c => c.Text && !c.Text.includes("<") && c.Text.length >= 2 && c.Text.length <= 4 && /^[가-힣]+$/.test(c.Text));
      if (m) games.push({ date: curDate, time, awayName: m[1], homeName: m[2], stadiumRaw: stCell ? stCell.Text : "", awayScore, homeScore, hasResult });
    }
    _scheduleCache[key] = games;
    return games;
  } catch (e) {
    console.error("KBO schedule fetch error:", e);
    return null;
  }
}

// KBO API에서 당일 선발투수 정보 가져오기
const _spCache = {};
async function fetchStartingPitchers(dateStr) {
  if (_spCache[dateStr]) return _spCache[dateStr];
  try {
    const dt = dateStr.replace(/-/g, "");
    const r = await fetch("/kbo-api/ws/Main.asmx/GetKboGameList", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `leId=1&srId=0,1,3,4,5,6,7,8,9&date=${dt}`
    });
    if (!r.ok) return {};
    const d = await r.json();
    const map = {};
    for (const g of (d.game || [])) {
      const key = `${g.AWAY_NM.trim()}_${g.HOME_NM.trim()}`;
      map[key] = { awaySP: (g.T_PIT_P_NM || "").trim(), homeSP: (g.B_PIT_P_NM || "").trim() };
    }
    _spCache[dateStr] = map;
    return map;
  } catch (e) { return {}; }
}

// 선발투수 이름으로 인덱스 찾기 (부분 매칭 지원)
function findStarterIdx(team, spName) {
  if (!spName) return 0;
  const idx = team.starters.findIndex(s => s.name === spName || spName.includes(s.name) || s.name.includes(spName));
  return idx >= 0 ? idx : 0;
}

// 특정 날짜의 경기 일정 파싱
function parseKBOGames(allGames, dateStr, spMap) {
  const [y, mo, da] = dateStr.split("-");
  const seasonYear = getSeasonYear(dateStr);
  const dayMatch = `${mo}.${da}`;
  const filtered = allGames.filter(g => g.date.startsWith(dayMatch));
  const seed = dateStr.replace(/-/g,"").split("").reduce((a,c) => a*31+c.charCodeAt(0), 0);
  const rng = (i) => ((seed*16807+i*48271) % 2147483647) / 2147483647;
  return filtered.map((g, i) => {
    const homeId = KBO_NAME_TO_ID[g.homeName];
    const awayId = KBO_NAME_TO_ID[g.awayName];
    if (!homeId || !awayId || !KBO_TEAMS[homeId] || !KBO_TEAMS[awayId]) return null;
    const home = getSeasonTeam(homeId, seasonYear), away = getSeasonTeam(awayId, seasonYear);
    const stadiumId = KBO_STADIUM_TO_ID[g.stadiumRaw] || home.stadium;
    // 실제 선발투수 매칭 (KBO API 데이터 활용)
    const spKey = `${g.awayName}_${g.homeName}`;
    const sp = spMap && spMap[spKey];
    const homeStarterIdx = sp ? findStarterIdx(home, sp.homeSP) : Math.floor(rng(i + 100) * home.starters.length);
    const awayStarterIdx = sp ? findStarterIdx(away, sp.awaySP) : Math.floor(rng(i + 200) * away.starters.length);
    return {
      id: `${dateStr}-${i}`, homeId, awayId, home, away, stadiumId,
      homeStarterIdx, awayStarterIdx,
      homeSPName: sp ? sp.homeSP : home.starters[homeStarterIdx].name,
      awaySPName: sp ? sp.awaySP : away.starters[awayStarterIdx].name,
      time: g.time, weatherData: null,
      awayScore: g.awayScore, homeScore: g.homeScore, hasResult: g.hasResult
    };
  }).filter(Boolean);
}

// 폴백: API 실패 시 랜덤 대진표 생성
function generateScheduleFallback(dateStr) {
  const seed = dateStr.replace(/-/g,"").split("").reduce((a,c) => a*31+c.charCodeAt(0), 0);
  const rng = (i) => ((seed*16807+i*48271) % 2147483647) / 2147483647;
  const seasonYear = getSeasonYear(dateStr);
  const sh = [...TEAM_IDS]; for (let i=sh.length-1;i>0;i--) { const j=Math.floor(rng(i)*(i+1)); [sh[i],sh[j]]=[sh[j],sh[i]]; }
  const times = ["14:00","17:00","18:30","18:30","18:30"];
  return Array.from({length:5},(_,i)=> {
    const aId=sh[i*2], hId=sh[i*2+1], h=getSeasonTeam(hId, seasonYear), a=getSeasonTeam(aId, seasonYear);
    return { id:`${dateStr}-${i}`, homeId:hId, awayId:aId, home:h, away:a, stadiumId:h.stadium, homeStarterIdx:Math.floor(rng(i+100)*h.starters.length), awayStarterIdx:Math.floor(rng(i+200)*a.starters.length), time:times[i], weatherData:null };
  });
}

async function fetchWeather(cityEn) {
  try {
    const r = await fetch("https://wttr.in/" + cityEn + "?format=j1");
    if(!r.ok) throw new Error("fail"); const d=await r.json();
    const cc=d.current_condition; const c=cc && cc[0]; if(!c) throw new Error("no data");
    const t=parseInt(c.temp_C), wd=c.weatherDesc, desc=(wd && wd[0] && wd[0].value) || "";
    return { tempC:t, desc:desc, humidity:c.humidity, windSpeed:c.windspeedKmph, weatherKey:tempToWeatherKey(t,desc), display:t+"°C "+desc };
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════════════
// AI 인텔리전스 파서
// ═══════════════════════════════════════════════════════

const NEG_KW = [
  {w:["술","음주","과음","숙취","마시","마셨","취해","만취"],wt:1,d:"음주"},{w:["부상","다친","다쳤","통증","아프","아파","무릎","어깨","팔꿈치","허리"],wt:1,d:"부상"},
  {w:["피로","지친","지쳐","힘들","혹사","연투","과로"],wt:.8,d:"피로"},{w:["슬럼프","부진","난조","못하","안좋","안 좋","저조","최악"],wt:.7,d:"부진"},
  {w:["감기","몸살","병원","치료","재활","수술"],wt:.9,d:"건강문제"},{w:["논란","불화","갈등","벌금","징계"],wt:.6,d:"비컨디션"},{w:["긴장","떨리","데뷔"],wt:.4,d:"심리압박"},
];
const POS_KW = [
  {w:["컨디션 좋","컨디션좋","몸상태 좋","최상"],wt:1,d:"호컨디션"},{w:["핫","불붙","연타석","타격감","감각","살아"],wt:.8,d:"타격감"},
  {w:["상대전적 좋","강한","잘치","상성 좋","천적"],wt:.5,d:"상성유리"},{w:["휴식","쉬었","충분히","회복"],wt:.6,d:"휴식"},
  {w:["동기부여","의욕","각오","투지","복수"],wt:.4,d:"동기부여"},{w:["연승","기세","분위기","사기"],wt:.5,d:"분위기상승"},
];

class InsightParser {
  constructor(h,a){ this.h=h;this.a=a;this.pl={};
    const add=(t,s)=>{ t.lineup.forEach((p,i)=>{this.pl[p.name]={side:s,role:"batter",idx:i,teamId:t.id};}); t.starters.forEach((p,i)=>{this.pl[p.name]={side:s,role:"pitcher",idx:i,teamId:t.id};}); };
    add(h,"home"); add(a,"away"); }
  pct(t){ const m=t.match(/(\d+)\s*(%|퍼센트|프로|퍼|정도)/); return m?parseInt(m[1]):null; }
  players(t){ return Object.entries(this.pl).filter(([n])=>t.includes(n)).map(([n,v])=>({name:n,...v})); }
  teams(t){ const f=[]; for(const tm of [this.h,this.a]){ for(const n of [tm.name,tm.short,...(tm.aliases||[])]){ if(t.includes(n)){f.push({teamId:tm.id,side:tm.id===this.h.id?"home":"away",name:tm.name});break;} } } return f; }
  ctx(t){ let ns=0,ps=0; const nr=[],pr=[];
    NEG_KW.forEach(k=>{k.w.forEach(w=>{if(t.includes(w)){ns+=k.wt;if(!nr.includes(k.d))nr.push(k.d);}});});
    POS_KW.forEach(k=>{k.w.forEach(w=>{if(t.includes(w)){ps+=k.wt;if(!pr.includes(k.d))pr.push(k.d);}});});
    return {ns,ps,nr,pr}; }
  parse(t){
    const pl=this.players(t),tm=this.teams(t),pc=this.pct(t),c=this.ctx(t);
    const neg=c.ns>c.ps,pos=c.ps>c.ns,dir=neg?-1:pos?1:0;
    let ap=pc!==null?pc:Math.min(25,Math.max(5,Math.round(Math.max(c.ns,c.ps)*10)));
    const adj=[],exp=[];
    if(dir===0&&!pl.length&&!tm.length) return {adjustments:[],response:"특정 선수/팀/컨디션 정보를 찾지 못했습니다.\n\n예: \"기아 양현종 어제 술 마셨대 15% 하락 예상\""};
    const reasons=dir<0?c.nr.join(","):c.pr.join(","), dT=dir<0?"하락":"상승";
    if(pl.length){ pl.forEach(p=>{
      adj.push({targetType:"player",side:p.side,role:p.role,idx:p.idx,name:p.name,teamId:p.teamId,factor:1+(dir*ap/100),direction:dir,pct:ap});
      exp.push(`${p.name}(${p.role==="pitcher"?"투수":"타자"}) → ${reasons} / ${dT} ${ap}%`); }); }
    else if(tm.length){ tm.forEach(tt=>{
      adj.push({targetType:"team",side:tt.side,teamId:tt.teamId,teamName:tt.name,factor:1+(dir*ap/100),direction:dir,pct:ap});
      exp.push(`${tt.name} 팀 전체 → ${reasons} / ${dT} ${ap}%`); }); }
    return {adjustments:adj,response:`분석 완료!\n\n${exp.join("\n")}\n\n시뮬레이션에 자동 반영됩니다.`};
  }
}

function applyAdj(h,a,adjs){
  const H=_.cloneDeep(h),A=_.cloneDeep(a);
  adjs.forEach(adj=>{
    if(adj.targetType==="player"){ const tm=adj.side==="home"?H:A;
      if(adj.role==="batter"){ const b=tm.lineup[adj.idx]; if(b){b.avg=_.clamp(b.avg*adj.factor,.1,.45);b.obp=_.clamp(b.obp*adj.factor,.15,.5);b.slg=_.clamp(b.slg*adj.factor,.2,.7);b.hr=Math.max(0,Math.round(b.hr*adj.factor));} }
      else { const p=tm.starters[adj.idx],iv=2-adj.factor; if(p){p.era=_.clamp(p.era*iv,1,8);p.whip=_.clamp(p.whip*iv,.8,2);p.k9=_.clamp(p.k9*adj.factor,3,14);p.bb9=_.clamp(p.bb9*iv,.5,6);} }
    } else { const tm=adj.side==="home"?H:A,iv=2-adj.factor;
      tm.lineup.forEach(b=>{b.avg=_.clamp(b.avg*adj.factor,.1,.45);b.obp=_.clamp(b.obp*adj.factor,.15,.5);b.slg=_.clamp(b.slg*adj.factor,.2,.7);b.hr=Math.max(0,Math.round(b.hr*adj.factor));});
      tm.starters.forEach(p=>{p.era=_.clamp(p.era*iv,1,8);p.whip=_.clamp(p.whip*iv,.8,2);p.k9=_.clamp(p.k9*adj.factor,3,14);});
      tm.bullpen.era=_.clamp(tm.bullpen.era*iv,1,8);tm.bullpen.whip=_.clamp(tm.bullpen.whip*iv,.8,2);
      tm.teamRating=_.clamp(Math.round(tm.teamRating*adj.factor),50,99);
    }
  }); return {home:H,away:A};
}

// ═══════════════════════════════════════════════════════
// 시뮬레이션 엔진
// ═══════════════════════════════════════════════════════

// ── 투수 피로도 모델 ──
// 이닝 경과에 따라 투수 능력이 점진적으로 하락
// 실점이 많으면 피로 가속, 삼진 많으면 투구수 증가로 피로 가속
function getPitcherFatigue(inningsPitched, runsAllowed, hitsAllowed) {
  // 기본 피로: 이닝당 증가 (1~3이닝 안정, 4~6이닝 점진하락, 7이닝+ 급격하락)
  let fatigue = 0;
  if (inningsPitched <= 3) fatigue = inningsPitched * 0.02;
  else if (inningsPitched <= 6) fatigue = 0.06 + (inningsPitched - 3) * 0.04;
  else fatigue = 0.18 + (inningsPitched - 6) * 0.08;
  // 실점 누적에 따른 추가 피로 (멘탈 소모)
  fatigue += runsAllowed * 0.015;
  // 피안타 누적에 따른 추가 피로 (투구수 증가)
  fatigue += hitsAllowed * 0.008;
  return _.clamp(fatigue, 0, 0.45); // 최대 45% 능력 하락
}

// ── 투수 교체 판단 AI ──
// 상황별 지능형 교체: 피로도, 실점, 이닝, 스코어 차이 등 종합 판단
function shouldChangePitcher(pitcher, inningsPitched, runsAllowed, hitsAllowed, scoreDiff, isHome) {
  const fatigue = getPitcherFatigue(inningsPitched, runsAllowed, hitsAllowed);
  // 1) 에이스급 투수는 오래 던질 수 있음 (WAR/WPA 기반)
  const aceBonus = (pitcher.war > 5 || pitcher.wpaLI > 3) ? 1 : 0;
  // 2) 호투 중이면 유지 (3이닝 이상, 이닝당 실점 < 0.5)
  if (inningsPitched >= 3 && runsAllowed / inningsPitched < 0.5 && inningsPitched < 8 + aceBonus) return false;
  // 3) 대량 실점 시 조기 강판 (한 이닝 3실점 이상 가정 → runsAllowed/inningsPitched > 1.5)
  if (inningsPitched >= 2 && runsAllowed / inningsPitched > 1.5) return true;
  // 4) 피로도 기반 교체 (에이스는 좀 더 버팀)
  const fatigueThreshold = 0.20 + aceBonus * 0.05;
  if (fatigue >= fatigueThreshold) return true;
  // 5) 기본 이닝 기준: 6이닝 이상이면 교체 검토 (확률적)
  if (inningsPitched >= 6 + aceBonus) return Math.random() < 0.3 + fatigue;
  // 6) 큰 점수차로 지고 있으면 일찍 교체 (5이닝+, 4점차 이상)
  if (inningsPitched >= 5 && scoreDiff <= -4) return true;
  return false;
}

class Sim {
  constructor(h,a,sid,w,hsi=0,asi=0,opts={}){ this.h=_.cloneDeep(h);this.a=_.cloneDeep(a);this.st=STADIUMS[sid];this.w=WEATHER_EFFECTS[w];
    // v8.0: 평균 회귀 적용 (소표본 보정)
    this.h.lineup = this.h.lineup.map(regressBatter);
    this.a.lineup = this.a.lineup.map(regressBatter);
    this.hP = regressPitcher(this.h.starters[hsi]);
    this.aP = regressPitcher(this.a.starters[asi]);
    // v8.0: wOBA/FIP 사전 계산
    this.h.lineup.forEach(b => { b.woba = calcWOBA(b); });
    this.a.lineup.forEach(b => { b.woba = calcWOBA(b); });
    this.hP.fip = calcFIP(this.hP); this.aP.fip = calcFIP(this.aP);
    // v8.0: 피타고리안 기대승률 + Elo 레이팅
    this.hPyth = h.record ? calcPythagorean(h.record.rs||0, h.record.ra||0) : 0.5;
    this.aPyth = a.record ? calcPythagorean(a.record.rs||0, a.record.ra||0) : 0.5;
    this.hElo = calcElo(h.record); this.aElo = calcElo(a.record);
    // Elo 기반 팀 전력 보정 (Elo 차이 → 승률 차이)
    const eloDiff = this.hElo - this.aElo;
    this.eloMod = { home: 1 + _.clamp(eloDiff * 0.0002, -0.03, 0.03), away: 1 - _.clamp(eloDiff * 0.0002, -0.03, 0.03) };
    // 팀 수비력 합산 (Statiz RAA Fielding 기반)
    this.hDefRAA=this.h.lineup.reduce((s,b)=>s+(b.defRAA||0),0);
    this.aDefRAA=this.a.lineup.reduce((s,b)=>s+(b.defRAA||0),0);
    // v6.0 신규 보정 팩터
    const dayIdx = opts.dayOfWeek ?? new Date().getDay();
    const jsDayToKr = [6,0,1,2,3,4,5];
    this.dayIdx = jsDayToKr[dayIdx] ?? 0;
    this.timeMod = TIME_SLOT_MOD[getTimeSlot(opts.time)] || TIME_SLOT_MOD.night;
    this.oddsMod = getOddsMod(h.teamRating, a.teamRating);
    this.h2hMod = getH2HMod(h.id, a.id);
    // v7.0 투수 피로도 추적 상태
    this.pitcherState = {
      home: { inningsPitched: 0, runsAllowed: 0, hitsAllowed: 0, isBullpen: false },
      away: { inningsPitched: 0, runsAllowed: 0, hitsAllowed: 0, isBullpen: false },
    };
  }
  platoon(b,p){ // 좌우 매치업: 반대손 유리, 같은손 불리, 스위치히터 중립
    const bt=b.bat||"R", pt=p.throws||"R";
    if(bt==="S") return 1.01; // 스위치히터 약간 유리
    if(bt!==pt) return 1.04; // 반대손 → 타자 유리 (좌타 vs 우투, 우타 vs 좌투)
    return 0.96; // 같은손 → 투수 유리
  }
  warBonus(b){ // WAR 기반 클러치 보너스 (Statiz WAR TOP 10 반영)
    const w=b.war||0; if(w<=0)return 1.0;
    return 1+Math.min(0.03,w*0.004); // WAR 7.5 → +3% 보너스 (과대 누적 방지)
  }
  pitcherWar(p){ // 투수 WAR/WPA 기반 지배력 (Statiz WPA/LI 반영)
    const w=p.wpaLI||0; if(w<=0)return 1.0;
    return 1+Math.min(0.04,w*0.008); // WPA/LI 5.0 → +4% 지배력 (과대 누적 방지)
  }
  defFactor(isHome){ // 수비 RAA → 실책/안타 억제 (Statiz Fielding RAA 반영)
    const dr=isHome?this.hDefRAA:this.aDefRAA;
    return 1-_.clamp(dr*0.001,-.03,.05); // 수비 RAA 50 → 안타 5% 억제
  }
  prob(b,p,isH,fatigueFactor=0){ const pf=this.st.parkFactor,wH=this.st.dome?1+(this.w.hitMod-1)*.2:this.w.hitMod,wR=this.st.dome?1+(this.w.hrMod-1)*.2:this.w.hrMod,hA=isH?1.025:1;
    const bF=_.clamp(b.recentForm||1.0,0.92,1.08), plt=this.platoon(b,p), wB=this.warBonus(b), pW=this.pitcherWar(p);
    // v6.0: 요일/시간대/배당/상대전적/매치업 보정
    const dayMod = DAY_OF_WEEK_MOD[isH?"home":"away"][this.dayIdx];
    const tHit = this.timeMod.hitMod, tHr = this.timeMod.hrMod;
    const oddF = isH ? this.oddsMod.home : this.oddsMod.away;
    const h2hF = isH ? this.h2hMod.home : this.h2hMod.away;
    const muMod = getMatchupMod(p.name, b.name);
    // v8.0: Elo 기반 팀 전력 보정 추가
    const eloF = isH ? this.eloMod.home : this.eloMod.away;
    const envMod = dayMod * oddF * h2hF * muMod * eloF; // 종합 환경 보정 (Elo 포함)
    // v7.0: 투수 피로도 보정 — 피로 시 제구력↓, 구위↓
    const ftg = fatigueFactor;
    const fatigueHitBoost = 1 + ftg * 0.8;
    const fatigueKDrop = 1 - ftg * 0.5;
    const fatigueBBBoost = 1 + ftg * 0.6;
    // v8.0: FIP 기반 투수력 (ERA 대신 FIP 사용 — 수비 독립적, 더 예측적)
    const fip = p.fip || calcFIP(p);
    const pF=_.clamp(1+(3.80-fip)*0.12,.7,1.3)*_.clamp(p.recentForm||1.0,0.92,1.08)*pW*(2-this.timeMod.eraMod);
    const pK=p.k9/9*fatigueKDrop, pB=p.bb9/9*fatigueBBBoost;
    const dF=this.defFactor(!isH);
    // v8.0: wOBA 기반 타자력 (AVG/OBP/SLG 개별 대신 wOBA 통합 지표 활용)
    const woba = b.woba || calcWOBA(b);
    const wobaFactor = woba / 0.340; // 리그 평균 wOBA(.340) 대비 비율
    const so=Math.min(.35,pK*(1-b.obp/.5)*.70*(2-plt)),bb=Math.min(.18,pB*(b.obp/.34)*.23*plt),hbp=.008;
    const hit=Math.max(.05,(wobaFactor*0.38*hA*wH*tHit*bF*plt*wB*envMod*fatigueHitBoost/pF-bb-hbp)*.88*dF),iso=b.slg-b.avg;
    const hr=Math.min(.08,(b.hr/550)*pf*wR*tHr*hA*bF*plt*wB*envMod*fatigueHitBoost/pF),t3=Math.min(.008,.003*(b.spd/5)),d2=Math.min(.08,iso*.25*pf*wH*tHit*plt*dF),s1=Math.max(.05,hit-hr-t3-d2);
    const errMod=this.defFactor(isH);
    const err=Math.max(.003,.015*this.w.errMod*errMod);
    const rem=Math.max(0,1-hit-bb-so-hbp-err);
    return {strikeout:so,walk:bb,hitByPitch:hbp,single:s1,double:d2,triple:t3,homerun:hr,groundOut:rem*.473,flyOut:rem*.368,lineOut:rem*.158,error:err};
  }
  ab(b,p,isH,ftg=0){ const pr=this.prob(b,p,isH,ftg); let r=Math.random(),c=0; for(const[t,v]of Object.entries(pr)){c+=v;if(r<c)return t;} return"groundOut"; }
  adv(bs,o,outs,b){ let rs=0; const sp=b.spd||5;
    switch(o){ case"homerun":rs=bs.filter(Boolean).length+1;bs[0]=bs[1]=bs[2]=null;break; case"triple":rs+=bs.filter(Boolean).length;bs[0]=bs[1]=null;bs[2]=b.name;break;
    case"double":if(bs[2]){rs++;bs[2]=null;}if(bs[1]){rs++;bs[1]=null;}if(bs[0]){bs[2]=bs[0];bs[0]=null;}bs[1]=b.name;break;
    case"single":if(bs[2]){rs++;bs[2]=null;}if(bs[1]){if(sp>=6||Math.random()>.5)bs[2]=bs[1];else rs++;bs[1]=null;}if(bs[0]){bs[1]=bs[0];bs[0]=null;}bs[0]=b.name;break;
    case"walk":case"hitByPitch":if(bs[0]&&bs[1]&&bs[2])rs++;if(bs[0]&&bs[1])bs[2]=bs[1];if(bs[0])bs[1]=bs[0];bs[0]=b.name;break;
    case"groundOut":if(bs[0]&&outs<2&&Math.random()<.4){bs[0]=null;if(bs[2]&&Math.random()<.3){rs++;bs[2]=null;}return{rs,o:2};}if(bs[2]&&outs<2&&Math.random()<.45){rs++;bs[2]=null;}if(bs[1]&&!bs[2]){bs[2]=bs[1];bs[1]=null;}return{rs,o:1};
    case"flyOut":if(bs[2]&&outs<2&&Math.random()<.55){rs++;bs[2]=null;}return{rs,o:1};
    case"error":if(bs[2]){rs++;bs[2]=null;}if(bs[1]){bs[2]=bs[1];bs[1]=null;}if(bs[0])bs[1]=bs[0];bs[0]=b.name;break;
    default:return{rs,o:1};} return{rs,o:0};
  }
  // v7.0: 도루 시도 판단 — 1루 주자 속력, 아웃카운트, 점수차 고려
  trySteal(bs,outs,scoreDiff,isOffense) {
    if (outs >= 2 || !bs[0]) return null; // 2아웃이거나 1루 주자 없으면 도루 불가
    if (bs[1]) return null; // 2루 점유 시 도루 불가
    const runner = bs[0];
    // 라인업에서 주자의 속력 찾기
    const team = isOffense ? this.a : this.h;
    const player = team.lineup.find(p => p.name === runner);
    const spd = player ? player.spd : 5;
    if (spd < 7) return null; // 속력 7 미만이면 도루 시도 안 함
    // 도루 시도 확률: 속력 높을수록, 접전일수록 시도
    const baseChance = (spd - 6) * 0.08; // spd7=8%, spd8=16%, spd9=24%
    const closeGame = Math.abs(scoreDiff) <= 2 ? 1.3 : 0.7;
    if (Math.random() > baseChance * closeGame) return null;
    // 도루 성공률: 속력 기반 (spd7=65%, spd8=75%, spd9=85%)
    const successRate = 0.50 + spd * 0.04;
    if (Math.random() < successRate) {
      bs[1] = bs[0]; bs[0] = null;
      return { success: true, runner, spd };
    }
    bs[0] = null;
    return { success: false, runner, spd };
  }
  // v7.0: 희생번트 판단 — 접전 + 주자 1루 + 0아웃 + 하위타선
  trySacBunt(b, bs, outs, scoreDiff) {
    if (outs !== 0 || !bs[0] || bs[1]) return false;
    if (Math.abs(scoreDiff) > 2) return false; // 접전이 아니면 번트 안 함
    const batIdx = this.h.lineup.indexOf(b) !== -1 ? this.h.lineup.indexOf(b) : this.a.lineup.indexOf(b);
    if (batIdx < 6) return false; // 상위타선(1~6번)은 번트 안 함
    if (Math.random() > 0.45) return false;
    // 번트 성공률 80%
    if (Math.random() < 0.80) {
      bs[1] = bs[0]; bs[0] = null;
      return "success";
    }
    return "fail"; // 번트 실패 = 파울/아웃
  }
  ko(o){return{single:"안타",double:"2루타",triple:"3루타",homerun:"홈런",walk:"볼넷",hitByPitch:"사구",strikeout:"삼진",groundOut:"땅볼",flyOut:"뜬공",lineOut:"라인아웃",error:"실책출루",steal:"도루성공",stealFail:"도루실패",sacBunt:"희생번트"}[o]||o;}
  game(){ const sc={home:0,away:0},is={home:[],away:[]},ht={home:0,away:0},er={home:0,away:0},so={home:0,away:0},bb={home:0,away:0},hr={home:[],away:[]};
    let hi=0,ai=0; const log=[];
    let hP=this.hP,aP=this.aP;
    // v7.0: 투수 상태 추적 (선발/불펜 각각)
    const ps = {
      home: { ip:0, ra:0, ha:0, isBullpen:false },
      away: { ip:0, ra:0, ha:0, isBullpen:false },
    };
    for(let inn=1;inn<=12;inn++){
      // ── 이닝 시작 시 투수 교체 판단 (v7.0 지능형) ──
      // 홈팀 투수 (원정팀 공격 전) 교체 검토
      if (!ps.home.isBullpen && inn >= 2) {
        const diff = sc.home - sc.away;
        if (shouldChangePitcher(hP, ps.home.ip, ps.home.ra, ps.home.ha, diff, true)) {
          hP = this.h.bullpen; ps.home.isBullpen = true; ps.home.ip=0; ps.home.ra=0; ps.home.ha=0;
        }
      }
      // 원정팀 투수 (홈팀 공격 전) 교체 검토
      if (!ps.away.isBullpen && inn >= 2) {
        const diff = sc.away - sc.home;
        if (shouldChangePitcher(aP, ps.away.ip, ps.away.ra, ps.away.ha, diff, false)) {
          aP = this.a.bullpen; ps.away.isBullpen = true; ps.away.ip=0; ps.away.ra=0; ps.away.ha=0;
        }
      }
      const hFtg = ps.home.isBullpen ? 0 : getPitcherFatigue(ps.home.ip, ps.home.ra, ps.home.ha);
      const aFtg = ps.away.isBullpen ? 0 : getPitcherFatigue(ps.away.ip, ps.away.ra, ps.away.ha);

      // ── 초(원정 공격) ──
      let outs=0,bs=[null,null,null],ir=0;const top=[];
      while(outs<3){
        // 도루 시도
        const steal=this.trySteal(bs,outs,sc.away-sc.home,true);
        if(steal){if(steal.success){top.push(`${steal.runner}: 도루성공 (SPD ${steal.spd})`);}else{top.push(`${steal.runner}: 도루실패`);outs++;continue;}}
        const b=this.a.lineup[ai%9];
        // 희생번트 시도
        const bunt=inn>=7?this.trySacBunt(b,bs,outs,sc.away-sc.home):false;
        if(bunt==="success"){top.push(`${b.name}: 희생번트 (주자 진루)`);outs++;ai++;continue;}
        if(bunt==="fail"){top.push(`${b.name}: 번트 실패`);outs++;ai++;continue;}
        const o=this.ab(b,hP,false,hFtg),r=this.adv(bs,o,outs,b);
        if(o==="error")er.home++;if(["single","double","triple","homerun"].includes(o)){ht.away++;ps.home.ha++;}if(o==="strikeout")so.away++;if(o==="walk"||o==="hitByPitch")bb.away++;if(o==="homerun")hr.away.push({batter:b.name,inning:inn});ir+=r.rs;outs+=r.o;ai++;top.push(`${b.name}: ${this.ko(o)}${r.rs?` (${r.rs}점)`:""}`);}
      sc.away+=ir;is.away.push(ir);ps.home.ra+=ir;ps.home.ip++;
      // 이닝 중 대량실점 시 긴급 교체 (3점 이상)
      if(!ps.home.isBullpen && ir>=3){hP=this.h.bullpen;ps.home.isBullpen=true;ps.home.ip=0;ps.home.ra=0;ps.home.ha=0;}
      if(inn>=9&&sc.home>sc.away){is.home.push("-");log.push({inning:inn,top,bottom:["종료"]});break;}

      // ── 말(홈 공격) ──
      outs=0;bs=[null,null,null];ir=0;const bot=[];
      while(outs<3){
        // 도루 시도
        const steal=this.trySteal(bs,outs,sc.home-sc.away,false);
        if(steal){if(steal.success){bot.push(`${steal.runner}: 도루성공 (SPD ${steal.spd})`);}else{bot.push(`${steal.runner}: 도루실패`);outs++;continue;}}
        const b=this.h.lineup[hi%9];
        // 희생번트 시도
        const bunt=inn>=7?this.trySacBunt(b,bs,outs,sc.home-sc.away):false;
        if(bunt==="success"){bot.push(`${b.name}: 희생번트 (주자 진루)`);outs++;hi++;continue;}
        if(bunt==="fail"){bot.push(`${b.name}: 번트 실패`);outs++;hi++;continue;}
        const o=this.ab(b,aP,true,aFtg),r=this.adv(bs,o,outs,b);
        if(o==="error")er.away++;if(["single","double","triple","homerun"].includes(o)){ht.home++;ps.away.ha++;}if(o==="strikeout")so.home++;if(o==="walk"||o==="hitByPitch")bb.home++;if(o==="homerun")hr.home.push({batter:b.name,inning:inn});ir+=r.rs;outs+=r.o;hi++;bot.push(`${b.name}: ${this.ko(o)}${r.rs?` (${r.rs}점)`:""}`);if(inn>=9&&sc.home+ir>sc.away)break;}
      sc.home+=ir;is.home.push(ir);ps.away.ra+=ir;ps.away.ip++;
      // 이닝 중 대량실점 시 긴급 교체
      if(!ps.away.isBullpen && ir>=3){aP=this.a.bullpen;ps.away.isBullpen=true;ps.away.ip=0;ps.away.ra=0;ps.away.ha=0;}
      log.push({inning:inn,top,bottom:bot});if(inn>=9&&sc.home!==sc.away)break;
    } while(is.home.length<is.away.length)is.home.push("-");
    return{score:sc,inningScores:is,hits:ht,errors:er,strikeouts:so,walks:bb,homeRuns:hr,gameLog:log,winner:sc.home>sc.away?"home":sc.away>sc.home?"away":"draw",totalInnings:is.away.length};
  }
  mc(n=1000){ let hw=0,aw=0,dr=0;const hs=[],as=[],all=[];
    for(let i=0;i<n;i++){const r=this.game();if(r.winner==="home")hw++;else if(r.winner==="away")aw++;else dr++;hs.push(r.score.home);as.push(r.score.away);if(i<5)all.push(r);}
    return{homeWins:hw,awayWins:aw,draws:dr,homeWinPct:((hw/n)*100).toFixed(1),awayWinPct:((aw/n)*100).toFixed(1),avgHome:_.mean(hs).toFixed(1),avgAway:_.mean(as).toFixed(1),totalScoreDist:_.countBy(hs.map((h,i)=>h+as[i])),sampleResults:all,simCount:n};
  }
}

// ═══════════════════════════════════════════════════════
// UI 컴포넌트 (다크 블루/퍼플 테마)
// ═══════════════════════════════════════════════════════

const AI_AV = "🤖", AI_NM = "BALL-E";

// ═══════════════════════════════════════════════════════
// Claude API 연동 (BALL-E 대화형 AI)
// ═══════════════════════════════════════════════════════

const CLAUDE_API_KEY = import.meta.env.VITE_CLAUDE_API_KEY || "";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

function buildTeamContext(h, a) {
  const fmt = (t) => {
    const batters = t.lineup.map(b => `${b.name}(${b.pos}) AVG${b.avg} OBP${b.obp} SLG${b.slg} HR${b.hr} WAR${b.war||"-"}`).join(", ");
    const pitchers = t.starters.map(p => `${p.name} ERA${p.era} WHIP${p.whip} K9${p.k9} WAR${p.war||"-"} FIP${p.fip||"-"}`).join(", ");
    return `[${t.name}] 팀레이팅:${t.teamRating}\n 타자: ${batters}\n 투수: ${pitchers}\n 불펜: ERA${t.bullpen.era} WHIP${t.bullpen.whip}`;
  };
  return `=== 홈팀 ===\n${fmt(h)}\n\n=== 원정팀 ===\n${fmt(a)}`;
}

const BALLE_SYSTEM = `당신은 BALL-E, KBO 야구 AI 분석 파트너입니다.

## 성격
- 야구에 열정적이고 전문적인 분석가
- 세이버메트릭스(WAR, FIP, wOBA, 피타고리안 기대승률)에 능숙
- 간결하고 핵심적인 답변 (3~5문장 이내)
- 한국어로 대화

## 핵심 역할
1. 경기 예측 분석: 양 팀 데이터를 바탕으로 승패 분석
2. 선수 비교/평가: 스탯 기반 객관적 비교
3. 전략 제안: 날씨, 구장, 상대전적 등 고려
4. 컨디션 반영: 사용자가 알려주는 비공개 정보(부상, 음주, 컨디션 등)를 수치로 변환

## 조정값 추출 규칙
사용자가 선수/팀의 컨디션 정보를 알려주면, 응답 마지막에 반드시 아래 형식으로 조정값을 출력하세요:
[ADJ] 선수명|방향(+/-)|퍼센트
예시:
- "양현종 어제 술 마셨대" → [ADJ] 양현종|-|15
- "김도영 타격감 살아있어" → [ADJ] 김도영|+|10
- "삼성 전체 분위기 최고" → [ADJ] 삼성|+|8

조정이 필요 없는 일반 질문에는 [ADJ]를 출력하지 마세요.

## 데이터
시뮬레이터는 Monte Carlo 방식으로 1000~10000회 시뮬레이션하며, 투수피로도/지능형교체/도루전략/요일보정/H2H 등 28개 변수를 사용합니다.`;

async function* streamClaude(messages, teamContext) {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === "your-api-key-here") {
    yield "⚠️ API 키가 설정되지 않았습니다.\n.env 파일에 VITE_CLAUDE_API_KEY를 설정해주세요.\n\nhttps://console.anthropic.com/settings/keys";
    return;
  }

  const systemPrompt = BALLE_SYSTEM + (teamContext ? `\n\n## 현재 경기 데이터\n${teamContext}` : "");

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role === "ai" ? "assistant" : "user", content: m.content })),
    stream: true,
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    yield `❌ API 오류 (${resp.status}): ${err.slice(0, 200)}`;
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const ev = JSON.parse(data);
        if (ev.type === "content_block_delta" && ev.delta?.text) {
          yield ev.delta.text;
        }
      } catch {}
    }
  }
}

function parseAdjFromResponse(text, homeTeam, awayTeam) {
  const adjs = [];
  const adjMatches = text.matchAll(/\[ADJ\]\s*(.+?)\|([\+\-])\|(\d+)/g);
  const parser = new InsightParser(homeTeam, awayTeam);

  for (const m of adjMatches) {
    const name = m[1].trim(), dir = m[2] === "+" ? 1 : -1, pct = parseInt(m[3]);
    const players = parser.players(name);
    const teams = parser.teams(name);

    if (players.length > 0) {
      players.forEach(p => adjs.push({
        targetType: "player", side: p.side, role: p.role, idx: p.idx,
        name: p.name, teamId: p.teamId, factor: 1 + (dir * pct / 100), direction: dir, pct
      }));
    } else if (teams.length > 0) {
      teams.forEach(t => adjs.push({
        targetType: "team", side: t.side, teamId: t.teamId, teamName: t.name,
        factor: 1 + (dir * pct / 100), direction: dir, pct
      }));
    }
  }
  return adjs;
}

const Board = ({result:r,homeTeam:h,awayTeam:a}) => (
  <div className="overflow-x-auto"><table className="w-full text-center text-sm border-collapse dark-table"><thead><tr><th className="p-2 text-left min-w-28 text-slate-300">팀</th>
    {Array.from({length:r.totalInnings},(_,i)=><th key={i} className="p-1 w-7 text-xs text-slate-400">{i+1}</th>)}
    <th className="p-1 w-9 font-bold text-neon-purple">R</th><th className="p-1 w-9 text-slate-400">H</th><th className="p-1 w-9 text-slate-400">E</th></tr></thead>
    <tbody>{[{t:a,s:"away"},{t:h,s:"home"}].map(({t,s})=>(<tr key={s}><td className="p-2 text-left font-bold text-sm"><TeamLogo src={t.logo} alt={t.short} size={18} className="mr-1 align-middle" /><span style={{color:t.color}}>{t.short}</span></td>
      {r.inningScores[s].map((v,i)=><td key={i} className={`p-1 text-xs ${v>0&&v!=="-"?"font-bold text-cyan-400":"text-slate-500"}`}>{v}</td>)}
      <td className="p-1 font-bold text-base text-white">{r.score[s]}</td><td className="p-1 text-xs text-slate-400">{r.hits[s]}</td><td className="p-1 text-xs text-slate-400">{r.errors[s]}</td></tr>))}
  </tbody></table></div>);

const WPB = ({hp,ap,h,a}) => (<div className="mt-4"><div className="flex justify-between text-xs mb-1.5 font-bold"><span className="text-pink-400">{a.short} {ap}%</span><span className="text-neon-blue">{h.short} {hp}%</span></div>
  <div className="w-full h-8 rounded-full overflow-hidden flex bg-dark-600">{[{p:ap,cls:"win-bar-away"},{p:hp,cls:"win-bar-home"}].map(({p,cls},i)=>(<div key={i} className={`h-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500 ${cls}`} style={{width:`${p}%`}}>{parseFloat(p)>18?`${p}%`:""}</div>))}</div></div>);

const TeamLogo = ({src, alt, size = 32, className = ""}) => (
  <img src={src} alt={alt} width={size} height={size} className={`inline-block object-contain ${className}`} style={{width: size, height: size}} />
);

const GLog = ({log,h,a}) => { const[e,setE]=useState(null); return(<div className="mt-3 space-y-1">{log.map((inn,i)=>(<div key={i}><button onClick={()=>setE(e===i?null:i)} className="w-full text-left px-3 py-1.5 rounded-lg bg-dark-600/50 hover:bg-dark-500/50 text-xs flex justify-between border border-white/5"><span className="font-semibold text-slate-300">{inn.inning}회</span><span className="text-slate-500">{e===i?"−":"+"}</span></button>
    {e===i&&<div className="px-3 py-1.5 text-xs space-y-1.5 animate-fadeIn">{[{ev:inn.top,t:a,l:"초"},{ev:inn.bottom,t:h,l:"말"}].map(({ev,t,l})=>(<div key={l}><span className="font-semibold" style={{color:t.color}}>{t.short} ({l})</span><div className="ml-2 mt-0.5 text-slate-400 space-y-0.5">{ev.map((x,j)=><div key={j}>{x}</div>)}</div></div>))}</div>}</div>))}</div>); };

const EX_AI = [
  "오늘 경기 누가 이길 것 같아?",
  "양현종 어제 술을 많이 마셨대",
  "김도영 vs 강백호 누가 더 나아?",
  "비 오는 날 롯데 홈 경기 어때?",
];

const Chat = ({homeTeam:h,awayTeam:a,adj,setAdj,onC}) => {
  const greet = `안녕하세요! ${AI_NM}입니다. ${h.short} vs ${a.short} 경기에 대해 무엇이든 물어보세요.\n\n💡 선수 컨디션, 경기 분석, 전략 제안 등 자유롭게 대화하세요.`;
  const[ms,setMs]=useState([{role:"ai",content:greet}]);
  const[inp,setInp]=useState("");
  const[loading,setLoading]=useState(false);
  const scrollRef=useRef(null);
  const isAI = CLAUDE_API_KEY && CLAUDE_API_KEY !== "your-api-key-here";

  useEffect(()=>{if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[ms]);

  const send = useCallback(async ()=>{
    if(!inp.trim()||loading) return;
    const userMsg = inp.trim();
    setInp("");
    const newMs = [...ms, {role:"user",content:userMsg}];
    setMs(newMs);

    if(!isAI){
      // 폴백: 기존 InsightParser
      const p=new InsightParser(h,a), r=p.parse(userMsg);
      setAdj(r.adjustments);
      setMs(m=>[...m,{role:"ai",content:r.response + "\n\n💡 Claude API 키를 설정하면 더 자연스러운 대화가 가능합니다."}]);
      return;
    }

    // Claude API 스트리밍 호출
    setLoading(true);
    setMs(m=>[...m,{role:"ai",content:""}]);
    let fullText = "";
    try {
      const teamCtx = buildTeamContext(h, a);
      const chatHistory = newMs.filter(m=>m.role!=="ai"||m.content!==greet);
      for await (const chunk of streamClaude(chatHistory, teamCtx)) {
        fullText += chunk;
        setMs(m=>{const updated=[...m]; updated[updated.length-1]={role:"ai",content:fullText}; return updated;});
      }
      // [ADJ] 태그 파싱 → adjustment 추출
      const adjs = parseAdjFromResponse(fullText, h, a);
      if(adjs.length > 0) setAdj(adjs);
      // [ADJ] 태그를 UI에서 숨김
      const cleanText = fullText.replace(/\[ADJ\]\s*.+?\|[\+\-]\|\d+/g, "").trim();
      if(cleanText !== fullText) {
        setMs(m=>{const updated=[...m]; updated[updated.length-1]={role:"ai",content:cleanText}; return updated;});
      }
    } catch(e) {
      setMs(m=>{const updated=[...m]; updated[updated.length-1]={role:"ai",content:`❌ 오류: ${e.message}`}; return updated;});
    } finally { setLoading(false); }
  },[inp,ms,h,a,setAdj,loading,isAI,greet]);

  return(<div className="space-y-3 glass-card rounded-2xl p-4">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-lg">{AI_AV}</span>
      <span className="text-sm font-bold text-slate-200">{AI_NM}</span>
      {isAI?<span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">AI</span>
            :<span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">키워드</span>}
    </div>
    <div ref={scrollRef} className="bg-dark-900/60 rounded-lg p-3 h-72 overflow-y-auto space-y-2.5">
      {ms.map((m,i)=>(<div key={i} className={`flex gap-2 ${m.role==="user"?"flex-row-reverse":""}`}>
        <span className="text-lg flex-shrink-0 mt-0.5">{m.role==="user"?"👤":AI_AV}</span>
        <div className={`text-xs p-2.5 rounded-xl max-w-[85%] whitespace-pre-wrap leading-relaxed ${
          m.role==="user"?"bg-accent-blue/20 text-blue-200 border border-accent-blue/20"
          :"bg-dark-500/50 text-slate-300 border border-white/5"}`}>
          {m.content||(loading&&i===ms.length-1?<span className="inline-block w-2 h-4 bg-neon-purple animate-pulse rounded-sm"/>:"")}
        </div>
      </div>))}
    </div>
    <div className="flex gap-1.5">
      <input value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.nativeEvent.isComposing&&send()}
        placeholder={isAI?"BALL-E에게 물어보세요...":"예: 디아즈 20% 상승"} className="dark-input flex-1 px-3 py-2.5 rounded-lg text-sm" disabled={loading}/>
      <button onClick={send} disabled={loading} className="btn-primary px-4 py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50">
        {loading?"...":"전송"}
      </button>
    </div>
    <div className="flex flex-wrap gap-1.5">{EX_AI.map((e,i)=><button key={i} disabled={loading}
      className="px-2.5 py-1.5 bg-dark-600/40 rounded-lg text-xs text-slate-400 hover:text-slate-300 hover:bg-dark-500/50 transition border border-white/5 disabled:opacity-40"
      onClick={()=>setInp(e)}>{e}</button>)}</div>
  </div>);
};

const TC = ({team:t,sel,onClick}) => (<button onClick={onClick} className={`p-2.5 rounded-xl text-center transition-all duration-200 ${sel?"ring-2 ring-accent-purple bg-accent-purple/15 shadow-glow-purple":"glass-card hover:bg-dark-500/40"}`}><div className="flex justify-center"><TeamLogo src={t.logo} alt={t.short} size={36} /></div><div className="text-xs font-bold mt-1 text-slate-200">{t.short}</div>{t.record?<div className="text-xs text-slate-500">{t.record.w}승{t.record.l}패 ({t.record.pct})</div>:<div className="text-xs text-slate-500">R{t.teamRating}</div>}</button>);

const TodayGamePanel = ({g, wk, wd}) => {
  const[adj,setAdj]=useState([]);
  const[sc,setSc]=useState(1000);
  const[run,setRun]=useState(false);
  const[mc,setMc]=useState(null);
  const[sg,setSg]=useState(null);
  const h=g.home, a=g.away;
  const dow=new Date().getDay(), simOpts={dayOfWeek:dow, time:g.time};
  const clr=()=>{setMc(null);setSg(null);};
  const r1=useCallback(async()=>{setRun(true);try{const{home:h2,away:a2}=applyAdj(h,a,adj);await new Promise(r=>setTimeout(r,10));const sim=new Sim(h2,a2,h.stadium,wk,g.homeStarterIdx,g.awayStarterIdx,simOpts),res=sim.game();setSg(res);}catch(e){console.error(e);}finally{setRun(false);}},[h,a,adj,wk,g,simOpts]);
  const rN=useCallback(async()=>{setRun(true);try{const{home:h2,away:a2}=applyAdj(h,a,adj);await new Promise(r=>setTimeout(r,10));const sim=new Sim(h2,a2,h.stadium,wk,g.homeStarterIdx,g.awayStarterIdx,simOpts),res=sim.mc(sc);setMc(res);if(res.sampleResults.length>0)setSg(res.sampleResults[0]);}catch(e){console.error(e);}finally{setRun(false);}},[h,a,adj,wk,sc,g,simOpts]);
  return(<div className="mt-3 space-y-3 animate-fadeIn border-t border-white/5 pt-4">
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
      <div className="lg:col-span-3"><Chat homeTeam={h} awayTeam={a} adj={adj} setAdj={setAdj} onC={clr}/></div>
      <div className="lg:col-span-2 space-y-3">
        <div className="glass-card rounded-xl p-3">
          <div className="text-xs font-semibold text-slate-400 mb-2">구장 정보</div>
          <div className="bg-dark-600/50 rounded-lg p-2 text-xs border border-white/5"><span className="font-bold text-slate-200">{STADIUMS[g.stadiumId].name}</span> <span className="text-slate-500">파크팩터 {STADIUMS[g.stadiumId].parkFactor}{STADIUMS[g.stadiumId].dome?" (돔)":""}</span></div>
        </div>
        <div className="glass-card rounded-xl p-3">
          <div className="text-xs font-semibold text-slate-400 mb-2">상대전적 (H2H)</div>
          <div className="text-xs text-slate-400">{h.short} 홈 vs {a.short}: <span className="font-bold text-neon-purple">{((H2H_RECORDS[h.id]?.[a.id]||.5)*100).toFixed(0)}%</span> 승률</div>
          <div className="text-xs text-slate-500 mt-0.5">배당 보정: 홈 {getOddsMod(h.teamRating,a.teamRating).home>.999?"유리":"언더독"} ({h.teamRating} vs {a.teamRating})</div>
        </div>
        {adj.length>0&&<div className="glass-card rounded-xl p-3 border-accent-purple/30 animate-glow"><div className="text-xs font-bold text-neon-purple mb-1">{AI_AV} 유저 인텔리전스 {adj.length}건</div>{adj.map((x,i)=><div key={i} className="text-xs flex gap-1.5"><span className={`font-bold ${x.direction<0?"text-red-400":"text-emerald-400"}`}>{x.direction<0?"▼":"▲"}{x.pct}%</span><span className="text-slate-400">{x.name||x.teamName}</span></div>)}</div>}
      </div>
    </div>
    <div className="flex gap-2">
      <button onClick={r1} disabled={run} className="flex-1 btn-secondary text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50">{run?"시뮬중...":"단일 경기"}</button>
      <button onClick={rN} disabled={run} className="flex-1 btn-primary text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50">{run?"분석중...":`${sc.toLocaleString()}회 시뮬`}</button>
      <select value={sc} onChange={e=>setSc(Number(e.target.value))} className="dark-input rounded-xl px-2 text-xs">{[100,500,1000,5000,10000].map(n=><option key={n} value={n}>{n.toLocaleString()}회</option>)}</select>
    </div>
    {mc&&<div className="glass-card-strong rounded-2xl p-4 animate-fadeIn">
      <div className="flex items-center justify-center gap-6 mb-3">{[a,h].reduce((acc,t,i)=>{const el=<div key={t.id} className="text-center"><div className="mb-1 flex justify-center"><TeamLogo src={t.logo} alt={t.short} size={48} /></div><div className="font-bold text-base" style={{color:t.color}}>{t.name}</div></div>;return i===0?[el]:[...acc,<div key="vs" className="text-dark-400 text-xl font-black glow-text">VS</div>,el];},[])}
      </div>{adj.length>0&&<div className="text-center text-xs text-neon-purple font-bold mb-2">{AI_AV} 유저 인텔리전스 {adj.length}건 반영</div>}
      <WPB hp={mc.homeWinPct} ap={mc.awayWinPct} h={h} a={a}/>
      <div className="grid grid-cols-4 gap-2 mt-4 text-center">{[{l:`${a.short} 승률`,v:mc.awayWinPct+"%",c:"#ec4899"},{l:`${h.short} 승률`,v:mc.homeWinPct+"%",c:"#3b82f6"},{l:"평균",v:`${mc.avgAway}-${mc.avgHome}`,c:"#94a3b8"},{l:"무승부",v:mc.draws,c:"#64748b"}].map((c,i)=><div key={i} className="glass-card rounded-xl p-2.5"><div className="text-xs text-slate-500">{c.l}</div><div className="text-lg font-black" style={{color:c.c}}>{c.v}</div></div>)}</div>
      <div className="mt-4"><div className="text-xs font-semibold text-slate-400 mb-2">총 득점 분포</div><div className="flex items-end gap-0.5 h-20">{Array.from({length:25},(_,i)=>{const ct=mc.totalScoreDist[i]||0,mx=Math.max(...Object.values(mc.totalScoreDist)),ht=mx>0?(ct/mx)*100:0;return<div key={i} className="flex-1 flex flex-col items-center"><div className="w-full rounded-t transition-all" style={{height:`${ht}%`,background:ct>0?"linear-gradient(180deg,#8b5cf6,#3b82f6)":"rgba(255,255,255,0.03)",minHeight:ct>0?"2px":0}} title={`${i}점: ${ct}회`}/>{i%3===0&&<span className="text-xs text-slate-600 mt-0.5">{i}</span>}</div>;})}</div></div>
    </div>}
    {sg&&<div className="glass-card-strong rounded-2xl p-4 animate-fadeIn">
      <div className="flex items-center justify-between mb-2"><h3 className="font-bold text-sm text-slate-200">{mc?"샘플 경기":"경기 결과"}</h3>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${sg.winner==="home"?"bg-accent-blue/20 text-blue-300 border border-accent-blue/30":sg.winner==="away"?"bg-pink-500/20 text-pink-300 border border-pink-500/30":"bg-dark-500 text-slate-400 border border-white/10"}`}>{sg.winner==="home"?`${h.short} 승`:sg.winner==="away"?`${a.short} 승`:"무승부"}</span></div>
      <Board result={sg} homeTeam={h} awayTeam={a}/>
      {(sg.homeRuns.home.length>0||sg.homeRuns.away.length>0)&&<div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-xs"><span className="font-bold text-amber-400">홈런</span><div className="mt-1 text-slate-400">{[...sg.homeRuns.away.map(x=>`${a.short} ${x.batter} (${x.inning}회)`),...sg.homeRuns.home.map(x=>`${h.short} ${x.batter} (${x.inning}회)`)].join(" / ")}</div></div>}
      <GLog log={sg.gameLog} h={h} a={a}/>
    </div>}
  </div>);
};

const TodayTab = () => {
  const[d,setD]=useState(new Date().toISOString().split("T")[0]);
  const[sch,setSch]=useState([]);
  const[loading,setLoading]=useState(false);
  const[source,setSource]=useState("");
  const wR=useRef({});
  const[w]=useState("cloudy");
  const[expanded,setExpanded]=useState(null);
  useEffect(()=>{
    let cancel=false;
    (async()=>{
      setLoading(true); setSch([]); setSource("");
      const [y,mo] = d.split("-");
      const year = parseInt(y), month = parseInt(mo);

      // ── 1순위: 정적 schedule-today.json (GitHub Pages, daily-predict workflow가 매일 갱신) ──
      const staticGames = await tryStaticSchedule(d);
      if (!cancel && staticGames && staticGames.length > 0) {
        const staticSpMap = {};
        for (const g of staticGames) {
          staticSpMap[`${g.awayName}_${g.homeName}`] = g._spFromStatic;
        }
        const games = parseKBOGames(staticGames, d, staticSpMap);
        if (!cancel && games.length > 0) {
          setSch(games); setSource("static-data"); setLoading(false);
          return;
        }
      }

      // ── 2순위: KBO 공식 API (로컬 dev 환경) ──
      // 선택된 연도로 먼저 시도, 실패 시 KBO 최신 시즌으로 재시도
      let allGames = await fetchKBOSchedule(year, month);
      if((!allGames || allGames.length === 0) && year !== KBO_CURRENT_SEASON){
        allGames = await fetchKBOSchedule(KBO_CURRENT_SEASON, month);
      }
      if(cancel) return;
      if(allGames && allGames.length > 0){
        const spMap = await fetchStartingPitchers(d);
        const games = parseKBOGames(allGames, d, spMap);
        if(games.length > 0){ setSch(games); setSource("kbo"); }
        else { setSch([]); setSource("kbo-nodata"); }
      } else {
        setSch(generateScheduleFallback(d)); setSource("fallback");
      }
      setLoading(false);
    })();
    return ()=>{ cancel=true; };
  },[d]);
  useEffect(()=>{if(sch.length>0)(async()=>{for(const g of sch){if(!wR.current[g.stadiumId]){const wd=await fetchWeather(STADIUMS[g.stadiumId].cityEn);wR.current[g.stadiumId]=wd;}}})();},[sch]);
  useEffect(()=>{setExpanded(null);},[d]);
  return(<div className="space-y-4 animate-fadeIn">
    <div className="glass-card-strong rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-300">날짜</div>
        {source&&<div className="text-xs px-2 py-0.5 rounded-full border" style={source==="kbo"?{color:"#34d399",borderColor:"rgba(16,185,129,0.3)",background:"rgba(16,185,129,0.1)"}:{color:"#94a3b8",borderColor:"rgba(148,163,184,0.2)",background:"rgba(148,163,184,0.08)"}}>{source==="kbo"?"KBO 공식 일정":"자동 생성 일정"}</div>}
      </div>
      <input type="date" value={d} onChange={e=>setD(e.target.value)} className="dark-input w-full px-3 py-2 rounded-lg"/>
    </div>
    {loading&&<div className="glass-card rounded-xl p-8 text-center"><div className="text-slate-400 text-sm animate-pulse">KBO 공식 일정을 불러오는 중...</div></div>}
    {!loading&&sch.length===0&&<div className="glass-card rounded-xl p-8 text-center"><div className="text-slate-500 text-sm">해당 날짜에 예정된 경기가 없습니다</div></div>}
    <div className="space-y-3">{sch.map(g=>{const wd=wR.current[g.stadiumId],wk=(wd&&wd.weatherKey)||w,isExp=expanded===g.id;return(<div key={g.id} className={`glass-card rounded-xl p-4 transition-all duration-300 cursor-pointer ${isExp?"ring-1 ring-accent-purple/40 shadow-glow-purple":"hover:shadow-card-hover"}`} onClick={()=>!isExp&&setExpanded(g.id)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><div className="text-xs text-slate-500">{g.time} @ {STADIUMS[g.stadiumId].name}</div>{isExp&&<span className="text-xs text-accent-purple font-semibold px-2 py-0.5 rounded-full bg-accent-purple/10 border border-accent-purple/20">시뮬레이션 모드</span>}</div>
        <div className="flex items-center gap-2"><div className="text-xs font-semibold text-cyan-400" title={wd&&wd.display}>{WEATHER_EFFECTS[wk].label}</div>
          {isExp?<button onClick={e=>{e.stopPropagation();setExpanded(null);}} className="text-xs text-slate-500 hover:text-slate-300 transition px-2 py-1 rounded-lg hover:bg-dark-500/50">✕ 닫기</button>:<button className="text-xs text-slate-500 hover:text-accent-purple transition">시뮬 ▼</button>}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-center min-w-[52px]"><div className="flex justify-center"><TeamLogo src={g.away.logo} alt={g.away.short} size={40} /></div><div className="text-xs font-bold text-slate-300 mt-1">{g.away.short}</div></div>
          {g.hasResult?(
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-black tabular-nums ${g.awayScore>g.homeScore?"text-cyan-400":"text-slate-500"}`}>{g.awayScore}</span>
              <span className="text-xs font-bold text-dark-400">:</span>
              <span className={`text-2xl font-black tabular-nums ${g.homeScore>g.awayScore?"text-cyan-400":"text-slate-500"}`}>{g.homeScore}</span>
            </div>
          ):(<div className="text-center text-sm font-black text-dark-400 px-2">VS</div>)}
          <div className="text-center min-w-[52px]"><div className="flex justify-center"><TeamLogo src={g.home.logo} alt={g.home.short} size={40} /></div><div className="text-xs font-bold text-slate-300 mt-1">{g.home.short}</div></div>
        </div>
        <div className="text-right space-y-1">
          {g.hasResult&&<div className="mb-1"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${g.awayScore>g.homeScore?"bg-pink-500/20 text-pink-300 border border-pink-500/30":g.homeScore>g.awayScore?"bg-accent-blue/20 text-blue-300 border border-accent-blue/30":"bg-dark-500 text-slate-400 border border-white/10"}`}>{g.awayScore>g.homeScore?`${g.away.short} 승`:g.homeScore>g.awayScore?`${g.home.short} 승`:"무승부"}</span></div>}
          <div className="text-xs text-slate-500"><span className={g.away.starters[g.awayStarterIdx].throws==="L"?"text-cyan-400":"text-pink-400"}>{g.away.starters[g.awayStarterIdx].throws}</span> {g.away.starters[g.awayStarterIdx].name} <span className="text-slate-600">ERA {g.away.starters[g.awayStarterIdx].era}</span></div>
          <div className="text-xs text-slate-500"><span className={g.home.starters[g.homeStarterIdx].throws==="L"?"text-cyan-400":"text-pink-400"}>{g.home.starters[g.homeStarterIdx].throws}</span> {g.home.starters[g.homeStarterIdx].name} <span className="text-slate-600">ERA {g.home.starters[g.homeStarterIdx].era}</span></div>
        </div>
      </div>
      {isExp&&<TodayGamePanel g={g} wk={wk} wd={wd}/>}
    </div>);})}
    </div></div>);
};

const VirtualTab = () => {
  const[hId,setHId]=useState("lg");
  const[aId,setAId]=useState("hanwha");
  const[hsi,setHsi]=useState(0);
  const[asi,setAsi]=useState(0);
  const[w,setW]=useState("cloudy");
  const[adj,setAdj]=useState([]);
  const[run,setRun]=useState(false);
  const[sc,setSc]=useState(1000);
  const[mc,setMc]=useState(null);
  const[sg,setSg]=useState(null);
  const[selDay,setSelDay]=useState(new Date().getDay());
  const[selTime,setSelTime]=useState("18:30");
  const h=KBO_TEAMS[hId],a=KBO_TEAMS[aId],can=h&&a&&h.id!==a.id;
  const simOpts={dayOfWeek:selDay, time:selTime};
  const clr=()=>{setMc(null);setSg(null);};
  const r1=useCallback(async()=>{if(!can)return;setRun(true);try{const{home:h2,away:a2}=applyAdj(h,a,adj);await new Promise(r=>setTimeout(r,10));const sim=new Sim(h2,a2,h.stadium,w,hsi,asi,simOpts),res=sim.game();setSg(res);}catch(e){console.error("Sim error:",e);}finally{setRun(false);}},[h,a,adj,w,hsi,asi,can,simOpts]);
  const rN=useCallback(async()=>{if(!can)return;setRun(true);try{const{home:h2,away:a2}=applyAdj(h,a,adj);await new Promise(r=>setTimeout(r,10));const sim=new Sim(h2,a2,h.stadium,w,hsi,asi,simOpts),res=sim.mc(sc);setMc(res);if(res.sampleResults.length>0)setSg(res.sampleResults[0]);}catch(e){console.error("MC error:",e);}finally{setRun(false);}},[h,a,adj,w,hsi,asi,sc,can,simOpts]);
  const ts=Object.values(KBO_TEAMS).sort((x,y)=>y.teamRating-x.teamRating);
  return(<div className="space-y-4 animate-fadeIn">
    <div className="glass-card-strong rounded-2xl p-5">
      <div className="text-sm font-semibold text-slate-300 mb-3">대전 팀 선택</div>
      <div className="space-y-4">
        {[{l:"원정 AWAY",sel:aId,set:(id)=>{setAId(id);setAsi(0);clr();setAdj([]);}},{l:"홈 HOME",sel:hId,set:(id)=>{setHId(id);setHsi(0);clr();setAdj([]);}}].map(({l,sel,set})=>(
          <div key={l}><div className="text-xs font-semibold text-slate-500 mb-2">{l}</div><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{ts.map(t=><TC key={t.id} team={t} sel={sel===t.id} onClick={()=>set(t.id)}/>)}</div></div>
        ))}
      </div>{hId===aId&&hId&&<div className="mt-3 text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">같은 팀 불가</div>}
    </div>

    {can&&<div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3"><Chat homeTeam={h} awayTeam={a} adj={adj} setAdj={setAdj} onC={clr}/></div>
      <div className="lg:col-span-2 space-y-3">
        <div className="glass-card-strong rounded-2xl p-4">
          <div className="text-sm font-semibold text-slate-300 mb-1">구장</div>
          <div className="bg-dark-600/50 rounded-lg p-2.5 text-sm mb-3 border border-white/5"><div className="font-bold text-slate-200">{STADIUMS[h.stadium].name}</div><div className="text-slate-500 text-xs">파크팩터 {STADIUMS[h.stadium].parkFactor}{STADIUMS[h.stadium].dome?" (돔)":""}</div></div>
          <div className="text-sm font-semibold text-slate-300 mb-1">요일</div>
          <div className="flex flex-wrap gap-1 mb-3">{["일","월","화","수","목","금","토"].map((d,i)=>(<button key={i} onClick={()=>{setSelDay(i);clr();}} className={`px-2.5 py-1 rounded-lg text-xs transition-all ${selDay===i?"bg-accent-purple text-white shadow-glow-purple":"bg-dark-600/50 text-slate-400 hover:bg-dark-500/50 border border-white/5"}`}>{d}</button>))}</div>
          <div className="text-sm font-semibold text-slate-300 mb-1">시간대</div>
          <div className="flex flex-wrap gap-1 mb-3">{["14:00","17:00","18:30"].map(t=>(<button key={t} onClick={()=>{setSelTime(t);clr();}} className={`px-2.5 py-1 rounded-lg text-xs transition-all ${selTime===t?"bg-accent-purple text-white shadow-glow-purple":"bg-dark-600/50 text-slate-400 hover:bg-dark-500/50 border border-white/5"}`}>{TIME_SLOT_MOD[getTimeSlot(t)].label}</button>))}</div>
          <div className="text-sm font-semibold text-slate-300 mb-1">날씨</div>
          <div className="flex flex-wrap gap-1 mb-3">{Object.entries(WEATHER_EFFECTS).map(([k,v])=>(<button key={k} onClick={()=>{setW(k);clr();}} className={`px-2 py-1 rounded-lg text-xs transition-all ${w===k?"bg-accent-blue text-white shadow-glow-blue":"bg-dark-600/50 text-slate-400 hover:bg-dark-500/50 border border-white/5"}`}>{v.label}</button>))}</div>
          {can&&<div className="bg-dark-600/40 rounded-lg p-2.5 mb-3 border border-white/5"><div className="text-xs font-semibold text-slate-400 mb-1">팀 상대전적 (H2H)</div><div className="text-xs text-slate-500">{h.short} 홈 vs {a.short}: <span className="font-bold text-neon-purple">{((H2H_RECORDS[hId]?.[aId]||.5)*100).toFixed(0)}%</span> 승률</div><div className="text-xs text-slate-500">배당 보정: 홈 {getOddsMod(h.teamRating,a.teamRating).home>.999?"유리":"언더독"} ({h.teamRating} vs {a.teamRating})</div></div>}
          {[{t:a,si:asi,setSi:(i)=>{setAsi(i);clr();}},{t:h,si:hsi,setSi:(i)=>{setHsi(i);clr();}}].map(({t,si,setSi})=>(
            <div key={t.id} className="mb-2"><div className="text-xs font-semibold mb-1"><span style={{color:t.color}}>{t.short}</span> <span className="text-slate-500">선발</span></div>
              <div className="space-y-1">{t.starters.map((p,i)=>(<button key={i} onClick={()=>setSi(i)} className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-all ${si===i?"bg-accent-purple/20 text-white border border-accent-purple/40 shadow-glow-purple":"bg-dark-600/30 hover:bg-dark-500/40 text-slate-400 border border-white/5"}`}><span className={`inline-block w-4 text-center font-bold ${p.throws==="L"?"text-cyan-400":"text-pink-400"}`}>{p.throws||"R"}</span> {p.name} <span className="opacity-60">ERA {p.era} K9 {p.k9}</span>{p.war?<span className="ml-1 text-neon-purple font-bold">WAR {p.war}</span>:""}{p.recentForm&&p.recentForm>1.08?<span className="ml-1">🔥</span>:p.recentForm&&p.recentForm<0.92?<span className="ml-1">❄️</span>:""}</button>))}</div></div>))}
        </div>
        {adj.length>0&&<div className="glass-card rounded-xl p-3 border-accent-purple/30 animate-glow"><div className="text-xs font-bold text-neon-purple mb-1">{AI_AV} 유저 인텔리전스 {adj.length}건</div>{adj.map((x,i)=><div key={i} className="text-xs flex gap-1.5"><span className={`font-bold ${x.direction<0?"text-red-400":"text-emerald-400"}`}>{x.direction<0?"▼":"▲"}{x.pct}%</span><span className="text-slate-400">{x.name||x.teamName}</span></div>)}</div>}
      </div>
    </div>}

    {can&&<div className="flex gap-2">
      <button onClick={r1} disabled={run} className="flex-1 btn-secondary text-white py-3 rounded-xl font-bold disabled:opacity-50">{run?"시뮬중...":"단일 경기"}</button>
      <button onClick={rN} disabled={run} className="flex-1 btn-primary text-white py-3 rounded-xl font-bold disabled:opacity-50">{run?"분석중...":`${sc.toLocaleString()}회 시뮬`}</button>
      <select value={sc} onChange={e=>setSc(Number(e.target.value))} className="dark-input rounded-xl px-3 text-sm">{[100,500,1000,5000,10000].map(n=><option key={n} value={n}>{n.toLocaleString()}회</option>)}</select>
    </div>}

    {mc&&<div className="glass-card-strong rounded-2xl p-5 animate-fadeIn">
      <div className="flex items-center justify-center gap-6 mb-4">{[a,h].reduce((acc,t,i)=>{const el=<div key={t.id} className="text-center"><div className="mb-1 flex justify-center"><TeamLogo src={t.logo} alt={t.short} size={56} /></div><div className="font-bold text-lg" style={{color:t.color}}>{t.name}</div></div>;return i===0?[el]:[...acc,<div key="vs" className="text-dark-400 text-2xl font-black glow-text">VS</div>,el];},[])}
      </div>{adj.length>0&&<div className="text-center text-xs text-neon-purple font-bold mb-3">{AI_AV} 유저 인텔리전스 {adj.length}건 반영</div>}
      <WPB hp={mc.homeWinPct} ap={mc.awayWinPct} h={h} a={a}/>
      <div className="grid grid-cols-4 gap-2 mt-5 text-center">{[{l:`${a.short} 승률`,v:mc.awayWinPct+"%",c:"#ec4899"},{l:`${h.short} 승률`,v:mc.homeWinPct+"%",c:"#3b82f6"},{l:"평균",v:`${mc.avgAway}-${mc.avgHome}`,c:"#94a3b8"},{l:"무승부",v:mc.draws,c:"#64748b"}].map((c,i)=><div key={i} className="glass-card rounded-xl p-3"><div className="text-xs text-slate-500">{c.l}</div><div className="text-xl font-black" style={{color:c.c}}>{c.v}</div></div>)}</div>
      <div className="mt-5"><div className="text-xs font-semibold text-slate-400 mb-2">총 득점 분포</div><div className="flex items-end gap-0.5 h-24">{Array.from({length:25},(_,i)=>{const ct=mc.totalScoreDist[i]||0,mx=Math.max(...Object.values(mc.totalScoreDist)),ht=mx>0?(ct/mx)*100:0;return<div key={i} className="flex-1 flex flex-col items-center"><div className="w-full rounded-t transition-all" style={{height:`${ht}%`,background:ct>0?"linear-gradient(180deg,#8b5cf6,#3b82f6)":"rgba(255,255,255,0.03)",minHeight:ct>0?"2px":0}} title={`${i}점: ${ct}회`}/>{i%3===0&&<span className="text-xs text-slate-600 mt-0.5">{i}</span>}</div>;})}</div></div>
    </div>}

    {sg&&<div className="glass-card-strong rounded-2xl p-5 animate-fadeIn">
      <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-slate-200">{mc?"샘플 경기":"경기 결과"}</h3>
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${sg.winner==="home"?"bg-accent-blue/20 text-blue-300 border border-accent-blue/30":sg.winner==="away"?"bg-pink-500/20 text-pink-300 border border-pink-500/30":"bg-dark-500 text-slate-400 border border-white/10"}`}>{sg.winner==="home"?`${h.short} 승`:sg.winner==="away"?`${a.short} 승`:"무승부"}</span></div>
      <Board result={sg} homeTeam={h} awayTeam={a}/>
      {(sg.homeRuns.home.length>0||sg.homeRuns.away.length>0)&&<div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-xs"><span className="font-bold text-amber-400">홈런</span><div className="mt-1 text-slate-400">{[...sg.homeRuns.away.map(x=>`${a.short} ${x.batter} (${x.inning}회)`),...sg.homeRuns.home.map(x=>`${h.short} ${x.batter} (${x.inning}회)`)].join(" / ")}</div></div>}
      <GLog log={sg.gameLog} h={h} a={a}/>
    </div>}
  </div>);
};

// ═══════════════════════════════════════════════════════
// 백테스트 탭
// ═══════════════════════════════════════════════════════

const BacktestTab = () => {
  const[running,setRunning]=useState(false);
  const[results,setResults]=useState(null);
  const[simCount,setSimCount]=useState(500);
  const[btSeason,setBtSeason]=useState(2025);

  const seasonResults = getSeasonResults(btSeason);

  const runBacktest=useCallback(async()=>{
    setRunning(true);
    await new Promise(r=>setTimeout(r,50));
    const details=[];
    let correct=0,total=0;
    const data = getSeasonResults(btSeason);
    for(const g of data){
      const home=getSeasonTeam(g.home, btSeason), away=getSeasonTeam(g.away, btSeason);
      if(!home||!away) continue;
      const hsi=home.starters.findIndex(s=>s.name===g.homeSP);
      const asi=away.starters.findIndex(s=>s.name===g.awaySP);
      const dow=new Date(g.date).getDay();
      const opts={dayOfWeek:dow, time:g.time};
      const sim=new Sim(home,away,home.stadium,g.weather||"cloudy",Math.max(0,hsi),Math.max(0,asi),opts);
      const mc=sim.mc(simCount);
      const predWinner=parseFloat(mc.homeWinPct)>=50?"home":"away";
      const actualWinner=g.homeScore>g.awayScore?"home":g.awayScore>g.homeScore?"away":"draw";
      const hit=predWinner===actualWinner;
      if(actualWinner!=="draw"){total++;if(hit)correct++;}
      details.push({
        date:g.date, home:home.short, away:away.short, homeColor:home.color, awayColor:away.color,
        homeSP:g.homeSP, awaySP:g.awaySP,
        actualScore:`${g.homeScore}-${g.awayScore}`, actualWinner,
        predHomePct:mc.homeWinPct, predAwayPct:mc.awayWinPct,
        predAvgScore:`${mc.avgAway}-${mc.avgHome}`,
        predWinner, hit,
      });
    }
    setResults({details,correct,total,accuracy:total>0?((correct/total)*100).toFixed(1):"0",season:btSeason});
    setRunning(false);
  },[simCount,btSeason]);

  return(<div className="space-y-4 animate-fadeIn">
    <div className="glass-card-strong rounded-2xl p-5">
      <h2 className="text-lg font-black text-white mb-2">백테스트 — {btSeason} 시즌 검증</h2>
      <p className="text-sm text-slate-500 mb-4">{btSeason} 시즌 실제 경기 결과와 시뮬레이션 예측을 비교하여 적중률을 검증합니다.<br/>시즌별 팀 데이터(선발·불펜·팀레이팅)가 자동 적용됩니다.</p>
      <div className="flex items-center gap-3 flex-wrap">
        <select value={btSeason} onChange={e=>{setBtSeason(Number(e.target.value));setResults(null);}} className="dark-input rounded-xl px-3 py-2 text-sm">
          <option value={2024}>2024 시즌</option>
          <option value={2025}>2025 시즌</option>
          <option value={2026}>2026 시즌</option>
        </select>
        <select value={simCount} onChange={e=>setSimCount(Number(e.target.value))} className="dark-input rounded-xl px-3 py-2 text-sm">
          {[100,300,500,1000,3000].map(n=><option key={n} value={n}>{n.toLocaleString()}회 시뮬/경기</option>)}
        </select>
        <button onClick={runBacktest} disabled={running} className="btn-primary px-6 py-2.5 rounded-xl font-bold text-white text-sm">
          {running?`분석중... (${seasonResults.length}경기)`:"백테스트 실행"}
        </button>
      </div>
    </div>

    {results&&<>
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card-strong rounded-2xl p-5 text-center">
          <div className="text-xs text-slate-500 mb-1">전체 적중률</div>
          <div className={`text-3xl font-black ${parseFloat(results.accuracy)>=55?"text-emerald-400":parseFloat(results.accuracy)>=50?"text-amber-400":"text-red-400"}`}>{results.accuracy}%</div>
          <div className="text-xs text-slate-500 mt-1">{results.correct}/{results.total} 경기</div>
        </div>
        <div className="glass-card-strong rounded-2xl p-5 text-center">
          <div className="text-xs text-slate-500 mb-1">분석 경기 수</div>
          <div className="text-3xl font-black text-neon-blue">{results.details.length}</div>
          <div className="text-xs text-slate-500 mt-1">{results.season} 시즌 샘플</div>
        </div>
        <div className="glass-card-strong rounded-2xl p-5 text-center">
          <div className="text-xs text-slate-500 mb-1">시뮬 횟수/경기</div>
          <div className="text-3xl font-black text-neon-purple">{simCount.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">몬테카를로</div>
        </div>
      </div>

      <div className="glass-card-strong rounded-2xl overflow-hidden">
        <table className="w-full text-sm dark-table">
          <thead><tr className="text-xs text-slate-400">
            <th className="p-2.5 text-left">날짜</th><th className="p-2.5">대진</th><th className="p-2.5">선발</th>
            <th className="p-2.5">예측 승률</th><th className="p-2.5">예측 스코어</th><th className="p-2.5">실제 결과</th><th className="p-2.5">적중</th>
          </tr></thead>
          <tbody>{results.details.map((r,i)=>(<tr key={i} className={r.hit?"":"opacity-70"}>
            <td className="p-2.5 text-slate-500">{r.date.slice(5)}</td>
            <td className="p-2.5 text-center"><span style={{color:r.awayColor}} className="font-bold">{r.away}</span><span className="text-slate-600 mx-1">@</span><span style={{color:r.homeColor}} className="font-bold">{r.home}</span></td>
            <td className="p-2.5 text-center text-slate-500">{r.awaySP} vs {r.homeSP}</td>
            <td className="p-2.5 text-center"><span className={`font-bold ${r.predWinner==="away"?"text-pink-400":"text-slate-500"}`}>{r.predAwayPct}%</span><span className="text-slate-700 mx-1">:</span><span className={`font-bold ${r.predWinner==="home"?"text-neon-blue":"text-slate-500"}`}>{r.predHomePct}%</span></td>
            <td className="p-2.5 text-center text-slate-400">{r.predAvgScore}</td>
            <td className="p-2.5 text-center font-bold text-slate-300">{r.actualScore} <span className={r.actualWinner==="home"?"text-neon-blue":"text-pink-400"}>{r.actualWinner==="home"?r.home:r.actualWinner==="away"?r.away:"무"}</span></td>
            <td className="p-2.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.actualWinner==="draw"?"text-slate-500":r.hit?"badge-hit":"badge-miss"}`}>{r.actualWinner==="draw"?"—":r.hit?"HIT":"MISS"}</span></td>
          </tr>))}</tbody>
        </table>
      </div>
    </>}
  </div>);
};

// ═══════════════════════════════════════════════════════
// 메인 앱
// ═══════════════════════════════════════════════════════

export default function KBOSimulation() {
  const[tab,setTab]=useState("virtual");
  return(<div className="min-h-screen bg-dark-950 bg-grid">
    <div className="bg-hero-gradient border-b border-white/5 py-6 px-4"><div className="max-w-6xl mx-auto flex items-center justify-between">
      <div><div className="flex items-center gap-3"><h1 className="text-2xl font-black tracking-tight text-white glow-text">KBO 경기 예측 시뮬레이터</h1><span className="px-2 py-0.5 rounded-full text-xs font-bold bg-accent-purple/20 text-neon-purple border border-accent-purple/30">v8.3</span></div><p className="text-slate-500 mt-1 text-xs">AI 분석 파트너 {AI_NM} · 투수피로도/지능형교체/도루전략 · 요일/시간대/배당/H2H · Statiz 2025</p></div>
      <div className="text-3xl animate-glow rounded-full p-2">{AI_AV}</div></div>
      <div className="max-w-6xl mx-auto mt-5 flex gap-0.5">
        {[{id:"virtual",label:"가상 대결",icon:"⚔️"},{id:"today",label:"오늘의 경기",icon:"📅"},{id:"backtest",label:"백테스트",icon:"📊"}].map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} className={`px-5 py-2.5 text-sm font-bold transition-all ${tab===t.id?"tab-active rounded-t-xl":"tab-inactive rounded-t-xl"}`}>{t.icon} {t.label}</button>))}
      </div>
    </div>
    <div className="max-w-6xl mx-auto p-4">{tab==="today"?<TodayTab/>:tab==="virtual"?<VirtualTab/>:<BacktestTab/>}
      <div className="text-center text-xs text-slate-600 py-8">KBO 경기 예측 시뮬레이터 v8.1 · {AI_NM} AI 분석 파트너 · Powered by Monte Carlo Simulation</div>
    </div>
  </div>);
}
