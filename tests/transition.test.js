/**
 * K-JAMDS 시뮬레이터 — 임계 전환점 분석 회귀 테스트 (Phase 5)
 * 실행:  node tests/transition.test.js   (저장소 루트에서)
 *
 * 계획서 Recommendations 6의 핵심 산출물(ρ>0.9 임계 구간에서 As-Is 대비 To-Be 개선폭)이
 * 시나리오에서 실제로 도출되는지, 그리고 결정론·구조적 성질이 유지되는지 검증한다.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js',
 'analysis/mc-runner.js', 'analysis/transition.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

console.log('# 결정론');
var opts = { reps: 20, seed: 777, xMin: 0.5, xMax: 3.0, xStep: 0.5 };
var r1 = KJ.analyzeTransition(KJ.scenarioById('sc3'), opts);
var r2 = KJ.analyzeTransition(KJ.scenarioById('sc3'), opts);
assert(JSON.stringify(r1) === JSON.stringify(r2), '동일 옵션 → 완전 동일 결과');

console.log('# 구조적 성질 (SC3 포화 시나리오, reps=30)');
var r = KJ.analyzeTransition(KJ.scenarioById('sc3'), { reps: 30, seed: 12345 });
assert(r.points.length === 11, '스윕 점 개수 = 11 (0.5~3.0, step 0.25 — 부동소수 누적오차 없음)');
assert(r.points.every(function (p, i) { return i === 0 || p.x > r.points[i - 1].x; }), '강도 오름차순');
assert(r.rho09CrossX !== null, 'As-Is C2 최대 ρ의 0.9 임계 돌파 강도 존재 (' + r.rho09CrossX + ')');
assert(r.points.every(function (p) { return p.gap > 0; }), '전 구간에서 To-Be 누수율 < As-Is (gap>0)');
assert(r.postGapMean > r.preGapMean,
  '임계 이후 평균 개선폭(' + (r.postGapMean * 100).toFixed(1) + '%p) > 임계 이전(' +
  (r.preGapMean * 100).toFixed(1) + '%p) — 투자정당화 핵심 논증');
assert(r.maxGapX >= r.rho09CrossX, '최대 격차 지점(' + r.maxGapX + ')이 임계 돌파(' + r.rho09CrossX + ') 이후 구간에 위치');

// As-Is C2 최대 ρ는 강도에 대해 약단조 증가 (표본 노이즈 허용 오차 0.05)
var rhoMono = r.points.every(function (p, i) {
  return i === 0 || p.asis.maxC2Rho >= r.points[i - 1].asis.maxC2Rho - 0.05;
});
assert(rhoMono, 'As-Is C2 최대 ρ 강도에 대해 약단조 증가');

// 전환점은 시나리오의 함수 — SC1(경계 침투)은 SC3(포화)보다 '더 높은' 강도에서 임계를 돌파한다.
// (feat/stage2-track-overhaul Phase 4: 중복항적 팬아웃 도입 전 SC1은 전 스윕 미돌파였으나,
//  Track Fusion 부재의 dup 부하가 각 군 C2를 실제로 배가시켜 고강도에서 SC1도 돌파한다 — 실제
//  물리이며 아티팩트 아님. 대조 방식을 "절대 미돌파"에서 "SC3보다 늦게 돌파"로 재프레임: 둘 다
//  돌파하되 전환점 순서가 다름을 정량으로 보여 "전환점은 시나리오의 함수"를 더 강하게 증명한다.)
console.log('# 전환점의 시나리오 의존성: SC1(경계 침투)은 SC3(포화)보다 높은 강도에서 돌파');
var r5 = KJ.analyzeTransition(KJ.scenarioById('sc1'), { reps: 20, seed: 12345 });
assert(r5.rho09CrossX !== null && r.rho09CrossX !== null && r5.rho09CrossX > r.rho09CrossX,
  'SC1 전환점(' + r5.rho09CrossX + ') > SC3 전환점(' + r.rho09CrossX + ') — 전환점은 시나리오의 함수(고정 아님)');

console.log('# 성능');
var t0 = Date.now();
KJ.analyzeTransition(KJ.scenarioById('sc3'), { reps: 30, seed: 1 });
var el = Date.now() - t0;
assert(el < 15000, '전체 스윕(11점×2모드×30복제) < 15초 (' + el + 'ms)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
