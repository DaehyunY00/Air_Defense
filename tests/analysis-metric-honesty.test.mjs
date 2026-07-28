/**
 * ADR-062 — 분석 탭 지표 정직성 회귀.
 *
 * 검증 관점:
 *  1) 死 지표 제거: '무기 최대 평균대기 (Wq)'는 native에 대응 관측량이 없다(사수 대기행렬 부재).
 *     실제로 포화 셀에서도 사수 Wq가 0임을 실측으로 고정한다 — 되살리면 이 어서션이 깨진다.
 *  2) 라벨 정정: 사수 노드의 drops는 capacityBlocks(차단 후 재시도)이지 영구 상실이 아니다.
 *  3) 미측정 표기: 승인 계선 OFF 실행은 ⑥⑦ 승인·협조 지표를 0이 아니라 '미측정'으로 표시한다.
 *  4) 토글 배선: appr 딥링크·UI 토글이 features.approvalChain으로 전달되고, ON에서 지표가 실제로 발화한다.
 *  5) OFF 불변: 토글 OFF 실행은 종전 기본 실행과 bit-exact.
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

function run(opts) {
  var features = { highResolutionDeployment: true };
  if (opts.appr) features.approvalChain = true;
  return KJ.runDES({
    scenario: KJ.scenarioById(opts.sc || 'sc3'), mode: opts.mode || 'asis',
    intensity: opts.x || 1.5, seed: 12345, endTimeSec: opts.dur || 600,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', features: features
  });
}
function maxWq(res, cat) {
  return res.nodes.reduce(function (m, n) {
    return (n.category === cat && isFinite(n.Wq) && n.Wq > m) ? n.Wq : m;
  }, 0);
}
function maxWqByKind(res, kind) {
  return res.nodes.reduce(function (m, n) {
    if (n.category !== 'c2' || !n.WqByKind) return m;
    var v = n.WqByKind[kind] || 0;
    return (isFinite(v) && v > m) ? v : m;
  }, 0);
}
function maxRhoByKind(res, kind) {
  return res.nodes.reduce(function (m, n) {
    if (n.category !== 'c2' || !n.rhoByKind) return m;
    var v = n.rhoByKind[kind] || 0;
    return v > m ? v : m;
  }, 0);
}

// ── 1. 사수 대기행렬은 native에 존재하지 않는다 (死 지표 제거 근거) ──
console.log('# ⑧ 사수 Wq — native 대응 관측량 부재');
var sat = run({ sc: 'sc3', x: 1.5 });
var shooterBlocks = sat.nodes.reduce(function (s, n) { return n.category === 'shooter' ? s + n.drops : s; }, 0);
assert(shooterBlocks > 0, '포화 셀에서 사수 슬롯 차단이 실제로 발생 (검증 전제, ' + shooterBlocks + '건)');
assert(maxWq(sat, 'shooter') === 0,
  '차단이 발생해도 사수 Wq는 0 — 대기 없이 즉시 차단·재시도 구조(ADR-062: 지표 제거 근거)');
assert(sat.nodes.some(function (n) { return n.category === 'shooter' && n.capacityBlocks > 0; }),
  '사수 drops는 capacityBlocks(차단)로 계상됨 — 영구 상실 라벨이 아님');

// ── 2. 분석 탭 소스가 死 지표를 다시 노출하지 않는지 (회귀 잠금) ──
console.log('# 분석 탭 소스 잠금');
var panels = fs.readFileSync(path.join(root, 'js', 'ui', 'panels.js'), 'utf8');
assert(panels.indexOf("label: '무기 최대 평균대기 (Wq)'") === -1,
  "'무기 최대 평균대기 (Wq)' 행이 분석 탭에서 제거됨(ADR-062)");
assert(panels.indexOf("label: '동시교전 슬롯 차단 (재시도)'") !== -1,
  "사수 차단 지표 라벨이 '동시교전 슬롯 차단 (재시도)'로 정정됨");
assert(/na: apprNa/.test(panels), '⑥⑦ 승인·협조 지표에 미측정(na) 표기가 배선됨');

// ── 3. 승인 계선 OFF는 '0'이 아니라 '미측정' 조건 ──
console.log('# ⑥⑦ 승인·협조 지표의 측정 조건');
var off = run({ sc: 'sc3', x: 1.5 });
assert(!off.global.features.approvalChain,
  'OFF 실행은 features.approvalChain을 노출하지 않음(미측정 판정 근거)');
assert((off.global.meanCoordDelaySec || 0) === 0 && maxRhoByKind(off, 'approval') === 0 &&
  maxWqByKind(off, 'approval') === 0 && off.global.delegation.count === 0,
  'OFF 실행에서 승인·협조 4종 지표가 전부 0 — 값이 아니라 미측정으로 표시해야 하는 이유');

var on = run({ sc: 'sc3', x: 1.5, appr: true });
assert(on.global.features.approvalChain === true, 'ON 실행은 features.approvalChain=true를 신고');
assert(on.global.meanCoordDelaySec > 0 && maxRhoByKind(on, 'approval') > 0 && maxWqByKind(on, 'approval') > 0,
  'ON 실행에서 협조몫·승인 ρ·승인 Wq가 실제로 발화 (협조 ' +
  on.global.meanCoordDelaySec.toFixed(1) + 's · ρ ' + maxRhoByKind(on, 'approval').toFixed(3) +
  ' · Wq ' + maxWqByKind(on, 'approval').toFixed(1) + 's)');
var heavy = run({ sc: 'sc3', x: 3, dur: 1200, appr: true });
assert(heavy.global.delegation.count > 0,
  '고부하 ON 실행에서 분권 전환도 발화 (' + heavy.global.delegation.count + '회) — 부하의 함수');

// ── 4. UI·라우터 배선 ──
console.log('# 토글 배선 (라우터·컨트롤·모델설정)');
var router = fs.readFileSync(path.join(root, 'js', 'core', 'router.js'), 'utf8');
assert(/appr: '0'/.test(router), '라우터 DEFAULTS에 appr 기본 OFF 등록');
assert(/state\.appr = \(state\.appr === '1'/.test(router), '알 수 없는 appr 값은 OFF로 정규화');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('id="approval-chain-toggle"') !== -1, '상단 컨트롤에 승인 계선 토글 존재');
['main.js', 'ui/panels.js', 'ui/sim-view.js'].forEach(function (f) {
  var src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  assert(/approvalChain = true/.test(src), f + ' modelConfig가 appr → features.approvalChain 전달');
});
var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
assert(/\.pl-m-na-note/.test(css), '미측정 표기 스타일 존재');

// ── 5. OFF bit-exact (기본 결과 불변) ──
console.log('# OFF bit-exact');
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
var plain = KJ.runDES({
  scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1.5, seed: 12345,
  endTimeSec: 600, deploymentId: 'HANBANDO_LEGACY_NORMAL',
  features: { highResolutionDeployment: true }
});
assert(sha(plain) === sha(off), '토글 OFF 실행 == 종전 기본 실행 (SHA-256 동일)');
assert(sha(plain) !== sha(on), 'ON 실행은 실제로 다른 결과 — 토글이 무의미한 장식이 아님');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
