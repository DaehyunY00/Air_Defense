// Fresh 182-cell experiment, plus a separately recorded probe; never reads XLSX.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../../../scripts/experiment-lib.mjs';
import { HERE, DEPLOYMENTS, config, metadata, stats } from './report-common.mjs';

export const FLAGS = {
  appr: ['approvalChain', false], cop: ['unifiedEngagementState', false], sdf: ['selfDefenseFire', false],
  eor: ['engageOnRemote', true], share: ['usfkTrackSharing', 'datalink'], suit: ['wtaSuitability', true],
  uavsd: ['uavLocalSelfEngage', true], ew: ['earlyWarningReport', true], lx: ['ballisticLaunchAxes', false],
  aim: ['threatAimpoints', false], floor: ['c2ServiceFloor', true], pipe: ['approvalPipelineRealism', false],
  icc: ['iccRelayAuthorization', false], ecs: ['ecsExecutionTime', true], issue: ['directiveIssueTime', true],
  par: ['c2DecisionTimeParity', false]
};
const KJ = loadEngine();
function measure(options) {
  const cfg = config(KJ, options), sim = new KJ.Simulation(cfg), r = sim.run();
  const g = r.global, co = g.coordination || {};
  assert.equal(g.spawned, g.killed + g.leaked + g.censoredRaw);
  assert.equal(Object.values(g.leakReasons).reduce((s,n)=>s+n,0), g.leaked);
  const c2 = r.nodes.filter(n=>n.category==='c2').map(n=>({ id:n.id, name:n.name, wq:n.Wq,
    rho:n.rho, drops:n.drops, arrivals:n.arrivals, servers:n.c, serviceSec:n.meanSec,
    arrivalsByKind:n.arrivalsByKind, dropsByKind:n.dropsByKind, WqByKind:n.WqByKind }));
  return { config: { ...cfg, scenario:cfg.scenario.id }, spawned:g.spawned, killed:g.killed, leaked:g.leaked,
    censored:g.censoredRaw, detected:g.detected, engaged:g.everEngaged,
    leakRateSpawn:g.spawned?g.leaked/g.spawned:0, killRateSpawn:g.spawned?g.killed/g.spawned:0,
    censoredRate:g.spawned?g.censoredRaw/g.spawned:0, leakRateResolved:g.leakRate,
    dup:co.duplicates||0, realDuplicates:co.realDuplicates||0, gaps:co.gaps||0, shots:g.shotsFired,
    costM:g.cost.interceptM, duplicateCostM:g.cost.duplicateInterceptM, exchange:g.cost.exchange,
    exchangeSat:g.cost.exchangeSat,
    // Preserve sampling denominators from successful _onIadsFire, not stale result-field comments.
    tte:sim.global.timeToEngage.length?g.meanTimeToEngageSec:null, tteN:sim.global.timeToEngage.length,
    dec:sim.decisionDelayCount?g.meanDecisionDelaySec:null, decN:sim.decisionDelayCount,
    coord:sim.decisionDelayCount?g.meanCoordDelaySec:null,
    reasons:g.leakReasons, c2, top:c2.slice().sort((a,b)=>b.wq-a.wq).slice(0,3),
    maxC2Rho:Math.max(...c2.map(n=>n.rho)), bn:r.bottlenecks.length,
    selfDefense:sim.global.selfDefense, statusSharing:co.statusSharing,
    observation:{traceEnabled:false, flowTraceEnabled:false, wholeRunCounts:true} };
}
if (!isMainThread) {
  parentPort.on('message', task=>{
    try { parentPort.postMessage({index:task.index, value:measure(task.options)}); }
    catch(error) { parentPort.postMessage({index:task.index,error:error.stack}); }
  });
} else {
  const output = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE,'analysis-out.json');
  const workerFlag=process.argv.indexOf('--workers');
  const workers=workerFlag<0?2:Number(process.argv[workerFlag+1]);
  assert.ok(workers===1||workers===2,'At most two compute workers');
  const cells=[];
  const add=(section,options)=>cells.push({section,options});
  for(const dep of DEPLOYMENTS)for(const sc of ['sc1','sc2','sc3'])for(const mode of ['asis','tobe'])add('baseline',{dep,sc,mode});
  for(const dep of DEPLOYMENTS)for(const mode of ['asis','tobe'])for(const [flag,[feature,value]]of Object.entries(FLAGS))add('oat',{dep,mode,flag,feature,value,feat:{[feature]:value}});
  for(const dep of DEPLOYMENTS)for(const mode of ['asis','tobe'])for(let i=0;i<20;i++)add('mc',{dep,mode,seed:29+i*7});
  for(const dep of DEPLOYMENTS)for(const x of [1,1.5,2,2.5,3])for(const mode of ['asis','tobe'])add('sweep',{dep,x,mode});
  for(const dur of [600,1200,1800])for(const mode of ['asis','tobe'])add('dur',{dur,mode});
  assert.equal(cells.length,182);
  const out={meta:{...metadata(),cellCount:182,probeCount:1,sectionCounts:{baseline:12,oat:64,mc:80,sweep:20,dur:6},
    seeds:Array.from({length:20},(_,i)=>29+i*7),ci:'Paired mean difference; Student t(19)=2.093024054; 95%; descriptive, no multiple-comparison adjustment'},
    probe:measure({}),baseline:[],oat:[],mc:[],sweep:[],dur:[]};
  console.log('probe',JSON.stringify(out.probe));
  if(process.argv.includes('--probe')) {fs.writeFileSync(output,JSON.stringify(out,null,2));process.exit(0);}
  const values=new Array(cells.length); let next=0, done=0;
  const started=Date.now();
  await new Promise((resolve,reject)=>{
    const pool=[];
    function dispatch(worker){if(next<cells.length){const index=next++;worker.postMessage({index,options:cells[index].options});}}
    for(let i=0;i<workers;i++){
      const worker=new Worker(fileURLToPath(import.meta.url));pool.push(worker);
      worker.on('error',reject);
      worker.on('message',message=>{
        if(message.error){pool.forEach(w=>w.terminate());reject(new Error(message.error));return;}
        values[message.index]=message.value;done++;
        if(done%10===0||done===cells.length)console.log(`cells ${done}/${cells.length}, ${((Date.now()-started)/1000).toFixed(1)}s`);
        if(done===cells.length){pool.forEach(w=>w.terminate());resolve();}else dispatch(worker);
      });dispatch(worker);
    }
  });
  cells.forEach((cell,index)=>out[cell.section].push({...cell.options,...values[index]}));
  out.paired={};
  for(const dep of DEPLOYMENTS){
    const A=out.mc.filter(r=>r.dep===dep&&r.mode==='asis'), T=out.mc.filter(r=>r.dep===dep&&r.mode==='tobe');
    const pairs=A.map(a=>{const b=T.find(t=>t.seed===a.seed);assert.ok(b);assert.equal(a.spawned,b.spawned);return {seed:a.seed,a,b};});
    out.paired[dep]=Object.fromEntries(['leaked','killed','censored','leakRateSpawn','killRateSpawn','censoredRate','dup','shots'].map(key=>[key,stats(pairs.map(p=>p.b[key]-p.a[key]))]));
    out.paired[dep].direction={lowerLeak:pairs.filter(p=>p.b.leaked<p.a.leaked).length,tie:pairs.filter(p=>p.b.leaked===p.a.leaked).length,higherLeak:pairs.filter(p=>p.b.leaked>p.a.leaked).length};
  }
  out.meta.elapsedSec=(Date.now()-started)/1000;
  fs.writeFileSync(output,JSON.stringify(out,null,2));
  console.log('saved',output);
}
