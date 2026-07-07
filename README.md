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
    threats.js              # 위협 유형 (탐지 특성·승인 수준)
    scenarios.js            # 시나리오 (위협 구성·축선·도착률 λ만 정의)
  core/
    router.js               # 딥링크 라우터 (#tab=&sc=&mode=&t=&open=&x=)
    constraints.js          # 제약조건 어서션 (신궁·천마 탄도탄 불가 등)
  analysis/
    bottleneck.js           # ★ 시나리오 기반 병목 도출 (M/M/c 해석적 근사)
  ui/
    map-view.js             # Leaflet 지도 (개념좌표·링크·병목 하이라이트)
    panels.js               # 시나리오/분석/근거자료 탭 렌더러
  main.js                   # 부트스트랩·상태 관리 (해시 = 상태 단일원천)
docs/
  params.md                 # 파라미터 근거표 (ID·출처·인용·신뢰도 A/B/C·MC 적용방식)
```

## 모델링 대상 (요구 반영)

| 구분 | 대상 |
|---|---|
| C2 | KAOC, MCRC, KAMDOC(KAMD작전센터), 군단 방공상황실(AOC), JAOC(수방사 합동방공상황실), JAMDC2(To-Be 융합 노드) |
| 관제부대·센서 | 합동대공감시소, 방공관제레이더(동·서부), 저고도 탐지레이더, 국지방공레이더(군단·수방사), E-737 피스아이, 탄도탄 감시레이더(그린파인), 이지스함 레이더(동·서해 SPY-1D) |
| 무기체계 | 전투기(KF-16·F-15K·KF-21 보라매), 단거리방공무기(신궁·천마·비호·벌컨), 미사일방어부대(중거리 천궁-II·PAC-3 / 장거리 L-SAM), 군단 중거리 방공무기, SM-2(동·서해 이지스함) |

## 설계 원칙: 병목은 고정이 아니라 도출된다

병목 위치는 데이터에 하드코딩되어 있지 않습니다. `js/analysis/bottleneck.js`가

1. **시나리오**의 위협 도착률(λ)·축선·구성 (`scenarios.js`)
2. **모드별 C2 토폴로지** — As-Is: 육·공 데이터링크 미연동(음성 협조), To-Be: JAMDC2 Track Fusion (`links.js`)
3. **노드 처리용량** — M/M/c 대기행렬 (서버 수 c, 처리시간 μ⁻¹) (`nodes.js`)

로부터 부하를 그래프에 전파시켜 이용률 ρ·평균대기 Wq·통신지연·탐지/교전 공백을 계산하고,
임계값(주의 ρ≥0.7, 병목 ρ≥0.9, 포화 ρ≥1.0, 통신병목 지연≥60s — 근거: `docs/params.md` ENV-RHO-THRESH-01)을
초과하는 지점을 병목으로 **도출**합니다. 시나리오·강도 슬라이더·모드를 바꾸면 병목 위치가 함께 바뀝니다.

## 딥링크 스킴

`#tab=<map|scenario|analysis|data>&sc=<시나리오ID>&mode=<asis|tobe>&t=<초>&open=<노드ID>&x=<강도배수>`

예: [`#tab=analysis&sc=sc3&mode=asis&x=1.5`](index.html#tab=analysis&sc=sc3&mode=asis&x=1.5) — 섞어쏘기 포화공격, As-Is, 강도 1.5배의 병목 분석.
`t=`는 Phase 2 DES 시뮬레이션 시각용 예약 파라미터입니다.

## Phase 로드맵

- [x] **Phase 1 — 스캐폴딩** (현재): 다중 파일 구조, Leaflet 지도, 탭·딥링크, 데이터 모델, 시나리오 기반 병목 도출 프레임워크(정상상태 M/M/c 근사), 제약 어서션
- [ ] **Phase 2 — DES 엔진**: 이벤트 큐(min-heap), 위협/노드 FSM, 9단계 C2 파이프라인, seeded RNG
- [ ] **Phase 3 — Monte Carlo**: Welford 수렴판정, 분포 샘플러(삼각/로그정규/지수/포아송), 민감도 스윕
- [ ] **Phase 4 — 시각화 고도화**: 위협궤적 애니메이션, Gantt/Sankey/히트맵
- [ ] **Phase 5 — 통합검증·문서화**: V&V, 회귀 스위트

## 검증

```bash
# JS 구문 검증 (Phase 1 종료 게이트)
for f in $(find js -name '*.js'); do node --check "$f"; done
```

제약조건 어서션(신궁·천마 탄도탄 교전 불가, THAAD 미모델링, 디스클레이머 상시 표출,
개념좌표 주석, KF-21 보라매 표기)은 앱 내 **[근거자료·제약검증] 탭**에서 상시 확인됩니다.
