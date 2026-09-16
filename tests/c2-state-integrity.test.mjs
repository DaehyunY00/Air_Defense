/** C2 queue isolation, source-state ordering, and command audit provenance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of [
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
]) require(path.join(root, 'js', file));
const KJ = globalThis.KJ;
installIadsKernel(KJ);

function simulation() {
  return new KJ.Simulation({
    scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 0, seed: 29,
    endTimeSec: 600, deploymentId: 'HANBANDO_LEGACY_NORMAL', c2Analysis: true,
    flowTrace: true, features: { highResolutionDeployment: true }
  });
}
function threat(id = 'TEST') {
  return { id, type: 'uav_small', axis: 'NW', alive: true, pipelineDead: false,
    leakReason: null, spawnT: 0, dwellSec: 600, _iadsPlans: [],
    _trace: { exitT: null, stages: [] } };
}
function commander(sim) {
  return { id: sim._resolveRole('MCRC'), typeId: 'MCRC', axis: 'MCRC', scope: 'global' };
}
function holdNode(sim, id, capacity = 1) {
  const node = sim.nodeState[id];
  node.c = 1; node.K = capacity;
  // Deterministic service end exposes queue overflow/deadline handling without
  // depending on a combat outcome or a selected random sample.
  sim.rng.exponential = () => 10;
  assert.equal(sim._nodeArrive(id, 0, { kind: 'iads_track', threat: threat('HOLDER') }), 'started');
  return node;
}
function pendingEvents(sim) {
  const events = [];
  while (sim.heap.size()) events.push(sim.heap.pop());
  return events;
}

for (const kind of ['approval_return', 'directive_relay', 'directive_issue']) {
  test(`${kind}: overflow finalizes only its branch and preserves another queued branch`, () => {
    const sim = simulation(), item = threat(), cmd = commander(sim);
    const branch = Object.values(sim.nodeState).find((n) => n.node.typeId === 'ICC').node.id;
    const affected = kind === 'directive_relay' ? branch : cmd.id;
    const other = Object.values(sim.nodeState).find((n) => n.node.category === 'c2' && n.node.id !== affected).node.id;
    const full = holdNode(sim, affected);
    holdNode(sim, other, 2);
    let otherCompleted = 0;
    assert.equal(sim._nodeArrive(other, 0, { kind: 'iads_track', threat: item }, () => otherCompleted++), 'queued');
    const key = `${cmd.id}|${cmd.axis}`;
    item._iadsApproval = { [key]: 'pending' };
    const plan = sim._iadsCreatePlan(cmd, 'TEST_BATTERY', 0, item, { validUntil: 100 });
    item._iadsPlans.push(plan);
    const data = { threat: item, commander: cmd, plan, shooterId: 'TEST_BATTERY',
      iccId: branch, key, appr: branch, path: [], from: 0 };
    if (kind === 'approval_return') sim._onIadsApprovalReturn(0, data);
    else if (kind === 'directive_relay') sim._onIadsIccRelay(0, data);
    else sim._iadsIssueDirective(0, data);
    assert.equal(item.pipelineDead, false);
    assert.equal(item.leakReason, null);
    assert.equal(full.drops, 1);
    assert.equal(full.byKind[kind].drops, 1);
    assert.equal(sim.flowEvents.filter((e) => e.k === 'nx' && e.at === affected && e.r === 'over').length, 1);
    if (kind === 'approval_return') {
      assert.equal(item._iadsApproval[key], 'dropped');
      assert.equal(sim._iadsApprovalGate(item, cmd, 1), 'blocked');
      assert.ok(item._failureEvidence.approval_dropped);
    } else {
      assert.equal(sim._iadsActivePlan(plan), false);
      assert.equal(plan.state, 'expired');
      const reason = kind === 'directive_relay' ? 'relay_queue_capacity' : 'issue_queue_capacity';
      assert.equal(plan.expiryReason, reason);
      assert.equal(sim.global.c2Orders.expired, 1);
      assert.equal(sim.global.c2Orders.released, 1);
      assert.equal(sim.global.c2Orders.expiryByReason[reason], 1);
      assert.ok(item._iadsRetryAt[key] > 0);
    }
    const events = pendingEvents(sim);
    const retry = events.find((e) => e.type === 'IADS_RETRY');
    if (retry) {
      let retried = false;
      sim._iadsDecide = (th, at, owner) => {
        assert.equal(th, item); assert.equal(owner, cmd);
        assert.equal(th._iadsRetryAt[key], undefined);
        retried = true;
      };
      sim._onIadsRetry(retry.t, retry.data);
      assert.equal(retried, true);
    }
    for (const event of events.filter((e) => e.type === 'SERVICE_END')) sim._onServiceEnd(event.t, event.data);
    for (const event of pendingEvents(sim).filter((e) => e.type === 'SERVICE_END')) sim._onServiceEnd(event.t, event.data);
    assert.equal(otherCompleted, 1, 'an already queued job in the independent branch completes');
  });
}

for (const kind of ['directive_relay', 'directive_issue']) {
  test(`${kind}: queued deadline releases the plan and schedules retry once`, () => {
    const sim = simulation(), item = threat(), cmd = commander(sim);
    const iccId = Object.values(sim.nodeState).find((n) => n.node.typeId === 'ICC').node.id;
    const id = kind === 'directive_relay' ? iccId : cmd.id;
    const ns = holdNode(sim, id, 2);
    const plan = sim._iadsCreatePlan(cmd, 'TEST_BATTERY', 0, item, { validUntil: 5 });
    item._iadsPlans.push(plan);
    const data = { threat: item, commander: cmd, plan, shooterId: 'TEST_BATTERY', iccId, path: [], from: 0 };
    if (kind === 'directive_relay') sim._onIadsIccRelay(0, data);
    else sim._iadsIssueDirective(0, data);
    assert.equal(ns.queue.length, 1);
    const done = sim.heap.pop();
    sim.now = done.t;
    sim._onServiceEnd(done.t, done.data);
    const reason = kind === 'directive_relay' ? 'relay_queue_deadline' : 'issue_queue_deadline';
    assert.equal(plan.expiryReason, reason);
    assert.equal(sim._iadsActivePlan(plan), false);
    assert.equal(item.pipelineDead, false);
    assert.equal(ns.queue.length, 0);
    assert.equal(ns.busy, 0);
    assert.equal(ns.byKind[kind].drops, 1);
    assert.equal(sim.global.c2Orders.expired, 1);
    assert.equal(sim.global.c2Orders.released, 1);
    assert.equal(pendingEvents(sim).filter((e) => e.type === 'IADS_RETRY').length, 1);
  });
}

function statusContext() {
  const sim = simulation(), item = threat();
  const channel = Object.values(sim.iadsStatusChannels)[0];
  const cmd = { id: channel.link.to, axis: 'MCRC' };
  item._iadsCommandersById = { [cmd.id]: cmd };
  channel.freshnessSec = 300;
  function message(phase, createdAt, sequence) {
    return { threat: item, from: channel.link.from, to: channel.link.to, phase, createdAt, sequence };
  }
  function deliver(at, msg) {
    channel.busy++;
    sim._onIadsStatusArrive(at, { channelKey: channel.key, message: msg });
    return item._engagementStatusBySender[channel.link.from];
  }
  return { sim, item, channel, cmd, message, deliver };
}

for (const failure of ['capacity', 'deadline']) {
  test(`directive_issue: ${failure} failure broadcasts release of the prior assignment`, () => {
    const { sim, item, channel } = statusContext();
    const cmd = { id: channel.link.from, axis: 'LOCAL_AD', typeId: 'ARMY_LOCAL_AD' };
    holdNode(sim, cmd.id, failure === 'capacity' ? 1 : 2);
    const plan = sim._iadsCreatePlan(cmd, 'TEST_BATTERY', 0, item, { validUntil: 5 });
    item._iadsPlans.push(plan);
    sim._sendIadsStatus(item, cmd, 'assigned', 0);
    sim._iadsIssueDirective(0, { threat: item, commander: cmd, plan, shooterId: 'TEST_BATTERY', path: [] });
    const events = pendingEvents(sim);
    if (failure === 'deadline') {
      const done = events.find((e) => e.type === 'SERVICE_END');
      sim.now = done.t;
      sim._onServiceEnd(done.t, done.data);
      events.push(...pendingEvents(sim));
    }
    const messages = events.filter((e) => e.type === 'IADS_STATUS_ARRIVE').map((e) => e.data.message)
      .concat(channel.queue).sort((a, b) => a.sequence - b.sequence);
    assert.deepEqual(messages.map((m) => m.phase), ['assigned', 'released']);
    assert.equal(sim.global.statusSharing.sent, 2);
    assert.equal(plan.expiryReason, `issue_queue_${failure}`);
  });
}

test('status: age uses source time and receipt cannot extend the validity interval', () => {
  const { sim, item, cmd, message, deliver } = statusContext();
  const stored = deliver(200, message('assigned', 0, 1));
  assert.equal(stored.freshUntil, 300);
  assert.equal(stored.ageAtReceipt, 200);
  assert.equal(sim._iadsSharedLocalEngagement(item, cmd, 300), stored);
  assert.equal(sim._iadsSharedLocalEngagement(item, cmd, 301), null);
  deliver(500, message('assigned', 0, 2));
  assert.equal(sim.global.statusSharing.delivered, 2);
  assert.equal(sim.global.statusSharing.stale, 1);
  assert.equal(sim._iadsSharedLocalEngagement(item, cmd, 799), null);
});

test('status: first stale arrival is not adopted, does not trigger release retry, and drains transport queue', () => {
  const { sim, item, channel, message, deliver } = statusContext();
  const queued = message('assigned', 499, 2);
  channel.queue.push(queued);
  assert.equal(deliver(500, message('released', 0, 1)), undefined);
  assert.equal(item._iadsRetryAt, undefined);
  assert.equal(sim.global.statusSharing.delivered, 1);
  assert.equal(sim.global.statusSharing.stale, 1);
  assert.equal(channel.queue.length, 0);
  assert.equal(channel.busy, 1, 'next queued message begins despite rejected state');
  const events = pendingEvents(sim);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'IADS_STATUS_ARRIVE');
  assert.equal(events[0].data.message, queued);
});

test('status: old assigned state cannot overwrite newer released state', () => {
  const { sim, item, cmd, message, deliver } = statusContext();
  const latest = deliver(500, message('released', 490, 2));
  assert.equal(deliver(501, message('assigned', 400, 1)), latest);
  assert.equal(sim._iadsSharedLocalEngagement(item, cmd, 501), null);
  assert.equal(sim.global.statusSharing.delivered, 2, 'discarded state is still a delivered message');
  assert.equal(sim.global.statusSharing.stale, 0, 'fresh but out-of-order is distinct from TTL expiry');
  assert.ok(item._trace.stages.some((s) => s.name.endsWith('/out_of_order')));
});

test('status: older or duplicate release does not trigger retry after newer assigned state', () => {
  const { sim, item, message, deliver } = statusContext();
  const latest = deliver(500, message('assigned', 490, 3));
  assert.equal(deliver(501, message('released', 480, 2)), latest);
  assert.equal(deliver(502, message('released', 490, 3)), latest);
  assert.equal(item._iadsRetryAt, undefined);
  assert.equal(pendingEvents(sim).length, 0);
});

test('status: equal-time source updates remain ordered independently of tracing', () => {
  for (const tracing of [false, true]) {
    const { sim, item, channel } = statusContext();
    sim.flowTrace = tracing;
    channel.servers = 2;
    const local = { id: channel.link.from, axis: 'LOCAL_AD' };
    sim._sendIadsStatus(item, local, 'assigned', 0);
    sim._sendIadsStatus(item, local, 'released', 0);
    const messages = pendingEvents(sim).map((e) => e.data.message).sort((a, b) => a.sequence - b.sequence);
    assert.deepEqual(messages.map((m) => m.sequence), [1, 2]);
    sim._onIadsStatusArrive(5, { channelKey: channel.key, message: messages[1] });
    sim._onIadsStatusArrive(6, { channelKey: channel.key, message: messages[0] });
    assert.equal(item._engagementStatusBySender[local.id].phase, 'released');
    assert.equal(item._engagementStatusBySender[local.id].sequence, 2);
    assert.equal(sim.global.statusSharing.sent, 2);
    assert.equal(sim.global.statusSharing.delivered, 2);
    assert.equal(channel.busy, 0);
  }
});

test('status: newer same-time update is adopted when it arrives after the earlier update', () => {
  const { item, channel, message, deliver } = statusContext();
  deliver(5, message('assigned', 0, 1));
  const state = deliver(6, message('released', 0, 2));
  assert.equal(state.phase, 'released');
  assert.equal(item._engagementStatusBySender[channel.link.from].sequence, 2);
});

test('ICC reassignment records actual issuer and parent without changing controlling commander', () => {
  const sim = simulation(), item = threat(), cmd = commander(sim);
  const icc = Object.values(sim.nodeState).find((n) => n.node.typeId === 'ICC').node;
  const original = { id: 'BATTERY_ORIGINAL', category: 'shooter', iccC2Id: icc.id };
  const alternate = { id: 'BATTERY_ALTERNATE', category: 'shooter', iccC2Id: icc.id, ecsC2Id: 'ECS_TEST' };
  // Isolate provenance at the existing reassignment boundary. Selection and timing
  // rules are deliberately outside this regression's assertion contract.
  sim._nodeById = (id) => [original, alternate, icc].find((n) => n.id === id);
  sim._nodesInMode = () => [original, alternate, icc];
  sim._iadsEvaluate = (node) => node === alternate
    ? { feasible: true, ammo: 1 } : { feasible: false, reason: 'capacity_full' };
  sim._iadsWtaScore = () => 1;
  sim._iadsShortestPath = () => [];
  sim._iadsGeometryWindow = () => ({ lastFire: 100 });
  const parent = sim._iadsCreatePlan(cmd, original.id, 0, item);
  assert.equal(parent.issuedByC2Id, cmd.id);
  assert.equal(parent.parentDirectiveId, null);
  item._iadsPlans.push(parent);
  sim._iadsRelayAuthorize(10, { threat: item, commander: cmd, plan: parent,
    shooterId: original.id, iccId: icc.id, path: [], from: 0 });
  const replacement = item._iadsPlans[1];
  assert.ok(replacement);
  assert.equal(replacement.issuedByC2Id, icc.id);
  assert.equal(replacement.parentDirectiveId, parent.directiveId);
  assert.equal(replacement.commander, cmd);
  assert.equal(replacement.delegationLevel, 'ICC');
  assert.equal(sim._iadsActivePlan(parent), false);
  const created = sim.c2Events.find((e) => e.type === 'DIRECTIVE_CREATED' && e.directiveId === replacement.directiveId);
  const sent = sim.c2Events.find((e) => e.type === 'DIRECTIVE_SENT' && e.directiveId === replacement.directiveId);
  for (const event of [created, sent]) {
    assert.equal(event.issuedByC2Id, icc.id);
    assert.equal(event.parentDirectiveId, parent.directiveId);
  }
  const fire = pendingEvents(sim).find((e) => e.type === 'IADS_FIRE');
  assert.equal(fire.data.commander, cmd, 'original control path stays unchanged');
});
