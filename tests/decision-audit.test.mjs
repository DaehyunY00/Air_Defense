/**
 * ADR-073 — 결심 감사 로깅(decisionAudit) 회귀.
 *
 * 계측 계층이 물리·결심·RNG를 건드리지 않았음을 증명한다.
 *  1) 기본 OFF == 명시적 OFF, 감사 전용 필드·이벤트를 제외한 ON/OFF 전체 결과 동일
 *  2) RNG 불변 — ON/OFF에서 난수 소비 **횟수**가 동일 (이벤트 수가 아니라 카운터로 확인)
 *  3) 완결성 — decision_audit 이벤트가 COMMAND_DECIDED와 1:1
 *  4) 정합성 — chosenUnitId는 항상 최고점 후보이며 candidates는 점수 내림차순
 *  5) 상한·표본 규칙 결정론 — 후보 상한/이벤트 상한/threatId 해시 표본이 재현 가능
 *  6) 후보 명단 폭 실측(⚠️ 기대와 반대) — ADR-073 §발견 참조. As-Is가 더 좁다는 전제는
 *     이 엔진에서 성립하지 않는다. 그 구조적 이유(양 모드의 ROK 주축 사수 풀이 동일)를
 *     어서션으로 못박아, 장차 이 구조가 바뀌면 테스트가 깨지도록 한다.
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

// ── RNG 소비 카운터 ──
// 처리·도착 스트림(KJ.makeRng)과 센서 도메인 서브스트림(KJ.IADS.deriveStream)을 모두 감싼다.
// 계측이 어느 한쪽이라도 난수를 소비하면 이 수가 달라진다.
let rngCalls = 0;
const realMakeRng = KJ.makeRng;
KJ.makeRng = function (seed) {
  const r = realMakeRng(seed);
  const w = { seed: r.seed };
  ['raw', 'uniform', 'exponential', 'triangular', 'normal', 'lognormal', 'poisson']
    .forEach(function (k) { w[k] = function () { rngCalls++; return r[k].apply(r, arguments); }; });
  return w;
};
const realDerive = KJ.IADS.deriveStream;   // KJ.IADS는 frozen — 사본으로 교체한다
KJ.IADS = Object.assign({}, KJ.IADS, {
  deriveStream: function () {
    const next = realDerive.apply(null, arguments);
    return function () { rngCalls++; return next(); };
  }
});

// 주 분석 배치 × 충실도 iads-c2 × seed 12345 × 900초.
const CASES = ['sc1|asis', 'sc1|tobe', 'sc3|asis', 'sc3|tobe'];
// ADR-100: 변경 전 12d14e0 스냅샷에서도 과거 v4 OFF 지문 4개가 모두 실패한다.
// 아카이브 해시를 새 수치로 덮지 않고 같은 모델의 감사 ON/OFF 결과 전체를 비교한다.
// parentDirectiveId 등 명령 감사 스키마는 양쪽에 유지한다. 감사 로깅 자체가 추가한
// 세 영역만 제거하므로 노드·링크·명령 이벤트·집계의 변화는 이 검사에 잡힌다.
// 별도의 엔진 고정 기준선은 hires-baseline.test.mjs가 담당한다.

function run(key, features) {
  const [sc, mode] = key.split('|');
  rngCalls = 0;
  const result = KJ.runDES({
    scenario: KJ.scenarioById(sc), mode, intensity: 1, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2', c2Analysis: true,
    features: Object.assign({ highResolutionDeployment: true }, features || {})
  });
  return {
    result, rngCalls,
    sha256: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    audits: result.c2Events.filter(function (e) { return e.type === 'decision_audit'; }),
    decided: result.c2Events.filter(function (e) { return e.type === 'COMMAND_DECIDED'; })
  };
}
function withoutDecisionAudit(result) {
  const copy = JSON.parse(JSON.stringify(result));
  delete copy.global.decisionAudit;
  delete copy.global.features.decisionAudit;
  copy.c2Events = copy.c2Events.filter((event) => event.type !== 'decision_audit');
  return crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}
function median(values) {
  const a = values.filter(function (v) { return typeof v === 'number' && isFinite(v); })
    .slice().sort(function (x, y) { return x - y; });
  if (!a.length) return null;
  const m = (a.length - 1) / 2;
  return (a[Math.floor(m)] + a[Math.ceil(m)]) / 2;
}

console.log('== 1) 기본 OFF == 명시적 OFF · RNG 기준 ==');
const off = {};
CASES.forEach(function (key) {
  off[key] = run(key);
  const explicitOff = run(key, { decisionAudit: false });
  assert(off[key].sha256 === explicitOff.sha256, key + ' 기본 OFF == 명시적 OFF 전체 결과');
  assert(off[key].rngCalls === explicitOff.rngCalls, key + ' 기본 OFF == 명시적 OFF 난수 소비');
  assert(off[key].audits.length === 0, key + ' OFF에서 decision_audit 0건');
  assert(off[key].result.global.decisionAudit === undefined,
    key + ' OFF wire shape 불변(global.decisionAudit 미노출)');
  assert(off[key].result.global.features.decisionAudit === undefined,
    key + ' OFF features 미노출');
});

console.log('\n== 2) ON — RNG 소비 횟수 불변 (핵심) ==');
const on = {};
CASES.forEach(function (key) {
  on[key] = run(key, { decisionAudit: true });
  assert(on[key].rngCalls === off[key].rngCalls,
    key + ' 난수 소비 횟수 동일 (' + off[key].rngCalls + ')');
  assert(withoutDecisionAudit(on[key].result) === withoutDecisionAudit(off[key].result),
    key + ' 감사 전용 필드·이벤트만 제외하면 ON/OFF 전체 결과 동일');
  assert(on[key].result.global.killed === off[key].result.global.killed &&
         on[key].result.global.leaked === off[key].result.global.leaked,
    key + ' 격추/누수 불변 (killed=' + on[key].result.global.killed +
    ' leaked=' + on[key].result.global.leaked + ')');
});

console.log('\n== 3) 완결성 — decision_audit ↔ WTA 결심 1:1 ==');
// ⚠️ 분모는 **WTA 사수 선정을 거친 결심**이다. ADR-071 자위권 발사는 포대가 자기 항적으로
// 스스로 쏘는 경로라 후보 명단도 점수도 존재하지 않는다 — 감사를 남길 수 없으므로(없는 것을
// 지어내지 않는다) 분모에서 뺀다. 대신 그 건수가 원장에 드러나는지를 아래에서 검증한다.
CASES.forEach(function (key) {
  const r = on[key];
  const wta = r.decided.filter(function (e) { return e.cause !== 'self_defense'; });
  const selfDefense = r.decided.length - wta.length;
  assert(r.audits.length === wta.length,
    key + ' 감사 ' + r.audits.length + '건 = WTA 결심 ' + wta.length + '건' +
    (selfDefense ? ' (자위권 ' + selfDefense + '건 제외)' : ''));
  const paired = r.audits.every(function (a, i) {
    return a.t === wta[i].t && a.threatId === wta[i].threatId &&
      a.chosenUnitId === wta[i].shooterId;
  });
  assert(paired, key + ' 감사와 WTA 결심이 시각·위협·사수까지 동일 순서로 짝지어짐');
  // 커버리지 구멍을 침묵시키지 않는다: 빠진 건수가 원장에 정확히 드러나야 한다.
  assert(on[key].result.global.decisionAudit.selfDefenseUnaudited === selfDefense,
    key + ' 원장 selfDefenseUnaudited=' + selfDefense + ' — 감사 밖 결심을 숨기지 않음');
});

console.log('\n== 4) 정합성 — 최고점 = 실제 선택, 후보 정렬 ==');
CASES.forEach(function (key) {
  const r = on[key];
  const topIsChosen = r.audits.every(function (a) {
    return a.candidates.length > 0 && a.candidates[0].unitId === a.chosenUnitId;
  });
  const sorted = r.audits.every(function (a) {
    for (let i = 1; i < a.candidates.length; i++) {
      if (a.candidates[i].score > a.candidates[i - 1].score) return false;
    }
    return true;
  });
  const fieldsOk = r.audits.every(function (a) {
    return a.candidates.every(function (c) {
      return typeof c.score === 'number' && typeof c.pk === 'number' &&
        typeof c.ammoRatio === 'number' && typeof c.load === 'number' &&
        typeof c.rangeKm === 'number' && typeof c.pipTime === 'number' &&
        c.pipTime >= a.t;   // 요격 가능 시각은 결심 이후
      });
  });
  assert(topIsChosen, key + ' chosenUnitId = 점수 1위 후보');
  assert(sorted, key + ' candidates 점수 내림차순');
  assert(fieldsOk, key + ' 후보 필드(점수·pk·탄약비·부하·거리·PIP시각) 전부 유한·정합');
  assert(r.audits.every(function (a) { return a.candidateCount <= a.visibleUnitCount; }),
    key + ' 실현가능 후보 ≤ 시야 내 발사대');
});

console.log('\n== 5) 상한·표본 규칙 (결정론) ==');
{
  const capped = run('sc3|tobe', { decisionAudit: true, decisionAuditMaxCandidates: 1 });
  const anyMulti = on['sc3|tobe'].audits.some(function (a) { return a.candidateCount > 1; });
  assert(anyMulti, '후보 2개 이상인 결심이 실제로 존재해 상한 검증이 유효');
  assert(capped.audits.every(function (a) { return a.candidates.length <= 1; }),
    '후보 상한 1 적용 시 배열 길이 ≤ 1');
  assert(capped.audits.every(function (a) { return a.candidates[0].unitId === a.chosenUnitId; }),
    '상한이 걸려도 실제 선택 후보는 절대 잘리지 않음');
  assert(capped.audits.some(function (a) { return a.candidatesTruncated === true; }),
    '잘린 결심은 candidatesTruncated=true로 공시');
  assert(capped.audits.every(function (a, i) {
    return a.candidateCount === on['sc3|tobe'].audits[i].candidateCount;
  }), '상한은 candidateCount(실제 후보 수)를 왜곡하지 않음');
  assert(capped.rngCalls === off['sc3|tobe'].rngCalls, '상한 적용에서도 RNG 불변');
  assert(withoutDecisionAudit(capped.result) === withoutDecisionAudit(off['sc3|tobe'].result),
    '후보 상한 적용에서도 감사 외 전체 결과 불변');

  const limited = run('sc3|tobe', { decisionAudit: true, decisionAuditMaxEvents: 5 });
  const led = limited.result.global.decisionAudit;
  assert(limited.audits.length === 5 && led.logged === 5,
    '이벤트 상한 5 → 5건만 기록 (logged=' + led.logged + ')');
  assert(led.truncated === true && led.dropped > 0,
    '초과분은 0으로 위장하지 않고 truncated·dropped로 공시 (dropped=' + led.dropped + ')');
  assert(withoutDecisionAudit(limited.result) === withoutDecisionAudit(off['sc3|tobe'].result),
    '이벤트 상한 적용에서도 감사 외 전체 결과 불변');

  const half = run('sc3|tobe', { decisionAudit: true, decisionAuditSampleRate: 0.5 });
  const halfAgain = run('sc3|tobe', { decisionAudit: true, decisionAuditSampleRate: 0.5 });
  const ids = function (r) { return r.audits.map(function (a) { return a.threatId; }).join(','); };
  assert(ids(half) === ids(halfAgain), 'threatId 해시 표본은 재실행에서 동일(결정론)');
  assert(half.audits.length > 0 && half.audits.length < on['sc3|tobe'].audits.length,
    '표본추출률 0.5 → 전수의 진부분집합 (' + half.audits.length + '/' + on['sc3|tobe'].audits.length + ')');
  const full = new Set(on['sc3|tobe'].audits.map(function (a) { return a.threatId; }));
  assert(half.audits.every(function (a) { return full.has(a.threatId); }),
    '표본은 전수 위협집합의 부분집합(위협 단위 채택)');
  assert(half.rngCalls === off['sc3|tobe'].rngCalls, '표본추출에서도 RNG 불변');
  assert(withoutDecisionAudit(half.result) === withoutDecisionAudit(off['sc3|tobe'].result),
    '표본추출에서도 감사 외 전체 결과 불변');
}

console.log('\n== 6) 후보 명단 폭 실측 — ⚠️ 기대와 반대 (ADR-073 §발견) ==');
CASES.forEach(function (key) {
  const a = on[key].audits;
  note(key + ' visibleUnitCount 중앙 ' + median(a.map(function (x) { return x.visibleUnitCount; })) +
    ' · candidateCount 중앙 ' + median(a.map(function (x) { return x.candidateCount; })) +
    ' · 결심 ' + a.length + '건');
});
{
  // 구조적 이유를 어서션으로 못박는다: 같은 위협에 대해 ROK 주축(LOCAL_AD·USFK 제외) 결심자가
  // 보는 사수 풀은 두 모드에서 **동일 집합**이다. As-Is는 지휘 노드가 위협범주별로 갈릴 뿐
  // 사수 명단이 좁아지지 않는다 — 따라서 "명단이 좁아 차선을 고른다"는 전제는 성립하지 않고,
  // To-Be 이점은 명단 폭이 아닌 다른 축(시간·절차)에서 찾아야 한다. Phase B가 이를 검정한다.
  const scenario = KJ.scenarioById('sc3');
  const mk = function (mode) {
    const sim = new KJ.Simulation({
      scenario, mode, intensity: 1, seed: 12345, endTimeSec: 900,
      deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
      features: { highResolutionDeployment: true }
    });
    return sim;
  };
  const simA = mk('asis'), simB = mk('tobe');
  const MAIN = { LOCAL_AD: 1, USFK_THAAD: 1, USFK_PATRIOT: 1 };
  const poolFor = function (sim, threat) {
    const out = {};
    sim._resolveIadsCommanders(threat).forEach(function (c) {
      if (MAIN[c.axis]) return;
      c.batteryIds.forEach(function (id) { out[id] = true; });
    });
    return Object.keys(out).sort().join(',');
  };
  const types = ['srbm', 'cruise', 'fighter', 'uav_small', 'mrl_large'];
  const same = types.every(function (type) {
    const threat = { id: 'probe_' + type, type, axis: 'NW', spawnT: 0, dwellSec: 600 };
    return poolFor(simA, threat) === poolFor(simB, threat);
  });
  assert(same, 'ROK 주축 사수 풀이 As-Is·To-Be 동일 (명단 폭 가설 반증 — 구조로 고정)');
}

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
