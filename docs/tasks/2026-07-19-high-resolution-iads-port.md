# Phase 0–1 고해상도 IADS 배치 이식 작업 기록

## 작업 범위·경계

- 대상: `/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/Air_Defense_v2`
- 읽기 전용 원본: `/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/IADS_codex_original`
- 작업 시작 시 대상 dirty: `M .DS_Store`, `?? docs/.DS_Store`, `?? js/.DS_Store`. 사용자 변경으로 간주해 수정·스테이징하지 않음.
- 원본은 Git 저장소가 아니어 `git status`로 전후 비교할 수 없음. 읽은 정본 3개 파일의 SHA-256·크기·mtime로 무변경을 검사함.

## Phase 0 기준선

- 수정 전: JS 21개 `node --check`, 16개 스위트·398개 어서션 전부 통과.
- `tests/phase0-baseline.json`: SC1–SC3 × As-Is/To-Be, 강도 1.5, seed 42, 1800초의 전체 결과 SHA-256·핵심 flow·전역 지표·이벤트 수 저장.
- `tests/baseline.test.js`: 플래그 생략과 `highResolutionDeployment:false`가 모든 6개 경우에 byte-for-byte 동일하고 fixture 해시와 일치함을 검증.

## 프로젝트 차이와 이식 판단

| 구분 | 읽기 전용 원본 | 대상 | Phase 0–1 결정 |
|---|---|---|---|
| 모듈 | ESM·번들 앱 | 빌드 없는 classic script/`window.KJ` | IIFE 컨테이너로 적응 |
| 실행 | 상세 인스턴스/토폴로지 | 9단계 축선·대기행렬 DES | `phase1-axis-queue` 호환 어댑터 |
| 좌표 | `{lon,lat,alt}` | `[lat,lon]` | 배치 정본은 전자, 지도 노드 경계에서만 후자 |
| 시스템 데이터 | 타입·인스턴스 분리 | 대표 노드 혼합 | legacy 타입/인스턴스 뷰+bit-exact 재구성, 상세 배치는 완전 분리 |
| USFK | THAAD/Patriot 독립 축 | THAAD 노드 없음 | FULL 그래프에 보존, 한국군 WTA에서 제외 |
| SHORAD | 차량별 제원/재장전 | 합산 채널 | 차량 스키마는 보존, Phase 1은 포대 합산 실행 |

## 구현 결과

- `SENSOR_TYPES`, `SHOOTER_TYPES`, `C2_TYPES`, MDL 보간 도우미, 6개 불변 배치 레지스트리 이식.
- MINI 11/8/14(13) 및 FULL 71/84/98(97) 센서/포대/C2 수량, FULL 포대 구성, 비호 28/167, 천마 17/100, 900초 차량별 재장전 스키마를 회귀 고정.
- `KJ.DEPLOYMENTS`, `deploymentById`, `buildDeploymentCatalog`, `resolveModelCatalog`, catalog 선택적 조회 API, `runDES` 기능 플래그 구현.
- DES·정적 해석·MC·민감도·전환점·Leaflet·SVG fallback·근거자료 표에 동일 catalog 전달.
- DOWN은 정본 C2 하나와 그 종점 링크만 제거. USFK↔한국군 교차 링크 없음.
- 상세 배치 선택 시 UI에 과도기 호환 실행·개념좌표·전술적 절대값 금지 경고를 상시 표시.

## 검증 결과

- JS 25개 `node --check`: 통과.
- `node tests/run-all.js`: 19개 스위트·525개 어서션 통과.
- 6개 배치×2모드 결정론, 보존법칙, 유한 지표, 모든 링크 종점, USFK 분리 통과.
- `git diff --check`: 통과.
- Leaflet: FULL_NORMAL As-Is 마커 251개(모드 전용 IAOC/EOC 제외), 분석 노드 180·링크 128, 근거자료 인벤토리 253, 제약 실패 0, 브라우저 오류 0.
- SVG fallback: `?svgFallback=1#dep=HANBANDO_MINI_NORMAL` 노드 라벨 31, 상시 경고·디스클레이머, 브라우저 오류 0.
- 원본 전후 SHA-256 동일: `weapon-data.js` `f6c00290…d162c`, `geo-mdl.js` `9cb20135…b3d8d`, `deployments.js` `7cd6e0df…c33c69`. 원본은 Git 저장소가 아니며 위 checksum·stat으로 무변경을 확인함.

## 알려진 경계·기술부채

- 상세 배치 결과는 배치·큐·축선 호환성 검증용이며 전술적 절대값이 아님.
- 현재 `_doEngage` 단일 경로를 재사용한다. 기존 As-Is 최소부하·To-Be 적합도/비용 점수 분기는 선행 기술부채이며 기준선 보존을 위해 본 단계에서 변경하지 않음.
- 상세 운동학·PIP/PSSEK·센서 상태·항적 신선도·차량별 재장전 동역학·USFK 교전권·paired MC·Cesium은 범위 밖. 목표 경계는 `docs/high-resolution-iads-architecture.md`.

## 후속 실행 프롬프트

> Phase 0–1 기준선과 `highResolutionDeployment` OFF bit-exact 게이트를 보존하라. 먼저 버전된 정본 이벤트 스키마와 도메인별 RNG(도착/운동/센서/항적/C2/교전/BDA/재장전)를 도입하고, 무관한 RNG 소비 순서가 모델 토글에 의해 바뀌지 않음을 검증하라. 그 다음 위협 3차원 운동학, 센서 주사/상태, 항적 freshness·공분산을 이벤트로 연결하라. PIP/PSSEK, 차량별 재장전, USFK 독립 교전, paired MC는 이 기반 게이트 통과 후 별도 단계로 둔다.
