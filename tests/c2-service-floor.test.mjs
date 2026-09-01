/**
 * ADR-092 — C2 처리 시간 바닥(c2ServiceFloor) 회귀.
 *
 * 검증 관점:
 *  1) OFF bit-exact — 플래그 미지정 결과가 변경 **전** 소스의 지문(골든 SHA-256)과 같다.
 *  2) 카탈로그 성분 — 모든 C2 노드가 serviceParts를 갖고, 중점+평균 = serviceTimeSec(항등).
 *  3) 문제의 실재 — OFF에서는 체계 처리 바닥 아래의 서비스 표본이 실제로 존재한다(0.5초 미만 포함).
 *  4) ON 바닥 — 모든 C2 서비스 표본 ≥ systemSec[0]. 사수 노드는 성분이 없어 종전 분포 그대로.
 *  5) ON 평균 항등 — 노드별 표본 평균이 카탈로그 평균에서 통계적으로 벗어나지 않는다.
 *  6) mult.service — 배율이 바닥에도 같은 비율로 걸린다.
 *  7) 배선 — 프로토타입 파라미터·칩·features, 결과 wire shape(global.features) 불변.
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
    seed: 12345, endTimeSec: 600, deploymentId: 'HANBANDO_LEGACY_NORMAL',
    flowTrace: !!opts.flow, flowTraceCap: 200000, mult: opts.mult,
    features: Object.assign({ highResolutionDeployment: true }, f)
  });
}
const DEP = 'HANBANDO_LEGACY_NORMAL';

// ── 1. OFF bit-exact — 변경 전 소스(2026-09-01, b82f090 기준 js/)에서 뽑은 지문 ──
console.log('# 1) OFF bit-exact (골든 지문)');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
const offA = run({}), offT = run({}, { mode: 'tobe' });
assert(sha(offA) === GOLDEN.asis, 'SC3 As-Is OFF = 변경 전 지문 (' + sha(offA).slice(0, 8) + '…)');
assert(sha(offT) === GOLDEN.tobe, 'SC3 To-Be OFF = 변경 전 지문 (' + sha(offT).slice(0, 8) + '…)');
assert(sha(run({ c2ServiceFloor: false })) === GOLDEN.asis, '명시 false = 미지정');
assert(!('c2ServiceFloor' in offA.global.features), 'global.features wire shape 불변 (키 추가 없음)');

// ── 2. 카탈로그 성분 ──
console.log('# 2) 카탈로그 — serviceParts 와 serviceTimeSec 항등');
const cat = KJ.buildDeploymentCatalog(DEP, {});
const c2s = cat.nodes.filter((n) => n.category === 'c2');
assert(c2s.length > 0 && c2s.every((n) => n.queue.serviceParts &&
  Array.isArray(n.queue.serviceParts.systemSec) && n.queue.serviceParts.systemSec.length === 2 &&
  typeof n.queue.serviceParts.operatorSec === 'number'), '모든 C2 노드(' + c2s.length + ')에 serviceParts');
assert(c2s.every((n) => {
  const p = n.queue.serviceParts;
  return Math.abs((p.systemSec[0] + p.systemSec[1]) / 2 + p.operatorSec - n.queue.serviceTimeSec.asis) < 1e-9;
}), '(lo+hi)/2 + op === serviceTimeSec.asis (전 노드)');
assert(c2s.every((n) => n.queue.serviceParts.systemSec[0] > 0), '체계 구간 하한 > 0 (바닥이 실제로 있음)');
assert(cat.nodes.filter((n) => n.category === 'shooter').every((n) => !n.queue || !n.queue.serviceParts),
  '사수 노드에는 serviceParts 없음');
const floorOf = {}; c2s.forEach((n) => { floorOf[n.id] = n.queue.serviceParts.systemSec[0]; });
const meanOf = {}; c2s.forEach((n) => { meanOf[n.id] = n.queue.serviceTimeSec.asis; });

/** flowEvents의 ns(서비스 개시)/nd(완료) 짝에서 노드별 서비스 시간 표본을 모은다. */
function serviceSamples(r) {
  const start = new Map(), out = {};
  for (const e of r.flowEvents) {
    if (e.k === 'ns') start.set(e.id + '@' + e.at, e.t);
    else if (e.k === 'nd') {
      const s = start.get(e.id + '@' + e.at);
      if (s != null) { (out[e.at] = out[e.at] || []).push(e.t - s); start.delete(e.id + '@' + e.at); }
    }
  }
  return out;
}
const stat = (a) => ({ n: a.length, min: Math.min(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });

// ── 3. 문제의 실재 (OFF) ──
console.log('# 3) OFF — 바닥 아래 표본이 실제로 있다');
const offFlow = run({}, { flow: true });
assert(!offFlow.flowTruncated, 'flowTrace 절삭 없음 (표본 전수)');
const sOff = serviceSamples(offFlow);
let subFloor = 0, subHalf = 0, nC2 = 0;
for (const id of Object.keys(sOff)) {
  if (!(id in floorOf)) continue;
  for (const v of sOff[id]) { nC2++; if (v < floorOf[id]) subFloor++; if (v < 0.5) subHalf++; }
}
assert(nC2 > 200, 'C2 서비스 표본 ' + nC2 + '건');
assert(subFloor > 0, 'OFF: 체계 바닥 아래 표본 ' + subFloor + '건 (' + (100 * subFloor / nC2).toFixed(1) + '%)');
assert(subHalf > 0, 'OFF: 0.5초 미만(화면 「0초」) 표본 ' + subHalf + '건');

// ── 4. ON 바닥 ──
console.log('# 4) ON — 모든 C2 서비스 ≥ 체계 구간 하한');
const onFlow = run({ c2ServiceFloor: true }, { flow: true });
assert(sha(onFlow) !== sha(offFlow), 'ON은 실제로 다른 결과');
const sOn = serviceSamples(onFlow);
let onC2 = 0, viol = 0;
for (const id of Object.keys(sOn)) {
  if (!(id in floorOf)) continue;
  for (const v of sOn[id]) { onC2++; if (v < floorOf[id] - 1e-9) viol++; }
}
assert(onC2 > 200 && viol === 0, 'ON: C2 표본 ' + onC2 + '건 중 바닥 위반 ' + viol + '건');
// 사수 노드는 성분이 없으므로(2 참조) 엔진의 else 분기(종전 지수분포)를 탄다 — 소스에서 그 가드를 고정한다.
// (iads-c2 충실도에서 발사대는 교전 모델이 맡아 ns/nd 체류 표본이 없다 — 표본으로는 확인 불가.)
const engSrc = fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8');
assert(/n\.category === 'c2' && n\.queue\.serviceParts/.test(engSrc) && /if \(this\.c2ServiceFloor && ns\.parts\)/.test(engSrc),
  '엔진 가드: parts는 C2 성분에만 · 바닥 분기는 c2ServiceFloor && parts 에서만 — 사수는 종전 지수분포');

// ── 5. ON 평균 항등 (통계) ──
console.log('# 5) ON — 노드별 표본 평균 ≈ 카탈로그 평균');
// 지수+균등 합의 분산 ≈ op² + (hi-lo)²/12. 표본 평균의 표준오차 σ/√n 의 4배 안이면 통과.
for (const id of Object.keys(sOn)) {
  if (!(id in meanOf) || sOn[id].length < 30) continue;
  const st = stat(sOn[id]);
  const n = c2s.find((x) => x.id === id), p = n.queue.serviceParts;
  const sd = Math.sqrt(p.operatorSec * p.operatorSec + Math.pow(p.systemSec[1] - p.systemSec[0], 2) / 12);
  const tol = 4 * sd / Math.sqrt(st.n);
  assert(Math.abs(st.mean - meanOf[id]) <= tol,
    `${n.name}(${id}): n=${st.n} 평균 ${st.mean.toFixed(2)} vs 카탈로그 ${meanOf[id]} (허용 ±${tol.toFixed(2)}) · 최소 ${st.min.toFixed(2)} ≥ 바닥 ${floorOf[id]}`);
}

// ── 6. mult.service — 바닥도 같은 배율 ──
console.log('# 6) mult.service 배율이 바닥에 걸림');
const mulFlow = run({ c2ServiceFloor: true }, { flow: true, mult: { service: 2 } });
const sMul = serviceSamples(mulFlow);
let mulViol = 0, mulN = 0;
for (const id of Object.keys(sMul)) {
  if (!(id in floorOf)) continue;
  for (const v of sMul[id]) { mulN++; if (v < 2 * floorOf[id] - 1e-9) mulViol++; }
}
assert(mulN > 0 && mulViol === 0, 'mult.service=2: 표본 ' + mulN + '건 전부 ≥ 2×바닥');
assert(mulFlow.nodes.filter((n) => n.category === 'c2').every((n) => Math.abs(n.meanSec - 2 * meanOf[n.id]) < 1e-9),
  '결과 meanSec = 2×카탈로그 평균 (평균 스케일 보존)');

// ── 7. 배선 ──
console.log('# 7) 배선');
const proto = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
assert(/c2ServiceFloor:\s*P\.floor/.test(proto), '프로토타입 features()에 c2ServiceFloor: P.floor');
assert(/\{ k: 'floor',\s*d: 0,/.test(proto), "프로토타입 ?floor= 파라미터 (기본 0 — 엔진 기본과 같게, 사용자 결정 2026-09-01)");
assert(proto.includes("out.push('처리 바닥 ON')"), '켜진 동안 상태줄 칩 「처리 바닥 ON」');
assert(!/처리 \$\{r\.svc\.toFixed\(0\)\}초/.test(proto) && proto.includes("'<1초'"), 'C2 처리 로그가 1초 미만을 「0초」로 적지 않음');
const eng = fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8');
assert(/this\.c2ServiceFloor = ff\('c2ServiceFloor', false\)/.test(eng), '엔진 기본 OFF');

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
