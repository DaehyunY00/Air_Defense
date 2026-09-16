/**
 * ADR-074 — 그림자 평가(전역 최적) · 교전창 계측 회귀.
 *
 *  1) OFF 동치 — 생략/명시 OFF의 전체 결과 일치, ON에서도 계측 이외 결과 불변
 *  2) RNG 불변(핵심) — 그림자 평가 ON에서도 난수 소비 **횟수**가 OFF와 동일
 *  3) regret 건전성 — 항상 ≥ 0, 전역최적=실제선택이면 정확히 0
 *  4) USFK 독립 축 — ADR-036에 따라 그림자 반사실에서 제외(미측정으로 남김)
 *  5) 교전창 원장 — window_audit이 위협 전수와 1:1 (놓침률 분모의 생존 편향 제거)
 *  6) 교차검증 — 창 마감 뒤 결심은 0건. `window_lost_due_to_c2`와의 잔여 차이를 공시
 *  7) 방향 관측 — 우열은 NOTE로 남기고, 계측 분모·경계는 통제 입력으로 검증한다
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
// ADR-100: 과거 기본값의 지문은 계측 비간섭성을 검증하지 못한다. 동일한 현행 조건에서
// 생략/명시 OFF를 비교하고, ON/OFF에서는 아래에 열거한 계측 전용 필드만 제외한다.
// 고정 조건의 수치 지문은 hires-baseline.test.mjs에서 별도로 유지한다.
function behavior(result) {
  const copy = JSON.parse(JSON.stringify(result));
  delete copy.global.decisionAudit;
  ['decisionAudit', 'shadowEval', 'shadowEvalIncludeUsfk', 'windowMargin'].forEach(function (key) {
    delete copy.global.features[key];
  });
  copy.c2Events = copy.c2Events.filter(function (e) {
    return e.type !== 'decision_audit' && e.type !== 'window_audit';
  });
  return JSON.stringify(copy);
}

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
  const explicitOff = run(key, {
    decisionAudit: true, shadowEval: false, shadowEvalIncludeUsfk: false, windowMargin: false
  });
  assert(auditOnly[key].sha256 === explicitOff.sha256 &&
    auditOnly[key].rngCalls === explicitOff.rngCalls,
    key + ' 신규 플래그 생략/명시 OFF의 전체 결과·난수 소비 동일');
});

console.log('\n== 2) ON — RNG 소비 횟수 불변 (핵심) ==');
CASES.forEach(function (key) {
  on[key] = run(key, FULL);
  assert(on[key].rngCalls === off[key].rngCalls,
    key + ' 그림자 평가·교전창 계측 ON에서도 난수 소비 동일 (' + off[key].rngCalls + ')');
  assert(on[key].rngCalls === auditOnly[key].rngCalls,
    key + ' audit만 ON일 때와도 동일');
  assert(behavior(on[key].result) === behavior(off[key].result) &&
    behavior(on[key].result) === behavior(auditOnly[key].result),
    key + ' 계측 전용 필드 이외 전체 결과·이벤트 순서 불변');
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
{
  const fixture = {
    audits: [
      { threatId: 'early', t: 4 }, { threatId: 'early', t: 8 },
      { threatId: 'late', t: 12 }, { threatId: 'no-window', t: 1 },
      { threatId: 'boundary', t: 10 }
    ],
    windows: ['early', 'late', 'undecided', 'boundary'].map(function (threatId) {
      return { threatId, windowCloseT: 10 };
    }).concat({ threatId: 'no-window', windowCloseT: null })
  };
  const m = missRate(fixture);
  assert(m.total === 4 && m.missed === 2 && m.undecided === 1 && m.rate === 0.5,
    '놓침률 분모는 창 보유 위협 전수: 최초 결심·마감 경계·미결심·창 없음 처리');
  const o = optimalRate({ audits: [{ regret: 0 }, { regret: 2 }, { regret: null }, {}] });
  assert(o.n === 2 && o.opt === 1 && o.rate === 0.5,
    '최적일치율 분모는 regret 측정 표본만 포함');
  assert(missRate({ audits: [], windows: [] }).rate === null &&
    optimalRate({ audits: [] }).rate === null, '빈 분모는 0%가 아닌 미측정(null)');
}
CASES.forEach(function (key) {
  const m = missRate(on[key]), o = optimalRate(on[key]);
  note(key + ' 교전창 놓침률 ' + pct(m.missed, m.total) + ' (미결심 ' + m.undecided + '/' + m.total +
    ') · 전역최적 일치율 ' + pct(o.opt, o.n));
});
{
  const missA = missRate(on['sc3|asis']), missB = missRate(on['sc3|tobe']);
  note('SC3 교전창 놓침률 As-Is ' + pct(missA.missed, missA.total) + ' / To-Be ' +
    pct(missB.missed, missB.total) + ' — 방향은 회귀 통과 조건이 아님');
  const m1a = missRate(on['sc1|asis']), m1b = missRate(on['sc1|tobe']);
  note('SC1 놓침률은 As-Is ' + pct(m1a.missed, m1a.total) + ' / To-Be ' + pct(m1b.missed, m1b.total) +
    ' — 부하가 낮아 C2가 병목이 아니므로 방향성 없음. 어서션하지 않는다.');

  // 어느 모드가 우세한지는 모형·입력의 관측이며 구현의 통과 조건이 아니다.
  {
    const a1 = optimalRate(on['sc1|asis']), b1 = optimalRate(on['sc1|tobe']);
    note('SC1 전역최적 일치율 As-Is ' + pct(a1.opt, a1.n) + ' / To-Be ' + pct(b1.opt, b1.n));
    const a3 = optimalRate(on['sc3|asis']), b3 = optimalRate(on['sc3|tobe']);
    note('SC3 전역최적 일치율 As-Is ' + pct(a3.opt, a3.n) + ' / To-Be ' + pct(b3.opt, b3.n) +
      ' — 단일 seed의 관측');
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
  // 축별 계측 표본을 분리하되 어느 축에 손실이 몰리는지는 고정하지 않는다.
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
  const all = optimalRate(on['sc3|asis']);
  assert(la.n > 0 && oa.n > 0 && la.n + oa.n === all.n && la.opt + oa.opt === all.opt,
    'SC3 As-Is 축별 표본·최적일치 건수 합계가 전수 계정과 일치');
  note('SC3 As-Is LOCAL_AD ' + la.n + '건 / 타 축 ' + oa.n + '건 · 일치율 ' +
    pct(la.opt, la.n) + ' / ' + pct(oa.opt, oa.n));
}

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
