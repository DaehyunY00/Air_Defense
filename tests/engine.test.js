/**
 * K-JAMDS 시뮬레이터 — DES 엔진 회귀 테스트 (Phase 2)
 * 실행:  node tests/engine.test.js   (저장소 루트에서)
 *
 * 브라우저 전역(window.KJ)을 Node 전역으로 매핑해 데이터·엔진 모듈을 로드하고,
 * 재현성·극한값·시나리오 기반 병목 도출·제약·보존 항등식을 검증한다.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, seed, dur) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: dur || 1800 });
}

console.log('# 재현성');
var r1 = run('sc3', 'asis', 1.5, 42);
var r2 = run('sc3', 'asis', 1.5, 42);
assert(JSON.stringify(r1) === JSON.stringify(r2), '동일 seed/config → 완전 동일 결과 (결정론)');
assert(JSON.stringify(r1) !== JSON.stringify(run('sc3', 'asis', 1.5, 43)), 'seed 변경 → 결과 변화');

console.log('# 극한값');
var empty = { id: 'empty', name: 'empty', mix: [] };
var rE = KJ.runDES({ scenario: empty, mode: 'asis', intensity: 1, seed: 1, endTimeSec: 600 });
assert(rE.global.spawned === 0 && rE.bottlenecks.length === 0, '위협 0: 생성·병목 0');
assert(rE.nodes.every(function (n) { return n.rho === 0 && isFinite(n.rho); }), '위협 0: ρ=0, NaN 없음');
assert(run('sc3', 'asis', 0, 1).global.spawned === 0, '강도 0: 생성 0');
var rSat = run('sc3', 'asis', 3.0, 7);
assert(isFinite(rSat.eventCount) && rSat.eventCount > 0, '포화: 이벤트 루프 정상 종료');
assert(rSat.nodes.every(function (n) { return n.rho <= 1.0000001; }), '포화: 관측 ρ ≤ 1');
assert(rSat.nodes.some(function (n) { return n.drops > 0; }) && rSat.global.leaked > 0, '포화: 드롭·누수 발생');
assert(rSat.bottlenecks.length > 0, '포화: 병목 도출');

console.log('# 시나리오 기반 병목 (고정 아님)');
var sig = {};
['sc1', 'sc2', 'sc3', 'sc4', 'sc5'].forEach(function (id) {
  [1, 2.5].forEach(function (x) {
    ['asis', 'tobe'].forEach(function (mode) {
      var r = run(id, mode, x, 100);
      sig[id + '/' + mode + '/' + x] = r.bottlenecks.map(function (b) { return b.kind + ':' + b.id; }).sort().join(',');
    });
  });
});
assert(new Set(Object.values(sig)).size > 3, '시나리오·강도·모드별 병목 다양 (' + new Set(Object.values(sig)).size + '종)');
assert(run('sc5', 'asis', 1, 5).bottlenecks.length === 0, 'SC5 저강도: 병목 0 (부하의 함수)');
['sc3', 'sc4'].forEach(function (id) {
  assert(run(id, 'asis', 2.5, 100).bottlenecks.length >= run(id, 'asis', 1, 100).bottlenecks.length,
    id + ': 강도↑ 병목 비감소');
});

console.log('# To-Be 개선');
var a = run('sc3', 'asis', 1.5, 9), b = run('sc3', 'tobe', 1.5, 9);
assert(b.global.leakRate < a.global.leakRate, 'To-Be 누수율 < As-Is (' +
  (a.global.leakRate * 100).toFixed(0) + '% → ' + (b.global.leakRate * 100).toFixed(0) + '%)');
assert(b.bottlenecks.length <= a.bottlenecks.length, 'To-Be 병목 ≤ As-Is');

console.log('# 제약·보존');
var sc2 = run('sc2', 'asis', 2, 3);
assert(sc2.nodes.filter(function (n) { return n.id.indexOf('SHORAD') === 0 && n.arrivals > 0; }).length === 0,
  '탄도탄 시나리오: 신궁·천마 교전투입 0 (제약)');
[a, b, rSat].forEach(function (r, i) {
  assert(r.global.spawned - r.global.killed - r.global.leaked >= 0, 'run' + i + ': 생성 ≥ 격추+누수 (보존)');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
