# ADR-061 — legacy 배치·compat 충실도 폐기 (§6 개정)

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

## 맥락

Phase 5(ADR-060, `docs/compat-retirement-readiness.md`)의 폐기 조건 판정: 원문 §6 기준
7항목 중 **충족 2 / 범위축소 3 / 미충족 2**. 사용자 결정(AskUserQuestion, 2026-07-28):
**"§6 개정 후 진행"** — §6을 범위 축소 기준으로 개정하고 미충족 항목은 정직한 후속 과제로
남긴 채 폐기를 진행한다.

## 결정

1. **`modelFidelity`는 `iads-c2` 하나다.** `compat` 요청은 명시적 오류
   (`compat 충실도는 폐기되었다(ADR-061)`). UI 충실도 드롭다운 제거.
2. **배치는 고해상도 6종뿐이다** (HANBANDO_LEGACY_* 3 + HANBANDO_FULL_* 3, 기본
   `HANBANDO_LEGACY_NORMAL`). `features.highResolutionDeployment===false` 요청은 명시적
   오류. legacy 배치 데이터(`js/data/nodes.js`·`links.js`)는 빈 stub(`Object.freeze([])`)로
   교체 — 부활 방지를 위해 파일은 남기되 내용을 비운다(`constraints.test.mjs` (g)가 고정).
3. **legacy 9단계 파이프라인 삭제** — `_scanProb`·`_onDetect`·`makeGhost`·`_coordCheck`·
   `_onC2Arrive(D up)`·`_afterC2`·`_onFusionArrive`·`_decision`·legacy `_onApproveArrive`·
   `reserveFloorFor`·`_doEngage`·`_onShooterArrive`·`_onEngageEnd`·`coordPath`·`_dupEngage`
   및 해당 이벤트 dispatch 7종. `KJ._coordPath` 노출 제거.
4. **§6 개정** (`docs/high-resolution-iads-architecture.md`) — 개정 기준: 범위 축소로 정의된
   센서/항적·PIP·C2 Resolver(+정책 객체)·차량별 재장전 결합 + 보존/결정론/paired MC/V&V
   게이트 + SHA-256 기준선 이관. 원문 문구는 괄호로 보존.

## 이관 증명 (핵심 게이트)

`tests/hires-baseline.json` — 폐기 직전 LEGACY_HIRES×iads-c2×seed 12345×900초 6케이스
(SC1/2/3 × As-Is/To-Be)의 SHA-256. **폐기 커밋 전후 6/6 bit-exact 실측** — legacy 삭제가
native 경로의 난수 소비·이벤트 순서를 전혀 건드리지 않았음의 증명이다.

**의미론 약화의 정직 기록**: 이 지문은 "개선 이전 대비" 증명이 아니라 **"이관 시점 이후 회귀
없음"** 증명이다. legacy baseline(`tests/baseline.test.js`, SHA 6셀)은 비교 대상 경로 자체가
삭제되면서 함께 폐기되었고, 되돌리기 보증은 git 이력(revert)로만 남는다.

**compat-on-hires 조합의 소멸**: `features.highResolutionDeployment:true`에 `modelFidelity`를
생략한 실행은 종전에 "hires 배치 × compat 충실도(센서물리 OFF)"였다. 강제 iads-c2 이후 이런
셀의 결과는 정당하게 변한다(예: FULL SC2 As-Is seed 12345 — 격추 16→34, 누출 13→0).
이에 따라 `iads-failure-realism`의 관측 셀을 SC2→SC3로 이동했고(파일 주석), 진단용 책임공백
카탈로그는 `iadsEngageableThreats` 표 기준으로 재구성했다(`failure-classification`).

## 회귀 게이트 비용 재조정과 그 과정에서 드러난 관측 변경

iads-c2가 유일 충실도가 되면서 1회 실행 비용이 legacy의 수십 배가 됐다(실측: SC3·1800초·×2
1회 ≈ 9.6초, SC1·900초 ≈ 0.9초). MC 계열 두 스위트의 셀 크기를 줄이되, **줄이면 관측 자체가
사라지는 지점**은 실측으로 확인해 원래 크기를 유지했다.

| 스위트 | 재조정 | 실측 근거 |
|---|---|---|
| `mc` | MC 셀 1800→600초·복제 200→90/40/30/20으로 축소. **단 SC2 민감도 셀은 1800초 유지**(복제만 60→12) | SC2를 900초로 줄이면 무인기가 표적에 도달하기 전이라 **전 인자 누수율이 0.0%로 눌려 민감도 자체가 관측 불가**(pk 단조성 검증 소멸). 1800초·12복제에서는 pk 6.2%→0.2%로 정상 관측 |
| `transition` | 구조 스윕 30복제·1800초 → 3복제·600초 | 600초에서도 ρ≥0.9 임계 돌파가 보존됨(×2에서 돌파, ρ 0.44→0.94). 36실행 73초 |

**관측 변경(정직 기록) — SC1 임계 전환점 소멸**: legacy 경로에서 SC1(경계 침투)은 고강도에서
ρ≥0.9를 돌파했고, 그 원인은 legacy 전용 **중복항적 팬아웃**(각 군 C2가 같은 항적을 중복
접수해 부하가 배가되던 경로)이었다. 그 경로가 본 커밋으로 삭제되면서 native SC1은 전 스윕
구간에서 C2 최대 ρ가 **임계를 넘지 않는다** — 관측창을 늘려도 같다(reps 3·step 0.5 실측:
600초 0.04→0.32, 1800초 0.06→0.33. 동일 조건 SC3는 각각 ×2·×1.5에서 돌파). 회귀 어서션을 "SC1이 SC3보다
늦게 돌파"에서 **"SC3는 돌파·SC1은 미돌파"**로 되돌렸다(검증 취지 "전환점은 시나리오의
함수"는 동일하게 성립). G6 결론과는 무관하다 — SC1은 저부하 시나리오이고, As-Is 병목 판정은
협조·승인 경로 계측(ADR-058)이 근거다.

## 검증 스위트 정리

- 폐기 16종 + fixture 3종: 원장 `tests/retired-legacy-suites.md` (사유·대체 커버리지·유실 목록).
- 이관: `constraints`(a·b·d·f 카탈로그/SHOOTER_TYPES 정본화, e→ADR-060 범위 선언 승계),
  `engine`/`mc`/`transition`(native로 어서션 유지), `overlap`(어댑터 적재),
  나머지 native 스위트는 커널 적재(.mjs 전환)와 ADR-061 의미론 갱신.
- 제약 어서션(불변 규칙 5)은 유지: 신궁·천마 탄도탄 불가는
  `SHOOTER_TYPES.iadsEngageableThreats`(데이터) + 탄도 단독 시나리오 발사 0건(행위)으로 이중
  검증. USFK 독립축·개념좌표·디스클레이머 동일.

## L16·KVMF 처분 기록 (v2 스펙 "하지 말 것" 항목의 종결)

- legacy `links.js`의 L16 12초는 **갱신주기를 전송지연으로 오적용**한 값(ADR-057 판정),
  KVMF 30초는 등급 C 개념값이었다. v2 스펙은 "Phase 2에서 수정하지 말고 Phase 6에서 삭제"를
  지시했고, 본 커밋으로 삭제되었다. 판정 근거는 `js/data/links.js` stub 주석과 ADR-057에 보존.
- codex 정본의 Link-K "1초 보수" 판정은 어댑터(`IADS-LINK-*-01` 계열)가 승계.

## 도메인 RNG 이관을 이번에 하지 않은 이유

§6 원문 기준의 미충족 항목인 도메인별 RNG 완전 이관(§2)은 **이번 커밋과 양립 불가능**하다:
난수 스트림을 도메인별로 재배정하면 native 전 셀의 수치가 바뀌어, 위 "폐기 전후 bit-exact"
이관 증명 자체가 성립하지 않는다. 한 커밋에 한 변경(불변 규칙 7). 후속 과제로 남긴다
(§6 개정문의 미충족 목록 ①~③과 동일).

## 단일본 (옵션 b)

단일본은 file://로 열려 ES 모듈 커널(`js/model/iads/bootstrap.js`)을 적재할 수 없다.
iads-c2가 유일 충실도가 된 이상 커널 없는 단일본은 실행 불가이므로,
`scripts/build-single.mjs`가 커널 모듈 8종을 **IIFE로 텍스트 번들**해 동봉한다(모듈 태그 대체,
`KJ.IADS`·`createIadsEventQueue`·`iadsKernelReady` 동일 표면). IIFE 커널 실행이
`hires-baseline.json` 6케이스와 **bit-exact(6/6)** 임을 실측 확인했다. 모듈 Worker는 단일본에서
기존 main-thread fallback으로 동작한다(종전과 동일).

## 잔여 사항 (정직 기록)

1. `_onServiceStart`의 `job.kind==='engage'` 분기·ghost `_dup` fireDetail 등 legacy 전용
   방어 코드 일부가 도달 불가 상태로 남아 있다(발화 경로 없음 — 후속 청소 후보).
2. `KJ.IADS.approvalPolicy`는 api 표면에 없어(index.js가 c2policy를 spread하지 않음) 엔진은
   동치 fallback을 사용한다(ADR-058 §구성에 기록된 동치성). 표면 배선은 후속 과제.
3. 분석 모듈(`bottleneck.js` 등)의 legacy 전용 잔여 분기(`catalog ? ... : KJ.LINKS`)는 stub이
   빈 배열이라 무해하나, 후속 청소 후보다.

## 되돌리는 법

이 커밋 revert (feature flag 없음 — 폐기는 구조 변경이다). 폐기 직전 상태의 legacy 코드·
테스트는 직전 커밋의 git 이력에서 복구한다(`tests/retired-legacy-suites.md`의 복구 절차).

## G6 재산출 (불변 규칙 6)

본 커밋은 native 경로 bit-exact이므로 G6 결론의 수치 원장은 Phase 4(ADR-059)와 동일하다:
① As-Is 핵심 병목 = 협조·승인(협조몫 19~35초, 승인 Wq 36.8초 — ADR-058 원장) — 유지.
② To-Be 병목 → 무기체계(누수 사유 timeout·missed 지배) — 유지.
③ exchangeSat ≫1 전 셀(4.7~20.6) — 무인기 비대칭 미해소 유지.
④ 신궁·천마 탄도탄 불가 — `constraints.test.mjs` (a) 데이터+행위 이중 검증 통과 — 유지.
**뒤집힌 결론 없음.**
