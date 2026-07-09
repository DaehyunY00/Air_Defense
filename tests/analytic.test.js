/**
 * K-JAMDS 시뮬레이터 — 해석해 교차검증 (Phase 7, 결과 확인 Results Validation)
 * 실행:  node tests/analytic.test.js   (저장소 루트에서)
 *
 * 목적: DES 엔진을 '검증 모드'(serviceDist='exp', discipline='fifo' — M/M/c 가정 복원)로
 * 단순화한 단일 경로 시나리오에 돌려, 관측 이용률 ρ와 평균대기 Wq가 정상상태 M/M/c
 * (Erlang-C) 이론값과 일치하는지 자동 대조한다. MIL-STD-3022 V&V의 '결과 확인
 * (results validation)' 상설 회귀 — 근거: docs/vv-report.md §3.5.
 *
 * 구성: 소형 무인기 단일 스트림(서부축) → LLR-1C(최속 보고 30s) → AOC-1C(c=2, μ⁻¹=45s).
 *  - 도착: 포아송 λ. 탐지 지연은 독립 변위(displacement)라 포아송성 보존.
 *  - AOC-1C는 위협당 정확히 1회 방문(승인은 KAOC, 교전은 SHORAD — 재방문 없음).
 *  - dwell 900s ≫ 체계시간이라 이탈(reneging)·K=15 차단 영향은 ~1% 수준(허용오차 내).
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
 'core/rng.js', 'core/heap.js', 'core/hungarian.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

/**
 * M/M/c/K 정상상태 해석해 — 엔진의 유한 대기실(K)과 정확히 대응.
 * 반환: { rho: λ_eff·μ⁻¹/c (유효 이용률), Wq: Lq/λ_eff, pBlock: 차단확률 }
 * (교과서 정식화: p_n = a^n/n!·p0 (n≤c), a^c/c!·(a/c)^{n-c}·p0 (c<n≤K))
 */
function mmcK(lambda, muInv, c, K) {
  var a = lambda * muInv, rho = a / c;
  var terms = [1], t = 1;
  for (var n = 1; n <= K; n++) {
    t *= a / (n <= c ? n : c);
    terms.push(t);
  }
  var p0 = 1 / terms.reduce(function (s, x) { return s + x; }, 0);
  var pBlock = terms[K] * p0;
  var Lq = 0;
  for (n = c + 1; n <= K; n++) Lq += (n - c) * terms[n] * p0;
  var lambdaEff = lambda * (1 - pBlock);
  return { rho: lambdaEff * muInv / c, Wq: Lq / lambdaEff, pBlock: pBlock };
}

var RATE_PER_MIN = 2.133;              // λ ≈ 0.03556/s → a = λ·45 ≈ 1.6 erlang, ρ = 0.8
var scn = {
  id: 'test-analytic', name: 'M/M/c 교차검증(검증용)',
  mix: [{ type: 'uav_small', axis: 'west', ratePerMin: RATE_PER_MIN }]
};
// 장시간 실행으로 워밍업(빈 시스템 시작)·수평선 절단 편의를 정상상태 대비 소폭(<5%)으로 억제
var T = 28800, REPS = 12;

function aggregate(extra) {
  var arrivals = 0, waitSum = 0, waitN = 0, busy = 0, detected = 0, spawned = 0;
  for (var i = 0; i < REPS; i++) {
    var r = KJ.runDES(Object.assign({
      scenario: scn, mode: 'asis', intensity: 1, seed: 1000 + i, endTimeSec: T
    }, extra || {}));
    var n = r.nodes.find(function (x) { return x.id === 'AOC-1C'; });
    arrivals += n.arrivals;
    waitSum += n.Wq * (n.arrivals - n.drops); // Wq는 서비스 개시 표본 평균 — 표본수 가중 근사
    waitN += (n.arrivals - n.drops);
    busy += n.rho;
    detected += r.global.detected; spawned += r.global.spawned;
  }
  return {
    lambda: arrivals / (REPS * T), Wq: waitSum / waitN, rho: busy / REPS,
    detectRate: detected / spawned
  };
}

console.log('# 검증 모드 (M/M/c 가정 복원: 지수 서비스 · FIFO)');
var obs = aggregate({ serviceDist: 'exp', discipline: 'fifo' });
assert(obs.detectRate > 0.99, '탐지율 ≈ 100% (도착과정 보존 전제 성립, ' + (obs.detectRate * 100).toFixed(1) + '%)');

var MU_INV = 45, C = 2, K = 15;        // AOC-1C: c=2, μ⁻¹=45s(asis), capacity 15
var pred = mmcK(obs.lambda, MU_INV, C, K); // 관측 도착률 기반 이론값
console.log('  [이론 M/M/2/15] ρ=' + pred.rho.toFixed(3) + ', Wq=' + pred.Wq.toFixed(1) +
  's, P차단=' + (pred.pBlock * 100).toFixed(1) + '%  [관측] ρ=' + obs.rho.toFixed(3) + ', Wq=' + obs.Wq.toFixed(1) + 's');
assert(Math.abs(obs.rho - pred.rho) / pred.rho < 0.05,
  '관측 ρ(' + obs.rho.toFixed(3) + ') = 이론 ρ(' + pred.rho.toFixed(3) + ') ±5%');
assert(Math.abs(obs.Wq - pred.Wq) / pred.Wq < 0.15,
  '관측 Wq(' + obs.Wq.toFixed(1) + 's) = M/M/c/K Wq(' + pred.Wq.toFixed(1) + 's) ±15%');

console.log('# 기본 모드 (로그정규 결심시간, CV=0.5) — M/G/c 방향성');
var obsLn = aggregate({}); // 기본: lognormal + priority(단일 클래스라 순서 동일)
assert(Math.abs(obsLn.rho - pred.rho) / pred.rho < 0.10,
  '로그정규에서도 ρ 근사 불변 (이용률은 분포 둔감, ' + obsLn.rho.toFixed(3) + ')');
// M/G/c 근사: Wq(G) ≈ Wq(M/M/c)·(1+CV²)/2 = 0.625배 (CV=0.5). 방향성 + 근사 일치 확인.
assert(obsLn.Wq < obs.Wq,
  '로그정규(CV=0.5) Wq(' + obsLn.Wq.toFixed(1) + 's) < 지수(CV=1) Wq(' + obs.Wq.toFixed(1) + 's) — M/G/c 예측 방향');
var ratio = obsLn.Wq / obs.Wq;
assert(ratio > 0.4 && ratio < 0.9,
  'Wq 비율 ' + ratio.toFixed(2) + ' ≈ Allen-Cunneen (1+CV²)/2 = 0.625 (0.4~0.9 허용)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
