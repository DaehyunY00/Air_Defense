# ADR-110 — 사수 지정 되먹임: 보수적 예측 · 사수 CANTCO 회신 · 즉시 재지정 (`assignmentFeedback`)

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

- 날짜: 2026-10-01
- 상태: 채택 (엔진 기본 OFF · [지휘 흐름] 화면 기본 ON — 사용자 요청 2026-10-01)
- 관련: ADR-109(조기 사수 지정 — 이 ADR은 그 예측·대기 규칙의 보완) · ADR-056(통합 COP 역방향 가시성 — 다른 웹이 계획 소멸을 보는 통로) · ADR-076(기하 창 캐시)
- 플래그: `assignmentFeedback`(earlyShooterAssignment ON에서만 뜻이 있음) · `cantcoGraceSec`(기본 30) · `cantcoCooldownSec`(기본 60) · 화면 `?cf=`(기본 1)

## 맥락 — 예측이 낙관적이고, 빗나가면 15분을 기다렸다

ADR-109의 예측 평가는 `_iadsGeometryWindow`(전체 비행 중 봉투 안 구간 · 탄·채널·레이더 정상 가정)로 요격 창을 잡았다.
실제 발사 평가 `_iadsEvaluate`는 300초 전방 요격점(`findEarliestPip`)과 포대 레이더 사격통제 등급을 요구하므로 두 계산이 다르다.
느리고 낮은 소형 무인기에 대해 천궁-II가 「준비 +1초」로 지정됐지만 15분 내내 요격점·사격통제 등급을 얻지 못했고(seed 29 To-Be:
만료 24건 중 천궁-II 22건 · 사유 요격점 미형성 16 · 사통 미달 15), 그동안 같은 위협에 대한 긴급발사와 다른 웹의 결심(군단 방공 천마 —
통합 COP로 계획을 보고 양보)이 막혔다. As-Is는 군단 방공이 그 계획을 보지 못해 천마가 쏘았고(만료 뒤 격추 31건 중 천마 15건), To-Be는 0건.
그 결과 To-Be 격추가 조기 지정 OFF 217 → ON 209로 줄었다(As-Is 212 → 211).

실제 방공 절차에서 「쏠 수 있다」는 지휘소의 추정이 아니라 **사격 단위가 자기 사격통제 체계로 계산해 보고하는 것**이며, 할당을 받은
사격 단위는 수 초 안에 WILCO/CANTCO로 회신하고 지휘소는 CANTCO에 즉시 재할당한다.

## 결정

`assignmentFeedback`(기본 OFF)를 둔다. ON이면:

1. **예측 일치(보수적 예측)** `_iadsPipIntervals` — 실제 발사 평가와 같은 조건(봉투 안 · 비행시간 ≤ 도달시간 · 300초 전방 · 연료)으로
   「이 시각에 쏘면 요격점이 있다」가 성립하는 발사 시각 구간의 합집합을 계산한다(점 p가 봉투 안이고 비행시간 f면 τ ∈ [p−f−3, p−f] — 실제 평가의 launchWait ≤ 0과 같은 조건).
   `_iadsPredictFcReadyAt` — 포대 레이더 사격통제 거리 진입 + 전이 시간으로 사격통제 획득 예상 시각을 잡는다. 예측 readyAt = 두 조건을
   모두 만족하는 첫 시각, windowEnd = 구간 끝. 어느 쪽도 성립하지 않으면 후보에서 제외(종전에는 후보였음). 계획 `validUntil` = windowEnd + 3.
2. **사수 CANTCO 회신** — 지정 사수가 예측 준비 시각 + `cantcoGraceSec`(30초)까지 못 쏘면 「수행 불가」 회신(마크 `사수불가회신:사수(사유)`),
   계획 해제(`expiryByReason.cantco`), 교전 현황 released 송신. `global.earlyAssignment.cantco` 계상.
3. **즉시 재지정** — 결심 지휘소는 회신 1초 뒤 재결심한다. 같은 사수는 `cantcoCooldownSec`(60초) 동안 예측 재지정에서 제외
   (`reason: cantco_cooldown`; 지금 실제로 쏠 수 있으면 제외하지 않음). 다른 웹(군단 방공)은 통합 COP(ADR-056 역방향)로 계획 소멸을 보고
   자기 결심을 진행한다 — 별도 통지 없이 기존 2.5초 재시도로 이어진다.
4. **불변** — OFF는 bit-exact(모든 분기가 플래그 뒤). ON 신고: `features.assignmentFeedback/cantcoGraceSec/cantcoCooldownSec`.

## 수치 영향

ADR-110 채택 시점의 실측은 `docs/analysis/2026-09-29-moe-analysis/README.md`(개정 3판 보완)에 적는다. 요지: 지정 만료 대기가
15분 → 유예 30초로 줄고, 다른 웹의 양보가 풀려 To-Be의 소형 무인기·방사포 격추가 회복된다.

## 검증

`tests/assignment-feedback.test.mjs` — ① OFF bit-exact(ADR-109 ON과 동일) ② ON: CANTCO 마크 = 계정 · CANTCO까지 대기 ≤ 유예 + 재점검 간격 ·
예측 readyAt에서 요격점 구간이 성립 · 냉각 중 같은 사수 예측 재지정 0 ③ 만료 대기(expiredWaiting)가 ADR-109만 켠 경우보다 줄어듦 ④ flowTrace ON/OFF 지문 동일.

## 남은 것

- 유예 30초·냉각 60초는 개념값. 사격 단위의 CANTCO 응답 시간(수 초)과 지휘소 재할당 시간은 체계별 실측이 필요하다.
- 레이더 사격통제 획득 예상은 거리 기준 근사다(지형 차폐·저고도 탐지 한계 미반영).
