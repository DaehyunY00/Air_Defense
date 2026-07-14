/**
 * ⑧ WTA 편향 원장(bias ledger) 측정기 — feat/stage8-wta
 * 실행: node scripts/bias-ledger.mjs [라벨]
 *
 * 고정 측정 조건: seed 1~20, endTimeSec 1800, SC1/SC2/SC3 × x1.0/1.5/2.5 (9셀 풀링).
 * 6개 결론 지표를 As-Is/To-Be 각각 집계한다:
 *   격추율 = Σkilled/Σspawned · 누수율 = Σleaked/Σspawned
 *   구조적실패율 = Σ(structural leakReasons)/Σspawned · exchangeSat = ΣinterceptSatM/ΣkilledThreatSatM
 * 각 Phase 적용 후 이 스크립트를 재실행해 개별 기여도를 기록한다(Phase를 묶어 적용하지 않는다).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
global.window = global;
const root = new URL('../js/', import.meta.url).pathname;
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js', 'analysis/overlap-heatmap.js'].forEach(f => require(root + f));
const KJ = global.KJ;

const SCEN = ['sc1', 'sc2', 'sc3'];
const XS = [1.0, 1.5, 2.5];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function structuralLeaks(g) {
  let n = 0;
  Object.keys(g.leakReasons).forEach(code => { if (KJ.leakTaxonomy(code).structural) n += g.leakReasons[code]; });
  return n;
}

function ledgerFor(mode) {
  let spawned = 0, killed = 0, leaked = 0, struct = 0, iSat = 0, kSat = 0;
  const leakCodes = {};
  SCEN.forEach(id => XS.forEach(x => SEEDS.forEach(sd => {
    const r = KJ.runDES({ scenario: KJ.scenarioById(id), mode, intensity: x, seed: sd, endTimeSec: 1800 });
    const g = r.global;
    spawned += g.spawned; killed += g.killed; leaked += g.leaked; struct += structuralLeaks(g);
    iSat += g.cost.interceptSatM; kSat += g.cost.killedThreatSatM;
    Object.keys(g.leakReasons).forEach(c => {
      const key = c.indexOf('overflow:') === 0 ? 'overflow' : (c.indexOf('timeout') === 0 ? 'timeout' : c);
      leakCodes[key] = (leakCodes[key] || 0) + g.leakReasons[c];
    });
  })));
  return {
    killRate: killed / spawned, leakRate: leaked / spawned, structRate: struct / spawned,
    exchangeSat: kSat > 0 ? iSat / kSat : null, leakCodes, spawned
  };
}

const label = process.argv[2] || '(현행)';
const a = ledgerFor('asis'), b = ledgerFor('tobe');
const pp = v => (v * 100).toFixed(1) + '%';
const ex = v => v == null ? '—' : v.toFixed(2);
console.log('# 편향 원장 행: ' + label + '  (seed1~20 × SC1/2/3 × x1.0/1.5/2.5 풀링)');
console.log('지표            | As-Is    | To-Be    | To-Be 개선(Δ)');
console.log('격추율          | ' + pp(a.killRate).padEnd(8) + ' | ' + pp(b.killRate).padEnd(8) + ' | ' + pp(b.killRate - a.killRate) + 'p');
console.log('누수율          | ' + pp(a.leakRate).padEnd(8) + ' | ' + pp(b.leakRate).padEnd(8) + ' | ' + pp(a.leakRate - b.leakRate) + 'p 감소');
console.log('구조적실패율    | ' + pp(a.structRate).padEnd(8) + ' | ' + pp(b.structRate).padEnd(8) + ' | ' + pp(a.structRate - b.structRate) + 'p 감소');
console.log('exchangeSat     | ' + ex(a.exchangeSat).padEnd(8) + ' | ' + ex(b.exchangeSat).padEnd(8) + ' | ' + (a.exchangeSat && b.exchangeSat ? (a.exchangeSat - b.exchangeSat).toFixed(2) + ' 감소' : '—'));
console.log('\n누수 사유 분포 As-Is:', JSON.stringify(a.leakCodes));
console.log('누수 사유 분포 To-Be:', JSON.stringify(b.leakCodes));
