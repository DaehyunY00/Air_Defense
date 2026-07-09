/**
 * 단일본 HTML 재생성 빌드 스크립트 (Phase 7)
 * 실행:  node tools/build-single.js   (저장소 루트에서)
 *
 * 기존 `K-JAMDS_시뮬레이터_단일본.html`에서 Leaflet 인라인 블록(CSS·JS)만 보존하고,
 * 프로젝트 CSS(`css/style.css`)와 index.html의 <script src> 순서에 따른 전체 JS를
 * 현재 소스로 다시 인라인해 같은 파일에 덮어쓴다. 소스 수정 후 반드시 재실행할 것.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var OUT = path.join(root, 'K-JAMDS_시뮬레이터_단일본.html');

var prev = fs.readFileSync(OUT, 'utf8');

// 1) 기존 단일본에서 Leaflet 인라인 블록 추출 (CDN 접근 없이 보존)
function extract(s, startMarker, endMarker, fromIdx) {
  var a = s.indexOf(startMarker, fromIdx || 0);
  if (a === -1) throw new Error('marker not found: ' + startMarker);
  var b = s.indexOf(endMarker, a);
  if (b === -1) throw new Error('end not found after: ' + startMarker);
  return s.slice(a, b + endMarker.length);
}
var leafletCss = extract(prev, '<style>/* Leaflet 1.9.4 CSS (inlined) */', '</style>');
var leafletJs = extract(prev, '<script>/* Leaflet 1.9.4 JS (inlined) */', '</script>');

// 2) index.html에서 body 마크업과 스크립트 순서 취득
var index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var scripts = [];
index.replace(/<script src="(js\/[^"]+)"><\/script>/g, function (_, p) { scripts.push(p); return _; });
if (scripts.length < 10) throw new Error('script list too short: ' + scripts.length);

// body 내용: <body> ~ 첫 <script (Leaflet CDN) 직전까지
var bodyStart = index.indexOf('<body>') + '<body>'.length;
var bodyEnd = index.indexOf('<script src="https://unpkg.com/leaflet');
var body = index.slice(bodyStart, bodyEnd).replace(/\s+$/, '\n');

var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

// 3) 조립
var out = [];
out.push('<!DOCTYPE html>');
out.push('<html lang="ko">');
out.push('<head>');
out.push('  <meta charset="UTF-8">');
out.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
out.push('  <title>K-JAMDS C2 시뮬레이터 (단일 HTML)</title>');
out.push('  <!-- 단일 파일 빌드: 모든 CSS/JS(+Leaflet) 인라인. 지도 타일만 온라인(OpenStreetMap), 폐쇄망에서는 자동 SVG 개념도로 대체. 원본: index.html + js/ + css/ — 재생성: node tools/build-single.js -->');
out.push('  ' + leafletCss);
out.push('  <style>/* css/style.css (inlined) */');
out.push(css.replace(/<\/style>/g, ''));
out.push('</style>');
out.push('</head>');
out.push('<body>');
out.push(body);
out.push('  ' + leafletJs);
scripts.forEach(function (p) {
  var src = fs.readFileSync(path.join(root, p), 'utf8');
  // </script> 문자열이 소스에 있으면 인라인이 깨지므로 방어
  if (src.indexOf('</script>') !== -1) throw new Error(p + ' contains </script>');
  out.push('  <script>/* ' + p + ' (inlined) */');
  out.push(src.replace(/\s+$/, ''));
  out.push('</script>');
});
out.push('</body>');
out.push('</html>');
out.push('');

fs.writeFileSync(OUT, out.join('\n'), 'utf8');
console.log('빌드 완료: ' + path.basename(OUT) + ' (' +
  (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB, 스크립트 ' + scripts.length + '개 인라인)');
