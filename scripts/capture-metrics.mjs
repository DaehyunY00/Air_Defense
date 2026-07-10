#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — 지표 시각화 감사용 스크린샷 캡처 (docs/metrics-verification.md 부속)
 *
 * 로컬 서버(python3 -m http.server 8000 등)를 미리 띄운 뒤 실행한다:
 *   node scripts/capture-metrics.mjs [baseUrl]   (기본 baseUrl: http://localhost:8000)
 *
 * 아래 4개 딥링크에 진입해 [시뮬레이션 시작] → 결과 모달까지 도달한 스크린샷을
 * docs/screenshots/ 에 저장한다. 이 환경은 외부망이 차단돼 있어 Leaflet CDN을 불러오지
 * 못하므로, 4건 모두 자동으로 "폐쇄망 SVG 개념도 대체" 경로를 겸해서 검증한다.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const baseUrl = process.argv[2] || 'http://localhost:8000';
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || undefined;

const TARGETS = [
  { name: 'sc3-asis-x1.5-saturation', hash: '#tab=sim&sc=sc3&mode=asis&x=1.5&seed=12345', tab: 'sim' },
  { name: 'sc1-asis-x1-boundary', hash: '#tab=sim&sc=sc1&mode=asis&x=1&seed=12345', tab: 'sim' },
  { name: 'sc2-asis-x1-uav-burst', hash: '#tab=sim&sc=sc2&mode=asis&x=1&seed=12345', tab: 'sim' },
  { name: 'sc3-mc-transition-tornado', hash: '#tab=mc&sc=sc3&mode=asis&x=1&seed=12345', tab: 'mc' }
];

/**
 * 해시만 바뀌는 goto()는 SPA를 완전히 재초기화하지 않고(같은 문서 내 프래그먼트 이동)
 * 이전 실행 상태(모달·버튼 라벨 등)를 남긴다 — 매 타깃마다 about:blank를 거쳐
 * 완전한 재적재를 강제한다.
 */
async function hardGoto(page, url) {
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'load' });
}

async function captureSimTab(page, target) {
  await hardGoto(page, `${baseUrl}/index.html${target.hash}`);
  await page.waitForTimeout(800);

  const fallback = await page.evaluate(() => !!(window.KJ && KJ.mapView && KJ.mapView.isFallback()));

  await page.click('#sim-run');
  // 결과 모달이 뜰 때까지 대기(재생 종료 시 자동 표출) — 최대 30초
  await page.waitForSelector('#result-modal:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(500);

  // 모달 body의 overflow 스크롤을 풀어 전체 내용이 한 장에 담기도록 함(캡처 전용, 일시적 DOM 조작)
  await page.evaluate(() => {
    const mb = document.querySelector('.modal-body');
    if (mb) { mb.style.maxHeight = 'none'; mb.style.overflow = 'visible'; }
    const modal = document.querySelector('.modal');
    if (modal) { modal.style.maxHeight = 'none'; }
  });
  await page.waitForTimeout(200);

  const modalPath = path.join(outDir, `${target.name}__result-modal.png`);
  await page.locator('.modal').screenshot({ path: modalPath });

  // 지도+범례+HUD 화면도 별도 캡처(시뮬레이션 탭 초기 상태 확인용).
  // 모달 캡처를 위해 .modal-body/.modal의 max-height/overflow를 인라인으로 풀어놨기
  // 때문에 스크롤 위치가 예측 불가해져 #modal-close 클릭이 대상을 놓치거나(버튼이
  // 뷰포트 밖으로 밀림) catch로 조용히 실패해 모달이 지도 위에 잔류하는 문제를 겪었다
  // (검증 스크립트 자체 버그 — DOM 조작 후 클릭에 의존하지 않고 그냥 재적재한다).
  await hardGoto(page, `${baseUrl}/index.html${target.hash}`);
  await page.waitForTimeout(800);
  const mapPath = path.join(outDir, `${target.name}__map.png`);
  await page.screenshot({ path: mapPath });

  return { fallback, modalPath, mapPath };
}

async function captureMcTab(page, target) {
  await hardGoto(page, `${baseUrl}/index.html${target.hash}`);
  await page.waitForTimeout(500);
  await page.click('#mc-run');
  await page.waitForSelector('#mc-tornado .tor-row', { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.click('#mc-transition-run');
  await page.waitForFunction(() => {
    const el = document.querySelector('#mc-transition svg');
    return !!el;
  }, { timeout: 30000 });
  await page.waitForTimeout(300);
  // 스크롤은 document가 아니라 .tab-panel 내부에서 일어난다(main{overflow:hidden} +
  // .tab-panel{height:100%;overflow-y:auto}) — page.screenshot({fullPage:true})는 문서
  // 스크롤 높이 기준이라 뷰포트 이상을 담지 못한다(최초 캡처 시 1680×1000으로 하단 잘림
  // 확인). 모달과 동일하게 활성 패널의 높이 제약을 일시 해제한 뒤 그 요소를 캡처한다.
  await page.evaluate(() => {
    const panel = document.querySelector('#panel-mc');
    if (panel) { panel.style.height = 'auto'; panel.style.overflow = 'visible'; }
    const main = document.querySelector('main');
    if (main) { main.style.overflow = 'visible'; }
  });
  await page.waitForTimeout(200);
  const p = path.join(outDir, `${target.name}.png`);
  await page.locator('#panel-mc').screenshot({ path: p });
  return { fallback: false, modalPath: p, mapPath: null };
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const results = [];
  for (const target of TARGETS) {
    console.log(`캡처 중: ${target.name} (${target.hash})`);
    const res = target.tab === 'mc' ? await captureMcTab(page, target) : await captureSimTab(page, target);
    results.push({ ...target, ...res });
  }

  await browser.close();

  console.log('\n=== 캡처 결과 ===');
  results.forEach((r) => {
    console.log(`- ${r.name} [폐쇄망 SVG 대체: ${r.fallback ? 'YES' : 'no'}]: ${r.modalPath}${r.mapPath ? ' , ' + r.mapPath : ''}`);
  });
  if (pageErrors.length) {
    console.log('\n⚠ 페이지 에러 발생:', pageErrors);
    process.exitCode = 1;
  } else {
    console.log('\n페이지 에러 없음.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
