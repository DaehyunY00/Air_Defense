# C2 분석결과 — 항적별 결심 흐름 재구성 (2026-09-11)

`K-JAMDS_C2_분석결과.pdf`(저장소 루트)의 원본. 지휘흐름 화면 기본값(SC3 · seed 29 · 600초 · ×1 ·
pipe/icc/lx/aim/par ON — ADR-099 결심 시간 동일화 포함)으로 기본·확대 배치 × As-Is/To-Be 4회 실행한 트레이스(단계 마크 + 계선 통과 이벤트)에서
항적마다 개입 노드·명령 홉·결심 시간 5구간을 재구성했다.

재현:
```
node docs/analysis/2026-09-11-C2-분석결과/c2-analysis-run.mjs out.json      # 약 40초
node docs/analysis/2026-09-11-C2-분석결과/c2-report-gen.mjs out.json report.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer \
  --print-to-pdf=report.pdf file://$PWD/report.html
```
