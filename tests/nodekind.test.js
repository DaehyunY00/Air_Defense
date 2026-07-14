/**
 * K-JAMDS 시뮬레이터 — 작업 종류(kind) 분리 회귀 테스트 (Phase: track vs approval)
 * 실행:  node tests/nodekind.test.js   (저장소 루트에서)
 *
 * C2 서버풀이 ③④⑤ 항적처리(track: _onC2Arrive/_onFusionArrive)와 ⑥⑦ 승인처리
 * (approval: _onApproveArrive)에 공유되므로, 노드 단위 통계만으로는 두 부하가 섞인다.
 * 엔진이 kind별로 분해한 rhoByKind/arrivalsByKind/dropsByKind/WqByKind가:
 *  1) 전체 합계를 정확히 보존하고(순수 관측 — 시뮬레이션 동작 불변),
 *  2) 각 노드의 부하 성격(track/approval/engage)을 올바로 귀속하며,
 *  3) 결정론을 유지하고 NaN/Infinity를 내지 않음을 검증한다.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, seed) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: 1800 });
}
function nodesById(r) { var m = {}; r.nodes.forEach(function (n) { m[n.id] = n; }); return m; }
function maxRhoByKind(r, cat, kind) {
  var m = 0; r.nodes.forEach(function (n) { if (n.category === cat && n.rhoByKind[kind] > m) m = n.rhoByKind[kind]; }); return m;
}
function maxRhoTotal(r, cat) {
  var m = 0; r.nodes.forEach(function (n) { if (n.category === cat && n.rho > m) m = n.rho; }); return m;
}

// ══════════ 1. 합 보존 — Σ_kind === 전체 (순수 관측, 부동소수 오차 허용) ══════════
console.log('# 1 kind별 통계 합 보존 (Σ byKind === 전체)');
var EPS = 1e-6, maxArrErr = 0, maxRhoErr = 0, maxDropErr = 0, cfgN = 0;
[['sc1', 'asis'], ['sc1', 'tobe'], ['sc2', 'asis'], ['sc2', 'tobe'], ['sc3', 'asis'], ['sc3', 'tobe']].forEach(function (p) {
  [1.5, 2.5, 3.0].forEach(function (x) {
    for (var sd = 1; sd <= 5; sd++) {
      var r = run(p[0], p[1], x, sd); cfgN++;
      r.nodes.forEach(function (n) {
        var sa = n.arrivalsByKind.track + n.arrivalsByKind.approval + n.arrivalsByKind.engage;
        var sr = n.rhoByKind.track + n.rhoByKind.approval + n.rhoByKind.engage;
        var sd2 = n.dropsByKind.track + n.dropsByKind.approval + n.dropsByKind.engage;
        maxArrErr = Math.max(maxArrErr, Math.abs(sa - n.arrivals));
        maxRhoErr = Math.max(maxRhoErr, Math.abs(sr - n.rho));      // rho = busyTime/(cT) → busyTime 보존과 동치
        maxDropErr = Math.max(maxDropErr, Math.abs(sd2 - n.drops));
      });
    }
  });
});
assert(maxArrErr === 0, 'arrivals: Σ_kind === ns.arrivals (정확, ' + cfgN + '개 config · 오차 ' + maxArrErr + ')');
assert(maxRhoErr < EPS, 'busyTime(ρ): Σ_kind === 전체 (오차 ' + maxRhoErr.toExponential(2) + ' < 1e-6)');
assert(maxDropErr === 0, 'drops: Σ_kind === ns.drops (정확, 오차 ' + maxDropErr + ')');

// ══════════ 2. 노드 부하 성격 귀속 ══════════
console.log('# 2 노드별 부하 성격 (track/approval/engage 귀속)');
// JAMDC2(To-Be 융합허브)는 항적처리(track) 전용 — 승인·교전 부하 없음
var j = nodesById(run('sc3', 'tobe', 2.5, 3)).JAMDC2;
assert(j && j.rhoByKind.approval === 0 && j.rhoByKind.engage === 0 && j.rhoByKind.track > 0,
  'JAMDC2는 track 전용 (approval=' + j.rhoByKind.approval + ' engage=' + j.rhoByKind.engage + ' track=' + j.rhoByKind.track.toFixed(3) + ')');

// KAOC 승인 부하: As-Is에서는 approval 부하가 실재하고, To-Be에서는 완전 유휴(사장) —
// 승인 kind가 승인권자 노드에 올바로 귀속됨을 증명한다.
// ※ KAOC의 track 부하는 0이 아니다: ②브랜치(feat/stage2-track-overhaul)의 중복항적 팬아웃이
//   As-Is에서 KAOC로 ghost 항적을 보낸다(primary 라우팅은 argmin에서 항상 MCRC에 짐). 이 track
//   부하는 실제 C2 서버 점유이며 ②브랜치 소관이므로 여기서 0을 강제하지 않는다(사실 그대로 관측).
var kAsis = nodesById(run('sc1', 'asis', 2.5, 3)).KAOC;
var kTobe = nodesById(run('sc1', 'tobe', 2.5, 3)).KAOC;
assert(kAsis.rhoByKind.approval > 0, 'KAOC As-Is 승인 부하 실재 (approval ρ=' + kAsis.rhoByKind.approval.toFixed(3) + ' > 0)');
assert(kTobe.arrivals === 0, 'KAOC To-Be 완전 유휴 (arrivals=0 — 사전승인/이관으로 승인 요청 없음, 사장 노드)');

// 무기(shooter)는 engage 한 종류뿐 — track·approval 부하 0
console.log('# 3 shooter는 engage 전용');
var shBad = 0;
run('sc3', 'asis', 2.5, 3).nodes.concat(run('sc3', 'tobe', 2.5, 3).nodes).forEach(function (n) {
  if (n.category === 'shooter' && (n.rhoByKind.track !== 0 || n.rhoByKind.approval !== 0)) shBad++;
});
assert(shBad === 0, '전 shooter 노드 track=0·approval=0 (engage 전용, 위반 ' + shBad + '건)');

// ══════════ 4. 분리가 실제로 작동 — ③④⑤(track) ≠ ⑥⑦(approval) ══════════
console.log('# 4 카드 분리 작동 — track 최대 ≠ approval 최대');
var s1 = run('sc1', 'asis', 2.5, 3);
var trackMax = maxRhoByKind(s1, 'c2', 'track');
var apprMax = maxRhoByKind(s1, 'c2', 'approval');
assert(trackMax !== apprMax,
  'SC1 x2.5 As-Is: maxRho track(' + trackMax.toFixed(3) + ') ≠ approval(' + apprMax.toFixed(3) + ') — 분리 실효');
// ③④⑤ 카드 값이 실제로 바뀐다: track 최대(신규 표시값) ≠ 전체 최대(구 표시값), 그리고 track ≤ 전체
assert(trackMax <= maxRhoTotal(s1, 'c2') + 1e-12, 'track 최대 ≤ C2 전체 최대 (부분집합 관계)');
assert(Math.abs(trackMax - maxRhoTotal(s1, 'c2')) > 1e-6,
  'SC1: ③④⑤ 신규값(track 최대 ' + trackMax.toFixed(3) + ') ≠ 구값(C2 전체 최대 ' + maxRhoTotal(s1, 'c2').toFixed(3) + ') — 표시값 변경 확인');

// ══════════ 5. 결정론 — 동일 seed → 동일 byKind ══════════
console.log('# 5 결정론 (동일 seed → 동일 kind별 통계)');
var A = run('sc3', 'asis', 2, 9), B = run('sc3', 'asis', 2, 9);
function kindSig(r) { return JSON.stringify(r.nodes.map(function (n) { return [n.id, n.rhoByKind, n.arrivalsByKind, n.dropsByKind, n.WqByKind]; })); }
assert(kindSig(A) === kindSig(B), '동일 seed → rhoByKind/arrivalsByKind/dropsByKind/WqByKind 완전 동일');

// ══════════ 6. Wq 유한성 — idle 노드 포함 NaN/Infinity 없음 ══════════
console.log('# 6 Wq 유한성 (idle 노드 포함)');
var wqBad = 0, idleSeen = 0;
[['sc1', 'asis'], ['sc2', 'tobe'], ['sc3', 'tobe']].forEach(function (p) {
  run(p[0], p[1], 2.5, 4).nodes.forEach(function (n) {
    if (n.arrivals === 0) idleSeen++;
    if (!isFinite(n.Wq)) wqBad++;
    ['track', 'approval', 'engage'].forEach(function (k) { if (!isFinite(n.WqByKind[k])) wqBad++; });
  });
});
assert(idleSeen > 0, 'idle 노드(arrivals=0)가 표본에 존재 (' + idleSeen + '건 — 경계조건 실제 검증)');
assert(wqBad === 0, 'Wq·WqByKind 전부 유한 (NaN/Infinity 0건)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
