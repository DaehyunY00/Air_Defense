/**
 * K-JAMDS — 자원 최적화(KJADS 원칙 5) 회귀 테스트 (feat/resource-opt)
 * 실행:  node tests/resource.test.js
 *
 * 핵심 불변: (1) costAwareWta는 To-Be 전용 — As-Is 결과 불변(가장 중요), (2) MDU-L 死노드 방지,
 * (3) 제약(SHORAD 탄도 배제)이 비용에 우회되지 않음, (4) SC2 exchangeSat>1(G6-3) 보호, (5) 되돌리기.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, sd, feat) { return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: sd, endTimeSec: 1800, features: feat }).global; }

// ══════════ 되돌리기 — costAwareWta OFF = W=0 (bit-clean, RNG 미소비) ══════════
console.log('# Step 1 되돌리기 — costAwareWta OFF ≡ W=0');
var revMism = 0;
for (var s = 1; s <= 10; s++) {
  var off = run('sc3', 'tobe', 2.5, s, { costAwareWta: false });
  var w0 = run('sc3', 'tobe', 2.5, s, { costAwareWta: true, costWtaWeight: 0 });
  if (off.killed !== w0.killed || off.leaked !== w0.leaked || Math.abs(off.cost.interceptM - w0.cost.interceptM) > 1e-9) revMism++;
}
assert(revMism === 0, 'costAwareWta OFF = W=0 (비용항=1) 완전 일치 (' + revMism + '/10) — 되돌리기');

// ══════════ ★ As-Is 불변 — costAwareWta ON이어도 As-Is 결과 안 바뀐다(To-Be 전용 증명, 가장 중요) ══════════
console.log('# Step 1 ★ As-Is 불변 (costAwareWta는 To-Be 전용)');
var asisMism = 0;
['sc1', 'sc3'].forEach(function (id) {
  for (var sd = 1; sd <= 10; sd++) {
    var aOff = run(id, 'asis', 2.5, sd, { costAwareWta: false });
    var aOn = run(id, 'asis', 2.5, sd, { costAwareWta: true, costWtaWeight: 0.5 }); // ON이어도 As-Is엔 무효
    if (aOff.killed !== aOn.killed || aOff.leaked !== aOn.leaked || Math.abs(aOff.cost.interceptM - aOn.cost.interceptM) > 1e-9) asisMism++;
  }
});
assert(asisMism === 0, 'costAwareWta ON이어도 As-Is 결과 완전 불변 (' + asisMism + '/20) — 정의상 To-Be 전용임의 증명');

// ══════════ MDU-L 生存 — 死노드 방지(ρ > 0.05) ══════════
console.log('# Step 1 MDU-L 生存 (死노드 방지)');
var maxRhoMduL = 0;
[1.0, 1.5, 2.5].forEach(function (x) {
  for (var sd = 1; sd <= 20; sd++) {
    var res = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: x, seed: sd, endTimeSec: 1800, features: { costAwareWta: true, costWtaWeight: 0.5 } });
    (res.nodes || []).forEach(function (n) { if (n.id === 'MDU-L' && n.rho > maxRhoMduL) maxRhoMduL = n.rho; });
  }
});
assert(maxRhoMduL > 0.05, 'MDU-L ρ = ' + maxRhoMduL.toFixed(3) + ' > 0.05 — 비용 인식 후에도 死노드 아님(G3 정신 유지)');

// ══════════ 제약 — SHORAD가 비용이 싸도 ballistic 교전 안 함(canEngage 선행 필터) ══════════
console.log('# Step 1 제약 — 저비용 SHORAD가 탄도에 배정되지 않음');
var sh = KJ.nodeById('SHORAD-1C');
assert(!sh.canEngage.mrl_large && !sh.canEngage.srbm,
  'SHORAD canEngage.mrl_large/srbm = false — 비용 WTA가 제약을 우회하지 못함(§6 금지)');
// 고가유도탄 보존율은 W와 함께 상승(반드시 실효)
var hv0 = 0, hv5 = 0, iM0 = 0, iM5 = 0;
for (var sd2 = 1; sd2 <= 20; sd2++) {
  var g0 = run('sc3', 'tobe', 2.5, sd2, { costAwareWta: false });
  var g5 = run('sc3', 'tobe', 2.5, sd2, { costAwareWta: true, costWtaWeight: 0.5 });
  hv0 += g0.highValueInterceptM; iM0 += g0.cost.interceptM; hv5 += g5.highValueInterceptM; iM5 += g5.cost.interceptM;
}
var preserv0 = 1 - hv0 / iM0, preserv5 = 1 - hv5 / iM5;
assert(preserv5 > preserv0, '고가유도탄 보존율 상승: ' + (preserv0 * 100).toFixed(1) + '% → ' + (preserv5 * 100).toFixed(1) + '% (비용 WTA가 MDU-L 낭비 완화)');

// ══════════ SC2 핵심결론 보호 — exchangeSat > 1 (G6-3) ══════════
console.log('# Step 1 SC2 핵심결론 보호 (G6-3: 무인기 비대칭 미해소)');
var iS = 0, kS = 0;
[1.0, 1.5, 2.5].forEach(function (x) { for (var sd = 1; sd <= 20; sd++) { var g = run('sc2', 'tobe', x, sd, { costAwareWta: true, costWtaWeight: 0.5 }); iS += g.cost.interceptSatM; kS += g.cost.killedThreatSatM; } });
assert(iS / kS > 1, 'SC2 exchangeSat = ' + (iS / kS).toFixed(2) + ' > 1 유지 — 무인기 비용 비대칭 C2로 미해소(G6-3 불변)');

// ══════════ Step 2 — 재고(magazine) + 보존(reserveFloor) ══════════
console.log('# Step 2 되돌리기 — magazine OFF = 현행(ammo=∞, no_ammo 0)');
var naOff = 0;
for (var sd3 = 1; sd3 <= 10; sd3++) { naOff += run('sc3', 'tobe', 2.5, sd3, { magazine: false }).leakReasons['no_ammo'] || 0; }
assert(naOff === 0, 'magazine OFF → no_ammo 0 (' + naOff + ') — 재고 무제한(현행)');
// magazine ON → 소진 발생(no_ammo>0)
var naOn = 0;
for (var sd4 = 1; sd4 <= 10; sd4++) { naOn += run('sc3', 'tobe', 2.5, sd4, { magazine: true, magazineSize: 24 }).leakReasons['no_ammo'] || 0; }
assert(naOn > 0, 'magazine ON(24) → no_ammo ' + naOn + '건 발생 — 유한 재고 소진 재현');
assert(KJ.leakTaxonomy('no_ammo').structural === false, 'no_ammo = 비구조 (C2로 유도탄 수량 안 늘어남 — no_shooter 계열)');
// reserveFloor: To-Be 전용 (As-Is 보존발동 0 — GAP 5)
console.log('# Step 2 ★ reserveFloor는 To-Be 전용 (GAP 5 — As-Is 보존 불가)');
var asisTrig = 0, tobeTrig = 0;
[1.0, 1.5, 2.5].forEach(function (x) {
  for (var sd = 1; sd <= 10; sd++) {
    var ra = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: x, seed: sd, endTimeSec: 1800, features: { magazine: true, reserveFloor: true } });
    var rb = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: x, seed: sd, endTimeSec: 1800, features: { magazine: true, reserveFloor: true } });
    (ra.nodes || []).forEach(function (n) { if (n.id === 'MDU-L') asisTrig += n.reserveTriggers || 0; });
    (rb.nodes || []).forEach(function (n) { if (n.id === 'MDU-L') tobeTrig += n.reserveTriggers || 0; });
  }
});
assert(asisTrig === 0, 'As-Is 보존발동 = ' + asisTrig + ' (0 — reserveFloor는 To-Be 전용, 잔여 실시간통합 부재)');
assert(tobeTrig > 0, 'To-Be 보존발동 = ' + tobeTrig + ' > 0 — MDU-L이 srbm용 재고를 지킴(mrl_large 배정 차단)');

// ══════════ Step 3 — 임계 재가중(thresholdReweight, 기본 OFF) ══════════
console.log('# Step 3 되돌리기 — thresholdReweight 기본 OFF = 현행');
var s3mism = 0;
for (var sd5 = 1; sd5 <= 8; sd5++) {
  var def3 = run('sc3', 'tobe', 2.5, sd5, {});
  var off3 = run('sc3', 'tobe', 2.5, sd5, { thresholdReweight: false });
  if (def3.killed !== off3.killed) s3mism++;
}
assert(s3mism === 0, 'thresholdReweight 기본 = 명시 OFF (' + s3mism + '/8) — 기본 OFF·한계효용 소(ADR-009)');
// magazine OFF면 이중 무효(ammo=∞) — ON이어도 재고 무한이라 감쇠 발동 안 함
var rw1 = run('sc3', 'tobe', 2.5, 4, { thresholdReweight: true, magazine: false });
var rw0 = run('sc3', 'tobe', 2.5, 4, { thresholdReweight: false, magazine: false });
assert(rw1.killed === rw0.killed, 'magazine OFF → thresholdReweight 무효(ammo=∞) — 이중 게이트');

// ══════════ 결정론 ══════════
console.log('# 결정론');
function sig(feat) { var g = run('sc3', 'tobe', 2.5, 7, feat); return [g.killed, g.leaked, +g.cost.interceptM.toFixed(4), +g.highValueInterceptM.toFixed(4)].join(','); }
assert(sig({ costAwareWta: true, costWtaWeight: 0.5 }) === sig({ costAwareWta: true, costWtaWeight: 0.5 }), '동일 seed·설정 → 동일 결과');

console.log(fail === 0 ? '\nOK — 자원 최적화 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
