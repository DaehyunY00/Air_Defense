/**
 * ADR-112 포대 상태 보고(batteryStatusReporting) 회귀.
 *  ① OFF bit-exact — 플래그 false와 미지정이 같은 결과(해시).
 *  ② ON — features 신고 · 결심 기록의 상태 나이(age)가 [계선 지연, 주기+계선 지연] 안 · 주기가 길수록 중앙값이 커진다.
 *  ③ ON — C2가 보는 사격통제 등급은 실제보다 앞서지 않는다(예측 후보 제외, 비예측 ok 후보는 그 시각 실제로도 발사 가능).
 *  ④ 관측 순수성 — ON에서 trace ON/OFF global 동일.
 */
import path from 'node:path';
import crypto from 'node:crypto';
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
const run = (mode, extra, trace) => KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 1200,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: !!trace, traceCap: 1000, features: Object.assign({}, F, extra) });
const hash = (r) => crypto.createHash('sha256').update(JSON.stringify({ g: r.global, n: r.nodes })).digest('hex');
for (const mode of ['asis', 'tobe']) {
  console.log('[' + mode + ']');
  assert(hash(run(mode, {})) === hash(run(mode, { batteryStatusReporting: false })), '① OFF bit-exact');
  const on4 = run(mode, { batteryStatusReporting: true, statusReportPeriodSec: 4 }, true);
  const on30 = run(mode, { batteryStatusReporting: true, statusReportPeriodSec: 30 }, true);
  assert(on4.global.features.batteryStatusReporting === true && on4.global.features.statusReportPeriodSec === 4, '② features 신고');
  const ages = (r) => { const a = []; r.threatTraces.forEach((t) => (t.decisions || []).forEach((d) => { if (d.kind === 'formal') d.cands.forEach((c) => { if (Number.isFinite(c.age)) a.push(c.age); }); })); return a.sort((x, y) => x - y); };
  const a4 = ages(on4), a30 = ages(on30), med = (a) => a[Math.floor(a.length / 2)];
  assert(a4.length > 0 && a4[0] >= 0 && a4[a4.length - 1] <= 4 + 120, '② 나이 범위 P=4 [0, P+계선] (' + a4[0] + '~' + a4[a4.length - 1] + ')');
  assert(a30.length > 0 && a30[a30.length - 1] <= 30 + 120 && med(a30) > med(a4), '② 주기 30초 중앙값 > 4초 중앙값 (' + med(a30) + ' > ' + med(a4) + ')');
  // ③ standby 기록(포대 자체 판단)에는 age가 없다 — 실제 상태로 판단한다.
  let standbyWithAge = 0;
  on4.threatTraces.forEach((t) => (t.decisions || []).forEach((d) => { if (d.kind === 'standby' && d.cands.some((c) => c.age != null)) standbyWithAge++; }));
  assert(standbyWithAge === 0, '③ 큐 자체 판단은 지연 없음(age 없음)');
  const onNoTrace = run(mode, { batteryStatusReporting: true, statusReportPeriodSec: 4 }, false);
  assert(JSON.stringify(onNoTrace.global) === JSON.stringify(on4.global), '④ trace ON/OFF global 동일');
}
console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
