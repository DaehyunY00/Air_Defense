// Current C2 observation report. All joins are threat + canonical node/job/directive IDs.
// No text token is promoted to a node, and no candidate/role edge is treated as communication.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../../../scripts/experiment-lib.mjs';
import { HERE, BASE, DEPLOYMENTS, config, metadata, stats } from './report-common.mjs';

export const SEGMENTS = ['report', 'process', 'coord', 'wait', 'deliver'];
const EPS = 1e-7;
const byTime = (a, b) => a.t - b.t;
const same = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < EPS;
const group = (xs, key) => { const out = new Map(); for (const x of xs) { const k = key(x); if (!out.has(k)) out.set(k, []); out.get(k).push(x); } return out; };
const branchNode = s => typeof s.axis === 'string' ? s.axis.split('|')[1] : null;

export function communication(events, nodeMap, endTime) {
  const canonical = e => nodeMap.has(e.from) && nodeMap.has(e.to);
  const links = events.filter(e => e.k === 'link' && canonical(e));
  const failed = events.filter(e => e.k === 'cx' && canonical(e) && e.t <= endTime);
  const settled = new Set([...links.map(e => e.mid), ...failed.map(e => e.id)].filter(x => x != null));
  const queued = events.filter(e => e.k === 'cq' && canonical(e) && e.t <= endTime && !settled.has(e.id));
  const rows = links.map(e => ({ from: e.from, to: e.to, kind: e.kind, mt: e.mt,
    t0: e.t0, t1: e.t1, state: e.t1 <= endTime ? 'delivered' : e.t0 <= endTime ? 'inTransit' : 'notStarted' }));
  for (const e of failed) rows.push({ from: e.from, to: e.to, kind: 'status', t0: e.t, state: 'failed', reason: e.r });
  for (const e of queued) rows.push({ from: e.from, to: e.to, kind: 'status', t0: e.t, state: 'queued' });
  const counts = Object.fromEntries(['delivered', 'inTransit', 'notStarted', 'failed', 'queued'].map(k => [k, rows.filter(e => e.state === k).length]));
  return { ...counts, invalidEndpoints: events.filter(e => ['link', 'cq', 'cx'].includes(e.k) && !canonical(e)).length, rows };
}

// First actual launch is fixed before finding a decision. ICC replacement orders may
// inherit their upstream decision only through explicit parentDirectiveId ancestry.
export function firstLaunchTiming(trace, metrics, nodeMap, complete = true) {
  const ev = metrics.slice().sort(byTime);
  const fire = ev.find(e => e.type === 'ENGAGEMENT_FIRED');
  if (!fire) return { reason: 'no_actual_launch', dec: null, events: [] };
  const out = { fire, reason: null, dec: null, events: [] };
  if (!complete) return { ...out, reason: 'observation_truncated' };
  const detect = ev.find(e => e.type === 'SENSOR_DETECTED');
  const creates = new Map(ev.filter(e => e.type === 'DIRECTIVE_CREATED').map(e => [e.directiveId, e]));
  const decisions = new Map(ev.filter(e => e.type === 'COMMAND_DECIDED').map(e => [e.directiveId, e]));
  const lineage = [], visited = new Set(); let id = fire.directiveId, decision;
  while (id && !visited.has(id)) {
    visited.add(id); lineage.push(id); decision = decisions.get(id);
    if (decision) break;
    id = creates.get(id)?.parentDirectiveId;
  }
  out.lineage = lineage; out.decision = decision || null;
  if (!decision || !nodeMap.has(decision.nodeId)) return { ...out, reason: 'unlinked_decision' };
  if (fire.cause === 'self_defense' || decision.cause === 'self_defense') return { ...out, reason: 'self_defense_separate_path' };
  // Strictly join the track version observed by this decision; never fall back to
  // the first report from a different branch, even if it has an earlier time.
  const arrivals = ev.filter(e => e.type === 'TRACK_REPORT_RECEIVED' && e.nodeId === decision.nodeId &&
    same(e.trackReceivedAt, decision.trackReceivedAt) && e.t <= decision.t + EPS);
  if (arrivals.length !== 1 || !detect) return { ...out, reason: 'unlinked_track_report' };
  const arrival = arrivals[0], jobId = `TRACK_${trace.id}_${decision.nodeId}`;
  const done = ev.find(e => e.type === 'C2_DONE' && e.kind === 'iads_track' && e.nodeId === decision.nodeId &&
    e.jobId === jobId && same(e.trackReceivedAt, arrival.trackReceivedAt) && e.t >= arrival.t - EPS && e.t <= decision.t + EPS);
  if (!done) return { ...out, reason: 'unlinked_track_processing' };
  const branch = (trace.stages || []).filter(s => branchNode(s) === decision.nodeId).sort(byTime);
  const requests = branch.filter(s => /^(협조개시:|감독승인개시:)/.test(s.name) && s.t >= done.t - EPS && s.t <= decision.t + EPS);
  const endPattern = BASE.approvalPipelineRealism ? /^승인회신처리완료:/ : /^승인완료:/;
  const intervals = [];
  for (const request of requests) {
    const end = branch.find(s => endPattern.test(s.name) && s.t >= request.t - EPS && s.t <= decision.t + EPS);
    if (!end) return { ...out, reason: 'unlinked_approval_completion' };
    intervals.push([request.t, end.t]);
  }
  // Union prevents double counting if approval observations overlap.
  const merged = []; for (const [start, end] of intervals) {
    const prev = merged.at(-1); if (prev && start <= prev[1]) prev[1] = Math.max(prev[1], end); else merged.push([start, end]);
  }
  const coord = merged.reduce((s, [a, b]) => s + b - a, 0);
  const dec = { report: arrival.t - detect.t, process: done.t - arrival.t, coord,
    wait: decision.t - done.t - coord, deliver: fire.t - decision.t, total: fire.t - detect.t };
  if (Object.values(dec).some(v => !Number.isFinite(v) || v < -EPS)) return { ...out, reason: 'nonmonotonic_lineage' };
  assert.ok(Math.abs(SEGMENTS.reduce((s, k) => s + dec[k], 0) - dec.total) < EPS);
  out.dec = dec; out.branch = decision.nodeId;
  out.events = [{ t: detect.t, label: '최초 탐지', node: null },
    { t: arrival.t, label: '해당 지휘부 항적 접수', node: decision.nodeId },
    { t: done.t, label: '해당 항적 처리 완료', node: decision.nodeId },
    ...merged.flatMap(([a, b]) => [{ t: a, label: '같은 분기 협조 시작', node: decision.nodeId }, { t: b, label: '협조·회신 처리 완료', node: decision.nodeId }]),
    { t: decision.t, label: '연결된 지휘 결심', node: decision.nodeId, directiveId: decision.directiveId },
    ...ev.filter(e => e.type === 'C2_DONE' && ['directive_relay', 'directive_reception'].includes(e.kind) && lineage.includes(e.jobId) && e.t <= fire.t)
      .map(e => ({ t: e.t, label: e.kind === 'directive_relay' ? '명령 중계 처리 완료' : 'ECS 접수 처리 완료', node: e.nodeId })),
    { t: fire.t, label: '실제 발사', node: fire.shooterId, directiveId: fire.directiveId }];
  const bda = ev.find(e => /^INTERCEPT_(HIT|MISS)$/.test(e.type) && e.directiveId === fire.directiveId && e.engagementId === fire.engagementId && e.t >= fire.t);
  if (bda) out.events.push({ t: bda.t, label: bda.type === 'INTERCEPT_HIT' ? '해당 발사 HIT' : '해당 발사 MISS', node: bda.shooterId });
  out.events.sort(byTime); return out;
}

export function analyzeTrace(trace, flow, metrics, nodeMap, endTime, complete = true) {
  const comm = communication(flow, nodeMap, endTime), nodes = new Set();
  const add = id => { if (nodeMap.has(id)) nodes.add(id); };
  for (const e of flow) if (['na', 'ns', 'nd', 'nx'].includes(e.k) && e.t <= endTime) add(e.at);
  for (const e of metrics) {
    if (/^C2_(ARRIVED|PROCESSING|DONE|DROPPED)$/.test(e.type) || e.type === 'TRACK_REPORT_RECEIVED' || e.type === 'COMMAND_DECIDED') add(e.nodeId);
    if (e.type === 'ENGAGEMENT_FIRED') add(e.shooterId);
  }
  for (const e of comm.rows) { if (e.state !== 'notStarted') add(e.from); if (e.state === 'delivered') add(e.to); }
  for (const s of trace.stages || []) if (/^SENSOR_(DETECTED|TRACKED|FIRE_CONTROL):/.test(s.name)) add(s.name.slice(s.name.indexOf(':') + 1));
  const nonSensor = [...nodes].filter(id => nodeMap.get(id).category !== 'sensor');
  const byEch = { c2: 0, relay: 0, exec: 0, battery: 0 };
  for (const id of nonSensor) { const n = nodeMap.get(id); byEch[n.typeId === 'ICC' ? 'relay' : n.typeId === 'ECS' ? 'exec' : n.category === 'shooter' || id.startsWith('BATTERY_') ? 'battery' : 'c2']++; }
  const stages = trace.stages || [], timing = firstLaunchTiming(trace, metrics, nodeMap, complete);
  const count = re => stages.filter(s => re.test(s.name)).length;
  return { id: trace.id, type: trace.type, outcome: trace.outcome, spawnT: trace.spawnT, exitT: trace.exitT,
    nodes: nonSensor.sort(), sensorNodes: [...nodes].filter(id => nodeMap.get(id).category === 'sensor').sort(), byEch, nodeCount: nonSensor.length,
    responsibleNodes: [...new Set((trace.commanders || []).map(c => c.id).filter(id => nodeMap.has(id)))],
    observedBranches: [...new Set(metrics.filter(e => e.type === 'TRACK_REPORT_RECEIVED').map(e => e.nodeId).filter(id => nodeMap.has(id)))],
    launches: metrics.filter(e => e.type === 'ENGAGEMENT_FIRED').length, decisions: metrics.filter(e => e.type === 'COMMAND_DECIDED').length,
    hits: metrics.filter(e => e.type === 'INTERCEPT_HIT').length, misses: metrics.filter(e => e.type === 'INTERCEPT_MISS').length,
    reassign: count(/^교전명령재배정:/), bounce: count(/^교전명령반송:/), noFire: count(/^발사불가:/), dedup: count(/^교전중복해소:/),
    evidenceCodes: Object.keys(trace.evidence || {}), comm, timing };
}

export function summarize(threats) {
  const timed = threats.filter(t => t.timing.dec), launched = threats.filter(t => t.launches);
  return { threats: threats.length, launched: launched.length, timed: timed.length,
    timingMissing: Object.fromEntries([...group(launched.filter(t => !t.timing.dec), t => t.timing.reason)].map(([k, v]) => [k, v.length])),
    total: stats(timed.map(t => t.timing.dec.total)), segments: Object.fromEntries(SEGMENTS.map(k => [k, stats(timed.map(t => t.timing.dec[k]))])),
    nodes: stats(threats.map(t => t.nodeCount)), launchedNodes: stats(launched.map(t => t.nodeCount)) };
}

function selfTest() {
  const nodeMap = new Map(['A', 'B', 'ICC', 'BAT'].map(id => [id, { id, category: id === 'BAT' ? 'shooter' : 'c2' }]));
  const trace = { id: 'T', stages: [{ name: '협조개시:B→A', t: 3, axis: 'LOCAL_AD|B' }, { name: '승인회신처리완료:B', t: 90, axis: 'LOCAL_AD|B' }, { name: 'BDA:HIT:FAKE', t: 25 }], evidence: { no_fire_control: { detail: { shooterId: 'FAKE' } } } };
  const metrics = [ { type: 'SENSOR_DETECTED', t: 0 },
    { type: 'TRACK_REPORT_RECEIVED', t: 1, nodeId: 'B', trackReceivedAt: 1 },
    { type: 'COMMAND_DECIDED', t: 2, nodeId: 'B', directiveId: 'WRONG', trackReceivedAt: 1 },
    { type: 'TRACK_REPORT_RECEIVED', t: 5, nodeId: 'A', trackReceivedAt: 5 },
    { type: 'C2_DONE', t: 10, nodeId: 'A', kind: 'iads_track', jobId: 'TRACK_T_A', trackReceivedAt: 5 },
    { type: 'COMMAND_DECIDED', t: 15, nodeId: 'A', directiveId: 'ROOT', trackReceivedAt: 5 },
    { type: 'DIRECTIVE_CREATED', t: 17, directiveId: 'CHILD', parentDirectiveId: 'ROOT' },
    { type: 'ENGAGEMENT_FIRED', t: 20, directiveId: 'CHILD', engagementId: 'E', shooterId: 'BAT' },
    { type: 'INTERCEPT_HIT', t: 21, directiveId: 'WRONG', engagementId: 'W', shooterId: 'BAT' },
    { type: 'INTERCEPT_MISS', t: 25, directiveId: 'CHILD', engagementId: 'E', shooterId: 'BAT' } ];
  const a = firstLaunchTiming(trace, metrics, nodeMap);
  assert.deepEqual(a.dec, { report: 5, process: 5, coord: 0, wait: 5, deliver: 5, total: 20 });
  assert.deepEqual(a.lineage, ['CHILD', 'ROOT']); assert.equal(a.events.at(-1).label, '해당 발사 MISS');
  assert.equal(firstLaunchTiming(trace, metrics.filter(e => e.nodeId !== 'A'), nodeMap).reason, 'unlinked_decision');
  assert.equal(firstLaunchTiming(trace, metrics.filter(e => !(e.type === 'TRACK_REPORT_RECEIVED' && e.nodeId === 'A')), nodeMap).reason, 'unlinked_track_report');
  const withApproval = { ...trace, stages: [...trace.stages,
    { name: '협조개시:A→B', t: 11, axis: 'LOCAL_AD|A' },
    { name: '승인회신처리완료:A', t: 13, axis: 'LOCAL_AD|A' }] };
  assert.deepEqual(firstLaunchTiming(withApproval, metrics, nodeMap).dec, { report: 5, process: 5, coord: 2, wait: 3, deliver: 5, total: 20 });
  assert.equal(firstLaunchTiming({ ...withApproval, stages: withApproval.stages.filter(s => s.t !== 13) }, metrics, nodeMap).reason, 'unlinked_approval_completion');
  assert.equal(firstLaunchTiming(trace, metrics, nodeMap, false).reason, 'observation_truncated');
  const flow = [{ k: 'link', from: 'A', to: 'B', t0: 0, t1: 10, mid: 1 }, { k: 'cq', from: 'A', to: 'B', t: 0, id: 1 },
    { k: 'link', from: 'A', to: 'B', t0: 15, t1: 30 }, { k: 'link', from: 'A', to: 'B', t0: 25, t1: 30 },
    { k: 'cq', from: 'A', to: 'B', t: 1, id: 2 }, { k: 'cx', from: 'A', to: 'B', t: 1, id: 3 },
    { k: 'link', from: 'A', to: 'FAKE', t0: 0, t1: 2 }];
  const c = communication(flow, nodeMap, 20);
  for (const k of ['delivered', 'inTransit', 'notStarted', 'queued', 'failed', 'invalidEndpoints']) assert.equal(c[k], 1);
  trace.commanders = [{ id: 'ICC' }]; trace.evidence.no_fire_control.detail.shooterId = 'ICC';
  const parsed = analyzeTrace(trace, [], metrics, nodeMap, 30); assert.ok(!parsed.nodes.includes('FAKE')); assert.ok(!parsed.nodes.includes('HIT'));
  assert.ok(!parsed.nodes.includes('ICC')); assert.deepEqual(parsed.responsibleNodes, ['ICC']);
  console.log('C2 parser contracts: PASS (same branch, child directive, same BDA, cap coverage, communication states, canonical nodes)');
}

async function main() {
  if (process.argv.includes('--self-test')) { selfTest(); return; }
  const KJ = loadEngine(), out = { meta: { ...metadata(), sc: 'sc3', seed: 29, dur: 600,
    observation: { traceCap: 5000, flowTraceCap: 500000, c2EventCap: 500000 },
    definitions: { timing: 'first actual ENGAGEMENT_FIRED -> directive ancestry -> COMMAND_DECIDED -> same node/trackReceivedAt/jobId; same branch approval interval union',
      nodes: 'canonical catalog IDs with actual node events, sent source, arrived destination, or actual launch; excludes candidate/evidence/role-only nodes',
      delivered: 'recorded link with t1 <= observation end; transport arrival, not proof that application accepted it',
      wait: 'residual time from track processing to linked decision after same-branch approval intervals; no physical/procedural causal attribution',
      caps: 'timing disabled if any trace/flow/C2 channel truncates; population outcomes remain global' } }, runs: {} };
  for (const dep of DEPLOYMENTS) for (const mode of ['asis', 'tobe']) {
    const cfg = config(KJ, { dep, mode, sc: 'sc3', seed: 29, dur: 600, trace: true, traceCap: 5000,
      flowTrace: true, flowTraceCap: 500000, c2Analysis: true, c2EventCap: 500000 });
    const r = KJ.runDES(cfg), catalog = KJ.resolveModelCatalog(cfg), nodeMap = new Map(catalog.nodes.map(n => [n.id, n]));
    const flows = group(r.flowEvents, e => e.th), metrics = group(r.c2Events, e => e.threatId);
    const complete = !r.traceTruncated && !r.flowTruncated && !r.c2EventsTruncated;
    const threats = r.threatTraces.map(t => analyzeTrace(t, flows.get(t.id) || [], metrics.get(t.id) || [], nodeMap, 600, complete));
    const comm = communication(r.flowEvents, nodeMap, 600); delete comm.rows;
    const run = { dep, mode, config: r.config, global: { spawned: r.global.spawned, killed: r.global.killed, leaked: r.global.leaked,
      censoredRaw: r.global.censoredRaw, shotsFired: r.global.shotsFired, everEngaged: r.global.everEngaged },
      coverage: { traces: r.threatTraces.length, flowEvents: r.flowEvents.length, c2Events: r.c2Events.length,
        traceTruncated: !!r.traceTruncated, flowTruncated: !!r.flowTruncated, c2EventsTruncated: !!r.c2EventsTruncated },
      nodeCatalog: Object.fromEntries(catalog.nodes.map(n => [n.id, { name: n.name, typeId: n.typeId, category: n.category }])), comm,
      summary: summarize(threats), byType: Object.fromEntries([...group(threats, t => t.type)].map(([k, v]) => [k, summarize(v)])), threats };
    assert.equal(run.global.spawned, run.global.killed + run.global.leaked + run.global.censoredRaw);
    if (complete) assert.equal(run.coverage.traces, run.global.spawned);
    out.runs[`${dep}|${mode}`] = run;
    console.log(dep, mode, JSON.stringify({ global: run.global, timed: run.summary.timed, launched: run.summary.launched,
      missing: run.summary.timingMissing, mean: run.summary.total.mean, median: run.summary.total.median, comm, coverage: run.coverage }));
  }
  fs.writeFileSync(path.join(HERE, 'c2-analysis-out.json'), JSON.stringify(out, null, 2) + '\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
