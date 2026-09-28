# ADR-103 — 탄도 위협의 시작 보고원을 조기경보 레이더(그린파인)로 고정한다 (`ballisticReportSource`)

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

🔴 **에스컬레이션 표기**: 기준 실행(SC3 · FULL_NORMAL · seed 29 · 1800초 · 화면 기본 플래그)에서 To-Be − As-Is 격추 차이가
OFF +8(173−165) → ON +11(178−167)로 **상대 37.5% 움직였다**(저장소 규칙 20% 초과). seed 하나의 관측이라 방향·크기를
확정하는 수치가 아니며, 20 seed 쌍대 비교로 다시 재야 한다(§한계). 이 플래그는 엔진·화면 모두 **기본 OFF**다.

- 날짜: 2026-09-28
- 상태: 채택 (엔진 기본 OFF · [지휘 흐름] 화면 기본 OFF — §프로토타입 기본값 참조)
- 관련: ADR-090(조기경보 보고원 — 추가 출처 **병합**) · ADR-091(탄도 발사점 연장) · ADR-062(0과 미측정 구분) · ADR-036(USFK 독립) · ADR-061(호환 원장)
- 번호: 작업 지시서는 ADR-102를 예약했으나 같은 날 ADR-102(지휘 흐름 기본 배치 FULL)가 먼저 채택돼 **103**으로 매긴다.
- 플래그: `ballisticReportSource` — 엔진 기본 OFF(불변 규칙 1) · 화면 `?bsrc=1`

## 맥락 — KAMDOC은 그린파인 보고를 한 건도 받지 못했다

실측(SC3 · FULL_NORMAL · seed 29 · 1800초 · 화면 기본 플래그 `pipe/icc/lx/aim/par` ON):

- 방사포(`mrl_large`) 90건의 As-Is 시작 경로가 **90/90** `FPS117_GANGWON_N → C2_MCRC → C2_ICC_BRIGADE_1 → C2_KAMD_OPS`였다.
  KAMDOC이 그린파인 보고로 시작한 방사포 항적은 **0건**이다(그린파인은 탐지 마크를 남기고도 보고 링크 통과 0).
- SRBM 53건은 `lx`(ADR-091) 덕에 48건이 그린파인 직보로 시작하지만, 5건은 포대 MFR(`LSAM_MFR`)이 시작 보고원이었다.
  같은 함수를 타므로 `lx=0`이면 방사포와 같은 문제가 난다.
- 원인은 ADR-090이 기록한 두 규칙이다. `_iadsReportBundle()`이 책임 C2로 가는 **최속 보고 경로 1개**를 센서 종류와
  무관하게 고른다(FPS-117 보고주기 8초 + coord 1초 + 1초 ≈ 10초가 그린파인 직보 16초를 항상 이긴다). 그리고
  `_routeIadsDetected()`가 **최초 획득 시점 스냅숏**으로 경로를 고정한다.
- 정본 IADS_codex(7c1c5bc9)는 다르다. `LINEAR_TOPOLOGIES.kamd_ballistic`이 `startNode: 'GREEN_PINE_B'`로 고정돼
  `KAMD_OPS → ICC → ECS → 사수`이고, `killchain.js _findStartSensor`는 `typeId === startNode`인 센서만 찾는다 — 그린파인이
  잡기 전에는 킬체인이 시작하지 않는다. `_recordC2ReportTrack`은 `threatCategory !== 'abt'`면 즉시 반환해 MCRC는 탄도
  항적을 기록하지도 넘기지도 않는다. codex ADR-044(MLRS를 MCRC/국지 경로로 라우팅 금지) · ADR-069(탄도 시작노드는
  킬웹에서도 무변경).

## 결정

`ballisticReportSource` 플래그(기본 OFF)를 둔다. ON이면:

1. **시작 보고원 고정** — 탄도 위협(`iadsThreatCategory === 'ballistic'`, srbm·mrl_large)의 **탄도 책임 C2**
   (As-Is `KAMD_OPS` 축 `KAMD` · KAMDOC 무력화 배치의 권역 ICC(같은 축) · To-Be `IAOC` 축 `KILL_WEB`)로 가는 보고
   번들은 `role`이 `ballistic_early_warning`인 센서(GREEN_PINE_B/C)만 시작 보고원으로 채택한다. FPS-117·TPS-880K·
   포대 MFR의 탄도 탐지는 그 C2의 시작 보고원이 되지 않는다(`_iadsReportBundle` 필터).
2. **스냅숏 고정 해제** — 최초 획득 시점에 그린파인 track이 fresh하지 않으면 경로를 고정하지 않고(번들 null · commander
   key 미설정), 그린파인이 획득하는 스캔 사건에서 `_routeIadsDetected`가 다시 돌아 그때 라우팅한다. ADR-090의
   `_iadsSupplementEwReport`(원장 병합)와 달리 **시작 보고 자체**라 `IADS_C2_ARRIVE`와 C2 서비스 작업이 그때 생성된다.
3. **미개시 계상** — 그린파인이 끝내(격추·누수·관측 종료까지) 획득하지 못한 탄도 항적은 codex와 같이 한국군 탄도
   킬체인이 시작하지 않는다. 증거 `no_ew_report`(기여원인 · taxonomy 등재)와 계정
   `coordination.trackFusion.ballisticEwStarted + ballisticEwMissing = 탄도 생성 수`로 「0건」과 「미측정」을 가른다
   (ADR-062). 대기 중에는 `no_report_path` 사유·증거를 남기지 않는다 — 남기면 뒤늦게 시작한 항적까지 보고경로
   부재로 오분류된다.
4. **불변** — USFK 독립 축(THAAD/Patriot) · LOCAL_AD 축 · 비탄도(abt) 라우팅, 카탈로그 계선(MCRC↔ICC↔KAMDOC coord 포함 —
   교전현황·중복해소가 쓴다), `_linkDelay()` 호출 순서. MCRC가 탄도 항적을 접수하는 경로는 ON에서 **0건**이 된다.

OFF는 bit-exact다(`tests/hires-baseline.json` 6케이스 · 화면 기본 플래그 골든 4케이스 · flowTrace ON/OFF 계약).
ON도 관측(flowTrace) ON/OFF에 대해 bit-exact다.

## 수치 영향 (실측 — SC3 · FULL_NORMAL · seed 29 · 1800초 · 화면 기본 플래그)

| 조건 | 격추 / 누수 / 미해결 | 방사포 격추/누수/미해결 · 탐지→최초발사 중앙값 | SRBM 격추/누수/미해결 · 중앙값 | 탄도 시작 보고원 | MCRC 경유 탄도 |
|---|---|---|---|---|---|
| As-Is OFF | 165 / 40 / 23 | 53 / 33 / 4 · 66.7초 | 43 / 2 / 8 · 196.1초 | 방사포 FPS117 90 · SRBM 그린파인 48 + LSAM MFR 5 | 방사포 90 |
| As-Is ON | 167 / 37 / 24 | 51 / 34 / 5 · 92.6초 | 43 / 2 / 8 · 198.5초 | **그린파인 143/143** | **0** |
| To-Be OFF | 173 / 31 / 24 | 61 / 25 / 4 · 46.9초 | 39 / 6 / 8 · 198.3초 | 방사포 FPS117 90 · SRBM 그린파인 48 + LSAM MFR 5 | 0 |
| To-Be ON | 178 / 27 / 23 | 63 / 22 / 5 · 64.3초 | 42 / 4 / 7 · 195.7초 | **그린파인 143/143** | 0 |

| 조건 | KAMDOC 도착 · ρ · Wq | MCRC 도착(항적) · ρ | IAOC 도착 · ρ | 최빈 경로(방사포) |
|---|---|---|---|---|
| As-Is OFF | 143 · 0.501 · 2.16초 | 116(84) · 0.215 | — | FPS117_GANGWON_N → MCRC → ICC_BRIGADE_1 → KAMD_OPS → … (21건) |
| As-Is ON | 142 · 0.482 · 2.26초 | 117(84) · 0.217 | — | GREEN_PINE_CHUNGBUK → KAMD_OPS → … (24건) |
| To-Be OFF | 143 · 0.478 · 2.22초(통보) | 85(85) · 0.171 | 228 · 0.179 | FPS117_GANGWON_N → IAOC → ECS_LSAM_MID_NORTH → … (20건) |
| To-Be ON | 142 · 0.500 · 1.70초(통보) | 85(85) · 0.149 | 227 · 0.188 | GREEN_PINE_CHUNGBUK → IAOC → ECS_LSAM_MID_NORTH → … (18건) |

읽는 법:

- **시작이 늦어진다.** 방사포는 동부축(강원)에서 오고 그린파인 4기는 충남·충북·부산·전남에 있다. 강원 FPS-117이 먼저
  보던 것을 그린파인이 잡을 때까지 기다리므로 탐지→최초 발사 중앙값이 As-Is 66.7 → 92.6초, To-Be 46.9 → 64.3초로
  **늘어난다**. 그런데도 격추가 줄지 않는 것(As-Is +2 · To-Be +5)은 seed 29의 표본 차이(보고 링크 추첨 시점이 달라져
  실행 전체가 다른 표본)와 MCRC·ICC 경유 2홉이 사라진 효과가 섞인 결과다 — 한 판으로 가르지 않는다.
- MCRC의 도착 수가 그대로인 것(116→117 · 85)은 As-Is에서 MCRC 항적 도착 84건이 **공중 위협**뿐임을 뜻한다. 종전에도
  MCRC는 탄도 항적을 큐 작업으로 처리하지 않았고 **coord 계선의 중계 홉**으로만 지났다(그래서 KAMDOC 도착 수는 143 → 142로
  거의 같다). 이 ADR이 없애는 것은 그 중계 홉이다.
- 미개시(`ballisticEwMissing`)는 두 모드 모두 0이다 — `lx`가 켜진 기본 조건에서는 그린파인이 모든 탄도 항적을 잡는다.
  `lx=0`이나 그린파인이 없는 배치에서는 0이 아니며, 그때 증거가 미측정과 0을 가른다.

## 진단 A — 천궁-II 22개 포대가 탄도에 거의 쏘지 않는 이유 (구현 변경 없음 · `scripts/diagnose-cheongung2-ballistic.mjs`)

기준 실행(As-Is · OFF)에서 탄도 발사 131건 중 천궁-II 발사는 **6건**이다(작업 지시서의 「한 발도」는 다른 실행의 관측이다).
`system-types.js`의 천궁-II ABM `{ enabled: false }`는 원인이 아니다 — `compatibility.enabled`는 `!iadsSensorPhysics` 경로
(`_iadsEvaluate`·`_iadsGeometryWindow`의 compat 분기)에서만 읽히고 iads-c2에서는 ABM이 활성이다(§진단 B 주석).

| 유형 | 항적 | 어느 천궁-II 봉투(R 3~50km·H 0.5~20km)라도 체류 | 봉투∩MFR 사격통제 | **첫 결심 시점에 MFR 사격통제** | 봉투 진입 시점 PIP 가능 | 첫 결심 시점 PIP 가능 |
|---|---:|---:|---:|---:|---:|---:|
| mrl_large | 90 | 90 | 56 | **11** | 52 | 64 |
| srbm | 53 | 52 | 10 | **0** | 37 | 47 |

- (항적×포대) 봉투 체류 쌍 417건: 체류 길이 중앙값 13초(최대 31초). PIP 탐색(봉투 진입 시점부터, `findEarliestPip` 동일 규칙)은
  137건 가능 · 280건 「봉투 안이지만 요격탄 비행시간 > 도달 시간」. MFR 사격통제 상태와 겹치는 쌍은 200건이지만 **첫 결심
  시점**에 사격통제였던 쌍은 20건뿐이다.
- 첫 결심(사수선정·표적할당)은 봉투 진입보다 **중앙값 91.8초 앞서** 난다. 그 순간 천궁-II MFR은 사거리 밖이라 `no_fire_control`
  (증거 131건)로 후보에서 빠지고, C2는 그 시점에 실행 가능한 다른 사수(USFK Patriot·THAAD·L-SAM)에게 명령을 낸다. 계획이
  생기면 같은 축은 재결심하지 않으므로 천궁-II는 봉투에 들어와도 다시 평가되지 않는다. 즉 원인은 봉투·제원이 아니라
  **결심 시점의 사격통제 게이트 + 축당 계획 1개 규칙**의 결합이다. 나머지는 `no_feasible_pip` 95(결심 시점 기준 봉투 밖)·
  `too_early` 71·`ammo_depleted` 68이다.
- **고도 프로파일 대조(기록만)**: 엔진(`js/model/iads/index.js threatPhysics`)의 탄도 고도는 `maxAltitude × 거리계수 × sin(π·progress)`
  로, srbm 150km(거리 140km→82.5km · 545km→202.5km), mrl 35km(197·372km→47.3km)다. 작업 지시서의 「방사포 45km·SRBM 70km」와
  ADR-097 본문의 「정점 70km」는 이 식과 맞지 않는다(ADR-097 수치는 `lx` 이전 종말 구간 기준으로 보인다). `docs/모의논리서.html`
  §3·§5에는 탄도 고도식이 적혀 있지 않다. codex 탄도 운동학과의 차이 검토·수정은 **별도 ADR**로 넘긴다(이 ADR은 손대지 않는다).

## 진단 B — 죽은 플래그 주석

`system-types.js`의 `missile(…, { enabled: false })`(L-SAM AAM · 천궁-II ABM)가 iads-c2 경로에서 읽히지 않음을 주석으로
명시했다. 제거하지 않는다(ADR-061 호환 원장 보존).

## 프로토타입 기본값 — 사용자 확인 대기

작업 지시서는 이 플래그를 `pipe/icc/lx/aim/par`처럼 **화면만 기본 ON**으로 두자고 제안했다. 이는 ADR-090 추기(2026-09-01)의
「엔진 기본 OFF인 플래그는 프로토타입도 기본 OFF」 결정과 충돌한다. 지시서가 허용한 대로 **확인 전까지 화면 기본 OFF**
(`?bsrc=1`로 켬 · 켜면 상태줄 칩 「탄도 보고원 그린파인 ON」)로 두었다. 기본 ON으로 바꾸려면 `PARAMS`의 `bsrc` 기본값을 1로
올리고, README [지휘 흐름] 절의 기본값 문장과 이 절을 고친다(단일본 재생성 · xlsx 재내보내기 포함).

## 검증

- `tests/ballistic-report-source.test.mjs`(run-all 등록): OFF 골든 4케이스(LEGACY·FULL × As-Is/To-Be · 화면 기본 플래그)
  bit-exact + wire shape 키 없음 · ON 탄도 책임 C2 첫 link = 그린파인 `report-cycle` · MCRC 경유 탄도 link 0 · 비탄도 보고 link
  집합 OFF와 동일(th·from·to) · USFK 축 보고 link는 항적 생존 구간 안에서 동일(ON은 다른 표본이라 수명이 달라진다) · flowTrace ON/OFF 지문 동일 · `no_ew_report` 증거는 시작 안 한 항적에만 · 계정 항등식 ·
  KAMDOC_DOWN에서 권역 ICC 시작 보고도 그린파인.
- `tests/hires-baseline.test.mjs`(OFF 6케이스 SHA 불변 — 재수립하지 않음) · `flow-trace` · `failure-classification` ·
  `ballistic-launch-axes` · `command-flow-single`(단일본 재생성 후 `--check`) · `command-flow-config` · `prototype-readability` 통과.
  전체 스위트 `node tests/run-all.js` 결과는 커밋 메시지에 적는다.
- 캐시 버스터: js/engine을 고쳤으므로 `index.html`·워커·워커 클라이언트·프로토타입의 `?v=`를 20260928a로 올렸다.

## 한계·후속

- seed 29 한 판의 격추 차이 이동(+8 → +11)은 표본 차이와 구조 효과가 섞여 있다. 채택 근거는 **codex 구조 정합**이지 수치가
  아니며(ADR-081·090과 같은 논리), 효과 크기는 20 seed 쌍대 비교로 잰 뒤 인용한다.
- 그린파인의 **주기 갱신 보고**(16초마다)는 여전히 모델링하지 않는다(ADR-090 §한계 그대로).
- 시작이 그린파인으로 고정되면 강원 방사포처럼 FPS-117이 먼저 보는 축에서 시작이 늦어진다. 이것이 codex의 의도된 구조인지,
  FPS-117 → KAMDOC 직보를 허용해야 하는지는 codex ADR-044의 「MLRS를 MCRC 경로로 보내지 않는다」와 별개의 질문이다.

## 되돌리는 법

`ballisticReportSource` 미지정(기본 OFF)이면 종전과 bit-exact. 화면은 `?bsrc=0`(기본).
