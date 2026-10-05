// 7-2 교전 규칙 민감도(ADR-116 uavLocalAdPriority) — seed 29·30·31 × OFF/ON × As-Is/To-Be. 결과: uav-local-priority.json. 실행: node docs/analysis/2026-09-29-moe-analysis/uav-local-priority.mjs
import path from 'node:path'; import { createRequire } from 'node:module'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'js');
const { installIadsKernel } = await import(path.join(ROOT, 'model/iads/index.js'));
globalThis.window = globalThis; const require = createRequire(import.meta.url);
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(ROOT, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment:true, threatTargetDispersion:true, southernAxes:true, linkSemanticsV2:true, sensorReportParity:true, sawtoothFreshness:true, approvalChain:true, unifiedEngagementState:true, selfDefenseFire:true, ballisticLaunchAxes:true, airLaunchAxes:true, threatAimpoints:true, c2DecisionTimeParity:true, approvalPipelineRealism:true, iccRelayAuthorization:true, ballisticReportSource:true, standbyCue:true, rokUsfkCoordination:{asis:'voice',tobe:'datalink'}, commanderRouteRetry:true, shoradCruiseExclusion:true, shoradCruiseExclusionAll:true, shoradPkRealism:true, earlyShooterAssignment:true, assignmentFeedback:true, batteryStatusReporting:true, statusReportPeriodSec:4, standbyCueAuthority:'prepare', tobeApprovalRealism:true };
const med=a=>{a=[...a].sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const TYPES=['srbm','mrl_large','cruise','fighter','uav_small'];
const out={};
for (const seed of [29,30,31]) for (const flag of [false,true]) for (const mode of ['asis','tobe']) {
  const r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity:1, seed, endTimeSec:3600, spawnUntilSec:1800, deploymentId:'HANBANDO_FULL_NORMAL', modelFidelity:'iads-c2', trace:true, traceCap:1000, features:Object.assign({},BASE,{uavLocalAdPriority:flag}) });
  const g=r.global; const row={ killed:g.killed, leaked:g.leaked, shots:g.shotsFired, decon:g.statusSharing&&g.statusSharing.deconflicted, statusDropped:g.statusSharing&&g.statusSharing.dropped, coalDup:g.coalition&&g.coalition.duplicates, byType:{} };
  for (const ty of TYPES) {
    const trs=r.threatTraces.filter(t=>t.type===ty); const T={n:trs.length,killed:0,leaked:0,fired:0,dec:[],fire:[],total:[],c2dec:[],lsamAsg:0,lsamCantco:0,copDecon:0,dup:0};
    for (const tr of trs) { const st=tr.stages; const f=re=>st.find(s=>re.test(s.name));
      if(tr.outcome==='killed')T.killed++; if(tr.outcome==='leaked')T.leaked++;
      const det=f(/^탐지$/), c2=f(/^항적정보접수:/), fire=f(/^발사:/), hit=st.find(s=>/^BDA:HIT/.test(s.name));
      const fires=st.filter(s=>/^발사:/.test(s.name)); if(fires.length>1) T.dup+= (new Set(fires.map(s=>s.name.slice(3).split('/')[0])).size>1)?1:0;
      T.lsamAsg+=st.filter(s=>/^사수선정·표적할당:(MCRC|IAOC)→BATTERY_LSAM/.test(s.name)).length;
      T.lsamCantco+=st.filter(s=>/^사수불가회신:BATTERY_LSAM/.test(s.name)).length;
      T.copDecon+=st.filter(s=>/^교전중복해소/.test(s.name)).length;
      if(!fire) continue; T.fired++;
      const bat=fire.name.slice(3).split('/')[0];
      const dec=st.find(s=>/^(사수선정·표적할당|긴급발사|자위권발사):/.test(s.name)&&s.name.includes('→'+bat))||f(/^(사수선정·표적할당|긴급발사|자위권발사):/);
      if(c2&&dec)T.dec.push(dec.t-c2.t); if(dec&&fire)T.fire.push(fire.t-dec.t); if(det&&hit)T.total.push(hit.t-det.t); }
    row.byType[ty]={n:T.n,killed:T.killed,leaked:T.leaked,fired:T.fired,decMed:med(T.dec),decMean:mean(T.dec),fireMed:med(T.fire),totalMed:med(T.total),lsamAsg:T.lsamAsg,lsamCantco:T.lsamCantco,copDecon:T.copDecon,dup:T.dup};
  }
  out[`seed${seed}/${flag?'ON':'OFF'}/${mode}`]=row; console.error('done',seed,flag,mode, row.killed, row.leaked);
  fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'uav-local-priority.json'), JSON.stringify(out,null,1));
}
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'uav-local-priority.json'), JSON.stringify(out,null,1));
for (const [k,v] of Object.entries(out)) { const u=v.byType.uav_small; console.log(k.padEnd(18), 'kill/leak',v.killed+'/'+v.leaked, 'shots',v.shots, '| uav kill',u.killed,'fired',u.fired,'dec med/mean',u.decMed?.toFixed(0)+'/'+u.decMean?.toFixed(0),'dec→fire',u.fireMed?.toFixed(0),'det→kill',u.totalMed?.toFixed(0),'L-SAM asg/cantco',u.lsamAsg+'/'+u.lsamCantco,'decon',u.copDecon,'dup',u.dup,'| statusDrop',v.statusDropped,'coalDup',v.coalDup); }
