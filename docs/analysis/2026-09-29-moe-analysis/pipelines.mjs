// 9장 — 위협 유형별 노드 파이프라인(결심 사슬) 전수 추출. 발사에 이른 항적마다 사수에 닿은 마지막 전문에서 거꾸로 전임 전문을
// 이어 「레이더 → … → 발사 포대」 사슬을 만들고, 같은 사슬을 묶어 건수·매체·구간별 중앙 지연·탐지→발사 중앙을 fig/pipelines.json에 쓴다.
// 그림은 pipelines-svg.py가 이 JSON으로 그린다. 실행: node docs/analysis/2026-09-29-moe-analysis/pipelines.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installIadsKernel } from '../../../js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(HERE, '../../../js');
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach(f=>require(path.join(root,f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment:true, threatTargetDispersion:true, southernAxes:true, linkSemanticsV2:true, sensorReportParity:true, sawtoothFreshness:true, approvalChain:true, unifiedEngagementState:true, selfDefenseFire:true, ballisticLaunchAxes:true, threatAimpoints:true, c2DecisionTimeParity:true, approvalPipelineRealism:true, iccRelayAuthorization:true, ballisticReportSource:true, standbyCue:true, rokUsfkCoordination:{asis:'voice',tobe:'datalink'}, commanderRouteRetry:true, shoradCruiseExclusion:true, shoradPkRealism:true, earlyShooterAssignment:true, assignmentFeedback:true, batteryStatusReporting:true, statusReportPeriodSec:4 };
const TYPES = ['srbm','mrl_large','cruise','fighter','uav_small'];
const med = (a) => { if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
const out = { generatedAt: new Date().toISOString(), condition: 'SC3 · FULL · seed 29 · 생성 1800초 · 관측 3600초 · 화면 기본 플래그(bsr 4초 포함)', modes: {} };
for (const mode of ['asis','tobe']) {
  const res = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity:1, seed:29, endTimeSec:3600, spawnUntilSec:1800, deploymentId:'HANBANDO_FULL_NORMAL', modelFidelity:'iads-c2', trace:true, traceCap:1000, flowTrace:true, flowTraceCap:400000, features:BASE });
  const cat = KJ.resolveModelCatalog({ deploymentId:'HANBANDO_FULL_NORMAL', mode, modelFidelity:'iads-c2', features:BASE });
  const nodeInfo = {}; KJ.nodesInMode(mode, cat).forEach(n => { nodeInfo[n.id] = { name: n.name || n.id, category: n.category || 'c2', typeId: n.typeId || null }; });
  const ecsOf = {}; KJ.nodesInMode(mode, cat).forEach(n => { if (n.category === 'shooter') ecsOf[n.id] = n.ecsC2Id || n.id; });
  const byTh = {}; res.flowEvents.filter(e=>e.k==='link').forEach(e=>{ (byTh[e.th]=byTh[e.th]||[]).push(e); });
  const chains = {}; TYPES.forEach(t=>chains[t]={});
  let fired = 0;
  res.threatTraces.forEach(tr => {
    const fire = tr.stages.find(s=>/^발사:/.test(s.name)); if (!fire || !chains[tr.type]) return; fired++;
    const shooter = fire.name.match(/^발사:([^/]+)/)[1];
    const links = (byTh[tr.id]||[]).filter(l=>l.t1<=fire.t+1e-9 && l.mt!=='fanout');
    const emer = tr.stages.some(s=>s.name==='긴급발사:'+shooter && Math.abs(s.t-fire.t)<1e-6);
    let cur = links.filter(l=>l.to===shooter).sort((a,b)=>b.t1-a.t1)[0];
    // 긴급발사(ADR-104 ②)는 포대로 가는 명령 전문이 없다 — 대기 지시(cue)가 닿은 포대 사격통제소까지를 사슬로 잡고 「포대 자체 판단」 한 칸을 덧붙인다.
    let selfTail = null;
    if (!cur && emer) { const ecs = ecsOf[shooter]; cur = links.filter(l=>l.kind==='cue' && l.to===ecs).sort((a,b)=>b.t1-a.t1)[0]; if (cur) selfTail = { from: ecs, to: shooter, kind: 'self', mt: 'self', t0: fire.t, t1: fire.t }; }
    const chain = []; const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); chain.unshift(cur); cur = links.filter(l=>l.to===cur.from && l.t1<=cur.t0+1e-9).sort((a,b)=>b.t1-a.t1)[0]; }
    if (selfTail) chain.push(selfTail);
    if (!chain.length) return;
    const nodes = [chain[0].from, ...chain.map(l=>l.to)];
    const key = nodes.join('>') + '|' + chain.map(l=>l.kind||'').join(',');
    const det = (tr.stages.find(s=>s.name==='탐지')||{t:tr.spawnT}).t;
    const c = chains[tr.type][key] = chains[tr.type][key] || { nodes, kinds: chain.map(l=>l.kind||null), media: chain.map(l=>l.mt), n:0, detToFire:[], linkDelay: chain.map(()=>[]), gapBefore: chain.map(()=>[]), emergency:0, examples:[] };
    c.n++; c.detToFire.push(fire.t - det);
    chain.forEach((l,i)=>{ c.linkDelay[i].push(l.t1 - l.t0); c.gapBefore[i].push(i ? l.t0 - chain[i-1].t1 : l.t0 - det); });
    if (emer) c.emergency++;
    if (c.examples.length < 3) c.examples.push(tr.id);
  });
  const types = {};
  TYPES.forEach(t => {
    const list = Object.values(chains[t]).map(c => ({ nodes: c.nodes, names: c.nodes.map(id=>(nodeInfo[id]||{}).name||id), categories: c.nodes.map(id=>(nodeInfo[id]||{}).category||'?'), kinds: c.kinds, media: c.media, n: c.n, emergency: c.emergency,
      detToFireMed: med(c.detToFire), linkDelayMed: c.linkDelay.map(med), gapBeforeMed: c.gapBefore.map(med), examples: c.examples })).sort((a,b)=>b.n-a.n);
    types[t] = { fired: list.reduce((a,c)=>a+c.n,0), total: res.threatTraces.filter(x=>x.type===t).length, chains: list };
  });
  out.modes[mode] = { killed: res.global.killed, leaked: res.global.leaked, fired, types };
  console.error(mode, 'done', fired);
}
fs.mkdirSync(path.join(HERE,'fig'), { recursive: true });
fs.writeFileSync(path.join(HERE,'fig','pipelines.json'), JSON.stringify(out, null, 1));
console.log('written fig/pipelines.json');
