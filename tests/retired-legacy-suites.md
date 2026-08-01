# 폐기된 legacy 회귀 스위트 원장 (ADR-061)

> 본 문서의 모든 내용은 공개자료 기반 **정책연구용 개념값** 모델에 대한 것이며 실제 작전자료가 아니다.

2026-07-28 Phase 6(ADR-061)에서 legacy 9단계 파이프라인·legacy 배치(`KJ.NODES`/`KJ.LINKS`)·
compat 충실도가 폐기되면서, **검증 대상 자체가 삭제된** 회귀 스위트를 함께 폐기했다.
복구는 `git show <폐기 직전 커밋>:tests/<파일>` 로 가능하다(마지막 보존 커밋: Phase 6 커밋의
직전 커밋, `git log --diff-filter=D -- tests/<파일>` 로 확인).

## 판정 기준

- **폐기**: 스위트의 주 검증 대상이 삭제된 legacy 코드(9단계 파이프라인 함수·legacy 배치
  데이터·compat 충실도)라서, 남길 경우 어서션이 참조하는 함수/노드/코드가 존재하지 않음.
- **이관**: 검증 대상이 살아있는 경우(엔진 일반 성질·통계 모듈·분석 모듈·UI)는 폐기하지 않고
  고해상도(iads-c2) 정본으로 어서션을 이관했다 — 아래 "이관 스위트" 참조.

## 폐기 스위트 16종

| 스위트 | 종전 검증 대상 | 폐기 사유 | 잔존 커버리지(대체) |
|---|---|---|---|
| `baseline.test.js` | legacy 6셀 SHA-256 bit-exact 잠금 | legacy 경로 삭제 — 잠금 대상 소멸 | `hires-baseline.test.mjs` (native 6케이스 SHA-256, 폐기 시점 지문 이관) |
| `detect.test.js` | ① `_scanProb` 탐지 융합 (legacy Pd 모델) | `_scanProb`·`_onDetect` 삭제 | `iads-kernel.test.mjs` (SNR/RCS/수평선 센서), `legacy-hires-deployment.test.mjs` §4 (스캔·게이팅 발화) |
| `track.test.js` | ② 센서→JAMDC2 직결 추적생성 (legacy 확장 노드) | legacy 노드·`C2_ARRIVE` 삭제 | native 항적·상관은 `iads-kernel`·`c2-analysis` (trackQuality·correlation) |
| `refine.test.js` | 정밀화 Phase A~D (legacy WTA·권한위임·원인분포) + `refine-snapshot.json` | legacy `_decision`·위임 플래그 경로 삭제 | 위임·승인은 `approval-chain.test.mjs`(ADR-058), WTA는 `native-wta.test.mjs`(ADR-059), 원인분포는 `failure-classification.test.mjs` |
| `metrics-verification.test.js` | legacy 지표 감사 (Lq 시각화·분권전환 0건·exchangeSat 반전) | 감사 대상이 legacy 실행 결과 | 지표 계정은 `metrics-accounting.test.mjs`, exchangeSat 방향은 실험보고서 G6 원장 |
| `nodekind.test.js` | legacy 작업종류 3종(track/approval/engage) 합보존·귀속 | legacy kind 스키마 폐기 — native는 iads_track·directive_reception 등 | `metrics-accounting.test.mjs` F7 (native kind 노출·분해) |
| `coord.test.js` | ⑥⑦ `coordPath` 다익스트라 최소지연 경로 | `coordPath`·`KJ._coordPath` 삭제 | native 협조는 `approval-chain.test.mjs` (coord 경유·협조몫 계측) |
| `coord2.test.js` | ⑥⑦ 수평 교전협조·ghost 중복교전·책임공백 부활 | `_coordCheck`·`makeGhost`·`_dupEngage` 삭제 | 실제 발사 기반 중복교전은 `iads-native-pipeline.test.mjs`, 중복 귀속은 `metrics-accounting.test.mjs` F3 |
| `wta.test.js` | ⑧ legacy WTA (교전창·축선 필터·canEngage) | legacy `_decision`·`reserveFloorFor` 삭제 | `native-wta.test.mjs` + `iads-native-pipeline.test.mjs` (scope WTA·PIP) + `constraints.test.mjs` (a) |
| `reengage.test.js` | ⑨ legacy BDA·재교전 + `legacy-snapshot.json` | legacy `_onEngageEnd` 삭제 | `iads-failure-realism.test.mjs` (SLS 2발 상한·무한 재교전 방지·BDA) |
| `deadcode.test.js` | legacy 死 코드 레지스트리 (통합 Gate 3) | 레지스트리가 추적하던 legacy 코드 경로 자체가 삭제됨 | 소멸 — native 실패코드 발화는 `failure-classification.test.mjs`가 검증 |
| `resource.test.js` | legacy 자원 최적화 플래그 4종 (costAwareWta·magazine·reserveFloor·thresholdReweight) | 플래그가 native에서 무효임을 ADR-059가 실측 기록 — legacy 경로 삭제로 소멸 | 비용 인식은 `native-wta.test.mjs` (nativeWtaMode·nativeWtaCostAsis) |
| `engine.test.js`(구판) | legacy 9단계 엔진 성질 | — | **이관 완료**: `engine.test.mjs` (동일 어서션이 native에서 전부 통과 — 재현성·극한값·병목·보존·trace) |
| `transition.test.js`(구판) | legacy 임계 전환점 | — | **이관 완료**: `transition.test.mjs` |
| `mc.test.js`(구판) | legacy MC·통계 | — | **이관 완료**: `mc.test.mjs` (Welford·샘플러는 엔진 무관, MC 셀만 native로) |
| `legacy-deployment-expansion.test.js` | legacy 확장 배치(서4·중3·동3 10세트, `KJ.LEGACY_AIR_DEFENSE_SITES`) | legacy 배치 데이터 삭제(`nodes.js` stub) | 10세트 편성은 `legacy-hires-deployment.test.mjs` §1 (LEGACY_HIRES 카탈로그), 지도는 `map-visualization.test.js` |

## 폐기 fixture 3종

| fixture | 용도 | 대체 |
|---|---|---|
| `phase0-baseline.json` | legacy 6셀 지문 | `hires-baseline.json` (native 6케이스 SHA-256) |
| `legacy-snapshot.json` | reengage 스냅샷 | 소멸 (대상 코드 삭제) |
| `refine-snapshot.json` | refine 스냅샷 | 소멸 (대상 코드 삭제) |

## 이관 스위트 (폐기 아님 — 고해상도 정본으로 어서션 이동)

`constraints.test.mjs`(a·b·d·f를 카탈로그·SHOOTER_TYPES 정본으로 이관, e는 ADR-060 범위
선언으로 승계), `engine/mc/transition/overlap`, `deployment-adapter`, `high-resolution-connection`,
`iads-native-pipeline`, `c2a-asis`, `iads-failure-realism`(관측 셀 SC2→SC3 이동 — 사유는 파일
주석), `failure-classification`(진단 카탈로그를 iadsEngageableThreats 표 기준으로 재구성),
`metrics-accounting`(ghost→실제 중복 발사 의미론), `c2-analysis`(명령 만료율 상시 계측),
`map-visualization`(고해상도 카탈로그 렌더).

## 유실되는 검증(정직 기록)

1. **legacy 이론 서사의 행위 검증** — 분권 전환 관측, legacy 반증 시나리오(비용 인식이 보존율을
   끌어올린다)는 native에서 재현되지 않음이 ADR-059에 실측 기록되어 있고, 그 검증 코드는 함께
   소멸한다.
2. **9단계 파이프라인 단계별 어서션**(①~⑨ 단계 명칭 기반) — native 파이프라인은 단계 구조가
   달라 1:1 대응이 없다. 대응 관계는 `docs/모의논리서.html`의 파이프라인 다이어그램이 정본.
3. **死 코드 레지스트리** — legacy 통합 검증 게이트 3의 개념 자체가 소멸.
