/** Failure classification v2: causal families, structurality, native evidence and shooter load. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/bottleneck.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });

var KJ = global.KJ, fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function sum(o) { return Object.keys(o || {}).reduce(function (s, k) { return s + o[k]; }, 0); }

var required = ['family', 'structurality', 'structural', 'stage', 'label', 'group'];
assert(Object.keys(KJ.LEAK_TAXONOMY).every(function (code) {
  return required.every(function (key) { return KJ.LEAK_TAXONOMY[code][key] !== undefined; });
}), '모든 실패코드가 원인계열·구조성·단계 메타를 보유');
assert(!KJ.leakTaxonomy('not_detected').structural && KJ.leakTaxonomy('no_sensor').structural,
  '센서 보유 후 확률적 미탐지와 센서 배치 공백을 분리');
assert(!KJ.leakTaxonomy('capacity_full').structural &&
  KJ.classifyFailure('capacity_full', { persistentAcrossSeeds: true }).structural,
  '조건부 용량실패는 paired-seed 지속성 증거가 있을 때만 구조로 승격');

var cfg = {
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1, seed: 12345,
  endTimeSec: 1800, deploymentId: 'HANBANDO_FULL_NORMAL',
  features: { highResolutionDeployment: true }
};
var result = KJ.runDES(cfg), fs = result.global.failureSummary;
assert(fs && sum(fs.primary) === result.global.leaked && sum(fs.byStructurality) === result.global.leaked,
  '고해상도 누출마다 상호배타적 주원인·구조성 1건 보존');
assert(!result.global.leakReasons.no_feasible_pip &&
  ((result.global.leakReasons.engagement_geometry_gap || 0) +
   (result.global.leakReasons.window_lost_due_to_c2 || 0) +
   (result.global.leakReasons.no_fire_control || 0)) > 0,
  'no_feasible_pip를 기하·C2 교전창·화력통제 원인으로 분해');
assert(result.bottlenecks.some(function (b) {
  return b.kind === 'gap' && KJ.leakTaxonomy(b.id).structural;
}), '정본 taxonomy의 구조적 주원인이 도출 병목에 포함');
var fired = result.nodes.filter(function (n) { return n.category === 'shooter' && n.shots > 0; });
assert(fired.length > 0 && fired.every(function (n) {
  return isFinite(n.rho) && n.rho >= 0 && n.peakActive > 0 && n.maxSimultaneous > 0;
}), 'native 사수 실제 발사·피크활성·이용률을 node 결과에 계측');

// 동일 센서/C2에서 SHORAD와 그 ECS만 제거해 '책임 C2 없음'과 '보고경로 없음'이 혼합되지 않음을 고정한다.
var base = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL');
var removed = {};
base.nodes.forEach(function (n) {
  if (n.category === 'shooter' && (n.typeId === 'BIHO' || n.typeId === 'CHUNMA')) removed[n.id] = true;
});
base.nodes.forEach(function (n) {
  if (n.category === 'c2' && n.typeId === 'ECS' && removed[n.batteryId]) removed[n.id] = true;
});
var nodes = base.nodes.filter(function (n) { return !removed[n.id]; }), nodeMap = {};
nodes.forEach(function (n) { nodeMap[n.id] = n; });
var diagnostic = {
  id: 'HANBANDO_FULL_NORMAL_NO_SHORAD_DIAGNOSTIC', deployment: base.deployment,
  nodes: nodes, links: base.links.filter(function (l) { return nodeMap[l.from] && nodeMap[l.to]; }),
  nodeMap: nodeMap, roles: base.roles, compatibilityMode: base.compatibilityMode, nativeCounts: base.nativeCounts
};
KJ.resolveModelCatalog = function () { return diagnostic; };
var noShorad = KJ.runDES({
  scenario: KJ.scenarioById('sc2'), mode: 'asis', intensity: 1, seed: 12345,
  endTimeSec: 1800, deploymentId: 'HANBANDO_FULL_NORMAL', features: { highResolutionDeployment: true }
});
assert((noShorad.global.leakReasons.no_responsible_c2 || 0) > 0 && !noShorad.global.leakReasons.no_report_path,
  '교전 가능 책임 C2 부재를 보고경로 단절과 별도 코드로 방출');
assert(noShorad.bottlenecks.some(function (b) { return b.id === 'no_responsible_c2'; }),
  '책임 C2 부재가 구조 병목으로 승격');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
