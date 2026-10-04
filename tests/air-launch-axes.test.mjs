/**
 * ADR-114 공중 위협 발사점 연장(`airLaunchAxes`) — 가드.
 *
 * 지키는 것:
 *  1) OFF bit-exact — 켜야만 움직이고, OFF 결과에 키가 실리지 않는다
 *  2) 연장은 **공중 위협만** — 탄도(srbm·mrl_large)는 ADR-091 갈래 그대로(ON/OFF 무관하게 같은 연장량)
 *  3) 연장량 = 위협 제원 launchStandoffKm · 체공시간은 (reach+ext)/reach 배(함의 속도 유지)
 *  4) 새 난수 소비 없음 — 같은 seed 두 번이 같은 결과(결정론)
 *  5) 관측 배선 — trace의 launchExtKm·dwellSec과 KJ.iadsThreatPosition이 발사점(진입점 뒤)에서 시작한다
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js','config/geo-mdl.js','config/deployments.js','data/nodes.js','data/links.js','data/threats.js','data/scenarios.js','data/axes.js','config/deployment-adapter.js','core/rng.js','core/heap.js','engine/sim-engine.js'].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
let fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(Object.assign({}, r, { threatTraces: undefined }))).digest('hex'); }
function run(extra, opts) {
  opts = opts || {};
  return KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: opts.mode || 'asis', intensity: 1, seed: opts.seed || 29,
    endTimeSec: opts.dur || 600, spawnUntilSec: opts.dur || 600, deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2',
    trace: !!opts.trace, traceCap: 5000, features: Object.assign({ highResolutionDeployment: true, ballisticLaunchAxes: true }, extra || {}) });
}
console.log('# 1) OFF bit-exact · wire shape');
const off = run({}), offExplicit = run({ airLaunchAxes: false });
assert(sha(off) === sha(offExplicit), 'airLaunchAxes:false === 미지정');
assert(!('airLaunchAxes' in off.global.features), 'OFF에서는 features에 키가 실리지 않는다');
const on = run({ airLaunchAxes: true });
assert(sha(on) !== sha(off), 'ON은 실제로 다른 결과');
assert(on.global.features.airLaunchAxes === true, 'ON은 features.airLaunchAxes=true 신고');
console.log('# 2) 연장은 공중 위협만 · 탄도는 ADR-091 그대로');
const trOff = run({}, { trace: true }), trOn = run({ airLaunchAxes: true }, { trace: true });
const AIR = ['cruise', 'fighter', 'uav_small', 'ac_low', 'heli'], BAL = ['srbm', 'mrl_large'];
const byType = {};
trOn.threatTraces.forEach((t) => { const b = byType[t.type] = byType[t.type] || { n: 0, ext: 0 }; b.n++; if (t.launchExtKm > 0) b.ext++; });
Object.keys(byType).forEach((t) => {
  const v = byType[t];
  if (AIR.includes(t)) assert(v.ext === v.n, `${t}: 공중 — 전부 연장(${v.ext}/${v.n})`);
});
const balOff = {}, balOn = {};
trOff.threatTraces.filter((t) => BAL.includes(t.type)).forEach((t) => balOff[t.id] = [t.launchExtKm, +t.dwellSec.toFixed(6)]);
trOn.threatTraces.filter((t) => BAL.includes(t.type)).forEach((t) => balOn[t.id] = [t.launchExtKm, +t.dwellSec.toFixed(6)]);
assert(Object.keys(balOn).length > 0 && Object.keys(balOn).every((id) => balOff[id] && balOff[id][0] === balOn[id][0] && balOff[id][1] === balOn[id][1]), '탄도 항적의 연장량·체공시간은 ON/OFF에서 같다(ADR-091 갈래 불변)');
console.log('# 3) 연장량 = launchStandoffKm · 체공 동비율');
let okExt = 0, okDwell = 0, nAir = 0;
const offById = {}; trOff.threatTraces.forEach((t) => offById[t.id] = t);
trOn.threatTraces.filter((t) => AIR.includes(t.type)).forEach((t) => {
  nAir++; const tt = KJ.threatType(t.type), ax = KJ.AXES[t.axis];
  if (Math.abs(t.launchExtKm - tt.launchStandoffKm) < 1e-9) okExt++;
  const base = offById[t.id]; if (base && Math.abs(t.dwellSec / base.dwellSec - (ax.conceptReachKm + tt.launchStandoffKm) / ax.conceptReachKm) < 1e-9) okDwell++;
});
assert(nAir > 0 && okExt === nAir, `연장량 = 제원 launchStandoffKm (${okExt}/${nAir})`);
assert(okDwell === nAir, `체공시간 = OFF × (reach+ext)/reach (${okDwell}/${nAir})`);
console.log('# 4) 결정론');
assert(sha(run({ airLaunchAxes: true })) === sha(on), '같은 seed 두 번 = 같은 결과');
console.log('# 5) 관측 배선 — 발사점이 진입점 뒤에 있다');
const sample = trOn.threatTraces.find((t) => t.type === 'cruise') || trOn.threatTraces.find((t) => AIR.includes(t.type));
if (sample) {
  const ax = KJ.AXES[sample.axis];
  const th = { axis: sample.axis, target: sample.target, spawnT: sample.spawnT, dwellSec: sample.dwellSec, type: sample.type, _launchExtKm: sample.launchExtKm };
  const p0 = KJ.iadsThreatPosition(th, sample.spawnT);
  const dEntry = Math.hypot((p0.lat - ax.entry[0]) * 111, (p0.lon - ax.entry[1]) * 88);
  assert(dEntry > sample.launchExtKm * 0.8, `${sample.id}: 생성 위치가 진입점에서 ${dEntry.toFixed(0)}km 떨어짐(연장 ${sample.launchExtKm}km)`);
  const tEntry = sample.spawnT + sample.dwellSec * (sample.launchExtKm / (sample.launchExtKm + ax.conceptReachKm));
  const pE = KJ.iadsThreatPosition(th, tEntry);
  const dE = Math.hypot((pE.lat - ax.entry[0]) * 111, (pE.lon - ax.entry[1]) * 88);
  assert(dE < 15, `${sample.id}: 연장 구간을 지난 시점의 위치가 진입점 근처(${dE.toFixed(1)}km)`);
} else assert(false, '공중 항적 표본 없음');
console.log(fail ? `FAIL ${fail}` : 'OK — 전체 통과'); process.exit(fail ? 1 : 0);
