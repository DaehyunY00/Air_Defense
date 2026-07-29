/**
 * ADR-059 — native WTA 모드 차등 + 비용 인식(nativeWtaMode) 회귀.
 *
 * 문제: native 사수 선정 점수식에 this.mode가 없어 As-Is/To-Be 무기 배정이 동일했다.
 * ON: As-Is = 관측 가능한 부하·탄약만(COP 부재 이론) / To-Be = 현행 물리 점수식 ×
 * 비용 인식((1−W)+W·costFit, 탄도 한정). wtaSuit는 이식하지 않음(pk·PIP와 이중 계상).
 * nativeWtaCostAsis = 반증 전용(As-Is에도 비용항).
 *
 * 검증 관점:
 *  1) OFF bit-exact은 engagement-state-unification의 SHA 4케이스가 잠근다(여기서는 노출만 확인)
 *  2) ON에서 As-Is 사수 선정이 실제로 달라진다(OFF 대비 결과 변화)
 *  3) ON에서 고가유도탄 보존율이 As-Is ≠ To-Be
 *  4) [정직 관측] LEGACY_HIRES To-Be의 비용항은 불개입 — 탄도 후보가 단일이라 argmax 불변
 *  5) 반증(FULL): As-Is+비용항이 As-Is 단독과 다르다(비용항이 실제로 무는 배치 존재)
 *  6) 결정론·보존법칙
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

function run(dep, sc, mode, dur, features, intensity) {
  return KJ.runDES({
    scenario: KJ.scenarioById(sc), mode: mode, intensity: intensity || 1.5, seed: 12345, endTimeSec: dur,
    deploymentId: dep, modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, features || {})
  });
}
function stripEcho(r) {
  var c = JSON.parse(JSON.stringify(r));
  delete c.global.features;
  if (c.global.coordination) delete c.global.coordination.copDeconflicted;
  return JSON.stringify(c);
}

console.log('# 1 — As-Is 사수 선정 차등 (LEGACY_HIRES · SC3 · 900초)');
var aOff = run('HANBANDO_LEGACY_NORMAL', 'sc3', 'asis', 900, null);
var aOn = run('HANBANDO_LEGACY_NORMAL', 'sc3', 'asis', 900, { nativeWtaMode: true });
assert(stripEcho(aOff) !== stripEcho(aOn), 'ON에서 As-Is 결과가 OFF와 달라짐 (사수 선정 변화)');
assert(aOn.global.features.nativeWtaMode === true, 'ON 플래그 노출');
assert(aOn.global.spawned === aOn.global.killed + aOn.global.leaked + aOn.global.censoredRaw, 'ON 보존법칙');
var det = run('HANBANDO_LEGACY_NORMAL', 'sc3', 'asis', 900, { nativeWtaMode: true });
assert(JSON.stringify(det) === JSON.stringify(aOn), 'ON 결정론');

console.log('# 2 — 고가유도탄 보존율 모드 차등');
var tOn = run('HANBANDO_LEGACY_NORMAL', 'sc3', 'tobe', 900, { nativeWtaMode: true });
assert(Math.abs(aOn.global.highValuePreservation - tOn.global.highValuePreservation) > 0.01,
  'As-Is(' + aOn.global.highValuePreservation.toFixed(3) + ') ≠ To-Be(' + tOn.global.highValuePreservation.toFixed(3) + ')');

console.log('# 3 — [정직 관측] LEGACY_HIRES To-Be 비용항 불개입');
var tOff = run('HANBANDO_LEGACY_NORMAL', 'sc3', 'tobe', 900, null);
assert(stripEcho(tOn) === stripEcho(tOff),
  'To-Be ON==OFF — 탄도 후보가 단일이라 비용항이 argmax를 바꾸지 못함(ADR-059 §한계에 기록)');

// ADR-065 관측 변경: 기본값 3종(승인 계선·표적 산포·남부 축선)을 켠 뒤 비용항이 무는 셀이
// 더 줄었다 — 6셀 실측 중 2셀에서만 발화(구 기본값에서는 이 셀 300초에서도 발화했다:
// 보존율 0.686→0.678·격추율 0.583→0.500. 신 기본값 같은 셀은 완전 무효과).
// 어서션을 **신 기본값에서 실제로 발화하는 셀**로 옮긴다. 임계를 낮춘 것이 아니라
// 현상이 일어나는 조건으로 관측 지점을 옮긴 것이며, 빈도 감소는 ADR-059의 원 결론
// ("비용항은 거의 물지 않는다")을 오히려 강화한다.
console.log('# 4 — 반증 (FULL · ×1.5 · 600초): 비용항이 실제로 무는 셀');
// ADR-066 갱신: 무는 셀이 **또 이동했다**. ADR-065 판에서는 FULL·×3에서 물고 ×1.5에서 무효과였는데,
// 링크 의미론 정합 후에는 정반대다(8셀 격자 실측: FULL ×1.5 600s·900s만 물고 ×3·LEGACY 전 셀 무효과
// — 개입 2/8셀). **빈도(약 1/4)는 유지되고 위치만 바뀐다.**
// 이 불안정성 자체가 ADR-059의 원 결론("비용항은 거의 물지 않는다 — 절약은 교전량·기하에서
// 나온다")을 강화한다. 무는 셀과 무는 셀이 아닌 셀을 **함께** 고정해 빈도를 증거로 남긴다.
var fOn = run('HANBANDO_FULL_NORMAL', 'sc3', 'asis', 600, { nativeWtaMode: true });
var fCf = run('HANBANDO_FULL_NORMAL', 'sc3', 'asis', 600, { nativeWtaMode: true, nativeWtaCostAsis: true });
assert(stripEcho(fOn) !== stripEcho(fCf), 'FULL As-Is(×1.5): 반증 플래그(비용항)가 결과를 바꿈');
var lOn = run('HANBANDO_FULL_NORMAL', 'sc3', 'asis', 600, { nativeWtaMode: true }, 3);
var lCf = run('HANBANDO_FULL_NORMAL', 'sc3', 'asis', 600, { nativeWtaMode: true, nativeWtaCostAsis: true }, 3);
assert(stripEcho(lOn) === stripEcho(lCf),
  '[정직 관측] 같은 배치 ×3 셀에서는 비용항 무효과 — 무는 셀은 판마다 이동하고 빈도는 2/8셀에 머문다');
assert(fCf.global.features.nativeWtaCostAsis === true, '반증 플래그 노출');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
