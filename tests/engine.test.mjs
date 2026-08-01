/**
 * K-JAMDS 시뮬레이터 — DES 엔진 회귀 테스트 (Phase 2)
 * 실행:  node tests/engine.test.js   (저장소 루트에서)
 *
 * 브라우저 전역(window.KJ)을 Node 전역으로 매핑해 데이터·엔진 모듈을 로드하고,
 * 재현성·극한값·시나리오 기반 병목 도출·제약·보존 항등식을 검증한다.
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
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;
installIadsKernel(KJ);

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, seed, dur) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: dur || 1800 });
}

console.log('# 재현성');
var r1 = run('sc3', 'asis', 1.5, 42);
var r2 = run('sc3', 'asis', 1.5, 42);
assert(JSON.stringify(r1) === JSON.stringify(r2), '동일 seed/config → 완전 동일 결과 (결정론)');
assert(JSON.stringify(r1) !== JSON.stringify(run('sc3', 'asis', 1.5, 43)), 'seed 변경 → 결과 변화');
// seed 0 보존 (리뷰 지적: (seed>>>0)||1 은 0을 1로 붕괴시켰음)
var s0 = run('sc3', 'asis', 1.5, 0), s1 = run('sc3', 'asis', 1.5, 1);
assert(s0.config.seed === 0 && JSON.stringify(s0) !== JSON.stringify(s1), 'seed 0 보존 (seed 1과 구별)');

console.log('# 극한값');
var empty = { id: 'empty', name: 'empty', mix: [] };
var rE = KJ.runDES({ scenario: empty, mode: 'asis', intensity: 1, seed: 1, endTimeSec: 600 });
assert(rE.global.spawned === 0 && rE.bottlenecks.length === 0, '위협 0: 생성·병목 0');
assert(rE.nodes.every(function (n) { return n.rho === 0 && isFinite(n.rho); }), '위협 0: ρ=0, NaN 없음');
assert(run('sc3', 'asis', 0, 1).global.spawned === 0, '강도 0: 생성 0');
var rSat = run('sc3', 'asis', 3.0, 7);
assert(isFinite(rSat.eventCount) && rSat.eventCount > 0, '포화: 이벤트 루프 정상 종료');
assert(rSat.nodes.every(function (n) { return n.rho <= 1.0000001; }), '포화: 관측 ρ ≤ 1');
assert(rSat.nodes.some(function (n) { return n.drops > 0; }) && rSat.global.leaked > 0, '포화: 드롭·누수 발생');
assert(rSat.bottlenecks.length > 0, '포화: 병목 도출');

console.log('# 시나리오 기반 병목 (고정 아님) — KJADS 문제 상황 1·2·3');
var sig = {};
['sc1', 'sc2', 'sc3'].forEach(function (id) {
  [1, 2.5].forEach(function (x) {
    ['asis', 'tobe'].forEach(function (mode) {
      var r = run(id, mode, x, 100);
      sig[id + '/' + mode + '/' + x] = r.bottlenecks.map(function (b) { return b.kind + ':' + b.id; }).sort().join(',');
    });
  });
});
assert(new Set(Object.values(sig)).size > 3, '시나리오·강도·모드별 병목 다양 (' + new Set(Object.values(sig)).size + '종)');
// legacy ICC 확장 후에도 저강도에서 처리 노드는 포화되지 않아야 한다.
// [2026-07 C2-VOICE-COORD-01 실험 변경] 음성협조가 180s 삼각분포 → 10~30s 균등분포로
// 단축되어, 종전 "메시지 1건 체류만으로 통신병목 기준 충족"이던 ICC→MCRC 링크 신호가
// 저강도에서 소멸한다. 원 파라미터(Triangular 90/180/270)로 되돌리면 이 어서션도
// some(...) 존재 검사로 복원할 것.
var sc1Low = run('sc1', 'asis', 0.5, 5);
assert(sc1Low.bottlenecks.filter(function (b) { return b.kind === 'node'; }).length === 0,
  'SC1 저강도(0.5×): 처리 노드 용량 병목 0');
assert(!sc1Low.bottlenecks.some(function (b) {
  return b.kind === 'link' && /^ICC-[WCE]\d→MCRC$/.test(b.id);
}), 'SC1 저강도(0.5×): 10~30s 음성협조에서는 ICC→MCRC 통신병목 신호 소멸 (실험 변경 정본)');
// ADR-066: SC2는 이 단조성을 담을 수 있는 신호가 아니다 — 실측상 SC2의 병목 목록은 거의 항상
// 비어 있고, 37개 위협 중 **1개**가 교전창을 놓친 범주형 gap 1건으로만 채워졌다가 강도를 올리면
// 그 1건이 재현되지 않아 0이 된다(x1: gap 1건 → x2.5: 0건). 임계를 느슨하게 하는 대신 SC2는
// **지배 메커니즘**을 직접 어서션한다: SC2의 누수는 어느 강도에서도 사격통제 부족이 지배하며
// 부하와 함께 증가한다(no_fire_control x1 9건 → x2.5 19건). "무인기 문제는 C2 통합이 아니라
// 교전 수단의 한계"라는 G6 관측과 같은 방향이다.
var sc2Low = run('sc2', 'asis', 1, 100), sc2High = run('sc2', 'asis', 2.5, 100);
function leaks(r, code) { return (r.global.leakReasons || {})[code] || 0; }
assert(leaks(sc2Low, 'no_fire_control') > 0 && leaks(sc2High, 'no_fire_control') > leaks(sc2Low, 'no_fire_control'),
  'SC2: 지배 누수 사유가 no_fire_control이고 부하와 함께 증가 (' +
  leaks(sc2Low, 'no_fire_control') + ' → ' + leaks(sc2High, 'no_fire_control') + '건)');
assert(leaks(sc2High, 'no_fire_control') >
  Object.keys(sc2High.global.leakReasons || {}).reduce(function (m, k) {
    return k === 'no_fire_control' ? m : m + sc2High.global.leakReasons[k];
  }, 0), 'SC2 고강도: 사격통제 부족이 나머지 누수 사유 합보다 큼 — C2가 아니라 교전 수단의 한계');
['sc3'].forEach(function (id) {
  assert(run(id, 'asis', 2.5, 100).bottlenecks.length >= run(id, 'asis', 1, 100).bottlenecks.length,
    id + ': 강도↑ 병목 비감소');
});

console.log('# burst 동시 다발 (SC2 무인기 1차 8대 + 2차 남파)');
var rB = run('sc2', 'asis', 1, 77);
var wave1 = KJ.scenarioById('sc2').mix.filter(function (m) { return m.burst && m.atSec === 60; })
  .reduce(function (s, m) { return s + m.burst; }, 0);
var burstTotal = KJ.scenarioById('sc2').mix.reduce(function (s, m) { return s + (m.burst || 0); }, 0);
assert(wave1 === 8, 'SC2 1차 남파(t=60s) 동시 8대 (문제 상황 2 명세)');
assert(burstTotal > wave1, 'SC2 2차 남파 존재 — 위협 다양화 (총 burst ' + burstTotal + '대)');
assert(rB.global.spawned >= burstTotal, 'SC2: 생성 위협 ≥ 총 burst ' + burstTotal + '대 (' + rB.global.spawned + '건)');
assert(run('sc2', 'asis', 0, 77).global.spawned === 0, 'SC2 강도 0: burst 포함 생성 0');
assert(JSON.stringify(run('sc2', 'asis', 1, 77)) === JSON.stringify(rB), 'SC2 burst 포함 재현성 유지');

console.log('# To-Be 개선');
var a = run('sc3', 'asis', 1.5, 9), b = run('sc3', 'tobe', 1.5, 9);
assert(b.global.leakRate < a.global.leakRate, 'To-Be 누수율 < As-Is (' +
  (a.global.leakRate * 100).toFixed(0) + '% → ' + (b.global.leakRate * 100).toFixed(0) + '%)');
// ADR-078·079 이후 「병목 개수 ≤」 비교는 성격이 다른 것을 한 저울에 올린다:
// ① To-Be KAMDOC 병목은 병렬 통보(도메인 상황인식) 부하다 — 교전을 gate하지 않는다(ADR-078).
// ② To-Be 포대 용량차단 증가는 더 많이 쏘는 결과다(처리량이지 기능부전이 아니다).
// 원래 재려던 것은 「C2가 늦어 교전창을 놓친 누수」이므로 그것을 직접 잠근다.
function gapLeaks(r, id) {
  var g = r.bottlenecks.find(function (x) { return x.id === id; });
  var m = g && /누수 (\d+)건/.exec(g.detail);
  return m ? +m[1] : 0;
}
assert(gapLeaks(b, 'window_lost_due_to_c2') < gapLeaks(a, 'window_lost_due_to_c2'),
  'C2 지연 기인 교전창 상실 누수: To-Be < As-Is (' +
  gapLeaks(a, 'window_lost_due_to_c2') + '건 → ' + gapLeaks(b, 'window_lost_due_to_c2') + '건)');
// To-Be에서 새로 생기는 노드 병목은 포대(교전량 증가) 또는 도메인 제대(ADR-078 병렬 통보 부하)뿐
// 이어야 한다 — C2 결심 계선에 새 병목이 생기면 통합이 제 일을 못 하는 것이다.
var extraBn = b.bottlenecks.filter(function (x) {
  return x.kind === 'node' && !a.bottlenecks.some(function (y) { return y.id === x.id; });
});
assert(extraBn.every(function (x) {
  return /^BATTERY_/.test(x.id) || x.id === 'C2_KAMD_OPS_KAMD_OPS' || x.id === 'C2_MCRC_MCRC';
}), 'To-Be 신규 병목은 포대(교전량 증가) 또는 도메인 제대(상황인식 부하)뿐 (' +
  (extraBn.map(function (x) { return x.id; }).join(', ') || '없음') + ')');

console.log('# 제약·보존');
// 탄도탄 단독 구성(검증용 인라인 시나리오) — SHORAD 교전 불가 제약의 행위 검증
var balScn = {
  id: 'test-ballistic', name: '탄도탄 단독(검증용)',
  mix: [{ type: 'srbm', axis: 'central', ratePerMin: 1.0 },
        { type: 'srbm', axis: 'east', ratePerMin: 0.5 }]
};
var rBal = KJ.runDES({ scenario: balScn, mode: 'asis', intensity: 2, seed: 3, endTimeSec: 1800 });
assert(rBal.nodes.filter(function (n) { return n.id.indexOf('SHORAD') === 0 && n.arrivals > 0; }).length === 0,
  '탄도탄 단독 구성: 신궁·천마 교전투입 0 (제약)');
[a, b, rSat].forEach(function (r, i) {
  assert(r.global.spawned - r.global.killed - r.global.leaked >= 0, 'run' + i + ': 생성 ≥ 격추+누수 (보존)');
});

console.log('# 흐름 카운터 (Sankey/funnel용, trace 무관 항상 제공)');
var flowRun = run('sc3', 'asis', 1.5, 21);
assert(flowRun.flow.spawned >= flowRun.flow.detected, 'flow: 생성 ≥ 탐지');
assert(flowRun.flow.detected >= flowRun.flow.reachedC2, 'flow: 탐지 ≥ C2도달');
assert(flowRun.flow.reachedC2 >= flowRun.flow.everEngaged, 'flow: C2도달 ≥ 교전개시(단발집계)');
assert(flowRun.flow.everEngaged >= flowRun.flow.killed, 'flow: 교전개시 ≥ 격추');
assert(!flowRun.threatTraces && !flowRun.nodeSeries, 'trace 미지정 시 threatTraces/nodeSeries 미포함(오버헤드 없음)');

console.log('# Phase 4 trace 모드');
var tr = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 21, endTimeSec: 1800, trace: true, traceCap: 300 });
assert(JSON.stringify(tr.global) === JSON.stringify(flowRun.global), 'trace:true 이어도 통계 결과는 trace:false와 완전 동일(부수효과 없음)');
assert(Array.isArray(tr.threatTraces) && tr.threatTraces.length > 0, 'threatTraces 기록됨 (' + tr.threatTraces.length + '건)');
assert(tr.threatTraces.length <= 300, 'threatTraces가 traceCap(300) 이내로 절삭');
assert(tr.threatTraces.every(function (tt) { return tt.stages.length >= 2 && tt.stages[0].name === '생성'; }),
  '각 trace는 "생성" 단계로 시작하고 최소 2단계 이상 기록');
assert(tr.threatTraces.every(function (tt) {
  for (var i = 1; i < tt.stages.length; i++) if (tt.stages[i].t < tt.stages[i - 1].t) return false;
  return true;
}), '각 trace의 단계 타임스탬프가 비감소(시간순)');
// Phase 5 리뷰 발견 1 회귀: trace 종결(exitT) 이후 단계가 기록되지 않아야 함
// (누수한 위협의 잔여 서버 완료 콜백이 exitT 이후 _mark를 추가해 Gantt 구간 합이
//  100%를 초과하던 결함 — 포화 조건에서 재현되었음)
(function () {
  var violations = 0, checked = 0;
  [0, 21, 42].forEach(function (sd) {
    var r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 3, seed: sd, endTimeSec: 1800, trace: true, traceCap: 300 });
    r.threatTraces.forEach(function (tt) {
      if (tt.exitT === null) return;
      checked++;
      tt.stages.forEach(function (s) { if (s.t > tt.exitT + 1e-9) violations++; });
    });
  });
  assert(checked > 100 && violations === 0,
    '종결된 trace(' + checked + '건)에 exitT 이후 단계 없음 — Gantt 구간 합 ≤100% 보장 (위반 ' + violations + ')');
})();
assert(tr.threatTraces.filter(function (tt) { return tt.outcome !== null; }).length > 0,
  '일부 위협은 종결(killed/leaked) outcome 기록');
assert(Object.keys(tr.nodeSeries).length > 0, 'nodeSeries가 노드별로 기록됨');
Object.keys(tr.nodeSeries).forEach(function (id) {
  var series = tr.nodeSeries[id];
  for (var i = 1; i < series.length; i++) {
    if (series[i].t < series[i - 1].t) { assert(false, 'nodeSeries[' + id + '] 시간 역행'); return; }
  }
  assert(series.every(function (s) { return s.n >= 0; }), 'nodeSeries[' + id + '] 재고 음수 없음');
});
// trace 재현성: 동일 seed → 동일 trace (threatTraces/nodeSeries 포함 완전 동일)
var tr2 = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 21, endTimeSec: 1800, trace: true, traceCap: 300 });
assert(JSON.stringify(tr) === JSON.stringify(tr2), 'trace 포함 결과도 동일 seed → 완전 동일 (재현성)');
// traceCap 절삭 동작: 상한을 낮게 주면 truncated 플래그가 서고, 배열은 상한을 넘지 않음
var trCap = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 21, endTimeSec: 1800, trace: true, traceCap: 5 });
assert(trCap.threatTraces.length <= 5, 'traceCap=5: threatTraces ≤ 5건');
assert(trCap.traceTruncated === true, 'traceCap 초과 시 traceTruncated=true (절삭을 숨기지 않음)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
