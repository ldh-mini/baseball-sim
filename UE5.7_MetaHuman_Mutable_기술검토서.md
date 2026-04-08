# UE 5.7 MetaHuman + Mutable 캐릭터 커스터마이징 시스템 기술 검토서

**작성일:** 2026년 3월 30일
**목적:** 야구 시뮬레이션 프로젝트에 언리얼 엔진 5.7의 MetaHuman과 Mutable 플러그인을 활용한 선수 캐릭터 커스터마이징 시스템 도입 가능성 검토

---

## 1. 기술 개요

### 1.1 Unreal Engine 5.7 현황

UE 5.7은 2026년에 정식 출시되었으며, 야구 시뮬레이션에 직접 관련되는 주요 업데이트는 다음과 같다.

**Substrate (정식 출시):** 모듈형 머티리얼 저작 및 렌더링 프레임워크가 프로덕션 레디 상태로 전환되었다. 금속, 클리어코트, 피부, **천(Cloth)** 등 복수 머티리얼 동작을 물리적으로 정확하게 조합할 수 있다. 이는 유니폼 소재(폴리에스터, 메시 원단)와 피부 표현을 동시에 고품질로 구현할 수 있음을 의미한다.

**애니메이션 시스템 개선:** 리팩토링된 Animation Mode, Selection Sets 지원이 추가되어 다수의 컨트롤 리그를 효율적으로 관리할 수 있다. 야구 선수의 타격·투구·주루 등 복합 애니메이션 작업 시 생산성 향상이 기대된다.

**MetaHuman 5.7 동시 출시:** Linux/macOS 크로스 플랫폼 지원, A-pose 제한 해제, 신장 제한 완화, FBX 라운드트립 지원 등이 추가되었다.

### 1.2 MetaHuman 시스템

MetaHuman은 Epic Games가 제공하는 고품질 디지털 휴먼 생성 도구로, 야구 시뮬레이션 관점에서 다음과 같은 기능을 제공한다.

**얼굴 커스터마이징:** MetaHuman Creator에서 얼굴 형태, 피부 톤, 주름, 눈 색상 등을 세밀하게 조정할 수 있다. 실제 선수와 유사한 외모를 재현하는 데 활용 가능하다.

**체형 커스터마이징:** 5.7 버전에서 신장 제한이 완화되어 다양한 체형의 야구 선수(투수의 장신, 내야수의 민첩형 등)를 표현할 수 있다.

**그루밍(헤어):** 절차적 그루밍 도구와 아트 디렉팅 헤어 애니메이션이 추가되었다. 헬멧 아래 머리카락, 수염 등의 표현이 가능하다.

**FBX 라운드트립:** 외부 DCC 도구(Maya, Blender 등)에서 수정 후 다시 엔진으로 가져올 수 있어, 팀별 유니폼이나 보호 장구 등의 커스텀 에셋 통합이 용이하다.

### 1.3 Mutable 플러그인

Mutable은 UE 5.5에서 처음 도입된 캐릭터 커스터마이징 전용 시스템이다. 현재 **베타** 단계이며, 런타임에서 동적으로 스켈레탈 메시, 머티리얼, 텍스처를 생성한다.

**핵심 개념:**

- **CustomizableObject:** 모든 가능한 변형(유니폼 색상, 번호, 장비 등)을 정의하는 에셋. 에디터에서 노드 그래프로 편집한다.
- **CustomizableObjectInstance:** CustomizableObject의 특정 파라미터 값 세트. 각 선수가 하나의 인스턴스를 가진다.
- **Object Groups:** 상호 배타적 선택을 관리. 예를 들어 헬멧 그룹에서는 하나의 헬멧만 선택 가능하다.
- **States:** 특정 사용 시나리오별 최적화. 예를 들어 "경기 중" 상태와 "선수 편집" 상태에서 서로 다른 LOD 전략을 적용할 수 있다.

**성능 최적화 기법:**

- 메시 및 텍스처 병합으로 Draw Call 감소
- Morph 베이킹으로 GPU 부하 절감
- 텍스처 레이어링 및 데칼 프로젝션 베이킹
- 런타임 스켈레탈 메시 병합 (기존 방식 대비 효율적)
- 숨겨진 표면 제거(Hidden Surface Removal)로 Z-fighting 방지 및 오브젝트 레이어링
- LOD 지원으로 거리에 따른 폴리곤 카운트 자동 조절

---

## 2. 야구 시뮬레이션 적용 설계

### 2.1 커스터마이징 항목 분류

| 카테고리 | 항목 | Mutable 구현 방식 | 우선순위 |
|---------|------|------------------|---------|
| **얼굴** | 얼굴형, 피부톤, 눈/코/입 | MetaHuman Creator 프리셋 + 파라미터 | 높음 |
| **체형** | 신장, 체중, 근육량 | MetaHuman Body 파라미터 + Morph Target | 높음 |
| **유니폼 상의** | 팀 컬러, 등번호, 이름, 소매 길이 | Mutable 텍스처 레이어 + 데칼 | 높음 |
| **유니폼 하의** | 바지 길이, 색상, 벨트 | Mutable 메시 스위칭 + 머티리얼 | 높음 |
| **헬멧** | 팀별 헬멧, 페이스가드, 이어플랩 | Mutable Object Groups (배타적 선택) | 중간 |
| **장갑** | 배팅 글러브, 수비 글러브 | Mutable Object Groups | 중간 |
| **신발** | 스파이크 종류, 색상 | Mutable 머티리얼 파라미터 | 낮음 |
| **액세서리** | 선글라스, 손목밴드, 팔꿈치 보호대 | Mutable 메시 추가/제거 | 낮음 |
| **헤어** | 헤어스타일, 수염 | MetaHuman 그루밍 | 중간 |

### 2.2 아키텍처 제안

```
[MetaHuman Creator]
  ↓ 베이스 캐릭터 (얼굴/체형/헤어)
  ↓
[CustomizableObject: 야구선수]
  ├─ Group: 유니폼상의 (팀컬러, 번호, 이름패치)
  ├─ Group: 유니폼하의 (바지 스타일, 색상)
  ├─ Group: 헬멧 (타격용/수비용/없음)
  ├─ Group: 글러브 (배팅/수비/없음)
  ├─ Group: 신발 (스파이크 종류)
  └─ Group: 액세서리 (선글라스, 밴드 등)
       ↓
  [CustomizableObjectInstance: 선수 A]
       ↓
  State: "경기중" → 최적화된 LOD, 병합 메시
  State: "선수편집" → 풀 디테일, 개별 메시
```

### 2.3 KBO 10개 구단 유니폼 시스템

유니폼 커스터마이징은 Mutable의 텍스처 레이어링 시스템을 활용한다.

**레이어 구조:**
1. **Base Layer:** 유니폼 기본 원단 텍스처 (폴리에스터 재질)
2. **Color Layer:** 팀별 메인/서브 컬러 마스크 적용
3. **Logo Layer:** 구단 로고 데칼 프로젝션
4. **Number Layer:** 등번호 + 이름 데칼 (런타임 텍스트 렌더링)
5. **Patch Layer:** 리그 패치, 스폰서 로고 등

이 구조를 사용하면 10개 구단 × 홈/원정 × 등번호 변형을 소수의 베이스 에셋과 파라미터 조합으로 처리할 수 있어, 메모리 사용량과 에셋 관리 비용을 크게 줄일 수 있다.

---

## 3. 알려진 이슈 및 리스크

### 3.1 Mutable + MetaHuman 얼굴 리그 호환성 문제 (높은 리스크)

커뮤니티에서 보고된 가장 심각한 문제는 **Mutable이 MetaHuman의 얼굴 뼈대 구조를 손상시키는 현상**이다. CustomizableObject에서 MetaHuman 헤드를 스와핑할 때, 컴파일 후 에디터를 두 번 재시작하거나 패키지 빌드에서만 정상 동작하는 경우가 보고되었다.

**대응 방안:**
- 얼굴과 몸체를 분리하여, MetaHuman 헤드는 Mutable 파이프라인 밖에서 별도 관리
- 얼굴 커스터마이징은 MetaHuman Creator 프리셋 선택 방식으로 제한
- Mutable은 몸체(유니폼, 장비)에만 적용
- UE 5.7의 최신 Mutable 버전에서 수정 여부를 공식 문서에서 확인 필요

### 3.2 베타 상태의 불안정성 (중간 리스크)

Mutable은 아직 베타 단계이므로 API 변경, 예기치 않은 크래시, 문서 부족 등이 예상된다.

**대응 방안:**
- 핵심 기능(유니폼 색상, 번호)만 Mutable에 의존하고, 복잡한 메시 변형은 전통적 방식(Skeletal Mesh Component 스와핑) 병행
- Mutable의 주요 버전 업데이트마다 마이그레이션 테스트 수행
- Epic의 Mutable 로드맵에서 "Macro Libraries & Streaming" 기능 출시 시점 추적

### 3.3 성능 우려 (중간 리스크)

런타임 메시 생성은 로딩 시간에 영향을 줄 수 있다. 야구 시뮬레이션에서는 경기 시작 시 최대 18명의 선수 + 심판 + 관중이 동시 로딩될 수 있다.

**대응 방안:**
- Mutable States를 활용해 "경기 중" 상태에서는 미리 병합된 메시 캐시 사용
- 비동기 인스턴스 생성으로 프레임 드롭 방지
- 벤치/불펜 선수는 저해상도 State로 전환
- LOD를 적극 활용하여 카메라 거리에 따른 자동 최적화

### 3.4 MetaHuman 자체 퍼포먼스 (낮은 리스크)

MetaHuman 캐릭터는 단독으로도 고비용 에셋이다. 다만 UE 5.7의 Substrate 정식 출시와 Nanite 연동으로 이전 버전 대비 렌더링 효율이 개선되었다.

---

## 4. 권장 워크플로우

### Phase 1: 프로토타입 (2~3주)

1. UE 5.7에서 Mutable 플러그인 활성화 및 Sample Project 분석
2. MetaHuman 1체를 기반으로 유니폼 상의/하의 CustomizableObject 제작
3. 팀 컬러 + 등번호 파라미터 테스트
4. 얼굴 리그 호환성 검증 (헤드 분리 vs 통합 방식 비교)

### Phase 2: 파이프라인 구축 (3~4주)

1. KBO 10개 구단 유니폼 에셋 제작 파이프라인 확립
2. CustomizableObject 노드 그래프 템플릿 작성
3. 선수 데이터(이름, 번호, 체형)에서 자동 인스턴스 생성 시스템 구현
4. States 설정 (경기중 / 선수편집 / 원거리)

### Phase 3: 최적화 및 통합 (2~3주)

1. 18명+ 동시 렌더링 성능 프로파일링
2. LOD 및 메시 병합 최적화
3. 기존 애니메이션 시스템과 Mutable 메시 통합 검증
4. 유니폼 주름 시뮬레이션(이전 구현한 천 물리)과의 연동 테스트

---

## 5. 결론 및 권장 사항

MetaHuman + Mutable 조합은 야구 시뮬레이션의 선수 커스터마이징 시스템으로 기술적으로 적합하며, 특히 유니폼 파라미터화와 런타임 최적화 측면에서 강점이 있다.

다만 다음 사항을 반드시 고려해야 한다.

첫째, **얼굴과 몸체를 분리 관리**하는 것을 강력히 권장한다. Mutable의 MetaHuman 얼굴 리그 손상 이슈가 해결될 때까지, 얼굴은 MetaHuman 프리셋 방식으로, 유니폼/장비는 Mutable로 이원화하는 것이 안전하다.

둘째, **베타 리스크를 완화**하기 위해 Mutable에 대한 의존도를 단계적으로 높이는 전략이 필요하다. 초기에는 유니폼 색상·번호 등 단순 파라미터에만 적용하고, 안정성이 검증되면 장비·액세서리로 확장한다.

셋째, UE 5.7의 **Substrate와 연계**하여 유니폼 원단(폴리에스터, 메시)과 피부 등 복합 머티리얼을 물리 기반으로 정확하게 표현할 수 있으므로, 이전 작업에서 구현한 유니폼 주름 시뮬레이션과의 시너지가 기대된다.

---

## 참고 자료

- [UE 5.7 Release Notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-7-release-notes)
- [UE 5.7 공식 발표](https://www.unrealengine.com/en-US/news/unreal-engine-5-7-is-now-available)
- [MetaHuman 5.7 업데이트](https://www.metahuman.com/en-US/releases/metahuman-5-7-is-now-available)
- [Mutable + MetaHuman 공식 문서](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-mutable-and-metahumans-in-unreal-engine)
- [Mutable Overview (UE 5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/mutable-overview-in-unreal-engine)
- [Mutable Quickstart Guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/mutable-quickstart-guide-for-unreal-engine)
- [Mutable 최적화 및 디버깅](https://dev.epicgames.com/documentation/en-us/unreal-engine/mutable-optimizing-and-debugging-in-unreal-engine)
- [Mutable States 활용](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-customizable-states-in-mutable-with-unreal-engine)
- [Mutable Sample Project](https://www.unrealengine.com/en-US/news/the-mutable-sample-project-is-now-available)
- [Mutable + MetaHuman 커뮤니티 튜토리얼](https://dev.epicgames.com/community/learning/tutorials/rMG7/unreal-engine-mutable-with-metahumans-character-creation-system-part-1-and-2)
- [MetaHuman 얼굴 리그 이슈 포럼](https://forums.unrealengine.com/t/mutable-destroys-metahuman-face-advanced-rig-logic-for-mutable/2354600)
- [Mutable 퍼포먼스/Draw Call 포럼](https://forums.unrealengine.com/t/mutable-and-metahuman-general-performances-and-draw-calls/2598133)
- [Epic Mutable 로드맵](https://portal.productboard.com/epicgames/1-unreal-engine-public-roadmap/c/1628-mutable-customizable-characters-and-meshes-beta-)
