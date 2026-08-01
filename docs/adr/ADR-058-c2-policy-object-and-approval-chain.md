# ADR-058 — C2 정책 객체 분리 + 승인 계선 이식(`approvalChain`)

## 맥락

native 경로(고해상도 배치)는 책임 C2가 자체 승인한다 — legacy `_decision`이 모델링하던
C2 이론(승인권자 해소·coord 협조 단계·`kind='approval'` 서비스·동적 권한위임·automation
3단계 차등)이 전부 없다. SC3 ×3.0 As-Is 실측: `meanCoordDelaySec` 0.0초, approval 도착
0건, 위임 0건 (legacy는 9.4초 / 146건 / 539건).

승인 단계가 실제로 발생해야 하는 곳은 **한 군데뿐**이다: As-Is `LOCAL_AD` 축(군단 AOC,
self_battery)의 ABT 교전 — 승인권자 KAOC가 MCRC(다른 노드)로 해소된다. 다른 한국군 축은
자기 자신이 승인권자라 경유가 없고, USFK 축은 ADR-036이 계선 적용을 금지한다.
빠진 것은 링크 하나였다: 고해상도 카탈로그에 군단AOC→MCRC `coord` 링크가 없어
`_iadsShortestPath(..., ['coord'])`가 null을 반환했다.

`docs/high-resolution-iads-architecture.md` §5가 정책 객체 분리를 지시한다.

## 선택지

- **(a) 정책 객체 분리 + LOCAL_AD 한정 이식** — `c2-policy.js`(승인권자·자동화·위임
  임계·해제 권한)를 신설하고, 엔진 게이트는 As-Is 의미론이 실제로 요구하는 유일한 구간
  (LOCAL_AD 축)에만 적용. 채택.
- **(b) 전 축 승인 서비스 이식** — 자기 자신 승인 축에도 approval 서비스를 계상.
  legacy 실측(146건)에 더 가깝게 보이나, legacy의 146건 분해 근거가 없고 native의
  iads_track 서비스가 이미 결심 처리를 계상하므로 이중 계상 위험. 기각.
- **채널 대안** — 승인 협조를 기존 `status` 채널(음성/VTC 180초·서버1·용량4)에 얹는 안:
  As-Is에서 status가 이미 88~91% 드롭이라 승인이 거의 내려오지 않게 되고, 두 기능의 효과
  분해가 불가능해진다. **분리 채널**(신설 coord, 절차 지연 20초)을 채택하고 이 대안은 기각.

## 결정

**(a) + 분리 채널.** 플래그 `approvalChain`(기본 OFF), 반증 전용 `approvalChainTobe`
(기본 OFF — To-Be에 As-Is 계선 강제, 선례 `costAwareWtaAsis`).

### 정책 객체 (js/model/iads/c2-policy.js)

`{ approvalAuthority, automationLevel, delegationThreshold, releaseAuthority, approvalPolicy }`
— **수치 신규 없음**: `threats.js`의 `approvalLevel`/`automation`과 legacy
`DELEG_QUEUE_MULT`(As-Is 4/To-Be 1, `C2-DELEG-THRESH-01`)를 승계. c2-agent.js(명령
상태기계)와의 역할 분담은 파일 헤더에 명시. compat 실행(모듈 미로드)에서는 엔진이 동일
데이터를 읽는 동치 폴백을 쓴다.

### 엔진 게이트 (_iadsDecide 계획 수립 직전)

| automation (정책 모드 기준) | 거동 |
|---|---|
| `auto-preauth` / 승인권자 null·자기 자신·부재 | 단계·처리 없음 (legacy 동치) |
| 위임 임계 초과(busy≥c ∧ queue≥c×배수) | 위임 계상(`delegation.*`) 후 즉시 진행 |
| `human-on-loop` | 경유 생략, 승인권자 `kind='approval'` 서비스만 |
| `human-in-loop` | coord 최단경로 경유(지연 `_coordDelay` 누적) → approval 서비스 → 재진입 |
| coord 경로 부재 | `responsibility_gap` (legacy 의미론 복원) |

- 협조 단계 몫은 native 발사 계정에서 `coordDelaySum`으로 누적 → `meanCoordDelaySec` 배선.
- **approval 드롭은 native에서 branch-local** — 한 축(LOCAL_AD)의 승인 요청 드롭이 전
  계통(pipelineDead)을 죽이지 않는다. legacy(단일 파이프라인 — 드롭=누수)와 다른 지점이며,
  native 다계통 구조("한 계통 포화가 다른 계통을 죽이지 않는다"는 기존 원칙)에 정합시켰다.
  legacy 경로의 approval 드롭 의미론은 `nativeIads` 가드로 불변.

### 신설 링크 (군단AOC→MCRC coord — `IADS-APPR-COORD-01`)

As-Is `VOICE`(대표 20초·Uniform(10,30) — `C2-VOICE-COORD-01` 승계) / To-Be DL 2초
(linkSemanticsV2 ON이면 IFCN 1초). **As-Is 20초는 링크(전선) 성능이 아니라 음성/VTC 협조
절차 지연이다** — codex는 Link-K 전선을 "1초 보수"로 판정했지만 육↔공 협조 절차는
모델링하지 않아 참고 정본이 없다(전선 ≠ 절차 — params.md에 명기). 따라서 linkSemanticsV2가
켜져도 As-Is 측은 codex 정합 대상이 아니다. ADR-057의 변형 카탈로그 패턴 재사용
(캐시 키 `|appr`) — OFF 카탈로그 wire shape 불변.

### ADR-056·057과의 상호작용

- `unifiedEngagementState`와 독립 — 승인 대기 중인 위협도 교전상태 소비·COP 해소 대상
  (게이트는 dedup/plan-block 검사 **뒤에** 위치 — 보류가 승인 요청보다 우선).
- `linkSemanticsV2` ON이면 신설 링크 To-Be 측만 IFCN 1초를 따른다(위 절차/전선 구분).

## 구성 (변경 파일)

`js/model/iads/c2-policy.js`(신규) · `index.js`(export) ·
`js/config/deployment-adapter.js`(`|appr`·`|op:` 변형, coord 링크, 운용자 스윕 노브) ·
`js/engine/sim-engine.js`(플래그 2종·`_iadsApprovalGate`·`_onIadsApproveArrive`·디스패치·
approval branch-local·coordDelaySum 배선) · `tests/approval-chain.test.mjs`(15 어서션,
run-all 등록) · `docs/params.md`(`IADS-APPR-COORD-01`·`IADS-APPR-CHAIN-01`).

## 검증

`tests/approval-chain.test.mjs`: OFF wire shape 불변 / ON 카탈로그 값(음성 20초·DL 2초·
v2 시 IFCN 1초·As-Is 음성 불변) / As-Is 관측 3종(협조몫 36.0초·approval 59건·포화 위임
97건 — 수용 기준) / To-Be 차등(경유 0·on-loop 서비스 31건·SC2 auto-preauth ON==OFF
bit-exact) / **USFK 축 approval 0건**(FULL 실측·어서션) / 반증 플래그 동작.
OFF bit-exact: Phase 2 종료 시점 SHA-256 4셀 일치 + legacy `baseline.test.js` 통과.

### MCRC 이중 부하 계측 (제약 5)

단일 seed(12345·900초) 노드 전체 ρ와 30-seed 평균 approval 분해:

| 관측 | OFF | ON |
|---|---|---|
| SC1 As-Is MCRC 노드 ρ (seed 12345·900초) | 0.192 | **0.469** (maxInSystem 5→10) |
| SC3 ×3.0 As-Is MCRC 노드 ρ (동일) | — | **0.887** (K 근접) |
| SC1 As-Is approval ρ / Wq (30 seed·1800초) | 0 / 0 | **0.280 / 1.34초** |
| SC3 As-Is approval ρ / Wq (30 seed·1800초) | 0 / 0 | **0.510 / 36.78초** |
| SC3 As-Is track ρ (동일) | 0.953 | 0.952 (불변) |

같은 위협을 `iads_track`+`approval`로 두 번 서비스하는 legacy 동일 의미론
(`ENV-DES-C2K-01`: 같은 K 공유). SC3 As-Is에서 승인 대기 Wq 36.8초 —
"결심 지연의 본체는 통신이 아니라 승인 대기행렬"이라는 legacy 발견이 native에서 재현된다.

### 편향 원장 (2-베이스 paired MC 30 seed × 1800초 × ×1.5)

주 베이스 = `{unifiedEngagementState, linkSemanticsV2}` ON(결함 수정 + 정본 정합 상태),
참고 베이스 = 전 플래그 OFF. 원자료 `artifacts/experiment/phase3-*.json`.

**주 베이스 위 approvalChain 단독 효과** (Δ = To-Be − As-Is):

| 지표 | SC1: OFF → ON | SC3: OFF → ON |
|---|---|---|
| 협조몫(As-Is) | 0 → **34.6초** | 0 → **19.1초** |
| 결심지연 Δ | −4.0 → −6.9 [−8.7,−5.1] | −41.9 → −45.0 [−47.1,−42.9] |
| 격추율 Δ | +0.6pp → +0.7pp (무이동, CI 0 포함) | **+18.8pp → +18.7pp (무이동)** |
| 누수율 Δ | −0.6pp → −0.3pp (무이동) | −18.8pp → −18.6pp (무이동) |
| As-Is 중복교전 | 16.1 → 14.8 | 33.2 → **19.7** (승인 직렬화가 동시결심 경합 억제) |
| exchangeSat | 20.4/20.5 → 20.6/20.6 | 4.98/4.71 → 4.91/4.76 — ≫1 유지 |

**🔴 판정**: 임무 지표(격추·누수) 개선폭은 **이동 없음**. 결심지연 개선폭은 SC1 −4.0→−6.9초
(상대 +72% — 절대 +2.9초), SC3 +7.5%. 상대 기준 20%를 넘는 항목(SC1 결심지연)이 있으므로
실험보고서 최상단에 🔴로 명시하되, 절대 크기(3초)와 임무 지표 무이동을 함께 적는다.

**참고 베이스(전 OFF) 위 동일 토글** — 효과가 3~4배 과장된다:
SC1 결심지연 Δ −7.5→−26.1(주 베이스의 3.8배), 격추율 Δ +0.9→+4.3pp(주 베이스는 무이동).
**같은 변경이 낡은 기준선 위에서는 훨씬 커 보인다** — 일률 16초 링크(ADR-057이 폐기한 해석)
위에 승인 단계가 얹히며 As-Is 페널티가 중첩 과장되기 때문. 두 베이스의 방향은 같으나 크기가
다르며, 이것이 §0 측정 기준선 규정("수정·정합 상태가 새 분석 기준선")의 실증 근거다.

**반증 실험 (approvalChainTobe — To-Be에도 동일 계선 강제, SC3 30 seed)**:

| To-Be 지표 | 계선 없음 | 계선 강제 |
|---|---|---|
| 결심지연 | 124.0초 | **124.0초** (무변화) |
| 격추율 | 62.3% | 62.1% |
| 협조몫 | 0 | 0.65초 |

To-Be에 같은 계선을 강제해도 결과가 사실상 변하지 않는다 — To-Be의 위임 임계(×1)와
automation(on-loop/auto-preauth)이 계선 비용을 거의 0으로 만들기 때문. **따라서 As-Is↔To-Be
차이는 "승인 계선의 존재" 자체가 아니라 "in-loop 협조 절차(음성 왕복)와 승인 대기행렬,
그리고 늦은 분권 전환"에서 나온다** — "승인이 그냥 느려서"가 아니라 절차·자동화의 차이.

**operator.mid 민감도 (SC3 ×1.5 · 10 seed · 주 베이스, high 22.5/mid 37.5/low 57.5초)**:

| operator | As-Is 결심지연 OFF→ON | 협조몫 | 결심지연 Δ(개선폭) OFF→ON |
|---|---|---|---|
| high | 134.0 → 136.8초 | 14.7초 | −10.3 → −13.5초 |
| mid(30 seed) | 165.7 → 169.0초 | 19.1초 | −41.9 → −45.0초 |
| low | 190.5 → 206.5초 | 18.6초 | −64.2 → −80.5초 |

**방향은 세 수준 모두 동일**(To-Be 우위 확대), 크기는 operator 값에 민감(low에서 ON 효과
+16.3초 vs high +3.2초). 승인 계선 효과의 크기 인용에는 operator.mid가 등급 C임을 병기할 것.

## 결론 영향

G6 재산출(주 베이스 ON 기준): ① As-Is 핵심 병목(협조·승인) — **강화**: native에서 처음으로
협조몫(19~35초)과 승인 Wq(36.8초)가 관측되며 legacy 발견("지연의 본체는 승인 대기")이 재현.
② To-Be 병목 무기체계 이동 — 유지(legacy 무접촉). ③ exchangeSat ≫1 — 유지(전 셀 4.7~20.6).
④ 신궁·천마 제약 — 유지(37스위트 887어서션 통과). **뒤집힌 것 없음.**

## 되돌리는 법

- 런타임: `features.approvalChain=false`(기본). 반증 플래그도 기본 OFF.
- 코드: 이 커밋 revert. 변형 카탈로그·플래그 게이트로 OFF 경로는 참조까지 동일.

## 한계

1. **적용 범위 한정의 대가** — legacy approval 146건에는 자기-승인 축의 서비스도 섞여
   있었을 수 있으나 분해 근거가 없어, native는 구조적으로 경유가 실재하는 LOCAL_AD 축만
   이식했다. legacy와 approval 건수 절대치는 일치하지 않는다(의미론 이식이지 수치 복제가
   아님).
2. **승인 드롭의 재시도 없음** — 드롭된 승인 요청은 해당 축의 교전 기회 상실로 남는다
   (실패 증거 `approval_dropped` 계상). legacy도 재시도가 없었으나 legacy는 전체 누수로
   처리했다는 차이가 있다(위 branch-local 결정).
3. **operator 스윕은 10 seed** — 30 seed 본 측정보다 CI가 넓다(민감도 방향 확인 목적).
4. **releaseAuthority는 선언만** — 현행 native 해제 의미론(책임 C2 자신)을 문서화했을 뿐
   새 거동을 만들지 않았다.
