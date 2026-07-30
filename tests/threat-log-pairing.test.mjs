/**
 * 분석 탭 위협 항적 병렬 로그 (As-Is ↔ To-Be) 회귀.
 *
 * 이 로그의 전제는 하나다: **동일 seed에서 두 모드의 위협 집단이 같다**(CRN — 공통난수).
 * 도착 스트림이 모드 의존 로직과 분리돼 있어야만 성립하며, 이것이 깨지면 좌·우를 나란히
 * 놓는 비교 자체가 무의미해진다(다른 위협을 비교하게 된다). 그래서 주석이 아니라
 * 실측으로 고정한다.
 *
 * 검증 관점:
 *  1) CRN 짝맞춤: 두 모드의 threatTraces가 ID·발생시각·축선·유형까지 동일 순서로 일치.
 *  2) 판정 분기 실재: 그럼에도 결과(outcome)가 갈리는 항적이 존재 — 없으면 이 화면은
 *     보여줄 것이 없다는 뜻이므로 유의미한 대조가 성립하는지 함께 고정한다.
 *  3) desPair 배선: tracePair 없이는 반대 모드 trace가 없고(기존 재생 경로 성능 보존),
 *     tracePair=true면 양쪽 다 생긴다.
 *  4) UI 배선: panels.js가 tracePair를 요청하고, 단일 실행(getLastRun)이 아니라
 *     desPair 결과를 쓰며, 두 렌더러가 공용 콜백으로 갱신된다.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/bottleneck.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

var FEATURES = {
  highResolutionDeployment: true, approvalChain: true, threatTargetDispersion: true,
  southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  unifiedEngagementState: true, sawtoothFreshness: true, selfDefenseFire: true
};
function run(mode, extra) {
  return KJ.runDES(Object.assign({
    scenario: KJ.scenarioById('sc3'), mode: mode, intensity: 1.5, seed: 12345,
    endTimeSec: 900, deploymentId: 'HANBANDO_LEGACY_NORMAL', features: FEATURES,
    trace: true, traceCap: 300
  }, extra || {}));
}

console.log('# ① CRN — 두 모드의 위협 집단 동일성 (병렬 대조의 전제)');
var a = run('asis'), b = run('tobe');
var ta = a.threatTraces || [], tb = b.threatTraces || [];
assert(ta.length > 0 && tb.length > 0, '양 모드 모두 항적 추적 생성 (asis ' + ta.length + ' · tobe ' + tb.length + ')');
assert(ta.length === tb.length, '추적 항적 수 동일 (' + ta.length + ' = ' + tb.length + ')');
assert(ta.map(function (t) { return t.id; }).join('|') === tb.map(function (t) { return t.id; }).join('|'),
  '위협 ID가 같은 순서로 완전 일치 — ID 기준 1:1 대응이 성립');
assert(ta.every(function (t, i) { return tb[i] && Math.abs(t.spawnT - tb[i].spawnT) < 1e-9; }),
  '발생시각(spawnT) 전건 일치 — 도착 스트림이 모드 불변');
assert(ta.every(function (t, i) { return tb[i] && t.axis === tb[i].axis && t.type === tb[i].type; }),
  '축선·위협유형 전건 일치');

console.log('# ② 판정 분기 — 대조가 실제로 보여줄 것이 있는가');
var diverged = ta.filter(function (t, i) { return tb[i] && t.outcome !== tb[i].outcome; });
assert(diverged.length > 0, '결과가 갈린 항적 존재 (' + diverged.length + '/' + ta.length + '건) — 구조 차이의 항적 단위 증거');
var gained = ta.filter(function (t, i) {
  return tb[i] && t.outcome !== 'killed' && tb[i].outcome === 'killed';
});
assert(gained.length > 0, 'As-Is 실패 → To-Be 격추로 뒤집힌 항적 존재 (' + gained.length + '건)');
assert(ta.some(function (t) { return typeof t.outcome === 'string' && t.outcome.indexOf('leaked:') === 0; }),
  "요격 실패 outcome이 'leaked:<코드>' 형식 — UI의 사유 라벨 파싱 전제");

console.log('# ③ desPair 배선 — tracePair 옵트인');
var runtime = fs.readFileSync(path.join(root, 'js/workers/sim-worker-runtime.js'), 'utf8');
var client = fs.readFileSync(path.join(root, 'js/core/sim-worker-client.js'), 'utf8');
assert(/tracePair\s*\?\s*cfg\.trace\s*:\s*false/.test(runtime),
  '워커 런타임: tracePair일 때만 반대 모드 trace (기본은 종전대로 off)');
assert(/tracePair\s*\?\s*cfg\.trace\s*:\s*false/.test(client),
  '메인스레드 폴백: 동일 규약 — 실행 경로에 따라 화면이 달라지지 않음');

console.log('# ④ UI 배선 — 분석 탭이 단일 실행이 아니라 쌍 실행을 쓴다');
var panels = fs.readFileSync(path.join(root, 'js/ui/panels.js'), 'utf8');
assert(/tracePair:\s*true/.test(panels), 'panels.js가 desPair에 tracePair를 요청');
assert(/trace:\s*true,\s*traceCap:\s*300/.test(panels), 'panels.js가 cfg에 trace를 켬 — 없으면 양쪽 다 빈 로그');
assert(!/getLastRun/.test(panels),
  '분석 탭이 getLastRun(단일 모드 최근 실행)에 의존하지 않음 — 병렬 대조로 대체됨');
assert(/threatTraces/.test(panels), 'panels.js가 desPair 결과의 threatTraces를 직접 읽음');
assert((panels.match(/pipelineData\(state,\s*function\s*\(\)\s*\{\s*renderAnalysisPanels\(state\);\s*\}\)/g) || []).length === 2,
  '두 렌더러가 공용 콜백(renderAnalysisPanels)으로 구독 — 나중 구독자가 갱신을 놓치지 않음');
assert(/좌\s*=?\s*As-Is|As-Is 분절형/.test(panels) && /To-Be 통합형/.test(panels),
  '좌=As-Is·우=To-Be 라벨이 코드에 고정');

console.log('# ⑤ 기존 경로 보존 — tracePair 없는 호출은 반대 모드 trace를 만들지 않음');
var other = run('tobe', { trace: false });
assert(!other.threatTraces, 'trace:false 실행은 threatTraces를 내지 않음 (재생 경로 비용 보존 전제)');

console.log('# ⑥ trace 중립성 — 관측을 켠다고 결과가 바뀌면 안 된다');
// 반대 모드에 trace를 켠 것이 이번 변경의 핵심이다. trace가 RNG를 소비하거나 분기를
// 바꾸면 분석 탭의 기존 파이프라인 지표(To-Be 열)가 조용히 달라진다 — bit-exact로 고정한다.
function fingerprint(r) {
  var g = r.global;
  return JSON.stringify({
    spawned: g.spawned, killed: g.killed, leaked: g.leaked, reasons: g.leakReasons,
    nodes: r.nodes.map(function (n) { return [n.id, n.served, n.drops, n.rho.toFixed(9)]; }),
    links: r.links.map(function (l) { return [l.id, l.count, l.delaySec.toFixed(9)]; })
  });
}
['asis', 'tobe'].forEach(function (mode) {
  assert(fingerprint(run(mode, { trace: false })) === fingerprint(run(mode, { trace: true })),
    mode + ': trace on/off 결과 지문 일치 — trace는 순수 관측(비침습)');
});

console.log(fail ? '\nFAIL — ' + fail + '건' : '\nOK — 전체 통과');
process.exit(fail ? 1 : 0);
