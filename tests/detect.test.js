/**
 * K-JAMDS 시뮬레이터 — ① 탐지 융합 회귀 테스트 (feat/sensor-pd-fusion)
 * 실행:  node tests/detect.test.js   (저장소 루트에서)
 *
 * 센서 Pd × 위협 난이도 → 모드별 융합 규칙(SEN-FUSION-01)의 정확성을 3축으로 증명한다.
 * 핵심 설계 사실: 현행 스캔 재시도 구조(N=dwell/10)에서 누적 탐지 "율"은 두 모드 모두
 * ~1.0으로 포화하므로, 융합의 효과는 (1) per-scan 확률과 (2) 탐지 "시점"에서 나타난다.
 * 따라서 정확성 증명은 end-to-end 누적율(포화·잡음)이 아니라 아래 세 축에 둔다.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
var EPS = 1e-9; // 부동소수점 톨러런스: To-Be 단일센서 1−(1−p)는 p보다 ~1e-17 작을 수 있음

// _scanProb을 임의 센서집합에 대해 직접 평가하는 헬퍼 (엔진 실행 없이 규칙만 검증)
function mkThreat(type, pds) {
  return { type: type, _sensors: pds.map(function (v) { return { detectProb: { value: v } }; }) };
}
function sp(mode, type, pds, md) {
  var s = new KJ.Simulation({ scenario: KJ.scenarioById('sc2'), mode: mode, intensity: 1, seed: 1, endTimeSec: 1800, mult: { detect: md || 1 } });
  return s._scanProb(mkThreat(type, pds));
}

console.log('# 축1 — _scanProb per-scan 정확성·단조성·범위 (결정론)');
var SETS = [
  ['uav_small', [0.5]], ['uav_small', [0.35, 0.6]], ['uav_small', [0.35, 0.6, 0.6]],
  ['cruise', [0.35, 0.9, 0.85, 0.85]], ['srbm', [0.95, 0.85]], ['fighter', [0.9, 0.85, 0.85]]
];
SETS.forEach(function (c) {
  [1, 0.8, 3.0].forEach(function (md) {
    var a = sp('asis', c[0], c[1], md), b = sp('tobe', c[0], c[1], md);
    assert(a >= 0 && a <= 1 && b >= 0 && b <= 1,
      '∈[0,1] ' + c[0] + ' pds=' + JSON.stringify(c[1]) + ' mult=' + md + ' (AsIs ' + a.toFixed(3) + ' ToBe ' + b.toFixed(3) + ')');
    assert(b >= a - EPS,
      'To-Be ≥ As-Is (모드 단조) ' + c[0] + ' pds=' + JSON.stringify(c[1]) + ' mult=' + md);
  });
});
// 극한 mult에서도 클램프 유지 (mult.detect 3.0 등)
assert(sp('tobe', 'fighter', [0.95, 0.95, 0.95], 3.0) <= 1 && sp('asis', 'fighter', [0.95, 0.95, 0.95], 3.0) <= 1,
  '극한 mult=3.0 고Pd 다센서에서도 p ≤ 1 (클램프)');
// 센서 없음 → 0, value 누락 → 폴백 1.0
assert(sp('asis', 'uav_small', [], 1) === 0 && sp('tobe', 'uav_small', [], 1) === 0, '센서 없음 → p=0');
var sim = new KJ.Simulation({ scenario: KJ.scenarioById('sc2'), mode: 'asis', intensity: 1, seed: 1, endTimeSec: 1800 });
assert(sim._scanProb({ type: 'cruise', _sensors: [{ detectProb: {} }] }) === 0.5,
  'value 누락 센서 → 폴백 Pd=1.0 (cruise detectFactor 0.5 그대로)');

console.log('# 축2 — 단일센서 대조군: 융합 대상 없으면 To-Be ≡ As-Is (정확성 핵심)');
// 데이터 가드: uav_small@central 은 LAR-C 하나만 커버 (융합 무대상 대조군)
var covCentral = KJ.NODES.filter(function (n) {
  return n.category === 'sensor' && n.detects.indexOf('uav_small') !== -1 && n.coverage.indexOf('central') !== -1;
}).map(function (n) { return n.id; });
assert(covCentral.length === 1 && covCentral[0] === 'LAR-C',
  'uav_small@central 커버 센서 = [LAR-C] 단독 (대조군 성립: ' + JSON.stringify(covCentral) + ')');
// 단일센서: 두 모드 per-scan 확률 동일 (융합 이득 없음)
var single = KJ.nodeById('LAR-C').detectProb.value;
assert(Math.abs(sp('asis', 'uav_small', [single]) - sp('tobe', 'uav_small', [single])) < EPS,
  '단일센서 uav_small: To-Be == As-Is (±ε) — 융합 대상 없음 → 개선 없음');
// 다센서: To-Be 가 strict 하게 크다 (융합이 실제로 확률을 올림)
assert(sp('tobe', 'uav_small', [0.35, 0.6]) - sp('asis', 'uav_small', [0.35, 0.6]) > 1e-3,
  '다센서 uav_small: To-Be > As-Is (융합이 획득확률을 실제로 향상)');

console.log('# 축3 — 탐지 시점(latency): 다센서에서 To-Be 단축, 단일센서에서 불변 (20 seed pooled median)');
function pooledLatMedian(id, mode, cls) {
  var lat = [];
  for (var s = 1; s <= 20; s++) {
    var r = KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: 1.5, seed: s, endTimeSec: 1800, trace: true, traceCap: 5000 });
    r.threatTraces.forEach(function (tr) {
      if (tr.type + '@' + tr.axis !== cls) return;
      var d = tr.stages.filter(function (x) { return x.name === '탐지'; })[0];
      if (d) lat.push(d.t - tr.spawnT);
    });
  }
  lat.sort(function (a, b) { return a - b; });
  var m = Math.floor(lat.length / 2);
  return { med: lat.length % 2 ? lat[m] : (lat[m - 1] + lat[m]) / 2, n: lat.length };
}
var seoulA = pooledLatMedian('sc2', 'asis', 'uav_small@seoul');
var seoulB = pooledLatMedian('sc2', 'tobe', 'uav_small@seoul');
var centA = pooledLatMedian('sc2', 'asis', 'uav_small@central');
var centB = pooledLatMedian('sc2', 'tobe', 'uav_small@central');
assert(seoulA.n > 100 && centA.n > 100, '표본 충분 (seoul n=' + seoulA.n + ', central n=' + centA.n + ')');
assert(seoulB.med <= seoulA.med - 10,
  '다센서 uav_small@seoul(3센서): To-Be 중위 탐지시점 ≥1스캔 단축 (' + seoulA.med + 's → ' + seoulB.med + 's)');
assert(Math.abs(centB.med - centA.med) <= 10,
  '단일센서 uav_small@central(1센서): To-Be ≈ As-Is (유의미한 단축 없음, ' + centA.med + 's vs ' + centB.med + 's)');

console.log('# 재현성 — 탐지 경로 결정론 유지');
function detCount(mode, seed) {
  return KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: mode, intensity: 1.5, seed: seed, endTimeSec: 1800 }).global.detected;
}
assert(detCount('asis', 42) === detCount('asis', 42) && detCount('tobe', 7) === detCount('tobe', 7),
  '동일 seed/config → 동일 탐지수 (결정론 canary)');

console.log(fail ? ('\nFAILED — ' + fail + '건') : '\n통과 (전 어서션)');
process.exit(fail ? 1 : 0);
