/**
 * ADR-113 큐 권한(standbyCueAuthority) 회귀.
 *  ① 기본('fire')은 미지정과 bit-exact — 종전 긴급발사 ② 거동 그대로.
 *  ② 'prepare': 큐는 발행·도착하지만 긴급발사 0건, fireByCause에 standby_emergency 없음, features 신고.
 *  ③ 'prepare': 큐를 받은 포대도 자위권 ③을 탈 수 있다(상호배타 해제) — 자위권 발사 중 큐 수신 포대 ≥ 0건이며
 *     ②의 자리를 정식 명령(early_assigned/commanded)이 채운다(정식 발사 수가 'fire'보다 많다).
 *  ④ 보존법칙: 발사 마크 수 = Σ fireByCause.
 */
import path from 'node:path'; import crypto from 'node:crypto'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
globalThis.window = globalThis; const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.join(dir, '..', 'js');
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(root, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
let fail = 0; const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const F = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true, sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true, c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true, rokUsfkCoordination: { asis: 'voice', tobe: 'datalink' }, commanderRouteRetry: true, shoradCruiseExclusion: true, shoradPkRealism: true, earlyShooterAssignment: true, assignmentFeedback: true, batteryStatusReporting: true, statusReportPeriodSec: 4 };
const run = (mode, extra) => KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 1200, deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 1000, features: Object.assign({}, F, extra) });
const hash = (r) => crypto.createHash('sha256').update(JSON.stringify({ g: r.global, n: r.nodes })).digest('hex');
for (const mode of ['asis', 'tobe']) {
  console.log('[' + mode + ']');
  const base = run(mode, {}), fire = run(mode, { standbyCueAuthority: 'fire' }), prep = run(mode, { standbyCueAuthority: 'prepare' });
  assert(hash(base) === hash(fire) && base.global.features.standbyCueAuthority === 'fire', "① 기본 = 'fire' bit-exact");
  const fbF = fire.global.c2Orders.fireByCause, fbP = prep.global.c2Orders.fireByCause;
  assert(prep.global.features.standbyCueAuthority === 'prepare' && prep.global.standbyCue.threatsCued > 0 && prep.global.standbyCue.noticesArrived > 0, '② prepare: 큐 발행·도착 유지 (' + prep.global.standbyCue.threatsCued + '위협)');
  assert(!fbP.standby_emergency && prep.global.standbyCue.emergencyFired === 0 && !prep.threatTraces.some((t) => t.stages.some((s) => /^긴급발사:/.test(s.name))), '② prepare: 긴급발사 0건 (fire ' + (fbF.standby_emergency || 0) + '건)');
  const formal = (fb) => (fb.early_assigned || 0) + (fb.commanded || 0) + (fb.mcrc_commanded || 0);
  assert(formal(fbP) > formal(fbF), '③ 정식 명령 발사가 늘어남 ' + formal(fbF) + ' → ' + formal(fbP));
  let sdfCued = 0, sdf = 0;
  prep.threatTraces.forEach((t) => t.stages.forEach((s) => { const m = /^자위권발사:(.+)$/.exec(s.name); if (!m) return; sdf++; if (t.stages.some((x) => x.name === '사전대기큐도착:' + m[1])) sdfCued++; }));
  assert(sdf > 0 && sdfCued > 0 && (fbP.self_defense || 0) <= sdf, '③ 자위권 시도 ' + sdf + '건(큐 수신 포대 ' + sdfCued + '건) ≥ 실제 자위권 발사 ' + (fbP.self_defense || 0) + '건 — 큐 포대도 ③을 탄다');
  const fires = prep.threatTraces.reduce((a, t) => a + t.stages.filter((s) => /^발사:/.test(s.name)).length, 0);   // 자위권발사: 마크는 결심이고 실제 발사는 같은 시각 발사: 마크
  assert(fires === Object.values(fbP).reduce((a, b) => a + b, 0), '④ 발사 마크 ' + fires + ' = Σ fireByCause');
}
console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건'); process.exit(fail ? 1 : 0);
