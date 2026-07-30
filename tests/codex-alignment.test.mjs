/**
 * ADR-069·070·071·072 — IADS_codex 정본 정합 회귀.
 *
 * 형제 저장소 IADS_codex 소스를 직접 대조해 이식한 세 가지를 고정한다.
 *
 *  1) ADR-069 톱니 신선도 (기본 ON) — codex `track-pool.reportingStaleness`.
 *     "탐지자산이 주기 P마다 1회 보고 → C2가 보는 정보 나이는 [0,P) 톱니"
 *     전역 동기 시계이므로 RNG를 쓰지 않는다(결정론 보존).
 *  2) ADR-070 원격 교전 + 웹 파티션 (기본 OFF — 판단 보류) — codex ADR-051 D1·D2.
 *     웹 내 다른 포대 MFR이 FC면 발사 허용, 탐지 전용 레이더 제외, 웹 경계 준수.
 *  3) ADR-071 자위권 발사 (기본 ON) — codex ADR-050 발사 3단 사다리 ③.
 *     지명·명령 없음 + 자기 MFR 추적 + 낙하 10km + 마감. 탄도축 한정.
 *
 * ⚠️ codex 인용 정정: `LINK_DELAYS.ifcn = 1`은 정본의 **신선도 판정이 아니다** —
 *    codex 주석이 그 값들을 "회귀 안전을 위해 무변경"인 레거시 메시지 레이턴시 상수로
 *    명시하고, 실제 모델은 reportingStaleness이며 flat 상수는 폐기됐다고 적고 있다.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(repo, 'js', f)); });
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

function run(sc, mode, flags, dur) {
  return KJ.runDES({
    scenario: KJ.scenarioById(sc), mode: mode, intensity: 1.5, seed: 12345,
    endTimeSec: dur || 900, deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, flags || {})
  });
}
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
function behaviourSha(r) {
  var c = JSON.parse(JSON.stringify(r));
  delete c.global.features; delete c.config;
  if (c.global.selfDefense) delete c.global.selfDefense;
  if (c.global.remoteFcGrants !== undefined) delete c.global.remoteFcGrants;
  return crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
}

console.log('# 1 — ADR-069 톱니 신선도 (기본 ON)');
// codex reportingStaleness 정의를 그대로 재현하는지: staleness = t − ⌊t/P⌋·P, 치역 [0,P)
var Sim = KJ.Simulation.prototype;
function stalenessAt(now, period) { return Sim._reportingStaleness.call({ now: now }, period); }
assert(stalenessAt(0, 16) === 0 && stalenessAt(16, 16) === 0 && stalenessAt(32, 16) === 0,
  '보고 시각(t = 0, P, 2P …)에서 나이 0');
assert(Math.abs(stalenessAt(15.9, 16) - 15.9) < 1e-9 && Math.abs(stalenessAt(17, 16) - 1) < 1e-9,
  '주기 내 선형 증가 후 재시작 (톱니)');
assert(stalenessAt(100, 16) >= 0 && stalenessAt(100, 16) < 16, '치역 [0, P)');
assert(stalenessAt(50, 0) === 0 && stalenessAt(50, -1) === 0, '주기 0 이하 = 실시간(전속 MFR) → 0');
// 평균 나이가 P 고정 근사의 절반 수준이어야 한다(전 주기 평균 = P/2)
var samples = 0, sum = 0;
for (var t = 0; t < 64; t += 0.1) { sum += stalenessAt(t, 16); samples++; }
assert(Math.abs(sum / samples - 8) < 0.2, '전 주기 평균 나이 ≈ P/2 (' + (sum / samples).toFixed(2) + 's) — 고정 근사 P의 절반');

var sawOn = run('sc3', 'asis'), sawOff = run('sc3', 'asis', { sawtoothFreshness: false });
assert(sawOn.global.features.sawtoothFreshness === true, '기본 실행이 sawtoothFreshness=true 신고 (ADR-072)');
assert(sawOff.global.features.sawtoothFreshness === false, '명시적 OFF는 false 신고');
assert(sha(sawOn) !== sha(sawOff), '토글이 결과를 바꾼다 — 장식이 아님');
assert(sha(run('sc3', 'asis')) === sha(sawOn), '톱니 ON 결정론 (RNG 미소비 — 전역 동기 시계)');
// 톱니는 보고 주기 링크에만 적용된다 — 음성 절차·데이터링크는 대상이 아니다
var cat = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL', features: { highResolutionDeployment: true } });
assert(cat.links.some(function (l) { return l.comm.asis && l.comm.asis.type === 'report-cycle'; }),
  'report-cycle 링크가 존재 (톱니 적용 대상)');
assert(cat.links.filter(function (l) { return /voice/.test((l.comm.asis || {}).type || ''); }).length === 4,
  '음성 절차 4링크는 report-cycle이 아니므로 톱니 대상 아님');

console.log('# 2 — ADR-071 자위권 발사 (기본 ON · codex ADR-050 조건 4개)');
assert(KJ.SELF_DEFENSE_RADIUS_KM === 10, 'codex 교리 상수 SELF_DEFENSE_RADIUS_KM = 10km');
var sdfOn = run('sc3', 'asis', null, 1800), sdfOff = run('sc3', 'asis', { selfDefenseFire: false }, 1800);
assert(sdfOn.global.features.selfDefenseFire === true, '기본 실행이 selfDefenseFire=true 신고 (ADR-072)');
assert(sdfOn.global.features.selfDefenseRadiusKm === 10, '반경이 features에 노출됨');
var fired = (sdfOn.global.c2Orders.fireByCause || {}).self_defense || 0;
assert(fired > 0, '자위권 발사가 실제로 발생 (' + fired + '발) — launchCause=self_defense 표식');
// ⚠️ 효과의 **방향·크기는 여기서 어서션하지 않는다**. 단일 seed 방향 주장은 취약하다 —
// 구 베이스(톱니 OFF)에서는 격추 133→152·중복 15→21이었는데 톱니가 켜진 신 베이스의 같은
// seed에서는 격추 144→144·중복 15→13이었다. 효과 크기는 paired 30 seed 원장
// (`artifacts/experiment/r75-base-*` ↔ `r75-sdfoff-*`, ADR-071·072 편향 원장)이 담당한다.
// 스위트는 **경로가 실제로 열리고 결과를 바꾼다**는 사실만 고정한다.
assert(behaviourSha(sdfOn) !== behaviourSha(sdfOff),
  '자위권 경로가 결과를 바꾼다 (격추 ' + sdfOff.global.killed + ' → ' + sdfOn.global.killed +
  ' · 중복 ' + sdfOff.global.coordination.duplicates + ' → ' + sdfOn.global.coordination.duplicates + ')');
assert(sdfOff.global.c2Orders.fireByCause.self_defense === undefined,
  '명시적 OFF에서는 자위권 발사가 한 발도 없음');
// 적용 범위: 탄도축 한정 — SC1(항공기·헬기)·SC2(무인기)는 발동하지 않는다
['sc1', 'sc2'].forEach(function (sc) {
  var on = run(sc, 'asis', null, 1800), off = run(sc, 'asis', { selfDefenseFire: false }, 1800);
  assert(((on.global.c2Orders.fireByCause || {}).self_defense || 0) === 0,
    sc + ': 비탄도 시나리오에서 자위권 미발동 (codex 적용범위 = SRBM/MLRS 한정)');
  assert(behaviourSha(on) === behaviourSha(off), sc + ': 따라서 거동이 OFF와 동일');
});

console.log('# 3 — ADR-070 원격 교전 + 웹 파티션 D1 (기본 OFF · 판단 보류)');
var eorOff = run('sc2', 'tobe', null, 1800), eorOn = run('sc2', 'tobe', { engageOnRemote: true }, 1800);
assert(eorOff.global.features.engageOnRemote === undefined, '기본은 OFF — features에 노출되지 않음');
assert(eorOn.global.features.engageOnRemote === true, 'ON 실행은 플래그 신고');
assert(eorOn.global.remoteFcGrants > 0, '원격 자격 부여가 발생 (' + eorOn.global.remoteFcGrants + '회)');
assert(eorOn.global.killed > eorOff.global.killed,
  '킬웹 이점 복원 — 격추 ' + eorOff.global.killed + ' → ' + eorOn.global.killed);
// As-Is는 어느 시나리오에서도 불변이어야 한다(killweb 전용 능력)
['sc1', 'sc2', 'sc3'].forEach(function (sc) {
  assert(behaviourSha(run(sc, 'asis', { engageOnRemote: true })) === behaviourSha(run(sc, 'asis')),
    sc + ' As-Is: 원격 교전 ON/OFF 거동 동일 (killweb 전용)');
});
// D1 웹 파티션 — 분류 규칙이 codex와 같은 필드로 판정되는지
var webOf = Sim._iadsWebOf;
var shooters = cat.nodes.filter(function (n) { return n.category === 'shooter'; });
var sensors = cat.nodes.filter(function (n) { return n.category === 'sensor'; });
assert(shooters.filter(function (n) { return webOf(n) === 'local_ad'; }).length === 3,
  '국지방공 웹 포대 3문 (forceOwner=ROK_LOCAL_AD)');
assert(sensors.filter(function (n) { return webOf(n) === 'local_ad'; }).length === 2,
  '국지방공 웹 센서 2기 (localAdPosKey 보유)');
assert(shooters.every(function (n) { return webOf(n) !== null; }) &&
  sensors.every(function (n) { return webOf(n) !== null; }), '전 자산이 웹에 분류됨(미분류 없음)');
// D2 — 탐지 전용 레이더는 발사 자격을 주지 못한다
['GREEN_PINE_B', 'GREEN_PINE_C', 'FPS117', 'TPS880K'].forEach(function (id) {
  assert(!KJ.IADS.hasFireControlCapability(KJ.SENSOR_TYPES[id], 'srbm'),
    'D2: ' + id + '는 탐지 전용 — 화력통제 자격 없음');
});
['LSAM_MFR', 'MSAM_MFR', 'PATRIOT_RADAR'].forEach(function (id) {
  assert(KJ.IADS.hasFireControlCapability(KJ.SENSOR_TYPES[id], 'srbm'),
    'D2: ' + id + '는 포대 MFR — 화력통제 자격 있음');
});

console.log('# 4 — ADR-072 반증 경로 배선 (라우터·UI)');
var router = fs.readFileSync(path.join(repo, 'js', 'core', 'router.js'), 'utf8');
assert(/saw: '1'/.test(router) && /sdf: '1'/.test(router), "라우터 DEFAULTS에 saw·sdf 기본 ON");
assert(/state\.saw = \(state\.saw === '0'/.test(router) && /state\.sdf = \(state\.sdf === '0'/.test(router),
  "명시적 '0'만 해제로 정규화");
var html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
assert(html.indexOf('id="sawtooth-toggle"') !== -1 && html.indexOf('id="self-defense-toggle"') !== -1,
  '토글 2종 존재');
// ADR-072: 여덟 토글 전부 접기 섹션 안에 있어야 한다(기본 동작이지 선택사항이 아님)
var adv = html.slice(html.indexOf('<details class="ctl-advanced"'), html.indexOf('</details>', html.indexOf('<details class="ctl-advanced"')));
['approval-chain-toggle', 'target-dispersion-toggle', 'southern-axes-toggle', 'link-semantics-toggle',
  'sensor-parity-toggle', 'engagement-cop-toggle', 'sawtooth-toggle', 'self-defense-toggle'
].forEach(function (id) {
  assert(adv.indexOf('id="' + id + '"') !== -1, id + '이 접기 섹션 안에 있음 (기본 동작 표현)');
});
['main.js', 'ui/panels.js', 'ui/sim-view.js', 'ui/mc-panel.js'].forEach(function (f) {
  var src = fs.readFileSync(path.join(repo, 'js', f), 'utf8');
  assert(/sawtoothFreshness\s*[:=]\s*.*saw !== '0'/.test(src) &&
    /selfDefenseFire\s*[:=]\s*.*sdf !== '0'/.test(src), f + ' modelConfig 배선');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
