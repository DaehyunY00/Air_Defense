#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — As-Is↔To-Be 실험 보고서 PDF 빌드
 *
 * docs/실험보고서_AsIs_ToBe.html(experiment-report.mjs 산출)을 headless Chromium으로
 * 렌더해 같은 이름의 PDF를 만든다. 표가 넓어 A4 가로(landscape)로 출력한다.
 *
 * 실행:  node scripts/build-experiment-pdf.mjs   (저장소 루트에서)
 * 요구:  playwright-core(또는 playwright) + Chromium (PW_CHROMIUM_PATH 또는 표준 설치 경로),
 *        한글 폰트가 시스템에 설치되어 있어야 함
 */
import path from 'node:path';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const requireFrom = createRequire(import.meta.url);
async function loadChromium() {
  const errors = [];
  for (const pkg of ['playwright-core', 'playwright']) {
    try { return (await import(pkg)).chromium; } catch (err) { errors.push(pkg + '(esm): ' + err.code); }
    try { return requireFrom(pkg).chromium; } catch (err) { errors.push(pkg + '(cjs): ' + err.code); }
  }
  throw new Error('playwright-core / playwright를 찾을 수 없습니다 (' + errors.join(', ') +
    '). npm install playwright-core 후 다시 실행하거나, 전역 설치라면 NODE_PATH=$(npm root -g) 를 지정하십시오.');
}
const chromium = await loadChromium();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'docs', '실험보고서_AsIs_ToBe.html');
const out = path.join(root, 'docs', '실험보고서_AsIs_ToBe.pdf');

const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.pdf({
  path: out,
  format: 'A4',
  landscape: true,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;text-align:center;font-size:7px;color:#8a97a8;">' +
    'K-JAMDS C2 시뮬레이터 — As-Is↔To-Be 실험 보고서 · 정책연구용 개념값 · 실제 작전자료 아님 · ' +
    '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  margin: { top: '10mm', bottom: '12mm', left: '0', right: '0' }
});
await browser.close();
console.log('PDF 생성 완료:', out, '(' + (statSync(out).size / 1024 / 1024).toFixed(2) + ' MB)');
