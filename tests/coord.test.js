/**
 * K-JAMDS 시뮬레이터 — ⑥⑦ 결심·교전협조 회귀 테스트 (Phase 1)
 * 실행:  node tests/coord.test.js   (저장소 루트에서)
 *
 * Phase 1B: 결심지연을 [협조 홉 지연 + 잔여(C2 처리·승인 대기)]로 분해 — 합·부분집합 관계.
 * Phase 1C: coordPath를 홉수 BFS → 최소지연 다익스트라로 교체 — "느린 1홉 대신 빠른 N홉" 선택.
 * (Phase 2의 responsibility_gap·중복교전 어서션은 tests/coord2.test.js에서 별도 — 엔진 거동 변경 동반)
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
function run(id, mode, x, seed) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: 1800 });
}

// ══════════ 1C — 다익스트라: 최소'지연' 경로 (홉수 아님) ══════════
console.log('# 1C 다익스트라 coordPath — 느린 1홉 대신 빠른 N홉');
var slow = { type: 'voice', delaySec: 200 }, fast = { type: 'datalink', delaySec: 2 };
var G = [
  { from: 'A', to: 'Z', kind: 'coord', comm: { asis: slow } },   // 1홉 200s
  { from: 'A', to: 'B', kind: 'coord', comm: { asis: fast } },
  { from: 'B', to: 'C', kind: 'coord', comm: { asis: fast } },
  { from: 'C', to: 'Z', kind: 'coord', comm: { asis: fast } }    // 3홉 합 6s
];
var p = KJ._coordPath('A', 'Z', 'asis', G);
var total = p.reduce(function (s, l) { return s + l.comm.asis.delaySec; }, 0);
assert(p.length === 3 && total === 6,
  '빠른 3홉(6s) 선택 (BFS였다면 느린 1홉 200s 선택 — 홉수 최소화 결함) [' +
  p.map(function (l) { return l.from + '→' + l.to; }).join(' ') + ' = ' + total + 's]');
// 결정론: 동일 입력 → 동일 경로
var p2 = KJ._coordPath('A', 'Z', 'asis', G);
assert(JSON.stringify(p.map(function (l) { return l.from + l.to; })) === JSON.stringify(p2.map(function (l) { return l.from + l.to; })),
  '다익스트라 결정론 (동일 입력 → 동일 경로)');
// 동점 tiebreak: 같은 지연의 두 경로 → 노드 id 사전순으로 결정론적 선택
var Gtie = [
  { from: 'A', to: 'M', kind: 'coord', comm: { asis: fast } },
  { from: 'A', to: 'B', kind: 'coord', comm: { asis: fast } },
  { from: 'M', to: 'Z', kind: 'coord', comm: { asis: fast } },
  { from: 'B', to: 'Z', kind: 'coord', comm: { asis: fast } }
];
var pt = KJ._coordPath('A', 'Z', 'asis', Gtie);
assert(pt && pt.length === 2 && (pt[0].to === 'B' || pt[0].to === 'M'),
  '동점 경로도 결정론적으로 1개 선택 (경유 ' + pt[0].to + ')');
// 도달 불가 → null
assert(KJ._coordPath('A', 'Q', 'asis', G) === null, '도달 불가 경로는 null');
assert(KJ._coordPath('A', 'A', 'asis', G) === null, 'src===target은 null (자기 승인 케이스)');

// 현재 실제 그래프에서 알려진 경로 (As-Is): AOC-1C→KAOC = MCRC 경유 2홉 182s, MCRC→KAOC = 1홉 2s
var pk = KJ._coordPath('AOC-1C', 'KAOC', 'asis');
var pkTotal = pk.reduce(function (s, l) { return s + l.comm.asis.delaySec; }, 0);
assert(pk.length === 2 && pk[0].from === 'AOC-1C' && pk[pk.length - 1].to === 'KAOC' && pkTotal === 182,
  'As-Is AOC-1C→KAOC = 2홉 182s (음성 180 + 2) — 이원화 C2의 정량 실체');
var pm = KJ._coordPath('MCRC', 'KAOC', 'asis');
assert(pm.length === 1 && pm[0].comm.asis.delaySec === 2, 'As-Is MCRC→KAOC = 1홉 2s');

// ══════════ 1B — 결심지연 분해: 협조 홉 + 잔여 ══════════
console.log('# 1B 결심지연 분해 (협조 홉 지연 ⊆ 결심 지연)');
var badFinite = 0, badSubset = 0, asisCoordSeen = 0, tobeCoordNonzero = 0, n = 0;
[['sc1', 'asis'], ['sc1', 'tobe'], ['sc2', 'asis'], ['sc2', 'tobe'], ['sc3', 'asis'], ['sc3', 'tobe']].forEach(function (pr) {
  [1.5, 2.5].forEach(function (x) {
    for (var sd = 1; sd <= 5; sd++) {
      var g = run(pr[0], pr[1], x, sd).global; n++;
      if (!isFinite(g.meanCoordDelaySec) || g.meanCoordDelaySec < 0) badFinite++;
      // 협조 홉 지연은 결심 지연의 부분집합 (≤, 부동소수 여유)
      if (g.meanCoordDelaySec > g.meanDecisionDelaySec + 1e-6) badSubset++;
      if (pr[1] === 'asis' && g.meanCoordDelaySec > 0) asisCoordSeen++;
      // To-Be는 협조 홉이 대부분 생략(자동화) — 0이어야 정상. 0이 아닌 케이스 카운트만(경보용)
      if (pr[1] === 'tobe' && g.meanCoordDelaySec > 1e-9) tobeCoordNonzero++;
    }
  });
});
assert(badFinite === 0, 'meanCoordDelaySec 전부 유한·비음수 (' + n + ' config)');
assert(badSubset === 0, '협조 홉 지연 ≤ 결심 지연 (부분집합 관계 보존)');
assert(asisCoordSeen > 0, 'As-Is에서 협조 홉 지연 > 0 관측 (육↔공 음성 협조가 실제 발화)');
assert(tobeCoordNonzero === 0, 'To-Be 협조 홉 지연 ≈ 0 (자동화·직결로 홉 생략 — ' + tobeCoordNonzero + '건 예외)');

// 결정론
var A = run('sc3', 'asis', 2, 9).global, B = run('sc3', 'asis', 2, 9).global;
assert(A.meanCoordDelaySec === B.meanCoordDelaySec && A.meanDecisionDelaySec === B.meanDecisionDelaySec,
  '분해 지표도 동일 seed → 완전 동일 (결정론)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
