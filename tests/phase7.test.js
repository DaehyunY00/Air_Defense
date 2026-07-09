/**
 * K-JAMDS 시뮬레이터 — Phase 7 고도화 회귀 테스트
 * 실행:  node tests/phase7.test.js   (저장소 루트에서)
 *
 * 검증 대상:
 *  1) 헝가리안 알고리즘 최적성 (브루트포스 대조, 직사각·할당불가 셀 포함)
 *  2) 비선점 우선순위 큐 — 고우선(탄도탄) 평균대기 ≤ 저우선(무인기)
 *  3) 오경보(클러터) 처리 부하 — 통계 분리·용량 소모·재현성
 *  4) 재고 임계치 관리(원칙 5) — 재고 비음수·소진 시 교전 보류
 *  5) Degraded Mode(원칙 6) — 두절 창에서 권한위임(fallback) 전환
 *  6) 파상(wave) 도착 — 평균률 보존·재현성
 *  7) To-Be 배치 WTA — 다중 시드 평균에서 탐욕 대비 비열등
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js',
 'core/rng.js', 'core/heap.js', 'core/hungarian.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, seed, extra) {
  var cfg = Object.assign({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: 1800 }, extra || {});
  return KJ.runDES(cfg);
}

// ── 1) 헝가리안 최적성 (브루트포스 대조) ──
console.log('# 헝가리안 알고리즘');
function bruteForce(cost) { // 행 순열 전수조사 (작은 행렬 전용)
  var rows = cost.length, cols = cost[0].length, best = Infinity;
  var colIdx = [];
  for (var j = 0; j < cols; j++) colIdx.push(j);
  function perm(remaining, r, acc) {
    if (r === rows || remaining.length === 0) { best = Math.min(best, acc); return; }
    if (acc >= best) return;
    // 이 행을 배정하지 않는 경우(불가 셀 회피)도 허용해야 브루트포스가 안전하지만,
    // 여기선 유한비용 정방/직사각 행렬만 사용해 완전 배정 최적값을 비교한다.
    for (var i = 0; i < remaining.length; i++) {
      var rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      perm(rest, r + 1, acc + cost[r][remaining[i]]);
    }
  }
  perm(colIdx, 0, 0);
  return best;
}
function totalCost(cost, assign) {
  return assign.reduce(function (s, j, i) { return j >= 0 ? s + cost[i][j] : s; }, 0);
}
var m1 = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
assert(totalCost(m1, KJ.hungarian(m1)) === bruteForce(m1), '3×3 알려진 행렬: 브루트포스와 동일 최적비용');
var rng = KJ.makeRng(2026);
var okRect = true;
for (var trial = 0; trial < 20; trial++) {
  var r = 2 + Math.floor(rng.raw() * 4), c = 2 + Math.floor(rng.raw() * 4);
  var m = [];
  for (var i = 0; i < r; i++) {
    m.push([]);
    for (var j = 0; j < c; j++) m[i].push(Math.floor(rng.raw() * 100));
  }
  var a = KJ.hungarian(m);
  // 유효성: 중복 열 배정 없음, 배정 수 = min(r,c)
  var used = {}, n = 0;
  a.forEach(function (j) { if (j >= 0) { if (used[j]) okRect = false; used[j] = true; n++; } });
  if (n !== Math.min(r, c)) okRect = false;
  if (r <= c && totalCost(m, a) !== bruteForce(m)) okRect = false; // 행≤열이면 완전 배정 최적
}
assert(okRect, '무작위 직사각 행렬 20건: 유효 배정 + (행≤열) 브루트포스 최적 일치');
var mInf = [[KJ.hungarian.INF, KJ.hungarian.INF], [1, KJ.hungarian.INF]];
var aInf = KJ.hungarian(mInf);
assert(aInf[0] === -1 && aInf[1] === 0, '할당 불가(INF) 행은 -1, 가능한 행만 배정');

// ── 2) 비선점 우선순위 큐 ──
console.log('# 우선순위 큐 (섞어쏘기 포화)');
var rp = run('sc3', 'asis', 2.5, 11);
var p1 = rp.priorityWait['1'], p4 = rp.priorityWait['4'];
assert(!!p1 && !!p4 && p1.n > 10 && p4.n > 10, '우선순위 1(탄도탄)·4(무인기) 대기 표본 확보 (' + (p1 && p1.n) + '/' + (p4 && p4.n) + '건)');
assert(p1 && p4 && p1.meanWaitSec <= p4.meanWaitSec + 1e-9,
  '고우선 평균대기(' + p1.meanWaitSec.toFixed(1) + 's) ≤ 저우선(' + p4.meanWaitSec.toFixed(1) + 's)');
var rf = run('sc3', 'asis', 2.5, 11, { discipline: 'fifo' });
assert(JSON.stringify(rf) !== JSON.stringify(rp), 'discipline=fifo는 priority와 구별되는 결과');
assert(rf.config.discipline === 'fifo' && rp.config.discipline === 'priority', 'config에 큐 규율 기록');

// ── 3) 오경보(클러터) 부하 ──
console.log('# 오경보 트랙');
var rft = run('sc2', 'asis', 1, 77);
var ft = rft.global.falseTracks;
assert(ft.spawned > 0, '오경보 트랙 발생 (' + ft.spawned + '건)');
assert(ft.dismissed <= ft.spawned && ft.escalated <= ft.spawned, '기각·상위보고 ≤ 발생 (회계 일관)');
assert(rft.global.spawned === rft.flow.spawned && rft.global.killRate <= 1,
  '오경보는 위협 생성/격추/누수 통계에 불산입');
// 동일 시드에서 오경보 유무 비교 — 오경보가 C2 도착 부하를 증가시켜야 함
var scNoFt = Object.assign({}, KJ.scenarioById('sc2'), { falseTracks: null });
var rNoFt = KJ.runDES({ scenario: scNoFt, mode: 'asis', intensity: 1, seed: 77, endTimeSec: 1800 });
function c2Arrivals(res) {
  return res.nodes.filter(function (n) { return n.category === 'c2'; })
    .reduce(function (s, n) { return s + n.arrivals; }, 0);
}
assert(c2Arrivals(rft) > c2Arrivals(rNoFt), '오경보 포함 시 C2 도착 부하 증가 (' +
  c2Arrivals(rNoFt) + ' → ' + c2Arrivals(rft) + '건)');
assert(JSON.stringify(run('sc2', 'asis', 1, 77)) === JSON.stringify(rft), '오경보 포함 재현성 유지');
assert(run('sc2', 'asis', 0, 77).global.falseTracks.spawned === 0, '강도 0: 오경보도 0');

// ── 4) 재고 임계치 관리 (원칙 5) ──
console.log('# 재고(요격자산) 임계치');
// C2(KAMDOC) 포화 없이 교전 단계까지 흐르는 부하(ρ≈0.83)로 장시간 돌려
// 탄도탄 대응 무기(MDU-M 32 + MDU-L 18 = 50발)를 전량 소진시킨다.
var invScn = {
  id: 'test-inv', name: '재고 소진(검증용)',
  mix: [{ type: 'srbm', axis: 'central', ratePerMin: 3.0 },
        { type: 'mrl_large', axis: 'east', ratePerMin: 3.0 }]
};
var rInv = KJ.runDES({ scenario: invScn, mode: 'asis', intensity: 1, seed: 5, endTimeSec: 3600 });
assert(rInv.inventory.length > 0, '재고 현황 리포트 제공 (' + rInv.inventory.length + '개 무기)');
assert(rInv.inventory.every(function (v) { return v.left >= 0 && v.used + v.left === v.start; }),
  '재고 비음수·보존 (사용+잔여=초기)');
var mdInv = rInv.inventory.filter(function (v) { return v.id === 'MDU-M' || v.id === 'MDU-L'; });
assert(mdInv.some(function (v) { return v.used > 0; }), '탄도탄 대응 무기 재고 소모 발생');
var denied = (rInv.global.leakReasons.inventory_denied || 0);
var allExhausted = mdInv.every(function (v) { return v.left === 0; });
assert(allExhausted, '장시간 포화 사격으로 탄도탄 대응 무기 전량 소진');
assert(denied > 0, '재고 전량 고갈 후 inventory_denied 누수 계상 (denied=' + denied + ')');
[rp, rft, rInv].forEach(function (r, i) {
  assert(r.global.spawned - r.global.killed - r.global.leaked >= 0, 'inv-run' + i + ': 보존 항등식 유지');
});

// ── 5) Degraded Mode / 권한위임 (원칙 6) ──
console.log('# SC4 통신 두절·분권 전환');
var rd = run('sc4', 'asis', 1, 33);
assert(rd.global.fallback.count > 0, '두절 창에서 권한위임(fallback) 발생 (' + rd.global.fallback.count + '건)');
assert(rd.global.fallback.meanDelaySec === 45, '권한위임 지연 45초 (C2-FALLBACK-DLY-01)');
var scNoOut = Object.assign({}, KJ.scenarioById('sc4'), { outages: [] });
var rNoOut = KJ.runDES({ scenario: scNoOut, mode: 'asis', intensity: 1, seed: 33, endTimeSec: 1800 });
assert(rNoOut.global.fallback.count === 0, '두절 창 없으면 fallback 0 (두절의 함수)');
var rdT = run('sc4', 'tobe', 1, 33);
assert(rdT.global.fallback.count <= rd.global.fallback.count,
  'To-Be(JAMDC2 우회경로) fallback ≤ As-Is — 복원력 (' + rd.global.fallback.count + ' → ' + rdT.global.fallback.count + '건)');
assert(JSON.stringify(run('sc4', 'asis', 1, 33)) === JSON.stringify(rd), 'SC4 재현성 유지');

// ── 6) 파상(wave) 도착 ──
console.log('# 파상 도착 (SC3 방사포)');
var waveEntry = KJ.scenarioById('sc3').mix.find(function (m) { return m.wave; });
assert(!!waveEntry && waveEntry.type === 'mrl_large', 'SC3 방사포 wave 정의 존재');
var eqRate = waveEntry.ratePerMin * (waveEntry.wave.onSec * waveEntry.wave.mult + waveEntry.wave.offSec) /
  (waveEntry.wave.onSec + waveEntry.wave.offSec);
assert(Math.abs(eqRate - 3.0) < 1e-9, 'wave 평균 도착률 = 종전 3.0/분 보존 (배치성만 추가)');
// 다중 시드 평균 생성 수가 평균률 기대값에 근접 (±25%) — 전용 인라인 시나리오로 검증
var seeds = [1, 2, 3, 4, 5, 6, 7, 8];
var waveScn = { id: 'test-wave', name: 'wave 검증', mix: [
  { type: 'mrl_large', axis: 'east', ratePerMin: 1.5, wave: { onSec: 60, offSec: 120, mult: 4 } }
] };
var waveTot = 0;
seeds.forEach(function (sd) {
  waveTot += KJ.runDES({ scenario: waveScn, mode: 'asis', intensity: 1, seed: sd, endTimeSec: 1800 }).global.spawned;
});
var waveMean = waveTot / seeds.length, waveExp = 3.0 * 30; // 3/분 × 30분
assert(Math.abs(waveMean - waveExp) / waveExp < 0.25,
  'wave 평균 생성 ' + waveMean.toFixed(1) + '건 ≈ 기대 ' + waveExp + '건 (±25%)');
assert(JSON.stringify(run('sc3', 'asis', 1.5, 42)) === JSON.stringify(run('sc3', 'asis', 1.5, 42)),
  'wave 포함 재현성 유지');

// ── 7) To-Be 배치 WTA (헝가리안) vs 탐욕 ──
console.log('# To-Be 배치 WTA');
var rBatch = run('sc3', 'tobe', 1.5, 9);
var rGreedy = run('sc3', 'tobe', 1.5, 9, { wtaBatch: false });
assert(rBatch.config.wtaBatch === true && rGreedy.config.wtaBatch === false, 'config에 WTA 방식 기록');
assert(rBatch.global.everEngaged > 0, '배치 WTA 경로에서 교전 발생 (' + rBatch.global.everEngaged + '건)');
var sumB = 0, sumG = 0;
seeds.forEach(function (sd) {
  sumB += run('sc3', 'tobe', 1.5, sd).global.leakRate;
  sumG += run('sc3', 'tobe', 1.5, sd, { wtaBatch: false }).global.leakRate;
});
assert(sumB / seeds.length <= sumG / seeds.length + 0.03,
  '8시드 평균: 배치 WTA 누수율(' + (sumB / 8 * 100).toFixed(1) + '%) ≤ 탐욕(' +
  (sumG / 8 * 100).toFixed(1) + '%) + 3%p (비열등)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
