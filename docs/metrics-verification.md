# K-JAMDS 시뮬레이터 — C2 병목·해결 지표 구현·시각화 검증 보고서

> **디스클레이머**: 본 문서와 시뮬레이터의 모든 수치·좌표·확률은 공개자료 기반의 정책연구용
> 개념값이며, 실제 작전자료가 아니다.

이 문서는 **새 기능을 추가하지 않는다.** Phase A~D 정밀화가 병합된 현재 상태에서, 18개 지표
체크리스트가 (1) 실제로 계산되는지, (2) 어느 화면 요소로 시각화되는지, (3) As-Is↔To-Be 대조가
올바른 방향으로 나오는지를 코드 인용·행위 검증·스크린샷으로 감사한 결과다.

- **정적 검증**: §1의 18개 지표 전체에 대해 파일:라인 인용
- **행위 검증**: `tests/metrics-verification.test.js` 63개 어서션 신설(회귀 편입)
- **시각화 캡처**: `scripts/capture-metrics.mjs` 신설, 4개 딥링크 스크린샷 7장 캡처
- **판정**: 18개 지표 중 16개 PASS, **2개 발견(미표시)**, 그 외 **방향성 특이사항 2건**(버그
  아님, 사용자 오인 방지를 위해 UI 반영 여부를 질문으로 남김)

---

## 1. 지표 매트릭스

범례: **PASS** = 계산·시각화·방향성 모두 확인됨 · **발견** = 계산은 되나 시각화 누락(§3 참조)

### MoP (과정)

| # | 지표 | MoM | 계산 위치(파일:라인) | 결과 필드 | 시각화 요소 | As-Is↔To-Be 방향 검증 | 판정 |
|---|---|---|---|---|---|---|---|
| 1 | 결심 지연(탐지→교전개시) | MoP | `sim-engine.js:85-86,415-416,654-655` | `global.meanDecisionDelaySec` | `sim-view.js:523`(statCard) · `sim-view.js:747`(vsCompare, MoP 태그) | `refine.test.js` B 종합절 + `metrics-verification.test.js`로 전 시나리오 재확인(항상 To-Be < As-Is) | **PASS** |
| 2 | 통신지연 부하(전달 1건 평균) | MoP | `sim-view.js:712-716`(`commMeanDelay`, 입력은 `sim-engine.js:590-598` 링크 집계) | UI 계산 함수(엔진 필드 아님) | `sim-view.js:760`(vsCompare, MoP 태그) | `refine.test.js` D-3(sc3 x1.5) + `metrics-verification.test.js`는 별도 스윕 없음(§3 발견 아님, 커버리지 낮음으로 기록) | **PASS** |
| 3 | 노드 관측 ρ / Wq / Lq | MoP | `sim-engine.js:572-574,586`(DES), `bottleneck.js:196-206`(해석 근사) | `nodes[].rho/Wq/Lq` | ρ·Wq: `sim-view.js:604-621`(DES 결과표), `panels.js:44-60`(해석 탭). **Lq: 어디에도 렌더 없음** | ρ≤1 포화 검증(`engine.test.js`), Wq 유한성 검증 기존 | **발견 1** (Lq 미표시) |
| 4 | 드롭(포화손실) 건수 | (병목 판정용, MoM 미태그) | `sim-engine.js:198,585,609` | `nodes[].drops`, 병목 상세 텍스트 | `sim-view.js:614`(표 셀), `sim-engine.js:609`(병목 detail 문구) → `sim-view.js:557`(병목 목록 렌더) | `engine.test.js` "포화: 드롭·누수 발생" | **PASS** |
| 5 | 평균 격추시간 | MoP | `sim-engine.js:80,447,635-636,652` | `global.meanTimeToKillSec` | `sim-view.js:522`(statCard) · `sim-view.js:758`(vsCompare, MoP 태그) | `engine.test.js`/`refine.test.js` 기존 검증 | **PASS** |

### MoCE (효과)

| # | 지표 | MoM | 계산 위치(파일:라인) | 결과 필드 | 시각화 요소 | As-Is↔To-Be 방향 검증 | 판정 |
|---|---|---|---|---|---|---|---|
| 6 | 중복교전 위험(축선 합) | MoCE | `overlap-heatmap.js`(`computeOverlapHeat`), 합산은 `sim-view.js:726-729`(`overlapRiskSum`) | `computeOverlapHeat().axes[]` | 축선별 상세: `sim-view.js:586-601`(섹션⑦, 히트맵 바) · 합산: `sim-view.js:753`(vsCompare, MoCE 태그) | `overlap.test.js`(축선별 To-Be≤As-Is, JAMDC2 허브 완전해소) + `metrics-verification.test.js`(overlapRiskSum이 축선 합과 정확히 일치함을 재현, 3개 시나리오 To-Be=0 고정) | **PASS** (단, To-Be가 항상 정확히 0 — §3 참고사항) |
| 7 | 구조적 실패(공백·포화·지연) 합 | MoCE | `sim-view.js:717-724`(`structuralLeaks`), taxonomy는 `sim-engine.js:720-736`(`LEAK_TAXONOMY.structural`) | UI 계산 함수 | `sim-view.js:762`(vsCompare, MoCE 태그) | `refine.test.js` C-2(sc2/sc3, 5시드 집계: To-Be 구조적 비율 < As-Is, 명중실패 비중 이동) | **PASS** |
| 8 | 도출 병목 수 | MoCE | `sim-engine.js` `_results` 내 `bottlenecks` 배열(§ "병목 종합") | `res.bottlenecks` | `sim-view.js:526`(statCard) · `sim-view.js:554-560`(섹션④ 목록) · `sim-view.js:764`(vsCompare, MoCE 태그) | `engine.test.js` "To-Be 병목 ≤ As-Is" | **PASS** |
| 9 | 분권 전환(중앙↔분권) | (MoCE 성격, MoM 미태그) | `sim-engine.js:52,83,336-339,657-659` | `global.delegation.{count,firstT,byNode}` | `sim-view.js:524-525`(statCard, **현재 실행 모드 1개만**) — **vsCompare 9행에 비교행 없음, byNode 어디에도 미표시** | `refine.test.js` B-2(합성 시나리오로 매커니즘 검증) + `metrics-verification.test.js`(공식 SC1-3×UI 강도 0.5~3.0×에서 **To-Be 0건 고정**, As-Is는 SC3 x≥2.0에서만 발생) | **발견 2** (As-Is↔To-Be 비교 UI 없음 + 실사용 시나리오에서 To-Be 관측 불가) |

### MoFE (결과)

| # | 지표 | MoM | 계산 위치(파일:라인) | 결과 필드 | 시각화 요소 | As-Is↔To-Be 방향 검증 | 판정 |
|---|---|---|---|---|---|---|---|
| 10 | 요격 실패율(누출률) | MoFE | `sim-engine.js` `global.leakRate`(spawned/leaked 비) | `global.leakRate` | `sim-view.js:521`(statCard) · `sim-view.js:749`(vsCompare) · `sim-view.js:543-547`(MC CI 표) · `mc-panel.js:22`(METRIC_META) | 다수 기존 테스트(`engine.test.js`,`mc.test.js`,`transition.test.js`) | **PASS** |
| 11 | 격추율 | MoFE | `global.killRate` | `global.killRate` | `sim-view.js:520`(statCard) · `sim-view.js:751`(vsCompare) · `mc-panel.js:21` | 기존 다수 테스트 | **PASS** |
| 12 | 비용교환비(저가 포화위협) | MoFE | `sim-engine.js:89,441-442,449-450,662-668`(`SAT_THREATS`=uav_small·mrl_large) | `global.cost.exchangeSat` | `sim-view.js:755`(vsCompare, MoFE 태그, 유일한 노출 지점) | `refine.test.js` D-2(SC2만) + `metrics-verification.test.js`(SC1·SC3 포함 전수 확인) → **SC2는 항상 개선, SC1·SC3는 강도에 따라 악화로 반전** | **PASS**(계산·표시 정확) / **특이사항 3**(방향 비단조, §3) |

### 실패 원인 분해

| # | 지표 | 계산 위치(파일:라인) | 결과 필드 | 시각화 요소 | 판정 |
|---|---|---|---|---|---|
| 13 | 원인 taxonomy 8종 | `sim-engine.js:720-736`(`KJ.LEAK_TAXONOMY`/`leakTaxonomy`) | 정적 딕셔너리 | 원인 대조표(14)·실패 타임라인(15)에서 **암묵적으로만** 사용 — 8종 전체를 나열하는 독립 참조표는 `근거자료` 탭(`panels.js:103-128`)에도 없음 | **PASS**(기능) / 저심각도 문서화 공백(§3 참고) |
| 14 | As-Is↔To-Be 원인 대조표 | `sim-view.js:637-663`(`leakCompareTable`) | 렌더 함수 | `sim-view.js:563-564`(섹션⑤) | **PASS** |
| 15 | 개별 실패 항적 타임라인 | `sim-view.js:669-703`(`failedTimelineSection`) | 렌더 함수 | `sim-view.js:566-567`(섹션⑤-2), `<details>` 접이식, 상한 40건 명시 | **PASS** |

### 통계·전환점

| # | 지표 | 계산 위치(파일:라인) | 시각화 요소 | 판정 |
|---|---|---|---|---|
| 16 | MC 95% CI·수렴·유의성 | `mc-runner.js`(Welford, `runMonteCarlo`) | `mc-panel.js:68-77`(수렴), `80-88`(지표별 통계), `91,102-123`(유의성 비교), 결과모달 `sim-view.js:536-551`(백그라운드 CI) | **PASS** |
| 17 | 민감도 토네이도(±20%) | `mc-runner.js`(`sensitivitySweep`) | `mc-panel.js:93-98,125-145`(`_tornado`) | **PASS** |
| 18 | 임계 전환점(ρ≥0.9 돌파) | `transition.js`(`analyzeTransition`) | `mc-panel.js:150-242`(`runTransition`/`renderTransition`, SVG) | **PASS** |

**요약**: 16/18 PASS, 2/18 발견(미표시), 2건 특이사항(계산·표시는 정확하나 기대와 다른 특성).

---

## 2. 스크린샷 인덱스

캡처 스크립트: `scripts/capture-metrics.mjs` (§4 참조). 저장 위치: `docs/screenshots/`.
이 환경은 외부망이 차단돼 있어 Leaflet CDN을 불러오지 못하므로, sim 탭 캡처 3건 **전부**
"폐쇄망 SVG 개념도 대체" 경로(`KJ.mapView.isFallback() === true`)로 자동 검증되었다.

| 딥링크 | 파일 | 폐쇄망 대체 | 화면에서 확인된 지표 |
|---|---|---|---|
| `#tab=sim&sc=sc3&mode=asis&x=1.5&seed=12345` | `sc3-asis-x1.5-saturation__result-modal.png`, `__map.png` | YES | 결과요약(#1,5,8,9,10,11 statCard) · vsCompare 9행 전부(#1,2,5,6,7,8,10,11,12, MoM 태그 포함) · MC CI(#16 일부) · 도출 병목(#8) · 원인 대조표(#13,14, [구조]배지) · 실패 타임라인(#15, 다수 항목) · 흐름 funnel · 축선별 중복교전(#6) · 노드표(#3 ρ/Wq만, **Lq 없음 육안 확인**) |
| `#tab=sim&sc=sc1&mode=asis&x=1&seed=12345` | `sc1-asis-x1-boundary__result-modal.png`, `__map.png` | YES | 위와 동일 구성. 이 실행에서는 비용교환비가 **개선 방향**(165.00배→46.67배)으로 표시 — SC1 x3에서는 반전됨(§1 특이사항 3, §2-2 근거) |
| `#tab=sim&sc=sc2&mode=asis&x=1&seed=12345` | `sc2-asis-x1-uav-burst__result-modal.png`, `__map.png` | YES | 위와 동일 구성. 실패 타임라인이 대부분 "명중 실패(기회소진)"로 채워짐(무인기 저요격확률 반영, vv-report §3.2 face validity와 일치) |
| `#tab=mc&sc=sc3&mode=asis&x=1&seed=12345` | `sc3-mc-transition-tornado.png` | (해당없음, 지도 미사용) | 수렴판정·지표별 통계·As-Is↔To-Be 유의성 표(#16) · 민감도 토네이도(#17) · 임계 전환점 SVG(#18, ρ≥0.9 돌파선·최대격차 마커) |

캡처 중 발견해 수정한 **검증 스크립트 자체의 버그 2건**(제품 코드 결함 아님):
1. 해시만 바꾸는 `page.goto()`는 SPA를 완전히 재초기화하지 않아(같은 문서 내 프래그먼트 이동)
   이전 실행의 모달·버튼 상태가 남음 → `about:blank` 경유 강제 재적재(`hardGoto`)로 수정.
2. 모달 캡처를 위해 `.modal-body`/`.modal`의 `max-height`를 인라인으로 해제한 뒤 스크롤 위치가
   불특정해져 `#modal-close` 클릭이 조용히 실패, 지도 스크린샷에 모달 잔여물이 겹쳐 보임 →
   클릭 대신 재적재로 대체.
3. (버그는 아니지만 기록) `page.screenshot({fullPage:true})`는 이 앱의 레이아웃(`main{overflow:
   hidden}` + `.tab-panel{height:100%;overflow-y:auto}` — 스크롤이 document가 아니라 내부
   패널에서 일어남)에서 뷰포트 높이로 잘림 → 활성 패널 요소의 높이 제약을 일시 해제한 뒤
   해당 요소를 직접 캡처하는 방식으로 수정(MC 탭: 1000px → 1603px 전체 캡처 확인).

---

## 3. 발견 사항

### 발견 1 (낮음) — Lq(대기열 길이)가 계산되나 어디에도 표시되지 않음

`sim-engine.js:573,586`과 `bottleneck.js:201`에서 계산되어 결과 객체(`nodes[].Lq`)에 담기지만,
DES 결과 노드표(`sim-view.js:604-621`)와 해석 탭 노드표(`panels.js:44-60`) 둘 다 **ρ와 Wq만
표시하고 Lq 열이 없다.** Little's Law(Lq = λ·Wq)로 Wq에서 유도 가능해 정보 손실은 크지 않지만,
체크리스트가 Lq를 명시적으로 요구하는 이상 시각화 공백으로 기록한다.

- **영향**: 낮음(대체 지표 Wq가 이미 표시됨)
- **임의 수정 여부**: 하지 않음 — 열 추가는 표 레이아웃 변경이라 질문으로 남김(§5)

### 발견 2 (중간) — 분권 전환(delegation)의 As-Is↔To-Be 비교가 UI에 없고, 실사용 시나리오에서 To-Be 관측이 불가능

두 가지가 겹친 문제다.

1. **UI 구조상 공백**: `vsCompare`의 9개 행(`sim-view.js:745-766`) 중 분권 전환 비교 행이
   없다. 현재는 `statCard`(`sim-view.js:524-525`)로 **현재 실행 중인 단일 모드**의
   `count`/`firstT`만 보여줄 뿐, As-Is와 To-Be를 나란히 비교하는 화면 요소가 전혀 없다.
   `global.delegation.byNode`(어느 승인노드에서 전환이 발생했는지)도 어디에도 표시되지 않는다.
2. **행위상 공백**: `tests/metrics-verification.test.js`로 공식 3대 시나리오(SC1/SC2/SC3) ×
   UI가 허용하는 전 강도(0.5×~3.0×, seed=12345)를 전수 실행한 결과, **To-Be는 단 한 건도
   분권 전환이 발생하지 않는다.** As-Is만 SC3의 강도 2.0× 이상에서 발생(x2: 6건, x3: 10건).
   즉 설사 (1)의 UI 공백을 메워 비교 행을 추가하더라도, 사용자가 실제로 조작 가능한 범위
   내에서는 "To-Be 열은 항상 0건"만 보이게 된다 — 이 정밀화 기능(Phase B-2) 자체가 현재
   임계값(`DELEG_QUEUE_MULT = {asis:4, tobe:1}`, `sim-engine.js:52`)과 공식 시나리오 부하
   하에서는 **사실상 관측 불가능**하다.

- **영향**: 중간(기능은 정확히 구현·단위검증되어 있으나, 제품 사용자 관점에서 "이 지표가 To-Be의
  가치를 보여주는 사례"를 한 번도 볼 수 없다)
- **임의 수정 여부**: 하지 않음 — vsCompare 행 추가는 UI 변경, 임계값 조정은 모델 특성(파라미터)
  변경이라 **둘 다 질문으로 남김**(§5)

### 특이사항 3 (참고, 버그 아님) — 비용교환비(exchangeSat)의 방향이 시나리오·강도에 따라 반전됨

`refine.test.js` D-2는 SC2(x2, seed=42)만 검증했고 그 방향은 항상 개선(To-Be < As-Is)이다.
그러나 `metrics-verification.test.js`로 SC1·SC3까지 넓혀 확인한 결과:

| 시나리오 | 강도 | As-Is | To-Be | 방향 |
|---|---|---|---|---|
| SC1 | ×1.0 | 165.0배 | 46.7배 | 개선(스크린샷과 일치) |
| SC1 | **×3.0** | 81.4배 | **107.5배** | **악화** |
| SC2 | ×0.5~3.0 전 구간 | — | — | 항상 개선 |
| SC3 | **×1.0** | 7.91배 | **8.30배** | **악화** |
| SC3 | ×3.0 | 10.15배 | 8.80배 | 개선 |

계산·표시(`sim-view.js:755`) 자체는 **정확**하다 — 해당 실행의 실제 방향을 있는 그대로
보여준다. 다만 다른 8개 vsCompare 지표(결심지연·누출률·격추율·중복교전위험·구조적실패·병목수
등)는 이번 감사에서 확인한 범위 내에서 **일관되게 To-Be가 개선**되는 반면, 비용교환비만
시나리오·강도에 따라 반전될 수 있어 사용자가 "다른 지표처럼 항상 개선될 것"이라 오인할 여지가
있다. 원인은 저가 포화위협(무인기·방사포) 부분집합에 대한 Best-Shooter WTA(Phase B-1)가
때때로 더 비싼 자산을 배정하거나, 재교전 횟수 차이로 소모비용이 달라지는 자연스러운 결과로
추정되며 별도 조사 없이는 근본원인을 단정하지 않는다.

- **영향**: 낮음~중간(오인 가능성) — **임의 수정 여부**: 하지 않음, 툴팁에 "항상 개선되는
  지표가 아님"을 명시할지 질문으로 남김(§5)

### 참고 (최저 심각도) — 원인 taxonomy 8종의 독립 참조표 부재

`KJ.LEAK_TAXONOMY`(`sim-engine.js:720-731`) 8개 코드 전체를 한눈에 보여주는 화면이 없다.
원인 대조표(14)·실패 타임라인(15)은 **실제로 발생한 코드만** 보여주므로(설계상 정상 —
발생하지 않은 코드를 나열할 필요는 없음), 사용자가 전체 분류체계를 이해하려면 `docs/params.md`
또는 소스코드를 읽어야 한다. 기능 결함이 아니라 문서화 편의성 문제이므로 판정에는 반영하지 않되
참고로 남긴다.

---

## 4. 재현 방법

```bash
# 1) 정적/행위 회귀 전체(신규 63개 어서션 포함)
node tests/run-all.js

# 2) 스크린샷 재캡처 (로컬 서버 필요)
python3 -m http.server 8000 --bind 127.0.0.1 &
node scripts/capture-metrics.mjs http://localhost:8000
# → docs/screenshots/*.png 갱신 (playwright-core + Chromium 필요:
#    npm install playwright-core 후 npx playwright install chromium,
#    또는 PW_CHROMIUM_PATH 환경변수로 기존 설치 경로 지정)
```

사용 seed: 딥링크 기본값과 동일한 `12345`(router.js `DEFAULTS.seed`). 모든 수치는 seed 고정
재현 가능(엔진 재현성 보장, `engine.test.js`).

---

## 5. 사용자 결정 사항 (반영 완료)

이 보고서 초안 검토 후 사용자가 아래와 같이 결정했다:

1. **Lq(대기열 길이) 노드표 열 추가 — 보류(현상유지).** Wq로 대체 가능한 정보라 우선순위가
   낮다고 판단, 변경하지 않음.
2. **분권 전환(delegation) vsCompare 비교 행 추가·임계값 조정 — 보류(현상유지).** UI·모델
   파라미터 모두 변경하지 않음. 발견 2는 기록으로만 남고 시정하지 않는다.
3. **비용교환비 툴팁에 "항상 개선되는 지표가 아님" 안내 — 반영 완료.**
   `js/ui/sim-view.js:756`의 `tip` 문구에 "다른 지표와 달리 To-Be가 항상 개선되는 지표가
   아님 — Best-Shooter 배정·재교전 횟수 차이로 시나리오·강도에 따라 악화되는 경우도 실재함
   (docs/metrics-verification.md 참조)"을 추가(계산 로직 변경 없음, 툴팁 텍스트만 수정).
4. **원인 taxonomy 8종 참조표 추가 — 논의되지 않음(보류).** 최저 우선순위 항목으로 남겨둠.
