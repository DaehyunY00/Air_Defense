/**
 * ADR-111 결심 기록(trace.decisions) 회귀.
 *  ① 관측 순수성 — trace ON/OFF에서 global·nodes가 동일(기록이 동역학을 바꾸지 않는다).
 *  ② 기록이 모델과 맞물린다 — 긴급발사 마크마다 같은 시각 standby 기록이 있고 chosen=그 사수, 그 후보는 ok.
 *     chosen은 항상 ok 후보 중 하나. ok 후보에만 rank가 있고 1부터 빈틈없이 매겨진다.
 *  ③ 부피 — 같은 판정의 반복은 접힌다(n·tEnd) · 항적당 상한 400 · JSON 비교용 _sig는 실리지 않는다.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..', 'js');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js', 'data/threats.js',
  'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const F = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true,
  rokUsfkCoordination: { asis: 'voice', tobe: 'datalink' }, commanderRouteRetry: true, shoradCruiseExclusion: true, shoradPkRealism: true,
  earlyShooterAssignment: true, assignmentFeedback: true };
for (const mode of ['asis', 'tobe']) {
  const cfg = { scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 1200, deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', features: F };
  const off = KJ.runDES(Object.assign({}, cfg, { trace: false }));
  const on = KJ.runDES(Object.assign({}, cfg, { trace: true, traceCap: 1000 }));
  console.log('[' + mode + ']');
  assert(JSON.stringify(off.global) === JSON.stringify(on.global) && JSON.stringify(off.nodes) === JSON.stringify(on.nodes), '① trace ON/OFF 동역학 동일');
  let total = 0, maxPer = 0, bad = 0, emerMissing = 0, emerTotal = 0, collapsed = 0, sigLeak = 0;
  on.threatTraces.forEach((tr) => {
    const ds = tr.decisions || []; total += ds.length; maxPer = Math.max(maxPer, ds.length);
    ds.forEach((d) => {
      if (d.n > 1) collapsed++;
      if (Object.prototype.propertyIsEnumerable.call(d, '_sig')) sigLeak++;
      const ok = d.cands.filter((c) => c.ok);
      if (d.chosen && !ok.some((c) => c.id === d.chosen)) bad++;
      const ranks = ok.map((c) => c.rank).filter(Number.isFinite).sort((a, b) => a - b);
      if (d.kind === 'formal' && ranks.some((r, i) => r !== i + 1)) bad++;
      if (d.cands.some((c) => !c.ok && c.rank != null)) bad++;
      if (d.tEnd < d.t || d.n < 1) bad++;
    });
    tr.stages.forEach((s) => {
      const m = /^긴급발사:(.+)$/.exec(s.name); if (!m) return;
      emerTotal++;
      const d = ds.find((x) => x.kind === 'standby' && Math.abs(x.t - s.t) < 1e-9);
      if (!d || d.chosen !== m[1] || !d.cands.some((c) => c.id === m[1] && c.ok)) emerMissing++;
    });
  });
  assert(total > 0, '② 결심 기록 존재 (' + total + '건)');
  assert(bad === 0, '② chosen∈ok · rank 연속 · tEnd≥t (위반 ' + bad + ')');
  assert(emerTotal > 0 && emerMissing === 0, '② 긴급발사 ' + emerTotal + '건마다 같은 시각 standby 기록·chosen 일치 (누락 ' + emerMissing + ')');
  assert(maxPer <= 400, '③ 항적당 상한 400 (최대 ' + maxPer + ')');
  assert(collapsed > 0, '③ 반복 판정 접힘 (' + collapsed + '건)');
  assert(sigLeak === 0, '③ _sig 비노출');
  assert(!JSON.stringify(on.threatTraces).includes('"_sig"'), '③ JSON에 _sig 없음');
}
console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
