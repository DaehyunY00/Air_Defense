# 지휘흐름 모의논리서 (2026-09-28)

`K-JAMDS_지휘흐름_단일본.html`이 무엇을 어떻게 계산하고 무엇을 가정하는지를 코드를 읽지 않아도 따라갈 수 있게 쓴 14쪽 문서다.
결과물은 저장소 루트의 `K-JAMDS_지휘흐름_모의논리서.pdf`.

## 구성

1. 한눈에 보는 열 가지(표지) · 2. 위협 하나가 겪는 여정(킬체인 9열) · 3. 모의의 뼈대(DES·관측창·난수) ·
4. 위협(시나리오·유형·발사점 연장·조준점) · 5. 센서(탐지·보고 주기·보고처) · 6. 지휘소 = 창구 모델(노드별 창구·처리 시간·대기실) ·
7. 계선과 매체(지연 표) · 8. As-Is vs To-Be · 9. 사수 선정과 요격, 누수 사유 · 10. 배치와 기본 조건(FULL 기본 · ADR-102) ·
11. 화면이 읽는 것과 계산하는 것 · 12. 가정과 단순화 · 13. 숫자를 읽을 때의 주의 · 14. 재현·URL 파라미터·검증 장치.

수치는 2026-09-28 소스 기준이며, 노드 제원·계선 지연은 `js/config/system-types.js`·`js/config/deployment-adapter.js`에서,
기본 조건은 `prototype/command-flow.html` PARAMS에서 읽었다. 기준 실행 결과(FULL·As-Is·1800초: 생성 228·격추 165·누수 40·미해결 23)는
헤드리스 Chrome에서 단일본을 실제로 돌린 값이다. 「모든 항적 종결」 수치는 `docs/analysis/2026-09-21-sc3-final/`의 것이다.

## 재생성

```bash
node docs/analysis/2026-09-28-command-flow-logic/render-report.mjs      # report.html → K-JAMDS_지휘흐름_모의논리서.pdf (Playwright + Chrome)
node docs/analysis/2026-09-28-command-flow-logic/verify-pdf.mjs /tmp/kjamds-logic-pdf-qa   # 쪽수·글자·꼬리말 검사 + PNG
```

`report.html`은 손으로 쓴 문서다(생성기 없음). 본문은 자연 흐름이고 장마다 새 쪽에서 시작하며, 쪽 번호는 Playwright 꼬리말 템플릿으로 찍는다.
모델이나 기본값이 바뀌면 해당 장의 수치와 `render-qa.json`·`pdf-qa.json`을 같이 갱신한다.
