// Poppler 기반 확인: 쪽수(render-qa.json과 일치), 깨진 글자·미해결 값 없음, 쪽마다 본문과 「i / N」 꼬리말, 래스터 PNG 생성.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'../../..');
const imageDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'kjamds-logic-pdf-qa'));
fs.mkdirSync(imageDir, { recursive: true });
const rendered = JSON.parse(fs.readFileSync(path.join(HERE, 'render-qa.json'), 'utf8'));
for (const stale of fs.readdirSync(imageDir).filter(f => /^logic-\d+\.png$/.test(f))) fs.unlinkSync(path.join(imageDir, stale));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const audit = { checkedAt: new Date().toISOString(), imageDir, artifacts: [] };
for (const a of rendered) {
  const pdf = path.join(ROOT, a.pdf);
  const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
  const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  assert.equal(pageCount, a.pages, a.pdf + ': unexpected page count');
  const content = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  const pages = content.split('\f').filter(s => s.trim());
  assert.equal(pages.length, pageCount);
  assert.ok(!content.includes('�'), a.pdf + ': replacement glyph');
  assert.ok(!/NaN|undefined|PLACEHOLDER|__PAGE__/.test(content), a.pdf + ': unresolved value');
  pages.forEach((p, i) => {
    assert.ok(p.replace(/\s/g, '').length > 150, a.pdf + ': thin page ' + (i + 1));
    assert.ok(new RegExp(`${i + 1}\\s*/\\s*${pageCount}`).test(p), a.pdf + ': missing footer ' + (i + 1));
  });
  execFileSync('pdftoppm', ['-r', '110', '-png', pdf, path.join(imageDir, 'logic')]);
  const images = fs.readdirSync(imageDir).filter(f => /^logic-\d+\.png$/.test(f)).sort();
  assert.equal(images.length, pageCount, a.pdf + ': stale or missing raster pages');
  audit.artifacts.push({ filename: a.pdf, sha256: sha256(pdf), pageCount, pageTextCharacters: pages.map(p => p.replace(/\s/g, '').length),
    pngs: images.map(file => ({ path: path.join(imageDir, file), sha256: sha256(path.join(imageDir, file)) })),
    visualInspection: '생성된 PNG를 전부 눈으로 확인한다(별도 단계).' });
}
fs.writeFileSync(path.join(HERE, 'pdf-qa.json'), JSON.stringify(audit, null, 2));
console.log('PDF checks passed:', audit.artifacts.map(a => `${a.filename} (${a.pageCount})`).join(', '));
