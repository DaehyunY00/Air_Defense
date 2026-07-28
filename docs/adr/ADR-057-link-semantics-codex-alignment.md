# ADR-057 — 링크 의미론을 IADS_codex 정본에 정합(`linkSemanticsV2`)

## 맥락

형제 저장소 `IADS_codex`가 물리·제원의 정본이다(`js/config/system-types.js` 헤더:
*"Source values are adapted from the read-only IADS_codex_original registry"*).
codex의 링크 모델은 지휘 위계로만 구분한다:

```js
// IADS_codex/src/config/weapon-data.js
export const LINK_DELAYS = Object.freeze({
  longRange: 16,    // (구) GREEN_PINE→KAMD 등 — ADR-014: 보고주기 의미는 reportingPeriod 참조
  shortRange: 1,    // ICC→ECS, ECS→발사대
  internal: 0.5,    // MFR→ECS
  ifcn: 1,          // Kill Web 모든 링크
});
```

그리고 codex ADR-014가 **"일률 지연" 해석을 명시적으로 폐기**했다:

> "탐지자산→상위 C2 정보 전달은 **일률 지연이 아니라 보고 주기** — 그림 나이가 0~P
> 톱니(sawtooth)로 변동. 탐지자산별 주기는 `SENSOR_TYPES.<sensor>.reportingPeriod`가
> 단일 출처(GREEN_PINE_B 16 / FPS117 8 / TPS880K 4 / 포대 전속 MFR 1).
> 하향(교전명령)은 사건기반 즉시발송 + 중계 C2 처리시간(≠0)."

### Air_Defense의 결함 세 가지 (전부 실측)

1. **`reportingPeriod`가 죽은 필드였다.** `system-types.js`는 codex와 동일한 값으로
   선언하고 있으나(그린파인 16 / FPS-117 8 / TPS-880K 4 / MFR 1) `js/` 전수 검색 결과
   선언부 외 **소비처 0건**.
2. **어댑터가 `LONG` 16초를 센서 종류와 무관하게 일률 적용** — TPS-880K(주기 4초)도
   FPS-117(8초)도 전부 16초. codex ADR-014가 폐기한 바로 그 방식.
3. **`SHORT` 4초·`INTERNAL` 1초의 조정 근거가 없다.** codex는 shortRange 1초·internal
   0.5초인데 Air_Defense가 4초/1초로 바꾼 이유가 저장소 어디에도 기록돼 있지 않다.

## 선택지

- **(a) 톱니(sawtooth) 신선도 완전 구현** — 센서별 보고 주기에 위상을 두고 그림 나이가
  0~P로 변동. codex 원 의미에 가장 충실하나, 현행 DES 이벤트 구조에서 보고 이벤트를
  주기적으로 생성해야 해 이벤트 수가 크게 늘고(센서 수 × 주기), 위상 결정론 관리가 필요.
- **(b) 1단계 근사: 센서별 고정 지연 = reportingPeriod** — 보고 지연을 그 센서의 주기로
  고정(평균적으로 톱니의 상한에 해당하는 보수적 근사). 이벤트 구조 불변, 차등(4≠8≠16초)은
  즉시 확보. 톱니는 후속 과제.
- **(c) 현상 유지** — codex 정본과의 불일치(죽은 필드·일률 지연·근거 불명 조정)를 방치.

## 결정

**(b) 1단계 근사를 택하고, 플래그 `linkSemanticsV2`(기본 OFF)로 감싼다.** 톱니는 후속
과제로 §한계에 남긴다. 구체 매핑:

| 구간 | OFF (종전) | ON (codex 정합) | 근거 |
|---|---|---|---|
| As-Is 센서→C2 `report` | `LONG` 16 s 일률 | **그 센서의 `reportingPeriod`** (16/8/4/1 s) | codex ADR-014 — 일률 지연 폐기, 보고 주기가 단일 출처 |
| As-Is C2↔C2 `coord`·항적 중계 | `LONG` 16 s 또는 `SHORT` 4 s | **1 s** (codex shortRange) | "조정 근거 불명 — codex 값으로 환원" |
| **To-Be 전 링크** | `DL_FAST` 2 s | **IFCN 1 s** | codex `ifcn: 1` — **"Kill Web 모든 링크 (ADR-014: 킬웹 보고주기 전부 1s)"**. 킬웹은 IFCN 네트워크가 융합 항적을 1초 주기로 밀어내므로 센서 자체 회전 주기가 아니라 네트워크 주기가 정보 나이를 지배한다는 것이 정본의 판정 |
| 하향 명령 ECS→발사대 | `INTERNAL` 1 s | 유지(불변) | codex shortRange 1 s와 이미 일치 — ADR-014 "사건기반 즉시발송 + 중계 처리시간" 부합 확인 |
| MFR→ECS | `INTERNAL` 1 s | As-Is reportingPeriod 1 s · To-Be IFCN 1 s (값 동일, 출처가 명확해짐) | codex internal 0.5 s와의 차이는 소멸 구간 |

### 설계 반전 기록 — "보고 주기 양 모드 공통" 1차안의 폐기

1차 구현은 "보고 주기는 센서 물리 속성이므로 As-Is/To-Be 공통(통합해도 레이더가 빨리
돌지 않는다)"으로 갔다. 물리적으로 그럴듯하나 **codex 원문 대조에서 정본과 다른 해석임이
확인됐다** — codex는 `ifcn: 1`에 "킬웹 보고주기 전부 1s"라고 명시한다(킬웹의 IFCN은
개별 센서의 회전 주기가 아니라 네트워크 융합 주기로 항적을 공급한다는 IBCS 개념).
공통 컨텍스트 규칙("codex 판정 우선, 다르게 가려면 사유 기록")에 따라 codex 판정으로
환원했다. 1차안 폐기 전 실측(30 seed, 폐기된 중간 상태)은 아티팩트를 남기지 않았다 —
최종 의미론의 측정만 편향 원장에 기록한다.

## 구성

- `js/config/deployment-adapter.js` — `buildDeploymentCatalog(id, opts)`가
  `opts.linkSemanticsV2`로 **변형 카탈로그**를 별도 캐시 키(`id|linkV2`)에 생성.
  `reportCycleComm(typeId)`(paramRef `IADS-LINK-RP-01`)·`C2_TRANSFER`(1 s,
  `IADS-LINK-SHORT-01`)·`IFCN`(1 s, `IADS-LINK-IFCN-01`) 도입.
  OFF 경로는 기존 상수 객체를 그대로 사용(참조 동일성 보존).
- `js/engine/sim-engine.js` — `this.linkSemanticsV2 = ff('linkSemanticsV2', false)`,
  ON일 때만 `features`에 노출. 분기 자체는 어댑터가 수행(엔진 로직 불변).
- `docs/params.md` — `IADS-LINK-RP-01` 신설, `IADS-LINK-SHORT-01`/`-INTERNAL-01`/
  `-LONG-01` 등록(종전에는 어댑터가 paramRef만 달고 원장에 미등록이던 것을 시정),
  codex 대조·인용문·조정 사유 포함.

### 하지 않은 것 (중요)

`js/data/links.js`의 `L16`(12초)·`KVMF`(30초)는 **건드리지 않았다.** 고해상도 경로는 이
두 상수를 전혀 사용하지 않으며(어댑터 전수 검색 0건), legacy는 Phase 6에서 삭제된다.
지금 고치면 `baseline.test.js` SHA-256 6케이스와 `constraints.test.js`가 깨지는데
어차피 삭제될 코드다. (두 값의 근거 약점 — `L16` 12초는 갱신주기를 지연으로 오적용,
`KVMF` 30초는 폐기된 파라미터에서 값만 승계한 등급 C, codex는 Link-K를 "Link-16급 가정
1초 보수"로 판정 — 은 Phase 6 ADR에 기록한다.)

## 검증

`tests/link-semantics.test.mjs` (run-all 등록, 16 어서션):

1. OFF 카탈로그 불변(LONG 16/DL 2) + OFF/ON 캐시 분리.
2. ON As-Is 센서별 차등: 그린파인 16 ≠ FPS-117 8 ≠ TPS-880K 4 (수용 기준 어서션), MFR 1 s.
3. ON To-Be 전 링크 IFCN 1 s(type='ifcn') · ON C2↔C2 As-Is 1 s. 하향 명령 1 s 불변.
4. ON 실행 결정론·보존법칙·플래그 노출.
5. OFF 실행 bit-exact은 `engagement-state-unification` 스위트의 SHA-256 4케이스가 잠근다
   (Phase 1 종료 시점 지문 그대로 통과 = 이 변경의 OFF 무영향 증명).

### 편향 원장 — 단독 효과 (paired MC 30 seed × 1800초 × ×1.5 · LEGACY_HIRES × iads-c2)

**예상 방향**: 양쪽 다 빨라진다 — As-Is는 센서 보고 16→8/4초·C2↔C2 16/4→1초,
To-Be는 전 링크 2→1초. As-Is의 절대 단축폭이 더 크므로 **To-Be 개선폭 축소**가 예상되나,
As-Is 그린파인(16초 유지) 대 To-Be IFCN(1초)의 탄도탄 축 격차는 오히려 커진다. 실측으로 판정.

| 지표 | SC1 Δ(To-Be−As-Is): OFF → ON | SC3 Δ: OFF → ON |
|---|---|---|
| 격추율(spawn) | +0.9pp → +1.0pp [+0.2,+1.8] | **+27.3pp → +18.0pp** [+16.7,+19.2] |
| 누수율(spawn) | −0.2pp → −0.6pp [−1.2,+0.0] | **−26.8pp → −17.9pp** [−19.1,−16.7] |
| 결심지연(초) | −7.5 → −2.5 [−4.9,−0.2] | **−87.2 → −41.5** [−44.0,−38.9] |
| 교전지연(초) | −7.9 → −2.8 [−5.2,−0.4] | **−101.4 → −48.4** [−51.5,−45.3] |
| 중복교전 | +8.53 → +1.27 [+0.35,+2.18] | +7.87 → **+0.87 [−0.40,+2.13] (미분리로 전환)** |
| 구조적실패 | 0 → 0 | +9.17 → **−8.07 [−10.6,−5.5] (방향 반전 — To-Be가 적어짐)** |
| exchangeSat | As-Is 20.5/To-Be 20.4 | As-Is 4.98/To-Be 4.69 — **양 팔 모두 ≫1 유지(G6 ③)** |

**🔴 개선폭 20% 이상 이동 — 에스컬레이션.** SC3 격추율 개선폭 −34%(27.3→18.0pp), 결심지연
개선폭 −52%(87→41초), 교전지연 개선폭 −52%. 원인은 As-Is의 링크가 정본 정합으로 크게
빨라진 것이다(센서 보고 16→8/4초 차등, C2↔C2 16/4→1초): **종전 As-Is는 "일률 16초"라는
폐기된 해석 때문에 실제(codex 정본 기준)보다 나쁘게 모델링되어 있었고, 그만큼 To-Be 개선폭이
과대평가되고 있었다.** 이는 예상된 방향의 정직한 발견이며(작업 지침: "줄어들면 그대로
보고한다"), 실험보고서 최상단에 🔴로 명시한다.

부수 관측 2건: ① As-Is 중복교전이 SC1 8.8→16.1로 급증 — C2↔C2가 1초로 빨라지자 MCRC와
군단 AOC의 동시결심 경합이 늘었다(빠른 링크가 협조 없이는 중복을 오히려 키운다는 관측 —
ADR-056의 교전상태 공유 필요성을 강화). ② SC3 구조적실패 방향 반전 — OFF에서 To-Be가 더
많던 이례(29.1 vs 19.9)가 ON에서 해소되고 To-Be가 절반으로 준다(14.2 vs 22.2). OFF의 이례가
링크 의미론 왜곡의 산물이었을 가능성이 높다.

## 결론 영향

G6 4종 재산출(ON 기준): ① As-Is 핵심 병목 유지 — ON에서도 As-Is 결심지연(SC3 166초)이
To-Be(124초)를 크게 상회하며 legacy 경로는 무접촉. ② legacy 경로 불변으로 유지.
③ exchangeSat ON에서도 SC1 20.4/SC3 4.7~5.0 — 미해소 유지. ④ 제약 어서션 36스위트 통과.
**4종 모두 유지 — 뒤집힌 것 없음.** 단 개선폭 축소 🔴는 위 편향 원장 절 참조.
기본 OFF이므로 배포 상태의 결론은 불변. legacy 경로 무접촉(`baseline.test.js` 불변).

## 되돌리는 법

- 런타임: `features.linkSemanticsV2 = false`(기본값).
- 코드: 이 커밋 revert. 변형 카탈로그는 캐시 키로 격리되어 OFF 경로 객체는 참조까지 동일.

## 한계

0. **codex의 reportingPeriod 값 자체가 placeholder다** — codex 주석이 "ADR-014 모델값
   (§0.13 D-5 — 가상 placeholder, 추후 실측 자료조사)"라고 명시한다. 이 ADR은 **의미론**
   (일률 지연이 아니라 센서별 보고 주기)을 정합시킨 것이지, 개별 수치(16/8/4/1)의 공개근거를
   확보한 것이 아니다. `IADS-LINK-RP-01`은 등급 C로 등록했다.
1. **톱니 신선도 미구현** — 보고 주기를 고정 지연으로 근사했다(항상 주기의 상한만큼 늦게
   보는 보수적 가정). 실제로는 0~P 균등 위상으로 평균 P/2. 후속 과제.
2. **`C2-DL-DLY-01`(2 s)은 OFF 경로에만 남는다** — ON은 To-Be 전 링크를 codex `ifcn`
   1 s로 대체한다. OFF(기본)의 2 s는 회귀 호환 목적으로 유지되며, Phase 6에서 OFF 경로가
   사라질 때 함께 정리 대상이다.
3. **VOICE_STATUS(교전현황 채널)는 범위 밖** — 링크가 아니라 절차 채널이며 Phase 3
   (승인 계선)의 특별 주의 사항으로 넘긴다.
4. **보고 주기가 M/M/c 서비스와 독립** — 보고 주기는 링크 지연으로만 반영되고, C2 노드의
   서비스 시간·용량은 불변이다. 주기 단축이 C2 부하를 늘리는 2차 효과는 모델링되지 않는다.
