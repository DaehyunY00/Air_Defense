/**
 * LEGACY_HIRES 배치 회귀 — legacy 자산 배치 위에서 고해상도(iads-c2) 실행 (ADR-054).
 *
 * 검증 관점:
 *  1) 두 충실도(compat·iads-c2) 모두 실행되고, iads-c2가 물리 계층을 실제로 사용한다
 *  2) 자산 구성이 legacy 편성을 따른다(10세트 교차 배치 + 국지방공 + 미사일방어부대)
 *  3) 제외 자산군(전투기·이지스·조기경보기·광학감시)이 실제로 없다
 *  4) 노드 파괴 변형에서 책임 C2가 권역 ICC로 대체된다
 *  5) 기존 배치·legacy(compat) 경로에 영향이 없다
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });

var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

function catalogOf(id) {
  return KJ.resolveModelCatalog({ deploymentId: id, features: { highResolutionDeployment: true } });
}
function run(id, mode, fidelity) {
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode: mode, intensity: 1, seed: 12345, endTimeSec: 1800,
    deploymentId: id, features: { highResolutionDeployment: true }, modelFidelity: fidelity
  });
}

// ── 1. 등록·구성 ──
console.log('# 배치 등록과 자산 구성');
assert(KJ.DEPLOYMENT_IDS.indexOf('HANBANDO_LEGACY_NORMAL') !== -1,
  'LEGACY_NORMAL이 배치 레지스트리에 등록됨(UI 드롭다운은 DEPLOYMENT_IDS에서 생성)');
['HANBANDO_LEGACY_MCRC_DOWN', 'HANBANDO_LEGACY_KAMDOC_DOWN'].forEach(function (id) {
  assert(KJ.DEPLOYMENT_IDS.indexOf(id) !== -1, id + ' 등록됨');
});

var cat = catalogOf('HANBANDO_LEGACY_NORMAL');
var nodes = KJ.nodesInMode('asis', cat);
var shooters = nodes.filter(function (n) { return n.category === 'shooter'; });
var byType = shooters.reduce(function (o, n) { o[n.typeId] = (o[n.typeId] || 0) + 1; return o; }, {});
console.log('    사수 타입 분포: ' + JSON.stringify(byType));
assert(byType.CHUNMA === 5, 'legacy 10세트의 천마 5개가 CHUNMA로 이식됨');
assert(byType.CHEONGUNG2 === 6, '천궁-II 5세트 + 군단 중거리(MSAM-1C) = CHEONGUNG2 6개');
assert(byType.BIHO === 2, 'legacy SHORAD 2개가 BIHO로 이식됨');
assert(byType.LSAM === 1 && byType.PAC3 === 1, '미사일방어부대 MDU-L→LSAM · MDU-M→PAC3');

// ── 2. 제외 자산군이 실제로 없는지 ──
console.log('# 의도적 제외 자산군');
assert(!byType.THAAD && !byType.USFK_PAC3,
  'legacy 배치에는 THAAD·USFK Patriot이 없다(legacy 제약과 정합)');
var names = nodes.map(function (n) { return n.name || ''; }).join(' ');
assert(!/이지스|SM-2|조기경보|E-737/.test(names),
  '전투기·이지스·조기경보기는 대응 타입이 없어 제외됨');

// ── 3. 천마 포대는 전속 MFR을 갖지 않는다 (FC 게이팅 함정 회피) ──
console.log('# 화력통제 배선');
var chunma = shooters.filter(function (n) { return n.typeId === 'CHUNMA'; });
assert(chunma.every(function (n) { return !n.mfrSensorId; }),
  '천마 포대에 mfrSensorId가 없음 — TPS880K는 fireControl 사거리가 없어 물리면 영구 미발사가 된다');
var msam = shooters.filter(function (n) { return n.typeId === 'CHEONGUNG2'; });
assert(msam.every(function (n) { return !!n.mfrSensorId; }), '천궁-II 포대는 전속 MFR 보유');

// ── 4. 두 충실도 실행 + 물리 계층 실제 사용 ──
console.log('# 충실도별 실행');
var compat = run('HANBANDO_LEGACY_NORMAL', 'asis', 'compat');
var physics = run('HANBANDO_LEGACY_NORMAL', 'asis', 'iads-c2');
assert(compat.config.compatibilityMode === 'native-iads-c2-engagement-v1',
  'compat도 native 교전 파이프라인을 사용(고해상도 배치)');
assert(!compat.global.sensorPhysics, 'compat은 센서 물리 계층을 쓰지 않음');
assert(physics.global.sensorPhysics && physics.global.sensorPhysics.scans > 0,
  'iads-c2는 SNR/RCS 센서 스캔을 실제로 수행 — legacy 배치에서 물리 충실도 동작');
assert(physics.global.sensorPhysics.gated > 0,
  '거리·고도·수평선·섹터 게이팅이 실제로 발화');
assert(physics.global.trackQuality && physics.global.c2Orders,
  'iads-c2는 상관·식별과 명령 수명주기를 계정');
assert(physics.eventCount > compat.eventCount,
  '물리 계층이 이벤트 수를 늘림(compat ' + compat.eventCount + ' → iads-c2 ' + physics.eventCount + ')');
assert(physics.global.killed > 0 && compat.global.killed > 0,
  '두 충실도 모두 실제 격추가 발생(전 위협 미탐지로 끝나지 않음)');

// ── 5. 노드 파괴 시 책임 C2 대체 ──
console.log('# 노드 파괴 변형');
var normal = run('HANBANDO_LEGACY_NORMAL', 'asis', 'iads-c2').global.commanderAssignments;
var mcrcDown = run('HANBANDO_LEGACY_MCRC_DOWN', 'asis', 'iads-c2').global.commanderAssignments;
var kamdocDown = run('HANBANDO_LEGACY_KAMDOC_DOWN', 'asis', 'iads-c2').global.commanderAssignments;
assert(normal.MCRC > 0 && normal.KAMD_OPS > 0, 'NORMAL: MCRC·KAMDOC 둘 다 책임 C2로 동작');
assert(!mcrcDown.MCRC && mcrcDown.ICC > 0, 'MCRC_DOWN: ABT 책임이 권역 ICC로 전환');
assert(!kamdocDown.KAMD_OPS && kamdocDown.ICC > 0, 'KAMDOC_DOWN: 탄도 책임이 권역 ICC로 전환');
assert(normal.ARMY_LOCAL_AD > 0, '국지방공(군단·수방사 AOC) 축이 실제로 교전 지휘');

// ── 6. To-Be 융합 허브 ──
var tobe = run('HANBANDO_LEGACY_NORMAL', 'tobe', 'iads-c2');
assert(tobe.global.commanderAssignments.IAOC > 0,
  'To-Be 한국군 책임 C2가 IAOC(융합 허브)로 통합');
assert(tobe.global.leaked / tobe.global.spawned < compat.global.leaked / compat.global.spawned,
  'To-Be 누출률이 As-Is compat보다 낮음(방향성 face validity)');

// ── 7. 기존 경로 불변 ──
console.log('# 기존 경로 영향 없음');
var legacyCompat = KJ.runDES({
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1, seed: 12345, endTimeSec: 1800
});
assert(!legacyCompat.config.deploymentId && !legacyCompat.config.compatibilityMode,
  'legacy(compat) 실행은 고해상도 카탈로그를 타지 않음');
assert(legacyCompat.nodes.every(function (n) {
  return !n.rhoByKind || Object.keys(n.rhoByKind).join(',') === 'track,approval,engage';
}), 'legacy 결과의 kind 키가 종전 3종 그대로');
var mini = catalogOf('HANBANDO_MINI_NORMAL');
assert(mini.nativeCounts.batteries === 8, 'MINI 배치 구성 불변(포대 8)');

console.log(fail === 0 ? '\nOK — LEGACY_HIRES 배치 전체 통과' : '\n실패 ' + fail + '건');
process.exit(fail ? 1 : 0);
