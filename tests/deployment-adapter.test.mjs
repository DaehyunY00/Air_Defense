/** Phase 1 배치 어댑터 통합·결정론 실행 — ADR-061: 고해상도 카탈로그 단일화 후. */
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
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'engine/sim-engine.js', 'analysis/bottleneck.js', 'analysis/overlap-heatmap.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = globalThis.KJ;
installIadsKernel(KJ);
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function stable(r) { return JSON.stringify({ global: r.global, flow: r.flow, nodes: r.nodes, links: r.links, eventCount: r.eventCount }); }

// ADR-061: legacy 카탈로그 폐기 — 플래그 생략도 고해상도 기본 배치를 받는다.
assert(KJ.resolveModelCatalog({}).id === 'HANBANDO_LEGACY_NORMAL',
  '플래그 생략도 고해상도 기본 배치(ADR-061: legacy 카탈로그 폐기)');
assert(KJ.LEGACY_CATALOG === undefined, 'KJ.LEGACY_CATALOG는 더 이상 존재하지 않음(ADR-061)');
var offRejected = false;
try {
  KJ.runDES({ scenario: KJ.scenarioById('sc1'), mode: 'asis', intensity: 0.5, seed: 42,
    endTimeSec: 60, features: { highResolutionDeployment: false } });
} catch (e) { offRejected = /ADR-061/.test(e.message); }
assert(offRejected, 'highResolutionDeployment:false는 명시적 오류(ADR-061: legacy 배치 폐기)');
assert(KJ.resolveModelCatalog({ features: { highResolutionDeployment: true } }).id === 'HANBANDO_LEGACY_NORMAL', 'ON+ID 생략은 LEGACY_NORMAL (ADR-055: MINI 폐기 후 기본 배치)');
var bad = false;
try { KJ.resolveModelCatalog({ deploymentId: 'NO_SUCH_DEPLOYMENT', features: { highResolutionDeployment: true } }); } catch (e) { bad = /Unknown high-resolution deployment/.test(e.message); }
assert(bad, '잘못된 배치 ID는 명시적 오류');

KJ.DEPLOYMENT_IDS.forEach(function (id) {
  var c = KJ.buildDeploymentCatalog(id);
  assert(c.links.every(function (l) { return !!c.nodeMap[l.from] && !!c.nodeMap[l.to]; }), id + ' 모든 링크 종점 존재');
  assert(new Set(c.nodes.map(function (n) { return n.id; })).size === c.nodes.length, id + ' catalog 노드 ID 유일');
  var crossing = c.links.filter(function (l) {
    return (c.nodeMap[l.from].forceOwner === 'USFK') !== (c.nodeMap[l.to].forceOwner === 'USFK');
  });
  assert(crossing.length === 0, id + ' USFK↔한국군 C2 교차 링크 부재');
  assert(c.nodes.filter(function (n) { return n.category === 'shooter' && n.forceOwner === 'USFK'; }).every(function (n) {
    return Object.keys(n.canEngage).some(function (k) { return n.canEngage[k] === true; }) &&
      n.c2Axis.indexOf('USFK_') === 0;
  }), id + ' USFK 사수는 독립 C2 축에서만 실제 교전 가능');
});

['FULL', 'LEGACY'].forEach(function (size) {
  ['MCRC', 'KAMDOC'].forEach(function (rootName) {
    var id = 'HANBANDO_' + size + '_' + rootName + '_DOWN';
    var c = KJ.buildDeploymentCatalog(id);
    assert(!c.nodes.some(function (n) { return n.typeId === (rootName === 'MCRC' ? 'MCRC' : 'KAMD_OPS'); }) &&
      !c.links.some(function (l) { return !c.nodeMap[l.from] || !c.nodeMap[l.to]; }), id + ' 제거 C2·잔존 링크 정합');
  });
});

var scenario = KJ.scenarioById('sc1');
KJ.DEPLOYMENT_IDS.forEach(function (id) {
  ['asis', 'tobe'].forEach(function (mode) {
    var cfg = { scenario: scenario, mode: mode, intensity: 0.5, seed: 42, endTimeSec: 900,
      deploymentId: id, features: { highResolutionDeployment: true } };
    var a = KJ.runDES(cfg), b = KJ.runDES(cfg), g = a.global;
    assert(stable(a) === stable(b), id + ' ' + mode + ' 결정론적 재현');
    assert(g.spawned === g.killed + g.leaked + g.censoredRaw && a.flow.spawned >= a.flow.detected && a.flow.detected >= a.flow.reachedC2 &&
      [g.killRate, g.leakRate, g.meanDecisionDelaySec, g.meanTimeToEngageSec, g.meanTimeToKillSec].every(Number.isFinite),
      id + ' ' + mode + ' 보존법칙·유한 지표');
  });
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
