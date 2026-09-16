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
 *  6) 고정 후보로 비용항의 모드·탄도 적용범위와 가중치 0 계약 검증
 *  7) 결정론·보존법칙
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

function run(dep, sc, mode, dur, features, intensity, seed) {
  return KJ.runDES({
    scenario: KJ.scenarioById(sc), mode: mode, intensity: intensity || 1.5,
    seed: seed || 12345, endTimeSec: dur,
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

// 이 셀은 전체 실행에서 비용항 개입을 확인하는 대조군이다. 특정 seed의 무효과나
// 비용항 개입 빈도는 모델 계약이 아니다. 기능의 적용 범위는 아래 고정 후보로 검증한다.
console.log('# 4 — FULL 실행에서 비용항 개입 (×1.0 · 600초 · seed 4242)');
var fOn = run('HANBANDO_FULL_NORMAL', 'sc3', 'asis', 600, { nativeWtaMode: true }, 1, 4242);
var fCf = run('HANBANDO_FULL_NORMAL', 'sc3', 'asis', 600,
  { nativeWtaMode: true, nativeWtaCostAsis: true }, 1, 4242);
assert(stripEcho(fOn) !== stripEcho(fCf),
  'FULL As-Is(×1.0 · seed 4242): 반증 플래그(비용항)가 결과를 바꿈 (보존율 ' +
  fOn.global.highValuePreservation.toFixed(3) + '→' + fCf.global.highValuePreservation.toFixed(3) + ')');
assert(fCf.global.features.nativeWtaCostAsis === true, '반증 플래그 노출');

console.log('# 5 — 비용항의 모드·위협·가중치 계약 (고정 후보)');
// 특정 seed에서 "비용항 효과 0"을 강제하면 다른 절차를 고친 뒤 정상적인 결과 변화도
// 실패가 된다. 실제 점수 함수에 같은 두 후보를 넣어 플래그와 순위 변화의 계약을 분리한다.
function scoreSimulation(mode, features) {
  return new KJ.Simulation({ scenario: KJ.scenarioById('sc3'), mode: mode,
    intensity: 0, seed: 29, endTimeSec: 60, deploymentId: 'HANBANDO_FULL_NORMAL',
    modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true, costWtaWeight: 1 }, features)
  });
}
var candidates = {
  cheap: { ammo: 0.9, ev: { pk: 0.8, pip: { rangeKm: 10 }, missile: { costPerShot: 3 } } },
  expensive: { ammo: 1, ev: { pk: 0.8, pip: { rangeKm: 10 }, missile: { costPerShot: 30 } } }
};
var shooter = { shooterPriority: 1 };
function score(sim, candidate, type) {
  var item = candidates[candidate];
  return sim._iadsWtaScore(item.ev, shooter, item.ammo, 0, { type: type || 'srbm' });
}
var asisBase = scoreSimulation('asis', { nativeWtaMode: true });
var asisCost = scoreSimulation('asis', { nativeWtaMode: true, nativeWtaCostAsis: true });
var tobeCost = scoreSimulation('tobe', { nativeWtaMode: true });
assert(score(asisBase, 'expensive') > score(asisBase, 'cheap'),
  'As-Is 기본 선호: 같은 부하에서는 탄약 여유가 큰 후보가 우선 (비용항 없음)');
assert(score(asisCost, 'cheap') > score(asisCost, 'expensive'),
  'As-Is 반증 플래그: 탄도 표적에 비용항을 적용해 고정 후보의 순위가 바뀐다');
assert(score(tobeCost, 'cheap') > score(tobeCost, 'expensive'),
  'To-Be native WTA: 별도 As-Is 반증 플래그 없이 탄도 비용항이 적용된다');
assert(score(asisCost, 'expensive', 'fighter') === score(asisBase, 'expensive', 'fighter'),
  '비탄도 표적에는 As-Is 반증 비용항을 적용하지 않는다');
var nativeOff = scoreSimulation('asis', { nativeWtaMode: false });
var nativeOffCf = scoreSimulation('asis', { nativeWtaMode: false, nativeWtaCostAsis: true });
assert(score(nativeOff, 'expensive') === score(nativeOffCf, 'expensive'),
  'nativeWtaMode OFF면 반증 플래그만 켜도 비용항이 적용되지 않는다');
var asisZero = scoreSimulation('asis', { nativeWtaMode: true, nativeWtaCostAsis: true, costWtaWeight: 0 });
var tobeZero = scoreSimulation('tobe', { nativeWtaMode: true, costWtaWeight: 0 });
var tobeBase = scoreSimulation('tobe', { nativeWtaMode: false });
assert(score(asisZero, 'expensive') === score(asisBase, 'expensive') &&
  score(tobeZero, 'expensive') === score(tobeBase, 'expensive'),
  '가중치 0이면 양 모드에서 비용항이 제거된다');
assert(score(tobeCost, 'expensive', 'fighter') === score(tobeBase, 'expensive', 'fighter'),
  '비탄도 표적에는 To-Be 비용항도 적용하지 않는다');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
