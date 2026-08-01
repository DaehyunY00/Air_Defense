// ADR-079 이후 native WTA 비용항 반증 셀 재탐색 — FULL·SC3 축(문서화된 발생 조건)부터.
import { createRequire } from 'node:module';
import { installIadsKernel } from './js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js',
 'data/links.js','data/threats.js','data/scenarios.js','data/axes.js',
 'config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js']
 .forEach(f => require('./js/' + f));
const KJ = globalThis.KJ; installIadsKernel(KJ);
function run(dep, sc, dur, features, x, seed) {
  return KJ.runDES({ scenario: KJ.scenarioById(sc), mode: 'asis', intensity: x, seed: seed || 12345,
    endTimeSec: dur, deploymentId: dep, modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, features) });
}
function strip(r) {
  const c = JSON.parse(JSON.stringify(r));
  delete c.global.features;
  return JSON.stringify(c);
}
let bite = 0, total = 0;
for (const seed of [777, 4242, 12345]) {
  for (const x of [1, 1.5, 2, 3]) {
    for (const dur of [600, 900]) {
      const on = run('HANBANDO_FULL_NORMAL', 'sc3', dur, { nativeWtaMode: true }, x, seed);
      const cf = run('HANBANDO_FULL_NORMAL', 'sc3', dur, { nativeWtaMode: true, nativeWtaCostAsis: true }, x, seed);
      const diff = strip(on) !== strip(cf);
      total++;
      if (diff) bite++;
      console.log('seed ' + String(seed).padStart(5) + ' ×' + String(x).padEnd(3) + ' ' + dur + 's  ' +
        (diff ? '★ 문다' : '무효과') + '  보존율 ' + on.global.highValuePreservation.toFixed(3) +
        (diff ? '→' + cf.global.highValuePreservation.toFixed(3) : ''));
    }
  }
}
console.log('FULL·SC3 격자: ' + bite + '/' + total + ' 셀에서 개입');
