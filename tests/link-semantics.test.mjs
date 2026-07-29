/**
 * ADR-057 — 링크 의미론 IADS_codex 정합(linkSemanticsV2) 회귀.
 *
 * codex ADR-014: "탐지자산→상위 C2 정보 전달은 일률 지연이 아니라 보고 주기" —
 * As-Is는 센서별 reportingPeriod(그린파인 16 / FPS-117 8 / TPS-880K 4 / MFR 1)가 단일 출처.
 * To-Be(킬웹)는 codex 판정 "킬웹 보고주기 전부 1s" — IFCN 1초가 전 링크를 지배.
 * C2↔C2 As-Is는 전송 지연(codex shortRange 1초)으로 재해석한다.
 *
 * 검증 관점:
 *  1) OFF 카탈로그는 종전 상수(LONG 16 등)를 그대로 쓴다(변형 캐시 분리)
 *  2) ON에서 As-Is 센서→C2 지연 = 그 센서의 reportingPeriod (TPS-880K 4 ≠ 그린파인 16 — 수용 기준)
 *  3) ON에서 To-Be 전 링크 = IFCN 1초 (codex "킬웹 보고주기 전부 1s")
 *  4) ON에서 C2↔C2 As-Is = 1초(codex shortRange)
 *  5) 하향 명령(ECS→발사대)은 양 상태 모두 1초로 불변(codex shortRange와 이미 일치)
 *  6) ON 실행: 결정론·보존법칙·플래그 노출
 *  (OFF 실행의 bit-exact은 engagement-state-unification 스위트의 SHA-256 4케이스가 잠근다)
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

var off = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL');
var on = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', { linkSemanticsV2: true });
function link(cat, from, to) {
  return cat.links.find(function (l) { return l.from.indexOf(from) !== -1 && l.to.indexOf(to) !== -1; });
}
function delays(cat, from, to) {
  var l = link(cat, from, to);
  return l ? [l.comm.asis && l.comm.asis.delaySec, l.comm.tobe && l.comm.tobe.delaySec] : null;
}

console.log('# 1 — OFF 카탈로그 불변');
assert(off !== on, 'OFF/ON 변형 카탈로그가 캐시에서 분리됨');
assert(String(delays(off, 'SENSOR_GPR', 'KAMD')) === '16,2' &&
  String(delays(off, 'SENSOR_LLR_1C', 'MCRC')) === '16,2' &&
  String(delays(off, 'C2_MCRC', 'ICC_W1')) === '16,2', 'OFF: 종전 LONG 16/DL 2 유지');

console.log('# 2 — ON 센서별 보고 주기 (codex ADR-014)');
assert(String(delays(on, 'SENSOR_GPR', 'KAMD')) === '16,1', 'ON: 그린파인 As-Is 16초(reportingPeriod) · To-Be 1초(IFCN)');
assert(String(delays(on, 'SENSOR_ACR_E', 'MCRC')) === '8,1', 'ON: FPS-117 As-Is 8초 · To-Be IFCN 1초');
assert(String(delays(on, 'SENSOR_LLR_1C', 'MCRC')) === '4,1', 'ON: TPS-880K As-Is 4초 · To-Be IFCN 1초');
var gp = delays(on, 'SENSOR_GPR', 'KAMD'), llr = delays(on, 'SENSOR_LLR_1C', 'MCRC');
assert(gp[0] !== llr[0], '수용 기준: TPS-880K 4초 ≠ 그린파인 16초 (일률 지연 폐기)');
var mfr = on.links.find(function (l) { return l.axis === 'battery_mfr'; });
assert(mfr.comm.asis.delaySec === 1 && mfr.comm.tobe.delaySec === 1, 'ON: 포대 MFR As-Is 1초(reportingPeriod) · To-Be 1초(IFCN)');
var iaocLink = on.links.find(function (l) { return l.axis === 'killweb' && l.kind === 'report'; });
assert(iaocLink.comm.tobe.delaySec === 1 && iaocLink.comm.tobe.type === 'ifcn',
  'ON: 킬웹(IAOC) 전 링크 IFCN 1초 — codex "킬웹 보고주기 전부 1s"');

console.log('# 3 — ON C2↔C2 전송 지연');
assert(String(delays(on, 'C2_MCRC', 'ICC_W1')) === '1,1', 'ON: C2↔C2 As-Is 1초(codex shortRange) · To-Be 1초(IFCN)');
var cmd = on.links.find(function (l) { return l.kind === 'command'; });
var cmdOff = off.links.find(function (l) { return l.kind === 'command'; });
assert(cmd.comm.asis.delaySec === 1 && cmd.comm.tobe.delaySec === 1 &&
  cmdOff.comm.asis.delaySec === 1, '하향 명령(ECS→발사대) 1초 불변 — codex shortRange와 기존 일치');

console.log('# 4 — ON 실행 (결정론·보존·노출)');
['asis', 'tobe'].forEach(function (mode) {
  var cfg = {
    scenario: KJ.scenarioById('sc1'), mode: mode, intensity: 1.5, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: { highResolutionDeployment: true, linkSemanticsV2: true }
  };
  var a = KJ.runDES(cfg), b = KJ.runDES(cfg), g = a.global;
  assert(JSON.stringify(a) === JSON.stringify(b), 'sc1 ' + mode + ' ON 결정론');
  assert(g.spawned === g.killed + g.leaked + g.censoredRaw, 'sc1 ' + mode + ' ON 보존법칙');
  assert(g.features.linkSemanticsV2 === true, 'sc1 ' + mode + ' ON 플래그 노출');
});

console.log('# 5 — ADR-066 기본 ON 전환');
// (a) 엔진·어댑터 정합: features에 키가 없는 호출이 v2 카탈로그를 받아야 한다.
//     `=== true` 판정을 되살리면 "엔진은 ON인데 카탈로그는 구 링크값"인 조용한 불일치가 생긴다.
// 기본 실행은 ADR-065의 승인 계선·남부 축선도 함께 켜므로, 같은 변형 조합으로 비교해야 한다
// (`on`은 linkV2 단독 변형이라 캐시 키가 다르다 — 동일성 비교의 대상이 아니다).
var onFull = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL',
  { linkSemanticsV2: true, approvalChain: true, southernAxes: true });
var dflt = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL',
  features: { highResolutionDeployment: true } });
assert(dflt === onFull, '키 생략 호출이 v2 변형 카탈로그를 받음 (어댑터가 엔진 기본값과 정합)');
var explicitOff = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL',
  features: { highResolutionDeployment: true, linkSemanticsV2: false } });
assert(explicitOff !== on, '명시적 false만 구 카탈로그로 되돌린다');

// (b) 기본 실행이 플래그를 ON으로 신고하고, 명시적 OFF는 다른 결과를 낸다.
var runCfg = function (f) {
  return KJ.runDES({ scenario: KJ.scenarioById('sc1'), mode: 'asis', intensity: 1.5, seed: 12345,
    endTimeSec: 900, deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, f || {}) });
};
var omitted = runCfg(null), forcedOff = runCfg({ linkSemanticsV2: false });
assert(omitted.global.features.linkSemanticsV2 === true, '키 생략 실행이 linkSemanticsV2=true를 신고');
assert(forcedOff.global.features.linkSemanticsV2 === false, '명시적 OFF 실행은 false를 신고(미측정 아님)');
assert(JSON.stringify(omitted) !== JSON.stringify(forcedOff), '토글이 실제로 결과를 바꾼다 — 장식이 아님');

// (c) 구 기본값(OFF)에는 As-Is가 To-Be보다 **빠른** 링크가 있었다 — 전환 사유의 실측 고정.
//     통합 C2가 포대 내부 링크를 느리게 만든다는 뜻이라 어떤 해석으로도 정당화되지 않는다.
function inverted(cat) {
  return cat.links.filter(function (l) {
    return l.comm.asis && l.comm.tobe && l.comm.asis.delaySec < l.comm.tobe.delaySec;
  }).length;
}
assert(inverted(off) === 16, '구 카탈로그: As-Is가 To-Be보다 빠른 링크 16개 (ADR-066 전환 사유)');
assert(inverted(on) === 0, 'v2 카탈로그: 역전 링크 0개');

// (d) 전선(데이터링크)과 절차(음성)의 분리 — 남는 비대칭은 절차·보고 주기뿐이다.
var voiceAsym = onFull.links.filter(function (l) {
  return l.comm.asis && l.comm.tobe && /voice/.test(l.comm.asis.type);
});
assert(voiceAsym.length === 4 && voiceAsym.every(function (l) { return l.comm.tobe.delaySec === 1; }),
  '음성 협조·교전현황 4링크는 비대칭 유지 — 링크(전선)가 아니라 절차이므로 대칭화 대상이 아님');
assert(onFull.links.filter(function (l) {
  return l.kind === 'coord' && l.comm.asis && l.comm.tobe &&
    !/voice/.test(l.comm.asis.type) && l.comm.asis.delaySec !== l.comm.tobe.delaySec;
}).length === 0, 'C2↔C2 데이터링크는 양 모드 동일(1초) — 전선 대칭 확보');

// (e) UI·라우터 배선 — 반증 경로가 화면에 있어야 한다(ADR-065가 appr/disp/south에 준 것과 동일).
var fs = require('node:fs');
var repo = path.join(root, '..');
var router = fs.readFileSync(path.join(repo, 'js', 'core', 'router.js'), 'utf8');
assert(/linkv2: '1'/.test(router), "라우터 DEFAULTS에 linkv2 기본 ON ('1')");
assert(/state\.linkv2 = \(state\.linkv2 === '0'/.test(router), "명시적 '0'만 해제로 정규화");
assert(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').indexOf('id="link-semantics-toggle"') !== -1,
  '상단 컨트롤에 링크 의미론 토글 존재');
['main.js', 'ui/panels.js', 'ui/sim-view.js', 'ui/map-view.js', 'ui/mc-panel.js'].forEach(function (f) {
  // 대입(`x = ...`)과 객체 리터럴(`x: ...`) 두 형태를 모두 허용한다 — 지도·MC 탭은 후자다.
  assert(/linkSemanticsV2\s*[:=]\s*.*linkv2 !== '0'/.test(fs.readFileSync(path.join(repo, 'js', f), 'utf8')),
    f + " modelConfig가 linkv2 → features 전달 (기본 ON, '0'만 해제)");
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
