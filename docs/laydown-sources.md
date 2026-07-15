# 소싱 지도 — Fire-Unit Layer(WP1) + 자체교전(WP2) 파라미터 출처표

> **디스클레이머**: 본 문서의 모든 수치는 **공개자료(OSINT) 기반 정책연구용 추정값이며 실제 작전자료·실제 배치가 아님.** 공개 제원과 유사하더라도 실제 편성·배치 데이터가 아니다. **좌표·부대위치는 일절 특정하지 않으며 도시 수준 개념좌표만 사용**한다(수치는 실측 지향, 위치는 추상 유지 — 이 비대칭이 본 프로젝트의 안전선이다). 조사 접근일: **2026-07-15**.

작업지시서 §1.5 데이터 소싱 규율에 따라, 신규·기존 파라미터를 부류별로 조사하고 A·B 출처 확보 가능 여부를 지도화한다. 등급 재정의(§1-5): **A** 공식 공개출처 / **B** 복수 독립출처 일치 또는 A값 산술유도 / **C** 공개자료 부재로 유추(스윕 필수).

> ⚠️ **접근 제약(정직 기록)**: 조사 중 iiss.org·en.wikipedia.org·namu.wiki·armscontrol.org·CSIS Missile Threat 등에 대한 직접 `WebFetch`가 조직 egress 정책으로 403 차단되었다(우회하지 않음). 아래 값은 동일 공개출처의 **검색 인덱스 요약 + 직접 접근 가능한 방산매체**(Janes·Naval News·Army Recognition·Asian Military Review·38 North·Defense Post 등)의 교차확인으로 작성했다. 게시 전 1차 출처(IISS *Military Balance* 한국편, ROK 국방백서, CSIS Missile Threat 원문)의 사람 검증을 권고한다.

---

## 1. 요격체계 제원 (요격고도·사거리·티어·발사대 발수·MFR 채널)

| System (legacyOf) | 파라미터 | 값 | 등급 | 출처 | 비고 |
|---|---|---|---|---|---|
| **L-SAM** (MDU-L) | 요격사거리 | ~150 km (L-SAM-II 레이더 180km) | B | Wikipedia L-SAM; Army Recognition 2025 | 기존 rangeKm 150 **재확인** |
| L-SAM | 요격고도 | 40–70 km(과제값) — 공개범위 40–100km, 통상 50–60km | B | Wikipedia; Asian Military Review 2024-12 | 출처 간 상충 → 보수적 40–70 유지, ceiling 스윕 |
| L-SAM | 티어 | 상층(terminal high-tier ABM) | A | DAPA 완료발표(The Defense Post 2024-12) | tier=upper |
| L-SAM | 발사대당 발수 | 6발/발사대, 포대=4발사대(2 AA + 2 ABM) | B | Asian Military Review; TWZ | TEL 6발 → 4×6=24(기존 magazine 24와 정합) |
| L-SAM | MFR 동시교전 채널 | S-band AESA, 탐지 ~600km. **동시교전 채널 정수 미공개** | C | Grokipedia/Wikipedia 요약 | **GAP** → 스윕(3 채택) |
| L-SAM | 요격시험 성공률 | 2022-11-22 첫 hit-to-kill, 2024-11-29 개발완료. **집계 성공률·pk 미공개** | — | Wikipedia; TWZ | **GAP** → pk는 C+스윕 |
| **천궁-II** (MDU-M) | 요격사거리 | ~40km(탄도) / ~50km(공기흡입) | B | globalsecurity.org m-sam; Asian Military Review 2025-08 | 기존 rangeKm 40 재확인 |
| 천궁-II | 요격고도 | ~15–20km(통상) / 일부 ~40km | B/C | Defence Security Asia; Army Recognition 2025 | 상충 → 15–20 유지, 40은 C |
| 천궁-II | 발사대당 발수 | **8발/발사대** | B | Defence Security Asia; TheDefenseWatch | 과제 "8" 확인 |
| 천궁-II | 탄도 대응 | 가능(hit-to-kill, 능동 종말호밍) | A | globalsecurity.org; Zona Militar 2026 | canEngage.srbm 유지 |
| 천궁-II | MFR 동시교전 | 40표적 추적, "6 탄도 동시교전" 보도 | B/C | TheDefenseWatch; Army Recognition 2025 | "40 추적" B / "6 동시교전" C(단일출처) |
| **PAC-3(ROKAF)** (MDU-M 계열) | 변형 | MIM-104F PAC-3 **CRI**(MSE 아님) | A/B | Janes; Defense News 2022-06 | ROKAF는 CRI |
| PAC-3 CRI | 요격사거리/고도 | ~35km / ~20km(CRI, 탄도) | B | TheDefenseWatch; Wikipedia MIM-104 | MSE보다 낮음 |
| PAC-3 CRI | 발사대당 발수 | **16발**(M903, CRI 캐니스터) | A/B | Wikipedia MIM-104; Janes | CRI 16 / MSE 12 |
| **SM-2**(ROK) (SM2-E/W) | 변형 | SM-2 Block IIIB(RIM-66) | A | Wikipedia Sejong-class | |
| SM-2 | 사거리/고도 | ~150–185km / >24km | B | Wikipedia RIM-66; weaponsystems.net | 기존 rangeKm 150 재확인 |
| SM-2 | 티어 | **함대공(대공/대순항) — 탄도 요격 불가**(SM-3/6 미탑재) | A | Wikipedia RIM-66; USNI 2022-03 | canEngage.srbm=false 유지 |
| SM-2 | VLS | KDX-III 128셀(80 Mk41 + 48 K-VLS) | A/B | Wikipedia Sejong-class; USNI 2022 | 함정 battery화 판단근거(ADR-010) |
| **신궁 KP-SAM** (SHORAD) | 사거리/고도 | ~7km / ~3.5km | B | missilery.info; Wikipedia Chiron | 기존 rangeKm 7 재확인 |
| 신궁 | 탄도 대응 | **불가**(IR/UV MANPADS) | A | Wikipedia Chiron | **제약 불변**(canEngage.srbm=false) |
| 신궁 | 시험 명중률 | 개발시험 ~90%(≠ 전투 pk) | B | missilery.info | pk는 C |
| **천마 K-SAM** (SHORAD) | 사거리/고도 | ~9–10km / ~5km | B | globalsecurity.org ksam; MDAA | |
| 천마 | 발사대당 발수 | 8발(2×4 포탑 즉응) | B | tank-afv.com; Missilery Pegasus | |
| 천마 | 탄도 대응 | **불가**(CLOS 단거리) | A | globalsecurity.org ksam | **제약 불변** |
| **비호 K-30** (SHORAD) | 대공유효 | ~3km(쌍열 30mm), 신궁통합 시 ~7km | B | Wikipedia K30 Biho(DAPA 2013) | |
| **벌컨 K263** (SHORAD) | 유효고도 | ~1.2km(army-guide) / ~2km(M167 계열) | B/C | army-guide.com; militaryfactory | 상충 1.2–2.0 → 기존 2km(C2-VULCAN-CEIL-01) 유지, ceiling 스윕 |

**GAP 요약(요격체계)**: L-SAM/천궁-II MFR 동시교전 채널 정수, 전 체계 전투 pk, PAC-3 CRI ROK 특화 제원, 벌컨 정확 고도 — 모두 C + 스윕.

---

## 2. 배치 수량·편성 (포대/대대/함정 수 — 개념 laydown 근거)

| 항목 | 보도 수량/범위 | 등급 | 출처 | 비고(개념 laydown 반영) |
|---|---|---|---|---|
| Patriot(PAC-3 CRI) 포대 — 공군 | **8 포대** | B | Arms Control Assoc.; IISS 2026-03 | 8±1 |
| 천궁 Block-I(대공) 포대 | ~8–18(출처 상충) | C | CSIS Missile Threat; Wikipedia M-SAM | 범위 8–18 → 중앙값 스윕 |
| 천궁-II(Block-II, ABM) 포대 | 당초 7 계획 → ~20 확대(공군) | B | Janes; IISS 2026 | 포대=MFR+4 TEL×8=32발 |
| L-SAM 포대 | ~2–4 계획(2027–28 전력화) | B | Korea Herald; Asian Military Review; Army Recognition 2025 | 상층 소수 |
| 육군 군단 SHORAD | 6개 군단, 각 방공대대(천마·비호·벌컨·신궁) — ~6–8 대대 | C | Wikipedia ROKA 구조; namu 방공 | ORBAT 미공개 → 스윕 |
| 수방사 방공 | 제1방공여단(여단 규모, 서울 P-73) | C | Wikipedia 1st Air Defense Brigade | 여단 1(~2–4 예하 대대) |
| 이지스 구축함(KDX-III) | 목표 6척(Batch-I 3 + Batch-II 3, 현재 ~4 운용) | A/B | Wikipedia Sejong-class; Naval News; Army Recognition 2026 | Batch-II BMD(Baseline 9) |
| ROK 총 방공 포대 | **단일 공식 총계 없음** ≈ 25–50 주요 SAM 포대(육군 SHORAD 제외) | C | 행 1–4 산술유도 | 모델링 envelope, 인용값 아님 |

**GAP 요약(배치)**: 정확한 현행 Patriot/천궁 포대 수·군단 방공대대 ORBAT·수방사 예하 편성·공식 총계 — 미공개. 개념 laydown은 **커버리지 매트릭스 무공백**을 목표로 보도 범위의 하한~중앙값을 채택하고 스윕한다. **실제 배치·좌표는 특정하지 않는다.**

---

## 3. 위협 제원·요격탄/위협 단가·pk

| 항목 | 값 | 등급 | 출처 | 비고 |
|---|---|---|---|---|
| KN-23 사거리 | ~450km(500kg) / 최대 690km(경량) | A | CSIS Missile Threat KN-23 | 기존 rangeBandKm 400–690 재확인 |
| KN-23 속도 | 정점 ~Mach 6(~2km/s), 종말 감속 | B | GlobalSecurity; Beyond the Horizon | 기존 speedKmh 6000 정합 |
| KN-23 정점고도 | ~50km(420km사) — 저각(depressed) | A | CSIS(시험데이터) | |
| KN-23 비행시간(400–600km) | **~4–7분(추정)** | C | 산술추정 — 공개수치 없음 | **GAP** → dwellSec 90 유지, 스윕 |
| KN-24 사거리/속도 | ~400km / Mach 6.1–6.9 | A/B | CSIS KN-24; GlobalSecurity | |
| KN-25 사거리 | ~350–380km | A | CSIS Missile Threat KN-25 | 기존 350–400 정합 |
| KN-25 발사간격 | **~20초/발**(4연장 TEL) | A | 38 North 2020-03; CSIS | 기존 THR-KN25-RNG-01 재확인 |
| 소형 UAV(2022.12) | ~2m, 속도 ~100km/h, 고도 ~3km, 항속 ~500km | A/B | 38 North 2023-01 | 기존 speedKmh 100·고도정합 |
| PAC-3 MSE 단가 | ~$3.87–4.2M(미육군 예산) | A | US Army FY2026 Missile Procurement | FMS 패키지 $6.25–7M은 C |
| SM-2 단가 | ~$2.0–2.5M(IIIB ~$2.1M) | B | TWZ; MDAA | 기존 costPerShotM 2.1 **재확인(B)** |
| 천궁-II 요격탄 단가 | ~$1.1M(≈15–17억원/발) | B | IISS 2026-03; Wikipedia M-SAM | 기존 MDU-M costPerShotM 3 → **갱신 검토(3→2)** |
| L-SAM 요격탄 단가 | **per-round 미공개**(양산계약 총액만: ₩705.4B 체계·₩357.3B 레이더) | A(총액)/GAP(단가) | The Defense Post 2025-12; Asian Military Review | 기존 8 유지(C, 상층급 유추) |
| KN-23급 SRBM 단가 | ~$2–3M(추정) | C | RAND(Bennett) via RFA | 기존 3 정합 |
| KN-25 방사포탄 단가 | 미공개("탄도탄보다 저가") | C/GAP | CSIS/Wikipedia(정성) | 기존 1 유지(C) |
| 소형 UAV 단가 | 미공개(~$10k–50k 유추) | C/GAP | 상용 유추 | 기존 0.01 정합 |
| 천궁-II 전투/시험 | UAE ~96%(29/30, ~60발 사용) | B | Seoul Economic Daily 2026; IISS | **시험≠pk**. 60/30=표적당 2발 → 발당 pk ≪96% |
| PAC-3 비행시험 | ~92%(9/10) | A/B | Lockheed Martin | 통제시험, 전투 아님 |
| L-SAM 성공률 | **미공개**(개발완료 선언만, DAPA 2024-05) | GAP | Wikipedia L-SAM | pk는 C |
| Patriot 전투 pk — 걸프전 | ~0–9%(의회조사·Postol) | A | GAO 조사·Postol via Cirincione | 초기 70% 주장 반박 |
| Patriot 전투 — 우크라이나 | ~42%→~6%(Iskander-M/Kinzhal 대상 하락) | B | Military Watch; Missile Matters | **KN-23=이 부류** → 실전 pk 하향 앵커 |

**핵심 caveat(§1.5 요구)**: 시험·제조사 성공률(천궁-II 96%·PAC-3 92%)은 **전투 pk가 아니다.** 전투 pk는 통상 실질적으로 더 낮고 조건의존적이다(표적 기동·포화·디코이·저하된 조준). Patriot 실전기록(걸프전 ~0–9%, 우크라이나 ~6%까지 하락, 대상은 KN-23과 동류의 기동 준탄도)이 기동 SRBM에 대한 **현실적 발당 pk 하향 앵커**다. 연발(표적당 2+발)은 누적 pk를 올리되 발당 pk를 낮춘다. → **pk triangular의 mode에 시험치·min에 실전 하향치 배치**(작업지시서 §1.5).

**GAP 요약(위협·단가·pk)**: KN-23 비행시간, L-SAM/천궁-II per-round 단가·pk, KN-25 방사포탄 단가, UAV 단가 — 미공개. 전 체계 전투 pk는 공개값 부재 → **전부 C + 스윕**.

---

## 4. 기존 params.md 값 갱신 대상(공개 제원과 대조)

§1.5 규율에 따라 기존 값 중 공개 제원과 어긋나는 항목을 식별한다. **갱신은 스냅샷을 깨뜨리므로 별도 커밋으로 분리하고 ADR에 before/after를 남긴다.**

| ID | 기존값 | 조사결과 | 조치 |
|---|---|---|---|
| WPN-SM2-COST-01 | 2.1(B) | ~$2.0–2.5M(B, 재확인) | **유지**(등급 B 근거 보강) |
| WPN-MDUM-COST-01 | 3(C) | 천궁-II ~$1.1M(B) / PAC-3 MSE ~$3.9M(A) | ROKAF는 CRI+천궁-II 혼합 → **3 유지(C)**, 비고에 상충 기록(스냅샷 보존) |
| rangeKm(MDU-L 150·MDU-M 40·SM2 150·SHORAD 7) | 개념 | 공개 제원과 정합 확인 | **유지**(재확인, 등급 상향 근거) |
| THR-KN25/KN23-RNG | 개념 | CSIS와 정합 | **유지** |
| dwellSec(srbm 90) | 개념 | KN-23 비행시간 4–7분 추정(GAP) | **유지**(C, 스윕) |

**결론**: 조사 결과 기존 params.md의 사거리·위협 제원·단가 다수가 공개 제원과 **정합**하여 스냅샷을 깨는 갱신은 최소화된다(등급 근거를 A/B로 보강). 신규 Fire-Unit/자체교전 파라미터가 등급 C인 항목은 전부 스윕 범위를 함께 정의한다(params.md·ADR-010/011).
