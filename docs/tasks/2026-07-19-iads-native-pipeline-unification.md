# IADS_codex_original C2·교전 파이프라인 통일

## 목적과 범위

- 대상: `/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/Air_Defense`
- 읽기 전용 정본: `/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/IADS_codex_original`
- 요청: 고해상도 실행의 책임 C2, 사수 선정, 교전 가능성, 탄약, 중복교전을 원본 의미론으로 통일한다.
- 보존 경계: `highResolutionDeployment=false`와 플래그 생략 legacy 실행은 기존 결과 wire shape과 SHA-256을 bit-exact로 유지한다.
- 초기 worktree의 기존 dirty 변경과 `.DS_Store`는 건드리지 않았다. commit, push, PR은 생성하지 않았다.

## 구현 결과

1. 책임 C2 Resolver
   - As-Is 탄도 위협: 생존 `KAMD_OPS`, 부재 시 권역 `ICC`.
   - As-Is 항공호흡 위협: 생존 `MCRC`, 부재 시 권역 `ICC`.
   - To-Be 한국군: `IAOC`.
   - 육군 지역방공과 USFK THAAD/Patriot은 한국군 축과 자동 통합하지 않고 독립 scope로 결정한다.
2. 사수 선정·교전 가능성
   - Resolver가 반환한 command scope와 force owner 내에서만 후보를 생성한다.
   - MFR 화력통제 상태, `canEngage`, R/H 봉투, 축선별 개념 3D PIP, 요격체 비행시간, 명령 지연, 채널·잠금, 잔탄을 모두 통과한 사수만 선정한다.
   - Pk·잔탄비·현재 점유·거리·체계 우선순위로 결정론적 점수를 계산한다.
3. 탄약·재장전·BDA
   - 포대 합산 탄약을 실제 발사대별로 분배하고 발사 시 차감한다.
   - 발사대 잔탄 0 시 해당 발사대만 900초 재장전하며, 다른 발사대는 계속 사용한다.
   - 명중은 발사 시 시드 RNG로 결정하고 요격체 PIP 도달 시 BDA를 처리한다. MISS는 잔여 교전창 내 재교전한다.
4. 중복교전
   - global/ICC/self-battery scope의 공유 수준에서 기존 교전 계획을 차단한다.
   - 한국군·지역방공·USFK 독립 축 사이에 실제 동시 발사가 발생한 경우만 `realDuplicates` 및 중복 요격탄 비용으로 계산한다. 기존 ghost 사격은 고해상도 경로에서 사용하지 않는다.

## 공개 API·출력

- `runDES({ deploymentId, features: { highResolutionDeployment: true } })`는 `native-iads-c2-engagement-v1` 경로를 사용한다.
- 고해상도 결과에 `global.commanderAssignments`, `global.coordination.realDuplicates`, 발사대 합산 `nodes[].ammo/ammoRatio`를 노출한다.
- legacy 결과에는 위 신규 필드를 추가하지 않아 wire shape를 보존한다.

## 검증

- `tests/iads-native-pipeline.test.js` 12건: NORMAL/DOWN/To-Be 책임 C2, PIP/FC 발사, 실제 중복 BDA, 발사대 탄약/재장전, 결정론.
- `tests/baseline.test.js` 18건: SC1–SC3×As-Is/To-Be 전체 JSON SHA-256 및 플래그 생략=OFF bit-exact.
- 전체: JS 25개 `node --check`, 21개 스위트·540개 어서션.

## 해석 한계·후속

현재 PIP와 센서 상태는 고정 축선·개념 고도·결정론적 MFR 상태전이다. 원본의 canonical event, 도메인별 RNG, 실시간 센서 오차/손실, track freshness/상관, 교차각·편란, 전체 PSSEK 테이블은 후속 범위다. 따라서 FULL/MINI 결과는 배치·C2·교전 로직 비교용이며 전술적 절대값으로 보고하지 않는다.
