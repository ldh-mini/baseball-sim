import { chromium } from 'playwright';

const BASE = 'https://www.koreabaseball.com';

async function crawlPage(page, url, season) {
  await page.goto(url, { waitUntil: 'networkidle' });

  // Change season to 2025
  await page.selectOption('#cphContents_cphContents_cphContents_ddlSeason_ddlSeason', season);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Parse table
  const rows = await page.evaluate(() => {
    const trs = document.querySelectorAll('tbody tr');
    const data = [];
    trs.forEach(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      if (cells.length > 3 && /^\d+$/.test(cells[0])) data.push(cells);
    });
    return data;
  });

  return rows;
}

async function crawlAllPages(page, url, season) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.selectOption('#cphContents_cphContents_cphContents_ddlSeason_ddlSeason', season);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  let allRows = [];
  let pageNum = 1;

  while (true) {
    const rows = await page.evaluate(() => {
      const trs = document.querySelectorAll('tbody tr');
      return [...trs].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
        .filter(cells => cells.length > 3 && /^\d+$/.test(cells[0]));
    });

    allRows = allRows.concat(rows);
    console.log(`  Page ${pageNum}: ${rows.length} rows (total: ${allRows.length})`);

    // Try next page
    const hasNext = await page.evaluate(() => {
      const pager = document.querySelector('.paging');
      if (!pager) return false;
      const links = pager.querySelectorAll('a');
      for (const a of links) {
        if (a.textContent.trim() === '다음') return true;
      }
      // Check for page number links
      const active = pager.querySelector('.on, .active, strong');
      if (!active) return false;
      const next = active.nextElementSibling;
      return next && next.tagName === 'A';
    });

    if (!hasNext || pageNum >= 10) break;

    // Click next page
    const clicked = await page.evaluate((pn) => {
      const nextNum = pn + 1;
      const links = document.querySelectorAll('.paging a');
      for (const a of links) {
        if (a.textContent.trim() === String(nextNum)) {
          a.click();
          return true;
        }
      }
      return false;
    }, pageNum);

    if (!clicked) break;
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    pageNum++;
  }

  return allRows;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await ctx.newPage();

  console.log('=== 2025 KBO 타자 기록 (Basic1) ===');
  const h1 = await crawlAllPages(page, BASE + '/Record/Player/HitterBasic/Basic1.aspx', '2025');

  console.log('\n=== 2025 KBO 타자 기록 (Basic2: OBP/SLG) ===');
  const h2 = await crawlAllPages(page, BASE + '/Record/Player/HitterBasic/Basic2.aspx', '2025');

  console.log('\n=== 2025 KBO 투수 기록 (Basic1) ===');
  const p1 = await crawlAllPages(page, BASE + '/Record/Player/PitcherBasic/Basic1.aspx', '2025');

  await browser.close();

  // Print summary
  console.log('\n========================================');
  console.log(`타자: ${h1.length}명, 투수: ${p1.length}명`);

  console.log('\n--- Top 15 타자 (AVG 기준) ---');
  // h1 cols: rank, name, team, AVG, G, PA, AB, R, H, 2B, 3B, HR, RBI, SB
  h1.slice(0, 15).forEach(r => {
    const obpSlg = h2.find(h => h[1] === r[1] && h[2] === r[2]);
    const obp = obpSlg ? obpSlg[10] : '?';
    const slg = obpSlg ? obpSlg[9] : '?';
    console.log(`  ${r[1].padEnd(6)} ${r[2].padEnd(4)} AVG:${r[3]} G:${r[4].padStart(4)} PA:${r[5].padStart(4)} HR:${r[11].padStart(3)} RBI:${r[12].padStart(4)} OBP:${obp} SLG:${slg}`);
  });

  console.log('\n--- Top 15 투수 (ERA 기준) ---');
  // p1 cols: rank, name, team, ERA, G, W, L, SV, HLD, WPCT, IP, H, HR, BB, HBP, SO, R, ER, WHIP
  p1.slice(0, 15).forEach(r => {
    console.log(`  ${r[1].padEnd(6)} ${r[2].padEnd(4)} ERA:${r[3].padStart(5)} G:${r[4].padStart(3)} W:${r[5]} L:${r[6]} IP:${r[10].padStart(6)} SO:${r[15].padStart(4)} WHIP:${r[18]}`);
  });

  // Save data for blending
  const fs = await import('fs');
  fs.writeFileSync('h1_2025.json', JSON.stringify(h1));
  fs.writeFileSync('h2_2025.json', JSON.stringify(h2));
  fs.writeFileSync('p1_2025.json', JSON.stringify(p1));
  console.log('\nData saved to h1_2025.json, h2_2025.json, p1_2025.json');
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
