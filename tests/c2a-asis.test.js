/** FULL As-Is 군단 AOC C2A 항적융합·제한형 교전현황 공유 회귀. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ, fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(deploymentId, trace) {
  return KJ.runDES({
    scenario: KJ.scenarioById('sc1'), mode: 'asis', intensity: 1.5, seed: 42,
    endTimeSec: 1800, trace: !!trace, traceCap: 300, deploymentId: deploymentId,
    features: { highResolutionDeployment: true }
  });
}

var catalog = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL');
var mcrc = catalog.nodes.find(function (n) { return n.typeId === 'MCRC'; });
var aocs = catalog.nodes.filter(function (n) { return n.typeId === 'ARMY_LOCAL_AD'; });
assert(aocs.length === 5 && aocs.every(function (n) { return n.architectureRole === 'CORPS_AOC_C2A'; }),
  'FULL 5개 육군·수방사·해병 권역 C2를 군단 AOC/C2A 역할로 명시');
assert(aocs.every(function (aoc) {
  return catalog.links.some(function (l) {
    return l.from === mcrc.id && l.to === aoc.id && l.kind === 'report' && l.comm.asis;
  });
}), 'MCRC 공중항적→전 군단 AOC 보고경로');
var statusLinks = catalog.links.filter(function (l) {
  return aocs.some(function (aoc) { return l.from === aoc.id; }) && l.to === mcrc.id && l.kind === 'status';
});
assert(statusLinks.length === 5 && statusLinks.every(function (l) {
  var c = l.comm.asis;
  return c && c.type === 'voice-vtc' && c.messageServers === 1 && c.messageCapacity === 4 && c.freshnessSec === 300;
}), '군단 AOC→MCRC 음성/VTC 1채널·4건 제한·300초 신선도');

var normal = run('HANBANDO_FULL_NORMAL', true);
var coord = normal.global.coordination;
assert(normal.global.commanderAssignments.MCRC > 0 && normal.global.commanderAssignments.ARMY_LOCAL_AD > 0,
  'ABT에 MCRC와 군단 AOC 독립 책임축 모두 실행');
assert(coord.trackFusion.multiSourceTracks > 0 && coord.trackFusion.reportsReceived > coord.trackFusion.fusedTracks,
  '군단 AOC에서 MCRC+국지레이더 복수출처 항적융합');
assert(coord.trackFusion.prioritizedTracks === coord.trackFusion.fusedTracks,
  '융합항적 전건에 위협군·잔여시간 우선순위 부여');
assert(coord.statusSharing.sent > 0 && coord.statusSharing.delivered > 0 &&
  coord.statusSharing.queued > 0 && coord.statusSharing.dropped > 0,
  '제한형 교전현황 채널의 전송·대기·수신·드롭 실제 발생');
assert(coord.statusSharing.duplicatesDueToStaleState > 0 &&
  coord.statusSharing.duplicatesDueToStaleState <= coord.realDuplicates,
  '군단 AOC↔MCRC 교전상태 지연·드롭이 실제 중복교전 원인으로 계산');
assert(normal.threatTraces.some(function (tr) {
  var names = tr.stages.map(function (s) { return s.name; });
  return names.some(function (n) { return n.indexOf('항적융합:') === 0; }) &&
    names.some(function (n) { return n.indexOf('위협우선순위:') === 0; }) &&
    names.some(function (n) { return n.indexOf('자체교전승인:') === 0; });
}), 'trace에 항적접수→융합→우선순위→자체승인 단계 기록');

var down = run('HANBANDO_FULL_MCRC_DOWN', false);
assert(down.global.coordination.trackFusion.multiSourceTracks === 0 &&
  down.global.coordination.statusSharing.sent === 0,
  'MCRC DOWN이면 MCRC 유래 융합·MCRC 현황공유가 자동 제거');
var normal2 = run('HANBANDO_FULL_NORMAL', false);
assert(JSON.stringify(normal.global.coordination) === JSON.stringify(normal2.global.coordination),
  '동일 seed C2A 융합·메시지·중복교전 결정론');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
