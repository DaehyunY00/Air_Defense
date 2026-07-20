/** FULL 배치 중복교전 위험 계산의 결과 동등성·성능 회귀. */
'use strict';
global.window = global;
var path = require('path');
var performance = require('perf_hooks').performance;
var root = path.join(__dirname, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'analysis/overlap-heatmap.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

var model = {
  deploymentId: 'HANBANDO_FULL_NORMAL',
  features: { highResolutionDeployment: true }
};
var scenario = KJ.scenarioById('sc3');
var expected = {
  asis: [1125, 2858.25, 1698, 506.25],
  tobe: [112.5, 997.5, 609, 0]
};

['asis', 'tobe'].forEach(function (mode) {
  var t0 = performance.now();
  var heat = KJ.computeOverlapHeat(scenario, mode, 1.5, model);
  var elapsed = performance.now() - t0;
  var raw = heat.axes.map(function (a) { return a.raw; });
  assert(raw.every(function (v, i) { return Math.abs(v - expected[mode][i]) < 1e-9; }),
    mode + ': 최적화 전 정본 축선 raw와 bit-equivalent');
  // 기존 구현은 로컬에서 5~20초/회였다. CI 편차를 허용하면서도 O(root-pair×BFS) 회귀를 잡는다.
  assert(elapsed < 500, mode + ': FULL/SC3 overlap 500ms 미만 (' + elapsed.toFixed(1) + 'ms)');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
