import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// 저장소 상대 경로 — docs/analysis/<날짜>/ 에서 세 단계 위가 저장소 루트.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'js');
const { installIadsKernel } = await import(path.join(ROOT, 'model/iads/index.js'));
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = ROOT;
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(root, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment:true, threatTargetDispersion:true, southernAxes:true, linkSemanticsV2:true, sensorReportParity:true, sawtoothFreshness:true, approvalChain:true, unifiedEngagementState:true, selfDefenseFire:true, ballisticLaunchAxes:true, threatAimpoints:true, c2DecisionTimeParity:true, approvalPipelineRealism:true, iccRelayAuthorization:true, ballisticReportSource:true, standbyCue:true, rokUsfkCoordination:{asis:'voice',tobe:'datalink'}, commanderRouteRetry:true, shoradCruiseExclusion:true, shoradPkRealism:true, earlyShooterAssignment:true, assignmentFeedback:true, batteryStatusReporting:true, statusReportPeriodSec:4, standbyCueAuthority:'prepare' };
const TYPES = ['srbm','mrl_large','cruise','fighter','uav_small'];
const q = (a,p)=>{ if(!a.length) return NaN; const s=[...a].sort((x,y)=>x-y); return s[Math.min(s.length-1,Math.floor(p*s.length))]; };
const short = (id)=>id.replace(/^(C2_|SENSOR_|BATTERY_|ECS_)/,'').replace(/^(KAMD_OPS|MCRC|IAOC|ICC|ARMY_LOCAL_AD|USFK_PATRIOT_C2|USFK_THAAD_C2)_.*/,'$1');
function run(mode, features, seed, flow) {
  return KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity:1, seed, endTimeSec:3600, spawnUntilSec:1800, deploymentId:'HANBANDO_FULL_NORMAL', modelFidelity:'iads-c2', trace:true, traceCap:1000, flowTrace:!!flow, flowTraceCap:400000, features });
}
function analyze(res) {
  const out = { g: {}, time: {}, path: {}, load: {}, sensor: {}, outcomeByType: {} };
  const g = res.global; out.g = { spawned:g.spawned, killed:g.killed, leaked:g.leaked, unresolved:g.spawned-g.killed-g.leaked, shots:g.shotsFired, mttk:g.meanTimeToKillSec, mtte:g.meanTimeToEngageSec, decision:g.meanDecisionDelaySec, coord:g.meanCoordDelaySec, leakReasons:g.leakReasons, failure:g.failureSummary&&g.failureSummary.primary, coalition:g.coalition&&{proposals:g.coalition.proposals, allocRok:g.coalition.allocatedRok, allocUsfk:g.coalition.allocatedUsfk, dup:g.coalition.duplicates, skipped:g.coalition.skippedDeadline}, cue:g.standbyCue&&{cued:g.standbyCue.threatsCued, emergency:g.standbyCue.emergencyFired}, routeRetry:g.routeRetry, trackQuality:g.trackQuality, cost:g.cost };
  const byTh = {}; (res.flowEvents||[]).filter(e=>e.k==='link').forEach(e=>{ (byTh[e.th]=byTh[e.th]||[]).push(e); });
  TYPES.forEach(ty=>{ out.time[ty]={ n:0, det:[], c2:[], dec:[], fire:[], kill:[], total:[] }; out.path[ty]={ hops:[], c2n:[], voice:0, chains:0, media:{} }; out.outcomeByType[ty]={killed:0,leaked:0,unresolved:0,fired:0,emergency:0,selfdef:0}; });
  const firstDet = {}, fcOfShot = {}, sensorAny = {};
  res.threatTraces.forEach(tr=>{
    const ty = tr.type; if(!out.time[ty]) return; const T=out.time[ty]; T.n++;
    const o = out.outcomeByType[ty]; o[tr.outcome==='killed'?'killed':tr.outcome==='leaked'?'leaked':'unresolved']++;
    const st = tr.stages; const f=(re)=>st.find(s=>re.test(s.name));
    const det=f(/^탐지$/), c2=f(/^항적정보접수:/), dec=f(/^(사수선정·표적할당|긴급발사|자위권발사):/), fire=f(/^발사:/), hit=st.find(s=>/^BDA:HIT/.test(s.name));
    if(det) T.det.push(det.t-tr.spawnT); if(det&&c2) T.c2.push(c2.t-det.t); if(c2&&dec) T.dec.push(dec.t-c2.t); if(dec&&fire) T.fire.push(fire.t-dec.t); if(fire&&hit) T.kill.push(hit.t-fire.t); if(det&&hit) T.total.push(hit.t-det.t);
    if(fire) o.fired++; if(f(/^긴급발사:/)) o.emergency++; if(f(/^자위권발사:/)) o.selfdef++;
    const sd = st.filter(s=>/^SENSOR_DETECTED:/.test(s.name)).sort((a,b)=>a.t-b.t); if(sd.length){ const s=sd[0].name.split(':')[1]; firstDet[s]=(firstDet[s]||0)+1; } sd.forEach(s=>{ const id=s.name.split(':')[1]; sensorAny[id]=(sensorAny[id]||0)+1; });
    // path chain
    if(fire && byTh[tr.id]){ const shooter=fire.name.match(/^발사:([^/]+)/)[1]; const links=byTh[tr.id].filter(l=>l.t1<=fire.t+1e-9 && l.mt!=='fanout');
      let cur=links.filter(l=>l.to===shooter).sort((a,b)=>b.t1-a.t1)[0]; const chain=[]; const seen=new Set();
      while(cur&&!seen.has(cur)){ seen.add(cur); chain.unshift(cur); cur=links.filter(l=>l.to===cur.from&&l.t1<=cur.t0+1e-9).sort((a,b)=>b.t1-a.t1)[0]; }
      if(chain.length){ const nodes=[chain[0].from,...chain.map(l=>l.to)]; const P=out.path[ty]; P.chains++; P.hops.push(chain.length); P.c2n.push(new Set(nodes.filter(n=>/^C2_/.test(n))).size); if(chain.some(l=>l.mt==='voice')) P.voice++; chain.forEach(l=>P.media[l.mt]=(P.media[l.mt]||0)+1); }
    }
  });
  TYPES.forEach(ty=>{ const T=out.time[ty]; ['det','c2','dec','fire','kill','total'].forEach(k=>{ T[k]={n:T[k].length, med:q(T[k],.5), p90:q(T[k],.9)}; }); const P=out.path[ty]; P.hopsMed=q(P.hops,.5); P.hopsMax=P.hops.length?Math.max(...P.hops):NaN; P.c2Med=q(P.c2n,.5); delete P.hops; delete P.c2n; });
  out.sensor.firstDet = Object.entries(firstDet).sort((a,b)=>b[1]-a[1]).slice(0,12);
  const byType={}; Object.entries(firstDet).forEach(([id,n])=>{ const t=id.replace(/^SENSOR_/,'').replace(/_(MFR|USFK|N|S)?_?[A-Z]*$/,'').split('_')[0]; byType[t]=(byType[t]||0)+n; }); out.sensor.firstDetByFamily=byType;
  out.sensor.anySeen = Object.entries(sensorAny).sort((a,b)=>b[1]-a[1]).slice(0,8);
  // load
  const nodes=res.nodes; const cat=(c)=>nodes.filter(n=>n.category===c);
  const summarize=(arr)=>({ n:arr.length, rhoMax:Math.max(...arr.map(n=>n.rho||0)), rhoMean:arr.reduce((a,n)=>a+(n.rho||0),0)/Math.max(1,arr.length), WqMax:Math.max(...arr.map(n=>n.Wq||0)), drops:arr.reduce((a,n)=>a+(n.drops||0),0), maxIn:Math.max(...arr.map(n=>n.maxInSystem||0)), stressed:arr.filter(n=>n.level&&n.level!=='normal').map(n=>short(n.id)+':'+n.level) });
  out.load.c2=summarize(cat('c2')); out.load.shooter=summarize(cat('shooter')); const others=nodes.filter(n=>!/^(c2|shooter)$/.test(n.category)); out.load.other=summarize(others); out.load.categories=[...new Set(nodes.map(n=>n.category))];
  out.load.topRho=nodes.slice().sort((a,b)=>(b.rho||0)-(a.rho||0)).slice(0,10).map(n=>({id:short(n.id), cat:n.category, rho:+(n.rho||0).toFixed(3), arrivals:n.arrivals, Wq:+(n.Wq||0).toFixed(1), maxIn:n.maxInSystem, level:n.level}));
  out.load.topArrivals=nodes.filter(n=>n.category==='c2').sort((a,b)=>b.arrivals-a.arrivals).slice(0,8).map(n=>({id:short(n.id), arrivals:n.arrivals, rho:+(n.rho||0).toFixed(3), kinds:Object.entries(n.arrivalsByKind||{}).filter(([k,v])=>v>0).map(([k,v])=>k+':'+v).join(' ')}));
  out.load.bottlenecks=res.bottlenecks;
  // shooter shots distribution from fire marks
  const shots={}; res.threatTraces.forEach(tr=>tr.stages.forEach(s=>{ const m=s.name.match(/^발사:([^/]+)/); if(m) shots[m[1]]=(shots[m[1]]||0)+1; }));
  const sv=Object.values(shots).sort((a,b)=>b-a); const tot=sv.reduce((a,b)=>a+b,0); const nBat=cat('shooter').length;
  out.load.shots={ total:tot, batteries:nBat, firing:sv.length, zero:nBat-sv.length, top3Share:tot?sv.slice(0,3).reduce((a,b)=>a+b,0)/tot:0, top5Share:tot?sv.slice(0,5).reduce((a,b)=>a+b,0)/tot:0, top:Object.entries(shots).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>short(k)+':'+v) };
  // link load
  out.load.topLinks=(res.links||[]).slice().sort((a,b)=>b.count-a.count).slice(0,6).map(l=>short(l.from)+'→'+short(l.to)+' '+l.kind+'/'+l.type+' ×'+l.count+(l.isCommBottleneck?' ⚠':''));
  return out;
}
const report = { main:{}, seeds:{}, sweep:{} };
for (const mode of ['asis','tobe']) { const r=run(mode,BASE,29,true); report.main[mode]=analyze(r); console.error('main',mode,'done'); }
for (const seed of [30,31]) for (const mode of ['asis','tobe']) { const r=run(mode,BASE,seed,false); const a=analyze(r); report.seeds[mode+'#'+seed]={g:a.g, time:a.time, outcomeByType:a.outcomeByType}; console.error('seed',seed,mode,'done'); }
const SWEEP = { 'ea OFF':{earlyShooterAssignment:false}, 'shorad 현실화 OFF':{shoradCruiseExclusion:false, shoradPkRealism:false}, 'bsrc+cue OFF':{ballisticReportSource:false, standbyCue:false}, 'coal OFF':{rokUsfkCoordination:null}, 'rr OFF':{commanderRouteRetry:false}, 'par OFF':{c2DecisionTimeParity:false}, 'pipe+icc OFF':{approvalPipelineRealism:false, iccRelayAuthorization:false}, 'sdf OFF':{selfDefenseFire:false}, 'share=datalink ON':{usfkTrackSharing:'datalink'} };
for (const [label,extra] of Object.entries(SWEEP)) for (const mode of ['asis','tobe']) { const r=run(mode,Object.assign({},BASE,extra),29,false); const a=analyze(r); report.sweep[label+' / '+mode]={g:a.g, outcomeByType:a.outcomeByType, timeTotal:Object.fromEntries(TYPES.map(t=>[t,a.time[t].total.med]))}; console.error('sweep',label,mode,'done'); }
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'moe-report.json'), JSON.stringify(report,null,1));
console.log('written');
