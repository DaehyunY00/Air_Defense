# 현재 코드 보고서 재실행 · 2026-09-19

저장소 루트의 기존 두 PDF를 갱신하기 위한 재현 소스다.

- `K-JAMDS_분석_방법과_결과.pdf`: 기준선·OAT·20개 쌍대 seed·강도·관측창·누수 원인·xlsx 활용.
- `K-JAMDS_C2_분석결과.pdf`: 항적별 실제 관측 노드·명령 계보·발사 기준 시간·기록 커버리지.

과거 2026-09-10/11 보고서는 당시 소스·원시 결과로 보존한다. 현재 보고서는 이전 JSON을 재사용하지
않고 엔진을 다시 실행했다. xlsx는 코드에서 내보낸 참조표이며, 어느 러너도 xlsx 값을 입력하지 않는다.

## 입력과 재현

`report-common.mjs`는 지휘흐름 HTML의 `PARAMS`, `parseCommandFlowParams`, `features()`를 격리된
VM에서 직접 실행한다. 숫자 기본값을 독자적으로 복사하지 않는다. `par=true`가 실제 카탈로그에
전달되는 조건이다. 본 앱의 기본 설정과 지휘흐름 화면의 기본 설정은 구분한다.

분석 당시 HEAD와 엔진·카탈로그 어댑터·프로토타입 SHA-256, 모든 플래그, 실행 시각을 JSON에 저장한다.
HEAD는 분석 시작 시점의 커밋 식별자이고, 함께 진행한 UI 표시 수정은 소스 스냅샷 해시로 구분한다.
엔진과 물리·카탈로그의 입력은 이 분석 중 변경하지 않았다. 최종 문서 커밋은 입력 커밋과 별개다.

```bash
node docs/analysis/2026-09-19-current-reports/analysis-run.mjs docs/analysis/2026-09-19-current-reports/analysis-out.json --workers 2
node docs/analysis/2026-09-19-current-reports/c2-analysis-run.mjs --self-test
node docs/analysis/2026-09-19-current-reports/c2-analysis-run.mjs
node docs/analysis/2026-09-19-current-reports/report-gen.mjs
node docs/analysis/2026-09-19-current-reports/c2-report-gen.mjs
node docs/analysis/2026-09-19-current-reports/render-reports.mjs
node docs/analysis/2026-09-19-current-reports/verify-pdfs.mjs /tmp/kjamds-pdf-qa
```

일반 분석은 **182개 셀 + 별도 탐침 1개**다. 기준선 12 + OAT 64(16조건) + seed 반복 80 + 강도 20 +
관측창 6이다. 과거 안내의 178회·15조건은 잘못된 합계였다. C2 기록 실행 4개는 별도다.
동시에 실행하는 계산 worker는 최대 2개로 제한한다.

`render-reports.mjs`는 설치된 Playwright와 Chrome을 사용한다. 필요하면 `PLAYWRIGHT_MODULE_DIR`와
`CHROME_PATH`를 지정한다. 기존 HTML 보고서의 A4·청색 계열 디자인을 유지하며 글꼴 로딩·페이지
가로 넘침·본문/꼬리말 겹침을 검사한다. PDF 생성 이후 Poppler로 전 페이지를 PNG에 렌더링해 육안 검토한다.

## 이번 실행의 검증 범위

- 일반 분석 182셀과 별도 탐침 1개를 새로 실행했다(계산 worker 2개, 분석 셀 383.756초).
  모든 셀의 생성/격추/누수/미해결 보존식과 누수 원인 합계, 20쌍 seed의 생성 수를 검사했다.
- C2 네 실행은 항적 기록 각각 89/89개이며 trace/flow/C2 기록 상한에 걸리지 않았다.
  실제 발사 항적 29/36/68/73개, 합계 206개의 최초 발사 시간 계보를 연결했다.
  합성 self-test는 다른 분기 혼입, 자식 명령, 다른 발사의 BDA, 기록 절단과 통신 상태/정식 노드를 확인한다.
- 두 분석의 기준 결과·시간, 코드 해시와 쌍대 통계의 별도 검산은 `integration-validation.md`에 남겼다.
- 최종 일반 PDF 10페이지, C2 PDF 12페이지의 DOM 배치 검사와 Poppler 텍스트·PNG 검사를 수행한다.
  `render-qa.json`은 페이지 넘침 검사, `pdf-qa.json`은 최종 PDF/PNG 해시·페이지 수·텍스트 검사를 보존한다.
  실제 전 페이지 시각 검토의 범위와 수정 이력은 `QA.md`에 기록한다. PNG와 추출 텍스트는 위 임시 경로에
  저장하며 같은 명령으로 다시 만들 수 있다.

이 범위는 보고서의 재현·집계·표현을 검증한다. 문서 변경 때문에 전체 52개 엔진 테스트를 다시 돌렸다고
주장하지 않으며, 실제 군사 운용 성능을 검증한 것으로 해석하지 않는다.

## 해석 규칙

- 전체 생성 = 격추 + 확정 누수 + 종료 미해결. 600초/1800초 종료 시점의 값은 최종 생애 성능이 아니다.
- 20개 seed에서 같은 seed끼리 차이를 먼저 구한다. 평균 차이의 95% CI는 Student t(19)를 사용한다.
  단일 seed OAT에는 신뢰구간을 부여하지 않으며 다중 비교 보정도 하지 않았다.
- 엔진의 `timeToEngage`와 `decisionDelay`는 성공한 `_onIadsFire`에서 수집한다. 각각 생성/탐지에서
  최초 실제 발사까지의 값이다. 결과 필드의 과거 주석을 그대로 인용하지 않는다.
- 새 역할 문맥도와 후보 근거는 실제 통신·명령 사건이 아니다. 관측되지 않은 노드·경유를 추가하지 않는다.
- 도메인 제대의 통보 큐는 IAOC 결심을 차단하지 않는다. 결정권·승인·거부권의 실증으로 해석하지 않는다.
- 보고서는 개념 모델의 재현·기록 정합성 분석이며 군사 운용 검증이나 현실의 전술 최적화 권고가 아니다.
