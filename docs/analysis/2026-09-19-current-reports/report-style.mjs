export const STYLE = `
@page { size:A4; margin:16mm 14mm; }
* { box-sizing:border-box; }
body { margin:0; color:#172536; font-family:"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif; font-size:10pt; line-height:1.48; }
.page { width:182mm; height:265mm; position:relative; padding-bottom:11mm; break-after:page; }
.page:last-child { break-after:auto; }
.eyebrow { font-size:9pt; font-weight:700; color:#24628b; letter-spacing:.5px; margin:0 0 10px; }
h1 { font-size:26pt; line-height:1.25; margin:20px 0 12px; color:#173d63; }
h2 { font-size:17pt; line-height:1.3; color:#173d63; margin:0 0 14px; padding-bottom:8px; border-bottom:2px solid #24628b; }
h3 { font-size:11.2pt; color:#173d63; margin:15px 0 6px; break-after:avoid; }
p { margin:7px 0; } ul,ol { margin:7px 0; padding-left:19px; } li { margin:5px 0; }
.subtitle { font-size:12pt; color:#43586d; margin:8px 0 18px; }
.box { background:#f2f6fa; border-left:3px solid #24628b; padding:10px 13px; margin:12px 0; }
.notice { background:#fff8e9; border-color:#c29647; }
.small,.note { font-size:8.4pt; color:#526274; line-height:1.45; }
table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:8.25pt; line-height:1.35; margin:7px 0 11px; break-inside:avoid; }
th,td { border:1px solid #c2ccd6; padding:5px 5px; text-align:center; vertical-align:middle; overflow-wrap:anywhere; }
th { background:#e8eff6; font-weight:700; color:#173d63; } td:first-child { text-align:left; }
.kv td { text-align:left; } .kv td:first-child { width:24%; font-weight:600; background:#f7f9fb; }
.oat { font-size:7.6pt; line-height:1.32; } .oat th,.oat td { padding:5px 4px; } .oat td:nth-child(2) { text-align:left; }
.metrics { display:flex; gap:12px; margin:16px 0; } .metric { flex:1; border-top:3px solid #24628b; background:#f2f6fa; padding:10px; } .metric strong { display:block; font-size:22pt; color:#173d63; } .metric span { font-size:9pt; }
.footer { position:absolute; bottom:0; left:0; right:0; border-top:1px solid #cbd5df; padding-top:5px; font-size:8pt; color:#637384; display:flex; justify-content:space-between; }
code { font-family:Menlo,monospace; font-size:7.5pt; overflow-wrap:anywhere; } .code { background:#f4f7fa; padding:8px; white-space:pre-wrap; overflow-wrap:anywhere; font-family:Menlo,monospace; font-size:7.7pt; }
`;
export const escapeHTML = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function table(headers, rows, cls='', widths=[]) {
  return `<table class="${cls}">${widths.length?'<colgroup>'+widths.map(w=>`<col style="width:${w}%">`).join('')+'</colgroup>':''}<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(c=>`<td>${c}</td>`).join('')+'</tr>').join('')}</tbody></table>`;
}
export function pagesHTML(title, pages, revision) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHTML(title)}</title><style>${STYLE}</style></head><body>${pages.map((html,i)=>`<section class="page">${html}<footer class="footer"><span>K-JAMDS · 2026-09-19 · ${escapeHTML(revision.slice(0,7))}</span><span>${i+1} / ${pages.length}</span></footer></section>`).join('')}</body></html>`;
}
