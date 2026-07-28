# ADR-055 — `HANBANDO_MINI` 배치 3종 폐기

## 맥락

`HANBANDO_MINI_{NORMAL, MCRC_DOWN, KAMDOC_DOWN}`은 `js/config/deployments.js` 헤더 주석이
직접 밝히듯 **"4 상황 매트릭스 시연용"** 배치였다. 즉 배치 축과 상황(본사장 생존) 축이 결과를
실제로 움직인다는 것을 보여주기 위한 최소 예제이지, 연구 질문을 재는 배치가 아니었다.

이후 두 배치가 추가되면서 그 시연 역할이 중복되었다.

- `HANBANDO_FULL_*`(ADR-022 §16 · ADR-036) — 2030 가정 전면 배치.
- `HANBANDO_LEGACY_*`(ADR-054) — legacy 자산 편성을 고해상도 타입으로 이식한 배치.

동시에 MINI의 전력 구성이 **연구 질문과 맞지 않는다**는 것이 관측으로 확인되었다.

### MINI의 구조적 결핍

MINI는 포대 8개(L-SAM 2 · 천궁-II 5 · PAC-3 1)뿐이고,

- **단거리방공(비호·천마) 0개** — `deployment.test.js`의 SHORAD 열이 `0`이었다.
- **국지방공(`LOCAL_AD`) C2 축 0개** — 군단·수방사 방공상황실에 해당하는 노드가 없다.

그래서 KJADS 문제상황 중 두 가지의 **원인 구조가 모델 안에 존재하지 않는다.**

| 문제상황 | 필요한 구조 | MINI |
|---|---|---|
| 1. 육↔공 경계 책임공백 | 국지방공 축 ↔ 공군 축의 경계 | 국지방공 축 자체가 없음 |
| 2. 무인기 동시 남파 | `uav_small`을 교전 가능한 사수 | BIHO/CHUNMA만 가능한데 둘 다 없음 |

README가 기록한 관측 — *"SC2×MINI compat: 양 모드 68.1% 동일 — 무인기 교전 수단 부재"* — 는
모델의 발견이 아니라 **배치 선언의 결과**다. As-Is와 To-Be가 같은 값을 낸 이유가
"C2 구조가 무의미해서"가 아니라 "쏠 무기가 없어서"였다.

`HANBANDO_LEGACY_*`는 SHORAD 7문(비호 2 · 천마 5)과 `LOCAL_AD` 축을 모두 갖는다. 즉 MINI가
못 담던 구조를 담으면서 3상황 토글 패턴은 동일하다.

## 선택지

- **A. MINI를 유지한다.** 변경 0. 대신 배치 드롭다운에 "이 배치로는 문제상황 1·2를 물을 수
  없다"는 것이 표시되지 않는 항목 3개가 남는다. 실험 매트릭스가 21셀 → 6셀이 낭비되고,
  MINI 셀의 결과가 구조 결론으로 잘못 인용될 위험이 계속된다.
- **B. MINI를 남기되 UI에서 숨긴다.** 딥링크로는 접근 가능. 코드·테스트·스크립트의 중복은
  그대로 남고, "왜 숨겼나"가 어디에도 기록되지 않는다.
- **C. MINI를 삭제한다.** 배치 6종(`FULL` 3 + `LEGACY` 3)으로 정리한다. 4상황 시연 역할은
  `HANBANDO_LEGACY_*`가 동일 구조로 대체한다.

## 결정

**C를 택한다.** MINI 3종을 저장소에서 제거하고, MINI를 쓰던 테스트·스크립트는 전력 구성이
가장 가까운 `HANBANDO_LEGACY_NORMAL`로 이관한다.

근거는 "간결함"이 아니라 **정직성**이다. 연구 질문의 원인 구조를 담지 못하는 배치를 선택지로
남겨 두면, 그 배치에서 나온 "차이 없음"이 구조적 결론으로 읽힌다. 실제로 README에 그런 문장이
이미 한 번 실렸다.

## 구성

### 삭제

`js/config/deployments.js`

- `HANBANDO_MINI_POSITIONS` / `_BATTERIES` / `_SENSORS` / `_C2_BASE`
- `KAMDOC_ENTRY` / `MCRC_ENTRY` (MINI 전용. FULL은 `MCRC_FULL_ENTRY`, LEGACY는 `MCRC_LEGACY_ENTRY`를 쓴다)
- `RAW_DEPLOYMENT_HANBANDO_MINI_{NORMAL, MCRC_DOWN, KAMDOC_DOWN}`
- `normalizeDeployment` 호출 3건 · `KJ.DEPLOYMENTS` 레지스트리 3줄

결과: `KJ.DEPLOYMENT_IDS.length === 6`.

### 기본값 이동

`js/config/deployment-adapter.js`

```js
// before
return buildDeploymentCatalog(config.deploymentId || 'HANBANDO_MINI_NORMAL');
// after
return buildDeploymentCatalog(config.deploymentId || 'HANBANDO_LEGACY_NORMAL');
```

`highResolutionDeployment: true`인데 `deploymentId`를 생략한 호출이 legacy와 자산 편성이
같은 배치를 보게 된다.

### 테스트 이관

| 파일 | 처리 |
|---|---|
| `tests/deployment.test.js` | `expected` 표에서 MINI 3행 삭제, `9개 → 6개 배치 ID` · `['MINI','FULL','LEGACY'] → ['FULL','LEGACY']` |
| `tests/deployment-adapter.test.js` | 기본 카탈로그 어서션을 `HANBANDO_LEGACY_NORMAL`로, `['MINI','FULL'] → ['FULL','LEGACY']` |
| `tests/high-resolution-connection.test.js` | ICC 상향 승인경로·주교전 셀을 `HANBANDO_LEGACY_NORMAL`로 |
| `tests/iads-kernel.test.mjs` | 결정론 셀을 `HANBANDO_LEGACY_NORMAL`로 |
| `tests/legacy-hires-deployment.test.mjs` | "MINI 구성 불변(포대 8)" → "FULL 구성 불변(포대 84)" |
| `tests/metrics-accounting.test.js` | F1·F7 셀을 `HANBANDO_LEGACY_NORMAL`로 (F1은 아래 참조) |

### 스크립트·문서

- 감사/비교 스크립트 6종(`audit-feature-activation` · `audit-runtime-counters` ·
  `compare-architectures` · `compare-deployments` · `verify-trace-consistency` ·
  `build-structural-audit-pdf.py`)의 배치 목록에서 MINI → `HANBANDO_LEGACY_NORMAL`.
- `scripts/experiment-report.mjs`: `DEP_NAME`·`ORDER`·배치 축 표에서 MINI 열 제거
  (21셀 → 15셀). 보고서 HTML 재생성.
- `README.md` · `docs/모의논리서.html` · `docs/사용자_가이드.html` · `js/ui/panels.js` ·
  `js/ui/sim-view.js`: 현재 상태를 서술하는 문장은 6종 기준으로 갱신.

## 검증

- `node tests/run-all.js` — 전체 통과.
- `tests/baseline.test.js`의 SHA-256 6케이스 **변경 없이** 통과. 엔진(`sim-engine.js`)과
  legacy 배치·`compat` 충실도를 한 줄도 건드리지 않았으므로 예상된 결과다.
- `KJ.DEPLOYMENT_IDS.length === 6`, 전부 고해상도.
- 배치 드롭다운은 `KJ.DEPLOYMENT_IDS`에서 자동 생성되므로(`js/main.js:186`) MINI가 사라진다.
- 구 딥링크 `#dep=HANBANDO_MINI_NORMAL`은 `js/core/router.js:44`의 기존 검증이
  `DEFAULTS.dep`(=`legacy`)로 폴백한다. 코드 변경 불필요 — 이미 알 수 없는 ID를 거른다.

### F1(고가유도탄 계상) 셀의 mode 변경

`tests/metrics-accounting.test.js`의 F1은 "native 경로에서 L-SAM($8M) 소모가 계상되는가"를
본다. MINI에는 L-SAM이 2문 있었으나 `HANBANDO_LEGACY_NORMAL`에는 `MDU_L` 1문뿐이고,
**As-Is에서는 이 셀에서 한 번도 선정되지 않는다.** 실측:

| 셀 (SC3 · seed 42 · 900초 · LEGACY_HIRES) | `highValueInterceptM` | `interceptM` |
|---|---|---|
| As-Is ×1.5 | 0.0 | 55.4 |
| As-Is ×3.0 | 0.0 | 96.8 |
| **To-Be ×1.5** | **192.0** | 281.4 |
| To-Be ×3.0 | 192.0 | 396.8 |

SC1·SC2는 양 모드 모두 0.0이었다. 따라서 F1 셀을 `mode: 'tobe'`로 바꿨다(보존율 0.3177).

**As-Is에서 단일 L-SAM이 선정되지 않는다는 사실 자체는 이 ADR에서 고치지 않는다.**
native `_iadsDecide`의 사수 선정 점수식은 `this.mode`를 참조하지 않으므로 As-Is/To-Be의 무기
배정이 같아야 하는데 실제로는 다르다 — 책임 C2 해소가 모드별로 다르기 때문일 가능성이 높다.
이는 WTA 모드 차등 작업(예정)에서 다룰 관측이며, 여기서 추측으로 손대지 않는다.

## 결론 영향

**없다.** G6 결론 불변 4종은 어느 것도 MINI 배치의 관측에 의존하지 않는다.

| 결론 | 근거 배치 | MINI 폐기 영향 |
|---|---|---|
| ①⑥⑦이 As-Is 핵심 병목 | legacy(compat) · LEGACY_HIRES | 없음 |
| To-Be 병목이 무기체계로 이동 | legacy(compat) · FULL | 없음 |
| 무인기 비용 비대칭 미해소(`exchangeSat>1`) | legacy(compat) · FULL | 없음 |
| 신궁·천마 탄도탄 교전 불가 | 타입 레지스트리 제약 어서션 | 없음 |

`baseline.test.js`가 SHA-256으로 잠근 6케이스는 전부 legacy 배치이므로 지문이 바뀌지 않는다.

## 되돌리는 법

이 커밋 하나를 revert하면 된다. 엔진 변경이 없고 기능 플래그도 도입하지 않았으므로,
배치 선언·테스트·스크립트·문서만 원상 복구된다. `git revert <sha>` 후
`node scripts/build-single.mjs`로 단일본을 재생성한다.

## 한계

1. **`confidence` 기본값 분기가 live case를 잃었다.** `normalizePositions`의
   `p.confidence || 'estimated'` 폴백은 MINI 좌표(모두 `confidence` 미선언)가 유일한 실행
   사례였다. 남은 6배치는 전 좌표가 `confidence`를 명시 선언한다(FULL: public 40 · estimated
   129 · scenario 2, LEGACY: scenario 53). `deployment.test.js`의 해당 어서션은 아직 살아 있는
   분기 — `confidence` 값에 따라 `coordNote` 문구가 갈리는 쪽 — 로 대체했다. 폴백 자체는
   지금 어떤 테스트도 통과시키지 못한다. 코드를 지우지 않은 이유는 새 배치 선언이 언제든
   `confidence`를 생략할 수 있기 때문이지만, **이것은 검증되지 않는 코드다.**

2. **MINI 실측 기록은 재현할 수 없다.** `README.md`의 21셀 실측 평균(특히
   "MINI −52초", "SC2×MINI compat 양 모드 68.1% 동일")과 `docs/모의논리서.html` §13.7 표의
   MINI 행, `docs/high-resolution-effectiveness-audit.md` · `docs/metrics-verification.md`의
   MINI 관측치는 **폐기 전 측정치**다. 숫자를 지우거나 고치지 않고, 각 문서에 "폐기된 배치의
   기록값"이라는 주석을 붙였다. 기록을 사후에 다시 쓰는 것보다 낫다고 판단했다.
   `artifacts/experiment/*.json`은 애초에 커밋 대상이 아니다(해당 디렉터리의 `.gitignore`).
   그래서 **`docs/실험보고서_AsIs_ToBe.html`을 이 커밋에서 재생성하지 않았다** — 입력 셀이
   없는 상태로 돌리면 보고서가 빈 껍데기가 된다(실측: "셀 0개"). 커밋된 보고서는 21셀 실행
   당시의 산출물 그대로이고, `experiment-report.mjs`는 이미 15셀 기준으로 고쳐져 있다.
   **다음번 `experiment-run.mjs` 전수 실행 뒤 보고서를 재생성하면 MINI 행이 사라진다.**
   그때까지 생성기와 커밋된 보고서는 의도적으로 어긋나 있다.

3. **PDF는 갱신하지 못했다.** `docs/사용자_가이드.html`과 `docs/모의논리서.html`은 고쳤지만,
   대응 PDF(`사용자_가이드.pdf` · `모의논리서.pdf` · `실험보고서_AsIs_ToBe.pdf`)는 이 환경에
   `playwright-core`가 없어 재생성에 실패했다(`build-guide-pdf.mjs` 실행 시 `ERR_MODULE_NOT_FOUND`).
   HTML과 PDF가 어긋난 상태다. `npm install playwright-core` 후
   `node scripts/build-guide-pdf.mjs`로 맞춰야 한다.

4. **`docs/tasks/*`는 손대지 않았다.** 이 파일들은 날짜가 박힌 작업 기록이며 그 시점의 사실을
   적은 것이다. MINI가 등장한다고 해서 지금 고치면 당시 무엇을 했는지가 지워진다.
   현재 상태를 서술하는 문서(README·모의논리서·사용자 가이드)만 갱신했다.

5. **MINI가 유일하게 제공하던 것 — "포대 8개 규모의 소형 고해상도 배치" — 는 사라진다.**
   가장 가벼운 고해상도 배치가 이제 LEGACY_HIRES(포대 15)다. 회귀 테스트가 조금 느려지고,
   "규모가 작을 때"를 보고 싶은 후속 작업은 배치를 새로 선언해야 한다. 그때는 SHORAD와
   `LOCAL_AD` 축을 반드시 포함해야 한다 — 그게 MINI를 폐기한 이유다.
