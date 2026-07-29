/**
 * ADR-056 — To-Be 교전상태 통합(unifiedEngagementState) 회귀.
 *
 * 배경(확정된 결함): To-Be의 상급 C2는 axis='KILL_WEB'(IAOC)인데, 군단 AOC 교전현황의
 * 유일한 소비처 `_iadsSharedLocalEngagement`는 axis==='MCRC'만 소비했다. 그래서 To-Be는
 * 교전현황을 2초/무손실로 전달받고도 한 번도 소비하지 않았고(statusSharing.deconflicted=0),
 * 중복교전이 As-Is보다 많았다(paired MC 30 seed: SC1 Δ +8.53 [7.22, 9.85]).
 *
 * 검증 관점:
 *  1) 플래그 OFF = Phase 0 종료 시점(ADR-055 직후)과 bit-exact — SHA-256 4케이스
 *  2) 플래그 ON에서 To-Be가 교전현황을 실제로 소비한다(deconflicted>0, 중복 감소)
 *  3) 플래그 ON이어도 As-Is 거동은 불변(KILL_WEB 축은 To-Be 전용) — features 에코 제외 bit-exact
 *  4) 보존법칙 유지
 */
import path from 'node:path';
import crypto from 'node:crypto';
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

// Phase 0 종료 시점(ADR-055, MINI 폐기 직후) 지문 — LEGACY_HIRES × iads-c2 × ×1.5 × seed 12345 × 900초.
// 갱신 규칙: 의도된 거동 변경으로 재기준선이 필요하면 ADR에 사유를 남기고 아래 값을 교체한다.
// ADR-065 재기준화: 기본값 3종(승인 계선·표적 산포·남부 축선)을 ON으로 전환하면서 배경이
// 바뀌어 구 지문(전 OFF 기본값 기준)은 재현 불가가 되었다. 지문을 신 기본값으로 다시 잡는다.
// ⚠️ 이 어서션의 의미도 함께 약해진다: "unifiedEngagementState OFF == ADR-056 도입 전"이
// 아니라 **"OFF == 현행 기본 기준선"**(이후 회귀 방지선)이다. 구 지문은 git 이력에 있다.
var PHASE0_SHA = {
  'sc1|asis': '6f1339c2a1eebeabe5bae7fa2255986fea2919f19f12c4fe6e97b462e6605ddc',
  'sc1|tobe': 'd4a39bdd3e94936594b6febfde8e879830c2aea207d7e1d681183130873ca5bc',
  'sc3|asis': '612c8fa107ecd7306f1feeb0c6e40140b45a67b8f6d9b1ce5fde4128b1c8f0c4',
  'sc3|tobe': 'ea592d1ff827b3a9659436adaca616dd3c5fe5abe869385ae846b8a214598517'
};
var OFF_TOBE_DUP = { sc1: 12, sc3: 13 }; // OFF To-Be 중복교전(신 기본값 실측) — ON에서 이보다 작아야 함

function run(sc, mode, flags) {
  return KJ.runDES({
    scenario: KJ.scenarioById(sc), mode: mode, intensity: 1.5, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, flags || {})
  });
}
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
function shaNoFeatures(r) {
  // ON일 때만 노출되는 키(features 에코·copDeconflicted 카운터)를 제외한 거동 비교.
  var clone = JSON.parse(JSON.stringify(r));
  delete clone.global.features;
  if (clone.global.coordination) delete clone.global.coordination.copDeconflicted;
  return crypto.createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

console.log('# 1 — OFF bit-exact (Phase 0 종료 시점 SHA-256)');
var offRuns = {};
['sc1', 'sc3'].forEach(function (sc) {
  ['asis', 'tobe'].forEach(function (mode) {
    var r = run(sc, mode, null);
    offRuns[sc + '|' + mode] = r;
    assert(sha(r) === PHASE0_SHA[sc + '|' + mode], sc + ' ' + mode + ' OFF SHA-256 불변');
  });
});
['sc1', 'sc3'].forEach(function (sc) {
  var c = offRuns[sc + '|tobe'].global.coordination;
  assert(c.statusSharing.deconflicted === 0 && c.duplicates === OFF_TOBE_DUP[sc],
    sc + ' OFF To-Be: 결함 상태 보존(deconflicted=0, 중복=' + OFF_TOBE_DUP[sc] + ')');
});

console.log('# 2 — ON: To-Be가 교전현황을 소비');
['sc1', 'sc3'].forEach(function (sc) {
  var r = run(sc, 'tobe', { unifiedEngagementState: true });
  var c = r.global.coordination, g = r.global;
  assert(c.statusSharing.deconflicted > 0, sc + ' ON To-Be: statusSharing.deconflicted > 0 (순방향: KILL_WEB이 군단 AOC 현황 소비)');
  assert(c.copDeconflicted > 0,
    sc + ' ON To-Be: 역방향 COP 해소 발생(copDeconflicted=' + c.copDeconflicted + ')');
  assert(c.duplicates < OFF_TOBE_DUP[sc], sc + ' ON To-Be: 중복교전 감소(' + c.duplicates + ' < ' + OFF_TOBE_DUP[sc] + ')');
  assert(g.spawned === g.killed + g.leaked + g.censoredRaw, sc + ' ON To-Be: 보존법칙');
  assert(r.global.features.unifiedEngagementState === true, sc + ' ON To-Be: 플래그가 결과에 노출');
});

console.log('# 3 — ON: As-Is 거동 불변(features 에코 제외 bit-exact)');
['sc1', 'sc3'].forEach(function (sc) {
  var on = run(sc, 'asis', { unifiedEngagementState: true });
  assert(shaNoFeatures(on) === shaNoFeatures(offRuns[sc + '|asis']),
    sc + ' ON As-Is == OFF As-Is (KILL_WEB 축 부재 → 거동 무변화)');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
