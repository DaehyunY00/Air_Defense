#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — 단일본 HTML 빌드 스크립트
 *
 * index.html + css/style.css + js/**를 인라인해 `K-JAMDS_시뮬레이터_단일본.html`을
 * 재생성한다. Leaflet 1.9.4 CSS/JS 인라인 블록은 (외부망 없이 재현 가능하도록)
 * 기존 단일본에서 추출해 재사용한다 — 즉 이 스크립트는 항상 "직전 단일본 + 현재 소스"
 * 만으로 결정론적으로 동작한다.
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

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SINGLE = path.join(root, 'K-JAMDS_시뮬레이터_단일본.html');

const old = readFileSync(SINGLE, 'utf-8');
const idx = readFileSync(path.join(root, 'index.html'), 'utf-8');

/** 기존 단일본에서 마커 블록(여는 태그 포함, 닫는 태그 포함) 추출 */
function extractBlock(src, startTok, closeTag) {
  const i = src.indexOf(startTok);
  if (i < 0) throw new Error('블록 마커 없음: ' + startTok);
  const j = src.indexOf(closeTag, i);
  return src.slice(i, j + closeTag.length);
}
const leafletCss = extractBlock(old, '<style>/* Leaflet 1.9.4 CSS (inlined) */', '</style>');
const leafletJs = extractBlock(old, '<script>/* Leaflet 1.9.4 JS (inlined) */', '</script>');

function inlineFile(relPath, tag) {
  let body = readFileSync(path.join(root, relPath), 'utf-8');
  if (!body.endsWith('\n')) body += '\n';
  return '<' + tag + '>/* ' + relPath + ' (inlined) */\n' + body + '</' + tag + '>';
}

let out = idx;

// 제목: 단일본임을 명시
out = out.replace(
  /<title>[^<]*<\/title>/,
  '<title>K-JAMDS C2 시뮬레이터 (단일 HTML)</title>'
);

// head: Leaflet CDN CSS 링크(2줄) + 로컬 스타일시트 링크 → 빌드 주석 + 인라인 CSS 2블록
out = out.replace(
  /  <link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet[^>]*\n[^>]*>\n  <link rel="stylesheet" href="css\/style\.css">/,
  '  <!-- 단일 파일 빌드: 모든 CSS/JS(+Leaflet) 인라인. 지도 타일만 온라인(OpenStreetMap), ' +
  '폐쇄망에서는 자동 SVG 개념도로 대체. 원본: index.html + js/ + css/ (재생성: node scripts/build-single.mjs) -->\n' +
  '  ' + leafletCss + '\n  ' + inlineFile('css/style.css', 'style')
);

// Leaflet CDN JS(2줄 태그) → 인라인 JS
out = out.replace(
  /  <script src="https:\/\/unpkg\.com\/leaflet[^>]*\n[^>]*><\/script>/,
  '  ' + leafletJs
);

// 각 로컬 스크립트 → 인라인 (index.html의 순서 그대로)
out = out.replace(/  <script src="(js\/[\w/.-]+\.js)"><\/script>/g, (m, rel) => '  ' + inlineFile(rel, 'script'));

// 잔여 외부 참조 검증
if (/<link rel="stylesheet" href="css\//.test(out) || /<script src="js\//.test(out)) {
  throw new Error('인라인되지 않은 로컬 참조가 남아 있음');
}

writeFileSync(SINGLE, out);
console.log('단일본 재생성 완료: ' + SINGLE);
console.log('  인라인 JS 블록:', (out.match(/<script>\/\* js\//g) || []).length + '개');
console.log('  Leaflet CSS/JS:', out.includes('Leaflet 1.9.4 CSS (inlined)') && out.includes('Leaflet 1.9.4 JS (inlined)') ? 'OK' : 'MISSING');
