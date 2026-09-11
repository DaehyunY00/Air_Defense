# ADR-099 — C2 결심 시간 동일화(`c2DecisionTimeParity`): To-Be 결심 노드의 사람 판단 시간을 As-Is와 같게

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

## 맥락

To-Be 결심 노드 IAOC의 처리시간은 체계 [1,2]초 + 운용자 0.5/1/1.5초(숙련도별)였다. As-Is 결심 노드
KAMD_OPS·MCRC는 체계 [5,10]초 + 운용자 15/30/50초다. 결심 한 건당 15배 차이이고, 세션 실측으로
이 값 차이가 To-Be 우위의 절반 이상을 만든다(ADR-058 §이득의 출처 · 운용자 시간 동일화 시 개선폭
+7.75 → +3.50). C2 분석결과 보고서의 대표 항적 카드에서 "같은 KAMDOC이 As-Is 12.6초, To-Be
0.9초"로 읽히는 문제로 드러났다(실제로는 To-Be의 결심 노드가 IAOC이고 KAMDOC은 병렬 도메인 처리).

사용자 판단(2026-09-11): "구조가 변하는 것이지 각 C2가 처리하는 시간 자체는 동일하게 흘러가야
한다. codex와 동일하게 가는 것이 맞다."

codex `c2-timing-policy.js`는 킬웹을 IAOC = `automated`(사람 0, 체계 중간값만) + EOC = `decision`
(사람 판단 15/30/50초 — As-Is KAMD_OPS·MCRC와 **같은 표**)로 둔다. 즉 자동화되는 것은 융합·중계이고,
쏘겠다는 결심은 여전히 사람이 같은 시간을 쓴다.

## 결정

플래그 `c2DecisionTimeParity`(기본 OFF). ON이면 카탈로그(deployment-adapter)에서 tier가
`killweb_central`인 C2(IAOC)의 **운용자 성분**을 `KAMD_OPS.processing.operator[운용 수준]`으로
바꾼다. 체계 성분 [1,2]초와 동시 처리 석수 20은 그대로 둔다(자동화·통합센터 규모는 별개 가정 —
후속 반사실 대상). 운용 수준 키(high/mid/low)는 양쪽에 같은 키를 쓴다.

- 엔진은 wire shape 신고만 한다(`global.features.c2DecisionTimeParity`, ON일 때만 키 존재).
- 카탈로그 캐시 키에 `|decpar`를 더해 OFF 카탈로그는 종전과 같은 객체다.
- 지휘 흐름 화면은 **기본 ON**(pipe·icc·lx·aim과 같은 예외), 켜진 동안 칩 「결심 시간 동일화 ON」.
  끄면(`?par=0`) 종전 IAOC 1초로 돌아가 「값의 몫」을 반사실로 잰다.
- 엔진·본 앱 기본은 OFF(불변 규칙 1 — 골든 지문 불변). 기본 ON 전환은 재기준선과 함께 별도 판단.

## 영향(예상)

- To-Be의 ② C2 처리 구간이 As-Is와 같은 자릿수가 된다. To-Be 우위 중 남는 것은 구조 효과 —
  ICC 중계 홉 제거, 센서 직결·IFCN 1초, KAMDOC·MCRC의 병렬 참여, COP 중복 해소, 교전 협조 관문 소멸.
- As-Is 결과는 bit-exact 불변(IAOC는 As-Is 모드에 없다).

## 남는 차이(의도적)

- As-Is 결심 노드의 체계 성분 [5,10]초는 codex가 결심 노드 절차시간을 0으로 두는 것과 다르다.
  이번 결정 범위 밖 — 별도 판단.
- 동시 처리 석수 IAOC 20 vs codex EOC 10 — 통합센터 인력 규모 가정. 별도 반사실.

## 관련

ADR-058(승인 계선·이득의 출처) · ADR-092(처리시간 성분 분리) · ADR-098(협조 용어) ·
codex c2-timing-policy §5·§7
