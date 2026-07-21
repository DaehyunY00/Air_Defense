# Air_Defense_v2 고해상도 구현 실효성 진단

> **이력 주석**: 아래 본문은 C2/PIP/발사대 후속 이식 전 진단 기록이다. 현행 구현은 `2026-07-19-iads-native-pipeline-unification.md`에 기록했으며, 책임 C2 Resolver·scope WTA·개념 PIP/FC·발사대별 탄약/재장전·실제 중복 BDA가 추가되었다.

## 문제 정의

`Air_Defense_v2` 고해상도 배치·센서·C2·교전·자원 선언이 실제 실행 경로, 판정, trace, 분석, UI에 연결되었는지를 진단한다. 결과 차이를 키우기 위한 Pk·지연·사거리·용량 조정은 하지 않는다.

## 비교 기준

| 우선순위 | 비교 대상 | 상태 |
|---:|---|---|
| 1 | `/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/Air_Defense` | 이전 비교 기준, commit `02eea4c`, 읽기 전용. 기존 `.DS_Store` dirty만 존재 |
| 2 | 현재 `Air_Defense_v2` legacy 기능 OFF | `KJ.LEGACY_CATALOG`과 Phase 0 SHA-256 fixture |
| 3 | `IADS_codex_original` | 고해상도 목표/데이터 참조, 읽기 전용 |

`Air_Defense_v2` 초기 dirty 상태는 직전 Phase 0–1 이식 변경 전체와 기존 `.DS_Store` 3건이다. 초기 진단은 운영 로직을 수정하지 않고 시작했다. 후속 쌍대 실험에서 명백한 C2 방향성 연결 결함이 재현되어 focused test 선행 후 최소 수정했다. `.DS_Store`는 건드리지 않았다.

## 조사 대상

- 엔진: `js/engine/sim-engine.js`
- 배치: `js/config/system-types.js`, `geo-mdl.js`, `deployments.js`, `deployment-adapter.js`
- 분석: `js/analysis/*.js`
- UI/URL: `js/main.js`, `js/core/router.js`, `js/ui/*.js`, `index.html`
- 비교 기준: `../Air_Defense/js/**`
- trace/event 정본: 현재 결과 wire shape과 `threatTraces`, 원본의 canonical event 구조 존재 여부

## 실행 조건 고정

| 항목 | 값 |
|---|---|
| 주 비교 시나리오 | SC3 |
| 보조 시나리오 | SC1, SC2 |
| seed | 42 |
| 강도 | 1.5 |
| 실행시간 | 1800초 |
| 모드 | As-Is, To-Be |
| 배치 | legacy, MINI_NORMAL, FULL_NORMAL, FULL_MCRC_DOWN, FULL_KAMDOC_DOWN |
| E0 | `highResolutionDeployment` 생략/OFF |
| E1 | `highResolutionDeployment:true`, 선택 배치 |
| 후속 E2–E9 | 구현·플래그 존재 여부를 먼저 감사. 미구현은 미실행으로 보고 |

예상 신규 이벤트는 `SENSOR_DETECTED`, `TRACK_REPORTED`, `C2_STAGE_ENTERED`, `ENGAGEMENT_COMMITTED`, `ENGAGEMENT_FIRED`, `BDA_COMPLETED`, 자원 재장전 이벤트이다. 예상 신규 지표는 센서별 기여, track freshness, 후보 기각, PIP 성공률, 발사대 가동률·재장전이다. 이 두 집합이 실제로 존재하는지를 진단한다.

## 신규 기능 활성화 지도

- 실제 활성: 고해상도 deployment/catalog resolve, 노드·링크, 정적 axis coverage, 포대 합산 queue/channel/Pk.
- 선언만 존재: `quantity`, `launcherConfig`, `reloadConfig`, 센서/사수 `rangeKm`.
- 미구현: 위협 운동학, 런타임 센서 기하·상태, freshness/correlation, scope resolver, PIP/PSSEK, 발사대 별 자원·재장전, canonical events.
- 상세 표와 카탈로그 수량은 `artifacts/audit/feature-activation.json`.

## 정적 실행경로 분석

```text
UI simView.start
→ modelConfig(deploymentId, highResolutionDeployment)
→ KJ.runDES
→ Simulation → resolveModelCatalog
→ SPAWN → DETECT(정적 axis+Pd)
→ report/C2 queue → decision
→ _doEngage(정적 axis+aggregate channel)
→ BDA(Pk) → threatTraces/nodeSeries
→ 기존 분석·MC·axisPosition replay
```

Adapter 상단 주석와 구현이 모두 `phase1-axis-queue` 과도기 투영을 명시한다. `sim-engine.js` event dispatcher에는 기존 10개 event type만 있고 요구된 canonical type은 없다.

## 런타임 증거

- SC3/42/1.5/1800의 모든 고해상도 실행에서 `compatibilityPipelineThreats=307`.
- 같은 실행에서 geometry/state/freshness/correlation/scope/PIP/PSSEK/launcher/reload/canonical counter는 모두 0. 해당 훅이 없으므로 trace OFF 때문의 0이 아니다.
- FULL_NORMAL/To-Be: 307 발생, 303 탐지, 302 최초교전, 189 격추, 351발.
- FULL_NORMAL/As-Is: 307 발생, 303 탐지지만 최초교전 2, 격추 2, 중복교전 3,437. 이는 세부 모델 성과가 아니라 정적 MFR 팬아웃 왜곡이다.
- 전체 카운터는 `artifacts/audit/runtime-counters.json`.

## 차등 실험

1. `Air_Defense` 대 `Air_Defense_v2 legacy/OFF`: As-Is·To-Be 전체 JSON bit-exact. SHA-256 As-Is `3887555d...7527`, To-Be `20aff24c...3f31`.
2. deployment ON: 결과가 크게 변함. 다만 변화 원인은 상세 동역학이 아니라 catalog 노드/링크/정적 coverage/합산 용량.
3. 메모리 복제 catalog 통제 실험: `quantity+launcherConfig`, `reloadConfig`, adapter 생성 후 `rangeKm` 변경은 각각 full-result hash 불변. `coverage=[]`는 탐지·격추를 0으로 변경.
4. 기존 극단값: detect×0.01, delay×10, aggregate magazine=1은 각각 어서션과 MOE를 변경. 기존 축선/큐/집계 자원 경로가 살아 있음을 보이지만 세부 모델을 증명하지는 않는다.

## 시각화 경로 검토

- 배치: 선택 catalog를 Leaflet/SVG에 직접 전달. FULL To-Be 253 노드/506 링크, FULL As-Is 251/263으로 변화가 실제 표시됨.
- replay: `threatTraces` 자유형 stage를 `buildThreats` 후 `KJ.axisPosition` 선형 보간으로 재구성. 운동학/canonical event 소비자가 아님.
- 센서 상태, track freshness, 후보 기각, PIP, launcher/reload는 event가 없어 UI에도 표시 불가.
- 고해상도 선택 시 Phase 1 과도기 경고는 상시 표시됨.

## 원인 분류

| ID | 관측 문제 | 분류 | 우선순위 |
|---|---|---|---|
| A-01 | 세부 동역학 모듈/훅이 없음 | R1/R2 | P0(완성 주장 대비) |
| A-02 | launcher/reload/range 필드가 평탄화·미사용 | R3 | P1 |
| A-03 | canonical trace·분석·replay 미연결 | R5/R6/R7 | P1 |
| A-04 | 모든 MFR의 axis 팬아웃으로 As-Is 중복 폭증 | R3/R8/R11 | P1 |
| A-05 | UI 위협 궤적이 기존 axis 보간 | R7 | P2 |
| A-06 | 기본 dep=legacy로 상세 배치 미선택 시 완전 동일 | R2/R12 | 정상·의도된 회귀 |
| A-07 | ICC→본사장 상향 승인 링크 누락 | R3 | P0 수정 완료 |

## 권고 수정안

1. P0: 원본 event schema·domain RNG·threat timeline을 먼저 포트하고 E2–E9를 개별 flag/카운터로 연결.
2. P1: sensor state/track freshness/correlation 후에만 C2 report를 생성해 MFR 팬아웃 중복을 제거. 그 다음 scope resolver→PIP/PSSEK→launcher/reload 순서.
3. P1: canonical event를 analysis/replay의 단일 정본으로 삼고 기존 stage 문자열은 adapter로 하향 제공.
4. P2: D1–D6 식별 시나리오와 센서·항적·후보·발사대 중간 MOP panel 추가.

## 수정 결과

- focused test `tests/high-resolution-connection.test.js` 선행: 수정 전 3 FAIL.
- 원인: ECS→ICC는 있지만 ICC→KAMDOC/MCRC `coord` 반환 edge가 없어 `_decision`의 방향성 `coordPath()`가 실패.
- 최소 수정: `deployment-adapter.js`의 기존 ICC 링크를 같은 comm 정보로 양방향화. legacy catalog 불변.
- 수정 후 focused test 3 PASS, 배치 adapter test 55 PASS.
- 이 수정은 상향 경로만 복구하며 As-Is 중복 폭증/세부 동역학 누락을 해결했다고 보지 않는다.

## 검증 결과

- 진단 스크립트 7개 `node --check` 통과.
- 산출물 재생성: 6개 entry script 연속 실행 통과.
- legacy paired full JSON As-Is·To-Be bit-exact.
- trace ON/OFF 집계 결과 불변, stage 시간 단조, threat ID 유일.
- 10개 JSON을 두 번 연속 생성한 바이트 hash 일치.
- 진단 스냅샷: JS 25개 구문, 20개 스위트·528개 어서션 통과. 후속 이식·실패분류 v2·군단 AOC C2A 당시 26개 스위트·595개였고, legacy 지도 보완 후 현행은 JS 27개 구문·28개 스위트·664개 어서션이다.
- `git diff --check` 통과.
- 실제 Leaflet UI: FULL_NORMAL As-Is 251 마커, FULL_MCRC_DOWN 250 마커/MCRC 0, 상시 경고 표시. SC3/42/1.5 실행에서 trace 행 300, MC 30·30 완료, console error 0.
- 비교 기준 `Air_Defense` 상태는 초기와 동일한 `.DS_Store` 3건만 남았다. `IADS_codex_original`은 Git repository가 아니며 읽기만 수행했다.

## 잔여 위험

- FULL/MINI 절대 MOE는 현 과도기 adapter의 정적 coverage·팬아웃에 민감하여 전술적 값으로 사용할 수 없다.
- To-Be 개선폭은 세부 항적/교전 모델 효과가 아니라 기존 Pd fusion·IAOC 직결·자동화·WTA와 adapter 토폴로지가 합쳐진 결과다.
- `KAMDOC_DOWN/To-Be`는 이 시나리오에서 주요 MOE가 NORMAL과 동일하다. IAOC 직결이 제거 노드를 우회하므로 D5 식별 시나리오가 필요하다.
- 센서 상태·PIP·launcher event가 없어 UI/analysis 개선만으로 해결할 수 없다.
