# KBO 경기 결과 예측 시뮬레이터

> 세이버메트릭스 + 베이지안 블렌딩 + 모멘텀 보정을 활용한 KBO 야구 경기 예측 엔진. 매일 자동 크롤링으로 데이터를 갱신하고, 시점기반 백테스트로 적중률을 검증한다.

**현재 버전**: v9.4 (2026-04)

## 주요 특징

- **3-Layer 베이지안 블렌딩**: 2025 prior × 2026 시즌 데이터 × 최근 10경기 오버레이
- **팀 레이팅 동적 갱신**: KBO 공식 사이트 실시간 크롤링 → 시즌 진행에 따라 자동 보정
- **Layer 2C 모멘텀**: 최근 10경기 승률 + 연승/연패 streak 반영 (±7점)
- **시점기반 백테스트**: 일별 스냅샷으로 look-ahead bias 없는 진정한 검증
- **완전 자동화 파이프라인**: `npm run predict` 한 번으로 5단계 일괄 실행
- **A/B 검증 인프라**: 모멘텀 ON/OFF 동시 예측 + McNemar 통계 검정

## 빠른 시작

### 설치
```bash
npm install
npx playwright install chromium  # v9.3 백필 기능용
```

### UI 실행 (React + Vite)
```bash
npm run dev
# → http://localhost:5173
```

### 매일 운영 흐름
```bash
# 매일 아침: 오늘 경기 예측
npm run predict        # 크롤링 → 블렌딩 → 시뮬레이션 → 로그 append

# 다음날 정오: 어제 결과 자동 검증
npm run verify         # KBO 공식 사이트에서 결과 fetch → 적중 채움

# 주 1회: 누적 통계 리포트
npm run report
```

### 시점기반 백테스트
```bash
# 특정 날짜 범위에 대해 D-1 스냅샷으로 시점 예측
npm run backtest:snapshot 2026-04-01 2026-04-05

# A/B 모멘텀 비교 (모멘텀 ON/OFF 동시 실행)
node predict-snapshot.mjs 2026-04-01 2026-04-05 --ab momentum

# 그리드 서치 (가중치 매트릭스)
node grid-search.mjs

# 비교 리포트
node stats-report.mjs --compare
node stats-report.mjs --grid
```

### 과거 스냅샷 백필 (Playwright)
```bash
# KBO TeamRankDaily 페이지에서 과거 임의 날짜의 팀 전적 추출
node backfill-snapshots-pw.mjs 2026-03-31 2026-04-06

# 누적 득실점 보강 (Schedule API 기반)
node compute-historical-rsra.mjs
```

## 아키텍처

```
crawl-stats.mjs        2025 시즌 종합 (Statiz 기반)
crawl-recent.mjs       각 선수 최근 10경기
crawl-teamrank.mjs     팀 전적 + last10 + streak
crawl-schedule.mjs     당일 일정 + 예고선발
        ↓
blend-stats.mjs        Layer 1A: 베이지안(REG_PA=120, REG_IP=40)
                       Layer 1B: 팀 레이팅 동적 (LEGACY_2025 × 2026 전적)
                       Layer 1C: 누락 선발 자동 등록
                       Layer 2A: 최근 10경기 오버레이 (max 30%)
                       Layer 2C: 모멘텀 (last10/streak ±7)
                       Layer 3:  동적 recentForm (±8%)
        ↓
kbo-simulation.jsx     몬테카를로 시뮬레이션 엔진 (React UI 포함)
        ↓
sim-today.mjs          MC 1000회 예측 → prediction-log.json append
verify-yesterday.mjs   어제 예측 vs KBO 실제 결과 매칭
stats-report.mjs       전체/신뢰도/팀별/주별 적중률 + McNemar 검정
```

## 검증 결과

| 버전 | 백테스트 | 실전/시점 | 주요 개선 |
|------|---------|-----------|----------|
| v9.0 | 75.0% (2025 60경기) | 60% (실전 9/15) | 3-Layer 블렌딩, 엔진 버그 수정 |
| v9.1 | 75.0% | 자동화 완료 | 팀 레이팅 동적, 선발 자동감지, `npm run predict` |
| v9.2 | 75.0% | 4/5 시점 80% | Layer 2C 모멘텀, 일별 스냅샷, verify/report |
| v9.3 | 75.0% | **시점 68% (17/25)** | Playwright 백필, A/B 검증, **모멘텀 +8%p** |
| v9.4 | 75.0% | 84경기 백테스트 | 그리드 서치, McNemar 검정, 가중치 파라미터화 |

## 기술 스택

- **Frontend**: React 19 + Vite 8 + Tailwind CSS 3 (다크 글래스모피즘)
- **Engine**: JavaScript 몬테카를로 시뮬레이션, lodash
- **Crawler**: cheerio (HTTP) + Playwright (헤드리스 브라우저)
- **Data Source**: KBO 공식 사이트, Statiz 2025 실데이터

## 디렉토리

```
야구시뮬레이션/
├── kbo-simulation.jsx              메인 앱 (엔진 + UI, ~1800줄)
├── src/                            엔트리/스타일
├── crawl-*.mjs                     데이터 크롤러 (4개)
├── blend-stats.mjs                 3-Layer 블렌딩 엔진
├── sim-today.mjs                   당일 예측 + 로그
├── predict-snapshot.mjs            시점기반 백테스트 러너
├── verify-yesterday.mjs            어제 결과 자동 검증
├── stats-report.mjs                누적 통계 + 비교 + 그리드
├── grid-search.mjs                 가중치 매트릭스 서치
├── backfill-snapshots-pw.mjs       Playwright 과거 백필
├── compute-historical-rsra.mjs     Schedule API 누적 득실점
├── team-stats-snapshots/           일별 스냅샷
├── recent-stats.json               최근 10경기 캐시
├── prediction-log.json             누적 예측 로그
├── 프로젝트_개요서.md              상세 기능/로드맵
└── Logs/Plans/                     구현 플랜 기록
```

## 향후 작업 (v9.5+)

- 표본 200경기+ 누적 후 모멘텀 가중치 재검증
- 모멘텀 함수 형태 비교 (linear vs threshold)
- LLM 연동 (BALL-E 자연어 분석)
- 카메라 화면 분석 → 즉시 예측
- 사용자 인증 + 구독 시스템
- MLB / 축구 등 타 종목 확장

## 라이선스

Private. 외부 공개 전 데이터 출처 확인 필요 (KBO 공식 사이트 / Statiz 등).
