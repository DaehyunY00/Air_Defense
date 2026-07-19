# Air_Defense_v2 고해상도 구현 실효성 감사

> **2026-07-19 후속 구현 업데이트**: 이 문서의 본문은 후속 구현 전 상태를 기록한 스냅샷이다. 현재 고해상도 경로에는 ① 위협 종류·아키텍처·C2 생존상태로 KAMDOC/MCRC/ICC/IAOC/지역방공/USFK 독립 축을 결정하는 Resolver, ② command scope별 사수선정·중복 차단, ③ 개념 3D 축선·고도·요격체 속도·R/H 봉투의 PIP 가능성, ④ MFR 화력통제 상태, ⑤ 발사대별 탄약·900초 개별 재장전, ⑥ 실제 발사·BDA 기반 중복교전이 구현되었다. legacy/OFF는 구현 전 SHA-256 기준선과 bit-exact다.
>
> 아직 원본과 완전히 동일하지 않은 부분은 canonical event schema, 도메인별 RNG, 실시간 센서 손실·오차·항적 freshness/상관, 교차각·편란을 포함한 정밀 운동학, 전체 PSSEK 테이블이다. 따라서 FULL/MINI 결과는 고해상도 배치·C2·교전 로직 검증용이며 전술적 절대값이 아니다. 현행 구현 기록은 `docs/tasks/2026-07-19-iads-native-pipeline-unification.md`를 본다.

## 1. 결론

**여러 원인의 복합이며, 정확한 판정은 “일부만 작동”이다.**

고해상도 배치 선택은 실제 엔진·분석·MC·지도에 전달되고, 노드·링크·정적 축선 후보·포대 합산 queue를 바꾸므로 결과에 큰 영향을 준다. 반면 원본의 개별 위협 운동학, 런타임 센서 기하·상태, 항적 신선도·상관, C2 scope resolver, PIP/PSSEK, 발사대별 탄약·재장전, canonical event는 현재 엔진에 구현되어 있지 않다.

따라서 현재 FULL/MINI 결과는 “세부 고해상도 전술 모델”의 결과가 아니라 **고해상도 배치를 기존 9단계 axis/queue DES에 투영한 과도기 결과**다. UI 경고와 adapter 주석은 이 경계를 올바르게 밝히고 있다.

## 2. 비교 기준과 실행 조건

비교 우선순는 읽기 전용 `../Air_Defense` commit `02eea4c`, 현재 legacy/OFF, `tests/phase0-baseline.json`이다. `IADS_codex_original`은 배치 및 목표 구현 경계의 정본으로만 사용했다. SC3, seed 42, 강도 1.5, 1800초를 주 쌍대 조건으로 고정했다.

| 항목 | UI 기본값 | 엔진 기본값 | 감사 값 | 일치 |
|---|---|---|---|---|
| 배치 | legacy | HR flag false→legacy | legacy/MINI/FULL/DOWN | 기본 일치 |
| 시나리오 | SC1 | 필수 입력 | SC3 | 불일치(의도) |
| 아키텍처 | As-Is | 필수 입력 | 양 모드 | 기본 일치 |
| seed | 12345 | 1 | 42 | 불일치 |
| 강도 | 1.0 | 1.0 | 1.5 | 불일치(진단) |
| 시간 | 1800s | 1800s | 1800s | 일치 |
| MC 반복 | 30–200 수렴 | 선택 옵션 | 본 paired DES에서 N/A | — |

URL `dep` 선택은 `modelConfig()`에서 `deploymentId` + `highResolutionDeployment:true`로 변환된다. 잘못된 URL 배치는 router가 legacy로 복원하고, headless에서 HR ON+잘못된 ID는 명시적 예외를 발생시킨다. 기계 판독 세부는 `artifacts/audit/execution-config.json`에 있다.

## 3. 실제 실행경로

```text
UI #sim-run
→ js/ui/sim-view.js KJ.simView.start
→ modelConfig(dep)
→ KJ.runDES
→ js/engine/sim-engine.js Simulation
→ KJ.resolveModelCatalog
→ SPAWN
→ _beginDetect / _scanProb        [정적 axis coverage + Pd]
→ _onDetected / C2 queue          [catalog report/coord link]
→ _decision / _doEngage           [정적 axis + 합산 channel]
→ _onEngageEnd                    [포대 Pk, 합산 magazine option]
→ threatTraces/nodeSeries         [기존 자유형 trace]
→ analysis/MC + axisPosition replay
```

`Simulation` 생성자가 catalog를 저장하고 노드/링크/좌표 조회가 이 catalog를 사용한다. 배치 선택이 `KJ.NODES` 전역으로 다시 덮어써지는 우회는 없다. 다만 `deployment-adapter.js`가 원본 선언을 기존 node/link wire shape로 평탄화하며, 엔진에는 상세 객체/함수가 존재하지 않는다.

## 4. 기능별 활성화 상태

| 기능 | 실행 상태 | 결과 영향 | UI 표시 | 판정 |
|---|---|---|---|---|
| 고해상도 배치/catalog | 실행 | 큰 영향 | 노드·링크·범위 링 | 활성 |
| 포대별 MFR/ECS | 인스턴스·queue로 실행 | report/큐/중복에 영향 | 개별 노드 | 부분 |
| 개별 위협 운동학 | 미구현 | 없음 | axis 선형 보간만 | 미활성 |
| 센서 기하 | adapter 생성 시 axis로 1회 축약 | 정적 coverage만 영향 | 원형 range | 평탄화 |
| 센서 상태/ECM | 미구현 | 없음 | 없음 | 미활성 |
| freshness/correlation | 미구현 | 없음 | 없음 | 미활성 |
| C2 scope resolver | 정적 role ID 매핑만 | 제한적 | 링크 시각화 | 미활성 |
| PIP/상세 봉투/PSSEK | 미구현 | 없음 | range ring만 | 미활성 |
| 발사대별 자원/재장전 | 필드만 존재 | 없음 | 없음 | 미활성 |
| 포대 합산 channel/magazine | 실행, magazine 기본 OFF | 영향 | 합산 node 재고 | 활성/옵션 |
| canonical trace | 미구현 | 없음 | 없음 | 미활성 |
| 기존 trace/analysis/replay | 실행 | 집계·표시 | stage log/axis replay | legacy 경로 |

전체 16개 기능 행과 catalog 수량은 `artifacts/audit/feature-activation.json`에 있다.

## 5. 이전 버전과 v2 legacy 차등

SC3/42/1.5/1800에서 `Air_Defense` 대 `Air_Defense_v2 legacy/OFF`는 As-Is·To-Be 모두 **전체 result JSON bit-exact**다.

| 모드 | Air_Defense SHA-256 | v2 legacy SHA-256 | 위협별 변경 |
|---|---|---|---:|
| As-Is | `3887555d…f7527` | 동일 | 0/307 |
| To-Be | `20aff24c…3f31` | 동일 | 0/307 |

이는 HR flag OFF 회귀 보존이 완전하다는 증거이지, HR ON의 세부 기능을 증명하지는 않는다. 전체 snapshot과 위협별 비교는 `legacy-sc3-42.json`, `v2-sc3-42.json`, `legacy-v2-diff.json`에 있다.

## 6. As-Is과 To-Be 차별성

두 모드는 같은 배치·위협 발생열·물리 type Pk를 공유하지만, 기존 엔진 입력은 실제로 다르다.

| 입력 요소 | As-Is | To-Be | 실제 값 차이 | 결과 사용 |
|---|---|---|---|---|
| 탐지 결합 | 최선 단일 센서 Pd | any-sensor 결합 | 있음 | `_scanProb` |
| 보고/융합 | 다중 C2 팬아웃 | IAOC 직결/융합 | 있음 | `_onDetected` |
| 승인/자동화 | human-in-loop 중심 | preauth/on-loop | 있음 | `_decision` |
| WTA | 최소 합산부하 | suit·cost·잔여용량 | 있음 | `_doEngage` |
| visible track/freshness | 세부 모델 없음 | 세부 모델 없음 | 없음 | 미사용 |
| commander scope/BDA 공유 | 동적 resolver 없음 | 동적 resolver 없음 | 없음 | 미사용 |

같은 307개 위협 발생열을 사용했지만 결과는 강하게 분리됐다.

| 배치 | As-Is 격추율 | To-Be 격추율 | 차이 | As-Is/To-Be 결심지연 |
|---|---:|---:|---:|---:|
| legacy | 20.82% | 53.60% | +32.78%p | 218.96s / 18.33s |
| MINI_NORMAL | 0.78% | 59.70% | +58.92%p | 6.72s / 8.24s |
| FULL_NORMAL | 0.78% | 66.55% | +65.77%p | 5.01s / 8.23s |
| FULL_MCRC_DOWN | 2.70% | 68.97% | +66.26%p | 4.04s / 4.49s |
| FULL_KAMDOC_DOWN | 42.86% | 66.55% | +23.69%p | 4.18s / 8.23s |

고해상도 As-Is의 지나친 저조성과 중복 사격은 아키텍처의 순수 성능 차이로 보면 안 된다. 정적 MFR 팬아웃과 항적 상관 부재가 혼입된 과도기 왜곡이다.

## 7. 배치 실효성과 통제 실험

MINI/FULL/NORMAL/DOWN은 catalog 노드·링크 수, 활성 queue, 사수 분포, MOE를 실제로 바꾸므로 배치 선택이 dead code는 아니다. FULL_NORMAL은 모드 선언 전 253 노드이며 As-Is 251/263(노드/링크), To-Be 253/506이다. MINI_NORMAL은 As-Is 31/35, To-Be 33/72이다.

통제된 메모리 복제 catalog 실험은 평탄화 경계를 명확히 보였다.

| 변형 | 전체 결과 hash | 판정 |
|---|---|---|
| 모든 shooter `quantity=9999`, launcherConfig 변경 | 불변 | 개별 발사대 미사용 |
| reloadConfig만 변경 | 불변 | 재장전 미사용 |
| adapter 생성 후 rangeKm=0 | 불변 | 런타임 기하/봉투 미사용 |
| legacy decision field `coverage=[]` | 변경, 탐지/격추 0 | 정적 axis 경로 활성 |
| aggregate magazine=1 | 변경, `no_ammo=226` | 포대 합산 자원만 활성 |

NORMAL→DOWN은 대체로 영향을 주지만, KAMDOC_DOWN/To-Be의 핵심 MOE는 NORMAL과 완전히 같다. To-Be IAOC 직결이 KAMDOC를 우회하므로 현 SC3가 해당 node 무력화를 식별하지 못한다.

## 8. Canonical trace 정합성

요구된 `SENSOR_DETECTED`, `SENSOR_TRACKED`, `SENSOR_FIRE_CONTROL`, `TRACK_REPORTED`, `TRACK_RECEIVED`, `C2_STAGE_ENTERED`, `INTENT_GENERATED`, `ENGAGEMENT_COMMITTED`, `CANDIDATE_REJECTED`, `ENGAGEMENT_FIRED`, `BDA_COMPLETED`, `RESOURCE_RELOAD_*`, `THREAT_LEAKED`는 현재 event dispatcher와 결과에 없다. `canonicalEventsCreated=0`은 시나리오 미발화가 아니라 스키마/생성자 미구현의 결과다.

기존 `threatTraces[].stages` 문자열 trace는 내부적으로는 안정적이다. legacy/MINI/FULL×양 모드에서 trace ON/OFF 집계 결과가 동일하고, 시간이 단조 증가하며, threat ID가 유일했다. 그러나 센서 소스, 상태, 후보 기각, PIP, launcher 전이가 없어 원본 구현과의 semantic replay 동치를 검증할 수 없다.

## 9. 분석 경로

DES, 정적 병목 분석, MC, 민감도, 전환점, overlap 분석은 모두 같은 deployment ID/features를 전달받는다. 서로 다른 엔진을 보는 P0 분기는 없다. 다만 분석이 소비할 canonical sensor/track/candidate/launcher event 자체가 없으므로 기존 node/link/global 집계 이상의 MOP를 제공할 수 없다.

## 10. UI 경로

- **배치:** 연결. 선택 `positions`, MFR, ECS, C2, shooter, DOWN 제거가 Leaflet/SVG에 반영된다.
- **센서 상태:** 미연결. 상태 event가 없고 원형 range만 표시한다.
- **C2 흐름:** 부분 연결. catalog 링크와 기존 stage log를 표시하지만 canonical track/intent/commit은 없다.
- **교전:** 부분 연결. 포대 ID가 문자열 stage에 남지만 PIP/기각 사유/발사체 운동은 없다.
- **자원:** 포대 queue/옵션 magazine만. launcher 가용률·재장전은 없다.
- **누출 원인:** 기존 taxonomy는 표시. stale/no-PIP/reload 원인은 생성되지 않음.

위협 replay는 canonical trace가 아니라 `threatTraces` 결과를 `KJ.axisPosition(axis, progress)`로 재구성한다. 배치가 FULL로 바뀌어도 위협 궤적이 기존 4개 축선처럼 보이므로, 사용자가 “결과가 같다”고 느끼기 쉽다.

## 11. 시나리오 식별력

현 SC3는 기존 Pd, 큐, 링크 지연, 합산 탄약 극단값에 반응하므로 legacy DES 식별력은 있다. 그러나 미구현된 세부 기능의 식별력은 평가할 수 없다. 후속으로 기존 시나리오를 변경하지 말고 다음 진단 전용 세트를 추가해야 한다.

| 시나리오 | 자극 로직 | 사전 반증 관측치 |
|---|---|---|
| D1 센서 경계 | 기하·인계 | 탐지 소실/재획득, sensor source 변경 |
| D2 저고도/저RCS | 수평선·SHORAD FC | track/FC 전환율 |
| D3 stale | 보고주기·지연 | stale 비율, commit 지연 |
| D4 launcher 포화 | 개별 launcher/reload | 재장전 event, reload 중 누출 |
| D5 C2 DOWN | scope/failover | commander·사수·누출 변경 |
| D6 독립축 | 비공유 | USFK/ROK 중복 또는 기회손실 |

## 12. 원인 분류과 우선순위

| ID | 관측 문제 | 원인 분류 | 코드/런타임 증거 | 영향 | 우선순위 |
|---|---|---|---|---|---|
| A-01 | 세부 모듈/이벤트 미구현 | R1/R2 | 해당 정의/플래그 없음, counter 0 | 고해상도 완성 불가 | P0 |
| A-02 | launcher/reload/range 미사용 | R3 | 필드 변형 hash 불변 | 자원/기하 무차별 | P1 |
| A-03 | canonical trace 없음 | R5/R6/R7 | dispatcher/result에 schema 없음 | 분석·UI 세부 MOP 불가 | P1 |
| A-04 | As-Is MFR 중복 폭증 | R3/R8/R11 | FULL 3,437 duplicate | 절대 MOE 왜곡 | P1 |
| A-05 | axis replay | R7 | `KJ.axisPosition` | 화면상 차이 축소 | P2 |
| A-06 | 기본 legacy 동일 | R2/R12 | 이전 버전 bit-exact | 선택 전에는 차이 없음 | 정상 |
| A-07 | ICC 상향 링크 누락 | R3 | focused test 수정 전 3 FAIL | As-Is 주 교전 단절 | P0 완료 |

## 13. 수정 권고

### P0

1. 원본 canonical event contract와 domain RNG ledger를 먼저 이식한다.
2. threat timeline/운동학→sensor geometry/state 순서로 연결하고, 각 계층의 flag·counter·focused test를 만든다.

### P1

1. track freshness/correlation을 report 전에 적용해 정적 MFR 팬아웃을 대체한다.
2. architecture-aware C2 scope resolver를 단일 WTA 입구 앞에 연결한다.
3. PIP/envelope/PSSEK→launcher reservation→per-launcher reload 순서로 이식한다.
4. canonical trace를 analysis/replay 단일 정본으로 사용한다.

### P2

1. sensor source/state, track age, candidate rejection, PIP, launcher/ammo/reload panel을 canonical event 기반으로 추가한다.
2. D1–D6 식별 시나리오를 운영 기본과 분리한다.

Pk, 지연, 사거리, 처리용량을 결과 차이를 키우기 위해 조정하면 안 된다.

## 14. 수정 결과

진단 중 명백한 P0 연결 결함 하나를 수정했다. 포대 MFR→ECS 주 항적이 상위 승인을 찾으려면 ECS→ICC→KAMDOC/MCRC 방향 경로가 필요한데, adapter에는 내려가는 ICC 링크만 있었다. 수정 전 focused test는 3건 모두 실패했다.

`deployment-adapter.js`에 기존 통신 정의를 재사용한 ICC→KAMDOC/MCRC `coord` edge를 추가했다. legacy catalog, Pk, 지연 수치, 사거리, 용량은 변경하지 않았다. 수정 후 focused 3/3과 기존 adapter 55/55가 통과했다.

수정 후도 FULL/As-Is duplicate 3,437은 남았다. 이는 상향 edge 문제가 아니라 세부 센서/항적 모델 부재의 결과이므로, 임의 토폴로지 보너스로 숨기지 않았다.

## 15. 남은 위험

- FULL/MINI 절대 MOE를 전술적 수치로 보고하면 안 된다.
- To-Be 개선폭은 기존 Pd fusion·IAOC·자동화·WTA와 과도기 토폴로지가 혼합된 값이다.
- 배치 노드 수가 많아져도 개별 발사대 상태가 아니므로 자원 분해능이 높아지지 않는다.
- canonical event가 없어 엔진·분석·UI 간 의미론적 동치를 증명할 수 없다.
- 원본을 조건별 수치 기준으로 직접 비교하려면 두 모델 간 scenario/threat/event ontology 매핑을 먼저 별도 정의해야 한다.

## 산출물

기계 판독 결과는 `artifacts/audit/` 10개 JSON에 있고, 재생 스크립트는 `scripts/audit-*.mjs`, `scripts/compare-*.mjs`, `scripts/verify-trace-consistency.mjs`에 있다. 감사 기준일과 입력을 고정했으므로 동일 코드에서 10개 JSON 전체가 바이트 단위로 결정론적이다.

## 16. 검증 결과

- 스크립트: audit 공통 모듈 + 6개 entry script `node --check` 통과.
- 재생성: 6개 entry script를 두 번 연속 실행해 10개 JSON SHA-256 전체 일치.
- 쌍대 비교: SC3/42 legacy As-Is·To-Be 전체 JSON bit-exact.
- trace: legacy/MINI/FULL×양 모드 trace ON/OFF 집계 동일, 단조 시간, 유일 ID.
- focused regression: 수정 전 3 FAIL → ICC 반환 edge 추가 후 3 PASS.
- 스냅샷 시점 회귀: JS 25개 구문, 20개 스위트, 528개 어서션 전부 통과. 후속 구현 후 현행 기준은 JS 27개 구문·22개 스위트·555개 어서션이다.
- `git diff --check` 통과.
- Leaflet UI: FULL_NORMAL As-Is 251 마커, FULL_MCRC_DOWN 250 마커와 MCRC 0, 경고 표시. FULL/SC3/42/1.5 DES·MC 실행, trace 행 300, console error 0.
- commit, push, PR은 생성하지 않았다.
