/**
 * KBO 시뮬레이션 v7.0 백테스트 — 2024 시즌
 * 2024 시즌 팀/선수 데이터 + 실제 경기 결과 60경기 × 100회 시뮬레이션
 */
import _ from "lodash";

// ── 구장 데이터 ──
const STADIUMS = {
  sajik:    { name: "사직야구장", parkFactor: 1.08 },
  gocheok:  { name: "고척스카이돔", parkFactor: 0.92, dome: true },
  jamsil:   { name: "잠실야구장", parkFactor: 0.90 },
  incheon:  { name: "인천SSG랜더스필드", parkFactor: 1.08 },
  suwon:    { name: "수원KT위즈파크", parkFactor: 1.05 },
  daegu:    { name: "대구삼성라이온즈파크", parkFactor: 1.12 },
  gwangju:  { name: "광주기아챔피언스필드", parkFactor: 1.06 },
  daejeon:  { name: "한화생명이글스파크", parkFactor: 1.04 },
  changwon: { name: "창원NC파크", parkFactor: 0.98 },
};

const WEATHER_EFFECTS = {
  sunny:  { hitMod: 1.03, hrMod: 1.05, errMod: 0.98 },
  cloudy: { hitMod: 1.00, hrMod: 1.00, errMod: 1.00 },
  rainy:  { hitMod: 0.95, hrMod: 0.93, errMod: 1.15 },
  cold:   { hitMod: 0.93, hrMod: 0.90, errMod: 1.08 },
  hot:    { hitMod: 1.05, hrMod: 1.08, errMod: 1.02 },
  windy:  { hitMod: 1.02, hrMod: 1.12, errMod: 1.05 },
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

// ── 2024 시즌 팀 상대전적 (H2H) ──
const H2H_RECORDS = {
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
function getH2HMod(hId, aId) {
  const wr = H2H_RECORDS[hId]?.[aId]; if (wr == null) return { home: 1, away: 1 };
  const dev = (wr - 0.5) * 0.15; return { home: 1 + dev, away: 1 - dev };
}

// ── 2024 시즌 주요 투수-타자 매치업 ──
const MATCHUPS = {
  "양현종": { "오스틴":{pa:40,avg:.225,hr:2}, "디아즈":{pa:32,avg:.188,hr:1}, "양의지":{pa:45,avg:.267,hr:2}, "최정":{pa:38,avg:.237,hr:2}, "노시환":{pa:30,avg:.200,hr:1} },
  "네일":   { "오스틴":{pa:30,avg:.267,hr:2}, "디아즈":{pa:35,avg:.200,hr:1}, "양의지":{pa:28,avg:.286,hr:1}, "추신수":{pa:25,avg:.240,hr:1}, "노시환":{pa:28,avg:.214,hr:1} },
  "원태인": { "최형우":{pa:35,avg:.229,hr:1}, "오스틴":{pa:30,avg:.233,hr:2}, "양의지":{pa:28,avg:.250,hr:1}, "김도영":{pa:25,avg:.280,hr:1}, "노시환":{pa:30,avg:.200,hr:1} },
  "임찬규": { "디아즈":{pa:32,avg:.250,hr:2}, "최형우":{pa:28,avg:.286,hr:1}, "양의지":{pa:30,avg:.267,hr:1}, "김도영":{pa:25,avg:.320,hr:2}, "노시환":{pa:26,avg:.231,hr:1} },
  "앤더슨": { "오스틴":{pa:28,avg:.179,hr:1}, "디아즈":{pa:30,avg:.200,hr:1}, "양의지":{pa:26,avg:.231,hr:1}, "김도영":{pa:22,avg:.227,hr:1}, "노시환":{pa:28,avg:.179,hr:1} },
  "문동주": { "오스틴":{pa:25,avg:.280,hr:2}, "디아즈":{pa:28,avg:.214,hr:1}, "양의지":{pa:22,avg:.273,hr:1}, "김도영":{pa:20,avg:.300,hr:1}, "노시환":{pa:24,avg:.208,hr:1} },
  "쿠에바스":{ "오스틴":{pa:30,avg:.233,hr:1}, "디아즈":{pa:26,avg:.231,hr:2}, "양의지":{pa:28,avg:.250,hr:1}, "김도영":{pa:22,avg:.273,hr:1}, "최정":{pa:25,avg:.240,hr:1} },
  "엔스":   { "디아즈":{pa:28,avg:.214,hr:1}, "오스틴":{pa:25,avg:.240,hr:1}, "양의지":{pa:24,avg:.250,hr:1}, "김도영":{pa:20,avg:.250,hr:1}, "최정":{pa:22,avg:.227,hr:1} },
};
function getMatchupMod(pN, bN) {
  const m = MATCHUPS[pN]?.[bN]; if (!m || m.pa < 15) return 1.0;
  const dev = (m.avg - 0.265) / 0.265; return 1 + _.clamp(dev * 0.15, -0.08, 0.08);
}

// ══════════════════════════════════════════════════════════
// 2024 시즌 KBO 10개 구단 데이터
// (2024 시즌 기준 Statiz 참고)
// ══════════════════════════════════════════════════════════

const KBO_TEAMS = {
  kia: { id:"kia", name:"기아 타이거즈", short:"기아", stadium:"gwangju",
    lineup: [
      {name:"김도영",pos:"SS",bat:"R",avg:.340,obp:.408,slg:.575,hr:38,spd:9,recentForm:1.25,war:8.2,defRAA:5.2},
      {name:"나성범",pos:"RF",bat:"R",avg:.293,obp:.375,slg:.485,hr:18,spd:5,recentForm:1.05},
      {name:"소크라테스",pos:"LF",bat:"R",avg:.305,obp:.382,slg:.520,hr:22,spd:5,recentForm:1.08},
      {name:"최형우",pos:"DH",bat:"R",avg:.278,obp:.372,slg:.435,hr:12,spd:2,recentForm:0.98},
      {name:"최원준",pos:"CF",bat:"R",avg:.287,obp:.348,slg:.430,hr:13,spd:8,recentForm:1.02},
      {name:"김선빈",pos:"2B",bat:"R",avg:.295,obp:.345,slg:.375,hr:2,spd:7,recentForm:1.0},
      {name:"윤도현",pos:"1B",bat:"R",avg:.268,obp:.330,slg:.420,hr:11,spd:4,recentForm:0.98},
      {name:"한승택",pos:"C",bat:"R",avg:.252,obp:.315,slg:.368,hr:6,spd:3,recentForm:0.95},
      {name:"박찬호",pos:"3B",bat:"R",avg:.258,obp:.320,slg:.385,hr:8,spd:5,recentForm:0.96},
    ],
    starters:[
      {name:"양현종",throws:"L",era:2.98,whip:1.12,k9:7.8,bb9:2.2,ip:172,recentForm:1.08,war:5.5,wpaLI:3.2},
      {name:"네일",throws:"R",era:3.15,whip:1.08,k9:9.2,bb9:2.0,ip:168,recentForm:1.10,war:5.8,wpaLI:3.0},
      {name:"이의리",throws:"R",era:3.72,whip:1.22,k9:8.2,bb9:2.8,ip:148,recentForm:1.0}
    ],
    bullpen:{era:3.40,whip:1.18,k9:8.5,bb9:2.6}, teamRating:92 },

  samsung: { id:"samsung", name:"삼성 라이온즈", short:"삼성", stadium:"daegu",
    lineup: [
      {name:"디아즈",pos:"DH",bat:"R",avg:.308,obp:.370,slg:.610,hr:42,spd:5,recentForm:1.12,war:5.2},
      {name:"구자욱",pos:"LF",bat:"R",avg:.312,obp:.395,slg:.495,hr:16,spd:6,recentForm:1.05},
      {name:"김성윤",pos:"RF",bat:"R",avg:.322,obp:.408,slg:.480,hr:12,spd:7,recentForm:1.08},
      {name:"김지찬",pos:"CF",bat:"R",avg:.283,obp:.348,slg:.388,hr:6,spd:9,recentForm:1.02},
      {name:"강민호",pos:"C",bat:"R",avg:.275,obp:.342,slg:.430,hr:13,spd:3,recentForm:1.0},
      {name:"전병우",pos:"SS",bat:"R",avg:.265,obp:.328,slg:.395,hr:8,spd:5,recentForm:0.98},
      {name:"김호진",pos:"2B",bat:"R",avg:.258,obp:.318,slg:.370,hr:5,spd:6,recentForm:0.96},
      {name:"이재현",pos:"3B",bat:"R",avg:.252,obp:.310,slg:.378,hr:7,spd:5,recentForm:0.94},
      {name:"맥키넌",pos:"1B",bat:"R",avg:.288,obp:.358,slg:.495,hr:20,spd:4,recentForm:1.05},
    ],
    starters:[
      {name:"원태인",throws:"R",era:3.10,whip:1.12,k9:8.5,bb9:2.2,ip:175,recentForm:1.08,war:5.5},
      {name:"사이드",throws:"R",era:3.45,whip:1.18,k9:8.0,bb9:2.5,ip:160,recentForm:1.02},
      {name:"이승현",throws:"R",era:3.82,whip:1.25,k9:7.5,bb9:2.8,ip:148,recentForm:0.98}
    ],
    bullpen:{era:3.75,whip:1.22,k9:8.0,bb9:2.8}, teamRating:85 },

  lg: { id:"lg", name:"LG 트윈스", short:"LG", stadium:"jamsil",
    lineup: [
      {name:"오스틴",pos:"1B",bat:"R",avg:.305,obp:.388,slg:.580,hr:28,spd:4,recentForm:1.10,war:5.0},
      {name:"박해민",pos:"CF",bat:"L",avg:.280,obp:.358,slg:.395,hr:5,spd:9,recentForm:1.12,defRAA:10.5,sb:42},
      {name:"홍창기",pos:"RF",bat:"R",avg:.298,obp:.378,slg:.435,hr:9,spd:8,recentForm:1.05},
      {name:"김현수",pos:"LF",bat:"L",avg:.290,obp:.385,slg:.432,hr:10,spd:4,recentForm:1.0},
      {name:"구본혁",pos:"2B",bat:"R",avg:.265,obp:.335,slg:.375,hr:4,spd:6,recentForm:1.02,defRAA:11.0},
      {name:"박동원",pos:"C",bat:"R",avg:.270,obp:.338,slg:.418,hr:12,spd:3,recentForm:0.98},
      {name:"문보경",pos:"DH",bat:"R",avg:.288,obp:.358,slg:.475,hr:18,spd:4,recentForm:1.05},
      {name:"오지환",pos:"SS",bat:"R",avg:.255,obp:.330,slg:.398,hr:12,spd:5,recentForm:0.96},
      {name:"김민성",pos:"3B",bat:"R",avg:.258,obp:.320,slg:.392,hr:9,spd:5,recentForm:0.95},
    ],
    starters:[
      {name:"임찬규",throws:"L",era:3.05,whip:1.15,k9:9.0,bb9:2.5,ip:168,recentForm:1.05,war:4.8},
      {name:"엔스",throws:"L",era:3.28,whip:1.12,k9:8.2,bb9:2.0,ip:172,recentForm:1.08,war:5.2,wpaLI:3.1},
      {name:"김윤식",throws:"L",era:3.85,whip:1.25,k9:7.5,bb9:3.0,ip:142,recentForm:0.95}
    ],
    bullpen:{era:3.55,whip:1.20,k9:8.5,bb9:2.5}, teamRating:85 },

  doosan: { id:"doosan", name:"두산 베어스", short:"두산", stadium:"jamsil",
    lineup: [
      {name:"양의지",pos:"C",bat:"R",avg:.325,obp:.398,slg:.520,hr:18,spd:3,recentForm:1.15,war:5.8,defRAA:2.0},
      {name:"호세",pos:"DH",bat:"R",avg:.298,obp:.368,slg:.502,hr:20,spd:4,recentForm:1.02},
      {name:"김재환",pos:"LF",bat:"L",avg:.278,obp:.345,slg:.480,hr:18,spd:3,recentForm:0.98},
      {name:"정수빈",pos:"CF",bat:"R",avg:.288,obp:.362,slg:.392,hr:4,spd:9,recentForm:1.0},
      {name:"허경민",pos:"2B",bat:"R",avg:.272,obp:.335,slg:.378,hr:5,spd:6,recentForm:0.97},
      {name:"강승호",pos:"3B",bat:"R",avg:.262,obp:.325,slg:.405,hr:10,spd:5,recentForm:0.95},
      {name:"조수행",pos:"SS",bat:"R",avg:.250,obp:.310,slg:.368,hr:7,spd:6,recentForm:0.92},
      {name:"이유찬",pos:"RF",bat:"R",avg:.255,obp:.320,slg:.388,hr:8,spd:5,recentForm:0.93},
      {name:"김인태",pos:"1B",bat:"R",avg:.260,obp:.325,slg:.412,hr:11,spd:4,recentForm:0.95},
    ],
    starters:[
      {name:"곽빈",throws:"R",era:3.35,whip:1.15,k9:8.2,bb9:2.3,ip:170,recentForm:1.02,war:4.5},
      {name:"쿠에바스",throws:"R",era:3.52,whip:1.18,k9:8.0,bb9:2.5,ip:162,recentForm:1.0,wpaLI:2.8},
      {name:"이영하",throws:"R",era:4.05,whip:1.28,k9:7.5,bb9:3.0,ip:148,recentForm:0.95}
    ],
    bullpen:{era:3.85,whip:1.25,k9:8.0,bb9:2.8}, teamRating:82 },

  ssg: { id:"ssg", name:"SSG 랜더스", short:"SSG", stadium:"incheon",
    lineup: [
      {name:"추신수",pos:"DH",bat:"L",avg:.270,obp:.375,slg:.438,hr:14,spd:4,recentForm:0.98},
      {name:"최정",pos:"3B",bat:"R",avg:.265,obp:.365,slg:.482,hr:20,spd:3,recentForm:1.02},
      {name:"한유섭",pos:"CF",bat:"R",avg:.288,obp:.352,slg:.428,hr:9,spd:8,recentForm:1.0},
      {name:"에레디아",pos:"LF",bat:"R",avg:.302,obp:.368,slg:.498,hr:18,spd:5,recentForm:1.03},
      {name:"정준재",pos:"SS",bat:"R",avg:.268,obp:.332,slg:.382,hr:7,spd:9,recentForm:1.02,sb:32},
      {name:"오태양",pos:"RF",bat:"R",avg:.260,obp:.320,slg:.398,hr:10,spd:5,recentForm:0.97},
      {name:"이재원",pos:"C",bat:"R",avg:.252,obp:.315,slg:.370,hr:7,spd:3,recentForm:0.95},
      {name:"정현석",pos:"2B",bat:"R",avg:.255,obp:.312,slg:.365,hr:4,spd:6,recentForm:0.94},
      {name:"윤동현",pos:"1B",bat:"R",avg:.265,obp:.330,slg:.422,hr:12,spd:4,recentForm:0.98},
    ],
    starters:[
      {name:"앤더슨",throws:"R",era:2.48,whip:1.02,k9:11.0,bb9:2.0,ip:182,recentForm:1.18,war:6.2,wpaLI:3.5},
      {name:"김광현",throws:"L",era:3.78,whip:1.18,k9:8.2,bb9:2.2,ip:165,recentForm:0.92},
      {name:"문동주",throws:"R",era:3.15,whip:1.10,k9:9.5,bb9:2.3,ip:155,recentForm:1.08,war:4.5}
    ],
    bullpen:{era:3.70,whip:1.22,k9:8.5,bb9:2.7}, teamRating:80 },

  kt: { id:"kt", name:"KT 위즈", short:"KT", stadium:"suwon",
    lineup: [
      {name:"강백호",pos:"1B",bat:"R",avg:.278,obp:.365,slg:.478,hr:18,spd:4,recentForm:1.0},
      {name:"황재균",pos:"3B",bat:"R",avg:.275,obp:.340,slg:.438,hr:13,spd:5,recentForm:0.98},
      {name:"배정대",pos:"CF",bat:"R",avg:.285,obp:.348,slg:.408,hr:7,spd:8,recentForm:1.0},
      {name:"멜렌데즈",pos:"DH",bat:"R",avg:.295,obp:.362,slg:.510,hr:22,spd:4,recentForm:1.05},
      {name:"장성우",pos:"LF",bat:"L",avg:.270,obp:.335,slg:.415,hr:10,spd:6,recentForm:0.97},
      {name:"심우준",pos:"SS",bat:"R",avg:.255,obp:.315,slg:.375,hr:6,spd:7,recentForm:0.96},
      {name:"권동진",pos:"C",bat:"R",avg:.250,obp:.310,slg:.368,hr:7,spd:3,recentForm:0.94},
      {name:"김상수",pos:"2B",bat:"R",avg:.262,obp:.328,slg:.372,hr:4,spd:6,recentForm:0.95},
      {name:"조용호",pos:"RF",bat:"R",avg:.258,obp:.320,slg:.390,hr:8,spd:5,recentForm:0.96},
    ],
    starters:[
      {name:"쿠에바스",throws:"R",era:3.42,whip:1.16,k9:8.5,bb9:2.3,ip:170,recentForm:1.02},
      {name:"소형준",throws:"R",era:3.80,whip:1.24,k9:7.5,bb9:2.8,ip:152,recentForm:0.98},
      {name:"벤자민",throws:"R",era:3.95,whip:1.26,k9:7.8,bb9:3.0,ip:145,recentForm:0.97}
    ],
    bullpen:{era:3.80,whip:1.25,k9:8.0,bb9:2.8}, teamRating:76 },

  lotte: { id:"lotte", name:"롯데 자이언츠", short:"롯데", stadium:"sajik",
    lineup: [
      {name:"레이예스",pos:"OF",bat:"R",avg:.318,obp:.378,slg:.462,hr:12,spd:5,recentForm:1.15},
      {name:"전준우",pos:"RF",bat:"R",avg:.285,obp:.352,slg:.452,hr:15,spd:5,recentForm:0.98},
      {name:"안치홍",pos:"2B",bat:"R",avg:.278,obp:.342,slg:.412,hr:9,spd:5,recentForm:0.97},
      {name:"윤동희",pos:"CF",bat:"R",avg:.270,obp:.335,slg:.402,hr:8,spd:8,recentForm:0.96},
      {name:"한현희",pos:"LF",bat:"L",avg:.262,obp:.325,slg:.398,hr:10,spd:5,recentForm:0.95},
      {name:"나승엽",pos:"1B",bat:"R",avg:.268,obp:.332,slg:.438,hr:14,spd:3,recentForm:0.97},
      {name:"김원중",pos:"3B",bat:"R",avg:.250,obp:.310,slg:.372,hr:7,spd:5,recentForm:0.93},
      {name:"황성빈",pos:"SS",bat:"R",avg:.255,obp:.315,slg:.362,hr:4,spd:7,recentForm:0.92},
      {name:"유강남",pos:"C",bat:"R",avg:.245,obp:.305,slg:.365,hr:7,spd:3,recentForm:0.92},
    ],
    starters:[
      {name:"박세웅",throws:"R",era:3.62,whip:1.20,k9:8.0,bb9:2.5,ip:165,recentForm:1.0},
      {name:"레예스",throws:"R",era:3.85,whip:1.25,k9:7.5,bb9:2.8,ip:155,recentForm:0.97},
      {name:"한현희",throws:"R",era:4.28,whip:1.32,k9:7.0,bb9:3.2,ip:138,recentForm:0.93}
    ],
    bullpen:{era:4.20,whip:1.30,k9:7.5,bb9:3.2}, teamRating:73 },

  hanwha: { id:"hanwha", name:"한화 이글스", short:"한화", stadium:"daejeon",
    lineup: [
      {name:"노시환",pos:"3B",bat:"R",avg:.255,obp:.345,slg:.478,hr:28,spd:4,recentForm:1.08},
      {name:"페라자",pos:"DH",bat:"R",avg:.290,obp:.358,slg:.498,hr:20,spd:5,recentForm:1.05},
      {name:"문현빈",pos:"CF",bat:"R",avg:.278,obp:.340,slg:.408,hr:8,spd:8,recentForm:0.98},
      {name:"채은성",pos:"1B",bat:"R",avg:.270,obp:.335,slg:.448,hr:15,spd:3,recentForm:0.98},
      {name:"황영묵",pos:"RF",bat:"R",avg:.265,obp:.328,slg:.398,hr:9,spd:6,recentForm:0.96},
      {name:"하주석",pos:"SS",bat:"R",avg:.260,obp:.320,slg:.372,hr:5,spd:7,recentForm:0.95},
      {name:"이도윤",pos:"LF",bat:"L",avg:.252,obp:.315,slg:.382,hr:7,spd:5,recentForm:0.93},
      {name:"송곤",pos:"C",bat:"R",avg:.245,obp:.305,slg:.358,hr:6,spd:3,recentForm:0.92},
      {name:"김인환",pos:"2B",bat:"R",avg:.255,obp:.312,slg:.368,hr:4,spd:6,recentForm:0.94},
    ],
    starters:[
      {name:"류현진",throws:"L",era:3.92,whip:1.22,k9:7.2,bb9:2.0,ip:145,recentForm:0.88},
      {name:"한승혁",throws:"R",era:4.15,whip:1.28,k9:7.8,bb9:3.0,ip:152,recentForm:0.95},
      {name:"쿠엘라",throws:"L",era:4.32,whip:1.30,k9:8.0,bb9:3.2,ip:140,recentForm:0.93}
    ],
    bullpen:{era:4.25,whip:1.32,k9:7.5,bb9:3.3}, teamRating:70 },

  nc: { id:"nc", name:"NC 다이노스", short:"NC", stadium:"changwon",
    lineup: [
      {name:"박건우",pos:"RF",bat:"R",avg:.285,obp:.360,slg:.435,hr:12,spd:5,recentForm:0.98},
      {name:"손아섭",pos:"DH",bat:"R",avg:.278,obp:.348,slg:.425,hr:13,spd:4,recentForm:0.97},
      {name:"박민우",pos:"2B",bat:"R",avg:.272,obp:.340,slg:.382,hr:5,spd:7,recentForm:0.98},
      {name:"서호철",pos:"3B",bat:"R",avg:.270,obp:.338,slg:.418,hr:11,spd:5,recentForm:0.96},
      {name:"권희동",pos:"CF",bat:"R",avg:.268,obp:.332,slg:.408,hr:9,spd:8,recentForm:0.97},
      {name:"김주원",pos:"SS",bat:"R",avg:.282,obp:.362,slg:.432,hr:12,spd:9,recentForm:1.05,war:4.8,sb:38},
      {name:"테일러",pos:"LF",bat:"R",avg:.278,obp:.345,slg:.468,hr:16,spd:5,recentForm:1.0},
      {name:"김태군",pos:"C",bat:"R",avg:.248,obp:.312,slg:.368,hr:6,spd:3,recentForm:0.93},
      {name:"박정우",pos:"1B",bat:"R",avg:.258,obp:.322,slg:.398,hr:10,spd:4,recentForm:0.94},
    ],
    starters:[
      {name:"루친스키",throws:"R",era:3.55,whip:1.18,k9:8.2,bb9:2.3,ip:168,recentForm:1.0},
      {name:"성재현",throws:"R",era:4.15,whip:1.28,k9:7.5,bb9:3.0,ip:145,recentForm:0.95},
      {name:"송명기",throws:"L",era:4.38,whip:1.32,k9:7.2,bb9:3.2,ip:135,recentForm:0.92}
    ],
    bullpen:{era:4.00,whip:1.28,k9:7.8,bb9:3.0}, teamRating:68 },

  kiwoom: { id:"kiwoom", name:"키움 히어로즈", short:"키움", stadium:"gocheok",
    lineup: [
      {name:"송성문",pos:"3B",bat:"R",avg:.298,obp:.378,slg:.525,hr:30,spd:8,recentForm:1.18,war:7.0},
      {name:"요키시",pos:"DH",bat:"R",avg:.290,obp:.362,slg:.508,hr:20,spd:4,recentForm:1.0},
      {name:"이주형",pos:"LF",bat:"R",avg:.265,obp:.332,slg:.410,hr:10,spd:6,recentForm:0.96},
      {name:"김혜성",pos:"2B",bat:"R",avg:.295,obp:.365,slg:.392,hr:3,spd:9,recentForm:1.0,sb:35},
      {name:"변상권",pos:"SS",bat:"L",avg:.255,obp:.320,slg:.388,hr:8,spd:5,recentForm:0.94},
      {name:"장진혁",pos:"1B",bat:"R",avg:.260,obp:.325,slg:.408,hr:11,spd:4,recentForm:0.95},
      {name:"이원석",pos:"CF",bat:"R",avg:.252,obp:.315,slg:.378,hr:7,spd:7,recentForm:0.93},
      {name:"박동훈",pos:"C",bat:"R",avg:.242,obp:.305,slg:.362,hr:6,spd:3,recentForm:0.91},
      {name:"최주환",pos:"RF",bat:"R",avg:.258,obp:.322,slg:.395,hr:9,spd:5,recentForm:0.94},
    ],
    starters:[
      {name:"안우진",throws:"L",era:3.25,whip:1.10,k9:10.0,bb9:2.5,ip:170,recentForm:0.95,war:4.5},
      {name:"주니어",throws:"R",era:3.65,whip:1.20,k9:8.2,bb9:2.8,ip:158,recentForm:0.98},
      {name:"김인범",throws:"R",era:4.02,whip:1.28,k9:7.5,bb9:3.0,ip:142,recentForm:0.95}
    ],
    bullpen:{era:4.05,whip:1.28,k9:8.0,bb9:3.0}, teamRating:63 },
};

// ══════════════════════════════════════════════════════════
// 2024 시즌 실제 경기 결과 60경기
// ══════════════════════════════════════════════════════════

const SEASON_2024_RESULTS = [
  // 3월 개막 (3/23~24)
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
  // 4월
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
  // 5월
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
  // 6월
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
  // 7월
  {date:"2024-07-13",home:"kia",away:"ssg",homeScore:5,awayScore:3,homeSP:"양현종",awaySP:"김광현",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"lg",away:"samsung",homeScore:4,awayScore:5,homeSP:"엔스",awaySP:"사이드",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"doosan",away:"lotte",homeScore:6,awayScore:3,homeSP:"곽빈",awaySP:"레예스",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"hanwha",away:"kiwoom",homeScore:5,awayScore:4,homeSP:"류현진",awaySP:"주니어",weather:"rainy",time:"18:30"},
  {date:"2024-07-13",home:"nc",away:"kt",homeScore:3,awayScore:4,homeSP:"성재현",awaySP:"소형준",weather:"cloudy",time:"18:30"},
  // 8월
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
  // 9월
  {date:"2024-09-07",home:"kia",away:"lotte",homeScore:9,awayScore:2,homeSP:"네일",awaySP:"레예스",weather:"sunny",time:"18:30"},
  {date:"2024-09-07",home:"samsung",away:"nc",homeScore:5,awayScore:1,homeSP:"원태인",awaySP:"성재현",weather:"sunny",time:"18:30"},
  {date:"2024-09-07",home:"lg",away:"ssg",homeScore:3,awayScore:4,homeSP:"김윤식",awaySP:"앤더슨",weather:"cloudy",time:"18:30"},
  {date:"2024-09-07",home:"doosan",away:"kt",homeScore:6,awayScore:5,homeSP:"쿠에바스",awaySP:"소형준",weather:"sunny",time:"18:30"},
  {date:"2024-09-07",home:"hanwha",away:"kiwoom",homeScore:7,awayScore:3,homeSP:"류현진",awaySP:"주니어",weather:"sunny",time:"18:30"},
];

// ═══════════════════════════════════════════════════════
// 시뮬레이션 엔진 (v7.0 동일)
// ═══════════════════════════════════════════════════════

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
  if (ftg >= 0.20 + ace * 0.05) return true;
  if (ip >= 6 + ace) return Math.random() < 0.3 + ftg;
  if (ip >= 5 && diff <= -4) return true;
  return false;
}

class Sim {
  constructor(h,a,sid,w,hsi=0,asi=0,opts={}) {
    this.h=_.cloneDeep(h);this.a=_.cloneDeep(a);this.st=STADIUMS[sid];this.w=WEATHER_EFFECTS[w];
    this.hP=this.h.starters[hsi];this.aP=this.a.starters[asi];
    this.hDefRAA=this.h.lineup.reduce((s,b)=>s+(b.defRAA||0),0);
    this.aDefRAA=this.a.lineup.reduce((s,b)=>s+(b.defRAA||0),0);
    const dayIdx=opts.dayOfWeek??new Date().getDay();
    const m=[6,0,1,2,3,4,5];this.dayIdx=m[dayIdx]??0;
    this.timeMod=TIME_SLOT_MOD[getTimeSlot(opts.time)]||TIME_SLOT_MOD.night;
    this.oddsMod=getOddsMod(h.teamRating,a.teamRating);
    this.h2hMod=getH2HMod(h.id,a.id);
  }
  platoon(b,p){const bt=b.bat||"R",pt=p.throws||"R";if(bt==="S")return 1.01;if(bt!==pt)return 1.04;return 0.96;}
  warBonus(b){const w=b.war||0;if(w<=0)return 1.0;return 1+Math.min(0.06,w*0.007);}
  pitcherWar(p){const w=p.wpaLI||0;if(w<=0)return 1.0;return 1+Math.min(0.08,w*0.015);}
  defFactor(isH){const dr=isH?this.hDefRAA:this.aDefRAA;return 1-_.clamp(dr*0.001,-.03,.05);}
  prob(b,p,isH,ftg=0){
    const pf=this.st.parkFactor,wH=this.st.dome?1+(this.w.hitMod-1)*.2:this.w.hitMod,wR=this.st.dome?1+(this.w.hrMod-1)*.2:this.w.hrMod,hA=isH?1.04:1;
    const bF=b.recentForm||1.0,plt=this.platoon(b,p),wB=this.warBonus(b),pW=this.pitcherWar(p);
    const dayMod=DAY_OF_WEEK_MOD[isH?"home":"away"][this.dayIdx];
    const tHit=this.timeMod.hitMod,tHr=this.timeMod.hrMod;
    const oddF=isH?this.oddsMod.home:this.oddsMod.away;
    const h2hF=isH?this.h2hMod.home:this.h2hMod.away;
    const muMod=getMatchupMod(p.name,b.name);
    const envMod=dayMod*oddF*h2hF*muMod;
    const fhb=1+ftg*0.8,fkd=1-ftg*0.5,fbb=1+ftg*0.6;
    const pF=_.clamp((4.5-p.era)/4.5+.5,.7,1.3)*(p.recentForm||1.0)*pW*(2-this.timeMod.eraMod);
    const pK=p.k9/9*fkd,pB=p.bb9/9*fbb;
    const dF=this.defFactor(!isH);
    const so=Math.min(.35,pK*(1-b.obp/.5)*.8*(2-plt)),bb=Math.min(.18,pB*(b.obp/.34)*.7*plt),hbp=.008;
    const hit=Math.max(.05,(b.obp*hA*wH*tHit*bF*plt*wB*envMod*fhb/pF-bb-hbp)*.88*dF),iso=b.slg-b.avg;
    const hr=Math.min(.08,(b.hr/550)*pf*wR*tHr*hA*bF*plt*wB*envMod*fhb/pF),t3=Math.min(.008,.003*(b.spd/5)),d2=Math.min(.08,iso*.25*pf*wH*tHit*plt*dF),s1=Math.max(.05,hit-hr-t3-d2);
    const errMod=this.defFactor(isH);const err=Math.max(.003,.015*this.w.errMod*errMod);
    const rem=Math.max(0,1-hit-bb-so-hbp-err);
    return{strikeout:so,walk:bb,hitByPitch:hbp,single:s1,double:d2,triple:t3,homerun:hr,groundOut:rem*.473,flyOut:rem*.368,lineOut:rem*.158,error:err};
  }
  ab(b,p,isH,ftg=0){const pr=this.prob(b,p,isH,ftg);let r=Math.random(),c=0;for(const[t,v]of Object.entries(pr)){c+=v;if(r<c)return t;}return"groundOut";}
  adv(bs,o,outs,b){let rs=0;const sp=b.spd||5;
    switch(o){case"homerun":rs=bs.filter(Boolean).length+1;bs[0]=bs[1]=bs[2]=null;break;case"triple":rs+=bs.filter(Boolean).length;bs[0]=bs[1]=null;bs[2]=b.name;break;
    case"double":if(bs[2]){rs++;bs[2]=null;}if(bs[1]){rs++;bs[1]=null;}if(bs[0]){bs[2]=bs[0];bs[0]=null;}bs[1]=b.name;break;
    case"single":if(bs[2]){rs++;bs[2]=null;}if(bs[1]){if(sp>=6||Math.random()>.5)bs[2]=bs[1];else rs++;bs[1]=null;}if(bs[0]){bs[1]=bs[0];bs[0]=null;}bs[0]=b.name;break;
    case"walk":case"hitByPitch":if(bs[0]&&bs[1]&&bs[2])rs++;if(bs[0]&&bs[1])bs[2]=bs[1];if(bs[0])bs[1]=bs[0];bs[0]=b.name;break;
    case"groundOut":if(bs[0]&&outs<2&&Math.random()<.4){bs[0]=null;if(bs[2]&&Math.random()<.3){rs++;bs[2]=null;}return{rs,o:2};}if(bs[2]&&outs<2&&Math.random()<.45){rs++;bs[2]=null;}if(bs[1]&&!bs[2]){bs[2]=bs[1];bs[1]=null;}return{rs,o:1};
    case"flyOut":if(bs[2]&&outs<2&&Math.random()<.55){rs++;bs[2]=null;}return{rs,o:1};
    case"error":if(bs[2]){rs++;bs[2]=null;}if(bs[1]){bs[2]=bs[1];bs[1]=null;}if(bs[0])bs[1]=bs[0];bs[0]=b.name;break;
    default:return{rs,o:1};}return{rs,o:0};
  }
  game(){
    const sc={home:0,away:0};let hi=0,ai=0;let hP=this.hP,aP=this.aP;
    const ps={home:{ip:0,ra:0,ha:0,isBullpen:false},away:{ip:0,ra:0,ha:0,isBullpen:false}};
    for(let inn=1;inn<=12;inn++){
      if(!ps.home.isBullpen&&inn>=2){if(shouldChangePitcher(hP,ps.home.ip,ps.home.ra,ps.home.ha,sc.home-sc.away)){hP=this.h.bullpen;ps.home.isBullpen=true;ps.home.ip=0;ps.home.ra=0;ps.home.ha=0;}}
      if(!ps.away.isBullpen&&inn>=2){if(shouldChangePitcher(aP,ps.away.ip,ps.away.ra,ps.away.ha,sc.away-sc.home)){aP=this.a.bullpen;ps.away.isBullpen=true;ps.away.ip=0;ps.away.ra=0;ps.away.ha=0;}}
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
  mc(n=100){let hw=0,aw=0;const hs=[],as=[];
    for(let i=0;i<n;i++){const r=this.game();if(r.winner==="home")hw++;else if(r.winner==="away")aw++;hs.push(r.score.home);as.push(r.score.away);}
    return{homeWins:hw,awayWins:aw,homeWinPct:((hw/n)*100).toFixed(1),awayWinPct:((aw/n)*100).toFixed(1),avgHome:_.mean(hs).toFixed(1),avgAway:_.mean(as).toFixed(1)};
  }
}

// ═══════════════════════════════════════════════════════
// 백테스트 실행
// ═══════════════════════════════════════════════════════

const SIM_COUNT = 100;

console.log("═══════════════════════════════════════════════════════════");
console.log("  KBO 시뮬레이션 v7.0 백테스트 — 2024 시즌 60경기 × 100회");
console.log("═══════════════════════════════════════════════════════════\n");

let correct=0,total=0;
const teamStats={},monthStats={};
const details=[];

for(const g of SEASON_2024_RESULTS){
  const home=KBO_TEAMS[g.home],away=KBO_TEAMS[g.away];
  if(!home||!away)continue;
  const hsi=home.starters.findIndex(s=>s.name===g.homeSP);
  const asi=away.starters.findIndex(s=>s.name===g.awaySP);
  const dow=new Date(g.date).getDay();
  const opts={dayOfWeek:dow,time:g.time};
  const sim=new Sim(home,away,home.stadium,g.weather||"cloudy",Math.max(0,hsi),Math.max(0,asi),opts);
  const mc=sim.mc(SIM_COUNT);
  const predWinner=parseFloat(mc.homeWinPct)>=50?"home":"away";
  const actualWinner=g.homeScore>g.awayScore?"home":g.awayScore>g.homeScore?"away":"draw";
  const hit=predWinner===actualWinner;
  const confidence=Math.max(parseFloat(mc.homeWinPct),parseFloat(mc.awayWinPct));
  if(actualWinner!=="draw"){total++;if(hit)correct++;}
  for(const tid of[g.home,g.away]){if(!teamStats[tid])teamStats[tid]={correct:0,total:0,name:KBO_TEAMS[tid].short};if(actualWinner!=="draw"){teamStats[tid].total++;if(hit)teamStats[tid].correct++;}}
  const month=g.date.slice(0,7);if(!monthStats[month])monthStats[month]={correct:0,total:0};if(actualWinner!=="draw"){monthStats[month].total++;if(hit)monthStats[month].correct++;}
  details.push({date:g.date,home:home.short,away:away.short,homeSP:g.homeSP,awaySP:g.awaySP,predHome:mc.homeWinPct,predAway:mc.awayWinPct,predScore:`${mc.avgAway}-${mc.avgHome}`,actual:`${g.awayScore}-${g.homeScore}`,actualWinner,predWinner,hit,confidence});
}

console.log("날짜        | 대진              | 선발              | 예측 승률        | 예측스코어 | 실제결과   | 적중");
console.log("─".repeat(110));
for(const d of details){
  const matchup=`${d.away} @ ${d.home}`.padEnd(14);
  const pitchers=`${d.awaySP} vs ${d.homeSP}`.padEnd(16);
  const pred=`${d.predAway}% : ${d.predHome}%`.padEnd(16);
  const mark=d.actualWinner==="draw"?"➖":d.hit?"✅":"❌";
  console.log(`${d.date} | ${matchup} | ${pitchers} | ${pred} | ${d.predScore.padEnd(9)}  | ${d.actual.padEnd(9)}  | ${mark}`);
}

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  종합 결과");
console.log("═══════════════════════════════════════════════════════════\n");
const acc=((correct/total)*100).toFixed(1);
console.log(`  전체 적중률: ${acc}% (${correct}/${total} 경기)`);
console.log(`  분석 경기: ${SEASON_2024_RESULTS.length}경기 × ${SIM_COUNT}회 시뮬레이션\n`);

console.log("  [월별 적중률]");
for(const[month,s]of Object.entries(monthStats).sort()){
  const pct=s.total>0?((s.correct/s.total)*100).toFixed(1):"N/A";
  const bar="█".repeat(Math.round(parseFloat(pct)/5));
  console.log(`    ${month}: ${pct}% (${s.correct}/${s.total}) ${bar}`);
}

console.log("\n  [팀별 적중률]");
const sortedTeams=Object.entries(teamStats).sort((a,b)=>(b[1].correct/b[1].total)-(a[1].correct/a[1].total));
for(const[,s]of sortedTeams){
  const pct=s.total>0?((s.correct/s.total)*100).toFixed(1):"N/A";
  const bar="█".repeat(Math.round(parseFloat(pct)/5));
  console.log(`    ${s.name.padEnd(4)}: ${pct}% (${s.correct}/${s.total}) ${bar}`);
}

console.log("\n  [예측 신뢰도별 적중률]");
const highConf=details.filter(d=>d.confidence>=60&&d.actualWinner!=="draw");
const midConf=details.filter(d=>d.confidence>=50&&d.confidence<60&&d.actualWinner!=="draw");
const hc=highConf.filter(d=>d.hit).length;
const mc2=midConf.filter(d=>d.hit).length;
console.log(`    고신뢰(60%+): ${highConf.length>0?((hc/highConf.length)*100).toFixed(1):"N/A"}% (${hc}/${highConf.length}경기)`);
console.log(`    중신뢰(50-59%): ${midConf.length>0?((mc2/midConf.length)*100).toFixed(1):"N/A"}% (${mc2}/${midConf.length}경기)`);

// ── 2025 대비 비교 ──
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  2024 vs 2025 시즌 비교");
console.log("═══════════════════════════════════════════════════════════");
console.log(`    2024 시즌: ${acc}% (${correct}/${total})`);
console.log(`    2025 시즌: 71.7% (43/60)  ← 이전 백테스트 결과`);
console.log("═══════════════════════════════════════════════════════════\n");
