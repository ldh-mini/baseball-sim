import fs from 'fs';

const h1 = JSON.parse(fs.readFileSync('h1.json', 'utf8'));
const h2 = JSON.parse(fs.readFileSync('h2.json', 'utf8'));
const p1 = JSON.parse(fs.readFileSync('p1.json', 'utf8'));

const TM = { '삼성': 'samsung', 'KIA': 'kia', 'LG': 'lg', '두산': 'doosan', 'KT': 'kt', 'SSG': 'ssg', '한화': 'hanwha', '롯데': 'lotte', 'NC': 'nc', '키움': 'kiwoom' };

// Build update maps
const hitterUpdates = {};
for (let i = 0; i < h1.length; i++) {
  const v1 = h1[i], v2 = h2[i] || [];
  const tid = TM[v1[2]];
  if (!tid) continue;
  hitterUpdates[v1[1] + '_' + tid] = {
    avg: +v1[3], hr: +v1[11], rbi: +v1[13], pa: +v1[5],
    obp: +(v2[10] || 0), slg: +(v2[9] || 0)
  };
}

const pitcherUpdates = {};
for (const v of p1) {
  const tid = TM[v[2]];
  if (!tid) continue;
  const ip = parseFloat(v[10]) || 0, so = +v[15] || 0, bb = +v[13] || 0;
  pitcherUpdates[v[1] + '_' + tid] = {
    era: +v[3], whip: +v[18],
    k9: ip > 0 ? +(so / ip * 9).toFixed(1) : 0,
    bb9: ip > 0 ? +(bb / ip * 9).toFixed(1) : 0,
    ip
  };
}

let jsx = fs.readFileSync('kbo-simulation.jsx', 'utf8');

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Update hitters
let hUpdated = 0;
for (const [key, stats] of Object.entries(hitterUpdates)) {
  const [name] = key.split('_');
  const esc = escRe(name);

  // Find the line containing this player name in lineup
  const avgRe = new RegExp(`(name:\\s*"${esc}",.*?avg:)[0-9.]+`);
  if (jsx.match(avgRe)) {
    jsx = jsx.replace(avgRe, `$1${stats.avg}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?obp:)[0-9.]+`), `$1${stats.obp}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?slg:)[0-9.]+`), `$1${stats.slg}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?hr:)[0-9]+`), `$1${stats.hr}`);
    hUpdated++;
    console.log(`  H: ${name} → AVG:${stats.avg} OBP:${stats.obp} SLG:${stats.slg} HR:${stats.hr}`);
  }
}

// Update pitchers
let pUpdated = 0;
for (const [key, stats] of Object.entries(pitcherUpdates)) {
  const [name] = key.split('_');
  const esc = escRe(name);
  const eraRe = new RegExp(`(name:\\s*"${esc}",.*?era:)[0-9.]+`);
  if (jsx.match(eraRe)) {
    jsx = jsx.replace(eraRe, `$1${stats.era}`);
    jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?whip:)[0-9.]+`), `$1${stats.whip}`);
    if (stats.k9) jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?k9:)[0-9.]+`), `$1${stats.k9}`);
    if (stats.bb9) jsx = jsx.replace(new RegExp(`(name:\\s*"${esc}",.*?bb9:)[0-9.]+`), `$1${stats.bb9}`);
    pUpdated++;
    console.log(`  P: ${name} → ERA:${stats.era} WHIP:${stats.whip} K/9:${stats.k9} BB/9:${stats.bb9}`);
  }
}

console.log(`\nHitters updated: ${hUpdated}/${Object.keys(hitterUpdates).length}`);
console.log(`Pitchers updated: ${pUpdated}/${Object.keys(pitcherUpdates).length}`);

fs.writeFileSync('kbo-simulation.jsx', jsx);
console.log('kbo-simulation.jsx saved!');
