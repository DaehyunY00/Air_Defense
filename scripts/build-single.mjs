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

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SINGLE = path.join(root, 'K-JAMDS_시뮬레이터_단일본.html');

const idx = readFileSync(path.join(root, 'index.html'), 'utf-8');

/** 파일 하나를 <tag>/* 라벨 *\/ … </tag> 블록으로 인라인 */
function inline(relPath, tag, label) {
  let body = readFileSync(path.join(root, relPath), 'utf-8');
  if (!body.endsWith('\n')) body += '\n';
  return '<' + tag + '>/* ' + (label || relPath + ' (inlined)') + ' */\n' + body + '</' + tag + '>';
}
const inlineFile = (relPath, tag) => inline(relPath, tag);

// Leaflet은 동봉본(vendor/)에서 읽는다. 마커 문구는 종전과 같게 유지 — 단일본 구조
// 규약이자 회귀 테스트의 식별자다.
const leafletCss = inline('vendor/leaflet-1.9.4/leaflet.css', 'style', 'Leaflet 1.9.4 CSS (inlined)');
const leafletJs = inline('vendor/leaflet-1.9.4/leaflet.js', 'script', 'Leaflet 1.9.4 JS (inlined)');

/**
 * 반드시 1회 치환. 안 맞으면 던진다 — 조용히 넘어가면 index.html의 태그가 그대로
 * 남은 채 "빌드 성공"으로 보고되고, 그 단일본은 외부 참조를 안고 배포된다.
 */
function replaceOnce(src, pattern, replacement, what) {
  if (!pattern.test(src)) throw new Error('치환 대상을 찾지 못함: ' + what);
  return src.replace(pattern, replacement);
}

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

// 각 로컬 스크립트 → 인라인 (index.html의 순서 그대로, ?v= 캐시버스터 허용)
out = out.replace(/  <script src="(js\/[\w/.-]+\.js)(?:\?[\w=.-]*)?"><\/script>/g, (m, rel) => '  ' + inlineFile(rel, 'script'));

// 잔여 참조 검증 — 로컬(css/·js/·vendor/)도, CDN도 남아 있으면 안 된다
if (/<link rel="stylesheet" href="(css|vendor)\//.test(out) || /<script src="(js|vendor)\//.test(out)) {
  throw new Error('인라인되지 않은 로컬 참조가 남아 있음');
}
// 태그 단위로만 검사한다 — 인라인된 JS 본문에는 타일 URL 등 https 문자열이 정상적으로 들어 있다
const cdnTag = out.match(/<(?:script|link)\b[^>]*\b(?:src|href)="https?:\/\/[^"]*"/);
if (cdnTag) throw new Error('단일본에 외부 CDN 참조가 남아 있음: ' + cdnTag[0].slice(0, 100));

writeFileSync(SINGLE, out);
console.log('단일본 재생성 완료: ' + SINGLE);
console.log('  인라인 JS 블록:', (out.match(/<script>\/\* js\//g) || []).length + '개');
console.log('  Leaflet CSS/JS:', out.includes('Leaflet 1.9.4 CSS (inlined)') && out.includes('Leaflet 1.9.4 JS (inlined)') ? 'OK' : 'MISSING');
