/**
 * Phase 5(⑨) 재교전 상관 pk — ρ 민감도 스윕 + 2022.12.26 무인기 앵커.
 * 독립(legacy) 대비 재교전 누적 격추 이득이 ρ에 따라 어떻게 줄어드는지, uav_small 격추율로 관측.
 * 실행: node scripts/phase5-sweep.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
global.window = global;
const root = new URL('../js/', import.meta.url).pathname;
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(f => require(root + f));
const KJ = global.KJ;

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

// 전체 격추율(To-Be, SC1~3 × x1/1.5/2.5 풀링) — ρ별
function overallKill(feat) {
  let sp = 0, k = 0;
  ['sc1', 'sc2', 'sc3'].forEach(id => [1.0, 1.5, 2.5].forEach(x => SEEDS.forEach(sd => {
    const g = KJ.runDES({ scenario: KJ.scenarioById(id), mode: 'tobe', intensity: x, seed: sd, endTimeSec: 1800, features: feat }).global;
    sp += g.spawned; k += g.killed;
  })));
  return k / sp;
}

console.log('# 되돌리기 — pkCorrelated OFF = legacy(독립)');
let mism = 0;
SEEDS.slice(0, 8).forEach(sd => {
  ['sc1', 'sc3'].forEach(id => ['asis', 'tobe'].forEach(m => {
    const a = KJ.runDES({ scenario: KJ.scenarioById(id), mode: m, intensity: 2.5, seed: sd, endTimeSec: 1800, features: { pkCorrelated: false } }).global;
    const b = KJ.runDES({ scenario: KJ.scenarioById(id), mode: m, intensity: 2.5, seed: sd, endTimeSec: 1800 }).global; // 기본(pkCorrelated 기본 OFF)
    if (a.killed !== b.killed || a.leaked !== b.leaked) mism++;
  }));
});
console.log('  pkCorrelated:false vs 기본(default OFF) 불일치: ' + mism + ' (0이어야 — 기본이 OFF임을 확인)');

console.log('\n# ρ 스윕 — 전체 격추율(To-Be, seed1~20 × 9셀)');
console.log('ρ      | 전체격추율 | 독립 대비 Δ');
const base = overallKill({ pkCorrelated: false });
[0.0, 0.3, 0.5, 0.7, 0.9, 1.0].forEach(rho => {
  const kr = overallKill({ pkCorrelated: true, pkCorrelation: rho });
  console.log(String(rho).padEnd(6) + ' | ' + (kr * 100).toFixed(2).padStart(7) + '% | ' + ((kr - base) * 100).toFixed(2) + 'p');
});
console.log('독립(OFF): ' + (base * 100).toFixed(2) + '%');

// 2022.12.26 앵커: uav_small 다수 동시 남파(SC 무인기 강도 x2.5), 재교전에도 다수 미격추 재현되는가?
console.log('\n# 2022.12.26 앵커 — uav_small 재교전 이득 감소(SC1 x2.5, To-Be)');
console.log('ρ      | uav 격추율(재교전 포함)');
[0.0, 0.7, 1.0].forEach(rho => {
  let usp = 0, uk = 0;
  SEEDS.forEach(sd => {
    const r = KJ.runDES({ scenario: KJ.scenarioById('sc1'), mode: 'tobe', intensity: 2.5, seed: sd, endTimeSec: 1800, features: { pkCorrelated: rho > 0, pkCorrelation: rho } });
    // 위협유형별 집계가 없으므로 leakReasons·killed로 근사 — uav 비중 높은 SC1 전체로 대리
    usp += r.global.spawned; uk += r.global.killed;
  });
  console.log((rho === 0 ? '독립' : 'ρ=' + rho).padEnd(6) + ' | ' + (uk / usp * 100).toFixed(2) + '%');
});
