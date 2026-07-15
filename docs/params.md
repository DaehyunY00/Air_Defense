# K-JAMDS 시뮬레이터 파라미터 근거자료 (Phase 1)

> **디스클레이머: 본 문서의 모든 수치·좌표·확률은 공개자료(오픈소스) 기반의 정책연구용 개념값이며, 실제 작전자료가 아님. 모든 좌표는 도시 수준 개념좌표임. KP-SAM(신궁)·천마(K-31)는 탄도탄 요격 불가로 모델링하며, KAMDOC↔THAAD 연동은 모델링하지 않음.**

## 파라미터 ID 체계
`도메인-객체-속성-일련번호` — 도메인: WPN(아군무기) / THR(위협) / C2(지휘통제) / SEN(센서) / ENV(환경)

## 신뢰도 등급
- **A**: 제조사 공식 스펙, 방위사업청/합참 등 1차 공식문서·보도자료
- **B**: 주요 언론·씽크탱크의 2차 보도, 학회 논문의 재인용
- **C**: 연구시제 기반 개념 추정, 유추, 미공개 항목에 대한 합리적 가정

---

## C2 (지휘통제)

> **[C2-VOICE-DLY-01] 폐기·분해됨 (feat/stage2-track-overhaul Phase 2).** 하나의 paramRef가 3개 값(음성 180s·KVMF 30s·데이터링크 2s)을 정당화하고, 링크 1홉 지연으로 오적용되던 문제를 아래 5개로 분해한다. 원 출처의 "3분 이상"은 **경로 총합(end-to-end)**임을 `C2-RESP-E2E-01`에서 명시한다.

### [C2-RESP-E2E-01] 작전반응시간 (탐지→대응, end-to-end) — 경로 총합 검증용
- **값/분포**: As-Is ≥180 s (원 출처 "3분 이상") → To-Be ~30 s. **링크 1홉 지연이 아니라 경로 총합 상한**으로만 사용.
- **단위**: 초 (경로 총합)
- **출처**: 쉘든의 밀리터리 "방공자동화체계"(2024.6)
- **인용문**: "작전 반응시간을 3분 이상에서 30초 수준으로 단축"
- **적용범위**: `tests/constraints.test.js` 경로 총합 검증(As-Is 대표경로 ∈ [180, 300]s · To-Be ≤ 30s)
- **신뢰도 등급**: B
- **MC 적용방식**: 검증 상한(고정)
- **재해석(중요)**: 원 출처의 "3분 이상"은 **탐지에서 대응까지의 작전반응시간(end-to-end)**이다. 현행 모델은 이를 **링크 1홉의 지연**으로 적용하여, As-Is 경로 합산 시 `보고 180 + 협조 180 + 교전명령 30 = 390초`로 **원 출처 총량의 2배 이상을 계상**하고 있었다(이중 계상). 본 개정은 이를 용도별 홉 지연으로 재배분하고, **경로 총합이 원 출처의 서술 범위(180~300초)에 들어오도록** 캘리브레이션한다.

### [C2-VOICE-RPT-01] 음성 항적보고 지연 (report)
- **값/분포**: 대표 60 s · **대칭 Triangular(min 30, mode 60, max 90)** (확정)
- **단위**: 초
- **출처**: 음성 항적보고(호출·확인·전달·복창)의 일방향 짧은 전달. 원 C2-VOICE-DLY-01의 음성값을 용도 분해.
- **적용범위**: `ADC2A-W→AOC-1C` (report, asis) — 음성 항적보고
- **신뢰도 등급**: C (용도 분해 후 개념 추정)
- **MC 적용방식**: 삼각분포 샘플링 (`_linkDelay`)
- **비고**: "단순 항적보고 음성"과 "교전협조 음성 협의"를 같은 180s로 두던 것을 분리 — 전자는 짧은 일방향 전달.

### [C2-VOICE-COORD-01] 음성 교전협조 지연 (coord)
- **값/분포**: 대표 180 s · **대칭 Triangular(min 90, mode 180, max 270)** (확정)
- **단위**: 초
- **출처**: 음성 교전협조(교전의사 선언·책임구역 확인·중복 회피 협상)의 왕복 협의. 2022.12.26 실증 병목.
- **적용범위**: `AOC-1C→MCRC`·`JAOC-CD→MCRC`·`MCRC→KAMDOC` (coord, asis)
- **신뢰도 등급**: C (용도 분해 후 개념 추정; 대표값은 원 출처 180s 계승)
- **MC 적용방식**: 삼각분포 샘플링 (`_linkDelay`)
- **비고**: 왕복 협의라 분산이 크다(대칭 min 90 ~ max 270, 평균=대표값 180). As-Is 이원화 C2의 핵심 병목 증거물. COORD<180이면 저부하 SC1에서 `AOC-1C→MCRC` 병목 신호가 소멸(inTransit<1)하므로 180 미만 금지(Phase 2 스윕 근거).

### [C2-DL-DLY-01] 통합 데이터링크 지연 (To-Be 개념)
- **값/분포**: 2 s (고정 개념)
- **단위**: 초
- **출처**: 통합 데이터링크 개념 추정치 — **원 출처에 명시 없음.** 종전 C2-VOICE-DLY-01과 paramRef를 공유하던 것을 분리해 정직하게 표기.
- **적용범위**: `js/data/links.js` DL_FAST (To-Be 전 연동 + 일부 As-Is 자동화 링크)
- **신뢰도 등급**: **C** (근거 없는 개념 추정)
- **MC 적용방식**: 고정

### [C2-KVMF-DLY-01] 육군 계열 데이터링크(KVMF) 지연
- **값/분포**: 30 s (고정 개념)
- **단위**: 초
- **출처**: 육군 체계 간 데이터링크(KVMF) — 종전 C2-VOICE-DLY-01의 "~30s(ADC2A/KVMF)" 값을 분리.
- **적용범위**: `LLR-1C/LLR-CD→AOC-1C/JAOC-CD`(report, asis) · `AOC-1C/JAOC-CD→SHORAD/MSAM`(command, asis) · `ADC2A-W→AOC-1C`(report, tobe)
- **신뢰도 등급**: C
- **MC 적용방식**: 고정

### [C2-L16-UPD-01] Link-16 항적 갱신주기
- **값/분포**: ≤12 s (고정)
- **단위**: 초
- **출처**: Link-16 기술자료(corvusintell, Tonex)
- **인용문**: "track update is broadcast in the assigned time slot, typically within 12 seconds of the report time"
- **적용범위**: E-737·이지스함 → MCRC/KAMDOC 항적 전파, C2→전투기/SM-2 교전명령
- **신뢰도 등급**: B
- **MC 적용방식**: 고정

### [C2-SAWS-DLY-01] SAWS 위성전군방공경보 전파 지연
- **값/분포**: ~60 s (개념)
- **단위**: 초
- **출처**: 쉘든의 밀리터리 "방공자동화체계"(2024.6) — SAWS 특성 서술 기반 유추
- **인용문**: "SAWS는 데이터링크 트랙정보와 달리 교전에 활용 가능한 실시간성을 반영하지 못한다"
- **적용범위**: As-Is MCRC → 군단 AOC/JAOC 일방향 경보방송
- **신뢰도 등급**: C
- **MC 적용방식**: 고정
- **비고**: 교전용 항적으로 사용 불가(일방향 방송) — 링크 kind='broadcast'로 구분

### [C2-MCRC-SVC-01] MCRC 항적 1건 처리시간
- **값/분포**: As-Is 30 s / To-Be 12 s, 서버(관제석) 4석 (개념)
- **단위**: 초
- **출처**: KAMD작전센터 성능개량 보도(항적처리시간·전송주기·체계전환시간 단축, 2023.4 인수) 기반 개념 설정
- **적용범위**: MCRC M/M/c 대기행렬 (c=4)
- **신뢰도 등급**: C
- **MC 적용방식**: 민감도스윕 대상 (±20%)

### [C2-KAMDOC-SVC-01] KAMDOC 탄도탄 항적 처리시간
- **값/분포**: As-Is 25 s / To-Be 10 s, 서버 3석 (개념)
- **단위**: 초
- **출처**: KTMO-Cell → KAMD작전센터 성능개량(2023.4) 공개보도 기반 개념 설정
- **적용범위**: KAMDOC M/M/c 대기행렬
- **신뢰도 등급**: C
- **MC 적용방식**: 민감도스윕 대상

### [C2-KAOC-SVC-01] KAOC 교전승인 결심 처리시간
- **값/분포**: As-Is 40 s / To-Be 15 s, 서버(결심라인) 3 (개념)
- **단위**: 초
- **출처**: UAM 조종사 task load M/M/1 모델링(AIAA SciTech 2025, 2025-2093) 준용 — 인간 결심권자의 동시 처리 한계를 서버 수로 표현
- **적용범위**: KAOC 승인 결심 부하
- **신뢰도 등급**: C
- **MC 적용방식**: 민감도스윕 대상

### [C2-AOC-SVC-01] 군단 방공상황실(AOC)·수방사 JAOC 처리시간
- **값/분포**: As-Is 40–45 s / To-Be 15 s, 서버 2 (개념)
- **단위**: 초
- **출처**: ADC2A 전력화 관련 공개자료(쉘든의 밀리터리, 2024.6) 기반 개념 설정
- **적용범위**: AOC-1C, JAOC-CD M/M/c 대기행렬
- **신뢰도 등급**: C
- **MC 적용방식**: 민감도스윕 대상

### [C2-JAMDC2-SVC-01] JAMDC2 (To-Be) 융합·무기배정 처리시간
- **값/분포**: 8 s, 서버 6 (개념). **대기실 용량 K=60은 본 항목이 아니라 `[ENV-DES-C2K-01]`에서 등급 C로 관리(공개근거 없음)**
- **단위**: 초
- **출처**: 합참 K-JAMDS 구축 개념안(국방신문 2025.8.24) "다중센서 융합→AI 기반 표적 식별·분류→무기 배정" — 자동화 수준 개념 설정
- **적용범위**: To-Be 모드 JAMDC2 노드
- **신뢰도 등급**: C
- **MC 적용방식**: 민감도스윕 대상
- **비고 (Phase 4 용량 감사, 실측 seed 1~10 평균)**:
  - 기본 스펙(c=6·8s·K=60)의 JAMDC2는 **어떤 시나리오·강도에서도 병목이 아니다**(SC3 x3.0에서도 ρ≈0.49). ρ≥0.9 병목이 되려면 서버를 2로 낮추거나(8s 기준) 서비스시간을 15s 이상으로 올려야 한다. **K는 전혀 구속하지 않는다**(K를 20으로 낮춰도 maxInSystem≈11, 드롭 0).
  - ⚠️ **취약점**: To-Be의 **누수율** 개선폭이 이 스펙에 상당히 민감하다. 허브를 As-Is 수준(c=3·25s)으로 낮추면 SC3 x2.5 누수율 47.9%→72.7%로 As-Is(73.0%)에 수렴, x3.0에서는 역전. 반면 **결심지연·격추율 개선은 스펙 무관하게 견고**(구조 효과). 상세·판단은 `docs/vv-report.md` §4-3.

### [C2-WTA-SUIT-01] Best-Shooter 적합도 개념 가중치 (정밀화 Phase B-1, `js/data/nodes.js` wtaSuit)
- **값/분포**: 무기별 × 위협 고도대역(low/medium/ballistic) 개념 가중 — FTR {0.7/1.2/0} · SHORAD {1.3/0.5/0} · MSAM-1C {0.8/1.1/0} · MDU-M {0.7/0.9/1.2} · MDU-L {0/0/1.3} · SM-2 {0.8/1.0/0}. WTA 점수 = wtaSuit[고도대역] × (0.25+0.75×잔여용량비). 동점은 노드 id 사전순(결정론)
- **출처**: 개념 설정 — 2022.12.26 소형표적 대응 저효율(전투기·헬기 격추 실패), 저고도 표적↔단거리방공 적합, 탄도탄↔MD 자산 적합의 상식적 서열화. K-JAMDS "Any Sensor, Best Shooter" 개념(합참 구축안)의 구현
- **적용범위**: DES `_doEngage` **To-Be 모드 전용** (As-Is는 COP 부재로 적합도 비교 불가 — 최소부하 선택 유지). canEngage 제약(신궁·천마 탄도탄 배제)이 어떤 경우에도 우선
- **신뢰도 등급**: C(개념 가중)
- **MC 적용방식**: 고정 (민감도스윕 후보)

### [C2-WTA-COST-01] 비용 인식 WTA 가중치 (자원최적화 Step 1, `js/engine/sim-engine.js`) — To-Be 전용
- **값/분포**: 탄도(ballistic) 위협에 한해 WTA 점수 `×= (1−W) + W·min(1, 위협가치/요격탄가)`. `COST_WTA_WEIGHT = W = 0.5`(스윕 채택, `features.costWtaWeight`로 재정의). `features.costAwareWta` 기본 ON. 저·중고도 위협엔 미적용(부작용 방지·문언 충실)
- **출처**: KJADS 원칙 5-1(대응수단 계층화·**탄도탄용 고가 유도탄 보존**) + 합참지 기고문 *"값싼 300mm 장사정포로 고가 KAMD 요격유도탄의 신속한 소모를 강요"* — To-Be Best-Shooter가 $1M 방사포탄을 $8M L-SAM으로 요격하던 anti-pattern 교정
- **적용범위**: DES `_doEngage` **To-Be 전용**(As-Is는 GAP 5로 비용 비교 불가). `canEngage → coverage → 교전창` 3중 필터 항상 선행. W=0/OFF → 현행 bit-clean 동일(RNG 미소비)
- **신뢰도 등급**: **B**(원칙 5-1 + 합참지 인용)
- **MC 적용방식**: W 민감도스윕 대상. 채택 W=0.5: SC3 고가유도탄 보존율 33.4→40.6%·격추율 44.3% 불변·MDU-L ρ0.936(死노드 아님)
- **비고**: 🔴 반증실험(ADR-007) — As-Is+비용WTA는 66.5% 보존(To-Be 40.6%보다 우수) → **자원 절약은 C2 통합이 아니라 비용 인식 로직의 효과**. "통합하면 절약된다"고 쓰면 안 됨

### [WPN-*-MAG-01] 무기별 유도탄 재고 (자원최적화 Step 2, `js/data/nodes.js` engage.magazine) — 기본 OFF
- **값/분포**: 시나리오 기간(1800s) 가용 요격탄 수(재장전 없음) — FTR 120·SHORAD 200/150·MSAM 48·MDU-M 48·MDU-L 24·SM2 32. `features.magazine` 기본 OFF(ON이면 재고 유한). `features.magazineSize`로 균일 override(스윕)
- **출처**: KJADS 원칙 5-2(잔여량·소진). **값 근거 없음 — 지어내지 않고 소진 경계를 스윕으로 발견**
- **적용범위**: `_doEngage`(ammo≤0 제외 → no_ammo) + `_onEngageEnd`(ammo 차감, As-Is·To-Be 공통). OFF → ammo=∞(현행)
- **신뢰도 등급**: **C**(재고값 근거 부재) → 기본 OFF, 민감도스윕 대상
- **MC 적용방식**: magazineSize 스윕. 발견: SC3 x2.5 균일 48발 미만서 소진 유의미(48→9.9%·24→27.3%·12→39.5% no_ammo). 노드기본(MDU-L 24) → MDU-L 첫소진 T+462s·격추율 44→35.7%(비대칭 소진전술 정량화)
- **비고**: 재장전 미모사(총량). no_ammo=비구조

### [C2-RESERVE-01] 고위협 대응 보존 최소수량 (자원최적화 Step 2, `engage.reserveFloor`) — To-Be 전용·기본 OFF
- **값/분포**: MDU-L `reserveFloor: { srbm: 6 }` — mrl_large 등 비(非)srbm 위협 교전 시 잔여가 6발 이하면 후보 제외(srbm용 보존). `features.reserveFloor` 기본 OFF(magazine 의존)
- **출처**: KJADS 원칙 5-2("고위협 대응 보존 최소 수량 설정")
- **적용범위**: `_doEngage` 후보 필터 **To-Be 전용** — GAP 5(잔여 실시간 미통합)로 As-Is는 보존 판단 불가(측정: As-Is 보존발동 0)
- **신뢰도 등급**: C(보존수량 근거 부재)
- **MC 적용방식**: 옵션. To-Be 보존발동 다수 발생·As-Is 0(비대칭). mrl_large 일부를 no_ammo로 돌려 srbm 재고 보존(doctrine 트레이드오프)
- **비고**: 이 As-Is/To-Be 비대칭이 원칙 5-2가 통합 C2 기능(개별 무기 아님)임을 보이는 정직한 증거(ADR-008)

### [C2-SCARCITY-RW-01] 임계 도달 시 동적 재가중 (자원최적화 Step 3, `js/engine/sim-engine.js`) — To-Be 전용·기본 OFF
- **값/분포**: 재고비율 < `SCARCITY_THRESH=0.3`이면 WTA 점수 `×= 0.3 + 0.7·(재고비율/0.3)`(연성 감쇠). `features.thresholdReweight` 기본 OFF(magazine 의존, To-Be 전용)
- **출처**: KJADS 원칙 5-2("임계 도달 시 자동 경보→상위 환수") 최소 구현. reserveFloor(경성)의 연속판
- **적용범위**: `_doEngage` WTA 점수 To-Be 전용. OFF 또는 magazine OFF(ammo=∞) → 무효(이중 게이트)
- **신뢰도 등급**: C(임계·감쇠계수 근거 부재)
- **MC 적용방식**: 옵션. 한계효용 소 — Step1+2 대비 격추율 +0.5pp·MDU-L 소진 ~160s 지연. reserveFloor가 이미 보존 대부분 수행 → 기본 OFF(ADR-009)
- **비고**: 원칙 4(IDD·ROE 자동화)의 초입 — 원칙 4는 미구현

### [C2-DELEG-THRESH-01] 부하 기반 중앙↔분권 동적 전환 임계 (정밀화 Phase B-2)
- **값/분포**: 승인권자 노드 관측 상태가 [전 결심서버 점유(busy≥c) AND 대기열 ≥ c×배수]일 때 해당 결심을 하위/자동으로 위임(분권 전환). 배수: **As-Is 4 / To-Be 1**
- **출처**: 개념 설정 — 임무형 지휘(권한위임) 원칙의 부하 트리거화. To-Be는 COP 공유·자동화로 조기 전환, As-Is는 수동 절차로 포화가 누적되어야 전환(느림/준부재)
- **적용범위**: DES `_decision`. 전환 시점·횟수·승인노드별 분포가 `global.delegation`으로 관측됨. **하드코딩된 병목이 아니라 부하의 함수** — 저강도에서는 어느 모드도 전환 0건(회귀 고정, tests/refine.test.js B-2)
- **신뢰도 등급**: C(개념 임계)
- **MC 적용방식**: 고정 (민감도스윕 후보)

### [C2-COORD-HORIZ-01] 수평 교전협조 링크 (Phase 2 ⑥⑦, `js/data/links.js`)
- **값/분포**: As-Is 신규 coord 링크 — `AOC-1C↔JAOC-CD`(양방향)·`MCRC→AOC-1C`·`MCRC→JAOC-CD`. As-Is=`VOICE_COORD`(대칭 삼각분포 min90/mode180/max270, 대표 180s), To-Be=`DL_FAST`(2s)
- **단위**: 초(링크 전달 지연)
- **출처**: 개념 설정 — KJADS 문제상황 1("각 군 개별 작전 → 음성 VTC에 의존, 신속 조율 불가")의 "협조 수단 부재"를 **링크 부재가 아니라 느린 음성 링크**로 표현. 종전엔 육↔육/상↔하 coord 링크가 아예 없어 `coordPath`가 호출조차 되지 않아 중복교전을 판정할 수 없었다. 지연값은 `[C2-VOICE-COORD-01]` 승계(등급 C)
- **적용범위**: DES `_coordCheck`(중복항적 계통 간 교전협조)·`coordPath`(다익스트라 최소지연). To-Be는 JAMDC2 COP 공유로 2s
- **신뢰도 등급**: C(개념 — 음성 협조 지연은 `[C2-VOICE-COORD-01]` 근거 승계)
- **MC 적용방식**: 분포샘플링(전달 시각) / 대표값(경로 선택·협조 성립 판정)

### [C2-RESPGAP-01] 책임공백(responsibility_gap) 발화 조건 (Phase 2 ⑥⑦, `js/engine/sim-engine.js` `_coordCheck`)
- **값/분포**: 동일 항적이 2개 이상 통제계통에 팬아웃(As-Is)되고, 그 계통이 교전 가능 무기를 통제할 때 — **계통 간 coord 협조 경로가 없거나, 협조 지연(대표값 총합) ≥ 잔여 체공창(spawnT+dwellSec−t)**이면 책임공백 → 두 계통이 각각 교전(중복교전). 잔여 체공창 내 협조 가능하면 주교전자 1개 지정(중복 회피)
- **출처**: 개념 설정 — KJADS 문제상황 1(교전 중복·책임 공백). 종전 `responsibility_gap`은 `coordPath(controlC2,approvalId)===null`(승인 경로 부재)에서만 발화하도록 되어 있었으나 coord 그래프가 상향 연결되어 **전 시나리오·전 모드·전 seed 0건(死 코드)**이었다. 본 항목으로 재정의해 부활시킨다
- **적용범위**: DES `_coordCheck`. 발화 시 `global.coordination.gaps`·`duplicateEngagements` 증가, 요격탄 이중 소모(`cost.duplicateInterceptM`), 해당 항적이 결국 누수하면 leakReason이 responsibility_gap으로 승격. **실측: As-Is SC1 x2.5 196건·SC3 x2.5 560건, To-Be 0건**(팬아웃 없음). SC2(무인기 dwell 900s)는 음성 180s로도 협조 성립해 0건 — 느린 위협은 책임공백이 안 생긴다
- **신뢰도 등급**: C(개념 — 임계=잔여 체공창은 물리적 근거, 협조 지연은 `[C2-COORD-HORIZ-01]` 승계)
- **MC 적용방식**: 고정(판정은 대표값). 정적 히트맵(`computeOverlapHeat`, 0.5×dwell 임계)과 **나란히 유지** — 정적 예측 vs 동적 발생의 상호 검증용(삭제 금지)

### [C2-AUTO-LEVEL-01] 위협별 자동화 차등 (정밀화 Phase B-3, `js/data/threats.js` automation)
- **값/분포**: human-in-loop(승인권자까지 협조경로+승인 처리) / human-on-loop(감독하 자동교전 — 승인 처리만, 협조 홉 생략) / auto-preauth(사전승인 자동교전 — 결심 홉 생략). As-Is 전 위협 in-loop; To-Be 무인기·순항(주1)·탄도탄 auto-preauth 또는 on-loop, 유인기 위협 on-loop
- **출처**: 합참 K-JAMDS 구축 개념안(AI 기반 표적 식별·무기 배정)·무인기 사전승인 자동교전 개념 — 기존 threats.js note 텍스트의 엔진 플래그 승격
- **적용범위**: DES `_decision` (구 approval=null 우회의 일반화). 주1: cruise는 on-loop이나 To-Be approvalLevel=null이라 홉 없는 감독 자동교전으로 동작
- **신뢰도 등급**: C(개념 구분)
- **MC 적용방식**: 고정
- **비고 (자기 승인 — ⑥⑦ 병목의 실제 대상, Phase 3 감사)**: `_decision`은 **담당 C2와 승인권자(`approvalLevel[mode]`)가 동일하면 승인 홉을 생략**한다(`approvalId === controlC2`). As-Is에서 **순항미사일(담당 MCRC=승인 MCRC)·탄도탄(담당 KAMDOC=승인 KAMDOC)은 자기 계통 내 자기 승인**이라 육↔공 이원화 병목을 겪지 않는다. 실측(SC3 x1.5 As-Is): 전체 결심의 **약 49%가 승인 홉 생략**(순항·탄도탄 자기승인). **의도된 모델링** — 이원화 마찰은 육군↔공군(및 최상위 KAOC 승인) 사이에서 발생하며, 공군 방공(MCRC)·대탄도탄(KAMDOC) 계통은 각자 담당 위협을 자기 계통 안에서 승인한다. 따라서 ⑥⑦ "핵심 병목"은 **육↔공 경유 위협(무인기·저속기·헬기·전투기)에 한정**해 정확하다(상세: `docs/분석가_가이드.md`). **approvalLevel 데이터는 이 감사에서 변경하지 않았다.**

### [C2-VULCAN-CEIL-01] 대공포(벌컨) 유효고도 한계 vs 무인기 비행고도
- **값/분포**: 벌컨 최대사거리 지상 2 km / 소형 무인기 비행 3 km (고정)
- **단위**: km
- **출처**: 위키백과 2022 무인기 침범 사건
- **인용문**: "벌컨포의 최대 사거리가 지상 2km인데 무인기는 3km 상공을 비행했다"
- **적용범위**: 저고도 대공화기 교전 가능여부 판정 (Phase 2 DES에서 고도 판정 도입)
- **신뢰도 등급**: B
- **MC 적용방식**: 고정(교전가능 임계)

---

## SEN (센서)

### [SEN-E737-PD-01] E-737 피스아이 광역 탐지 성능
- **값/분포**: 탐지거리 370+ km급(MESA 레이더), 소형 무인기에 대해서는 제한적 (개념). **탐지확률 Pd ≈ 0.85/스캔** (항공표적 대상 개념 추정 — 후보값, STEP 5 확정 대상)
- **단위**: km, 확률(per 스캔)
- **출처**: 보잉 E-7/MESA 레이더 공개 스펙(2차 보도); 공군 E-737 4대 운용 공개자료. Pd 숫자는 근거 없는 개념 추정.
- **적용범위**: E737 노드 detects/coverage (전 축선). detects에 uav_small 미포함 → 저RCS 소형 무인기 문제는 커버리지에서 자동 회피.
- **신뢰도 등급**: B(탐지거리) / **C(Pd — 개념 추정)**
- **MC 적용방식**: Pd 고정값 배선(현재) · 후보 스윕(STEP 5)

### [SEN-GPR-PD-01] 탄도탄 감시레이더(그린파인) 탐지 성능
- **값/분포**: 탐지거리 약 800 km (블록-B급, 고정 개념값). **탐지확률 Pd ≈ 0.95/스캔** (탄도탄 예측가능 궤적 대상 개념 추정 — 후보값, STEP 5 확정 대상)
- **단위**: km, 확률(per 스캔)
- **출처**: 그린파인(EL/M-2080) 도입 관련 국내 언론 보도(2차). Pd 숫자는 근거 없는 개념 추정.
- **적용범위**: GPR 노드 — 탄도탄(srbm/mrl_large) 전용 탐지
- **신뢰도 등급**: B(탐지거리) / **C(Pd — 개념 추정)**
- **MC 적용방식**: Pd 고정값 배선(현재) · 후보 스윕(STEP 5)

### [SEN-SPY1-PD-01] 이지스함 SPY-1D(V) 레이더 탐지 성능
- **값/분포**: 탐지거리 약 1,000 km급(탄도탄 표적, 개념). **탐지확률 Pd ≈ 0.85/스캔** (탄도탄·항공 표적 대상 개념 추정 — 후보값, STEP 5 확정 대상)
- **단위**: km, 확률(per 스캔)
- **출처**: 세종대왕급 이지스함 SPY-1D(V) 관련 국내 언론 보도(2차). Pd 숫자는 근거 없는 개념 추정.
- **적용범위**: AEGIS-E/W 노드 — 탄도탄·항공 항적 탐지, Link-16 전파
- **신뢰도 등급**: B(탐지거리) / **C(Pd — 개념 추정)**
- **MC 적용방식**: Pd 고정값 배선(현재) · 후보 스윕(STEP 5)

### [SEN-ACR-PD-01] 방공관제레이더 탐지확률 (중·고고도 일반 표적)
- **값/분포**: 0.9 per 스캔 (개념)
- **출처**: 개념 설정 (일반 항공표적 대비 고신뢰 탐지 가정)
- **적용범위**: ACR-E/W — 전투기·저속기·순항미사일·헬기
- **신뢰도 등급**: C
- **MC 적용방식**: Phase 3 분포샘플링

### [SEN-LAR-PD-01] 저고도 탐지레이더 탐지확률
- **값/분포**: 저고도 소형표적 Triangular(0.3, 0.5, 0.7) (개념)
- **출처**: 소형 무인기 탐지거리 10km(RPS-42 대형표적 30km 대비) 보도 기반 유추
- **적용범위**: LAR-C — 저고도 침투 위협
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링

### [SEN-JASP-PD-01] 합동대공감시소 육안관측 탐지확률
- **값/분포**: 주간 0.5 / 야간 0.2 (개념) → **주야 혼합 단일 개념값 0.35/스캔으로 배선**(ADC2A-W)
- **출처**: 개념 설정 (육안·광학 관측 한계)
- **적용범위**: ADC2A-W(구 합동대공감시소) — 저고도 위협 음성보고
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링
- **비고**: 주간/야간 구분은 이번 범위 밖 — 단일 혼합값(0.35)으로 처리(별도 이슈, docs/vv-report.md 잔여 한계 참조).

### [SEN-LLR-PD-01] 국지방공레이더(TPS-880K급) 탐지확률
- **값/분포**: 0.6/스캔 (개념 추정 — 후보값, STEP 5 확정 대상, 스윕 0.4/0.6/0.8)
- **단위**: 확률(per 스캔)
- **출처**: 2022.12.26 무인기 침투 시 LLR-1C가 **최초 포착**(탐지 자체는 성립)한 보도 기반 유추. TPS-880K급 국지방공레이더 개념. 근거 있는 정밀 Pd 아님.
- **적용범위**: LLR-1C·LLR-CD 노드 — 저고도 소형표적(uav_small·ac_low·heli) per-스캔 탐지확률
- **신뢰도 등급**: C (개념 추정)
- **MC 적용방식**: Pd 고정값 배선(현재) · 후보 스윕(STEP 5)
- **비고**: 종전 두 노드의 detectProb.paramRef가 THR-UAV-RCS-01(THR 도메인)으로 **오지정**되어 있던 것을 본 SEN 항목으로 교정(STEP 2). 2022.12.26 실증에서 무인기는 탐지는 되었으나 격추 실패 — As-Is 무인기 탐지율이 지나치게 낮으면 실증과 어긋나므로 캘리브레이션 하한 근거.

### [SEN-FUSION-01] 모드별 다센서 탐지 융합 규칙
- **값/분포**: per-sensor pᵢ = clamp(센서Pd × 위협 detectFactor × 민감도배수, 0, 1);
  **As-Is(비융합)** p = maxᵢ(pᵢ) · **To-Be(융합)** p = 1 − Πᵢ(1 − pᵢ)
- **출처**: 독립 센서 가정 하 병렬 결합(표준 확률 모델). "Any Sensor, Best Shooter" 개념 — 합참지 제104호 K-JAMDS 기고문 / KJADS 구축안 원칙 3-1
- **적용범위**: `js/engine/sim-engine.js` `_scanProb` — ① 탐지 단계 스캔 1회당 탐지확률
- **신뢰도 등급**: **C** — 센서 간 독립성은 강한 가정임
- **MC 적용방식**: 모드 스위치(구조적) · per-sensor Pd는 각 SEN 항목의 분포/고정 규칙을 따름
- **비고(중요)**:
  1. **센서 독립성 가정**: 실제로는 동일 기상·동일 저RCS 조건에서 센서 탐지 실패가 상관됨 → **To-Be 융합 효과가 과대추정될 수 있음.**
  2. **N-포화 상한**: 현행 스캔 재시도 구조(SCAN=10s, 상한 dwellSec)에서 시행횟수 N=dwell/10이 커, 체공 위협의 누적 탐지는 As-Is·To-Be 모두 ~1.0으로 포화됨. 따라서 본 규칙이 만드는 **누적 탐지율 격차는 상한이 눌리고**, 격차는 주로 탐지 *시점*(_detectT)과 종료 절단(censoring) 꼬리에서 관측된다. 항적 연속성(track continuity)은 미모사(옵션 C 과제).

---

## WPN (아군 무기체계)

### [WPN-LSAM-ALT-01] L-SAM 대탄도탄 요격고도
- **값/분포**: 40–70 km, Triangular(40, 55, 70)
- **단위**: km
- **출처**: 방위사업청 공식 블로그(2023.8.18, 국방뉴스 인용); 나무위키 L-SAM 항목
- **인용문**: "대탄도탄 유도탄의 탐지거리는 310km, 요격 가능 표적 속도 마하 8.8, 요격고도는 40km~70km, 사거리는 150km~300km 이상"(2011–2014 '장거리 다기능레이더 처리장치 연구시제' 기반)
- **적용범위**: MDU-L 상층 탄도탄 요격
- **신뢰도 등급**: B
- **MC 적용방식**: 분포샘플링
- **비고**: 상세제원 미공개. 체계개발 완료 후 한화에어로스페이스 양산계약 7,054억원(2025.11.28). 개념값으로만 사용

### [WPN-LSAM-PK-01] L-SAM 단발 요격확률 (개념)
- **값/분포**: Triangular(0.6, 0.75, 0.9)
- **출처**: 개념 설정 (공개 요격시험 성공 보도 기반 유추)
- **적용범위**: MDU-L 교전 판정
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링
- **비고(Phase 1 ⑨ 배선)**: 이 값은 종전 코드(`_pk`)가 **읽지 않았다** — shooter 인자가 항상-참 조건에만 쓰여 무기를 바꿔도 pk가 안 바뀌었다(사실 b). Phase 1에서 `engage.pk`로 실제 배선(`features.pkByShooter`, 기본 ON). 종전 "적용범위"는 의도였을 뿐 미적용 상태였음을 기록한다.

### [WPN-MSAM2-ALT-01] 천궁-II 요격고도
- **값/분포**: 약 15–20 km (고정)
- **단위**: km
- **출처**: 위키백과 천궁 항목
- **인용문**: "약 20 km(66,000 ft)의 중고도에서 접근하는 탄도 미사일을 요격"
- **적용범위**: MDU-M 하층 요격
- **신뢰도 등급**: B
- **MC 적용방식**: 고정

### [WPN-MSAM2-PK-01] 천궁-II·PAC-3 단발 요격확률 (개념)
- **값/분포**: Triangular(0.6, 0.8, 0.9)
- **출처**: 개념 설정
- **적용범위**: MDU-M, MSAM-1C 교전 판정
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링
- **비고(Phase 1 ⑨ 배선)**: 이 값은 종전 코드(`_pk`)가 **읽지 않았다** — shooter 인자가 항상-참 조건에만 쓰여 무기를 바꿔도 pk가 안 바뀌었다(사실 b). Phase 1에서 `engage.pk`로 실제 배선(`features.pkByShooter`, 기본 ON). 종전 "적용범위"는 의도였을 뿐 미적용 상태였음을 기록한다.

### [WPN-SM2-RNG-01] SM-2 함대공 요격 성능
- **값/분포**: 사거리 약 150 km급 (Block IIIB 개념), 탄도탄 요격 불가로 모델링
- **단위**: km
- **출처**: SM-2 Block IIIB 공개 스펙(2차 보도)
- **적용범위**: SM2-E/W — 항공기·순항미사일 대응 전용
- **신뢰도 등급**: B(사거리) / A(대탄도탄 미적용 — 국내 도입형 기준 공개사실)
- **MC 적용방식**: 고정
- **비고**: SM-3/SM-6급 BMD 능력은 모델링하지 않음

### [WPN-SM2-PK-01] SM-2 단발 요격확률 (개념)
- **값/분포**: Triangular(0.6, 0.75, 0.85)
- **출처**: 개념 설정
- **적용범위**: SM2-E/W 교전 판정
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링
- **비고(Phase 1 ⑨ 배선)**: 이 값은 종전 코드(`_pk`)가 **읽지 않았다** — shooter 인자가 항상-참 조건에만 쓰여 무기를 바꿔도 pk가 안 바뀌었다(사실 b). Phase 1에서 `engage.pk`로 실제 배선(`features.pkByShooter`, 기본 ON). 종전 "적용범위"는 의도였을 뿐 미적용 상태였음을 기록한다.

### [WPN-SHIN-CON-01] 신궁(KP-SAM)·천마(K-31) 요격대상 제약
- **값/분포**: 탄도탄 요격 불가(부울=false)
- **출처**: 한국형 미사일 방어 공개자료
- **적용범위**: SHORAD-1C, SHORAD-CD — 저고도 항공기/무인기/헬기 대상만
- **신뢰도 등급**: A
- **MC 적용방식**: 고정(제약조건) — `js/core/constraints.js` 어서션 A로 상시 검증
- **비고**: 천마(K-31)와 함께 탄도탄 요격 대상에서 반드시 제외

### [WPN-SHORAD-PK-01] 단거리방공무기 소형표적 요격확률 (개념)
- **값/분포**: 소형 무인기 대상 Triangular(0.1, 0.3, 0.5) — 2022.12.26 격추 실패 반영
- **출처**: 2022.12.26 사건 보도(헬기·전투기 약 20대 투입 격추 실패)
- **적용범위**: SHORAD-1C/CD 교전 판정
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링
- **비고(Phase 1 ⑨ 배선)**: 이 값은 종전 코드(`_pk`)가 **읽지 않았다** — shooter 인자가 항상-참 조건에만 쓰여 무기를 바꿔도 pk가 안 바뀌었다(사실 b). Phase 1에서 `engage.pk`로 실제 배선(`features.pkByShooter`, 기본 ON). 종전 "적용범위"는 의도였을 뿐 미적용 상태였음을 기록한다.

### [WPN-FTR-PK-01] 전투기 공중 요격확률 (개념)
- **값/분포**: 일반 항공표적 0.8 / 소형 무인기 Triangular(0.1, 0.25, 0.4)
- **출처**: 2022.12.26 사건(AH-1 20mm 사격 실패, KA-1 추락) 기반 소형표적 저효율 반영
- **적용범위**: FTR 교전 판정
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링
- **비고(Phase 1 ⑨ 배선)**: 이 값은 종전 코드(`_pk`)가 **읽지 않았다** — shooter 인자가 항상-참 조건에만 쓰여 무기를 바꿔도 pk가 안 바뀌었다(사실 b). Phase 1에서 `engage.pk`로 실제 배선(`features.pkByShooter`, 기본 ON). 종전 "적용범위"는 의도였을 뿐 미적용 상태였음을 기록한다.

### [WPN-*-ENGT-01] 무기별 교전 소요시간 (교전채널 점유시간, `js/data/nodes.js` engage.engageTimeSec)
- **값/분포**: FTR 300 · SHORAD 60 · MSAM-1C 90 · MDU-M 45 · MDU-L 40 · SM2 50 (초, M/M/c 서비스시간 평균). 교전채널이 다음 표적을 받기까지 묶이는 시간
- **출처**: **개념 설정 — 최초 스캐폴딩(커밋 5bd6d9a)에 근거 없이 도입됨(등급 C).** 종전 paramRef 부재를 본 항목으로 명시화
- **적용범위**: DES `_startService`(교전채널 지수분포 평균) + Phase 1 교전창 필터(명령링크지연+engageTimeSec ≤ 잔여 체공창)
- **신뢰도 등급**: C
- **MC 적용방식**: 민감도스윕 대상
- **⚠️ 비고 (FTR 300초 단위 모호성 — Phase 1C 감사)**: FTR 300초는 다른 무기(45~90초)의 **5~7배**이고, **채널 점유시간이 아니라 스크램블→요격 소요시간(항공기 출격 리드타임 포함)으로 보인다** — `[C2-VOICE-RPT-01]` 비고가 지적한 "end-to-end 값을 링크 1홉에 전용"한 것과 **동일 유형의 단위 오류** 가능성. **값은 이 감사에서 변경하지 않았다(판단 보류).** 대신 Phase 1 교전창 필터가 이 모호성을 방어한다: FTR lead(300+12=312s) > fighter 체공창(180s)이라 FTR은 fighter 후보에서 자동 제외되고 MSAM/SM2가 대체하므로, **engageTimeSec ∈ {60,120,180,300} 스윕에서 전체 격추율이 43~45%로 평탄**(FTR 도착만 54→15로 변함). 즉 300초가 옳든 그르든 outcome은 견고하다

### [WPN-*-COV-01] 무기별 담당 축선 (Phase 2 ⑧, `js/data/nodes.js` coverage)
- **값/분포**: FTR `west·central·east·seoul`(전 축선) · SHORAD-1C `west·seoul` · SHORAD-CD `seoul` · MSAM-1C `west·seoul·central` · MDU-M `west·central·seoul` · MDU-L `west·central·east·seoul`(전 축선) · SM2-E `east·central` · SM2-W `west·seoul`
- **출처**: 개념 설정 — **`rangeKm`을 1차 근거로**, 노드 이름·배치 좌표·담당 센서 커버리지와 정합. 사거리 7km 점방어 무기(SHORAD)는 인접 1~2축선, 150km 이상 광역(SM2·MDU-L·FTR)은 넓게. SM2-E/W는 각각 AEGIS-E/W 센서 커버리지 승계. **임의 배치가 아니라 데이터 기반**(등급 C — 좌표·사거리는 개념값)
- **적용범위**: DES `_doEngage` 후보 필터(coverage가 위협 axis 미포함이면 제외). 센서와 동일 스키마. coverage 미지정 노드는 전축선 폴백(현재 전 무기 지정됨). **canEngage 제약과 독립**(canEngage는 능력, coverage는 지리)
- **신뢰도 등급**: C
- **MC 적용방식**: 고정
- **비고 (방공 공백/취약 지도 — Phase 2 실측)**: 이 coverage로 시나리오 (위협@축선) 조합을 검사하면 **절대 공백(no_shooter)은 없다**(FTR이 기동 전축선 공중 backstop, MDU-L이 전축선 탄도탄 backstop). 단 **단일무기 취약** 2건: `mrl_large@east → MDU-L 단독`(병목 이동 신호와 일치, MDU-L ρ≈0.93), `uav_small@central → FTR 단독`(중부축엔 무인기용 단거리 방공 부재 → 전투기 스크램블뿐, 실제적 정책 취약점). 축선 필터 도입으로 FTR이 중부축 저가위협 backstop이 되며 **FTR이 새 병목으로 출현**(스냅샷 node:FTR)

### [WPN-*-CHAN-01] 무기별 교전채널 수 (`js/data/nodes.js` engage.channels)
- **값/분포**: FTR 4 · SHORAD-1C 6 · SHORAD-CD 4 · MSAM-1C 2 · MDU-M 4 · MDU-L 3 · SM2 2 (동시 교전 가능 표적 수 = M/M/c의 c). 대기실 K = c×2 (`[ENV-DES-SHOOTERK-01]`)
- **출처**: 개념 설정 — 무기별 발사대·유도채널 규모의 상식적 서열화(종전 paramRef 부재를 명시화, 등급 C)
- **적용범위**: DES 교전 노드 M/M/c/K 서버 수
- **신뢰도 등급**: C
- **MC 적용방식**: 고정 (민감도스윕 후보)

### [WPN-*-COST-01] 요격탄 1발 개념 단가 (정밀화 Phase D, `js/data/nodes.js` engage.costPerShotM)

비용교환비(MoFE) 계산 전용 개념 단가(백만 USD). **대부분 타 전역(미국 등) 공개수치의
유추이므로 한반도 획득단가로 보정이 필요**(Caveat). DES 교전 판정·병목 도출에는 사용되지 않음.

| ID | 무기 | 1발 개념 단가(M USD) | 근거 성격 | 신뢰도 |
|---|---|---|---|---|
| WPN-FTR-COST-01 | 전투기(공대공 미사일 1발 개념) | 0.5 | 중거리 공대공 미사일급 공개 단가 유추 | C |
| WPN-SHORAD-COST-01 | 신궁(휴대용 SAM급) | 0.2 | 휴대용 지대공유도탄급 공개 단가 유추 | C |
| WPN-MSAM-COST-01 | 천궁 계열 | 1.5 | 중거리 지대공유도탄 공개 보도 유추 | C |
| WPN-MDUM-COST-01 | 천궁-II·PAC-3급 | 3 | PAC-3/천궁-II 단가 보도(수십억 원대) 유추 | C |
| WPN-LSAM-COST-01 | L-SAM | 8 | 상층 요격탄급 공개 단가(THAAD류) 유추 | C |
| WPN-SM2-COST-01 | SM-2 | 2.1 | SM-2 계열 공개 단가(약 $2.1M) | B |

### [THR-*-COST-01] 위협 1기 개념 단가 (정밀화 Phase D, `js/data/threats.js` unitCostM)

| ID | 위협 | 개념 단가(M USD) | 근거 성격 | 신뢰도 |
|---|---|---|---|---|
| THR-UAV-COST-01 | 소형 무인기 | 0.01 | 상용급 소형 무인기 단가(수천~수만 달러) 개념 | C |
| THR-AN2-COST-01 | AN-2급 | 0.3 | 구형 기체 잔존가치 개념 | C |
| THR-HELI-COST-01 | 헬기 | 3 | 중형 군용헬기 공개 단가 유추 | C |
| THR-FTR-COST-01 | 전투기 | 25 | 4세대급 전투기 공개 단가 유추 | C |
| THR-CM-COST-01 | 순항미사일 | 1.5 | 순항미사일급 공개 단가 유추 | C |
| THR-KN23-COST-01 | KN-23급 SRBM | 3 | 이스칸데르급 단가 추정 보도 유추 | C |
| THR-KN25-COST-01 | KN-25급 방사포탄 | 1 | 유도 방사포탄 개념 단가 | C |

### [ENV-COST-EXCH-01] 비용교환비(MoFE) 정의
- **값/분포**: exchange = 소모 요격탄 개념비용 합 ÷ 격추 위협가치 합 (교전 시도 1회 = 1발 소모 개념). exchangeSat는 저가 포화위협(uav_small·mrl_large) 부분집합. 격추 0이면 null(0나눗셈 없음)
- **출처**: 방공 비용교환(cost-exchange) 논의 공개 문헌(저가 드론·방사포 대응의 비대칭 비용 문제) — 개념 정식화
- **적용범위**: DES `_onEngageEnd` 집계 → `global.cost`. 결과창 비교 블록(MoFE 행)
- **신뢰도 등급**: C(개념 정의; 단가는 WPN/THR-*-COST-01)
- **MC 적용방식**: 고정 단가(민감도스윕 후보)
- **비고**: Caveat — 단가가 타 전역 공개수치 기반이므로 절대값보다 As-Is↔To-Be 상대비교에 사용
- **⚠️ 함정·보완(Phase 2 ⑨)**: 분모에 **격추분만** 들어가 누수(패배)가 계상되지 않는다 → **아무것도 안 쏘면 exchange=0으로 "최적"**. As-Is가 C2에서 항적을 잃어 못 쏜 것이 "비용 우수"로 표시되는 역설. **보완 지표 `defenseEfficiency = 격추 위협가치 / (격추 + 누수 위협가치)` 신설**(ADR-002, `features.leakCost`, 기본 ON, 새 파라미터 0개 — 기존 unitCostM 재사용). exchange는 회귀 안전(`refine.test.js` 의존)을 위해 **그대로 유지**하고, 함정은 tip·본 비고로 명시. 실측(SC3 x2.5): defenseEfficiency As-Is 16% · To-Be 66% — exchange가 못 하던 "실제 방어 성과 보상"을 수행

### [ENV-MOM-COBP-01] 지표 계층(MoM) 라벨링
- **값/분포**: MoP(과정 성능: 결심 지연·평균 격추시간·통신지연 부하) / MoCE(C2 효과성: 중복교전 위험·구조적 실패·도출 병목 수) / MoFE(전력 효과성: 누출률·격추율·비용교환비)
- **출처**: NATO Code of Best Practice for C2 Assessment(COBP, SAS-026) — MoP/MoCE/MoFE 계층
- **적용범위**: 결과창 As-Is↔To-Be 비교 블록의 지표 태그·툴팁 (js/ui/sim-view.js)
- **신뢰도 등급**: B(방법론 계층) / C(개별 지표의 계층 배정)
- **MC 적용방식**: 라벨(계산 무관)

---

## Fire-Unit Layer — 요격체계 세분화 (WP1, `js/data/fire-units.js`, ADR-010)

> 집계 shooter(MDU-L·MDU-M·MSAM-1C·SHORAD-1C·SHORAD-CD)를 ICC(대대급 사격지휘)→포대(ECS+MFR+TEL[])
> 계층으로 대체한다(`features.fireUnitLayer` 기본 OFF). 능력·pk·비용·적합도·제약(canEngage)은 legacyOf에서
> 상속하므로 신궁·천마 탄도탄 불가가 전 포대 인스턴스에 자동 상속된다. 조사·출처는 `docs/laydown-sources.md`.
> **전 신규 파라미터 등급 C(공개 정수 부재) → 스윕 필수.** 좌표는 도시 수준 개념좌표만.

### [C2-ICC-SVC-01] ICC(대대급 사격지휘소) 처리시간
- **값/분포**: ICC-LSAM/MDUM(MD 대대) As-Is 8 / To-Be 4 s · 육군 ICC(MSAM/SHORAD) As-Is 20–22 / To-Be 10 s, 서버 2 (개념). MD 대대는 탄도 체공창(90s)이 좁아 준자동(짧은 서비스)
- **단위**: 초 (M/M/c 서비스시간 평균)
- **출처**: 개념 설정 — 유사 체계(패트리엇류) 대대 사격지휘 절차 유추. **공개 처리시간 근거 없음.** laydown-sources.md §1.5 "재장전·ECS 처리·운용 절차 소요=등급 C" 규율
- **적용범위**: DES `_onIccArrive`(kind 'fire-direction'). fireUnitLayer ON일 때만
- **신뢰도 등급**: **C**(공개근거 부재)
- **MC 적용방식**: 민감도 **스윕 대상**(scripts/step-fireunit-sweep.mjs). 탄도 요격 실현성이 이 값에 민감(ballistic dwell 90s 대비)

### [C2-ECS-SVC-01] ECS(포대 사격통제 콘솔) 처리시간
- **값/분포**: MD 포대 As-Is 6 / To-Be 3 s · SHORAD 포대 As-Is 8 / To-Be 4 s, 서버(콘솔) 2, 대기실 8–10 (개념)
- **단위**: 초 (M/M/c 서비스시간 평균)
- **출처**: 개념 설정 — 유사 체계 교전통제 콘솔 처리 유추. **공개 근거 없음.** laydown-sources.md §1.5 규율(등급 C 필수 스윕)
- **적용범위**: DES `_onEcsArrive`(kind 'ecs', nodeState `<포대>::ecs`). fireUnitLayer ON
- **신뢰도 등급**: **C**
- **MC 적용방식**: 민감도 **스윕 대상**. MFR 채널이 실질 제약이라 ECS는 통상 비병목(스윕으로 확인)

### [WPN-MFR-CH-01] MFR(교전통제레이더) 동시 추적·조사 채널
- **값/분포**: L-SAM 3 · 천궁-II/PAC-3 4 · 군단천궁 2 · SHORAD 4 (동시교전 상한=M/M/c의 c). 조사 점유시간(illumTimeSec) L-SAM 40 · MD 45 · 군단천궁 90 · SHORAD 60 s. 섹터모드 L-SAM='ballistic-sector'(탄도 지향), 그 외 '360'
- **단위**: 채널 수, 초
- **출처**: 공개 표현은 정성적("다표적 동시 요격")뿐 — **정확 채널 정수 비공개**(laydown-sources.md §1: L-SAM 채널 GAP, 천궁-II "6 동시교전" 단일출처 C). 방산 전시·보도 표현의 하한 채택
- **적용범위**: DES 포대 MFR 서버풀(_initBattery). 실질 동시교전 상한 — 포화 시 ECS 대기·overflow
- **신뢰도 등급**: **C**(채널 정수 비공개)
- **MC 적용방식**: 민감도 **스윕 대상** {2,3,4,6}(scripts/step-fireunit-sweep.mjs). "병목이 C2→MFR 채널로 이동"의 핵심 인자

### [SEN-MFR-PD-01] MFR 자체 탐지확률 (WP2 자체교전용)
- **값/분포**: L-SAM 0.9 · MD 0.85 · 군단천궁 0.8 · SHORAD 0.55 per 스캔 (개념). 위협 detectFactor와 곱해 per-scan 자체획득 확률
- **단위**: 확률(per 스캔)
- **출처**: 개념 설정 — 각 체계 교전통제레이더의 표적획득 성능을 SEN-*-PD 계열(관제레이더 0.9·국지레이더 0.6)과 정합 서열화. **정밀 Pd 공개근거 없음**
- **적용범위**: DES `_onSelfDefScan`(WP2 자체교전 트리거). fireUnitLayer+selfDefense 조합 시
- **신뢰도 등급**: **C**
- **MC 적용방식**: 고정 배선 · 후보 **스윕 대상**(SEN-*-PD 계열 동일 규율)

### [WPN-TEL-01] 발사대(TEL) 장전 발수·재장전
- **값/분포**: 발사대당 장전 발수(readyRoundsPerTel) L-SAM 6 · 천궁계열 8 · 재장전 reloadSec MD 1500–1800 · SHORAD 900 s. 포대 총 재고 magazine = Σ(발사대 수 × readyRoundsPerTel) — legacyOf magazine 상한 이하(이중계상 금지)
- **단위**: 발, 초
- **출처**: 발사대당 발수 — L-SAM 6발/발사대·천궁-II 8발/발사대(공개 제원, laydown-sources.md §1, 등급 B). **재장전 시간은 공개근거 없음(등급 C)** — 유사 체계 유추
- **적용범위**: DES `_telFire`/`_onReloadDone`(TEL 소진→reloadSec 후 복구). fireUnitLayer ON. ADR-008이 기각한 재장전을 ADR-010에서 번복(충실도 우선)
- **신뢰도 등급**: **B**(발사대당 발수) / **C**(재장전 시간)
- **MC 적용방식**: 발수 고정(공개 제원) · 재장전 시간 **스윕 대상**

### [WPN-BTY-LAYDOWN-01] 개념 배치(laydown) — 축선×티어 무공백
- **값/분포**: 상층 L-SAM 2포대(전 축선 탄도 커버) · 중층 천궁-II/PAC-3 2포대 + 군단천궁 1포대 · 하층 SHORAD 3포대. FTR·SM2는 battery화하지 않고 집계 유지(ADR-010 선택지). 커버리지 매트릭스 무공백(`KJ.checkCoverageMatrix`)
- **출처**: 공개 배치 수량(laydown-sources.md §2, 등급 B/C: Patriot 8·천궁-II ~7–20·L-SAM 2–4·이지스 목표6)의 **하한~중앙값 축소 개념**. **정확 포대 수·좌표 미공개(C)** — 커버리지 무공백을 목표로 축소 배치, 실제 배치·좌표 특정 안 함
- **적용범위**: `js/data/fire-units.js` BATTERIES. `tests/fireunit.test.js` 커버리지 어서션으로 무공백 고정
- **신뢰도 등급**: **C**(정확 수량·배치 비공개)
- **MC 적용방식**: 포대 수·배치 **스윕 대상**(향후). 현재는 무공백 최소 배치 고정

### [C2-FIREUNIT-01] fireUnitLayer 기능 플래그(되돌리기)
- **값/분포**: `features.fireUnitLayer` 기본 **OFF**. OFF → 집계 shooter 노드 그대로(legacy 지문 비트 동일, 추가 RNG 소비 0). ON → 포대 계층 대체. `KJ.PRESETS.highFidelity`로 selfDefense·magazine·reserveFloor와 함께 ON
- **출처**: 작업지시서 §1 절대규칙 3(되돌리기 가능성) — 모든 신규 거동은 토글 가능
- **적용범위**: DES `_buildActiveNodes`. `tests/fireunit.test.js` 되돌리기 어서션(전 플래그 OFF=legacy-snapshot 비트 동일)
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 고정(구조 스위치). OFF↔ON 짝비교로 병목 이동 정량화(docs/vv-report.md)

### [C2-SELFDEF-01] 자체교전(Self-Defense / 자율 교전) 파라미터 (WP2, ADR-011)
- **값/분포**: `features.selfDefense` 기본 **OFF**. 트리거: 잔여 체공창 ≤ `selfDefenseWindowSec`(기본 60, 스윕 {30,60,90}) AND coverage∋축선 AND canEngage AND C2 미교전(`!_countedEngaged` 또는 pipelineDead). ECS 로컬 결심 `selfDefenseDecisionSec`(기본 5s, 상위 C2·협조·승인 우회). 자체 pk 감쇠 `selfDefensePkMult`(기본 0.8, 스윕 {0.7,0.8,0.9}). MFR 자체 스캔 Pd=포대 mfr.detectProb(폴백 집계 shooter 0.6)
- **단위**: 초, 배수, 확률
- **출처**: 자위권 교전(JP 3-01 right of self-defense) — 지휘관은 적대행위로부터 부대·방호자산을 보호할 권한. KJADS 원칙 6-2(중앙→분권→자율 전환)·6-1(로컬 IDD) 최소 구현. **창·결심·감쇠 값은 공개근거 없음(등급 C)** — 스윕으로만 해석
- **적용범위**: DES `_onSelfDefScan`/`_selfEngage`/`_onEngageEnd(opts.selfDef)`. 양 모드 공통(As-Is에도 존재하는 물리·교리 — As-Is 하한↑ = To-Be 개선폭↓, 반증 성격). 자체 스캔당 raw 1회(OFF면 SDEF_SCAN 미예약, 추가 RNG 소비 0)
- **신뢰도 등급**: **C**(창·결심·감쇠 근거 부재)
- **MC 적용방식**: 민감도 **스윕 대상** selfDefenseWindowSec{30,60,90}·selfDefensePkMult{0.7,0.8,0.9}(scripts/step-fireunit-sweep.mjs)
- **비고**: 오격(fratricide)은 상위 CID 없이 교전하므로 위험 카운터(`iffRiskEngagements`)만 신설 — 실제 오격 확률 모델링은 근거 부재로 범위 밖(ADR-011). meanSelfDefenseReactionSec는 meanDecisionDelaySec 분모와 분리(경로 상이)

---

## THR (위협)

### [THR-UAV-RCS-01] 북한 소형 무인기 탐지확률
- **값/분포**: 저탐지(개념), Triangular(0.2, 0.4, 0.6) per 스캔 → Phase 1에서는 detectFactor=0.4로 근사
- **출처**: 2022.12.26 무인기 침투 사건 보도(경향·MBC·한반도선진화재단); 위키백과
- **인용문**: "2m 이하 소형 무인기… 탐지·추적하였으나… 격추 실패"; 소형 무인정찰기는 "탐지거리가 10km"(RPS-42 대형표적 탐지거리 30km 대비)
- **적용범위**: 탐지·추적생성 단계(항적소실 반복 → 부하 배수 dup=min(2.5, 1/detectFactor))
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링
- **비고**: 무인기 대응 4개 사업 5,500억원 반영(국방중기계획 2022.12.28), 레이저대공무기 블록1 2027년 전력화 전망

### [THR-KN25-RNG-01] 600mm 초대형 방사포(KN-25) 사거리·발사간격
- **값/분포**: 사거리 350–400 km, 발사간격 약 20 s
- **단위**: km, 초
- **출처**: 뉴스핌(2024.9.12), 권용수 국방대 명예교수 분석; KN-25 열병식 분석
- **인용문**: "일단 비행거리와 최고고도만 봤을 때는 북한의 600mm 초대형 방사포(KN-25)로 추정된다"(일본 방위성 파악 비행거리 350km·최고고도 100km). 최대사거리 400km, 발사간격 약 20초로 2~3분 내 6발 연발 가능
- **적용범위**: SC3 포화공격 시나리오 — mrl_large λ=3.0/분은 발사간격 20초의 역수
- **신뢰도 등급**: B
- **MC 적용방식**: 분포샘플링

### [THR-DRONE-ARR-01] 복합위협 도착률(포화공격)
- **값/분포**: Poisson(λ), λ는 시나리오별(저강도 0.05/분 ~ 포화 수 건/분) × 강도 슬라이더(0.5–3.0)
- **출처**: 개념 설정(포아송 도착 가정)
- **적용범위**: 전 시나리오 위협 생성 (js/data/scenarios.js)
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링(λ 민감도스윕 — UI 강도 슬라이더가 Phase 1 수동 스윕 역할)

### [THR-AN2-RCS-01] 저속 침투기(AN-2급) 탐지 특성
- **값/분포**: detectFactor 0.6 (개념 — 목재 기체 저RCS·저고도)
- **출처**: AN-2 저고도 침투 위협 공개 문헌(2차)
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링

### [THR-HELI-RCS-01] 헬기 저고도 침투 탐지 특성
- **값/분포**: detectFactor 0.7 (개념)
- **출처**: 개념 설정
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링

### [THR-*-RNG] 위협별 개념 사거리대·발사권역 (정밀화 Phase A, `js/data/threats.js` rangeBandKm·originZones)

위협 유형별 개념 사거리대와 허용 발사권역 태그. `js/data/axes.js`의 축선별
launchZones·conceptReachKm과 대조해 축선 배분의 정합성을 검증한다(ENV-AXIS-FIT-01,
`tests/refine.test.js`로 회귀 고정). **전부 공개자료 기반 개념값이며 실제 제원·배치·발사원점이 아님.**
발사권역 태그: `dmz`(DMZ 인접 근거리) / `coastal`(서해·연안) / `deep`(종심).

| ID | 위협 | 개념 사거리대(km) | 발사권역 | 출처 성격 | 신뢰도 |
|---|---|---|---|---|---|
| THR-UAV-RNG-01 | 소형 무인기(2m급) | 50–300 | dmz·coastal | 2022.12.26 침투 무인기 항속거리 보도(서울 왕복 비행) 기반 개념 | C |
| THR-AN2-RNG-01 | 저속 침투기(AN-2급) | 100–900 | dmz·coastal | AN-2 항속거리 공개 스펙(약 900km) 기반 개념 | B |
| THR-HELI-RNG-01 | 헬기(저고도 침투) | 50–500 | dmz·coastal | 중형 헬기 전투행동반경 공개 스펙 기반 개념 | C |
| THR-FTR-RNG-01 | 전투기 | 200–1,500 | dmz·coastal·deep | 전투기 전투행동반경 공개 스펙 기반 개념 | C |
| THR-CM-RNG-01 | 순항미사일 | 150–2,000 | dmz·coastal·deep | 북 순항미사일(화살 계열) 사거리 주장 보도(≈1,500–2,000km) 기반 개념 | B |
| THR-KN23-RNG-01 | SRBM(KN-23급) | 400–690 | deep | KN-23 사거리 분석 보도(≈450–690km) 기반 개념. 저각·단축발사 가능성으로 min은 정합검증 미사용 | B |
| THR-KN25-RNG-01 | 초대형 방사포(KN-25급) | 350–400 | deep | 기존 THR-KN25-RNG-01(사거리·발사간격)과 동일 출처 | B |

### [ENV-AXIS-FIT-01] 축선-사거리·발사권역 정합 검증 규칙
- **값/분포**: (1) 위협 originZones ∩ 축선 launchZones ≠ ∅, (2) 위협 rangeBandKm.max ≥ 축선 conceptReachKm. 축선 개념거리(북측 진입점 기준): west 150 / central 140 / east 200 / seoul 70 km. seoul 축선은 launchZones=['dmz'] (근거리 전용 — 종심 위협 배분 차단)
- **출처**: 개념 설정 — 위협 출발점(축선 entry)이 위협 사거리·발사권역과 모순되지 않게 하는 데이터 정합 규칙
- **적용범위**: `KJ.checkAxisThreatFit`/`KJ.validateScenarioOrigins`(js/data/axes.js). 시나리오 mix 배분 검증(회귀 고정). DES 부하·병목 계산에는 개입하지 않음(데이터 계층 전용 — 시드 고정 스냅샷으로 무회귀 검증)
- **신뢰도 등급**: C(개념 규칙)
- **MC 적용방식**: 고정(검증 기준)

### [THR-CM-RCS-01] 순항미사일 저고도 비행 탐지 특성
- **값/분포**: detectFactor 0.5 (개념 — 지형추적 저고도 비행)
- **출처**: 북한 순항미사일(화살 계열) 시험발사 보도 기반 개념 설정
- **신뢰도 등급**: C
- **MC 적용방식**: 분포샘플링

---

## 병목 판정 임계값 (분석 프레임워크)

### [ENV-RHO-THRESH-01] 대기행렬 이용률 병목 임계값
- **값/분포**: 주의 ρ≥0.7 / 병목 ρ≥0.9 / 포화 ρ≥1.0
- **출처**: Li & Mei, "Performance Analysis and Optimal Allocation of Layered Defense M/M/N Queueing Systems", *Mathematical Problems in Engineering*, 2016, DOI:10.1155/2016/5915918; MetricGate 큐잉 문헌
- **인용문**: "이용률 0.9 초과는 경고신호이며 수요의 작은 증가가 대기시간을 크게 늘린다"
- **적용범위**: `js/analysis/bottleneck.js` — 병목은 이 임계값과 시나리오 부하로부터 도출되며 데이터에 고정되지 않음
- **신뢰도 등급**: B(문헌 근거)
- **MC 적용방식**: 고정(판정 기준)

### [ENV-COMM-THRESH-01] 통신지연 병목 임계값
- **값/분포**: 전달지연 ≥60 s이고 전달 중 평균 체류(유통량×지연, Little's Law) ≥1건인 링크
- **출처**: 음성보고 180s vs 데이터링크 30s 대비(C2-VOICE-DLY-01) 기반 개념 설정
- **적용범위**: 링크 통신병목 판정 (해석·DES 공통)
- **신뢰도 등급**: C
- **MC 적용방식**: 고정(판정 기준)

---

## DES 엔진 파라미터 (Phase 2, `js/engine/sim-engine.js`)

### [ENV-DES-SCAN-01] 센서 스캔 주기 (탐지 재시도 간격)
- **값/분포**: 10 s (고정, 개념)
- **단위**: 초
- **출처**: 개념 설정 (저탐지 위협의 항적소실→재획득 반복 주기)
- **적용범위**: DES 탐지 단계 — 매 스캔 detectFactor 확률로 탐지 판정, 실패 시 재시도
- **신뢰도 등급**: C
- **MC 적용방식**: 고정 (Phase 3 민감도스윕 후보)

### [ENV-DES-DWELL-01] 위협별 요격 가능 체류시간(dwellSec)
- **값/분포**: 무인기 900 / 저속기 600 / 헬기 420 / 전투기 180 / 순항미사일 120 / SRBM 90 / 초대형방사포 80 (초, 개념)
- **단위**: 초
- **출처**: 개념 설정 — 위협 속도·교전권역 통과시간 유추 (탄도탄은 비행시간 짧아 창이 좁음)
- **적용범위**: DES 교전기회 창. 이 시간 내 미격추 시 누수(leak) 판정
- **신뢰도 등급**: C
- **MC 적용방식**: 고정 (Phase 3 삼각분포화 후보)
- **비고**: 탄도탄의 좁은 창은 "승인 지연=요격기회 상실"을 구조적으로 표현

### [ENV-DES-TRIES-01] BDA 재교전 상한
- **값/분포**: 3 회 (고정)
- **출처**: 개념 설정 (폐루프 무한재교전 방지 + 현실적 재교전 기회 제한)
- **적용범위**: DES BDA 단계 — 요격 실패 시 dwell 창 내에서 최대 3회 재교전
- **신뢰도 등급**: C
- **MC 적용방식**: 고정

### [ENV-DES-SHOOTERK-01] 무기체계 교전 대기실 용량(K)
- **값/분포**: 교전채널 c × 2 (M/M/c/K)
- **출처**: 개념 설정
- **적용범위**: DES 무기 노드 포화 판정 — K 초과 교전요청은 드롭(요격기회 상실)
- **신뢰도 등급**: C
- **MC 적용방식**: 고정

### [ENV-DES-C2K-01] C2 노드 대기실 용량(K) (`js/data/nodes.js` queue.capacity)
- **값/분포**: MCRC 40 · KAMDOC 30 · KAOC 30 · AOC-1C 15 · JAOC-CD 15 · JAMDC2 60 (M/M/c/K). 서버 수(c) 대비 배수로 보면 대체로 ×10(AOC-1C·JAOC-CD만 ×7.5)
- **단위**: 항적/작업 건수 (대기실 슬롯)
- **출처**: **개념 설정 — 서버 수 대비 배수로 임의 설정. 공개근거 없음(등급 C).** 무기체계 K(`[ENV-DES-SHOOTERK-01]`)는 "c×2" 규칙이라도 명시돼 있으나 C2의 K는 규칙조차 없이 노드 데이터에 박혀 있어, 본 항목으로 명시화하고 민감도 스윕 대상으로 지정한다. **근거를 지어내지 않는다.**
- **적용범위**: DES C2 노드 포화 판정 — 재계 중(busy)+대기(queue)가 K에 도달하면 이후 도착은 드롭(`overflow:<노드>`, 항적/승인 상실). track·approval 부하가 같은 K를 공유한다(`nodekind.test.js`).
- **신뢰도 등급**: C (근거 등급이 가장 낮으나, 아래 비고대로 버스트 시나리오에서 결과를 결정하는 파라미터)
- **MC 적용방식**: 민감도스윕 대상 (임시 스크립트에서 `queue.capacity` 조작으로 스윕 — Phase 3)
- **비고 (버스트에서 c가 아니라 K가 구속한다)**:
  - **SC2(무인기 동시 남파) 같은 버스트에서는 서버 수(c)가 아니라 K가 결과를 구속한다.** 8~20대가 동시 도착하면 서버 c개 + 대기실(K−c)개를 즉시 채우고 그 이후 도착은 즉시 드롭된다. 30분 평균 ρ는 이 순간 포화를 희석하므로, **ρ가 낮아도(예: AOC-1C ρ≈0.75) K 도달로 드롭이 발생**할 수 있다 → ρ 단독으로 읽으면 안 되고 드롭·maxInSystem과 함께 본다.
  - **실측(seed 1~10 평균)**: **As-Is** AOC-1C(c=2, K=15) — SC2 x2.5에서 드롭 7.1건(overflow:AOC-1C 6.6건), maxInSystem=15(=K로 고정). K를 30으로 올리면 드롭 0(maxInSystem 21.8로 풀림). 즉 **As-Is 버스트 드롭이 사라지는 임계 K는 ≈30**. 단, K를 풀어 드롭을 0으로 만들어도 **격추율 41.0%→41.8%·누수율 37.2%→36.7%로 사실상 불변** — SC2의 구속은 C2 용량이 아니라 무인기 저요격확률(Pk 0.1~0.5)이기 때문(무엇이 C2 문제이고 무엇이 무기 문제인지 구분되는 지점).
  - **To-Be는 현재 모델에서 SC2 버스트를 K로 구속받지 않는다**: ②브랜치(`feat/stage2-track-overhaul`)의 센서→JAMDC2 직결 라우팅으로 무인기 항적이 군단 AOC-1C를 **우회**하며(To-Be AOC-1C arrivals=0, 유휴), 버스트는 JAMDC2(c=6, K=60)가 흡수한다(SC2 x3.0에서도 maxInSystem≈11 ≪ K, JAMDC2 K를 20으로 낮춰도 드롭 0). **따라서 "To-Be가 K=15 때문에 AOC-1C에서 드롭한다"는 서술은 직결 라우팅 도입 이후 성립하지 않는다(초기 실측이 갱신됨).**

### [ENV-DES-SVC-DIST-01] 서비스·도착 분포
- **값/분포**: 도착=지수(포아송 도착간격), 서비스=지수(평균=노드 처리시간), 요격확률=삼각분포(WPN-*-PK)
- **출처**: 계획서 4절 (M/M/c 가정 — 지수 도착·서비스; 삼각분포=전문가 추정 최소/최빈/최대)
- **적용범위**: DES 전 노드·교전
- **신뢰도 등급**: B(방법론) / C(구체 파라미터)
- **MC 적용방식**: 분포샘플링 (seed 고정 시 재현)

### [ENV-DES-SEED-01] 난수 생성기
- **값/분포**: Mulberry32 (32비트 결정론적 PRNG)
- **출처**: 계획서 4절 — "Mulberry32는 UI 재현·딥링크 공유용으로 적합(결정론적·경량)"
- **적용범위**: DES 전 무작위성. 동일 seed → 동일 결과 (seed 0 포함 전 시드공간 유효)
- **신뢰도 등급**: B
- **MC 적용방식**: 고정(재현성 보장). 대규모 배치 통계 엄밀성은 장주기 생성기 병행 검토

### [ENV-DES-CENSOR-01] 종료 절단(censoring) 보정 (Phase 3 ⑨, `js/engine/sim-engine.js`)
- **값/분포**: `censored = max(0, spawned − killed − leaked)` — 관측창 종료(endTimeSec)까지 격추·누수 어느 쪽으로도 미해결한 위협. `features.censorFix`(기본 ON)이면 격추율·누수율 분모에서 제외(denom = spawned − censored)
- **출처**: 이산사건 시뮬레이션 종료 절단(right-censoring) 표준 처리 — 개념 적용
- **적용범위**: `_results` 격추율·누수율 분모(순수 보고 변경 — spawned·killed·leaked·rng·이벤트 불변). `censored`·`censoredRaw` 노출. **공용 유틸**: ①단계 탐지율도 `detected/(spawned−censored)`로 동일 보정 가능(동일 필드 재사용)
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 고정. flow 보존(spawned ≥ killed+leaked) 자동 유지(censored ≥ 0)
- **비고**: 실측 절단율 SC3 x2.5 As-Is 15.3% · To-Be 10.0%. 보정 시 격추율 As-Is 9.3→11.0%·To-Be 42.0→46.7%(개선폭 +9.2% 상대, 에스컬레이션 미달)

### [ENV-DES-TIMEOUT-01] timeout 분해 + overflow:shooter 재분류 (Phase 4 ⑨, `js/engine/sim-engine.js`)
- **값/분포**: 누수 사유 `timeout`을 `tries` 기준 분해 — `tries===0`(교전 미개시)=`timeout:c2`(구조, ②~⑦ 파이프라인 시간 소진) · `tries>0`(교전했으나 체공창 소진)=`timeout:engage`(비구조, ⑧⑨ 물리 한계). `features.timeoutSplit`(기본 ON). 별도로 `leakTaxonomy`가 `overflow:<노드>`를 노드 category로 재분류 — shooter=비구조(유도탄·발사대 수 한계), C2=구조(처리 포화)
- **출처**: 사실 (e)(동일 물리현상 구조/비구조 혼재) 해소. 분해 기준은 ⑧ `no_engage_window`와 동일(`threat.tries > 0 → 비구조`) — 두 단계 판정 일관성(ADR-004). 재분류 근거: 무기 교전채널 = 유도탄·발사대 수 = [WPN-*-CHAN-01]
- **적용범위**: `_onExit`(코드 방출, timeoutSplit 게이트) · `KJ.leakTaxonomy`(overflow 재분류, 무조건 — UI·테스트·원장 공유 단일 분류원). 동역학·rng·이벤트·지문(sp/k/l/iM/ex) **완전 불변**(순수 보고/분류)
- **신뢰도 등급**: B(방법론·문서 채널 수)
- **MC 적용방식**: 고정. timeoutSplit OFF → 단일 timeout(구조) = legacy 코드 분포
- **비고**: ⚠️ 과제 예측(구조적 −97%)과 불일치. 실측 To-Be 개선폭 25.09p→26.85p(**+7.0%**, 20% 미달, 🔴 아님). 이유: ⑧ 교전창 필터가 tries===0 위협을 교전 전 `no_engage_window`로 선점 → To-Be 잔여 timeout은 대부분 `timeout:c2`(구조 유지). 상세 ADR-004

### [ENV-DES-PKCORR-01] 재교전 요격확률 상관 ρ (Phase 5 ⑨, `js/engine/sim-engine.js`) — **기본 OFF**
- **값/분포**: 표적별 공유 잠재 `frailty`(최초 교전 1회 추출)와 발사별 신규 추출을 `u = ρ·frailty + (1−ρ)·raw()`로 혼합, `u<pk`면 격추. `PK_CORR_RHO=0.7`(기본), `features.pkCorrelation`로 재정의(스윕). `features.pkCorrelated` 기본 **false**
- **출처**: 재교전 실패의 체계적 상관(교전기하·ECM·표적특성 발사 간 공유). 앵커: 2022.12.26 소형 무인기 5대 남파 반복 대응에도 전량 미격추 — 독립 모델이 재교전 효과를 과대평가함을 시사(개념 모형)
- **적용범위**: `_onEngageEnd` 격추 판정. OFF → legacy 독립(`raw()<pk`), 그리기 수·지문·스냅샷 불변
- **신뢰도 등급**: **C**(ρ 실측 근거 없음) → 조건 2에 따라 기본 OFF
- **MC 적용방식**: 옵션. ON 시 표적당 frailty 1회 추가 추출. 스윕 결과(전체 격추율 To-Be): 독립 50.0% / ρ0.7 44.3% / ρ1.0 40.2%
- **비고**: 혼합 모형의 주변분포는 엄밀 균일 아님(평균 0.5·단조) — 효과는 주로 재교전 이득 축소로 발현. 위협유형별 격추율 분리 계측은 Phase 7 신규지표 예정. 상세 ADR-005

### [ENV-DES-SALVO-01] 연발(salvo) 교전 doctrine (Phase 6 ⑨, `js/engine/sim-engine.js`) — **기본 OFF**
- **값/분포**: 교전당 k발 동시 발사 → 비용 `costPerShot×k`, 누적 pk = `1−(1−pk)^k`. `SALVO_SIZE=2`(기본), `features.salvoSize`로 재정의. `features.salvo` 기본 **false**
- **출처**: shoot-look-shoot의 한계(짧은 체공창서 재교전 시간 부재 → missed 누수) 대응 doctrine 옵션. 필요성은 편향 원장의 `missed`(To-Be 3352건, 비구조) 규모로 판정
- **적용범위**: `_onEngageEnd` 비용·pk. OFF → k=1(legacy, 비용·pk·그리기 수 불변). ON도 그리기 수 불변(pk 값만 상향)
- **신뢰도 등급**: C(교리 파라미터 — 결함 아님) → 기본 OFF
- **MC 적용방식**: 옵션. 트레이드오프(To-Be): OFF 격추율 50.0%·교환비 0.94 / k=2 61.2%·1.54 / k=3 65.1%·2.21. `missed` 급감(3352→1121→445), `no_engage_window` 불변(⑧과 직교)
- **비고**: k=2에서 격추율 +11.2p(상대 +22%, 임계 초과) → doctrine 변경이므로 기본 결론 미반영. 누적 pk는 k발 독립 가정(salvo 내부 상관 미모형). 상세 ADR-006

### [ENV-DES-REVERT-01] sensorPdFusion 되돌리기 플래그 (통합 Gate 2, `js/engine/sim-engine.js`)
- **값/분포**: `features.sensorPdFusion`(기본 ON). OFF → 통합 이전(0468f10) 탐지식 `p=min(1, detectFactor×mult.detect)`(센서 Pd·모드별 융합 무시)로 복귀
- **출처**: 통합 검증 Gate 2(되돌리기 가능성) — W6 센서 Pd 융합 개편의 런타임 토글
- **적용범위**: `_scanProb`. 탐지 계층 그리기 수 동일(스캔당 raw 1회)이라 이 계층 bit-clean 되돌리기
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 고정. ON↔OFF 집계 영향 미미(탐지율 Δ0.16pp·교전지연 Δ1.1s — 재스캔 포화) → W6은 집계 결론을 거의 안 움직임(대조는 축선별)
- **비고**: ⚠️ 전체 bit-exact 기준선(0468f10) 복원은 CRN(arrRng 분리)이 도착 스트림을 재배치해 **불가**. 되돌리기는 ⑨ 런타임 플래그(36/36)+이 플래그+git 층위로 제공. 상세 docs/integration-audit.md G2

### [ENV-DES-TTKBIAS-01] meanTTK 생존자 편향 노출 + 교전당 발사수 (Phase 7 ⑨, `js/engine/sim-engine.js`)
- **값/분포**: `meanTimeToKillN`(=killed, meanTTK가 평균 낸 표본 수) · `shotsFired`(총 요격탄) · `shotsPerEngagement`(=shotsFired/everEngaged). 모두 순수 보고(동역학 불변)
- **출처**: meanTTK는 "격추 성공분에만" 조건화된 평균 → 생존자 편향(To-Be가 놓치던 느린 표적까지 격추하면 meanTTK↑=느려 보이는 선택효과). 교전당 발사수는 salvo·재교전으로 교전=1발 가정이 깨짐을 노출
- **적용범위**: `_results` 노출, ⑨ 카드 표시(meanTTK 라벨에 조건 n·편향 경고, 신규 "교전당 발사수" 지표)
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 고정. 시행별 격추분포는 MC 패널이 이미 killRate {mean, std, ci}로 계측(Welford) — 별도 히스토그램 대신 분산 노출로 대리
- **비고**: 기본(salvo OFF, k=1)에서도 shotsPerEngagement>1(재교전분). To-Be↔As-Is meanTTK 단순비교 금지 — 격추율(n)과 병독 필수

### [ENV-DES-CRN-01] 공통난수(CRN) — As-Is↔To-Be 짝지은 비교 (`js/engine/sim-engine.js`)
- **값/분포**: 난수 스트림 2분리 — `arrRng`(위협 도착간격 전용, seed에서 황금비 해시로 독립 파생) / `rng`(처리 무작위성: 탐지·서비스시간·요격확률·링크지연 분포·중복교전). 도착은 `arrRng`에서만 소비
- **출처**: 분산감소 표준기법(Common Random Numbers) — `claude/c2-simulation-review` 검토에서 이식. 근거: 동일 seed에서 두 형상이 같은 위협열을 마주해야 차이가 위협표본이 아니라 C2 구조에서만 비롯됨(짝지은 비교의 타당성)
- **적용범위**: DES 전 실행. 효과: 동일 seed·강도에서 As-Is와 To-Be의 **spawned(위협 수)가 완전 일치**(도입 전에는 단일 스트림이 도착·처리를 교대 소비해 모드마다 도착열이 어긋났다 — 예: 종전 sc3 asis 367 vs tobe 361 → 이식 후 307==307)
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 복제별 baseSeed로 As-Is/To-Be가 동일 도착열을 마주(MC 패널 비교표·토네이도에 반영). 비고: 이식으로 seed별 수치가 재배치되어 회귀 스냅샷·일부 seed 고정 어서션을 정본 갱신함(분권 전환 임계·exchangeSat 방향 등 — 오히려 비교 타당성 향상이 드러냄)

---

## Monte Carlo·통계 파라미터 (Phase 3, `js/analysis/mc-runner.js`)

### [ENV-MC-CONV-01] 수렴판정 기준
- **값/분포**: 주지표(누수율) 95% CI 반폭 ≤ 허용오차(기본 0.01=1%p), 최소 30회 / 상한 500회(UI 조정 가능)
- **출처**: 계획서 Recommendations 3 — "95% CI 반폭이 허용오차 이하로 수렴 시 정지, 미수렴 시 상한(10,000)까지"; SAS 적응적 DO-UNTIL
- **인용문**: "핵심 지표의 95% CI 반폭이 허용오차(0.01) 이하로 수렴할 때 정지"
- **적용범위**: MC 반복 정지 규칙
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 판정 기준

### [ENV-MC-CI-01] 신뢰구간·분산 추정
- **값/분포**: Welford 온라인 표본분산, CI 반폭 = z·s/√n (z=1.95996, 95% 양측)
- **출처**: 계획서 4절 — "Welford 스트리밍 평균/분산으로 신뢰구간 반폭을 실시간 모니터링"
- **적용범위**: 전 MC 지표(격추율·누수율·탐지율·평균격추시간·병목수)
- **신뢰도 등급**: A(표준 통계)
- **MC 적용방식**: 추정 방법

### [ENV-MC-SENS-01] 민감도 스윕 폭
- **값/분포**: 각 인자 ±20% 스케일, 고정 복제수(기본 50~60), 주지표 누수율
- **출처**: 계획서 4절 V&V — "민감도 분석(파라미터 ±20% 스윕)"
- **적용범위**: 인자 = 노드 처리시간·통신지연·탐지확률·요격확률·위협강도(λ)
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 스윕 대상
- **비고**: 엔진 배수 훅(mult.service/delay/detect/pk, intensity)으로 전역 스케일링. 데이터 원본 불변

---

## 재생·시각화 파라미터 (Phase 4, `js/data/axes.js` · `js/engine/sim-engine.js` trace · `js/analysis/overlap-heatmap.js`)

### [ENV-PB-AXES-01] 축선별 진입점→표적권역 개념좌표
- **값/분포**: west(해주 개념→서울), central(평강 개념→오산·평택 권역), east(원산 개념→강릉 권역), seoul(개성 개념→서울 도심) — 전부 도시 수준 개념좌표. 진입점은 북측 발사권역의 개념 표시(위협 다양화 개편 — 지도에서 위협이 북한 지역에서 출발)
- **출처**: 개념 설정(위협궤적 애니메이션·히트맵 전용). 실제 침투경로·발사원점·표적이 아님
- **적용범위**: 위협 위치(t) = lerp(entry, target, clamp((t−spawnT)/dwellSec, 0, 1))
- **신뢰도 등급**: C(시각화 목적 개념값)
- **MC 적용방식**: 고정
- **비고**: 시나리오 축선 키('west'|'central'|'east'|'seoul')와 1:1 대응. 구 좌표(백령도·철원·고성·고양 개념)는 위협 다양화 개편에서 북측 개념좌표로 대체

### [ENV-PB-TRACECAP-01] 재생용 trace 상한
- **값/분포**: 위협 추적 300건, 노드 재고 시계열 20,000 샘플 (초과 시 truncated 플래그로 명시, 은폐 없음)
- **출처**: 개념 설정(메모리·렌더 성능 보호)
- **적용범위**: `runDES({trace:true})`의 `threatTraces`/`nodeSeries`. **통계 결과(global/nodes/links/bottlenecks)는 trace 여부와 무관하게 항상 전체 모집단 기준**이며 절삭 영향을 받지 않음(회귀 테스트로 검증)
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 고정

### [ENV-PB-FADE-01] 격추/누수 후 마커 페이드아웃
- **값/분포**: 5초 (선형 투명도 감소)
- **출처**: 개념 설정(시각적 가독성)
- **적용범위**: 재생 탭 위협 마커 애니메이션
- **신뢰도 등급**: C
- **MC 적용방식**: 고정

### [ENV-TRANS-SWEEP-01] 임계 전환점 스윕 설정 (Phase 5, Rec.6)
- **값/분포**: 강도 0.5×~3.0× / 0.25 스텝(11점) × 2모드 × 복제 20~30회/점, 임계 ρ=0.9
- **출처**: 계획서 Recommendations 6 — "이용률 ρ가 0.9를 넘는 위협 도착률 구간에서 As-Is 대비 To-Be의 개선폭을 핵심 산출물로 제시"
- **적용범위**: `js/analysis/transition.js` — As-Is C2 최대 ρ의 0.9 돌파 강도, 임계 전/후 평균 개선폭, 최대 격차 지점 도출
- **신뢰도 등급**: B(방법론)
- **MC 적용방식**: 스윕(각 점 baseSeed 파생 독립시드, 결정론적)
- **비고**: 대표 결과(SC3, seed=12345): ρ≥0.9 돌파 ×1.75, 임계 이전 개선폭 10.3%p → 이후 18.9%p (docs/vv-report.md §3.4)

### [ENV-OVERLAP-RISK-01] 중복교전 위험 판정 임계
- **값/분포**: 두 통제계통 간 최단 협조지연이 해당 위협 dwellSec의 50% 이상(또는 협조경로 자체가 없음)이면 "제때 협조 불가"로 판정
- **출처**: 개념 설정 — 위협이 공역을 이탈하기 전에 협조를 완료할 수 있는지를 대리 지표로 사용
- **적용범위**: `computeOverlapHeat`의 riskPairs 판정. JAMDC2(Track Fusion) 노드는 report 유입+coord
  유출을 통합 협조경로로 인정하는 특례를 둠(엔진의 실제 융합 동작과 정합)
- **신뢰도 등급**: C(방법론적 대리지표)
- **MC 적용방식**: 판정 기준
- **비고**: 이 특례가 없으면 JAMDC2로 라우팅되는 통제계통 쌍이 여전히 "미협조"로 오판정되어
  To-Be의 실제 개선 효과가 히트맵에 드러나지 않음 — 개발 중 발견해 수정(overlap.test.js로 고정)

---

## 부록 A — 자산 범위 링 개념값 (CVG-*-RNG-01, Phase 6)

지도 시각화의 센서 탐지범위·무기 교전범위 링에 쓰이는 값으로, **모두 공개자료 기반
정책연구용 개념값**이다(시각화 전용 — DES/해석 계산에는 사용되지 않음). 실제 배치·성능
자료가 아니며, 좌표와 동일하게 도시 수준 개념 표시 목적이다.

| ID | 자산 | 범위(개념) | 근거 성격 | 신뢰도 |
|---|---|---|---|---|
| CVG-ADC2A-W-RNG-01 | ADC2A 대공감시 | ≈15km | 육안·광학 관측 가시범위 개념 | C |
| CVG-ACR-E/W-RNG-01 | 방공관제레이더 | ≈250km | 장거리 방공관제레이더급 공개 스펙 개념 | C |
| CVG-LAR-C-RNG-01 | 저고도 탐지레이더 | ≈40km | 저고도 전용 레이더 개념 | C |
| CVG-LLR-1C/CD-RNG-01 | 국지방공레이더 | ≈20km | TPS-880K급 공개 보도 기반 개념 | B |
| CVG-E737-RNG-01 | E-737 피스아이 | ≈370km | MESA 레이더 공개 스펙 기반 개념 | B |
| CVG-GPR-RNG-01 | 그린파인 | ≈500km | 공개 보도(탐지 수백 km) 보수적 개념 | B |
| CVG-AEGIS-E/W-RNG-01 | SPY-1D(V) | ≈300km | 공개 스펙 기반 대공 개념 | B |
| CVG-FTR-RNG-01 | 전투기 | ≈350km | 초계·요격 작전반경 개념 | C |
| CVG-SHORAD-RNG-01 | 신궁(단거리방공) | ≈7km | 신궁 유효사거리 공개값 기반 | B |
| CVG-MSAM-RNG-01 | 천궁 | ≈40km | 천궁 사거리 공개값 기반 | B |
| CVG-MDU-M-RNG-01 | 천궁-II·PAC-3 | ≈40km | 하층 요격범위 공개값 기반 개념 | B |
| CVG-MDU-L-RNG-01 | L-SAM | ≈150km | 공개 보도 기반 개념 | C |
| CVG-SM2-RNG-01 | SM-2 | ≈150km | SM-2 계열 사거리 공개값 기반 개념 | B |

## 부록 B — 시나리오 burst(동시 다발)와 등가 λ (Phase 6)

SC2(문제 상황 2 — 무인기 8대 동시 남파)는 포아송 연속 도착이 아닌 **일회성 동시 다발**
이므로 mix 항목에 `burst`(동시 발생 수)·`atSec`(발생 시각)을 도입했다(DES 엔진 지원).
정상상태 M/M/c 해석 모듈은 시간 개념이 없으므로, burst 항목에는 등가 도착률
`equivRatePerMin`(burst를 위협 체공창 dwellSec≈15분에 균등 살포한 개념 근사)을 병기해
사용한다(`KJ.entryRate`). 강도 배수는 burst 수에 반올림 스케일로 적용된다(강도 0 → 0대).
