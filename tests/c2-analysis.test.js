/**
 * C2 구조화 계측·순수 분석·paired MC 회귀.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
[
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
  'core/rng.js', 'core/heap.js', 'analysis/c2-report.js',
  'engine/sim-engine.js', 'analysis/mc-runner.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

var cfg = {
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5,
  seed: 42, endTimeSec: 1800
};

console.log('# 계측 opt-in과 분모');
var normal = KJ.runDES(cfg);
var measured = KJ.runDES(Object.assign({}, cfg, { c2Analysis: true }));
assert(!normal.c2Events && !normal.global.killRateSpawn,
  '기본 실행은 구조화 이벤트·확장 분모 필드가 없어 legacy wire shape 보존');
assert(JSON.stringify(normal.global) !== JSON.stringify(measured.global) &&
  normal.global.spawned === measured.global.spawned &&
  normal.global.killed === measured.global.killed &&
  normal.global.leaked === measured.global.leaked,
  '계측 실행은 동역학 카운터를 바꾸지 않고 분석 필드만 추가');
assert(near(measured.global.killRateSpawn + measured.global.leakRateSpawn +
  measured.global.censoredRate, 1, 1e-12), '전체 생성 분모: 격추+누출+미해결률=1');
assert(near(measured.global.killRateResolved + measured.global.leakRateResolved, 1, 1e-12),
  '해결분 분모: 격추+누출률=1');

console.log('# C2 순수 분석');
var report = KJ.buildC2Analysis(measured.c2Events, measured);
assert(report.available && report.eventCount > measured.global.spawned,
  '구조화 이벤트에서 C2 분석 리포트 생성');
assert(report.denominators.spawned === measured.global.spawned &&
  report.denominators.resolved === measured.global.killed + measured.global.leaked,
  '분석 리포트 분모가 DES 결과와 일치');
var attr = report.c2Attribution.byState;
assert(attr.queued + attr.processing + attr.afterC2Done + attr.noC2Contact === report.c2Attribution.totalLeaks,
  '모든 누출이 C2 상태 4종에 정확히 1회 귀속');
assert(report.killchainDelays.detectToDecision.p90 >= report.killchainDelays.detectToDecision.p50,
  '킬체인 지연 분위수 p90≥p50');
assert(Object.keys(report.c2Load.nodes).length > 0 &&
  Object.keys(report.c2Load.nodes).every(function (id) {
    var n = report.c2Load.nodes[id];
    return n.queueWait.n >= 0 && n.serviceTime.n >= 0 &&
      n.arrivals >= n.started && n.started >= n.completions;
  }), 'C2 노드별 대기·서비스·절단 불변식');
assert(report.bottleneckEvidence.every(function (e) {
  return e.attributedLeaks > 0 || e.level === 'warn' || e.level === 'bottleneck';
}), '병목 증거는 직접 귀속 누출 또는 ρ/드롭 경고가 있을 때만 노출');

console.log('# 명령 수명주기·항적 신선도·교전 기회');
var syntheticResult = {
  config: { endTimeSec: 30 },
  global: { spawned: 2, killed: 0, leaked: 2, censoredRaw: 0 },
  nodes: [{ id: 'ICC_X', c: 1, rho: 0.2, drops: 0 }]
};
var syntheticEvents = [
  { type: 'THREAT_SPAWNED', t: 0, threatId: 'T1' },
  { type: 'SENSOR_DETECTED', t: 1, threatId: 'T1' },
  { type: 'TRACK_REPORT_RECEIVED', t: 2, threatId: 'T1', nodeId: 'ICC_X',
    trackLastUpdateAt: 0.5, commanderAxis: 'MCRC', threatCategory: 'abt' },
  { type: 'C2_ARRIVED', t: 1.5, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_0', kind: 'coordination' },
  { type: 'C2_PROCESSING', t: 1.7, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_0', kind: 'coordination' },
  { type: 'C2_ARRIVED', t: 2, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_1', kind: 'iads_track' },
  { type: 'C2_PROCESSING', t: 3, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_1', kind: 'iads_track' },
  { type: 'C2_DONE', t: 4, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_1', kind: 'iads_track' },
  { type: 'C2_ARRIVED', t: 4, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_2', kind: 'directive_reception' },
  { type: 'C2_PROCESSING', t: 5, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_2', kind: 'directive_reception' },
  { type: 'C2_DONE', t: 6, threatId: 'T1', nodeId: 'ICC_X', jobId: 'JOB_2', kind: 'directive_reception' },
  { type: 'DIRECTIVE_CREATED', t: 5, threatId: 'T1', directiveId: 'D1', cause: 'emergency' },
  { type: 'DIRECTIVE_SENT', t: 6, threatId: 'T1', directiveId: 'D1', cause: 'emergency' },
  { type: 'DIRECTIVE_RECEIVED', t: 7, threatId: 'T1', directiveId: 'D1', cause: 'emergency' },
  { type: 'DIRECTIVE_PROCESSING', t: 7, threatId: 'T1', directiveId: 'D1', cause: 'emergency' },
  { type: 'DIRECTIVE_ACTIVE', t: 8, threatId: 'T1', directiveId: 'D1', cause: 'emergency' },
  { type: 'COMMAND_DECIDED', t: 8, threatId: 'T1', directiveId: 'D1', cause: 'emergency',
    trackLastUpdateAt: 0.5, trackAgeSec: 7.5, commanderAxis: 'MCRC', threatCategory: 'abt' },
  { type: 'ENGAGEMENT_FIRED', t: 10, threatId: 'T1', directiveId: 'D1',
    engagementId: 'E1', shooterId: 'B1', cause: 'emergency', fireControlTrackAgeSec: 1 },
  { type: 'INTERCEPT_MISS', t: 12, threatId: 'T1', engagementId: 'E1', shooterId: 'B1' },
  { type: 'THREAT_LEAKED', t: 20, threatId: 'T1', reason: 'missed',
    detected: true, tries: 1, hadDirective: true, hadGeometryWindow: true, failureContributors: ['no_fire_control'] },
  { type: 'THREAT_SPAWNED', t: 0, threatId: 'T2' },
  { type: 'SENSOR_DETECTED', t: 1, threatId: 'T2' },
  { type: 'THREAT_LEAKED', t: 20, threatId: 'T2', reason: 'window_lost_due_to_c2',
    detected: true, tries: 0, hadDirective: false, hadGeometryWindow: true,
    failureContributors: ['capacity_full'] },
  { type: 'COORDINATION_FAILED', t: 9, threatId: 'T1', reason: 'deadline_exceeded' },
  { type: 'RESPONSIBILITY_UNRESOLVED', t: 9, threatId: 'T2', reason: 'no_command_path' }
];
var sr = KJ.buildC2Analysis(syntheticEvents, syntheticResult);
assert(sr.c2Load.nodes.ICC_X.arrivals === 3,
  '같은 위협·노드의 서로 다른 jobId를 별도 C2 작업으로 계수');
assert(sr.c2Attribution.byState.processing === 1,
  '같은 노드의 후속 완료 job이 앞선 미완료 처리중 job의 누출 귀속을 덮어쓰지 않음');
assert(sr.c2Command.directives.created === 1 && sr.c2Command.directives.active === 1 &&
  sr.c2Command.directives.activationRate === 1,
  '명령 CREATED→ACTIVE 수명주기와 활성 성공률');
assert(sr.emergencyFire.total === 1 && sr.emergencyFire.outcomes.miss === 1,
  '비상발사를 engagementId로 MISS 결과에 정확히 연결');
assert(sr.trackFreshness.decisionTrackAge.p50 === 7.5 &&
  sr.trackFreshness.byAxis.MCRC.n === 1,
  '결심 항적 age와 지휘축별 coverage');
assert(sr.engagementGap.preFire.p50 === 9 && sr.engagementGap.neverEngagedLeaked === 1,
  '실제 탐지→발사 공백과 미교전 누출');
assert(sr.lostOpportunity.lostThreats === 1 &&
  sr.lostOpportunity.byReason.window_lost_due_to_c2 === 1,
  '기하학 창이 있었지만 발사 0인 위협을 1회 기회손실로 집계');
assert(sr.c2Command.coordinationFailures === 1 && sr.c2Command.responsibilityUnresolved === 1,
  '협조 실패와 책임 미해소를 별도 계측');

console.log('# 동일 seed paired Monte Carlo');
var pairedCfg = {
  scenario: KJ.scenarioById('sc3'), intensity: 1.5,
  seed: 17, endTimeSec: 600
};
var paired = KJ.runPairedMonteCarlo(pairedCfg, {
  minReps: 6, maxReps: 6, tol: 0, primary: 'leakRateSpawn', c2Mop: true
});
var paired2 = KJ.runPairedMonteCarlo(pairedCfg, {
  minReps: 6, maxReps: 6, tol: 0, primary: 'leakRateSpawn', c2Mop: true
});
assert(JSON.stringify(paired) === JSON.stringify(paired2), 'paired MC 동일 baseSeed 완전 재현');
assert(paired.paired === true && paired.asis.reps === 6 && paired.tobe.reps === 6 &&
  paired.delta.leakRateSpawn.n === 6, '양팔·Δ가 동일한 6개 seed 사용');
assert(near(paired.delta.leakRateSpawn.mean,
  paired.tobe.metrics.leakRateSpawn.mean - paired.asis.metrics.leakRateSpawn.mean, 1e-12),
  'Δ 평균 = To-Be 평균 − As-Is 평균(동일 표본)');
assert(paired.asis.metrics.censoredRate.n === paired.tobe.metrics.censoredRate.n,
  '관측 종료 미해결률도 동일 paired 표본으로 집계');
assert(paired.c2Mop.enabled && paired.c2Mop.delta.neverEngagedLeakedRate.n === 6,
  'C2 MOP도 같은 6개 paired seed 교집합으로 Δ 집계');
assert(paired.c2Mop.delta.directiveExpiryRate.available === false &&
  paired.c2Mop.excludedByMetric.directiveExpiryRate === 6,
  '미계측 명령 만료율은 0으로 위장하지 않고 seed별 제외');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
