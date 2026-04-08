/**
 * KBO 선수 스탯 크롤링 자동화
 * Usage: node crawl-stats.mjs [--year 2026] [--apply]
 *
 * 데이터 소스: KBO 공식 사이트 (koreabaseball.com) — 기록실
 *   - Basic1: AVG, G, PA, AB, R, H, 2B, 3B, HR, TB, RBI
 *   - Basic2: BB, SLG, OBP, OPS
 *   - BasicOld: SB, CS
 *   - Pitcher Basic1: ERA, G, W, L, SV, HLD, IP, H, HR, BB, SO, WHIP
 *
 * 출력: crawled-stats-{year}.json + crawled-stats-{year}.js
 * --apply 옵션: kbo-simulation.jsx 선수 스탯 자동 업데이트
 */
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// ── 설정 ──
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DELAY_MS = 800;
const KBO_BASE = "https://www.koreabaseball.com/Record/Player";

const TEAM_MAP = {
  "KIA": "kia", "삼성": "samsung", "LG": "lg", "두산": "doosan",
  "KT": "kt", "SSG": "ssg", "한화": "hanwha", "롯데": "lotte",
  "NC": "nc", "키움": "kiwoom",
};
const STADIUM_MAP = {
  kia: "gwangju", samsung: "daegu", lg: "jamsil", doosan: "jamsil",
  kt: "suwon", ssg: "incheon", hanwha: "daejeon", lotte: "sajik",
  nc: "changwon", kiwoom: "gocheok",
};
const COLOR_MAP = {
  kia: "#EA0029", samsung: "#074CA1", lg: "#C30452", doosan: "#131230",
  kt: "#000000", ssg: "#CE0E2D", hanwha: "#FF6600", lotte: "#041E42",
  nc: "#315288", kiwoom: "#820024",
};
const SHORT_MAP = {
  kia: "기아", samsung: "삼성", lg: "LG", doosan: "두산",
  kt: "KT", ssg: "SSG", hanwha: "한화", lotte: "롯데",
  nc: "NC", kiwoom: "키움",
};
const SUFFIX_MAP = {
  kia: "타이거즈", samsung: "라이온즈", lg: "트윈스", doosan: "베어스",
  kt: "위즈", ssg: "랜더스", hanwha: "이글스", lotte: "자이언츠",
  nc: "다이노스", kiwoom: "히어로즈",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pf = (v, d = 3) => parseFloat(v.toFixed(d));

// ── KBO 페이지 파싱 공통 (ASP.NET PostBack 페이지네이션 지원) ──
async function fetchKBOPage(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const cookies = (r.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    return { html, cookies };
  } catch (e) {
    console.error(`  ⚠ Fetch failed: ${url} — ${e.message}`);
    return { html: null, cookies: "" };
  }
}

async function fetchKBONextPage(url, html, cookies, pageNum) {
  const $ = cheerio.load(html);
  const formData = new URLSearchParams();
  $("input[type=hidden]").each((i, el) => {
    const name = $(el).attr("name");
    const val = $(el).val();
    if (name) formData.set(name, val || "");
  });
  formData.set("__EVENTTARGET", `ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ucPager$btnNo${pageNum}`);
  formData.set("__EVENTARGUMENT", "");

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookies },
      body: formData.toString(),
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    console.error(`  ⚠ Page ${pageNum} fetch failed: ${e.message}`);
    return null;
  }
}

// 모든 페이지를 자동으로 순회하며 데이터 수집
async function fetchAllPages(url, maxPages = 10) {
  const { html: firstHtml, cookies } = await fetchKBOPage(url);
  if (!firstHtml) return [];

  const allRows = [];
  const firstResult = parseTable(firstHtml);
  allRows.push(...firstResult.rows);

  // 페이지 수 확인
  const $ = cheerio.load(firstHtml);
  const pageLinks = [];
  $(".paging a").each((i, a) => {
    const text = $(a).text().trim();
    if (/^\d+$/.test(text)) pageLinks.push(parseInt(text));
  });
  const totalPages = Math.min(Math.max(...pageLinks, 1), maxPages);

  let prevHtml = firstHtml;
  for (let p = 2; p <= totalPages; p++) {
    await sleep(DELAY_MS);
    const nextHtml = await fetchKBONextPage(url, prevHtml, cookies, p);
    if (!nextHtml) break;
    const { rows } = parseTable(nextHtml);
    if (rows.length === 0) break;
    allRows.push(...rows);
    prevHtml = nextHtml;
  }

  return { headers: firstResult.headers, rows: allRows };
}

function parseTable(html) {
  const $ = cheerio.load(html);
  const headers = [];
  $(".tData01 thead th").each((i, th) => headers.push($(th).text().trim()));

  const rows = [];
  $(".tData01 tbody tr").each((i, tr) => {
    const cells = [];
    $(tr).find("td").each((ci, td) => cells.push($(td).text().trim()));
    if (cells.length >= 5) rows.push(cells);
  });

  return { headers, rows };
}

function buildColMap(headers) {
  const m = {};
  headers.forEach((h, i) => { m[h] = i; });
  return m;
}

// ── 타자 스탯 크롤링 ──
async function crawlBatters() {
  console.log("📊 타자 스탯 크롤링...");
  const batters = new Map(); // name+team → stats

  // Page 1: Basic1 — AVG, G, PA, AB, R, H, 2B, 3B, HR, TB, RBI (전체 페이지)
  console.log("  Basic1 (AVG, HR, RBI) — 전체 페이지...");
  const result1 = await fetchAllPages(`${KBO_BASE}/HitterBasic/Basic1.aspx`);
  if (result1 && result1.rows) {
    const { headers, rows } = result1;
    const c = buildColMap(headers);
    for (const r of rows) {
      const name = r[c["선수명"]]?.trim();
      const team = r[c["팀명"]]?.trim();
      if (!name || !team || !TEAM_MAP[team]) continue;
      const key = `${name}|${team}`;
      batters.set(key, {
        name, team, teamId: TEAM_MAP[team],
        avg: parseFloat(r[c["AVG"]]) || 0,
        g: parseInt(r[c["G"]]) || 0,
        pa: parseInt(r[c["PA"]]) || 0,
        ab: parseInt(r[c["AB"]]) || 0,
        r: parseInt(r[c["R"]]) || 0,
        h: parseInt(r[c["H"]]) || 0,
        "2b": parseInt(r[c["2B"]]) || 0,
        "3b": parseInt(r[c["3B"]]) || 0,
        hr: parseInt(r[c["HR"]]) || 0,
        tb: parseInt(r[c["TB"]]) || 0,
        rbi: parseInt(r[c["RBI"]]) || 0,
      });
    }
    console.log(`    → ${batters.size}명`);
  }
  await sleep(DELAY_MS);

  // Page 2: Basic2 — BB, SLG, OBP, OPS (전체 페이지)
  console.log("  Basic2 (OBP, SLG, OPS) — 전체 페이지...");
  const result2 = await fetchAllPages(`${KBO_BASE}/HitterBasic/Basic2.aspx`);
  if (result2 && result2.rows) {
    const { headers, rows } = result2;
    const c = buildColMap(headers);
    let matched = 0;
    for (const r of rows) {
      const name = r[c["선수명"]]?.trim();
      const team = r[c["팀명"]]?.trim();
      const key = `${name}|${team}`;
      const b = batters.get(key);
      if (!b) continue;
      b.bb = parseInt(r[c["BB"]]) || 0;
      b.so = parseInt(r[c["SO"]]) || 0;
      b.slg = parseFloat(r[c["SLG"]]) || 0;
      b.obp = parseFloat(r[c["OBP"]]) || 0;
      b.ops = parseFloat(r[c["OPS"]]) || 0;
      matched++;
    }
    console.log(`    → ${matched}명 매칭`);
  }
  await sleep(DELAY_MS);

  // Page 3: BasicOld — SB, CS (전체 페이지)
  console.log("  BasicOld (SB, CS) — 전체 페이지...");
  const result3 = await fetchAllPages(`${KBO_BASE}/HitterBasic/BasicOld.aspx`);
  if (result3 && result3.rows) {
    const { headers, rows } = result3;
    const c = buildColMap(headers);
    let matched = 0;
    for (const r of rows) {
      const name = r[c["선수명"]]?.trim();
      const team = r[c["팀명"]]?.trim();
      const key = `${name}|${team}`;
      const b = batters.get(key);
      if (!b) continue;
      b.sb = parseInt(r[c["SB"]]) || 0;
      b.cs = parseInt(r[c["CS"]]) || 0;
      matched++;
    }
    console.log(`    → ${matched}명 매칭`);
  }

  return [...batters.values()];
}

// ── 투수 스탯 크롤링 ──
async function crawlPitchers() {
  console.log("\n⚾ 투수 스탯 크롤링...");
  const pitchers = new Map();

  // Pitcher Basic1: ERA, G, W, L, SV, HLD, IP, H, HR, BB, HBP, SO, WHIP (전체 페이지)
  console.log("  PitcherBasic1 (ERA, W, L, SV, IP, SO, WHIP) — 전체 페이지...");
  const presult1 = await fetchAllPages(`${KBO_BASE}/PitcherBasic/Basic1.aspx`);
  if (presult1 && presult1.rows) {
    const { headers, rows } = presult1;
    const c = buildColMap(headers);
    for (const r of rows) {
      const name = r[c["선수명"]]?.trim();
      const team = r[c["팀명"]]?.trim();
      if (!name || !team || !TEAM_MAP[team]) continue;
      const key = `${name}|${team}`;
      const ip = parseFloat(r[c["IP"]]) || 0;
      const so = parseInt(r[c["SO"]]) || 0;
      const bb = parseInt(r[c["BB"]]) || 0;
      pitchers.set(key, {
        name, team, teamId: TEAM_MAP[team],
        era: parseFloat(r[c["ERA"]]) || 0,
        g: parseInt(r[c["G"]]) || 0,
        w: parseInt(r[c["W"]]) || 0,
        l: parseInt(r[c["L"]]) || 0,
        sv: parseInt(r[c["SV"]]) || 0,
        hld: parseInt(r[c["HLD"]]) || 0,
        ip,
        h: parseInt(r[c["H"]]) || 0,
        hr: parseInt(r[c["HR"]]) || 0,
        bb,
        hbp: parseInt(r[c["HBP"]]) || 0,
        so,
        whip: parseFloat(r[c["WHIP"]]) || 0,
        k9: ip > 0 ? pf((so / ip) * 9, 1) : 0,
        bb9: ip > 0 ? pf((bb / ip) * 9, 1) : 0,
      });
    }
    console.log(`    → ${pitchers.size}명`);
  }
  await sleep(DELAY_MS);

  // Pitcher Basic2: QS, CG 등 (전체 페이지)
  console.log("  PitcherBasic2 (QS, CG) — 전체 페이지...");
  const presult2 = await fetchAllPages(`${KBO_BASE}/PitcherBasic/Basic2.aspx`);
  if (presult2 && presult2.rows) {
    const { headers, rows } = presult2;
    const c = buildColMap(headers);
    let matched = 0;
    for (const r of rows) {
      const name = r[c["선수명"]]?.trim();
      const team = r[c["팀명"]]?.trim();
      const key = `${name}|${team}`;
      const p = pitchers.get(key);
      if (!p) continue;
      p.cg = parseInt(r[c["CG"]]) || 0;
      p.qs = parseInt(r[c["QS"]]) || 0;
      // GS가 명시적으로 없지만 QS > 0 또는 IP >= 5 이면 선발 추정
      matched++;
    }
    console.log(`    → ${matched}명 매칭`);
  }

  return [...pitchers.values()];
}

// ── GS(선발횟수) 크롤링 — 상세기록 페이지 ──
async function crawlPitcherGS() {
  console.log("  PitcherDetail (GS 선발횟수) — 전체 페이지...");
  const detailResult = await fetchAllPages(`${KBO_BASE}/PitcherBasic/Detail1.aspx`);
  if (!detailResult || !detailResult.rows) return new Map();
  const { headers, rows } = detailResult;
  const c = buildColMap(headers);
  const gsMap = new Map();
  if (c["GS"] !== undefined) {
    for (const r of rows) {
      const name = r[c["선수명"]]?.trim();
      const team = r[c["팀명"]]?.trim();
      if (name && team) gsMap.set(`${name}|${team}`, parseInt(r[c["GS"]]) || 0);
    }
    console.log(`    → ${gsMap.size}명 GS 데이터`);
  } else {
    console.log("    → GS 컬럼 없음, IP 기반으로 선발 추정");
  }
  return gsMap;
}

// ── 팀별 데이터 조합 ──
function groupByTeam(batters, pitchers, gsMap) {
  const teams = {};

  // 팀별 타자 그룹화
  for (const b of batters) {
    if (!teams[b.teamId]) teams[b.teamId] = { batters: [], pitchers: [] };
    teams[b.teamId].batters.push(b);
  }

  // 팀별 투수 그룹화 + 선발/불펜 분류
  for (const p of pitchers) {
    if (!teams[p.teamId]) teams[p.teamId] = { batters: [], pitchers: [] };
    const gs = gsMap.get(`${p.name}|${p.team}`) ?? 0;
    // 선발 판정: GS 데이터 있으면 사용, 없으면 IP/G 비율로 추정
    p.gs = gs;
    p.isStarter = gs >= 2 || (p.ip / Math.max(1, p.g) >= 4.0 && p.g <= 15) || p.qs > 0;
    teams[p.teamId].pitchers.push(p);
  }

  return teams;
}

// ── 시뮬레이션 데이터 형식으로 빌드 ──
function buildSimData(teamId, teamData) {
  const { batters, pitchers } = teamData;

  // 타자: PA 기준 상위 9명
  const sortedB = [...batters].sort((a, b) => (b.pa || 0) - (a.pa || 0));
  const lineup = sortedB.slice(0, 9).map((b) => {
    const spd = clamp(Math.round((b.sb || 0) / Math.max(1, b.g) * 30 + 4), 2, 9);
    // recentForm: OPS 기반 — 리그 평균 .700 대비
    const form = b.ops ? clamp(pf(0.85 + (b.ops - 0.700) * 0.5, 2), 0.75, 1.30) : 1.0;
    return {
      name: b.name,
      pos: "DH",
      bat: "R",
      avg: pf(b.avg || 0),
      obp: pf(b.obp || (b.avg + 0.06)),
      slg: pf(b.slg || (b.avg + 0.15)),
      hr: b.hr || 0,
      spd,
      recentForm: form,
      ...(b.rbi >= 30 ? { rbi: b.rbi } : {}),
      ...(b.sb >= 5 ? { sb: b.sb } : {}),
    };
  });

  // 선발 투수: 선발 판정된 투수 중 IP 순 상위 3명
  const starterPool = pitchers.filter((p) => p.isStarter).sort((a, b) => (b.ip || 0) - (a.ip || 0));
  const starters = starterPool.slice(0, 3).map((p) => {
    const form = clamp(pf(1.0 + (p.qs || 0) * 0.02 - p.era * 0.02, 2), 0.75, 1.30);
    return {
      name: p.name,
      throws: "R",
      era: pf(p.era, 2),
      whip: pf(p.whip || 1.20, 2),
      k9: pf(p.k9, 1),
      bb9: pf(p.bb9, 1),
      ip: pf(p.ip, 1),
      recentForm: form,
    };
  });

  // 불펜: 선발 제외 투수 평균
  const relievers = pitchers.filter((p) => !p.isStarter && p.ip >= 1);
  const avgField = (arr, field) => arr.length ? pf(arr.reduce((s, p) => s + (p[field] || 0), 0) / arr.length, 2) : 0;

  const bullpen = {
    era: avgField(relievers, "era") || 4.00,
    whip: avgField(relievers, "whip") || 1.25,
    k9: pf(avgField(relievers, "k9"), 1) || 8.0,
    bb9: pf(avgField(relievers, "bb9"), 1) || 3.0,
  };

  // 마무리
  const closer = [...relievers].sort((a, b) => (b.sv || 0) - (a.sv || 0))[0];
  if (closer && closer.sv >= 3) {
    bullpen.closer = closer.name;
    bullpen.closerEra = pf(closer.era, 2);
    bullpen.saves = closer.sv;
  }

  // 팀 레이팅 — 타율 합산 + 투수 ERA 역수 기반 (50~95)
  const teamAvg = lineup.length ? lineup.reduce((s, b) => s + b.avg, 0) / lineup.length : 0.260;
  const teamEra = starters.length ? starters.reduce((s, p) => s + p.era, 0) / starters.length : 4.00;
  const teamRating = clamp(Math.round(50 + (teamAvg - 0.240) * 300 + (4.50 - teamEra) * 8), 50, 95);

  return {
    id: teamId,
    name: `${SHORT_MAP[teamId]} ${SUFFIX_MAP[teamId]}`,
    short: SHORT_MAP[teamId],
    color: COLOR_MAP[teamId],
    stadium: STADIUM_MAP[teamId],
    lineup,
    starters,
    bullpen,
    teamRating,
  };
}

// ── 기존 kbo-simulation.jsx에서 포지션/투구손 매칭 ──
function loadExistingMeta() {
  try {
    const content = fs.readFileSync(path.resolve("kbo-simulation.jsx"), "utf-8");
    const posMap = {};
    const throwsMap = {};
    const batMap = {};
    for (const m of content.matchAll(/name:\s*"([^"]+)"[^}]*?pos:\s*"([^"]+)"/g)) posMap[m[1]] = m[2];
    for (const m of content.matchAll(/name:\s*"([^"]+)"[^}]*?throws:\s*"([^"]+)"/g)) throwsMap[m[1]] = m[2];
    for (const m of content.matchAll(/name:\s*"([^"]+)"[^}]*?bat:\s*"([^"]+)"/g)) batMap[m[1]] = m[2];
    return { posMap, throwsMap, batMap };
  } catch {
    return { posMap: {}, throwsMap: {}, batMap: {} };
  }
}

function applyExistingMeta(teamData, meta) {
  for (const team of Object.values(teamData)) {
    for (const b of team.lineup) {
      if (meta.posMap[b.name]) b.pos = meta.posMap[b.name];
      if (meta.batMap[b.name]) b.bat = meta.batMap[b.name];
    }
    for (const p of team.starters) {
      if (meta.throwsMap[p.name]) p.throws = meta.throwsMap[p.name];
    }
  }
}

// ── JS 코드 출력 ──
function formatJS(teams, year) {
  let code = `// ── ${year} 시즌 크롤링 데이터 (자동 생성: ${new Date().toISOString().slice(0, 10)}) ──\n`;
  code += `// 소스: KBO 공식 기록실 (koreabaseball.com)\n\n`;

  for (const [teamId, team] of Object.entries(teams)) {
    code += `// ${team.name} (Rating: ${team.teamRating})\n`;
    code += `// lineup: [\n`;
    for (const b of team.lineup) {
      const extras = []; if (b.rbi) extras.push(`rbi:${b.rbi}`); if (b.sb) extras.push(`sb:${b.sb}`);
      code += `//   { name:"${b.name}", pos:"${b.pos}", bat:"${b.bat}", avg:${b.avg}, obp:${b.obp}, slg:${b.slg}, hr:${b.hr}, spd:${b.spd}, recentForm:${b.recentForm}${extras.length ? ", " + extras.join(", ") : ""} },\n`;
    }
    code += `// ]\n`;
    code += `// starters: [\n`;
    for (const p of team.starters) {
      code += `//   { name:"${p.name}", throws:"${p.throws}", era:${p.era}, whip:${p.whip}, k9:${p.k9}, bb9:${p.bb9}, ip:${p.ip}, recentForm:${p.recentForm} },\n`;
    }
    code += `// ]\n`;
    code += `// bullpen: { era:${team.bullpen.era}, whip:${team.bullpen.whip}, k9:${team.bullpen.k9}, bb9:${team.bullpen.bb9}${team.bullpen.closer ? `, closer:"${team.bullpen.closer}", saves:${team.bullpen.saves}` : ""} }\n\n`;
  }
  return code;
}

// ── kbo-simulation.jsx 자동 업데이트 ──
function applyToSimulation(teams) {
  const simPath = path.resolve("kbo-simulation.jsx");
  let content = fs.readFileSync(simPath, "utf-8");
  let updates = 0;

  for (const team of Object.values(teams)) {
    // 타자 스탯 업데이트 (기존 선수만)
    for (const b of team.lineup) {
      const re = new RegExp(
        `(name:\\s*"${esc(b.name)}"[^}]*?avg:)[\\d.]+([^}]*?obp:)[\\d.]+([^}]*?slg:)[\\d.]+([^}]*?hr:)\\d+`,
        "g"
      );
      const before = content;
      content = content.replace(re, `$1${b.avg}$2${b.obp}$3${b.slg}$4${b.hr}`);
      if (content !== before) updates++;
    }
    // 투수 스탯 업데이트 (기존 선수만)
    for (const p of team.starters) {
      const re = new RegExp(
        `(name:\\s*"${esc(p.name)}"[^}]*?era:)[\\d.]+([^}]*?whip:)[\\d.]+([^}]*?k9:)[\\d.]+([^}]*?bb9:)[\\d.]+([^}]*?ip:)[\\d.]+`,
        "g"
      );
      const before = content;
      content = content.replace(re, `$1${p.era}$2${p.whip}$3${p.k9}$4${p.bb9}$5${p.ip}`);
      if (content !== before) updates++;
    }
  }

  fs.writeFileSync(simPath, content, "utf-8");
  return updates;
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ── 메인 ──
async function main() {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const year = yearIdx >= 0 ? parseInt(args[yearIdx + 1]) : 2026;
  const shouldApply = args.includes("--apply");

  console.log(`\n🏟️  KBO 선수 스탯 크롤링 — ${year} 시즌`);
  console.log(`${"═".repeat(50)}\n`);

  // 1. 타자 크롤링
  const batters = await crawlBatters();
  await sleep(DELAY_MS);

  // 2. 투수 크롤링
  const pitchers = await crawlPitchers();
  await sleep(DELAY_MS);

  // 3. GS 데이터
  const gsMap = await crawlPitcherGS();

  // 4. 팀별 그룹화
  const grouped = groupByTeam(batters, pitchers, gsMap);

  // 5. 시뮬 데이터 빌드
  const teamData = {};
  for (const [teamId, data] of Object.entries(grouped)) {
    if (data.batters.length > 0) {
      teamData[teamId] = buildSimData(teamId, data);
    }
  }

  // 6. 기존 데이터에서 포지션/투구손 매칭
  const meta = loadExistingMeta();
  applyExistingMeta(teamData, meta);

  const teamCount = Object.keys(teamData).length;
  console.log(`\n${"═".repeat(50)}`);
  console.log(`✅ 크롤링 완료: ${teamCount}개 팀, 타자 ${batters.length}명, 투수 ${pitchers.length}명`);

  // 7. JSON 저장
  const jsonPath = path.resolve(`crawled-stats-${year}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(teamData, null, 2), "utf-8");
  console.log(`📁 JSON: ${jsonPath}`);

  // 8. JS 코드 저장
  const jsCode = formatJS(teamData, year);
  const jsPath = path.resolve(`crawled-stats-${year}.js`);
  fs.writeFileSync(jsPath, jsCode, "utf-8");
  console.log(`📁 JS:   ${jsPath}`);

  // 9. --apply
  if (shouldApply && teamCount >= 8) {
    console.log("\n🔧 kbo-simulation.jsx 업데이트 적용 중...");
    const updates = applyToSimulation(teamData);
    console.log(`✅ ${updates}개 선수 스탯 업데이트 완료!`);
  } else if (shouldApply) {
    console.log(`\n⚠️  팀 데이터 부족 (${teamCount}/10) — 자동 적용 건너뜀`);
  }

  // 10. 결과 요약
  console.log(`\n📊 팀별 요약:`);
  for (const [id, t] of Object.entries(teamData)) {
    const topB = t.lineup[0]?.name || "-";
    const ace = t.starters[0]?.name || "-";
    const bp = t.bullpen;
    console.log(`  ${t.short.padEnd(4)} R:${String(t.teamRating).padStart(2)} | ${ace.padEnd(6)} (ERA ${t.starters[0]?.era ?? "-"}) | ${topB} (.${String(Math.round((t.lineup[0]?.avg ?? 0) * 1000)).padStart(3, "0")})`);
  }
  console.log(`\n💡 사용법:`);
  console.log(`   node crawl-stats.mjs --year 2026          # 크롤링만`);
  console.log(`   node crawl-stats.mjs --year 2026 --apply  # 크롤링 + 시뮬 업데이트\n`);
}

main().catch((e) => {
  console.error("❌ 크롤링 실패:", e);
  process.exit(1);
});
