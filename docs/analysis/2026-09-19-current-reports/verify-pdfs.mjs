// Poppler export and text/page checks. Visual review remains a separate human/agent step.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { HERE, ROOT } from './report-common.mjs';

const imageDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'kjamds-pdf-qa'));
fs.mkdirSync(imageDir, { recursive: true });
// Expected page count comes from the render audit of the same HTML, not from a hard-coded number.
const rendered = JSON.parse(fs.readFileSync(path.join(HERE, 'render-qa.json'), 'utf8'));
const artifacts = rendered.map(a => [a.pdf, 'report', a.pages.length]);
for (const stale of fs.readdirSync(imageDir).filter(f => /^(report|general|c2)-\d+\.png$/.test(f))) fs.unlinkSync(path.join(imageDir, stale));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const audit = { checkedAt: new Date().toISOString(), imageDir, artifacts: [] };
for (const [filename, prefix, expectedPages] of artifacts) {
  const pdf = path.join(ROOT, filename);
  const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
  const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  assert.equal(pageCount, expectedPages, filename + ': unexpected page count');
  const content = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  const pages = content.split('\f').filter(s => s.trim());
  assert.equal(pages.length, expectedPages);
  assert.ok(!content.includes('\uFFFD'), filename + ': replacement glyph');
  assert.ok(!/NaN|undefined|PLACEHOLDER/.test(content), filename + ': unresolved value');
  pages.forEach((p, i) => {
    assert.ok(p.replace(/\s/g, '').length > 150, filename + ': empty page ' + (i + 1));
    assert.ok(new RegExp(`${i + 1}\\s*/\\s*${expectedPages}`).test(p), filename + ': missing footer ' + (i + 1));
  });
  fs.writeFileSync(path.join(imageDir, prefix + '.txt'), content);
  fs.writeFileSync(path.join(imageDir, prefix + '-pdfinfo.txt'), info);
  execFileSync('pdftoppm', ['-r', '110', '-png', pdf, path.join(imageDir, prefix)]);
  const images = fs.readdirSync(imageDir).filter(f => new RegExp(`^${prefix}-\\d+\\.png$`).test(f)).sort();
  assert.equal(images.length, expectedPages, filename + ': stale or missing raster pages');
  audit.artifacts.push({ filename, sha256: sha256(pdf), pageCount,
    pageTextCharacters: pages.map(p => p.replace(/\s/g, '').length),
    replacementGlyphs: 0, unresolvedValues: 0, footerChecks: true,
    pngs: images.map(file => ({ path: path.join(imageDir, file), sha256: sha256(path.join(imageDir, file)) })),
    visualInspection: 'Must inspect every generated PNG; see QA.md for the signed-off scope.' });
}
fs.writeFileSync(path.join(HERE, 'pdf-qa.json'), JSON.stringify(audit, null, 2));
console.log('PDF page/text/raster checks passed:', audit.artifacts.map(a => `${a.filename} (${a.pageCount})`).join(', '));
