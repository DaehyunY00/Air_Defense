# ADR-003 — 종료 절단(censoring) 보정 (Phase 3, ⑨)

## 맥락
`spawnT + dwellSec > endTimeSec`인 위협은 EXIT가 안 떠 격추도 누수도 아닌 채 `spawned`(분모)에 남는다(사실 d, 실측 13~15%). `killRate = killed/spawned`가 이들을 분모에 포함해 격추율·누수율을 **체계적으로 과소평가**한다. ①단계 탐지율 절단과 같은 뿌리.

## 선택지
- **A. 분모 제외**: `denom = spawned − censored`, `censored = spawned − killed − leaked`(잔존). 순수 보고 변경.
- **B. Warm-up/Cool-down**: 앞뒤 관측 구간 제외 — 정상상태만. 구현 복잡, 도착 스케줄 손대야 함.
- **C. 도착 중단(cutoff)**: `t > endTime − maxDwell` 이후 스폰 중지 — **시뮬레이션 동역학을 바꾼다**(스냅샷·rng 교란).

## 결정
**A** — `censored = max(0, spawned − killed − leaked)`(관측창 종료까지 미해결). `features.censorFix`(기본 ON)이면 `killRate/leakRate` 분모에서 제외(= 해결분 killed+leaked 기준). exchange·spawned·killed·leaked·rng·이벤트는 **일절 불변**(순수 보고). `censored`·`censoredRaw`를 `global`에 노출.

## 근거
- **C안은 동역학 변경**이라 스냅샷·rng를 흔들고, 다른 Phase의 편향 측정을 오염시킨다. A안은 도착·이벤트를 안 건드려 개별 기여도 측정이 깨끗하다.
- `censored = spawned − killed − leaked`는 항등식이라 **flow 보존(spawned ≥ killed+leaked)이 자동 유지**된다(censored ≥ 0).
- **공용 유틸(① 적용 가능)**: `censored`/`censoredRaw`를 노출했으므로, ①단계 탐지율도 `detected/(spawned−censored)`로 동일 보정 가능하다. 본 브랜치는 ⑨(격추·누수율)만 보정하고, ①은 `feat/sensor-pd-fusion` 소관으로 남기되 **동일 필드를 재사용**하도록 설계했다.

## 결론 영향
- **절단율: As-Is 15.3% > To-Be 10.0%**(SC3 x2.5) — As-Is가 C2 파이프라인에 더 오래 갇혀 미해결분이 많다.
- 격추율 보정: As-Is 9.3→11.0% · To-Be 42.0→46.7%. **To-Be killRate 개선폭 Δ 32.7→35.7p (+9.2% 상대).** 에스컬레이션 임계(20%) **미달이나 방향은 약하게 To-Be 유리**(절단이 As-Is에 더 많아 보정 시 As-Is도 오르지만 절대폭은 To-Be가 큼). 원장에 기록.
- 스냅샷·exchange 불변(killRate/leakRate만 파생 변경).

## 되돌리는 법
- 플래그: `features.censorFix=false` → censored=0, killRate=killed/spawned(legacy). 되돌리기 0/36 유지.
- 커밋: (Phase 3 커밋 해시)
