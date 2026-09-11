// 지휘흐름 화면 기본값(seed 29, 600s, SC3, x1, pipe/icc/lx/aim ON) 기준의 분석 러너.
import fs from 'node:fs';
import { loadEngine } from '../../../scripts/experiment-lib.mjs';
const KJ = loadEngine();
const BASE = {
  highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true,
  linkSemanticsV2: true, sensorReportParity: true, sawtoothFreshness: true,
  approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, engageOnRemote: false,
  usfkTrackSharing: null, wtaSuitability: false, uavLocalSelfEngage: false, earlyWarningReport: false,
  ballisticLaunchAxes: true, threatAimpoints: true, c2ServiceFloor: false,
  approvalPipelineRealism: true, iccRelayAuthorization: true, ecsExecutionTime: false, directiveIssueTime: false,
  c2DecisionTimeParity: true
};
function run({ dep = 'HANBANDO_LEGACY_NORMAL', mode = 'asis', sc = 'sc3', seed = 29, dur = 600, x = 1, feat = {} }) {
  const cfg = { scenario: KJ.scenarioById(sc), mode, intensity: x, seed, endTimeSec: dur,
    deploymentId: dep, modelFidelity: 'iads-c2', features: Object.assign({}, BASE, feat) };
  const r = KJ.runDES(cfg);
  const g = r.global, co = g.coordination || {};
  const reasons = {};
  for (const [c, n] of Object.entries(g.leakReasons || {})) {
    const key = c.startsWith('overflow:') ? 'overflow' : c;
    reasons[key] = (reasons[key] || 0) + n;
  }
  const c2 = r.nodes.filter(n => n.category === 'c2').map(n => {
    const wq = Math.max(...['track', 'iads_track', 'approval'].map(k => (n.WqByKind && n.WqByKind[k]) || 0), n.Wq || 0);
    const rho = Math.max(...['track', 'iads_track', 'approval'].map(k => (n.rhoByKind && n.rhoByKind[k]) || 0), n.rho || 0);
    return { id: n.id, name: n.name, wq: +wq.toFixed(1), rho: +rho.toFixed(2), drops: n.drops || 0 };
  }).sort((a, b) => b.wq - a.wq).slice(0, 3);
  return {
    spawned: g.spawned, killed: g.killed, leaked: g.leaked, engaged: g.everEngaged, detected: g.detected,
    censored: g.censoredRaw || 0,
    dup: co.duplicates || 0, gaps: co.gaps || 0,
    shots: g.shotsFired, costM: g.cost.interceptM, dupShots: g.cost.duplicateInterceptM,
    tte: g.everEngaged ? +g.meanTimeToEngageSec.toFixed(1) : null,
    dec: g.everEngaged ? +g.meanDecisionDelaySec.toFixed(1) : null,
    reasons, top: c2, bn: r.bottlenecks.length
  };
}
const out = {};
const t0 = Date.now();
const probe = run({});
console.error('probe', JSON.stringify(probe), (Date.now() - t0) + 'ms');
if (process.argv[2] === 'probe') process.exit(0);

const DEPS = ['HANBANDO_LEGACY_NORMAL', 'HANBANDO_FULL_NORMAL'];
// A. 기준선 — 배치×구조×시나리오
out.baseline = [];
for (const dep of DEPS) for (const sc of ['sc1', 'sc2', 'sc3']) for (const mode of ['asis', 'tobe'])
  out.baseline.push({ dep, sc, mode, ...run({ dep, sc, mode }) });
console.error('A done', (Date.now() - t0) / 1000);
// B. OAT 플래그 — 배치×구조×플래그
const FLAGS = {
  appr: ['approvalChain', false], cop: ['unifiedEngagementState', false], sdf: ['selfDefenseFire', false],
  eor: ['engageOnRemote', true], share: ['usfkTrackSharing', 'datalink'], suit: ['wtaSuitability', true],
  uavsd: ['uavLocalSelfEngage', true], ew: ['earlyWarningReport', true], lx: ['ballisticLaunchAxes', false],
  aim: ['threatAimpoints', false], floor: ['c2ServiceFloor', true], pipe: ['approvalPipelineRealism', false],
  icc: ['iccRelayAuthorization', false], ecs: ['ecsExecutionTime', true], issue: ['directiveIssueTime', true],
  par: ['c2DecisionTimeParity', false]
};
out.oat = [];
for (const dep of DEPS) for (const mode of ['asis', 'tobe']) for (const [k, [f, v]] of Object.entries(FLAGS))
  out.oat.push({ dep, mode, flag: k, feature: f, value: v, ...run({ dep, mode, feat: { [f]: v } }) });
console.error('B done', (Date.now() - t0) / 1000);
// C. seed 20개 MC — 배치×구조 (SC3)
out.mc = [];
for (const dep of DEPS) for (const mode of ['asis', 'tobe']) for (let i = 0; i < 20; i++) {
  const seed = 29 + i * 7;
  out.mc.push({ dep, mode, seed, ...run({ dep, mode, seed }) });
}
console.error('C done', (Date.now() - t0) / 1000);
// D. 강도 스윕 — LEGACY SC3
out.sweep = [];
for (const dep of DEPS) for (const x of [1, 1.5, 2, 2.5, 3]) for (const mode of ['asis', 'tobe'])
  out.sweep.push({ dep, x, mode, ...run({ dep, mode, x }) });
console.error('D done', (Date.now() - t0) / 1000);
// E. 관측시간 — 정상상태 확인
out.dur = [];
for (const dur of [600, 1200, 1800]) for (const mode of ['asis', 'tobe'])
  out.dur.push({ dur, mode, ...run({ mode, dur }) });
console.error('E done', (Date.now() - t0) / 1000);
fs.writeFileSync(process.argv[2] || 'analysis-out.json', JSON.stringify(out, null, 1));
