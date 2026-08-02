/**
 * ADR-067 — 레이더→C2 보고 주기 양 모드 공통화(`sensorReportParity`) 회귀.
 *
 * 보고 주기는 센서의 물리 속성이므로 C2 구조에 따라 달라질 수 없다. 종전에는 To-Be 보고
 * 링크만 IFCN 1초로 덮여 **같은 그린파인이 To-Be에서 16배 빨리 보고**했다. codex `ifcn:1`의
 * 논거(융합 신선도)는 엔진이 이미 최속 센서 경로를 고르므로(`_iadsReportBundle`) 이중
 * 계상이다 — 정본 이탈 사유는 ADR-067·params.md IADS-LINK-IFCN-01에 기록.
 *
 * 검증 관점:
 *  1) 대칭: 센서 발신 report 링크의 As-Is/To-Be 지연이 전부 같다 — **킬웹 sensor→IAOC 포함**
 *  2) 대칭 제외: 음성 협조·교전현황은 비대칭 유지(전선 아님 — G6 ① 관측 대상)
 *  3) C2 발신 report(MCRC→군단 AOC 항적 중계)는 C2↔C2이므로 1초 유지
 *  4) OFF는 codex 해석(To-Be 전 보고 1초) 복원 · 캐시 분리
 *  5) 기본 ON 배선(엔진·어댑터·라우터·UI) · 실행 결정론·보존법칙
 *  6) 방향: As-Is는 불변, To-Be만 느려진다(변경이 To-Be 링크에만 닿는다는 구조적 보장)
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
const root = path.join(repo, 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

function catalog(extra) {
  return KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL',
    features: Object.assign({ highResolutionDeployment: true }, extra || {}) });
}
var on = catalog(), off = catalog({ sensorReportParity: false });
function sensorIds(cat) {
  var s = {};
  cat.nodes.forEach(function (n) { if (n.category === 'sensor') s[n.id] = n; });
  return s;
}
function sensorReports(cat) {
  var s = sensorIds(cat);
  return cat.links.filter(function (l) { return l.kind === 'report' && s[l.from]; });
}

console.log('# 1 — 레이더→C2 보고 링크 대칭');
var rep = sensorReports(on);
assert(rep.length > 0, '센서 발신 report 링크 존재 (' + rep.length + '개)');
var asym = rep.filter(function (l) {
  return l.comm.asis && l.comm.tobe && l.comm.asis.delaySec !== l.comm.tobe.delaySec;
});
assert(asym.length === 0, '센서 발신 report 링크 비대칭 0건 — 같은 레이더는 양 모드 같은 주기로 보고');
// ADR-080: 비편제 국지레이더→방공C2A 링크는 As-Is 전용이라 tobe 측이 없다 — 대칭성
// 판정은 양 모드에 있는 링크만 대상으로 한다(없는 쪽을 참조하면 여기서 죽는다. 실측).
assert(rep.filter(function (l) { return l.comm.tobe; })
  .every(function (l) { return l.comm.tobe.type === 'report-cycle'; }),
  'To-Be 측이 IFCN이 아니라 report-cycle 타입 — 보고 주기가 지배');

console.log('# 2 — 킬웹 sensor→IAOC (놓치면 To-Be가 전혀 안 바뀌는 구간)');
var kw = rep.filter(function (l) { return l.axis === 'killweb'; });
assert(kw.length > 0, '킬웹 센서 보고 링크 ' + kw.length + '개가 대칭화 대상에 포함됨');
var kwDelays = Array.from(new Set(kw.map(function (l) { return l.comm.tobe.delaySec; }))).sort(function (a, b) { return a - b; });
assert(kwDelays.length > 1 && kwDelays.indexOf(16) !== -1,
  '킬웹 보고 지연이 센서별로 차등 (' + kwDelays.join('/') + '초) — 종전에는 전부 1초였다');
var kwOff = sensorReports(off).filter(function (l) { return l.axis === 'killweb'; });
assert(kwOff.every(function (l) { return l.comm.tobe.delaySec === 1 && l.comm.tobe.type === 'ifcn'; }),
  'OFF에서는 킬웹 보고가 전부 IFCN 1초 — codex 해석 복원');

console.log('# 3 — 대칭화하지 않는 것');
// ADR-078로 육↔공 협조 절차 비대칭이 「같은 링크, 다른 속도」에서 **모드 전용 링크 쌍**으로
// 바뀌었다(To-Be에서 그 협조가 MCRC 직결 → 조율층 IAOC 경유로 재편). 그래서 판정을 둘로
// 나눈다: (1) 양 모드 공통 링크는 전선이 완전 대칭 — 이제 예외가 없다. (2) 절차 비대칭은
// 사라진 게 아니라 옮겨갔다 — axis·kind·타입·지연까지 전수 고정해 감사를 유지한다.
// ⚠️ 숫자만 0으로 맞추면 "To-Be만 빠른 전선"을 막던 이 절이 통째로 무력해진다.
var allAsym = on.links.filter(function (l) {
  return l.comm.asis && l.comm.tobe && l.comm.asis.delaySec !== l.comm.tobe.delaySec;
});
assert(allAsym.length === 0,
  '양 모드 공통 링크는 전선 지연이 전부 대칭 — To-Be만 빠른 전선은 하나도 없다');
function sig(list) {
  return list.map(function (l) {
    var c = l.comm.asis || l.comm.tobe;
    return l.axis + '|' + l.kind + '|' + c.type + '|' + c.delaySec;
  }).sort().join(' , ');
}
// ADR-080: As-Is 전용 목록이 6건 → 14건으로 늘었다. 국지레이더(TPS880K)의 MCRC 직보를
// 걷어내면서 ① 비편제 6대가 As-Is에서만 최근접 방공C2A로 보고하고(abt_local, To-Be는
// IAOC 직결이 이미 있어 새 링크를 깔지 않는다 — To-Be bit-exact 서명 유지), ② 방공C2A가
// 융합 국지항적을 MCRC로 문자 전파하는 상행 계선(corps_aoc_track_share)이 생겼기 때문이다.
assert(sig(on.links.filter(function (l) { return l.comm.asis && !l.comm.tobe; })) === [
  'abt_local|report|report-cycle|4',
  'abt_local|report|report-cycle|4',
  'abt_local|report|report-cycle|4',
  'abt_local|report|report-cycle|4',
  'abt_local|report|report-cycle|4',
  'abt_local|report|report-cycle|4',
  'corps_aoc_approval|coord|voice|20',
  'corps_aoc_approval|coord|voice|20',
  'corps_aoc_engagement_status|status|voice-vtc|135',
  'corps_aoc_engagement_status|status|voice-vtc|135',
  'corps_aoc_track_share|report|chat|45',
  'corps_aoc_track_share|report|chat|45',
  'mcrc_to_corps_aoc_track|report|chat|45',
  'mcrc_to_corps_aoc_track|report|chat|45'
].join(' , '),
  'As-Is 전용 계선 14건 — 음성 승인 2 · 음성/VTC 현황 2 · 문자 중계 하행 2 · 문자 전파 상행 2 · 비편제 국지레이더→방공C2A 6');
// ADR-080: 국지레이더 → MCRC 직보는 As-Is에서 사라졌다(To-Be 통합망 배포 전용).
// 2022-12 무인기 사건의 실패 모드(육군이 본 것을 공군이 제때 못 봄)가 모델에 존재하게 하는 핵심.
var larDirect = on.links.filter(function (l) {
  return /SENSOR_(LAR|LLR|SR_)/.test(l.from) && /MCRC/.test(l.to);
});
assert(larDirect.length === 8 && larDirect.every(function (l) { return !l.comm.asis && l.comm.tobe; }),
  '국지레이더→MCRC 직보 8건은 전부 To-Be 전용 — As-Is는 방공C2A 문자 전파를 거친다');
var iaocId = on.roles && on.roles.IAOC;
var tobeStatus = on.links.filter(function (l) {
  return l.kind === 'status' && !l.comm.asis && l.comm.tobe;
});
assert(!!iaocId && tobeStatus.length === 2 && tobeStatus.every(function (l) { return l.to === iaocId; }),
  'To-Be 교전현황은 조율층 계선으로 대체 — 절차 비대칭은 없어진 게 아니라 IAOC로 옮겨갔다');
var relay = on.links.filter(function (l) { return l.axis === 'mcrc_to_corps_aoc_track'; });
assert(relay.length > 0 && relay.every(function (l) {
  // ADR-079: 육↔공 교신 수단은 음성과 문자(서버 채팅)다 — 실시간 데이터링크가 아니다.
  // 그래서 v2(전선 지연 codex 정합) 대상이 아니며, 음성 협조를 대칭화에서 뺀 것과 같은 이유다.
  return l.comm.asis.type === 'chat' && l.comm.asis.delaySec === 45 && !l.comm.tobe;
}), 'C2 발신 항적 중계(MCRC→군단 AOC)는 As-Is 문자 45초 · To-Be엔 없다(조율층이 대신 내려준다)');

console.log('# 4 — 캐시 분리·기본값 배선');
assert(on !== off, 'ON/OFF 변형 카탈로그가 캐시에서 분리됨');
assert(catalog({ sensorReportParity: true }) === on, '명시적 true == 키 생략(기본 ON)');

function run(sc, mode, f) {
  return KJ.runDES({ scenario: KJ.scenarioById(sc), mode: mode, intensity: 1.5, seed: 12345,
    endTimeSec: 900, deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, f || {}) });
}
function behaviourSha(r) {
  var c = JSON.parse(JSON.stringify(r));
  delete c.global.features; delete c.config;
  return crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
}
var omitted = run('sc3', 'asis');
assert(omitted.global.features.sensorReportParity === true, '키 생략 실행이 sensorReportParity=true를 신고');
assert(run('sc3', 'asis', { sensorReportParity: false }).global.features.sensorReportParity === false,
  '명시적 OFF 실행은 false를 신고(미측정 아님)');

console.log('# 5 — 방향: As-Is 불변 · To-Be만 변화');
// 변경이 To-Be 보고 링크에만 닿으므로 As-Is 거동은 어느 시나리오에서도 움직이면 안 된다.
// 움직인다면 As-Is 링크를 잘못 건드린 것이다(구조적 보장을 어서션으로 고정).
['sc1', 'sc2', 'sc3'].forEach(function (sc) {
  assert(behaviourSha(run(sc, 'asis')) === behaviourSha(run(sc, 'asis', { sensorReportParity: false })),
    sc + ' As-Is: ON == OFF (변경이 To-Be 링크에만 닿음)');
  assert(behaviourSha(run(sc, 'tobe')) !== behaviourSha(run(sc, 'tobe', { sensorReportParity: false })),
    sc + ' To-Be: ON != OFF (보고 주기가 실제로 적용됨)');
});

console.log('# 6 — 실행 건전성');
['asis', 'tobe'].forEach(function (mode) {
  var a = run('sc1', mode), b = run('sc1', mode), g = a.global;
  assert(JSON.stringify(a) === JSON.stringify(b), 'sc1 ' + mode + ' 결정론');
  assert(g.spawned === g.killed + g.leaked + g.censoredRaw, 'sc1 ' + mode + ' 보존법칙');
});

console.log('# 7 — 반증 경로 (라우터·UI)');
var router = fs.readFileSync(path.join(repo, 'js', 'core', 'router.js'), 'utf8');
assert(/rp: '1'/.test(router), "라우터 DEFAULTS에 rp 기본 ON ('1')");
assert(/state\.rp = \(state\.rp === '0'/.test(router), "명시적 '0'만 해제로 정규화");
assert(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').indexOf('id="sensor-parity-toggle"') !== -1,
  '상단 컨트롤에 보고 주기 대칭 토글 존재');
['main.js', 'ui/panels.js', 'ui/sim-view.js', 'ui/map-view.js', 'ui/mc-panel.js'].forEach(function (f) {
  assert(/sensorReportParity\s*[:=]\s*.*rp !== '0'/.test(fs.readFileSync(path.join(repo, 'js', f), 'utf8')),
    f + " modelConfig가 rp → features 전달 (기본 ON, '0'만 해제)");
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
