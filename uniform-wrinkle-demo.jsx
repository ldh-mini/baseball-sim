import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// 야구 유니폼 주름 물리 시뮬레이션 컴포넌트
// - Spring-Mass 기반 천 시뮬레이션
// - 타격/투구/달리기 동작별 주름 패턴
// - 바람·속도·중력 기반 실시간 물리 연산
// ═══════════════════════════════════════════════════════════════

// ── 물리 상수 ──
const GRAVITY = 0.15;
const DAMPING = 0.96;
const SPRING_K = 0.4;
const REST_LENGTH = 12;

// ── 천 시뮬레이션 유틸 ──
function createClothGrid(rows, cols, offsetX = 0, offsetY = 0) {
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({
        x: offsetX + c * REST_LENGTH,
        y: offsetY + r * REST_LENGTH,
        ox: offsetX + c * REST_LENGTH,
        oy: offsetY + r * REST_LENGTH,
        vx: 0,
        vy: 0,
        pinned: r === 0, // 상단 고정
      });
    }
  }
  return points;
}

function createSprings(rows, cols) {
  const springs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1) springs.push([i, i + 1, REST_LENGTH]);
      if (r < rows - 1) springs.push([i, i + cols, REST_LENGTH]);
      // 대각선 (구조 안정성)
      if (c < cols - 1 && r < rows - 1) {
        springs.push([i, i + cols + 1, REST_LENGTH * 1.41]);
        springs.push([i + 1, i + cols, REST_LENGTH * 1.41]);
      }
    }
  }
  return springs;
}

function simulateCloth(points, springs, wind, action, dt = 1) {
  // 외부 힘 적용
  for (const p of points) {
    if (p.pinned) continue;
    p.vx += wind.x * 0.05 + action.forceX * 0.08;
    p.vy += GRAVITY + wind.y * 0.02 + action.forceY * 0.06;
    // 약간의 랜덤 flutter
    p.vx += (Math.random() - 0.5) * wind.turbulence * 0.3;
    p.vy += (Math.random() - 0.5) * wind.turbulence * 0.15;
  }

  // 스프링 제약 (여러 번 반복으로 안정성 확보)
  for (let iter = 0; iter < 3; iter++) {
    for (const [a, b, rest] of springs) {
      const pa = points[a], pb = points[b];
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const diff = (dist - rest) / dist * SPRING_K;
      const fx = dx * diff, fy = dy * diff;
      if (!pa.pinned) { pa.vx += fx; pa.vy += fy; }
      if (!pb.pinned) { pb.vx -= fx; pb.vy -= fy; }
    }
  }

  // 속도/위치 업데이트
  for (const p of points) {
    if (p.pinned) continue;
    p.vx *= DAMPING;
    p.vy *= DAMPING;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // 원래 위치에서 너무 멀어지지 않도록 제한
    const maxDrift = 20;
    p.x = Math.max(p.ox - maxDrift, Math.min(p.ox + maxDrift, p.x));
    p.y = Math.max(p.oy - maxDrift, Math.min(p.oy + maxDrift, p.y));
  }
}

// ── 주름선 생성 (SVG 패스) ──
function generateWrinklePaths(points, cols, rows) {
  const paths = [];
  // 가로줄
  for (let r = 0; r < rows; r++) {
    let d = "";
    for (let c = 0; c < cols; c++) {
      const p = points[r * cols + c];
      d += c === 0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : ` L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
    paths.push(d);
  }
  // 세로줄
  for (let c = 0; c < cols; c++) {
    let d = "";
    for (let r = 0; r < rows; r++) {
      const p = points[r * cols + c];
      d += r === 0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : ` L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
    paths.push(d);
  }
  return paths;
}

// ── 주름 그림자/하이라이트 계산 ──
function getWrinkleShading(points, cols, rows) {
  const shading = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const p0 = points[r * cols + c];
      const p1 = points[r * cols + c + 1];
      const p2 = points[(r + 1) * cols + c];
      const p3 = points[(r + 1) * cols + c + 1];
      // 셀의 변형 정도로 그림자 강도 결정
      const deformX = Math.abs((p1.x - p0.x) - REST_LENGTH) + Math.abs((p3.x - p2.x) - REST_LENGTH);
      const deformY = Math.abs((p2.y - p0.y) - REST_LENGTH) + Math.abs((p3.y - p1.y) - REST_LENGTH);
      const intensity = Math.min((deformX + deformY) / 15, 1);
      shading.push({
        x: (p0.x + p1.x + p2.x + p3.x) / 4,
        y: (p0.y + p1.y + p2.y + p3.y) / 4,
        w: Math.abs(p1.x - p0.x) + 2,
        h: Math.abs(p2.y - p0.y) + 2,
        intensity,
        // 오른쪽으로 밀린 정도로 빛/그림자 방향 결정
        lightSide: (p1.x - p0.x) > REST_LENGTH,
      });
    }
  }
  return shading;
}

// ── 동작 프리셋 ──
const ACTION_PRESETS = {
  idle: {
    name: "대기",
    nameEn: "Idle",
    forceX: 0,
    forceY: 0,
    cycleSpeed: 0,
    description: "가만히 서있는 자세",
  },
  batting: {
    name: "타격",
    nameEn: "Batting",
    forceX: 0,
    forceY: 0,
    cycleSpeed: 0.08,
    description: "배트 스윙 시 상체 회전에 의한 주름",
  },
  pitching: {
    name: "투구",
    nameEn: "Pitching",
    forceX: 0,
    forceY: 0,
    cycleSpeed: 0.06,
    description: "와인드업~릴리스 팔·몸통 주름 변화",
  },
  running: {
    name: "달리기",
    nameEn: "Running",
    forceX: 0,
    forceY: 0,
    cycleSpeed: 0.12,
    description: "전력 질주 시 바람에 의한 펄럭임",
  },
  sliding: {
    name: "슬라이딩",
    nameEn: "Sliding",
    forceX: 0,
    forceY: 0,
    cycleSpeed: 0.1,
    description: "슬라이딩 시 하체 유니폼 뭉침",
  },
};

// ── 동작별 물리력 계산 ──
function getActionForce(action, time) {
  const t = time * (action.cycleSpeed || 0.05);
  switch (action.nameEn) {
    case "Batting": {
      // 스윙 사이클: 준비 → 스윙 → 팔로스루
      const phase = (Math.sin(t) + 1) / 2; // 0~1
      const swingForce = Math.sin(t * 2) * 3;
      const twistForce = Math.cos(t * 1.5) * 2;
      return { forceX: swingForce, forceY: twistForce * 0.5 };
    }
    case "Pitching": {
      // 와인드업 → 스트라이드 → 릴리스 → 팔로스루
      const phase = ((t % (Math.PI * 2)) / (Math.PI * 2));
      let fx = 0, fy = 0;
      if (phase < 0.3) {
        // 와인드업: 위로 당기는 힘
        fx = Math.sin(phase * 10) * 1.5;
        fy = -2 * phase;
      } else if (phase < 0.6) {
        // 스트라이드 + 릴리스: 강한 앞쪽 힘
        fx = 4 * Math.sin((phase - 0.3) * 10);
        fy = 2 * Math.cos((phase - 0.3) * 8);
      } else {
        // 팔로스루: 감속
        fx = 2 * Math.cos((phase - 0.6) * 8);
        fy = Math.sin((phase - 0.6) * 6);
      }
      return { forceX: fx, forceY: fy };
    }
    case "Running": {
      // 주기적 달리기 동작: 팔/다리 교차
      return {
        forceX: -2 + Math.sin(t * 3) * 1.5, // 뒤로 밀리는 힘 + 진동
        forceY: Math.abs(Math.sin(t * 3)) * 1.5 - 0.5, // 상하 바운스
      };
    }
    case "Sliding": {
      // 슬라이딩: 강한 수평 + 마찰
      const slidePhase = (Math.sin(t * 0.5) + 1) / 2;
      return {
        forceX: -3 * slidePhase + Math.sin(t * 4) * 0.5,
        forceY: 2 * slidePhase + Math.abs(Math.sin(t * 6)) * 1,
      };
    }
    default:
      return { forceX: Math.sin(t) * 0.2, forceY: Math.cos(t * 0.5) * 0.1 };
  }
}

// ── 팀 컬러 프리셋 ──
const TEAM_COLORS = {
  samsung: { primary: "#074CA1", secondary: "#FFFFFF", accent: "#D4D4D4", name: "삼성 라이온즈" },
  kia: { primary: "#C8102E", secondary: "#231F20", accent: "#FFFFFF", name: "기아 타이거즈" },
  lg: { primary: "#C30452", secondary: "#000000", accent: "#FFFFFF", name: "LG 트윈스" },
  doosan: { primary: "#131230", secondary: "#FFFFFF", accent: "#ED1C24", name: "두산 베어스" },
  kt: { primary: "#000000", secondary: "#E3002B", accent: "#FFFFFF", name: "KT 위즈" },
  ssg: { primary: "#CE0E2D", secondary: "#FFB81C", accent: "#FFFFFF", name: "SSG 랜더스" },
  hanwha: { primary: "#FF6600", secondary: "#1D1D1B", accent: "#FFFFFF", name: "한화 이글스" },
  lotte: { primary: "#002B5C", secondary: "#D00F31", accent: "#FFFFFF", name: "롯데 자이언츠" },
  nc: { primary: "#315288", secondary: "#C1A972", accent: "#FFFFFF", name: "NC 다이노스" },
  kiwoom: { primary: "#820024", secondary: "#000000", accent: "#FFFFFF", name: "키움 히어로즈" },
};

// ── 선수 실루엣 SVG 생성 ──
function PlayerSilhouette({ action, color, time }) {
  const t = time * (ACTION_PRESETS[action]?.cycleSpeed || 0.05);

  const poses = {
    idle: {
      body: "M100,50 L100,120",
      leftArm: "M100,70 L75,95",
      rightArm: "M100,70 L125,95",
      leftLeg: "M100,120 L85,165",
      rightLeg: "M100,120 L115,165",
    },
    batting: {
      body: `M100,50 L${100 + Math.sin(t * 2) * 8},120`,
      leftArm: `M100,70 L${60 + Math.sin(t * 2) * 30},${60 + Math.cos(t * 2) * 20}`,
      rightArm: `M100,70 L${140 + Math.sin(t * 2) * 25},${55 + Math.cos(t * 2) * 15}`,
      leftLeg: `M${100 + Math.sin(t * 2) * 5},120 L${80 + Math.sin(t) * 5},165`,
      rightLeg: `M${100 + Math.sin(t * 2) * 5},120 L${120 - Math.sin(t) * 5},165`,
    },
    pitching: {
      body: `M100,50 L${100 + Math.sin(t) * 10},120`,
      leftArm: `M100,70 L${65 + Math.cos(t * 1.5) * 20},${70 - Math.sin(t) * 30}`,
      rightArm: `M100,70 L${135 + Math.sin(t * 1.5) * 25},${50 + Math.cos(t) * 35}`,
      leftLeg: `M${100 + Math.sin(t) * 5},120 L${75 + Math.sin(t * 0.8) * 10},165`,
      rightLeg: `M${100 + Math.sin(t) * 5},120 L${125 + Math.sin(t * 1.2) * 15},${165 - Math.abs(Math.sin(t)) * 20}`,
    },
    running: {
      body: `M${100 - 5},50 L${100 - 3},120`,
      leftArm: `M97,70 L${70 + Math.sin(t * 3) * 20},${75 - Math.abs(Math.sin(t * 3)) * 15}`,
      rightArm: `M97,70 L${125 - Math.sin(t * 3) * 20},${75 - Math.abs(Math.cos(t * 3)) * 15}`,
      leftLeg: `M97,120 L${80 + Math.sin(t * 3) * 15},${155 + Math.sin(t * 3) * 10}`,
      rightLeg: `M97,120 L${115 - Math.sin(t * 3) * 15},${155 - Math.sin(t * 3) * 10}`,
    },
    sliding: {
      body: `M${80 + Math.sin(t * 0.5) * 5},80 L${130},${110 + Math.sin(t) * 3}`,
      leftArm: `M90,85 L${65 + Math.sin(t) * 5},${60 + Math.cos(t) * 5}`,
      rightArm: `M110,90 L${145 + Math.sin(t * 0.8) * 8},${85 + Math.cos(t) * 5}`,
      leftLeg: `M130,110 L${165},${120 + Math.sin(t * 2) * 3}`,
      rightLeg: `M130,110 L${160},${135 + Math.sin(t * 2.5) * 4}`,
    },
  };

  const pose = poses[action] || poses.idle;

  return (
    <g opacity={0.6}>
      {/* 머리 */}
      <circle cx={action === "sliding" ? 75 : 100} cy={action === "sliding" ? 70 : 42} r={10} fill={color} />
      {/* 몸통 */}
      <path d={pose.body} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" />
      {/* 팔 */}
      <path d={pose.leftArm} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
      <path d={pose.rightArm} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
      {/* 다리 */}
      <path d={pose.leftLeg} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" />
      <path d={pose.rightLeg} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" />
    </g>
  );
}

// ── 유니폼 천 패널 ──
function UniformPanel({ label, rows, cols, offsetX, offsetY, color, secondaryColor, points, shading, wrinklePaths }) {
  return (
    <g>
      {/* 유니폼 베이스 */}
      {shading.map((s, i) => (
        <rect
          key={`shade-${i}`}
          x={s.x - s.w / 2}
          y={s.y - s.h / 2}
          width={s.w}
          height={s.h}
          fill={s.lightSide ? color : secondaryColor}
          opacity={0.15 + s.intensity * 0.4}
          rx={1}
        />
      ))}
      {/* 주름선 */}
      {wrinklePaths.map((d, i) => (
        <path
          key={`wrinkle-${i}`}
          d={d}
          stroke={i < rows ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.12)"}
          strokeWidth={i < rows ? 0.8 : 0.6}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {/* 라벨 */}
      <text x={offsetX} y={offsetY - 6} fontSize={9} fill="#888" fontFamily="sans-serif">{label}</text>
    </g>
  );
}

// ═══════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════════════════
export default function UniformWrinkleDemo() {
  const [currentAction, setCurrentAction] = useState("idle");
  const [teamId, setTeamId] = useState("samsung");
  const [windSpeed, setWindSpeed] = useState(1);
  const [windAngle, setWindAngle] = useState(0);
  const [showPhysicsDebug, setShowPhysicsDebug] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const animRef = useRef(null);
  const timeRef = useRef(0);
  const [frameCount, setFrameCount] = useState(0);

  // 천 시뮬레이션 상태 (상의, 하의, 소매 좌/우)
  const PANELS = useMemo(() => ({
    torso: { rows: 8, cols: 6, offsetX: 75, offsetY: 55, label: "상의 몸통" },
    pants: { rows: 6, cols: 5, offsetX: 80, offsetY: 125, label: "하의" },
    sleeveL: { rows: 4, cols: 3, offsetX: 58, offsetY: 60, label: "좌 소매" },
    sleeveR: { rows: 4, cols: 3, offsetX: 112, offsetY: 60, label: "우 소매" },
  }), []);

  const clothRef = useRef({});

  // 천 초기화
  const initCloth = useCallback(() => {
    const cloth = {};
    for (const [key, cfg] of Object.entries(PANELS)) {
      cloth[key] = {
        points: createClothGrid(cfg.rows, cfg.cols, cfg.offsetX, cfg.offsetY),
        springs: createSprings(cfg.rows, cfg.cols),
        rows: cfg.rows,
        cols: cfg.cols,
      };
    }
    clothRef.current = cloth;
  }, [PANELS]);

  useEffect(() => { initCloth(); }, [initCloth]);

  // 애니메이션 루프
  useEffect(() => {
    if (!isPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const animate = () => {
      timeRef.current += playbackSpeed;
      const action = ACTION_PRESETS[currentAction];
      const force = getActionForce(action, timeRef.current);

      const windRad = (windAngle * Math.PI) / 180;
      const wind = {
        x: Math.cos(windRad) * windSpeed,
        y: Math.sin(windRad) * windSpeed * 0.3,
        turbulence: windSpeed * 0.5,
      };

      const actionWithForce = { ...action, ...force };

      for (const panel of Object.values(clothRef.current)) {
        simulateCloth(panel.points, panel.springs, wind, actionWithForce);
      }

      setFrameCount((c) => c + 1);
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isPlaying, currentAction, windSpeed, windAngle, playbackSpeed]);

  // 현재 렌더링 데이터 계산
  const renderData = useMemo(() => {
    const data = {};
    for (const [key, panel] of Object.entries(clothRef.current)) {
      if (!panel.points) continue;
      data[key] = {
        wrinklePaths: generateWrinklePaths(panel.points, panel.cols, panel.rows),
        shading: getWrinkleShading(panel.points, panel.cols, panel.rows),
        points: panel.points,
        rows: panel.rows,
        cols: panel.cols,
      };
    }
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameCount]);

  const team = TEAM_COLORS[teamId];

  const containerStyle = {
    maxWidth: 900,
    margin: "0 auto",
    fontFamily: "'Pretendard', 'Noto Sans KR', sans-serif",
    background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)",
    color: "#e0e0e0",
    borderRadius: 16,
    padding: 24,
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  };

  const panelStyle = {
    background: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    padding: 16,
    border: "1px solid rgba(255,255,255,0.08)",
  };

  const btnBase = {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    transition: "all 0.2s",
  };

  return (
    <div style={containerStyle}>
      {/* 헤더 */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, background: "linear-gradient(90deg, #60a5fa, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          야구 유니폼 주름 시뮬레이션
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#888" }}>
          Spring-Mass 기반 천 물리 · 동작별 실시간 주름 변화
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 16 }}>
        {/* 메인 시뮬레이션 뷰 */}
        <div style={panelStyle}>
          <svg
            viewBox="0 0 200 200"
            style={{
              width: "100%",
              maxHeight: 420,
              background: "radial-gradient(ellipse at center, rgba(255,255,255,0.03) 0%, transparent 70%)",
              borderRadius: 8,
            }}
          >
            <defs>
              <radialGradient id="spotlight" cx="50%" cy="30%" r="60%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* 배경 스포트라이트 */}
            <rect width="200" height="200" fill="url(#spotlight)" />

            {/* 선수 실루엣 */}
            <PlayerSilhouette action={currentAction} color="rgba(200,200,200,0.3)" time={timeRef.current} />

            {/* 유니폼 천 패널 렌더링 */}
            {Object.entries(renderData).map(([key, data]) => (
              <UniformPanel
                key={key}
                label={showPhysicsDebug ? PANELS[key].label : ""}
                rows={data.rows}
                cols={data.cols}
                offsetX={PANELS[key].offsetX}
                offsetY={PANELS[key].offsetY}
                color={team.primary}
                secondaryColor={team.accent}
                points={data.points}
                shading={data.shading}
                wrinklePaths={data.wrinklePaths}
              />
            ))}

            {/* 디버그: 질점 표시 */}
            {showPhysicsDebug && Object.values(renderData).map((data, pi) =>
              data.points.map((p, i) => (
                <circle
                  key={`dbg-${pi}-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={p.pinned ? 2 : 1.2}
                  fill={p.pinned ? "#ff4444" : "#44ff44"}
                  opacity={0.7}
                />
              ))
            )}

            {/* 바람 방향 표시 */}
            {windSpeed > 0 && (
              <g transform={`translate(180, 15) rotate(${windAngle})`}>
                <line x1={-8} y1={0} x2={8} y2={0} stroke="#60a5fa" strokeWidth={1.5} opacity={0.6} />
                <polygon points="8,0 4,-3 4,3" fill="#60a5fa" opacity={0.6} />
                <text x={0} y={-6} textAnchor="middle" fontSize={6} fill="#60a5fa" opacity={0.5} transform={`rotate(${-windAngle})`}>
                  바람
                </text>
              </g>
            )}

            {/* 동작 이름 */}
            <text x={100} y={192} textAnchor="middle" fontSize={10} fill="#60a5fa" fontWeight={600} filter="url(#glow)">
              {ACTION_PRESETS[currentAction]?.name}
            </text>
          </svg>

          {/* 재생 컨트롤 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{ ...btnBase, background: isPlaying ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)", color: isPlaying ? "#f87171" : "#4ade80" }}
            >
              {isPlaying ? "⏸ 일시정지" : "▶ 재생"}
            </button>
            <button
              onClick={() => { initCloth(); timeRef.current = 0; }}
              style={{ ...btnBase, background: "rgba(255,255,255,0.08)", color: "#ccc" }}
            >
              ↻ 초기화
            </button>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              style={{ ...btnBase, background: "rgba(255,255,255,0.08)", color: "#ccc" }}
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
            </select>
          </div>
        </div>

        {/* 컨트롤 패널 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 동작 선택 */}
          <div style={panelStyle}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>동작 선택</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(ACTION_PRESETS).map(([key, action]) => (
                <button
                  key={key}
                  onClick={() => { setCurrentAction(key); initCloth(); timeRef.current = 0; }}
                  style={{
                    ...btnBase,
                    background: currentAction === key ? `${team.primary}33` : "rgba(255,255,255,0.05)",
                    borderColor: currentAction === key ? team.primary : "rgba(255,255,255,0.1)",
                    color: currentAction === key ? "#fff" : "#aaa",
                    textAlign: "left",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{action.name}</div>
                  <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{action.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 팀 컬러 */}
          <div style={panelStyle}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>팀 유니폼</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
              {Object.entries(TEAM_COLORS).map(([id, t]) => (
                <button
                  key={id}
                  onClick={() => setTeamId(id)}
                  title={t.name}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: teamId === id ? "2px solid #fff" : "2px solid transparent",
                    background: `linear-gradient(135deg, ${t.primary}, ${t.secondary})`,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    transform: teamId === id ? "scale(1.1)" : "scale(1)",
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 6, textAlign: "center" }}>{team.name}</div>
          </div>

          {/* 바람 설정 */}
          <div style={panelStyle}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>바람</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 4 }}>
                <span>풍속</span>
                <span>{windSpeed.toFixed(1)} m/s</span>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                step={0.1}
                value={windSpeed}
                onChange={(e) => setWindSpeed(Number(e.target.value))}
                style={{ width: "100%", accentColor: team.primary }}
              />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 4 }}>
                <span>풍향</span>
                <span>{windAngle}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={windAngle}
                onChange={(e) => setWindAngle(Number(e.target.value))}
                style={{ width: "100%", accentColor: team.primary }}
              />
            </div>
          </div>

          {/* 디버그 토글 */}
          <div style={panelStyle}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#aaa", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showPhysicsDebug}
                onChange={(e) => setShowPhysicsDebug(e.target.checked)}
                style={{ accentColor: team.primary }}
              />
              물리 디버그 (질점·스프링 표시)
            </label>
          </div>
        </div>
      </div>

      {/* 하단 정보 */}
      <div style={{ marginTop: 16, padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
        <strong style={{ color: "#888" }}>시뮬레이션 원리:</strong> Spring-Mass 모델로 유니폼 천을 격자(Grid)로 모델링합니다.
        각 질점은 스프링으로 연결되어 있으며, 동작에 따른 외력·바람·중력이 실시간으로 적용됩니다.
        주름은 격자 변형(deformation) 정도에 따라 그림자와 하이라이트로 시각화됩니다.
        상의 몸통, 좌·우 소매, 하의 4개 패널이 독립적으로 시뮬레이션됩니다.
      </div>
    </div>
  );
}
