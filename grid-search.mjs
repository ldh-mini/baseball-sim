import fs from 'fs';
import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════════
// grid-search.mjs (v9.4)
// 모멘텀 가중치 (l10 × streak × fn) 매트릭스 일괄 백테스트
// 사용법: node grid-search.mjs YYYY-MM-DD endDate [year2 endDate2 ...]
// 또는: node grid-search.mjs --auto  (4/3~4/6 2025+2026 자동)
// ═══════════════════════════════════════════════════════════════

const SNAP_DIR = 'team-stats-snapshots';

// 그리드 정의 (보수적: 9개 조합)
const GRID = {
  l10: [0, 5, 10, 15, 20],
  streak: [0, 0.5, 1.0],
  fn: ['linear'],  // threshold는 향후 별도 비교
};

function dateMinusOne(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function snapshotExists(dateStr) {
  return fs.existsSync(`${SNAP_DIR}/team-stats-${dateStr.replace(/-/g, '')}.json`);
}

function run(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, err: e.stderr || e.message };
  }
}

function predictGridDay(targetDate, variants) {
  const prevDate = dateMinusOne(targetDate);
  const prevSnap = prevDate.replace(/-/g, '');
  if (!snapshotExists(prevDate)) return false;

  // 일정 한 번만
  let r = run(`node crawl-schedule.mjs ${targetDate}`);
  if (!r.ok) return false;
  const schedFile = `schedule-${targetDate}.json`;
  fs.copyFileSync('schedule-today.json', schedFile);

  for (const v of variants) {
    const blendCmd = `node blend-stats.mjs --snapshot ${prevSnap} --mom-l10 ${v.l10} --mom-streak ${v.streak} --mom-fn ${v.fn}`;
    r = run(blendCmd);
    if (!r.ok) { console.error(`  ❌ blend ${v.tag}:`, r.err.slice(0, 200)); continue; }

    r = run(`node sim-today.mjs ${schedFile} --log --quiet --version ${v.tag}`);
    if (!r.ok) { console.error(`  ❌ sim ${v.tag}:`, r.err.slice(0, 200)); continue; }
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  // 기본: 2025-04-03~06 + 2026-04-01~05 자동
  let dateRanges;
  if (args.length === 0 || args[0] === '--auto') {
    dateRanges = [
      ['2025-04-03', '2025-04-06'],
      ['2026-04-01', '2026-04-05'],
    ];
  } else {
    dateRanges = [];
    for (let i = 0; i + 1 < args.length; i += 2) {
      dateRanges.push([args[i], args[i+1]]);
    }
  }

  // 그리드 변형 생성
  const variants = [];
  for (const fn of GRID.fn) {
    for (const l10 of GRID.l10) {
      for (const s of GRID.streak) {
        variants.push({
          l10, streak: s, fn,
          tag: `grid-l${l10}-s${s}-${fn}`,
        });
      }
    }
  }
  console.log(`🔬 그리드 서치: ${variants.length}개 변형 × ${dateRanges.length}개 날짜 범위`);
  console.log('변형 목록:');
  for (const v of variants) console.log(`  ${v.tag}`);
  console.log('');

  // 모든 날짜 수집
  const allDates = [];
  for (const [start, end] of dateRanges) {
    for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().slice(0, 10));
    }
  }
  console.log(`📅 ${allDates.length}일 처리:`, allDates.join(', '));

  let processed = 0, skipped = 0;
  for (const date of allDates) {
    process.stdout.write(`\n[${date}] `);
    const ok = predictGridDay(date, variants);
    if (ok) {
      processed++;
      process.stdout.write(`✅ (${variants.length} variants)`);
    } else {
      skipped++;
      process.stdout.write(`⏭️ skip`);
    }
  }

  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`✅ 완료: ${processed}일 처리, ${skipped}일 스킵`);
  console.log(`다음:`);
  console.log(`  for d in ${allDates.join(' ')}; do node verify-yesterday.mjs $d; done`);
  console.log(`  node stats-report.mjs --grid`);
}

main().catch(e => { console.error(e); process.exit(1); });
