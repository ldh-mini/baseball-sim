import fs from 'fs';
import _ from 'lodash';

// ── JSX에서 팀 데이터 추출 ──
const jsx = fs.readFileSync('kbo-simulation.jsx', 'utf8');

// eval-safe: 필요한 상수/함수만 정의하고 Sim 클래스를 재현
// 대신 JSX 파일의 데이터 섹션만 추출해서 사용

// STADIUMS
const stadiumsMatch = jsx.match(/const STADIUMS\s*=\s*(\{[\s\S]*?\n\};)/);
const STADIUMS = eval('(' + stadiumsMatch[1].replace(/};$/, '}') + ')');

// WEATHER_EFFECTS
const weatherMatch = jsx.match(/const WEATHER_EFFECTS\s*=\s*(\{[\s\S]*?\n\};)/);
const WEATHER_EFFECTS = eval('(' + weatherMatch[1].replace(/};$/, '}') + ')');

// DAY_OF_WEEK_MOD
const dayMatch = jsx.match(/const DAY_OF_WEEK_MOD\s*=\s*(\{[\s\S]*?\};)/);
const DAY_OF_WEEK_MOD = eval('(' + dayMatch[1].replace(/};$/, '}') + ')');

// TIME_SLOT_MOD
const timeMatch = jsx.match(/const TIME_SLOT_MOD\s*=\s*(\{[\s\S]*?\};)/);
const TIME_SLOT_MOD = eval('(' + timeMatch[1].replace(/};$/, '}') + ')');

// H2H_RECORDS
const h2hMatch = jsx.match(/const H2H_RECORDS\s*=\s*(\{[\s\S]*?\n\};)/);
const H2H_RECORDS = eval('(' + h2hMatch[1].replace(/};$/, '}') + ')');

// MATCHUPS
const matchupsMatch = jsx.match(/const MATCHUPS\s*=\s*(\{[\s\S]*?\n\};)/);
const MATCHUPS = eval('(' + matchupsMatch[1].replace(/};$/, '}') + ')');

// KBO_TEAMS
const teamsMatch = jsx.match(/const KBO_TEAMS\s*=\s*(\{[\s\S]*?\n\};)/);
const KBO_TEAMS = eval('(' + teamsMatch[1].replace(/};$/, '}') + ')');

// ── Helper functions from JSX ──
function getTimeSlot(timeStr) {
  if (!timeStr) return "night";
  const h = parseInt(timeStr.split(":")[0]);
  if (h < 16) return "day";
  if (h < 18) return "evening";
  return "night";
}

function getOddsMod(homeRating, awayRating) {
  const diff = homeRating - awayRating;
  const absDiff = Math.abs(diff);
  const underdogBoost = _.clamp(absDiff * 0.003, 0, 0.05);
  const favoritePenalty = _.clamp(absDiff * 0.002, 0, 0.03);
  if (diff > 0) return { home: 1 - favoritePenalty, away: 1 + underdogBoost };
  if (diff < 0) return { home: 1 + underdogBoost, away: 1 - favoritePenalty };
  return { home: 1, away: 1 };
}

function getH2HMod(homeId, awayId) {
  const wr = H2H_RECORDS[homeId]?.[awayId];
  if (wr == null) return { home: 1, away: 1 };
  const dev = (wr - 0.5) * 0.15;
  return { home: 1 + dev, away: 1 - dev };
}

function getMatchupMod(pitcherName, batterName) {
  const mu = MATCHUPS[pitcherName]?.[batterName];
  if (!mu || mu.pa < 20) return 1.0;
  const diff = mu.avg - 0.260;
  return 1 + _.clamp(diff * 0.3, -0.08, 0.08);
}

const LEAGUE_AVG = { avg: .265, obp: .340, slg: .410, era: 3.80, whip: 1.22, k9: 8.0, bb9: 2.8 };

function regressBatter(b) {
  const paEst = b.hr > 30 ? 600 : b.hr > 15 ? 500 : b.hr > 5 ? 400 : 300;
  const regFactor = Math.min(1, paEst / 500);
  return { ...b, avg: b.avg * regFactor + LEAGUE_AVG.avg * (1 - regFactor), obp: b.obp * regFactor + LEAGUE_AVG.obp * (1 - regFactor), slg: b.slg * regFactor + LEAGUE_AVG.slg * (1 - regFactor) };
}

function regressPitcher(p) {
  const ipEst = p.ip || 150;
  const regFactor = Math.min(1, ipEst / 160);
  return { ...p, era: p.era * regFactor + LEAGUE_AVG.era * (1 - regFactor), whip: p.whip * regFactor + LEAGUE_AVG.whip * (1 - regFactor), k9: p.k9 * regFactor + LEAGUE_AVG.k9 * (1 - regFactor), bb9: p.bb9 * regFactor + LEAGUE_AVG.bb9 * (1 - regFactor) };
}

function calcWOBA(b) { return (b.obp * 0.7 + b.slg * 0.3) * (1 + (b.spd || 5) * 0.005); }
function calcFIP(p) { return ((13 * (p.era > 6 ? 1.5 : p.hr ? p.hr / ((p.ip || 150) / 9) : 1.0)) + 3 * (p.bb9 || 3) - 2 * (p.k9 || 7)) / 13 + 3.10; }
function calcPythagorean(rs, ra) { if (rs + ra === 0) return 0.5; return Math.pow(rs, 1.83) / (Math.pow(rs, 1.83) + Math.pow(ra, 1.83)); }
function calcElo(rec) { if (!rec) return 1500; const pct = rec.w / (rec.w + rec.l); return 1500 + (pct - 0.5) * 400; }

function getPitcherFatigue(ip, ra, ha) {
  const ipF = Math.max(0, (ip - 4) * 0.04);
  const raF = ra * 0.03;
  const haF = Math.max(0, (ha - ip * 1.2) * 0.02);
  return _.clamp(ipF + raF + haF, 0, 0.5);
}

function shouldChangePitcher(pitcher, ip, ra, ha, scoreDiff, isHome) {
  const aceBonus = (pitcher.war || 0) > 4 ? 1 : 0;
  const fatigue = getPitcherFatigue(ip, ra, ha);
  if (ip >= 7 + aceBonus) return true;
  if (ip >= 1 && ra >= 5) return true;
  if (ip >= 2 && ra / ip > 1.5) return true;
  const fatigueThreshold = 0.20 + aceBonus * 0.05;
  if (fatigue >= fatigueThreshold) return true;
  if (ip >= 6 + aceBonus) return Math.random() < 0.3 + fatigue;
  if (ip >= 5 && scoreDiff <= -4) return true;
  return false;
}

// ── Sim class (copied from JSX) ──
class Sim {
  constructor(h, a, sid, w, hsi = 0, asi = 0, opts = {}) {
    this.h = _.cloneDeep(h); this.a = _.cloneDeep(a);
    this.st = STADIUMS[sid] || STADIUMS.jamsil; this.w = WEATHER_EFFECTS[w] || WEATHER_EFFECTS.cloudy;
    this.h.lineup = this.h.lineup.map(regressBatter);
    this.a.lineup = this.a.lineup.map(regressBatter);
    this.hP = regressPitcher(this.h.starters[hsi]);
    this.aP = regressPitcher(this.a.starters[asi]);
    this.h.lineup.forEach(b => { b.woba = calcWOBA(b); });
    this.a.lineup.forEach(b => { b.woba = calcWOBA(b); });
    this.hP.fip = calcFIP(this.hP); this.aP.fip = calcFIP(this.aP);
    this.hPyth = h.record ? calcPythagorean(h.record.rs || 0, h.record.ra || 0) : 0.5;
    this.aPyth = a.record ? calcPythagorean(a.record.rs || 0, a.record.ra || 0) : 0.5;
    this.hElo = calcElo(h.record); this.aElo = calcElo(a.record);
    const eloDiff = this.hElo - this.aElo;
    this.eloMod = { home: 1 + _.clamp(eloDiff * 0.0002, -0.03, 0.03), away: 1 - _.clamp(eloDiff * 0.0002, -0.03, 0.03) };
    this.hDefRAA = this.h.lineup.reduce((s, b) => s + (b.defRAA || 0), 0);
    this.aDefRAA = this.a.lineup.reduce((s, b) => s + (b.defRAA || 0), 0);
    const dayIdx = opts.dayOfWeek ?? new Date().getDay();
    const jsDayToKr = [6, 0, 1, 2, 3, 4, 5];
    this.dayIdx = jsDayToKr[dayIdx] ?? 0;
    this.timeMod = TIME_SLOT_MOD[getTimeSlot(opts.time)] || TIME_SLOT_MOD.night;
    this.oddsMod = getOddsMod(h.teamRating, a.teamRating);
    this.h2hMod = getH2HMod(h.id, a.id);
  }
  platoon(b, p) { const bt = b.bat || "R", pt = p.throws || "R"; if (bt === "S") return 1.01; if (bt !== pt) return 1.04; return 0.96; }
  warBonus(b) { const w = b.war || 0; if (w <= 0) return 1.0; return 1 + Math.min(0.03, w * 0.004); }
  pitcherWar(p) { const w = p.wpaLI || 0; if (w <= 0) return 1.0; return 1 + Math.min(0.04, w * 0.008); }
  defFactor(isHome) { const dr = isHome ? this.hDefRAA : this.aDefRAA; return 1 - _.clamp(dr * 0.001, -.03, .05); }
  prob(b, p, isH, fatigueFactor = 0) {
    const pf = this.st.parkFactor, wH = this.st.dome ? 1 + (this.w.hitMod - 1) * .2 : this.w.hitMod, wR = this.st.dome ? 1 + (this.w.hrMod - 1) * .2 : this.w.hrMod, hA = isH ? 1.025 : 1;
    const bF = _.clamp(b.recentForm || 1.0, 0.92, 1.08), plt = this.platoon(b, p), wB = this.warBonus(b), pW = this.pitcherWar(p);
    const dayMod = DAY_OF_WEEK_MOD[isH ? "home" : "away"][this.dayIdx];
    const tHit = this.timeMod.hitMod, tHr = this.timeMod.hrMod;
    const oddF = isH ? this.oddsMod.home : this.oddsMod.away;
    const h2hF = isH ? this.h2hMod.home : this.h2hMod.away;
    const muMod = getMatchupMod(p.name, b.name);
    const eloF = isH ? this.eloMod.home : this.eloMod.away;
    const envMod = dayMod * oddF * h2hF * muMod * eloF;
    const ftg = fatigueFactor;
    const fatigueHitBoost = 1 + ftg * 0.8;
    const fatigueKDrop = 1 - ftg * 0.5;
    const fatigueBBBoost = 1 + ftg * 0.6;
    const fip = p.fip || calcFIP(p);
    const pF = _.clamp(1 + (3.80 - fip) * 0.12, .7, 1.3) * _.clamp(p.recentForm || 1.0, 0.92, 1.08) * pW * (2 - this.timeMod.eraMod);
    const pK = p.k9 / 9 * fatigueKDrop, pB = p.bb9 / 9 * fatigueBBBoost;
    const dF = this.defFactor(!isH);
    const woba = b.woba || calcWOBA(b);
    const wobaFactor = woba / 0.340;
    const so = Math.min(.35, pK * (1 - b.obp / .5) * .70 * (2 - plt)), bb = Math.min(.18, pB * (b.obp / .34) * .23 * plt), hbp = .008;
    const hit = Math.max(.05, (wobaFactor * 0.38 * hA * wH * tHit * bF * plt * wB * envMod * fatigueHitBoost / pF - bb - hbp) * .88 * dF), iso = b.slg - b.avg;
    const hr = Math.min(.08, (b.hr / 550) * pf * wR * tHr * hA * bF * plt * wB * envMod * fatigueHitBoost / pF), t3 = Math.min(.008, .003 * (b.spd / 5)), d2 = Math.min(.08, iso * .25 * pf * wH * tHit * plt * dF), s1 = Math.max(.05, hit - hr - t3 - d2);
    const errMod = this.defFactor(isH);
    const err = Math.max(.003, .015 * this.w.errMod * errMod);
    const rem = Math.max(0, 1 - hit - bb - so - hbp - err);
    return { strikeout: so, walk: bb, hitByPitch: hbp, single: s1, double: d2, triple: t3, homerun: hr, groundOut: rem * .473, flyOut: rem * .368, lineOut: rem * .158, error: err };
  }
  ab(b, p, isH, ftg = 0) { const pr = this.prob(b, p, isH, ftg); let r = Math.random(), c = 0; for (const [t, v] of Object.entries(pr)) { c += v; if (r < c) return t; } return "groundOut"; }
  adv(bs, o, outs, b) {
    let rs = 0; const sp = b.spd || 5;
    switch (o) {
      case "homerun": rs = bs.filter(Boolean).length + 1; bs[0] = bs[1] = bs[2] = null; break;
      case "triple": rs += bs.filter(Boolean).length; bs[0] = bs[1] = null; bs[2] = b.name; break;
      case "double": if (bs[2]) { rs++; bs[2] = null; } if (bs[1]) { rs++; bs[1] = null; } if (bs[0]) { bs[2] = bs[0]; bs[0] = null; } bs[1] = b.name; break;
      case "single": if (bs[2]) { rs++; bs[2] = null; } if (bs[1]) { if (sp >= 6 || Math.random() > .5) bs[2] = bs[1]; else rs++; bs[1] = null; } if (bs[0]) { bs[1] = bs[0]; bs[0] = null; } bs[0] = b.name; break;
      case "walk": case "hitByPitch": if (bs[0] && bs[1] && bs[2]) rs++; if (bs[0] && bs[1]) bs[2] = bs[1]; if (bs[0]) bs[1] = bs[0]; bs[0] = b.name; break;
      case "groundOut": if (bs[0] && outs < 2 && Math.random() < .4) { bs[0] = null; if (bs[2] && Math.random() < .3) { rs++; bs[2] = null; } return { rs, o: 2 }; } if (bs[2] && outs < 2 && Math.random() < .45) { rs++; bs[2] = null; } if (bs[1] && !bs[2]) { bs[2] = bs[1]; bs[1] = null; } return { rs, o: 1 };
      case "flyOut": if (bs[2] && outs < 2 && Math.random() < .55) { rs++; bs[2] = null; } return { rs, o: 1 };
      case "error": if (bs[2]) { rs++; bs[2] = null; } if (bs[1]) { bs[2] = bs[1]; bs[1] = null; } if (bs[0]) bs[1] = bs[0]; bs[0] = b.name; break;
      default: return { rs, o: 1 };
    } return { rs, o: 0 };
  }
  game() {
    const sc = { home: 0, away: 0 }; let hi = 0, ai = 0;
    let hP = this.hP, aP = this.aP;
    const ps = { home: { ip: 0, ra: 0, ha: 0, isBullpen: false }, away: { ip: 0, ra: 0, ha: 0, isBullpen: false } };
    for (let inn = 1; inn <= 12; inn++) {
      if (!ps.home.isBullpen && inn >= 2) { if (shouldChangePitcher(hP, ps.home.ip, ps.home.ra, ps.home.ha, sc.home - sc.away, true)) { hP = this.h.bullpen; ps.home.isBullpen = true; ps.home.ip = 0; ps.home.ra = 0; ps.home.ha = 0; } }
      if (!ps.away.isBullpen && inn >= 2) { if (shouldChangePitcher(aP, ps.away.ip, ps.away.ra, ps.away.ha, sc.away - sc.home, false)) { aP = this.a.bullpen; ps.away.isBullpen = true; ps.away.ip = 0; ps.away.ra = 0; ps.away.ha = 0; } }
      const hFtg = ps.home.isBullpen ? 0 : getPitcherFatigue(ps.home.ip, ps.home.ra, ps.home.ha);
      const aFtg = ps.away.isBullpen ? 0 : getPitcherFatigue(ps.away.ip, ps.away.ra, ps.away.ha);
      // Top (away batting)
      let outs = 0, bs = [null, null, null], ir = 0;
      while (outs < 3) { const b = this.a.lineup[ai % 9]; const o = this.ab(b, hP, false, hFtg), r = this.adv(bs, o, outs, b); if (["single", "double", "triple", "homerun"].includes(o)) ps.home.ha++; ir += r.rs; outs += r.o; ai++; }
      sc.away += ir; ps.home.ra += ir; ps.home.ip++;
      if (!ps.home.isBullpen && ir >= 3) { hP = this.h.bullpen; ps.home.isBullpen = true; ps.home.ip = 0; ps.home.ra = 0; ps.home.ha = 0; }
      if (inn >= 9 && sc.home > sc.away) break;
      // Bottom (home batting)
      outs = 0; bs = [null, null, null]; ir = 0;
      while (outs < 3) { const b = this.h.lineup[hi % 9]; const o = this.ab(b, aP, true, aFtg), r = this.adv(bs, o, outs, b); if (["single", "double", "triple", "homerun"].includes(o)) ps.away.ha++; ir += r.rs; outs += r.o; hi++; if (inn >= 9 && sc.home + ir > sc.away) break; }
      sc.home += ir; ps.away.ra += ir; ps.away.ip++;
      if (!ps.away.isBullpen && ir >= 3) { aP = this.a.bullpen; ps.away.isBullpen = true; ps.away.ip = 0; ps.away.ra = 0; ps.away.ha = 0; }
      if (inn >= 9 && sc.home !== sc.away) break;
    }
    return { home: sc.home, away: sc.away, winner: sc.home > sc.away ? "home" : sc.away > sc.home ? "away" : "draw" };
  }
  mc(n = 1000) {
    let hw = 0, aw = 0, dr = 0; const hs = [], as = [];
    for (let i = 0; i < n; i++) { const r = this.game(); if (r.winner === "home") hw++; else if (r.winner === "away") aw++; else dr++; hs.push(r.home); as.push(r.away); }
    return { homeWins: hw, awayWins: aw, draws: dr, homeWinPct: ((hw / n) * 100).toFixed(1), awayWinPct: ((aw / n) * 100).toFixed(1), avgHome: _.mean(hs).toFixed(1), avgAway: _.mean(as).toFixed(1) };
  }
}

// ── ID mapping ──
const NAME_TO_ID = { "삼성": "samsung", "기아": "kia", "KIA": "kia", "LG": "lg", "두산": "doosan", "KT": "kt", "SSG": "ssg", "한화": "hanwha", "롯데": "lotte", "NC": "nc", "키움": "kiwoom" };
const STADIUM_TO_ID = { "잠실": "jamsil", "문학": "incheon", "수원": "suwon", "대구": "daegu", "광주": "gwangju", "대전": "daejeon", "사직": "sajik", "창원": "changwon", "고척": "gocheok", "인천": "incheon", "부산": "sajik" };

function findStarterIdx(team, spName) {
  if (!spName) return 0;
  const idx = team.starters.findIndex(s => s.name === spName || spName.includes(s.name) || s.name.includes(spName));
  return idx >= 0 ? idx : 0;
}

// ── 2026 시즌 전체 경기 데이터 ──
const games = [
  // 3/28 개막전
  { away: "KT", home: "LG", stadium: "잠실", awaySP: "사우어", homeSP: "치리노스", time: "14:00", actualAway: 11, actualHome: 7, date: "03.28" },
  { away: "KIA", home: "SSG", stadium: "문학", awaySP: "네일", homeSP: "화이트", time: "14:00", actualAway: 6, actualHome: 7, date: "03.28" },
  { away: "롯데", home: "삼성", stadium: "대구", awaySP: "로드리게스", homeSP: "후라도", time: "14:00", actualAway: 6, actualHome: 3, date: "03.28" },
  { away: "두산", home: "NC", stadium: "창원", awaySP: "플렉센", homeSP: "구창모", time: "14:00", actualAway: 0, actualHome: 6, date: "03.28" },
  { away: "키움", home: "한화", stadium: "대전", awaySP: "알칸타라", homeSP: "에르난데스", time: "14:00", actualAway: 9, actualHome: 10, date: "03.28" },
  // 3/29
  { away: "KT", home: "LG", stadium: "잠실", awaySP: "소형준", homeSP: "임찬규", time: "14:00", actualAway: 6, actualHome: 5, date: "03.29" },
  { away: "KIA", home: "SSG", stadium: "문학", awaySP: "이의리", homeSP: "김건우", time: "14:00", actualAway: 6, actualHome: 11, date: "03.29" },
  { away: "롯데", home: "삼성", stadium: "대구", awaySP: "비슬리", homeSP: "최원태", time: "14:00", actualAway: 6, actualHome: 2, date: "03.29" },
  { away: "두산", home: "NC", stadium: "창원", awaySP: "곽빈", homeSP: "테일러", time: "14:00", actualAway: 9, actualHome: 6, date: "03.29" },
  { away: "키움", home: "한화", stadium: "대전", awaySP: "하영민", homeSP: "왕옌청", time: "14:00", actualAway: 4, actualHome: 10, date: "03.29" },
  // 3/31
  { away: "KIA", home: "LG", stadium: "잠실", awaySP: "올러", homeSP: "톨허스트", time: "18:30", actualAway: 7, actualHome: 2, date: "03.31" },
  { away: "키움", home: "SSG", stadium: "문학", awaySP: "와일스", homeSP: "베니지아노", time: "18:30", actualAway: 3, actualHome: 9, date: "03.31" },
  { away: "두산", home: "삼성", stadium: "대구", awaySP: "잭로그", homeSP: "오러클린", time: "18:30", actualAway: 5, actualHome: 5, date: "03.31" },
  { away: "롯데", home: "NC", stadium: "창원", awaySP: "박세웅", homeSP: "토다", time: "18:30", actualAway: 2, actualHome: 9, date: "03.31" },
  { away: "KT", home: "한화", stadium: "대전", awaySP: "보쉴리", homeSP: "화이트", time: "18:30", actualAway: 9, actualHome: 4, date: "03.31" },
];

const N = 1000;
console.log('='.repeat(70));
console.log(`  2026 시즌 백테스트 — 전체 ${games.length}경기 (${N}회 시뮬/경기)`);
console.log('='.repeat(70));

let correct = 0, total = 0;

for (const g of games) {
  const awayId = NAME_TO_ID[g.away];
  const homeId = NAME_TO_ID[g.home];
  const stadiumId = STADIUM_TO_ID[g.stadium];

  const away = KBO_TEAMS[awayId];
  const home = KBO_TEAMS[homeId];

  const awayStarterIdx = findStarterIdx(away, g.awaySP);
  const homeStarterIdx = findStarterIdx(home, g.homeSP);

  // 3/31 = 화요일 (JS getDay: 2 = Tuesday)
  const sim = new Sim(home, away, stadiumId, 'cloudy', homeStarterIdx, awayStarterIdx, { dayOfWeek: 2, time: g.time });
  const mc = sim.mc(N);

  const predWinner = parseFloat(mc.homeWinPct) >= 50 ? g.home : g.away;
  const predWinPct = parseFloat(mc.homeWinPct) >= 50 ? mc.homeWinPct : mc.awayWinPct;
  const actualWinner = g.actualHome > g.actualAway ? g.home : (g.actualAway > g.actualHome ? g.away : "무승부");

  const isDraw = g.actualHome === g.actualAway;
  const isCorrect = !isDraw && predWinner === actualWinner;
  if (!isDraw) { total++; if (isCorrect) correct++; }

  const mark = isDraw ? "△" : (isCorrect ? "✅" : "❌");

  console.log(`\n${mark} ${g.away} ${g.actualAway} - ${g.actualHome} ${g.home} (${g.stadium})`);
  console.log(`   선발: ${g.awaySP}(${away.starters[awayStarterIdx]?.name}) vs ${g.homeSP}(${home.starters[homeStarterIdx]?.name})`);
  console.log(`   시뮬: ${g.away} ${mc.awayWinPct}% - ${mc.homeWinPct}% ${g.home} | 평균: ${mc.avgAway}-${mc.avgHome}`);
  console.log(`   예측: ${predWinner} 승 (${predWinPct}%) | 실제: ${actualWinner}${isDraw ? " (무승부)" : ""}`);
}

console.log('\n' + '='.repeat(70));
console.log(`  적중률: ${correct}/${total} (${(correct / total * 100).toFixed(1)}%) — 무승부 ${games.length - total}경기 제외`);
console.log('='.repeat(70));
