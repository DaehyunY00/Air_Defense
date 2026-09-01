/**
 * ADR-093 — 승인 파이프라인 현실화(approvalPipelineRealism) 회귀.
 *
 * 검증 관점:
 *  1) OFF bit-exact — 플래그 미지정 결과가 ADR-092 골든 지문(변경 전 소스)과 같다.
 *  2) To-Be — auto-preauth 유형은 미발동이지만 human-on-loop 유형(전투기 등)은 IAOC 감독승인을 타므로
 *     (a)(c)가 적용된다. 요청이 계선을 타지 않았으므로 회신도 0초(발신 시각 = 접수 시각).
 *  3) (a) 승인 요청은 요청 시점에 실행가능 사수가 하나 이상일 때만 — 엔진 계측(몽키패치)으로 전수 확인.
 *     OFF에서는 실행가능 사수 0인 요청이 실제로 있었다(문제의 실재).
 *  4) (b) 회신이 협조 계선 역방향(승인권자→C2A)으로 기록되고, 회신 지연 > 0.
 *  5) (c) C2A(AOC·JAOC) 큐에 approval_return 작업이 도착하고, 마크 순서가
 *     협조개시 < 승인완료 ≤ 승인회신발신 < 승인회신접수 ≤ 승인회신처리완료 ≤ 사수선정 이다.
 *  6) wire shape — OFF 결과 노드에 approval_return 키 없음, ON에서만 있음.
 *  7) 배선 — 프로토타입 파라미터(이 화면만 기본 1 — 사용자 결정 2026-09-01)·칩·JOB_LABEL, 엔진 기본 OFF.
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
    trace: !!opts.trace, traceCap: 5000, flowTrace: !!opts.flow, flowTraceCap: 200000,
    features: Object.assign({ highResolutionDeployment: true }, f)
  });
}
const AOCS = ['C2_ARMY_LOCAL_AD_ARMY_1C_AD', 'C2_ARMY_LOCAL_AD_ARMY_CD_AD'];
const MCRC = 'C2_MCRC_MCRC';

// ── 1. OFF bit-exact ──
console.log('# 1) OFF bit-exact (ADR-092 골든 지문 = 변경 전 소스)');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
const offA = run({}), offT = run({}, { mode: 'tobe' });
assert(sha(offA) === GOLDEN.asis, 'SC3 As-Is OFF = 골든 (' + sha(offA).slice(0, 8) + '…)');
assert(sha(offT) === GOLDEN.tobe, 'SC3 To-Be OFF = 골든 (' + sha(offT).slice(0, 8) + '…)');
assert(sha(run({ approvalPipelineRealism: false })) === GOLDEN.asis, '명시 false = 미지정');

// ── 2. To-Be — IAOC 감독승인(human-on-loop)에 적용, 회신 0초 ──
console.log('# 2) To-Be — IAOC 감독승인 유형에 (a)(c) 적용, 회신은 0초');
const IAOC_ID = offT.nodes.find((n) => (n.arrivalsByKind.approval || 0) > 0 && n.id !== MCRC).id;
const onT = run({ approvalPipelineRealism: true }, { mode: 'tobe', trace: true });
assert(sha(onT) !== GOLDEN.tobe, 'To-Be ON은 OFF와 다르다 (IAOC 감독승인 유형이 존재)');
const iaocOff = offT.nodes.find((n) => n.id === IAOC_ID), iaocOn = onT.nodes.find((n) => n.id === IAOC_ID);
assert(iaocOn.arrivalsByKind.approval <= iaocOff.arrivalsByKind.approval,
  `IAOC 승인 도착 ${iaocOff.arrivalsByKind.approval} → ${iaocOn.arrivalsByKind.approval} (실행가능 사수 없는 요청 제거)`);
const retT = AOCS.reduce((s, id) => s + (onT.nodes.find((n) => n.id === id).arrivalsByKind.approval_return || 0), 0);
assert(retT > 0, `To-Be C2A approval_return 도착 ${retT}건`);
let zeroDelay = 0, nonZero = 0;
for (const tr of onT.threatTraces) {
  const sent = (tr.stages || []).filter((m) => m.name.startsWith('승인회신발신:'));
  const recv = (tr.stages || []).filter((m) => m.name.startsWith('승인회신접수:'));
  for (let i = 0; i < Math.min(sent.length, recv.length); i++) { if (Math.abs(recv[i].t - sent[i].t) < 1e-9) zeroDelay++; else nonZero++; }
}
assert(zeroDelay > 0 && nonZero === 0, `To-Be 회신 지연 0초 (요청이 계선을 타지 않음): ${zeroDelay}건, 위반 ${nonZero}`);

// ── 3. (a) 요청 시점 실행가능성 — 계측 ──
console.log('# 3) (a) 승인 요청은 실행가능 사수가 있을 때만');
const Sim = KJ.Simulation;
const oGate = Sim.prototype._iadsApprovalGate;
let reqLog = [];
Sim.prototype._iadsApprovalGate = function (threat, commander, t) {
  const key = commander.id + '|' + commander.axis;
  const before = threat._iadsApproval && threat._iadsApproval[key];
  const g = oGate.call(this, threat, commander, t);
  const after = threat._iadsApproval[key];
  if (before === undefined && after === 'pending') {
    const feasible = commander.batteryIds.some((id) => this._iadsEvaluate(this._nodeById(id), threat, t).feasible);
    reqLog.push({ cmd: commander.id, th: threat.id, t, feasible });
  }
  return g;
};
// seed 4: 회신이 실제로 처리되는 표본(seed 12345는 6건 전부 회신 도착 전에 MCRC 자체 교전이 격추).
const SEED = 4;
reqLog = []; const offA4 = run({}, { seed: SEED }); const reqOff = reqLog.slice();
reqLog = []; const onA = run({ approvalPipelineRealism: true }, { seed: SEED, trace: true, flow: true }); const reqOn = reqLog.slice();
Sim.prototype._iadsApprovalGate = oGate;
const offInfeasible = reqOff.filter((r) => !r.feasible).length;
assert(reqOff.length > 0 && offInfeasible > 0,
  `OFF: 승인 요청 ${reqOff.length}건 중 요청 시점 실행가능 사수 0인 것 ${offInfeasible}건 (문제의 실재)`);
assert(reqOn.length > 0 && reqOn.every((r) => r.feasible),
  `ON: 승인 요청 ${reqOn.length}건 전부 요청 시점에 실행가능 사수 ≥ 1`);
assert(reqOn.length < reqOff.length, `ON 요청 수(${reqOn.length}) < OFF 요청 수(${reqOff.length})`);
const mcrcOff = offA4.nodes.find((n) => n.id === MCRC), mcrcOn = onA.nodes.find((n) => n.id === MCRC);
assert(mcrcOn.arrivalsByKind.approval < mcrcOff.arrivalsByKind.approval,
  `MCRC 승인 도착 ${mcrcOff.arrivalsByKind.approval} → ${mcrcOn.arrivalsByKind.approval}`);

// ── 4. (b) 회신 역방향 계선 ──
console.log('# 4) (b) 회신은 협조 계선 역방향(MCRC→C2A)');
const back = onA.flowEvents.filter((e) => e.k === 'link' && e.from === MCRC && AOCS.includes(e.to) && e.kind === 'coord');
const fwd = onA.flowEvents.filter((e) => e.k === 'link' && AOCS.includes(e.from) && e.to === MCRC && e.kind === 'coord');
assert(back.length > 0, `회신 링크 MCRC→C2A ${back.length}건 (요청 링크 ${fwd.length}건)`);
assert(back.every((e) => e.d > 0) && back.length && back.reduce((s, e) => s + e.d, 0) / back.length > 5,
  '회신 지연 전부 > 0, 평균 ' + (back.reduce((s, e) => s + e.d, 0) / Math.max(1, back.length)).toFixed(1) + '초 (음성 협조와 같은 매체)');
assert(back.every((e) => e.mt === (fwd[0] && fwd[0].mt)), '회신 매체 = 요청 매체 (' + (fwd[0] && fwd[0].mt) + ')');
const offFlow = run({}, { seed: SEED, flow: true });
assert(!offFlow.flowEvents.some((e) => e.k === 'link' && e.from === MCRC && AOCS.includes(e.to) && e.kind === 'coord'),
  'OFF에는 MCRC→C2A coord 링크가 없다');

// ── 5. (c) C2A 회신 처리 큐 + 마크 순서 ──
console.log('# 5) (c) C2A 큐의 approval_return 작업과 마크 순서');
let retArr = 0;
for (const id of AOCS) {
  const n = onA.nodes.find((x) => x.id === id);
  retArr += n.arrivalsByKind.approval_return || 0;
}
assert(retArr > 0 && retArr <= reqOn.length,
  `C2A approval_return 도착 ${retArr}건 (승인 요청 ${reqOn.length}건 — 회신 전 소멸한 항적은 큐에 넣지 않음)`);
const naRet = onA.flowEvents.filter((e) => e.k === 'na' && e.jk === 'approval_return');
assert(naRet.length === retArr && naRet.every((e) => AOCS.includes(e.at)), 'approval_return 작업은 전부 C2A(AOC·JAOC) 노드에 도착');
let orderOk = 0, orderBad = 0, checked = 0;
for (const tr of onA.threatTraces) {
  const marks = tr.stages || [];
  const byCmd = {};
  for (const m of marks) {
    const name = m.name ?? m[0], t = m.t ?? m[1], axis = m.axis ?? m[2] ?? '';
    if (!axis.startsWith('LOCAL_AD|')) continue;
    const cmd = axis.split('|')[1]; const b = byCmd[cmd] = byCmd[cmd] || {};
    for (const [k, pre] of [['req', '협조개시:'], ['ok', '승인완료:'], ['sent', '승인회신발신:'], ['recv', '승인회신접수:'], ['done', '승인회신처리완료:'], ['sel', '사수선정']]) {
      if (name.startsWith(pre) && b[k] === undefined) b[k] = t;
    }
  }
  for (const b of Object.values(byCmd)) {
    if (b.req === undefined || b.done === undefined) continue;
    checked++;
    const ok = b.req < b.ok && b.ok <= b.sent && b.sent < b.recv && b.recv <= b.done && (b.sel === undefined || b.done <= b.sel);
    if (ok) orderOk++; else orderBad++;
  }
}
assert(checked > 0 && orderBad === 0 && orderOk >= 3, `마크 순서 협조개시<승인완료≤회신발신<회신접수≤회신처리완료≤사수선정: ${orderOk}/${checked} (위반 ${orderBad})`);
assert(onA.threatTraces.every((tr) => {
  // 회신 처리 전에 LOCAL_AD 사수선정이 나가면 안 된다 — 승인 상태가 pending으로 유지되는지의 증거
  const m = (tr.stages || []).filter((x) => (x.axis ?? '').startsWith('LOCAL_AD|'));
  const firstSel = m.find((x) => (x.name ?? '').startsWith('사수선정'));
  const firstReq = m.find((x) => (x.name ?? '').startsWith('협조개시:'));
  const firstDone = m.find((x) => (x.name ?? '').startsWith('승인회신처리완료:'));
  if (!firstSel || !firstReq) return true;
  return firstDone !== undefined && firstDone.t <= firstSel.t;
}), '승인을 요청한 C2A는 회신 처리 완료 전에 사수선정을 내지 않는다');

// ── 6. wire shape ──
console.log('# 6) wire shape');
assert(offA.nodes.every((n) => !('approval_return' in n.arrivalsByKind)), 'OFF 노드 통계에 approval_return 키 없음');
assert(onA.nodes.every((n) => 'approval_return' in n.arrivalsByKind), 'ON 노드 통계에는 approval_return 키 있음');
assert(!('approvalPipelineRealism' in offA.global.features), 'global.features wire shape 불변');

// ── 7. 배선 ──
console.log('# 7) 배선');
const proto = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
assert(/approvalPipelineRealism:\s*P\.pipe/.test(proto), '프로토타입 features()에 approvalPipelineRealism: P.pipe');
assert(/\{ k: 'pipe',\s*d: 1,/.test(proto), "프로토타입 ?pipe= 파라미터 (이 화면만 기본 1 — 엔진 기본 OFF, 칩 상시 표기)");
assert(proto.includes("out.push('승인 파이프라인 현실화 ON')"), '켜진 동안 상태줄 칩');
assert(/approval_return:\s*'승인 회신 처리·교전명령'/.test(proto), 'JOB_LABEL approval_return');
const eng = fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8');
assert(/this\.approvalPipelineRealism = ff\('approvalPipelineRealism', false\)/.test(eng), '엔진 기본 OFF');
assert(/if \(self\.approvalPipelineRealism\) kindKeys = kindKeys\.concat\(\['approval_return'\]\)/.test(eng), 'kindKeys는 ON에서만 확장');

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
