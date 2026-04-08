import fs from 'fs';
import sharp from 'sharp';

// ═══════════════════════════════════════════════════════════════
// generate-assets.mjs (v9.5)
// SVG → 다양한 크기 PNG 자산 일괄 생성
// - public/favicon.svg
// - public/icons/icon-192.png, icon-512.png
// - public/apple-touch-icon.png
// - public/og-image.png
// ═══════════════════════════════════════════════════════════════

const PUBLIC = 'public';
const ICONS = `${PUBLIC}/icons`;

// ── 1. favicon.svg / 앱 아이콘 베이스 SVG ──
// 다크 그라디언트 배경 + 야구공 + KBO 텍스트
const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="50%" stop-color="#312e81"/>
      <stop offset="100%" stop-color="#4c1d95"/>
    </linearGradient>
    <radialGradient id="ball" cx="40%" cy="35%">
      <stop offset="0%" stop-color="#fefefe"/>
      <stop offset="80%" stop-color="#f1f5f9"/>
      <stop offset="100%" stop-color="#cbd5e1"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <!-- 야구공 -->
  <g transform="translate(256 256)">
    <circle r="150" fill="url(#ball)" stroke="#94a3b8" stroke-width="3"/>
    <!-- 빨간 실밥 (좌측) -->
    <path d="M -110 -70 Q -90 0 -110 70" fill="none" stroke="#dc2626" stroke-width="6" stroke-linecap="round"/>
    <path d="M -118 -55 L -100 -45 M -125 -25 L -107 -20 M -128 5 L -110 5 M -125 35 L -107 30 M -118 55 L -100 45" stroke="#dc2626" stroke-width="4" stroke-linecap="round"/>
    <!-- 빨간 실밥 (우측) -->
    <path d="M 110 -70 Q 90 0 110 70" fill="none" stroke="#dc2626" stroke-width="6" stroke-linecap="round"/>
    <path d="M 118 -55 L 100 -45 M 125 -25 L 107 -20 M 128 5 L 110 5 M 125 35 L 107 30 M 118 55 L 100 45" stroke="#dc2626" stroke-width="4" stroke-linecap="round"/>
  </g>
  <!-- KBO 텍스트 -->
  <text x="256" y="465" font-family="Arial Black, sans-serif" font-size="60" font-weight="900" fill="#a78bfa" text-anchor="middle" filter="url(#glow)">KBO</text>
</svg>`;

// ── 2. og-image.svg (1200×630) ──
const OG_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#4c1d95"/>
    </linearGradient>
    <radialGradient id="ball" cx="40%" cy="35%">
      <stop offset="0%" stop-color="#fefefe"/>
      <stop offset="80%" stop-color="#f1f5f9"/>
      <stop offset="100%" stop-color="#cbd5e1"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#a78bfa" stroke-width="0.5" opacity="0.15"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>

  <!-- 야구공 (왼쪽) -->
  <g transform="translate(220 315)">
    <circle r="180" fill="url(#ball)" stroke="#94a3b8" stroke-width="4"/>
    <path d="M -130 -85 Q -108 0 -130 85" fill="none" stroke="#dc2626" stroke-width="7" stroke-linecap="round"/>
    <path d="M -138 -65 L -118 -55 M -145 -30 L -125 -25 M -148 5 L -128 5 M -145 40 L -125 35 M -138 65 L -118 55" stroke="#dc2626" stroke-width="5" stroke-linecap="round"/>
    <path d="M 130 -85 Q 108 0 130 85" fill="none" stroke="#dc2626" stroke-width="7" stroke-linecap="round"/>
    <path d="M 138 -65 L 118 -55 M 145 -30 L 125 -25 M 148 5 L 128 5 M 145 40 L 125 35 M 138 65 L 118 55" stroke="#dc2626" stroke-width="5" stroke-linecap="round"/>
  </g>

  <!-- 텍스트 (오른쪽) -->
  <g transform="translate(470 0)">
    <text x="0" y="220" font-family="Arial Black, sans-serif" font-size="64" font-weight="900" fill="#ffffff">KBO 경기 예측</text>
    <text x="0" y="290" font-family="Arial Black, sans-serif" font-size="64" font-weight="900" fill="#a78bfa">시뮬레이터</text>

    <line x1="0" y1="320" x2="600" y2="320" stroke="#7c3aed" stroke-width="3"/>

    <text x="0" y="370" font-family="Arial, sans-serif" font-size="28" fill="#cbd5e1">베이지안 블렌딩 + Layer 2C 모멘텀</text>
    <text x="0" y="410" font-family="Arial, sans-serif" font-size="28" fill="#cbd5e1">시점기반 백테스트로 검증</text>

    <!-- 배지들 -->
    <g transform="translate(0 450)">
      <rect x="0" y="0" width="120" height="40" rx="20" fill="#7c3aed" opacity="0.2" stroke="#a78bfa" stroke-width="2"/>
      <text x="60" y="27" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#a78bfa" text-anchor="middle">v9.5</text>

      <rect x="135" y="0" width="180" height="40" rx="20" fill="#0ea5e9" opacity="0.2" stroke="#38bdf8" stroke-width="2"/>
      <text x="225" y="27" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#38bdf8" text-anchor="middle">매일 자동 갱신</text>

      <rect x="330" y="0" width="200" height="40" rx="20" fill="#10b981" opacity="0.2" stroke="#34d399" stroke-width="2"/>
      <text x="430" y="27" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#34d399" text-anchor="middle">10팀 KBO 실데이터</text>
    </g>
  </g>

  <!-- 하단 푸터 -->
  <text x="1180" y="600" font-family="Arial, sans-serif" font-size="18" fill="#64748b" text-anchor="end">github.com/ldh-mini/baseball-sim</text>
</svg>`;

async function main() {
  if (!fs.existsSync(PUBLIC)) fs.mkdirSync(PUBLIC);
  if (!fs.existsSync(ICONS)) fs.mkdirSync(ICONS);

  // 1. favicon.svg (vector — 그대로 저장)
  fs.writeFileSync(`${PUBLIC}/favicon.svg`, APP_ICON_SVG);
  console.log('✅ public/favicon.svg');

  // 2. PNG 생성 (sharp)
  const appBuf = Buffer.from(APP_ICON_SVG);
  await sharp(appBuf).resize(192, 192).png().toFile(`${ICONS}/icon-192.png`);
  console.log('✅ public/icons/icon-192.png');
  await sharp(appBuf).resize(512, 512).png().toFile(`${ICONS}/icon-512.png`);
  console.log('✅ public/icons/icon-512.png');
  await sharp(appBuf).resize(180, 180).png().toFile(`${PUBLIC}/apple-touch-icon.png`);
  console.log('✅ public/apple-touch-icon.png');
  await sharp(appBuf).resize(64, 64).png().toFile(`${PUBLIC}/favicon.png`);
  console.log('✅ public/favicon.png (호환용)');

  // 3. og-image.png (1200×630)
  const ogBuf = Buffer.from(OG_IMAGE_SVG);
  await sharp(ogBuf).png({ quality: 90 }).toFile(`${PUBLIC}/og-image.png`);
  const stat = fs.statSync(`${PUBLIC}/og-image.png`);
  console.log(`✅ public/og-image.png (${(stat.size / 1024).toFixed(0)} KB)`);

  console.log('\n🎨 자산 생성 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
