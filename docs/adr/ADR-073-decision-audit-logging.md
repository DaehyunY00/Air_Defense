# ADR-073 — 결심 감사 로깅 (decision_audit)

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

## 맥락

"To-Be가 왜 더 나은가"를 다수 지표가 아니라 **인과 사슬 한 줄**로 보이려면 두 기준값이
필요하다: 시간 지표(교전창 여유)와 점수 지표(선택 손실 = 전역최적 점수 − 실제선택 점수).

두 번째 지표의 분모·분자를 재려면 "결심 순간에 무엇을 후보로 봤고 각 후보의 점수가
얼마였는가"가 있어야 한다. `_iadsDecide`는 후보(`ev`)마다 `ev.score`를 **이미 계산해서**
최고점을 실제 선택으로 뽑고 있다. 그런데 이 후보 배열과 점수는 결심이 끝나는 순간
**어디에도 저장되지 않고 버려진다.** 재계산하면 물리·RNG를 건드릴 위험이 생기므로,
이미 계산된 값을 그 자리에서 옮겨 적기만 하는 계측 계층이 필요하다.

## 선택지

1. **결심 시점 인라인 로깅 (채택)** — `_iadsDecide` 안, 결심이 확정된 지점에서 이미 손에
   든 `candidates`·`chosen`을 이벤트로 남긴다. 새 계산 0, 새 난수 0.
2. **사후 재계산** — 런 종료 후 c2Events의 COMMAND_DECIDED를 보고 후보를 다시 평가한다.
   → 기각. `_iadsEvaluate`는 그 시점의 탄약·부하·FC 상태에 의존하므로 사후 재현이 불가능하고,
   재현하려면 상태 스냅샷을 떠야 해서 오히려 침습적이다.
3. **결심 함수 리팩터링(후보 산출 분리)** — 순수 함수로 뽑아 양쪽에서 호출.
   → 기각. 물리·결심 경로를 건드린다(§0 불변규칙 3). 계측 목적으로 감당할 위험이 아니다.

## 결정

기능 플래그 **`decisionAudit`(기본 OFF)** 뒤에서, `_iadsDecide`가 `COMMAND_DECIDED`를
낸 **직후 동일 시각 `t`**에 `decision_audit` 이벤트 하나를 `c2Events`에 push한다.

```
{ type: 'decision_audit', t, threatId, mode,
  commanderId, commanderAxis, commanderScope, threatCategory,
  visibleUnitCount,      // 이 결심자가 볼 수 있었던 발사대 수 (commander.batteryIds.length)
  candidateCount,        // 그중 그 순간 물리적으로 실현가능했던 후보 수
  candidatesTruncated,   // 후보 상한이 걸렸는가
  infeasibleReasons,     // 시야엔 있었으나 탈락한 사유별 건수(_iadsDecide의 reasons 그대로)
  candidates: [ { unitId, unitType, score, pk, rangeKm, ammoRatio, load, pipTime, missileType } ],
  chosenUnitId }
```

**기록 지점을 `COMMAND_DECIDED` 직후로 잡은 이유**: 그래야 감사가 실제 결심과 1:1이 되고,
이벤트의 `t`가 곧 "결심완료시각"이 되어 Phase B의 교전창 여유 계산에 그대로 쓰인다.
후보 선정만 끝나고 명령경로가 없어 무산된 경우(`responsibility_gap`)는 결심이 성립하지
않았으므로 기록하지 않는다.

### 구성 (파라미터는 `docs/params.md` C2-AUDIT-* 참조)

| 키 | 기본 | 뜻 |
|---|---|---|
| `decisionAudit` | `false` | 계측 전체 스위치 |
| `decisionAuditMaxCandidates` | 30 | 위협당 후보 배열 상한(점수 내림차순 상위 N) |
| `decisionAuditMaxEvents` | 5000 | 런당 이벤트 상한(메모리 백스톱) |
| `decisionAuditSampleRate` | 1 | threatId FNV-1a 해시 기반 결정론 표본추출률 |

**두 상한의 성격이 다르다는 점을 명시한다.**
- 후보 상한은 **무편향**이다. 배열은 이미 점수 내림차순이라 상위 N은 결정론이고, 실제 선택은
  언제나 rank 0이므로 절대 잘리지 않는다. 잘린 결심은 `candidatesTruncated=true`로 공시하고
  `candidateCount`는 상한과 무관한 실제 후보 수를 그대로 보존한다.
- 이벤트 상한은 **후반부 시간 편향이 있다**(초과 시점 이후 결심을 버린다). 그래서 이것은
  메모리 백스톱일 뿐이며, 편향 없이 로그를 줄이려면 `decisionAuditSampleRate`를 쓴다.
  표본은 위협 단위 해시 채택이라 시각·결과와 무관하고, 같은 seed의 As-Is/To-Be가 CRN으로
  같은 위협집합을 마주하므로 **두 모드가 같은 표본을 본다**(짝지은 비교 보존).
  상한이 걸리면 `global.decisionAudit.{dropped, truncated}`로 드러낸다 — 0으로 위장하지 않는다.

### 커버리지 원장

ON일 때만 `global.decisionAudit = { logged, dropped, sampledOut, truncated, sampleRate,
maxCandidates, maxEvents, recorded }`를 노출한다. `recorded`는 `c2Analysis` 여부다 —
이벤트는 분석 채널로만 나가므로 일반 DES/MC에서는 플래그가 켜져 있어도 로그가 없다.
후처리·UI는 이 원장으로 **"미측정"과 "0"을 구분**한다.

## 검증

`tests/decision-audit.test.mjs` (run-all 등록). 주 분석 배치 `HANBANDO_LEGACY_NORMAL` ×
`iads-c2` × SC1/SC3 × asis/tobe × seed 12345 × 900초, `c2Analysis:true`.

1. **OFF bit-exact** — 계측 도입 직전(v4 tip `2a91eeb`, 기본값 ADR-065~072 반영) SHA-256 4/4 일치.
   OFF에서 `global.decisionAudit`·`features.decisionAudit` 미노출(wire shape 불변).
   ⚠️ 잠근 해시는 **v4 기본값에 묶여 있다** — 기본값이 또 바뀌면 함께 재측정해야 한다.
2. **RNG 불변(핵심)** — `KJ.makeRng`(처리·도착)와 `KJ.IADS.deriveStream`(센서 도메인
   서브스트림)을 모두 감싸 **소비 횟수**를 센다. ON/OFF 4/4 동일:
   303,385 / 255,181 / 946,207 / 792,700. 격추·누수도 불변.
3. **완결성** — `decision_audit` 수 = **WTA 결심** 수, 시각·위협·사수까지 동일 순서로 짝.
   자위권 발사(ADR-071)는 분모에서 빠지며 그 건수가 원장에 그대로 드러난다(§한계 참조).
4. **정합성** — `chosenUnitId`는 항상 점수 1위, 배열은 내림차순, 전 필드 유한,
   `pipTime ≥ t`, `candidateCount ≤ visibleUnitCount`.
5. **상한·표본 결정론** — 후보 상한 1에서도 선택 후보 보존·`candidateCount` 불왜곡,
   이벤트 상한 5에서 `logged=5 / dropped=149 / truncated=true`,
   표본률 0.5에서 재실행 동일·전수의 진부분집합(92/154). 세 경우 모두 RNG 불변.

## 결론 영향 — ⚠️ 발견: 후보 명단 폭 가설은 성립하지 않는다

작업 전제는 "As-Is는 후보 명단이 작아 차선을 고를 수 있어 선택 손실이 커진다"였다.
**이 엔진에서는 성립하지 않는다.** 실측(seed 12345 × 900초):

| 케이스 | 결심 수 | `visibleUnitCount` 중앙 | `candidateCount` 중앙 |
|---|---|---|---|
| SC1 As-Is | 31 | 8 | 1 |
| SC1 To-Be | 26 | 9 | 1 |
| SC3 As-Is | 84 | 6 | 1 |
| SC3 To-Be | 147 | 6 | 1 |

원인은 `_resolveIadsCommanders`의 구조다. As-Is는 위협 범주에 따라 지휘 노드가
`KAMD_OPS`(탄도) / `MCRC`(항공)로 **갈릴 뿐**, 그 노드에 넘겨주는 사수 집합은 To-Be의
`IAOC`와 **동일한 `korean` 전체 집합**이다. 즉 As-Is에서 좁아지는 것은 *지휘권의 분절*이지
*사수 명단*이 아니다. 테스트 §6이 이 구조를 어서션으로 못박아 두었으므로, 장차 As-Is의
사수 가시성을 실제로 좁히는 변경이 들어오면 그 테스트가 깨져 재검토를 강제한다.

또 하나: `candidateCount` 중앙값이 전 케이스 1이다. 시야에 8기가 있어도 그 순간 봉투·PIP·
사격통제·탄약·채널을 모두 통과하는 발사대는 대개 1기다(`infeasibleReasons`가 대부분
`no_fire_control`·`no_feasible_pip`). **후보 명단 폭은 C2 구조가 아니라 물리가 결정한다.**

따라서 "선택 손실(regret)"이 유의미하게 나올 여지는 이 시점에서 이미 좁다. 그렇다고
지표를 버리지 않는다 — Phase B의 그림자 평가가 **전 자산 기준 최적**과 비교해 regret이
실제로 0에 붙는지를 검정하고, 0이라면 그것이 곧 *"To-Be 이점은 사수 선택 품질이 아니라
시간에서 온다"*는 원인 귀속 결과가 된다. 실패가 아니라 발견으로 보고한다.

**단일 런 인과 주장은 하지 않는다.** 위 표는 seed 1개의 관측이며, 주장은 Phase C의
분포·게이지로만 한다.

## 되돌리는 법

`features.decisionAudit`를 지우거나 `false`로 두면 끝이다(기본값). 코드까지 되돌리려면
`_emitDecisionAudit`·`_decisionAuditSampled` 두 메서드, `_iadsDecide`의 호출 1줄과
`ev.auditAmmoRatio/auditLoad` 보관 1줄, 자위권 경로의 카운터 1줄, 생성자의 플래그 블록,
결과의 `global.decisionAudit` 블록, 상수 `DECISION_AUDIT_*` 2개를 제거한다.
다른 코드가 이 값들을 읽지 않는다.

## 한계

- 이벤트는 `c2Analysis` 채널로만 나간다. 일반 DES/MC 실행에서는 플래그가 켜져 있어도
  기록이 없다(`global.decisionAudit.recorded=false`). 의도된 설계다 — 기본 wire shape 보존.
- `ammoRatio`·`load`는 점수식이 쓴 그 값이지 발사 시점의 값이 아니다. 결심과 발사 사이에
  탄약·채널이 변할 수 있다.
- `pipTime`은 결심 시점 후보 평가의 PIP이며, 실제 발사 시각의 재평가 결과와 다를 수 있다
  (`_iadsFire`가 `_iadsEvaluate`를 다시 부른다).
- `responsibility_gap`으로 무산된 결심 시도는 기록되지 않는다. "결심했으나 명령이 못 나간"
  경우의 후보 명단이 필요해지면 별도 이벤트가 필요하다(미구현 — 지금은 미측정).
- **자위권 발사(ADR-071)는 감사 대상이 아니다.** 포대가 자기 항적으로 스스로 쏘는 경로라
  WTA 사수 선정 자체가 없고, 따라서 후보 명단도 점수도 존재하지 않는다 — 지어내지 않는다.
  대신 그 건수를 `global.decisionAudit.selfDefenseUnaudited`로 드러내 커버리지 구멍을
  침묵시키지 않는다(SC3 As-Is seed 12345에서 17건). `COMMAND_DECIDED` 총수와 감사 수의
  차이가 정확히 이 값임을 테스트가 고정한다. 자위권 발사가 많은 조건에서는 감사가 전체
  발사 결정의 일부만 덮는다는 뜻이므로, 감사 기반 비율을 인용할 때 이 값을 함께 봐야 한다.
