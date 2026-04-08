import fs from 'fs';
import * as cheerio from 'cheerio';

// ═══════════════════════════════════════════════════════════════
// KBO 일자별 팀 순위 역추출 (v9.2) — ⚠️ 미작동
// 시도: TeamRankDaily.aspx PostBack
// 결과: KBO 서버가 봇 차단 (Referer/Origin/UA 모두 시도했으나 에러 페이지 응답)
// 향후: Playwright 헤드리스 또는 나무위키 일자별 결과 페이지 파싱으로 우회
// 현재 운영 방침: 4/8부터 매일 npm run predict 시 자동 누적 → 1주 후 첫 검증
// ═══════════════════════════════════════════════════════════════

const BASE = 'http://localhost:5173/kbo-api';
const URL_DAILY = `${BASE}/Record/TeamRank/TeamRankDaily.aspx`;
const SNAP_DIR = 'team-stats-snapshots';

const NM = {
  '삼성':'samsung','KIA':'kia','LG':'lg','두산':'doosan','KT':'kt',
  'SSG':'ssg','한화':'hanwha','롯데':'lotte','NC':'nc','키움':'kiwoom'
};

async function fetchInitial() {
  const r = await fetch(URL_DAILY);
  const html = await r.text();
  const cookies = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  return { html, cookies };
}

async function fetchByDate(html, cookies, dateYYMMDD) {
  const $ = cheerio.load(html);
  const formData = new URLSearchParams();
  $('input[type=hidden]').each((i, el) => {
    const name = $(el).attr('name');
    const val = $(el).val();
    if (name) formData.set(name, val || '');
  });
  // 날짜 설정
  formData.set('ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$hfSearchDate', dateYYMMDD);
  formData.set('__EVENTTARGET', 'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$btnCalendarSelect');
  formData.set('__EVENTARGUMENT', '');

  const r = await fetch(URL_DAILY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
    body: formData.toString(),
    redirect: 'follow',
  });
  return await r.text();
}

// 컬럼: 순위 팀명 경기 승 패 무 승률 게임차 최근10경기 연속 홈 방문
function parseTable(html) {
  const $ = cheerio.load(html);
  const teams = {};
  // tbody 안 모든 tr 순회 (클래스 불특정)
  $('tbody tr').each((i, tr) => {
    const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 7) return;
    if (!NM[cells[1]]) return;
    const teamKR = cells[1];
    const id = NM[teamKR];
    if (!id) return;
    teams[id] = {
      teamKR,
      g: parseInt(cells[2]) || 0,
      w: parseInt(cells[3]) || 0,
      l: parseInt(cells[4]) || 0,
      t: parseInt(cells[5]) || 0,
      pct: parseFloat(cells[6]) || 0,
    };
    // 컬럼: 0순위 1팀 2경기 3승 4패 5무 6승률 7게임차 8최근10 9연속 10홈 11방문
    if (cells[8]) teams[id].last10raw = cells[8];   // "7승0무1패"
    if (cells[9]) teams[id].streak = cells[9];      // "4승"
  });
  return teams;
}

async function snapshotForDate(targetDate) {
  // targetDate: "YYYY-MM-DD"
  const yymmdd = targetDate.slice(2).replace(/-/g, ''); // "260406"
  console.log(`\n📅 ${targetDate} (yymmdd=${yymmdd}) 스냅샷 백필...`);

  const { html: initial, cookies } = await fetchInitial();
  const dayHtml = await fetchByDate(initial, cookies, yymmdd);
  const teams = parseTable(dayHtml);

  if (Object.keys(teams).length === 0) {
    console.log(`  ❌ 파싱 실패 (cells 부족 또는 페이지 구조 변경)`);
    return false;
  }

  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR);
  const snapDate = targetDate.replace(/-/g, '');
  const snapFile = `${SNAP_DIR}/team-stats-${snapDate}.json`;
  // 득실점은 TeamRankDaily에 없으므로 별도 처리 필요. 일단 0으로
  // (Layer 1B 공식은 pct + runDiffPerGame을 모두 사용하므로 정확도 떨어짐 — 개선 여지)
  const enriched = {};
  for (const [id, t] of Object.entries(teams)) {
    enriched[id] = { ...t, rs: 0, ra: 0, runDiff: 0, runDiffPerGame: 0 };
  }
  fs.writeFileSync(snapFile, JSON.stringify({
    crawlDate: targetDate,
    crawlTime: new Date().toISOString(),
    source: 'TeamRankDaily backfill',
    teams: enriched,
  }, null, 2));

  console.log(`  ✅ ${snapFile} (${Object.keys(teams).length}팀)`);
  for (const [id, t] of Object.entries(teams)) {
    console.log(`    ${t.teamKR.padEnd(4)} ${t.g}경기 ${t.w}-${t.l}-${t.t} pct=${t.pct.toFixed(3)} 최근10:${t.last10 || '-'} 연속:${t.streak || '-'}`);
  }
  return true;
}

async function main() {
  const startDate = process.argv[2];
  const endDate = process.argv[3] || startDate;
  if (!startDate) {
    console.error('사용법: node backfill-snapshots.mjs YYYY-MM-DD [endDate]');
    process.exit(1);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    try {
      await snapshotForDate(dateStr);
    } catch (e) {
      console.error(`  ❌ ${dateStr}: ${e.message}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
