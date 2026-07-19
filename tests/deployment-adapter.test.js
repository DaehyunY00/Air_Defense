/** Phase 1 deployment adapter integration and deterministic execution. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'engine/sim-engine.js', 'analysis/bottleneck.js', 'analysis/overlap-heatmap.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function stable(r) { return JSON.stringify({ global: r.global, flow: r.flow, nodes: r.nodes, links: r.links, eventCount: r.eventCount }); }

assert(KJ.resolveModelCatalog({}).id === 'legacy' && KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_FULL_NORMAL', features: { highResolutionDeployment: false } }).id === 'legacy', '플래그 생략/OFF는 legacy 카탈로그');
assert(KJ.resolveModelCatalog({ features: { highResolutionDeployment: true } }).id === 'HANBANDO_MINI_NORMAL', 'ON+ID 생략은 MINI_NORMAL');
var bad = false;
try { KJ.resolveModelCatalog({ deploymentId: 'NO_SUCH_DEPLOYMENT', features: { highResolutionDeployment: true } }); } catch (e) { bad = /Unknown high-resolution deployment/.test(e.message); }
assert(bad, '잘못된 배치 ID는 명시적 오류');

KJ.DEPLOYMENT_IDS.forEach(function (id) {
  var c = KJ.buildDeploymentCatalog(id);
  assert(c.links.every(function (l) { return !!c.nodeMap[l.from] && !!c.nodeMap[l.to]; }), id + ' 모든 링크 종점 존재');
  assert(new Set(c.nodes.map(function (n) { return n.id; })).size === c.nodes.length, id + ' catalog 노드 ID 유일');
  var crossing = c.links.filter(function (l) {
    return (c.nodeMap[l.from].forceOwner === 'USFK') !== (c.nodeMap[l.to].forceOwner === 'USFK');
  });
  assert(crossing.length === 0, id + ' USFK↔한국군 C2 교차 링크 부재');
  assert(c.nodes.filter(function (n) { return n.category === 'shooter' && n.forceOwner === 'USFK'; }).every(function (n) {
    return Object.keys(n.canEngage).some(function (k) { return n.canEngage[k] === true; }) &&
      n.c2Axis.indexOf('USFK_') === 0;
  }), id + ' USFK 사수는 독립 C2 축에서만 실제 교전 가능');
});

['MINI', 'FULL'].forEach(function (size) {
  ['MCRC', 'KAMDOC'].forEach(function (rootName) {
    var id = 'HANBANDO_' + size + '_' + rootName + '_DOWN';
    var c = KJ.buildDeploymentCatalog(id);
    assert(!c.nodes.some(function (n) { return n.typeId === (rootName === 'MCRC' ? 'MCRC' : 'KAMD_OPS'); }) &&
      !c.links.some(function (l) { return !c.nodeMap[l.from] || !c.nodeMap[l.to]; }), id + ' 제거 C2·잔존 링크 정합');
  });
});

var scenario = KJ.scenarioById('sc1');
KJ.DEPLOYMENT_IDS.forEach(function (id) {
  ['asis', 'tobe'].forEach(function (mode) {
    var cfg = { scenario: scenario, mode: mode, intensity: 0.5, seed: 42, endTimeSec: 900,
      deploymentId: id, features: { highResolutionDeployment: true } };
    var a = KJ.runDES(cfg), b = KJ.runDES(cfg), g = a.global;
    assert(stable(a) === stable(b), id + ' ' + mode + ' 결정론적 재현');
    assert(g.spawned === g.killed + g.leaked + g.censoredRaw && a.flow.spawned >= a.flow.detected && a.flow.detected >= a.flow.reachedC2 &&
      [g.killRate, g.leakRate, g.meanDecisionDelaySec, g.meanTimeToEngageSec, g.meanTimeToKillSec].every(Number.isFinite),
      id + ' ' + mode + ' 보존법칙·유한 지표');
  });
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
