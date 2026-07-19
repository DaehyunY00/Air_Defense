# UI 성능·지도 제어 개선 기록

## 요청과 원인

- 엔진·FULL 배치가 커진 뒤 DES 양모드, MC 양모드, 민감도, 전환점이 모두 브라우저 메인
  스레드에서 동기 실행되어 `setTimeout` 뒤에도 실제 계산 동안 지도와 입력이 멈췄다.
- 헤더 우측 병목 개수 배지, C2 연결선 상시 표시, 좌측 하단 범례를 각각 제거·토글·재배치한다.
- 작업 전 사용자 소유 `.DS_Store` 변경은 보존하고 수정 범위에서 제외했다.

## 구현

- `js/workers/sim-worker.js`: DES·MC·민감도·전환점 정본 모듈을 로드하는 전용 Web Worker.
- `js/core/sim-worker-client.js`: 작업/진행 메시지, 취소, 오류 시 결정론 메인 스레드 폴백.
- 시뮬레이션·분석·MC 탭의 무거운 동기 호출을 Worker 게이트웨이로 통합했다. 강도
  슬라이더는 120ms 디바운스로 드래그 중 재분석 폭주를 막는다.
- FULL 지도 애니메이션은 표시 객체 수에 따라 10fps(legacy/MINI 30fps)로 적응하고,
  재고 링은 4Hz 및 등급 변화 시에만 갱신해 수백 개 Leaflet 호출을 매 프레임 반복하지 않는다.
- `file://` 단일본은 브라우저 보안 경계 때문에 Worker를 외부 파일로 생성할 수 없으므로
  기존과 동일한 메인 스레드 폴백을 유지한다. FULL/MC에는 `./scripts/serve.sh` 실행이 정본이다.
- 헤더 병목 배지 제거, C2 연결선 Leaflet/SVG 양쪽 토글, 범례 우측 하단 반응형 배치.

## 호환성과 검증 기준

- 엔진·RNG·물리 파라미터는 변경하지 않고 실행 위치만 분리한다.
- Worker와 폴백 모두 같은 `KJ.runDES`, `KJ.runMonteCarlo`, `KJ.sensitivitySweep`,
  `KJ.analyzeTransition`을 호출하므로 기존 seed 결정론과 결과 wire shape를 보존한다.
- 정적 회귀, 전체 Node 스위트, 단일본 재생성, `git diff --check`, Leaflet 및 SVG fallback
  브라우저 스모크로 검증한다.
