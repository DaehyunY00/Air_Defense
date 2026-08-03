/**
 * ADR-083 — [분석] 탭 「탐지 → 발사 파이프라인 시간표」 단일화 회귀.
 *
 * 종전에는 [분석] 탭에 시간표가 **둘**이었다 — ①-2「결심시간 분해」(decisionSplit)와
 * ②「구간별 소요시간」(gateStats). 관문 정의·기준점·코호트가 서로 달라 같은 실행에서도
 * 정의가 같은 구간의 평균이 어긋났고(실측 SC3: 115.5초 vs 128.2초), "어디서 벌어졌고
 * 어디서 개선됐나"를 한 화면에서 판단할 수 없었다. ADR-083에서 하나로 합쳤다.
 *
 * 이 스위트가 고정하는 것 — 표가 **거짓말하지 않는 조건**들이다:
 *  1) 산술 정합 — 코호트의 **모든 항적**에서 ①+②+③+④+⑤ = ⑥ (④를 잔여로 정의한 결과)
 *  2) ③ 승인·협조 — 승인 마크가 없으면(자기승인 축·권한위임) **0초**, 있으면 승인완료−개시
 *  3) prep = ident 동일성 — 두 마크는 같은 완료 콜백에서 연속으로 찍혀 항상 같은 시각이다.
 *     (그래서 「융합→식별확정」을 별도 관문으로 두지 않는다 — 잴 것이 없다.)
 *  4) 단일 코호트 — 전 줄이 같은 항적 집합. 구간별로 표본이 갈리면 부분의 합이 합계와 어긋난다.
 *  5) 순수 후처리 — 후처리기를 두 번 돌려도 같은 값이고, 원본 trace를 건드리지 않는다.
 *  6) 구표 검산 — 같은 코호트로 재계산하면 새 ①+② = 구 ①-2의 ①, 새 ③+④ = 구 ①-2의 ②
 *  7) UI 계약 — 카드가 한 장으로 합쳐졌고 구 함수·구 컨테이너가 남아 있지 않다
 *
 * ⚠️ 화면과 이 스위트는 **같은 함수**(KJ.panels.pipelineStats)를 본다. 검증용으로 식을
 *    다시 쓰면 화면과 회귀가 갈라져, 정합이 깨져도 초록불이 뜬다.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(dir, '..');
const root = path.join(repo, 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/c2-report.js', 'engine/sim-engine.js', 'ui/panels.js'
].forEach(function (f) { require(path.join(root, f)); });
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function note(m) { console.log('  NOTE ' + m); }

// 기본 플래그(ADR-065~072 기본 ON) + 계측 3종 — 화면이 실제로 쓰는 조합.
const FEATURES = {
  highResolutionDeployment: true, approvalChain: true, threatTargetDispersion: true,
  southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  unifiedEngagementState: true, sawtoothFreshness: true, selfDefenseFire: true,
  decisionAudit: true, shadowEval: true, windowMargin: true
};
function run(mode) {
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2', c2Analysis: true,
    features: FEATURES, trace: true, traceCap: 300
  });
}
const resA = run('asis'), resB = run('tobe');
const ta = resA.threatTraces || [], tb = resB.threatTraces || [];
const { pipelineStats, gateT } = KJ.panels;
assert(typeof pipelineStats === 'function' && typeof gateT === 'function',
  '후처리기가 KJ.panels로 노출됨 (화면과 회귀가 같은 함수를 본다)');
assert(ta.length > 0 && tb.length > 0, 'trace가 양 모드에서 실려 옴 (' + ta.length + ' / ' + tb.length + ')');

const rows = pipelineStats(ta, tb);
const byKey = {};
rows.forEach(function (r) { byKey[r.p.key] = r; });
const SPANS = ['in', 'proc', 'appr', 'fc', 'out'];
note('SC3 코호트 ' + rows.cohort + '건 / 짝지은 ' + rows.paired + '건 · 승인경유 As-Is ' +
  rows.approvedN.a + '→To-Be ' + rows.approvedN.b + ' · 교전중복해소 ' +
  rows.dedupN.a + '/' + rows.dedupN.b + ' · 자위권발사(선정 없이) ' +
  rows.selfDefN.a + '/' + rows.selfDefN.b);
SPANS.concat(['total']).forEach(function (k) {
  note('  ' + byKey[k].p.label + ' — As-Is ' + byKey[k].a.toFixed(2) +
    '초 → To-Be ' + byKey[k].b.toFixed(2) + '초 (Δ ' + byKey[k].d.toFixed(2) + '초)');
});

console.log('\n== 1) 산술 정합 — 항적마다 ①+②+③+④+⑤ = ⑥ ==');
{
  assert(rows.cohort > 0, '코호트가 비어 있지 않음');
  let worst = 0, negFc = 0, negAppr = 0;
  rows.cohortRows.forEach(function (c) {
    ['a', 'b'].forEach(function (m) {
      const sum = SPANS.reduce(function (s, k) { return s + rows.span(c[m], byKey[k].p); }, 0);
      worst = Math.max(worst, Math.abs(sum - rows.span(c[m], byKey.total.p)));
      if (rows.span(c[m], byKey.fc.p) < -1e-9) negFc++;
      if (rows.span(c[m], byKey.appr.p) < -1e-9) negAppr++;
    });
  });
  assert(worst < 1e-6, '항적별 구간 합 = 합계 (최대오차 ' + worst.toExponential(2) + ' < 1e-6)');
  // ④는 잔여이므로 ③이 [prep, assign] 창을 넘으면 음수가 된다. 한 항적을 두 축이 동시에
  // 다룰 때 실제로 생기는 상황이라(실측 SC3: 9건), 창 클램프가 없으면 표가 음수 구간을 낸다.
  assert(negFc === 0, '④ 사격통제 성립 대기가 어떤 항적에서도 음수가 아님 (창 클램프 작동)');
  assert(negAppr === 0, '③ 승인·협조가 어떤 항적에서도 음수가 아님');
  // 표 평균 차원에서도 같은 항등이 성립해야 한다(평균의 합 = 합의 평균).
  const avgSum = SPANS.reduce(function (s, k) { return s + byKey[k].a; }, 0);
  assert(Math.abs(avgSum - byKey.total.a) < 1e-6, '평균 차원에서도 구간 합 = 합계 (As-Is)');
  const avgSumB = SPANS.reduce(function (s, k) { return s + byKey[k].b; }, 0);
  assert(Math.abs(avgSumB - byKey.total.b) < 1e-6, '평균 차원에서도 구간 합 = 합계 (To-Be)');
  // 누적 도달 시각은 단조 증가여야 주 지표로 쓸 수 있다(부호가 안 뒤집힌다).
  let monoOk = true, prevA = 0, prevB = 0;
  rows.forEach(function (r) {
    if (r.p.ref || r.p.total) return;
    if (r.ca < prevA - 1e-9 || r.cb < prevB - 1e-9) monoOk = false;
    prevA = r.ca; prevB = r.cb;
  });
  assert(monoOk, '누적 도달 시각이 단조 증가 (주 지표로 쓸 수 있는 조건)');
  assert(Math.abs(byKey.total.a - prevA) < 1e-6 && Math.abs(byKey.total.b - prevB) < 1e-6,
    '마지막 구간의 누적 = 합계행');
}

console.log('\n== 2) ③ 승인·협조 — 마크 부재는 제외가 아니라 0초 ==');
{
  const idx = {};
  ta.forEach(function (t) { idx['a' + t.id] = t; });
  tb.forEach(function (t) { idx['b' + t.id] = t; });
  let noMarkZero = 0, noMarkNonZero = 0, exact = 0, clamped = 0, over = 0;
  rows.cohortRows.forEach(function (c) {
    ['a', 'b'].forEach(function (m) {
      const tr = idx[m + c.id];
      const s = gateT(tr, 'approveStart'), e = gateT(tr, 'approveEnd');
      if (s == null || e == null) {
        if (c[m].appr === 0) noMarkZero++; else noMarkNonZero++;
        return;
      }
      const raw = e - s;
      if (Math.abs(c[m].appr - raw) < 1e-9) exact++;
      else if (c[m].appr < raw + 1e-9) clamped++;
      else over++;
    });
  });
  assert(noMarkNonZero === 0,
    '승인 마크가 없는 항적은 전부 ③ = 0초 (' + noMarkZero + '건 — 자기승인 축·권한위임)');
  assert(noMarkZero > 0, '자기승인 축만 있는 항적이 실제로 코호트에 존재 (0초 규칙이 死조항 아님)');
  assert(exact > 0, '승인 계선을 경유한 항적의 ③ = 승인완료 − 협조/감독승인개시 (' + exact + '건 일치)');
  assert(over === 0, '③이 원(原) 승인 구간보다 커지는 항적 없음');
  note('창 클램프로 줄어든 항적 ' + clamped + '건 — 두 축이 한 항적을 동시에 다룰 때 승인 구간이 ' +
    '[준비, 선정] 창 밖으로 나가는 경우다(클램프가 없으면 ④가 음수가 된다).');
  // LOCAL_AD 축(육군 국지방공)에만 승인 계선이 붙는다 — 승인 마크는 그 축에서만 나와야 한다.
  const apprAxes = {};
  ta.concat(tb).forEach(function (tr) {
    (tr.stages || []).forEach(function (st) {
      if (st.name.indexOf('협조개시:') === 0 || st.name.indexOf('감독승인개시:') === 0) {
        apprAxes[String(st.axis).split('|')[0]] = (apprAxes[String(st.axis).split('|')[0]] || 0) + 1;
      }
    });
  });
  assert(Object.keys(apprAxes).length > 0 && Object.keys(apprAxes).every(function (k) { return k === 'LOCAL_AD'; }),
    '승인·협조 마크는 LOCAL_AD 축에서만 발생 (' + JSON.stringify(apprAxes) + ')');
}

console.log('\n== 3) 위협판단·표적할당준비 = 식별확정 (관문을 나누지 않는 근거) ==');
{
  let same = 0, diff = 0;
  ta.concat(tb).forEach(function (tr) {
    const i = gateT(tr, 'ident'), p = gateT(tr, 'prep');
    if (i == null || p == null) return;
    if (Math.abs(i - p) < 1e-12) same++; else diff++;
  });
  assert(same > 0 && diff === 0,
    '식별확정과 할당준비가 항상 같은 시각 (' + same + '건 전부 일치) — 두 마크는 같은 완료 콜백에서 찍힌다');
  // `책임C2:`도 관문으로 쓰지 않는다. 엔진이 센서 **보고** 이벤트에서 찍는데 그것이 대개
  // 탐지와 같은 이벤트라, 재는 것은 C2가 일한 시간이 아니라 보고 틱이다.
  // ⚠️ "항상 0초"는 과장이었다 — 어긋나는 건이 실제로 있다. 다만 그 차이는 보고주기 한 칸
  //    (최장 16초, 그린파인)을 넘지 못한다. 넘는다면 그것은 C2 처리시간이 섞인 것이므로 결함이다.
  let cmdSame = 0, cmdDiff = 0, cmdMax = 0;
  ta.concat(tb).forEach(function (tr) {
    const d = gateT(tr, 'detect');
    const c = (tr.stages || []).find(function (s) { return s.name.indexOf('책임C2:') === 0; });
    if (d == null || !c) return;
    if (Math.abs(c.t - d) < 1e-12) cmdSame++;
    else { cmdDiff++; cmdMax = Math.max(cmdMax, Math.abs(c.t - d)); }
  });
  const cmdTot = cmdSame + cmdDiff;
  assert(cmdSame / cmdTot >= 0.9,
    '책임C2 지정이 대부분 탐지와 같은 시각 (' + cmdSame + '/' + cmdTot + ') — 관문으로 쓸 게 없다');
  assert(cmdMax <= 16 + 1e-9,
    '어긋나는 건도 센서 보고주기 한 칸 이내 (최대 ' + cmdMax.toFixed(2) + '초 ≤ 16초) — C2 처리시간이 아님');
}

console.log('\n== 4) 단일 코호트 · 순수 후처리 ==');
{
  const KEYS = ['spawn', 'detect', 'fuse', 'prep', 'assign', 'fire'];
  const byB = {};
  tb.forEach(function (t) { byB[t.id] = t; });
  let expect = 0;
  ta.forEach(function (a) {
    const b = byB[a.id];
    if (!b) return;
    if (KEYS.every(function (k) { return gateT(a, k) != null && gateT(b, k) != null; })) expect++;
  });
  assert(rows.cohort === expect,
    '코호트 = 양 모드 전 관문 통과 항적 (' + rows.cohort + '건, 독립 재계산과 일치)');
  assert(rows.every(function (r) { return r.p.ref || r.n === rows.cohort; }),
    '모든 줄이 같은 n을 씀 (구간마다 표본이 갈리지 않음)');
  assert(rows.cohort < rows.paired, '제외가 실제로 발생 — 공시 대상 (' +
    (rows.paired - rows.cohort) + '건 제외)');
  // 순수성: 두 번 돌려도 같은 값이고 원본 trace를 건드리지 않는다.
  const before = JSON.stringify(ta.slice(0, 20));
  const again = pipelineStats(ta, tb);
  assert(JSON.stringify(ta.slice(0, 20)) === before, '후처리가 원본 trace를 변형하지 않음');
  assert(rows.map(function (r) { return [r.a, r.b, r.ca, r.cb]; }).join('|') ===
    again.map(function (r) { return [r.a, r.b, r.ca, r.cb]; }).join('|'),
    '같은 입력을 두 번 후처리하면 완전히 같은 결과(결정론)');
  // 참고행은 센서 물리 — CRN 짝맞춤이 공정하면 양 모드가 같아야 한다.
  assert(Math.abs(rows[0].d) < 1e-9,
    '참고행(침투→탐지)이 양 모드 동일 — CRN 공정성 증거 (Δ ' + rows[0].d.toExponential(2) + ')');
  assert(rows[0].ca === null && rows[0].cb === null, '참고행은 누적(탐지 기준)에 들어가지 않음');
}

console.log('\n== 5) 구표 검산 — 같은 코호트로 재계산하면 구 ①-2와 일치 ==');
{
  // 구 decisionSplit: ① = 탐지→준비, ② = 준비→선정. 새 표는 ①+② / ③+④가 이에 대응한다.
  let o1a = 0, o1b = 0, o2a = 0, o2b = 0;
  rows.cohortRows.forEach(function (c) {
    o1a += c.a.prep - c.a.detect; o1b += c.b.prep - c.b.detect;
    o2a += c.a.assign - c.a.prep; o2b += c.b.assign - c.b.prep;
  });
  const n = rows.cohort;
  const chk = [
    ['구 ①-2의 ① (탐지→준비) As-Is', o1a / n, byKey.in.a + byKey.proc.a],
    ['구 ①-2의 ① (탐지→준비) To-Be', o1b / n, byKey.in.b + byKey.proc.b],
    ['구 ①-2의 ② (준비→선정) As-Is', o2a / n, byKey.appr.a + byKey.fc.a],
    ['구 ①-2의 ② (준비→선정) To-Be', o2b / n, byKey.appr.b + byKey.fc.b]
  ];
  chk.forEach(function (c) {
    assert(Math.abs(c[1] - c[2]) < 1e-9,
      c[0] + ' = ' + c[1].toFixed(3) + '초 ↔ 새 표 ' + c[2].toFixed(3) + '초');
  });
  // 구 ②표의 합계는 침투→발사였다 — 참고행 + 새 합계로 복원된다(기준점만 옮겼음을 고정).
  assert(Math.abs((rows[0].a + byKey.total.a) -
    rows.cohortRows.reduce(function (s, c) { return s + (c.a.fire - c.a.spawn); }, 0) / n) < 1e-9,
    '참고행 + 새 합계 = 구 ②표의 침투→발사 합계 (기준점만 옮겼을 뿐 값은 보존)');
}

console.log('\n== 6) UI 계약 — 카드 2장이 1장으로 ==');
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const panels = fs.readFileSync(path.join(root, 'ui/panels.js'), 'utf8');
  assert(html.indexOf('id="analysis-pipeline"') !== -1, '단일 컨테이너 analysis-pipeline 존재');
  assert(panels.indexOf("'analysis-pipeline'") !== -1, '렌더러가 analysis-pipeline을 채움');
  assert(html.indexOf('id="analysis-decision"') === -1 && html.indexOf('id="analysis-gates"') === -1,
    '구 컨테이너(analysis-decision·analysis-gates) 제거');
  assert(!/function gateStats/.test(panels) && !/function decisionSplit/.test(panels),
    '구 후처리기(gateStats·decisionSplit) 제거 — 시간표 두 벌 금지');
  assert(/function pipelineStats/.test(panels), 'pipelineStats 신설');
  // "승인까지"류 오분류 문구가 남으면 표를 고쳐도 설명이 거짓말을 한다.
  assert(panels.indexOf('위협평가·승인까지') === -1,
    '구 오분류 문구(①이 승인까지 포함) 제거 — 승인은 ③으로 분리됐다');
  // ④를 C2 성과로 서술하면 안 되고, 승인 외 조율 대기가 섞였음을 숨겨서도 안 된다.
  assert(/C2 성능이 아니다/.test(panels), '④가 C2 성능이 아님을 명시');
  assert(/교전중복해소/.test(panels), '④에 교전중복해소 대기가 섞임을 공시');
  assert(/격추·누수를 대체하지 않습니다/.test(panels), '임무 지표 대체 금지 문구 유지');
  // 성격 배지 5종 — Δ가 어느 성격의 구간에서 났는지가 표에서 바로 읽혀야 한다.
  ['C2 입력', 'C2 처리', 'C2 구조', '물리 · 조율', 'C2 출력', '센서 물리'].forEach(function (tag) {
    assert(panels.indexOf("'" + tag + "'") !== -1 || panels.indexOf(tag) !== -1,
      '성격 배지 「' + tag + '」 정의');
  });
  const css = fs.readFileSync(path.join(repo, 'css/style.css'), 'utf8');
  ['.an-pipe', '.bd-c2', '.bd-struct', '.bd-phys', '.an-ref'].forEach(function (sel) {
    assert(css.indexOf(sel) !== -1, 'CSS ' + sel + ' 정의');
  });
  const singlePath = path.join(repo, 'K-JAMDS_시뮬레이터_단일본.html');
  if (fs.existsSync(singlePath)) {
    const single = fs.readFileSync(singlePath, 'utf8');
    assert(single.indexOf('id="analysis-pipeline"') !== -1, '단일본에 새 컨테이너 인라인');
    assert(single.indexOf('function pipelineStats') !== -1, '단일본에 새 후처리기 인라인');
    assert(single.indexOf('id="analysis-gates"') === -1, '단일본에서 구 컨테이너 제거됨(재빌드 확인)');
  } else {
    assert(false, '단일본 파일이 존재해야 한다');
  }
}

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
