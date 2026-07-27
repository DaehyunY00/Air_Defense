# 2026-07-27 — 분석 탭 지표 정리·모듈화·고충실 기본화 검토

사용자 요청 3건에 대한 검토 기록. 결론: **지표 1건 표시 제거, 나머지 2건은 근거를 남기고 현상 유지(반영 X)**.

## 1. 분석 탭 "항상 0건/변화 없음" 지표 검토 → no_report_path 표시만 제거

### 검토 방법
분석 탭 9단계 파이프라인 카드가 렌더링하는 지표 약 30종 + 병목 taxonomy 실패코드 표를,
UI가 실제 사용하는 계산식 그대로(`js/ui/panels.js`의 desPair 경로 복제) 전수 스윕:

- legacy 배치: sc1·sc2·sc3 × 강도 0.5/1/1.5/2/2.5/3 × seed 12345·7 (As-Is/To-Be 쌍)
- 고해상도: HANBANDO_MINI_NORMAL·MINI_MCRC_DOWN·FULL_NORMAL·FULL_MCRC_DOWN × sc1~3 × 강도 1/2 × seed 12345
- 합계 60 케이스쌍(120 DES 실행), 모델 충실도는 분석 탭 기본값 compat
  (iads-c2 전용 코드의 발화는 tests/failure-classification.test.js가 별도 검증)

### 결과 — 지표(metric row)는 전부 유지
모든 지표 행이 최소 한 케이스에서 비영(非零) 또는 As-Is↔To-Be 차이를 보였다. 특히 의심 후보였던:

| 지표 | 관측 | 판정 |
|---|---|---|
| 탐지율 | A 0.941~1.000, 최대 Δ 0.059 | 유지(포화 경향은 툴팁에 이미 명시) |
| MCRC+국지 복수출처 항적융합 | FULL As-Is 6케이스 비영(최대 167건) | 유지(FULL 전용) |
| 교전현황 음성/VTC 드롭 | FULL 6/5케이스 비영(최대 458건) | 유지(FULL 전용) |
| 지연·드롭 상태정보 중복교전 | FULL 1케이스 1건 | 유지(인과 지표, 희소하나 발화) |
| 분권 전환 | As-Is 18케이스 비영(최대 557회) | 유지 |
| 중복교전 발생(동적)·이중 소모 | As-Is 28케이스 비영 | 유지 |

To-Be 열이 항상 0인 지표(coord 홉 지연, 승인 대기, 중복교전, 분권 등)는 "To-Be가 해당 병목을
제거한다"는 비교 자체가 정보이므로 삭제 대상이 아니다.

### 결과 — 실패코드 중 no_report_path만 표시 제거
스윕 전 케이스에서 0건인 코드: `not_detected` `no_sensor` `no_report_path` `no_shooter`
`engagement_geometry_gap` `capacity_full`. 각각의 처분:

| 코드 | 처분 | 근거 |
|---|---|---|
| **no_report_path** | **분석 탭 표시 제거** | tests/deadcode.test.js가 "구조적으로 발화 불가(커버 센서가 있으면 보고경로 항상 존재) — 영구 死"로 판정. 어떤 데이터·설정에서도 발화할 수 없어 표시 가치 없음. 엔진 경로·死 코드 게이트는 유지 |
| not_detected | 유지 | compat 스윕에선 0이나 deadcode.test.js 풀링에서 극희소(1~5건) 발화 확인 — near-dead 아님 |
| no_sensor / no_shooter | 유지 | "정직한 0" — 커버리지 매트릭스에 공백 셀이 없어 0일 뿐, 배치 데이터가 바뀌면 즉시 발화하는 라이브 가드(deadcode.test.js가 반증 매트릭스로 검증). 공백을 인위 생성하지 않는다는 기존 결정 존중 |
| engagement_geometry_gap / capacity_full | 유지 | 고충실(iads-c2) 전용 분류 코드 — failure-classification.test.js가 native 실행에서 발화(>0)를 검증. compat 스윕 0은 정상 |

변경 파일: `js/ui/panels.js` (② 단계 codes 배열, taxonomy 표 rows) — 주석으로 근거 병기.

## 2. 모듈 전면 사용 검토 → 반영 X (오프라인 사용 불가)

현행: 기본 경로는 classic IIFE 스크립트 27개(`window.KJ` 네임스페이스) + 고충실 물리만
ES module(`js/model/iads/bootstrap.js`, `type="module"`). 전면 ES module 전환 시:

- `file://` 직접 실행이 전면 불가 — ES module은 file://에서 CORS로 차단된다. 저장소가 보장하는
  오프라인 시나리오(README 방법 B: 폐쇄망·서버 불가 환경에서 단일본 HTML 열기)가 깨진다.
- 단일본 빌드(`scripts/build-single.mjs`)는 classic 스크립트를 그대로 인라인하는 방식이다.
  module 그래프(import 문)는 인라인만으로는 동작하지 않아 번들러 도입이 필요한데, 이는
  "빌드 불필요·의존성 최소" 원칙과 충돌한다.
- 이득(정적 import 그래프, 트리셰이킹)은 현재 규모에서 실익이 작고, 이미 고충실 커널만
  module로 분리하는 하이브리드가 두 요구(물리 모듈성 ↔ 오프라인 배포)를 동시에 만족한다.

부수 관찰: 단일본 HTML에도 `<script type="module" src="js/model/iads/bootstrap.js">` 외부 참조가
남는데, 이는 의도된 우아한 강등이다 — file://에서 로드 실패해도 기본(compat) 경로는 완전 동작하고,
고충실 모드는 원래 로컬 서버 전용(README 명시). 빌드 검증(`잔여 외부 참조`)은 classic 스크립트만
검사하므로 오탐 없음.

## 3. 고충실(iads-c2) 모드 기본화 검토 → 현상 보존 (기본 모드 = legacy 배치)

- 기본값은 `fid=compat` + `dep=legacy`다(`js/core/router.js` DEFAULTS).
- 고충실 모드는 legacy 배치와 양립 불가: UI에서 `fid=iads-c2` 선택 시 배치가 자동으로
  `HANBANDO_MINI_NORMAL`로 강제 전환된다(`js/main.js:99`). 즉 "기본 모드"는 legacy 배치를
  의미하며, 사용자 조건("기본모드가 legacy 배치를 의미한다면 현상태 보존")에 해당한다.
- 추가 근거: 고충실 모드는 ES module 로딩(로컬 서버)이 필요해 file://·단일본 오프라인 실행이
  불가하고, README가 "FULL/MINI 절대값은 전술 성능치가 아니라 배치·파이프라인 비교값"이라
  명시하므로 기본화 시 첫 화면 결과의 해석 부담도 커진다.

## 스윕 원자료 요약 (60 케이스쌍)

| 지표 | As-Is 범위 | To-Be 범위 | 비영 A/B | max\|Δ\| |
|---|---|---|---|---|
| det(탐지율) | 0.941~1.000 | 0.955~1.000 | 60/60 | 0.059 |
| reportDelay | 0~16.0 | 0~2.0 | 56/56 | 14.0 |
| trackRho | 0~0.990 | 0~0.537 | 36/36 | 0.853 |
| trackWq | 0~149.1 | 0~2.8 | 36/19 | 149.1 |
| trackDrops | 0~81 | 0 | 10/0 | 81 |
| bnCount | 0~9 | 0~2 | 46/12 | 9 |
| decisionDelay | 0~304.6 | 0~296.7 | 56/56 | 177.5 |
| coordDelay | 0~54.2 | 0 | 36/0 | 54.2 |
| apprRho | 0~0.900 | 0~0.164 | 36/24 | 0.900 |
| apprWq | 0~109.6 | 0 | 34/0 | 109.6 |
| coordLinkDelay | 0~21.7 | 0~2.0 | 56/20 | 21.7 |
| fusionMulti | 0~167 | 0 | 6/0 | 167 |
| statusDropped | 0~458 | 0~93 | 6/5 | 424 |
| statusDupStale | 0~1 | 0 | 1/0 | 1 |
| heat(정적 위험) | 0~8250 | 0~2292 | 40/8 | 5958 |
| dupDynamic | 0~870 | 0 | 28/0 | 870 |
| dupCost | 0~1983.8 | 0 | 28/0 | 1983.8 |
| deleg | 0~557 | 0 | 18/0 | 557 |
| shooterRho | 0~0.939 | 0~0.537 | 56/56 | 0.488 |
| shooterWq | 0~21.8 | 0~4.1 | 14/5 | 21.8 |
| commandDelay | 0~30.0 | 0~2.6 | 56/56 | 28.0 |
| shooterDrops | 0~163 | 0 | 9/0 | 163 |
| killRate | 0~0.867 | 0~0.875 | 56/56 | 0.575 |
| meanTTK | 0~375.2 | 0~355.1 | 56/56 | 260.5 |
| shotsPerEng | 0~2.31 | 0~2.37 | 56/56 | 0.880 |
| defenseEff | 0~0.867 | 0~0.875 | 56/56 | 0.735 |
| exchangeSat | 11.4~6006.7 | 4.2~116.7 | 48/48 | 6002.3 |
| hvPreserve | 0.776~1.000 | 0.801~1.000 | 60/60 | 0.105 |
| interceptPerTV | 0.21~47.6 | 0.27~47.3 | 56/56 | 11.0 |
| leakRate | 0.133~1.000 | 0.125~1.000 | 60/60 | 0.575 |
| structLeaks | 0~212 | 0~74 | 40/12 | 212 |

실패코드 총 관측(A/B 합): no_engage_window 249/97 · responsibility_gap 2160/0 ·
missed 691/1260 · timeout:engage 50/278 · timeout:c2 1520/2127 · overflow 481/0 ·
no_responsible_c2 370/370 · window_lost_due_to_c2 125/28 · no_fire_control 288/0 ·
ammo_depleted 0/244. (전 케이스 0건: not_detected · no_sensor · no_report_path ·
no_shooter · engagement_geometry_gap · capacity_full — 처분은 위 표 참조.)

※ 본 스윕은 2026-07-24 C2-VOICE-COORD-01 실험 변경(음성협조 10~30s 균등분포) 이후 상태 기준.
