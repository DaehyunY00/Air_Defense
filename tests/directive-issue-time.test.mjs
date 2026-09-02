/**
 * ADR-096 — 교전명령 발령 작업(directiveIssueTime) 회귀.
 *
 * 검증 관점:
 *  1) OFF bit-exact — 플래그 미지정 결과가 골든 지문과 같다.
 *  2) 문제의 실재 — OFF에서는 명령의 다수가 「위협판단 완료」보다 **나중에** 나가는데
 *     그 사이 결심 노드는 큐를 한 번도 다시 타지 않는다(발령이 무료다).
 *  3) 발령이 작업이 된다 — ON이면 directive_issue가 결심 노드에만 도착하고,
 *     그 건수가 교전명령 생성 건수와 맞는다.
 *  4) 서비스 시간 = 노드 체계 성분 중점 (KAMDOC 5~10초 → 7.5초). 새 파라미터를 짓지 않았다.
 *  5) 마크 순서 — 사수선정 ≤ 발령 ≤ 하달(중계접수 또는 교전명령접수).
 *  6) **재발령도 계상된다** — ICC 반송(ADR-094) 뒤 상급이 다시 내는 명령이 새 발령 작업을 만든다.
 *     종전에는 이 재결심이 0초였다.
 *  7) 손잡이 · wire shape · 배선(프로토타입 파라미터·칩·라벨·로그 결과 표시).
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
    seed: opts.seed || 12345, endTimeSec: opts.dur || 600, deploymentId: 'HANBANDO_LEGACY_NORMAL',
    trace: true, traceCap: 5000, flowTrace: !!opts.flow, flowTraceCap: 200000,
    features: Object.assign({ highResolutionDeployment: true }, f)
  });
}
const marks = (r, pre) => r.threatTraces.flatMap((t) => (t.stages || []).filter((m) => m.name.startsWith(pre)));
const issueArrivals = (r) => r.nodes.reduce((s, n) => s + ((n.arrivalsByKind && n.arrivalsByKind.directive_issue) || 0), 0);

// ── 1. OFF bit-exact ──
console.log('# 1) OFF bit-exact (골든 지문)');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
const offPlain = KJ.runDES({
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1, seed: 12345, endTimeSec: 600,
  deploymentId: 'HANBANDO_LEGACY_NORMAL', features: { highResolutionDeployment: true }
});
assert(sha(offPlain) === GOLDEN.asis, 'SC3 As-Is OFF = 골든 (' + sha(offPlain).slice(0, 8) + '…)');
assert(!('directiveIssueTime' in offPlain.global.features), 'global.features wire shape 불변');

// ── 2. 문제의 실재 ──
console.log('# 2) OFF — 명령이 준비보다 나중에, 무료로 나간다');
const off = run({});
let sameInstant = 0, later = [], prepped = 0;
for (const tr of off.threatTraces) {
  const ms = tr.stages || [];
  const p = ms.find((m) => m.name === '위협판단·표적할당준비:KAMD_OPS');
  if (!p) continue;
  prepped++;
  for (const s of ms.filter((m) => m.name.startsWith('사수선정·표적할당:KAMD_OPS'))) {
    if (s.t - p.t < 0.001) sameInstant++; else later.push(s.t - p.t);
  }
}
later.sort((a, b) => a - b);
const med = later.length ? later[Math.floor(later.length / 2)] : 0;
assert(prepped > 20 && later.length > sameInstant,
  `KAMDOC 지휘 ${prepped}건 — 명령 ${sameInstant + later.length}건 중 나중에 나온 것 ${later.length}건 (중앙값 +${med.toFixed(1)}초)`);
assert(issueArrivals(off) === 0, 'OFF에는 발령 작업이 없다 (무료)');

// ── 3·4. 발령이 작업이 된다 ──
console.log('# 3) ON — 발령이 결심 노드 큐 작업이 된다');
const on = run({ directiveIssueTime: true }, { flow: true });
const nIssue = issueArrivals(on);
const nOrders = marks(on, '사수선정·표적할당:').length;
assert(nIssue > 0 && nIssue === nOrders,
  `발령 작업 ${nIssue}건 = 사수선정 ${nOrders}건 (모든 명령이 큐를 탄다)`);
const issueNodes = on.nodes.filter((n) => (n.arrivalsByKind.directive_issue || 0) > 0);
assert(issueNodes.every((n) => n.category === 'c2'), '발령 작업은 C2 노드에만 도착');
assert(issueNodes.some((n) => n.id === 'C2_KAMD_OPS_KAMD_OPS'), 'KAMDOC이 발령 작업을 갖는다 (이 ADR의 출발점)');

console.log('# 4) 서비스 시간 = 노드 체계 성분 중점');
const st = new Map(), svc = [];
for (const e of on.flowEvents) {
  if (e.k === 'na' && e.jk === 'directive_issue' && e.at === 'C2_KAMD_OPS_KAMD_OPS') st.set(e.id, true);
  else if (e.k === 'ns' && st.has(e.id)) st.set(e.id, e.t);
  else if (e.k === 'nd' && typeof st.get(e.id) === 'number') { svc.push(e.t - st.get(e.id)); st.delete(e.id); }
}
const avg = svc.reduce((a, b) => a + b, 0) / svc.length;
assert(svc.length > 20 && Math.abs(avg - 7.5) < 2.5,
  `KAMDOC 발령 실효 서비스 n=${svc.length} 평균 ${avg.toFixed(2)}초 (체계 5~10초 중점 7.5초)`);
const cat = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', { highResolutionDeployment: true });
const kam = cat.nodes.find((n) => n.id === 'C2_KAMD_OPS_KAMD_OPS');
assert(kam.queue.serviceParts.systemSec[0] === 5 && kam.queue.serviceParts.systemSec[1] === 10,
  '값의 출처는 ADR-092 serviceParts.systemSec — 새 파라미터를 짓지 않았다');

// ── 5. 마크 순서 ──
console.log('# 5) 마크 순서 — 사수선정 ≤ 발령 ≤ 하달');
let ok = 0, bad = 0;
for (const tr of on.threatTraces) {
  const ms = tr.stages || [];
  for (const iss of ms.filter((m) => m.name.startsWith('교전명령발령:'))) {
    const sel = ms.filter((m) => m.name.startsWith('사수선정·표적할당:') && m.t <= iss.t + 1e-9).pop();
    const down = ms.find((m) => (m.name.startsWith('교전명령접수:') || m.name.startsWith('교전명령중계접수:')) && m.t >= iss.t - 1e-9);
    if (sel && (!down || down.t >= iss.t - 1e-9)) ok++; else bad++;
  }
}
assert(ok > 20 && bad === 0, `순서 정합 ${ok}건 (위반 ${bad}건)`);

// ── 6. 재발령도 계상된다 (ADR-094 반송과 결합) ──
console.log('# 6) ICC 반송 뒤의 재발령도 큐를 탄다');
const both = run({ directiveIssueTime: true, iccRelayAuthorization: true }, { flow: true });
const backs = marks(both, '교전명령반송:').length;
const issuesB = issueArrivals(both), ordersB = marks(both, '사수선정·표적할당:').length;
assert(backs > 0, `ICC 반송 ${backs}건 발생`);
assert(issuesB === ordersB, `발령 ${issuesB}건 = 명령 ${ordersB}건 — 반송 뒤 재발령도 빠짐없이 계상`);
// 반송은 대개 「그 항적은 지금 아무도 못 쏜다」라서 재시도해도 새 명령이 안 나온다.
// 그러므로 「반송 뒤 재발령」을 세는 대신, **명령이 두 번 이상 나간 항적에서 발령 작업도 두 번
// 도착하는가**를 항적 단위로 본다 — 「재결심이 매번 비용을 낸다」의 정확한 서명이다.
// ⚠️ 발령 **마크**가 아니라 **도착(na)** 으로 센다 — 마크는 서비스 완료 시에만 찍혀
//    드롭·처리 중 항적 소멸분이 빠진다(총합은 같아도 항적별로는 어긋난다).
const issueByThreat = {};
for (const e of both.flowEvents) {
  if (e.k === 'na' && e.jk === 'directive_issue' && e.th) issueByThreat[e.th] = (issueByThreat[e.th] || 0) + 1;
}
let multi = 0, mismatch = 0;
for (const tr of both.threatTraces) {
  const sel = (tr.stages || []).filter((m) => m.name.startsWith('사수선정·표적할당:')).length;
  const iss = issueByThreat[tr.id] || 0;
  if (sel !== iss) mismatch++;
  if (sel > 1) multi++;
}
assert(multi > 0 && mismatch === 0,
  `항적별 사수선정 = 발령 도착 (불일치 ${mismatch}건). 명령이 2건 이상인 항적 ${multi}건 — 두 번째부터도 비용을 낸다`);

// ── 7. 손잡이 · wire shape · 배선 ──
console.log('# 7) 손잡이 · wire shape · 배선');
const st2 = new Map(), svc2 = [];
const on20 = run({ directiveIssueTime: true, directiveIssueSec: 20 }, { flow: true });
for (const e of on20.flowEvents) {
  if (e.k === 'na' && e.jk === 'directive_issue') st2.set(e.id, true);
  else if (e.k === 'ns' && st2.has(e.id)) st2.set(e.id, e.t);
  else if (e.k === 'nd' && typeof st2.get(e.id) === 'number') { svc2.push(e.t - st2.get(e.id)); st2.delete(e.id); }
}
const avg20 = svc2.reduce((a, b) => a + b, 0) / svc2.length;
assert(Math.abs(avg20 - 20) < 6, `directiveIssueSec=20 → 실효 평균 ${avg20.toFixed(2)}초 (전 노드 균일)`);
assert(off.nodes.every((n) => !('directive_issue' in n.arrivalsByKind)), 'OFF에 directive_issue 키 없음');
assert(on.nodes.every((n) => 'directive_issue' in n.arrivalsByKind), 'ON에만 directive_issue 키 있음');

const proto = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
assert(/directiveIssueTime:\s*P\.issue/.test(proto), '프로토타입 features()에 directiveIssueTime: P.issue');
assert(/\{ k: 'issue',\s*d: 1,/.test(proto), "프로토타입 ?issue= (이 화면만 기본 1)");
assert(/\{ k: 'issuesec',\s*d: -1,/.test(proto), "프로토타입 ?issuesec= 민감도 손잡이");
assert(proto.includes("out.push('명령 발령 ON'"), '켜진 동안 상태줄 칩');
assert(/directive_issue:\s*'교전명령 발령'/.test(proto), 'JOB_LABEL directive_issue');
// 로그 결과 표시(ADR-096 (A))
assert(/function spanOutcome\(s\)/.test(proto) && /OUTCOME_RULES/.test(proto),
  'C2 처리 로그에 결과 판정기(spanOutcome)');
assert(proto.includes('쏠 수 있는 사수 없음 · 계속 감시'),
  '결과 마크가 없을 때도 「무엇이 안 됐는가」를 적는다');
assert(/const kindTxt = Object\.keys\(byKind\)/.test(proto), '로그 헤더에 작업 종류 내역');
const eng = fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8');
assert(/this\.directiveIssueTime = ff\('directiveIssueTime', false\)/.test(eng), '엔진 기본 OFF');
assert(/if \(self\.directiveIssueTime\) kindKeys = kindKeys\.concat\(\['directive_issue'\]\)/.test(eng),
  'kindKeys는 ON에서만 확장');

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
