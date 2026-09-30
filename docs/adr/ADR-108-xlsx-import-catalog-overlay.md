# ADR-108 — xlsx 가져오기와 카탈로그 덮어쓰기: 통합문서에서 고친 위치·제원·계선을 엔진에 얹는다 (`catalogOverlay`)

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

- 날짜: 2026-09-30
- 상태: 채택 (엔진 옵트인 — `features.catalogOverlay`가 객체일 때만 · 화면·단일본 미적용, 사용자 결정 2026-09-30)
- 관련: `scripts/export-params-xlsx.mjs`(내보내기 — 이 ADR의 역방향) · `scripts/xlsx-lite.mjs`(쓰기)·`scripts/xlsx-read.mjs`(읽기, 신설) · ADR-061(배치 카탈로그) · ADR-064(남부 축선 coverage)
- 새 파일: `scripts/import-params-xlsx.mjs` · `scripts/run-with-overlay.mjs` · `scripts/xlsx-read.mjs` · `tests/catalog-overlay.test.mjs`

## 맥락

`K-JAMDS_파라미터.xlsx`는 내보내기 전용이었다(안내 시트 「엑셀 불러오기 기능은 없습니다」). 실제 자산의 위치·성능을 넣어 모의하려면
소스 파일(`js/config/deployments.js`·`system-types.js`·`data/links.js`)을 직접 고쳐야 했고, 그 값은 공개 저장소에 남는다. 사용자 요청
(2026-09-30): 통합문서에서 고친 값을 **엔진에** 적용할 수 있게 하되 단일본 화면은 제외.

## 결정

1. **덮어쓰기(overlay) 형식** — 소스와 다른 값만 담는 JSON. `nodes[id]`(coord · rangeKm · engage{rangeKm, channels, engageTimeSec, magazine,
   missiles{ABM|AAM: engagementEnvelope, missileSpeed}} · queue{servers, capacity, serviceTimeSec} · sensor{ranges, transitionTime, detectionProbability,
   reportingPeriod} · iadsEngageableThreats) · `links[]`(from, to, kind, asis/tobe{type, delaySec, dist}) · `removeNodes[]`. 새 노드 추가는 범위 밖
   (계선·소속·coverage를 지어내야 하므로 — 경고로 건너뜀).
2. **가져오기** `scripts/import-params-xlsx.mjs` — 통합문서의 「아군자산_<배치>」「자산제원_센서」「자산제원_포대」「통신계선_<배치>」를 읽어 **현행 카탈로그와
   다른 셀만** overlay로 만든다(열 이름으로 찾으므로 열 순서 무관). 유형 제원(센서·포대 시트)은 그 유형의 노드 전부에 적용된다. 검증: 한반도 범위 밖
   좌표(위도·경도 뒤바뀜 의심) · 음수·0 이하 · 대기실 < 결심석 · 뒤집힌 요격 구간 · 0~1 밖 탐지확률 · 알 수 없는 id·유형·매체·위협은 경고하고 건너뛴다.
   `--strict`면 경고 시 파일을 쓰지 않는다.
3. **적용** `KJ.applyCatalogOverlay(catalog, overlay, southern)`(deployment-adapter) — `resolveModelCatalog`가 `features.catalogOverlay`를 보면 캐시된
   카탈로그의 노드·링크를 **얕은 복사한 새 카탈로그**에 값을 얹는다(소스·캐시 불변). 좌표·사거리가 바뀌면 coverage(축선 투영)를 다시 계산한다.
   센서·포대 유형 제원은 노드에 `typeOverride`로 실리고, 엔진은 `sensorSpec(node)`/`shooterSpec(node)`로 **노드 제원을 유형표보다 먼저** 본다
   (OFF에서는 `typeOverride`가 없어 종전과 같은 객체를 돌려준다 — bit-exact).
4. **실행** `scripts/run-with-overlay.mjs` — overlay를 얹은 실행과 같은 조건의 기준 실행을 나란히 요약한다(격추·누수·위협별·최다 발사·이용률·병목).
   결과 `features.catalogOverlay`에는 overlay 객체가 아니라 **적용 요약**(nodes·links·removed·unknown·source)만 실린다.
5. **보안** — overlay JSON(`*_overlay.json`)은 `.gitignore`에 넣는다. 실제 위치·제원을 넣은 통합문서도 저장소에 커밋하지 않는다.
6. **불변** — overlay가 없으면 어댑터·엔진 경로가 종전과 자구 같다(hires-baseline 6케이스 통과). 화면(`prototype/command-flow.html`)·단일본·본 앱은
   overlay를 읽지 않는다(사용자 결정 — 필요해지면 입력칸 하나로 붙일 수 있다).

## 검증 (tests/catalog-overlay.test.mjs)

① OFF bit-exact(null = 미지정 · features 키 없음) ② 내보낸 통합문서 그대로 → 빈 overlay · 셀 7종 변경 → overlay에 실림 · 범위 밖 좌표·새 id는 경고
③ 좌표·coverage·노드 제거(계선 포함)·센서 typeOverride·계선 지연이 카탈로그에 반영 · THAAD 제거 → 발사 0 · 탄약 12 → 발사 ≤ 12 · 창구 2 → 이용률 상승 ·
features 요약 ④ flowTrace ON/OFF 동역학 지문 동일.

실측(수정 통합문서 예 · 현 체계 · 900초): THAAD 제거·수도 L-SAM 탄약 12·탄도탄작전통제소 창구 2·그린파인 충북 탐지 500 km·남부 L-SAM 부산 이동 →
격추 84 → 81, 탄도탄작전통제소 이용률 0.44 → 0.93(드롭 19), 남부 L-SAM 발사 8건(이동 후 남부 축 담당).

## 한계

- 가져올 수 있는 것은 「어디에 무엇이 있고 제원이 얼마인가」까지다. 요격확률 표(거리·방향별), 위협 물리, 결심 규칙은 시트에 없고 코드에 있다.
- 유형 제원은 유형 단위로만 바꿀 수 있다(같은 유형의 포대 일부만 다른 제원 — 지원하지 않음). 노드별로 다르게 하려면 아군자산 시트의 실효 제원 열
  (사거리·채널·탄약·탐지거리)을 쓴다.
- 좌표를 옮겨도 `posKey`·소속 지휘소는 그대로다(예: 남부 L-SAM을 부산으로 옮겨도 여전히 남부 L-SAM 사격통제소·2여단 소속).
