/** Native high-resolution IADS C2/WTA/PIP/launcher/BDA regression. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ, fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, trace) {
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode: mode, intensity: 1.5, seed: 42,
    endTimeSec: 1800, trace: !!trace, traceCap: 400, deploymentId: id,
    features: { highResolutionDeployment: true }
  });
}

var normal = run('HANBANDO_FULL_NORMAL', 'asis', true);
assert(normal.config.compatibilityMode === 'native-iads-c2-engagement-v1', '고해상도 실행은 native IADS 경로 사용');
assert(normal.global.commanderAssignments.KAMD_OPS > 0 && normal.global.commanderAssignments.MCRC > 0,
  'NORMAL As-Is: 탄도 KAMDOC·ABT MCRC 책임 C2');
assert(!normal.global.commanderAssignments.ICC && !normal.global.commanderAssignments.IAOC,
  'NORMAL As-Is: 생존 최상위 C2를 ICC/IAOC로 대체하지 않음');

var mcrcDown = run('HANBANDO_FULL_MCRC_DOWN', 'asis');
assert(mcrcDown.global.commanderAssignments.KAMD_OPS > 0 && mcrcDown.global.commanderAssignments.ICC > 0 &&
  !mcrcDown.global.commanderAssignments.MCRC, 'MCRC DOWN: ABT 책임자가 권역 ICC로 전환');
var kamdocDown = run('HANBANDO_FULL_KAMDOC_DOWN', 'asis');
assert(kamdocDown.global.commanderAssignments.MCRC > 0 && kamdocDown.global.commanderAssignments.ICC > 0 &&
  !kamdocDown.global.commanderAssignments.KAMD_OPS, 'KAMDOC DOWN: 탄도 책임자가 권역 ICC로 전환');
var tobe = run('HANBANDO_FULL_NORMAL', 'tobe');
assert(tobe.global.commanderAssignments.IAOC > 0 && !tobe.global.commanderAssignments.KAMD_OPS &&
  !tobe.global.commanderAssignments.MCRC, 'To-Be 한국군 책임 C2는 IAOC');

assert(normal.global.everEngaged > 0 && normal.global.shotsFired >= normal.global.everEngaged,
  'PIP·FC·지휘범위 통과 위협만 실제 발사');
assert(normal.threatTraces.some(function (tr) {
  return tr.stages.some(function (s) { return s.name.indexOf('PIP') !== -1; });
}), 'trace에 실제 사수·발사대·PIP 기록');
assert(normal.global.coordination.duplicates === normal.global.coordination.realDuplicates,
  '중복교전은 ghost 비용이 아니라 실제 BDA 가능한 발사');

var sim = new KJ.Simulation({
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 42,
  endTimeSec: 600, deploymentId: 'HANBANDO_FULL_NORMAL', features: { highResolutionDeployment: true }
});
var resourceResult = sim.run();
var firedResources = Object.keys(sim.iadsResources).filter(function (id) { return sim.iadsResources[id].shots > 0; });
assert(firedResources.length > 0 && firedResources.every(function (id) {
  var r = sim.iadsResources[id];
  return r.launchers.length > 0 && r.launchers.every(function (l) {
    return l.remaining >= 0 && l.remaining <= l.capacity && (l.reloadCompleteAt === null || l.reloadCompleteAt > 0);
  });
}), '포대별 발사대 탄약·개별 900초 재장전 상태 보존');
assert(resourceResult.nodes.filter(function (n) { return n.category === 'shooter' && n.ammo !== null; }).every(function (n) {
  return n.ammo >= 0 && n.ammoRatio >= 0 && n.ammoRatio <= 1;
}), '결과 wire에 발사대 합산 잔탄 범위 노출');

var normal2 = run('HANBANDO_FULL_NORMAL', 'asis', true);
assert(JSON.stringify(normal.global) === JSON.stringify(normal2.global) &&
  JSON.stringify(normal.threatTraces) === JSON.stringify(normal2.threatTraces), '동일 seed native IADS 결정론');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
