/**
 * K-JAMDS 시뮬레이터 — ⑧ 교전/요격명령(WTA) 회귀 테스트 (feat/stage8-wta)
 * 실행:  node tests/wta.test.js
 *
 * Phase 1 교전창 필터·Phase 2 축선 필터·Phase 3 동점 통일의 정본을 고정한다.
 * 편향 원장(scripts/bias-ledger.mjs)과 별개로, 물리 실현가능성·결정론·병목 이동을 검증.
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
function run(id, mode, x, seed, extra) {
  return KJ.runDES(Object.assign({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: 1800 }, extra || {}));
}
/** trace에서 (조건 위협)의 교전명령 무기 집합 수집 */
function engageMarks(res, threatFilter) {
  var picks = {};
  res.threatTraces.forEach(function (tr) {
    if (!threatFilter(tr)) return;
    tr.stages.forEach(function (s) {
      var m = /^교전명령#\d+:(.+)$/.exec(s.name);
      if (m) picks[m[1]] = (picks[m[1]] || 0) + 1;
    });
  });
  return picks;
}

// ══════════ Phase 1 — 교전창: fighter는 FTR을 고르지 않는다 (300s+12 > dwell 180s) ══════════
console.log('# 교전창 필터 — fighter ↛ FTR');
var FTR = KJ.nodeById('FTR');
var cmdFTR = KJ.LINKS.find(function (l) { return l.from === 'MCRC' && l.to === 'FTR' && l.kind === 'command'; });
assert(FTR.engage.engageTimeSec + cmdFTR.comm.tobe.delaySec > KJ.threatType('fighter').dwellSec,
  'FTR lead(engageTimeSec ' + FTR.engage.engageTimeSec + ' + 명령 ' + cmdFTR.comm.tobe.delaySec + ') > fighter dwell ' + KJ.threatType('fighter').dwellSec + ' → 필터가 제외해야 함');
var sc3t = run('sc3', 'tobe', 2.5, 3, { trace: true, traceCap: 300 });
var figPicks = engageMarks(sc3t, function (tr) { return tr.type === 'fighter'; });
assert(!figPicks.FTR, 'SC3 To-Be: fighter 교전명령에 FTR 없음 (확정 실패 무기 제거) — 선택: ' + JSON.stringify(figPicks));
assert(Object.keys(figPicks).length > 0, 'fighter는 다른 무기로 교전됨 (교전 자체가 사라진 게 아님)');

// ══════════ Phase 2 — 축선: SM2-E는 west 축 위협을 교전하지 않는다 ══════════
console.log('# 축선 필터 — SM2-E ↛ west');
assert(KJ.nodeById('SM2-E').coverage.indexOf('west') === -1, 'SM2-E coverage에 west 없음(east·central)');
var sc1t = run('sc1', 'asis', 2.5, 3, { trace: true, traceCap: 300 });
var westToSM2E = 0;
sc1t.threatTraces.forEach(function (tr) {
  if (tr.axis !== 'west') return;
  tr.stages.forEach(function (s) { if (/^교전명령#\d+:SM2-E$/.test(s.name)) westToSM2E++; });
});
assert(westToSM2E === 0, 'SC1 As-Is: west 축 위협을 SM2-E가 교전한 건수 0 (종전 서부 순항 요격 결함 해소)');

// ══════════ no_shooter / no_engage_window ══════════
console.log('# 실패코드 — no_engage_window 신설 발화 · no_shooter는 grounded coverage로 0');
var nw = 0, nsh = 0;
[['sc1', 'asis'], ['sc3', 'asis'], ['sc3', 'tobe']].forEach(function (p) {
  for (var s = 1; s <= 5; s++) {
    var g = run(p[0], p[1], 2.5, s).global;
    nw += (g.leakReasons['no_engage_window'] || 0);
    nsh += (g.leakReasons['no_shooter'] || 0);
  }
});
assert(nw > 0, 'no_engage_window 발화 > 0 (⑧ 신규 실패코드 — 종전 timeout에 은폐되던 교전창 부족, ' + nw + '건)');
assert(nsh === 0, 'no_shooter = 0 (grounded coverage에선 FTR·MDU-L이 universal backstop이라 절대 공백 없음 — 억지 부활 안 함)');
// coverage 취약 지도: 단일무기 취약 조합이 실재
function capableOf(type, axis) {
  return KJ.nodesInMode('tobe').filter(function (n) {
    return n.category === 'shooter' && n.canEngage[type] && (!n.coverage || n.coverage.indexOf(axis) !== -1);
  }).map(function (n) { return n.id; });
}
assert(capableOf('uav_small', 'central').join() === 'FTR',
  'uav_small@central 단일무기 취약: FTR 단독 (중부축 무인기용 단거리 방공 부재 — 정책 취약점)');
assert(capableOf('mrl_large', 'east').join() === 'MDU-L',
  'mrl_large@east 단일무기 취약: MDU-L 단독 (병목 이동 신호와 일치)');

// ══════════ canEngage 제약 유지 (신궁·천마 탄도탄 불가) ══════════
console.log('# canEngage 제약 유지');
var shBad = 0;
['asis', 'tobe'].forEach(function (m) {
  var r = run('sc3', m, 3, 11, { trace: true, traceCap: 300 });
  r.threatTraces.forEach(function (tr) {
    if (tr.type !== 'srbm' && tr.type !== 'mrl_large') return;
    tr.stages.forEach(function (s) { if (/^교전명령#\d+:SHORAD/.test(s.name)) shBad++; });
  });
});
assert(shBad === 0, '신궁·천마(SHORAD)가 탄도탄(srbm·mrl_large)을 교전한 건수 0 (canEngage 제약 — 축선 필터 도입 후에도 유지)');

// ══════════ 동점 결정론 · 병목 이동 ══════════
console.log('# 결정론 · 병목 이동');
function wsig(id, mode, x, sd) {
  return JSON.stringify(run(id, mode, x, sd).nodes.filter(function (n) { return n.category === 'shooter'; }).map(function (n) { return [n.id, n.arrivals, n.rho]; }));
}
assert(wsig('sc3', 'tobe', 2.5, 7) === wsig('sc3', 'tobe', 2.5, 7), '동일 seed → 동일 무기 선택·이용률 (동점 통일 결정론)');
function shArr(res) { return res.nodes.filter(function (n) { return n.category === 'shooter'; }).reduce(function (s, n) { return s + n.arrivals; }, 0); }
var a25 = shArr(run('sc3', 'asis', 2.5, 3)), b25 = shArr(run('sc3', 'tobe', 2.5, 3));
assert(b25 > a25, 'SC3 x2.5: To-Be 무기 총 도착 > As-Is (병목 이동 신호 유지 — ' + b25 + ' > ' + a25 + ')');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
