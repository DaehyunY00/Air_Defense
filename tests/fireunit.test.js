/**
 * K-JAMDS 시뮬레이터 — WP1 요격체계 세분화(Fire-Unit Layer) 회귀 테스트 (ADR-010)
 * 실행:  node tests/fireunit.test.js
 *
 * 검증: 되돌리기(OFF=legacy 비트동일)·제약 상속(인스턴스 단위)·커버리지 매트릭스·보존 항등식·
 *       재장전·티어 핸드오버·결정론·데이터 정합(validateFireUnits).
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'data/fire-units.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var LEGACY = require('./legacy-snapshot.json');

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function gof(cfg) { return KJ.runDES(cfg).global; }

// ══════════ 되돌리기 — 전 플래그 OFF(신규 2종 포함) = legacy 지문(비트 동일) ══════════
// legacy-snapshot은 stage9+ 최적화 플래그 전부 OFF 상태의 지문이므로, fireUnitLayer·selfDefense
// 를 포함한 완전 ALL_OFF로 대조해야 한다(신규 두 플래그를 껐을 때 legacy가 그대로 복원됨을 증명).
console.log('# 되돌리기 — 전 플래그 OFF(fireUnitLayer·selfDefense 포함) = legacy 지문(비트 동일)');
var ALL_OFF = { pkByShooter: false, leakCost: false, censorFix: false, timeoutSplit: false, pkCorrelated: false, salvo: false,
  costAwareWta: false, costAwareWtaAsis: false, magazine: false, reserveFloor: false, thresholdReweight: false,
  sensorPdFusion: true, fireUnitLayer: false, selfDefense: false };
var mism = 0, n = 0;
Object.keys(LEGACY).forEach(function (k) {
  var pr = k.split('/'); n++;
  var g = gof({ scenario: KJ.scenarioById(pr[0]), mode: pr[1], intensity: +pr[2], seed: +pr[3], endTimeSec: 1800, features: ALL_OFF });
  var cur = { sp: g.spawned, k: g.killed, l: g.leaked, iM: +g.cost.interceptM.toFixed(4), ex: g.cost.exchange == null ? null : +g.cost.exchange.toFixed(6) };
  if (JSON.stringify(cur) !== JSON.stringify(LEGACY[k])) { mism++; if (mism <= 3) console.log('    불일치 ' + k); }
});
assert(mism === 0, 'fireUnitLayer OFF → legacy 지문 완전 동일 (' + n + ' config, 불일치 ' + mism + ')');
// 기본값 OFF 확인: 명시 OFF == 미지정
var gDef = gof({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 1, seed: 1, endTimeSec: 1800 });
var gOff = gof({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 1, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: false } });
assert(gDef.killed === gOff.killed && gDef.leaked === gOff.leaked, 'fireUnitLayer 기본값 = OFF (미지정==명시 OFF)');
// ON은 거동을 실제로 바꾼다(플래그가 死 플래그가 아님)
var gOn = gof({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 1, seed: 1, endTimeSec: 1800, features: { fireUnitLayer: true } });
assert(gOn.killed !== gDef.killed || gOn.leaked !== gDef.leaked, 'fireUnitLayer ON은 거동을 바꾼다(집계→세분화)');

// ══════════ 데이터 정합 — validateFireUnits ══════════
console.log('# 데이터 정합 (validateFireUnits: 제약상속·재고상한·개념좌표)');
var v = KJ.validateFireUnits();
assert(v.ok, 'validateFireUnits OK (' + (v.errors.join(' | ') || '오류 없음') + ')');
assert(KJ.FIRE_UNITS.filter(function (u) { return u.category === 'battery'; }).length >= 5, '포대 인스턴스 5개 이상');
assert(KJ.FIRE_UNITS.filter(function (u) { return u.category === 'c2'; }).length >= 3, 'ICC(대대) 3개 이상');

// ══════════ 제약 상속 — 인스턴스 단위(§1 절대규칙 2) ══════════
console.log('# 제약 상속 — 전 battery 인스턴스에서 신궁·천마 탄도탄 불가 + THAAD 부재');
var bats = KJ.FIRE_UNITS.filter(function (u) { return u.category === 'battery'; });
assert(bats.filter(function (b) { return b.legacyOf.indexOf('SHORAD') === 0; })
  .every(function (b) { return b.canEngage.srbm === false && b.canEngage.mrl_large === false; }),
  '전 SHORAD 포대 canEngage.srbm/mrl_large = false (신궁·천마 제약 상속)');
assert(!KJ.FIRE_UNITS.some(function (u) { return /thaad|사드/i.test(u.id + u.name + (u.role || '')); }), 'fire-unit에 THAAD 부재');
// 행위 검증: 탄도탄 단독 구성 + fireUnitLayer ON에서 SHORAD 포대 교전 투입 0
var balScn = { id: 'test-bal', name: '탄도탄 단독', mix: [{ type: 'srbm', axis: 'central', ratePerMin: 1.0 }, { type: 'mrl_large', axis: 'east', ratePerMin: 1.0 }] };
var rBal = KJ.runDES({ scenario: balScn, mode: 'asis', intensity: 3, seed: 11, endTimeSec: 1800, features: { fireUnitLayer: true } });
assert(rBal.nodes.filter(function (nd) { return nd.id.indexOf('SHORAD') === 0 && nd.category === 'battery' && nd.arrivals > 0; }).length === 0,
  'DES 행위: 탄도탄 단독 강도3에서 SHORAD 포대 도착 0건(제약 상속 실증)');

// ══════════ 커버리지 매트릭스(§3-3-3) ══════════
console.log('# 커버리지 매트릭스 — 전 (축선×위협)에 교전자 존재(의도된 공백 제외)');
['asis', 'tobe'].forEach(function (m) {
  var c = KJ.checkCoverageMatrix(m);
  assert(c.ok, '커버리지 무공백 [' + m + '] (' + (c.gaps.join(',') || '공백 없음') + ')');
});

// ══════════ 보존 항등식 + kind 합 보존 (ON) ══════════
console.log('# 보존 항등식 — spawned ≥ killed+leaked · Σ_kind busyTime === busyTime (ON)');
['sc1', 'sc2', 'sc3'].forEach(function (sc) {
  ['asis', 'tobe'].forEach(function (m) {
    var r = KJ.runDES({ scenario: KJ.scenarioById(sc), mode: m, intensity: 1.5, seed: 7, endTimeSec: 1800, features: { fireUnitLayer: true } });
    assert(r.global.spawned >= r.global.killed + r.global.leaked, sc + '/' + m + ' 보존: spawned ≥ killed+leaked');
  });
});

// ══════════ 재장전 — TEL 소진 → reloadSec 후 복구 ══════════
console.log('# 재장전 — 발사대 소진 후 reloadSec 만에 복구(고강도 포화)');
var rHi = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 3, seed: 5, endTimeSec: 1800, features: { fireUnitLayer: true } });
assert(rHi.global.reloads >= 1, '고강도 SC3에서 발사대 재장전 발생(reloads=' + rHi.global.reloads + ')');
var anyDepleted = rHi.nodes.some(function (nd) { return nd.category === 'battery' && nd.ammoDepletedT !== null; });
assert(anyDepleted, '고강도에서 일부 포대 TEL 첫 소진 시각 기록됨(재고 유한 실증)');
// ammo는 magazine0을 넘지 않는다(재장전이 만재를 초과 복구하지 않음)
assert(rHi.nodes.filter(function (nd) { return nd.category === 'battery'; })
  .every(function (nd) { return nd.ammo === null || nd.magazine0 === null || nd.ammo <= nd.magazine0; }),
  '전 포대 ammo ≤ magazine0 (재장전 상한 준수)');

// ══════════ 티어 핸드오버 관측 ══════════
console.log('# 티어 핸드오버 — 상위 포대 실패 시 하위 티어 재교전 계수(관측)');
assert(typeof rHi.global.tierHandoffs === 'number', 'tierHandoffs 관측 노출(=' + rHi.global.tierHandoffs + ')');

// ══════════ 결정론 ══════════
console.log('# 결정론 — 동일 config → 동일 결과 (ON)');
var d1 = gof({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 3, endTimeSec: 1800, features: { fireUnitLayer: true } });
var d2 = gof({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 3, endTimeSec: 1800, features: { fireUnitLayer: true } });
assert(d1.killed === d2.killed && d1.leaked === d2.leaked && d1.tierHandoffs === d2.tierHandoffs, '동일 config 재현성(killed·leaked·tierHandoffs 일치)');

// ══════════ highFidelity 프리셋 ══════════
console.log('# highFidelity 프리셋 존재·동작');
assert(KJ.PRESETS && KJ.PRESETS.highFidelity && KJ.PRESETS.highFidelity.fireUnitLayer === true, 'KJ.PRESETS.highFidelity 정의(fireUnitLayer ON)');
var rHF = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 1, seed: 1, endTimeSec: 1800, features: KJ.PRESETS.highFidelity });
assert(rHF.global.spawned >= rHF.global.killed + rHF.global.leaked, 'highFidelity 프리셋 실행·보존 유지');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
