# 2026-07-23 IADS_C2 분석 계층 선택 이식

## 목적

Air_Defense의 기존 DES 동역학·실패 taxonomy·비용/자원 지표를 유지하면서,
IADS_C2에서 검증된 trace 순수 파생·C2 귀속·동일 seed paired 비교 방식을
C2 병목 분석과 해결 시각화에 적용한다.

## 구현

- `c2Analysis:true`일 때만 구조화 이벤트를 기록한다. 기본 `runDES` 결과 wire shape와
  Phase 0 legacy 해시는 유지한다.
- Worker의 `desPair`는 양 모드에서 구조화 이벤트를 수집하고 `buildC2Analysis()`로
  요약한 뒤 원시 이벤트를 삭제한다.
- 리포트는 킬체인 지연 분위수, C2 대기·서비스 분포, 60초 피크 ρ, 누출 시점
  C2 상태 귀속, 동시/순차 중복교전, 명령 원인, 병목 증거·검증할 해결안을 제공한다.
- 기존 engagement order를 `directiveId`, 권한 수준, 위임 수준, 유효기간, plan별
  `launchCause`, `engagementId`, 만료·취소 사유로 확장했다. 위협 전역
  `_commandCause`는 구 UI 호환만 담당하며 발사 귀속의 권위값이 아니다.
- `DIRECTIVE_CREATED/SENT/RECEIVED/PROCESSING/ACTIVE/EXPIRED/CANCELLED`,
  `TRACK_REPORT_RECEIVED`, `COORDINATION_FAILED`, `RESPONSIBILITY_UNRESOLVED`를
  구조화 계측한다. 같은 위협·노드를 재방문하는 작업은 `jobId`로 분리한다.
- 실제 C2 ledger의 마지막 갱신시각에서 결심 항적 age를, MFR 항적에서 발사 시
  FC age를 계산하며 지휘축·위협범주별 coverage를 함께 제공한다.
- 실제 `SENSOR_DETECTED`와 `engagementId`로 발사 전·재교전·누출 전 공백,
  비상/자위권 발사 결과를 파생한다. PIP 기하학 창이 있었지만 발사 0으로
  누출된 위협은 polling 횟수와 무관하게 위협당 한 번 기회손실로 집계한다.
- 전체 생성·해결·미해결 분모를 명시적으로 분리한다.
- `runPairedMonteCarlo()`는 As-Is/To-Be를 동일 seed 집합으로 실행하고
  seed별 Δ(To-Be−As-Is)의 CI로 수렴과 통계적 분리를 판정한다.
- paired MC는 18개 C2 MOP를 seed별로 요약한 뒤 원시 이벤트를 즉시 폐기한다.
  각 지표의 As-Is·To-Be·Δ는 양팔 모두 finite인 같은 seed 교집합만 사용하며,
  미계측·이벤트 절삭은 0이 아니라 제외 수로 공개한다.
- 결과 모달은 C2 귀속과 As-Is↔To-Be 단일-seed 효과를 표시하고, 확정 판단은
  paired MC CI를 보도록 안내한다.

## 의도적으로 이식하지 않은 부분

- IADS_C2의 탐지 대리시각은 사용하지 않는다. Air_Defense의 실제
  `SENSOR_DETECTED` 사건을 사용한다.
- 타입 수준 풀링 용량은 사용하지 않고 Air_Defense의 노드별 `c`, 관측 ρ·드롭을 유지한다.
- IADS_C2 구조성 휴리스틱은 Air_Defense failure taxonomy를 대체하지 않는다.
  C2 상태 귀속은 보조 증거이며 단일 실행 인과로 단정하지 않는다.
- `emergencyEngagement`는 공개근거가 필요한 교리 플래그라 기본 OFF다. 명령 부재만으로
  자동 발사하지 않으며, ON에서도 LOCAL_AD·실제 교전창 임박 조건을 만족한 기존 발사만
  비상 원인으로 분류한다. 자위권은 별도 정책 입력이 없어 자동 생성하지 않는다.
- `modelFidelity=iads-c2`에서는 지시가 포대별 ECS의 `directive_reception`
  M/M/c/K 업무를 통과해야 ACTIVE가 된다. 큐 포화는 `queue_capacity`, 교전창을 넘긴
  도착은 `window_closed` 만료로 분리한다. compat/Legacy는 결과 보존을 위해 이 물리
  수신 큐를 사용하지 않아 RECEIVED→ACTIVE가 같은 시각일 수 있다.

## 검증

- 기본 실행에 구조화 이벤트·확장 분모 필드가 없음을 고정한다.
- 계측 ON/OFF의 spawned/killed/leaked 동역학이 동일함을 검증한다.
- 격추+누출+미해결률=1, 해결분 격추+누출률=1을 검증한다.
- 모든 누출이 C2 상태 4종에 정확히 한 번 귀속됨을 검증한다.
- paired 양팔·Δ가 동일 seed 수를 사용하고 Δ 평균이 팔별 평균 차와 일치함을 검증한다.
- 합성 이벤트로 명령 활성률·만료 사유, engagementId 기반 비상 MISS,
  결심 항적 age, 교전 공백, 기회손실, 협조/책임 실패를 고정한다.
- 실제 FULL IADS_C2 실행에서 order 생성 수와 directive 이벤트 수, plan별 발사원인,
  항적 신선도 분포가 일치하는지 검증한다.
