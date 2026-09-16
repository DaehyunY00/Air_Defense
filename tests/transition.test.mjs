/**
 * K-JAMDS 시뮬레이터 — 임계 전환점 분석 회귀 테스트 (Phase 5)
 * 실행:  node tests/transition.test.js   (저장소 루트에서)
 *
 * ρ>0.9 임계 구간에서 As-Is 대비 To-Be 개선폭을 계산하고, 결정론·요약 산식·
 * 시나리오 의존성이 유지되는지 검증한다. 개선폭의 방향·최대지점은 배치 결과이지 고정 가정이 아니다.
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
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js',
 'analysis/mc-runner.js', 'analysis/transition.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;
installIadsKernel(KJ);

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function near(a, b) { return Math.abs(a - b) < 1e-12; }
function checkSummary(result, label) {
  assert(result.points.every(function (p) {
    return [p.asis, p.tobe].every(function (arm) {
      return [arm.leakRate, arm.killRate, arm.maxC2Rho].every(function (n) { return Number.isFinite(n) && n >= 0 && n <= 1 + 1e-9; }) &&
        arm.leakRate + arm.killRate <= 1 + 1e-9 && Number.isFinite(arm.leakCI) && arm.leakCI >= 0;
    }) && near(p.gap, p.asis.leakRate - p.tobe.leakRate);
  }), label + ': 전 구간 비율·CI 유효, 격차=As-Is−To-Be (방향 제한 없음)');
  var crossing = result.points.find(function (p) { return p.asis.maxC2Rho >= result.rhoCrit; });
  assert(result.rho09CrossX === (crossing ? crossing.x : null),
    label + ': 임계 전환점은 관측 ρ가 기준 이상인 최초 지점, 없으면 null');
  var before = result.points.filter(function (p) { return !crossing || p.x < crossing.x; });
  var after = result.points.filter(function (p) { return crossing && p.x >= crossing.x; });
  function matchesMean(actual, points) {
    return points.length ? near(actual, points.reduce(function (sum, p) { return sum + p.gap; }, 0) / points.length) : actual === null;
  }
  assert(matchesMean(result.preGapMean, before) && matchesMean(result.postGapMean, after),
    label + ': 임계 전·후 격차는 해당 점의 평균, 빈 구간은 null');
  var maxPoint = result.points.reduce(function (best, p) { return p.gap > best.gap ? p : best; }, result.points[0]);
  assert(result.maxGapX === maxPoint.x && near(result.maxGap, maxPoint.gap),
    label + ': 최대 격차 지점·값을 실제 스윕에서 도출 (음수도 보존)');
}

// ADR-061: iads-c2 단일 충실도의 실행 비용(sc3 1800초 1회 ≈ 10초)이 legacy의 수십 배라,
// 회귀 게이트가 감당 가능한 크기로 복제수·관측창을 줄였다(검증 대상 성질은 동일).
// 실측 근거: sc3·600초·reps 3·step 0.5 스윕 36실행 = 73초(≈2초/실행), ρ 임계 돌파도 보존됨.
console.log('# 결정론');
var opts = { reps: 3, seed: 777, xMin: 0.5, xMax: 3.0, xStep: 0.5, endTimeSec: 600 };
var r1 = KJ.analyzeTransition(KJ.scenarioById('sc3'), opts);
var r2 = KJ.analyzeTransition(KJ.scenarioById('sc3'), opts);
assert(JSON.stringify(r1) === JSON.stringify(r2), '동일 옵션 → 완전 동일 결과');

console.log('# 구조적 성질 (SC3 포화 시나리오, reps=3·600초 — ADR-061 비용 재조정)');
var tPerf = Date.now();
var r = KJ.analyzeTransition(KJ.scenarioById('sc3'), { reps: 3, seed: 12345, endTimeSec: 600 });
var elPerf = Date.now() - tPerf;
assert(r.points.length === 11, '스윕 점 개수 = 11 (0.5~3.0, step 0.25 — 부동소수 누적오차 없음)');
assert(r.points.every(function (p, i) { return i === 0 || p.x > r.points[i - 1].x; }), '강도 오름차순');
checkSummary(r, 'SC3');

console.log('# SC1 전환점·격차도 같은 관측 산식 사용');
var r5 = KJ.analyzeTransition(KJ.scenarioById('sc1'), { reps: 3, seed: 12345, endTimeSec: 600 });
checkSummary(r5, 'SC1');

// 전환점 미발생·첫 지점 발생·후속 지점 발생과 0/음수 격차를 통제 입력으로 확인한다.
// DES를 바꾸지 않고 분석 함수의 입력 경계만 대체하며, 실제 스윕 검사는 위에 유지한다.
console.log('# 전환점 경계 fixture — 빈 구간·불리한 결과 보존');
var realRunDES = KJ.runDES;
try {
  [
    { name: '미돌파·0 격차', rhos: [0.2, 0.4, 0.3], extraLeak: 0, crossing: null },
    { name: '첫 지점 돌파·음수 격차', rhos: [0.95, 0.95, 0.95], extraLeak: 10, crossing: 0.5 },
    { name: '중간 돌파 후 하락·음수 격차', rhos: [0.2, 0.95, 0.4], extraLeak: 10, crossing: 1 }
  ].forEach(function (fixture) {
    var calls = [];
    KJ.runDES = function (config) {
      calls.push({ x: config.intensity, seed: config.seed, mode: config.mode });
      var leaked = 20 + (config.mode === 'tobe' ? fixture.extraLeak : 0);
      return { global: { spawned: 100, leaked: leaked, killed: 60 - leaked, meanTimeToKillSec: 5 },
        nodes: [{ category: 'c2', rho: fixture.rhos[Math.round((config.intensity - 0.5) / 0.5)] }] };
    };
    var probe = KJ.analyzeTransition(KJ.scenarioById('sc3'), {
      reps: 2, seed: 7, xMin: 0.5, xMax: 1.5, xStep: 0.5, endTimeSec: 10
    });
    checkSummary(probe, fixture.name);
    assert(probe.rho09CrossX === fixture.crossing && probe.points.every(function (p) {
      return near(p.gap, -fixture.extraLeak / 100);
    }), fixture.name + ': 전환점과 격차가 지정한 입력을 보존');
    assert(calls.length === 12 && [0.5, 1, 1.5].every(function (x) {
      var asisSeeds = calls.filter(function (c) { return c.x === x && c.mode === 'asis'; }).map(function (c) { return c.seed; });
      var tobeSeeds = calls.filter(function (c) { return c.x === x && c.mode === 'tobe'; }).map(function (c) { return c.seed; });
      return asisSeeds.length === 2 && asisSeeds[0] !== asisSeeds[1] && JSON.stringify(asisSeeds) === JSON.stringify(tobeSeeds);
    }), fixture.name + ': 매 강도의 두 모드가 동일한 서로 다른 복제 seed를 사용');
  });
} finally { KJ.runDES = realRunDES; }

console.log('# 성능');
// 별도 재실행 대신 위 구조적 스윕의 실측 시간을 상한 검증(native 비용 — ADR-061 재조정).
assert(elPerf < 600000, '전체 스윕(11점×2모드×3복제×600초) < 10분 (' + elPerf + 'ms)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
