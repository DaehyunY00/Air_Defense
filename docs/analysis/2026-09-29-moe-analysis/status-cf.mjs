import path from 'node:path'; import { createRequire } from 'node:module';
const ROOT = path.join('/home/user/Air_Defense','js');
const { installIadsKernel } = await import(path.join(ROOT, 'model/iads/index.js'));
globalThis.window = globalThis; const require = createRequire(import.meta.url);
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(ROOT, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment:true, threatTargetDispersion:true, southernAxes:true, linkSemanticsV2:true, sensorReportParity:true, sawtoothFreshness:true, approvalChain:true, unifiedEngagementState:true, selfDefenseFire:true, ballisticLaunchAxes:true, airLaunchAxes:true, threatAimpoints:true, c2DecisionTimeParity:true, approvalPipelineRealism:true, iccRelayAuthorization:true, ballisticReportSource:true, standbyCue:true, rokUsfkCoordination:{asis:'voice',tobe:'datalink'}, commanderRouteRetry:true, shoradCruiseExclusion:true, shoradPkRealism:true, earlyShooterAssignment:true, assignmentFeedback:true, batteryStatusReporting:true, statusReportPeriodSec:4, standbyCueAuthority:'prepare' };
const orig = KJ.Simulation.prototype._initIadsResources;
let CF = null;
KJ.Simulation.prototype._initIadsResources = function () {
  orig.call(this);
  if (!CF) return;
  Object.values(this.iadsStatusChannels).forEach(ch => {
    if (CF.nodrop) { ch.servers = 100; ch.capacity = 100000; }
    if (CF.fast) ch.comm = Object.assign({}, ch.comm, { type: 'ifcn', delaySec: 1, dist: null });
  });
};
function run(mode, seed) {
  const r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity:1, seed, endTimeSec:3600, spawnUntilSec:1800, deploymentId:'HANBANDO_FULL_NORMAL', modelFidelity:'iads-c2', features:BASE });
  const g=r.global, co=g.coordination||{}, s=co.statusSharing||{}, lr=g.leakReasons||{};
  return { killed:g.killed, leaked:g.leaked, dup:co.duplicates, real:co.realDuplicates, cop:co.copDeconflicted, dupStale:s.duplicatesDueToStaleState, decon:s.deconflicted, sent:s.sent, delivered:s.delivered, dropped:s.dropped, stale:s.stale, shots:g.shotsFired, leakTop:Object.entries(lr).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>k+':'+v).join(' ') };
}
for (const seed of [29,30,31]) {
  for (const [label,cf] of [['As-Is 기준',null],['As-Is 버림 없음(대기 무제한)',{nodrop:true}],['As-Is 버림 없음+1초',{nodrop:true,fast:true}],['To-Be 기준','tobe']]) {
    CF = cf==='tobe'?null:cf; const mode = cf==='tobe'?'tobe':'asis';
    console.log(seed, label.padEnd(26), JSON.stringify(run(mode, seed)));
  }
}
