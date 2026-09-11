# xlsx 미수정 상태(현재 기본값) 분석 — 2026-09-10

`K-JAMDS_분석_방법과_결과.pdf`(저장소 루트)의 원본. 지휘흐름 화면 기본값
(SC3 · seed 29 · 600초 · ×1 · pipe/icc/lx/aim/par ON — ADR-099 결심 시간 동일화 포함) 기준으로 178회 실행한 결과다.

재현:
```
node docs/analysis/2026-09-10-xlsx-미수정-분석/analysis-run.mjs out.json   # 약 12분
node docs/analysis/2026-09-10-xlsx-미수정-분석/report-gen.mjs out.json report.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer \
  --print-to-pdf=report.pdf file://$PWD/report.html
```
