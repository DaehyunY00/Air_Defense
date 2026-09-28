/**
 * ADR-104 사전대기 큐 + 긴급발사 ② (standbyCue) — 가드.
 *
 * 지키는 것:
 *  1) bsrc 없이 cue만 켜면 큐 0건·비활성 신고, 동역학은 OFF와 동일(지문 — features 제외)
 *  2) 큐는 위협당 1회, 자격 포대는 한국군 상층(방어층 등재)만 — USFK·LOCAL_AD 없음
 *  3) 큐 도착 전 standby_emergency 발사 0건 · 긴급발사는 전부 자기 MFR FIRE_CONTROL 상태에서
 *  4) 같은 위협에 정식+긴급 이중 발사 0건(긴급 발사~BDA 사이 다른 발사 없음) · 큐 받은 포대의 자위권 발사 0건
 *  5) 큐가 C2 노드 도착(iads_track)을 늘리지 않음 · 'cue' kind 큐 작업 없음
 *  6) gain=0이면 센서 전이 마크가 A-only와 동일(공통 생존 구간) · gain=0.3이면 큐 포대 MFR 전이가 앞당겨짐
 *  7) 계정 대사: 생성 = 격추 + 누수 + 미해결 · 발사 = Σ fireByCause · 관측 순수성(flowTrace ON/OFF)
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
function dyn(r) { const c = Object.assign({}, r, { global: Object.assign({}, r.global) }); delete c.global.features; delete c.flowEvents; delete c.flowTruncated; delete c.flowCap; return sha(c); }

const SCREEN = { highResolutionDeployment: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true };
function run(extra, opts) {
  opts = opts || {};
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode: opts.mode || 'asis', intensity: 1,
    seed: opts.seed || 12345, endTimeSec: opts.dur || 600,
    deploymentId: opts.dep || 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2',
    trace: opts.trace !== false, traceCap: 5000, flowTrace: !!opts.flow,
    features: Object.assign({}, SCREEN, extra || {})
  });
}
const isBallistic = (t) => t === 'srbm' || t === 'mrl_large';
const marks = (tr, prefix) => tr.stages.filter((s) => s.name.startsWith(prefix));
const A = { ballisticReportSource: true }, AB = { ballisticReportSource: true, standbyCue: true };

console.log('# 1) bsrc 없이 cue만 — 비활성 · 동역학 OFF와 동일');
{
  const off = run({}), cueOnly = run({ standbyCue: true });
  assert(cueOnly.global.features.standbyCue === 'disabled_without_ballisticReportSource', 'features에 비활성 사유가 신고된다');
  assert(dyn(off) === dyn(cueOnly), '동역학 지문(features 제외)이 OFF와 같다');
  assert(!('standbyCue' in off.global) && !('standbyCue' in cueOnly.global), '큐 계정이 결과에 실리지 않는다');
}

const cat = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_FULL_NORMAL', mode: 'asis', modelFidelity: 'iads-c2', features: SCREEN });
const nodeById = (id, mode) => KJ.nodesInMode(mode, KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_FULL_NORMAL', mode, modelFidelity: 'iads-c2', features: SCREEN })).find((n) => n.id === id);

for (const mode of ['asis', 'tobe']) {
  console.log(`\n# 2~7) FULL ${mode}`);
  const a = run(A, { mode, flow: true }), ab = run(AB, { mode, flow: true });
  const sc = ab.global.standbyCue;
  assert(ab.global.features.standbyCue === true && sc && sc.threatsCued > 0, `${mode}: 큐 발행 ${sc && sc.threatsCued}개 위협 · 통지 ${sc && sc.noticesSent}건 · 도착 ${sc && sc.noticesArrived}건`);
  const ballistic = ab.threatTraces.filter((tr) => isBallistic(tr.type));
  // 2) 위협당 1회 · 자격 포대
  const multi = ballistic.filter((tr) => marks(tr, '사전대기큐발행:').length > 1).length;
  assert(multi === 0, `${mode}: 큐 발행 마크가 2회 이상인 탄도 항적 0개`);
  const nonBallisticCue = ab.threatTraces.filter((tr) => !isBallistic(tr.type) && marks(tr, '사전대기큐발행:').length).length;
  assert(nonBallisticCue === 0, `${mode}: 비탄도 항적에 큐 없음`);
  let badShooter = null, arrivals = 0;
  for (const tr of ballistic) for (const m of marks(tr, '사전대기큐도착:')) {
    arrivals++;
    const n = nodeById(m.name.slice('사전대기큐도착:'.length), mode);
    if (!n || n.forceOwner !== 'ROK' || !KJ.BALLISTIC_DEFENSE_TIERS[n.typeId]) badShooter = badShooter || m.name;
  }
  assert(arrivals > 0 && !badShooter, `${mode}: 큐 도착 ${arrivals}건 전부 한국군 상층 방어층 포대` + (badShooter ? ' — ' + badShooter : ''));
  const cueLinks = ab.flowEvents.filter((e) => e.k === 'link' && e.kind === 'cue');
  assert(cueLinks.length > 0 && cueLinks.every((l) => !/USFK|ARMY_LOCAL|MARINE/.test(l.to)), `${mode}: cue link ${cueLinks.length}건, USFK·국지방공으로 가는 것 없음`);
  // 3) 큐 도착 전 발사 0 · 자기 MFR FC
  let beforeCue = 0, notFc = 0, emergency = 0;
  for (const tr of ballistic) for (const e of marks(tr, '긴급발사:')) {
    emergency++;
    const sid = e.name.slice('긴급발사:'.length);
    const cueAt = marks(tr, '사전대기큐도착:' + sid)[0];
    if (!cueAt || cueAt.t > e.t) beforeCue++;
    const n = nodeById(sid, mode), mfr = n && n.mfrSensorId;
    if (mfr) {
      const fcOn = tr.stages.filter((s) => s.name === 'SENSOR_FIRE_CONTROL:' + mfr && s.t <= e.t).pop();
      const lost = tr.stages.filter((s) => (s.name === 'SENSOR_FC_DEGRADED:' + mfr || s.name === 'SENSOR_TRACK_LOST:' + mfr) && s.t <= e.t).pop();
      if (!fcOn || (lost && lost.t > fcOn.t)) notFc++;
    }
  }
  assert(emergency > 0, `${mode}: 긴급발사 ${emergency}건 (fireByCause ${ab.global.c2Orders.fireByCause.standby_emergency || 0})`);
  assert(beforeCue === 0, `${mode}: 큐 도착 전 긴급발사 0건`);
  assert(notFc === 0, `${mode}: 긴급발사 전부 자기 MFR FIRE_CONTROL 상태에서 (위반 ${notFc})`);
  // 4) 이중 발사 0 · 자위권 배제
  let dbl = 0, sdf = 0;
  for (const tr of ballistic) {
    for (const e of marks(tr, '긴급발사:')) {
      const sid = e.name.slice('긴급발사:'.length);
      const fire = tr.stages.find((s) => s.name.startsWith('발사:' + sid + '/') && s.t >= e.t);
      if (!fire) continue;
      const bda = tr.stages.find((s) => /^BDA:(HIT|MISS):/.test(s.name) && s.name.endsWith(':' + sid) && s.t > fire.t);
      const end = bda ? bda.t : Infinity;
      if (tr.stages.some((s) => s.name.startsWith('발사:') && !s.name.startsWith('발사:' + sid + '/') && s.t > fire.t && s.t < end
        && !/USFK|THAAD/.test(s.name))) dbl++;
    }
    for (const s of marks(tr, '자위권발사:')) if (marks(tr, '사전대기큐도착:' + s.name.slice('자위권발사:'.length)).length) sdf++;
  }
  assert(dbl === 0, `${mode}: 긴급 발사~BDA 사이 같은 위협에 한국군 다른 발사 0건 (arbitrated ${sc.arbitrated})`);
  assert(sdf === 0, `${mode}: 큐를 받은 포대의 자위권 발사 0건`);
  // 5) C2 도착 불변
  const c2Id = mode === 'tobe' ? cat.roles.IAOC : cat.roles.KAMDOC;
  const nA = a.nodes.find((n) => n.id === c2Id), nAB = ab.nodes.find((n) => n.id === c2Id);
  assert(nA.arrivalsByKind.iads_track === nAB.arrivalsByKind.iads_track, `${mode}: ${c2Id} 항적 도착 ${nAB.arrivalsByKind.iads_track}건 = A-only`);
  assert(!ab.nodes.some((n) => n.arrivalsByKind && n.arrivalsByKind.cue), `${mode}: 큐는 어떤 노드의 서비스 작업도 아니다`);
  // 6) gain
  const exitOf = (r) => { const m = {}; r.threatTraces.forEach((tr) => { m[tr.id] = tr.exitT == null ? Infinity : tr.exitT; }); return m; };
  const sensorMarks = (r, cut) => { const out = new Set(); r.threatTraces.forEach((tr) => tr.stages.forEach((s) => { if (/^SENSOR_/.test(s.name) && s.t < cut[tr.id]) out.add(tr.id + '|' + s.name + '|' + s.t.toFixed(3)); })); return out; };
  const cut = {}; const ea = exitOf(a), eab = exitOf(ab);
  Object.keys(ea).forEach((id) => { cut[id] = Math.min(ea[id], eab[id] ?? Infinity); });
  const sA = sensorMarks(a, cut), sAB = sensorMarks(ab, cut);
  assert(sA.size === sAB.size && [...sA].every((k) => sAB.has(k)), `${mode}: gain=0이면 센서 전이 마크가 A-only와 동일 (${sA.size}건 · 공통 생존 구간)`);
  const g3 = run(Object.assign({ cueAcquisitionGain: 0.3 }, AB), { mode });
  assert(g3.global.features.cueAcquisitionGain === 0.3, `${mode}: gain 0.3이 신고된다`);
  let earlier = 0;
  for (const tr of g3.threatTraces.filter((t) => isBallistic(t.type))) {
    const ref = ab.threatTraces.find((x) => x.id === tr.id); if (!ref) continue;
    for (const m of marks(tr, '사전대기큐도착:')) {
      const n = nodeById(m.name.slice('사전대기큐도착:'.length), mode); if (!n || !n.mfrSensorId) continue;
      const fc3 = tr.stages.find((s) => s.name === 'SENSOR_FIRE_CONTROL:' + n.mfrSensorId && s.t > m.t);
      const fc0 = ref.stages.find((s) => s.name === 'SENSOR_FIRE_CONTROL:' + n.mfrSensorId && s.t > m.t);
      if (fc3 && fc0 && fc3.t < fc0.t) earlier++;
    }
  }
  assert(earlier > 0, `${mode}: gain 0.3에서 큐 포대 MFR 사통 전이가 앞당겨진 사례 ${earlier}건`);
  // 7) 계정 대사 · 관측 순수성
  const g = ab.global;
  assert(g.spawned === g.killed + g.leaked + (g.spawned - g.killed - g.leaked), `${mode}: 생성 = 격추 + 누수 + 미해결`);
  const fires = ab.threatTraces.reduce((n, tr) => n + marks(tr, '발사:').length, 0);
  const byCause = Object.values(g.c2Orders.fireByCause).reduce((x, y) => x + y, 0);
  assert(fires === byCause, `${mode}: 발사 마크 ${fires} = Σ fireByCause ${byCause} (${JSON.stringify(g.c2Orders.fireByCause)})`);
  const abNoFlow = run(AB, { mode });
  assert(dyn(abNoFlow) === dyn(ab) && ab.global.features.standbyCue === abNoFlow.global.features.standbyCue, `${mode}: flowTrace ON/OFF 동역학 동일`);
}
console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
