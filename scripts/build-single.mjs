#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — 단일본 HTML 빌드 스크립트
 *
 * index.html + css/style.css + js/** + vendor/leaflet-1.9.4/**를 인라인해
 * `K-JAMDS_시뮬레이터_단일본.html`을 재생성한다. 즉 이 스크립트는 현재 소스만으로
 * 결정론적으로 동작한다 — 직전 단일본을 읽지 않는다.
 *
 * (~2026-07: Leaflet 블록은 직전 단일본에서 추출해 재사용했다. 외부망 없이 재현하기
 *  위한 방편이었으나 단일본이 자기 자신의 입력이 되는 구조라, Leaflet을 vendor/로
 *  동봉하면서 걷어냈다. 배경은 vendor/leaflet-1.9.4/README.md 참조.)
 *
 * 실행:  node scripts/build-single.mjs   (저장소 루트에서)
 *
 * 구조 규약(검증 대상):
 *  - <style>/* css/style.css (inlined) *\/ ... </style>
 *  - <script>/* js/<경로> (inlined) *\/ ... </script>  (index.html의 script src 순서 그대로)
 *  - Leaflet CSS/JS 블록은 "Leaflet 1.9.4 CSS|JS (inlined)" 마커로 식별
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineFile as inlineFrom, bundleIadsKernel, replaceOnce, assertSelfContained } from './single-lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SINGLE = path.join(root, 'K-JAMDS_시뮬레이터_단일본.html');

const idx = readFileSync(path.join(root, 'index.html'), 'utf-8');

// 인라인·커널 번들·치환·검증 조각은 scripts/single-lib.mjs에 있다 — [지휘 흐름] 단일본
// 빌더(build-command-flow-single.mjs)와 한 벌을 공유한다.
const inline = (relPath, tag, label) => inlineFrom(root, relPath, tag, label);
const inlineFile = (relPath, tag) => inline(relPath, tag);

// Leaflet은 동봉본(vendor/)에서 읽는다. 마커 문구는 종전과 같게 유지 — 단일본 구조
// 규약이자 회귀 테스트의 식별자다.
const leafletCss = inline('vendor/leaflet-1.9.4/leaflet.css', 'style', 'Leaflet 1.9.4 CSS (inlined)');
const leafletJs = inline('vendor/leaflet-1.9.4/leaflet.js', 'script', 'Leaflet 1.9.4 JS (inlined)');

// IADS 커널 IIFE 번들 (ADR-061 옵션 b) — 변환 규약은 single-lib.mjs 참조.
// footer는 bootstrap.js 동치(모듈판과 동일한 전역 표면: KJ.IADS·createIadsEventQueue·iadsKernelReady).
const iadsKernelIife = bundleIadsKernel(root, {
  label: 'js/model/iads/* (IIFE kernel bundle — ADR-061, 재생성: node scripts/build-single.mjs)',
  footer: [
    'const bootRoot = window;',
    'bootRoot.KJ = bootRoot.KJ || {};',
    'installIadsKernel(bootRoot.KJ);',
    'bootRoot.KJ.iadsKernelReady = Promise.resolve(bootRoot.KJ.IADS);'
  ].join('\n') + '\n'
});

let out = idx;

// 제목: 단일본임을 명시
out = out.replace(
  /<title>[^<]*<\/title>/,
  '<title>K-JAMDS C2 시뮬레이터 (단일 HTML)</title>'
);

// head: Leaflet 주석 + vendor CSS 링크 + 로컬 스타일시트 링크 → 빌드 주석 + 인라인 CSS 2블록
out = replaceOnce(out,
  /  <!-- Leaflet [^\n]*\n  <link rel="stylesheet" href="vendor\/leaflet-1\.9\.4\/leaflet\.css">\n  <link rel="stylesheet" href="css\/style\.css(?:\?[\w=.-]*)?">/,
  '  <!-- 단일 파일 빌드: 모든 CSS/JS(+Leaflet) 인라인. 지도 타일만 온라인(OpenStreetMap), ' +
  '폐쇄망에서는 자동 SVG 개념도로 대체. 원본: index.html + js/ + css/ + vendor/ (재생성: node scripts/build-single.mjs) -->\n' +
  '  ' + leafletCss + '\n  ' + inlineFile('css/style.css', 'style'),
  'Leaflet CSS 링크 + style.css 링크'
);

// vendor Leaflet JS 태그 → 인라인 JS
out = replaceOnce(out,
  /  <script src="vendor\/leaflet-1\.9\.4\/leaflet\.js"><\/script>/,
  '  ' + leafletJs,
  'Leaflet JS 태그'
);

// IADS 커널 모듈 태그 → IIFE 번들 (ADR-061 — file:// 에서 모듈 import가 차단되므로)
out = replaceOnce(out,
  /  <script type="module" src="js\/model\/iads\/bootstrap\.js(?:\?[\w=.-]*)?"><\/script>/,
  '  ' + iadsKernelIife,
  'IADS 커널 모듈 태그'
);

// 각 로컬 스크립트 → 인라인 (index.html의 순서 그대로, ?v= 캐시버스터 허용)
out = out.replace(/  <script src="(js\/[\w/.-]+\.js)(?:\?[\w=.-]*)?"><\/script>/g, (m, rel) => '  ' + inlineFile(rel, 'script'));

// 잔여 참조 검증 — 로컬(css/·js/·vendor/)도, 모듈 태그도, CDN도 남아 있으면 안 된다
assertSelfContained(out);

writeFileSync(SINGLE, out);
console.log('단일본 재생성 완료: ' + SINGLE);
console.log('  인라인 JS 블록:', (out.match(/<script>\/\* js\//g) || []).length + '개');
console.log('  Leaflet CSS/JS:', out.includes('Leaflet 1.9.4 CSS (inlined)') && out.includes('Leaflet 1.9.4 JS (inlined)') ? 'OK' : 'MISSING');
