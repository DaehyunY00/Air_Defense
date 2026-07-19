# K-JAMDS C2 시뮬레이터 — KJADS 3대 문제 상황

> ⚠️ **디스클레이머**: 본 프로젝트의 모든 수치·좌표·확률·범위는 공개자료(오픈소스) 기반의 **정책연구용 개념값**이며, 실제 작전자료가 아닙니다. 모든 좌표는 도시·권역 수준 개념좌표입니다. KP-SAM(신궁)·천마(K-31)는 탄도탄 요격 불가로 모델링합니다. 고해상도 FULL 배치에는 주한미군 THAAD/Patriot이 독립 축으로 존재하지만 KAMDOC와 연동하지 않으며, legacy 기본 배치에는 THAAD가 없습니다.

한국형 합동방공체계(K-JAMDS)의 As-Is(분절형) ↔ To-Be(통합형) C2 구조를 비교하고,
시나리오 기반으로 C2 프로세스 병목을 도출·시각화하는 웹 시뮬레이터입니다.
DES(이산사건 시뮬레이션) 엔진 위에서 9단계 F2T2EA 파이프라인(탐지→…→BDA→재교전)을
단계별로 정밀화하고, **모든 개선을 기능 플래그로 토글·되돌릴 수 있게** 하여 감사 추적을 남깁니다.

## 시나리오 — KJADS 구축안 3대 문제 상황 (1:1 재현)

| ID | 문제 상황 | 재현 내용 |
|---|---|---|
| **SC1** | 교전 중복 및 책임 공백 | 동일 침투 항공기·헬기가 수도군단 AOC·공군·수방사 JAOC 책임구역 **경계 부근** 접근 — 음성 VTC 협조 의존에 따른 중복교전·책임공백 위험 |
| **SC2** | 무인기 대응 실패 | 소형 무인기 **8대 동시 남파**(burst, 2022.12.26 확대 재현) — 저고도·저속·저RCS 반복 소실 + 이군종 센서 융합·COP 부재 |
| **SC3** | 전략적 섞어쏘기 | 전투기·무인기·TBM·방사포 **동시 복합 공격** — 처리용량 임계(ρ≥0.9) 초과 구간에서 As-Is↔To-Be 개선폭 정량화 |

## 사용 흐름

```
① 시나리오·배치(legacy 또는 6개 MINI/FULL)·체계모드(토글)·강도 선택
② [▶ 시뮬레이션 시작] → 지도 위 위협궤적·노드 재고 링 실시간 애니메이션
   (백그라운드: DES 양모드 비교 + Monte Carlo 수렴)
③ 재생 종료(또는 [결과 보기]) → 결과창: 요약·As-Is↔To-Be 비교·MC 95% CI·
   도출 병목·누수 사유·단계별 funnel·중복교전 위험·노드 관측통계
```

- 체계 모드는 **단일 토글 스위치**(off=As-Is 분절형, on=To-Be 통합형).
- 4개 탭: **[시뮬레이션]**(지도·실행·결과창) · **[분석]**(9단계 파이프라인 지표·병목 taxonomy·정상상태 해석) · **[Monte Carlo]**(수렴·유의성·민감도·임계 전환점) · **[근거자료·제약검증]**(파라미터 근거·제약 어서션).

## 실행 방법

정적 웹 페이지이므로 별도 빌드가 필요 없습니다. 두 가지 방법이 있습니다. 고해상도 배치·Monte
Carlo처럼 계산량이 큰 실행은 **방법 A**를 사용해야 DES·MC·민감도·전환점 계산이 Web Worker로
분리되어 지도와 컨트롤이 계속 반응합니다.

### 방법 A — 로컬 서버 (권장)

```bash
./scripts/serve.sh                 # http://127.0.0.1:8000 접속 (포트 변경: ./scripts/serve.sh 9000)
```

`scripts/serve.sh`는 `python3 -m http.server`를 127.0.0.1에 명시적으로 바인딩합니다. `--bind` 없이
직접 실행하면(특히 macOS) IPv6 주소(`http://[::]:8000/`)가 떠서 클릭해도 안 열리는 경우가 있는데,
이 스크립트를 쓰면 항상 바로 열리는 링크가 출력됩니다. (`python3 -m http.server 8000 --bind 127.0.0.1`도 동일.)

서버 실행에서는 `js/workers/sim-worker.js`가 연산을 전담합니다. 입력 강도 슬라이더도 120ms로
디바운스하고, FULL 지도는 수백 개 객체를 10fps(legacy/MINI 30fps), 재고 링을 4Hz로 제한해
드래그·지도 조작과 애니메이션의 경합을 줄였습니다. 결과 계산식·seed·wire shape는 바뀌지 않습니다.

### 방법 B — 단일 HTML 파일 (서버를 쓸 수 없을 때) 📄

서버를 띄울 수 없는 환경(설치·권한 제약, 폐쇄망, 빠른 공유·오프라인 검토)에서는 저장소 루트의

```
K-JAMDS_시뮬레이터_단일본.html
```

**한 파일을 브라우저로 바로 열면 됩니다**(더블클릭 또는 `file://` 경로). 별도 서버·설치가 필요 없습니다.

- 이 파일은 `index.html` + `css/style.css` + 모든 `js/**`를 인라인한 **완전 자기완결(self-contained)** 빌드로,
  외부 파일·CDN 의존이 없습니다(Leaflet 지도 라이브러리까지 인라인).
- `file://` 단일본은 브라우저 보안상 외부 Worker 파일을 불러올 수 없어 동일한 결정론 계산을 메인
  스레드 폴백으로 실행합니다. 가벼운 검토·공유에는 적합하지만 FULL/MC 실행에서는 일시 정지가 생길 수
  있으므로 `./scripts/serve.sh` 기반 다중 파일 실행을 권장합니다.
- 지도 **타일**은 인터넷이 있어야 표시되며, 없으면 **내장 SVG 개념도로 자동 대체**됩니다. DES 실행·9단계 분석·
  Monte Carlo·결과창·근거자료·제약검증 등 **나머지 모든 기능은 오프라인에서도 동일하게 동작**합니다.
- 소스(`index.html`/`css`/`js`)를 수정한 뒤에는 아래로 단일본을 재생성합니다:

  ```bash
  node scripts/build-single.mjs      # → K-JAMDS_시뮬레이터_단일본.html 갱신
  ```

  빌드는 "직전 단일본 + 현재 소스"만으로 결정론적으로 동작합니다(Leaflet 인라인 블록은 직전 단일본에서 재사용).

> 📘 **처음 사용한다면**: [`docs/사용자_가이드.pdf`](docs/사용자_가이드.pdf) — 기초 조작·용어 사전·화면별 설명·
> 결과 해석 레시피(원본 `docs/사용자_가이드.html`, 재생성 `node scripts/build-guide-pdf.mjs`).

## 9단계 C2 파이프라인 + 단계별 정밀화(①~⑨)

DES 엔진(`js/engine/sim-engine.js`)은 개별 위협 객체를 이벤트 구동으로 9단계에 흘려보내
**관측** 이용률·대기열·드롭·격추/누수를 수집합니다(M/M/c/K 대기행렬, 서버 c·지수 서비스·용량 K 초과 시 드롭=누수).

```
① 탐지 → ② 추적생성 → ③ 식별 → ④ 위협평가 → ⑤ WTA → ⑥ 결심
        → ⑦ 교전협조/권한위임 → ⑧ 교전/요격명령 → ⑨ BDA ─(실패)─▶ 재교전(폐루프)
```

각 단계는 실제 결함을 하나씩 진단·수정하며 정밀화했고, **모든 신규 거동은 기능 플래그로 토글**됩니다:

| 단계 | 정밀화 내용 | 대표 기능 플래그 (기본값) |
|---|---|---|
| **① 탐지** | 센서 고유 Pd × 위협 난이도 → 모드별 융합(As-Is=max, To-Be=1−Π(1−p)) | `sensorPdFusion`(ON) |
| **② 추적생성** | 중복항적(dup) 팬아웃, 음성 지연 분해·분포화, 死링크·死노드(JAOC-CD) 부활 | — |
| **③④⑤ 식별·위협평가·WTA** | C2 서버풀 track/approval kind 분리, Wq 노출, 대기실 K 근거 | — |
| **⑥⑦ 결심·교전협조** | 다익스트라 최소지연 경로, 수평 교전협조, `responsibility_gap` 부활, 동적 권한위임 | — |
| **⑧ 교전/요격명령** | 교전창 실현가능성·축선(coverage)·사거리 필터, Best-Shooter WTA | — |
| **⑨ BDA→재교전** | 무기별 pk 배선, 방어효율(누수 보상), 종료 절단 보정, timeout 분해, 재교전 상관·연발 | `pkByShooter`·`leakCost`·`censorFix`·`timeoutSplit`(ON) / `pkCorrelated`·`salvo`(OFF) |
| **자원 최적화(원칙 5)** | 비용 인식 WTA(고가 유도탄 보존), 유도탄 재고·보존 임계, 임계 재가중 | `costAwareWta`(ON) / `magazine`·`reserveFloor`·`thresholdReweight`(OFF) |

- As-Is는 육↔공 미연동으로 교전승인권자까지 음성 coord 홉(180초) — 중복·지연·책임공백의 원천.
- To-Be는 JAMDC2에서 융합·AI 식별·무기배정을 집중 처리하고, 위협별 자동화 차등(사전승인 자동교전)으로 결심·협조 홉을 생략.
- 모든 무작위성은 `seed` 기반 Mulberry32에서만 나오고, 도착·처리 스트림을 분리(CRN, Common Random Numbers)해
  As-Is↔To-Be가 **같은 위협열**을 마주하게 합니다 → **동일 config는 항상 동일 결과**(재현성·딥링크 공유·짝지은 비교).

## 감사 추적 방법론 — "고쳤더니 좋아졌다"는 비판의 방어

단계별 개선이 결론을 유리하게만 움직이지 않았음을 **정량 감사**로 증명합니다(`docs/integration-audit.md`).

- **기능 플래그 + 되돌리기 증명**: 모든 개선은 토글 가능하며, **플래그를 전부 끄면 개선 이전 지문과 완전 일치**(bit-clean).
  가장 중요한 불변으로 회귀 테스트에 고정합니다(`tests/reengage.test.js`·`resource.test.js`).
- **편향 원장(bias ledger)**: 각 개선을 하나씩 적용해 격추율·누수율·구조적실패·비용교환비·방어효율·고가유도탄 보존율의
  As-Is↔To-Be 이동을 기록. 개선이 어느 방향으로 결론을 움직이는지 추적합니다.
- **반증 실험(falsification)**: 자원 최적화처럼 "정의상 To-Be만 좋아지는" 변경은, **As-Is에도 동일 로직을 적용한 반사실 실행**과
  비교합니다. 예) 비용 인식 WTA — 반증 결과 As-Is 고가 유도탄 보존율(75.1%)이 To-Be(46.2%)보다 높아, **자원 절약 효익이
  C2 통합이 아니라 비용 인식 로직 자체에서 나옴**을 드러냈습니다("통합하면 절약된다"는 주장을 정직하게 반증).
- **에스컬레이션**: 어떤 변경이 To-Be 개선폭을 20% 이상 움직이면 보고서 최상단에 🔴로 명시.
- **핵심 결론 불변(G6)**: 모든 개선 후에도 ①⑥⑦이 As-Is 핵심 병목, ②To-Be 병목이 무기체계로 이동,
  ③무인기 비용 비대칭 미해소(exchangeSat>1), ④신궁·천마 탄도탄 불가 — **4종이 유지**되어야 정상.
  하나라도 뒤집히면 결함 수정이 아니라 모델 붕괴로 간주합니다.
- **결정 기록(ADR)**: 설계가 갈린 지점마다 `docs/adr/ADR-001~009` — 맥락·선택지·결정·근거·결론 영향(수치)·되돌리는 법.

## 프로젝트 구조

```
index.html                       # 진입점: 탭 구조·컨트롤·디스클레이머
K-JAMDS_시뮬레이터_단일본.html    # ★ 자기완결 단일본(서버 없이 실행) — build-single.mjs로 재생성
css/style.css                    # 레이아웃·테마
js/
  config/ system-types.js · geo-mdl.js · deployments.js · deployment-adapter.js
         # 고해상도 체계 타입 · MDL 개념 벨트 · 6개 배치 · C2/센서/사수/링크 catalog
  data/  nodes.js · links.js · threats.js · scenarios.js · axes.js
         # 노드(대기행렬·pk·wtaSuit·costPerShotM·magazine)·모드별 링크·위협·시나리오·축선 좌표
  core/  router.js · constraints.js · rng.js · heap.js · sim-worker-client.js
         # dep 포함 딥링크 · 제약 어서션 · RNG/힙 · 무거운 계산의 Worker 라우팅/단일본 폴백
  analysis/  bottleneck.js · mc-runner.js · overlap-heatmap.js · transition.js
         # 해석적 병목 근사 · Monte Carlo · 중복교전 히트맵 · 임계 전환점
  engine/  sim-engine.js         # ★ DES: 9단계·M/M/c/K·책임 C2·scope WTA·PIP·발사대 탄약/재장전·BDA
  workers/ sim-worker.js         # DES·MC·민감도·전환점 전용 Web Worker(로컬 서버 실행)
  ui/    map-view.js · panels.js · sim-view.js · mc-panel.js · geo.js · table-sort.js
  main.js                        # 부트스트랩·상태 관리 (해시 = 상태 단일원천)
docs/
  params.md                      # 파라미터 근거표 (ID·출처·인용·신뢰도 A/B/C·MC 적용방식)
  vv-report.md                   # V&V 종합: 매핑표·극한값·민감도·face validity·단계별 잔여 한계
  integration-audit.md           # ★ 통합 검증 감사(G1~G7): 회귀·되돌리기·死코드·제약·편향원장·결론 재산출·자원최적화 반증
  adr/ADR-001~009                # 결정 기록(pk 스키마·누수비용·절단·timeout분해·pk상관·salvo·비용WTA·재고·재가중)
  metrics-verification.md        # 지표 검증 감사 (비용교환비 비단조성 등)
scripts/
  serve.sh · build-single.mjs · build-guide-pdf.mjs · bias-ledger.mjs · step1~2·phase4~6 스윕
tests/  run-all.js + 22개 스위트  # 아래 [검증] 참조
```

## 설계 원칙: 병목은 고정이 아니라 도출된다

병목 위치는 하드코딩되지 않습니다. **시나리오 부하(λ)·모드별 토폴로지·노드 처리용량(M/M/c/K)**
로부터 계산하며, 시나리오·강도·모드·seed를 바꾸면 병목 위치가 함께 바뀝니다.

- **해석적(`analysis/bottleneck.js`)**: 부하를 그래프에 전파해 정상상태 M/M/c(Erlang-C) ρ·Wq·통신 체류량 — 빠른 개략 분석.
- **DES(`engine/sim-engine.js`)**: 개별 위협을 이벤트 구동으로 9단계에 흘려 **관측** 이용률·대기열·드롭·격추/누수 수집 — 실증적 병목·결과지표.

임계값(주의 ρ≥0.7, 병목 ρ≥0.9, 포화=드롭 발생, 통신병목 지연≥60s·체류≥1건 — 근거 `docs/params.md` ENV-RHO-THRESH-01)을 초과하는 지점을 병목으로 **도출**합니다.

## 딥링크 스킴

`#tab=<sim|analysis|mc|data>&sc=<시나리오ID>&mode=<asis|tobe>&dep=<legacy|배치ID>&x=<강도배수>&seed=<정수>&dur=<초>`

구 딥링크의 `tab=map|scenario|des|playback`은 자동으로 `sim` 탭으로 흡수됩니다.

- [`#tab=sim&sc=sc3&mode=asis&x=1.5&seed=12345`](index.html#tab=sim&sc=sc3&mode=asis&x=1.5&seed=12345) — 섞어쏘기 As-Is 1.5배 (시작 버튼으로 실행).
- [`#tab=analysis&sc=sc1&mode=asis`](index.html#tab=analysis&sc=sc1&mode=asis) — 경계 침투 시나리오 해석 분석.
- [`#tab=mc&sc=sc3&mode=asis&x=2`](index.html#tab=mc&sc=sc3&mode=asis&x=2) — Monte Carlo·임계 전환점.

## 검증

```bash
node tests/run-all.js            # 전체 회귀 — JS 27개 구문검증 + 22개 스위트·555 어서션
```

| 스위트 | 검증 내용 |
|---|---|
| `engine` · `mc` · `overlap` · `transition` · `constraints` | DES 재현성·극한값·보존 / Monte Carlo·수렴 / 중복교전 히트맵 / 임계 전환점 / 제약 a~e |
| `detect` · `track` | ① 센서 Pd 융합·단일센서 대조군 / ② 추적생성·①②독립성 |
| `refine` · `metrics-verification` · `nodekind` | 정밀화 스냅샷·WTA·권한위임 / 지표 감사 / ③④⑤·⑥⑦ 작업종류 분리 |
| `coord` · `coord2` · `wta` | ⑥⑦ 결심·협조·다익스트라 / 수평 협조·책임공백 부활 / ⑧ 교전창·축선 필터 |
| `reengage` · `deadcode` · `resource` | ⑨ 되돌리기·무기별 pk / 死코드 레지스트리(Gate 3) / 자원 최적화·As-Is불변·반증 |

테스트는 `window.KJ` 네임스페이스를 Node에서 로드해 실행합니다. 브라우저에서는 4개 탭에서 대화형으로 확인합니다.
V&V 종합은 **`docs/vv-report.md`**, 통합 감사(되돌리기·편향원장·반증·결론 재산출)는 **`docs/integration-audit.md`** 참조.

### 통계·시각화 방법론 (요약)

- **Welford 온라인 분산 + 95% CI 수렴판정**(주지표 누수율 CI 반폭 ≤ 허용오차, 최소 30회): 근거 계획서 Recommendations 3.
- **통계적 유의성**: As-Is·To-Be를 동일 baseSeed 파생 시드로 복제, 두 95% CI 비중첩 시 유의한 차이로 판정.
- **민감도 스윕(±20% 토네이도)**: 포화 시나리오에서 처리시간·강도가 지배적 → "병목은 처리용량" 진단을 정량 뒷받침.
- **DES trace 모드**·**위협궤적 애니메이션**(축선 개념좌표 선형보간·60fps)·**실시간 노드 링**·**자산 범위 링**·**Sankey형 흐름도**·**중복교전 히트맵**(JAMDC2 융합허브 특례) — Leaflet 부재(폐쇄망·단일본 오프라인) 시 SVG 개념도로 대체.

제약조건 어서션(신궁·천마 탄도탄 교전 불가, legacy THAAD 부재·FULL USFK 독립축/KAMDOC 미연동, 디스클레이머 상시 표출, 개념좌표 주석, KF-21 보라매 표기)은 **[근거자료·제약검증] 탭**에서 상시 확인됩니다.
