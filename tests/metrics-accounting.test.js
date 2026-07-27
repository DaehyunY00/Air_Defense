/**
 * K-JAMDS — 지표 계정(accounting) 회귀 테스트
 * 실행: node tests/metrics-accounting.test.js
 *
 * 2026-07 지표 전수 검토에서 발견한 3개 계정 결함의 재발 방지:
 *  (1) 고가유도탄 보존율이 native(고해상도) 경로에 미배선 — 항상 100%로 표시되던 결함.
 *  (2) 중복교전(ghost) 발사가 threatId 없이 기록돼 C2 리포트 중복 집계에서 누락되던 결함.
 *      단, ghost는 BDA·명령 수명주기가 없으므로 원인 분포·교전공백에는 들어가면 안 된다(범위 분리).
 *  (3) MC 시간지표가 표본 없는 복제의 0을 누산해 평균이 하향 편향되던 결함.
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
// 로딩 순서는 tests/iads-native-pipeline.test.js와 동일해야 한다
// (deployment-adapter는 data/*가 KJ.NODES/LINKS를 채운 뒤 legacy 카탈로그를 만든다).
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
 'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
 'analysis/c2-report.js', 'engine/sim-engine.js', 'analysis/mc-runner.js']
  .forEach(function (f) { require(path.join(root, f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m, extra) {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (extra ? '  [' + extra + ']' : ''));
  if (!c) fail++;
}

// ════════ F1: native(고해상도) 경로에서 고가유도탄($≥5M, L-SAM) 소모가 계상되는가 ════════
console.log('# F1 — native 고가유도탄 보존율');
var nativeCfg = {
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 42, endTimeSec: 900,
  deploymentId: 'HANBANDO_MINI_NORMAL', features: { highResolutionDeployment: true }
};
var nat = KJ.runDES(nativeCfg).global;
console.log('    native: interceptM=' + nat.cost.interceptM.toFixed(1) +
  ' highValueInterceptM=' + nat.highValueInterceptM.toFixed(1) +
  ' preservation=' + nat.highValuePreservation.toFixed(4) +
  ' shots=' + nat.shotsFired);
assert(nat.cost.interceptM > 0, 'native 실행에서 요격탄 비용이 계상됨');
assert(nat.highValueInterceptM > 0,
  'native 실행에서 고가유도탄(L-SAM $8M) 소모액이 계상됨 (수정 전 항상 0)');
assert(nat.highValuePreservation < 1,
  'native 보존율이 100% 고정에서 벗어남 (수정 전 항상 1.0)');
assert(Math.abs(nat.highValuePreservation - (1 - nat.highValueInterceptM / nat.cost.interceptM)) < 1e-12,
  '보존율 = 1 − 고가소모/전체소모 항등 성립');

// legacy는 종전과 동일해야 한다(회귀 안전)
var leg = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 12345, endTimeSec: 1800 }).global;
assert(leg.highValueInterceptM > 0 && leg.highValuePreservation < 1,
  'legacy 경로는 종전과 동일하게 고가탄 계상 유지',
  'pres=' + leg.highValuePreservation.toFixed(4));

// ════════ F3: legacy As-Is 중복교전(ghost) 발사가 C2 리포트에 귀속되는가 ════════
console.log('# F3 — ghost 중복교전 발사 귀속');
var dupRes = KJ.runDES({
  scenario: KJ.scenarioById('sc1'), mode: 'asis', intensity: 2, seed: 12345,
  endTimeSec: 1800, c2Analysis: true
});
var dupCount = dupRes.global.coordination.duplicates;
var report = KJ.buildC2Analysis(dupRes.c2Events, dupRes);
var firedEvents = dupRes.c2Events.filter(function (e) { return e.type === 'ENGAGEMENT_FIRED'; });
var nullThreat = firedEvents.filter(function (e) { return e.threatId == null; }).length;
var dupFlagged = firedEvents.filter(function (e) { return e.duplicate === true; }).length;
console.log('    엔진 duplicates=' + dupCount +
  ' · ENGAGEMENT_FIRED=' + firedEvents.length + ' (threatId null=' + nullThreat +
  ', duplicate 플래그=' + dupFlagged + ')' +
  ' · 리포트 duplicateThreats=' + report.duplicateEngagement.duplicateThreats +
  ' concurrent=' + report.duplicateEngagement.concurrent);
assert(dupCount > 0, '이 설정에서 As-Is 중복교전이 실제로 발생(검증 전제)');
assert(nullThreat === 0, '발사 이벤트에 threatId 누락이 없음 (수정 전 ghost 발사가 null)');
assert(dupFlagged > 0, 'ghost 발사가 duplicate=true로 구분 표시됨');
assert(report.duplicateEngagement.duplicateThreats > 0,
  'C2 리포트가 중복교전 위협을 집계함 (수정 전 0으로 누락)');

// 주 계통 cause 분포가 ghost로 오염되지 않았는지 (ghost는 중복 판정에만 사용)
var causes = report.c2Command.byCause || {};
var causeTotal = Object.keys(causes).reduce(function (s, k) { return s + causes[k]; }, 0);
console.log('    byCause=' + JSON.stringify(causes) + ' 합=' + causeTotal +
  ' · c2Command.total=' + report.c2Command.total +
  ' · engagementGap.preFire n=' + report.engagementGap.preFire.n);
assert(causeTotal === firedEvents.length - dupFlagged,
  '원인 분포는 주 계통 발사만 집계(ghost 제외) — unattributed 부풀림 없음');
assert((causes.unattributed || 0) === 0,
  'ghost 유입으로 인한 unattributed 발사가 없음');

// ════════ F4: MC 시간지표가 표본 없는 복제의 0을 누산하지 않는가 ════════
console.log('# F4 — MC 시간지표 0-포함 편향');
// 격추가 드문 설정(강도 0에 가까운 저부하 + 짧은 창)에서 표본 없는 복제를 유도
var mc = KJ.runMonteCarlo({
  scenario: KJ.scenarioById('sc2'), mode: 'asis', intensity: 0.5,
  seed: 4242, endTimeSec: 300
}, { minReps: 12, maxReps: 12, tol: 0 });
var ttk = mc.metrics.meanTimeToKillSec;
console.log('    reps=' + mc.reps + ' · meanTimeToKillSec n=' + ttk.n +
  ' mean=' + (ttk.n ? ttk.mean.toFixed(1) : '—') +
  ' · leakRateSpawn n=' + mc.metrics.leakRateSpawn.n);
assert(mc.metrics.leakRateSpawn.n === mc.reps,
  '비율 지표는 전 복제를 누산(n=reps)');
assert(ttk.n <= mc.reps, '시간지표 표본 수가 복제 수를 넘지 않음');
assert(ttk.n === 0 || ttk.mean > 0,
  '누산된 평균 격추시간이 0이 아님 (수정 전 격추 0건 복제의 0이 섞임)');

// paired MC의 Δ는 양팔 모두 표본이 있을 때만 누산
var paired = KJ.runPairedMonteCarlo({
  scenario: KJ.scenarioById('sc2'), intensity: 0.5, seed: 4242, endTimeSec: 300
}, { minReps: 8, maxReps: 8, tol: 0 });
var dttk = paired.delta.meanTimeToKillSec;
console.log('    paired: Δ meanTTK n=' + dttk.n + ' · asis n=' + paired.asis.metrics.meanTimeToKillSec.n +
  ' · tobe n=' + paired.tobe.metrics.meanTimeToKillSec.n);
assert(dttk.n <= Math.min(paired.asis.metrics.meanTimeToKillSec.n, paired.tobe.metrics.meanTimeToKillSec.n),
  'Δ 표본 수 ≤ 양팔 표본 수의 최솟값 (쌍대 교집합)');

console.log(fail === 0 ? '\nOK — 수정 검증 전체 통과' : '\n실패 ' + fail + '건');
process.exit(fail ? 1 : 0);
