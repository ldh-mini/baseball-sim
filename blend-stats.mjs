import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// 베이지안 블렌딩: 2026 실데이터 × 2025 개인별 풀시즌 prior
// 표본이 적을수록 2025 실적에 가깝게, 많을수록 2026 실데이터에 가깝게
// 2025 데이터 없는 선수는 리그평균을 prior로 사용
// ═══════════════════════════════════════════════════════════════

const BASE = 'http://localhost:5173/kbo-api';
const TM = { '삼성':'samsung','KIA':'kia','LG':'lg','두산':'doosan','KT':'kt','SSG':'ssg','한화':'hanwha','롯데':'lotte','NC':'nc','키움':'kiwoom' };

// ── KBO 리그 평균 (2025 시즌 기준 fallback) ──
const LEAGUE_AVG_HITTER = { avg: 0.267, obp: 0.345, slg: 0.415, hr_per_pa: 0.028 };
const LEAGUE_AVG_PITCHER = { era: 3.80, whip: 1.25, k9: 8.0, bb9: 3.3 };

// ── 회귀 상수 (regression constant) ──
const REG_PA = 120;   // 타자: ~30경기(한 달)분량이면 50:50
const REG_IP = 40;    // 투수: ~7선발(한 달)분량이면 50:50

function blend(real, prior, sampleSize, regConstant) {
  const w = sampleSize / (sampleSize + regConstant);
  return +(real * w + prior * (1 - w)).toFixed(3);
}

function parseIP(ipStr) {
  // "180 2/3" → 180.667, "176" → 176, "5" → 5
  if (!ipStr) return 0;
  const parts = ipStr.trim().split(/\s+/);
  let ip = parseFloat(parts[0]) || 0;
  if (parts[1] === '1/3') ip += 0.333;
  else if (parts[1] === '2/3') ip += 0.667;
  return ip;
}

// ── 크롤링 함수 (2026 현재 시즌) ──
async function fetchPage(url) {
  const r = await fetch(url);
  return r.text();
}

function parseTable(html) {
  const rows = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html))) {
    const tr = trMatch[0];
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td;
    while ((td = tdRe.exec(tr))) {
      cells.push(td[1].replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '').trim());
    }
    if (cells.length > 3 && /^\d+$/.test(cells[0])) rows.push(cells);
  }
  return rows;
}

async function crawlHitters2026() {
  const html1 = await fetchPage(`${BASE}/Record/Player/HitterBasic/Basic1.aspx`);
  const h1 = parseTable(html1);
  const html2 = await fetchPage(`${BASE}/Record/Player/HitterBasic/Basic2.aspx`);
  const h2 = parseTable(html2);
  return { h1, h2 };
}

async function crawlPitchers2026() {
  const html = await fetchPage(`${BASE}/Record/Player/PitcherBasic/Basic1.aspx`);
  return parseTable(html);
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── CLI 옵션 파싱 (v9.2/9.3/9.4) ──
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    snapshot: null, noRecent: false, noMomentum: false,
    // v9.4 그리드 서치 결론: l10=10 유지
    // - 9일 × 5경기 그리드에서 l10=5가 표면상 1등 (59.5% vs 50%)이었으나
    // - 같은 데이터로 5일 시점 비교 시 l10=5는 v9.1과 동일한 56% (효과 0)
    //   반면 l10=10은 v9.3 검증에서 v9.1 60% vs v9.2 68% (+8%p) 입증
    // - McNemar p>0.5 (모든 비교) — 표본 부족, 통계 유의성 약함
    // - 결론: v9.2/v9.3 검증된 l10=10 유지, v9.5에서 표본 확장 후 재검증
    momL10: 10,        // last10 가중치 (v9.2/v9.3 검증)
    momStreak: 0.5,    // streak 가중치
    momFn: 'linear',   // 'linear' or 'threshold'
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--snapshot' && args[i+1]) { opts.snapshot = args[++i]; }
    else if (args[i] === '--no-recent') { opts.noRecent = true; }
    else if (args[i] === '--no-momentum') { opts.noMomentum = true; }
    else if (args[i] === '--mom-l10' && args[i+1]) { opts.momL10 = parseFloat(args[++i]); }
    else if (args[i] === '--mom-streak' && args[i+1]) { opts.momStreak = parseFloat(args[++i]); }
    else if (args[i] === '--mom-fn' && args[i+1]) { opts.momFn = args[++i]; }
  }
  return opts;
}

// ── 메인 ──
async function main() {
  const opts = parseArgs();
  if (opts.snapshot) console.log(`🕒 스냅샷 모드: ${opts.snapshot}`);
  if (opts.noRecent) console.log(`⏭️  최근 10경기 오버레이 스킵`);
  if (opts.noMomentum) console.log(`⏭️  Layer 2C 모멘텀 스킵 (A/B 비교용)`);

  // ── 2025 풀시즌 데이터 로드 (Playwright로 크롤링된 파일) ──
  console.log('📂 2025 풀시즌 데이터 로드...');
  const h1_2025 = JSON.parse(fs.readFileSync('h1_2025.json', 'utf8'));
  const h2_2025 = JSON.parse(fs.readFileSync('h2_2025.json', 'utf8'));
  const p1_2025 = JSON.parse(fs.readFileSync('p1_2025.json', 'utf8'));
  console.log(`  2025: 타자 ${h1_2025.length}명, 투수 ${p1_2025.length}명`);

  // Build 2025 lookup maps (name_team → stats)
  const prior2025H = {};
  for (let i = 0; i < h1_2025.length; i++) {
    const v1 = h1_2025[i], v2 = h2_2025[i] || [];
    const key = v1[1]; // name only (team may change between seasons)
    prior2025H[key] = {
      avg: +v1[3], obp: +(v2[10] || 0), slg: +(v2[9] || 0),
      hr: +v1[11], pa: +v1[5]
    };
  }

  const prior2025P = {};
  for (const v of p1_2025) {
    const ip = parseIP(v[10]);
    const so = +v[15] || 0, bb = +v[13] || 0;
    prior2025P[v[1]] = {
      era: +v[3], whip: +v[18],
      k9: ip > 0 ? +(so / ip * 9).toFixed(1) : 0,
      bb9: ip > 0 ? +(bb / ip * 9).toFixed(1) : 0,
      ip
    };
  }

  // ── 2026 실데이터 크롤링 ──
  console.log('\n📊 2026 실데이터 크롤링 중...');
  const [{ h1, h2 }, p1] = await Promise.all([crawlHitters2026(), crawlPitchers2026()]);
  console.log(`  2026: 타자 ${h1.length}명, 투수 ${p1.length}명`);

  let jsx = fs.readFileSync('kbo-simulation.jsx', 'utf8');

  // ── 타자 블렌딩 ──
  console.log('\n🏏 타자 블렌딩 (2026 × 2025 개인 prior):');
  let hUpdated = 0, hUsed2025 = 0, hUsedLeague = 0;
  for (let i = 0; i < h1.length; i++) {
    const v1 = h1[i], v2 = h2[i] || [];
    const tid = TM[v1[2]];
    if (!tid) continue;

    const name = v1[1];
    const pa2026 = +v1[5] || 0;
    const real = { avg: +v1[3], obp: +(v2[10] || 0), slg: +(v2[9] || 0), hr: +v1[11] };

    if (pa2026 === 0) continue;

    const esc = escRe(name);
    const avgRe = new RegExp(`(name:\\s*"${esc}",.*?avg:)[0-9.]+`);
    if (!jsx.match(avgRe)) continue;

    // 2025 개인 데이터가 있으면 사용, 없으면 리그평균
    const p25 = prior2025H[name];
    let prior, priorLabel;
    if (p25) {
      prior = { avg: p25.avg, obp: p25.obp, slg: p25.slg, hr_per_pa: p25.pa > 0 ? p25.hr / p25.pa : LEAGUE_AVG_HITTER.hr_per_pa };
      priorLabel = `2025(AVG:${p25.avg})`;
      hUsed2025++;
    } else {
      prior = LEAGUE_AVG_HITTER;
      priorLabel = 'LgAvg';
      hUsedLeague++;
    }

    const bAvg = blend(real.avg, prior.avg, pa2026, REG_PA);
    const bObp = blend(real.obp, prior.obp, pa2026, REG_PA);
    const bSlg = blend(real.slg, prior.slg, pa2026, REG_PA);
    const w = pa2026 / (pa2026 + REG_PA);
    const bHr = Math.round(real.hr * w + (pa2026 * prior.hr_per_pa) * (1 - w));

    jsx = jsx.replace(avgRe, `$1${bAvg}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?obp:)[0-9.]+`), `$1${bObp}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?slg:)[0-9.]+`), `$1${bSlg}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?hr:)[0-9]+`), `$1${bHr}`);
    hUpdated++;

    console.log(`  ${name} (PA:${pa2026}, w:${(w*100).toFixed(1)}%, prior:${priorLabel}) → AVG:${bAvg} OBP:${bObp} SLG:${bSlg} HR:${bHr}`);
  }

  // ── 2025 데이터만 있고 2026에 없는 선수 → 2025 실적 그대로 적용 ──
  console.log('\n📋 2026 미등판/미출장 선수 → 2025 실적 적용:');
  const updated2026H = new Set(h1.map(v => v[1]));
  let hCarryover = 0;
  for (const [name, stats] of Object.entries(prior2025H)) {
    if (updated2026H.has(name)) continue;
    const esc = escRe(name);
    const avgRe = new RegExp(`(name:\\s*"${esc}",.*?avg:)[0-9.]+`);
    if (!jsx.match(avgRe)) continue;

    jsx = jsx.replace(avgRe, `$1${stats.avg}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?obp:)[0-9.]+`), `$1${stats.obp}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?slg:)[0-9.]+`), `$1${stats.slg}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?hr:)[0-9]+`), `$1${stats.hr}`);
    hCarryover++;
    console.log(`  ${name} → 2025 그대로: AVG:${stats.avg} OBP:${stats.obp} SLG:${stats.slg} HR:${stats.hr}`);
  }

  // ── 투수 블렌딩 ──
  console.log('\n⚾ 투수 블렌딩 (2026 × 2025 개인 prior):');
  let pUpdated = 0, pUsed2025 = 0, pUsedLeague = 0;
  for (const v of p1) {
    const tid = TM[v[2]];
    if (!tid) continue;

    const name = v[1];
    const ip2026 = parseFloat(v[10]) || 0;
    const so = +v[15] || 0, bb = +v[13] || 0;
    const real = {
      era: +v[3], whip: +v[18],
      k9: ip2026 > 0 ? +(so / ip2026 * 9).toFixed(1) : 0,
      bb9: ip2026 > 0 ? +(bb / ip2026 * 9).toFixed(1) : 0
    };

    if (ip2026 === 0) continue;

    const esc = escRe(name);
    const eraRe = new RegExp(`(name:\\s*"${esc}",.*?era:)[0-9.]+`);
    if (!jsx.match(eraRe)) continue;

    const p25 = prior2025P[name];
    let prior, priorLabel;
    if (p25) {
      prior = { era: p25.era, whip: p25.whip, k9: +p25.k9, bb9: +p25.bb9 };
      priorLabel = `2025(ERA:${p25.era})`;
      pUsed2025++;
    } else {
      prior = LEAGUE_AVG_PITCHER;
      priorLabel = 'LgAvg';
      pUsedLeague++;
    }

    const bEra = blend(real.era, prior.era, ip2026, REG_IP);
    const bWhip = blend(real.whip, prior.whip, ip2026, REG_IP);
    const bK9 = blend(real.k9, prior.k9, ip2026, REG_IP);
    const bBb9 = blend(real.bb9, prior.bb9, ip2026, REG_IP);

    jsx = jsx.replace(eraRe, `$1${bEra}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?whip:)[0-9.]+`), `$1${bWhip}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?k9:)[0-9.]+`), `$1${bK9}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?bb9:)[0-9.]+`), `$1${bBb9}`);
    pUpdated++;

    const w = ip2026 / (ip2026 + REG_IP);
    console.log(`  ${name} (IP:${ip2026}, w:${(w*100).toFixed(1)}%, prior:${priorLabel}) → ERA:${bEra} WHIP:${bWhip} K/9:${bK9} BB/9:${bBb9}`);
  }

  // ── 2025 데이터만 있고 2026에 없는 투수 → 2025 실적 적용 ──
  console.log('\n📋 2026 미등판 투수 → 2025 실적 적용:');
  const updated2026P = new Set(p1.map(v => v[1]));
  let pCarryover = 0;
  for (const [name, stats] of Object.entries(prior2025P)) {
    if (updated2026P.has(name)) continue;
    const esc = escRe(name);
    const eraRe = new RegExp(`(name:\\s*"${esc}",.*?era:)[0-9.]+`);
    if (!jsx.match(eraRe)) continue;

    jsx = jsx.replace(eraRe, `$1${stats.era}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?whip:)[0-9.]+`), `$1${stats.whip}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?k9:)[0-9.]+`), `$1${stats.k9}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?bb9:)[0-9.]+`), `$1${stats.bb9}`);
    pCarryover++;
    console.log(`  ${name} → 2025 그대로: ERA:${stats.era} WHIP:${stats.whip} K/9:${stats.k9} BB/9:${stats.bb9}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer 2: 최근 10경기 오버레이 + 동적 recentForm 반영
  // ═══════════════════════════════════════════════════════════════
  const RECENT_MAX_WEIGHT = 0.30; // 최근 10경기 최대 가중치 30%

  let recentFile = null;
  if (!opts.noRecent && fs.existsSync('recent-stats.json')) {
    recentFile = JSON.parse(fs.readFileSync('recent-stats.json', 'utf8'));
    console.log(`\n🔥 최근 10경기 데이터 로드 (${recentFile.crawlDate})`);
    console.log(`  타자: ${Object.keys(recentFile.hitters).length}명, 투수: ${Object.keys(recentFile.pitchers).length}명`);
  }

  if (recentFile) {
    console.log('\n🏏 타자 최근 10경기 오버레이:');
    let hRecentApplied = 0;
    for (const [name, recent] of Object.entries(recentFile.hitters)) {
      if (recent.games < 3) continue; // 3경기 미만은 스킵
      const esc = escRe(name);
      const avgRe = new RegExp(`(name:\\s*"${esc}",.*?avg:)[0-9.]+`);
      if (!jsx.match(avgRe)) continue;

      // 현재 블렌딩된 시즌 스탯 읽기
      const curAvg = +(jsx.match(new RegExp(`name:\\s*"${esc}",.*?avg:([0-9.]+)`))?.[1] || 0);
      const curObp = +(jsx.match(new RegExp(`name:\\s*"${esc}",.*?obp:([0-9.]+)`))?.[1] || 0);
      const curSlg = +(jsx.match(new RegExp(`name:\\s*"${esc}",.*?slg:([0-9.]+)`))?.[1] || 0);

      // 최근 10경기 가중치: games/10 * MAX_WEIGHT
      const rW = Math.min(RECENT_MAX_WEIGHT, (recent.games / 10) * RECENT_MAX_WEIGHT);
      const finalAvg = +(curAvg * (1 - rW) + recent.avg * rW).toFixed(3);
      const finalObp = +(curObp * (1 - rW) + recent.obp * rW).toFixed(3);
      const finalSlg = +(curSlg * (1 - rW) + recent.slg * rW).toFixed(3);

      jsx = jsx.replace(avgRe, `$1${finalAvg}`);
      jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?obp:)[0-9.]+`), `$1${finalObp}`);
      jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?slg:)[0-9.]+`), `$1${finalSlg}`);

      // 동적 recentForm 계산: 최근 OPS vs 시즌 OPS
      const seasonOPS = Math.max(curObp + curSlg, 0.400);
      const recentOPS = recent.obp + recent.slg;
      const formRatio = Math.min(1.15, Math.max(0.85, recentOPS / seasonOPS));
      const clampedForm = Math.min(1.08, Math.max(0.92, formRatio));
      jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?recentForm:\\s*)[0-9.]+`), `$1${clampedForm.toFixed(2)}`);

      hRecentApplied++;
      console.log(`  ${name} (${recent.games}G, rW:${(rW*100).toFixed(0)}%) AVG:${curAvg}→${finalAvg} OBP:${curObp}→${finalObp} SLG:${curSlg}→${finalSlg} form:${clampedForm.toFixed(2)}`);
    }

    console.log('\n⚾ 투수 최근 10경기 오버레이:');
    let pRecentApplied = 0;
    for (const [name, recent] of Object.entries(recentFile.pitchers)) {
      if (recent.games < 1) continue;
      const esc = escRe(name);
      const eraRe = new RegExp(`(name:\\s*"${esc}",.*?era:)[0-9.]+`);
      if (!jsx.match(eraRe)) continue;

      const curEra = +(jsx.match(new RegExp(`name:\\s*"${esc}",.*?era:([0-9.]+)`))?.[1] || 0);
      const curWhip = +(jsx.match(new RegExp(`name:\\s*"${esc}",.*?whip:([0-9.]+)`))?.[1] || 0);
      const curK9 = +(jsx.match(new RegExp(`name:\\s*"${esc}",.*?k9:([0-9.]+)`))?.[1] || 0);
      const curBb9 = +(jsx.match(new RegExp(`name:\\s*"${esc}",.*?bb9:([0-9.]+)`))?.[1] || 0);

      const rW = Math.min(RECENT_MAX_WEIGHT, (recent.games / 10) * RECENT_MAX_WEIGHT);
      const finalEra = +(curEra * (1 - rW) + recent.era * rW).toFixed(2);
      const finalWhip = +(curWhip * (1 - rW) + recent.whip * rW).toFixed(3);
      const finalK9 = +(curK9 * (1 - rW) + recent.k9 * rW).toFixed(1);
      const finalBb9 = +(curBb9 * (1 - rW) + recent.bb9 * rW).toFixed(1);

      jsx = jsx.replace(eraRe, `$1${finalEra}`);
      jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?whip:)[0-9.]+`), `$1${finalWhip}`);
      jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?k9:)[0-9.]+`), `$1${finalK9}`);
      jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?bb9:)[0-9.]+`), `$1${finalBb9}`);

      // 투수 recentForm: 시즌ERA / 최근ERA (낮을수록 좋으므로 역수)
      const seasonERA = Math.max(curEra, 1.0);
      const recentERA = Math.max(recent.era, 1.0);
      const pFormRatio = Math.min(1.15, Math.max(0.85, seasonERA / recentERA));
      const pClampedForm = Math.min(1.08, Math.max(0.92, pFormRatio));
      jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?recentForm:\\s*)[0-9.]+`), `$1${pClampedForm.toFixed(2)}`);

      pRecentApplied++;
      console.log(`  ${name} (${recent.games}G, rW:${(rW*100).toFixed(0)}%) ERA:${curEra}→${finalEra} WHIP:${curWhip}→${finalWhip} form:${pClampedForm.toFixed(2)}`);
    }

    console.log(`\n  최근 10경기 적용: 타자 ${hRecentApplied}명, 투수 ${pRecentApplied}명`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer 1B: 팀 레이팅 동적 블렌딩 (v9.1)
  // 2026 시즌 전적(team-stats.json) × 2025 prior 베이지안 회귀
  // - LEGACY_TEAM_RATINGS_2025를 prior로 사용 (idempotent: 매 실행 동일 결과)
  // - KBO_TEAMS 블록 내 정의(`id: "{teamId}"` 시그니처)만 매칭하여 H2H 충돌 방지
  // ═══════════════════════════════════════════════════════════════
  const LEGACY_TEAM_RATINGS_2025 = {
    samsung: 83, kia: 72, lg: 90, doosan: 78, kt: 76,
    ssg: 78, hanwha: 75, lotte: 80, nc: 78, kiwoom: 58,
  };

  let teamRatingsApplied = 0;
  let momentumApplied = 0;
  // 스냅샷 모드: team-stats-snapshots/team-stats-{snapshot}.json
  // 기본: team-stats.json
  const teamFilePath = opts.snapshot
    ? `team-stats-snapshots/team-stats-${opts.snapshot}.json`
    : 'team-stats.json';
  if (fs.existsSync(teamFilePath)) {
    const teamFile = JSON.parse(fs.readFileSync(teamFilePath, 'utf8'));
    console.log(`\n🏆 팀 레이팅 동적 블렌딩 (${teamFile.crawlDate}, source=${teamFilePath})`);

    // rating 공식: 50 + (pct-0.5)*80 + runDiff/G * 3, 클램프 [40, 100]
    function calcRating(t) {
      const base = 50 + (t.pct - 0.5) * 80 + t.runDiffPerGame * 3;
      return Math.max(40, Math.min(100, base));
    }

    for (const [teamId, t] of Object.entries(teamFile.teams)) {
      const prior = LEGACY_TEAM_RATINGS_2025[teamId];
      if (prior == null) continue;

      const rating2026 = calcRating(t);
      const w = Math.min(1.0, t.g / 30);
      let newRating = Math.round(rating2026 * w + prior * (1 - w));

      // Layer 2C: 모멘텀 보정 (v9.2/9.4) — 가중치/함수 형태 파라미터화
      let momentum = 0;
      if (!opts.noMomentum) {
        // last10 컴포넌트
        if (t.last10pct != null) {
          if (opts.momFn === 'threshold') {
            // 임계값 방식: 0.7 이상 또는 0.3 이하만 활성
            if (t.last10pct >= 0.7) momentum += opts.momL10 / 2;
            else if (t.last10pct <= 0.3) momentum -= opts.momL10 / 2;
          } else {
            // linear (기본): (pct-0.5) × weight
            const half = opts.momL10 / 2;
            momentum += Math.max(-half, Math.min(half, (t.last10pct - 0.5) * opts.momL10));
          }
        }
        // streak 컴포넌트 (3+ 연속만)
        if (Math.abs(t.streak) >= 3) {
          momentum += Math.max(-2, Math.min(2, t.streak * opts.momStreak));
        }
        momentum = Math.round(momentum);
        if (momentum !== 0) momentumApplied++;
      }
      newRating = Math.max(40, Math.min(100, newRating + momentum));

      // KBO_TEAMS 블록 한정 매칭: `{teamId}: { id: "{teamId}"` 시그니처 사용
      // teamRating: \d+ 한 곳만 정확히 갱신 (record 필드는 별도)
      const ratingRe = new RegExp(
        `(${teamId}:\\s*\\{\\s*id:\\s*"${teamId}"[\\s\\S]*?teamRating:\\s*)\\d+`
      );
      const recordRe = new RegExp(
        `(${teamId}:\\s*\\{\\s*id:\\s*"${teamId}"[\\s\\S]*?record:\\s*\\{)[^}]*?(\\})`
      );

      if (!jsx.match(ratingRe)) {
        console.log(`  [SKIP] ${teamId}: KBO_TEAMS 블록 매칭 실패`);
        continue;
      }

      jsx = jsx.replace(ratingRe, `$1${newRating}`);
      const newRecord = ` w:${t.w}, t:${t.t}, l:${t.l}, pct:"${t.pct.toFixed(3)}", rs:${t.rs}, ra:${t.ra} `;
      jsx = jsx.replace(recordRe, `$1${newRecord}$2`);

      teamRatingsApplied++;
      const arrow = newRating > prior ? '↑' : newRating < prior ? '↓' : '=';
      const momStr = momentum !== 0 ? ` mom:${momentum > 0 ? '+' : ''}${momentum}` : '';
      console.log(`  ${t.teamKR.padEnd(4)} ${prior}→${newRating} ${arrow} (${t.g}경기, w=${(w*100).toFixed(0)}%, pct=${t.pct.toFixed(3)}, runDiff/G=${t.runDiffPerGame > 0 ? '+' : ''}${t.runDiffPerGame}, last10=${t.last10raw || '-'}, streak=${t.streakRaw || '-'}${momStr})`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer 1C: 누락 선발투수 자동 등록 (v9.1)
  // schedule-today.json의 선발이 KBO_TEAMS.starters[]에 없으면 자동 추가
  // - 1순위: recent-stats.json의 최근10경기 실측치
  // - 2순위: 팀 bullpen 평균치 + recentForm 1.0
  // ═══════════════════════════════════════════════════════════════
  let newStartersAdded = 0;
  if (fs.existsSync('schedule-today.json')) {
    const schedule = JSON.parse(fs.readFileSync('schedule-today.json', 'utf8'));
    console.log(`\n🆕 누락 선발투수 확인 (${schedule.date}, ${schedule.games.length}경기)`);

    // 팀별 starters 추출 헬퍼
    function teamStartersBlock(teamId) {
      const re = new RegExp(`${teamId}:\\s*\\{\\s*id:\\s*"${teamId}"[\\s\\S]*?starters:\\s*\\[([\\s\\S]*?)\\]`);
      return jsx.match(re);
    }
    function hasStarter(teamId, name) {
      const m = teamStartersBlock(teamId);
      if (!m) return true; // 못찾으면 추가 시도 안 함
      return new RegExp(`name:\\s*"${name}"`).test(m[1]);
    }
    function teamBullpen(teamId) {
      const re = new RegExp(`${teamId}:\\s*\\{\\s*id:\\s*"${teamId}"[\\s\\S]*?bullpen:\\s*\\{([^}]+)\\}`);
      const m = jsx.match(re);
      if (!m) return null;
      const obj = {};
      m[1].replace(/(\w+):\s*([0-9.]+)/g, (_, k, v) => obj[k] = parseFloat(v));
      return obj;
    }

    function addStarter(teamId, name, stats) {
      const re = new RegExp(`(${teamId}:\\s*\\{\\s*id:\\s*"${teamId}"[\\s\\S]*?starters:\\s*\\[[\\s\\S]*?)\\]`);
      const entry = `,\n      { name: "${name}", throws: "R", era:${stats.era}, whip:${stats.whip}, k9:${stats.k9}, bb9:${stats.bb9}, ip:${stats.ip}, recentForm: ${stats.recentForm}, war:${stats.war} }`;
      jsx = jsx.replace(re, `$1${entry}]`);
    }

    const recent = recentFile;
    const targets = [];
    for (const g of schedule.games) {
      if (g.awaySP) targets.push({ teamId: g.awayId, name: g.awaySP });
      if (g.homeSP) targets.push({ teamId: g.homeId, name: g.homeSP });
    }

    for (const { teamId, name } of targets) {
      if (!teamId || !name) continue;
      if (hasStarter(teamId, name)) continue;

      // 1순위: recent-stats.json 실측치
      let stats, source;
      if (recent && recent.pitchers && recent.pitchers[name]) {
        const r = recent.pitchers[name];
        stats = {
          era: r.era.toFixed(2),
          whip: r.whip.toFixed(3),
          k9: r.k9.toFixed(1),
          bb9: r.bb9.toFixed(1),
          ip: 30,
          recentForm: 1.0,
          war: 0.5,
        };
        source = 'recent10';
      } else {
        // 2순위: 팀 bullpen 평균
        const bp = teamBullpen(teamId) || { era: 4.0, whip: 1.30, k9: 7.5, bb9: 3.2 };
        stats = {
          era: bp.era.toFixed(2),
          whip: bp.whip.toFixed(3),
          k9: bp.k9.toFixed(1),
          bb9: bp.bb9.toFixed(1),
          ip: 30,
          recentForm: 1.0,
          war: 0.3,
        };
        source = 'bullpen_avg';
      }

      addStarter(teamId, name, stats);
      newStartersAdded++;
      console.log(`  [NEW] ${teamId.padEnd(8)} ${name} 등록 (출처: ${source}, ERA:${stats.era})`);
    }
    if (newStartersAdded === 0) {
      console.log('  ✅ 모든 선발투수가 이미 등록되어 있음');
    }
  }

  // ── 요약 ──
  console.log('\n' + '='.repeat(60));
  console.log('📊 블렌딩 결과 요약');
  console.log('='.repeat(60));
  console.log(`Layer 1 - 베이지안: 타자 ${hUpdated}명 (2025: ${hUsed2025}, 리그avg: ${hUsedLeague}) + ${hCarryover}명 캐리오버`);
  console.log(`Layer 1 - 베이지안: 투수 ${pUpdated}명 (2025: ${pUsed2025}, 리그avg: ${pUsedLeague}) + ${pCarryover}명 캐리오버`);
  console.log(`Layer 2 - 최근10경기: ${recentFile ? '적용됨' : 'recent-stats.json 없음 (node crawl-recent.mjs 실행 필요)'}`);
  console.log(`Layer 1B - 팀 레이팅: ${teamRatingsApplied}개 팀 동적 갱신`);
  console.log(`Layer 1C - 누락 선발: ${newStartersAdded}명 자동 등록`);
  console.log(`Layer 2C - 모멘텀: ${momentumApplied}개 팀 보정 적용 (last10/streak)`);
  console.log(`회귀상수: REG_PA=${REG_PA}, REG_IP=${REG_IP}, 최근10경기 max weight=${RECENT_MAX_WEIGHT*100}%`);

  fs.writeFileSync('kbo-simulation.jsx', jsx);
  console.log('\nkbo-simulation.jsx 저장 완료!');
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
