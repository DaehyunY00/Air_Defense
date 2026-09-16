import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const require = createRequire(path.join(root, 'tests', 'engine.test.mjs'));
globalThis.window = globalThis;
for (const f of ['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js']) require(path.join(root, 'js', f));
const { installIadsKernel } = await import(pathToFileURL(path.join(root, 'js/model/iads/index.js')));
installIadsKernel(KJ);
const proto = KJ.Simulation.prototype;
const overflow = [];
for (const kind of ['iads_track', 'directive_reception', 'approval', 'approval_return', 'directive_relay', 'directive_issue']) {
  const threat = { id: 'T1', alive: true, pipelineDead: false, leakReason: null };
  const ns = { node: { id: 'TEST_C2', category: 'c2' }, busy: 1, c: 1, K: 1, queue: [], byKind: {}, arrivals: 0, drops: 0, maxInSystem: 1 };
  const sim = Object.assign(Object.create(proto), { nodeState: { TEST_C2: ns }, nativeIads: true,
    _advance() {}, _sample() {}, _metricEvent() {}, _c2JobMetricDetail() { return {}; } });
  const disposition = sim._nodeArrive('TEST_C2', 10, { kind, threat }, () => {});
  overflow.push({ kind, disposition, pipelineDead: threat.pipelineDead, leakReason: threat.leakReason });
}
console.log('FORCED_OVERFLOW', JSON.stringify(overflow));
function statusSim() {
  return Object.assign(Object.create(proto), { iadsStatusChannels: { ch: { busy: 1, queue: [], freshnessSec: 300 } },
    global: { statusSharing: { delivered: 0, stale: 0 } }, _mark() {} });
}
const status = statusSim(), statusThreat = { id: 'STATUS1', alive: true };
status._onIadsStatusArrive(500, { channelKey: 'ch', message: { threat: statusThreat, from: 'AOC', to: 'MCRC', phase: 'assigned', createdAt: 0 } });
console.log('STALE_STATUS', JSON.stringify({ countedStale: status.global.statusSharing.stale, stored: statusThreat._engagementStatusBySender.AOC,
  actionableAt500: !!status._iadsSharedLocalEngagement(statusThreat, { axis: 'MCRC' }, 500),
  actionableAt799: !!status._iadsSharedLocalEngagement(statusThreat, { axis: 'MCRC' }, 799),
  actionableAt801: !!status._iadsSharedLocalEngagement(statusThreat, { axis: 'MCRC' }, 801) }));
const oo = statusSim(), ooThreat = { id: 'STATUS2', alive: true };
for (const [t, phase, createdAt] of [[500, 'released', 490], [501, 'assigned', 400]])
  oo._onIadsStatusArrive(t, { channelKey: 'ch', message: { threat: ooThreat, from: 'AOC', to: 'MCRC', phase, createdAt } });
console.log('OUT_OF_ORDER_STATUS', JSON.stringify({ stored: ooThreat._engagementStatusBySender.AOC,
  actionableAt501: !!oo._iadsSharedLocalEngagement(ooThreat, { axis: 'MCRC' }, 501) }));
const source = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
const start = source.indexOf('const PARAMS = [');
const params = new Function(source.slice(start, source.indexOf('\n];', start) + 3) + '\nreturn PARAMS;')();
const P = Object.fromEntries(params.map(p => [p.k, p.d]));
const featureText = source.slice(source.indexOf('function features() {'), source.indexOf('\n}\n', source.indexOf('function features() {')) + 3);
const features = new Function('P', featureText + '\nreturn features();')(P);
console.log('DEFAULT_FEATURES', JSON.stringify(features));
for (const mode of ['asis', 'tobe']) {
  const sim = new KJ.Simulation({ scenario: KJ.scenarioById(P.sc), mode, intensity: 1, seed: P.seed, endTimeSec: P.dur,
    deploymentId: P.dep, modelFidelity: 'iads-c2', trace: true, traceCap: 300, flowTrace: true, features });
  const arrivals = [], stale = [], outOfOrder = [];
  const original = sim._nodeArrive;
  sim._nodeArrive = function (id, t, job, done) {
    const before = job.threat.pipelineDead;
    const disp = original.call(this, id, t, job, done);
    if (disp === 'dropped') arrivals.push({ id, t, kind: job.kind, threat: job.threat.id, newlyPipelineDead: !before && !!job.threat.pipelineDead });
    return disp;
  };
  const statusOriginal = sim._onIadsStatusArrive;
  sim._onIadsStatusArrive = function (t, d) {
    const ch = this.iadsStatusChannels[d.channelKey], msg = d.message;
    const prev = msg.threat._engagementStatusBySender?.[msg.from];
    if (ch && t - msg.createdAt > ch.freshnessSec) stale.push({ t, from: msg.from, phase: msg.phase, age: t - msg.createdAt, ttl: ch.freshnessSec });
    if (prev && prev.createdAt > msg.createdAt) outOfOrder.push({ t, from: msg.from, oldPhase: prev.phase, newPhase: msg.phase, oldCreatedAt: prev.createdAt, newCreatedAt: msg.createdAt });
    return statusOriginal.call(this, t, d);
  };
  const result = sim.run();
  console.log('DEFAULT_RUN', JSON.stringify({ mode, seed: P.seed, duration: P.dur, deployment: P.dep,
    killed: result.global.killed, leaked: result.global.leaked, spawned: result.global.spawned,
    overflow: arrivals, statusSharing: result.global.coordination.statusSharing, stale, outOfOrder }));
}
