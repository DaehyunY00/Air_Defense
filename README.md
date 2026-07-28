# K-JAMDS C2 시뮬레이터 — KJADS 3대 문제 상황

> ⚠️ **디스클레이머**: 본 프로젝트의 모든 수치·좌표·확률·범위는 공개자료(오픈소스) 기반의 **정책연구용 개념값**이며, 실제 작전자료가 아닙니다. 모든 좌표는 도시·권역 수준 개념좌표입니다. KP-SAM(신궁)·천마(K-31)는 탄도탄 요격 불가로 모델링합니다. FULL 배치에는 주한미군 THAAD/Patriot이 독립 축으로 존재하지만 KAMDOC와 연동하지 않으며, LEGACY 배치에는 THAAD가 없습니다. **본 모델은 지상배치 방공체계 C2에 한정하며 요격기·해상 자산을 포함하지 않습니다(ADR-060).**

한국형 합동방공체계(K-JAMDS)의 As-Is(분절형) ↔ To-Be(통합형) C2 구조를 비교하고,
시나리오 기반으로 C2 프로세스 병목을 도출·시각화하는 웹 시뮬레이터입니다.
DES(이산사건 시뮬레이션) 엔진이 IADS_C2 계열 물리(SNR/RCS·레이더 수평선·센서상태·PSSEK/PIP)
위에서 책임 C2 결정 → 항적 상관·식별 → 사수선정(WTA) → 승인·협조 → 발사대 단위 교전 → BDA의
**native IADS 파이프라인**을 실행하며, **모든 신규 거동은 기능 플래그(기본 OFF)로 토글**하여
감사 추적을 남깁니다. 2026-07 Phase 6(ADR-061)로 legacy 9단계 파이프라인과 compat 충실도는
폐기되었고, `modelFidelity`는 `iads-c2` 하나입니다.

## 시나리오 — KJADS 구축안 3대 문제 상황 (1:1 재현)

| ID | 문제 상황 | 재현 내용 |
|---|---|---|
| **SC1** | 교전 중복 및 책임 공백 | 동일 침투 항공기·헬기가 수도군단 AOC·공군·수방사 책임구역 **경계 부근** 접근 — 음성 협조 의존에 따른 중복교전·책임공백 위험 |
| **SC2** | 무인기 대응 실패 | 소형 무인기 **8대 동시 남파**(burst, 2022.12.26 확대 재현) — 저고도·저속·저RCS 반복 소실 + 이군종 센서 융합·COP 부재 |
| **SC3** | 전략적 섞어쏘기 | 전투기·무인기·TBM·방사포 **동시 복합 공격** — 처리용량 임계(ρ≥0.9) 초과 구간에서 As-Is↔To-Be 개선폭 정량화 |

## 배치 — 고해상도 6종 (ADR-061: 이것이 전부)

| 배치 ID | 구성 | 용도 |
|---|---|---|
| `HANBANDO_LEGACY_NORMAL` | **기본 배치·주 분석 대상.** legacy 자산 편성(10세트 교차 배치 + 국지방공 + 미사일방어부대)을 고해상도 타입으로 이식(ADR-054) — 천마 5·천궁-II 6·비호 2·L-SAM 1·PAC-3 1 | 주 분석 |
| `HANBANDO_LEGACY_MCRC_DOWN` | 〃 에서 MCRC 파괴 — ABT 책임이 권역 ICC로 전환 | C2 생존성 변형 |
| `HANBANDO_LEGACY_KAMDOC_DOWN` | 〃 에서 KAMDOC 파괴 — 탄도 책임이 권역 ICC로 전환 | 〃 |
| `HANBANDO_FULL_NORMAL` | 전국 84개 포대 확장 배치 + USFK THAAD/Patriot 독립 축 | 규모 민감도 |
| `HANBANDO_FULL_MCRC_DOWN` / `HANBANDO_FULL_KAMDOC_DOWN` | 〃 의 C2 파괴 변형 | 〃 |

- 전투기·이지스·조기경보기·광학감시는 **의도적으로 제외**됩니다(ADR-060 — 지상배치 방공 C2 한정).
- ⚠️ **기본 표적은 서울·오산평택·강릉 3권역뿐입니다** — 남부 배치 자산(대구·부산·광주 등)은
  위협 회랑이 닿지 않아 유휴 상태입니다. `southernAxes`(ADR-064)를 켜면 대구·부산 축선이 추가됩니다.
- 링크 의미론은 codex(IADS_codex) 정본을 따릅니다(ADR-057): 센서→C2 보고주기 차등(GREEN_PINE 16s /
  FPS117 8s / TPS880K 4s / MFR 1s), C2↔C2 1초, To-Be 킬웹 IFCN 전 링크 1초. As-Is 육↔공 협조는
  음성 **절차** 지연(대표 20초, Uniform 10~30 — 전선 성능이 아님)으로 모델링합니다(ADR-058).
- 구 legacy 배치(24+40노드 wire)와 그 L16 12초·KVMF 30초 링크는 ADR-061로 폐기 — 판정 근거는
  `js/data/links.js` 주석과 ADR-057.

지도에서는 동일 좌표의 포대·ECS·MFR을 하나의 공동 사이트 마커(자산 수 배지)로 겹쳐 표시하고,
팝업에서 구성 자산별 역할·범위·부하를 확인할 수 있습니다. 과밀 방지를 위해 C2 연결선은 기본
OFF입니다. Leaflet 없는 SVG fallback도 같은 중첩 표시와 범위 링 토글을 지원합니다.

## 사용 흐름

```
① 시나리오·배치(고해상도 6종)·체계모드(토글)·강도 선택
② [▶ 시뮬레이션 시작] → 지도 위 위협궤적·노드 재고 링 실시간 애니메이션
   (백그라운드: DES 양모드 비교 — iads-c2 물리는 계산량이 커 자동 MC를 생략)
③ 재생 종료(또는 [결과 보기]) → 결과창: 요약·As-Is↔To-Be 비교·
   도출 병목·누수 사유·흐름 funnel·중복교전 위험·노드 관측통계
```

- 체계 모드는 **단일 토글 스위치**(off=As-Is 분절형, on=To-Be 통합형).
- 4개 탭: **[시뮬레이션]**(지도·실행·결과창) · **[분석]**(파이프라인 지표·병목 taxonomy·정상상태 해석) · **[Monte Carlo]**(수렴·유의성·민감도·임계 전환점) · **[근거자료·제약검증]**(파라미터 근거·제약 어서션).

## 실행 방법

정적 웹 페이지이므로 별도 빌드가 필요 없습니다. 두 가지 방법이 있습니다. FULL 배치·Monte
Carlo처럼 계산량이 큰 실행은 **방법 A**를 사용해야 DES·MC·민감도·전환점 계산이 Web Worker로
분리되어 지도와 컨트롤이 계속 반응합니다.

**외부 다운로드가 필요 없습니다.** 지도 라이브러리(Leaflet 1.9.4)는 `vendor/leaflet-1.9.4/`에
동봉돼 있습니다. 인터넷이 필요한 것은 지도 **배경 타일**뿐이며, 타일이 없어도 Leaflet은
정상 초기화되어 자산 마커·범위 링·연결선과 **위협 궤적 재생 애니메이션이 모두 동작**합니다
(배경만 비어 보입니다). `window.L` 자체가 없을 때만 SVG 개념도로 대체되며,
`?svgFallback=1`을 붙이면 그 대체 화면을 일부러 재현할 수 있습니다.

### 방법 A — 로컬 서버 (권장)

```bash
./scripts/serve.sh                 # http://127.0.0.1:8000 접속 (포트 변경: ./scripts/serve.sh 9000)
```

`scripts/serve.sh`는 `python3 -m http.server`를 127.0.0.1에 명시적으로 바인딩합니다. `--bind` 없이
직접 실행하면(특히 macOS) IPv6 주소(`http://[::]:8000/`)가 떠서 클릭해도 안 열리는 경우가 있는데,
이 스크립트를 쓰면 항상 바로 열리는 링크가 출력됩니다. (`python3 -m http.server 8000 --bind 127.0.0.1`도 동일.)

서버 실행에서는 IADS 커널(ES module, `js/model/iads/`)이 모듈로 적재되고, ES module 기반
`js/workers/sim-worker.mjs`가 연산을 전담합니다(구형 환경용 `js/workers/sim-worker.js`는 Classic
Worker 호환 경계). 입력 강도 슬라이더는 120ms 디바운스, FULL 지도는 10fps(LEGACY 30fps)·재고 링
4Hz로 제한해 드래그와 애니메이션의 경합을 줄였습니다. 화면의 `계산 모드`가 `Web Worker`인지
확인하면 됩니다. 모든 실행은 SNR·RCS·레이더 수평선·섹터·센서 4상태, coarse-scan 추적상실
hazard/신선도, 센서별 탐지·추적·FC 거리와 range·aspect PSSEK/PIP, 상관·식별과 명시적 C2 명령
수명주기를 사용합니다(iads-c2가 유일 충실도 — ADR-061).

### 방법 B — 단일 HTML 파일 (서버를 쓸 수 없을 때) 📄

서버를 띄울 수 없는 환경(설치·권한 제약, 폐쇄망, 빠른 공유·오프라인 검토)에서는 저장소 루트의

```
K-JAMDS_시뮬레이터_단일본.html
```

**한 파일을 브라우저로 바로 열면 됩니다**(더블클릭 또는 `file://` 경로). 별도 서버·설치가 필요 없습니다.

- 이 파일은 `index.html` + `css/style.css` + 모든 `js/**` + `vendor/leaflet-1.9.4/**`를 인라인한
  **완전 자기완결(self-contained)** 빌드로, 외부 파일·CDN 의존이 없습니다.
- IADS 커널은 단일본에서 **IIFE 번들로 동봉**됩니다(ADR-061 — file://는 ES module import가
  차단되므로 빌드가 모듈 8종을 텍스트 번들). IIFE 커널 실행은 모듈 커널과 **bit-exact**임이
  기준선 6케이스로 검증되었습니다.
- `file://` 단일본은 외부 Worker 파일을 불러올 수 없어 동일한 결정론 계산을 메인 스레드 폴백으로
  실행하고, UI 정지를 막기 위해 자동 Monte Carlo를 생략합니다. 가벼운 검토·공유에는 적합하지만
  FULL/MC 실행은 `./scripts/serve.sh` 기반 다중 파일 실행을 사용해야 합니다.
- 지도 **타일**만 인터넷이 있어야 표시됩니다. 나머지 모든 기능은 오프라인에서 동일하게 동작합니다.
- 소스(`index.html`/`css`/`js`)를 수정한 뒤에는 아래로 단일본을 재생성합니다:

  ```bash
  node scripts/build-single.mjs      # → K-JAMDS_시뮬레이터_단일본.html 갱신
  ```

  빌드는 **현재 소스만으로** 결정론적으로 동작합니다(`index.html` + `css/` + `js/` + `vendor/`).

> 📘 **처음 사용한다면**: [`docs/사용자_가이드.html`](docs/사용자_가이드.html) — 실행법·화면 조작·
> 지표 읽는 법(일상어)·자주 오해되는 지표·FAQ.
>
> 📐 **모델 내부가 궁금하다면**: [`docs/모의논리서.html`](docs/모의논리서.html) — IADS_C2 원본에서
> 가져온 것/가져오지 않은 것, As-Is/To-Be C2 파이프라인 다이어그램, 지표 계산식 전체, V&V 장치, 한계.
>
> 📊 **실험 결과**: [`docs/실험보고서.html`](docs/실험보고서.html) — paired MC(30 seed) As-Is↔To-Be
> 비교(v3 재실측), ADR-056~059 단독 효과 공개, G6 결론 재산출.

## native IADS C2 파이프라인 + 정책 계층 이식 (ADR-056~059)

DES 엔진(`js/engine/sim-engine.js`)은 개별 위협 객체를 이벤트 구동으로 흘려보내
**관측** 이용률·대기열·드롭·격추/누수를 수집합니다(C2 노드는 M/M/c/K 대기행렬 — 서버 c·지수 서비스·용량 K 초과 시 드롭).

```
센서 스캔(SNR/RCS·수평선·섹터) → 항적 생성·상관·식별 → 책임 C2 결정(위협종류×아키텍처×생존상태)
  → 승인·협조(ADR-058: LOCAL_AD 축 승인 계선·위임) → 사수선정 WTA(ADR-059: 모드 차등)
  → PIP/PSSEK·발사대 탄약/재장전 → 교전(SLS 최대 2발) → BDA → 재교전/누출 분류
```

legacy C2 이론은 **정책 계층으로 이식**되었고, 전부 기능 플래그(기본 OFF)입니다:

| 플래그 (기본 OFF) | 내용 | ADR |
|---|---|---|
| `unifiedEngagementState` | To-Be 통합 교전상태(양방향 COP) — 중복해소 결함 수정 | ADR-056 |
| `linkSemanticsV2` | codex 정합 링크 의미론(보고주기 차등·C2 1초·킬웹 IFCN 1초) | ADR-057 |
| `approvalChain` (+반증 `approvalChainTobe`) | As-Is 승인 계선(KAOC→MCRC coord 홉 + 승인 서비스 + 동적 위임), USFK 제외 | ADR-058 |
| `nativeWtaMode` (+반증 `nativeWtaCostAsis`) | WTA 모드 차등 — As-Is는 관측 가능한 것만(자기 탄약·부하), To-Be는 물리 점수×비용 인식 | ADR-059 |
| `c2OperatorLevel` ('high'/'low') | 운용자 처리시간 스윕 노브 | ADR-058 |
| `threatTargetDispersion` (+반경 `targetSpreadKm`) | 표적권역 산포 — 위협마다 착탄점을 권역(반경 15km 개념) 안에서 추첨. 끄면 같은 축선의 모든 위협이 정확히 같은 한 점으로 향한다 | ADR-063 |
| `southernAxes` | 남부 종심 축선 2종(대구 306km·부산 400km) — SC3에 종심 위협 추가. 끄면 표적은 서울·오산평택·강릉 3권역뿐이라 남부 배치 자산이 유휴 상태다 | ADR-064 |

- 모든 무작위성은 `seed` 기반 Mulberry32에서만 나오고, 도착·센서 스트림을 분리(CRN)해
  As-Is↔To-Be가 **같은 위협열**을 마주하게 합니다 → **동일 config는 항상 동일 결과**(재현성·딥링크 공유·짝지은 비교).

## 감사 추적 방법론 — "고쳤더니 좋아졌다"는 비판의 방어

단계별 개선이 결론을 유리하게만 움직이지 않았음을 **정량 감사**로 증명합니다(감사 이력은 ADR과 커밋 로그가 원장입니다).

- **기능 플래그 + OFF bit-exact**: 모든 개선은 토글 가능하며, 플래그 OFF는 기준선 지문과 완전
  일치해야 합니다. 폐기 이후의 기준선은 `tests/hires-baseline.json`(이관 시점 SHA-256 6케이스 —
  ADR-061: "개선 이전" 증명이 아니라 "이관 후 회귀 없음" 증명으로 의미가 약해졌음을 명시).
- **2-베이스 편향 원장(bias ledger)**: 각 플래그를 주 베이스({056+057 ON})와 전-OFF 참조 베이스
  양쪽에서 토글해 지표 이동을 기록 — 낡은 기준선이 효과를 3~4배 부풀리는 것을 실측으로 노출.
- **반증 실험(falsification)**: "정의상 To-Be만 좋아지는" 변경은 As-Is에도 동일 로직을 적용한
  반사실 실행과 비교합니다. **정직 기록**: legacy의 반증 결론("자원 절약은 비용 인식 로직에서
  나온다")은 native에서 **재현되지 않았습니다** — 비용항의 단독 효과가 사실상 0이고, 보존율
  차이는 교전 기회의 양·기하에서 나옵니다(ADR-059 §반증 결론).
- **에스컬레이션**: 어떤 변경이 To-Be 개선폭을 20% 이상(상대) 움직이면 보고서 최상단에 🔴로 명시.
- **핵심 결론 불변(G6)**: 모든 변경 후에도 ①협조·승인이 As-Is 핵심 병목, ②To-Be 병목이
  무기체계로 이동, ③무인기 비용 비대칭 미해소(exchangeSat≫1), ④신궁·천마 탄도탄 불가 —
  **4종이 유지**되어야 정상. 하나라도 뒤집히면 결함 수정이 아니라 모델 붕괴로 간주합니다.
- **결정 기록(ADR)**: 설계가 갈린 지점마다 `docs/adr/` — 맥락·선택지·결정·근거·결론 영향(수치)·되돌리는 법.

## 프로젝트 구조

```
index.html                       # 진입점: 탭 구조·컨트롤·디스클레이머
K-JAMDS_시뮬레이터_단일본.html    # ★ 자기완결 단일본(서버 없이 실행, IIFE 커널 동봉) — build-single.mjs로 재생성
css/style.css                    # 레이아웃·테마
js/
  config/ system-types.js · geo-mdl.js · deployments.js · deployment-adapter.js
         # 고해상도 체계 타입 · MDL 개념 벨트 · 배치 6종 · C2/센서/사수/링크 catalog
         #   (FULL 3종 + LEGACY_HIRES 3종 — ADR-054·055·061. 변형 카탈로그: linkV2/appr/opLevel)
  data/  nodes.js · links.js · threats.js · scenarios.js · axes.js
         # nodes/links는 ADR-061로 빈 stub(legacy 배치 폐기 기록 보존) · 위협·시나리오·축선 좌표
  core/  router.js · constraints.js · rng.js · heap.js · sim-worker-client.js
         # 딥링크 · 제약 어서션(고해상도 정본) · RNG/힙 · Worker 라우팅/단일본 폴백
  analysis/  bottleneck.js · mc-runner.js · overlap-heatmap.js · transition.js · c2-report.js
  engine/  sim-engine.js         # ★ DES: native IADS 파이프라인·M/M/c/K·책임 C2·WTA·PIP·발사대·BDA
  model/iads/                    # IADS_C2 공통 커널 ES modules (event-queue·rng-substream·물리·
                                 #  sensor/track/engagement/c2-agent·c2-policy(ADR-058))
  workers/ sim-worker.mjs · sim-worker.js
  ui/    map-view.js · panels.js · sim-view.js · mc-panel.js · geo.js · table-sort.js
  main.js                        # 부트스트랩·상태 관리 (해시 = 상태 단일원천)
docs/
  모의논리서.html · 사용자_가이드.html · 실험보고서.html    # ★ 3대 문서 (아래 참조)
  params.md                      # 파라미터 근거표 (ID·출처·인용·신뢰도 A/B/C)
  high-resolution-iads-architecture.md  # 목표 아키텍처(§6은 ADR-061로 개정)
  compat-retirement-readiness.md # Phase 5 폐기 조건 판정 원장
  adr/ADR-001~009, 036, 049~063  # 결정 기록
scripts/
  serve.sh · build-single.mjs · bias-ledger.mjs · experiment-lib/run/report.mjs 등
tests/  run-all.js + 27개 스위트  # 아래 [검증] 참조. 폐기 스위트 원장: tests/retired-legacy-suites.md
```

## 설계 원칙: 병목은 고정이 아니라 도출된다

병목 위치는 하드코딩되지 않습니다. **시나리오 부하(λ)·모드별 토폴로지·노드 처리용량(M/M/c/K)**
로부터 계산하며, 시나리오·강도·모드·seed를 바꾸면 병목 위치가 함께 바뀝니다.

- **해석적(`analysis/bottleneck.js`)**: 부하를 그래프에 전파해 정상상태 M/M/c(Erlang-C) ρ·Wq — 빠른 개략 분석.
- **DES(`engine/sim-engine.js`)**: 개별 위협을 이벤트 구동으로 흘려 **관측** 이용률·대기열·드롭·격추/누수 수집 — 실증적 병목·결과지표.

임계값(주의 ρ≥0.7, 병목 ρ≥0.9, 포화=드롭 발생 — 근거 `docs/params.md` ENV-RHO-THRESH-01)을 초과하는 지점을 병목으로 **도출**합니다.

## 딥링크 스킴

`#tab=<sim|analysis|mc|data>&sc=<시나리오ID>&mode=<asis|tobe>&dep=<배치ID>&appr=<0|1>&disp=<0|1>&south=<0|1>&x=<강도배수>&seed=<정수>&dur=<초>`

- `dep`은 고해상도 6종 ID(기본 `HANBANDO_LEGACY_NORMAL`). 구 딥링크의 `dep=legacy`·MINI ID·
  `fid=` 파라미터는 기본값으로 자동 흡수됩니다(ADR-061).
- `south=1`은 **남부 종심 축선**(ADR-064)을 켭니다(기본 0) — SC3에 대구·부산 표적이 추가되어
  남부 배치 자산이 교전에 참여합니다(FULL 기준 발사 사수 10→15문).
- `appr=1`은 **승인 계선 모델**(ADR-058)을 켭니다(기본 0). 끄면 ⑥⑦ 승인·협조 지표가 0이
  아니라 **"미측정"**으로 표시됩니다(ADR-062) — 상단 컨트롤의 체크박스와 같은 스위치입니다.
- `disp=1`은 **표적권역 산포**(ADR-063)를 켭니다(기본 0). 끄면 같은 축선의 모든 위협이 seed와
  무관하게 정확히 같은 한 점으로 향합니다. ⚠️ 산포는 표적권역 **내부**만 다양화하며 새 표적
  (부산·대구 등)을 만들지 않습니다 — 그것은 축선 추가(별도 사안)의 몫입니다.
- 구 `tab=map|scenario|des|playback`은 `sim` 탭으로 흡수됩니다.
- [`#tab=sim&sc=sc3&mode=asis&x=1.5&seed=12345`](index.html#tab=sim&sc=sc3&mode=asis&x=1.5&seed=12345) — 섞어쏘기 As-Is 1.5배.
- [`#tab=analysis&sc=sc1&mode=asis`](index.html#tab=analysis&sc=sc1&mode=asis) — 경계 침투 해석 분석.
- [`#tab=mc&sc=sc3&mode=asis&x=2`](index.html#tab=mc&sc=sc3&mode=asis&x=2) — Monte Carlo·임계 전환점.

## 검증

```bash
node tests/run-all.js            # 전체 회귀 — js/ 구문검증 + 27개 스위트 (CI 게이트)
```

| 스위트 | 검증 내용 |
|---|---|
| `engine` · `mc` · `overlap` · `transition` | DES 재현성·극한값·보존·trace / MC 수렴·유의성 / 중복교전 히트맵 / 임계 전환점 (전부 native 이관) |
| `constraints` | 제약 a~g — 신궁·천마 탄도탄 불가(데이터+행위), THAAD 부재, 디스클레이머, 개념좌표, ADR-060 범위, 협조 지연 정박점, runConstraintChecks |
| `hires-baseline` | **ADR-061 기준선** — 이관 시점 지문 6케이스 SHA-256 |
| `deployment` · `deployment-adapter` · `high-resolution-connection` | 배치 6종 선언·수량 / 카탈로그 토폴로지·DOWN·결정론·보존 / ICC 승인경로 |
| `iads-kernel` · `iads-native-pipeline` · `c2a-asis` | 커널(이벤트 큐·RNG·센서 물리) / 책임 C2·WTA·PIP·발사대·BDA / 군단 AOC C2A |
| `iads-failure-realism` · `failure-classification` · `metrics-accounting` · `c2-analysis` | 실패 현실성(SLS 2발) / 실패 분류 v2 / 지표 계정 / C2 계측·paired MC |
| `legacy-hires-deployment` | LEGACY_HIRES 편성·물리 동작·DOWN 대체·**legacy/compat 거부(ADR-061)** |
| `engagement-state-unification` · `link-semantics` · `approval-chain` · `native-wta` | ADR-056~059 플래그별 OFF bit-exact·ON 거동·반증 |
| `target-dispersion` · `southern-axes` | ADR-063 표적권역 산포(균등원판·스트림 분리·권역 무결성) / ADR-064 남부 종심 축선(coverage 파생 분리·사거리 정합·체공 환산) |
| `analysis-metric-honesty` | ADR-062 분석 탭 지표 정직성 — 死 지표 제거 근거(포화에도 사수 Wq=0)·"미측정" 표기·승인계선 토글 배선·OFF bit-exact |
| `target-dispersion` | ADR-063 표적권역 산포 — OFF bit-exact·균등원판 분포·seed 의존성·도착 스트림 분리·권역 무결성·제약 불변 |
| `map-visualization` · `ui-performance` · `vendor-leaflet` · `overlap-performance` | 지도 렌더 정합(카탈로그 기준) / Worker·범례 / Leaflet 동봉 무결성 / FULL 성능 |

폐기된 legacy 스위트 16종의 목록·사유·대체 커버리지는 **`tests/retired-legacy-suites.md`** 원장 참조.

### As-Is ↔ To-Be 비교 실험 (재현 가능)

시나리오(SC1~3) × 배치 × 기능 플래그 조합에서 **동일 seed로 짝지은(paired) 복제**를 실행하고,
seed별 Δ(To-Be−As-Is)의 95% CI로 구조 차이를 판정합니다.

```bash
node scripts/experiment-run.mjs --cell "sc3|HANBANDO_LEGACY_NORMAL|iads-c2|1.5|30"   # 셀 1개
node scripts/experiment-run.mjs --cell "..." --features '{"unifiedEngagementState":true}'
node scripts/experiment-report.mjs && node scripts/build-experiment-pdf.mjs
```

결과는 `artifacts/experiment/*.json`에 남습니다. 정리된 결과는 `docs/실험보고서.html`이 단일
권위입니다. 전 셀이 결정론적이라 동일 명령은 동일 수치를 재현합니다.

> ⚠️ **기록 보존 주의**: 과거 보고서·ADR에 인용된 legacy/compat 셀(구 21셀·15셀 실측)은
> ADR-055(MINI 폐기)·ADR-061(legacy·compat 폐기)로 **더 이상 재현할 수 없는 측정 당시의
> 기록**입니다. 현재 재현 가능한 조합은 고해상도 배치 6종 × iads-c2 × 기능 플래그입니다.

주요 결과(v3 주 베이스, paired 30 seed — `docs/실험보고서.html`): SC3 포화에서 To-Be 격추율
+20pp 안팎·결심지연 −46초 안팎의 유의 개선, SC1 저부하는 개선 미분리(n.s.) 셀 존재.
As-Is 협조몫 19~35초·승인 Wq 36.8초(ADR-058 원장) — **G6 ① As-Is 병목=협조·승인**의 native 증거.
exchangeSat는 전 셀 4.7~20.6(≫1)로 **③ 무인기 비용 비대칭 미해소** 유지.

### 고해상도 결과의 요격 실패율 읽기

결과 모달은 `격추`, `확정 누출`, `관측 종료 미해결`을 전체 생성 위협 기준으로 따로 표시합니다.
`global.killRate/leakRate`는 종료 시점 미해결을 제외한 **해결분 기준** 파생지표이므로, 전체 생성
기준 비율과 구분해야 합니다. native 경로는 무한 재교전을 막기 위해 표적당 전 책임 C2 축 합산
최대 2발을 발사합니다. 경도·위도 진행률과 체공시간은 아직 개념 축선/dwell 함수이고 false
merge/split은 포함하지 않습니다(§6 미충족 후속 과제 — ADR-061). 따라서 절대값은 전술 성능치가
아니라 배치·모드 비교값으로만 사용하십시오.

### 통계·시각화 방법론 (요약)

- **Welford 온라인 분산 + 95% CI 수렴판정**(주지표 누수율 CI 반폭 ≤ 허용오차): 근거 계획서 Recommendations 3.
- **통계적 유의성**: As-Is·To-Be를 완전히 같은 seed 집합으로 쌍대복제하고,
  seed별 Δ(To-Be−As-Is)의 95% CI가 0을 제외할 때 구조 차이가 통계적으로 분리된 것으로 판정.
- **C2 병목 귀속**: 선택적 구조화 이벤트(`c2Analysis`)에서 누출 시점의 C2 상태, 노드별
  대기/서비스 분위수와 60초 피크 ρ를 순수 파생. 원시 이벤트는 Worker에서 요약 후 폐기.
- **민감도 스윕(±20% 토네이도)**: 포화 시나리오에서 처리시간·강도가 지배적 → "병목은 처리용량" 진단을 정량 뒷받침.
- **DES trace 모드**·**위협궤적 애니메이션**·**실시간 노드 링**·**자산 범위 링**·**Sankey형 흐름도**·**중복교전 히트맵** — Leaflet은 `vendor/`에 동봉돼 오프라인에서도 동작.

제약조건 어서션(신궁·천마 탄도탄 교전 불가, LEGACY 배치 THAAD 부재·FULL USFK 독립축/KAMDOC
미연동, 디스클레이머 상시 표출, 개념좌표 주석, 전투기류 미포함 — ADR-060 범위)은
**[근거자료·제약검증] 탭**에서 상시 확인됩니다.
