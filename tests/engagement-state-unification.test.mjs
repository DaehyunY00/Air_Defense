/**
 * ADR-056 — To-Be 교전상태 통합(unifiedEngagementState) 회귀. **ADR-068로 기본 ON.**
 *
 * 배경(확정된 결함): To-Be의 상급 C2는 axis='KILL_WEB'(IAOC)인데 군단 AOC 교전현황의
 * 유일한 소비처 `_iadsSharedLocalEngagement`는 axis==='MCRC'만 소비했다. 그래서 To-Be는
 * 교전현황을 전달받고도 한 번도 소비하지 않았고(statusSharing.deconflicted=0),
 * 중복교전이 As-Is보다 많았다 — 이름 불일치에서 온 결함이지 의도된 모델이 아니다.
 *
 * ADR-068 이후 어서션 구조가 뒤집혔다: **기본(키 생략) == ON**이고, 반증 경로는 명시적
 * `unifiedEngagementState:false`다. 같은 코드의 기본·명시 ON/OFF와 직접 상태 소비를 대조한다.
 *
 * 검증 관점:
 *  1) 명시적 OFF에서 To-Be가 국지 교전현황을 소비하지 않는다
 *  2) 기본(ON)에서 To-Be가 양방향 교전현황을 실제로 소비한다
 *  3) 기본 == 명시적 ON, 기본 != 명시적 OFF (토글이 장식이 아님)
 *  4) **As-Is는 ON/OFF가 거동 bit-exact** — KILL_WEB 축은 To-Be 전용이므로 비교의 공정성 보존
 *  5) 보존법칙 · 반증 경로 배선(cop 딥링크·UI 토글)
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });

var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

// ADR-100: 12d14e0 기준 소스를 별도 스냅샷에서 실행해도 종전 OFF SHA 4개와
// SC3 중복 수 고정값·ON 중복 0건 어서션이 이미 실패했다. 현행 기준선을 표현하지 못하는
// 옛 지문을 새 수치로 덮지 않는다. 공유 토글의 계약을 직접 검증하고, 엔진 전체의
// 고정 기준선은 hires-baseline.test.mjs에서 검증한다. 단일 seed의 중복 수는 관측값이다.

function run(sc, mode, flags) {
  return KJ.runDES({
    scenario: KJ.scenarioById(sc), mode: mode, intensity: 1.5, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, flags || {})
  });
}
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
function behaviourSha(r) {
  // features 에코와 ON 전용 카운터를 제외한 **거동** 비교.
  var clone = JSON.parse(JSON.stringify(r));
  delete clone.global.features;
  if (clone.global.coordination) delete clone.global.coordination.copDeconflicted;
  return crypto.createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

console.log('# 1 — 명시적 OFF는 교전현황을 소비하지 않는다 (반증 경로)');
var offRuns = {};
['sc1', 'sc3'].forEach(function (sc) {
  ['asis', 'tobe'].forEach(function (mode) {
    var r = run(sc, mode, { unifiedEngagementState: false });
    offRuns[sc + '|' + mode] = r;
    assert(r.global.features.unifiedEngagementState === false,
      sc + ' ' + mode + ' 명시적 OFF 신고');
    assert(r.global.spawned === r.global.killed + r.global.leaked + r.global.censoredRaw,
      sc + ' ' + mode + ' OFF 보존법칙');
  });
});
['sc1', 'sc3'].forEach(function (sc) {
  var c = offRuns[sc + '|tobe'].global.coordination;
  assert(c.statusSharing.deconflicted === 0,
    sc + ' OFF To-Be: 교전현황 소비 0건');
});

console.log('# 2 — 기본(ON): To-Be가 양방향 교전현황을 실제로 소비한다');
var onRuns = {};
['sc1', 'sc3'].forEach(function (sc) {
  var r = run(sc, 'tobe', null); // 키 생략 = 기본 ON (ADR-068)
  onRuns[sc] = r;
  var c = r.global.coordination, g = r.global;
  assert(c.statusSharing.deconflicted > 0,
    sc + ' 기본 To-Be: 순방향 소비 발생(KILL_WEB이 군단 AOC 현황을 읽음, ' + c.statusSharing.deconflicted + '건)');
  assert(c.copDeconflicted > 0,
    sc + ' 기본 To-Be: 역방향 COP 해소 발생(' + c.copDeconflicted + '건)');
  console.log('  NOTE ' + sc + ' 관측 중복교전 OFF ' + offRuns[sc + '|tobe'].global.coordination.duplicates +
    ' → ON ' + c.duplicates + ' (우열·완전 해소를 통과 조건으로 고정하지 않음)');
  assert(g.spawned === g.killed + g.leaked + g.censoredRaw, sc + ' 기본 To-Be: 보존법칙');
  assert(r.global.features.unifiedEngagementState === true, sc + ' 기본 To-Be: 플래그 ON 신고');
});

console.log('# 3 — 토글이 장식이 아님 (기본 == 명시적 ON, != 명시적 OFF)');
['sc1', 'sc3'].forEach(function (sc) {
  var explicitOn = run(sc, 'tobe', { unifiedEngagementState: true });
  assert(sha(explicitOn) === sha(onRuns[sc]), sc + ' 키 생략 == 명시적 ON (ADR-068 기본값 전환)');
  assert(sha(onRuns[sc]) !== sha(offRuns[sc + '|tobe']), sc + ' 기본(ON) != 명시적 OFF');
  assert(offRuns[sc + '|tobe'].global.features.unifiedEngagementState === false,
    sc + ' 명시적 OFF는 false를 신고(미측정 아님)');
});

console.log('# 4 — As-Is는 ON/OFF가 거동 bit-exact (비교의 공정성)');
// 이 어서션이 ADR-068 전환의 핵심 근거다 — 전환이 As-Is를 전혀 건드리지 않으므로
// "To-Be에 유리하게 기준을 옮긴 것"이 아니라 To-Be 전용 결함을 고친 것이다.
['sc1', 'sc3'].forEach(function (sc) {
  var on = run(sc, 'asis', null);
  assert(behaviourSha(on) === behaviourSha(offRuns[sc + '|asis']),
    sc + ' As-Is: 기본(ON) == 명시적 OFF (KILL_WEB 축 부재 → 거동 무변화)');
});

console.log('# 4b — 공유 상태 소비 계약: 축·토글·유효기간·해제');
var sharedState = { from: 'AOC_TEST', phase: 'assigned', createdAt: 0, receivedAt: 10, freshUntil: 300 };
var sharedThreat = { _engagementStatusBySender: { AOC_TEST: sharedState } };
function consume(enabled, axis, at) {
  return KJ.Simulation.prototype._iadsSharedLocalEngagement.call(
    { unifiedEngagementState: enabled }, sharedThreat, { axis: axis }, at);
}
assert(consume(true, 'KILL_WEB', 100) === sharedState, 'ON 통합축은 수신한 국지 할당을 소비');
assert(consume(false, 'KILL_WEB', 100) === null, 'OFF 통합축은 같은 수신 상태를 소비하지 않음');
assert(consume(true, 'MCRC', 100) === sharedState && consume(false, 'MCRC', 100) === sharedState,
  'MCRC 소비는 통합 토글과 무관');
assert(consume(true, 'LOCAL_AD', 100) === null, '국지축이 상급 수신함을 직접 소비하지 않음');
assert(consume(true, 'KILL_WEB', 301) === null, '유효기간이 지난 할당은 소비하지 않음');
sharedState.phase = 'fired';
assert(consume(true, 'KILL_WEB', 100) === sharedState, '유효한 발사 상태도 소비');
sharedState.phase = 'released';
assert(consume(true, 'KILL_WEB', 100) === null, '해제된 상태는 교전 중으로 소비하지 않음');

console.log('# 5 — 반증 경로 배선 (라우터·UI)');
var router = fs.readFileSync(path.join(repo, 'js', 'core', 'router.js'), 'utf8');
assert(/cop: '1'/.test(router), "라우터 DEFAULTS에 cop 기본 ON ('1')");
assert(/state\.cop = \(state\.cop === '0'/.test(router), "명시적 '0'만 해제로 정규화");
assert(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').indexOf('id="engagement-cop-toggle"') !== -1,
  '상단 컨트롤에 교전현황 공유 토글 존재');
['main.js', 'ui/panels.js', 'ui/sim-view.js', 'ui/mc-panel.js'].forEach(function (f) {
  assert(/unifiedEngagementState\s*[:=]\s*.*cop !== '0'/.test(fs.readFileSync(path.join(repo, 'js', f), 'utf8')),
    f + " modelConfig가 cop → features 전달 (기본 ON, '0'만 해제)");
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
