# ADR-102 — 지휘 흐름 화면의 기본 배치를 LEGACY에서 FULL로

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

- 날짜: 2026-09-28
- 상태: 적용
- 범위: `prototype/command-flow.html`의 `dep` 기본값(PARAMS · 알 수 없는 값의 되돌림 · 스위치 초기
  표시)과 그 단일본(`K-JAMDS_지휘흐름_단일본.html`), 파라미터 내보내기(`K-JAMDS_파라미터.xlsx`).
  본 앱(`index.html` · `js/core/router.js`)의 기본 배치와 엔진·카탈로그는 바꾸지 않는다.

## 맥락

2026-09-10에 배치를 고정 상수에서 스위치·`?dep=`로 되돌리면서(PARAMS 주석) 이 화면이 답할 질문을
「FULL 251노드(포대 84)에서 그림이 어떻게 달라지는가」로 두었다. 그런데 기본값은 LEGACY 64노드
(포대 15)로 남아 있어, 처음 여는 사람은 **배치 자체가 시험되지 않는 판**을 기준으로 읽게 된다 —
실측(SC3·seed29·1800초)에서 LEGACY는 상위 3개 포대가 발사의 68%를 담당하고 15개 중 4개는 한 발도
쏘지 않으며, 조준점 10개 중 5개에는 사거리 안 포대가 하나도 없다.

사용자 결정(2026-09-28): 지휘 흐름 단일본의 기본 옵션을 FULL 배치로 한다.

## 결정

1. `PARAMS`의 `dep` 기본값을 `HANBANDO_FULL_NORMAL`로 한다. 알 수 없는 `?dep=` 값의 되돌림도 FULL이다.
2. 상단 배치 스위치의 초기 표시를 FULL로 맞춘다(`renderDep()`이 어차피 상태를 다시 그리지만, 정적
   마크업도 기본값과 같게 둔다).
3. LEGACY는 없애지 않는다 — 스위치 또는 `?dep=HANBANDO_LEGACY_NORMAL`로 종전 조건이 그대로 재현된다.
4. seed 29 · 관측 1800초 · 강도 ×1과 기본 ON/OFF 플래그(`pipe/icc/lx/aim/par` ON · `floor/ecs/issue` OFF)는
   그대로다.

## 결과와 주의

- 기본 실행(SC3 · seed 29 · FULL · As-Is · 1800초): 생성 228개 · 상세 기록 228/228 · 전문 관측 2,960건 ·
  격추 165 / 누수 40 / 종료 미해결 23 · 중복교전 27. 헤드리스 Chrome 실측 계산 32.1초.
- **대가는 계산 시간이다.** 메인 스레드 동기 실행이라 30초쯤 화면이 멈춘다. 배치 표기가 「계산 20초+」를
  실행 전에 알린다(종전과 같은 장치). 빠르게 계선 흐름만 읽고 싶으면 LEGACY(약 4초)로 바꾼다.
- 두 배치의 수치를 섞어 인용하지 않는다(PARAMS 주석 · README). 기본이 바뀌었으므로 **날짜가 앞선
  화면 캡처·보고서의 「기본 실행」은 LEGACY 수치**다. 인용할 때 배치 이름을 함께 적는다.
- FULL의 밀집 열(센서·ECS·포대)은 소열로 갈리고 이름표가 빠진다(DENSE=30). 대표 C2·ICC·국지방공은
  이름을 달고, 나머지는 툴팁으로 읽는다(종전 문서와 같다).
- seed 29는 LEGACY·600초 조건에서 고른 재현 예시다(ADR-084 §추기 · ADR-100). FULL·1800초의 대표
  표본이라는 뜻이 아니다.

## 검증

- `node scripts/build-command-flow-single.mjs`로 단일본을 재생성하고 `tests/command-flow-single.test.mjs`
  (빌더 재현·자기완결·인라인 순서) 통과.
- `tests/command-flow-config.test.mjs`(기본 URL의 파라미터·기능 매핑·관측 상한 불변) 6/6 통과 —
  이 테스트는 기본 배치를 화면에서 직접 읽으므로 FULL로 돈다.
- `tests/prototype-readability.test.mjs` 통과.
- 헤드리스 Chrome에서 단일본을 `file://`로 열어 확인: 기본 URL은 FULL 스위치 ON · 「한반도 본 배치 — 정상 ·
  노드 251 · 포대 84 · 계산 20초+」, `?dep=HANBANDO_LEGACY_NORMAL`은 LEGACY 64노드·포대 15,
  `?dep=typo`는 FULL로 되돌림, 페이지 오류 0건.
- `node scripts/export-params-xlsx.mjs`로 파라미터 xlsx 재생성(기본 배치 행 1건 변경).
