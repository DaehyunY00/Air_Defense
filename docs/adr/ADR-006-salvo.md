# ADR-006 — 연발(salvo) 교전 doctrine (Phase 6, ⑨)

## 맥락
종전 교전은 **1발 발사 → BDA → 실패 시 재교전**(shoot-look-shoot)이다. 체공창(dwell)이 짧으면 재교전 시간이 없어 첫 발이 빗나가면 그대로 누수한다(사유 `missed`). 연발(salvo)은 한 교전에서 **k발 동시 발사**해 단일 패스 누적 격추확률을 `1−(1−pk)^k`로 올린다 — 대신 요격탄 k발 소모(비용교환비↓). "연발이 필요한가"를 편향 원장의 누수 사유로 판정한다.

## 편향 원장 판정(필요성)
To-Be 누수 사유(seed1~20 × 9셀): `timeout` 4493(대부분 구조적 timeout:c2) · **`missed` 3352** · `no_engage_window` 3275 · overflow 674.
- `missed`(터미널 교전 실패, 기회 소진)는 **비구조**이고 salvo가 정확히 겨냥하는 모드다.
- `no_engage_window`는 교전 개시 전 체공창 부족(⑧) → salvo로 **안 줄어든다**(측정 확인).

→ salvo는 실재하는 비구조 누수(`missed`)를 겨냥하나, **결함 교정이 아니라 교리 트레이드오프**(요격탄을 더 써 격추율을 산다)다. 따라서 **구현하되 기본 OFF**(범위 확대 옵션).

## 선택지
- **A. 누적 pk 상향(1 draw)**: k발을 한 pk 추출로 `1−(1−pk)^k` 계산, 비용 k배. 그리기 수 불변(pk 값만 상향).
- **B. k발 개별 추출**: 발마다 pk·raw 독립 추출 — 그리기 수 k배로 스냅샷·스트림 대폭 교란(ON일 때도 불필요한 복잡도).
- **C. 발사대별 salvo 정책 데이터화**: 무기별 연발 교리를 nodes.js에 — 데이터 근거 부재.

## 결정
**A**(`features.salvo`, **기본 OFF**). `SALVO_SIZE=2`(기본), `features.salvoSize`로 재정의. `_onEngageEnd`: OFF면 k=1(legacy), ON이면 비용 `costPerShot×k`·`pk←1−(1−pk)^k`. Phase 5(상관)와 조합 시 상향된 pk에 동일 `u<pk` 판정 — 자연 합성.

**되돌리기/그리기 수:** OFF → k=1, 비용·pk·그리기 수 legacy와 완전 동일(검증 불일치 0). ON도 그리기 수 불변(pk 값만 상향) → 스냅샷 교란 최소.

## 근거
- **기본 OFF인 이유(조건 2)**: doctrine 변경이라 결론을 크게 움직인다(k=2에서 격추율 +11.2p ≈ **상대 +22%** → 20% 초과). 결함 교정이 아니므로 기본 결론에 넣지 않는다. 켜면 명시적 교리 선택.
- **A를 택한 이유**: B는 ON일 때 그리기 수를 k배로 늘려 스트림을 흔들고 Phase 5와의 합성도 지저분해진다. A는 pk만 상향해 회귀 안전·합성 자연.
- **한계(정직)**: 누적 pk 공식은 k발이 **독립**이라 가정한다. Phase 5(pkCorrelated) ON과 조합하면 실제로는 동시 발사도 상관될 수 있으나, 본 모형은 salvo 내부 상관은 다루지 않는다(발사 간 상관만) — vv-report 한계에 명시.

## 결론 영향(`scripts/phase6-salvo.mjs`, To-Be seed1~20 × 9셀)
| 설정 | 격추율 | 비용교환비 | missed | no_engage_window |
|---|---|---|---|---|
| **OFF(k=1)** | 50.01% | 0.94 | 3352 | 3275 |
| salvo k=2 | 61.18% | 1.54 | 1121 | 3260 |
| salvo k=3 | 65.06% | 2.21 | 445 | 3267 |

- salvo는 `missed`를 급감(3352→1121→445)시키나 `no_engage_window`는 **불변**(3275≈3260) — 교전창 부족은 doctrine이 아니라 체공창 문제임을 재확인(⑧과 직교).
- **비용교환비 악화**(0.94→1.54→2.21): 격추율은 사되 요격탄 소모가 급증. defenseEfficiency(Phase 2)로 보면 누수 감소분과 저울질해야 하는 순수 doctrine 선택.
- **기본 OFF → 기본 결론(To-Be 개선폭) 불변 → Phase 6 기본 에스컬레이션 0%.** 켜면 격추율 +22% 상대(임계 초과)라 반드시 명시적 옵션으로만.

## 되돌리는 법
- 플래그: `features.salvo=false`(기본) → k=1, 비용·pk·그리기 수 legacy 동일.
- k 조정: `features.salvoSize`. 원복하려면 `_onEngageEnd`의 shots 분기·`SALVO_SIZE`·`salvoSize` 제거.
- 커밋: (Phase 6 커밋 해시)
