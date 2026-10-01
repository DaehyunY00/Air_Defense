/**
 * ADR-109 조기 사수 지정(earlyShooterAssignment) 회귀.
 *  ① OFF bit-exact — 미지정 = false · features·global에 키 없음.
 *  ② ON — 「사수지정(예측)」 마크와 early_assigned 발사가 있고, 계정이 대사한다(waits ≥ firedAfterWait + expiredWaiting ·
 *     assigned ≥ waits). srbm#3의 정식 결심(사수선정) 시각이 OFF보다 앞선다.
 *  ③ 이중 발사 없음 — 같은 축의 살아 있는 계획이 둘인 위협 0건(발사 마크 기준: 같은 위협에 같은 축 발사가 BDA 없이 겹치지 않음은
 *     기존 중재가 맡으므로, 여기서는 early_assigned 계획이 살아 있는 동안 같은 축 긴급발사가 0건임을 본다).
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
  rokUsfkCoordination: 'voice', commanderRouteRetry: true, shoradCruiseExclusion: true, shoradPkRealism: true };
const run = (mode, extra, opts) => KJ.runDES(Object.assign({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 900,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 2000, features: Object.assign({}, SCREEN, extra || {}) }, opts || {}));

for (const mode of ['asis', 'tobe']) {
  console.log(`\n# ${mode}`);
  const off = run(mode), offFalse = run(mode, { earlyShooterAssignment: false });
  assert(sha(off) === sha(offFalse), '① OFF: 미지정 = false bit-exact');
  assert(off.global.features.earlyShooterAssignment === undefined && off.global.earlyAssignment === undefined, '① OFF wire shape에 키 없음');
  const on = run(mode, { earlyShooterAssignment: true }, { flowTrace: true, flowTraceCap: 400000 });
  const onNoFlow = run(mode, { earlyShooterAssignment: true });
  assert(on.global.features.earlyShooterAssignment === true && on.global.features.earlyAssignmentTimePenaltySec === 30, '② features 신고(τ=30)');
  assert(dyn(on) === dyn(onNoFlow), '④ flowTrace ON/OFF 동역학 지문 동일');
  const ea = on.global.earlyAssignment, fbc = on.global.c2Orders.fireByCause;
  let marks = 0, waits = 0;
  on.threatTraces.forEach((t) => t.stages.forEach((s) => { if (/^사수지정\(예측\):/.test(s.name)) marks++; if (/^사수대기:/.test(s.name)) waits++; }));
  assert(ea && ea.assigned > 0 && marks === ea.assigned, `② 예측 지정 ${ea && ea.assigned}건 = 마크 ${marks}`);
  assert(fbc.early_assigned > 0, `② early_assigned 발사 ${fbc.early_assigned}건`);
  assert(waits === ea.waits && ea.waits >= ea.firedAfterWait + ea.expiredWaiting && ea.assigned >= ea.waits,
    `② 대기 계정 대사: waits ${ea.waits} = 마크 ${waits} · ≥ 발사 ${ea.firedAfterWait} + 만료 ${ea.expiredWaiting} · assigned ${ea.assigned} ≥ waits`);
  const decT = (res) => { const tr = res.threatTraces.find((t) => t.id === 'srbm#3'); const d = tr.stages.find((s) => /^사수선정·표적할당:/.test(s.name)); return d ? d.t : Infinity; };
  assert(decT(on) < decT(off), `② srbm#3 정식 결심 ${decT(off).toFixed(1)} → ${decT(on).toFixed(1)}초`);
  // ③ early_assigned 계획이 살아 있는 동안 같은 축 긴급발사 0건 — 발사 귀속으로 본다: 같은 위협에 early_assigned 발사와 standby_emergency 발사가 둘 다 있으면 안 됨
  let both = 0;
  on.threatTraces.forEach((t) => { const em = t.stages.some((s) => /^긴급발사:/.test(s.name)); const pred = t.stages.some((s) => /^사수지정\(예측\):(KAMD_OPS|IAOC)/.test(s.name)); const firedPred = t.stages.some((s) => /^발사:/.test(s.name)) && pred; if (em && firedPred && !t.stages.some((s) => /^BDA:MISS/.test(s.name))) both++; });
  assert(both === 0, `③ 실패(MISS) 없이 같은 위협에 예측 지정 발사와 긴급발사가 겹친 항적 0건 (${both})`);
  const g = on.global, unresolved = g.spawned - g.killed - g.leaked;
  assert(Number.isInteger(g.spawned) && unresolved >= 0 && g.killed >= 0 && g.leaked >= 0, `생성 ${g.spawned} = 격추 ${g.killed} + 누수 ${g.leaked} + 미해결 ${unresolved}`);
}
console.log(fail ? `\n${fail} FAIL` : '\nALL PASS'); process.exit(fail ? 1 : 0);
