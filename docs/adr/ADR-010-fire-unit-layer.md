# ADR-010 — 요격체계 세분화 (Fire-Unit Layer, WP1)

## 맥락 (WP0 코드 정독 산출)
현행 shooter는 "무기유형 × 권역" **단일 집계 노드**(M/M/c 교전채널)다. 예: `MDU-L`은 상층 MD 전체를
한 노드로 뭉뚱그려 `engage.channels`(교전채널 수)·`engage.engageTimeSec`(채널 점유)·`engage.pk`·
`engage.magazine`만 갖는다(`js/data/nodes.js`). 엔진(`js/engine/sim-engine.js`)의 교전 경로는:
`_doEngage`(canEngage→coverage→교전창 3중 필터 + WTA) → `_onShooterArrive`(_nodeArrive, kind 'engage')
→ `_onEngageEnd`(BDA·재교전·magazine 차감). RNG는 **스캔/발사당 정확히 1회**로 엄격 관리되며(`_startService`
지수 1회·`_pk` triangular 1회), 도착 스트림(`arrRng`)과 처리 스트림(`rng`)이 분리(CRN)돼 As-Is↔To-Be가
같은 위협열을 마주한다. 모든 신규 거동은 `features.*` 플래그로 토글되고 **전부 OFF면 legacy 지문과 비트
동일**(`tests/legacy-snapshot.json`·reengage 되돌리기 어서션)해야 한다. 이 집계 모델은 **실제 화력단위 내부
(대대 사격지휘·포대 ECS·교전통제레이더 채널·발사대 재고·재장전)를 보이지 않게 한다** — "병목이 C2에서
화력단위로 이동하는가"를 물을 수 없다. WP1은 이를 실제 계층으로 세분화한다.

## 선택지 (구현 전 대안 기록)

### 1) 대체 방식 — 집계 노드를 어떻게 세분화하나
- **A. 인스턴스 대체(채택)**: `features.fireUnitLayer=true`일 때 집계 shooter를 ICC(대대,'c2')+포대('battery',
  ECS+MFR+TEL[]) 인스턴스로 **대체**한다. OFF면 집계 노드 그대로 — 두 세계가 한 실행에서 하나만 활성.
  엔진은 per-sim 활성노드 목록(`_buildActiveNodes`)+id 색인(`_node`)으로 간접화하되 **OFF는 `KJ.nodesInMode`
  그대로 반환**(비트 동일 보장, 위험 국한).
- B. 집계 노드에 하위구조를 필드로만 부착: 엔진이 여전히 단일 노드로 처리 — 채널/재장전 병목이 드러나지 않음(기각).

### 2) 능력·pk·비용·제약 — 포대가 어떻게 상속하나
- **상속(채택)**: 포대는 `legacyOf` 노드에서 canEngage·pk·costPerShotM·wtaSuit·reserveFloor를 **런타임 상속**
  (`battery()` 팩토리가 `KJ.nodeById(legacyOf)`에서 복사). **신궁·천마 탄도탄 불가가 전 포대 인스턴스에 자동
  상속**(§1 절대규칙 2) — `KJ.validateFireUnits` (a)(c)로 고정, `tests/constraints.test.js` (a-2) 인스턴스 검증.
- 복제(각 포대에 값 재기입): 제약 누락·표류 위험 → 기각.

### 3) 함정(SM2-E/W) battery化 여부
- **집계 유지(채택)**: 이지스함은 SPY-1 단일 레이더 + VLS(80 Mk41)라 ECS/MFR/TEL 3분해가 어색하고
  해군 C2 계통이 다르다(laydown-sources.md §1). `legacyOf` 미지정 → 대체되지 않음. **VLS를 대용량 단일
  magazine 포대로 볼 여지는 있으나 범위 밖으로 유보**(향후 ADR). FTR(기동 공중자산)도 동일 사유로 집계 유지.

### 4) WTA 계층 — ICC가 예하 포대를 재선택하나
- **단일 티어 WTA(채택)**: `_doEngage`의 Best-Shooter WTA가 **포대를 직접 선택**한다(그 포대의 대대도 함께
  선택됨). ICC는 대대 사격지휘 **처리 큐**(모든 교전이 통과하는 부하 지점)로 모델링 — 별도 재할당 알고리즘이
  아니다(결정론 유지). 대안(2티어: 대대 선택 후 ICC가 포대 재선택)은 비결정론 여지·복잡도로 유보.

### 5) 섹터 모드 — 동적 전환 여부
- **정적(채택)**: L-SAM MFR은 `sectorMode:'ballistic-sector'`(탄도 지향 → 비탄도 위협 후보 제외)로 **정적
  설정**. 합참 기고문 "360도 모드 시 탄도탄 방어 취약"의 역방향(섹터 지향 시 대공 취약)을 표현. **동적 전환은
  범위 밖**(향후).

### 6) 재장전 — ADR-008 기각의 번복
- ADR-008은 재장전(reload)을 "별개 물류 과제"로 **범위 밖 기각**했다. **WP1에서 명시적으로 번복한다**:
  작업지시서가 충실도 우선(성능보다)·발사대 물리 모델을 요구하므로, TEL 단위 `readyRoundsPerTel`+`reloadSec`를
  도입한다. 관계: `magazine = Σ(TEL readyRounds) + 예비탄`으로 정의하고 **이중계상 금지**(`validateFireUnits`(b):
  ΣreadyRounds ≤ legacy magazine). 재장전은 `features.fireUnitLayer`에 종속(magazine 플래그와 독립 — 발사대
  물리는 세분화의 일부).

## 결정
**A + 상속 + 함정 집계 유지 + 단일티어 WTA + 정적 섹터 + 재장전 도입.** `features.fireUnitLayer` 기본 **OFF**.
포대 교전 파이프라인(ON): 상위C2 →(command)→ **ICC**(kind 'fire-direction') →(command)→ **ECS**(kind 'ecs',
`<포대>::ecs` 콘솔 큐) → **MFR**(kind 'engage', 채널 = 동시교전 상한, 조사 점유 = illumTimeSec) → BDA. 각 단계는
검증된 `_nodeArrive` M/M/c/K를 재사용(포화·드롭·Wq·보존 항등식 자동 계승). TEL 재고 차감/재장전은 `_telFire`/
`_onReloadDone`. 티어 핸드오버(상위→하위 재교전)는 `global.tierHandoffs`로 관측.

## 근거
- **되돌리기(비트 동일)**: fireUnitLayer OFF → `_buildActiveNodes`가 `KJ.nodesInMode` 그대로 반환, `_node`는
  기존 노드 그대로, FIRE_LINKS·battery 경로 미진입 → **추가 RNG 소비 0, legacy 지문 완전 동일**. 실측:
  전 36 config(legacy-snapshot) 비트 동일(`tests/fireunit.test.js` 되돌리기 어서션).
- **제약 상속**: legacyOf 상속 + `validateFireUnits` + 인스턴스 단위 행위검증(탄도탄 단독 강도3에서 SHORAD
  포대 도착 0건, fireUnitLayer ON).
- **커버리지 무공백**: `KJ.checkCoverageMatrix('asis'/'tobe')` 전 (축선×위협) 교전자 존재(집계 유지 FTR/SM2 +
  포대). 의도된 공백 allow 목록은 현재 비어 있음(실공백 0).
- **RNG 규율**: 신규 파이프라인 단계(ICC/ECS)는 `_nodeArrive`의 기존 그리기(서비스 지수 1회)만 소비 —
  스캔/발사당 그리기 수 규율 유지. 도착 스트림 불변.

## 결론 영향(수치) — OFF↔ON 짝비교 (seed 1, intensity 1)
| config | OFF 격추율 | ON 격추율 | tierHandoffs | reloads |
|---|---|---|---|---|
| sc1/asis | 78.0% | 64.6% | 1 | 0 |
| sc1/tobe | 80.8% | 84.0% | 0 | 3 |
| sc2/asis | 62.2% | 62.9% | 0 | 1 |
| sc2/tobe | 78.4% | 73.2% | 0 | 3 |
| sc3/asis | 30.7% | 21.2% | 0 | 2 |
| sc3/tobe | 54.9% | 38.6% | 0 | 3 |

→ **세분화는 격추율을 대체로 낮춘다**(교전 체인 지연 ICC→ECS→MFR + MFR 채널 동시교전 상한 + TEL 재고·재장전).
포화(SC3)에서 낙폭이 가장 크다(−9.6pp asis · −16.3pp tobe) — **병목이 C2에서 화력단위(MFR 채널·재고)로
이동**함을 정량화한다(§3-4 핵심 질문, docs/vv-report.md 표). SC3 tobe reloads=3·SC3 asis에서 MFR 채널 포화가
관측된다. 상세 leak taxonomy 이동표는 vv-report.

## 되돌리는 법
- 플래그: `features.fireUnitLayer=false`(기본) → 집계 노드 복원, legacy 지문 비트 동일. `KJ.PRESETS.highFidelity`로 ON.
- 검증: `node tests/fireunit.test.js`(되돌리기·제약상속·커버리지·재장전·결정론) · `node tests/run-all.js`(전 회귀 + params-audit).
- 커밋: (WP1 커밋 해시)

## 잔여 한계 (정직 기록)
- ICC·ECS 처리시간·MFR 채널 정수·재장전 시간은 **전부 등급 C(공개 정수 부재)** — 스윕으로만 해석(params.md
  C2-ICC/ECS-SVC-01·WPN-MFR-CH-01·WPN-TEL-01, scripts/step-fireunit-sweep.mjs). 탄도 요격 실현성이 ICC/ECS
  서비스시간에 민감(dwell 90s).
- 지리 미모델(축선 추상)이라 MFR `rangeKm`·섹터는 개념 필터로만 작용. 함정·FTR battery화 유보(선택지 3).
