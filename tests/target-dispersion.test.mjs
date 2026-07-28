/**
 * ADR-063 — 표적권역 산포 회귀.
 *
 * 검증 관점:
 *  1) OFF bit-exact — 플래그를 끈 실행은 도입 전과 SHA-256 동일(전용 스트림을 소비하지 않음).
 *  2) 산포 분포 정합 — 착탄점이 반경 R 원판 안에 있고, 평균 이격이 균등원판 이론값 2R/3에 수렴.
 *  3) seed 의존성 — 같은 축선 위협의 착탄점이 seed마다 달라진다(도입 목적 그 자체).
 *  4) 스트림 분리 — 산포 ON이 도착 스케줄(위협 수·유형·축선)을 바꾸지 않는다.
 *  5) 권역 무결성 — 산포가 다른 축선 표적권역을 침범하지 않는다(권역 혼입 방지).
 *  6) 사거리 정합 — 산포 최악거리(축선거리 + R)에서도 ENV-AXIS-FIT-01 위반 0건.
 *  7) 제약 불변 — 신궁·천마 탄도탄 불가가 산포 ON에서도 유지된다.
 *  8) UI·라우터 배선.
 */
import path from 'node:path';
import fs from 'node:fs';
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
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
function km(a, b) {
  var R = 6371, rad = Math.PI / 180;
  var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  var q = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}
function run(seed, disp, opts) {
  opts = opts || {};
  var features = { highResolutionDeployment: true };
  if (disp) features.threatTargetDispersion = true;
  if (opts.spreadKm !== undefined) features.targetSpreadKm = opts.spreadKm;
  return KJ.runDES({
    scenario: KJ.scenarioById(opts.sc || 'sc3'), mode: opts.mode || 'asis',
    intensity: 1.5, seed: seed, endTimeSec: opts.dur || 900, trace: true, traceCap: 3000,
    deploymentId: opts.dep || 'HANBANDO_LEGACY_NORMAL', features: features
  });
}

// ── 1. OFF bit-exact ──
console.log('# OFF bit-exact');
var off = run(12345, false);
var plain = KJ.runDES({
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 12345,
  endTimeSec: 900, trace: true, traceCap: 3000, deploymentId: 'HANBANDO_LEGACY_NORMAL',
  features: { highResolutionDeployment: true }
});
assert(sha(off) === sha(plain), '플래그 OFF == 도입 전 실행 (SHA-256 동일 — 전용 스트림 미소비)');
assert(!off.global.features.threatTargetDispersion, 'OFF는 features에 노출되지 않음(wire shape 보존)');
assert(off.threatTraces.every(function (t) { return t.target === undefined; }),
  'OFF는 위협에 착탄점을 부여하지 않음 — 축선 표적점 그대로');

var on = run(12345, true);
assert(sha(on) !== sha(plain), 'ON은 실제로 다른 결과');
assert(on.global.features.threatTargetDispersion === true &&
  on.global.features.targetSpreadKm === KJ.THREAT_TARGET_SPREAD_KM,
  'ON은 features에 산포·반경을 신고 (' + on.global.features.targetSpreadKm + 'km)');

// ── 2. 산포 분포 정합 (균등 원판) ──
console.log('# 산포 분포 (균등 원판)');
var R = KJ.THREAT_TARGET_SPREAD_KM;
var dists = on.threatTraces.filter(function (t) { return t.target; })
  .map(function (t) { return km(KJ.AXES[t.axis].target, t.target); });
assert(dists.length > 50, '착탄점 표본 충분 (' + dists.length + '건)');
// 허용오차 0.1%: 착탄점 생성은 평면 근사(km→도 환산)인데 검증은 haversine이라 왕복 오차가
// 남는다(실측 최대 초과 8.3m). 오차는 반경에 비례하므로 절대값이 아니라 비율로 둔다.
var maxD = Math.max.apply(null, dists);
assert(maxD <= R * 1.001, '전 착탄점이 반경 ' + R + 'km 이내 (최대 ' + maxD.toFixed(3) +
  'km — 평면↔구면 환산 오차 ' + ((maxD - R) * 1000).toFixed(0) + 'm)');
var meanD = dists.reduce(function (s, x) { return s + x; }, 0) / dists.length;
assert(Math.abs(meanD - 2 * R / 3) < 1.5,
  '평균 이격 ' + meanD.toFixed(1) + 'km ≈ 균등원판 이론값 2R/3 = ' + (2 * R / 3).toFixed(1) + 'km');

// 반경 0은 산포 없음과 동치여야 한다(경계값)
var zero = run(12345, true, { spreadKm: 0 });
assert(zero.threatTraces.every(function (t) {
  return t.target && Math.abs(t.target[0] - KJ.AXES[t.axis].target[0]) < 1e-12;
}), 'targetSpreadKm=0은 축선 표적점과 동일 좌표 (경계값)');

// ── 3. seed 의존성 (도입 목적) ──
console.log('# seed 의존성');
var firstWest = [12345, 42, 7].map(function (seed) {
  var t = run(seed, true).threatTraces.filter(function (x) { return x.axis === 'west'; })[0];
  return t ? t.target.join(',') : null;
});
assert(new Set(firstWest).size === firstWest.length,
  'seed마다 첫 west 위협의 착탄점이 서로 다름 — 산포 도입의 목적');
var sameSeed = run(12345, true).threatTraces.filter(function (x) { return x.axis === 'west'; })[0];
assert(sameSeed.target.join(',') === firstWest[0], '동일 seed는 동일 착탄점 (결정론 유지)');
var westTargets = on.threatTraces.filter(function (t) { return t.axis === 'west'; })
  .map(function (t) { return t.target.join(','); });
assert(new Set(westTargets).size > westTargets.length * 0.9,
  '같은 축선 안에서도 위협마다 착탄점이 다름 (' + new Set(westTargets).size + '/' + westTargets.length + ' 고유)');

// ── 4. 스트림 분리 — 도착 스케줄 불변 ──
console.log('# 도메인 스트림 분리');
function arrivalSig(r) {
  return r.threatTraces.map(function (t) { return t.type + '@' + t.axis + '@' + t.spawnT.toFixed(3); }).join('|');
}
assert(arrivalSig(on) === arrivalSig(off),
  '산포 ON/OFF의 도착 스케줄(시각·유형·축선·수) 완전 동일 — dispRng가 arrRng를 건드리지 않음');

// ── 5. 권역 무결성 — 서로 다른 표적권역이 산포로 겹치지 않는다 ──
// ⚠️ 축선 ≠ 표적권역: west(서울)와 seoul(서울 도심)은 1.4km 떨어진 **같은 표적권역**을 공유한다
// (설계상 의도 — 서부축과 직접침투축이 같은 수도를 노린다). 따라서 권역 단위로 묶어 검증한다.
console.log('# 권역 무결성');
var axisKeys = Object.keys(KJ.AXES);
var REGION_MERGE_KM = 5;
var regions = []; // [{ target, axes: [] }]
axisKeys.forEach(function (k) {
  var t = KJ.AXES[k].target;
  var hit = regions.find(function (r) { return km(r.target, t) < REGION_MERGE_KM; });
  if (hit) hit.axes.push(k); else regions.push({ target: t, axes: [k] });
});
var regionOf = {};
regions.forEach(function (r, i) { r.axes.forEach(function (k) { regionOf[k] = i; }); });
console.log('    표적권역 ' + regions.length + '개: ' +
  regions.map(function (r) { return r.axes.join('+'); }).join(' / '));
// 권역 수를 상수로 박지 않는다 — 축선이 늘면(ADR-064 대구·부산) 권역도 늘기 때문이다.
// 검증의 실질은 "서울을 공유하는 west·seoul만 하나로 묶이고 나머지는 각자 권역"이다.
var seoulRegion = regions.find(function (r) { return r.axes.indexOf('seoul') !== -1; });
assert(seoulRegion && seoulRegion.axes.indexOf('west') !== -1 && seoulRegion.axes.length === 2,
  'west·seoul은 같은 표적권역(서울)으로 묶임');
assert(regions.length === axisKeys.length - 1,
  '나머지 축선은 각자 독립 권역 — 축선 ' + axisKeys.length + '개 → 권역 ' + regions.length + '개');
var minPair = Infinity;
regions.forEach(function (a, i) {
  regions.forEach(function (b, j) {
    if (i >= j) return;
    var d = km(a.target, b.target);
    if (d < minPair) minPair = d;
  });
});
assert(minPair > 2 * R,
  '서로 다른 표적권역 간 최소 거리 ' + minPair.toFixed(1) + 'km > 2R(' + (2 * R) +
  'km) — 산포가 다른 권역을 침범할 수 없음');
assert(on.threatTraces.every(function (t) {
  var mine = regionOf[t.axis];
  var own = km(regions[mine].target, t.target);
  return regions.every(function (r, i) { return i === mine || km(r.target, t.target) >= own; });
}), '모든 착탄점이 자기 축선의 표적권역에 가장 가까움 (권역 혼입 없음)');

// ── 6. 사거리 정합 (ENV-AXIS-FIT-01 + 산포 최악거리) ──
console.log('# 사거리 정합 (산포 최악거리)');
var fitViolations = [];
['sc1', 'sc2', 'sc3'].forEach(function (id) {
  KJ.scenarioById(id).mix.forEach(function (m) {
    var tt = KJ.threatType(m.type), ax = KJ.AXES[m.axis];
    if (!tt.rangeBandKm || !ax.conceptReachKm) return;
    if (tt.rangeBandKm.max < ax.conceptReachKm + R) fitViolations.push(id + ' ' + m.type + '@' + m.axis);
  });
});
assert(fitViolations.length === 0,
  '전 시나리오 mix가 축선거리+' + R + 'km에서도 사거리 정합 유지' +
  (fitViolations.length ? ' — 위반: ' + fitViolations.join(', ') : ''));

// ── 7. 제약 어서션 불변 (불변 규칙 5) ──
console.log('# 제약 불변');
var balScn = {
  id: 'test-ballistic-disp', name: '탄도탄 단독(산포 검증용)',
  mix: [{ type: 'srbm', axis: 'central', ratePerMin: 1.0 },
        { type: 'mrl_large', axis: 'east', ratePerMin: 1.0 }]
};
var fullCat = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL');
var shoradIds = {};
fullCat.nodes.forEach(function (n) {
  if (n.category === 'shooter' && (n.typeId === 'BIHO' || n.typeId === 'CHUNMA')) shoradIds[n.id] = true;
});
var balRun = KJ.runDES({
  scenario: balScn, mode: 'asis', intensity: 2, seed: 11, endTimeSec: 900,
  deploymentId: 'HANBANDO_FULL_NORMAL',
  features: { highResolutionDeployment: true, threatTargetDispersion: true }
});
assert(balRun.nodes.filter(function (n) { return shoradIds[n.id] && (n.shots || 0) > 0; }).length === 0,
  '산포 ON에서도 신궁·천마는 탄도탄에 발사 0건 (제약 어서션 a 불변)');

// ── 8. UI·라우터 배선 ──
console.log('# 토글 배선');
var router = fs.readFileSync(path.join(root, 'js', 'core', 'router.js'), 'utf8');
assert(/disp: '0'/.test(router), '라우터 DEFAULTS에 disp 기본 OFF 등록');
assert(/state\.disp = \(state\.disp === '1'/.test(router), '알 수 없는 disp 값은 OFF로 정규화');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('id="target-dispersion-toggle"') !== -1, '상단 컨트롤에 표적 산포 토글 존재');
['main.js', 'ui/panels.js', 'ui/sim-view.js'].forEach(function (f) {
  var src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  assert(/threatTargetDispersion = true/.test(src), f + ' modelConfig가 disp → features 전달');
});
var params = fs.readFileSync(path.join(root, 'docs', 'params.md'), 'utf8');
assert(params.indexOf('THREAT-TARGET-DISP-01') !== -1 && /공개근거 없음/.test(params),
  '산포 반경이 params.md에 등급 C(공개근거 없음)로 등록됨');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
