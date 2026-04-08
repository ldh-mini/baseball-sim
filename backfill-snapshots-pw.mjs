import fs from 'fs';
import { chromium } from 'playwright';

// ═══════════════════════════════════════════════════════════════
// backfill-snapshots-pw.mjs (v9.3)
// Playwright 헤드리스로 KBO TeamRankDaily 페이지 크롤링
// HTTP 직접 호출이 봇차단되는 문제를 우회
// 사용법: node backfill-snapshots-pw.mjs YYYY-MM-DD [endDate]
// ═══════════════════════════════════════════════════════════════

const URL = 'https://www.koreabaseball.com/Record/TeamRank/TeamRankDaily.aspx';
const SNAP_DIR = 'team-stats-snapshots';

const NM = {
  '삼성':'samsung','KIA':'kia','LG':'lg','두산':'doosan','KT':'kt',
  'SSG':'ssg','한화':'hanwha','롯데':'lotte','NC':'nc','키움':'kiwoom'
};

function parseLast10Pct(s) {
  if (!s) return null;
  const m = s.match(/(\d+)승(?:(\d+)무)?(\d+)패/);
  if (!m) return null;
  const w = +m[1], l = +m[3];
  return (w + l) > 0 ? w / (w + l) : null;
}
function parseStreak(s) {
  if (!s) return 0;
  const m = s.match(/(\d+)(승|패)/);
  if (!m) return 0;
  return parseInt(m[1]) * (m[2] === '승' ? 1 : -1);
}

async function readCurrentDate(page) {
  return await page.evaluate(() => {
    const hf = document.querySelector('#cphContents_cphContents_cphContents_hfSearchDate');
    return hf?.value?.trim() || '';
  });
}

async function snapshotForDate(page, targetDate) {
  // targetDate "YYYY-MM-DD"
  const yyyymmdd = targetDate.replace(/-/g, '');
  const [y, mo, da] = targetDate.split('-');
  console.log(`\n📅 ${targetDate} 백필 중...`);

  // 페이지가 로드되지 않았으면 로드
  let curDate = await readCurrentDate(page);
  if (!curDate) {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    curDate = await readCurrentDate(page);
  }

  // 이미 목표 날짜면 그대로
  if (curDate !== yyyymmdd) {
    // datepicker 트리거 클릭 → 달력 열기
    await page.click('.ui-datepicker-trigger');
    await page.waitForSelector('select.ui-datepicker-month');
    await page.waitForTimeout(200);

    // year/month 드롭다운으로 직접 이동 (month는 0-based: 0=1월, 3=4월)
    await page.selectOption('select.ui-datepicker-year', String(parseInt(y)));
    await page.waitForTimeout(150);
    await page.selectOption('select.ui-datepicker-month', String(parseInt(mo) - 1));
    await page.waitForTimeout(300);

    // 해당 일자 클릭
    const dayNum = parseInt(da);
    const clicked = await page.evaluate((d) => {
      const cells = Array.from(document.querySelectorAll('.ui-datepicker-calendar td'));
      const target = cells.find(td => {
        if (td.classList.contains('ui-state-disabled')) return false;
        const a = td.querySelector('a');
        return a && a.textContent.trim() === String(d);
      });
      if (target) {
        target.querySelector('a').click();
        return true;
      }
      return false;
    }, dayNum);

    if (!clicked) {
      console.log(`  ⚠️  ${targetDate}: 달력에서 일자 클릭 실패 (경기 미개최일 가능)`);
      return false;
    }

    // PostBack 후 페이지 재렌더 대기
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    const newDate = await readCurrentDate(page);
    if (newDate !== yyyymmdd) {
      console.log(`  ⚠️  날짜 도달 실패: 목표=${yyyymmdd}, 현재=${newDate}`);
      return false;
    }
  }

  // 테이블 데이터 추출
  const teams = await page.evaluate((NM) => {
    const out = {};
    const rows = document.querySelectorAll('tbody tr');
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
      if (cells.length < 7) continue;
      const teamKR = cells[1];
      const id = NM[teamKR];
      if (!id) continue;
      out[id] = {
        teamKR,
        g: parseInt(cells[2]) || 0,
        w: parseInt(cells[3]) || 0,
        l: parseInt(cells[4]) || 0,
        t: parseInt(cells[5]) || 0,
        pct: parseFloat(cells[6]) || 0,
        last10raw: cells[8] || '',
        streakRaw: cells[9] || '',
      };
    }
    return out;
  }, NM);

  if (Object.keys(teams).length === 0) {
    console.log(`  ❌ 파싱 실패`);
    return false;
  }

  // 모멘텀 필드 채우기
  for (const id of Object.keys(teams)) {
    const t = teams[id];
    const last10pct = parseLast10Pct(t.last10raw);
    t.last10pct = last10pct != null ? +last10pct.toFixed(3) : null;
    t.streak = parseStreak(t.streakRaw);
    // rs/ra는 별도 누적 계산 (3단계)에서 채울 예정. 지금은 0
    t.rs = 0; t.ra = 0; t.runDiff = 0; t.runDiffPerGame = 0;
  }

  // 저장
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR);
  const snapDate = targetDate.replace(/-/g, '');
  const snapFile = `${SNAP_DIR}/team-stats-${snapDate}.json`;
  fs.writeFileSync(snapFile, JSON.stringify({
    crawlDate: targetDate,
    crawlTime: new Date().toISOString(),
    source: 'playwright-backfill',
    teams,
  }, null, 2));

  console.log(`  ✅ ${snapFile} (${Object.keys(teams).length}팀)`);
  // 요약 (정렬: pct desc)
  const sorted = Object.entries(teams).sort((a, b) => b[1].pct - a[1].pct);
  for (const [id, t] of sorted) {
    console.log(`    ${t.teamKR.padEnd(4)} ${t.g}경기 ${t.w}-${t.l}-${t.t} pct=${t.pct.toFixed(3)} last10=${t.last10raw} streak=${t.streakRaw}`);
  }
  return true;
}

async function main() {
  const start = process.argv[2];
  const end = process.argv[3] || start;
  if (!start) {
    console.error('사용법: node backfill-snapshots-pw.mjs YYYY-MM-DD [endDate]');
    process.exit(1);
  }

  console.log(`🎬 Playwright 시작: ${start} ~ ${end}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  let success = 0, fail = 0;
  const startD = new Date(start);
  const endD = new Date(end);
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const ok = await snapshotForDate(page, dateStr);
      if (ok) success++; else fail++;
    } catch (e) {
      console.error(`  ❌ ${dateStr}: ${e.message}`);
      fail++;
    }
    await page.waitForTimeout(1500); // 봇 의심 회피
  }

  await browser.close();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ 완료: ${success}일 성공, ${fail}일 실패`);
  console.log(`다음: node compute-historical-rsra.mjs 로 득실점 보강`);
}

main().catch(e => { console.error(e); process.exit(1); });
