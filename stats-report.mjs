import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// stats-report.mjs (v9.2)
// prediction-log.json 누적 데이터 → 종합/신뢰도/팀별/주별 적중률 리포트
// ═══════════════════════════════════════════════════════════════

const LOG_FILE = 'prediction-log.json';

function pad(s, n) { return String(s).padEnd(n); }
function pct(hits, total) {
  return total > 0 ? `${(hits / total * 100).toFixed(1)}%` : '-';
}

function weekKey(dateStr) {
  const d = new Date(dateStr);
  // ISO week-ish: 시즌 시작(3월 마지막 주)부터의 주차
  const start = new Date('2026-03-23'); // 월요일
  const diff = Math.floor((d - start) / 86400000 / 7);
  return `W${String(diff + 1).padStart(2, '0')}`;
}

function compareReport(log) {
  // 같은 (date, away, home) 키로 매칭하여 버전별 적중 비교
  console.log('='.repeat(70));
  console.log(`📊 KBO 예측 버전 비교 리포트 (--compare 모드)`);
  console.log('='.repeat(70));

  // 버전 → 경기 맵
  const byVersion = {};
  for (const p of log.predictions) {
    if (!byVersion[p.version]) byVersion[p.version] = [];
    for (const g of p.games) {
      if (g.hit !== null) {
        byVersion[p.version].push({ ...g, date: p.date });
      }
    }
  }
  if (Object.keys(byVersion).length === 0) {
    console.log('확정된 결과 없음');
    return;
  }

  // 버전별 종합
  console.log('\n버전별 적중률:');
  for (const [v, games] of Object.entries(byVersion)) {
    const hits = games.filter(g => g.hit).length;
    console.log(`  ${pad(v, 16)} ${pad(`${hits}/${games.length}`, 8)} ${pct(hits, games.length)}`);
  }

  // 같은 경기 매칭 (모든 버전이 예측한 경기만)
  const versionList = Object.keys(byVersion);
  if (versionList.length < 2) return;
  const v0 = versionList[0];
  const matched = [];
  for (const g0 of byVersion[v0]) {
    const key = `${g0.date}|${g0.away}|${g0.home}`;
    const allVersions = {};
    let allFound = true;
    for (const v of versionList) {
      const m = byVersion[v].find(g => `${g.date}|${g.away}|${g.home}` === key);
      if (!m) { allFound = false; break; }
      allVersions[v] = m;
    }
    if (allFound) matched.push({ key, ...allVersions });
  }

  console.log(`\n같은 경기 매칭: ${matched.length}건`);
  if (matched.length === 0) return;

  console.log('\n경기별 비교 (예측 결과 + 적중 여부):');
  console.log(pad('날짜', 12) + pad('경기', 18) + versionList.map(v => pad(v, 18)).join('') + '실제');
  console.log('─'.repeat(70 + versionList.length * 18));
  for (const m of matched) {
    const game = m[v0];
    const actual = `${game.actualAway}-${game.actualHome}`;
    const cells = versionList.map(v => {
      const e = m[v];
      const mark = e.hit ? '✅' : '❌';
      return pad(`${mark} ${e.predWinner} ${e.confidence}`, 18);
    });
    console.log(pad(game.date.slice(5), 12) + pad(`${game.away}@${game.home}`, 18) + cells.join('') + actual);
  }

  // 차이 분석
  if (versionList.length === 2) {
    const [vA, vB] = versionList;
    const diff = matched.filter(m => m[vA].hit !== m[vB].hit);
    console.log(`\n${vA} vs ${vB} 차이: ${diff.length}건`);
    let aWin = 0, bWin = 0;
    for (const m of diff) {
      if (m[vA].hit) aWin++;
      else bWin++;
    }
    console.log(`  ${vA} 우위: ${aWin}건`);
    console.log(`  ${vB} 우위: ${bWin}건`);
    const aHits = byVersion[vA].filter(g => g.hit).length;
    const bHits = byVersion[vB].filter(g => g.hit).length;
    const aPct = aHits / byVersion[vA].length;
    const bPct = bHits / byVersion[vB].length;
    const delta = ((bPct - aPct) * 100).toFixed(1);
    console.log(`  순효과: ${vB} ${delta > 0 ? '+' : ''}${delta}%p (${pct(bHits, byVersion[vB].length)} vs ${pct(aHits, byVersion[vA].length)})`);
  }
}

// ── 그리드 서치 리포트 (v9.4) ──
function gridReport(log) {
  console.log('='.repeat(70));
  console.log(`📊 모멘텀 가중치 그리드 서치 리포트`);
  console.log('='.repeat(70));

  // grid-l{N}-s{M}-{fn} 태그만
  const re = /^grid-l(\d+(?:\.\d+)?)-s(\d+(?:\.\d+)?)-(linear|threshold)$/;
  const cells = {}; // key: l|s|fn → { hits, total }
  for (const p of log.predictions) {
    const m = p.version.match(re);
    if (!m) continue;
    const key = `${m[1]}|${m[2]}|${m[3]}`;
    if (!cells[key]) cells[key] = { hits: 0, total: 0, l10: +m[1], streak: +m[2], fn: m[3] };
    for (const g of p.games) {
      if (g.hit !== null) {
        cells[key].total++;
        if (g.hit) cells[key].hits++;
      }
    }
  }

  if (Object.keys(cells).length === 0) {
    console.log('grid-* 태그 항목 없음. node grid-search.mjs 먼저 실행');
    return;
  }

  // 매트릭스 출력 (linear만, l10 행 × streak 열)
  const linearCells = Object.values(cells).filter(c => c.fn === 'linear');
  const l10Vals = [...new Set(linearCells.map(c => c.l10))].sort((a, b) => a - b);
  const sVals = [...new Set(linearCells.map(c => c.streak))].sort((a, b) => a - b);

  console.log(`\nLinear 함수 매트릭스 (행=l10 가중치, 열=streak 가중치):\n`);
  // 헤더
  let header = pad('l10\\streak', 12);
  for (const s of sVals) header += pad(`s=${s}`, 14);
  console.log(header);
  console.log('─'.repeat(12 + sVals.length * 14));

  let bestKey = null, bestPct = -1;
  for (const l10 of l10Vals) {
    let row = pad(`l=${l10}`, 12);
    for (const s of sVals) {
      const c = linearCells.find(x => x.l10 === l10 && x.streak === s);
      if (c) {
        const pctVal = c.total > 0 ? c.hits / c.total : 0;
        const cell = `${c.hits}/${c.total} ${(pctVal*100).toFixed(1)}%`;
        row += pad(cell, 14);
        if (pctVal > bestPct && c.total >= 30) {
          bestPct = pctVal;
          bestKey = `l=${l10}, s=${s}`;
        }
      } else {
        row += pad('-', 14);
      }
    }
    console.log(row);
  }
  console.log(`\n🏆 최고: ${bestKey} = ${(bestPct*100).toFixed(1)}%`);

  // McNemar 검정: l=0,s=0 (베이스라인) vs 최고
  const baseline = linearCells.find(c => c.l10 === 0 && c.streak === 0);
  const best = linearCells.find(c => `l=${c.l10}, s=${c.streak}` === bestKey);
  if (baseline && best && baseline !== best) {
    mcnemarTest(log, `grid-l0-s0-linear`, `grid-l${best.l10}-s${best.streak}-linear`);
  }
}

// McNemar 검정 (v9.4)
function mcnemarTest(log, vA, vB) {
  // 같은 (date, away, home)에서 두 버전의 hit 비교
  const map = {};
  for (const p of log.predictions) {
    if (p.version !== vA && p.version !== vB) continue;
    for (const g of p.games) {
      if (g.hit === null) continue;
      const key = `${p.date}|${g.away}|${g.home}`;
      if (!map[key]) map[key] = {};
      map[key][p.version] = g.hit;
    }
  }
  let aOnly = 0, bOnly = 0, both = 0, neither = 0;
  for (const k of Object.keys(map)) {
    const a = map[k][vA], b = map[k][vB];
    if (a == null || b == null) continue;
    if (a && b) both++;
    else if (a && !b) aOnly++;
    else if (!a && b) bOnly++;
    else neither++;
  }
  const n = both + aOnly + bOnly + neither;
  // McNemar χ² (continuity correction): (|b-c|-1)² / (b+c)
  const disc = aOnly + bOnly;
  if (disc === 0) {
    console.log(`\nMcNemar (${vA} vs ${vB}): 차이 없음 (n=${n})`);
    return;
  }
  const chi2 = Math.pow(Math.abs(aOnly - bOnly) - 1, 2) / disc;
  // p-value 근사 (df=1, χ²): 1-chi-square CDF
  // p ≈ exp(-chi2/2) 단순 근사
  const p = Math.exp(-chi2 / 2);
  console.log(`\n🧪 McNemar 검정: ${vA} vs ${vB}`);
  console.log(`   매칭 ${n}건: 둘다✓ ${both}, ${vA}만✓ ${aOnly}, ${vB}만✓ ${bOnly}, 둘다✗ ${neither}`);
  console.log(`   χ² = ${chi2.toFixed(2)}, p ≈ ${p.toFixed(3)} ${p < 0.05 ? '(유의)' : p < 0.10 ? '(약한 유의)' : '(유의 아님)'}`);
  console.log(`   효과 크기: ${vB} ${bOnly > aOnly ? '+' : ''}${bOnly - aOnly}건 우위`);
}

function main() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`❌ ${LOG_FILE} 없음`);
    process.exit(1);
  }
  const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));

  if (process.argv.includes('--grid')) {
    return gridReport(log);
  }
  if (process.argv.includes('--compare')) {
    return compareReport(log);
  }

  // 확정 결과만
  const all = [];
  for (const p of log.predictions) {
    for (const g of p.games) {
      if (g.hit !== null) all.push({ ...g, date: p.date, version: p.version, week: weekKey(p.date) });
    }
  }

  if (all.length === 0) {
    console.log('📭 확정된 예측 결과 없음. node verify-yesterday.mjs 실행 필요');
    return;
  }

  console.log('='.repeat(60));
  console.log(`📊 KBO 예측 적중률 리포트 (v9.2)`);
  console.log('='.repeat(60));
  console.log(`기간: ${all[0].date} ~ ${all[all.length - 1].date}`);
  console.log(`샘플: ${all.length}경기`);

  // ── 전체 적중률 ──
  const hits = all.filter(g => g.hit).length;
  console.log(`\n🎯 전체 적중률: ${hits}/${all.length} = ${pct(hits, all.length)}`);

  // ── 신뢰도별 ──
  console.log(`\n📌 신뢰도별 적중률`);
  for (const conf of ['★★★', '★★', '★']) {
    const subset = all.filter(g => g.confidence === conf);
    const h = subset.filter(g => g.hit).length;
    console.log(`  ${pad(conf, 6)} ${pad(`${h}/${subset.length}`, 8)} ${pct(h, subset.length)}`);
  }

  // ── 팀별 적중률 ──
  console.log(`\n🏟️  팀별 적중률 (홈/원정 합산)`);
  const teamStats = {};
  for (const g of all) {
    for (const team of [g.home, g.away]) {
      if (!teamStats[team]) teamStats[team] = { hit: 0, total: 0 };
      teamStats[team].total++;
      if (g.hit) teamStats[team].hit++;
    }
  }
  const sortedTeams = Object.entries(teamStats)
    .sort((a, b) => (b[1].hit / b[1].total) - (a[1].hit / a[1].total));
  for (const [t, s] of sortedTeams) {
    console.log(`  ${pad(t, 5)} ${pad(`${s.hit}/${s.total}`, 8)} ${pct(s.hit, s.total)}`);
  }

  // ── 주별 ──
  console.log(`\n📅 주별 적중률`);
  const weekStats = {};
  for (const g of all) {
    if (!weekStats[g.week]) weekStats[g.week] = { hit: 0, total: 0 };
    weekStats[g.week].total++;
    if (g.hit) weekStats[g.week].hit++;
  }
  for (const [w, s] of Object.entries(weekStats).sort()) {
    console.log(`  ${w}  ${pad(`${s.hit}/${s.total}`, 8)} ${pct(s.hit, s.total)}`);
  }

  // ── 일자별 ──
  console.log(`\n📆 일자별 적중률`);
  const dayStats = {};
  for (const g of all) {
    if (!dayStats[g.date]) dayStats[g.date] = { hit: 0, total: 0 };
    dayStats[g.date].total++;
    if (g.hit) dayStats[g.date].hit++;
  }
  for (const [d, s] of Object.entries(dayStats).sort()) {
    console.log(`  ${d}  ${pad(`${s.hit}/${s.total}`, 8)} ${pct(s.hit, s.total)}`);
  }

  console.log('\n' + '='.repeat(60));
}

main();
