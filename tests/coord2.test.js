/**
 * K-JAMDS 시뮬레이터 — ⑥⑦ 수평 교전협조·중복교전 회귀 테스트 (Phase 2)
 * 실행:  node tests/coord2.test.js   (저장소 루트에서)
 *
 * Phase 2는 거동 변경(중복교전 모사)이라 refine-snapshot.json이 의도적으로 갱신되었다.
 * 여기서는 새 거동의 정본을 고정한다:
 *  - responsibility_gap(책임공백) 死 코드 부활: As-Is 팬아웃에서 > 0, To-Be에서 ≈ 0
 *  - 중복교전: As-Is > To-Be(=0), 요격탄 이중 소모 발생(As-Is만)
 *  - 보존: 중복교전은 요격탄·engaged만 이중 계상, 격추/누수는 불변(killed+leaked ≤ spawned)
 *  - 결정론 유지
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
function agg(id, mode, x, field) {
  var a = { gaps: 0, dup: 0, dupCost: 0, rgLeak: 0, kill: 0, leak: 0, sp: 0, consViol: 0, decon: 0 };
  for (var s = 1; s <= 10; s++) {
    var r = KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: s, endTimeSec: 1800 });
    var c = r.global.coordination;
    a.gaps += c.gaps; a.dup += c.duplicates; a.decon += c.deconflicted;
    a.dupCost += r.global.cost.duplicateInterceptM;
    a.rgLeak += (r.global.leakReasons['responsibility_gap'] || 0);
    a.kill += r.global.killed; a.leak += r.global.leaked; a.sp += r.global.spawned;
    if (r.global.killed + r.global.leaked > r.global.spawned) a.consViol++;
  }
  return a;
}

// ══════════ 死 코드 부활 — responsibility_gap 발화 ══════════
console.log('# 책임공백(responsibility_gap) 死 코드 부활');
var s1 = agg('sc1', 'asis', 2.5), s3 = agg('sc3', 'asis', 2.5);
assert(s1.gaps > 0, 'SC1 x2.5 As-Is: coordGaps > 0 (책임공백 발화 — 종전 전 시나리오 0건이던 死 코드, ' + s1.gaps + '건)');
assert(s3.gaps > 0, 'SC3 x2.5 As-Is: coordGaps > 0 (' + s3.gaps + '건)');
assert(s1.rgLeak > 0 || s3.rgLeak > 0, 'responsibility_gap이 leakReasons에도 부활 (누수 taxonomy 정합, SC1 ' + s1.rgLeak + ' · SC3 ' + s3.rgLeak + ')');

// ══════════ To-Be는 중복 원천 차단 (JAMDC2 COP 공유·팬아웃 없음) ══════════
console.log('# To-Be 중복 원천 차단');
var t1 = agg('sc1', 'tobe', 2.5), t3 = agg('sc3', 'tobe', 2.5), t2 = agg('sc2', 'tobe', 2.5);
assert(t1.gaps === 0 && t3.gaps === 0 && t2.gaps === 0, 'To-Be 전 시나리오 coordGaps = 0 (팬아웃 없음 → 협조 판정 자체가 없음)');
assert(t1.dup === 0 && t3.dup === 0, 'To-Be 중복교전 = 0');
assert(t1.dupCost === 0 && t3.dupCost === 0, 'To-Be 요격탄 이중 소모 = 0');

// ══════════ 중복교전: As-Is > To-Be, 이중 소모 발생 ══════════
console.log('# 중복교전 As-Is > To-Be');
assert(s1.dup > t1.dup && s3.dup > t3.dup, 'SC1·SC3: As-Is 중복교전 > To-Be (SC1 ' + s1.dup + '>' + t1.dup + ', SC3 ' + s3.dup + '>' + t3.dup + ')');
assert(s1.dup === s1.gaps && s3.dup === s3.gaps, '중복교전 건수 = coordGaps 건수 (협조 실패 1건 → 중복교전 1건)');
assert(s1.dupCost > 0 && s3.dupCost > 0, 'As-Is 요격탄 이중 소모 비용 > 0 (비용교환비 악화 요인)');

// ══════════ SC2: 대부분 협조되지만 확장 ICC 병렬 음성경로에서 일부 gap 발생 ══════════
console.log('# SC2 무인기 버스트 — 확장 ICC 음성협조의 성립·실패가 함께 관측');
var s2 = agg('sc2', 'asis', 2.5);
assert(s2.decon > s2.gaps && s2.gaps > 0 && s2.dup === s2.gaps,
  'SC2 As-Is: 대부분 협조 성립(' + s2.decon + ')하나 확장 ICC 음성경로 일부 책임공백(' + s2.gaps + ')·중복교전 발생');

// ══════════ 보존 — 중복교전은 격추/누수를 이중 계상하지 않는다 ══════════
console.log('# 보존 항등식 (killed+leaked ≤ spawned)');
var viol = 0;
[['sc1', 'asis'], ['sc3', 'asis'], ['sc3', 'tobe']].forEach(function (p) {
  [1.5, 2.5, 3.0].forEach(function (x) { viol += agg(p[0], p[1], x).consViol; });
});
assert(viol === 0, '전 config에서 killed+leaked ≤ spawned (중복교전은 요격탄·engaged만 이중 계상, ' + viol + ' 위반)');

// ══════════ 결정론 ══════════
console.log('# 결정론');
function sig(id, mode, x, sd) {
  var r = KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: sd, endTimeSec: 1800 });
  return JSON.stringify([r.global.coordination, r.global.cost.duplicateInterceptM, r.global.killed, r.global.leaked]);
}
assert(sig('sc3', 'asis', 2.5, 7) === sig('sc3', 'asis', 2.5, 7), '동일 seed → 동일 교전협조·중복·비용·격추·누수 (결정론)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
