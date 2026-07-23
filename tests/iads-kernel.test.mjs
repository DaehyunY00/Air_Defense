/** Phase A common-kernel, module loader and physical sensor integration tests. */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CLAIM_STATE, EventQueue, ORDER_STATE, RNG_DOMAIN, SENSOR_STATE, TRACK_CORRELATION,
  advanceTransitions, applyEngagementProbabilityCorrections, calculateDetectionProbability, correlationProbabilities,
  createEngagementOrder, createTrackState, deriveStream, findEarliestPip,
  hazardLossProbability, hazardScanProbability, installIadsKernel, isActiveClaim, lookupPssek, radarHorizon,
  resolveCorrelation, stepSensorTrack, trackFreshness, transitionOrder
} from '../js/model/iads/index.js';

globalThis.window = globalThis;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function assert(condition, message) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${message}`);
  if (!condition) failures += 1;
}

assert(Math.abs(calculateDetectionProbability(100, 100, 1, 1) - 0.95) < 1e-12,
  'SNR 기준점 R=Rref·RCS=RCSref에서 Pd=0.95');
assert(radarHorizon(0, 0) === 0 && radarHorizon(100, 100) > 70,
  '지구곡률 레이더 수평선 경계');
assert(hazardScanProbability(0.01, 0.2) > 0.09,
  '0.02초 Pd를 0.2초 스캔 hazard로 등가변환');

const a = deriveStream(42, RNG_DOMAIN.SENSOR_SCAN, 'T1', 'S1');
const b = deriveStream(42, RNG_DOMAIN.SENSOR_SCAN, 'T1', 'S1');
const c = deriveStream(42, RNG_DOMAIN.SENSOR_SCAN, 'T1', 'S2');
assert(a() === b() && a() === b(), '동일 도메인·엔티티 RNG 서브스트림 재현');
assert(c() !== deriveStream(42, RNG_DOMAIN.SENSOR_SCAN, 'T1', 'S1')(),
  '센서 ID가 다른 RNG 서브스트림 분리');

const trackState = createTrackState();
const fcSensorFixture = { role: 'battery_fire_control', ranges: { fireControl: 40 },
  transitionTime: { detectToTrack: 1, trackToFireControl: 1 } };
stepSensorTrack(trackState, 1, .2, () => 0, 0);
for (let i = 1; i <= 5; i += 1) {
  stepSensorTrack(trackState, 1, .2, () => 0, i * .2);
  advanceTransitions(trackState, fcSensorFixture, i * .2);
}
for (let i = 6; i <= 10; i += 1) {
  stepSensorTrack(trackState, 1, .2, () => 0, i * .2);
  advanceTransitions(trackState, fcSensorFixture, i * .2);
}
assert(trackState.state === SENSOR_STATE.FIRE_CONTROL, '연속 hit로 DETECTED→TRACKED→FIRE_CONTROL 전이');
stepSensorTrack(trackState, null, .2, () => { throw new Error('gated scan must not draw'); }, 2.2);
assert(trackState.state === SENSOR_STATE.FIRE_CONTROL, '기하 게이트 밖 스캔은 RNG·기존 FC 항적을 소모하지 않음');
const lossDraws = [1, 0];
stepSensorTrack(trackState, .5, .2, () => lossDraws.shift(), 2.4);
assert(trackState.state === SENSOR_STATE.TRACKED && hazardLossProbability(.5, .2) > 0,
  '0.2초 coarse 스캔에서 3×0.02초 연속 miss 추적상실 hazard 보존');
assert(trackFreshness(trackState, 5, 3).fresh && !trackFreshness(trackState, 6, 3).fresh,
  'lastUpdateAt 기반 추적 신선도 경계');

assert(correlationProbabilities('GREEN_PINE_B').failed === .02 &&
  correlationProbabilities('MSAM_MFR').failed === .10, '조기경보/교전 MFR 상관 오류 계층 분리');
const correlationCache = {};
const correlation = resolveCorrelation(correlationCache, 42, 'S1', 'MSAM_MFR', 'T1', 'linear', 0);
assert([TRACK_CORRELATION.CORRECT, TRACK_CORRELATION.MIS, TRACK_CORRELATION.FAILED].includes(correlation),
  '도메인 RNG 기반 상관 결과 계약');
assert(resolveCorrelation(correlationCache, 42, 'S1', 'MSAM_MFR', 'T1', 'linear', 0) === correlation,
  '같은 5초 상관 시도는 결정론적');
let failedSeed = null;
for (let seed = 1; seed < 10000 && failedSeed === null; seed += 1) {
  if (resolveCorrelation({}, seed, 'MFR', 'MSAM_MFR', 'TX', 'linear', 0) === TRACK_CORRELATION.FAILED) failedSeed = seed;
}
const retryCache = {};
const failedFirst = resolveCorrelation(retryCache, failedSeed, 'MFR', 'MSAM_MFR', 'TX', 'linear', 0);
let recovered = false;
for (let attempt = 1; attempt < 20 && !recovered; attempt += 1) {
  recovered = resolveCorrelation(retryCache, failedSeed, 'MFR', 'MSAM_MFR', 'TX', 'linear', attempt * 5) !== TRACK_CORRELATION.FAILED;
}
assert(failedFirst === TRACK_CORRELATION.FAILED && !Object.values(retryCache).includes(TRACK_CORRELATION.FAILED) && recovered,
  'failed 상관은 캐시하지 않고 5초 버킷에서 재시도');

const pip = findEarliestPip({ now: 0, remainingSeconds: 30,
  missile: { engagementEnvelope: { Rmin: 1, Rmax: 20, Hmin: 0, Hmax: 20 }, missileSpeed: 1000 },
  positionAt: (at) => ({ lat: 0, lon: 0, altKm: 10, rangeKm: 10 + at * 0 }),
  rangeTo: (position) => position.rangeKm });
assert(pip && pip.timeToReach === 10 && pip.flyout === 10, '최초 봉투·도달 가능점 PIP 선택');
assert(lookupPssek({ SRBM: { front: { '3-20': .9 }, side: { '3-20': .7 } } }, 'srbm', 10, 'side') === .7,
  '위협 별칭×거리×접근각 PSSEK 조회');
assert(lookupPssek({ SRBM: { front: { '5-15': .8 } } }, 'srbm', 3, 'rear') === .4,
  '봉투 내 PSSEK 빈 경계·탄도 rear 누락은 IADS_C2 보수 fallback 적용');
assert(Math.abs(applyEngagementProbabilityCorrections(.8, {
  jammingLevel: .5, jammingSusceptibility: .7, ecmActive: true, ecmFactor: .2
}) - .416) < 1e-12, 'PSSEK에 센서밴드 재밍·표적 ECM 확률 보정');

const order = createEngagementOrder('O1', { id: 'C2', axis: 'KAMD' }, 'B1', 0);
transitionOrder(order, ORDER_STATE.IN_TRANSIT, 1);
transitionOrder(order, ORDER_STATE.EXECUTING, 2, CLAIM_STATE.FIRED);
assert(isActiveClaim(order) && order.fired, '명령·salvo claim이 발사 후 BDA 전까지 활성');
transitionOrder(order, ORDER_STATE.MISS, 3, CLAIM_STATE.MISS);
assert(!isActiveClaim(order) && order.resolved && order.released, 'BDA MISS에서 claim 해제');

const q = new EventQueue();
q.push({ time: 2, priority: 1, type: 'late' });
q.push({ time: 1, priority: 2, type: 'priority-2' });
q.push({ time: 1, priority: 1, type: 'first' });
q.push({ time: 1, priority: 1, type: 'second' });
assert([q.pop().type, q.pop().type, q.pop().type, q.pop().type].join('|') ===
  'first|second|priority-2|late', '이벤트 큐 (time, priority, sequence) 안정 순서');

const classic = [
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/bottleneck.js', 'analysis/c2-report.js', 'engine/sim-engine.js'
];
for (const rel of classic) await import(pathToFileURL(path.join(root, 'js', rel)).href);
installIadsKernel(globalThis.KJ);

assert(KJ.SENSOR_TYPES.PATRIOT_RADAR.ranges.fireControl.ballistic === 100 &&
  KJ.SENSOR_TYPES.PATRIOT_RADAR.azimuthHalf === 45 &&
  KJ.SENSOR_TYPES.MSAM_MFR.transitionTime.trackToFireControl === 3,
  'IADS_C2 센서 거리·전이·Patriot 90도 섹터 파라미터 정합');
assert(KJ.SHOOTER_TYPES.LSAM.missiles.AAM.missileSpeed === 1700 &&
  KJ.SHOOTER_TYPES.PAC3.battery.launcherCount === 6 &&
  KJ.SHOOTER_TYPES.PAC3.missiles.ABM.roundsPerLauncher === 12,
  'L-SAM AAM·PAC-3 발사대/탄약 물리 파라미터 정합');

const cfg = {
  scenario: KJ.scenarioById('sc2'), mode: 'asis', intensity: 0.5, seed: 42, endTimeSec: 180,
  deploymentId: 'HANBANDO_MINI_NORMAL', features: { highResolutionDeployment: true },
  modelFidelity: 'iads-c2', trace: true, traceCap: 30
};
const first = KJ.runDES(cfg);
const second = KJ.runDES(cfg);
assert(JSON.stringify(first) === JSON.stringify(second), 'IADS_C2 물리 프로파일 전체 결과 결정론');
assert(first.config.modelFidelity === 'iads-c2' && /physics-probability-parity/.test(first.config.modelRevision),
  '결과에 모델 충실도·revision 기록');
assert(first.global.sensorPhysics.scans > 0 && first.global.sensorPhysics.gated > 0,
  '센서별 0.2초 물리 스캔·기하 게이트 실행');
assert(first.global.spawned === first.global.killed + first.global.leaked + first.global.censoredRaw,
  'IADS_C2 프로파일 생성·격추·실패·절단 보존');
assert(Object.values(SENSOR_STATE).length === 4, '센서 4상태 계약 고정');

const calibrated = KJ.runDES({
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: .2, seed: 42, endTimeSec: 600,
  deploymentId: 'HANBANDO_FULL_NORMAL', features: { highResolutionDeployment: true },
  modelFidelity: 'iads-c2', c2Analysis: true
});
assert(calibrated.global.sensorPhysics.fireControl > 0, 'FULL 복합위협에서 MFR FIRE_CONTROL 전이 발생');
assert(calibrated.global.c2Orders.created > 0 && calibrated.global.c2Orders.fired > 0,
  '책임 C2 명령 생성→수신·확약→실행 수명주기 발생');
assert(calibrated.global.trackQuality.correct + calibrated.global.trackQuality.mis > 0,
  '상관·식별 품질 계측이 실제 항적 보고에 연결');
const calibratedC2 = KJ.buildC2Analysis(calibrated.c2Events, calibrated);
assert(calibratedC2.c2Command.directives.created === calibrated.global.c2Orders.created &&
  calibratedC2.c2Command.directives.active > 0,
  '실제 IADS_C2 실행의 명령 CREATED→ACTIVE 이벤트 분석');
assert(calibratedC2.c2Command.directives.delays.receivedToActive.p50 > 0,
  '포대별 ECS 수신 큐 서비스가 RECEIVED와 ACTIVE를 실제 시간으로 분리');
assert(calibratedC2.trackFreshness.available &&
  calibratedC2.trackFreshness.decisionTrackAge.n > 0,
  '실제 C2 ledger에서 결심 항적 신선도 분포 산출');
assert(Object.values(calibratedC2.c2Command.byCause).reduce((sum, n) => sum + n, 0) ===
  calibrated.global.c2Orders.fired,
  '발사원인을 위협 전역값이 아닌 plan별 원인으로 정확히 귀속');

let rejected = false;
try {
  KJ.runDES({ scenario: KJ.scenarioById('sc1'), mode: 'asis', intensity: 1, seed: 1,
    endTimeSec: 60, modelFidelity: 'iads-c2' });
} catch (error) { rejected = /high-resolution deployment/.test(error.message); }
assert(rejected, 'IADS_C2 물리 프로파일의 legacy 배치 오사용 명시적 거부');

console.log(failures === 0 ? '\nOK — 전체 통과' : `\nFAILED — ${failures}건`);
process.exit(failures ? 1 : 0);
