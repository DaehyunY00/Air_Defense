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

// ══════════ Phase 2 — 방어효율(defenseEfficiency): "안 쏘면 최적" 함정 반전 ══════════
console.log('# Phase 2 — 방어효율(누수 보상)');
var deAsis = 0, deTobe = 0, exUnchanged = true;
for (var s2 = 1; s2 <= 10; s2++) {
  var ga = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2.5, seed: s2, endTimeSec: 1800 }).global;
  var gb = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s2, endTimeSec: 1800 }).global;
  deAsis += ga.cost.defenseEfficiency; deTobe += gb.cost.defenseEfficiency;
  // exchange는 leakCost와 무관하게 불변이어야 함(회귀 안전)
  var gOff = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2.5, seed: s2, endTimeSec: 1800, features: { leakCost: false } }).global;
  if (Math.abs((ga.cost.exchange || 0) - (gOff.cost.exchange || 0)) > 1e-9) exUnchanged = false;
}
assert(deTobe > deAsis, 'defenseEfficiency: To-Be > As-Is (실제 방어 성과 보상 — SC3 x2.5 ' + (deTobe / 10 * 100).toFixed(0) + '% > ' + (deAsis / 10 * 100).toFixed(0) + '%)');
assert(exUnchanged, 'leakCost ON/OFF과 무관하게 exchange 불변 (옵션 B — 회귀 안전)');

// ══════════ Phase 3 — 절단 보정: flow 보존 + 분모 제외 ══════════
console.log('# Phase 3 — 절단 보정');
var flowBad = 0, censOk = 0, cn = 0;
[['sc1', 'asis'], ['sc3', 'asis'], ['sc3', 'tobe']].forEach(function (p) {
  for (var s3 = 1; s3 <= 5; s3++) {
    var g = KJ.runDES({ scenario: KJ.scenarioById(p[0]), mode: p[1], intensity: 2.5, seed: s3, endTimeSec: 1800 }).global; cn++;
    if (g.spawned < g.killed + g.leaked) flowBad++;              // flow 보존
    if (g.censored === g.spawned - g.killed - g.leaked) censOk++; // censored 항등식
  }
});
assert(flowBad === 0, 'flow 보존: spawned ≥ killed + leaked (절단 보정 후에도, ' + cn + ' config)');
assert(censOk === cn, 'censored = spawned − killed − leaked (항등식) — 전 config');
var gOn = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2.5, seed: 3, endTimeSec: 1800, features: { censorFix: true } }).global;
var gOff2 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2.5, seed: 3, endTimeSec: 1800, features: { censorFix: false } }).global;
assert(gOn.killRate > gOff2.killRate && gOff2.censored === 0,
  'censorFix ON → 격추율 상승(분모 제외), OFF → censored=0·legacy 분모 (' + (gOff2.killRate * 100).toFixed(1) + '%→' + (gOn.killRate * 100).toFixed(1) + '%)');

// ══════════ Phase 4 — timeout 분해 + overflow:shooter 재분류 ══════════
console.log('# Phase 4 — timeout 분해(tries 기준) + overflow:shooter 재분류');
// (1) 합 보존: timeout:c2 + timeout:engage (분해 ON) = timeout (분해 OFF) — 같은 위협 집합
var sumSplit = 0, sumLegacy = 0;
for (var s4 = 1; s4 <= 5; s4++) {
  var gOnT = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 1.5, seed: s4, endTimeSec: 1800, features: { timeoutSplit: true } }).global;
  var gOffT = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 1.5, seed: s4, endTimeSec: 1800, features: { timeoutSplit: false } }).global;
  sumSplit += (gOnT.leakReasons['timeout:c2'] || 0) + (gOnT.leakReasons['timeout:engage'] || 0);
  sumLegacy += (gOffT.leakReasons['timeout'] || 0);
}
assert(sumSplit === sumLegacy && sumSplit > 0,
  'timeout:c2 + timeout:engage (분해 ON, ' + sumSplit + ') = timeout (분해 OFF, ' + sumLegacy + ') — 분해는 재라벨링일 뿐 합 보존(되돌리기)');
// timeoutSplit OFF → timeout:c2/engage 코드가 없어야(legacy 단일 코드)
var gOffT2 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: 3, endTimeSec: 1800, features: { timeoutSplit: false } }).global;
assert(!gOffT2.leakReasons['timeout:c2'] && !gOffT2.leakReasons['timeout:engage'],
  'timeoutSplit OFF → timeout:c2/engage 미방출(단일 timeout 코드) — 코드 방출 되돌리기');
// (2) ⑧ no_engage_window와 동일 기준: tries>0 → 비구조. 두 코드 모두 structural:false로 일관
assert(KJ.leakTaxonomy('timeout:engage').structural === false && KJ.leakTaxonomy('no_engage_window').structural === false,
  'timeout:engage·no_engage_window 모두 비구조 — ⑧⑨가 동일 판정(tries>0→비구조) 사용(ADR-004)');
assert(KJ.leakTaxonomy('timeout:c2').structural === true,
  'timeout:c2(tries===0, 교전 미개시) = 구조적 — 앞단 C2·협조 시간 소진');
// (3) overflow:shooter 재분류: 교전채널(shooter) 노드 = 비구조, C2 노드 = 구조
var shooterOv = KJ.leakTaxonomy('overflow:MDU-L'), c2Ov = KJ.leakTaxonomy('overflow:MCRC');
assert(shooterOv.structural === false && c2Ov.structural === true,
  'overflow:MDU-L(교전채널)=비구조 · overflow:MCRC(C2)=구조 — 노드 category 기반 재분류(종전 둘 다 구조 오분류 정정)');

// ══════════ Phase 5 — 재교전 상관 pk(pkCorrelated, 기본 OFF) ══════════
console.log('# Phase 5 — 재교전 상관 pk (기본 OFF = 되돌리기)');
// 기본이 OFF임을 증명: 명시 OFF와 기본(미지정)이 완전 동일
var p5mism = 0;
for (var s5 = 1; s5 <= 6; s5++) {
  var gDef = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s5, endTimeSec: 1800 }).global;
  var gOff5 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s5, endTimeSec: 1800, features: { pkCorrelated: false } }).global;
  if (gDef.killed !== gOff5.killed || gDef.leaked !== gOff5.leaked) p5mism++;
}
assert(p5mism === 0, 'pkCorrelated 기본 = 명시 OFF (기본 OFF·근거 C — 조건 2 준수, ' + p5mism + '/6 불일치)');
// 단조성: ρ가 커질수록 격추율이 감소(재교전 이득 축소) — 상관의 방향 정합
function killRateRho(rho) {
  var sp = 0, k = 0;
  for (var s = 1; s <= 12; s++) {
    var g = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s, endTimeSec: 1800, features: { pkCorrelated: rho > 0, pkCorrelation: rho } }).global;
    sp += g.spawned; k += g.killed;
  }
  return k / sp;
}
var kr0 = killRateRho(0), kr7 = killRateRho(0.7), kr10 = killRateRho(1.0);
assert(kr0 >= kr7 && kr7 >= kr10, '격추율 단조 감소: ρ0 ' + (kr0 * 100).toFixed(1) + '% ≥ ρ0.7 ' + (kr7 * 100).toFixed(1) + '% ≥ ρ1 ' + (kr10 * 100).toFixed(1) + '% (재교전 상관 → 이득 축소)');
assert(kr10 < kr0, '완전상관(ρ=1) 격추율 < 독립(ρ=0) — 재교전이 실패를 구제하지 못함(2022.12.26 방향)');

// ══════════ Phase 6 — 연발(salvo, 기본 OFF) ══════════
console.log('# Phase 6 — 연발 salvo (기본 OFF = 되돌리기)');
var p6mism = 0;
for (var s6 = 1; s6 <= 6; s6++) {
  var gd6 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s6, endTimeSec: 1800 }).global;
  var go6 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s6, endTimeSec: 1800, features: { salvo: false } }).global;
  if (gd6.killed !== go6.killed || Math.abs(gd6.cost.interceptM - go6.cost.interceptM) > 1e-9) p6mism++;
}
assert(p6mism === 0, 'salvo 기본 = 명시 OFF (기본 OFF·doctrine 옵션 — 조건 2, ' + p6mism + '/6 불일치)');
// 격추율 상승·비용 상승 트레이드오프 + missed 감소, no_engage_window 불변(직교)
function salvoAgg(k) {
  var sp = 0, kl = 0, iM = 0, missed = 0, few = 0;
  for (var s = 1; s <= 12; s++) {
    var g = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: s, endTimeSec: 1800, features: { salvo: k > 1, salvoSize: k } }).global;
    sp += g.spawned; kl += g.killed; iM += g.cost.interceptM;
    missed += g.leakReasons['missed'] || 0; few += g.leakReasons['no_engage_window'] || 0;
  }
  return { kr: kl / sp, iM: iM, missed: missed, few: few };
}
var s1 = salvoAgg(1), s2 = salvoAgg(2);
assert(s2.kr > s1.kr && s2.iM > s1.iM, '연발 k=2: 격추율↑(' + (s1.kr * 100).toFixed(1) + '→' + (s2.kr * 100).toFixed(1) + '%) & 요격탄비용↑ — doctrine 트레이드오프');
assert(s2.missed < s1.missed, 'salvo → missed(터미널 실패) 급감 (' + s1.missed + '→' + s2.missed + ') — 겨냥한 누수모드 해소');
assert(Math.abs(s2.few - s1.few) <= s1.few * 0.05, 'salvo → no_engage_window 거의 불변(' + s1.few + '→' + s2.few + ') — 교전창 부족은 doctrine 무관(⑧과 직교)');

// ══════════ Phase 7 — 부수 정정(생존자 편향·교전당 발사수) ══════════
console.log('# Phase 7 — meanTTK 생존자편향 노출 + 교전당 발사수');
var g7 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: 4, endTimeSec: 1800 }).global;
assert(g7.meanTimeToKillN === g7.killed,
  'meanTTK 조건 분모 노출: meanTimeToKillN(' + g7.meanTimeToKillN + ') = killed(' + g7.killed + ') — 조건부 평균(생존자 편향)임을 드러냄');
// 교전당 발사수: 기본(k=1) ≥ 1(재교전으로 1 초과 가능), salvo k=2면 최소 2배 증가
assert(g7.shotsPerEngagement >= 1 && g7.shotsFired >= g7.everEngaged,
  '교전당 발사수 ≥ 1 (재교전 포함, ' + g7.shotsPerEngagement.toFixed(2) + ' — shotsFired ' + g7.shotsFired + ' / everEngaged ' + g7.everEngaged + ')');
var g7s = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: 4, endTimeSec: 1800, features: { salvo: true, salvoSize: 2 } }).global;
assert(g7s.shotsPerEngagement > g7.shotsPerEngagement * 1.5,
  'salvo k=2 → 교전당 발사수 급증 (' + g7.shotsPerEngagement.toFixed(2) + '→' + g7s.shotsPerEngagement.toFixed(2) + ') — 연발 발사 부담 가시화(발사=시도×k, 일부 명령표적은 발사 전 이탈로 k배 미만)');

// ══════════ 결정론 ══════════
console.log('# 결정론');
function sig(feat) { var g = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2.5, seed: 7, endTimeSec: 1800, features: feat }).global; return [g.killed, g.leaked, +g.cost.interceptM.toFixed(4)].join(','); }
assert(sig(undefined) === sig(undefined), '동일 seed·기본 플래그 → 동일 결과 (결정론)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
