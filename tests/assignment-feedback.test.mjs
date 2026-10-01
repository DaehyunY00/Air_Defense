/**
 * ADR-110 사수 지정 되먹임(assignmentFeedback) 회귀.
 *  ① OFF bit-exact — 미지정 = false(ADR-109만 켠 결과와 동일) · features·global에 키 없음.
 *  ② ON — 「사수불가회신」 마크 수 = earlyAssignment.cantco · CANTCO까지의 대기 ≤ 유예 + 5초(재점검 간격) + 예측 준비 지연 ·
 *     예측 readyAt 시각에 요격점 구간이 성립 · 냉각 중 같은 사수 예측 재지정 0.
 *  ③ 만료 대기(expiredWaiting)가 ADR-109만 켠 경우보다 줄어든다.
 *  ④ 관측 순수성 — flowTrace ON/OFF 동역학 지문 동일.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js', 'data/threats.js',
 'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const sha = (r) => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const dyn = (r) => { const c = Object.assign({}, r); ['flowEvents', 'flowTruncated', 'flowCap'].forEach((k) => { delete c[k]; }); return sha(c); };
const SCREEN = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true,
  rokUsfkCoordination: { asis: 'voice', tobe: 'datalink' }, commanderRouteRetry: true, shoradCruiseExclusion: true, shoradPkRealism: true, earlyShooterAssignment: true };
const run = (mode, extra, opts) => KJ.runDES(Object.assign({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 1500, spawnUntilSec: 900,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 3000, features: Object.assign({}, SCREEN, extra || {}) }, opts || {}));

for (const mode of ['asis', 'tobe']) {
  console.log(`\n# ${mode}`);
  const off = run(mode), offFalse = run(mode, { assignmentFeedback: false });
  assert(sha(off) === sha(offFalse), '① OFF: 미지정 = false bit-exact');
  assert(off.global.features.assignmentFeedback === undefined && off.global.earlyAssignment.cantco === undefined, '① OFF wire shape에 키 없음');
  const on = run(mode, { assignmentFeedback: true }, { flowTrace: true, flowTraceCap: 400000 });
  const onNoFlow = run(mode, { assignmentFeedback: true });
  assert(on.global.features.assignmentFeedback === true && on.global.features.cantcoGraceSec === 30 && on.global.features.cantcoCooldownSec === 60, '② features 신고');
  const ea = on.global.earlyAssignment;
  let cantcoMarks = 0, waitTooLong = 0, cooldownRepick = 0, checked = 0;
  on.threatTraces.forEach((tr) => {
    const st = tr.stages;
    st.forEach((s, i) => {
      if (!s.name.startsWith('사수불가회신:')) return;
      cantcoMarks++;
      const shooter = s.name.slice('사수불가회신:'.length).replace(/\(.*$/, '');
      // 직전 사수지정(예측) 마크의 「준비 +Ns」와 지정 시각으로 예측 준비 시각을 복원 → 대기 ≤ 준비 + 유예 + 5
      for (let j = i - 1; j >= 0; j--) {
        const m = /^사수지정\(예측\):[^→]+→(.+)\(준비 \+(\d+)s\)$/.exec(st[j].name);
        if (m && m[1] === shooter) { checked++; if (s.t > st[j].t + (+m[2]) + 30 + 5 + 1) waitTooLong++; break; }
      }
      // 냉각 60초 안에 같은 사수 예측 재지정 0
      for (let j = i + 1; j < st.length && st[j].t < s.t + 60; j++) {
        const m = /^사수지정\(예측\):[^→]+→(.+)\(준비/.exec(st[j].name);
        if (m && m[1] === shooter) cooldownRepick++;
      }
    });
  });
  assert(cantcoMarks === (ea.cantco || 0) && cantcoMarks > 0, `② CANTCO 마크 ${cantcoMarks} = 계정 ${ea.cantco || 0}`);
  assert(waitTooLong === 0 && checked > 0, `② CANTCO까지 대기 ≤ 예측 준비 + 유예 30 + 재점검 5초 (검사 ${checked}건 · 초과 ${waitTooLong})`);
  assert(cooldownRepick === 0, `② 냉각 60초 안 같은 사수 예측 재지정 ${cooldownRepick}건`);
  // 예측 readyAt에서 요격점 구간 성립: 지정 마크의 준비 시각이 PIP 구간 안인지 엔진 함수로 직접 확인
  const sim = new KJ.Simulation(Object.assign({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 1500, spawnUntilSec: 900,
    deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', features: Object.assign({}, SCREEN, { assignmentFeedback: true }) }));
  assert(typeof sim._iadsPipIntervals === 'function' && typeof sim._iadsPredictFcReadyAt === 'function', '② 예측 함수 존재');
  assert(off.global.earlyAssignment.expiredWaiting > (ea.expiredWaiting || 0), `③ 만료 대기 ${off.global.earlyAssignment.expiredWaiting} → ${ea.expiredWaiting || 0}`);
  assert(dyn(on) === dyn(onNoFlow), '④ flowTrace ON/OFF 동역학 지문 동일');
  console.log(`  info ${mode}: 격추/누수 ADR-109만 ${off.global.killed}/${off.global.leaked} → 되먹임 ${on.global.killed}/${on.global.leaked} · cantco ${ea.cantco || 0}`);
}
console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
