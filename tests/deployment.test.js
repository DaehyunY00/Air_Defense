/** Phase 0–1 high-resolution deployment declaration invariants. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js'].forEach(function (f) {
  require(path.join(root, 'js', f));
});
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

var expected = {
  HANBANDO_MINI_NORMAL: [11, 8, 14, 8, 0],
  HANBANDO_MINI_MCRC_DOWN: [11, 8, 13, 8, 0],
  HANBANDO_MINI_KAMDOC_DOWN: [11, 8, 13, 8, 0],
  HANBANDO_FULL_NORMAL: [71, 84, 98, 84, 45],
  HANBANDO_FULL_MCRC_DOWN: [71, 84, 97, 84, 45],
  HANBANDO_FULL_KAMDOC_DOWN: [71, 84, 97, 84, 45]
};

assert(JSON.stringify(KJ.DEPLOYMENT_IDS) === JSON.stringify(Object.keys(expected)), '6개 배치 ID·순서 고정');
KJ.DEPLOYMENT_IDS.forEach(function (id) {
  var d = KJ.deploymentById(id), e = expected[id];
  var ecs = d.c2Nodes.filter(function (c) { return c.typeId === 'ECS'; }).length;
  var shorad = d.batteries.filter(function (b) { return b.shooterTypeId === 'BIHO' || b.shooterTypeId === 'CHUNMA'; }).length;
  assert(d.sensors.length === e[0] && d.batteries.length === e[1] && d.c2Nodes.length === e[2] && ecs === e[3] && shorad === e[4],
    id + ' 센서/포대/C2/ECS/SHORAD 수량');
  assert(Object.isFrozen(d) && Object.isFrozen(d.positions) && Object.isFrozen(d.batteries) && Object.isFrozen(d.sensors), id + ' 불변 선언');
});

['MINI', 'FULL'].forEach(function (size) {
  var n = KJ.deploymentById('HANBANDO_' + size + '_NORMAL');
  var m = KJ.deploymentById('HANBANDO_' + size + '_MCRC_DOWN');
  var k = KJ.deploymentById('HANBANDO_' + size + '_KAMDOC_DOWN');
  assert(n.positions === m.positions && n.positions === k.positions && n.batteries === m.batteries && n.batteries === k.batteries && n.sensors === m.sensors && n.sensors === k.sensors,
    size + ' NORMAL/DOWN 물리 positions·batteries·sensors 동일 참조');
  function types(d) { return d.c2Nodes.map(function (c) { return c.typeId + ':' + c.posKey; }); }
  var nt = types(n), mt = types(m), kt = types(k);
  assert(nt.length - mt.length === 1 && nt.filter(function (x) { return mt.indexOf(x) === -1; }).every(function (x) { return x.indexOf('MCRC:') === 0; }), size + ' MCRC_DOWN은 MCRC 1개만 제거');
  assert(nt.length - kt.length === 1 && nt.filter(function (x) { return kt.indexOf(x) === -1; }).every(function (x) { return x.indexOf('KAMD_OPS:') === 0; }), size + ' KAMDOC_DOWN은 KAMDOC 1개만 제거');
});

var full = KJ.deploymentById('HANBANDO_FULL_NORMAL');
var shooterCounts = full.batteries.reduce(function (o, b) { o[b.shooterTypeId] = (o[b.shooterTypeId] || 0) + 1; return o; }, {});
assert(JSON.stringify(shooterCounts) === JSON.stringify({ LSAM: 3, CHEONGUNG2: 22, PAC3: 8, BIHO: 28, CHUNMA: 17, THAAD: 1, USFK_PAC3: 5 }), 'FULL 체계별 포대 수량');

function checkShorad(type, nodes, vehicles, rounds, concurrency) {
  var xs = full.batteries.filter(function (b) { return b.shooterTypeId === type; });
  assert(xs.length === nodes && xs.reduce(function (s, b) { return s + b.quantity; }, 0) === vehicles, type + ' 노드/차량 합계');
  assert(xs.every(function (b) {
    return b.launcherConfig.launcherCount === b.quantity && b.launcherConfig.roundsPerLauncher === rounds &&
      b.launcherConfig.perVehicleConcurrency === concurrency && b.launcherConfig.aggregateRounds === b.quantity * rounds &&
      b.reloadConfig.scope === 'per-launcher' && b.reloadConfig.durationSec === 900;
  }), type + ' 차량별 탄약·동시교전·900초 개별 재장전 스키마');
}
checkShorad('BIHO', 28, 167, 4, 4);
checkShorad('CHUNMA', 17, 100, 8, 8);

KJ.DEPLOYMENT_IDS.forEach(function (id) {
  var d = KJ.deploymentById(id), ids = [];
  var batteryRefsOk = true, c2RefsOk = true;
  d.batteries.forEach(function (b) {
    ids.push(b.id);
    batteryRefsOk = batteryRefsOk && !!d.positions[b.posKey] && (!b.mfrSensorPosKey || !!d.positions[b.mfrSensorPosKey]);
  });
  d.sensors.forEach(function (s) { ids.push(s.id); });
  d.c2Nodes.forEach(function (c) {
    ids.push(c.id);
    c2RefsOk = c2RefsOk && !!d.positions[c.posKey] && (!c.batteryId || d.batteries.some(function (b) { return b.id === c.batteryId; }));
  });
  assert(batteryRefsOk, id + ' 모든 포대·MFR 참조');
  assert(c2RefsOk, id + ' 모든 C2·ECS 참조');
  assert(new Set(ids).size === ids.length, id + ' 전역 인스턴스 ID 유일');
  assert(d.batteries.every(function (b) {
    if (!b.mfrSensorPosKey) return true;
    var batteryPos = d.positions[b.posKey], sensorPos = d.positions[b.mfrSensorPosKey];
    return batteryPos.lon === sensorPos.lon && batteryPos.lat === sensorPos.lat &&
      sensorPos.coLocatedWith === b.posKey;
  }), id + ' 포대·ECS·MFR/레이더 동일 위·경도');
  assert(Object.keys(d.positions).every(function (key) {
    var p = d.positions[key];
    return typeof p.lon === 'number' && typeof p.lat === 'number' && typeof p.alt === 'number' && p.confidence && p.sourceNote && /(개념|공개)/.test(p.coordNote);
  }), id + ' {lon,lat,alt}+confidence/sourceNote/coordNote');
});

var shoradSensors = full.sensors.filter(function (s) { return s.typeId === 'BIHO' || s.typeId === 'CHUNMA'; });
assert(shoradSensors.length === 0 && KJ.SHOOTER_TYPES.BIHO.integratedSensor && KJ.SHOOTER_TYPES.CHUNMA.integratedSensor, 'SHORAD 통합 센서는 타입 내장, 별도 센서 인스턴스 없음');
var nonShorad = full.batteries.filter(function (b) { return b.shooterTypeId !== 'BIHO' && b.shooterTypeId !== 'CHUNMA'; });
assert(nonShorad.every(function (b) {
  return full.sensors.some(function (s) { return s.posKey === b.mfrSensorPosKey; }) && full.c2Nodes.some(function (c) { return c.typeId === 'ECS' && c.batteryId === b.id; });
}), '비SHORAD 포대별 MFR·ECS 1:1 참조');

var usfkBatteries = full.batteries.filter(function (b) { return b.forceOwner === 'USFK'; });
assert(usfkBatteries.filter(function (b) { return b.shooterTypeId === 'THAAD'; }).length === 1 && usfkBatteries.filter(function (b) { return b.shooterTypeId === 'USFK_PAC3'; }).length === 5, 'USFK THAAD 1·Patriot 5 독립축 선언');
assert(KJ.deploymentById('HANBANDO_MINI_NORMAL').positions.GREEN_PINE.confidence === 'estimated', 'MINI 비공개 메타 estimated 표시');

var mdl = KJ.sampleMdlDefensePoints(126.80, 128.30, 25);
assert(mdl.length === 25 && mdl.every(function (p) {
  var south = KJ.mdlDefenseSouthLat(p.lon, 6);
  return south < p.lat && Math.abs((p.lat - south) * KJ.KM_PER_DEG_LAT - 6) < 0.01;
}), 'MDL 방어 개념 벨트 6km 남측 오프셋 불변식');
var mouth = full.positions.BIHO_CO1;
assert(mouth && mouth.lat < 38 && mouth.lon < 127, '한강하구 SHORAD 남안 수동 앵커 불변식');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
