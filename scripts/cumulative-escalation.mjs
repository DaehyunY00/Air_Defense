/**
 * 🔴 합산 편향 보고 — Phase 1~4 누적이 "To-Be 개선폭"을 legacy 대비 상대 몇 % 옮겼나(조건 4, ≥20% → 🔴).
 * 개별 Phase는 각각 20% 미만이어도 합산이 임계를 넘을 수 있다("합산 편향"). 지배 요인도 분해한다.
 * 실행: node scripts/cumulative-escalation.mjs
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

function struct(g, split) {
  let n = 0;
  Object.keys(g.leakReasons).forEach(c => {
    // legacy 규칙(split=false): timeout=구조, overflow:*=구조
    let s;
    if (c.indexOf('timeout') === 0) s = split ? c !== 'timeout:engage' : true;
    else if (c.indexOf('overflow:') === 0) { const nd = KJ.nodeById(c.slice(9)); s = split ? !(nd && nd.category === 'shooter') : true; }
    else { const b = KJ.LEAK_TAXONOMY[c]; s = b ? b.structural : false; }
    if (s) n += g.leakReasons[c];
  });
  return n;
}
function ledger(mode, feat, splitStruct) {
  let sp = 0, k = 0, l = 0, st = 0, cen = 0;
  SCEN.forEach(id => XS.forEach(x => SEEDS.forEach(sd => {
    const g = KJ.runDES({ scenario: KJ.scenarioById(id), mode, intensity: x, seed: sd, endTimeSec: 1800, features: feat }).global;
    sp += g.spawned; k += g.killed; l += g.leaked; st += struct(g, splitStruct); cen += (g.censored || 0);
  })));
  const d = sp - cen;
  return { kill: k / d, leak: l / d, struct: st / d };
}
const OFF = { pkByShooter: false, leakCost: false, censorFix: false, timeoutSplit: false, pkCorrelated: false, salvo: false };
const P14 = { pkByShooter: true, leakCost: true, censorFix: true, timeoutSplit: true, pkCorrelated: false, salvo: false };
const P14noCensor = Object.assign({}, P14, { censorFix: false });

function improve(a, b, metric) { return metric === 'kill' ? (b.kill - a.kill) : (a[metric] - b[metric]); }
function rowFor(feat, split) { return { a: ledger('asis', feat, split), b: ledger('tobe', feat, split) }; }

const L = rowFor(OFF, false);          // legacy (분해 전 구조 규칙)
const C = rowFor(P14, true);           // Phase 1-4 (분해 후)
const Cnc = rowFor(P14noCensor, true); // Phase 1-4 but censorFix OFF (절단 기여 격리)

console.log('# 🔴 합산 편향 — Phase 1~4 누적 "To-Be 개선폭" 이동 (legacy 대비 상대 %)');
console.log('지표        | legacy 개선폭 | P1-4 개선폭 | 상대이동 | 판정');
[['kill', '격추율'], ['leak', '누수율'], ['struct', '구조적실패율']].forEach(([m, label]) => {
  const li = improve(L.a, L.b, m), ci = improve(C.a, C.b, m);
  const rel = (ci - li) / Math.abs(li) * 100;
  console.log(label.padEnd(11) + ' | ' + (100 * li).toFixed(2).padStart(9) + 'p | ' + (100 * ci).toFixed(2).padStart(9) + 'p | ' + (rel >= 0 ? '+' : '') + rel.toFixed(1) + '% | ' + (Math.abs(rel) >= 20 ? '🔴 임계초과' : '녹색'));
});

console.log('\n# 지배 요인 분해 — censorFix(Phase 3, 분모) 격리');
[['kill', '격추율'], ['leak', '누수율'], ['struct', '구조적실패율']].forEach(([m, label]) => {
  const li = improve(L.a, L.b, m);
  const noCen = improve(Cnc.a, Cnc.b, m);   // censorFix 뺀 P1-4
  const full = improve(C.a, C.b, m);        // 전체 P1-4
  const relNoCen = (noCen - li) / Math.abs(li) * 100;
  const relFull = (full - li) / Math.abs(li) * 100;
  console.log(label.padEnd(11) + ' | censorFix 제외 시 ' + relNoCen.toFixed(1) + '% → 포함 시 ' + relFull.toFixed(1) + '%  (절단보정 기여 ' + (relFull - relNoCen).toFixed(1) + 'p)');
});
// As-Is 구조적/누수율이 절단보정으로 얼마나 오르나(As-Is가 더 많이 잘려 있었음을 보이는 근거)
console.log('\n# 절단보정이 As-Is를 더 악화로 드러냄 (As-Is가 파이프라인에 더 오래 갇혀 미해결분 많음)');
console.log('As-Is 누수율: censorFix OFF ' + (100 * Cnc.a.leak).toFixed(1) + '% → ON ' + (100 * C.a.leak).toFixed(1) + '%');
console.log('To-Be 누수율: censorFix OFF ' + (100 * Cnc.b.leak).toFixed(1) + '% → ON ' + (100 * C.b.leak).toFixed(1) + '%');
