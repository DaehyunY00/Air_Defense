/**
 * ADR-106 책임 C2 보고 재시도 — commanderRouteRetry 회귀.
 *
 * 지키려는 계약:
 *  ① OFF bit-exact — 플래그를 주지 않으면(또는 false) 결과가 종전과 같고 features·global에 키가 실리지 않는다.
 *  ② 효과 — srbm#3(SC3·FULL·seed 29)에서 THAAD C2의 「책임C2:」 마크가 OFF(150.6초)보다 앞당겨지고, AN/TPY-2 탐지 뒤
 *     상관 시도 창(5초) 한 개 안쪽 경계에서 성립한다.
 *  ③ 중복 없음 — 어느 항적에서도 같은 책임 C2가 시작 보고를 두 번 받지 않는다(원장 receivedAt 단일 · 「책임C2:」 마크 C2당 1회).
 *  ④ 계정 — commandersRecovered ≤ commandersDeferred, 회복 마크 수 = commandersRecovered, recoveryDelayMax ≤ 관측 창.
 *  ⑤ 관측 순수성 — flowTrace ON/OFF 동역학 지문 동일.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const sha = (r) => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const dyn = (r) => { const c = Object.assign({}, r); ['flowEvents', 'flowTruncated', 'flowCap'].forEach((k) => { delete c[k]; }); return sha(c); };

const SCREEN = Object.freeze({
  highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true,
  sensorReportParity: true, sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true,
  selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true, c2DecisionTimeParity: true,
  approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true,
  rokUsfkCoordination: 'voice'
});
const DEP = 'HANBANDO_FULL_NORMAL';
const run = (mode, extra, opts) => KJ.runDES(Object.assign({
  scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 600,
  deploymentId: DEP, modelFidelity: 'iads-c2', trace: true, traceCap: 1000,
  features: Object.assign({}, SCREEN, extra || {})
}, opts || {}));
const RETRY = KJ.IADS.CORRELATION_RETRY_SECONDS;
const cmdMarks = (tr, re) => tr.stages.filter((s) => re.test(s.name));

for (const mode of ['asis', 'tobe']) {
  console.log(`\n# ${mode}`);
  const off = run(mode), offFalse = run(mode, { commanderRouteRetry: false });
  assert(sha(off) === sha(offFalse), '① OFF: 미지정 = false bit-exact');
  assert(off.global.features.commanderRouteRetry === undefined && off.global.routeRetry === undefined, '① OFF wire shape에 키 없음');

  const on = run(mode, { commanderRouteRetry: true }, { flowTrace: true, flowTraceCap: 400000 });
  const onNoFlow = run(mode, { commanderRouteRetry: true });
  assert(on.global.features.commanderRouteRetry === true, '② features 신고');
  assert(dyn(on) === dyn(onNoFlow), '⑤ flowTrace ON/OFF 동역학 지문 동일');

  const trOff = off.threatTraces.find((t) => t.id === 'srbm#3');
  const trOn = on.threatTraces.find((t) => t.id === 'srbm#3');
  const thaadOff = cmdMarks(trOff, /^책임C2:USFK_THAAD_C2/)[0];
  const thaadOn = cmdMarks(trOn, /^책임C2:USFK_THAAD_C2/)[0];
  const tpy2 = cmdMarks(trOn, /^SENSOR_DETECTED:SENSOR_AN_TPY2/)[0];
  assert(thaadOff && thaadOn && thaadOn.t < thaadOff.t, `② srbm#3 THAAD C2 인지 ${thaadOff && thaadOff.t.toFixed(1)} → ${thaadOn && thaadOn.t.toFixed(1)}초`);
  // 재시도는 5초 경계 **이후 첫 스캔 사건**에서 돈다(스캔 주기 dt만큼 늦을 수 있다) — 경계 + 한 창 안쪽이면 된다.
  assert(tpy2 && thaadOn && thaadOn.t >= tpy2.t && thaadOn.t - tpy2.t < 2 * RETRY,
    `② AN/TPY-2 탐지(${tpy2 && tpy2.t.toFixed(1)}) 뒤 두 상관 창(${2 * RETRY}초) 안에 성립(${thaadOn && thaadOn.t.toFixed(2)})`);
  assert(cmdMarks(trOn, /^보고재시도회복:USFK_THAAD_C2/).length === 1, '② srbm#3에 THAAD C2 회복 마크 1개');

  let dup = 0, recoveryMarks = 0;
  on.threatTraces.forEach((tr) => {
    const seen = {};
    tr.stages.forEach((s) => {
      const m = /^책임C2:([^(]+)\(([^)]+)\)/.exec(s.name);
      if (m) { const k = m[1] + '|' + m[2] + '|' + (s.axis || ''); if (seen[k]) dup++; seen[k] = true; }
      if (/^보고재시도회복:/.test(s.name)) recoveryMarks++;
    });
  });
  assert(dup === 0, `③ 같은 책임 C2 시작 보고 중복 0건 (${dup})`);
  const rr = on.global.routeRetry;
  assert(rr && rr.scheduled > 0 && rr.attempts > 0, `④ 계정 존재 · 예약 ${rr && rr.scheduled} · 시도 ${rr && rr.attempts}`);
  assert(rr.commandersRecovered <= rr.commandersDeferred, `④ 회복 ${rr.commandersRecovered} ≤ 보류 ${rr.commandersDeferred}`);
  assert(recoveryMarks === rr.commandersRecovered, `④ 회복 마크 ${recoveryMarks} = 계정 ${rr.commandersRecovered}`);
  assert(rr.recoveryDelayMax <= 600 && rr.recoveryDelaySum >= rr.recoveryDelayMax, `④ 회복 지연 최대 ${rr.recoveryDelayMax.toFixed(1)}초 · 합 ${rr.recoveryDelaySum.toFixed(1)}`);
  const g = on.global, unresolved = g.spawned - g.killed - g.leaked;
  assert(Number.isInteger(g.spawned) && g.spawned > 0 && unresolved >= 0 && g.killed >= 0 && g.leaked >= 0,
    `④ 생성 ${g.spawned} = 격추 ${g.killed} + 누수 ${g.leaked} + 미해결 ${unresolved}`);
}

console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
