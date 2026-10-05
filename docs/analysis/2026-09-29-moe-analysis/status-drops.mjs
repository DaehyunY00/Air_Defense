import path from 'node:path'; import { createRequire } from 'node:module';
const ROOT = path.join('/home/user/Air_Defense','js');
const { installIadsKernel } = await import(path.join(ROOT, 'model/iads/index.js'));
globalThis.window = globalThis; const require = createRequire(import.meta.url);
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(ROOT, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment:true, threatTargetDispersion:true, southernAxes:true, linkSemanticsV2:true, sensorReportParity:true, sawtoothFreshness:true, approvalChain:true, unifiedEngagementState:true, selfDefenseFire:true, ballisticLaunchAxes:true, airLaunchAxes:true, threatAimpoints:true, c2DecisionTimeParity:true, approvalPipelineRealism:true, iccRelayAuthorization:true, ballisticReportSource:true, standbyCue:true, rokUsfkCoordination:{asis:'voice',tobe:'datalink'}, commanderRouteRetry:true, shoradCruiseExclusion:true, shoradPkRealism:true, earlyShooterAssignment:true, assignmentFeedback:true, batteryStatusReporting:true, statusReportPeriodSec:4, standbyCueAuthority:'prepare' };
const r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode:'asis', intensity:1, seed:29, endTimeSec:3600, spawnUntilSec:1800, deploymentId:'HANBANDO_FULL_NORMAL', modelFidelity:'iads-c2', trace:true, traceCap:1000, features:BASE });
const byType={}, byPhase={}, perThreat=[];
for (const tr of r.threatTraces) {
  const st=tr.stages; const drops=st.filter(s=>/^교전현황드롭:/.test(s.name));
  if(!drops.length) continue;
  byType[tr.type]=(byType[tr.type]||0)+drops.length;
  drops.forEach(s=>{const ph=s.name.split('/').pop(); byPhase[ph]=(byPhase[ph]||0)+1;});
  const mcrcPlan=st.filter(s=>/^사수선정·표적할당:MCRC/.test(s.name)).length;
  const localPlan=st.filter(s=>/^사수선정·표적할당:ARMY_LOCAL_AD/.test(s.name)).length;
  const fires=st.filter(s=>/^발사:/.test(s.name)).map(s=>s.name.replace(/^발사:/,'').split('/')[0].replace('BATTERY_',''));
  const dup=st.some(s=>/중복/.test(s.name));
  const firstDrop=drops[0].t-tr.spawnT, firstFire=st.find(s=>/^발사:/.test(s.name)); 
  perThreat.push({id:tr.id,type:tr.type,outcome:tr.outcome,leak:tr.leakReason||'',drops:drops.length,phases:drops.map(s=>s.name.split('/').pop()[0]).join(''),mcrcPlan,localPlan,fires:fires.join('+'),dup});
}
console.log('by type',JSON.stringify(byType)); console.log('by phase',JSON.stringify(byPhase));
console.log('threats with drops',perThreat.length,'of',r.threatTraces.length);
const agg={}; perThreat.forEach(p=>{const k=p.type+'|'+p.outcome+'|mcrcPlan='+(p.mcrcPlan>0)+'|dup='+p.dup; agg[k]=(agg[k]||{n:0,drops:0}); agg[k].n++; agg[k].drops+=p.drops;});
Object.entries(agg).sort((a,b)=>b[1].drops-a[1].drops).forEach(([k,v])=>console.log(k.padEnd(50),'threats',v.n,'drops',v.drops));
console.log('--- leaked threats with drops'); perThreat.filter(p=>p.outcome!=='killed').forEach(p=>console.log(JSON.stringify(p)));
console.log('--- dup threats with drops'); perThreat.filter(p=>p.dup).forEach(p=>console.log(JSON.stringify(p)));
console.log('--- MCRC plan targets on uav threats with drops');
const tgt={}; for (const tr of r.threatTraces) { if(tr.type!=='uav_small') continue; tr.stages.filter(s=>/^사수선정·표적할당:MCRC/.test(s.name)).forEach(s=>{const k=s.name.split('→')[1].split('/')[0].replace('BATTERY_',''); tgt[k]=(tgt[k]||0)+1;}); }
console.log(JSON.stringify(tgt));
for (const id of ['uav_small#15','uav_small#43','uav_small#118']) { const tr=r.threatTraces.find(t=>t.id===id); console.log('=== '+id, tr.outcome); tr.stages.filter(s=>!/^(SENSOR_|항적정보접수|상태보고|대기지시|STATUS)/.test(s.name)).forEach(s=>console.log('  '+(s.t-tr.spawnT).toFixed(1).padStart(7), s.name.slice(0,110))); }
console.log('--- MCRC assignments on drones: fate');
let assign=0, nofc=0, lsamFire=0, lsamHit=0, decon=0, uavN=0, mcrcAny=0;
for (const tr of r.threatTraces) { if(tr.type!=='uav_small') continue; uavN++;
  const st=tr.stages; const a=st.filter(s=>/^사수선정·표적할당:MCRC/.test(s.name)).length; assign+=a; if(a) mcrcAny++;
  nofc+=st.filter(s=>/^사수불가회신:BATTERY_LSAM/.test(s.name)).length;
  lsamFire+=st.filter(s=>/^발사:BATTERY_LSAM/.test(s.name)).length;
  lsamHit+=st.filter(s=>/^BDA:HIT:BATTERY_LSAM/.test(s.name)).length;
  decon+=st.filter(s=>/^사격직전중복해소/.test(s.name)).length; }
console.log(JSON.stringify({uavN, mcrcAny, mcrcAssignments:assign, lsamNoFireControl:nofc, lsamFiredAtDrone:lsamFire, lsamHitDrone:lsamHit, deconflictedAtFire:decon}));
const dropsAfterEnd = (()=>{let n=0; for (const tr of r.threatTraces){ const st=tr.stages; const hit=st.find(s=>/^BDA:HIT/.test(s.name)); st.filter(s=>/^교전현황드롭/.test(s.name)).forEach(s=>{ if(hit && s.t>=hit.t-1e-9) n++; }); } return n;})();
console.log('drops at/after kill:', dropsAfterEnd);
