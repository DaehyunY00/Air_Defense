/**
 * ADR-091 탄도 축선 발사점 연장 — 가드.
 *
 * 왜 이제야 쓰는가: 채택(2026-08-25) 당시 이 ADR에는 가드 테스트가 없었다. 2026-09-10에
 * [지휘 흐름] 프로토타입의 **기본값**이 되면서(사용자 결정 「출발점은 모든 배치에서 수정」)
 * 지켜야 할 계약이 생겼다.
 *
 * 지키는 것:
 *  1) OFF bit-exact — 이 기능은 켜야만 움직인다(골든 지문 불변)
 *  2) 연장은 **탄도탄만** — 비탄도에 걸리면 조용히 다른 궤적이 된다(실제로 밖에서 재계산하다
 *     이 갈래를 빠뜨려 uav_small·fighter 17건이 어긋난 적이 있다)
 *  3) 연장량이 ADR 표와 같다(축선×유형 상수)
 *  4) **탐지 선착이 뒤집힌다** — 이 ADR의 존재 이유. 포대 전속 MFR → 그린파인
 *  5) 새 난수 소비 없음(결정론·CRN 쌍대 유지)
 *  6) 관측 배선 — trace의 dwellSec·launchExtKm과 공개 helper KJ.iadsThreatPosition.
 *     화면이 궤적을 되짚는 재료라, 빠지면 지도의 항적이 조용히 틀린 자리에 그려진다.
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
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }

const BASE = { highResolutionDeployment: true };
function run(extra, opts) {
  opts = opts || {};
  return KJ.runDES({
    scenario: KJ.scenarioById(opts.sc || 'sc3'), mode: opts.mode || 'asis', intensity: 1,
    seed: opts.seed || 12345, endTimeSec: opts.dur || 600,
    deploymentId: opts.dep || 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    trace: !!opts.trace, traceCap: 5000,
    features: Object.assign({}, BASE, extra || {})
  });
}

// ── 1. OFF bit-exact ──
console.log('# 1) OFF는 골든 지문 그대로 (켜야만 움직인다)');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
assert(sha(run({})) === GOLDEN.asis, 'SC3 As-Is OFF = 골든');
assert(sha(run({}, { mode: 'tobe' })) === GOLDEN.tobe, 'SC3 To-Be OFF = 골든');
assert(!('ballisticLaunchAxes' in run({}).global.features), 'OFF wire shape 불변 (키가 실리지 않는다)');
const on = run({ ballisticLaunchAxes: true });
assert(sha(on) !== GOLDEN.asis, 'ON은 실제로 다른 결과');

// ── 2. 연장은 탄도탄만 ──
console.log('# 2) 연장은 **탄도탄만** — 비탄도는 한 건도 걸리지 않는다');
const BALLISTIC = ['srbm', 'mrl_large'];
const NON = ['cruise', 'fighter', 'ac_low', 'uav_small', 'heli'];
const AX = Object.keys(KJ.AXES);
// ⚠️ **함정을 여기 못박는다.** `KJ.ballisticLaunchExtension(type, axis)`는 스스로 탄도 여부를
//    검사하지 **않는다** — 대표 사거리가 축선 개념거리보다 길기만 하면 무엇에든 값을 낸다
//    (cruise는 사거리밴드 150~2000km라 중앙값 1075km로 전 축선에서 값이 나온다).
//    탄도 판정은 **엔진 안**(`iadsThreatCategory` — srbm·mrl_large, 공개 대응물 없음)에 있고
//    호출부가 지킨다. 밖에서 이 함수를 그대로 쓰면 비탄도까지 연장되어 조용히 다른 궤적이
//    된다(실제로 화면 밖에서 재계산하다 uav_small·fighter 17건이 어긋난 적이 있다).
let selfGuard = [];
NON.forEach((t) => AX.forEach((a) => {
  const e = KJ.ballisticLaunchExtension && KJ.ballisticLaunchExtension(t, a);
  if (e && e.extKm > 0) selfGuard.push(t + '/' + a);
}));
assert(selfGuard.length > 0,
  'ballisticLaunchExtension은 **자기 검사를 하지 않는다** — 비탄도에도 값을 낸다(' +
  selfGuard.length + '조합, 예: ' + selfGuard.slice(0, 2).join(', ') + '). 호출부가 탄도 판정을 지켜야 한다');
const trOn = run({ ballisticLaunchAxes: true }, { trace: true });
const extByType = {};
trOn.threatTraces.forEach((t) => {
  extByType[t.type] = extByType[t.type] || { n: 0, ext: 0 };
  extByType[t.type].n++;
  if (t.launchExtKm > 0) extByType[t.type].ext++;
});
Object.keys(extByType).forEach((t) => {
  const v = extByType[t], bal = BALLISTIC.indexOf(t) >= 0;
  assert(bal ? v.ext > 0 : v.ext === 0,
    `${t}: 연장 걸린 항적 ${v.ext}/${v.n} (${bal ? '탄도 — 걸려야 한다' : '비탄도 — 걸리면 안 된다'})`);
});

// ── 3. 연장량이 ADR 표와 같다 ──
console.log('# 3) 연장량은 축선×유형 상수 — ADR-091 표와 일치');
const TABLE = { 'srbm/central': 405, 'srbm/east': 345, 'srbm/southcentral': 239, 'srbm/southeast': 145,
  'mrl_large/central': 235, 'mrl_large/east': 175, 'mrl_large/southcentral': 69 };
Object.keys(TABLE).forEach((k) => {
  const [t, a] = k.split('/');
  const e = KJ.ballisticLaunchExtension(t, a);
  assert(e && Math.abs(e.extKm - TABLE[k]) <= 1, `${k} 연장 ${e ? e.extKm.toFixed(0) : '없음'}km (ADR ${TABLE[k]}km)`);
});
assert(!KJ.ballisticLaunchExtension('mrl_large', 'southeast'),
  'mrl_large/southeast 연장 없음 (대표 사거리 ≤ 축선거리)');

// ── 4. 탐지 선착이 뒤집힌다 — 이 ADR의 존재 이유 ──
console.log('# 4) 탐지 선착이 기하에서 나온다 (포대 MFR → 그린파인)');
function firstDetector(res, dep, mode, type) {
  const cat = KJ.resolveModelCatalog({ deploymentId: dep, mode: mode, modelFidelity: 'iads-c2',
    features: Object.assign({}, BASE) });
  const nm = {};
  KJ.nodesInMode(mode, cat).forEach((n) => { nm[n.id] = n.typeId; });
  const c = {};
  res.threatTraces.filter((t) => t.type === type).forEach((t) => {
    const d = (t.stages || []).filter((s) => /^SENSOR_DETECTED:/.test(s.name)).sort((a, b) => a.t - b.t)[0];
    if (!d) return;
    const ty = nm[d.name.split(':')[1]] || '?';
    c[ty] = (c[ty] || 0) + 1;
  });
  return c;
}
[['HANBANDO_LEGACY_NORMAL', 'MSAM_MFR'], ['HANBANDO_FULL_NORMAL', 'LSAM_MFR']].forEach(([dep, mfr]) => {
  const off = firstDetector(run({}, { trace: true, dep, seed: 29 }), dep, 'asis', 'srbm');
  const onD = firstDetector(run({ ballisticLaunchAxes: true }, { trace: true, dep, seed: 29 }), dep, 'asis', 'srbm');
  const nOff = Object.values(off).reduce((a, b) => a + b, 0);
  const nOn = Object.values(onD).reduce((a, b) => a + b, 0);
  const gpOn = (onD.GREEN_PINE_B || 0) + (onD.GREEN_PINE_C || 0);
  assert(nOff > 5 && (off[mfr] || 0) === nOff,
    `${dep.replace('HANBANDO_', '')} OFF: srbm 최초 탐지가 전부 포대 전속 ${mfr} (${off[mfr] || 0}/${nOff})`);
  assert(gpOn > nOn * 0.8,
    `${dep.replace('HANBANDO_', '')} ON: 그린파인이 최초 ${gpOn}/${nOn} (80% 초과) — 조기경보가 제 일을 한다`);
});

// ── 5. 결정론 ──
console.log('# 5) 새 난수 소비 없음 — 같은 seed는 같은 결과');
assert(sha(run({ ballisticLaunchAxes: true })) === sha(run({ ballisticLaunchAxes: true })), 'ON 재실행 동일');
assert(sha(run({ ballisticLaunchAxes: true }, { mode: 'tobe' })) !== sha(run({ ballisticLaunchAxes: true })),
  'As-Is·To-Be는 여전히 다르다(비교가 성립한다)');

// ── 6. 관측 배선 — 화면이 궤적을 되짚는 재료 ──
console.log('# 6) 관측 배선 (trace 필드 + 공개 helper)');
assert(typeof KJ.iadsThreatPosition === 'function', 'KJ.iadsThreatPosition 공개');
assert(trOn.threatTraces.every((t) => t.dwellSec > 0), 'trace 전건에 dwellSec');
assert(trOn.threatTraces.every((t) => typeof t.launchExtKm === 'number'), 'trace 전건에 launchExtKm');
// 화면이 쓰는 방식 그대로 되짚어, 엔진이 기록한 착탄점과 만나는지 본다.
const sample = trOn.threatTraces.filter((t) => t.launchExtKm > 0).slice(0, 20);
assert(sample.length > 0, `연장이 걸린 표본 ${sample.length}건`);
const bad = sample.filter((t) => {
  const shim = { axis: t.axis, target: t.target, type: t.type, spawnT: t.spawnT,
    dwellSec: t.dwellSec, _launchExtKm: t.launchExtKm };
  const end = KJ.iadsThreatPosition(shim, t.spawnT + t.dwellSec);
  const tgt = t.target || KJ.AXES[t.axis].target;
  return Math.abs(end.lat - tgt[0]) > 1e-6 || Math.abs(end.lon - tgt[1]) > 1e-6;
});
assert(bad.length === 0, '되짚은 궤적의 종점 = 기록된 착탄점 (연장이 표적을 흔들지 않는다)');
// 발사점은 진입점보다 **북쪽**(표적 반대 방향)이어야 한다.
const south = sample.filter((t) => {
  const shim = { axis: t.axis, target: t.target, type: t.type, spawnT: t.spawnT,
    dwellSec: t.dwellSec, _launchExtKm: t.launchExtKm };
  const s0 = KJ.iadsThreatPosition(shim, t.spawnT);
  return s0.lat <= KJ.AXES[t.axis].entry[0];
});
assert(south.length === 0, '발사점이 축선 진입점보다 북쪽 (연장은 표적 반대 방향)');

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
