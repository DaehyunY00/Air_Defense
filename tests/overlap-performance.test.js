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
// ADR-065 갱신: 남부 종심 축선(ADR-064)이 기본 포함되면서 coverage 파생이 좁아졌다 —
// 사거리가 남부 축선에만 닿는 자산이 종전에는 coverage:[](=축선 무제한)이라 **중부축 중복위험에
// 계상**되고 있었고, 이제 남부 전용으로 분류돼 빠진다(central asis 2858.25 → 2250.75).
// 종전 값이 과대계상이었다 — 임계를 맞춘 것이 아니라 계정 범위가 정확해진 것이다.
var expected = {
  asis: [1125, 2250.75, 1698, 506.25],
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
