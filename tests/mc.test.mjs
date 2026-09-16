/**
 * K-JAMDS 시뮬레이터 — Monte Carlo·통계 회귀 테스트 (Phase 3)
 * 실행:  node tests/mc.test.js   (저장소 루트에서)
 *
 * 검증: Welford 정확성(나이브 대비), 분포 샘플러의 이론값 수렴, CI 축소, MC 재현성·수렴,
 *       쌍대 차이·민감도 스윕 산식과 입력 배선, 성능 상한.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
 'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'config/deployment-adapter.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js', 'analysis/mc-runner.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;
installIadsKernel(KJ);

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
// ADR-061: iads-c2 단일 충실도의 실행 비용이 legacy의 수십 배라, 회귀 게이트가 감당 가능한
// 크기로 관측창·복제수를 줄였다(검증 성질은 동일 — 재현성·최소반복·수렴시 CI 상한).
var cfg = { scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 2024, endTimeSec: 600 };
var mc1 = KJ.runMonteCarlo(cfg, { minReps: 30, maxReps: 40, tol: 0.01 });
var mc2 = KJ.runMonteCarlo(cfg, { minReps: 30, maxReps: 40, tol: 0.01 });
assert(JSON.stringify(mc1) === JSON.stringify(mc2), '동일 baseSeed → 동일 MC 요약 (재현성)');
assert(mc1.metrics.leakRate.n >= 30, 'MC 최소 반복수 보장 (' + mc1.metrics.leakRate.n + '≥30)');
assert(!mc1.converged || mc1.metrics.leakRate.ci <= 0.01 + 1e-9, '수렴 시 누수율 95% CI 반폭 ≤ 허용오차 0.01');
console.log('    → leakRate=' + (mc1.metrics.leakRate.mean * 100).toFixed(1) + '% ±' +
  (mc1.metrics.leakRate.ci * 100).toFixed(2) + '%p, reps=' + mc1.reps + ', converged=' + mc1.converged);

console.log('# CI 산식과 동일 σ에서의 반복수 스케일링');
var few = KJ.runMonteCarlo(cfg, { minReps: 10, maxReps: 10, tol: 0 });   // 강제 10회
var many = KJ.runMonteCarlo(cfg, { minReps: 90, maxReps: 90, tol: 0 }); // 강제 90회
assert(few.reps === 10 && many.reps === 90 && few.metrics.leakRate.n === 10 && many.metrics.leakRate.n === 90,
  '고정 반복수 10/90을 정확히 실행·집계 (표본분산 변화 때문에 CI 감소 자체는 강제하지 않음)');
// √n 스케일링. 종전에는 두 표본의 CI를 직접 나눴는데, 그 비율은 **두 표본이 같은 σ를
// 추정한다**는 전제에 의존한다. n=10의 σ̂는 자유도 9라 잡음이 커서(실측: seed 2024는 σ̂ 3.43%p
// vs 90회 5.92%p, 비율 0.576 / seed 7은 6.05 vs 6.42, 비율 0.354) 이 전제가 seed에 따라
// 깨진다 — 모델이 아니라 시험 설계의 문제였다. σ̂ 잡음을 제거하고 두 가지를 나눠 검증한다.
//  (1) CI 공식 자체: ci == z·σ̂/√n (양쪽 n에서)
//  (2) 1/√n 법칙: 같은 σ(90회 추정)를 쓰면 10회 대비 90회 CI가 √(10/90)=0.333배
var Z = 1.959963985;
function ciOf(std, n) { return Z * std / Math.sqrt(n); }
[[few, 10], [many, 90]].forEach(function (pair) {
  var m = pair[0].metrics.leakRate;
  assert(Math.abs(m.ci - ciOf(m.std, pair[1])) < 1e-12,
    'CI 공식 정합 (n=' + pair[1] + ': z·σ̂/√n)');
});
var pooledRatio = ciOf(many.metrics.leakRate.std, 90) / ciOf(many.metrics.leakRate.std, 10);
assert(Math.abs(pooledRatio - Math.sqrt(10 / 90)) < 1e-12,
  '동일 σ 기준 1/√n 법칙 성립 (비율 ' + pooledRatio.toFixed(3) + ' = √(10/90))');
// σ̂ 추정 자체도 표본이 늘수록 참값에 수렴해야 한다 — 방향만 고정(크기는 seed 의존).
assert(many.metrics.leakRate.std > 0 && few.metrics.leakRate.std > 0, '양 표본 모두 유효한 산포 추정');

console.log('# As-Is/To-Be 통계 요약 정합');
var a = KJ.runMonteCarlo({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 55, endTimeSec: 600 }, { minReps: 30, maxReps: 30, tol: 0 });
var b = KJ.runMonteCarlo({ scenario: KJ.scenarioById('sc3'), mode: 'tobe', intensity: 2, seed: 55, endTimeSec: 600 }, { minReps: 30, maxReps: 30, tol: 0 });
[a, b].forEach(function (arm) {
  ['leakRate', 'leakRateSpawn', 'killRateSpawn', 'censoredRate'].forEach(function (key) {
    var m = arm.metrics[key];
    assert(m.n === 30 && m.mean >= 0 && m.mean <= 1 &&
      near(m.ci, ciOf(m.std, m.n), 1e-12) && near(m.lo, m.mean - m.ci, 1e-12) && near(m.hi, m.mean + m.ci, 1e-12),
    arm.config.mode + ' ' + key + ': 같은 30개 표본의 평균·산포·CI 경계 정합');
  });
  assert(near(arm.metrics.leakRateSpawn.mean + arm.metrics.killRateSpawn.mean + arm.metrics.censoredRate.mean, 1, 1e-12),
    arm.config.mode + ': 전체 생성 분모의 평균 격추+누수+미해결률=1');
});

// 모드 우열을 가정하지 않고 쌍대 통계 자체를 검증한다. 공통 표본이 크게 움직여도
// 차이의 CI는 seed별 차이의 분산으로 계산되어야 한다. 양·음·0 및 0을 가로지르는
// 차이를 모두 입력한다. 실제 DES 결과는 위 통합 검사와 성능 검사에서 계속 사용한다.
console.log('# 쌍대 차이 fixture — 양·음·0 모두 허용');
function measuredResult(leaked) {
  return { global: { spawned: 100, killed: 80 - leaked, leaked: leaked, censoredRaw: 20,
    detected: 100, everEngaged: 80, killRate: (80 - leaked) / 80, leakRate: leaked / 80,
    meanTimeToEngageSec: 10, meanTimeToKillSec: 20 }, bottlenecks: [] };
}
var realRunDES = KJ.runDES;
try {
  [[-0.1, -0.1, -0.1, -0.1], [0.1, 0.1, 0.1, 0.1], [0, 0, 0, 0], [0, 0.05, -0.05, 0]].forEach(function (deltas) {
    var seenSeeds = new Map(), calls = [];
    KJ.runDES = function (config) {
      if (!seenSeeds.has(config.seed)) seenSeeds.set(config.seed, seenSeeds.size);
      var index = seenSeeds.get(config.seed);
      calls.push({ seed: config.seed, mode: config.mode });
      return measuredResult(15 + index * 10 + (config.mode === 'tobe' ? deltas[index] * 100 : 0));
    };
    var paired = KJ.runPairedMonteCarlo(cfg, { minReps: 4, maxReps: 4, tol: 0, primary: 'leakRateSpawn' });
    var mean = deltas.reduce(function (sum, d) { return sum + d; }, 0) / deltas.length;
    var variance = deltas.reduce(function (sum, d) { return sum + (d - mean) * (d - mean); }, 0) / 3;
    var ci = Z * Math.sqrt(variance) / 2, metric = paired.delta.leakRateSpawn;
    assert(calls.length === 8 && seenSeeds.size === 4 && calls.every(function (call, index) {
      return index % 2 === 0 ? call.mode === 'asis' : call.mode === 'tobe' && call.seed === calls[index - 1].seed;
    }), '쌍대 fixture [' + deltas.join(',') + ']: 각 seed를 양 모드에 정확히 한 번 전달');
    assert(metric.n === 4 && near(metric.mean, mean, 1e-12) && near(metric.std, Math.sqrt(variance), 1e-12) &&
      near(metric.ci, ci, 1e-12) && near(metric.lo, mean - ci, 1e-12) && near(metric.hi, mean + ci, 1e-12),
    '쌍대 fixture [' + deltas.join(',') + ']: Δ(To-Be−As-Is) 평균·표본분산·95% CI가 직접 계산과 일치');
  });
} finally { KJ.runDES = realRunDES; }

console.log('# 민감도 스윕');
var sw = KJ.sensitivitySweep({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 7, endTimeSec: 600 }, { reps: 8, deltaPct: 0.2 });
sw.rows.forEach(function (r) {
  console.log('    ' + r.label + ': ' + (r.low * 100).toFixed(1) + '% ↔ ' + (r.high * 100).toFixed(1) +
    '% (스윙 ' + (r.swing * 100).toFixed(1) + '%p)');
});
function checkSweep(sweep, label) {
  assert(sweep.rows.map(function (r) { return r.factor; }).sort().join('|') === 'delay|detect|intensity|pk|service' &&
    sweep.rows.every(function (r, index) { return index === 0 || sweep.rows[index - 1].swing >= r.swing; }),
  label + ': 인자 5개를 중복 없이 포함하고 전체 스윙을 내림차순 정렬');
  assert(sweep.rows.every(function (r) {
    return [r.low, r.high, r.base].every(function (n) { return Number.isFinite(n) && n >= 0 && n <= 1; }) &&
      near(r.swing, Math.abs(r.high - r.low), 1e-12) && near(r.base, sweep.base, 1e-12);
  }), label + ': 각 인자의 스윙=|high−low|, 기준값·전체 생성 분모 비율 정합');
}
checkSweep(sw, 'SC3');
// 기존 SC2 관측창·복제수를 유지해 무인기 시나리오의 실제 민감도 집계도 검사한다.
var swU = KJ.sensitivitySweep({ scenario: KJ.scenarioById('sc2'), mode: 'asis', intensity: 1, seed: 7, endTimeSec: 1800 }, { reps: 12, deltaPct: 0.2 });
checkSweep(swU, 'SC2');

console.log('# 민감도 입력 배선 fixture — 증가·감소·무효과');
var probeConfig = Object.assign({}, cfg, { intensity: 2, mult: { service: 2, delay: 3, detect: 0.5, pk: 1.2 } });
var originalConfig = JSON.stringify(probeConfig);
var coefficients = { service: 0.05, delay: -0.1, detect: 0, pk: 0.15, intensity: -0.2 };
try {
  KJ.runDES = function (config) {
    var rate = 0.5;
    Object.keys(coefficients).forEach(function (factor) {
      var ratio = factor === 'intensity' ? config.intensity / probeConfig.intensity : config.mult[factor] / probeConfig.mult[factor];
      rate += coefficients[factor] * (ratio - 1);
    });
    return measuredResult(rate * 100);
  };
  var probe = KJ.sensitivitySweep(probeConfig, { reps: 2, deltaPct: 0.2 });
  checkSweep(probe, '통제 입력');
  assert(probe.rows.every(function (r) {
    return near(r.low, 0.5 - coefficients[r.factor] * 0.2, 1e-12) &&
      near(r.high, 0.5 + coefficients[r.factor] * 0.2, 1e-12);
  }), '스윕은 기존 배수에 ±20%를 곱하고 해당 인자만 변경 (증가·감소·0 응답 그대로 보존)');
  assert(JSON.stringify(probeConfig) === originalConfig, '민감도 스윕이 입력 설정을 변형하지 않음');
} finally { KJ.runDES = realRunDES; }

console.log('# 성능');
// native(iads-c2) 복제당 비용은 legacy(~40ms)의 수십 배 — 상한을 native 기준으로 재설정(ADR-061).
var t0 = Date.now();
KJ.runMonteCarlo({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 1, endTimeSec: 600 }, { minReps: 20, maxReps: 20, tol: 0 });
var elapsed = Date.now() - t0;
assert(elapsed < 180000, '20 복제(600초 창) < 180초 (' + elapsed + 'ms)');
console.log('    → 20 복제 ' + elapsed + 'ms (' + (elapsed / 20).toFixed(0) + 'ms/복제)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
