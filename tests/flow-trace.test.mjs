/**
 * 지휘 흐름 관측(flowTrace) 회귀.
 *
 * 이 관측 채널은 「전문이 **어느 간선을 언제 출발해 언제 도착했는가**」와 「노드에서
 * **얼마나 기다렸다 얼마나 처리했는가**」를 남긴다(prototype/command-flow.html이 쓴다).
 * 지키려는 계약은 셋이다.
 *
 *  ① **OFF는 bit-exact.** 관측을 끄면 결과가 종전과 한 톨도 달라지지 않는다.
 *  ② **ON도 bit-exact.** 관측은 순수하다 — RNG를 뽑지 않고 스케줄·분기를 건드리지 않으므로,
 *     켜도 동역학 결과(격추·누수·해시)가 같아야 한다. 이 어서션이 이 파일의 핵심이다.
 *     ⚠️ 여기서 실패하면 "관측이 모델을 바꿨다"는 뜻이고, 화면에 나온 어떤 수치도
 *     인용할 수 없게 된다.
 *  ③ **관측값이 모델과 맞물린다.** 도착 = 출발 + 지연이고, 간선은 그 모드의 카탈로그에
 *     실재하며, 매체는 그 간선에 선언된 매체다. 즉 화면의 점 속도가 곧 모델의 지연이다.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, f)));
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const FEATURES = Object.freeze({
  highResolutionDeployment: true, approvalChain: true, threatTargetDispersion: true,
  southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  unifiedEngagementState: true, sawtoothFreshness: true, selfDefenseFire: true
});
const base = (mode, extra) => Object.assign({
  scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 12345,
  endTimeSec: 420, deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2',
  features: FEATURES
}, extra || {});

/** 결과 지문. flowTrace 산출물은 **관측이므로 지문에서 뺀다** — 비교 대상은 동역학이다. */
function fingerprint(res) {
  const copy = Object.assign({}, res);
  delete copy.flowEvents; delete copy.flowTruncated; delete copy.flowCap;
  return crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}

for (const mode of ['asis', 'tobe']) {
  console.log(`\n-- ${mode} --`);

  // ① OFF wire shape — 관측 키가 아예 없어야 한다(있으면 소비 측이 "0건"과 "미측정"을 못 가른다)
  const off = KJ.runDES(base(mode));
  assert(off.flowEvents === undefined && off.flowTruncated === undefined,
    `${mode}: flowTrace OFF에서는 관측 키가 결과에 실리지 않는다`);

  // ② ON/OFF 동역학 동일 — 이 파일의 핵심 어서션
  const on = KJ.runDES(base(mode, { flowTrace: true }));
  assert(fingerprint(off) === fingerprint(on),
    `${mode}: flowTrace ON/OFF 결과 SHA-256 일치 (관측이 모델을 바꾸지 않는다)`);

  // trace까지 함께 켜는 것이 실사용 조합(프로토타입) — 그 조합에서도 동역학이 같아야 한다
  const traceOff = KJ.runDES(base(mode, { trace: true }));
  const traceOn = KJ.runDES(base(mode, { trace: true, flowTrace: true }));
  const strip = (r) => { const c = Object.assign({}, r); delete c.flowEvents;
    delete c.flowTruncated; delete c.flowCap; return c; };
  assert(JSON.stringify(strip(traceOff)) === JSON.stringify(strip(traceOn)),
    `${mode}: trace+flowTrace 조합에서도 항적 trace가 동일하다`);

  const fe = on.flowEvents;
  assert(Array.isArray(fe) && fe.length > 0, `${mode}: 관측 이벤트가 실린다 (${fe.length}건)`);
  assert(on.flowTruncated === false, `${mode}: 기본 상한(60000) 안에서 절삭되지 않는다`);

  // ③-a 링크 사건: 도착 = 출발 + 지연, 지연은 음수가 아니다
  const links = fe.filter((e) => e.k === 'link');
  assert(links.length > 0, `${mode}: 링크 통과 사건 ${links.length}건`);
  const badTime = links.find((e) => !near(e.t1, e.t0 + e.d) || e.d < 0 || !(e.t0 >= 0));
  assert(!badTime, `${mode}: 모든 링크 사건이 t1 = t0 + d (d ≥ 0)를 만족한다` +
    (badTime ? ' — 위반: ' + JSON.stringify(badTime) : ''));

  // ③-b 간선·매체가 그 모드의 카탈로그와 맞물린다.
  //     `fanout`(ADR-078 병렬 통보)만은 예외 — 카탈로그 간선이 아니라 같은 시각의 통보라서,
  //     엔진이 linkStat이 아니라 관측 채널로만 보낸다. 그 예외를 여기서 못 박는다.
  //     ⚠️ 두 노드 사이에 간선이 **하나뿐이라고 가정하면 안 된다.** 방공C2A → MCRC에는
  //     성격이 다른 계선이 세 가닥 병렬로 있다(교전현황 음성/VTC · 승인협조 음성 ·
  //     항적공유 문자). 그래서 쌍 → 매체 **집합**으로 본다.
  const catalog = KJ.resolveModelCatalog(base(mode));
  const declared = new Map();
  KJ.linksInMode(mode, catalog).forEach((l) => {
    const k = l.from + '>' + l.to;
    if (!declared.has(k)) declared.set(k, new Set());
    declared.get(k).add(l.comm[mode].type);
  });
  const orphan = links.find((e) => e.mt !== 'fanout' && !declared.has(e.from + '>' + e.to));
  assert(!orphan, `${mode}: 카탈로그에 없는 간선을 지나지 않는다` +
    (orphan ? ' — ' + orphan.from + '>' + orphan.to : ''));
  const wrongMedia = links.find((e) => e.mt !== 'fanout' &&
    !declared.get(e.from + '>' + e.to).has(e.mt));
  assert(!wrongMedia, `${mode}: 관측 매체가 그 간선에 선언된 매체 중 하나다` +
    (wrongMedia ? ' — ' + JSON.stringify(wrongMedia) : ''));

  // 병렬 계선이 실재한다는 사실 자체를 못 박는다 — 화면이 (from,to)로만 간선을 묶으면
  // 세 채널이 한 가닥으로 접혀 나머지 둘이 없는 것처럼 보인다(실제로 그랬다).
  if (mode === 'asis') {
    const multi = [...declared.entries()].filter(([, v]) => v.size > 1);
    assert(multi.length > 0,
      `asis: 같은 두 노드를 잇는 성격이 다른 병렬 계선이 존재한다 (${multi.length}쌍)`);
  }
  const fanouts = links.filter((e) => e.mt === 'fanout');
  assert(fanouts.every((e) => e.d === 0),
    `${mode}: 병렬 통보(fanout)는 지연 0으로만 기록된다 (${fanouts.length}건)`);
  // fanout이 linkStat을 오염시키지 않았는지 — 오염되면 OFF wire shape가 달라진다
  assert(!(on.links || []).some((l) => l.type === 'fanout'),
    `${mode}: fanout은 결과 links 집계에 섞이지 않는다`);

  // ③-c 노드 체류: 도착 ≤ 개시 ≤ 완료. 셋은 같은 작업 id로 이어진다.
  const spans = new Map();
  fe.forEach((e) => {
    if (e.k === 'na') spans.set(e.id, { at: e.at, arrive: e.t, start: null, done: null, drop: null });
    else if (spans.has(e.id)) {
      const s = spans.get(e.id);
      if (e.k === 'ns') s.start = e.t; else if (e.k === 'nd') s.done = e.t; else if (e.k === 'nx') s.drop = e.t;
    }
  });
  assert(spans.size > 0, `${mode}: 노드 체류 ${spans.size}건`);
  const dangling = [...spans.values()].find((s) =>
    (s.start != null && s.start < s.arrive - 1e-9) ||
    (s.done != null && s.start == null) ||
    (s.done != null && s.done < s.start - 1e-9));
  assert(!dangling, `${mode}: 모든 체류가 도착 ≤ 개시 ≤ 완료 순서를 지킨다` +
    (dangling ? ' — ' + JSON.stringify(dangling) : ''));
  // 고아 사건 방지: 개시/완료는 반드시 앞선 도착을 갖는다(id 짝이 깨지면 화면에서 노드가
  // 영원히 "처리 중"으로 굳는다)
  const orphanSpan = fe.find((e) => (e.k === 'ns' || e.k === 'nd' || e.k === 'nx') && !spans.has(e.id));
  assert(!orphanSpan, `${mode}: 도착 없는 개시·완료 사건이 없다`);

  // ③-e 이탈 사유 — 모든 nx는 사유를 갖는다. 'over'(대기실 초과)·'ttl'(기한 만료)만
  //     엔진 ns.drops에 계상되고 'dead'(항적 소멸 큐 정리)는 계상되지 않는다.
  const badNx = fe.find((e) => e.k === 'nx' && ['over', 'dead', 'ttl'].indexOf(e.r) < 0);
  assert(!badNx, `${mode}: 모든 이탈(nx)에 사유가 실린다` + (badNx ? ' — ' + JSON.stringify(badNx) : ''));

  // ③-f **장부 대사** — 관측(flowTrace)으로 재구성한 노드별 도착·완료·드롭이 엔진의
  //     독립 카운터(result.nodes[].arrivals/completions/drops)와 정확히 일치해야 한다.
  //     여기가 어긋나면 화면의 케파·병목은 허구다. 사수 노드는 결과가 교전자원 카운터
  //     (commandArrivals)를 보고하므로 비교 대상이 다르다 — 제외한다.
  {
    const resNode = {};
    on.nodes.forEach((n) => { resNode[n.id] = n; });
    const obs = {};
    const ob = (id) => obs[id] || (obs[id] = { na: 0, nd: 0, over: 0, ttl: 0, dead: 0 });
    fe.forEach((e) => {
      if (e.k === 'na') ob(e.at).na++;
      else if (e.k === 'nd') ob(e.at).nd++;
      else if (e.k === 'nx') ob(e.at)[e.r]++;
    });
    let mismatch = null;
    Object.keys(resNode).forEach((id) => {
      if (resNode[id].category === 'shooter') return;
      const o = obs[id] || { na: 0, nd: 0, over: 0, ttl: 0, dead: 0 };
      const r = resNode[id];
      if (o.na !== r.arrivals) mismatch = mismatch || `${id}: na ${o.na} ≠ arrivals ${r.arrivals}`;
      else if (o.nd !== r.completions) mismatch = mismatch || `${id}: nd ${o.nd} ≠ completions ${r.completions}`;
      else if (o.over + o.ttl !== r.drops) mismatch = mismatch || `${id}: over+ttl ${o.over + o.ttl} ≠ drops ${r.drops}`;
    });
    assert(!mismatch, `${mode}: 전 노드 장부 대사 일치 (도착·완료·드롭 = 엔진 카운터)` +
      (mismatch ? ' — ' + mismatch : ''));

    // ③-g 점유 재구성 불변식 — 체류 사건을 시간순으로 재생하면 어느 순간에도
    //     q ≥ 0, busy ≤ c 여야 하고, 최대 재실률(busy+q)은 엔진 maxInSystem과 같아야 한다.
    //     같은 시각의 동률은 완료 → 도착 → 개시 → 이탈 순으로 푼다(엔진 실제 순서:
    //     서비스 종료가 서버를 비운 뒤 대기열에서 인출한다).
    const seq = [];
    spans.forEach((s) => {
      seq.push({ t: s.arrive, at: s.at, k: 'a' });
      if (s.start != null) seq.push({ t: s.start, at: s.at, k: 's' });
      if (s.done != null) seq.push({ t: s.done, at: s.at, k: 'd' });
      if (s.drop != null) seq.push({ t: s.drop, at: s.at, k: 'x' });
    });
    const ORD = { d: 0, a: 1, s: 2, x: 3 };
    seq.sort((a, b) => a.t - b.t || ORD[a.k] - ORD[b.k]);
    const liveN = {}, peak = {};
    let invErr = null;
    seq.forEach((e) => {
      const L = liveN[e.at] || (liveN[e.at] = { busy: 0, q: 0 });
      if (e.k === 'a') L.q++;
      else if (e.k === 's') { L.q--; L.busy++; }
      else if (e.k === 'd') L.busy--;
      else if (e.k === 'x') L.q--;
      const r = resNode[e.at];
      if (L.q < 0) invErr = invErr || `${e.at}: q<0 @${e.t.toFixed(1)}`;
      if (L.busy < 0) invErr = invErr || `${e.at}: busy<0 @${e.t.toFixed(1)}`;
      if (r && r.category !== 'shooter' && r.c && L.busy > r.c)
        invErr = invErr || `${e.at}: busy ${L.busy} > c ${r.c} @${e.t.toFixed(1)}`;
      peak[e.at] = Math.max(peak[e.at] || 0, L.busy + L.q);
    });
    assert(!invErr, `${mode}: 점유 재구성 불변식 (q≥0 · busy≤c)` + (invErr ? ' — ' + invErr : ''));
    let peakErr = null;
    Object.keys(resNode).forEach((id) => {
      if (resNode[id].category === 'shooter') return;
      if ((peak[id] || 0) !== resNode[id].maxInSystem)
        peakErr = peakErr || `${id}: 재구성 최대 ${peak[id] || 0} ≠ maxInSystem ${resNode[id].maxInSystem}`;
    });
    assert(!peakErr, `${mode}: 최대 재실(busy+q) 재구성이 엔진 maxInSystem과 일치` +
      (peakErr ? ' — ' + peakErr : ''));
    // 한 체류가 완료와 이탈을 동시에 갖지 않는다
    const both = [...spans.values()].find((s) => s.done != null && s.drop != null);
    assert(!both, `${mode}: 완료와 이탈을 동시에 가진 체류가 없다`);
  }

  // ③-h **채널 적체 대사** — 「가려다 못 간 전문」이 엔진 카운터와 맞물린다.
  //     종전 관측은 실제로 출발한 전문만 남겨(_recordLink), 용량에 막혀 대기하거나 버려진
  //     전문은 흔적조차 없었다(As-Is 실측: 보낸 15건 중 화면에 2건만 보였다).
  //     ⚠️ 여기가 어긋나면 화면의 「막힘 N건」은 허구다.
  {
    const ss = on.global.coordination && on.global.coordination.statusSharing;
    assert(!!ss, `${mode}: 교전현황 채널 계정이 결과에 있다`);
    const cq = fe.filter((e) => e.k === 'cq');
    const cx = fe.filter((e) => e.k === 'cx');
    // 대기 진입·용량 드롭은 각각 엔진의 queued·dropped와 같은 수여야 한다
    assert(cq.length === ss.queued,
      `${mode}: 대기 진입(cq) ${cq.length} = statusSharing.queued ${ss.queued}`);
    assert(cx.length === ss.dropped,
      `${mode}: 용량 드롭(cx) ${cx.length} = statusSharing.dropped ${ss.dropped}`);
    // 보낸 전문의 향방은 셋 중 하나로 남김없이 갈린다: 즉시 출발 · 대기 · 드롭
    const statusLinks = fe.filter((e) => e.k === 'link' && e.kind === 'status');
    const immediate = statusLinks.filter((e) => e.mid == null ||
      !cq.some((q) => q.id === e.mid)).length;
    assert(immediate + cq.length + cx.length === ss.sent,
      `${mode}: 즉시출발 ${immediate} + 대기 ${cq.length} + 드롭 ${cx.length} = 보냄 ${ss.sent}`);
    // 모든 이탈·대기 사건은 실재하는 계선의 양 끝을 가리킨다
    const badEnd = cq.concat(cx).find((e) => !e.from || !e.to || e.from === e.to);
    assert(!badEnd, `${mode}: 모든 채널 사건이 양 끝을 갖는다`);
    // 대기 후 출발한 전문은 대기 시각 ≤ 출발 시각이어야 한다(음수 대기 금지)
    const departByMid = new Map();
    statusLinks.forEach((e) => { if (e.mid != null) departByMid.set(e.mid, e); });
    const negWait = cq.map((q) => departByMid.get(q.id))
      .filter(Boolean).find((d, i) => d.t0 < cq[i].t - 1e-9);
    assert(!negWait, `${mode}: 대기 후 출발이 대기 시작보다 앞서지 않는다`);
    // cq와 cx는 같은 전문에 동시에 붙지 않는다(대기줄에 섰으면 드롭이 아니다)
    const qi = new Set(cq.map((e) => e.id));
    assert(!cx.some((e) => qi.has(e.id)),
      `${mode}: 한 전문이 대기와 드롭을 동시에 갖지 않는다`);
  }

  // ③-d 관측 상한 — 넘치면 조용히 자르지 말고 잘랐다고 남긴다(ADR-062: 0과 미측정 구분)
  const capped = KJ.runDES(base(mode, { flowTrace: true, flowTraceCap: 1000 }));
  assert(capped.flowEvents.length === 1000 && capped.flowTruncated === true,
    `${mode}: 상한 초과 시 절삭 사실이 결과에 남는다`);
  assert(fingerprint(capped) === fingerprint(off),
    `${mode}: 상한을 걸어도 동역학은 그대로다`);
}

// ── 고강도 스트레스 대사 — 넘침이 실제로 발생하는 조건에서도 장부가 맞는가 ─────
// ×3에서는 KAMDOC 대기실 초과 드롭이 다발한다(전체 흐름 화면의 대표 장면).
// 넘침 없는 실행의 대사 통과는 'over' 경로를 한 번도 안 밟았다는 뜻이라 증명력이 없다.
console.log('\n-- 고강도(×3) 스트레스 대사 --');
{
  const hot = KJ.runDES(Object.assign(base('asis', { flowTrace: true }), { intensity: 3 }));
  const fe = hot.flowEvents;
  const overs = fe.filter((e) => e.k === 'nx' && e.r === 'over');
  assert(overs.length > 0, `×3에서 대기실 초과 드롭(over)이 실제로 발생한다 (${overs.length}건)`);
  const resNode = {};
  hot.nodes.forEach((n) => { resNode[n.id] = n; });
  const obs = {};
  const ob = (id) => obs[id] || (obs[id] = { na: 0, nd: 0, over: 0, ttl: 0, dead: 0 });
  fe.forEach((e) => {
    if (e.k === 'na') ob(e.at).na++;
    else if (e.k === 'nd') ob(e.at).nd++;
    else if (e.k === 'nx') ob(e.at)[e.r]++;
  });
  let mismatch = null;
  Object.keys(resNode).forEach((id) => {
    if (resNode[id].category === 'shooter') return;
    const o = obs[id] || { na: 0, nd: 0, over: 0, ttl: 0, dead: 0 };
    const r = resNode[id];
    if (o.na !== r.arrivals || o.nd !== r.completions || o.over + o.ttl !== r.drops)
      mismatch = mismatch || `${id}: na ${o.na}/${r.arrivals} nd ${o.nd}/${r.completions} drop ${o.over + o.ttl}/${r.drops}`;
  });
  assert(!hot.flowTruncated, '×3에서도 관측 상한(60000) 안이다 — 절삭되면 아래 대사가 무의미하다');
  assert(!mismatch, '×3 스트레스에서도 전 노드 장부 대사 일치' + (mismatch ? ' — ' + mismatch : ''));

  // 채널 드롭 경로는 기본 설정에서 0건이라 증명력이 없다 — 실제로 버려지는 ×3에서 잡는다.
  const ss = hot.global.coordination.statusSharing;
  const cq = fe.filter((e) => e.k === 'cq'), cx = fe.filter((e) => e.k === 'cx');
  assert(cx.length > 0, `×3에서 채널 용량 드롭(cx)이 실제로 발생한다 (${cx.length}건)`);
  assert(cq.length === ss.queued && cx.length === ss.dropped,
    `×3 채널 대사 일치 — 대기 ${cq.length}/${ss.queued} · 드롭 ${cx.length}/${ss.dropped}`);
  const statusLinks = fe.filter((e) => e.k === 'link' && e.kind === 'status');
  const immediate = statusLinks.filter((e) => e.mid == null || !cq.some((q) => q.id === e.mid)).length;
  assert(immediate + cq.length + cx.length === ss.sent,
    `×3 보낸 전문의 향방이 남김없이 갈린다 — 즉시 ${immediate} + 대기 ${cq.length} + 드롭 ${cx.length} = ${ss.sent}`);
  // 이 실행이 실제로 "거의 못 건너가는" 상태인지 — 화면이 말하려는 그림의 근거
  console.log(`  · ×3 교전현황: 보냄 ${ss.sent} → 도착 ${ss.delivered} (드롭 ${ss.dropped} · 대기 ${ss.queued})`);
}

// ── 계선 매체 반사실(linkMediaOverrides) ──────────────────────────────────────
// 지키려는 계약: ① 오버라이드 없는 실행은 이 기능이 없던 때와 wire shape가 같다(위 ①이
// 이미 잠근다 — cfg에 키가 없으면 경로 자체가 안 탄다). ② 적용 내역이 결과에 원장으로
// 남는다. ③ 못 맞춘 키는 조용히 사라지지 않는다. ④ 카탈로그에 없는 매체는 거부한다.
// ⑤ 관측 매체가 실제로 바뀐다 — 바꿨는데 안 바뀌는 실행은 원장만 보고 못 잡는다.
console.log('\n-- 계선 매체 반사실 --');
{
  const CHAT_KEY = 'C2_MCRC_MCRC>C2_ARMY_LOCAL_AD_ARMY_WEST_FRONT_AD>report';
  const ovr = KJ.runDES(base('asis', { flowTrace: true, linkMediaOverrides: {
    [CHAT_KEY]: 'datalink', '없는노드>없는노드>report': 'voice'
  } }));
  const ledger = ovr.linkMediaOverrides;
  assert(!!ledger, '반사실 실행은 결과에 적용 원장을 싣는다');
  assert(ledger.applied.length === 1 &&
    ledger.applied[0].was === 'chat' && ledger.applied[0].now === 'datalink',
    `원장이 chat → datalink 교체를 기록한다 (${JSON.stringify(ledger.applied)})`);
  assert(ledger.unmatched.length === 1 && ledger.unmatched[0].indexOf('없는노드') === 0,
    '못 맞춘 키가 unmatched에 남는다 — 오타가 조용히 사라지지 않는다');
  const chatHops = ovr.flowEvents.filter((e) => e.k === 'link' &&
    e.from === 'C2_MCRC_MCRC' && e.to === 'C2_ARMY_LOCAL_AD_ARMY_WEST_FRONT_AD');
  assert(chatHops.length > 0 && chatHops.every((e) => e.mt === 'datalink'),
    `교체된 계선의 관측 매체가 실제로 datalink다 (${chatHops.length}건)`);
  // 오버라이드가 없는 실행은 원장 키 자체가 없어야 한다(빈 원장과 미적용을 가른다)
  const plain = KJ.runDES(base('asis'));
  assert(plain.linkMediaOverrides === undefined, '오버라이드 없는 실행에는 원장 키가 없다');
  let threw = false;
  try { KJ.runDES(base('asis', { linkMediaOverrides: { [CHAT_KEY]: '초광속' } })); }
  catch (e) { threw = /알 수 없는 계선 매체/.test(e.message); }
  assert(threw, '카탈로그에 없는 매체는 예외로 거부한다 — 근거 없는 수치를 만들 수 없다');
}

// As-Is에는 사람 매개 채널(음성·문자·VTC)이 실제로 쓰이고, To-Be에는 쓰이지 않는다 —
// 프로토타입 화면이 보여주려는 대비가 관측에 실제로 실리는지 확인한다.
// ⚠️ "느린 매체가 없다"가 아니라 "**사람이 끼는 매체**가 없다"를 본다.
const HUMAN = ['voice', 'chat', 'voice-vtc'];
const asisMedia = new Set(KJ.runDES(base('asis', { flowTrace: true })).flowEvents
  .filter((e) => e.k === 'link').map((e) => e.mt));
const tobeMedia = new Set(KJ.runDES(base('tobe', { flowTrace: true })).flowEvents
  .filter((e) => e.k === 'link').map((e) => e.mt));
console.log('\n-- 모드별 매체 --');
console.log('  As-Is:', [...asisMedia].sort().join(', '));
console.log('  To-Be:', [...tobeMedia].sort().join(', '));
assert(HUMAN.some((m) => asisMedia.has(m)), 'As-Is는 사람 매개 채널(음성·문자·VTC)을 실제로 지난다');
assert(!HUMAN.some((m) => tobeMedia.has(m)), 'To-Be는 사람 매개 채널을 지나지 않는다');

console.log(fail ? `\n실패 ${fail}건` : '\nOK — 전체 통과');
process.exit(fail ? 1 : 0);
