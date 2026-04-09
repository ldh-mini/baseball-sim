import fs from 'fs';
import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════════
// predict-snapshot.mjs (v9.2)
// 시점기반 백테스트 러너
// 사용법: node predict-snapshot.mjs YYYY-MM-DD [endDate]
//
// 각 날짜 D에 대해:
//   1. D-1 시점 스냅샷 강제 로드 (team-stats-snapshots/team-stats-{D-1}.json)
//   2. blend-stats.mjs --snapshot {D-1} 실행
//   3. crawl-schedule.mjs D 실행
//   4. sim-today.mjs schedule-{D}.json --log 실행
//
// ⚠️  D-1 스냅샷이 존재해야 함. 미래 운영 시작 후 1주일 이상 누적 필요.
// ═══════════════════════════════════════════════════════════════

const SNAP_DIR = 'team-stats-snapshots';

function dateMinusOne(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function snapshotExists(dateStr) {
  const fname = `${SNAP_DIR}/team-stats-${dateStr.replace(/-/g, '')}.json`;
  return fs.existsSync(fname);
}

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || e.message };
  }
}

function predictDay(targetDate, opts = {}) {
  const { abMomentum = false, abCalibration = false } = opts;
  const label = abMomentum ? ' (A/B 모멘텀)' : abCalibration ? ' (A/B calibration)' : '';
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📅 ${targetDate} 시점 예측${label}`);
  console.log('═'.repeat(60));

  const prevDate = dateMinusOne(targetDate);
  const prevSnap = prevDate.replace(/-/g, '');

  if (!snapshotExists(prevDate)) {
    console.log(`❌ ${prevDate} 스냅샷 없음 → 스킵`);
    console.log(`   필요 파일: ${SNAP_DIR}/team-stats-${prevSnap}.json`);
    return false;
  }
  console.log(`✓ D-1 스냅샷 사용: ${prevDate}`);

  // schedule for target day (한 번만)
  console.log(`\n[1] crawl-schedule ${targetDate}`);
  let r = run(`node crawl-schedule.mjs ${targetDate}`);
  if (!r.ok) { console.error('  ❌', r.err); return false; }
  const schedFile = `schedule-${targetDate}.json`;
  fs.copyFileSync('schedule-today.json', schedFile);

  // 실행할 버전 목록
  let variants;
  if (abMomentum) {
    variants = [
      { tag: 'v9.1-no-mom', blendArgs: `--snapshot ${prevSnap} --no-momentum`, simArgs: '' },
      { tag: 'v9.2-mom',    blendArgs: `--snapshot ${prevSnap}`,                simArgs: '' },
    ];
  } else if (abCalibration) {
    variants = [
      { tag: 'v9.2-temp1.0', blendArgs: `--snapshot ${prevSnap}`, simArgs: '--temp 1.0' },
      { tag: 'v9.5-temp0.7', blendArgs: `--snapshot ${prevSnap}`, simArgs: '--temp 0.7' },
      { tag: 'v9.5-temp0.5', blendArgs: `--snapshot ${prevSnap}`, simArgs: '--temp 0.5' },
    ];
  } else {
    variants = [
      { tag: 'v9.2', blendArgs: `--snapshot ${prevSnap}`, simArgs: '' },
    ];
  }

  for (const v of variants) {
    console.log(`\n[2:${v.tag}] blend-stats ${v.blendArgs}`);
    r = run(`node blend-stats.mjs ${v.blendArgs}`);
    if (!r.ok) { console.error('  ❌', r.err); return false; }
    const teamLine = r.out.split('\n').filter(l => l.includes('팀 레이팅')).slice(0, 1);
    if (teamLine[0]) console.log('  ', teamLine[0].trim());

    console.log(`\n[3:${v.tag}] sim-today ${schedFile} --version ${v.tag} ${v.simArgs}`);
    r = run(`node sim-today.mjs ${schedFile} --log --quiet --version ${v.tag} ${v.simArgs}`);
    if (!r.ok) { console.error('  ❌', r.err); return false; }
    const log = JSON.parse(fs.readFileSync('prediction-log.json', 'utf8'));
    const entry = log.predictions.find(p => p.date === targetDate && p.version === v.tag);
    if (entry) {
      for (const g of entry.games) {
        const pct = g.predHomePct >= 50 ? g.predHomePct : g.predAwayPct;
        console.log(`  ${g.away} @ ${g.home}: ${g.predWinner} ${g.confidence} (${pct}%)`);
      }
    }
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const start = positional[0];
  const end = positional[1] || start;
  const abIdx = args.indexOf('--ab');
  const abMode = abIdx >= 0 ? args[abIdx + 1] : null;
  const abMomentum = abMode === 'momentum';
  const abCalibration = abMode === 'calibration';

  if (!start) {
    console.error('사용법: node predict-snapshot.mjs YYYY-MM-DD [endDate] [--ab momentum|calibration]');
    process.exit(1);
  }

  const label = abMomentum ? ' (A/B momentum)' : abCalibration ? ' (A/B calibration)' : '';
  console.log(`🎯 시점기반 백테스트: ${start} ~ ${end}${label}\n`);

  let processed = 0, skipped = 0;
  const startD = new Date(start);
  const endD = new Date(end);
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const ok = predictDay(dateStr, { abMomentum, abCalibration });
    if (ok) processed++;
    else skipped++;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`완료: ${processed}일 처리, ${skipped}일 스킵`);
  console.log('다음: node verify-yesterday.mjs YYYY-MM-DD 로 결과 검증');
  console.log('또는: node stats-report.mjs 로 누적 통계');
}

main().catch(e => { console.error(e); process.exit(1); });
