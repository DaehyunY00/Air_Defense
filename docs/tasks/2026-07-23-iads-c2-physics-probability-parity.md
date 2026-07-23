# IADS_C2 물리·확률 파라미터 정합

## 작업 의도

Air_Defense의 `modelFidelity=iads-c2` 경로가 참조 저장소
`/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/IADS_C2`
의 물리·확률 파라미터를 실제 계산에 사용하도록 맞춘다. 기본 `compat` 실행과 기존
고해상도 호환 배치 결과는 보존하며, C2 정보 풀·다발 사격 같은 구조 차이는 이번 범위에
포함하지 않는다.

## 구현 계획

- 센서별 탐지/추적/화력통제 거리, 전이시간, 최저고도, RCS 기준, 밴드별 재밍 감수성과
  Patriot/AN/TPY-2 섹터를 IADS_C2 `weapon-data.js`와 맞춘다.
- 0.02초 기준 Pd를 0.2초 coarse 스캔으로 변환할 때 탐지와 추적상실 hazard를 보존한다.
- 위협별 RCS phase, ECM 계수와 고도 프로파일을 이식한다.
- 무기별 봉투·속도·연료·PSSEK·발사대 탄약·교리 메타를 맞추고, PSSEK에 재밍/ECM 및
  최소 교전확률 0.10 기준을 적용한다.
- 물리 정합값은 `iads-c2`에서만 소비하고, `compatibilityRanges`와 compatibility missile
  경계를 통해 기존 실행을 보존한다.

## 구현 결과

- Green Pine B/C, FPS-117, TPS-880K, L-SAM MFR, 천궁 MFR, Patriot Radar,
  AN/TPY-2의 IADS_C2 파라미터를 등록했다. 탄도/비탄도별 센서 사거리를 구분해서 읽는다.
- 기하 게이트 밖 스캔은 RNG를 소비하거나 기존 트랙을 잃지 않으며, 추적 중 in-sector
  miss는 IADS_C2의 `hazardLossProbability`로 3×0.02초 연속 miss 위험을 보존한다.
- SRBM·유도방사포·순항미사일·항공기·UAS의 RCS phase, 기준속도, 고도, ECM 계수를
  등록하고 현재 개념 축선 시간 위에 IADS_C2 고도/RCS 프로파일을 적용했다.
- L-SAM AAM, 무기별 PSSEK와 보수적 빈 경계/aspect fallback, 연료시간, Patriot 6개
  발사대×12발, 교리/유도/발사간격 메타를 이식했다.
- `jammingLevel`(0~1)과 `ecmActive` 입력을 추가했다. 기본값은 각각 0/false이며,
  활성 시 탐지·PSSEK·통신지연에 반영하고 결과 config에 기록한다.
- `fuel_insufficient`, `pk_too_low`를 실패 원인 taxonomy에 추가했다.

## 검증 결과

- 수정 모듈 `node --check`: 통과.
- `node tests/iads-kernel.test.mjs`: 물리·확률·결정론 계약 통과.
- `node tests/run-all.js`: JS/ESM 38개 구문검증과 29개 스위트·703개 어서션 전체 통과.
- `git diff --check`: 통과.
- legacy/고해상도 `compat` 경로는 별도 compatibility 데이터로 분리했으며 Phase 0 해시와
  기존 고해상도 회귀 스위트가 이를 검증한다.

## 남은 문제 / 다음 작업 후보

- 위협의 경도·위도 진행률과 체공시간은 Air_Defense 시나리오의 개념 축선/dwell을 유지한다.
  IADS_C2의 탄도 speed warp와 순항 waypoint를 그대로 적용하려면 시나리오 발생·종료시간까지
  함께 재설계해야 한다.
- IADS_C2의 포대/웹별 visible-track pool, 원격 FC-grade 권한, SS 다발 사격,
  interceptor entity, Directive/Claim 집계는 구조 이식 단계로 남는다.
- `ecmActive`와 `jammingLevel`의 UI 입력 및 민감도 스윕 축은 후속 작업이다.
