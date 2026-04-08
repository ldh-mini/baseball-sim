/**
 * KBO 시뮬레이션 v8.0 백테스트 러너
 * 2025 시즌 60경기 × 100회 시뮬레이션 → 예측 성공률 산출
 */
import _ from "lodash";

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
  sunny:  { label: "맑음", hitMod: 1.03, hrMod: 1.05, errMod: 0.98 },
  cloudy: { label: "흐림", hitMod: 1.00, hrMod: 1.00, errMod: 1.00 },
  rainy:  { label: "비",   hitMod: 0.95, hrMod: 0.93, errMod: 1.15 },
  cold:   { label: "추위", hitMod: 0.93, hrMod: 0.90, errMod: 1.08 },
  hot:    { label: "더위", hitMod: 1.05, hrMod: 1.08, errMod: 1.02 },
  windy:  { label: "강풍", hitMod: 1.02, hrMod: 1.12, errMod: 1.05 },
};

const DAY_OF_WEEK_MOD = {
  home: [0.97, 1.00, 1.01, 1.00, 1.02, 1.03, 1.04],
  away: [1.01, 1.00, 0.99, 1.00, 0.99, 0.98, 0.97],
};

const TIME_SLOT_MOD = {
  day:     { hitMod: 1.04, hrMod: 1.06, eraMod: 1.05 },
  evening: { hitMod: 1.01, hrMod: 1.02, eraMod: 1.01 },
  night:   { hitMod: 0.98, hrMod: 0.97, eraMod: 0.97 },
};
function getTimeSlot(t) { if (!t) return "night"; const h = parseInt(t.split(":")[0]); if (h < 16) return "day"; if (h < 18) return "evening"; return "night"; }

function getOddsMod(hr, ar) {
  const d = hr - ar, a = Math.abs(d);
  const ub = _.clamp(a * 0.003, 0, 0.05), fp = _.clamp(a * 0.002, 0, 0.03);
  if (d > 0) return { home: 1 - fp, away: 1 + ub };
  if (d < 0) return { home: 1 + ub, away: 1 - fp };
  return { home: 1, away: 1 };
}

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
function getH2HMod(hId, aId) {
  const wr = H2H_RECORDS[hId]?.[aId]; if (wr == null) return { home: 1, away: 1 };
  const dev = (wr - 0.5) * 0.15; return { home: 1 + dev, away: 1 - dev };
}

const MATCHUPS = {
  "후라도": { "최형우":{pa:45,avg:.178,hr:1}, "위즈덤":{pa:38,avg:.211,hr:3}, "김도영":{pa:32,avg:.250,hr:2}, "오스틴":{pa:28,avg:.214,hr:2}, "노시환":{pa:35,avg:.200,hr:2}, "송성문":{pa:30,avg:.233,hr:3} },
  "네일":   { "디아즈":{pa:40,avg:.225,hr:3}, "구자욱":{pa:35,avg:.286,hr:1}, "오스틴":{pa:30,avg:.267,hr:2}, "양의지":{pa:28,avg:.321,hr:2}, "노시환":{pa:32,avg:.188,hr:1}, "레이예스":{pa:25,avg:.280,hr:1} },
  "임찬규": { "디아즈":{pa:36,avg:.250,hr:3}, "최형우":{pa:30,avg:.300,hr:1}, "양의지":{pa:34,avg:.265,hr:1}, "노시환":{pa:28,avg:.214,hr:2}, "송성문":{pa:32,avg:.219,hr:2}, "안현민":{pa:26,avg:.308,hr:1} },
  "앤더슨": { "디아즈":{pa:32,avg:.188,hr:1}, "오스틴":{pa:28,avg:.179,hr:1}, "양의지":{pa:30,avg:.233,hr:1}, "송성문":{pa:35,avg:.200,hr:2}, "김도영":{pa:28,avg:.214,hr:1}, "노시환":{pa:30,avg:.167,hr:1} },
  "폰세":   { "디아즈":{pa:38,avg:.158,hr:1}, "오스틴":{pa:30,avg:.200,hr:1}, "구자욱":{pa:28,avg:.214,hr:0}, "양의지":{pa:32,avg:.188,hr:1}, "송성문":{pa:34,avg:.176,hr:1}, "김도영":{pa:26,avg:.231,hr:1} },
  "박영현": { "디아즈":{pa:30,avg:.267,hr:2}, "오스틴":{pa:26,avg:.231,hr:1}, "양의지":{pa:28,avg:.250,hr:1}, "송성문":{pa:32,avg:.219,hr:2}, "노시환":{pa:24,avg:.208,hr:1}, "레이예스":{pa:22,avg:.273,hr:1} },
  "라일리": { "디아즈":{pa:28,avg:.214,hr:2}, "오스틴":{pa:24,avg:.250,hr:1}, "양의지":{pa:30,avg:.233,hr:1}, "노시환":{pa:26,avg:.192,hr:1}, "송성문":{pa:30,avg:.200,hr:2}, "최정":{pa:28,avg:.250,hr:2} },
  "헤르난데스": { "디아즈":{pa:34,avg:.235,hr:2}, "오스틴":{pa:28,avg:.214,hr:1}, "양의지":{pa:32,avg:.250,hr:2}, "구자욱":{pa:26,avg:.269,hr:1}, "노시환":{pa:30,avg:.200,hr:1}, "김도영":{pa:24,avg:.292,hr:1} },
  "곽빈":   { "오스틴":{pa:26,avg:.231,hr:1}, "송성문":{pa:28,avg:.250,hr:2}, "노시환":{pa:24,avg:.208,hr:1}, "김도영":{pa:22,avg:.273,hr:1}, "디아즈":{pa:30,avg:.233,hr:2}, "안현민":{pa:20,avg:.300,hr:1} },
  "원태인": { "최형우":{pa:30,avg:.233,hr:1}, "오스틴":{pa:28,avg:.250,hr:2}, "양의지":{pa:26,avg:.269,hr:1}, "송성문":{pa:24,avg:.208,hr:1}, "노시환":{pa:28,avg:.214,hr:2}, "김도영":{pa:22,avg:.227,hr:0} },
};
function getMatchupMod(pN, bN) {
  const m = MATCHUPS[pN]?.[bN]; if (!m || m.pa < 15) return 1.0;
  const dev = (m.avg - 0.265) / 0.265; return 1 + _.clamp(dev * 0.15, -0.08, 0.08);
}

// ── v8.0: 고급 통계 함수 ──
function calcWOBA(b) {
  if (b.woba) return b.woba;
  return _.clamp(b.obp * 0.72 + (b.slg - b.avg) * 0.52 + b.avg * 0.21, .200, .500);
}
function calcFIP(p) {
  if (p.fip) return p.fip;
  const ip = p.ip || 150;
  const hr9 = (p.era / 9) * 0.25;
  return _.clamp(((13 * hr9 + 3 * (p.bb9 / 9) - 2 * (p.k9 / 9)) / 1) * 9 + 3.10, 1.5, 6.5);
}
function calcPythagorean(rs, ra) {
  if (rs <= 0 || ra <= 0) return 0.5;
  return rs ** 1.83 / (rs ** 1.83 + ra ** 1.83);
}
function calcElo(record) {
  if (!record || !record.w) return 1500;
  const winPct = record.w / (record.w + record.l);
  const pyth = calcPythagorean(record.rs || 0, record.ra || 0);
  const blended = winPct * 0.6 + pyth * 0.4;
  return Math.round(1500 + (blended - 0.5) * 400);
}
const LEAGUE_AVG = { avg: .265, obp: .340, slg: .410, era: 3.80, whip: 1.22, k9: 8.0, bb9: 2.8 };
function regressBatter(b) {
  const paEst = b.hr > 30 ? 600 : b.hr > 15 ? 500 : b.hr > 5 ? 400 : 300;
  const regFactor = Math.min(1, paEst / 500);
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

// ── 2025 시즌 팀 성적 (피타고리안/Elo 계산용) ──
const TEAM_RECORDS = {
  samsung:  { w: 74, l: 68, rs: 775, ra: 647 },
  kia:      { w: 65, l: 75, rs: 668, ra: 734 },
  lg:       { w: 85, l: 56, rs: 788, ra: 584 },
  doosan:   { w: 61, l: 77, rs: 647, ra: 686 },
  kt:       { w: 71, l: 68, rs: 648, ra: 657 },
  ssg:      { w: 75, l: 65, rs: 609, ra: 576 },
  hanwha:   { w: 83, l: 57, rs: 689, ra: 554 },
  lotte:    { w: 66, l: 72, rs: 676, ra: 749 },
  nc:       { w: 71, l: 67, rs: 732, ra: 766 },
  kiwoom:   { w: 47, l: 93, rs: 581, ra: 860 },
};

// ── KBO 10개 구단 (2025 시즌 Statiz/FancyStats 기반) ──
const KBO_TEAMS = {
  samsung: { id:"samsung", name:"삼성 라이온즈", short:"삼성", stadium:"daegu",
    lineup: [
      {name:"디아즈",pos:"DH",bat:"R",avg:.314,obp:.381,slg:.644,hr:50,spd:5,recentForm:1.15,war:8.41,defRAA:9.86,rbi:158},
      {name:"구자욱",pos:"LF",bat:"R",avg:.319,obp:.402,slg:.516,hr:19,spd:6,recentForm:1.08,war:6.80},
      {name:"김성윤",pos:"RF",bat:"R",avg:.331,obp:.419,slg:.474,hr:6,spd:7,recentForm:1.10,war:5.85,sb:26},
      {name:"김지찬",pos:"CF",bat:"R",avg:.275,obp:.340,slg:.380,hr:5,spd:9,recentForm:0.90},
      {name:"이재현",pos:"3B",bat:"R",avg:.280,obp:.335,slg:.400,hr:5,spd:5,recentForm:0.98},
      {name:"전병우",pos:"SS",bat:"R",avg:.272,obp:.338,slg:.408,hr:10,spd:5,recentForm:1.0},
      {name:"김호진",pos:"2B",bat:"R",avg:.265,obp:.325,slg:.378,hr:6,spd:6,recentForm:0.98},
      {name:"강민호",pos:"C",bat:"R",avg:.260,obp:.330,slg:.400,hr:10,spd:3,recentForm:0.95},
      {name:"김인태",pos:"1B",bat:"R",avg:.265,obp:.330,slg:.418,hr:12,spd:4,recentForm:0.95},
    ],
    starters:[{name:"후라도",throws:"R",era:2.57,whip:1.09,k9:9.7,bb9:2.0,ip:171.1,recentForm:1.18,war:7.57,wpaLI:3.48,fip:2.80},{name:"원태인",throws:"R",era:3.24,whip:1.10,k9:5.8,bb9:2.3,ip:166.2,recentForm:1.08,war:4.20},{name:"이승현",throws:"R",era:4.72,whip:1.35,k9:6.0,bb9:3.5,ip:90,recentForm:0.85,war:0.80}],
    bullpen:{era:3.85,whip:1.25,k9:8.2,bb9:3.0}, teamRating:84 },

  kia: { id:"kia", name:"기아 타이거즈", short:"기아", stadium:"gwangju",
    lineup: [
      {name:"최형우",pos:"DH",bat:"R",avg:.307,obp:.399,slg:.529,hr:24,spd:2,recentForm:1.08,war:6.78},
      {name:"위즈덤",pos:"3B",bat:"R",avg:.236,obp:.321,slg:.535,hr:35,spd:5,recentForm:1.08,war:3.50},
      {name:"나성범",pos:"RF",bat:"R",avg:.265,obp:.345,slg:.420,hr:12,spd:5,recentForm:0.85},
      {name:"김도영",pos:"SS",bat:"R",avg:.300,obp:.370,slg:.515,hr:7,spd:8,recentForm:0.88},
      {name:"김선빈",pos:"2B",bat:"R",avg:.290,obp:.340,slg:.370,hr:2,spd:7,recentForm:0.95},
      {name:"최원준",pos:"CF",bat:"R",avg:.280,obp:.340,slg:.420,hr:11,spd:8,recentForm:1.0},
      {name:"한승택",pos:"C",bat:"R",avg:.255,obp:.320,slg:.375,hr:7,spd:3,recentForm:0.95},
      {name:"박민",pos:"1B",bat:"R",avg:.268,obp:.335,slg:.418,hr:12,spd:4,recentForm:0.98},
      {name:"박찬호",pos:"LF",bat:"R",avg:.270,obp:.330,slg:.410,hr:10,spd:6,recentForm:0.97},
    ],
    starters:[{name:"네일",throws:"R",era:2.25,whip:1.05,k9:8.3,bb9:2.2,ip:164.1,recentForm:1.15,war:6.59,wpaLI:3.37,fip:3.08},{name:"올러",throws:"R",era:3.20,whip:1.12,k9:10.2,bb9:2.5,ip:149,recentForm:1.08,war:4.25,fip:2.97},{name:"이의리",throws:"R",era:7.94,whip:1.77,k9:9.5,bb9:7.0,ip:39.2,recentForm:0.70,war:0.20}],
    bullpen:{era:3.55,whip:1.20,k9:8.5,bb9:2.8}, teamRating:74 },

  lg: { id:"lg", name:"LG 트윈스", short:"LG", stadium:"jamsil",
    lineup: [
      {name:"오스틴",pos:"1B",bat:"R",avg:.313,obp:.393,slg:.595,hr:31,spd:4,recentForm:1.12,war:5.69},
      {name:"박해민",pos:"CF",bat:"L",avg:.276,obp:.379,slg:.346,hr:3,spd:9,recentForm:1.15,defRAA:11.90,sb:49,war:4.50},
      {name:"구본혁",pos:"2B",bat:"R",avg:.286,obp:.340,slg:.380,hr:5,spd:6,recentForm:1.05,defRAA:13.34,war:3.80},
      {name:"홍창기",pos:"RF",bat:"R",avg:.279,obp:.396,slg:.370,hr:1,spd:7,recentForm:0.85},
      {name:"김현수",pos:"LF",bat:"L",avg:.298,obp:.385,slg:.440,hr:12,spd:4,recentForm:1.0,war:3.20},
      {name:"박동원",pos:"C",bat:"R",avg:.253,obp:.340,slg:.455,hr:22,spd:3,recentForm:1.05,war:3.00},
      {name:"문보경",pos:"DH",bat:"R",avg:.276,obp:.371,slg:.460,hr:24,spd:4,recentForm:1.08,rbi:108,war:4.10},
      {name:"오지환",pos:"SS",bat:"R",avg:.253,obp:.314,slg:.430,hr:16,spd:5,recentForm:0.95,war:2.00},
      {name:"김민성",pos:"3B",bat:"R",avg:.262,obp:.325,slg:.400,hr:10,spd:5,recentForm:0.97},
    ],
    starters:[{name:"임찬규",throws:"L",era:3.03,whip:1.15,k9:6.7,bb9:2.5,ip:160.1,recentForm:1.08,war:4.50,fip:3.40},{name:"치리노스",throws:"R",era:3.31,whip:1.18,k9:7.0,bb9:2.2,ip:177,recentForm:1.05,war:5.03,wpaLI:3.08,fip:3.01},{name:"김윤식",throws:"L",era:3.80,whip:1.22,k9:7.8,bb9:2.8,ip:135,recentForm:1.0,war:2.50}],
    bullpen:{era:3.50,whip:1.18,k9:8.8,bb9:2.5}, teamRating:92 },

  doosan: { id:"doosan", name:"두산 베어스", short:"두산", stadium:"jamsil",
    lineup: [
      {name:"양의지",pos:"C",bat:"R",avg:.337,obp:.406,slg:.533,hr:20,spd:3,recentForm:1.18,war:7.06,defRAA:1.97},
      {name:"김재환",pos:"LF",bat:"L",avg:.282,obp:.350,slg:.488,hr:20,spd:3,recentForm:1.0,war:3.50},
      {name:"정수빈",pos:"CF",bat:"R",avg:.295,obp:.370,slg:.398,hr:5,spd:9,recentForm:1.0,war:2.50},
      {name:"허경민",pos:"2B",bat:"R",avg:.278,obp:.340,slg:.385,hr:6,spd:6,recentForm:0.98,war:2.00},
      {name:"강승호",pos:"3B",bat:"R",avg:.268,obp:.330,slg:.410,hr:11,spd:5,recentForm:0.95,defRAA:9.00,war:2.80},
      {name:"조수행",pos:"SS",bat:"R",avg:.255,obp:.315,slg:.375,hr:8,spd:6,recentForm:0.92},
      {name:"이유찬",pos:"RF",bat:"R",avg:.260,obp:.325,slg:.395,hr:9,spd:5,recentForm:0.93},
      {name:"김인태",pos:"1B",bat:"R",avg:.265,obp:.330,slg:.418,hr:12,spd:4,recentForm:0.95},
      {name:"로하스",pos:"DH",bat:"R",avg:.280,obp:.355,slg:.475,hr:18,spd:4,recentForm:1.0,war:2.50},
    ],
    starters:[{name:"잭로그",throws:"R",era:2.81,whip:1.12,k9:8.0,bb9:2.8,ip:176,recentForm:1.10,war:4.53,wpaLI:3.05,fip:3.20},{name:"곽빈",throws:"R",era:4.50,whip:1.30,k9:11.0,bb9:3.5,ip:85,recentForm:0.90,war:1.50},{name:"이영하",throws:"R",era:4.05,whip:1.53,k9:9.7,bb9:3.2,ip:66.2,recentForm:0.92,war:1.20}],
    bullpen:{era:3.90,whip:1.28,k9:8.0,bb9:3.0}, teamRating:72 },

  kt: { id:"kt", name:"KT 위즈", short:"KT", stadium:"suwon",
    lineup: [
      {name:"안현민",pos:"OF",bat:"R",avg:.334,obp:.448,slg:.570,hr:22,spd:6,recentForm:1.20,war:7.24,defRAA:1.36},
      {name:"강백호",pos:"1B",bat:"R",avg:.255,obp:.330,slg:.430,hr:7,spd:4,recentForm:0.88,war:1.50},
      {name:"황재균",pos:"3B",bat:"R",avg:.280,obp:.345,slg:.445,hr:14,spd:5,recentForm:1.0,war:2.50},
      {name:"배정대",pos:"CF",bat:"R",avg:.290,obp:.355,slg:.415,hr:8,spd:8,recentForm:1.0,war:2.80},
      {name:"장성우",pos:"LF",bat:"L",avg:.275,obp:.340,slg:.420,hr:11,spd:6,recentForm:0.98,war:2.20},
      {name:"심우준",pos:"SS",bat:"R",avg:.260,obp:.320,slg:.380,hr:7,spd:7,recentForm:0.97,war:1.80},
      {name:"권동진",pos:"C",bat:"R",avg:.255,obp:.315,slg:.375,hr:8,spd:3,recentForm:0.95},
      {name:"김상수",pos:"2B",bat:"R",avg:.268,obp:.335,slg:.378,hr:5,spd:6,recentForm:0.96},
      {name:"조용호",pos:"DH",bat:"R",avg:.262,obp:.325,slg:.395,hr:9,spd:5,recentForm:0.98},
    ],
    starters:[{name:"소형준",throws:"R",era:3.30,whip:1.15,k9:7.8,bb9:2.5,ip:155,recentForm:1.08,war:4.19,fip:2.94},{name:"헤이수스",throws:"R",era:3.96,whip:1.22,k9:9.4,bb9:2.8,ip:160,recentForm:1.0,war:3.20,fip:3.50},{name:"고영표",throws:"R",era:3.50,whip:1.18,k9:7.5,bb9:2.5,ip:150,recentForm:1.0,war:4.10,fip:3.16}],
    bullpen:{era:3.70,whip:1.22,k9:8.3,bb9:2.8}, teamRating:79 },

  ssg: { id:"ssg", name:"SSG 랜더스", short:"SSG", stadium:"incheon",
    lineup: [
      {name:"최정",pos:"3B",bat:"R",avg:.244,obp:.340,slg:.502,hr:23,spd:3,recentForm:1.0,war:3.50},
      {name:"에레디아",pos:"LF",bat:"R",avg:.334,obp:.398,slg:.491,hr:13,spd:5,recentForm:1.05,war:4.20},
      {name:"한유섭",pos:"CF",bat:"R",avg:.295,obp:.360,slg:.438,hr:10,spd:8,recentForm:1.0,war:3.00},
      {name:"정준재",pos:"SS",bat:"R",avg:.245,obp:.340,slg:.288,hr:2,spd:9,recentForm:0.95,sb:37,war:2.50},
      {name:"오태양",pos:"RF",bat:"R",avg:.265,obp:.325,slg:.405,hr:11,spd:5,recentForm:0.98},
      {name:"이재원",pos:"C",bat:"R",avg:.258,obp:.320,slg:.378,hr:8,spd:3,recentForm:0.95},
      {name:"정현석",pos:"2B",bat:"R",avg:.260,obp:.318,slg:.370,hr:5,spd:6,recentForm:0.96},
      {name:"윤동현",pos:"1B",bat:"R",avg:.270,obp:.335,slg:.428,hr:13,spd:4,recentForm:0.99},
      {name:"최지훈",pos:"DH",bat:"R",avg:.275,obp:.345,slg:.420,hr:10,spd:5,recentForm:1.0,war:2.00},
    ],
    starters:[{name:"앤더슨",throws:"R",era:2.25,whip:1.00,k9:12.8,bb9:2.0,ip:171.2,recentForm:1.20,war:6.54,fip:2.61},{name:"김광현",throws:"L",era:5.00,whip:1.30,k9:8.6,bb9:2.5,ip:144,recentForm:0.82,war:1.80},{name:"미치화이트",throws:"R",era:2.87,whip:1.10,k9:9.2,bb9:2.8,ip:155,recentForm:1.05,war:3.80,fip:3.44}],
    bullpen:{era:3.65,whip:1.22,k9:8.5,bb9:2.7}, teamRating:85 },

  hanwha: { id:"hanwha", name:"한화 이글스", short:"한화", stadium:"daejeon",
    lineup: [
      {name:"노시환",pos:"3B",bat:"R",avg:.260,obp:.354,slg:.497,hr:32,spd:4,recentForm:1.12,war:6.70},
      {name:"문현빈",pos:"CF",bat:"R",avg:.320,obp:.370,slg:.453,hr:12,spd:8,recentForm:1.05,war:4.00},
      {name:"채은성",pos:"1B",bat:"R",avg:.275,obp:.340,slg:.458,hr:17,spd:3,recentForm:0.95,war:2.50},
      {name:"황영묵",pos:"RF",bat:"R",avg:.270,obp:.332,slg:.405,hr:10,spd:6,recentForm:0.98},
      {name:"하주석",pos:"SS",bat:"R",avg:.265,obp:.325,slg:.378,hr:6,spd:7,recentForm:0.96},
      {name:"이도윤",pos:"LF",bat:"L",avg:.258,obp:.320,slg:.390,hr:8,spd:5,recentForm:0.95},
      {name:"송곤",pos:"C",bat:"R",avg:.250,obp:.310,slg:.365,hr:7,spd:3,recentForm:0.93},
      {name:"김인환",pos:"2B",bat:"R",avg:.260,obp:.318,slg:.375,hr:5,spd:6,recentForm:0.95},
      {name:"손아섭",pos:"DH",bat:"R",avg:.300,obp:.365,slg:.440,hr:8,spd:4,recentForm:1.0,war:2.50},
    ],
    starters:[{name:"폰세",throws:"R",era:1.89,whip:0.94,k9:12.6,bb9:1.5,ip:180.2,recentForm:1.28,war:8.38,wpaLI:5.04,fip:2.14},{name:"와이스",throws:"R",era:2.87,whip:1.02,k9:10.4,bb9:1.8,ip:178.2,recentForm:1.18,war:5.95,fip:3.24},{name:"류현진",throws:"L",era:3.65,whip:1.20,k9:7.0,bb9:2.2,ip:140,recentForm:0.95,war:2.80}],
    bullpen:{era:4.10,whip:1.30,k9:7.8,bb9:3.2}, teamRating:90 },

  lotte: { id:"lotte", name:"롯데 자이언츠", short:"롯데", stadium:"sajik",
    lineup: [
      {name:"레이예스",pos:"OF",bat:"R",avg:.326,obp:.386,slg:.475,hr:13,spd:5,recentForm:1.20,rbi:107,war:4.00},
      {name:"전준우",pos:"RF",bat:"R",avg:.293,obp:.369,slg:.420,hr:8,spd:5,recentForm:1.0,war:3.20},
      {name:"안치홍",pos:"2B",bat:"R",avg:.282,obp:.348,slg:.418,hr:10,spd:5,recentForm:0.99,war:2.50},
      {name:"윤동희",pos:"CF",bat:"R",avg:.275,obp:.340,slg:.410,hr:9,spd:8,recentForm:0.98,war:2.00},
      {name:"나승엽",pos:"1B",bat:"R",avg:.272,obp:.338,slg:.445,hr:15,spd:3,recentForm:0.98,war:2.50},
      {name:"황성빈",pos:"SS",bat:"R",avg:.260,obp:.320,slg:.368,hr:5,spd:7,recentForm:0.94},
      {name:"유강남",pos:"C",bat:"R",avg:.248,obp:.310,slg:.370,hr:8,spd:3,recentForm:0.93},
      {name:"손호영",pos:"LF",bat:"R",avg:.265,obp:.330,slg:.395,hr:8,spd:6,recentForm:0.97},
      {name:"박승욱",pos:"3B",bat:"R",avg:.258,obp:.320,slg:.385,hr:7,spd:5,recentForm:0.95},
    ],
    starters:[{name:"박세웅",throws:"R",era:4.93,whip:1.30,k9:8.7,bb9:3.0,ip:160.2,recentForm:0.90,war:2.50,fip:4.20},{name:"감보아",throws:"R",era:3.60,whip:1.20,k9:9.8,bb9:2.8,ip:155,recentForm:1.0,war:3.50,fip:3.30},{name:"나균안",throws:"R",era:4.30,whip:1.28,k9:7.5,bb9:3.0,ip:140,recentForm:0.95,war:1.80}],
    bullpen:{era:4.15,whip:1.30,k9:7.5,bb9:3.2}, teamRating:76 },

  nc: { id:"nc", name:"NC 다이노스", short:"NC", stadium:"changwon",
    lineup: [
      {name:"데이비슨",pos:"1B",bat:"R",avg:.293,obp:.346,slg:.619,hr:36,spd:4,recentForm:1.12,war:5.00},
      {name:"김주원",pos:"SS",bat:"R",avg:.289,obp:.379,slg:.451,hr:15,spd:9,recentForm:1.08,war:6.62,sb:44,defRAA:0.58},
      {name:"박건우",pos:"RF",bat:"R",avg:.292,obp:.368,slg:.445,hr:13,spd:5,recentForm:1.0,war:3.50},
      {name:"서호철",pos:"3B",bat:"R",avg:.278,obp:.345,slg:.425,hr:12,spd:5,recentForm:0.98,war:2.50},
      {name:"권희동",pos:"CF",bat:"R",avg:.275,obp:.340,slg:.415,hr:10,spd:8,recentForm:1.0,war:2.80},
      {name:"김태군",pos:"C",bat:"R",avg:.255,obp:.320,slg:.375,hr:7,spd:3,recentForm:0.95},
      {name:"김성욱",pos:"LF",bat:"L",avg:.262,obp:.325,slg:.390,hr:8,spd:6,recentForm:0.96},
      {name:"박민우",pos:"2B",bat:"R",avg:.268,obp:.335,slg:.378,hr:5,spd:7,recentForm:0.97},
      {name:"테일러",pos:"DH",bat:"R",avg:.275,obp:.345,slg:.460,hr:15,spd:5,recentForm:1.0,war:2.50},
    ],
    starters:[{name:"라일리",throws:"R",era:3.45,whip:1.15,k9:11.3,bb9:2.3,ip:172,recentForm:1.10,war:4.20,fip:3.01},{name:"테일러",throws:"R",era:3.80,whip:1.20,k9:8.5,bb9:2.5,ip:155,recentForm:1.0,war:3.00,fip:3.40},{name:"성재현",throws:"R",era:4.10,whip:1.28,k9:7.5,bb9:3.0,ip:142,recentForm:0.95,war:1.50}],
    bullpen:{era:3.85,whip:1.25,k9:8.0,bb9:3.0}, teamRating:80 },

  kiwoom: { id:"kiwoom", name:"키움 히어로즈", short:"키움", stadium:"gocheok",
    lineup: [
      {name:"송성문",pos:"3B",bat:"R",avg:.315,obp:.387,slg:.530,hr:26,spd:8,recentForm:1.25,war:8.76,sb:25},
      {name:"이주형",pos:"LF",bat:"R",avg:.270,obp:.338,slg:.418,hr:11,spd:6,recentForm:0.98,war:2.00},
      {name:"요키시",pos:"DH",bat:"R",avg:.280,obp:.350,slg:.480,hr:18,spd:4,recentForm:1.0,war:2.50},
      {name:"변상권",pos:"SS",bat:"L",avg:.260,obp:.325,slg:.395,hr:9,spd:5,recentForm:0.95,war:1.50},
      {name:"장진혁",pos:"1B",bat:"R",avg:.265,obp:.330,slg:.415,hr:12,spd:4,recentForm:0.97,war:1.80},
      {name:"김휘집",pos:"CF",bat:"R",avg:.265,obp:.335,slg:.380,hr:5,spd:8,recentForm:0.95},
      {name:"박동훈",pos:"C",bat:"R",avg:.248,obp:.310,slg:.368,hr:7,spd:3,recentForm:0.93},
      {name:"이준혁",pos:"RF",bat:"R",avg:.275,obp:.345,slg:.405,hr:10,spd:6,recentForm:0.96,war:1.50},
      {name:"김건웅",pos:"2B",bat:"R",avg:.255,obp:.318,slg:.370,hr:5,spd:6,recentForm:0.93},
    ],
    starters:[{name:"헤르난데스",throws:"R",era:3.50,whip:1.15,k9:9.0,bb9:2.5,ip:165,recentForm:1.0,war:3.50,fip:3.20},{name:"김인범",throws:"R",era:3.85,whip:1.24,k9:7.8,bb9:3.0,ip:120,recentForm:0.98,war:2.00},{name:"하영민",throws:"R",era:4.30,whip:1.30,k9:7.5,bb9:3.2,ip:130,recentForm:0.95,war:1.50}],
    bullpen:{era:4.50,whip:1.35,k9:7.8,bb9:3.2}, teamRating:55 },
};

// ── 백테스트용 2025 시즌 결과 ──
const SEASON_2025_RESULTS = [
  {date:"2025-03-22",home:"lg",away:"kia",homeScore:5,awayScore:3,homeSP:"임찬규",awaySP:"네일",weather:"cloudy",time:"14:00"},
  {date:"2025-03-22",home:"samsung",away:"hanwha",homeScore:2,awayScore:7,homeSP:"후라도",awaySP:"폰세",weather:"sunny",time:"14:00"},
  {date:"2025-03-22",home:"ssg",away:"doosan",homeScore:4,awayScore:1,homeSP:"앤더슨",awaySP:"곽빈",weather:"cloudy",time:"14:00"},
  {date:"2025-03-22",home:"kt",away:"lotte",homeScore:6,awayScore:2,homeSP:"박영현",awaySP:"박세웅",weather:"cloudy",time:"14:00"},
  {date:"2025-03-22",home:"nc",away:"kiwoom",homeScore:3,awayScore:1,homeSP:"라일리",awaySP:"헤르난데스",weather:"sunny",time:"14:00"},
  {date:"2025-03-23",home:"lg",away:"kia",homeScore:8,awayScore:4,homeSP:"치리노스",awaySP:"올러",weather:"sunny",time:"14:00"},
  {date:"2025-03-23",home:"samsung",away:"hanwha",homeScore:3,awayScore:5,homeSP:"원태인",awaySP:"와이스",weather:"sunny",time:"14:00"},
  {date:"2025-03-23",home:"ssg",away:"doosan",homeScore:6,awayScore:3,homeSP:"김광현",awaySP:"잭로그",weather:"cloudy",time:"14:00"},
  {date:"2025-03-23",home:"kt",away:"lotte",homeScore:4,awayScore:5,homeSP:"소형준",awaySP:"감보아",weather:"cloudy",time:"14:00"},
  {date:"2025-03-23",home:"nc",away:"kiwoom",homeScore:7,awayScore:2,homeSP:"테일러",awaySP:"김인범",weather:"sunny",time:"14:00"},
  {date:"2025-04-01",home:"hanwha",away:"lg",homeScore:4,awayScore:3,homeSP:"폰세",awaySP:"임찬규",weather:"cloudy",time:"18:30"},
  {date:"2025-04-01",home:"kia",away:"samsung",homeScore:6,awayScore:5,homeSP:"네일",awaySP:"후라도",weather:"sunny",time:"18:30"},
  {date:"2025-04-01",home:"doosan",away:"kt",homeScore:3,awayScore:4,homeSP:"곽빈",awaySP:"박영현",weather:"cloudy",time:"18:30"},
  {date:"2025-04-01",home:"kiwoom",away:"ssg",homeScore:2,awayScore:6,homeSP:"헤르난데스",awaySP:"앤더슨",weather:"cloudy",time:"18:30"},
  {date:"2025-04-01",home:"lotte",away:"nc",homeScore:5,awayScore:4,homeSP:"박세웅",awaySP:"라일리",weather:"sunny",time:"18:30"},
  {date:"2025-04-15",home:"lg",away:"samsung",homeScore:7,awayScore:2,homeSP:"임찬규",awaySP:"이승현",weather:"sunny",time:"18:30"},
  {date:"2025-04-15",home:"hanwha",away:"kia",homeScore:3,awayScore:1,homeSP:"폰세",awaySP:"이의리",weather:"cloudy",time:"18:30"},
  {date:"2025-04-15",home:"ssg",away:"nc",homeScore:5,awayScore:3,homeSP:"앤더슨",awaySP:"테일러",weather:"cloudy",time:"18:30"},
  {date:"2025-04-15",home:"kt",away:"kiwoom",homeScore:8,awayScore:1,homeSP:"박영현",awaySP:"김인범",weather:"sunny",time:"18:30"},
  {date:"2025-04-15",home:"doosan",away:"lotte",homeScore:4,awayScore:6,homeSP:"잭로그",awaySP:"박세웅",weather:"cloudy",time:"18:30"},
  {date:"2025-05-03",home:"samsung",away:"lg",homeScore:3,awayScore:8,homeSP:"후라도",awaySP:"치리노스",weather:"sunny",time:"14:00"},
  {date:"2025-05-03",home:"kia",away:"ssg",homeScore:2,awayScore:4,homeSP:"올러",awaySP:"앤더슨",weather:"sunny",time:"14:00"},
  {date:"2025-05-03",home:"hanwha",away:"doosan",homeScore:6,awayScore:1,homeSP:"와이스",awaySP:"이영하",weather:"hot",time:"14:00"},
  {date:"2025-05-03",home:"nc",away:"kt",homeScore:5,awayScore:3,homeSP:"라일리",awaySP:"소형준",weather:"sunny",time:"14:00"},
  {date:"2025-05-03",home:"lotte",away:"kiwoom",homeScore:7,awayScore:4,homeSP:"박세웅",awaySP:"헤르난데스",weather:"hot",time:"14:00"},
  {date:"2025-05-20",home:"lg",away:"doosan",homeScore:5,awayScore:2,homeSP:"김윤식",awaySP:"곽빈",weather:"sunny",time:"18:30"},
  {date:"2025-05-20",home:"samsung",away:"kiwoom",homeScore:9,awayScore:3,homeSP:"후라도",awaySP:"김인범",weather:"hot",time:"18:30"},
  {date:"2025-05-20",home:"ssg",away:"kia",homeScore:3,awayScore:2,homeSP:"미치화이트",awaySP:"네일",weather:"cloudy",time:"18:30"},
  {date:"2025-05-20",home:"hanwha",away:"nc",homeScore:4,awayScore:1,homeSP:"폰세",awaySP:"성재현",weather:"hot",time:"18:30"},
  {date:"2025-05-20",home:"kt",away:"lotte",homeScore:6,awayScore:5,homeSP:"박영현",awaySP:"감보아",weather:"sunny",time:"18:30"},
  {date:"2025-06-07",home:"lg",away:"hanwha",homeScore:4,awayScore:6,homeSP:"임찬규",awaySP:"폰세",weather:"hot",time:"17:00"},
  {date:"2025-06-07",home:"samsung",away:"nc",homeScore:5,awayScore:3,homeSP:"원태인",awaySP:"라일리",weather:"hot",time:"17:00"},
  {date:"2025-06-07",home:"kia",away:"doosan",homeScore:7,awayScore:4,homeSP:"네일",awaySP:"잭로그",weather:"hot",time:"17:00"},
  {date:"2025-06-07",home:"ssg",away:"lotte",homeScore:3,awayScore:1,homeSP:"앤더슨",awaySP:"나균안",weather:"cloudy",time:"17:00"},
  {date:"2025-06-07",home:"kiwoom",away:"kt",homeScore:2,awayScore:5,homeSP:"헤르난데스",awaySP:"고영표",weather:"cloudy",time:"17:00"},
  {date:"2025-06-21",home:"hanwha",away:"samsung",homeScore:8,awayScore:2,homeSP:"폰세",awaySP:"이승현",weather:"hot",time:"18:30"},
  {date:"2025-06-21",home:"lg",away:"kiwoom",homeScore:6,awayScore:1,homeSP:"치리노스",awaySP:"김인범",weather:"hot",time:"18:30"},
  {date:"2025-06-21",home:"kia",away:"kt",homeScore:4,awayScore:3,homeSP:"올러",awaySP:"소형준",weather:"hot",time:"18:30"},
  {date:"2025-06-21",home:"doosan",away:"ssg",homeScore:2,awayScore:5,homeSP:"곽빈",awaySP:"앤더슨",weather:"hot",time:"18:30"},
  {date:"2025-06-21",home:"nc",away:"lotte",homeScore:3,awayScore:4,homeSP:"테일러",awaySP:"박세웅",weather:"sunny",time:"18:30"},
  {date:"2025-07-12",home:"lg",away:"ssg",homeScore:4,awayScore:2,homeSP:"임찬규",awaySP:"김광현",weather:"rainy",time:"18:30"},
  {date:"2025-07-12",home:"samsung",away:"kia",homeScore:6,awayScore:5,homeSP:"후라도",awaySP:"이의리",weather:"rainy",time:"18:30"},
  {date:"2025-07-12",home:"hanwha",away:"kt",homeScore:7,awayScore:3,homeSP:"와이스",awaySP:"고영표",weather:"rainy",time:"18:30"},
  {date:"2025-07-12",home:"doosan",away:"nc",homeScore:4,awayScore:6,homeSP:"잭로그",awaySP:"라일리",weather:"cloudy",time:"18:30"},
  {date:"2025-07-12",home:"lotte",away:"kiwoom",homeScore:5,awayScore:2,homeSP:"박세웅",awaySP:"김인범",weather:"rainy",time:"18:30"},
  {date:"2025-08-09",home:"lg",away:"nc",homeScore:3,awayScore:1,homeSP:"치리노스",awaySP:"성재현",weather:"hot",time:"18:30"},
  {date:"2025-08-09",home:"hanwha",away:"lotte",homeScore:5,awayScore:0,homeSP:"폰세",awaySP:"나균안",weather:"hot",time:"18:30"},
  {date:"2025-08-09",home:"samsung",away:"doosan",homeScore:7,awayScore:4,homeSP:"후라도",awaySP:"이영하",weather:"hot",time:"18:30"},
  {date:"2025-08-09",home:"ssg",away:"kt",homeScore:4,awayScore:3,homeSP:"앤더슨",awaySP:"소형준",weather:"hot",time:"18:30"},
  {date:"2025-08-09",home:"kia",away:"kiwoom",homeScore:8,awayScore:2,homeSP:"네일",awaySP:"헤르난데스",weather:"hot",time:"18:30"},
  {date:"2025-09-06",home:"lg",away:"lotte",homeScore:6,awayScore:2,homeSP:"임찬규",awaySP:"감보아",weather:"sunny",time:"18:30"},
  {date:"2025-09-06",home:"hanwha",away:"kiwoom",homeScore:9,awayScore:1,homeSP:"폰세",awaySP:"김인범",weather:"sunny",time:"18:30"},
  {date:"2025-09-06",home:"samsung",away:"kt",homeScore:4,awayScore:5,homeSP:"원태인",awaySP:"박영현",weather:"sunny",time:"18:30"},
  {date:"2025-09-06",home:"ssg",away:"kia",homeScore:3,awayScore:4,homeSP:"미치화이트",awaySP:"올러",weather:"cloudy",time:"18:30"},
  {date:"2025-09-06",home:"doosan",away:"nc",homeScore:5,awayScore:3,homeSP:"잭로그",awaySP:"테일러",weather:"sunny",time:"18:30"},
  {date:"2025-09-27",home:"lg",away:"kt",homeScore:7,awayScore:3,homeSP:"치리노스",awaySP:"고영표",weather:"cloudy",time:"14:00"},
  {date:"2025-09-27",home:"hanwha",away:"doosan",homeScore:4,awayScore:2,homeSP:"와이스",awaySP:"이영하",weather:"sunny",time:"14:00"},
  {date:"2025-09-27",home:"samsung",away:"ssg",homeScore:3,awayScore:5,homeSP:"이승현",awaySP:"앤더슨",weather:"cloudy",time:"14:00"},
  {date:"2025-09-27",home:"kia",away:"nc",homeScore:5,awayScore:4,homeSP:"네일",awaySP:"라일리",weather:"sunny",time:"14:00"},
  {date:"2025-09-27",home:"lotte",away:"kiwoom",homeScore:6,awayScore:3,homeSP:"박세웅",awaySP:"김인범",weather:"cloudy",time:"14:00"},
];

// ── 시뮬레이션 엔진 (v7.0) ──

function getPitcherFatigue(ip, ra, ha) {
  let f = 0;
  if (ip <= 3) f = ip * 0.02;
  else if (ip <= 6) f = 0.06 + (ip - 3) * 0.04;
  else f = 0.18 + (ip - 6) * 0.08;
  f += ra * 0.015 + ha * 0.008;
  return _.clamp(f, 0, 0.45);
}

function shouldChangePitcher(p, ip, ra, ha, diff) {
  const ftg = getPitcherFatigue(ip, ra, ha);
  const ace = (p.war > 5 || p.wpaLI > 3) ? 1 : 0;
  if (ip >= 3 && ra / ip < 0.5 && ip < 8 + ace) return false;
  if (ip >= 2 && ra / ip > 1.5) return true;
  const th = 0.20 + ace * 0.05;
  if (ftg >= th) return true;
  if (ip >= 6 + ace) return Math.random() < 0.3 + ftg;
  if (ip >= 5 && diff <= -4) return true;
  return false;
}

class Sim {
  constructor(h,a,sid,w,hsi=0,asi=0,opts={}) {
    this.h=_.cloneDeep(h); this.a=_.cloneDeep(a); this.st=STADIUMS[sid]; this.w=WEATHER_EFFECTS[w];
    // v8.0: 평균 회귀 적용
    this.h.lineup = this.h.lineup.map(regressBatter);
    this.a.lineup = this.a.lineup.map(regressBatter);
    this.hP = regressPitcher(this.h.starters[hsi]);
    this.aP = regressPitcher(this.a.starters[asi]);
    // v8.0: wOBA/FIP 사전 계산
    this.h.lineup.forEach(b => { b.woba = calcWOBA(b); });
    this.a.lineup.forEach(b => { b.woba = calcWOBA(b); });
    this.hP.fip = calcFIP(this.hP); this.aP.fip = calcFIP(this.aP);
    // v8.0: 피타고리안 + Elo
    const hRec = TEAM_RECORDS[h.id]; const aRec = TEAM_RECORDS[a.id];
    this.hElo = calcElo(hRec); this.aElo = calcElo(aRec);
    const eloDiff = this.hElo - this.aElo;
    this.eloMod = { home: 1 + _.clamp(eloDiff * 0.0004, -0.06, 0.06), away: 1 - _.clamp(eloDiff * 0.0004, -0.06, 0.06) };
    this.hDefRAA=this.h.lineup.reduce((s,b)=>s+(b.defRAA||0),0);
    this.aDefRAA=this.a.lineup.reduce((s,b)=>s+(b.defRAA||0),0);
    const dayIdx=opts.dayOfWeek??new Date().getDay();
    const jsDayToKr=[6,0,1,2,3,4,5];
    this.dayIdx=jsDayToKr[dayIdx]??0;
    this.timeMod=TIME_SLOT_MOD[getTimeSlot(opts.time)]||TIME_SLOT_MOD.night;
    this.oddsMod=getOddsMod(h.teamRating,a.teamRating);
    this.h2hMod=getH2HMod(h.id,a.id);
  }
  platoon(b,p){ const bt=b.bat||"R",pt=p.throws||"R"; if(bt==="S")return 1.01; if(bt!==pt)return 1.04; return 0.96; }
  warBonus(b){ const w=b.war||0; if(w<=0)return 1.0; return 1+Math.min(0.06,w*0.007); }
  pitcherWar(p){ const w=p.wpaLI||0; if(w<=0)return 1.0; return 1+Math.min(0.08,w*0.015); }
  defFactor(isH){ const dr=isH?this.hDefRAA:this.aDefRAA; return 1-_.clamp(dr*0.001,-.03,.05); }
  prob(b,p,isH,ftg=0){
    const pf=this.st.parkFactor,wH=this.st.dome?1+(this.w.hitMod-1)*.2:this.w.hitMod,wR=this.st.dome?1+(this.w.hrMod-1)*.2:this.w.hrMod,hA=isH?1.04:1;
    const bF=b.recentForm||1.0,plt=this.platoon(b,p),wB=this.warBonus(b),pW=this.pitcherWar(p);
    const dayMod=DAY_OF_WEEK_MOD[isH?"home":"away"][this.dayIdx];
    const tHit=this.timeMod.hitMod,tHr=this.timeMod.hrMod;
    const oddF=isH?this.oddsMod.home:this.oddsMod.away;
    const h2hF=isH?this.h2hMod.home:this.h2hMod.away;
    const muMod=getMatchupMod(p.name,b.name);
    // v8.0: Elo 기반 팀 전력 보정 추가
    const eloF = isH ? this.eloMod.home : this.eloMod.away;
    const envMod=dayMod*oddF*h2hF*muMod*eloF;
    const fatigueHitBoost=1+ftg*0.8, fatigueKDrop=1-ftg*0.5, fatigueBBBoost=1+ftg*0.6;
    // v8.0: FIP 기반 투수력 (ERA 대신)
    const fip = p.fip || calcFIP(p);
    const pF=_.clamp((4.5-fip)/4.5+.5,.7,1.3)*(p.recentForm||1.0)*pW*(2-this.timeMod.eraMod);
    const pK=p.k9/9*fatigueKDrop, pB=p.bb9/9*fatigueBBBoost;
    const dF=this.defFactor(!isH);
    // v8.0: wOBA 기반 타자력
    const woba = b.woba || calcWOBA(b);
    const wobaFactor = woba / 0.340;
    const so=Math.min(.35,pK*(1-b.obp/.5)*.8*(2-plt)),bb=Math.min(.18,pB*(b.obp/.34)*.7*plt),hbp=.008;
    const hit=Math.max(.05,(wobaFactor*0.32*hA*wH*tHit*bF*plt*wB*envMod*fatigueHitBoost/pF-bb-hbp)*.88*dF),iso=b.slg-b.avg;
    const hr=Math.min(.08,(b.hr/550)*pf*wR*tHr*hA*bF*plt*wB*envMod*fatigueHitBoost/pF),t3=Math.min(.008,.003*(b.spd/5)),d2=Math.min(.08,iso*.25*pf*wH*tHit*plt*dF),s1=Math.max(.05,hit-hr-t3-d2);
    const errMod=this.defFactor(isH); const err=Math.max(.003,.015*this.w.errMod*errMod);
    const rem=Math.max(0,1-hit-bb-so-hbp-err);
    return{strikeout:so,walk:bb,hitByPitch:hbp,single:s1,double:d2,triple:t3,homerun:hr,groundOut:rem*.473,flyOut:rem*.368,lineOut:rem*.158,error:err};
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
  game(){
    const sc={home:0,away:0}; let hi=0,ai=0;
    let hP=this.hP,aP=this.aP;
    const ps={home:{ip:0,ra:0,ha:0,isBullpen:false},away:{ip:0,ra:0,ha:0,isBullpen:false}};
    for(let inn=1;inn<=12;inn++){
      if(!ps.home.isBullpen&&inn>=2){ if(shouldChangePitcher(hP,ps.home.ip,ps.home.ra,ps.home.ha,sc.home-sc.away)){hP=this.h.bullpen;ps.home.isBullpen=true;ps.home.ip=0;ps.home.ra=0;ps.home.ha=0;} }
      if(!ps.away.isBullpen&&inn>=2){ if(shouldChangePitcher(aP,ps.away.ip,ps.away.ra,ps.away.ha,sc.away-sc.home)){aP=this.a.bullpen;ps.away.isBullpen=true;ps.away.ip=0;ps.away.ra=0;ps.away.ha=0;} }
      const hFtg=ps.home.isBullpen?0:getPitcherFatigue(ps.home.ip,ps.home.ra,ps.home.ha);
      const aFtg=ps.away.isBullpen?0:getPitcherFatigue(ps.away.ip,ps.away.ra,ps.away.ha);
      let outs=0,bs=[null,null,null],ir=0;
      while(outs<3){const b=this.a.lineup[ai%9],o=this.ab(b,hP,false,hFtg),r=this.adv(bs,o,outs,b);if(["single","double","triple","homerun"].includes(o))ps.home.ha++;ir+=r.rs;outs+=r.o;ai++;}
      sc.away+=ir;ps.home.ra+=ir;ps.home.ip++;
      if(!ps.home.isBullpen&&ir>=3){hP=this.h.bullpen;ps.home.isBullpen=true;ps.home.ip=0;ps.home.ra=0;ps.home.ha=0;}
      if(inn>=9&&sc.home>sc.away)break;
      outs=0;bs=[null,null,null];ir=0;
      while(outs<3){const b=this.h.lineup[hi%9],o=this.ab(b,aP,true,aFtg),r=this.adv(bs,o,outs,b);if(["single","double","triple","homerun"].includes(o))ps.away.ha++;ir+=r.rs;outs+=r.o;hi++;if(inn>=9&&sc.home+ir>sc.away)break;}
      sc.home+=ir;ps.away.ra+=ir;ps.away.ip++;
      if(!ps.away.isBullpen&&ir>=3){aP=this.a.bullpen;ps.away.isBullpen=true;ps.away.ip=0;ps.away.ra=0;ps.away.ha=0;}
      if(inn>=9&&sc.home!==sc.away)break;
    }
    return{score:sc,winner:sc.home>sc.away?"home":sc.away>sc.home?"away":"draw"};
  }
  mc(n=100){ let hw=0,aw=0; const hs=[],as=[];
    for(let i=0;i<n;i++){const r=this.game();if(r.winner==="home")hw++;else if(r.winner==="away")aw++;hs.push(r.score.home);as.push(r.score.away);}
    return{homeWins:hw,awayWins:aw,homeWinPct:((hw/n)*100).toFixed(1),awayWinPct:((aw/n)*100).toFixed(1),avgHome:_.mean(hs).toFixed(1),avgAway:_.mean(as).toFixed(1)};
  }
}

// ═══════════════════════════════════════════════════════
// 백테스트 실행
// ═══════════════════════════════════════════════════════

const SIM_COUNT = 100;

console.log("═══════════════════════════════════════════════════════════");
console.log("  KBO 시뮬레이션 v8.0 백테스트 — 2025 시즌 60경기 × 100회");
console.log("═══════════════════════════════════════════════════════════\n");

let correct = 0, total = 0;
const teamStats = {};
const monthStats = {};
const details = [];

for (const g of SEASON_2025_RESULTS) {
  const home = KBO_TEAMS[g.home], away = KBO_TEAMS[g.away];
  if (!home || !away) continue;
  const hsi = home.starters.findIndex(s => s.name === g.homeSP);
  const asi = away.starters.findIndex(s => s.name === g.awaySP);
  const dow = new Date(g.date).getDay();
  const opts = { dayOfWeek: dow, time: g.time };
  const sim = new Sim(home, away, home.stadium, g.weather || "cloudy", Math.max(0, hsi), Math.max(0, asi), opts);
  const mc = sim.mc(SIM_COUNT);

  const predWinner = parseFloat(mc.homeWinPct) >= 50 ? "home" : "away";
  const actualWinner = g.homeScore > g.awayScore ? "home" : g.awayScore > g.homeScore ? "away" : "draw";
  const hit = predWinner === actualWinner;
  const confidence = Math.max(parseFloat(mc.homeWinPct), parseFloat(mc.awayWinPct));

  if (actualWinner !== "draw") { total++; if (hit) correct++; }

  // 팀별 통계
  for (const tid of [g.home, g.away]) {
    if (!teamStats[tid]) teamStats[tid] = { correct: 0, total: 0, name: KBO_TEAMS[tid].short };
    if (actualWinner !== "draw") { teamStats[tid].total++; if (hit) teamStats[tid].correct++; }
  }

  // 월별 통계
  const month = g.date.slice(0, 7);
  if (!monthStats[month]) monthStats[month] = { correct: 0, total: 0 };
  if (actualWinner !== "draw") { monthStats[month].total++; if (hit) monthStats[month].correct++; }

  details.push({
    date: g.date, home: home.short, away: away.short,
    homeSP: g.homeSP, awaySP: g.awaySP,
    predHome: mc.homeWinPct, predAway: mc.awayWinPct,
    predScore: `${mc.avgAway}-${mc.avgHome}`,
    actual: `${g.awayScore}-${g.homeScore}`,
    actualWinner, predWinner, hit, confidence,
  });
}

// ── 경기별 상세 결과 ──
console.log("날짜        | 대진              | 선발              | 예측 승률        | 예측스코어 | 실제결과   | 적중");
console.log("─".repeat(110));
for (const d of details) {
  const matchup = `${d.away} @ ${d.home}`.padEnd(14);
  const pitchers = `${d.awaySP} vs ${d.homeSP}`.padEnd(16);
  const pred = `${d.predAway}% : ${d.predHome}%`.padEnd(16);
  const mark = d.actualWinner === "draw" ? "➖" : d.hit ? "✅" : "❌";
  console.log(`${d.date} | ${matchup} | ${pitchers} | ${pred} | ${d.predScore.padEnd(9)}  | ${d.actual.padEnd(9)}  | ${mark}`);
}

// ── 종합 결과 ──
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  종합 결과");
console.log("═══════════════════════════════════════════════════════════\n");
const acc = ((correct / total) * 100).toFixed(1);
console.log(`  전체 적중률: ${acc}% (${correct}/${total} 경기)`);
console.log(`  분석 경기: ${SEASON_2025_RESULTS.length}경기 × ${SIM_COUNT}회 시뮬레이션\n`);

// ── 월별 적중률 ──
console.log("  [월별 적중률]");
for (const [month, s] of Object.entries(monthStats).sort()) {
  const pct = s.total > 0 ? ((s.correct / s.total) * 100).toFixed(1) : "N/A";
  const bar = "█".repeat(Math.round(parseFloat(pct) / 5));
  console.log(`    ${month}: ${pct}% (${s.correct}/${s.total}) ${bar}`);
}

// ── 팀별 적중률 ──
console.log("\n  [팀별 적중률]");
const sortedTeams = Object.entries(teamStats).sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total));
for (const [, s] of sortedTeams) {
  const pct = s.total > 0 ? ((s.correct / s.total) * 100).toFixed(1) : "N/A";
  const bar = "█".repeat(Math.round(parseFloat(pct) / 5));
  console.log(`    ${s.name.padEnd(4)}: ${pct}% (${s.correct}/${s.total}) ${bar}`);
}

// ── 신뢰도별 적중률 ──
console.log("\n  [예측 신뢰도별 적중률]");
const highConf = details.filter(d => d.confidence >= 60 && d.actualWinner !== "draw");
const midConf = details.filter(d => d.confidence >= 50 && d.confidence < 60 && d.actualWinner !== "draw");
const hc = highConf.filter(d => d.hit).length;
const mc2 = midConf.filter(d => d.hit).length;
console.log(`    고신뢰(60%+): ${highConf.length > 0 ? ((hc / highConf.length) * 100).toFixed(1) : "N/A"}% (${hc}/${highConf.length}경기)`);
console.log(`    중신뢰(50-59%): ${midConf.length > 0 ? ((mc2 / midConf.length) * 100).toFixed(1) : "N/A"}% (${mc2}/${midConf.length}경기)`);

console.log("\n═══════════════════════════════════════════════════════════");
