import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import { installIadsKernel } from '../../../js/model/iads/index.js';
globalThis.window = globalThis; const require = createRequire(import.meta.url);
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach(f=>require(path.join(path.dirname(fileURLToPath(import.meta.url)),'../../../js',f)));
const KJ=globalThis.KJ; installIadsKernel(KJ);
const F = { highResolutionDeployment:true, threatTargetDispersion:true, southernAxes:true, linkSemanticsV2:true, sensorReportParity:true, sawtoothFreshness:true, approvalChain:true, unifiedEngagementState:true, selfDefenseFire:true, ballisticLaunchAxes:true, threatAimpoints:true, c2DecisionTimeParity:true, approvalPipelineRealism:true, iccRelayAuthorization:true, ballisticReportSource:true, standbyCue:true, rokUsfkCoordination:{asis:'voice',tobe:'datalink'}, commanderRouteRetry:true, shoradCruiseExclusion:true, shoradPkRealism:true, earlyShooterAssignment:true, assignmentFeedback:true, batteryStatusReporting:true, statusReportPeriodSec:4 };
const DEP=process.argv[2], SEEDS=process.argv[3].split(',').map(Number);
const TYPES=['srbm','mrl_large','cruise','fighter','uav_small']; const mean=(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const out={};
for (const seed of SEEDS) for (const mode of ['asis','tobe']) {
  const r=KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity:1, seed, endTimeSec:3600, spawnUntilSec:1800, deploymentId:DEP, modelFidelity:'iads-c2', trace:true, traceCap:1000, flowTrace:true, flowTraceCap:400000, features:F });
  const g=r.global; const byType={}; TYPES.forEach(t=>byType[t]={n:0,k:0,fired:0,emer:0,dec:[],total:[],shooters:{}});
  r.threatTraces.forEach(tr=>{ const B=byType[tr.type]; if(!B) return; B.n++; if(tr.outcome==='killed') B.k++; const st=tr.stages; const f=(re)=>st.find(s=>re.test(s.name));
    const det=f(/^탐지$/), c2=f(/^항적정보접수:/), dec=f(/^(사수선정·표적할당|긴급발사|자위권발사):/), hit=st.find(s=>/^BDA:HIT/.test(s.name));
    if(f(/^발사:/)) B.fired++; if(f(/^긴급발사:/)) B.emer++; if(c2&&dec) B.dec.push(dec.t-c2.t); if(det&&hit) B.total.push(hit.t-det.t);
    st.forEach(s=>{ const m=/^(발사|자위권발사):([^/]+)/.exec(s.name); if(m){ const k=m[2].replace('BATTERY_',''); B.shooters[k]=(B.shooters[k]||0)+1; } }); });
  const shots={}; Object.values(byType).forEach(B=>Object.entries(B.shooters).forEach(([k,v])=>shots[k]=(shots[k]||0)+v));
  const sv=Object.values(shots).sort((a,b)=>b-a), tot=sv.reduce((a,b)=>a+b,0); const nBat=r.nodes.filter(n=>n.category==='shooter').length;
  const cnt={}; r.flowEvents.filter(e=>e.k==='link').forEach(e=>{ cnt[e.from]=(cnt[e.from]||0)+1; cnt[e.to]=(cnt[e.to]||0)+1; });
  const lad=r.nodes.filter(n=>/ARMY_LOCAL_AD/.test(n.id)).map(n=>({name:n.name,msgs:cnt[n.id]||0,arrivals:n.arrivals||0,rho:+(n.rho||0).toFixed(3)}));
  const c2top=r.nodes.filter(n=>n.category==='c2'&&!/^ECS_/.test(n.id)).sort((a,b)=>(b.rho||0)-(a.rho||0)).slice(0,6).map(n=>({name:n.name,rho:+(n.rho||0).toFixed(3),arrivals:n.arrivals,Wq:+(n.Wq||0).toFixed(1)}));
  const idle=r.nodes.filter(n=>!cnt[n.id]).length;
  out[mode+'#'+seed]={ g:{spawned:g.spawned,killed:g.killed,leaked:g.leaked,shots:g.shotsFired,mttk:+g.meanTimeToKillSec.toFixed(1),mtte:+g.meanTimeToEngageSec.toFixed(1),leakReasons:g.leakReasons,cantco:g.earlyAssignment&&g.earlyAssignment.cantco,dup:g.coalition&&g.coalition.duplicates},
    byType:Object.fromEntries(TYPES.map(t=>{const B=byType[t]; return [t,{n:B.n,k:B.k,fired:B.fired,emer:B.emer,dec:B.dec.length?+mean(B.dec).toFixed(0):null,total:B.total.length?+mean(B.total).toFixed(0):null,shooters:Object.entries(B.shooters).sort((a,b)=>b[1]-a[1]).slice(0,4)}];})),
    shots:{total:tot,batteries:nBat,firing:sv.length,zero:nBat-sv.length,top3Share:tot?+(sv.slice(0,3).reduce((a,b)=>a+b,0)/tot).toFixed(3):0,top:Object.entries(shots).sort((a,b)=>b[1]-a[1]).slice(0,8)},
    nodes:r.nodes.length, idle, lad, c2top };
  console.error(DEP,mode,seed,'done',g.killed,g.leaked);
}
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), `pubexp-${DEP}.json`), JSON.stringify(out,null,1));
