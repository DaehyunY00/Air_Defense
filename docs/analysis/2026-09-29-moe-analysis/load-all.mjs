// 5장 보강 — 처리 용량이 있는 모든 부분(결심 지휘소·방공여단 통제소·포대 사격통제소·포대 채널/발사대/탄·교전 현황 공유 채널·통신 계선)과
// 용량이 없는 부분(탐지 레이더)의 부하를 두 체계에서 한 번에 뽑는다. 이용률은 생성 구간(1800초) 실행에서, 나머지 집계는 관측 3600초 실행에서 읽는다.
// 실행: node docs/analysis/2026-09-29-moe-analysis/load-all.mjs → fig/load-all.json
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installIadsKernel } from '../../../js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(HERE, '../../../js');
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach(f=>require(path.join(root,f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment:true, threatTargetDispersion:true, southernAxes:true, linkSemanticsV2:true, sensorReportParity:true, sawtoothFreshness:true, approvalChain:true, unifiedEngagementState:true, selfDefenseFire:true, ballisticLaunchAxes:true, threatAimpoints:true, c2DecisionTimeParity:true, approvalPipelineRealism:true, iccRelayAuthorization:true, ballisticReportSource:true, standbyCue:true, rokUsfkCoordination:{asis:'voice',tobe:'datalink'}, commanderRouteRetry:true, shoradCruiseExclusion:true, shoradPkRealism:true, earlyShooterAssignment:true, assignmentFeedback:true, batteryStatusReporting:true, statusReportPeriodSec:4, standbyCueAuthority:'prepare' };
const out = { generatedAt: new Date().toISOString(), condition: 'SC3 · FULL · seed 29 · 생성 1800초 · 이용률은 관측 1800초 실행, 집계는 관측 3600초 실행 · 화면 기본 플래그(bsr · 큐 권한 prepare)', modes: {} };
const cls = (n) => n.category === 'sensor' ? 'sensor' : n.category === 'shooter' ? 'shooter' : /^ECS_/.test(n.id) ? 'ecs' : /ICC/.test(n.id) ? 'icc' : /ARMY_LOCAL/.test(n.id) ? 'army' : /USFK/.test(n.id) ? 'usfk' : 'c2';
for (const mode of ['asis','tobe']) {
  const run = (end) => KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity:1, seed:29, endTimeSec:end, spawnUntilSec:1800, deploymentId:'HANBANDO_FULL_NORMAL', modelFidelity:'iads-c2', trace:true, traceCap:1000, flowTrace:true, flowTraceCap:400000, features:BASE });
  const r18 = run(1800), r36 = run(3600);
  const cat = KJ.resolveModelCatalog({ deploymentId:'HANBANDO_FULL_NORMAL', mode, modelFidelity:'iads-c2', features:BASE });
  const nodes = KJ.nodesInMode(mode, cat); const byId = {}; nodes.forEach(n => byId[n.id] = n);
  const n18 = {}; r18.nodes.forEach(n => n18[n.id] = n);
  const M = { killed: r36.global.killed, leaked: r36.global.leaked, shots: r36.global.shots, nodes: [], sensors: {}, links: [], statusSharing: r36.global.statusSharing, c2Orders: r36.global.c2Orders && r36.global.c2Orders.expiryByReason, coalition: r36.global.coalition, cue: r36.global.cue, leakReasons: r36.global.leakReasons };
  r36.nodes.forEach(n => {
    const a = n18[n.id] || {}; const def = byId[n.id] || {};
    M.nodes.push({ id: n.id, name: n.name, cls: cls({ id: n.id, category: n.category }), c: n.c, K: n.K, meanSec: n.meanSec,
      rho1800: a.rho ?? null, Wq1800: a.Wq ?? null, maxIn1800: a.maxInSystem ?? null, drops1800: a.drops ?? null,
      arrivals: n.arrivals, completions: n.completions, drops: n.drops, Wq: n.Wq, maxIn: n.maxInSystem, rho3600: n.rho, level: n.level,
      rhoByKind: a.rhoByKind || null, shots: n.shots ?? null, peakActive: n.peakActive ?? null, maxSimultaneous: n.maxSimultaneous ?? null, capacityBlocks: n.capacityBlocks ?? null,
      ammo: n.ammo, ammoRatio: n.ammoRatio, ammoDepletedT: n.ammoDepletedT, magazine: def.engage && def.engage.magazine, engageTimeSec: def.engage && def.engage.engageTimeSec });
  });
  // 센서: 용량이 없으므로 부하 대리 지표 — 보고 전문 수·본 항적 수·사격통제 등급에 이른 항적 수(flowEvents report 링크)
  const rep = {}; r36.flowEvents.filter(e => e.k === 'link' && e.kind === 'report').forEach(e => { const s = rep[e.from] = rep[e.from] || { reports: 0, threats: new Set() }; s.reports++; if (e.th) s.threats.add(e.th); });
  Object.keys(rep).forEach(id => { if (byId[id] && byId[id].category === 'sensor') M.sensors[id] = { name: byId[id].name, typeId: byId[id].typeId, reports: rep[id].reports, threats: rep[id].threats.size }; });
  M.links = r36.links.slice().sort((a, b) => b.count - a.count).slice(0, 40).map(l => ({ from: l.from, to: l.to, kind: l.kind, type: l.type, delaySec: l.delaySec, count: l.count, perMin: +l.perMin.toFixed(2), inTransit: +(l.perMin * l.delaySec / 60).toFixed(2), isCommBottleneck: l.isCommBottleneck }));
  M.bottlenecks = r36.bottlenecks;
  out.modes[mode] = M; console.error(mode, 'done');
}
fs.writeFileSync(path.join(HERE, 'fig', 'load-all.json'), JSON.stringify(out, null, 1)); console.log('written fig/load-all.json');
