# ADR-004 — timeout 분해 + overflow:shooter 재분류 (Phase 4, ⑨)

## 맥락
누수 사유 `timeout`(처리지연 초과·공역이탈)이 **두 가지 물리적으로 다른 현상**을 한 코드로 뭉뚱그린다(사실 e).
- **교전을 한 번도 못 함**(`tries===0`): 앞단 ②~⑦ C2·협조·승인이 시간을 소진 → **구조적**(파이프라인 결함).
- **교전했으나 명중/체공창 소진**(`tries>0`): ⑧⑨ 교전·BDA 단계의 물리 한계 → **비구조**(무기 성능·체공 시간 문제, C2 무관).

또한 `overflow:<노드>`(대기실·교전채널 초과)는 단일 실행에서 구조/비구조로 즉시 단정할 수 없다. C2와 shooter 모두 용량 계열 `conditional`로 분류하고 반복 지속성으로 승격 여부를 판단한다.

## 선택지
- **A. tries 기준 분해**: `timeout:c2`(tries===0, 조건부·세부원인 필요) / `timeout:engage`(tries>0, 비구조). overflow는 용량 계열 조건부로 분류.
- **B. 분해하지 않음**: 단일 timeout 유지 — 구조/비구조 혼재를 감수(정보 손실).
- **C. 시간·단계 계측 기반 분해**: 각 위협이 어느 단계에서 시간을 얼마나 썼는지 적분 → 지배 단계로 귀속. 구현 복잡, 이벤트 계측 추가(동역학 무관하나 상태 증가).

## 결정
**A** — `_onExit`에서 `timeoutSplit`(기본 ON) 플래그로 timeout을 `tries` 기준 분해. 재설정된 taxonomy에서 `timeout:c2`는 단일 실행으로 구조로 단정하지 않는 `conditional`, `timeout:engage`는 `nonstructural`이다. `overflow:*`도 paired-seed 지속성 증거 후에만 구조로 승격하는 용량 계열 `conditional`이다.

**되돌리기 경계(중요):**
- **동역학 지문(sp/k/l/iM/ex) — 완전 불변, 0/36.** 두 변경 모두 순수 보고/분류 변경이다.
- **timeout 코드 방출** — `timeoutSplit=OFF` → 단일 `timeout`(구조) 방출 = legacy. 완전 되돌림.
- **overflow:shooter 재분류** — `leakTaxonomy`는 UI·테스트·원장이 공유하는 **단일 분류원**이라 플래그로 게이트하지 않고 **무조건 교정** 적용. 근거는 아래 “근거”의 마지막 항.

## 근거
- **분해 기준은 ⑧ `no_engage_window`와 정확히 동일**(`threat.tries > 0` → 비구조). `tries===0`은 자동으로 구조가 아니며, 책임·경로·용량·화력통제·PIP 증거를 추가 분해한다. paired-seed 지속성 또는 구조 개입 반사실이 확인될 때만 구조로 승격한다.
- overflow 코드는 그대로 보존하되 `family=capacity`, `structurality=conditional`로 해석한다. `classifyFailure(code,evidence)`는 paired-seed 지속성 또는 구조 개입 반사실 증거가 주어진 경우에만 구조로 승격한다. 방출 코드·동역학·legacy 지문은 변하지 않는다.

## 결론 영향 — ⚠️ 과제 예측과 불일치(정직 보고)
과제는 Phase 4가 “🔴 에스컬레이션 임계를 확실히 넘는다”(To-Be 구조적 565→9, ~97% 급감)고 예측했다. **실측은 그렇지 않다.**

편향 원장(seed1~20 × SC1/2/3 × x1.0/1.5/2.5 풀링, `scripts/phase4-measure.mjs`):

| 규칙 | As-Is 구조적실패율 | To-Be 구조적실패율 | To-Be 개선폭(As-Is−To-Be) |
|---|---|---|---|
| legacy(Phase 3) | 44.25% | 19.16% | 25.09p |
| +timeout 분해 | 42.47% | 17.24% | 25.22p |
| **+overflow 재분류(Phase 4)** | **41.59%** | **14.74%** | **26.85p** |

- **To-Be 개선폭 이동: 25.09p → 26.85p = 상대 +7.0% → 20% 미만, 🔴 아님.**
- **왜 예측(−97%)이 빗나갔나:** 과제의 사실 (e)(“To-Be timeout의 98%가 `tries>0`”)는 **⑧ 병합 이전** 측정값이다. ⑧ 교전창 필터가 체공창 내 교전 불가 위협을 교전 개시 전 `no_engage_window`로 분리하면, 남은 `timeout:c2`는 책임·경로·대기·화력통제·PIP가 혼합된다. 재설정 후에는 이를 구조로 고정하지 않고 세부 증거로 주원인을 다시 판정한다.
- 구 표본(SC3 x1.5, seed1~5)의 timeout 분해 합 보존값은 유효하지만, c2 311건을 전부 구조로 계산한 해석은 폐기한다.

**결론: Phase 4는 에스컬레이션 임계를 넘지 않는다(+7.0%). 과제의 🔴 예측은 ⑧ 병합으로 무효화됐다.** 이는 “판단은 위임하되 추적 가능성은 위임하지 않는다” 원칙에 따라, 예측을 강행하지 않고 실측대로 보고한 결과다.

## 되돌리는 법
- 플래그: `features.timeoutSplit=false` → 단일 `timeout`(구조) 방출 = legacy 코드 분포. 동역학 지문 0/36 유지.
- overflow:shooter 재분류는 무조건 적용(단일 분류원)이나 방출 코드·동역학·지문 불변 → 회귀 안전. 원복하려면 `leakTaxonomy`의 `isShooter` 분기를 제거(1줄).
- 커밋: (Phase 4 커밋 해시)
