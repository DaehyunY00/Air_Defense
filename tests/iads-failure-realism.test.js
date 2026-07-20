/** Native high-resolution IADS interception-failure realism regression. */
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
function assert(c, m) {
  console.log((c ? '  PASS ' : '  FAIL ') + m);
  if (!c) fail++;
}

assert(KJ.SHOOTER_TYPES.BIHO.missiles.AAM.pssekTable.default === 0.30,
  '비호 고해상도 과도기 PSSEK는 정본 호환 Pk 0.30');
assert(KJ.SHOOTER_TYPES.CHUNMA.missiles.AAM.pssekTable.default === 0.30,
  '천마 고해상도 과도기 PSSEK는 정본 호환 Pk 0.30');
assert(KJ.SHOOTER_TYPES.LSAM.missiles.ABM.pssekTable.default === 0.75,
  '비SHORAD 체계 Pk는 기존 개념값 보존');

var sim = new KJ.Simulation({
  scenario: KJ.scenarioById('sc2'), mode: 'asis', intensity: 1, seed: 12345,
  endTimeSec: 1800, trace: true, traceCap: 400,
  deploymentId: 'HANBANDO_FULL_NORMAL',
  features: { highResolutionDeployment: true }
});
var result = sim.run();
var g = result.global;
var fireCounts = result.threatTraces.map(function (tr) {
  return tr.stages.filter(function (s) { return s.name.indexOf('발사:') === 0; }).length;
});

assert(g.spawned === g.killed + g.leaked + g.censoredRaw,
  '생성=격추+확정 누출+관측 종료 미해결 보존');
assert(g.leaked > 0 && g.leakReasons.missed > 0,
  'FULL SC2 고해상도에서 명중 실패가 실제 누출로 관측됨');
assert(fireCounts.length > 0 && Math.max.apply(null, fireCounts) <= 2,
  '위협당 실제 발사는 shoot-look-shoot 2발 상한');
assert(result.threatTraces.some(function (tr) {
  return tr.outcome === 'leaked:missed' && tr.stages.filter(function (s) {
    return s.name.indexOf('발사:') === 0;
  }).length === 2;
}), '2회 명중 실패 후 무한 재교전 없이 누출 처리');
assert(!g.commanderAssignments.ECS && !g.commanderAssignments.ICC,
  'NORMAL local-AD 교전은 ECS/ICC 타임아웃 자율발사가 아님');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
