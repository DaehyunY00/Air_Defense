/**
 * K-JAMDS 시뮬레이터 — 지표 구현·시각화 검증 감사 (docs/metrics-verification.md 부속)
 * 실행:  node tests/metrics-verification.test.js   (저장소 루트에서)
 *
 * 이 파일은 새 기능이 아니라 §1 체크리스트(18개 지표)의 "행위 검증(§2-2)" 중,
 * 기존 스위트(engine/mc/overlap/transition/constraints/refine.test.js)가 다루지 않는
 * 잔여 항목만 최소 보강한다:
 *  - Lq(대기열 길이) 존재·유한성 (계산은 되나 어디에도 렌더되지 않는 필드 — 감사 발견 1)
 *  - overlapRiskSum(vsCompare가 쓰는 합산 함수)의 재현 — per-axis 합과 정확히 일치
 *  - 분권 전환(delegation)이 **공식 3대 시나리오·UI 허용 강도(0.5~3.0×) 범위에서** 실제로
 *    어떻게 관측되는지 고정 — 감사 발견 2(To-Be는 전무, As-Is만 SC3 고강도에서 발생)
 *  - 비용교환비(exchangeSat)가 시나리오에 따라 **방향이 반전될 수 있음**을 고정 — 감사 발견 3
 *    (SC2는 항상 개선되지만 SC1·SC3는 강도에 따라 악화되는 경우가 있음 — 버그 아님, 특성 기록)
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js', 'analysis/overlap-heatmap.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, seed) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: 1800 });
}
var SCENARIOS = ['sc1', 'sc2', 'sc3'];
var UI_X = [0.5, 1, 1.5, 2, 2.5, 3]; // UI 강도 슬라이더 허용 범위(0.5~3.0×)
var SEED = 12345; // 딥링크 기본 seed(router.js DEFAULTS.seed)와 동일

console.log('# 감사 발견 1 — Lq(대기열 길이): 계산되나 시각화 없음 (참고 §2-1)');
SCENARIOS.forEach(function (id) {
  UI_X.forEach(function (x) {
    ['asis', 'tobe'].forEach(function (mode) {
      var r = run(id, mode, x, SEED);
      assert(r.nodes.every(function (n) { return typeof n.Lq === 'number' && isFinite(n.Lq) && n.Lq >= 0; }),
        id + '/' + mode + '/x' + x + ': 전 노드 Lq 유한·비음수 (계산은 정상 — sim-view.js/panels.js에 렌더 없음, 감사 보고서 발견 1)');
    });
  });
});

console.log('# overlapRiskSum(vsCompare 합산 함수) 재현 — per-axis 합과 정확히 일치');
function overlapRiskSum(id, mode, x) {
  var h = KJ.computeOverlapHeat(KJ.scenarioById(id), mode, x);
  return h.axes.reduce(function (s, a) { return s + a.raw; }, 0);
}
SCENARIOS.forEach(function (id) {
  [1, 1.5, 3].forEach(function (x) {
    ['asis', 'tobe'].forEach(function (mode) {
      var h = KJ.computeOverlapHeat(KJ.scenarioById(id), mode, x);
      var manualSum = 0;
      h.axes.forEach(function (a) { manualSum += a.raw; });
      assert(Math.abs(overlapRiskSum(id, mode, x) - manualSum) < 1e-9,
        id + '/' + mode + '/x' + x + ': overlapRiskSum = Σ axes.raw (sim-view.js:726-729 로직 재현 일치)');
    });
  });
});
// To-Be는 JAMDC2 허브가 전 C2를 연결해 축선 위험이 항상 완전히 0으로 해소됨(overlap.test.js와 일치, 감사 확인)
SCENARIOS.forEach(function (id) {
  assert(overlapRiskSum(id, 'tobe', 1.5) === 0,
    id + '/tobe/x1.5: 중복교전 위험 합 = 0 (JAMDC2 허브 전연결 구조상 항상 완전 해소 — 감사 참고사항, 버그 아님)');
});

console.log('# 감사 발견 2 — 분권 전환(delegation): 공식 3대 시나리오·UI 강도 범위에서 To-Be 관측 0건');
// Phase B-2 자체 로직은 합성 시나리오(refine.test.js ftr-storm)로 이미 검증됨(전환 발생 가능).
// 여기서는 "실제 제품 UI로 도달 가능한 시나리오·강도 조합"에서 이 지표가 사용자에게
// 관측되는지를 감사한다 — 결과: To-Be는 전무, As-Is만 SC3 고강도(x≥2)에서 발생.
var deleg = {};
SCENARIOS.forEach(function (id) {
  deleg[id] = {};
  UI_X.forEach(function (x) {
    var a = run(id, 'asis', x, SEED).global.delegation;
    var b = run(id, 'tobe', x, SEED).global.delegation;
    deleg[id][x] = { asis: a.count, tobe: b.count };
  });
});
assert(SCENARIOS.every(function (id) {
  return UI_X.every(function (x) { return deleg[id][x].tobe === 0; });
}), '전 시나리오×전 UI강도(0.5~3.0×, seed=12345)에서 To-Be 분권 전환 0건 ' +
  '(vsCompare에 이 지표 비교행이 없는 것과 별개로, 있었더라도 To-Be 열은 항상 "0건"만 표시됐을 것 — 감사 보고서 발견 2)');
assert(deleg.sc3[2].asis > 0 && deleg.sc3[3].asis > 0,
  'SC3 As-Is는 x≥2.0에서 분권 전환 발생(x2:' + deleg.sc3[2].asis + '건, x3:' + deleg.sc3[3].asis + '건) — 유일한 실사용자 관측 가능 사례');
// feat/stage2-track-overhaul Phase 2: 음성 협조 지연 분포화(_linkDelay 삼각 샘플링)로 승인노드
// 도착 타이밍이 재분포되며, SC3 중강도(x1.5)에서도 대기열이 임계를 넘어 전환이 발생하기 시작함
// (부하 함수성 강화 — 하드코딩 아님). SC1·SC2는 여전히 전 강도 0건.
assert(SCENARIOS.every(function (id) { return UI_X.every(function (x) { return deleg[id][x].asis === 0 || (id === 'sc3' && x >= 1.5); }); }),
  'SC1·SC2는 전 강도에서, SC3는 x<1.5에서 As-Is 분권 전환 0건 (부하의 함수 — 음성 협조 분포화로 SC3 x≥1.5부터 전환)');

console.log('# 감사 발견 3 — 비용교환비(exchangeSat): 방향이 시나리오·강도에 따라 반전됨 (버그 아님, 특성 기록)');
// refine.test.js D-2는 SC2(x2)만 검증했고 그 방향은 항상 개선이다. 하지만 SC1·SC3에서는
// To-Be가 오히려 악화되는 강도 구간이 실재한다 — vsCompare는 이를 있는 그대로(방향 무관) 표시하므로
// 계산·표시 자체는 정확하지만, "To-Be가 항상 개선"이라는 암묵적 기대와 다를 수 있음을 고정한다.
var exch = {};
SCENARIOS.forEach(function (id) {
  exch[id] = {};
  UI_X.forEach(function (x) {
    var a = run(id, 'asis', x, SEED).global.cost.exchangeSat;
    var b = run(id, 'tobe', x, SEED).global.cost.exchangeSat;
    exch[id][x] = { asis: a, tobe: b };
  });
});
// 재핀(feat/sensor-pd-fusion): 센서 Pd 융합으로 탐지 시점이 재타이밍되며 공유 RNG 스트림이
// 이동 → seed=12345 고정 exchangeSat의 반전 셀 위치가 바뀜(수치 이동일 뿐 계산·표시는 불변).
// 발견 3의 본질("방향이 시나리오·강도에 따라 반전될 수 있음")은 오히려 강화됨: 이제 SC2조차
// 저·중강도에서는 개선이나 고강도(2·3×)에서 반전이 관측된다. SC3의 반전은 x1.0·x2.5에 존재.
// 단일 seed exchangeSat는 RNG 스트림 이동(①융합·②음성 분포화)에 민감해 반전 셀 위치가 옮겨간다.
// 특정 셀을 핀하는 대신 "SC2가 강도에 따라 개선↔반전 양방향을 모두 보인다"는 발견 3의 본질을 고정.
assert(UI_X.some(function (x) { return exch.sc2[x].tobe < exch.sc2[x].asis; }) &&
       UI_X.some(function (x) { return exch.sc2[x].tobe >= exch.sc2[x].asis; }),
  'SC2(무인기 포화): exchangeSat 방향이 강도에 따라 개선↔반전 양쪽 모두 관측 (발견 3: 방향은 시나리오·강도의 함수, 단일 seed 특성)');
assert(exch.sc3[2.5].tobe > exch.sc3[2.5].asis,
  'SC3 x2.5: To-Be 비용교환비(' + exch.sc3[2.5].tobe.toFixed(2) + ') > As-Is(' + exch.sc3[2.5].asis.toFixed(2) +
  ') — 방향 반전 실재(감사 보고서 발견 3, seed=' + SEED + ' 고정 재현)');
assert(exch.sc3[1].tobe > exch.sc3[1].asis,
  'SC3 x1.0: To-Be 비용교환비(' + exch.sc3[1].tobe.toFixed(2) + ') > As-Is(' + exch.sc3[1].asis.toFixed(2) +
  ') — 별개 강도에서도 반전 재확인');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
