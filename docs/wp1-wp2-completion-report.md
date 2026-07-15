# WP1(요격체계 세분화) · WP2(자체교전) 완료 보고

> 작업지시서 §5-6 필수 산출: (a) ON/OFF 짝비교 leak taxonomy 변화표, (b) 자체교전이 As-Is/To-Be 격차를
> 몇 %p 줄였는지, (c) 근거 C로 선언한 파라미터 전체 목록과 스윕 민감도 순위. 전 수치는 공개자료 기반
> 정책연구용 개념값이며 실제 작전자료 아님. 재현: `node scripts/step-fireunit-sweep.mjs`.

## (a) ON/OFF 짝비교 leak taxonomy 변화 (SC3 x1.5, seed 1~20 합)

### WP1 fireUnitLayer OFF↔ON (To-Be)
| 누수 사유 | OFF | ON | 이동 |
|---|---|---|---|
| `timeout:c2`(구조, C2 지연) | 1174 | 644 | **−530 (C2 병목 완화)** |
| `no_ammo`(TEL 재고 소진) | 0 | 457 | **+457 (화력단위 재고 병목 출현)** |
| `no_engage_window`(교전창) | 867 | 2082 | +1215 (ICC→ECS→MFR 체인 지연) |
| `overflow:MDU-L`(집계) → `overflow:*-BTY-*`(포대) | 52 | 4 | 채널 포화가 포대 단위로 이동 |
| `missed`(⑨ BDA) | 712 | 579 | −133 (종말 성능, 큰 변화 없음) |

→ **병목이 C2(`timeout:c2`)에서 화력단위(`no_ammo`·`no_engage_window`·포대 `overflow`)로 이동.** 세분화가
드러낸 핵심 결과다(§3-4 fire-unit 핵심 질문 답).

### WP2 selfDefense OFF↔ON (As-Is, fireUnitLayer ON)
| 지표 | OFF | ON | 이동 |
|---|---|---|---|
| `timeout:c2` | 88 | 76 | **−12 (자율 교전이 구조적 실패 구제)** |
| 격추율 | 12.6% | 24.9% | **+12.3pp (As-Is 하한 상승)** |
| 자체격추(rescuedFromTimeoutC2) | — | 33 | C2 실패 위협 자율 구제 |

## (b) 자체교전의 As-Is↔To-Be 격차 축소 (SC3 x1.5, seed 1~20 평균)
| 구성 | As-Is | To-Be | 격차 |
|---|---|---|---|
| selfDefense OFF | 12.6% | 36.4% | **23.8%p** |
| selfDefense ON (w60·pk0.8) | 24.9% | 35.5% | **10.6%p** |
| selfDefense ON (w90·pk0.9) | 28.4% | 37.0% | 8.6%p |

→ **자체교전은 As-Is↔To-Be 격차를 23.8%p → 10.6%p로 약 13.2%p(절반 이하) 축소**한다(w60·pk0.8 기준).
양 모드 공통 물리·교리를 정직하게 넣은 결과 — "통합 C2 효익"을 자율 교전이 상당 부분 대체함을 드러낸다(ADR-011,
결론에 불리한 방향을 근거 없이 배제하지 않음).

## (c) 근거 C 파라미터 전체 목록 + 스윕 민감도 순위

신규 도입 파라미터는 **전부 등급 C(공개 정수 부재)** — laydown-sources.md GAP 기록대로 스윕으로만 해석한다.

| ID | 파라미터 | 등급 | 스윕 범위 | 민감도(결과 영향) | 순위 |
|---|---|---|---|---|---|
| C2-SELFDEF-01 | selfDefenseWindowSec | C | {30,60,90} | **높음** — SC3 As-Is 격추율 22.0→28.4%(창 30→90), 격차를 크게 움직임 | **1** |
| WPN-MFR-CH-01 | MFR 동시교전 채널 | C | {2,3,4,6} | 중 — SC3 To-Be 33.6→36.4%(ch2→6). 포화서 병목, 한계효용 감소 | 2 |
| C2-SELFDEF-01 | selfDefensePkMult | C | {0.7,0.8,0.9} | 중 — SC3 As-Is 자체격추 24→42건(창90). 격추율 ±2pp | 3 |
| C2-ICC-SVC-01 | ICC 사격지휘 처리시간 | C | (탄도창 90s 대비) | 중 — 탄도 요격 실현성(no_engage_window)에 민감. 준자동 값 채택 | 4 |
| C2-ECS-SVC-01 | ECS 콘솔 처리시간 | C | (스윕 대상) | 낮음 — MFR 채널이 실질 제약이라 통상 비병목 | 5 |
| SEN-MFR-PD-01 | MFR 자체 탐지확률 | C | (SEN-*-PD 규율) | 중 — 자체교전 획득률 좌우(WP2 트리거) | 6 |
| WPN-TEL-01 | 재장전 시간(reloadSec) | C | (스윕 대상) | 낮음 — 30분 관측창서 재장전 소수(고강도만) | 7 |
| WPN-BTY-LAYDOWN-01 | 포대 수·배치 | C | (향후 스윕) | 구조적 — 무공백 최소 배치 고정, 커버리지 어서션으로 검증 | — |
| C2-SELFDEF-01 | selfDefenseDecisionSec | C | (고정 5s) | 낮음 — 로컬 결심 짧음 | — |

**총평**: 결론을 가장 크게 움직이는 C-파라미터는 **selfDefenseWindowSec**(As-Is 하한 상승폭 좌우)와
**MFR 채널 수**(포화 격추율). 두 항목은 스윕 표로 범위 전체를 노출했고, 어느 값에서도 정성적 결론
(병목이 C2→화력단위 이동, 자체교전이 격차 축소)은 유지된다. ICC/ECS 처리시간은 탄도 요격 실현성에
국소 민감하나 준자동 값 채택으로 완화(스윕으로 확인).

## 되돌리기·완료 기준 체크
- 두 플래그 OFF → legacy-snapshot 비트 동일(전 36 config, `tests/fireunit.test.js`·`selfdefense.test.js`).
- 제약 상속(인스턴스 단위 신궁·천마 탄도탄 불가)·THAAD 부재·커버리지 무공백·보존 항등식·결정론 — 전 어서션 통과.
- `node tests/run-all.js` 전체 통과(신규 fireunit 24 + selfdefense 28 어서션, constraints 확장, params 감사 게이트).
- 단일본 재생성 무결(`node scripts/build-single.mjs`). ADR-010·011·params.md·vv-report §3.5–3.6·README 갱신.

## 남은 항목(정직 기록)
- **지도 UI**: `KJ.mapView.renderFireUnits(mode)` 최소 오버레이(포대 마커+커버리지 원+티어 색)를 추가했으나,
  **화면 토글로 표출하려면 fireUnitLayer용 UI 컨트롤이 필요**하다. 작업지시서가 "기존 딥링크·탭 구조를
  건드리지 않는다"고 명시해, 렌더 capability만 노출하고 토글 배선은 유보했다(UX 결정 필요).
