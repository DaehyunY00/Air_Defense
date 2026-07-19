/** Phase 0 bit-exact legacy baseline lock. */
'use strict';
global.window = global;
var path = require('path');
var crypto = require('crypto');
var root = path.join(__dirname, '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js', 'analysis/bottleneck.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = global.KJ;
var fixture = require('./phase0-baseline.json');
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function hash(o) { return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex'); }
function keyFlow(r) {
  return {
    flow: r.flow,
    global: {
      spawned: r.global.spawned, detected: r.global.detected, reachedC2: r.global.reachedC2,
      everEngaged: r.global.everEngaged, killed: r.global.killed, leaked: r.global.leaked,
      censoredRaw: r.global.censoredRaw, killRate: r.global.killRate, leakRate: r.global.leakRate
    },
    eventCount: r.eventCount
  };
}

fixture.cases.forEach(function (c) {
  var base = { scenario: KJ.scenarioById(c.scenario), mode: c.mode, intensity: fixture.config.intensity,
    seed: fixture.config.seed, endTimeSec: fixture.config.endTimeSec };
  var omitted = KJ.runDES(base);
  var explicitOff = KJ.runDES(Object.assign({}, base, { features: { highResolutionDeployment: false } }));
  assert(hash(omitted) === c.sha256, c.scenario + ' ' + c.mode + ' 전체 결과 SHA-256 기준선');
  assert(JSON.stringify(omitted) === JSON.stringify(explicitOff), c.scenario + ' ' + c.mode + ' 플래그 생략=OFF bit-exact');
  assert(JSON.stringify(keyFlow(omitted)) === JSON.stringify({ flow: c.flow, global: c.global, eventCount: c.eventCount }), c.scenario + ' ' + c.mode + ' 핵심 흐름 기준선');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
