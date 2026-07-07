# K-JAMDS C2 프로세스 병목 분석 시뮬레이터

> ⚠️ **디스클레이머**: 본 프로젝트의 모든 수치·좌표·확률은 공개자료(오픈소스) 기반의 **정책연구용 개념값**이며, 실제 작전자료가 아닙니다. 모든 좌표는 도시 수준 개념좌표입니다. KP-SAM(신궁)·천마(K-31)는 탄도탄 요격 불가로 모델링하며, KAMDOC↔THAAD 연동은 모델링하지 않습니다.

한국형 합동방공체계(K-JAMDS)의 As-Is(분절형) ↔ To-Be(통합형) C2 구조를 비교하고,
시나리오 기반으로 C2 프로세스 병목을 도출·시각화하는 웹 시뮬레이터입니다.

## 실행 방법

정적 웹 페이지이므로 별도 빌드가 필요 없습니다.

```bash
# 로컬 서버 실행 (권장 — 타일 로딩 CORS 회피)
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

외부 의존성은 Leaflet 1.9.4(CDN) 하나뿐입니다. CDN 접근이 불가한 폐쇄망에서는
지도 탭이 자동으로 내장 SVG 개념도로 대체(graceful degradation)되며 나머지 기능은 동일하게 동작합니다.

## 프로젝트 구조 (다중 파일)

```
index.html                  # 진입점: 탭 구조·컨트롤·디스클레이머
css/style.css               # 레이아웃·테마
js/
  data/
    nodes.js                # C2·센서·무기체계 노드 정의 (대기행렬 파라미터 포함)
    links.js                # 모드별(As-Is/To-Be) C2 연결·통신특성
    threats.js              # 위협 유형 (탐지 특성·승인 수준·dwellSec)
    scenarios.js            # 시나리오 (위협 구성·축선·도착률 λ만 정의)
    axes.js                 # (Phase 4) 축선별 진입점→표적권역 개념좌표 (궤적 애니메이션용)
  core/
    router.js               # 딥링크 라우터 (#tab=&sc=&mode=&t=&open=&x=&seed=&dur=)
    constraints.js          # 제약조건 어서션 (신궁·천마 탄도탄 불가 등)
    rng.js                  # (Phase 2) Mulberry32 시드 RNG + 분포 샘플러
    heap.js                 # (Phase 2) 이벤트 큐용 이진 최소힙
  analysis/
    bottleneck.js           # 시나리오 기반 병목 도출 (M/M/c 해석적 정상상태 근사)
    mc-runner.js            # (Phase 3) Monte Carlo: Welford CI 수렴판정·민감도 스윕
    overlap-heatmap.js      # ★ (Phase 4) 축선별 중복교전 위험도 (JAMDC2 융합허브 반영)
  engine/
    sim-engine.js           # (Phase 2) DES 엔진: 9단계 파이프라인·FSM·M/M/c/K·병목 도출
                            # (Phase 4) trace:true 옵트인 시 threatTraces·nodeSeries·flow 추가 기록
  ui/
    geo.js                  # ★ (Phase 4) 공용 위경도→SVG 좌표 투영 (map-view·playback 공유)
    map-view.js             # Leaflet 지도 (개념좌표·링크·병목 하이라이트)
    panels.js               # 시나리오/분석/근거자료 탭 렌더러
    des-panel.js            # (Phase 2) DES 실행·관측통계·As-Is↔To-Be 비교 탭
    mc-panel.js             # (Phase 3) MC 수렴·유의성 비교·민감도 토네이도 탭
    playback-panel.js       # ★ (Phase 4) 재생·시각화: 궤적 애니메이션·대기열·Gantt·funnel·히트맵
  main.js                   # 부트스트랩·상태 관리 (해시 = 상태 단일원천)
docs/
  params.md                 # 파라미터 근거표 (ID·출처·인용·신뢰도 A/B/C·MC 적용방식)
tests/
  engine.test.js            # DES 회귀(재현성·극한값·병목·제약·보존·trace모드)
  mc.test.js                # Monte Carlo 회귀(Welford·샘플러·수렴·유의성·민감도)
  overlap.test.js           # (Phase 4) 중복교전 히트맵 회귀(순수성·스케일링·융합허브 효과)
```

## 모델링 대상 (요구 반영)

| 구분 | 대상 |
|---|---|
| C2 | KAOC, MCRC, KAMDOC(KAMD작전센터), 군단 방공상황실(AOC), JAOC(수방사 합동방공상황실), JAMDC2(To-Be 융합 노드) |
| 관제부대·센서 | 합동대공감시소, 방공관제레이더(동·서부), 저고도 탐지레이더, 국지방공레이더(군단·수방사), E-737 피스아이, 탄도탄 감시레이더(그린파인), 이지스함 레이더(동·서해 SPY-1D) |
| 무기체계 | 전투기(KF-16·F-15K·KF-21 보라매), 단거리방공무기(신궁·천마·비호·벌컨), 미사일방어부대(중거리 천궁-II·PAC-3 / 장거리 L-SAM), 군단 중거리 방공무기, SM-2(동·서해 이지스함) |

## 설계 원칙: 병목은 고정이 아니라 도출된다

병목 위치는 데이터에 하드코딩되어 있지 않습니다. 두 방법이 모두

1. **시나리오**의 위협 도착률(λ)·축선·구성 (`scenarios.js`)
2. **모드별 C2 토폴로지** — As-Is: 육·공 데이터링크 미연동(음성 협조), To-Be: JAMDC2 Track Fusion (`links.js`)
3. **노드 처리용량** — M/M/c/K 대기행렬 (서버 c, 처리시간 μ⁻¹, 용량 K) (`nodes.js`)

로부터 병목을 계산하며, 시나리오·강도·모드·seed를 바꾸면 병목 위치가 함께 바뀝니다:

- **해석적(Phase 1, `analysis/bottleneck.js`)**: 부하를 그래프에 전파시켜 정상상태 M/M/c(Erlang-C)
  이용률 ρ·평균대기 Wq·통신 체류량을 계산 — 빠른 개략 분석.
- **DES(Phase 2, `engine/sim-engine.js`)**: 개별 위협 객체를 이벤트 구동으로 9단계 파이프라인에
  흘려보내 **관측** 이용률·대기열·드롭·격추/누수를 수집 — 실증적 병목·결과지표.

임계값(주의 ρ≥0.7, 병목 ρ≥0.9, 포화=드롭 발생, 통신병목 지연≥60s이고 체류≥1건 — 근거:
`docs/params.md` ENV-RHO-THRESH-01)을 초과하는 지점을 병목으로 **도출**합니다.

### DES 9단계 C2 파이프라인 (Phase 2)

계획서 Key Findings 1의 보완형(협조/권한위임 서브단계 + BDA 재교전 피드백):

```
1 탐지 → 2 추적생성 → 3 식별 → 4 위협평가 → 5 WTA → 6 결심
        → 7 교전협조/권한위임 → 8 교전/요격명령 → 9 BDA ─(실패)─▶ 재교전(폐루프)
```

- 각 C2·무기 노드는 M/M/c/K 서버풀(서버 c개, 지수 서비스, 용량 K 초과 시 드롭=누수).
- As-Is는 육↔공 미연동으로 교전승인권자까지 음성 coord 홉(180초) — 중복·지연·책임공백의 원천.
- To-Be는 JAMDC2에서 융합·AI 식별·무기배정을 집중 처리하고, 위협별 자동화 차등(사전승인 자동교전)으로
  결심·협조 홉을 생략.
- 모든 무작위성은 `seed` 기반 Mulberry32에서만 나오고 이벤트 동시성은 (시각, 우선순위, 삽입순서)로
  결정론적으로 해소 → **동일 config는 항상 동일 결과**(재현성·딥링크 공유).

## 딥링크 스킴

`#tab=<map|scenario|analysis|des|mc|playback|data>&sc=<시나리오ID>&mode=<asis|tobe>&t=<재생초>&open=<노드ID>&x=<강도배수>&seed=<정수>&dur=<초>`

- 예: [`#tab=analysis&sc=sc3&mode=asis&x=1.5`](index.html#tab=analysis&sc=sc3&mode=asis&x=1.5) — 섞어쏘기 포화공격 As-Is 강도 1.5배 해석 분석.
- 예: [`#tab=des&sc=sc3&mode=asis&x=2&seed=12345&dur=1800`](index.html#tab=des&sc=sc3&mode=asis&x=2&seed=12345&dur=1800) — 동일 시나리오의 DES 실행(seed 고정 → 재현 가능).
- 예: [`#tab=playback&sc=sc3&mode=asis&x=1.5&seed=777&t=120`](index.html#tab=playback&sc=sc3&mode=asis&x=1.5&seed=777&t=120) — 재생 탭에서 120초 시점으로 즉시 이동(정지 상태로 1프레임 렌더).

`t=`는 재생 탭의 스크러버 위치(초)이며, 재생 중 500ms 간격으로 자동 동기화된다(다른 탭에서는 보존만).

## Phase 로드맵

- [x] **Phase 1 — 스캐폴딩**: 다중 파일 구조, Leaflet 지도, 탭·딥링크, 데이터 모델, 시나리오 기반 병목 도출 프레임워크(정상상태 M/M/c 근사), 제약 어서션
- [x] **Phase 2 — DES 엔진**: 이벤트 큐(이진 min-heap), 시뮬레이션 클록, 위협/노드 FSM, 9단계 C2 파이프라인, M/M/c/K 대기열, seeded RNG(Mulberry32)+분포 샘플러, DES 실행 UI·As-Is↔To-Be 비교, 재현성·극한값 회귀 테스트
- [x] **Phase 3 — Monte Carlo**: Welford 스트리밍 평균/분산, 95% CI 수렴판정, 다중복제 신뢰구간, As-Is↔To-Be 통계적 유의성(CI 비중첩), 파라미터 ±20% 민감도 스윕(토네이도), 분포 샘플러 이론값 수렴 테스트
- [x] **Phase 4 — 시각화 고도화**: DES trace 모드(위협별 9단계 타임스탬프·노드별 재고 시계열), 위협궤적 애니메이션(requestAnimationFrame, 60fps), 대기열·노드 실시간 막대/링, Gantt 타임라인, Sankey형 흐름도(funnel), 축선별 중복교전 히트맵(As-Is↔To-Be), 딥링크 재생시각 동기화
- [x] **Phase 5 — 통합검증·문서화** (완료): 통합 회귀 스위트(`tests/run-all.js`, 115 어서션 + 구문검증), 제약 어서션 헤드리스화(Rec.5 a~e, 데이터+행위 이중검증), **임계 전환점 분석**(Rec.6 — ρ≥0.9 돌파 구간의 As-Is↔To-Be 개선폭 정량화, `js/analysis/transition.js` + MC 탭 카드), Phase 4 적대적 코드리뷰·수정 6건, V&V 보고서(`docs/vv-report.md` — 9단계↔F2T2EA/OODA/TEWA 매핑표·극한값·민감도·2022.12.26 face validity·한계)

## 검증

```bash
# 전체 회귀 스위트 — 단일 진입점 (구문검증 + 5개 스위트 115 어서션, CI 게이트)
node tests/run-all.js

# 개별 실행
node tests/engine.test.js      # DES: 재현성·극한값·시나리오 병목·보존·trace모드
node tests/mc.test.js          # MC: Welford·샘플러 이론값 수렴·CI 축소·유의성·민감도
node tests/overlap.test.js     # 중복교전 히트맵: 순수성·스케일링·JAMDC2 융합허브
node tests/transition.test.js  # 임계 전환점: Rec.6 — ρ≥0.9 구간 개선폭
node tests/constraints.test.js # 제약 어서션: Rec.5 a~e (데이터+행위 이중검증)
```

테스트는 `window.KJ` 네임스페이스를 Node에서 로드해 실행합니다. 브라우저에서는
**[DES 시뮬레이션] 탭**(단일 복제 관측통계·As-Is↔To-Be 비교), **[Monte Carlo] 탭**
(수렴판정·신뢰구간·통계적 유의성·민감도 토네이도·**임계 전환점**), **[재생·시각화] 탭**
(궤적 애니메이션·실시간 대기열·Gantt·흐름도·히트맵)에서 대화형으로 확인합니다.
V&V 종합(매핑표·검증 이력·타당성·한계)은 **`docs/vv-report.md`** 참조.

### 통계 방법론 (Phase 3)

- **Welford 온라인 분산**: 매 복제마다 평균·표본분산을 스트리밍 갱신, 수치적으로 안정.
- **수렴판정**: 주지표(누수율) 95% CI 반폭 = z·s/√n 이 허용오차(기본 1%p) 이하로 떨어지면 정지
  (최소 30회 보장, 상한까지 미수렴 시 상한 정지). 근거: 계획서 Recommendations 3.
- **통계적 유의성**: As-Is·To-Be를 동일 baseSeed 파생 독립 시드로 각각 복제해, 두 95% CI가
  겹치지 않으면 개선이 표본변동으로 설명되지 않는 유의한 차이로 판정.
- **민감도 스윕**: 처리시간·통신지연·탐지확률·요격확률·위협강도를 각각 ±20% 스케일해 누수율
  변동을 측정(토네이도). 포화 시나리오에서 탐지확률 영향이 미미한 반면 처리시간·강도가 지배적이라는
  결과는 "병목은 처리용량"이라는 진단을 정량적으로 뒷받침한다.

### 재생·시각화 방법론 (Phase 4)

- **DES trace 모드**: `KJ.runDES({..., trace:true, traceCap:300})`가 기존 통계는 그대로 두고
  (부수효과 없음 — trace on/off 결과가 통계상 완전 동일함을 회귀 테스트로 검증) 위협별 9단계
  타임스탬프(`threatTraces`, 최대 300건 절삭)와 노드별 재고 시계열(`nodeSeries`)을 추가로 반환한다.
- **위협궤적 애니메이션**: 시나리오의 축선(west/central/east/seoul)에 `data/axes.js`의 진입점→
  표적권역 개념좌표를 부여하고, 위협의 `dwellSec` 대비 경과시간으로 선형보간한다. 마커 DOM 엘리먼트는
  실행당 1회만 생성하고 매 프레임은 좌표·투명도 속성만 갱신 — 60fps 목표를 위한 핵심 설계.
- **실시간 대기열/노드 링**: `nodeSeries`를 이진탐색해 현재 재생시각의 재고/용량(K) 비율을 즉시 조회.
- **Gantt**: 위협별 스테이지 타임스탬프 사이 구간을 색상별로 표시(탐지·보고전달·C2처리·협조/승인·
  교전명령·교전결과·누수). 특정 위협이 어느 단계에서 오래 머물렀는지(예: KAOC 승인 대기) 시각적으로 드러난다.
- **Sankey형 흐름도**: 표본이 아닌 **전체 실행 결과**(`result.flow`)의 단계별 손실(생성→탐지→C2도달→
  교전개시→격추, 손실 = 직전 단계와의 차)을 표시 — 정확도를 위해 애니메이션과 분리된 정적 집계.
- **중복교전 히트맵**(`analysis/overlap-heatmap.js`): 동일 위협클래스를 교전 가능한 서로 다른 통제계통이
  협조지연 내에 제때 협조할 수 없는 조합 수 × 시나리오 부하(λ)를 축선별로 합산. coord 링크 그래프
  BFS에 JAMDC2(Track Fusion) 융합허브 특례를 두어(report 유입+coord 유출을 협조경로로 인정), 엔진의
  실제 융합 동작과 일치시켰다 — 특례 없이는 To-Be의 실제 개선 효과가 히트맵에 드러나지 않았음(회귀 테스트로 고정).

제약조건 어서션(신궁·천마 탄도탄 교전 불가, THAAD 미모델링, 디스클레이머 상시 표출,
개념좌표 주석, KF-21 보라매 표기)은 앱 내 **[근거자료·제약검증] 탭**에서 상시 확인됩니다.
