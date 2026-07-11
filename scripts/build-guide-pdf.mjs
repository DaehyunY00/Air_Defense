#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — 사용자 가이드 PDF 빌드
 *
 * docs/사용자_가이드.html(원본)을 headless Chromium으로 렌더해
 * docs/사용자_가이드.pdf(A4)를 생성한다. 스크린샷(docs/screenshots/*.png)은
 * 상대경로로 임베드되므로 file:// 로 직접 열어 렌더한다 — 로컬 서버 불필요.
 *
 * 실행:  node scripts/build-guide-pdf.mjs   (저장소 루트에서)
 * 요구:  playwright-core + Chromium (PW_CHROMIUM_PATH 또는 표준 설치 경로),
 *        한글 폰트(Noto Sans KR 등)가 시스템에 설치되어 있어야 함
 */
import { chromium } from 'playwright-core';
import path from 'node:path';
import { statSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'docs', '사용자_가이드.html');
const out = path.join(root, 'docs', '사용자_가이드.pdf');
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || undefined;

const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: 'load' });
// 이미지·폰트 렌더 안정화 대기
await page.waitForTimeout(700);
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;text-align:center;font-size:7.5px;color:#8a97a8;">' +
    'K-JAMDS C2 시뮬레이터 사용자 가이드 — 정책연구용 개념값 · 실제 작전자료 아님 · ' +
    '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  margin: { top: '14mm', bottom: '14mm', left: '0', right: '0' }
});
await browser.close();
console.log('PDF 생성 완료:', out, '(' + (statSync(out).size / 1024 / 1024).toFixed(2) + ' MB)');
