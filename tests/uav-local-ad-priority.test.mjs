/**
 * ADR-116 — 저고도 소형 무인기 국지방공 우선(uavLocalAdPriority) 회귀.
 *  ① OFF bit-exact(wire shape에 키 없음) ② features 신고 ③ ON이면 중앙 지휘소(MCRC·IAOC)가 무인기에 L-SAM을 지정하지 않는다
 *  ④ 국지방공(군단 방공)의 무인기 지정은 남는다 ⑤ 무인기 외 유형의 중앙 지정은 그대로 ⑥ 결정론.
 */
import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
const { installIadsKernel } = await import(path.join(ROOT, 'model/iads/index.js'));
globalThis.window = globalThis; const require = createRequire(import.meta.url);
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(ROOT, f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
const BASE = { highResolutionDeployment: true, linkSemanticsV2: true, approvalChain: true, unifiedEngagementState: true, earlyShooterAssignment: true, assignmentFeedback: true, airLaunchAxes: true, tobeApprovalRealism: true };
function run(mode, extra) {
  return KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 1200, spawnUntilSec: 600,
    deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 600, features: Object.assign({}, BASE, extra || {}) });
}
let fails = 0; const assert = (c, m) => { if (!c) { fails++; console.error('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const strip = (r) => { const g = Object.assign({}, r.global); delete g.features; return JSON.stringify({ g, t: r.threatTraces.map((x) => [x.id, x.outcome, x.stages.length]) }); };
const count = (r, type, re) => r.threatTraces.filter((t) => t.type === type).reduce((n, t) => n + t.stages.filter((s) => re.test(s.name)).length, 0);
for (const mode of ['asis', 'tobe']) {
  const off = run(mode), offFalse = run(mode, { uavLocalAdPriority: false });
  assert(strip(off) === strip(offFalse), mode + ' ① OFF bit-exact');
  assert(off.global.features.uavLocalAdPriority === undefined, mode + ' ① OFF wire shape에 키 없음');
  const central = mode === 'tobe' ? 'IAOC' : 'MCRC';
  const centralOff = count(off, 'uav_small', new RegExp('^사수선정·표적할당:' + central + '→'));
  assert(centralOff > 0, mode + ' ③′ OFF에서는 ' + central + '의 무인기 지정이 있다 (' + centralOff + ')');
  const on = run(mode, { uavLocalAdPriority: true });
  assert(on.global.features.uavLocalAdPriority === true, mode + ' ② features 신고');
  const centralOn = count(on, 'uav_small', new RegExp('^사수선정·표적할당:' + central + '→'));
  assert(centralOn === 0, mode + ' ③ ON: ' + central + '의 무인기 지정 0 (' + centralOn + ')');
  const localOn = count(on, 'uav_small', /^사수선정·표적할당:ARMY_LOCAL_AD→/);
  assert(localOn > 0, mode + ' ④ ON: 군단 방공의 무인기 지정은 남는다 (' + localOn + ')');
  for (const ty of ['srbm', 'cruise']) {
    const a = count(off, ty, /^사수선정·표적할당:(MCRC|IAOC|KAMD_OPS)→/), b = count(on, ty, /^사수선정·표적할당:(MCRC|IAOC|KAMD_OPS)→/);
    // L-SAM이 무인기 교전에서 풀리면 다른 유형의 지정 수가 한두 건 움직인다(자원 공유) — 「있다」만 본다.
    assert(a > 0 && b > 0 && Math.abs(a - b) <= 3, mode + ' ⑤ ' + ty + ' 중앙 지정 유지 (' + a + ' → ' + b + ')');
  }
  const on2 = run(mode, { uavLocalAdPriority: true });
  assert(strip(on) === strip(on2), mode + ' ⑥ 결정론');
}
if (fails) { console.error(fails + ' failure(s)'); process.exit(1); } else console.log('uav-local-ad-priority: all passed');
