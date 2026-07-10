/**
 * K-JAMDS 시뮬레이터 — 정밀화(Refine) 회귀 테스트 (Phase A~D)
 * 실행:  node tests/refine.test.js   (저장소 루트에서)
 *
 * Phase A: 위협 사거리대·발사권역 데이터 존재 + 축선-사거리 정합(ENV-AXIS-FIT-01)
 *          + 시드 고정 스냅샷(엔진 의미 불변 확인 — 엔진 변경 Phase에서 의도적 갱신)
 * Phase B: Best-Shooter 적합도 WTA·부하 기반 동적 권한위임(부하의 함수)·제약 유지
 * Phase C: 실패원인 taxonomy 완전성 + To-Be 원인분포 구조적 개선 방향
 * Phase D: 신규 지표(결심지연·비용교환비) 계산·결정론
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, seed, dur) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: dur || 1800 });
}

// ══════════ Phase A — 위협 출발점 정합화 ══════════
console.log('# A-1 위협별 사거리대·발사권역 데이터 (개념값, THR-*-RNG-*)');
var typeKeys = Object.keys(KJ.THREAT_TYPES);
assert(typeKeys.every(function (k) {
  var t = KJ.THREAT_TYPES[k];
  return t.rangeBandKm && t.rangeBandKm.min > 0 && t.rangeBandKm.max >= t.rangeBandKm.min &&
    Array.isArray(t.originZones) && t.originZones.length > 0 && typeof t.rangeRef === 'string';
}), '전 위협(' + typeKeys.length + '종) rangeBandKm{min,max}·originZones·rangeRef 보유');
assert(typeKeys.every(function (k) {
  return KJ.THREAT_TYPES[k].originZones.every(function (z) { return z in KJ.ORIGIN_ZONES; });
}), '전 originZones 태그가 KJ.ORIGIN_ZONES 정의에 존재');
assert(KJ.THREAT_TYPES.srbm.originZones.join() === 'deep' &&
  KJ.THREAT_TYPES.mrl_large.originZones.join() === 'deep',
  '탄도탄(srbm·mrl_large)은 종심(deep) 발사권역 전용');
assert(KJ.THREAT_TYPES.uav_small.originZones.indexOf('deep') === -1,
  '근거리 무인기는 종심(deep) 발사권역 미포함 (근거리 정합)');

console.log('# A-2 축선 발사권역·개념거리 (ENV-AXIS-FIT-01)');
var axisKeys = Object.keys(KJ.AXES);
assert(axisKeys.every(function (k) {
  var a = KJ.AXES[k];
  return Array.isArray(a.launchZones) && a.launchZones.length > 0 &&
    a.conceptReachKm > 0 && typeof a.reachNote === 'string' && a.reachNote.indexOf('개념') !== -1;
}), '전 축선(' + axisKeys.length + '개) launchZones·conceptReachKm·"개념" 명시 reachNote 보유');
assert(KJ.AXES.seoul.launchZones.join() === 'dmz',
  'seoul 축선은 DMZ 인접 근거리 전용 (종심 위협 배분 차단)');

console.log('# A-3 시나리오 배분의 축선-사거리 정합');
KJ.SCENARIOS.forEach(function (sc) {
  var v = KJ.validateScenarioOrigins(sc);
  assert(v.length === 0, sc.id + ': 위반 0건' +
    (v.length ? ' — ' + JSON.stringify(v) : ''));
});
assert(!KJ.checkAxisThreatFit('srbm', 'seoul').ok,
  '부정 케이스: 종심 전용 srbm의 seoul(근거리) 축선 배분은 거부됨');
assert(!KJ.checkAxisThreatFit('uav_small', '없는축선').ok, '부정 케이스: 미정의 축선 거부');

console.log('# A-4 정합화는 데이터 계층 — 병목 도출·통계의 부하 함수성 유지 (스냅샷)');
// 시드 고정 스냅샷: 엔진 의미가 바뀌면(의도된 Phase B 등) 이 값을 갱신하고 커밋 메시지에 명시.
var SNAPSHOT = require('./refine-snapshot.json');
Object.keys(SNAPSHOT).forEach(function (key) {
  var p = key.split('/'); // sc/mode
  var r = run(p[0], p[1], 1.5, 42);
  var got = {
    spawned: r.global.spawned, killed: r.global.killed, leaked: r.global.leaked,
    bn: r.bottlenecks.map(function (b) { return b.kind + ':' + b.id; }).sort().join(',')
  };
  assert(JSON.stringify(got) === JSON.stringify(SNAPSHOT[key]),
    '스냅샷 ' + key + ' 일치 (기대 ' + JSON.stringify(SNAPSHOT[key]) + ' / 실제 ' + JSON.stringify(got) + ')');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
