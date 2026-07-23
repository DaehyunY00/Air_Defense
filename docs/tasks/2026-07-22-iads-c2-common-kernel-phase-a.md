# IADS_C2 공통 커널 Phase A 구현 기록

## 목표

기존 `legacy`/`compat` 결과를 변경하지 않으면서 IADS_C2와 같은 ES module·이벤트 큐·도메인별 RNG·센서 물리 경계를 Air_Defense에 도입한다. 이번 단계는 공통 커널 이식의 시작이며 전체 PIP/PSSEK·상관/식별·C2 명령 에이전트의 완료를 뜻하지 않는다.

## 기준과 작업 경계

- 대상: `/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/Air_Defense`, branch `v2`, 시작 HEAD `f2cdbb6`.
- 참조 정본: `/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/IADS_C2`.
- 시작 dirty 상태의 `.DS_Store`, `docs/.DS_Store`, `js/.DS_Store`는 사용자 변경으로 간주해 수정·스테이징하지 않는다.
- 기본 `fid=compat`; `fid=iads-c2`는 고해상도 배치에서만 허용한다.

## 구현

- `js/model/iads/`
  - 안정 순서 `(time, priority, sequence)` 이진힙 EventQueue와 기존 DES 어댑터.
  - `(masterSeed, domain, entity keys)` 기반 Mulberry32 RNG substream.
  - WGS84 slant range, 레이더 수평선, 3D sector gate.
  - IADS_C2 SNR/RCS 탐지확률과 0.02→0.2초 hazard 등가변환.
  - 센서별 `UNDETECTED/DETECTED/TRACKED/FIRE_CONTROL`, 추적 소실, MFR FC sticky.
  - 위협별/비행단계별 RCS·ECM 매핑과 모델 revision.
- 로딩/실행
  - `sim-worker.mjs`를 우선 사용하는 ES module Worker로 전환했다.
  - 기존 전역 모듈은 의존 순서대로 동적 import하고, 공통 worker runtime을 사용한다.
  - `worker-ready` 이전 요청은 클라이언트 큐에 보관해 모듈 초기화와 첫 작업 전송의 경쟁 조건을 제거했다.
  - 변경 자산에는 릴리스 쿼리를 부여해 브라우저 304 캐시에서 구·신 런타임이 섞이지 않게 했다.
  - Classic Worker와 메인 스레드 계산 코드는 호환 경계로 보존한다.
  - `file://`에서는 module Worker가 보장되지 않으므로 `./scripts/serve.sh` 실행이 정본이다.
- UI/API
  - 해시 상태 `fid=compat|iads-c2`와 모델 충실도 선택기를 추가했다.
  - `iads-c2` 선택 중 legacy 배치이면 MINI_NORMAL로 안전 전환한다.
  - `runDES({modelFidelity:'iads-c2', ...})`를 추가하고 결과에 `modelFidelity`, `modelRevision`, `sensorPhysics`를 기록한다.
  - 초기 고충실도 프로파일에서는 과도한 계산을 피하기 위해 자동 MC를 생략한다. 수동 MC/민감도는 후속 성능 기준 확정 전 실험용이다.
  - 낮은 데스크톱 화면에서 우하단 범례가 실행 HUD를 덮던 적중영역 충돌을 해소했다.

## 검증 결과

- `node tests/run-all.js`: JS/ESM 35개 구문검증, 29개 스위트, 678개 어서션 통과.
- `git diff --check`: 통과.
- 로컬 서버 Leaflet 스모크: MINI_NORMAL/IADS_C2/SC2/180초가 Module Worker에서 완료되고 결과 모달이 열림.
- `?svgFallback=1` 스모크: 동일 실행이 SVG 지도에서 완료되고 결과 모달이 열림.
- legacy/compat 기준선 해시와 명시적 OFF 동일성은 기존 baseline 스위트에서 계속 통과한다.

## 이번 단계의 의도적 한계

- 위협 궤적은 아직 Air_Defense의 개념 축선 위치 함수다. IADS_C2 탄도 speed warp와 waypoint trajectory는 다음 단계다.
- 최초 획득·상태 갱신은 물리 센서 모델을 사용하지만, 보고주기·항적 freshness·다중 보고 갱신은 아직 기존 책임 C2 어댑터를 경유한다.
- 전체 range/aspect PSSEK, 연료, 정밀 aspect, correlation/identification 오류는 아직 공통 커널로 이전되지 않았다.
- C2 Commander/ICC/ECS의 선택 의미는 유지되지만 directive/claim/order lifecycle은 아직 기존 고해상도 DES 표현이다.
- IADS_C2의 `mis`가 실제 threat identity를 바꾸지 않는 결함은 그대로 이식하지 않는다. 다음 단계에서 truth/track/identity를 분리한다.
- 현재 센서 전이는 아직 보정 전이다. SC2/MINI_NORMAL/As-Is/seed 42/1800초 확인값은 생성 40·물리탐지 26이지만 FIRE_CONTROL 0으로, 이 프로파일의 격추율/MoE를 전술적 결과로 비교하면 안 된다. Phase B에서 MFR 보고주기·추적 신선도·연속 miss·FC 전이와 PIP/PSSEK를 함께 보정한다.

## 다음 단계

1. IADS_C2 trajectory·ballistic speed warp·PIP와 전체 PSSEK registry를 공통 커널로 이식한다.
2. `truthThreatId`와 `trackId`, correlation, identification, classification을 분리하고 false merge/split/swap을 구현한다.
3. 보고주기/freshness와 Commander→ICC Resolver→ECS Executor 메시지 및 directive/claim 수명주기를 이식한다.
4. 두 앱이 같은 시나리오·seed에서 canonical trace hash를 공유하도록 기존 결과 어댑터를 trace 소비자로 전환한다.
5. FULL 성능 예산과 paired MC 기준을 확정한 뒤 자동 MC를 다시 활성화한다.
