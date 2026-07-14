/**
 * 자원최적화 Step 1 — 비용 인식 WTA. W 스윕 + MDU-L 死노드 검사 + 반증실험.
 * 실행: node scripts/step1-cost-wta.mjs
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

function pool(mode, feat, scenFilter) {
  let sp = 0, k = 0, l = 0, iS = 0, kS = 0, iM = 0, kM = 0, lM = 0, hvM = 0, etv = 0, neg = 0, ofMduM = 0;
  let rhoMduL = 0, rhoMduM = 0, dropMduM = 0, cnt = 0;
  (scenFilter || SCEN).forEach(id => XS.forEach(x => SEEDS.forEach(sd => {
    const r = KJ.runDES({ scenario: KJ.scenarioById(id), mode, intensity: x, seed: sd, endTimeSec: 1800, features: feat });
    const g = r.global, c = g.cost;
    sp += g.spawned; k += g.killed; l += g.leaked;
    iS += c.interceptSatM; kS += c.killedThreatSatM; iM += c.interceptM; kM += c.killedThreatM; lM += (c.leakedThreatM || 0);
    hvM += g.highValueInterceptM; etv += g.engagedThreatValueM;
    neg += g.leakReasons['no_engage_window'] || 0;
    Object.keys(g.leakReasons).forEach(cd => { if (cd === 'overflow:MDU-M') ofMduM += g.leakReasons[cd]; });
    (r.nodes || []).forEach(n => {
      if (n.id === 'MDU-L') { if (n.rho > rhoMduL) rhoMduL = n.rho; }
      if (n.id === 'MDU-M') { if (n.rho > rhoMduM) rhoMduM = n.rho; dropMduM += n.drops; }
    });
    cnt++;
  })));
  return {
    killRate: k / sp, leakRate: l / sp,
    exchangeSat: kS > 0 ? iS / kS : null,
    defEff: (kM + lM) > 0 ? kM / (kM + lM) : 0,
    hvPreserv: iM > 0 ? 1 - hvM / iM : 1,
    intPerThreatVal: etv > 0 ? iM / etv : null,
    rhoMduL, rhoMduM, dropMduM, neg
  };
}

const pp = v => (v * 100).toFixed(1) + '%', f2 = v => v == null ? '—' : v.toFixed(2);

// 되돌리기: costAwareWta OFF = 현행(비용항 없음). W항이 곱해지지 않아 legacy 점수식.
console.log('# 되돌리기 검증 — costAwareWta OFF vs W=0 (동일해야: bit-clean)');
let mism = 0;
SEEDS.slice(0, 8).forEach(sd => ['sc3'].forEach(id => {
  const a = KJ.runDES({ scenario: KJ.scenarioById(id), mode: 'tobe', intensity: 2.5, seed: sd, endTimeSec: 1800, features: { costAwareWta: false } }).global;
  const b = KJ.runDES({ scenario: KJ.scenarioById(id), mode: 'tobe', intensity: 2.5, seed: sd, endTimeSec: 1800, features: { costAwareWta: true, costWtaWeight: 0 } }).global;
  if (a.killed !== b.killed || a.leaked !== b.leaked || Math.abs(a.cost.interceptM - b.cost.interceptM) > 1e-9) mism++;
}));
console.log('  OFF vs W=0 불일치: ' + mism + ' (0이어야 — W=0은 비용항=1 → 현행)');

console.log('\n# W 스윕 (To-Be, seed1~20 × SC1/2/3 × x1/1.5/2.5 풀링)');
console.log('W     | 격추율 | 누수율 | exchSat | defEff | 고가보존 | MDU-L ρ | MDU-M ρ/drops | no_eng_win');
[0, 0.25, 0.5, 0.75, 1.0].forEach(w => {
  const r = pool('tobe', { costAwareWta: w > 0, costWtaWeight: w });
  console.log(String(w).padEnd(5) + ' | ' + pp(r.killRate).padStart(6) + ' | ' + pp(r.leakRate).padStart(6) + ' | ' +
    f2(r.exchangeSat).padStart(7) + ' | ' + pp(r.defEff).padStart(6) + ' | ' + pp(r.hvPreserv).padStart(7) + ' | ' +
    r.rhoMduL.toFixed(3).padStart(7) + ' | ' + r.rhoMduM.toFixed(3) + '/' + r.dropMduM + ' | ' + r.neg);
});

console.log('\n# SC2(무인기) 핵심결론 보호 — exchangeSat > 1 유지 확인 (W별)');
[0, 0.5, 1.0].forEach(w => {
  const r = pool('tobe', { costAwareWta: w > 0, costWtaWeight: w }, ['sc2']);
  console.log('  W=' + w + ': SC2 exchangeSat = ' + f2(r.exchangeSat) + (r.exchangeSat > 1 ? ' ✓(>1 유지)' : ' 🔴 붕괴!'));
});
