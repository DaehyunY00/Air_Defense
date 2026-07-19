/** Focused regression for the Phase 1 high-resolution C2 compatibility graph. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

['HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL'].forEach(function (id) {
  var catalog = KJ.buildDeploymentCatalog(id);
  var roots = [catalog.roles.KAMDOC, catalog.roles.MCRC].filter(Boolean);
  var iccs = catalog.nodes.filter(function (n) { return n.typeId === 'ICC'; });
  assert(iccs.every(function (icc) {
    return roots.every(function (rootId) {
      return catalog.links.some(function (l) {
        return l.from === icc.id && l.to === rootId && l.kind === 'coord' && l.comm.asis;
      });
    });
  }), id + ' ICC→KAMDOC/MCRC As-Is 상향 승인 경로');
});

var cfg = {
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5,
  seed: 42, endTimeSec: 1800, deploymentId: 'HANBANDO_MINI_NORMAL',
  features: { highResolutionDeployment: true }
};
var result = KJ.runDES(cfg);
assert(result.global.everEngaged > 0 && result.global.shotsFired > 0,
  'MINI_NORMAL As-Is 주 교전 경로가 실제 발사를 생성');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
