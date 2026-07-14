/**
 * Phase 6(⑨) 연발(salvo) — 필요성·트레이드오프 판정. 격추율↑ vs 비용교환비↓.
 * 실행: node scripts/phase6-salvo.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
global.window = global;
const root = new URL('../js/', import.meta.url).pathname;
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(f => require(root + f));
const KJ = global.KJ;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function agg(feat) {
  let sp = 0, k = 0, iM = 0, kM = 0, missed = 0, few = 0;
  ['sc1', 'sc2', 'sc3'].forEach(id => [1.0, 1.5, 2.5].forEach(x => SEEDS.forEach(sd => {
    const g = KJ.runDES({ scenario: KJ.scenarioById(id), mode: 'tobe', intensity: x, seed: sd, endTimeSec: 1800, features: feat }).global;
    sp += g.spawned; k += g.killed; iM += g.cost.interceptM; kM += g.cost.killedThreatM;
    missed += g.leakReasons['missed'] || 0;
    few += g.leakReasons['no_engage_window'] || 0;
  })));
  return { killRate: k / sp, exchange: kM > 0 ? iM / kM : null, missed, few };
}

console.log('# 되돌리기 — salvo OFF = legacy');
let mism = 0;
SEEDS.slice(0, 8).forEach(sd => ['sc1', 'sc3'].forEach(id => ['asis', 'tobe'].forEach(m => {
  const a = KJ.runDES({ scenario: KJ.scenarioById(id), mode: m, intensity: 2.5, seed: sd, endTimeSec: 1800, features: { salvo: false } }).global;
  const b = KJ.runDES({ scenario: KJ.scenarioById(id), mode: m, intensity: 2.5, seed: sd, endTimeSec: 1800 }).global;
  if (a.killed !== b.killed || a.leaked !== b.leaked || Math.abs(a.cost.interceptM - b.cost.interceptM) > 1e-9) mism++;
})));
console.log('  salvo:false vs 기본(default OFF) 불일치: ' + mism + ' (0이어야)');

console.log('\n# 연발 트레이드오프 (To-Be, seed1~20 × 9셀)');
console.log('설정        | 격추율  | 비용교환비 | missed | no_engage_window');
const base = agg({ salvo: false });
const pr = (r, label) => console.log(label.padEnd(11) + ' | ' + (r.killRate * 100).toFixed(2).padStart(6) + '% | ' + (r.exchange == null ? '—' : r.exchange.toFixed(2)).padStart(9) + ' | ' + String(r.missed).padStart(6) + ' | ' + r.few);
pr(base, 'OFF(k=1)');
[2, 3].forEach(k => pr(agg({ salvo: true, salvoSize: k }), 'salvo k=' + k));
