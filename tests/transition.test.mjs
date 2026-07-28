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
assert(r.rho09CrossX !== null, 'As-Is C2 최대 ρ의 0.9 임계 돌파 강도 존재 (' + r.rho09CrossX + ')');
assert(r.points.every(function (p) { return p.gap > 0; }), '전 구간에서 To-Be 누수율 < As-Is (gap>0)');
var prePoints = r.points.filter(function (p) { return p.x < r.rho09CrossX; });
var postPoints = r.points.filter(function (p) { return p.x >= r.rho09CrossX; });
var preMean = prePoints.reduce(function (s, p) { return s + p.gap; }, 0) / prePoints.length;
var postMean = postPoints.reduce(function (s, p) { return s + p.gap; }, 0) / postPoints.length;
assert(Number.isFinite(r.preGapMean) && Number.isFinite(r.postGapMean) &&
  Math.abs(r.preGapMean - preMean) < 1e-12 && Math.abs(r.postGapMean - postMean) < 1e-12,
  '임계 전·후 개선폭 요약이 스윕 점 평균과 정확히 일치 (' +
  (r.preGapMean * 100).toFixed(1) + '%p / ' + (r.postGapMean * 100).toFixed(1) + '%p)');
var maxPoint = r.points.reduce(function (best, p) { return p.gap > best.gap ? p : best; }, r.points[0]);
assert(r.maxGapX === maxPoint.x && Math.abs(r.maxGap - maxPoint.gap) < 1e-12,
  '최대 격차 지점·값이 스윕 결과에서 정확히 도출 (×' + r.maxGapX + ')');

// As-Is C2 최대 ρ는 강도에 대해 약단조 증가 (표본 노이즈 허용 오차 0.05)
var rhoMono = r.points.every(function (p, i) {
  return i === 0 || p.asis.maxC2Rho >= r.points[i - 1].asis.maxC2Rho - 0.05;
});
assert(rhoMono, 'As-Is C2 최대 ρ 강도에 대해 약단조 증가');

// 전환점은 시나리오의 함수다.
// [ADR-061 관측 변경 — 정직 기록] legacy 경로에서는 SC1도 고강도에서 임계를 돌파했고, 그
// 원인은 legacy 전용 **중복항적 팬아웃**(각 군 C2가 같은 항적을 중복 접수해 부하가 배가되던
// 경로)이었다. 그 경로가 ADR-061로 삭제되면서 native SC1은 전 스윕 구간에서 C2 최대 ρ가
// 0.3 언저리에 머물러 임계를 넘지 않는다(실측 600초·reps 3: 0.04→0.32, 1800초에서도 동일
// 경향). 따라서 대조 방식을 "SC3보다 늦게 돌파"에서 **"SC3는 돌파·SC1은 미돌파"**로 되돌린다
// — 두 모델의 절대값을 비교하지 말라는 원칙(모의논리서 §7)의 사례이기도 하다.
console.log('# 전환점의 시나리오 의존성: SC3는 돌파, SC1(경계 침투)은 미돌파');
var r5 = KJ.analyzeTransition(KJ.scenarioById('sc1'), { reps: 3, seed: 12345, endTimeSec: 600 });
var sc1MaxRho = r5.points.reduce(function (m, p) { return Math.max(m, p.asis.maxC2Rho); }, 0);
assert(r.rho09CrossX !== null && r5.rho09CrossX === null && sc1MaxRho < 0.9,
  'SC3는 ×' + r.rho09CrossX + '에서 임계 돌파 · SC1은 전 스윕(×0.5~3.0) 미돌파(최대 ρ ' +
  sc1MaxRho.toFixed(2) + ') — 전환점은 시나리오의 함수(고정 아님)');

console.log('# 성능');
// 별도 재실행 대신 위 구조적 스윕의 실측 시간을 상한 검증(native 비용 — ADR-061 재조정).
assert(elPerf < 600000, '전체 스윕(11점×2모드×3복제×600초) < 10분 (' + elPerf + 'ms)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
