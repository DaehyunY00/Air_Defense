/**
 * K-JAMDS 시뮬레이터 — WP2 자체교전(Self-Defense / 자율 교전) 회귀 테스트 (ADR-011)
 * 실행:  node tests/selfdefense.test.js
 *
 * 검증: 되돌리기(OFF 불변)·중복교전 방지(_countedEngaged)·taxonomy 분리·플래그 직교성·
 *       timeout:c2 구제·반응시간 분리·결정론·As-Is 하한 상승(반증 성격).
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'data/fire-units.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(cfg) { return KJ.runDES(cfg); }

// ══════════ 되돌리기 — selfDefense OFF = 불변(추가 RNG 소비 0) ══════════
console.log('# 되돌리기 — selfDefense OFF 불변 (fireUnitLayer OFF/ON 양쪽)');
['sc1', 'sc2', 'sc3'].forEach(function (sc) {
  ['asis', 'tobe'].forEach(function (m) {
    // fireUnitLayer OFF: selfDefense OFF == 미지정(legacy 경로 불변)
    var a = run({ scenario: KJ.scenarioById(sc), mode: m, intensity: 1.5, seed: 2, endTimeSec: 1800 }).global;
    var b = run({ scenario: KJ.scenarioById(sc), mode: m, intensity: 1.5, seed: 2, endTimeSec: 1800, features: { selfDefense: false } }).global;
    assert(a.killed === b.killed && a.leaked === b.leaked && a.cost.interceptM === b.cost.interceptM,
      sc + '/' + m + ' selfDefense OFF = 미지정(불변)');
  });
});
// fireUnitLayer ON에서도 selfDefense가 死 플래그가 아님(SC3에서 거동 변경)
var fuOn = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: true } }).global;
var sdOn = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true } }).global;
assert(sdOn.selfDefense.engagements > 0 && (sdOn.killed !== fuOn.killed), 'selfDefense ON은 거동을 바꾼다(SC3 자체교전 발생·격추 변화)');

// ══════════ 중복교전 방지 — _countedEngaged 위협 이중 발사 안 함 ══════════
console.log('# 중복교전 방지 — everEngaged ≤ spawned · 자체교전은 C2 미교전분만');
['sc1', 'sc2', 'sc3'].forEach(function (sc) {
  ['asis', 'tobe'].forEach(function (m) {
    var g = run({ scenario: KJ.scenarioById(sc), mode: m, intensity: 2, seed: 4, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true } }).global;
    assert(g.everEngaged <= g.spawned, sc + '/' + m + ' everEngaged(' + g.everEngaged + ') ≤ spawned(' + g.spawned + ') — 자체교전 이중계상 없음');
    assert(g.spawned >= g.killed + g.leaked, sc + '/' + m + ' 보존: spawned ≥ killed+leaked (자체교전 포함)');
  });
});

// ══════════ taxonomy 분리 + 반응시간 별도 지표 ══════════
console.log('# taxonomy 분리 — selfDefense 관측 별도·반응시간 meanDecisionDelaySec 미오염');
var r = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 3, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true } });
var sd = r.global.selfDefense;
assert(typeof sd.engagements === 'number' && typeof sd.kills === 'number' && typeof sd.rescuedFromTimeoutC2 === 'number' && typeof sd.iffRiskEngagements === 'number',
  'global.selfDefense = {engagements,kills,rescuedFromTimeoutC2,iffRiskEngagements} 노출');
assert(sd.iffRiskEngagements === sd.engagements, 'iffRiskEngagements = 자체교전 총건수(오격 위험 카운터, ADR-011)');
assert(typeof sd.meanReactionSec === 'number', 'meanSelfDefenseReactionSec 별도 노출(meanDecisionDelaySec 분모와 분리)');
assert(sd.kills <= r.global.killed, '자체격추(kills)는 전체 killed의 부분집합');

// ══════════ 플래그 직교성 — fireUnitLayer OFF + selfDefense ON(집계 폴백) ══════════
console.log('# 직교성 — fireUnitLayer OFF + selfDefense ON (집계 shooter 개념 MFR 폴백)');
var oOff = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 5, endTimeSec: 1800 }).global;
var oSD = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 5, endTimeSec: 1800, features: { selfDefense: true } }).global;
assert(oSD.selfDefense.engagements >= 0 && (oSD.selfDefense.engagements === 0 || oSD.killed !== oOff.killed || oSD.leaked !== oOff.leaked),
  'fireUnitLayer OFF + selfDefense ON 독립 동작(집계 노드 폴백 MFR)');

// ══════════ ADR-011 반증 성격 — As-Is 하한 상승(timeout:c2 구제) ══════════
console.log('# ADR-011 — 자체교전이 As-Is 하한을 올린다(timeout:c2 구제, To-Be 개선폭 축소 방향)');
var a3 = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: true } }).global;
var a3s = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true } }).global;
assert(a3s.killRate >= a3.killRate, 'SC3 As-Is 격추율 자체교전 ON ≥ OFF (하한 상승: ' + (a3.killRate * 100).toFixed(1) + '%→' + (a3s.killRate * 100).toFixed(1) + '%)');
assert((a3s.leakReasons['timeout:c2'] || 0) <= (a3.leakReasons['timeout:c2'] || 0), 'SC3 As-Is timeout:c2 자체교전 ON ≤ OFF (구조적 실패 구제)');

// ══════════ pk 감쇠 — selfDefensePkMult 반영 ══════════
console.log('# pk 감쇠 — selfDefensePkMult 스윕이 격추에 반영');
var hi = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true, selfDefensePkMult: 0.9 } }).global;
var lo = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true, selfDefensePkMult: 0.5 } }).global;
assert(hi.selfDefense.kills >= lo.selfDefense.kills, '높은 pkMult(0.9)의 자체격추 ≥ 낮은 pkMult(0.5) (감쇠 반영)');

// ══════════ 결정론 ══════════
console.log('# 결정론 — 동일 config → 동일 결과');
var d1 = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 7, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true } }).global;
var d2 = run({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 7, endTimeSec: 1800, features: { fireUnitLayer: true, selfDefense: true } }).global;
assert(d1.killed === d2.killed && d1.selfDefense.engagements === d2.selfDefense.engagements, '동일 config 재현성(killed·자체교전 일치)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
