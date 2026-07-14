/**
 * Phase 4(⑨) 구조적실패 재분류 측정 — timeout 분해 + overflow:shooter 재분류.
 * timeout-split 기여와 overflow-reclass 기여를 분리해 에스컬레이션(≥20%)을 판정한다.
 * 실행: node scripts/phase4-measure.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
global.window = global;
const root = new URL('../js/', import.meta.url).pathname;
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(f => require(root + f));
const KJ = global.KJ;

const SCEN = ['sc1', 'sc2', 'sc3'], XS = [1.0, 1.5, 2.5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

// 코드 하나의 구조성을 3가지 규칙으로 재현(에스컬레이션 분해용):
//  legacy   : timeout=구조, overflow:*=구조 (Phase 3 상태)
//  splitOnly: timeout:c2=구조·timeout:engage=비구조, overflow:*=구조
//  phase4   : + overflow:shooter=비구조 (현행 leakTaxonomy)
function isStruct(code, rule) {
  if (code.indexOf('timeout') === 0) {
    if (rule === 'legacy') return true;
    return code !== 'timeout:engage'; // c2=구조, engage=비구조
  }
  if (code.indexOf('overflow:') === 0) {
    if (rule !== 'phase4') return true;
    const node = KJ.nodeById(code.slice(9));
    return !(node && node.category === 'shooter'); // shooter=비구조
  }
  const base = KJ.LEAK_TAXONOMY[code];
  return base ? base.structural : false;
}

function measure(mode, rule) {
  let spawned = 0, censored = 0, struct = 0;
  SCEN.forEach(id => XS.forEach(x => SEEDS.forEach(sd => {
    // timeoutSplit는 legacy 규칙일 때 OFF(단일 timeout 코드), 아니면 ON
    const feat = { timeoutSplit: rule !== 'legacy' };
    const g = KJ.runDES({ scenario: KJ.scenarioById(id), mode, intensity: x, seed: sd, endTimeSec: 1800, features: feat }).global;
    spawned += g.spawned; censored += (g.censored || 0);
    Object.keys(g.leakReasons).forEach(c => { if (isStruct(c, rule)) struct += g.leakReasons[c]; });
  })));
  return struct / (spawned - censored);
}

const rows = [['legacy(Phase3)', 'legacy'], ['+timeout분해', 'splitOnly'], ['+overflow재분류(Phase4)', 'phase4']];
console.log('# Phase 4 구조적실패율 — 규칙별(seed1~20 × SC1/2/3 × x1/1.5/2.5 풀링)');
console.log('규칙                    | As-Is  | To-Be  | To-Be 개선폭');
const de = {};
rows.forEach(([label, rule]) => {
  const a = measure('asis', rule), b = measure('tobe', rule);
  de[rule] = a - b; // 구조적실패는 낮을수록 좋음 → As-Is−To-Be가 "To-Be 개선폭(=As-Is가 더 나쁨)"
  const pp = v => (v * 100).toFixed(2) + '%';
  console.log(label.padEnd(23) + ' | ' + pp(a).padEnd(6) + ' | ' + pp(b).padEnd(6) + ' | As-Is−To-Be ' + (100 * (a - b)).toFixed(2) + 'p');
});
// 에스컬레이션: To-Be 개선폭이 Phase3→Phase4에서 상대 몇 % 이동?
const rel = (de.phase4 - de.legacy) / Math.abs(de.legacy) * 100;
console.log('\n구조적실패 "To-Be 개선폭(As-Is−To-Be)" 이동: legacy ' + (100 * de.legacy).toFixed(2) + 'p → Phase4 ' + (100 * de.phase4).toFixed(2) + 'p');
console.log('상대 이동 = ' + rel.toFixed(1) + '%  ' + (Math.abs(rel) >= 20 ? '🔴 에스컬레이션(≥20%)' : '(20% 미만)'));
