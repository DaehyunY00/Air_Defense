# ADR-104 — 탄도 위협 사전대기 큐와 긴급발사 ② (`standbyCue`) — IADS_codex EmergencyReadySet 이식

> 본 문서의 모든 수치는 공개자료 기반 **정책연구용 개념값**이며 실제 작전자료가 아니다.

🔴 **에스컬레이션 표기**: 기준 실행(SC3 · FULL_NORMAL · seed 29 · 1800초 · 화면 기본 플래그)에서 To-Be − As-Is 격추 차이가
OFF +8(173−165) → A+B(gain 0) **+4**(201−197)로 상대 50% 움직였다(저장소 규칙 20% 초과). 누수 차이는 −9 → −1이다.
큐·긴급발사가 양 모드에 같은 크기로 들어가 **구조 차이를 좁히는** 방향이다. seed 하나의 관측이며 20 seed 쌍대 비교는
이 작업 범위 밖이다(별도 실험). 엔진·화면 모두 **기본 OFF**.

- 날짜: 2026-09-28
- 상태: 채택 (엔진 기본 OFF · [지휘 흐름] 화면 기본 OFF — §프로토타입 기본값)
- 관련: ADR-103(파트 A — 시작 보고원 그린파인 고정 · **이 플래그의 전제**) · ADR-071(자위권 발사 ③) · ADR-078(To-Be 도메인
  통보 — 큐 발행 주체는 IAOC이지 통보받는 KAMDOC이 아니다) · ADR-090(추가 출처 병합과의 구분) · ADR-070(engageOnRemote 불변)
- 번호: 작업 지시서는 ADR-103을 예약했으나 파트 A가 103으로 채택돼 **104**로 매긴다.
- 플래그: `standbyCue`(기본 OFF) · `standbyCueGateMode`(`awareness` 기본 / `decision_done`) · `cueAcquisitionGain`(기본 0) ·
  화면 `?bsrc=1&cue=1[&cuegain=]`

## 맥락 — 큐잉 부재

- 정본 IADS_codex(7c1c5bc9) `sim-engine.js _stepStandbyCues()`(ADR-035→068): 큐 발행 주체(Linear `KAMD_OPS` / killweb `IAOC`,
  ADR-053 D3)가 탄도 위협을 **인지**하면 위협당 1회, 방어층(`BALLISTIC_DEFENSE_TIERS`)별 자격 포대 전부를 `EmergencyReadySet`에
  넣는다. 자격 = operational · KAMD 축(USFK·Local AD 제외) · 층위 등재 · 대응 탄종 · 교전창 비-null. 잔탄·FC·동시교전은 멤버십에
  쓰지 않고 발사 평가에서 재검사한다. ReadySet 포대는 자기 MFR 사통이 잡히면 **정식 명령 도착 전에 발사**(긴급발사 ②)할 수 있고,
  같은 simTime의 성공한 정식 commit이 우선한다. codex ADR-026 filter2는 큐가 포대의 표적 필터·운용 모드(응시 섹터)에 위협을
  주입해 획득을 앞당긴다. codex 결과: 천궁-II가 회당 16발 발사, 방사포 누출 182 → 19.0/회.
- K-JAMDS에는 큐·②가 없었다. 있는 것은 자위권 ③(`selfDefenseFire`, ADR-071 — 지명·명령 전무 + 자기 MFR + 포대 10km 이내 낙하)뿐.
  codex는 ②(지명 전제)와 ③(지명 없음)을 상호배타 사다리로 둔다.
- 천궁-II 22개 포대의 탄도 미교전 진단(ADR-103 §진단 A): 첫 결심이 봉투 진입보다 중앙값 91.8초 앞서 나고, 그 순간 천궁-II MFR은
  사거리 밖이라 `no_fire_control`로 빠진다. 큐잉이 있어야 봉투에 들어온 뒤 자기 사통으로 쏠 수 있다.

## 결정

`standbyCue` 플래그(기본 OFF · `ballisticReportSource` ON 전제 — A가 꺼져 있으면 비활성이며 결과 `features.standbyCue =
'disabled_without_ballisticReportSource'`로 남긴다). ON이면:

1. **ReadySet 생성(B-1)** — 발행 주체는 탄도 책임 C2 중 global scope(As-Is `KAMD_OPS` · To-Be `IAOC`). KAMDOC 무력화 배치의 권역
   ICC·ECS 위임은 큐를 내지 않는다. 시점은 **인지** = 파트 A의 그린파인 시작 보고가 그 C2에 **도착**한 사건(`awareness`, C2 처리
   완료를 기다리지 않음). 선택지 `decision_done`(위협판단 완료 시)도 있다. 위협당 1회. 자격 = `forceOwner==='ROK'`(USFK·
   `ROK_LOCAL_AD` 제외) · `BALLISTIC_DEFENSE_TIERS` 등재(L-SAM 상층, 천궁-II·PAC-3 하층 — params.md IADS-CUE-TIER-01, 등급 C) ·
   자원 실재 · (To-Be) 상층 웹(`_iadsWebOf`) · `_iadsCanEngage` · `_iadsGeometryWindow` 비-null(캐시 · 난수 없음). 큐는 발행 C2 →
   ICC → ECS 하향 계선(`_iadsShortestPath(commander, ecs, ['coord','command'])`)의 지연만큼 늦게 도착하고(`IADS_CUE_ARRIVE`),
   flowTrace에 `kind:'cue'` link 사건으로 남는다(`_recordLink`). **C2 서비스 큐를 소모하지 않는다**(ADR-090 §46→36 교훈 —
   테스트가 KAMDOC·IAOC `iads_track` 도착 수 불변을 고정).
2. **긴급발사 ②(B-2)** — 큐가 도착한 포대는 정식 명령 전이라도 자기 MFR `FIRE_CONTROL`(싼 사전 점검) · 교전창 안 · `_iadsEvaluate`
   feasible(PIP·잔탄·동시교전)이면 발사한다(`launchCause='standby_emergency'`, `delegationLevel='STANDBY_CUE'`). 정식 우선: 탄도 책임
   C2 축의 살아 있는 정식 계획(하달 중 포함)이 있으면 물러선다. 긴급 계획이 살아 있으면 같은 축의 정식 결심은 기존
   `_iadsPlanBlocks`가 막으므로 같은 위협에 정식+긴급 이중 발사가 없다(안전망으로 `_onIadsFire`에 같은 축 중재 `standby_arbitration`
   추가). 큐를 받은 포대는 ③ 자위권을 타지 않는다(상호배타). 발사는 ③과 같이 하달 계선 없이 즉시(큐가 이미 ECS를 거쳤으므로
   접수 큐도 다시 타지 않는다).
3. **획득 이득(B-3, 명시된 근사)** — K-JAMDS에는 운용 모드 모델이 없어 codex filter2를 옮길 수 없다. 대신 `cueAcquisitionGain`
   (기본 **0** = 이득 없음)이 큐 도착 포대 MFR의 `transitionTime.detectToTrack`·`trackToFireControl`을 (1 − gain)배로 줄인다.
   탐지확률·RNG 소비 순서는 건드리지 않는다(gain 0이면 센서 전이 마크가 A-only와 동일 — 테스트 고정). **값의 근거는 없다(등급 C).**
4. **To-Be(B-4)** — IAOC가 발행하고 상층 웹 포대만 자격. `engageOnRemote`는 건드리지 않는다.
5. **불변** — 카탈로그 계선(cue는 기존 하향 계선을 쓴다) · USFK 독립 · LOCAL_AD·abt 라우팅 · 탐지확률 · `_linkDelay()` 순서 · 천궁-II
   ABM·고도 프로파일.

OFF(두 플래그 모두)는 bit-exact(`tests/hires-baseline.json` 6케이스 · flowTrace 계약). cue만 켜고 A가 꺼진 실행은 동역학이 OFF와
같다(features 제외 지문 동일 — 테스트 고정). ON도 flowTrace ON/OFF에 대해 bit-exact.

## 수치 영향 (C-1 진단표 — `scripts/diagnose-ballistic-cue.mjs` · SC3 · FULL_NORMAL · seed 29 · 1800초 · 화면 기본 플래그)

| 모드 | 조건 | 격추/누수/미해결 | 방사포 격추/누수 · 탐지→최초발사 중앙값 | SRBM | 천궁-II·PAC-3·L-SAM 탄도 발사 | 발사 원인 | 그린파인 시작 도착(초) | 큐 도착(초) · 자격 포대 | KAMDOC ρ · IAOC ρ | 유휴 포대 |
|---|---|---|---|---|---|---|---|---|---|---|
| As-Is | OFF | 165/40/23 | 53/33 · 66.7 | 43/2 · 196.7 | 6·9·45 | commanded 150 · mcrc 37 · autonomous 27 · self_defense 1 | 18.8 | — | 0.501 · — | 56 |
| As-Is | A | 167/37/24 | 51/34 · 92.6 | 43/2 · 198.5 | 8·16·39 | commanded 154 · mcrc 32 · self_defense 6 · autonomous 27 | 17.3 | — | 0.482 · — | 58 |
| As-Is | A+B g0 | **197/5/26** | **86/0 · 41.2** | 40/4 · 197.2 | 1·28·87 | **standby_emergency 100** · commanded 105 · mcrc 31 · autonomous 33 | 17.3 | 19.3 · 7 | 0.489 · — | 60 |
| As-Is | A+B g0.3 | 198/5/25 | 85/1 · 37.8 | 44/3 · 198.4 | 2·23·87 | standby_emergency 98 · commanded 106 · mcrc 27 · autonomous 30 | 17.3 | 19.3 · 7 | 0.518 · — | 59 |
| To-Be | OFF | 173/31/24 | 61/25 · 46.9 | 39/6 · 198.3 | 6·9·62 | commanded 192 · autonomous 45 | 18.8 | — | 0.478 · 0.179 | 63 |
| To-Be | A | 178/27/23 | 63/22 · 64.3 | 42/4 · 195.8 | 10·13·61 | commanded 202 · autonomous 46 · self_defense 2 | 17.3 | — | 0.500 · 0.188 | 60 |
| To-Be | A+B g0 | **201/4/23** | **85/1 · 37.2** | 45/2 · 198.7 | 1·30·82 | **standby_emergency 93** · commanded 127 · autonomous 49 | 17.3 | 18.3 · 7 | 0.411 · 0.205 | 62 |
| To-Be | A+B g0.3 | 199/5/24 | 83/2 · 37.9 | 45/2 · 199.0 | 3·24·88 | standby_emergency 92 · commanded 129 · autonomous 48 | 17.3 | 18.3 · 7 | 0.521 · 0.181 | 59 |

(가장 긴 대기는 KAMDOC이며 네 조건 모두 Wq 2초 안팎, 드롭 0 — 큐는 C2 큐를 늘리지 않는다.)

천궁-II ABM 봉투 체류(항적×포대 417쌍 · 봉투 진입 시점 PIP 가능 137 · 요격탄 비행시간 초과 280 — 네 조건 동일) 중 MFR 사통과
겹친 쌍: As-Is OFF 200 · A 217 · A+B 87 · A+B g0.3 93 / To-Be 158 · 179 · 82 · 98. 큐 계정(양 모드 동일): 위협 142 · 통지 968 ·
도착 968 · 경로 없음 0 · 긴급발사 계획 As-Is 100/98 · To-Be 93/92 · 중재 0.

읽는 법:

- **누수가 무너진다.** 방사포 누수 As-Is 34 → 0, To-Be 22 → 1. 긴급발사 ②가 정식 결심(KAMDOC 37.5초 + ICC 9초 + ECS 3.5초)을
  기다리지 않고 자기 사통이 잡힌 순간 쏘므로 탐지→최초 발사 중앙값이 92.6 → 41.2초(As-Is), 64.3 → 37.2초(To-Be)로 준다.
  발사의 절반 가까이가 `standby_emergency`다(As-Is 100/269 · To-Be 93/269).
- **구조 차이가 좁혀진다.** 큐·②는 양 모드에 같은 크기로 들어가고 As-Is의 약점(느린 C2 사슬)을 더 크게 구제한다. To-Be 우위
  격추 +8 → +4, 누수 −9 → −1. 이것은 ADR-071(자위권)과 같은 방향의 **As-Is 구제** 효과이며, 채택 근거는 codex 구조 정합이지 수치가
  아니다.
- **천궁-II는 여전히 거의 쏘지 않는다**(탄도 발사 1~3건). 긴급발사의 대부분은 L-SAM(87·82)과 PAC-3(28·30)이 낸다 — 사거리·고도
  봉투가 넓어 자기 MFR 사통이 먼저 잡히고, 그 발사가 위협을 먼저 끝내 천궁-II 봉투 체류 자체가 줄어든다(사통 겹침 217 → 87쌍).
  codex의 「천궁-II 16발」은 filter2 획득 이득과 층위 순서가 함께 만든 결과인데, 여기서는 획득 이득 0.3에서도 2~3건에 그친다 —
  천궁-II MFR의 사격통제 전이(5초+3초)보다 **봉투 체류 자체(중앙값 13초)와 요격탄 비행시간 조건(280/417쌍 초과)**이 제약이다.
- 유휴 포대 수(56~63)는 거의 그대로다. 큐는 자격 포대 7개(중앙값)에게 가지만 발사는 먼저 사통이 잡힌 하나가 한다.
- 「중복교전 해소」 계정이 는다(단일본 LEGACY 600초 실측 해소 0 → 21). 긴급 계획이 살아 있는 동안 같은 축의 정식 결심이
  `_iadsPlanBlocks`에서 막히며 기존 코드가 이를 `deconflicted`로 센다 — 종전에도 활성 계획이 있으면 같은 계정을 쓰던 자리라
  새 계정을 만들지 않았다. 읽을 때 「긴급 선점」이 섞였음을 안다.

## 프로토타입 기본값 — 사용자 확인 대기

지시서는 `bsrc`·`cue`를 `pipe/icc/lx/aim/par`처럼 화면만 기본 ON(gain 0)으로 두자고 제안했다. ADR-090 추기의 「엔진 기본 OFF면
화면도 OFF」 결정과 충돌하므로, 지시서가 허용한 대로 **확인 전까지 화면 기본 OFF**(`?bsrc=1&cue=1`로 켬 · 칩 「사전대기 큐 ON」 ·
`cue=1&bsrc=0`이면 칩 「⚠ 사전대기 큐 비활성 — bsrc=0」)로 두었다. 기본 ON으로 바꾸려면 `PARAMS`의 `bsrc`·`cue` 기본값을 1로
올리고 README 기본값 문장과 ADR-103·104의 이 절을 고친다(단일본 재생성 · xlsx 재내보내기 포함).

## 검증

- `tests/standby-cue.test.mjs`(run-all 등록): cue만 켜면 비활성 신고 + 동역학 OFF 동일 · 큐 위협당 1회 · 비탄도 큐 0 · 큐 도착
  포대 전부 한국군 상층 방어층 · cue link에 USFK·국지방공 목적지 없음 · 큐 도착 전 긴급발사 0 · 긴급발사 전부 자기 MFR
  FIRE_CONTROL 상태 · 긴급 발사~BDA 사이 같은 위협에 한국군 다른 발사 0 · 큐 받은 포대 자위권 0 · KAMDOC/IAOC `iads_track` 도착
  A-only와 동일 · 'cue' 서비스 작업 없음 · gain 0이면 센서 전이 마크 A-only와 동일(공통 생존 구간 7,016·6,912건) · gain 0.3에서
  큐 포대 MFR 사통 전이 앞당김(227·238건) · 생성 = 격추 + 누수 + 미해결 · 발사 마크 = Σ fireByCause · flowTrace ON/OFF 동일.
- `hires-baseline`(OFF 6케이스 SHA 불변 — 재수립하지 않음) · `flow-trace` · `ballistic-report-source` · `codex-alignment` ·
  `command-flow-single`(단일본 재생성 후 `--check`) · `command-flow-config` 통과. 전체 스위트 결과는 커밋 메시지에 적는다.
- 헤드리스 Chrome에서 단일본 `?cue=1`은 경고 칩, `?bsrc=1&cue=1&cuegain=0.3`은 「사전대기 큐 ON (획득이득 0.3)」 칩 · 페이지 오류 0.

## 한계·후속

- 획득 이득은 **근사**다. codex filter2(운용 모드·응시 섹터)를 옮기려면 센서 커널에 운용 모드 개념이 필요하다(별도 ADR).
- 탄도 고도 프로파일(`threatPhysics`: maxAltitude × 거리계수 × sin(π·progress))과 codex 운동학의 차이는 ADR-103 §진단 A에 기록만
  했다. 천궁-II 봉투 체류가 짧은 원인 후보이며 수정은 별도 ADR.
- 큐 통지는 포대당 한 번, 갱신 없음. codex의 ReadyNotice 갱신·해제(위협 소멸 시)는 이식하지 않았다 — 위협이 죽으면 `_cueReady`는
  더 이상 읽히지 않을 뿐이다.
- 20 seed 쌍대 비교는 이 작업 범위 밖. seed 29 한 판의 우위 축소(+8 → +4)는 그 실험 뒤에 인용한다.

## 되돌리는 법

`standbyCue` 미지정(기본 OFF)이면 종전과 bit-exact. 화면은 `?cue=0`(기본). 파트 A만 되돌리려면 ADR-103.
