/**
 * K-JAMDS 시뮬레이터 — Monte Carlo·통계 회귀 테스트 (Phase 3)
 * 실행:  node tests/mc.test.js   (저장소 루트에서)
 *
 * 검증: Welford 정확성(나이브 대비), 분포 샘플러의 이론값 수렴, CI 축소, MC 재현성·수렴,
 *       민감도 스윕 단조성, 성능 상한.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
 'core/rng.js', 'core/heap.js', 'core/hungarian.js', 'engine/sim-engine.js', 'analysis/mc-runner.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

console.log('# Welford 정확성 (나이브 대비)');
var data = [];
var rngT = KJ.makeRng(777);
for (var i = 0; i < 5000; i++) data.push(rngT.uniform(0, 100));
var w = new KJ.Welford();
data.forEach(function (x) { w.push(x); });
var nMean = data.reduce(function (s, x) { return s + x; }, 0) / data.length;
var nVar = data.reduce(function (s, x) { return s + (x - nMean) * (x - nMean); }, 0) / (data.length - 1);
assert(near(w.mean, nMean, 1e-9), 'Welford 평균 = 나이브 평균 (Δ=' + Math.abs(w.mean - nMean).toExponential(1) + ')');
assert(near(w.variance(), nVar, 1e-6), 'Welford 표본분산 = 나이브 표본분산');
assert(near(w.ciHalf(1.959963985), 1.959963985 * w.std() / Math.sqrt(w.n), 1e-9), 'CI 반폭 공식 z·s/√n 일치');

console.log('# 분포 샘플러 이론값 수렴 (N=200,000)');
var rng = KJ.makeRng(12345);
var N = 200000;
function sampleMeanVar(fn) {
  var a = new KJ.Welford();
  for (var k = 0; k < N; k++) a.push(fn());
  return a;
}
var expo = sampleMeanVar(function () { return rng.exponential(5); });
assert(near(expo.mean, 5, 0.1), '지수(mean=5): 표본평균≈5 (' + expo.mean.toFixed(3) + ')');
assert(near(expo.std(), 5, 0.2), '지수(mean=5): 표준편차≈5 (' + expo.std().toFixed(3) + ')');
var tri = sampleMeanVar(function () { return rng.triangular(0, 0.5, 1); });
assert(near(tri.mean, 0.5, 0.01), '삼각(0,0.5,1): 표본평균≈0.5 (이론 (a+c+b)/3=0.5) (' + tri.mean.toFixed(4) + ')');
assert(near(tri.variance(), (1 + 0.25 + 0 - 0 - 0 - 0.5) / 18, 0.002),
  '삼각(0,0.5,1): 분산≈(a²+b²+c²−ab−ac−bc)/18=0.0417');
var triAsym = sampleMeanVar(function () { return rng.triangular(40, 55, 70); });
assert(near(triAsym.mean, 55, 0.2), '삼각(40,55,70) [L-SAM 요격고도]: 표본평균≈55 (' + triAsym.mean.toFixed(2) + ')');
var nrm = sampleMeanVar(function () { return rng.normal(10, 2); });
assert(near(nrm.mean, 10, 0.05) && near(nrm.std(), 2, 0.05), '정규(10,2): 평균≈10, 표준편차≈2');
var pois = sampleMeanVar(function () { return rng.poisson(3); });
assert(near(pois.mean, 3, 0.05) && near(pois.variance(), 3, 0.1), '포아송(3): 평균≈분산≈3 (등평균분산)');
var logn = sampleMeanVar(function () { return rng.lognormal(5, 2); });
assert(near(logn.mean, 5, 0.15), '로그정규(mean=5,sd=2): 표본평균≈5 (' + logn.mean.toFixed(3) + ')');

console.log('# MC 재현성·수렴');
var cfg = { scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 2024, endTimeSec: 1800 };
var mc1 = KJ.runMonteCarlo(cfg, { minReps: 30, maxReps: 300, tol: 0.01 });
var mc2 = KJ.runMonteCarlo(cfg, { minReps: 30, maxReps: 300, tol: 0.01 });
assert(JSON.stringify(mc1) === JSON.stringify(mc2), '동일 baseSeed → 동일 MC 요약 (재현성)');
assert(mc1.metrics.leakRate.n >= 30, 'MC 최소 반복수 보장 (' + mc1.metrics.leakRate.n + '≥30)');
assert(!mc1.converged || mc1.metrics.leakRate.ci <= 0.01 + 1e-9, '수렴 시 누수율 95% CI 반폭 ≤ 허용오차 0.01');
console.log('    → leakRate=' + (mc1.metrics.leakRate.mean * 100).toFixed(1) + '% ±' +
  (mc1.metrics.leakRate.ci * 100).toFixed(2) + '%p, reps=' + mc1.reps + ', converged=' + mc1.converged);

console.log('# CI 축소 (반복수↑ → CI↓)');
var few = KJ.runMonteCarlo(cfg, { minReps: 20, maxReps: 20, tol: 0 });   // 강제 20회
var many = KJ.runMonteCarlo(cfg, { minReps: 200, maxReps: 200, tol: 0 }); // 강제 200회
assert(many.metrics.leakRate.ci < few.metrics.leakRate.ci,
  'reps 20→200: CI 반폭 감소 (' + (few.metrics.leakRate.ci * 100).toFixed(2) + '%p → ' +
  (many.metrics.leakRate.ci * 100).toFixed(2) + '%p)');
// √n 스케일링: CI는 대략 1/√(n비율)=1/√10≈0.316 배로 감소해야 함
var ratio = many.metrics.leakRate.ci / few.metrics.leakRate.ci;
assert(ratio > 0.15 && ratio < 0.55, 'CI 축소가 1/√n 스케일과 정합 (비율 ' + ratio.toFixed(3) + ' ≈ 0.316)');

console.log('# As-Is vs To-Be 통계적 유의성');
var a = KJ.runMonteCarlo({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 55, endTimeSec: 1800 }, { minReps: 100, maxReps: 100, tol: 0 });
var b = KJ.runMonteCarlo({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2, seed: 55, endTimeSec: 1800 }, { minReps: 100, maxReps: 100, tol: 0 });
var overlap = a.metrics.leakRate.lo <= b.metrics.leakRate.hi && b.metrics.leakRate.lo <= a.metrics.leakRate.hi;
assert(a.metrics.leakRate.mean > b.metrics.leakRate.mean && !overlap,
  'To-Be 누수율 유의하게 낮음 (As-Is ' + (a.metrics.leakRate.mean * 100).toFixed(1) + '±' +
  (a.metrics.leakRate.ci * 100).toFixed(2) + ' vs To-Be ' + (b.metrics.leakRate.mean * 100).toFixed(1) +
  '±' + (b.metrics.leakRate.ci * 100).toFixed(2) + ', CI 비중첩)');

console.log('# 민감도 스윕');
var sw = KJ.sensitivitySweep({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 7, endTimeSec: 1800 }, { reps: 40, deltaPct: 0.2 });
sw.rows.forEach(function (r) {
  console.log('    ' + r.label + ': ' + (r.low * 100).toFixed(1) + '% ↔ ' + (r.high * 100).toFixed(1) +
    '% (스윙 ' + (r.swing * 100).toFixed(1) + '%p)');
});
assert(sw.rows.length === 5 && sw.rows[0].swing >= sw.rows[4].swing, '민감도 인자 스윙 내림차순 정렬');
var intensityRow = sw.rows.find(function (r) { return r.factor === 'intensity'; });
assert(intensityRow.high > intensityRow.low, '위협 강도↑ → 누수율↑ (단조 정합)');
var serviceRow = sw.rows.find(function (r) { return r.factor === 'service'; });
assert(serviceRow.high > serviceRow.low, '처리시간↑ → 누수율↑ (단조 정합)');
// 포화(SC3)에서 탐지확률은 병목이 아니므로 영향 미미 — 그 자체가 유의미한 인사이트.
// SC2(무인기 동시 남파)의 결정적 제약은 요격확률이다: uav 체공 900s ≫ 스캔 10s라 탐지는
// 사실상 확실하고(배수는 탐지 '시점'만 이동), 2022.12.26 실패의 본질인 저요격확률
// (pk 삼각 0.1/0.3/0.5)이 누수를 지배한다 — pk↑→누수↓ 단조성으로 검증.
var swU = KJ.sensitivitySweep({ scenario: KJ.scenarioById('sc2'), mode: 'asis', intensity: 1, seed: 7, endTimeSec: 1800 }, { reps: 60, deltaPct: 0.2 });
var pkRow = swU.rows.find(function (r) { return r.factor === 'pk'; });
assert(pkRow.high < pkRow.low, 'SC2(무인기): 요격확률↑ → 누수율↓ (단조 정합 — 격추실패가 지배 제약)');
var swS3Detect = sw.rows.find(function (r) { return r.factor === 'detect'; });
assert(swS3Detect.swing < serviceRow.swing, 'SC3(포화): 탐지확률 영향 < 처리시간 영향 (병목은 처리용량)');

console.log('# 성능');
var t0 = Date.now();
KJ.runMonteCarlo({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 1, endTimeSec: 1800 }, { minReps: 200, maxReps: 200, tol: 0 });
var elapsed = Date.now() - t0;
assert(elapsed < 15000, '200 복제 < 15초 (' + elapsed + 'ms)');
console.log('    → 200 복제 ' + elapsed + 'ms (' + (elapsed / 200).toFixed(1) + 'ms/복제)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
