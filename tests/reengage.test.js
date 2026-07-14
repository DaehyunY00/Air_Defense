/**
 * K-JAMDS 시뮬레이터 — ⑨ BDA·재교전 회귀 테스트 (feat/stage9-bda)
 * 실행:  node tests/reengage.test.js
 *
 * 자율 진행의 조건: 되돌리기 가능성(플래그 OFF=legacy)·무기별 pk 차등·폴백 경계·결정론.
 * Phase가 늘면 이 파일에 어서션을 이어 붙인다.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var LEGACY = require('./legacy-snapshot.json');

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
var ALL_OFF = { pkByShooter: false, leakCost: false, censorFix: false, timeoutSplit: false, pkCorrelated: false, salvo: false };

// ══════════ 되돌리기 가능성 — 플래그 전부 OFF = stage9 이전(legacy)과 완전 동일 ══════════
// 가장 중요한 어서션. 어떤 Phase를 더해도 이 불변이 깨지면 되돌리기 가능성이 무너진 것이다.
console.log('# 되돌리기 — features 전부 OFF = legacy 지문');
var mism = 0, n = 0;
Object.keys(LEGACY).forEach(function (k) {
  var pr = k.split('/'); n++;
  var g = KJ.runDES({ scenario: KJ.scenarioById(pr[0]), mode: pr[1], intensity: +pr[2], seed: +pr[3], endTimeSec: 1800, features: ALL_OFF }).global;
  var cur = { sp: g.spawned, k: g.killed, l: g.leaked, iM: +g.cost.interceptM.toFixed(4), ex: g.cost.exchange == null ? null : +g.cost.exchange.toFixed(6) };
  if (JSON.stringify(cur) !== JSON.stringify(LEGACY[k])) { mism++; if (mism <= 3) console.log('    불일치 ' + k + ': ' + JSON.stringify(cur) + ' vs ' + JSON.stringify(LEGACY[k])); }
});
assert(mism === 0, 'features 전부 OFF → legacy 지문과 완전 동일 (' + n + ' config, 불일치 ' + mism + ') — 되돌리기 가능성 증명');

// ══════════ Phase 1 — 무기별 pk 차등 (문서값 배선) ══════════
console.log('# Phase 1 — 무기별 pk 차등');
var ftrPk = KJ.nodeById('FTR').engage.pk, shPk = KJ.nodeById('SHORAD-1C').engage.pk;
assert(ftrPk.byThreat.uav_small.mode !== shPk.byThreat.uav_small.mode,
  '동일 위협(uav_small)에 FTR pk(mode ' + ftrPk.byThreat.uav_small.mode + ') ≠ SHORAD pk(mode ' + shPk.byThreat.uav_small.mode + ') — 무기별 차등 확보(사실 b 해소)');
assert(ftrPk.byThreat.uav_small.mode === 0.25 && ftrPk.default.mode === 0.8,
  'FTR: uav Tri(…0.25…)·일반 0.8 — params.md WPN-FTR-PK-01 그대로');
assert(KJ.nodeById('MDU-M').engage.pk.default.mode === 0.8 && KJ.nodeById('SM2-E').engage.pk.default.mode === 0.75,
  'MDU-M 0.8(MSAM2)·SM2 0.75(SM2) — 종전 코드가 뒤섞어 쓰던 값이 무기별로 정정됨');

// pk 폴백은 문서화 안 된 조합(SHORAD 비무인기)에만 국한 — 문서화된 무기는 폴백 0
console.log('# Phase 1 — pk 폴백 경계 (문서값 있는 무기는 폴백 없음)');
var fb = {};
for (var s = 1; s <= 10; s++) {
  ['sc1', 'sc3'].forEach(function (id) {
    ['asis', 'tobe'].forEach(function (m) {
      var g = KJ.runDES({ scenario: KJ.scenarioById(id), mode: m, intensity: 2.5, seed: s, endTimeSec: 1800 }).global;
      Object.keys(g.pkFallback).forEach(function (c) { fb[c] = (fb[c] || 0) + g.pkFallback[c]; });
    });
  });
}
var docWeapons = ['FTR', 'MSAM-1C', 'MDU-M', 'MDU-L', 'SM2-E', 'SM2-W'];
var badFb = Object.keys(fb).filter(function (c) { return docWeapons.indexOf(c.split('×')[0]) !== -1; });
assert(badFb.length === 0, '문서 pk 있는 무기(FTR·MSAM·MDU·SM2)는 폴백 0 — 폴백은 미문서 조합에만 (' + badFb.join(',') + ')');
assert(Object.keys(fb).every(function (c) { return c.indexOf('SHORAD') === 0; }),
  '폴백은 SHORAD 비무인기 조합에만 국한 (params.md에 SHORAD non-uav pk 미문서 — 정직 보고): ' + Object.keys(fb).join(','));

// ══════════ 결정론 ══════════
console.log('# 결정론');
function sig(feat) { var g = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: 7, endTimeSec: 1800, features: feat }).global; return [g.killed, g.leaked, +g.cost.interceptM.toFixed(4)].join(','); }
assert(sig(undefined) === sig(undefined), '동일 seed·기본 플래그 → 동일 결과 (결정론)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
