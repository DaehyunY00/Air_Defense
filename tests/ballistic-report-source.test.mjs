/**
 * ADR-103 탄도 위협 시작 보고원 고정 (ballisticReportSource) — 가드.
 *
 * 지키는 것:
 *  1) OFF 골든 bit-exact — LEGACY·FULL × As-Is/To-Be(화면 기본 플래그) 지문 불변 + wire shape(키 없음)
 *  2) ON: 탄도 항적의 탄도 책임 C2(As-Is KAMD_OPS · To-Be IAOC) 첫 link 사건이 그린파인 report-cycle
 *  3) ON: MCRC를 지나는 탄도 항적 link 사건 0건(MCRC→ICC→KAMD_OPS 중계 소멸)
 *  4) ON: 비탄도 항적의 **보고**(kind report) link 집합이 OFF와 동일(th·from·to) · USFK 축 보고 link는 항적 생존 구간 안에서 동일
 *  5) ON: flowTrace ON/OFF 지문 동일(관측 순수성)
 *  6) ON: 그린파인 미획득 탄도 항적에 no_ew_report 증거, started + missing = 탄도 생성 수
 *  7) KAMDOC_DOWN: 권역 ICC로 가는 시작 보고도 그린파인
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
function fingerprint(r) { const c = Object.assign({}, r); delete c.flowEvents; delete c.flowTruncated; delete c.flowCap; return sha(c); }

// [지휘 흐름] 화면 기본 플래그(엔진 기본 OFF 예외 5종 포함) — 골든은 이 조건에서 잰다.
const SCREEN = { highResolutionDeployment: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true };
function run(extra, opts) {
  opts = opts || {};
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode: opts.mode || 'asis', intensity: 1,
    seed: opts.seed || 12345, endTimeSec: opts.dur || 600,
    deploymentId: opts.dep || 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2',
    trace: !!opts.trace, traceCap: 5000, flowTrace: !!opts.flow,
    features: Object.assign({}, SCREEN, extra || {})
  });
}
const isBallistic = (t) => t === 'srbm' || t === 'mrl_large';

console.log('# 1) OFF는 골든 지문 그대로 (켜야만 움직인다)');
const GOLDEN = {
  'HANBANDO_LEGACY_NORMAL|asis': '3b7c0fbea72228641a2f49f59e5ad7547abaf520adc995ea2ad9dd2a7f27972c',
  'HANBANDO_LEGACY_NORMAL|tobe': '0c8c9c24e9aa90e8a78392bd431e2d5441f455b1da9a050f6c3dfabad4fddd4c',
  'HANBANDO_FULL_NORMAL|asis': 'f5e18f3a8cb7c2a8ee61b689c59cd4e20cd2a71aae8fcd45f23d1ef90ad22dc2',
  'HANBANDO_FULL_NORMAL|tobe': '4b2c78c39d1838a5fab1c98809d1f73ae4033594bfa6562eeb9b1298295ec7d6'
};
for (const key of Object.keys(GOLDEN)) {
  const [dep, mode] = key.split('|');
  const r = run({}, { dep, mode });
  assert(sha(r) === GOLDEN[key], `${key} OFF = 골든`);
  assert(!('ballisticReportSource' in r.global.features), `${key} OFF wire shape 불변 (키가 실리지 않는다)`);
  assert(!('ballisticEwStarted' in r.global.coordination.trackFusion), `${key} OFF trackFusion 계정 키 없음`);
}

for (const mode of ['asis', 'tobe']) {
  console.log(`\n# 2~6) ON — FULL ${mode}`);
  const off = run({}, { mode, trace: true, flow: true });
  const on = run({ ballisticReportSource: true }, { mode, trace: true, flow: true });
  const cat = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_FULL_NORMAL', mode, modelFidelity: 'iads-c2', features: SCREEN });
  const balC2 = mode === 'tobe' ? cat.roles.IAOC : cat.roles.KAMDOC, mcrc = cat.roles.MCRC;
  assert(on.global.features.ballisticReportSource === true, `${mode}: ON이면 features에 신고된다`);
  assert(sha(on) !== sha(off), `${mode}: ON은 실제로 다른 결과`);

  const links = (r) => r.flowEvents.filter((e) => e.k === 'link' && e.mt !== 'fanout');
  const byTh = (r) => { const m = {}; links(r).forEach((l) => (m[l.th] = m[l.th] || []).push(l)); Object.values(m).forEach((a) => a.sort((x, y) => x.t0 - y.t0)); return m; };
  const onBy = byTh(on), offBy = byTh(off);
  const ballistic = on.threatTraces.filter((tr) => isBallistic(tr.type));
  assert(ballistic.length > 20, `${mode}: 탄도 항적 ${ballistic.length}개 (표본 충분)`);

  // 2) 첫 보고가 그린파인 report-cycle
  let started = 0, badStart = null, viaMcrc = 0;
  for (const tr of ballistic) {
    const ls = onBy[tr.id] || [];
    const toC2 = ls.filter((l) => l.to === balC2);
    if (toC2.length) {
      started++;
      const first = toC2[0];
      if (!/GREEN_PINE/.test(first.from) || first.mt !== 'report-cycle') badStart = badStart || first;
    }
    if (ls.some((l) => l.from === mcrc || l.to === mcrc)) viaMcrc++;
  }
  assert(started > 0 && !badStart, `${mode}: 탄도 책임 C2로 간 첫 link ${started}건 전부 그린파인 report-cycle` + (badStart ? ' — 위반 ' + JSON.stringify(badStart) : ''));
  // 3) MCRC 경유 0
  const offViaMcrc = ballistic.filter((tr) => (offBy[tr.id] || []).some((l) => l.from === mcrc || l.to === mcrc)).length;
  assert(viaMcrc === 0, `${mode}: MCRC를 지나는 탄도 항적 link 0건 (OFF에서는 ${offViaMcrc}개 항적)`);
  if (mode === 'asis') assert(offViaMcrc > 0, 'asis: (대조) OFF에서는 탄도 항적이 MCRC를 지난다');

  // 4) 비탄도·USFK 보고 link 집합 불변
  const reportSet = (m, pred) => new Set(Object.values(m).flat().filter((l) => l.kind === 'report' && pred(l)).map((l) => l.th + '|' + l.from + '|' + l.to));
  const typeOf = (th) => th.split('#')[0];
  const abtOn = reportSet(onBy, (l) => !isBallistic(typeOf(l.th))), abtOff = reportSet(offBy, (l) => !isBallistic(typeOf(l.th)));
  assert(abtOn.size > 0 && [...abtOn].every((k) => abtOff.has(k)) && abtOn.size === abtOff.size,
    `${mode}: 비탄도 항적의 보고 link 집합이 OFF와 동일 (${abtOn.size}건)`);
  // USFK 축은 라우팅 규칙이 불변이지만 ON은 다른 표본이라 항적의 **수명**이 달라진다(한쪽에서 먼저 격추된
  // 항적은 나중 센서의 보고가 없다). 그래서 「상대 실행에서 그 항적이 아직 살아 있던 시각의 보고」만 대조한다.
  const usfk = (l) => /USFK|AN_TPY2/.test(l.from) || /USFK/.test(l.to);
  const exitOf = (r) => { const m = {}; r.threatTraces.forEach((tr) => { m[tr.id] = tr.exitT == null ? Infinity : tr.exitT; }); return m; };
  const exOn = exitOf(on), exOff = exitOf(off);
  const usfkLinks = (m) => Object.values(m).flat().filter((l) => l.kind === 'report' && usfk(l));
  const key = (l) => l.th + '|' + l.from + '|' + l.to;
  const uOnAll = new Set(usfkLinks(onBy).map(key)), uOffAll = new Set(usfkLinks(offBy).map(key));
  const missOn = usfkLinks(offBy).filter((l) => l.t0 < (exOn[l.th] ?? Infinity) && !uOnAll.has(key(l)));
  const missOff = usfkLinks(onBy).filter((l) => l.t0 < (exOff[l.th] ?? Infinity) && !uOffAll.has(key(l)));
  assert(uOnAll.size > 0 && missOn.length === 0 && missOff.length === 0,
    `${mode}: USFK 축 보고 link가 항적 생존 구간 안에서 OFF와 동일 (OFF ${uOffAll.size} · ON ${uOnAll.size}건)` +
    (missOn.length || missOff.length ? ' — 위반 ' + JSON.stringify((missOn[0] || missOff[0])) : ''));

  // 5) 관측 순수성
  const onNoFlow = run({ ballisticReportSource: true }, { mode, trace: true });
  assert(fingerprint(onNoFlow) === fingerprint(on), `${mode}: ON에서도 flowTrace ON/OFF 지문 동일`);

  // 6) 미획득 증거·계정 항등식
  const tf = on.global.coordination.trackFusion;
  assert(tf.ballisticEwStarted + tf.ballisticEwMissing === ballistic.length,
    `${mode}: started ${tf.ballisticEwStarted} + missing ${tf.ballisticEwMissing} = 탄도 생성 ${ballistic.length}`);
  assert(tf.ballisticEwStarted === started, `${mode}: started 계정 = 그린파인 시작 link가 있는 항적 수`);
  let evBad = null;
  for (const tr of ballistic) {
    const hasStart = (onBy[tr.id] || []).some((l) => l.to === balC2);
    const ev = (tr.failure && tr.failure.evidence) || tr.evidence || {};
    const hasEv = !!ev.no_ew_report;
    if (hasStart === hasEv) { evBad = evBad || (tr.id + ' start=' + hasStart + ' ev=' + hasEv); }
  }
  assert(!evBad, `${mode}: 시작 안 한 탄도 항적에만 no_ew_report 증거가 있다` + (evBad ? ' — ' + evBad : ''));
  const noRp = ballistic.filter((tr) => { const ev = (tr.failure && tr.failure.evidence) || tr.evidence || {}; return !!ev.no_report_path; }).length;
  assert(noRp === 0, `${mode}: 대기 중이던 탄도 항적에 no_report_path 증거가 남지 않는다 (${noRp})`);
}

console.log('\n# 7) KAMDOC_DOWN — 권역 ICC로 가는 시작 보고도 그린파인');
{
  const r = run({ ballisticReportSource: true }, { dep: 'HANBANDO_FULL_KAMDOC_DOWN', mode: 'asis', trace: true, flow: true });
  const ls = r.flowEvents.filter((e) => e.k === 'link' && e.mt !== 'fanout' && isBallistic(e.th.split('#')[0]));
  const toIcc = ls.filter((l) => /^C2_ICC_/.test(l.to) && l.kind === 'report');
  const bad = toIcc.find((l) => !/GREEN_PINE/.test(l.from));
  assert(toIcc.length > 0 && !bad, `DOWN: 탄도 항적의 ICC 보고 link ${toIcc.length}건 전부 그린파인 발신` + (bad ? ' — ' + JSON.stringify(bad) : ''));
  assert(!ls.some((l) => /C2_MCRC/.test(l.from) || /C2_MCRC/.test(l.to)), 'DOWN: MCRC를 지나는 탄도 항적 link 0건');
  const tf = r.global.coordination.trackFusion, n = r.threatTraces.filter((t) => isBallistic(t.type)).length;
  assert(tf.ballisticEwStarted + tf.ballisticEwMissing === n, `DOWN: started + missing = 탄도 생성 ${n}`);
}

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
