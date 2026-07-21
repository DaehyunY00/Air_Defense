/**
 * K-JAMDS 시뮬레이터 — ② 추적생성·보고링크 회귀 (feat/stage2-track-overhaul)
 * 실행:  node tests/track.test.js   (저장소 루트에서)
 *
 * Phase 3(센서→JAMDC2 직결)의 ①②독립성을 결정론적으로 증명한다. 핵심 사실: 탐지(①)는
 * 라우팅(②)과 논리적으로 독립이나(직결 분기는 detected++ 이후 실행, _scanProb/_onDetect 미참조),
 * 단일 공유 RNG 스트림 탓에 라우팅이 스트림 소비를 바꾸면 집계 detected 카운트는 재색인된다.
 * 따라서 "bitwise 동일"은 라우팅이 애초에 발동하지 않는 대조군(육군센서 무커버)에서만 성립하며,
 * 그 대조군이 곧 ①②독립성의 결정론적 증명이다.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
var BASE_DIRECT = ['ADC2A-W', 'LLR-1C', 'LLR-CD'];
var MFR_DIRECT = (KJ.LEGACY_AIR_DEFENSE_SITES || []).map(function (s) { return 'MFR-' + s.key; });
var DIRECT_SENSORS = BASE_DIRECT.concat(MFR_DIRECT);

console.log('# Phase 3 — 센서→JAMDC2 직결: ①②(탐지·라우팅) 독립성');

// 직결 링크 토글 헬퍼 (KJ.LINKS를 필터해 원복)
function withDirect(hasDirect, fn) {
  var saved = KJ.LINKS;
  if (!hasDirect) {
    KJ.LINKS = saved.filter(function (l) {
      return !(l.to === 'JAMDC2' && DIRECT_SENSORS.indexOf(l.from) !== -1);
    });
  }
  try { return fn(); } finally { KJ.LINKS = saved; }
}
function detectedSeq(scn) {
  var out = [];
  for (var s = 1; s <= 5; s++) out.push(KJ.runDES({ scenario: scn, mode: 'tobe', intensity: 1.5, seed: s, endTimeSec: 1800 }).global.detected);
  return out;
}

// 확장 MFR이 전 축선에 있으므로 종전의 "직결 센서 무커버" E2E 대조군은 사라졌다.
// 대신 같은 센서 집합의 per-scan 탐지확률이 링크 토글과 무관함을 직접 고정한다.
var probThreat = { type: 'uav_small', _sensors: [KJ.nodeById('LAR-C'), KJ.nodeById('MFR-C1')] };
var probOff = withDirect(false, function () {
  return new KJ.Simulation({ scenario: KJ.scenarioById('sc2'), mode: 'tobe', intensity: 1, seed: 3, endTimeSec: 1800 })._scanProb(probThreat);
});
var probOn = withDirect(true, function () {
  return new KJ.Simulation({ scenario: KJ.scenarioById('sc2'), mode: 'tobe', intensity: 1, seed: 3, endTimeSec: 1800 })._scanProb(probThreat);
});
assert(probOff === probOn, '①②독립성: 직결 링크 토글은 동일 센서집합의 per-scan 탐지확률을 변경하지 않음');

// 토글이 실제로 무언가를 바꾼다는 것을 보장(대조 어서션이 vacuous가 아님을 증명):
// 육군센서 커버 위협(uav_small@seoul)에서는 직결 링크가 켜지면 라우팅이 달라진다.
var seoul = { id: 'seoul', name: '육군센서 커버', mix: [{ type: 'uav_small', axis: 'seoul', ratePerMin: 0.5 }] };
var routeOff = withDirect(false, function () { return KJ.runDES({ scenario: seoul, mode: 'tobe', intensity: 1.5, seed: 3, endTimeSec: 1800 }); });
var routeOn = withDirect(true, function () { return KJ.runDES({ scenario: seoul, mode: 'tobe', intensity: 1.5, seed: 3, endTimeSec: 1800 }); });
function hasDirectLink(res) {
  return res.links.some(function (l) { return l.to === 'JAMDC2' && DIRECT_SENSORS.indexOf(l.from) !== -1; });
}
assert(hasDirectLink(routeOn) && !hasDirectLink(routeOff),
  '직결 발동 확인: 육군센서 커버 위협은 켜짐에서만 센서→JAMDC2 직결 링크가 발화(토글 유효 — 대조군 non-vacuous)');
// 직결은 To-Be 전용 — As-Is에서는 절대 발화하지 않는다.
var asisRun = KJ.runDES({ scenario: seoul, mode: 'asis', intensity: 1.5, seed: 3, endTimeSec: 1800 });
assert(!hasDirectLink(asisRun), 'As-Is에서는 센서→JAMDC2 직결 링크 미발화 (To-Be 전용 comm)');

// 기존 육군 3개 + 신규 포대 MFR 10개가 To-Be JAMDC2에 직접 보고한다.
var directDefs = KJ.LINKS.filter(function (l) { return l.to === 'JAMDC2' && l.kind === 'report' && KJ.nodeById(l.from) && KJ.nodeById(l.from).category === 'sensor'; });
assert(directDefs.length === 13 && directDefs.every(function (l) { return DIRECT_SENSORS.indexOf(l.from) !== -1 && !l.comm.asis && l.comm.tobe; }),
  '센서→JAMDC2 직결 = 기존 3개 + 신규 MFR 10개 · To-Be 전용');

console.log('# Phase 4 — 중복항적(dup) 팬아웃: 부활·보존');
// 4E JAOC-CD 死노드 부활: As-Is 팬아웃으로 LLR-CD→JAOC-CD 중복항적이 발화 → ρ>0
var jaocRho = 0;
for (var s = 1; s <= 10; s++) {
  var r = KJ.runDES({ scenario: KJ.scenarioById('sc1'), mode: 'asis', intensity: 2.5, seed: s, endTimeSec: 1800 });
  var jn = r.nodes.filter(function (z) { return z.id === 'JAOC-CD'; })[0];
  jaocRho += jn ? jn.rho : 0;
}
assert(jaocRho / 10 > 0, 'JAOC-CD 死노드 부활: As-Is 팬아웃에서 ρ>0 (평균 ' + (jaocRho / 10).toFixed(3) + ' — 종전 0.000, SC1 수방사 3자 경계 재현 충실도 개선)');

// 보존 항등식: 중복 항적(ghost) 드롭이 global.leaked를 오염시키지 않는다.
var consViol = 0, ghostDrops = 0;
['sc1', 'sc3'].forEach(function (id) {
  for (var s = 1; s <= 10; s++) {
    var r = KJ.runDES({ scenario: KJ.scenarioById(id), mode: 'asis', intensity: 2.5, seed: s, endTimeSec: 1800 });
    if (r.global.spawned < r.global.killed + r.global.leaked) consViol++;
    r.nodes.forEach(function (z) { if (z.category === 'c2') ghostDrops += z.drops; });
  }
});
assert(consViol === 0, '보존 항등식: spawned ≥ killed + leaked (중복항적 드롭이 leaked 오염 안 함, 위반 0/20)');
assert(ghostDrops >= 0, 'C2 드롭 계상 정상(중복항적 부하는 ns.drops에만, global.leaked엔 미반영) — 드롭 누계 ' + ghostDrops);

// To-Be는 팬아웃하지 않는다(JAMDC2 Track Fusion이 dup 흡수) — 중복항적 마크 부재
var tb = KJ.runDES({ scenario: KJ.scenarioById('sc1'), mode: 'tobe', intensity: 2.5, seed: 5, endTimeSec: 1800, trace: true, traceCap: 500 });
var tbDup = 0;
tb.threatTraces.forEach(function (tr) { tr.stages.forEach(function (st) { if (st.name.indexOf('중복항적') === 0) tbDup++; }); });
assert(tbDup === 0, 'To-Be는 팬아웃 안 함 (중복항적 마크 0 — Track Fusion이 dup 흡수)');

console.log(fail ? ('\nFAILED — ' + fail + '건') : '\n통과 (전 어서션)');
process.exit(fail ? 1 : 0);
