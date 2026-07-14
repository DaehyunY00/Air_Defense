# ADR-002 — 비용교환비의 누수 피해 계상 (Phase 2, ⑨)

## 맥락
`exchange = 소모 요격탄 비용 ÷ 격추한 위협가치`. 분모에 **격추분만** 들어가고 누수는 어디에도 없다(사실 c). 결과: **아무것도 안 쏘면 `exchange=0`으로 "최적"** — 패배가 경제성으로 계상된다. As-Is가 C2에서 항적을 잃어 못 쏜 것이 "비용 우수"로 표시되는 역설.

## 선택지
- **A. 누수 위협을 분모에 가산** (`interceptM/(killedM + leakedM×λ)`): 단순하나 λ(피해계수) 근거 없음.
- **B. 별도 지표 신설**(`defenseEfficiency`): 기존 exchange 불변(회귀 안전), 지표 1개 증가.
- **C. 피해비용 명시 모델**(`damageCostM` 위협별 신설): 가장 정확하나 **파라미터 7개 추가·전부 등급 C** → 그 값이 결론을 결정.
- **D. 지표 유지 + tip 경고만**: 편향 위험 0이나 문제 미해결.

## 결정
**B** — `defenseEfficiency = killedThreatM / (killedThreatM + leakedThreatM)` 신설. 위협 가치(unitCostM, 기존 파라미터)로 가중한 "방어한 가치 비율". exchange/exchangeSat는 **그대로 유지**(삭제 금지·회귀 안전). `features.leakCost`(기본 ON, 순수 관측). exchange의 tip에 "안 쏘면 최적" 함정 경고 병기.

## 근거
- **C안은 위험하다**: `damageCostM`을 크게 잡을수록 To-Be가 좋아진다 — 등급 C 파라미터 7개로 결론을 만드는 것. 이 변경은 이미 To-Be 유리 방향이라 근거 없는 값으로 증폭하면 안 된다(금지 사항).
- **B안은 새 파라미터 0개**: 기존 unitCostM만 재사용. "안 쏘면 격추가치 0 → defenseEfficiency 0=최악"으로 함정을 정확히 반전.
- exchange를 직접 수정(A안)하면 `refine.test.js`가 의존하는 지표가 흔들리고 회귀가 깨진다.
- `exchangeSat`의 SC2 신호(무인기 비용 비대칭 미해소)는 exchangeSat를 건드리지 않으므로 그대로 보존.

## 결론 영향
- **exchange/exchangeSat 불변 → 편향 원장 기존 6개 지표 이동 0%** (에스컬레이션 임계 20% 안전 미달). Phase 2는 **순수 지표 추가**다.
- defenseEfficiency 신규(SC3 x2.5 seed1~10): As-Is 16.1% · To-Be 65.6% — To-Be의 실제 방어 우수를 처음으로 보상(exchange가 못 하던 것). 방향은 To-Be 유리하나 **기존 결론 지표를 움직이지 않으므로 편향 없음**.

## 되돌리는 법
- 플래그: `features.leakCost=false` → leakedThreatM 미집계·defenseEfficiency=null. 되돌리기 어서션 0/36 유지(fingerprint 미포함 지표).
- 커밋: (Phase 2 커밋 해시)
