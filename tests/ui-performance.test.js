/** Worker offload and map-control UI regression. */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
var index = read('index.html');
var css = read('css/style.css');
var main = read('js/main.js');
var map = read('js/ui/map-view.js');
var sim = read('js/ui/sim-view.js');
var mc = read('js/ui/mc-panel.js');
var client = read('js/core/sim-worker-client.js');
var worker = read('js/workers/sim-worker.js');
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

assert(index.indexOf('header-bn-count') === -1, '우측 상단 도출 병목 배지 제거');
assert(index.indexOf('id="toggle-links"') !== -1, 'C2 연결선 표시 토글 노출');
assert(index.indexOf('js/core/sim-worker-client.js') !== -1, 'Worker client 로드');
assert(/\.map-legend\s*\{[^}]*right:\s*12px;[^}]*left:\s*auto;/s.test(css), '범례 우측 하단 배치');
assert(main.indexOf("getElementById('toggle-links')") !== -1, '링크 토글 이벤트 바인딩');
assert(main.indexOf('header-bn-count') === -1, '헤더 병목 수 갱신 로직 제거');
assert(map.indexOf('setLinksVisible: function') !== -1, 'Leaflet C2 링크 레이어 토글');
assert(map.indexOf('linksVisible ? KJ.linksInMode') !== -1, 'SVG fallback 링크 토글');
assert(sim.indexOf("KJ.compute.run('desPair'") !== -1, '주 시뮬레이션 DES Worker 분리');
assert(sim.indexOf("KJ.compute.run('mcPair'") !== -1, '백그라운드 MC Worker 분리');
assert(sim.indexOf('renderEveryMs = objectCount > 160 ? 100 : 33') !== -1 && sim.indexOf('lastRingWall') !== -1,
  'FULL 지도 적응형 프레임률·링 갱신 제한');
assert(mc.indexOf("KJ.compute.run('mcBundle'") !== -1, 'MC·민감도 Worker 분리');
assert(mc.indexOf("KJ.compute.run('transition'") !== -1, '임계 전환점 Worker 분리');
assert(worker.indexOf("'../engine/sim-engine.js'") !== -1 && worker.indexOf("'../analysis/overlap-heatmap.js'") !== -1,
  'Worker 엔진·분석 정본 로드');
assert(client.indexOf('main-thread-fallback') !== -1, '단일 HTML/Worker 미지원 폴백 보존');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
