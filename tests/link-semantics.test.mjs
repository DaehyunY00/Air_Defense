/**
 * ADR-057 — 링크 의미론 IADS_codex 정합(linkSemanticsV2) 회귀.
 *
 * codex ADR-014: "탐지자산→상위 C2 정보 전달은 일률 지연이 아니라 보고 주기" —
 * As-Is는 센서별 reportingPeriod(그린파인 16 / FPS-117 8 / TPS-880K 4 / MFR 1)가 단일 출처.
 * To-Be(킬웹)는 codex 판정 "킬웹 보고주기 전부 1s" — IFCN 1초가 전 링크를 지배.
 * C2↔C2 As-Is는 전송 지연(codex shortRange 1초)으로 재해석한다.
 *
 * 검증 관점:
 *  1) OFF 카탈로그는 종전 상수(LONG 16 등)를 그대로 쓴다(변형 캐시 분리)
 *  2) ON에서 As-Is 센서→C2 지연 = 그 센서의 reportingPeriod (TPS-880K 4 ≠ 그린파인 16 — 수용 기준)
 *  3) ON에서 To-Be 전 링크 = IFCN 1초 (codex "킬웹 보고주기 전부 1s")
 *  4) ON에서 C2↔C2 As-Is = 1초(codex shortRange)
 *  5) 하향 명령(ECS→발사대)은 양 상태 모두 1초로 불변(codex shortRange와 이미 일치)
 *  6) ON 실행: 결정론·보존법칙·플래그 노출
 *  (OFF 실행의 bit-exact은 engagement-state-unification 스위트의 SHA-256 4케이스가 잠근다)
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

var off = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL');
var on = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', { linkSemanticsV2: true });
function link(cat, from, to) {
  return cat.links.find(function (l) { return l.from.indexOf(from) !== -1 && l.to.indexOf(to) !== -1; });
}
function delays(cat, from, to) {
  var l = link(cat, from, to);
  return l ? [l.comm.asis && l.comm.asis.delaySec, l.comm.tobe && l.comm.tobe.delaySec] : null;
}

console.log('# 1 — OFF 카탈로그 불변');
assert(off !== on, 'OFF/ON 변형 카탈로그가 캐시에서 분리됨');
assert(String(delays(off, 'SENSOR_GPR', 'KAMD')) === '16,2' &&
  String(delays(off, 'SENSOR_LLR_1C', 'MCRC')) === '16,2' &&
  String(delays(off, 'C2_MCRC', 'ICC_W1')) === '16,2', 'OFF: 종전 LONG 16/DL 2 유지');

console.log('# 2 — ON 센서별 보고 주기 (codex ADR-014)');
assert(String(delays(on, 'SENSOR_GPR', 'KAMD')) === '16,1', 'ON: 그린파인 As-Is 16초(reportingPeriod) · To-Be 1초(IFCN)');
assert(String(delays(on, 'SENSOR_ACR_E', 'MCRC')) === '8,1', 'ON: FPS-117 As-Is 8초 · To-Be IFCN 1초');
assert(String(delays(on, 'SENSOR_LLR_1C', 'MCRC')) === '4,1', 'ON: TPS-880K As-Is 4초 · To-Be IFCN 1초');
var gp = delays(on, 'SENSOR_GPR', 'KAMD'), llr = delays(on, 'SENSOR_LLR_1C', 'MCRC');
assert(gp[0] !== llr[0], '수용 기준: TPS-880K 4초 ≠ 그린파인 16초 (일률 지연 폐기)');
var mfr = on.links.find(function (l) { return l.axis === 'battery_mfr'; });
assert(mfr.comm.asis.delaySec === 1 && mfr.comm.tobe.delaySec === 1, 'ON: 포대 MFR As-Is 1초(reportingPeriod) · To-Be 1초(IFCN)');
var iaocLink = on.links.find(function (l) { return l.axis === 'killweb' && l.kind === 'report'; });
assert(iaocLink.comm.tobe.delaySec === 1 && iaocLink.comm.tobe.type === 'ifcn',
  'ON: 킬웹(IAOC) 전 링크 IFCN 1초 — codex "킬웹 보고주기 전부 1s"');

console.log('# 3 — ON C2↔C2 전송 지연');
assert(String(delays(on, 'C2_MCRC', 'ICC_W1')) === '1,1', 'ON: C2↔C2 As-Is 1초(codex shortRange) · To-Be 1초(IFCN)');
var cmd = on.links.find(function (l) { return l.kind === 'command'; });
var cmdOff = off.links.find(function (l) { return l.kind === 'command'; });
assert(cmd.comm.asis.delaySec === 1 && cmd.comm.tobe.delaySec === 1 &&
  cmdOff.comm.asis.delaySec === 1, '하향 명령(ECS→발사대) 1초 불변 — codex shortRange와 기존 일치');

console.log('# 4 — ON 실행 (결정론·보존·노출)');
['asis', 'tobe'].forEach(function (mode) {
  var cfg = {
    scenario: KJ.scenarioById('sc1'), mode: mode, intensity: 1.5, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: { highResolutionDeployment: true, linkSemanticsV2: true }
  };
  var a = KJ.runDES(cfg), b = KJ.runDES(cfg), g = a.global;
  assert(JSON.stringify(a) === JSON.stringify(b), 'sc1 ' + mode + ' ON 결정론');
  assert(g.spawned === g.killed + g.leaked + g.censoredRaw, 'sc1 ' + mode + ' ON 보존법칙');
  assert(g.features.linkSemanticsV2 === true, 'sc1 ' + mode + ' ON 플래그 노출');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
