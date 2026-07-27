/**
 * K-JAMDS 시뮬레이터 — Leaflet 동봉본 회귀 테스트
 * 실행:  node tests/vendor-leaflet.test.js   (저장소 루트에서)
 *
 * Leaflet은 CDN이 아니라 vendor/leaflet-1.9.4/에서 읽는다. CDN 의존이 있으면
 * 폐쇄망에서 지도가 SVG 개념도로 대체되고 **재생 애니메이션 경로 자체가 실행되지
 * 않아** 검증 불가 상태가 된다(sim-view.js의 isFallback 분기). 이 스위트는
 *  (a) 동봉 파일의 무결성(sha256 + 업스트림 SRI),
 *  (b) index.html·단일본에 CDN 참조가 되살아나지 않았는지,
 *  (c) CSS가 참조하는 이미지 자산이 실제로 불필요한지(divIcon만 사용)
 * 를 고정한다.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var root = path.join(__dirname, '..');

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sri(buf) { return crypto.createHash('sha256').update(buf).digest('base64'); }

var VENDOR = 'vendor/leaflet-1.9.4/';
// 업스트림 unpkg가 제공하던 SRI 값 — 동봉 전 index.html의 integrity 속성에 있던 것 그대로.
var UPSTREAM_SRI_JS = '20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
var LOCAL_SHA_JS = 'db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a';
var LOCAL_SHA_CSS = '5f236f11b6ca29a549c06be1c1c786ec53523fb39a1bae2f2ba61f6fef889edb';

// ── (a) 동봉 파일 무결성 ──
console.log('# (a) 동봉 파일 무결성');
var jsBuf = fs.readFileSync(path.join(root, VENDOR + 'leaflet.js'));
var cssBuf = fs.readFileSync(path.join(root, VENDOR + 'leaflet.css'));
assert(sha256(jsBuf) === LOCAL_SHA_JS, 'leaflet.js sha256 고정 (' + sha256(jsBuf).slice(0, 16) + '…)');
assert(sha256(cssBuf) === LOCAL_SHA_CSS, 'leaflet.css sha256 고정 (' + sha256(cssBuf).slice(0, 16) + '…)');
assert(sri(jsBuf) === UPSTREAM_SRI_JS, 'leaflet.js가 업스트림 SRI와 바이트 단위 일치');
// CSS는 업스트림 SRI와 불일치하는 것이 현재 알려진 상태다(원인 미규명 — vendor README §불일치).
// "일치하게 됐다"도 변화이므로, 불일치라는 사실 자체를 고정해 조용한 교체를 막는다.
assert(sri(cssBuf) !== 'p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
  'leaflet.css는 업스트림 SRI와 불일치(README에 기록된 미해결 항목)');
assert(fs.existsSync(path.join(root, VENDOR + 'README.md')), '출처·라이선스 문서 존재');
assert(fs.existsSync(path.join(root, 'scripts/verify-vendor-leaflet.mjs')),
  '업스트림 대조 스크립트 존재 (외부망 환경에서 불일치를 종결하기 위한 수단)');

// ── (a3) CSS 진위 — 바이트 출처를 증명할 수 없으므로 내용으로 검증한다 ──
// leaflet.css의 pane z-index 스택은 CSS에만 존재하는 임의 상수라, 다른 파일로
// 바꿔치기하면 이 값들이 먼저 어긋난다. 지도 레이어 순서가 곧 이 값이다.
console.log('# (a3) CSS 진위 — 정본 z-index 스택·구조');
var cssText = cssBuf.toString('utf8');
var jsText = jsBuf.toString('utf8');
var Z = { 'leaflet-pane': 400, 'leaflet-tile-pane': 200, 'leaflet-overlay-pane': 400,
  'leaflet-shadow-pane': 500, 'leaflet-marker-pane': 600, 'leaflet-tooltip-pane': 650,
  'leaflet-popup-pane': 700, 'leaflet-control': 800 };
Object.keys(Z).forEach(function (cls) {
  var m = cssText.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*z-index:\\s*(\\d+)'));
  assert(m && Number(m[1]) === Z[cls], '.' + cls + ' z-index = ' + Z[cls] + (m ? ' (실제 ' + m[1] + ')' : ' (규칙 없음)'));
});
var depth = 0, unbalanced = false;
for (var ci = 0; ci < cssText.length; ci++) {
  var ch = cssText[ci];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0) unbalanced = true; }
}
assert(depth === 0 && !unbalanced, '중괄호 균형 — 절단·삽입 없음');
assert((cssText.match(/\/\*/g) || []).length === (cssText.match(/\*\//g) || []).length, '주석 균형');
assert(!/[^\x00-\x7F]/.test(cssText), '순수 ASCII (HTML 경유 오염 흔적 없음)');
['.leaflet-popup', '.leaflet-tooltip', '.leaflet-control-zoom', '.leaflet-control-layers',
 '.leaflet-control-attribution', '.leaflet-control-scale', '.leaflet-touch', '.leaflet-oldie',
 '.leaflet-zoom-anim', '@media print'].forEach(function (sec) {
  assert(cssText.indexOf(sec) !== -1, '표준 섹션 존재: ' + sec);
});
// leaflet.js가 조작하는 클래스가 CSS에 정의돼 있는가 (런타임 접두사·비스타일 클래스는 제외)
var RUNTIME_ONLY = ['leaflet-drag-target', 'leaflet-marker-', 'leaflet-zoom-', 'leaflet-tooltip-', 'leaflet-vml-container'];
var jsCls = [], m2, reCls = /["'](leaflet-[a-z0-9-]+)["']/g;
while ((m2 = reCls.exec(jsText)) !== null) if (jsCls.indexOf(m2[1]) === -1) jsCls.push(m2[1]);
assert(jsCls.length >= 30, 'js에서 leaflet-* 클래스를 실제로 수집했는지 (' + jsCls.length + '종)');
var cssCls = {}, m3, reCss = /\.(leaflet-[a-z0-9-]+)/g;
while ((m3 = reCss.exec(cssText)) !== null) cssCls[m3[1]] = true;
var uncovered = jsCls.filter(function (c) { return !cssCls[c] && RUNTIME_ONLY.indexOf(c) === -1; });
assert(uncovered.length === 0,
  'js가 쓰는 leaflet-* 클래스 ' + jsCls.length + '종을 CSS가 모두 정의' +
  (uncovered.length ? ' — 미정의: ' + uncovered.join(', ') : ''));

console.log('# (a2) 라이선스·식별자 보존');
var js = jsBuf.toString('utf8');
assert(js.indexOf('@preserve') !== -1 && js.indexOf('Vladimir Agafonkin') !== -1,
  'BSD-2-Clause 저작권 표기(@preserve 헤더) 보존');
assert(/Leaflet 1\.9\.4/.test(js), '버전 문자열 1.9.4');
assert(js.indexOf('window.L=') !== -1, '전역 L 노출 (앱이 window.L로 fallback을 판정)');
var css = cssBuf.toString('utf8');
assert(css.indexOf('.leaflet-pane') !== -1 && css.indexOf('.leaflet-container') !== -1,
  '핵심 레이아웃 규칙(.leaflet-pane/.leaflet-container) 존재');

// ── (b) CDN 참조가 되살아나지 않았는가 ──
console.log('# (b) CDN 의존 부재');
var idx = read('index.html');
assert(idx.indexOf(VENDOR + 'leaflet.js') !== -1 && idx.indexOf(VENDOR + 'leaflet.css') !== -1,
  'index.html이 동봉본을 참조');
assert(!/<(?:script|link)\b[^>]*\b(?:src|href)="https?:\/\//.test(idx),
  'index.html 태그에 외부 CDN 참조 없음');
assert(idx.indexOf('unpkg.com') === -1, 'index.html에 unpkg 흔적 없음');

var single = read('K-JAMDS_시뮬레이터_단일본.html');
assert(single.indexOf('Leaflet 1.9.4 CSS (inlined)') !== -1 &&
  single.indexOf('Leaflet 1.9.4 JS (inlined)') !== -1, '단일본에 Leaflet 인라인 블록 존재');
assert(!/<(?:script|link)\b[^>]*\b(?:src|href)="https?:\/\//.test(single),
  '단일본 태그에 외부 CDN 참조 없음');
// 동봉본 본문이 그대로 인라인됐는가 (일부 발췌 대조 — 전체 문자열 비교는 메모리만 소모)
assert(single.indexOf(js.slice(0, 200)) !== -1, '단일본 인라인 JS가 동봉본과 동일한 선두를 가짐');
assert(single.indexOf(css.slice(0, 200)) !== -1, '단일본 인라인 CSS가 동봉본과 동일한 선두를 가짐');

// ── (c) CSS가 참조하는 이미지 자산이 불필요한가 ──
// leaflet.css는 marker-icon.png·layers.png를 url()로 참조하지만, 이 앱은 기본 마커
// 아이콘도 레이어 컨트롤도 쓰지 않으므로 해당 규칙에 걸리는 요소가 생기지 않는다.
// 그 전제(divIcon만 사용)가 깨지면 이미지 404가 나므로 소스 수준에서 고정한다.
console.log('# (c) 이미지 자산 불요 전제');
var mapView = read('js/ui/map-view.js');
assert(/L\.divIcon\(/.test(mapView), 'map-view는 divIcon으로 마커를 만든다');
assert(!/L\.icon\(/.test(mapView) && !/iconUrl/.test(mapView),
  '기본 마커 이미지(L.icon/iconUrl) 미사용');
assert(!/L\.control\.layers\(/.test(mapView), '레이어 컨트롤(layers.png 유발) 미사용');
assert(/url\(images\/marker-icon\.png\)/.test(css),
  '전제의 대상이 되는 CSS url() 참조가 실제로 존재함을 확인(전제가 무의미해지지 않았는지)');

// ── (d) 폐쇄망 대체 경로 탈출구 유지 ──
console.log('# (d) SVG 개념도 대체 경로 유지');
assert(idx.indexOf("svgFallback") !== -1 && /window\.L = undefined/.test(idx),
  '?svgFallback=1 스모크 훅 유지 (동봉 후에도 대체 경로를 재현할 수 있어야 함)');
var simView = read('js/ui/sim-view.js');
assert(/KJ\.mapView\.isFallback\(\)/.test(simView), 'sim-view의 fallback 분기 유지');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
