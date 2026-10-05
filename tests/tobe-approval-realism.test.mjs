/**
 * ADR-115 — 천마 순항 교전 양 모드 제외(shoradCruiseExclusionAll) · To-Be 교전 승인 절차(tobeApprovalRealism) 회귀.
 *  ① OFF bit-exact(두 플래그 모두 wire shape에 키 없음) ② features 신고 ③ 천마 순항 발사 0(To-Be, ① ON)
 *  ④ To-Be에서 군단 방공 결심에 IAOC 협조·승인 단계가 생긴다(② ON) ⑤ 결정론.
 */
import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
const { installIadsKernel } = await import(path.join(ROOT, 'model/iads/index.js'));
globalThis.window = globalThis; const require = createRequire(import.meta.url);
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(ROOT, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment: true, linkSemanticsV2: true, approvalChain: true, shoradCruiseExclusion: true, earlyShooterAssignment: true, assignmentFeedback: true, airLaunchAxes: true };
function run(mode, extra) {
  return KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 1200, spawnUntilSec: 600,
    deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 600, features: Object.assign({}, BASE, extra || {}) });
}
let fails = 0; const assert = (c, m) => { if (!c) { fails++; console.error('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const strip = (r) => { const g = Object.assign({}, r.global); delete g.features; return JSON.stringify({ g, t: r.threatTraces.map((x) => [x.id, x.outcome, x.stages.length]) }); };
for (const mode of ['asis', 'tobe']) {
  const off = run(mode), offFalse = run(mode, { shoradCruiseExclusionAll: false, tobeApprovalRealism: false });
  assert(strip(off) === strip(offFalse), mode + ' ① OFF bit-exact');
  assert(off.global.features.shoradCruiseExclusionAll === undefined && off.global.features.tobeApprovalRealism === undefined, mode + ' ① OFF wire shape에 키 없음');
}
const tb = run('tobe', { shoradCruiseExclusionAll: true, tobeApprovalRealism: true });
assert(tb.global.features.shoradCruiseExclusionAll === true && tb.global.features.tobeApprovalRealism === true, '② features 신고');
const chunmaCruise = tb.threatTraces.filter((t) => t.type === 'cruise').reduce((n, t) => n + t.stages.filter((s) => /^발사:BATTERY_CHUNMA/.test(s.name)).length, 0);
assert(chunmaCruise === 0, '③ To-Be 천마 순항 발사 0 (' + chunmaCruise + ')');
const tbOff = run('tobe');
const chunmaOff = tbOff.threatTraces.filter((t) => t.type === 'cruise').reduce((n, t) => n + t.stages.filter((s) => /^발사:BATTERY_CHUNMA|^사수선정·표적할당:ARMY_LOCAL_AD→BATTERY_CHUNMA/.test(s.name)).length, 0);
assert(chunmaOff > 0, '③′ 플래그 OFF에서는 To-Be 천마 순항 지정·발사가 있다 (' + chunmaOff + ')');
const approvals = tbOff.threatTraces.reduce((n, t) => n + t.stages.filter((s) => /^협조개시:C2_ARMY_LOCAL_AD.*→C2_IAOC/.test(s.name)).length, 0);
const approvalsOn = tb.threatTraces.reduce((n, t) => n + t.stages.filter((s) => /^협조개시:C2_ARMY_LOCAL_AD.*→C2_IAOC/.test(s.name)).length, 0);
const grantedOn = tb.threatTraces.reduce((n, t) => n + t.stages.filter((s) => /^승인완료:C2_IAOC/.test(s.name)).length, 0);
assert(approvals === 0 && approvalsOn > 0 && grantedOn > 0, '④ To-Be 군단 방공 → IAOC 협조·승인 단계 생성 (OFF ' + approvals + ' → ON ' + approvalsOn + ', 승인완료 ' + grantedOn + ')');
assert(strip(tb) === strip(run('tobe', { shoradCruiseExclusionAll: true, tobeApprovalRealism: true })), '⑤ 결정론');
const asOn = run('asis', { shoradCruiseExclusionAll: true, tobeApprovalRealism: true });
assert(strip(asOn) === strip(run('asis')), '⑥ As-Is는 두 플래그에 영향 없음(천마 순항은 이미 제외 · 승인 절차는 종전)');
console.log(fails ? `FAIL ${fails}` : 'PASS'); process.exit(fails ? 1 : 0);
