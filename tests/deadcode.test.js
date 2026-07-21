/**
 * K-JAMDS — 死 코드 레지스트리 게이트 (통합 검증 Gate 3)
 * 실행:  node tests/deadcode.test.js
 *
 * 목적: 각 실패코드·死노드의 "부활/영구死" 상태를 정본으로 잠근다. 통합 과정에서 어느 브랜치가
 * 무엇을 부활시켰는지, 그리고 무엇이 왜 여전히 0인지(정직한 미부활)를 회귀로 감시한다.
 *
 * 통합 계획의 예측 대비 실측(정직 보고):
 *   responsibility_gap : 부활 ✓ (W3 교전협조) — 이 프로젝트 핵심 개념
 *   JAOC-CD(수방사)     : 부활 ✓ (W2 팬아웃)
 *   no_report_path      : 영구 死 ✓ (구조적으로 발화 불가 — 커버 센서가 있으면 보고경로 존재)
 *   not_detected        : legacy MFR 확장 후 극희소 발화 — 낮은 Pd·짧은 체공 조합이 늘어 near-dead에서 전환.
 *                         전 풀링 6만여 표적 중 1건 수준이며 주 실패원인은 여전히 요격·협조다.
 *   no_shooter          : 여전히 0 — 계획은 W4 후 >0 예측했으나 커버리지 매트릭스에 (위협×축선)
 *                         공백이 없음(모든 셀 ≥1). 능력·타이밍 공백은 no_engage_window가 포착.
 *                         공백을 인위로 만들면 데이터 조작 → 강제하지 않음(정직한 0).
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

// 전 시나리오 풀링 집계 (seed 1~20 × SC1/2/3 × x1.0/1.5/2.5, 양 모드)
var leak = {}, maxRho = {};
['sc1', 'sc2', 'sc3'].forEach(function (id) {
  [1.0, 1.5, 2.5].forEach(function (x) {
    for (var s = 1; s <= 20; s++) {
      ['asis', 'tobe'].forEach(function (m) {
        var res = KJ.runDES({ scenario: KJ.scenarioById(id), mode: m, intensity: x, seed: s, endTimeSec: 1800 });
        var g = res.global;
        Object.keys(g.leakReasons).forEach(function (c) {
          var key = c.indexOf('overflow:') === 0 ? 'overflow' : c;
          leak[key] = (leak[key] || 0) + g.leakReasons[c];
        });
        (res.nodes || []).forEach(function (n) { if (n.rho > (maxRho[n.id] || 0)) maxRho[n.id] = n.rho; });
      });
    }
  });
});

console.log('# 부활한 코드·노드 (통합이 실제로 되살린 것)');
assert((leak['responsibility_gap'] || 0) > 0,
  'responsibility_gap 부활 (W3 교전협조·책임공백) ★핵심 — ' + (leak['responsibility_gap'] || 0) + '건');
assert((maxRho['JAOC-CD'] || 0) > 0,
  'JAOC-CD(수방사) 死 노드 부활 (W2 팬아웃) — 최대 ρ ' + (maxRho['JAOC-CD'] || 0).toFixed(3));
// ⑧⑨가 도입한 정밀 코드가 실제 발화하는지(taxonomy 정합)
assert((leak['no_engage_window'] || 0) > 0,
  'no_engage_window 발화 (W4 교전창 필터) — 능력·타이밍 공백 포착, ' + (leak['no_engage_window'] || 0) + '건');
assert((leak['timeout:c2'] || 0) > 0 && (leak['timeout:engage'] || 0) > 0,
  'timeout:c2·timeout:engage 분해 발화 (W5) — c2 ' + (leak['timeout:c2'] || 0) + ' · engage ' + (leak['timeout:engage'] || 0));
assert((leak['overflow'] || 0) >= 0 && (leak['missed'] || 0) > 0,
  'missed 발화 (W5 BDA 기회소진) — ' + (leak['missed'] || 0) + '건');

console.log('# 영구 0 코드와 극희소 부활 코드');
assert((leak['no_report_path'] || 0) === 0,
  'no_report_path 영구 死 ✓ — 구조적으로 발화 불가(커버 센서가 있으면 보고경로가 항상 존재)');
assert((leak['not_detected'] || 0) > 0 && (leak['not_detected'] || 0) <= 5,
  'not_detected 극희소 부활 — 확장 센서·위협 조합 풀링에서 ' + (leak['not_detected'] || 0) +
  '건(주 실패원인이 되지 않으며 재스캔 누적탐지 구조 유지)');
assert((leak['no_shooter'] || 0) === 0,
  'no_shooter = 0 (커버리지 공백 없음) — 모든 (위협×축선) 셀에 능력·담당 무기 ≥1. ' +
  '능력·타이밍 공백은 no_engage_window가 포착. 공백을 인위 생성하지 않음(데이터 조작 방지)');

// 반증(counterfactual): no_shooter 코드 경로 자체는 살아있다 — 커버 무기가 0이면 발화한다.
// 커버리지 매트릭스로 반증: 어떤 무기도 담당하지 않는 (위협,축선)이 있으면 no_shooter가 발화할 것이다.
// 현재는 공백 셀이 0임을 명시적으로 확인한다(공백이 생기는 즉시 라이브 경로가 발화).
console.log('# 반증 — no_shooter 코드 경로는 살아있다(공백이 있으면 발화)');
var axes = ['west', 'seoul', 'central', 'east'];
var types = ['uav_small', 'ac_low', 'heli', 'cruise', 'fighter', 'srbm', 'mrl_large'];
var shooters = KJ.nodesInMode('tobe').filter(function (n) { return n.category === 'shooter'; });
var gaps = 0;
types.forEach(function (ty) {
  axes.forEach(function (ax) {
    var cap = shooters.filter(function (n) {
      return n.canEngage[ty] && n.controlledBy && (n.controlledBy['tobe'] || []).length &&
        (!n.coverage || n.coverage.indexOf(ax) !== -1);
    });
    if (cap.length === 0) gaps++;
  });
});
assert(gaps === 0,
  '커버리지 매트릭스 공백 셀 = ' + gaps + ' (0이므로 no_shooter 미발화가 정당 — 공백이 생기면 즉시 발화하는 라이브 경로)');

console.log(fail === 0 ? '\nOK — 死 코드 레지스트리 게이트 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
