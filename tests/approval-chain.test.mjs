/**
 * ADR-058 — 승인 계선 이식(approvalChain) 회귀.
 *
 * legacy `_decision`의 C2 이론(승인권자 해소·coord 협조 단계·kind='approval' 서비스·
 * 동적 권한위임·automation 3단계 차등)을 native 경로에 이식한다. 적용 범위는
 * As-Is LOCAL_AD 축(군단 AOC) — 다른 한국군 축은 자기 자신이 승인권자라 경유가 없고,
 * USFK 축은 ADR-036에 따라 계선을 적용하지 않는다.
 *
 * 검증 관점:
 *  1) OFF 카탈로그에 승인 coord 링크가 없다(wire shape 불변 — 실행 bit-exact은
 *     engagement-state-unification 스위트의 SHA-256 4케이스가 잠근다)
 *  2) ON 카탈로그: 군단AOC→MCRC coord 링크 As-Is VOICE 20초 / To-Be DL 2초
 *     (linkSemanticsV2 동시 ON이면 To-Be IFCN 1초·As-Is 음성은 불변 — 절차 지연이므로)
 *  3) ON As-Is: meanCoordDelaySec>0 · approval 도착>0 · (포화에서) delegation>0
 *  4) ON To-Be: 거치지 않음(coord 몫 0) · on-loop는 승인 서비스만 · auto-preauth만 있는
 *     시나리오(SC2)는 ON==OFF (features 에코 제외 bit-exact)
 *  5) USFK 축 불변: FULL 배치에서 USFK C2 노드에 approval 도착 0건
 *  6) 반증 플래그(approvalChainTobe): To-Be에도 경유가 생긴다(coord 몫>0)
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });

var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

function run(dep, sc, mode, x, dur, features) {
  return KJ.runDES({
    scenario: KJ.scenarioById(sc), mode: mode, intensity: x, seed: 12345, endTimeSec: dur,
    deploymentId: dep, modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, features || {})
  });
}
function apprArrivals(r, idFilter) {
  return r.nodes.reduce(function (s, n) {
    if (idFilter && n.id.indexOf(idFilter) === -1) return s;
    return s + ((n.arrivalsByKind && n.arrivalsByKind.approval) || 0);
  }, 0);
}

console.log('# 1 — 카탈로그 wire shape');
var offCat = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL');
var onCat = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', { approvalChain: true });
var onV2Cat = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', { approvalChain: true, linkSemanticsV2: true });
function apprLink(cat) { return cat.links.find(function (l) { return l.axis === 'corps_aoc_approval'; }); }
assert(!apprLink(offCat), 'OFF: 승인 coord 링크 없음 (wire shape 불변)');
// ADR-078: 군단AOC→MCRC 승인 협조는 **As-Is 전용**이 됐다. To-Be에서 그 협조가 MCRC 직결이
// 아니라 조율층(IAOC) 경유로 재편됐기 때문이다 — 같은 선의 속도만 바꾸면 조율층을 신설한 의미가
// 거동에 나타나지 않는다. 판정을 둘로 나눈다: As-Is 음성 20초는 그대로 잠그고, To-Be 대체 계선이
// 조율층에 실재하는지를 따로 본다. 절차가 없어진 게 아니라 옮겨갔다는 것을 여기서 고정한다.
var al = apprLink(onCat);
assert(al && al.kind === 'coord' && al.comm.asis.delaySec === 20 && al.comm.asis.type === 'voice' &&
  !al.comm.tobe, 'ON: 군단AOC→MCRC coord는 As-Is 음성 20초(절차 지연) 전용 — To-Be엔 없다');
var al2 = apprLink(onV2Cat);
assert(al2 && al2.comm.asis.delaySec === 20 && al2.comm.asis.type === 'voice' && !al2.comm.tobe,
  'ON+v2: As-Is 음성 20초 불변 (협조 절차 — v2 대칭화 비대상)');
var upperCoord = onV2Cat.links.filter(function (l) {
  return l.kind === 'coord' && l.to === (onV2Cat.roles && onV2Cat.roles.IAOC) &&
    !l.comm.asis && l.comm.tobe;
});
assert(upperCoord.length > 0 &&
  upperCoord.every(function (l) { return l.comm.tobe.type === 'ifcn' && l.comm.tobe.delaySec === 1; }),
  'ON+v2: To-Be 승인 협조는 조율층 경유 IFCN 1초 (' + upperCoord.length + '개 계선) — 절차가 옮겨간 자리');
var st = onCat.links.filter(function (l) { return l.axis === 'corps_aoc_engagement_status'; });
assert(st.length > 0 && st.every(function (l) { return l.kind === 'status'; }),
  '교전현황(status) 채널은 승인 채널과 분리 유지');
assert(st.some(function (l) { return l.comm.asis && !l.comm.tobe; }) &&
  st.some(function (l) { return !l.comm.asis && l.comm.tobe; }),
  '교전현황도 모드별로 갈렸다 — As-Is 군단AOC→MCRC 음성 · To-Be 군단AOC→조율층');

console.log('# 2 — ON As-Is 관측 (수용 기준)');
var on1 = run('HANBANDO_LEGACY_NORMAL', 'sc1', 'asis', 1.5, 900, { approvalChain: true });
assert(on1.global.meanCoordDelaySec > 0, 'As-Is meanCoordDelaySec > 0 (실측 ' + on1.global.meanCoordDelaySec.toFixed(1) + '초)');
assert(apprArrivals(on1) > 0, "As-Is kind='approval' 도착 > 0 (실측 " + apprArrivals(on1) + '건)');
var on3 = run('HANBANDO_LEGACY_NORMAL', 'sc3', 'asis', 3, 900, { approvalChain: true });
assert(on3.global.delegation.count > 0, '포화(SC3 ×3)에서 동적 권한위임 발동 (실측 ' + on3.global.delegation.count + '건)');
assert(on3.global.spawned === on3.global.killed + on3.global.leaked + on3.global.censoredRaw, 'ON 보존법칙');
var det1 = run('HANBANDO_LEGACY_NORMAL', 'sc1', 'asis', 1.5, 900, { approvalChain: true });
assert(JSON.stringify(det1) === JSON.stringify(on1), 'ON 결정론');

console.log('# 3 — ON To-Be (automation 차등)');
var tb1 = run('HANBANDO_LEGACY_NORMAL', 'sc1', 'tobe', 1.5, 900, { approvalChain: true });
assert(tb1.global.meanCoordDelaySec === 0, 'To-Be 협조 단계 없음 (on-loop는 경유 생략)');
assert(apprArrivals(tb1) > 0, 'To-Be on-loop 승인 서비스는 발생 (실측 ' + apprArrivals(tb1) + '건)');
function stripEcho(r) {
  var c = JSON.parse(JSON.stringify(r));
  delete c.global.features;
  if (c.global.coordination) delete c.global.coordination.copDeconflicted;
  return JSON.stringify(c);
}
var sc2on = run('HANBANDO_LEGACY_NORMAL', 'sc2', 'tobe', 1.5, 900, { approvalChain: true });
var sc2off = run('HANBANDO_LEGACY_NORMAL', 'sc2', 'tobe', 1.5, 900, null);
assert(stripEcho(sc2on) === stripEcho(sc2off), 'auto-preauth만 있는 SC2 To-Be: ON==OFF (에코 제외 bit-exact)');

console.log('# 4 — USFK 축 불변 (ADR-036)');
var full = run('HANBANDO_FULL_NORMAL', 'sc3', 'asis', 1.5, 300, { approvalChain: true });
assert(apprArrivals(full, 'USFK') === 0, 'USFK C2 노드에 approval 도착 0건');
assert(apprArrivals(full) > 0, 'FULL에서도 한국군 승인 서비스는 발생 (실측 ' + apprArrivals(full) + '건)');

console.log('# 5 — 반증 플래그 (approvalChainTobe)');
var cf = run('HANBANDO_LEGACY_NORMAL', 'sc1', 'tobe', 1.5, 900, { approvalChain: true, approvalChainTobe: true });
assert(cf.global.meanCoordDelaySec > 0, '반증 ON: To-Be에도 As-Is 승인 단계가 생김 (실측 ' + cf.global.meanCoordDelaySec.toFixed(1) + '초)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
