/**
 * ADR-094 — ICC 중계 인가(iccRelayAuthorization) 회귀.
 *
 * 검증 관점:
 *  1) OFF bit-exact — 플래그 미지정 결과가 골든 지문(변경 전 소스)과 같다.
 *  2) To-Be 동역학 불변 — IAOC→ECS 직결이 최단이라 경로에 ICC가 없다. 중계 0건이고,
 *     ON에서만 노출되는 kind 키를 제외하면 결과가 bit-exact다.
 *  3) ICC가 실제로 일한다 — directive_relay 작업이 ICC 노드에만 도착하고, 마크 순서가
 *     사수선정 < 중계접수 < (인가|재배정|반송) < 교전명령접수 이다.
 *  4) 전송 분할 — 상급→ICC 간선은 인가 **전**, ICC→ECS 간선은 인가 **후**에 기록된다.
 *  5) 세 갈래 — 인가·반송이 실제로 발생하고, 재배정은 같은 ICC 권역의 포대로만 간다.
 *  6) 손잡이 — iccRelaySec=0이면 접수 시각 == 인가 시각(시간 효과와 로직 효과 분리 가능).
 *  7) wire shape — OFF 노드에 directive_relay 키 없음, ON에만 있음.
 *  8) 배선 — 프로토타입 파라미터·칩·JOB_LABEL, 엔진 기본 OFF.
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
    seed: opts.seed || 12345, endTimeSec: opts.dur || 600,
    deploymentId: opts.dep || 'HANBANDO_LEGACY_NORMAL',
    trace: !!opts.trace, traceCap: 5000, flowTrace: !!opts.flow, flowTraceCap: 200000,
    features: Object.assign({ highResolutionDeployment: true }, f)
  });
}
const isIcc = (id) => /^C2_ICC_/.test(id);
const relayArrivals = (r) => r.nodes.filter((n) => isIcc(n.id))
  .reduce((s, n) => s + (n.arrivalsByKind.directive_relay || 0), 0);

// ── 1. OFF bit-exact ──
console.log('# 1) OFF bit-exact (골든 지문)');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
const offA = run({}), offT = run({}, { mode: 'tobe' });
assert(sha(offA) === GOLDEN.asis, 'SC3 As-Is OFF = 골든 (' + sha(offA).slice(0, 8) + '…)');
assert(sha(offT) === GOLDEN.tobe, 'SC3 To-Be OFF = 골든 (' + sha(offT).slice(0, 8) + '…)');
assert(sha(run({ iccRelayAuthorization: false })) === GOLDEN.asis, '명시 false = 미지정');
assert(!('iccRelayAuthorization' in offA.global.features), 'global.features wire shape 불변');

// ── 2. To-Be 동역학 불변 ──
console.log('# 2) To-Be — 경로에 ICC가 없어 동역학 불변');
const onT = run({ iccRelayAuthorization: true }, { mode: 'tobe' });
assert(relayArrivals(onT) === 0, 'To-Be 중계 도착 0건 (IAOC→ECS 직결이 최단)');
assert(onT.global.killed === offT.global.killed && onT.global.leaked === offT.global.leaked &&
  onT.global.shotsFired === offT.global.shotsFired,
  `To-Be 임무 지표 동일 (격추 ${offT.global.killed} · 누수 ${offT.global.leaked} · 발사 ${offT.global.shotsFired})`);
function stripKind(r) {
  const c = JSON.parse(JSON.stringify(r));
  c.nodes.forEach((n) => ['rhoByKind', 'arrivalsByKind', 'dropsByKind', 'WqByKind']
    .forEach((k) => { if (n[k]) delete n[k].directive_relay; }));
  return c;
}
assert(sha(stripKind(onT)) === sha(stripKind(offT)), 'To-Be — kind 키를 빼면 결과 bit-exact');

// ── 3. ICC가 실제로 일한다 ──
console.log('# 3) As-Is — directive_relay 작업이 ICC에 도착');
const onA = run({ iccRelayAuthorization: true }, { trace: true, flow: true });
const relayN = relayArrivals(onA);
assert(relayN > 0, `ICC 중계 도착 ${relayN}건 (OFF는 ICC 도착 ` +
  offA.nodes.filter((n) => isIcc(n.id)).reduce((s, n) => s + n.arrivals, 0) + '건)');
const naRelay = onA.flowEvents.filter((e) => e.k === 'na' && e.jk === 'directive_relay');
assert(naRelay.length === relayN && naRelay.every((e) => isIcc(e.at)),
  'directive_relay 작업은 전부 ICC 노드에 도착');
assert(offA.nodes.filter((n) => isIcc(n.id)).every((n) => n.arrivals === 0),
  'OFF에서는 ICC 도착 0건 (종전 통과점)');

let ordered = 0, orderBad = 0;
for (const tr of onA.threatTraces) {
  const ms = tr.stages || [];
  const sel = ms.find((m) => m.name.startsWith('사수선정·표적할당:'));
  const recv = ms.find((m) => m.name.startsWith('교전명령중계접수:'));
  if (!sel || !recv) continue;
  const out = ms.find((m) => /^교전명령(인가|재배정|반송):/.test(m.name) && m.t >= recv.t);
  if (!out) continue;
  ordered++;
  const ecs = ms.find((m) => m.name.startsWith('교전명령접수:') && m.t >= out.t);
  if (!(sel.t <= recv.t && recv.t <= out.t && (!ecs || out.t <= ecs.t))) orderBad++;
}
assert(ordered > 0 && orderBad === 0,
  `마크 순서 사수선정 ≤ 중계접수 ≤ 인가/재배정/반송 ≤ 교전명령접수: ${ordered}건, 위반 ${orderBad}`);

// ── 4. 전송 분할 ──
console.log('# 4) 전송 분할 — 하행 간선은 인가 이후에 기록된다');
// ⚠️ ICC는 보고(ECS→ICC→상급)도 나르므로 「ICC 발신 간선」 전체를 보면 안 된다 —
//    같은 항적의 **하행(ICC→ECS) 간선**만 본다.
const svc = new Map();   // fid → {at, t0, done, th}
for (const e of onA.flowEvents) {
  if (e.k === 'na' && e.jk === 'directive_relay') svc.set(e.id, { at: e.at, t0: e.t, th: e.th });
  else if (e.k === 'nd' && svc.has(e.id)) svc.get(e.id).done = e.t;
}
const doneJobs = [...svc.values()].filter((s) => s.done != null);
assert(doneJobs.length > 0, `인가 완료 ${doneJobs.length}건`);
let downBefore = 0, downAfter = 0;
for (const s of doneJobs) {
  const outs = onA.flowEvents.filter((e) => e.k === 'link' && e.from === s.at && /^ECS_/.test(e.to) &&
    e.th === s.th && e.t0 >= s.t0 - 1e-9 && e.t0 <= s.done + 120);
  for (const l of outs) { if (l.t0 + 1e-9 < s.done) downBefore++; else downAfter++; }
}
assert(downAfter > 0 && downBefore === 0,
  `같은 항적의 ICC→ECS 하행 간선 ${downAfter}건이 전부 인가 완료 이후 (이전 ${downBefore}건)`);

// ── 5. 세 갈래 ──
console.log('# 5) 인가 · 재배정 · 반송');
const cnt = (r, p) => r.threatTraces.flatMap((t) => t.stages || []).filter((m) => m.name.startsWith(p)).length;
const nOk = cnt(onA, '교전명령인가'), nRe = cnt(onA, '교전명령재배정'), nBack = cnt(onA, '교전명령반송');
assert(nOk > 0, `인가 ${nOk}건`);
assert(nBack > 0, `반송 ${nBack}건 — ECS 큐에 닿기 전에 상급으로 되돌린다`);
// 중계 작업은 세 갈래 중 하나로 끝나거나, 처리 중 항적이 종결(격추·누수)되어 조용히 사라진다.
// 후자는 엔진의 `if (!threat.alive || plan.released ...) return` 가드다 — 그 몫을 실제로 확인한다.
const relayDrops = onA.nodes.filter((n) => isIcc(n.id)).reduce((s, n) => s + (n.dropsByKind.directive_relay || 0), 0);
let resolvedDuring = 0, unexplained = 0;
for (const s of doneJobs) {
  const tr = onA.threatTraces.find((x) => x.id === s.th);
  const ms = (tr && tr.stages) || [];
  const out = ms.find((m) => /^교전명령(인가|재배정|반송):/.test(m.name) && m.t >= s.done - 1e-9);
  if (out) continue;
  if (tr && tr.outcome != null && tr.exitT != null && tr.exitT <= s.done + 1e-9) resolvedDuring++;
  else unexplained++;
}
assert(nOk + nRe + nBack + relayDrops + resolvedDuring + unexplained === relayN && unexplained === 0,
  `중계 ${relayN}건 = 인가 ${nOk} + 재배정 ${nRe} + 반송 ${nBack} + 큐드롭 ${relayDrops} + 처리중 항적종결 ${resolvedDuring} (설명 안 되는 것 ${unexplained}건)`);
const cat = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', { highResolutionDeployment: true });
const iccOf = {}; cat.nodes.forEach((n) => { if (n.category === 'shooter') iccOf[n.id] = n.iccC2Id || null; });
let reBad = 0;
for (const tr of onA.threatTraces) {
  for (const m of (tr.stages || [])) {
    const g = /^교전명령재배정:(C2_ICC_[\w]+)→(BATTERY_[\w]+)/.exec(m.name);
    if (g && iccOf[g[2]] !== g[1]) reBad++;
  }
}
assert(reBad === 0, `재배정 대상은 전부 같은 ICC 권역 (위반 ${reBad}건, 재배정 ${nRe}건)`);

// ── 6. 손잡이 ──
console.log('# 6) iccRelaySec 손잡이');
const on0 = run({ iccRelayAuthorization: true, iccRelaySec: 0 }, { trace: true });
let zero = 0, nonZero = 0;
for (const tr of on0.threatTraces) {
  const ms = tr.stages || [];
  for (const recv of ms.filter((m) => m.name.startsWith('교전명령중계접수:'))) {
    const out = ms.find((m) => /^교전명령(인가|재배정|반송):/.test(m.name) && m.t >= recv.t);
    if (!out) continue;
    if (Math.abs(out.t - recv.t) < 1e-9) zero++; else nonZero++;
  }
}
assert(zero > 0 && nonZero === 0, `iccRelaySec=0: 접수 시각 == 인가 시각 ${zero}건 (위반 ${nonZero})`);
assert(cnt(on0, '교전명령반송') < nBack,
  `인가 시간 0초면 반송이 준다 ${nBack} → ${cnt(on0, '교전명령반송')} (반송은 대부분 인가 지연 동안 창이 닫혀 생긴다)`);

// ── 7. wire shape ──
console.log('# 7) wire shape');
assert(offA.nodes.every((n) => !('directive_relay' in n.arrivalsByKind)), 'OFF에 directive_relay 키 없음');
assert(onA.nodes.every((n) => 'directive_relay' in n.arrivalsByKind), 'ON에만 directive_relay 키 있음');

// ── 8. 배선 ──
console.log('# 8) 배선');
const proto = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
assert(/iccRelayAuthorization:\s*P\.icc/.test(proto), '프로토타입 features()에 iccRelayAuthorization: P.icc');
assert(/\{ k: 'icc',\s*d: 1,/.test(proto), "프로토타입 ?icc= (이 화면만 기본 1)");
assert(/\{ k: 'iccsec',\s*d: -1,/.test(proto), "프로토타입 ?iccsec= 민감도 손잡이 (기본 -1 = 미지정)");
assert(proto.includes("out.push('ICC 중계 인가 ON'"), '켜진 동안 상태줄 칩');
assert(/directive_relay:\s*'ICC 중계 인가'/.test(proto), 'JOB_LABEL directive_relay');
const eng = fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8');
assert(/this\.iccRelayAuthorization = ff\('iccRelayAuthorization', false\)/.test(eng), '엔진 기본 OFF');
assert(/if \(self\.iccRelayAuthorization\) kindKeys = kindKeys\.concat\(\['directive_relay'\]\)/.test(eng),
  'kindKeys는 ON에서만 확장');

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
