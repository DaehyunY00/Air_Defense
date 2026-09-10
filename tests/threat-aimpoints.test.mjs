/**
 * ADR-097 표적 카탈로그 — 가드.
 *
 * 지키는 것:
 *  1) OFF bit-exact + **난수 소비 불변** — 배정이 결정론이라 CRN 쌍대가 유지된다
 *  2) 조준점 좌표가 codex 세트와 같다(대조표를 여기에 박아 둔다)
 *  3) **탄도탄만** 받는다 — 그리고 그 목록이 엔진 iadsThreatCategory와 일치한다
 *  4) 사거리 게이트가 걸린다(무인기가 부산을 치지 않는다)
 *  5) 결정론 — 같은 (유형, 축선, 순번)은 같은 조준점
 *  6) 산포 중심이 조준점으로 옮겨간다(ADR-063은 그 위에 그대로 얹힌다)
 *  7) 표적이 실제로 흩어진다(착탄 격자 수 증가)
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
function hav(a, b) {
  var R = 6371, r = Math.PI / 180;
  var dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  var x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const BASE = { highResolutionDeployment: true };
function run(extra, opts) {
  opts = opts || {};
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode: opts.mode || 'asis', intensity: 1,
    seed: opts.seed || 12345, endTimeSec: opts.dur || 600,
    deploymentId: opts.dep || 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    trace: !!opts.trace, traceCap: 5000,
    features: Object.assign({}, BASE, extra || {})
  });
}

// ── 1. OFF bit-exact + 난수 소비 불변 ──
console.log('# 1) OFF는 골든 그대로 · ON은 난수를 더 쓰지 않는다');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
assert(sha(run({})) === GOLDEN.asis, 'SC3 As-Is OFF = 골든');
assert(sha(run({}, { mode: 'tobe' })) === GOLDEN.tobe, 'SC3 To-Be OFF = 골든');
assert(!('threatAimpoints' in run({}).global.features), 'OFF wire shape 불변');
const onA = run({ threatAimpoints: true });
assert(onA.global.features.threatAimpoints === true, 'ON wire shape에 키가 실린다');
assert(sha(onA) !== GOLDEN.asis, 'ON은 실제로 다른 결과');
// 난수 소비가 같아야 CRN 쌍대가 산다: 위협 **수·시각·유형·축선**이 그대로여야 한다.
const off = run({}, { trace: true }), on = run({ threatAimpoints: true }, { trace: true });
assert(off.threatTraces.length === on.threatTraces.length,
  `위협 수 불변 ${off.threatTraces.length} = ${on.threatTraces.length}`);
const same = off.threatTraces.every((t, i) =>
  t.id === on.threatTraces[i].id && t.type === on.threatTraces[i].type &&
  t.axis === on.threatTraces[i].axis && Math.abs(t.spawnT - on.threatTraces[i].spawnT) < 1e-9);
assert(same, '위협열(id·유형·축선·생성시각)이 전건 동일 — 난수 스트림이 흔들리지 않았다');

// ── 2. 조준점 좌표가 codex 세트와 같다 ──
console.log('# 2) 조준점 10점 = IADS_codex HANBANDO_FULL_16T_SRBM_AIMPOINTS');
const CODEX = {                       // [위도, 경도] — codex src/config/scenarios.js 대조본
  capital_area: [37.55, 126.98], allied_base_area: [36.95, 127.05],
  central_airfield: [36.85, 127.45], southeast_airfield: [35.90, 128.60],
  southeast_port: [35.15, 129.05], southwest_airfield: [35.15, 126.80],
  west_coast_port: [35.95, 126.65], east_coast_port: [36.05, 129.35],
  southern_logistics: [35.25, 127.85], southern_command: [35.55, 126.95]
};
assert(KJ.TARGET_AIMPOINTS.length === 10, `조준점 ${KJ.TARGET_AIMPOINTS.length}점`);
const wrong = KJ.TARGET_AIMPOINTS.filter((p) => {
  const c = CODEX[p.id];
  return !c || Math.abs(p.pos[0] - c[0]) > 1e-9 || Math.abs(p.pos[1] - c[1]) > 1e-9;
});
assert(wrong.length === 0, '전 조준점 좌표 일치' + (wrong.length ? ' — ' + wrong.map((p) => p.id).join(', ') : ''));
const fam = {};
KJ.TARGET_AIMPOINTS.forEach((p) => { fam[p.family] = (fam[p.family] || 0) + 1; });
assert(fam['major-point'] === 4 && fam.airfield === 3 && fam.port === 3,
  `계열 구성 major-point ${fam['major-point']} · airfield ${fam.airfield} · port ${fam.port}`);

// ── 3. 탄도탄만 — 그리고 엔진 판정과 일치 ──
console.log('# 3) 조준점은 탄도탄만 받는다 (엔진 iadsThreatCategory와 같은 목록)');
assert(KJ.AIMPOINT_TYPES.slice().sort().join(',') === 'mrl_large,srbm',
  `AIMPOINT_TYPES = ${KJ.AIMPOINT_TYPES.join(', ')}`);
['cruise', 'fighter', 'ac_low', 'uav_small', 'heli'].forEach((t) => {
  const hit = Object.keys(KJ.AXES).filter((a) => KJ.selectAimpoint(t, a, 0));
  assert(hit.length === 0, `${t}: 조준점 배정 없음 (${hit.length}축선)`);
});
// 엔진과의 일치는 **런타임 결과**로 잰다 — 사본이 어긋나면 여기서 걸린다.
const onT = run({ threatAimpoints: true }, { trace: true });
const axTarget = {};
Object.keys(KJ.AXES).forEach((k) => { axTarget[k] = KJ.AXES[k].target; });
const moved = {};
onT.threatTraces.forEach((t) => {
  if (!t.target) return;
  const d = hav(t.target, axTarget[t.axis]);
  moved[t.type] = moved[t.type] || { n: 0, far: 0 };
  moved[t.type].n++;
  if (d > 60) moved[t.type].far++;      // 산포 반경 15km를 훨씬 넘으면 조준점이 옮긴 것
});
Object.keys(moved).forEach((t) => {
  const bal = KJ.AIMPOINT_TYPES.indexOf(t) >= 0, v = moved[t];
  assert(bal ? v.far > 0 : v.far === 0,
    `${t}: 축선 표적에서 60km+ 벗어난 착탄 ${v.far}/${v.n} (${bal ? '탄도 — 있어야 한다' : '비탄도 — 없어야 한다'})`);
});

// ── 4. 사거리 게이트 ──
console.log('# 4) 사거리 게이트 — 진입점→조준점 ≤ rangeBandKm.max');
let over = [];
KJ.AIMPOINT_TYPES.forEach((t) => {
  const mx = (KJ.threatType(t).rangeBandKm || {}).max || Infinity;
  Object.keys(KJ.AXES).forEach((a) => {
    for (let i = 0; i < 20; i++) {
      const p = KJ.selectAimpoint(t, a, i);
      if (p && hav(KJ.AXES[a].entry, p.pos) > mx + 1e-6) over.push(`${t}/${a}/${p.id}`);
    }
  });
});
assert(over.length === 0, '게이트 위반 없음' + (over.length ? ' — ' + over.slice(0, 3).join(', ') : ''));
// 게이트가 **실제로 무언가를 거른다**는 것도 확인한다(전부 통과면 게이트가 없는 것과 같다).
const uavMax = (KJ.threatType('uav_small').rangeBandKm || {}).max;
const uavOut = KJ.TARGET_AIMPOINTS.filter((p) => hav(KJ.AXES.seoul.entry, p.pos) > uavMax).length;
assert(uavOut > 0, `게이트가 실제로 거른다 — 무인기(max ${uavMax}km) 기준 seoul 축선에서 ${uavOut}점 제외`);

// ── 5. 결정론 ──
console.log('# 5) 결정론 — 같은 (유형, 축선, 순번)은 같은 조준점');
assert(KJ.selectAimpoint('srbm', 'central', 7).id === KJ.selectAimpoint('srbm', 'central', 7).id, '재호출 동일');
assert(sha(run({ threatAimpoints: true })) === sha(run({ threatAimpoints: true })), 'ON 재실행 동일');
const ids = [];
for (let i = 0; i < 10; i++) ids.push(KJ.selectAimpoint('srbm', 'central', i).id);
assert(new Set(ids).size === 10, `순번 0~9가 서로 다른 10점을 돈다 (${new Set(ids).size}종)`);
assert(KJ.selectAimpoint('srbm', 'central', 0).id !== KJ.selectAimpoint('mrl_large', 'central', 0).id,
  '유형 위상이 달라 같은 순번에 같은 점을 치지 않는다');

// ── 6. 산포는 그 위에 그대로 얹힌다 ──
console.log('# 6) ADR-063 산포가 조준점 중심으로 걸린다');
const c = [37.0, 127.0];
const noSpread = KJ.axisImpactPoint('central', 0.5, 0.5, 0, c);
assert(Math.abs(noSpread[0] - c[0]) < 1e-9 && Math.abs(noSpread[1] - c[1]) < 1e-9,
  '반경 0이면 조준점 그대로');
const spread = KJ.axisImpactPoint('central', 0.9, 0.3, 15, c);
assert(hav(spread, c) <= 15 + 1e-6, `산포가 조준점 반경 안 (${hav(spread, c).toFixed(1)}km ≤ 15km)`);
const noCenter = KJ.axisImpactPoint('central', 0.9, 0.3, 15);
assert(hav(noCenter, KJ.AXES.central.target) <= 15 + 1e-6,
  '중심을 안 주면 종전대로 축선 표적 기준 (하위호환)');

// ── 7. 표적이 실제로 흩어진다 ──
console.log('# 7) 착탄이 흩어진다');
function cells(res) {
  const g = {};
  res.threatTraces.forEach((t) => { if (t.target) g[t.target[0].toFixed(0) + ',' + t.target[1].toFixed(0)] = 1; });
  return Object.keys(g).length;
}
const cOff = cells(off), cOn = cells(onT);
assert(cOn > cOff, `착탄 격자 ${cOff}개 → ${cOn}개`);

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
