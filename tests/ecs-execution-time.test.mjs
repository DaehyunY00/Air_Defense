/**
 * ADR-095 — ECS 실행 시간 ADSIM 정합(ecsExecutionTime) 회귀.
 *
 * 검증 관점:
 *  1) OFF bit-exact — 플래그 미지정 결과가 골든 지문과 같다.
 *  2) 실효 서비스 시간 — ON이면 ECS의 directive_reception 표본 평균이 10초 근방이다.
 *     ⚠️ 노드 카탈로그의 meanSec(3.5초)는 **바뀌지 않는다** — kind별 평균이라 노드 평균은 그대로다.
 *  3) 적용 범위 — directive_reception만 바뀌고 다른 kind(iads_track·approval)는 노드값 그대로다.
 *  4) 양 모드 공통 — As-Is·To-Be 둘 다 실제로 느려진다(한쪽만 걸리는 편향이 아님).
 *  5) 손잡이 — ecsExecutionSec가 실효 서비스 시간을 그대로 정한다.
 *  6) ADR-092 합성 — 바닥과 함께 켜면 체계 성분도 같은 비율로 스케일되어 최소값이 올라간다.
 *  7) 배선 — 프로토타입 파라미터(기본 0 — 예외 아님)·칩, 엔진 기본 OFF.
 */
import path from 'node:path';
import fs from 'node:fs';
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
function run(f, opts) {
  opts = opts || {};
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode: opts.mode || 'asis', intensity: 1,
    seed: opts.seed || 12345, endTimeSec: 600, deploymentId: 'HANBANDO_LEGACY_NORMAL',
    flowTrace: !!opts.flow, flowTraceCap: 200000,
    features: Object.assign({ highResolutionDeployment: true }, f)
  });
}
/** flowEvents의 ns/nd 짝에서 kind별 실효 서비스 시간 표본을 모은다. */
function samples(r, kind) {
  const st = new Map(), out = [];
  for (const e of r.flowEvents) {
    if (e.k === 'ns') st.set(e.id, { t: e.t, at: e.at });
    else if (e.k === 'na' && e.jk === kind) st.set('k' + e.id, true);
    else if (e.k === 'nd' && st.has(e.id) && st.has('k' + e.id)) { out.push(e.t - st.get(e.id).t); st.delete(e.id); }
  }
  return out;
}
const stat = (a) => ({ n: a.length, min: Math.min(...a), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });

// ── 1. OFF bit-exact ──
console.log('# 1) OFF bit-exact (골든 지문)');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
const offA = run({}), offT = run({}, { mode: 'tobe' });
assert(sha(offA) === GOLDEN.asis, 'SC3 As-Is OFF = 골든 (' + sha(offA).slice(0, 8) + '…)');
assert(sha(offT) === GOLDEN.tobe, 'SC3 To-Be OFF = 골든 (' + sha(offT).slice(0, 8) + '…)');
assert(sha(run({ ecsExecutionTime: false })) === GOLDEN.asis, '명시 false = 미지정');
assert(!('ecsExecutionTime' in offA.global.features), 'global.features wire shape 불변');

// ── 2. 실효 서비스 시간 ──
console.log('# 2) 실효 서비스 시간 — ON이면 10초 근방');
const offF = run({}, { flow: true });
const onF = run({ ecsExecutionTime: true }, { flow: true });
const sOff = stat(samples(offF, 'directive_reception'));
const sOn = stat(samples(onF, 'directive_reception'));
assert(sOff.n > 20 && Math.abs(sOff.mean - 3.5) < 1.6,
  `OFF: ECS 실효 서비스 n=${sOff.n} 평균 ${sOff.mean.toFixed(2)}초 (카탈로그 3.5초)`);
assert(sOn.n > 20 && Math.abs(sOn.mean - 10) < 3.5,
  `ON : ECS 실효 서비스 n=${sOn.n} 평균 ${sOn.mean.toFixed(2)}초 (ADSIM localExecution 10초)`);
assert(sOn.mean > sOff.mean * 1.8, `ON이 OFF보다 확실히 길다 (${sOff.mean.toFixed(2)} → ${sOn.mean.toFixed(2)}초)`);
assert(onF.nodes.filter((n) => n.id.startsWith('ECS_')).every((n) => n.meanSec === 3.5),
  '노드 meanSec는 카탈로그 3.5초 그대로 (kind별 평균이라 노드 평균은 불변)');

// ── 3. 적용 범위 ──
console.log('# 3) directive_reception 에만 적용');
const sTrackOff = stat(samples(offF, 'iads_track')), sTrackOn = stat(samples(onF, 'iads_track'));
assert(Math.abs(sTrackOn.mean - sTrackOff.mean) / sTrackOff.mean < 0.35,
  `iads_track 서비스는 그대로 (${sTrackOff.mean.toFixed(1)} → ${sTrackOn.mean.toFixed(1)}초 — 표본 차이 수준)`);
const eng = fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8');
assert(/\(m = m \|\| \{\}\)\.directive_reception = sim\.ecsExecutionSec \* sim\.mult\.service/.test(eng),
  '엔진 가드: kind 표에 directive_reception만 등재');

// ── 4. 양 모드 공통 ──
console.log('# 4) As-Is · To-Be 둘 다 걸린다');
const onT = run({ ecsExecutionTime: true }, { mode: 'tobe', flow: true });
const sOnT = stat(samples(onT, 'directive_reception'));
const sOffT = stat(samples(run({}, { mode: 'tobe', flow: true }), 'directive_reception'));
assert(sOnT.n > 10 && sOnT.mean > sOffT.mean * 1.8,
  `To-Be도 적용 (${sOffT.mean.toFixed(2)} → ${sOnT.mean.toFixed(2)}초)`);
assert(sha(onT) !== GOLDEN.tobe && sha(run({ ecsExecutionTime: true })) !== GOLDEN.asis,
  '두 모드 모두 결과가 실제로 이동한다 (한쪽만 걸리는 편향 아님)');

// ── 5. 손잡이 ──
console.log('# 5) ecsExecutionSec 손잡이');
const s20 = stat(samples(run({ ecsExecutionTime: true, ecsExecutionSec: 20 }, { flow: true }), 'directive_reception'));
assert(Math.abs(s20.mean - 20) < 6, `ecsExecutionSec=20 → 실효 평균 ${s20.mean.toFixed(2)}초`);
assert(s20.mean > sOn.mean * 1.4, `10초 대비 확실히 길다 (${sOn.mean.toFixed(2)} → ${s20.mean.toFixed(2)}초)`);

// ── 6. ADR-092 합성 ──
console.log('# 6) ADR-092(바닥)와 합성 — 성분도 같은 비율로 스케일');
const sFloor = stat(samples(run({ ecsExecutionTime: true, c2ServiceFloor: true }, { flow: true }), 'directive_reception'));
// ECS 체계 구간 1~2초 × (10/3.5) ≈ 2.86~5.71초 → 최소값이 2.8초 위로 올라간다
assert(sFloor.min > 2.5, `바닥 합성: 최소 ${sFloor.min.toFixed(2)}초 (체계 1~2초 × 10/3.5 ≈ 2.9~5.7)`);
const sFloorOnly = stat(samples(run({ c2ServiceFloor: true }, { flow: true }), 'directive_reception'));
assert(sFloorOnly.min > 0.9 && sFloorOnly.min < 2.5,
  `바닥만: 최소 ${sFloorOnly.min.toFixed(2)}초 (체계 1~2초 그대로)`);

// ── 7. 배선 ──
console.log('# 7) 배선');
const proto = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
assert(/ecsExecutionTime:\s*P\.ecs/.test(proto), '프로토타입 features()에 ecsExecutionTime: P.ecs');
assert(/\{ k: 'ecs',\s*d: 0,/.test(proto), "프로토타입 ?ecs= (기본 0 — pipe·icc와 달리 예외가 아니다)");
assert(/\{ k: 'ecssec',\s*d: -1,/.test(proto), "프로토타입 ?ecssec= 민감도 손잡이");
assert(proto.includes("out.push('ECS 실행 '"), '켜진 동안 상태줄 칩');
assert(/this\.ecsExecutionTime = ff\('ecsExecutionTime', false\)/.test(eng), '엔진 기본 OFF');

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
