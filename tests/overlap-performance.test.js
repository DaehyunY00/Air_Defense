/** FULL 배치 중복교전 위험 계산의 결과 동등성·성능 회귀. */
'use strict';
global.window = global;
var path = require('path');
var performance = require('perf_hooks').performance;
var root = path.join(__dirname, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'analysis/overlap-heatmap.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

var model = {
  deploymentId: 'HANBANDO_FULL_NORMAL',
  features: { highResolutionDeployment: true }
};
var scenario = KJ.scenarioById('sc3');
// ADR-065 갱신: 남부 종심 축선(ADR-064)이 기본 포함되면서 coverage 파생이 좁아졌다 —
// 사거리가 남부 축선에만 닿는 자산이 종전에는 coverage:[](=축선 무제한)이라 **중부축 중복위험에
// 계상**되고 있었고, 이제 남부 전용으로 분류돼 빠진다(central asis 2858.25 → 2250.75).
// 종전 값이 과대계상이었다 — 임계를 맞춘 것이 아니라 계정 범위가 정확해진 것이다.
// ADR-066 갱신: 링크 의미론 정본 정합이 기본 ON이 되면서 As-Is C2↔C2가 16/4초 → 1초가 됐다.
// 히트맵의 위험 판정은 "C2 쌍의 협조 지연 d ≥ dwellSec × COORD_RISK_FRACTION"이므로, 링크가
// 빨라지면 위험 쌍이 줄어든다(central 2250.75 → 1706.25, east 1698 → 609). To-Be는 이미
// 빨라 불변이다.
// ⚠️ 정직 기록 — 이 정적 지표와 DES 실측이 **반대 방향**으로 움직인다: 같은 전환에서 DES의
// As-Is 중복교전은 SC3에서 12.83 → 18.10으로 **늘었다**. 히트맵의 전제("협조가 느리면 중복")는
// 빠른 링크 영역에서 성립하지 않고, 실제 중복은 동시결심 경합에서 나온다(ADR-057 부수 관측 ①).
// 따라서 이 표는 "협조 지연발 중복 위험"만 재는 지표로 읽어야 하며 중복교전 예측치가 아니다.
var expected = {
  asis: [1125, 1706.25, 609, 506.25],
  tobe: [112.5, 997.5, 609, 0]
};

['asis', 'tobe'].forEach(function (mode) {
  var t0 = performance.now();
  var heat = KJ.computeOverlapHeat(scenario, mode, 1.5, model);
  var elapsed = performance.now() - t0;
  var raw = heat.axes.map(function (a) { return a.raw; });
  assert(raw.every(function (v, i) { return Math.abs(v - expected[mode][i]) < 1e-9; }),
    mode + ': 최적화 전 정본 축선 raw와 bit-equivalent');
  // 기존 구현은 로컬에서 5~20초/회였다. CI 편차를 허용하면서도 O(root-pair×BFS) 회귀를 잡는다.
  assert(elapsed < 500, mode + ': FULL/SC3 overlap 500ms 미만 (' + elapsed.toFixed(1) + 'ms)');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
