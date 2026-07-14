/**
 * 자원최적화 Step 2 — 유도탄 재고(magazine) + 보존 임계(reserveFloor).
 * 소진 경계 스윕 + 노드 기본 재고 시 MDU-L 소진 + reserveFloor의 As-Is/To-Be 비대칭 효과.
 * 실행: node scripts/step2-magazine.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
global.window = global;
const root = new URL('../js/', import.meta.url).pathname;
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(f => require(root + f));
const KJ = global.KJ;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function agg(mode, feat) {
  let sp = 0, k = 0, na = 0, srbmLeak = 0, reserveTrig = 0, mduLDep = [];
  [1.0, 1.5, 2.5].forEach(x => SEEDS.forEach(s => {
    const res = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: x, seed: s, endTimeSec: 1800, features: feat });
    const g = res.global;
    sp += g.spawned; k += g.killed; na += g.leakReasons['no_ammo'] || 0;
    (res.nodes || []).forEach(n => {
      if (n.id === 'MDU-L') { reserveTrig += n.reserveTriggers || 0; if (n.ammoDepletedT != null) mduLDep.push(n.ammoDepletedT); }
    });
  }));
  return { killRate: k / sp, noAmmo: na, reserveTrig, mduLDepFirst: mduLDep.length ? Math.min(...mduLDep) : null, mduLDepCount: mduLDep.length };
}

// 되돌리기: magazine OFF = 현행(무제한)
console.log('# 되돌리기 — magazine OFF (ammo=∞, no_ammo 미발생)');
let na = 0;
SEEDS.slice(0, 10).forEach(s => { na += (KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s, endTimeSec: 1800, features: { magazine: false } }).global.leakReasons['no_ammo'] || 0); });
console.log('  magazine OFF no_ammo 합: ' + na + ' (0이어야 — 소진 없음)');

console.log('\n# 노드 기본 재고(MDU-L 24, SHORAD 200 등) — SC3, To-Be');
const base = agg('tobe', { magazine: true });
console.log('  no_ammo ' + base.noAmmo + '건 · MDU-L 첫소진 ' + (base.mduLDepFirst != null ? base.mduLDepFirst.toFixed(0) + 's' : '없음') + ' (' + base.mduLDepCount + '개 실행서 소진) · 격추율 ' + (base.killRate * 100).toFixed(1) + '%');

console.log('\n# reserveFloor(To-Be 전용) 효과 — MDU-L이 srbm용 6발 보존');
const noRes = agg('tobe', { magazine: true, reserveFloor: false });
const withRes = agg('tobe', { magazine: true, reserveFloor: true });
console.log('  reserveFloor OFF: no_ammo ' + noRes.noAmmo + ' · 보존발동 ' + noRes.reserveTrig);
console.log('  reserveFloor ON : no_ammo ' + withRes.noAmmo + ' · 보존발동 ' + withRes.reserveTrig + ' (mrl_large 교전 시 MDU-L 6발 이하면 제외 → srbm 보존)');

console.log('\n# As-Is/To-Be 비대칭 — reserveFloor는 To-Be만 (GAP 5: As-Is는 잔여 실시간통합 없어 보존 불가)');
const asisRes = agg('asis', { magazine: true, reserveFloor: true }); // As-Is엔 reserveFloor 무효여야
console.log('  As-Is 보존발동 = ' + asisRes.reserveTrig + ' (0이어야 — reserveFloor는 To-Be 전용)');
