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
var ARMY_DIRECT = ['ADC2A-W', 'LLR-1C', 'LLR-CD'];

console.log('# Phase 3 — 센서→JAMDC2 직결: ①②(탐지·라우팅) 독립성');

// 직결 링크 토글 헬퍼 (KJ.LINKS를 필터해 원복)
function withDirect(hasDirect, fn) {
  var saved = KJ.LINKS;
  if (!hasDirect) {
    KJ.LINKS = saved.filter(function (l) {
      return !(l.to === 'JAMDC2' && ARMY_DIRECT.indexOf(l.from) !== -1);
    });
  }
  try { return fn(); } finally { KJ.LINKS = saved; }
}
function detectedSeq(scn) {
  var out = [];
  for (var s = 1; s <= 5; s++) out.push(KJ.runDES({ scenario: scn, mode: 'tobe', intensity: 1.5, seed: s, endTimeSec: 1800 }).global.detected);
  return out;
}

// 대조군: 육군센서가 커버하지 않는 위협(fighter@east — ACR-E·E737·AEGIS-E만 커버) →
// 직결 규칙이 발동하지 않으므로 직결 링크 유무와 무관하게 tobe detected가 bitwise 동일해야 한다.
var ctrl = { id: 'ctrl', name: '독립성 대조(육군센서 무커버)', mix: [{ type: 'fighter', axis: 'east', ratePerMin: 1 }] };
var ctrlOff = withDirect(false, function () { return detectedSeq(ctrl); });
var ctrlOn = withDirect(true, function () { return detectedSeq(ctrl); });
assert(JSON.stringify(ctrlOff) === JSON.stringify(ctrlOn),
  '①②독립성: 육군센서 무커버 시 직결 유무와 무관하게 tobe detected bitwise 동일 (' + JSON.stringify(ctrlOn) + ')');

// 토글이 실제로 무언가를 바꾼다는 것을 보장(대조 어서션이 vacuous가 아님을 증명):
// 육군센서 커버 위협(uav_small@seoul)에서는 직결 링크가 켜지면 라우팅이 달라진다.
var seoul = { id: 'seoul', name: '육군센서 커버', mix: [{ type: 'uav_small', axis: 'seoul', ratePerMin: 0.5 }] };
var routeOff = withDirect(false, function () { return KJ.runDES({ scenario: seoul, mode: 'tobe', intensity: 1.5, seed: 3, endTimeSec: 1800 }); });
var routeOn = withDirect(true, function () { return KJ.runDES({ scenario: seoul, mode: 'tobe', intensity: 1.5, seed: 3, endTimeSec: 1800 }); });
function hasDirectLink(res) {
  return res.links.some(function (l) { return l.to === 'JAMDC2' && ARMY_DIRECT.indexOf(l.from) !== -1; });
}
assert(hasDirectLink(routeOn) && !hasDirectLink(routeOff),
  '직결 발동 확인: 육군센서 커버 위협은 켜짐에서만 센서→JAMDC2 직결 링크가 발화(토글 유효 — 대조군 non-vacuous)');
// 직결은 To-Be 전용 — As-Is에서는 절대 발화하지 않는다.
var asisRun = KJ.runDES({ scenario: seoul, mode: 'asis', intensity: 1.5, seed: 3, endTimeSec: 1800 });
assert(!hasDirectLink(asisRun), 'As-Is에서는 센서→JAMDC2 직결 링크 미발화 (To-Be 전용 comm)');

// 직결 대상이 육군 3개로 한정됨(공/해군 광역센서는 직결 제외 — 설계 근거 회귀 고정)
var directDefs = KJ.LINKS.filter(function (l) { return l.to === 'JAMDC2' && l.kind === 'report' && KJ.nodeById(l.from) && KJ.nodeById(l.from).category === 'sensor'; });
assert(directDefs.length === 3 && directDefs.every(function (l) { return ARMY_DIRECT.indexOf(l.from) !== -1 && !l.comm.asis && l.comm.tobe; }),
  '센서→JAMDC2 직결 = 육군 3개(ADC2A-W·LLR-1C·LLR-CD) 한정 · To-Be 전용(asis 키 없음)');

console.log(fail ? ('\nFAILED — ' + fail + '건') : '\n통과 (전 어서션)');
process.exit(fail ? 1 : 0);
