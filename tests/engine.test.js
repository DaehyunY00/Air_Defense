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
// seed 0 보존 (리뷰 지적: (seed>>>0)||1 은 0을 1로 붕괴시켰음)
var s0 = run('sc3', 'asis', 1.5, 0), s1 = run('sc3', 'asis', 1.5, 1);
assert(s0.config.seed === 0 && JSON.stringify(s0) !== JSON.stringify(s1), 'seed 0 보존 (seed 1과 구별)');

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

console.log('# 흐름 카운터 (Sankey/funnel용, trace 무관 항상 제공)');
var flowRun = run('sc3', 'asis', 1.5, 21);
assert(flowRun.flow.spawned >= flowRun.flow.detected, 'flow: 생성 ≥ 탐지');
assert(flowRun.flow.detected >= flowRun.flow.reachedC2, 'flow: 탐지 ≥ C2도달');
assert(flowRun.flow.reachedC2 >= flowRun.flow.everEngaged, 'flow: C2도달 ≥ 교전개시(단발집계)');
assert(flowRun.flow.everEngaged >= flowRun.flow.killed, 'flow: 교전개시 ≥ 격추');
assert(!flowRun.threatTraces && !flowRun.nodeSeries, 'trace 미지정 시 threatTraces/nodeSeries 미포함(오버헤드 없음)');

console.log('# Phase 4 trace 모드');
var tr = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 21, endTimeSec: 1800, trace: true, traceCap: 300 });
assert(JSON.stringify(tr.global) === JSON.stringify(flowRun.global), 'trace:true 이어도 통계 결과는 trace:false와 완전 동일(부수효과 없음)');
assert(Array.isArray(tr.threatTraces) && tr.threatTraces.length > 0, 'threatTraces 기록됨 (' + tr.threatTraces.length + '건)');
assert(tr.threatTraces.length <= 300, 'threatTraces가 traceCap(300) 이내로 절삭');
assert(tr.threatTraces.every(function (tt) { return tt.stages.length >= 2 && tt.stages[0].name === '생성'; }),
  '각 trace는 "생성" 단계로 시작하고 최소 2단계 이상 기록');
assert(tr.threatTraces.every(function (tt) {
  for (var i = 1; i < tt.stages.length; i++) if (tt.stages[i].t < tt.stages[i - 1].t) return false;
  return true;
}), '각 trace의 단계 타임스탬프가 비감소(시간순)');
// Phase 5 리뷰 발견 1 회귀: trace 종결(exitT) 이후 단계가 기록되지 않아야 함
// (누수한 위협의 잔여 서버 완료 콜백이 exitT 이후 _mark를 추가해 Gantt 구간 합이
//  100%를 초과하던 결함 — 포화 조건에서 재현되었음)
(function () {
  var violations = 0, checked = 0;
  [0, 21, 42].forEach(function (sd) {
    var r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 3, seed: sd, endTimeSec: 1800, trace: true, traceCap: 300 });
    r.threatTraces.forEach(function (tt) {
      if (tt.exitT === null) return;
      checked++;
      tt.stages.forEach(function (s) { if (s.t > tt.exitT + 1e-9) violations++; });
    });
  });
  assert(checked > 100 && violations === 0,
    '종결된 trace(' + checked + '건)에 exitT 이후 단계 없음 — Gantt 구간 합 ≤100% 보장 (위반 ' + violations + ')');
})();
assert(tr.threatTraces.filter(function (tt) { return tt.outcome !== null; }).length > 0,
  '일부 위협은 종결(killed/leaked) outcome 기록');
assert(Object.keys(tr.nodeSeries).length > 0, 'nodeSeries가 노드별로 기록됨');
Object.keys(tr.nodeSeries).forEach(function (id) {
  var series = tr.nodeSeries[id];
  for (var i = 1; i < series.length; i++) {
    if (series[i].t < series[i - 1].t) { assert(false, 'nodeSeries[' + id + '] 시간 역행'); return; }
  }
  assert(series.every(function (s) { return s.n >= 0; }), 'nodeSeries[' + id + '] 재고 음수 없음');
});
// trace 재현성: 동일 seed → 동일 trace (threatTraces/nodeSeries 포함 완전 동일)
var tr2 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 21, endTimeSec: 1800, trace: true, traceCap: 300 });
assert(JSON.stringify(tr) === JSON.stringify(tr2), 'trace 포함 결과도 동일 seed → 완전 동일 (재현성)');
// traceCap 절삭 동작: 상한을 낮게 주면 truncated 플래그가 서고, 배열은 상한을 넘지 않음
var trCap = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 21, endTimeSec: 1800, trace: true, traceCap: 5 });
assert(trCap.threatTraces.length <= 5, 'traceCap=5: threatTraces ≤ 5건');
assert(trCap.traceTruncated === true, 'traceCap 초과 시 traceTruncated=true (절삭을 숨기지 않음)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
