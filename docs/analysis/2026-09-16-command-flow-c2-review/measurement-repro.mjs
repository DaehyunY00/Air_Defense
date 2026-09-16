// Read-only reproduction. Run from repository root:
// node /tmp/command-flow-measurement-review.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const root = process.cwd();
const require = createRequire(path.join(root, 'measurement-review.mjs'));
const { installIadsKernel } = await import(pathToFileURL(path.join(root, 'js/model/iads/index.js')));
globalThis.window = globalThis;
for (const f of ['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js']) {
  require(path.join(root, 'js', f));
}
const KJ = globalThis.KJ;
installIadsKernel(KJ);
const source = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
const start = source.indexOf('const PARAMS = [');
const params = new Function(source.slice(start, source.indexOf('\n];', start) + 3) + '\nreturn PARAMS;')();
const P = Object.fromEntries(params.map(p => [p.k, p.d]));
const featureText = source.slice(source.indexOf('function features() {'), source.indexOf('\n}\n', source.indexOf('function features() {')) + 3);
const getFeatures = p => new Function('P', featureText + '\nreturn features();')(p);
const features = getFeatures(P);
for (const [label, feat] of [['default', features], ['explicit-par=1', getFeatures({...P, par:true})]]) {
  const cat = KJ.resolveModelCatalog({deploymentId:P.dep, features:feat});
  const iaoc = KJ.nodesInMode('tobe', cat).find(n=>n.id==='C2_IAOC_IAOC');
  console.log(JSON.stringify({label, parityInput:feat.c2DecisionTimeParity, parityType:typeof feat.c2DecisionTimeParity, iaoc}));
}
for (const [mode, duration] of [['asis', 600], ['tobe', 600], ['asis', 3600]]) {
  const r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29,
    endTimeSec: duration, deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    trace: true, traceCap: 300, flowTrace: true, features });
  const arrivals = new Map(), service = new Map(), durations = [];
  for (const e of r.flowEvents) {
    if (e.k === 'na') arrivals.set(e.id, e);
    else if (e.k === 'ns') {
      const a = arrivals.get(e.id);
      if (a && ['KAMD', 'MCRC', 'IAOC'].some(x => a.at.includes(x)))
        service.set(e.id, { at: a.at, jk: a.jk, t: e.t });
    } else if (e.k === 'nd' && service.has(e.id)) {
      const s = service.get(e.id);
      durations.push({ at: s.at, jk: s.jk, d: e.t - s.t });
    }
  }
  console.log(JSON.stringify({ mode, duration, spawned: r.global.spawned,
    killed: r.global.killed, leaked: r.global.leaked, censored: r.global.censoredRaw,
    traces: r.threatTraces.length, traceTruncated: r.traceTruncated,
    flowEvents: r.flowEvents.length, flowTruncated: r.flowTruncated,
    lowC2: durations.filter(x => x.d < 1), nodes: r.nodes.filter(n => n.arrivals > 0 && n.category === 'c2')
      .map(n => ({ id: n.id, arrivals: n.arrivals, rho: n.rho, Wq: n.Wq, mean: n.meanSec })).slice(0, 5) }));
}
