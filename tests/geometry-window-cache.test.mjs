/**
 * ADR-076 — 반사실 PIP 교전창 캐시 키 정합 회귀.
 *
 * 결함: `_iadsGeometryWindow`의 공유 캐시 키가 (사수|유형|축|체공창)이었다. 창은 궤적의
 * 함수이고 궤적의 종점은 `threat.target`인데(ADR-063 산포 ON이면 위협마다 다르다) 키가
 * 그 종점을 빠뜨려, **같은 키 × 다른 착탄점**인 두 위협이 한 칸을 공유했다. 먼저 계산된
 * 위협의 창이 뒤 위협에게 그대로 나갔고, 캐시가 채워지는 **순서**가 결과를 좌우했다.
 *
 * 검증 관점:
 *  1) 순수함수 캐시 — 캐시를 완전히 무력화한 실행과 bit-exact. **이 결함의 정의적 증명**이다
 *     (키에 빠진 인자가 하나라도 있으면 깨진다). 종전 키에서는 실제로 깨졌다.
 *  2) 순서 독립 — 캐시를 미리 채우는 순서를 바꿔도 결과가 같다. 결함의 발견 경로(ADR-074
 *     계측이 호출 시점을 앞당기자 SC3 To-Be 격추 95→91로 이동)를 직접 겨냥한다.
 *  3) 단위 수준 — 착탄점만 다른 두 위협이 서로 다른 창을 받는다(캐시 관통 확인).
 *  4) 종전 키가 실제로 충돌했음 — 결함이 가설이 아니라 실측임을 고정한다.
 *  5) 산포 OFF 불변 — OFF면 `target`이 없어 키가 종전과 동일하다(bit-exact 보존).
 *  6) 격리 장치 부재 — `_engagementWindowOf`가 공유 캐시를 쓰며, 그래도 계측이 결과를
 *     흔들지 않는다(ADR-074의 전용 빈 캐시 우회는 ADR-076에서 걷어냈다).
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
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/bottleneck.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function note(m) { console.log('  NOTE ' + m); }
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }

function cfg(sc, mode, features, intensity) {
  return {
    scenario: KJ.scenarioById(sc), mode,
    intensity: intensity === undefined ? 1.5 : intensity,
    seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, features || {})
  };
}

// ── 훅: 실제 경로를 건드리지 않는 관찰·개입 지점 ──
// mode = 'off'   캐시 재사용을 원천 차단(매 호출 전 캐시를 비운다)
// mode = 'seed'  위협의 창을 미리 전부 계산해 캐시를 **다른 순서로** 채운다
// mode = 'census' 종전 키 기준 충돌 횟수를 센다(값은 그대로 통과시킨다)
let hook = null;
const realWindow = KJ.Simulation.prototype._iadsGeometryWindow;
KJ.Simulation.prototype._iadsGeometryWindow = function (shooter, threat) {
  if (hook === 'off') this._geometryWindowCache = {};
  if (hook === 'census' && this._iadsCanEngage(shooter, threat)) {
    const legacyKey = shooter.id + '|' + threat.type + '|' + threat.axis + '|' + threat.dwellSec;
    const tgt = threat.target ? threat.target[0] + ',' + threat.target[1] : '-';
    if (!this._censusOwner) this._censusOwner = {};
    if (this._censusOwner[legacyKey] !== undefined) {
      census.hits++;
      if (this._censusOwner[legacyKey] !== tgt) census.crossTarget++;
    } else {
      census.misses++;
      this._censusOwner[legacyKey] = tgt;
    }
  }
  return realWindow.call(this, shooter, threat);
};
let census = null;

const CASES = ['sc1|asis', 'sc1|tobe', 'sc2|asis', 'sc2|tobe', 'sc3|asis', 'sc3|tobe'];

// ── 1. 순수함수 캐시 (핵심) ──
console.log('# 1 — 캐시 유/무 bit-exact (키에 빠진 인자가 없다)');
const withCache = {};
CASES.forEach(function (key) {
  const [sc, mode] = key.split('|');
  hook = null; withCache[key] = sha(KJ.runDES(cfg(sc, mode)));
  hook = 'off'; const without = sha(KJ.runDES(cfg(sc, mode)));
  hook = null;
  assert(withCache[key] === without, key + ' 캐시를 완전히 끈 실행과 SHA-256 동일');
});

// ── 2. 순서 독립 ──
// ADR-074 계측은 결심보다 이른 시점(위협 생성)에 창을 물었다. 그 호출이 캐시를 먼저
// 채우면서 결과가 흔들린 것이 결함의 발견 경로다. 여기서는 그보다 강한 개입 —
// **매 호출마다 전 사수의 창을 미리 계산해** 캐시 적재 순서를 뒤집는다.
console.log('\n# 2 — 캐시 적재 순서를 바꿔도 결과 불변');
const realDecide = KJ.Simulation.prototype._iadsDecide;
KJ.Simulation.prototype._iadsDecide = function (threat, t, commander) {
  if (hook === 'seed') {
    const saved = hook; hook = null;
    this._nodesInMode().forEach(function (n) {
      if (n.category === 'shooter') realWindow.call(this, n, threat);
    }, this);
    hook = saved;
  }
  return realDecide.call(this, threat, t, commander);
};
CASES.forEach(function (key) {
  const [sc, mode] = key.split('|');
  hook = 'seed'; const seeded = sha(KJ.runDES(cfg(sc, mode)));
  hook = null;
  assert(seeded === withCache[key], key + ' 창을 미리 전부 채워도 SHA-256 동일');
});

// ── 3. 단위 수준 — 착탄점만 다르면 창도 달라야 한다 ──
console.log('\n# 3 — 착탄점만 다른 두 위협이 캐시를 공유하지 않는다');
const sim = new KJ.Simulation(cfg('sc3', 'asis'));
const axisKey = Object.keys(KJ.AXES).find(function (k) { return KJ.AXES[k].target; });
const shooters = sim._nodesInMode().filter(function (n) { return n.category === 'shooter'; });
function mkThreat(id, target) {
  return {
    id: id, type: 'cruise', axis: axisKey, target: target,
    spawnT: 0, dwellSec: 300, alive: true, killed: false, detected: false,
    pipelineDead: false, tries: 0, leakReason: null, _failureEvidence: {},
    _iadsPhysical: sim.iadsSensorPhysics, _iadsAxisDistanceKm: null
  };
}
const base = KJ.AXES[axisKey].target;
const tA = mkThreat('A', [base[0], base[1]]);
const tB = mkThreat('B', KJ.axisImpactPoint(axisKey, 0.97, 0.31, KJ.THREAT_TARGET_SPREAD_KM));
let differing = 0, comparable = 0;
shooters.forEach(function (n) {
  const wA = sim._iadsGeometryWindow(n, tA);
  const wB = sim._iadsGeometryWindow(n, tB);
  if (wA === null && wB === null) return;
  comparable++;
  if (wA === null || wB === null ||
      wA.firstFire !== wB.firstFire || wA.lastFire !== wB.lastFire) differing++;
});
assert(comparable > 0, '비교 가능한 사수 존재 (' + comparable + '문)');
assert(differing > 0, '착탄점이 다르면 창도 다르다 — ' + differing + '/' + comparable +
  '문에서 창이 갈렸다 (종전 키였다면 전부 동일값이 나왔다)');

// ── 4. 종전 키는 실제로 충돌했다 ──
// 이 스위트가 공허하지 않음을 고정한다. 종전 키 기준 충돌이 0이라면 결함은 애초에
// 발현하지 않았을 것이고, 위 1·2번도 자동으로 통과했을 것이다.
console.log('\n# 4 — 종전 키(착탄점 누락)는 실측으로 충돌한다');
CASES.forEach(function (key) {
  const [sc, mode] = key.split('|');
  census = { hits: 0, misses: 0, crossTarget: 0 };
  hook = 'census'; KJ.runDES(cfg(sc, mode)); hook = null;
  assert(census.crossTarget > 0, key + ' 종전 키 충돌 ' + census.crossTarget + '회 / 적중 ' +
    census.hits + '회 — 그만큼이 남의 착탄점으로 계산된 창이었다');
});

// ── 5. 산포 OFF는 불변 ──
// OFF면 `threat.target`이 undefined라 키가 종전과 글자 그대로 같다. 결정론과
// 캐시 순수성이 그대로 성립해야 한다(키 변경이 OFF 경로를 건드리지 않았다는 증명).
console.log('\n# 5 — 산포 OFF 경로 불변');
['asis', 'tobe'].forEach(function (mode) {
  const offCfg = cfg('sc3', mode, { threatTargetDispersion: false });
  hook = null; const a = sha(KJ.runDES(offCfg));
  hook = null; const b = sha(KJ.runDES(offCfg));
  hook = 'off'; const c = sha(KJ.runDES(offCfg)); hook = null;
  assert(a === b, 'sc3|' + mode + ' 산포 OFF 결정론');
  assert(a === c, 'sc3|' + mode + ' 산포 OFF도 캐시 유/무 bit-exact');
  census = { hits: 0, misses: 0, crossTarget: 0 };
  hook = 'census'; KJ.runDES(offCfg); hook = null;
  assert(census.crossTarget === 0, 'sc3|' + mode +
    ' 산포 OFF는 종전 키로도 충돌 0 (적중 ' + census.hits + '회) — 결함은 산포 ON 고유');
});

// ── 6. 격리 장치 없이도 계측이 결과를 흔들지 않는다 ──
// ADR-074는 `_engagementWindowOf`에서 전용 빈 캐시로 갈아끼워 결함을 우회했다.
// ADR-076에서 그 우회를 걷어냈으므로, 이제 **공유 캐시를 쓰고도** 계측 ON/OFF가
// 결과를 바꾸지 않아야 한다 — 우회가 아니라 근본 수정이라는 증거다.
console.log('\n# 6 — 계측이 공유 캐시를 쓰고도 관측 대상을 바꾸지 않는다');
assert(!/_geometryWindowCache\s*=\s*\{\}/.test(
  KJ.Simulation.prototype._engagementWindowOf.toString()),
  '_engagementWindowOf에 전용 빈 캐시 우회가 남아 있지 않다');
['sc1', 'sc3'].forEach(function (sc) {
  ['asis', 'tobe'].forEach(function (mode) {
    const plain = KJ.runDES(Object.assign(cfg(sc, mode, {}, 1), { c2Analysis: true }));
    const measured = KJ.runDES(Object.assign(
      cfg(sc, mode, { decisionAudit: true, shadowEval: true, windowMargin: true }, 1),
      { c2Analysis: true }));
    assert(plain.global.killed === measured.global.killed &&
           plain.global.leaked === measured.global.leaked,
      sc + '|' + mode + ' 계측 ON/OFF에서 격추·누수 동일 (killed=' + plain.global.killed +
      ' leaked=' + plain.global.leaked + ')');
  });
});
note('ADR-074 당시 이 지점이 SC3 To-Be 격추 95→91로 어긋났다 — 그것이 결함의 발견 경로다.');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
