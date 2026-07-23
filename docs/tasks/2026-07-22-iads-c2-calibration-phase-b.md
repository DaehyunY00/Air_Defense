# IADS_C2 추적·교전·명령 보정 Phase B

## 적용 범위

`modelFidelity=iads-c2`에서만 IADS_C2 정본의 MFR 추적, PIP/PSSEK, 상관·식별, C2 명령 상태를 사용한다. 기본 `compat` 경로와 기존 결과 wire shape은 유지한다.

## 보정 내용

- 센서 트랙은 `UNDETECTED → DETECTED → TRACKED → FIRE_CONTROL` 순서로 전이한다. 성공 스캔만 전이 타이머를 누적하고 3회 연속 miss에서 DETECTED/TRACKED는 소실, FIRE_CONTROL은 TRACKED로 강등된다. `lastUpdateAt`으로 보고 트랙 120초, 사격통제 트랙 3초의 신선도를 검사한다.
- 상관 오류는 조기경보·감시센서 `failed 2% / mis 1%`, 포대 MFR `failed 10% / mis 5%`로 구분한다. `failed`는 5초 버킷마다 도메인 RNG로 재시도하고 `correct/mis`는 지속된다. C2 처리 및 명령 수신 시 식별을 `correct/hostile`로 정정하며 실제 위협 객체의 종류·ID는 변경하지 않는다.
- PIP는 현재 위치나 Rmax 경계가 아니라 앞으로 300초 이내의 최초 `봉투 내 + 미사일 도달 가능` 위치다. 위협 종류, 사수-표적 접근각(front/side/rear), 사거리 구간으로 PSSEK를 조회하고 연료시간, MFR FC, 탄약, 동시교전 채널을 함께 검사한다.
- 명령은 `created → in_transit → received → acknowledged → committed → executing → bda_pending → hit/miss` 상태를 가진다. salvo claim은 reserved/fired/BDA pending 동안만 같은 책임축의 중복 할당을 막고 BDA 또는 취소에서 해제된다. 명령이 없을 때 자동 발사하는 fallback은 없다.
- 결과에 `global.trackQuality`, `global.c2Orders`, `global.sensorPhysics.fireControl`을 추가하고 결과 모달에 표시한다.

## 해석 경계

- 위협 운동학은 아직 Air_Defense 개념 축선 함수이며 IADS_C2의 ballistic speed warp/waypoint trajectory는 포함하지 않는다.
- 상관 `mis`는 truth를 훼손하지 않는 메타데이터다. phantom track/false merge·split은 별도 다중 항적 데이터 모델이 필요하다.
- 한국군, 육군 국지방공, USFK 축의 연결·권한 분리는 기존 배치 토폴로지를 유지한다.
