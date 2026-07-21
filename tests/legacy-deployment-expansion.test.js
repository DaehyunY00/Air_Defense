/** legacy 대표 배치 10개 ICC–ECS–MFR–포대 세트 회귀 검증. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..');
[
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
  'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function node(id) { return KJ.NODES.find(function (n) { return n.id === id; }); }
function link(from, to, mode) {
  return KJ.LINKS.find(function (l) { return l.from === from && l.to === to && l.comm[mode]; });
}
function signature(r) {
  return JSON.stringify({ global: r.global, flow: r.flow, nodes: r.nodes, links: r.links, eventCount: r.eventCount });
}

var sites = KJ.LEGACY_AIR_DEFENSE_SITES;
assert(Array.isArray(sites) && sites.length === 10, 'legacy 확장 사이트 10개');
var regionCounts = sites.reduce(function (a, s) { a[s.region] = (a[s.region] || 0) + 1; return a; }, {});
assert(regionCounts.west === 4 && regionCounts.central === 3 && regionCounts.east === 3,
  '권역 분포 서4·중3·동3');
var weaponCounts = sites.reduce(function (a, s) { a[s.weapon] = (a[s.weapon] || 0) + 1; return a; }, {});
assert(weaponCounts.CHUNMA === 5 && weaponCounts.CHEONGUNG2 === 5, '천마 5개·천궁-II 5개');

var expanded = KJ.NODES.filter(function (n) { return /^(ICC|ECS|MFR|BAT)-(?:CHUNMA-|CHEONGUNG2-)?[WCE]\d$/.test(n.id); });
assert(expanded.length === 40 && KJ.NODES.length === 64, 'ICC·ECS·MFR·포대 각 10개 추가(legacy 총 64노드)');
assert(new Set(KJ.NODES.map(function (n) { return n.id; })).size === KJ.NODES.length, '전역 노드 ID 유일');
assert(expanded.every(function (n) {
  return ['west', 'central', 'east'].indexOf(n.deploymentRegion) !== -1 &&
    Array.isArray(n.coord) && /개념좌표/.test(n.coordNote) && /실제 군사시설 위치 아님/.test(n.coordNote);
}), '모든 추가 자산에 권역·도시 수준 개념좌표 고지');

assert(sites.every(function (s) {
  var icc = node('ICC-' + s.key), ecs = node('ECS-' + s.key), mfr = node('MFR-' + s.key);
  var shooter = node('BAT-' + s.weapon + '-' + s.key);
  return icc && ecs && mfr && shooter &&
    icc.pairedEcsId === ecs.id && ecs.pairedIccId === icc.id &&
    ecs.pairedShooterId === shooter.id && shooter.pairedMfrId === mfr.id &&
    shooter.pairedEcsId === ecs.id && mfr.pairedEcsId === ecs.id;
}), '10개 세트의 ICC↔ECS↔MFR↔포대 참조 완전성');
assert(sites.every(function (s) {
  var k = s.key, shooter = 'BAT-' + s.weapon + '-' + k;
  return link('MFR-' + k, 'ECS-' + k, 'asis') && link('MFR-' + k, 'ECS-' + k, 'tobe') &&
    link('ECS-' + k, 'ICC-' + k, 'asis') && link('ICC-' + k, 'ECS-' + k, 'asis') &&
    link('ICC-' + k, 'MCRC', 'asis') && link('MCRC', 'ICC-' + k, 'asis') &&
    link('ECS-' + k, shooter, 'asis') && link('ECS-' + k, shooter, 'tobe');
}), 'As-Is 양방향 협조·포대명령 및 양모드 MFR/ECS 연결 완전성');
assert(sites.every(function (s) {
  return link('MFR-' + s.key, 'JAMDC2', 'tobe') && link('ICC-' + s.key, 'JAMDC2', 'tobe') &&
    link('JAMDC2', 'ICC-' + s.key, 'tobe');
}), 'To-Be JAMDC2 직결·통합협조 경로 완전성');
assert(sites.every(function (s) {
  var voice = link('ICC-' + s.key, 'MCRC', 'asis');
  var fast = link('ICC-' + s.key, 'MCRC', 'tobe');
  return voice.comm.asis.type === 'voice' && voice.comm.asis.delaySec === 180 &&
    fast.comm.tobe.type === 'datalink' && fast.comm.tobe.delaySec === 2;
}), 'ICC→MCRC는 As-Is 180초 음성/VTC, To-Be 2초 데이터링크');

var chunma = expanded.filter(function (n) { return /^BAT-CHUNMA-/.test(n.id); });
var cheongung = expanded.filter(function (n) { return /^BAT-CHEONGUNG2-/.test(n.id); });
assert(chunma.every(function (n) {
  return n.canEngage.srbm === false && n.canEngage.mrl_large === false && n.engage.channels === 6 && n.engage.magazine === 48;
}), '천마: 탄도탄 배제·6채널·48발');
assert(cheongung.every(function (n) {
  return n.canEngage.srbm === true && n.canEngage.mrl_large === true && n.engage.channels === 10 && n.engage.magazine === 32;
}), '천궁-II: 하층 탄도 교전·10채널·32발');
assert(KJ.LINKS.length === 134, 'legacy 링크 90개 추가(총 134개)');

['asis', 'tobe'].forEach(function (mode) {
  var cfg = { scenario: KJ.scenarioById('sc1'), mode: mode, intensity: 0.5, seed: 5, endTimeSec: 1800 };
  var a = KJ.runDES(cfg), b = KJ.runDES(cfg);
  assert(signature(a) === signature(b), mode + ' 확장 legacy 결정론적 재현');
  assert(a.global.spawned === a.global.killed + a.global.leaked + a.global.censoredRaw,
    mode + ' 확장 legacy 보존법칙');
  if (mode === 'asis') {
    assert(a.nodes.filter(function (n) { return /^ECS-[WCE]\d$/.test(n.id) && n.arrivals > 0; }).length === 10,
      'asis 10개 ECS가 전속 MFR 항적을 직접 접수');
  } else {
    assert(a.nodes.some(function (n) { return n.id === 'JAMDC2' && n.arrivals > 0; }),
      'tobe MFR 항적이 JAMDC2 통합경로로 도착');
  }
  assert(a.nodes.some(function (n) { return /^BAT-(CHUNMA|CHEONGUNG2)-[WCE]\d$/.test(n.id) && n.arrivals > 0; }),
    mode + ' 추가 포대가 실제 교전 파이프라인에 참여');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
