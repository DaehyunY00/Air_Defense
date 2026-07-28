# ADR-059 — native WTA 모드 차등 + 비용 인식(`nativeWtaMode`)

## 맥락

native 사수 선정 점수식에는 `this.mode` 참조가 없었다:

```js
ev.score = ev.pk * ammoRatio * (1 - load) / Math.max(1, ev.pip.rangeKm) - priority * 0.000001;
```

**As-Is와 To-Be의 무기 배정이 완전히 동일**했고, legacy의 자원 최적화 플래그 4종
(`costAwareWta`·`magazine`·`reserveFloor`·`thresholdReweight`)은 native에서 전부 무효였다
(§0-(3) 실측: 토글해도 이벤트 수까지 동일). 그 결과 README의 반증 사례(자원 절약은 C2 통합이
아니라 비용 인식 로직에서 나온다)를 고해상도에서 재현할 수 없었다.

legacy 이론의 핵심: **As-Is는 COP 부재로 무기별 적합도 비교가 불가**하다 — 전군 무기의
pk·교전 포락선을 실시간 비교하는 것은 통합 COP가 있어야 가능한 일이다.

## 선택지

- **wtaSuit 이식** — 기각. native 점수식이 이미 `pk`(PSSEK)와 `pip.rangeKm`(교전 포락선
  기하)을 쓰므로 `wtaSuit[altBand]`(고도대역 개념 가중)와 의미가 겹친다. 곱하면 같은 적합도의
  이중 계상이고, native의 물리 기반 적합도가 legacy 개념 가중보다 정확하다.
- **모드 차등 이식** — 채택 (아래).
- **magazine 이식** — 기각. native는 발사대별 탄약·재장전을 **항상** 모델링한다
  (`iadsResources` — legacy `magazine` 플래그 기본 OFF보다 이미 엄격).
- **reserveFloor(고위협 대응 보존)·thresholdReweight 이식** — 이번 Phase에서는 보류.
  둘 다 "선호 차등"이 아니라 **교리 계층의 별도 거동**(후보 제외/재고 감쇠)이라, 모드 차등과
  섞으면 편향 귀속이 불가능해진다(불변 규칙 7). 후속 ADR 후보로 남긴다.

## 결정

플래그 `nativeWtaMode`(기본 OFF) + 반증 전용 `nativeWtaCostAsis`(기본 OFF):

| 모드 | 점수식 (ON) |
|---|---|
| As-Is | `ammoRatio × (1 − load)` − 우선순위 ε — **관측 가능한 것(자기 탄약·자기 부하)만**. pk·PIP 항 제거 |
| To-Be | 현행 물리 점수식 × **비용 인식** `((1−W)+W·costFit)` — `costFit = min(1, 위협가치/요격탄가)`, W=`costWtaWeight`(0.5), **탄도(altBand='ballistic') 위협 한정**(legacy Step 1의 국한 논리·근거 승계 — 저·중고도에 걸면 anti-pattern 없는 곳까지 재배정) |
| As-Is + 반증 | As-Is 부하 점수 × 동일 비용항 — legacy `costAwareWtaAsis` 대응물 |

물리 실현가능성 필터(`_iadsEvaluate`의 canEngage·봉투·flyout·FC 게이트)는 두 모드 모두
**항상 선행**한다 — 바뀌는 것은 실현 가능한 후보들 사이의 선호 순서뿐이다(신궁·천마 탄도탄
불가 등 제약 어서션 불변).

legacy 반증과의 구현 차이(기록): legacy `costAwareWtaAsis`는 As-Is에 **To-Be 전체 점수식**
(suit·용량·비용)을 부여했다. native 반증은 As-Is 부하 점수에 **비용항만** 곱한다 —
"비용 인식"의 효과를 Best-Shooter 선정 효과와 분리해 더 깨끗하게 격리하기 위함이다.

## 구성

`js/engine/sim-engine.js` — 플래그 2종(ff, ON일 때만 features 노출), `_iadsDecide` 점수 분기,
`_iadsCostTerm(shooter, ev, threat)` 헬퍼(legacy Step 1과 동일 정의: costFit·W·탄도 국한).
**신규 수치 없음** — W(`costWtaWeight`=0.5, `C2-COST-WTA-01` 계열)·위협가치(`unitCostM`)·
요격탄가(`costPerShot`) 전부 기존 원장 값.

## 검증

`tests/native-wta.test.mjs` (run-all 등록, 10 어서션): As-Is ON≠OFF(선정 변화) / 보존율
As-Is 0.409 ≠ To-Be 0.652 / [정직 관측] LEGACY_HIRES To-Be 비용항 불개입(ON==OFF bit-exact)
/ FULL 반증 개입 확인 / 결정론·보존·노출. OFF bit-exact: SHA-256 4셀 + legacy baseline 통과.

### 핵심 정직 관측 — 비용항은 To-Be에서 물지 않는다

단일 seed 실측(LEGACY_HIRES·SC3·900초 / FULL·SC3·300초):

| 셀 | 격추율 | 고가보존율 |
|---|---|---|
| LEGACY To-Be OFF → ON | 0.641 → 0.641 (**동일**) | 0.652 → 0.652 |
| LEGACY As-Is OFF → ON | 0.237 → 0.194 | 0.465 → 0.409 |
| FULL To-Be OFF → ON | 0.980 → 0.980 (**동일**) | 0.360 → 0.360 |
| FULL As-Is OFF → ON | 0.583 → 0.583 | 0.814 → 0.686 |
| FULL As-Is ON → ON+반증(비용항) | 0.583 → 0.500 | 0.686 → 0.678 |

To-Be의 비용항이 결과를 전혀 바꾸지 못하는 이유: 탄도 위협의 결심 시점 실현 가능 후보가
사실상 단일이거나(LEGACY_HIRES — 상층 L-SAM이 As-Is에서 선정되지 않는 기존 관측과 동근원),
물리 점수(pk/rangeKm) 순서가 비용 순서와 일치해 argmax가 뒤집히지 않는다(FULL).

### 반증 결론 — legacy와 **다른 방향** (스펙 예정 절차에 따라 기록)

legacy의 반증 결론은 "As-Is에 비용 인식을 주면 고가보존율이 To-Be보다 높다(75.1%>46.2%) —
절약은 C2 통합이 아니라 비용 인식 로직에서 나온다"였다. **native에서는 재현되지 않는다**:
비용항 자체가 거의 물지 않고(위), 보존율 차이는 비용 인식이 아니라 **교전량·기하 제약**에서
나온다 — FULL As-Is는 비용항 없이도 보존율 0.814로 To-Be(0.360)보다 높다(적게 교전해서).
즉 native의 정직한 결론은: **"자원 절약은 비용 인식 로직에서도, C2 통합에서도 아니라,
주로 교전 기회의 양에서 나온다"** — 고해상도 물리가 legacy 개념 모델의 반증 서사를
지지하지 않는다. (paired MC 30 seed 확정치는 아래 편향 원장.)

### 편향 원장 (paired MC 30 seed × 1800초 × ×1.5)

주 베이스 = {056+057 ON} 위 `nativeWtaMode` 토글 (원자료 phase4-*.json):

| 지표 | SC1: OFF → ON | SC3: OFF → ON |
|---|---|---|
| 격추율 Δ(To-Be−As-Is) | +0.6pp → +0.6pp (**bit-동일** — SC1 선정 무변화) | +18.8pp → **+20.4pp** (상대 +8.2%) |
| 결심지연 Δ | −4.0 → −4.0초 (동일) | −41.9 → −45.8초 (상대 +9.3%) |
| As-Is 격추율 | 0.801 → 0.801 | 0.436 → **0.421** (COP 부재 열화 발현) |
| 고가보존율 (As-Is/To-Be) | 0.385/0.290 → 동일 | 0.586/0.548 → 0.578/0.548 |
| exchangeSat | 20.4/20.5 → 동일 | 4.98/4.71 → 5.22/4.71 — ≫1 유지 |

개선폭 이동은 최대 +9.3%(상대) — **20% 미만, 🔴 불필요**. SC1은 As-Is 선정이 아예 바뀌지
않았다(결심 시점 후보가 사실상 단일 — 부하 순서와 물리 순서 일치).

참고 베이스(전 OFF) 위 동일 토글(SC3): 격추율 Δ +27.3→+30.2pp(상대 +10.6%),
결심지연 Δ −87.2→−101.4초(+16.3%) — Phase 3과 동일한 패턴으로 낡은 기준선이 효과를 키운다.

**반증 확정(30 seed)**: base+WTA 위에 `nativeWtaCostAsis`(As-Is에도 비용항)를 얹어도
As-Is 보존율 0.578→0.581, 격추율 0.421→0.422 — **비용항의 단독 효과가 사실상 0**.
legacy의 "비용 인식이 보존율을 끌어올린다(60.8→76.5%)" 결론은 native에서 재현되지 않는다
(본문 "반증 결론 — legacy와 다른 방향" 참조).

## 결론 영향

G6 재산출(주 베이스 ± nativeWtaMode): ① As-Is 핵심 병목 — 유지(협조·승인 관측은 ADR-058
게이트 소관, 본 플래그는 사수 선정만). ② To-Be 병목 무기체계 이동 — 유지(To-Be 누수 사유는
timeout·missed 지배 — 셀 원자료). ③ exchangeSat ≫1 — 유지(전 셀 4.7~20.6). ④ 제약 어서션 —
유지(38스위트 895어서션). **뒤집힌 것 없음.** README의 legacy 반증 사례(자원 절약=비용 인식
로직)는 native에서 **다른 결론**(절약=교전량·기하)으로 대체됨 — 보고서에 정직 반영.

## 되돌리는 법

- 런타임: `features.nativeWtaMode=false`(기본). 반증 플래그도 기본 OFF.
- 코드: 이 커밋 revert.

## 한계

1. **To-Be 비용항의 불개입** — 이 배치·시나리오 집합에서 비용 인식은 To-Be 결과를 바꾸지
   않는다. "To-Be에 비용 인식을 넣었다"는 사실은 참이지만 효과 크기는 0이다 — 이 플래그로
   To-Be 절약 효과를 주장할 수 없다.
2. **As-Is 부하 점수의 잔여 모순** — As-Is가 자기 축 후보 전체의 부하를 조회하는 것은
   legacy 안 D(전역 부하 조회)의 축소판으로, "COP 부재" 전제와 부분적으로 긴장 관계다.
   legacy와 동일한 한계를 승계했다(legacy ADR 원장 §4-5 대안 A~D 논의 참조).
3. **reserveFloor·thresholdReweight 미이식** — 별도 교리 거동이라 이번 범위에서 제외(위).
4. **L-SAM 미선정 관측 지속** — As-Is에서 LEGACY_HIRES의 단일 L-SAM이 선정되지 않는
   기존 관측(ADR-055 §한계)은 이 Phase의 점수식 변경 후에도 지속된다(후보 자체가 결심
   시점에 실현 불가능 — 선호가 아니라 기하·FC 게이트 문제).
