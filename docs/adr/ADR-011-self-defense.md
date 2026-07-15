# ADR-011 — 자체교전 (Self-Defense / 자율 교전, WP2)

## 맥락
WP1 세분화로 포대(battery)가 MFR(교전통제레이더)·ECS(사격통제)를 갖게 됐다. 현행 교전은 **상위 C2 교전명령
(_doEngage)** 을 반드시 거친다 — As-Is에서 육↔공 음성 협조·승인 홉이 시간을 소진해 `timeout:c2`(구조적)로
누수하는 위협이 많다. 그러나 실제 방공 포대는 **자위권(right of self-defense, JP 3-01)** 에 근거해 상위 명령
없이 자체 레이더로 탐지·자체 요격하는 자율/분권 모드를 갖는다(패트리엇류 auto/자율모드). KJADS 원칙 6-2
(중앙→분권→자율 전환)·6-1(로컬 IDD)의 최소 구현이다. WP2는 이를 `features.selfDefense`(기본 OFF)로 추가한다.

## 선택지

### 1) 모드 적용 — As-Is 전용인가 양 모드 공통인가
- **양 모드 공통(채택)**: 자체교전은 As-Is에도 존재하는 **물리·교리**다(포대 자율모드는 통합 C2와 무관). 따라서
  양 모드에 넣는 것이 정직하다. **이는 As-Is 격추율 하한을 올려 To-Be 개선폭을 줄이는 방향** — 기존 저장소의
  반증 규율("결론에 유리한 가정을 근거 없이 채택하지 않는다")과 부합한다. To-Be 전용으로 넣으면 개선폭을
  인위적으로 부풀리는 편향이 되므로 기각.

### 2) 중복교전 — 정상 파이프라인과 어떻게 분리하나
- **C2 미교전분만 구제(채택)**: 자체교전은 `!_countedEngaged`(C2가 아직 교전 안 함) 또는 `pipelineDead`인 위협만
  대상. 자체교전 시 `_countedEngaged`로 표시해 이후 C2와 이중교전 차단. `everEngaged ≤ spawned` 불변 유지
  (`tests/selfdefense.test.js`). As-Is 팬아웃 중복교전(dup/coord)과는 별개 축(그 메커니즘 미변경).

### 3) 트리거 — 지리 미모델에서 "터미널 근접"을 어떻게 표현하나
- **잔여 체공창 프록시(채택)**: 지리가 축선 추상이라, "잔여 dwell ≤ `selfDefenseWindowSec`"(터미널 근접 프록시)
  AND coverage∋축선 AND canEngage 로 트리거. MFR 자체 스캔(스캔당 raw 1회, 기존 탐지 규율)으로 자체 항적 획득.

### 4) 오격(fratricide) — 모델링하나
- **카운터만(채택)**: 자체교전은 상위 식별(CID) 없이 이뤄져 오격 위험이 있으나, **실제 오격 확률은 근거 부재** →
  판정 없이 위험 카운터(`iffRiskEngagements` = 자체교전 총건수)만 신설. 확률 모델링은 범위 밖.

### 5) 모드 차등(선택 — 시간 남으면)
- **기본 동일값(채택)**: 원칙 6-2는 As-Is 창이 짧고(자율 전환 늦음) To-Be 창이 김(조기 전환)을 시사하나,
  **차등을 두는 순간 To-Be 유리 가정이 추가**된다. 따라서 기본은 양 모드 동일값(window/pkMult)으로 하고,
  차등은 스윕 실험으로만 관찰(scripts/step-fireunit-sweep.mjs). 기본 결론에 미반영.

## 결정
`features.selfDefense` 기본 **OFF**, 양 모드 공통. 흐름: MFR 자체 스캔(`_onSelfDefScan`, 잔여창 ≤ window부터
SCAN_SEC 간격) → 자체 획득 시 ECS 로컬 결심(`selfDefenseDecisionSec`, 상위 C2·협조·승인 우회) → MFR 채널
점유·발사(`_selfEngage`→SHOOTER_ARRIVE selfDef) → BDA(pk × `selfDefensePkMult` 감쇠 — 단일센서·비융합·촉박
기하). 격추는 `killed`에 포함하되 `global.selfDefense={engagements,kills,rescuedFromTimeoutC2,iffRiskEngagements,
meanReactionSec}`로 분리 관측. 반응시간은 `meanDecisionDelaySec` 분모에 넣지 않음(경로 상이). fireUnitLayer OFF +
selfDefense ON이면 집계 shooter에 개념 MFR Pd(0.6) 폴백 부여(플래그 직교성).

## 근거
- **되돌리기**: selfDefense OFF → SDEF_SCAN 미예약 → 추가 RNG 소비 0, `_onEngageEnd(opts=null)` → pk 불변 →
  legacy/WP1 지문 비트 동일(`tests/selfdefense.test.js` 되돌리기 어서션, fireUnitLayer OFF/ON 양쪽).
- **반증 성격(핵심)**: 자체교전을 양 모드 공통으로 넣으면 As-Is 격추율 하한이 오른다 → To-Be 개선폭 축소.
  결론에 불리한 방향을 정직하게 채택.

## 결론 영향(수치) — SC3 x1.5, seed 1~20 평균 (fireUnitLayer ON 기준)
| 구성 | As-Is 격추율 | To-Be 격추율 | As-Is↔To-Be 격차 |
|---|---|---|---|
| selfDefense OFF | 12.6% | 36.4% | **23.8%p** |
| selfDefense ON (w60·pk0.8) | 24.9% | 35.5% | **10.6%p** |
| selfDefense ON (w90·pk0.9) | 28.4% | 37.0% | 8.6%p |

→ **자체교전은 As-Is를 +12.3pp(w60·pk0.8) 끌어올리나 To-Be는 −0.9pp(거의 불변)** — C2가 실패한 위협을
포대가 자율 구제하기 때문. **As-Is↔To-Be 격차가 23.8→10.6%p로 절반 이하로 축소**된다(SC3 asis 자체격추 33건,
`timeout:c2` 구제). 즉 "통합 C2의 가치"를 자체교전이 상당 부분 **대체**한다 — 통합 효익을 정직하게 깎는 결과다.
창(window)이 길수록·pkMult 높을수록 As-Is 구제 효과가 커진다(스윕 표, scripts/step-fireunit-sweep.mjs).

## 되돌리는 법
- 플래그: `features.selfDefense=false`(기본) → SDEF_SCAN 미예약, pk 불변, 지문 비트 동일. `KJ.PRESETS.highFidelity`로 ON.
- 검증: `node tests/selfdefense.test.js` · `node tests/run-all.js`.
- 커밋: (WP2 커밋 해시)

## 잔여 한계
- window/decision/pkMult 전부 등급 C(근거 부재) → 스윕으로만 해석. 오격 확률 미모델(카운터만). 지리 미모델로
  "터미널 근접"은 잔여 체공창 프록시. 모드 차등은 스윕 관찰만(기본 동일값).
