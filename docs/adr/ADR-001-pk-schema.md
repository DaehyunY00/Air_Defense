# ADR-001 — 무기별 요격확률(pk) 스키마 설계 (Phase 1, ⑨)

## 맥락
`_pk`가 `shooter` 인자를 받지만 항상-참 조건 체크에만 써서, 무기를 바꿔도 요격확률이 안 바뀌었다(사실 b). 그런데 `js/data/nodes.js`의 모든 무기가 `pk.paramRef`를 갖고 `docs/params.md`에 5개 항목이 **서로 다른 값**으로 문서화돼 있다. 즉 "문서에 있는 값을 코드가 무시"하는 상태 — ①단계 센서 `detectProb`와 동일 유형. 이로 인해 ⑧ Best-Shooter(`wtaSuit`)가 "더 좋은 무기"를 골라도 격추율이 개선되지 않아 KJADS 원칙 3-2의 목적이 무력화된다.

## 선택지
- **A. `engage.pk`에 위협별(`byThreat`) + 기본(`default`) 분포 맵**: FTR처럼 위협별 값이 다른 경우까지 표현. 폴백은 위협별 legacy.
- **B. 위협별 평면 맵만**(`byThreat`, default 없음): 단순하나 모든 (무기×위협) 조합을 다 채워야 함 — params.md에 없는 값을 지어내야 함(금지 위반 위험).
- **C. 무기별 단일 분포**: FTR의 "일반 0.8 / 무인기 Tri(0.1,0.25,0.4)" 이원값을 표현 못 함.

## 결정
**A** — `engage.pk = { byThreat?: {type: dist}, default?: dist, paramRef }`. 분포는 `{kind:'triangular', min, mode, max}`. 점값(FTR 일반 0.8)은 `min=mode=max=0.8`(삼각분포 1회 draw로 그대로 반환 → RNG 정렬 유지). 조회 순서: `byThreat[type]` → `default` → **문서값 없으면 legacy 폴백 + 조합 기록**(값을 지어내지 않음).

## 근거
- params.md 문서값을 그대로 배선(새 숫자 창작 아님): FTR{uav Tri(0.1,0.25,0.4), 일반 0.8}, SHORAD{uav Tri(0.1,0.3,0.5)}, MSAM2{Tri(0.6,0.8,0.9)}, LSAM{Tri(0.6,0.75,0.9)}, SM2{Tri(0.6,0.75,0.85)}.
- SHORAD의 비무인기(ac_low·cruise·heli) pk는 **문서에 없음** → legacy 폴백. 실측 폴백 조합: `SHORAD-1C×{ac_low,cruise,heli}`, `SHORAD-CD×{ac_low,heli}` (전부 보고).
- RNG: 문서값·폴백·legacy 모두 `rng.triangular` 정확히 1회 → 스캔당 draw 수 불변(스냅샷 최소 교란).

## 결론 영향
- 편향 원장(seed1~20 풀링): 격추율 As-Is 25.6→25.2% · To-Be 50.4→50.0%. **To-Be 개선폭 24.9→24.8%p (−0.4% 상대, 에스컬레이션 20% 미달).**
- pk 변화가 부분 상쇄(FTR uav 0.3→0.25↓, MSAM/MDU-M 0.75→0.8↑, SM2 0.8→0.75↓)되고 양 모드가 ⑧ 축선필터 후 유사 무기를 써 **아그리게이트 효과는 작다.** 질적으로는 ⑧ Best-Shooter가 비로소 pk에 영향(무기별 pk 차등 확보).
- 방향: 특정 seed(sc3 42)에선 오히려 As-Is 유리(탄도탄 pk↑). **순 편향 방향은 중립에 가깝다.**

## 되돌리는 법
- 플래그: `features.pkByShooter=false` → `_pkLegacy`(stage9 이전과 완전 동일, 되돌리기 어서션 0/36 불일치 확인).
- 커밋: (Phase 1 커밋 해시)
