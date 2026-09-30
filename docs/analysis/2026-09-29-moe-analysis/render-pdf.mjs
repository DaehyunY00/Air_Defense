// 효과척도 분석 결과서 — README.md → report.html → PDF(A4). 헤드리스 Chrome의 --print-to-pdf를 쓴다(Playwright 불필요).
// 글꼴: 시스템에 있는 한글 글꼴을 순서대로 시도한다(Apple SD Gothic Neo · Noto Sans KR · Malgun Gothic · WenQuanYi Zen Hei).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..');
const md = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\{\{red:([^}]+)\}\}/g, '<span class="red">$1</span>');   // {{red:…}} → 붉은 강조(차이가 두드러진 칸)
const lines = md.split('\n'); const out = []; let i = 0, inList = null, para = [];
const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
const closeList = () => { if (inList) { out.push('</' + inList + '>'); inList = null; } };
while (i < lines.length) {
  const L = lines[i];
  if (/^\s*$/.test(L)) { flushPara(); closeList(); i++; continue; }
  let m;
  if ((m = /^(#{1,6})\s+(.*)$/.exec(L))) { flushPara(); closeList(); const lv = m[1].length; out.push(`<h${lv}${lv <= 2 && out.length ? ' class="brk"' : ''}>${inline(m[2])}</h${lv}>`); i++; continue; }
  if (/^>\s?/.test(L)) { flushPara(); closeList(); const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; } out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>'); continue; }
  if (/^\|/.test(L)) { flushPara(); closeList(); const rows = []; while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
    const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]); const body = rows.slice(2).map(cells);
    out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
      body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'); continue; }
  if ((m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(L))) { flushPara(); const tag = /\d/.test(m[2]) ? 'ol' : 'ul'; if (inList !== tag) { closeList(); out.push('<' + tag + '>'); inList = tag; }
    let item = m[3]; i++; while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) { item += ' ' + lines[i].trim(); i++; }
    out.push('<li>' + inline(item) + '</li>'); continue; }
  if (/^```/.test(L)) { flushPara(); closeList(); const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; } i++; out.push('<pre>' + esc(code.join('\n')) + '</pre>'); continue; }
  para.push(L.trim()); i++;
}
flushPara(); closeList();
const title = (md.match(/^#\s+(.*)$/m) || [, '결과서'])[1];
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4; margin: 16mm 15mm 18mm 15mm; }
html { font-size: 9.6pt; }
body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', 'WenQuanYi Zen Hei', sans-serif; color: #1d2a35; line-height: 1.55; margin: 0; }
h1 { font-size: 17pt; margin: 0 0 6mm; line-height: 1.3; border-bottom: 2px solid #1d2a35; padding-bottom: 3mm; }
h2 { font-size: 13pt; margin: 8mm 0 3mm; color: #143d5c; border-left: 4px solid #143d5c; padding-left: 3mm; }
h2.brk { break-before: page; }
h3 { font-size: 10.8pt; margin: 5mm 0 2mm; color: #2c4a63; }
p, li { margin: 0 0 2mm; }
ul, ol { padding-left: 6mm; margin: 0 0 3mm; }
blockquote { margin: 0 0 4mm; padding: 2mm 4mm; background: #f3f5f7; border-left: 3px solid #8a97a3; color: #44525e; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; margin: 2mm 0 4mm; font-size: 8.4pt; break-inside: auto; }
th, td { border: 1px solid #c9d1d8; padding: 1.3mm 2mm; vertical-align: top; text-align: left; }
th { background: #e8edf1; font-weight: 600; }
tr { break-inside: avoid; }
code { font-family: 'SF Mono', Menlo, Consolas, 'WenQuanYi Zen Hei Mono', monospace; font-size: 8.4pt; background: #f0f2f4; padding: 0 1mm; border-radius: 2px; }
pre { background: #f0f2f4; padding: 3mm; font-size: 8pt; overflow-wrap: anywhere; white-space: pre-wrap; }
strong { color: #0f2a40; }
.red { color: #b3261e; font-weight: 700; }
a { color: inherit; text-decoration: none; }
</style></head><body>${out.join('\n')}</body></html>`;
const htmlPath = path.join(HERE, 'report.html'); fs.writeFileSync(htmlPath, html);

const chrome = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ...(fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter((d) => /headless_shell/.test(d)).map((d) => path.join('/opt/pw-browsers', d, 'chrome-linux/headless_shell')) : [])
].find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome unavailable; set CHROME_PATH');
const outPdf = path.join(ROOT, 'K-JAMDS_효과척도_분석결과서.pdf');
execFileSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', '--print-to-pdf=' + outPdf, pathToFileURL(htmlPath).href], { stdio: ['ignore', 'ignore', 'pipe'] });
let pages = null; try { pages = Number(execFileSync('pdfinfo', [outPdf], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1]); } catch {}
fs.writeFileSync(path.join(HERE, 'render-qa.json'), JSON.stringify({ pdf: path.basename(outPdf), pages, chrome, renderedAt: new Date().toISOString() }, null, 2));
console.log('rendered', outPdf, 'pages', pages);
