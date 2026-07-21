# ADR-050 · 실패 분류 v2 — 반사실 기반 주원인·기여원인 분리

## 결정

실패 코드별 고정 `structural: true/false`를 최종 판정으로 쓰지 않는다. 각 실패는 다음 메타를 갖는다.

- `family`: `architecture`, `capability`, `capacity`, `resource`, `kinematic`, `stochastic`, `unknown`
- `structurality`: `structural`, `conditional`, `nonstructural`, `unknown`
- `primaryCause`: 누출을 직접 결정한 상호배타적 주원인 1개
- `contributors`: 파이프라인 중 관측된 보조 원인 0개 이상
- `evidence`: 사수·책임 C2·발생시각 등 판정 근거

`conditional`은 단일 실행에서 구조적 실패 수에 포함하지 않는다. paired-seed 반복에서 지속되거나 구조 개입 반사실에서만 사라진다는 증거가 있을 때 `classifyFailure(code, evidence)`로 `structural`에 승격한다.

## 고해상도 종료 판정

1. 교전 가능 책임 C2가 없으면 `no_responsible_c2`.
2. 책임 C2는 있으나 탐지 센서에서 도달할 보고경로가 없으면 `no_report_path`.
3. 탄약·채널·화력통제를 정상화한 반사실에서도 전 비행창에 PIP가 없으면 `engagement_geometry_gap`.
4. PIP는 있었지만 책임 C2 최초 결심 또는 명령 도착이 최종 발사창 후였으면 `window_lost_due_to_c2`.
5. 그 다음으로 전 가능 사수의 탄약, 채널, 화력통제를 각각 `ammo_depleted`, `capacity_full`, `no_fire_control`로 분리한다.
6. 발사 후에는 `missed` 또는 `timeout:engage`를 주원인으로 보존하고, 앞단 문제는 `contributors`에 남긴다.

## 병목과의 경계

실패와 병목은 별도 지표다. 구조적 주원인은 `gap` 병목으로 승격하지만, `conditional`은 승격하지 않는다. native IADS 사수는 M/M/c `nodeState`를 우회하므로 발사·완료·피크 활성·적분 이용률·용량차단을 `iadsResources`에서 별도 계측해 `nodes[]`에 합친다.

## 호환성

- legacy/OFF 결과 wire shape은 유지한다.
- `global.failureSummary` 및 사수 `shots/peakActive/maxSimultaneous/capacityBlocks`는 고해상도 ON에서만 의미가 있다.
- 기존 `leakReasons`는 유지하되, 미분해 `no_feasible_pip`는 최종 주원인으로 방출하지 않는다.
