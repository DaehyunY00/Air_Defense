/**
 * ADR-074 — 그림자 평가(전역 최적) · 교전창 계측 회귀.
 *
 *  1) OFF bit-exact — 신규 플래그 OFF에서 Phase A 종료 시점(ADR-062)과 SHA-256 일치
 *  2) RNG 불변(핵심) — 그림자 평가 ON에서도 난수 소비 **횟수**가 OFF와 동일
 *  3) regret 건전성 — 항상 ≥ 0, 전역최적=실제선택이면 정확히 0
 *  4) USFK 독립 축 — ADR-036에 따라 그림자 반사실에서 제외(미측정으로 남김)
 *  5) 교전창 원장 — window_audit이 위협 전수와 1:1 (놓침률 분모의 생존 편향 제거)
 *  6) 교차검증 — 창 마감 뒤 결심은 0건. `window_lost_due_to_c2`와의 잔여 차이를 공시
 *  7) 방향 관측 — 실측된 것만 어서션하고, 방향이 없는 것은 NOTE로 남긴다
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
].forEach(function (f) { require(path.join(root, f)); });
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function note(m) { console.log('  NOTE ' + m); }

let rngCalls = 0;
const realMakeRng = KJ.makeRng;
KJ.makeRng = function (seed) {
  const r = realMakeRng(seed);
  const w = { seed: r.seed };
  ['raw', 'uniform', 'exponential', 'triangular', 'normal', 'lognormal', 'poisson']
    .forEach(function (k) { w[k] = function () { rngCalls++; return r[k].apply(r, arguments); }; });
  return w;
};
const realDerive = KJ.IADS.deriveStream;
KJ.IADS = Object.assign({}, KJ.IADS, {
  deriveStream: function () {
    const next = realDerive.apply(null, arguments);
    return function () { rngCalls++; return next(); };
  }
});

const CASES = ['sc1|asis', 'sc1|tobe', 'sc3|asis', 'sc3|tobe'];
// ADR-073 종료 시점(`decisionAudit`만 ON)의 지문 — Phase B 신규 플래그가 OFF면 여기서
// 한 발도 안 움직여야 한다. 전 플래그 OFF 지문은 `decision-audit.test.mjs`가 따로 잠근다.
// ADR-076 재산출 — 교전창 캐시 키 결함 수정으로 실제 경로의 값이 바뀌었다. 같은 커밋에서
// `_engagementWindowOf`의 전용 빈 캐시 격리 장치도 걷어냈다(키가 순수해져 불필요해졌다).
// 그 제거가 결과 중립임은 전 케이스 bit-exact로 실증했다 — 아래 지문은 제거 후 값이다.
const AUDIT_ONLY_SHA = {
  'sc1|asis': '72151d3075ba1aa1fcbd2790d9b0e39a6285c070be38e64c773cbfaa49af5882',
  // ADR-077 재고정: To-Be ABT 승인권자 MCRC → IAOC. As-Is 2케이스는 지문 불변.
  'sc1|tobe': '4ffadc1b4ad137369654ddbe1906b85425173a5eaa0711341ff1330807a50b92',
  'sc3|asis': 'ebbcef1b2f76478aed90d264ba58e58a1b27140163d0cb42021a6392c58fa718',
  'sc3|tobe': 'c38b4f2caf3bfd51b4b25e4cc83ce531aae29bb241ec643e8b22ec67b69cd69a'
};

function run(key, features, deploymentId) {
  const [sc, mode] = key.split('|');
  rngCalls = 0;
  const result = KJ.runDES({
    scenario: KJ.scenarioById(sc), mode, intensity: 1, seed: 12345, endTimeSec: 900,
    deploymentId: deploymentId || 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    c2Analysis: true,
    features: Object.assign({ highResolutionDeployment: true }, features || {})
  });
  const events = result.c2Events;
  return {
    result, rngCalls,
    sha256: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    audits: events.filter(function (e) { return e.type === 'decision_audit'; }),
    windows: events.filter(function (e) { return e.type === 'window_audit'; }),
    spawned: events.filter(function (e) { return e.type === 'THREAT_SPAWNED'; }),
    leaked: events.filter(function (e) { return e.type === 'THREAT_LEAKED'; })
  };
}
const FULL = { decisionAudit: true, shadowEval: true, windowMargin: true };
function pct(n, d) { return d ? (n / d * 100).toFixed(1) + '%' : 'n/a'; }

/** 교전창 놓침률 — 분모는 **창이 있었던 전 위협**(결심에 도달한 것만 보면 생존 편향). */
function missRate(r) {
  const firstDecision = {};
  r.audits.forEach(function (e) {
    if (firstDecision[e.threatId] == null || e.t < firstDecision[e.threatId]) {
      firstDecision[e.threatId] = e.t;
    }
  });
  let total = 0, missed = 0, undecided = 0;
  r.windows.forEach(function (w) {
    if (w.windowCloseT == null) return;   // 어떤 자산도 요격점을 못 잡음 — 분모에서 뺀다(미측정)
    total++;
    const d = firstDecision[w.threatId];
    if (d == null) { missed++; undecided++; }
    else if (w.windowCloseT - d < 0) missed++;
  });
  return { total, missed, undecided, rate: total ? missed / total : null };
}
function optimalRate(r) {
  const scored = r.audits.filter(function (e) { return e.regret != null; });
  const opt = scored.filter(function (e) { return e.regret === 0; }).length;
  return { n: scored.length, opt, rate: scored.length ? opt / scored.length : null };
}

console.log('== 1) 기준선 — 전 플래그 OFF / audit만 ON ==');
const off = {}, auditOnly = {}, on = {};
CASES.forEach(function (key) {
  off[key] = run(key);
  auditOnly[key] = run(key, { decisionAudit: true });
  assert(auditOnly[key].windows.length === 0,
    key + ' windowMargin OFF에서 window_audit 0건');
  assert(auditOnly[key].audits.every(function (a) {
    return a.regret === undefined && a.engagementWindowMargin === undefined &&
      a.chosenScore === undefined;
  }), key + ' 신규 플래그 OFF에서 Phase A 페이로드 그대로(신규 필드 미부착)');
  const ledger = auditOnly[key].result.global.decisionAudit;
  assert(ledger.shadowEval === undefined && ledger.windowMargin === undefined,
    key + ' 신규 플래그 OFF에서 원장 wire shape 불변');
  assert(auditOnly[key].sha256 === AUDIT_ONLY_SHA[key],
    key + ' 신규 플래그 OFF SHA-256 = Phase A(ADR-073) 종료 시점과 일치');
});

console.log('\n== 2) ON — RNG 소비 횟수 불변 (핵심) ==');
CASES.forEach(function (key) {
  on[key] = run(key, FULL);
  assert(on[key].rngCalls === off[key].rngCalls,
    key + ' 그림자 평가·교전창 계측 ON에서도 난수 소비 동일 (' + off[key].rngCalls + ')');
  assert(on[key].rngCalls === auditOnly[key].rngCalls,
    key + ' audit만 ON일 때와도 동일');
  assert(on[key].result.global.killed === off[key].result.global.killed &&
         on[key].result.global.leaked === off[key].result.global.leaked,
    key + ' 격추/누수 불변 (killed=' + on[key].result.global.killed +
    ' leaked=' + on[key].result.global.leaked + ')');
  assert(run(key, FULL).sha256 === on[key].sha256, key + ' ON 자체도 재현 가능(결정론)');
});

console.log('\n== 3) regret 건전성 ==');
CASES.forEach(function (key) {
  const a = on[key].audits;
  assert(a.every(function (e) { return e.regret == null || e.regret >= 0; }),
    key + ' regret ≥ 0 (실제선택도 그림자 집합의 원소이므로 구조적 보장)');
  assert(a.every(function (e) {
    return e.globalBestScore == null || e.globalBestScore >= e.chosenScore - 1e-12;
  }), key + ' globalBestScore ≥ chosenScore');
  assert(a.every(function (e) {
    return e.globalBestUnitId !== e.chosenUnitId || e.regret === 0;
  }), key + ' 전역최적 = 실제선택이면 regret 정확히 0');
  assert(a.every(function (e) { return e.shadowFeasible <= e.shadowEvaluated; }),
    key + ' 실현가능 자산 ≤ 채점시도 자산');
  assert(on[key].result.global.decisionAudit.shadowScope === 'rok_only',
    key + ' 기본 그림자 범위는 ROK 전용 (ADR-036 — USFK 제외)');
});

console.log('\n== 4) USFK 독립 축 (ADR-036) ==');
{
  const full = run('sc3|asis', FULL, 'HANBANDO_FULL_NORMAL');
  const usfk = full.audits.filter(function (e) { return String(e.commanderAxis).indexOf('USFK') === 0; });
  assert(usfk.length > 0, 'FULL 배치에서 USFK 축 결심이 실제로 발생 (' + usfk.length + '건)');
  assert(usfk.every(function (e) { return e.shadowScope === 'skipped_usfk_axis'; }),
    'USFK 축 결심은 그림자 평가에서 제외 표시');
  assert(usfk.every(function (e) { return e.regret === null && e.globalBestUnitId === undefined; }),
    'USFK 축 regret은 0이 아니라 null(미측정) — 통합 반사실을 가정하지 않음');
  assert(full.result.global.decisionAudit.shadowSkippedDecisions === usfk.length,
    '원장의 shadowSkippedDecisions가 실제 제외 건수와 일치');

  const withUsfk = run('sc3|asis', Object.assign({}, FULL, { shadowEvalIncludeUsfk: true }),
    'HANBANDO_FULL_NORMAL');
  assert(withUsfk.result.global.decisionAudit.shadowScope === 'rok_and_usfk',
    '참고용 반사실(shadowEvalIncludeUsfk)은 범위를 rok_and_usfk로 공시');
  assert(withUsfk.rngCalls === run('sc3|asis', {}, 'HANBANDO_FULL_NORMAL').rngCalls,
    'USFK 포함 반사실에서도 RNG 불변');
}

console.log('\n== 5) 교전창 원장 — 위협 전수 (놓침률 분모) ==');
CASES.forEach(function (key) {
  const r = on[key];
  assert(r.windows.length === r.spawned.length,
    key + ' window_audit ' + r.windows.length + '건 = 생성 위협 ' + r.spawned.length + '건 (1:1)');
  assert(r.windows.every(function (w, i) { return w.threatId === r.spawned[i].threatId; }),
    key + ' window_audit이 생성 순서·위협ID까지 대응');
  assert(r.windows.every(function (w) {
    return w.windowCloseT == null || (w.windowOpenT != null && w.windowCloseT >= w.windowOpenT);
  }), key + ' 창 개시 ≤ 창 마감 (또는 창 자체가 없어 null)');
  assert(r.windows.every(function (w) {
    return w.windowCloseT == null || w.windowCloseT <= w.dwellEndT;
  }), key + ' 창 마감 ≤ 체공창 종료');
});

console.log('\n== 6) 교차검증 — 창 마감 뒤 결심 ==');
CASES.forEach(function (key) {
  const r = on[key];
  const win = {}, lastDecision = {};
  r.windows.forEach(function (w) { win[w.threatId] = w; });
  r.audits.forEach(function (e) {
    if (lastDecision[e.threatId] == null || e.t > lastDecision[e.threatId]) {
      lastDecision[e.threatId] = e.t;
    }
  });
  const late = r.audits.filter(function (e) {
    return e.engagementWindowMargin != null && e.engagementWindowMargin < 0;
  });
  // 결심은 실현가능 PIP가 있어야 성립하므로 여유는 사실상 음수가 되지 않는다. 다만 창 마감은
  // `_iadsGeometryWindow`가 **1초 정수 격자**로 훑어 얻은 값(이산화 하한)인데 결심 시각은
  // 연속값이라, 1초 미만의 초과가 경계에서 나올 수 있다. 이는 "문이 닫힌 뒤 결심"이 아니라
  // 격자 해상도의 산물이다 — 0건을 주장하지 않고 **1초 이내**임을 주장한다.
  const worst = late.reduce(function (m, e) { return Math.min(m, e.engagementWindowMargin); }, 0);
  assert(worst > -1,
    key + ' 창 마감 뒤 결심 ' + late.length + '건, 최대 초과 ' + worst.toFixed(2) +
    's — 전부 창 격자 해상도(1초) 이내');
  // `window_lost_due_to_c2`와의 잔여 차이: 제때 결심했어도 명령 전달·발사 준비에서 창을 잃는 경로.
  const lost = r.leaked.filter(function (e) { return e.reason === 'window_lost_due_to_c2'; });
  const lostUndecided = lost.filter(function (e) { return lastDecision[e.threatId] == null; }).length;
  const lostAfterDecision = lost.length - lostUndecided;
  assert(lost.every(function (e) {
    const w = win[e.threatId], d = lastDecision[e.threatId];
    return d == null || w.windowCloseT == null || d <= w.windowCloseT;
  }), key + ' window_lost_due_to_c2 위협도 결심 자체는 창 안에서 이뤄짐(정합)');
  if (lost.length) {
    note(key + ' window_lost_due_to_c2 ' + lost.length + '건 = 미결심 ' + lostUndecided +
      ' + 결심 후 상실 ' + lostAfterDecision +
      ' → 후자는 "결심 기준 놓침률"에 잡히지 않는 잔여 경로(명령전달·발사준비 지연)');
  }
});

console.log('\n== 7) 방향 관측 (seed 12345 단일 실행 — 주장은 분포로) ==');
CASES.forEach(function (key) {
  const m = missRate(on[key]), o = optimalRate(on[key]);
  note(key + ' 교전창 놓침률 ' + pct(m.missed, m.total) + ' (미결심 ' + m.undecided + '/' + m.total +
    ') · 전역최적 일치율 ' + pct(o.opt, o.n));
});
{
  const missA = missRate(on['sc3|asis']), missB = missRate(on['sc3|tobe']);
  assert(missA.rate > missB.rate,
    'SC3 교전창 놓침률 As-Is > To-Be (' + pct(missA.missed, missA.total) + ' > ' +
    pct(missB.missed, missB.total) + ')');
  const m1a = missRate(on['sc1|asis']), m1b = missRate(on['sc1|tobe']);
  note('SC1 놓침률은 As-Is ' + pct(m1a.missed, m1a.total) + ' / To-Be ' + pct(m1b.missed, m1b.total) +
    ' — 부하가 낮아 C2가 병목이 아니므로 방향성 없음. 어서션하지 않는다.');

  // 전역최적 일치율: SC1은 격차가 커(30시드 88.9%→95.7%) 단일 seed에서도 방향이 안정적이다.
  // SC3은 30시드 격차가 1.3%p(95.9%→97.2%)에 불과해 **단일 seed에서 뒤집힌다** — 어서션하지
  // 않고 관측만 한다. 유리한 seed를 골라 어서션을 세우면 그것은 측정이 아니라 연출이다.
  {
    const a1 = optimalRate(on['sc1|asis']), b1 = optimalRate(on['sc1|tobe']);
    assert(b1.rate >= a1.rate,
      'SC1 전역최적 일치율 To-Be ≥ As-Is (' + pct(b1.opt, b1.n) + ' ≥ ' + pct(a1.opt, a1.n) + ')');
    const a3 = optimalRate(on['sc3|asis']), b3 = optimalRate(on['sc3|tobe']);
    note('SC3 전역최적 일치율 As-Is ' + pct(a3.opt, a3.n) + ' / To-Be ' + pct(b3.opt, b3.n) +
      ' — 30시드 격차가 1.3%p뿐이라 단일 seed에서는 뒤집힐 수 있다(ADR-074 §결론 영향). 어서션하지 않는다.');
  }

  // 원인 귀속: As-Is의 선택 손실이 어느 축에서 나오는가.
  ['sc1|asis', 'sc1|tobe', 'sc3|asis', 'sc3|tobe'].forEach(function (key) {
    const byAxis = {};
    on[key].audits.forEach(function (e) {
      if (e.regret == null) return;
      const k = e.commanderAxis;
      byAxis[k] = byAxis[k] || { n: 0, opt: 0 };
      byAxis[k].n++;
      if (e.regret === 0) byAxis[k].opt++;
    });
    note(key + ' 축별 최적일치: ' + Object.keys(byAxis).sort().map(function (k) {
      return k + ' ' + pct(byAxis[k].opt, byAxis[k].n) + '(' + byAxis[k].n + ')';
    }).join(' · '));
  });
  // 실측 원인: 선택 손실은 자기 포대만 보는 LOCAL_AD 축에 몰린다(주축은 양 모드 동일 풀 — ADR-062).
  const localAd = function (key) {
    const a = on[key].audits.filter(function (e) {
      return e.commanderAxis === 'LOCAL_AD' && e.regret != null;
    });
    return { n: a.length, opt: a.filter(function (e) { return e.regret === 0; }).length };
  };
  const other = function (key) {
    const a = on[key].audits.filter(function (e) {
      return e.commanderAxis !== 'LOCAL_AD' && e.regret != null;
    });
    return { n: a.length, opt: a.filter(function (e) { return e.regret === 0; }).length };
  };
  const la = localAd('sc3|asis'), oa = other('sc3|asis');
  // ADR-080 갱신: 「선택 손실이 LOCAL_AD 축에 집중된다」(ADR-074 관측)는 이 셀에서 더는
  // 성립하지 않는다 — 국지 그림의 MCRC 유래 출처가 문자 전파(45초+)로 늦어지자 LOCAL_AD의
  // regret 측정 표본이 8건으로 쪼그라들었고 그 8건은 전부 최적이었다(100% vs 주축 95.2%).
  // 표본이 준 것 자체가 ADR-080의 관측이다: **국지축 결심 기회가 늦은 상황그림에 잠식된다.**
  // 방향 주장 대신 그 사실을 잠근다 — LOCAL_AD 표본이 주축의 1/5 이하로 희소하고,
  // regret 계측은 양 축 모두 살아 있다(0이 아니라 측정 중이라는 뜻 — ADR-062 구분).
  assert(la.n > 0 && oa.n > 0 && la.n * 5 <= oa.n,
    'SC3 As-Is LOCAL_AD regret 표본 희소(' + la.n + '건 ≤ 주축 ' + oa.n + '건의 1/5) — ' +
    '늦은 국지 상황그림이 국지축 결심 기회를 잠식(ADR-080) · 일치율 ' +
    pct(la.opt, la.n) + ' vs 주축 ' + pct(oa.opt, oa.n));
}

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
