/**
 * WP0 산출물 — Fire-Unit Layer 도입 전 기준선 캡처(회귀 대조용).
 * 대표 config(SC1/SC2/SC3 × asis/tobe × seed 1)의 결과 global을 docs/baseline-pre-fireunit.json에 저장.
 * 실행: node scripts/capture-baseline.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
global.window = global;
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(f => require(path.join(root, 'js', f)));
const KJ = global.KJ;

const out = {};
['sc1', 'sc2', 'sc3'].forEach(sc => {
  ['asis', 'tobe'].forEach(mode => {
    const r = KJ.runDES({ scenario: KJ.scenarioById(sc), mode, intensity: 1, seed: 1, endTimeSec: 1800 });
    const g = r.global;
    out[`${sc}/${mode}/1/1`] = {
      spawned: g.spawned, detected: g.detected, reachedC2: g.reachedC2,
      everEngaged: g.everEngaged, engaged: g.engaged, killed: g.killed, leaked: g.leaked,
      killRate: +g.killRate.toFixed(6), leakRate: +g.leakRate.toFixed(6),
      leakReasons: g.leakReasons,
      interceptM: +g.cost.interceptM.toFixed(4),
      exchange: g.cost.exchange == null ? null : +g.cost.exchange.toFixed(6),
      defenseEfficiency: g.cost.defenseEfficiency == null ? null : +g.cost.defenseEfficiency.toFixed(6),
      shotsFired: g.shotsFired, eventCount: r.eventCount
    };
  });
});
fs.writeFileSync(path.join(root, 'docs', 'baseline-pre-fireunit.json'), JSON.stringify(out, null, 1) + '\n');
console.log('baseline-pre-fireunit.json 저장 완료 (' + Object.keys(out).length + ' config)');
console.log(JSON.stringify(out, null, 1));
