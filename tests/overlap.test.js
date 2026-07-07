/**
 * K-JAMDS 시뮬레이터 — 중복교전 히트맵 회귀 테스트 (Phase 4)
 * 실행:  node tests/overlap.test.js   (저장소 루트에서)
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'analysis/overlap-heatmap.js'].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function heat(id, mode, x) { return KJ.computeOverlapHeat(KJ.scenarioById(id), mode, x); }

console.log('# 순수함수·결정론');
var h1 = heat('sc3', 'asis', 1), h2 = heat('sc3', 'asis', 1);
assert(JSON.stringify(h1) === JSON.stringify(h2), '동일 입력 → 동일 결과 (RNG 없는 순수 계산)');

console.log('# 시나리오 없는 축선은 위험도 0');
var h = heat('sc1', 'asis', 1);
h.axes.forEach(function (a) {
  var hasEntry = KJ.scenarioById('sc1').mix.some(function (m) { return m.axis === a.axis; });
  if (!hasEntry) assert(a.raw === 0, a.axis + ': 시나리오에 없는 축선은 raw=0');
});

console.log('# 강도 선형 스케일링');
var lo = heat('sc3', 'asis', 1), hi = heat('sc3', 'asis', 2);
var loWest = lo.axes.find(function (a) { return a.axis === 'west'; }).raw;
var hiWest = hi.axes.find(function (a) { return a.axis === 'west'; }).raw;
assert(Math.abs(hiWest - loWest * 2) < 1e-9, '강도 2배 → west raw 2배 (' + loWest + ' → ' + hiWest + ')');

console.log('# To-Be(JAMDC2 융합) ≤ As-Is (축선별)');
['sc1', 'sc2', 'sc3'].forEach(function (id) {
  var a = heat(id, 'asis', 1), b = heat(id, 'tobe', 1);
  a.axes.forEach(function (axA, i) {
    var axB = b.axes[i];
    assert(axB.raw <= axA.raw + 1e-9, id + '/' + axA.axis + ': To-Be(' + axB.raw.toFixed(2) +
      ') ≤ As-Is(' + axA.raw.toFixed(2) + ')');
  });
});

console.log('# JAMDC2 융합 허브: To-Be에서 다축선 위험 완전 해소되는 사례 존재');
var sc1a = heat('sc1', 'asis', 1), sc1b = heat('sc1', 'tobe', 1);
var asisHasRisk = sc1a.axes.some(function (a) { return a.raw > 0; });
var tobeAllZero = sc1b.axes.every(function (a) { return a.raw === 0; });
assert(asisHasRisk && tobeAllZero, 'SC1: As-Is에 위험 존재하나 To-Be에서 전 축선 0으로 해소');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
