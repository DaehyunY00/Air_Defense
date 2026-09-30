/**
 * ADR-107 단거리방공 현실화 — shoradCruiseExclusion(①) · shoradPkRealism(②) 회귀.
 *  ① OFF bit-exact — 미지정 = false, features·global에 키 없음.
 *  ② ① ON: 비호·천마의 순항미사일 발사 0건, 다른 위협(무인기) 발사는 남는다.
 *  ③ ② ON: global.shoradPkSamples = 비호·천마가 무인기·순항에 쏜 발사 수 · Pk가 내려가 격추가 준다.
 *  ④ ① 단독은 순항 외 결과를 거의 바꾸지 않는다(전체 격추 차이 ≤ 5).
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
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js', 'data/threats.js',
 'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const sha = (r) => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const dyn = (r) => { const c = Object.assign({}, r); ['flowEvents', 'flowTruncated', 'flowCap'].forEach((k) => { delete c[k]; }); return sha(c); };
const SCREEN = Object.freeze({ highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true,
  sensorReportParity: true, sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true,
  ballisticLaunchAxes: true, threatAimpoints: true, c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true,
  ballisticReportSource: true, standbyCue: true, rokUsfkCoordination: 'voice', commanderRouteRetry: true });
const run = (mode, extra, opts) => KJ.runDES(Object.assign({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 900,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 2000, features: Object.assign({}, SCREEN, extra || {}) }, opts || {}));
const isShorad = (id) => /^BATTERY_(BIHO|CHUNMA)_/.test(id);
const shots = (res, pred) => { let n = 0; res.threatTraces.forEach((t) => { if (!pred(t)) return; t.stages.forEach((s) => { const m = /^(발사|자위권발사):([^/]+)/.exec(s.name); if (m && isShorad(m[2])) n++; }); }); return n; };

for (const mode of ['asis', 'tobe']) {
  console.log(`\n# ${mode}`);
  const off = run(mode), offFalse = run(mode, { shoradCruiseExclusion: false, shoradPkRealism: false });
  assert(sha(off) === sha(offFalse), '① OFF: 미지정 = false bit-exact');
  assert(off.global.features.shoradCruiseExclusion === undefined && off.global.features.shoradPkRealism === undefined && off.global.shoradPkSamples === undefined, '① OFF wire shape에 키 없음');
  const a = run(mode, { shoradCruiseExclusion: true });
  assert(a.global.features.shoradCruiseExclusion === true, '② features 신고');
  assert(shots(a, (t) => t.type === 'cruise') === 0, `② 비호·천마 순항 발사 0건 (OFF에서는 ${shots(off, (t) => t.type === 'cruise')}건)`);
  assert(shots(a, (t) => t.type === 'uav_small') > 0, '② 비호·천마 무인기 발사는 남음');
  assert(Math.abs(a.global.killed - off.global.killed) <= 5, `④ ① 단독 격추 차이 ≤ 5 (${off.global.killed} → ${a.global.killed})`);
  const b = run(mode, { shoradCruiseExclusion: true, shoradPkRealism: true }, { flowTrace: true, flowTraceCap: 400000 });
  const bNoFlow = run(mode, { shoradCruiseExclusion: true, shoradPkRealism: true });
  assert(dyn(b) === dyn(bNoFlow), '⑤ flowTrace ON/OFF 동역학 지문 동일');
  const expectSamples = shots(b, (t) => t.type === 'uav_small' || t.type === 'cruise');
  assert(b.global.shoradPkSamples === expectSamples && expectSamples > 0, `③ Pk 샘플 ${b.global.shoradPkSamples} = 비호·천마 무인기·순항 발사 ${expectSamples}`);
  assert(b.global.killed < a.global.killed, `③ Pk 현실화로 격추 감소 (${a.global.killed} → ${b.global.killed})`);
}
console.log(fail ? `\n${fail} FAIL` : '\nALL PASS'); process.exit(fail ? 1 : 0);
