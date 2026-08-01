/**
 * ADR-056 — To-Be 교전상태 통합(unifiedEngagementState) 회귀. **ADR-068로 기본 ON.**
 *
 * 배경(확정된 결함): To-Be의 상급 C2는 axis='KILL_WEB'(IAOC)인데 군단 AOC 교전현황의
 * 유일한 소비처 `_iadsSharedLocalEngagement`는 axis==='MCRC'만 소비했다. 그래서 To-Be는
 * 교전현황을 전달받고도 한 번도 소비하지 않았고(statusSharing.deconflicted=0),
 * 중복교전이 As-Is보다 많았다 — 이름 불일치에서 온 결함이지 의도된 모델이 아니다.
 *
 * ADR-068 이후 어서션 구조가 뒤집혔다: **기본(키 생략) == ON**이고, 반증 경로는 명시적
 * `unifiedEngagementState:false`다. 지문도 두 벌을 함께 고정해 어느 쪽이 기본인지 못 헷갈리게 한다.
 *
 * 검증 관점:
 *  1) 명시적 OFF가 결함 상태를 그대로 보존한다(SHA-256 4케이스 + 중복교전 잔존)
 *  2) 기본(ON)에서 To-Be가 교전현황을 실제로 소비하고 중복이 사라진다
 *  3) 기본 == 명시적 ON, 기본 != 명시적 OFF (토글이 장식이 아님)
 *  4) **As-Is는 ON/OFF가 거동 bit-exact** — KILL_WEB 축은 To-Be 전용이므로 비교의 공정성 보존
 *  5) 보존법칙 · 반증 경로 배선(cop 딥링크·UI 토글)
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

// 명시적 OFF(= 결함 상태) 지문 — LEGACY_HIRES × iads-c2 × ×1.5 × seed 12345 × 900초.
// ⚠️ 이 지문의 의미: "OFF == ADR-056 도입 전"이 아니라 **"OFF == 현행 기준선의 결함 팔"**이다.
// 기본값이 여덟 번 재기준화되며(ADR-061 이관 → 065 → 066 → 067 → 068 → 072 → 076 → 077)
// 배경이 계속 바뀌었다. ADR-076(교전창 캐시 키 정합)에서는 **SC3만** 움직였다.
// ADR-077(To-Be ABT 승인권자 MCRC → IAOC)에서는 **To-Be 두 지문만** 움직였다 — As-Is 두
// 지문은 글자 그대로 종전 값이다(변경이 tobe 필드에만 닿았다는 하드 체크).
var OFF_SHA = {
  'sc1|asis': 'a15cf4bfadb6bc7632964c8a47bcfd640b1ca03a02753655d6a6fac01901d9e6',
  'sc1|tobe': 'c344c3d5f1371eef14e4345f887280a2cdc6cb73f1897e269f0ba34e21be88cb',
  'sc3|asis': '0585f4bbe47013fc82e1a5792b43b2d9699cf64d26de6e39f2e6dc08a78accbd',
  'sc3|tobe': 'bf4a9ed40f0060ec9edd5823227ac697935bf9ea513ee2f9deb86f0c852966e7'
};
// OFF To-Be 중복교전 — 결함이 남아 있다는 증거. ADR-076에서 sc3 12 → 13,
// ADR-077에서 sc1 12 → 13 · sc3 13 → 15 (승인이 빨라져 교전 시도 자체가 늘었다 —
// 결함 팔이라 그 증가분이 곧 중복으로 남는다. ON 팔에서는 여전히 0이어야 한다).
var OFF_TOBE_DUP = { sc1: 13, sc3: 12 };

function run(sc, mode, flags) {
  return KJ.runDES({
    scenario: KJ.scenarioById(sc), mode: mode, intensity: 1.5, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2',
    features: Object.assign({ highResolutionDeployment: true }, flags || {})
  });
}
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
function behaviourSha(r) {
  // features 에코와 ON 전용 카운터를 제외한 **거동** 비교.
  var clone = JSON.parse(JSON.stringify(r));
  delete clone.global.features;
  if (clone.global.coordination) delete clone.global.coordination.copDeconflicted;
  return crypto.createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

console.log('# 1 — 명시적 OFF는 결함 상태를 보존한다 (반증 경로)');
var offRuns = {};
['sc1', 'sc3'].forEach(function (sc) {
  ['asis', 'tobe'].forEach(function (mode) {
    var r = run(sc, mode, { unifiedEngagementState: false });
    offRuns[sc + '|' + mode] = r;
    assert(sha(r) === OFF_SHA[sc + '|' + mode], sc + ' ' + mode + ' 명시적 OFF SHA-256 불변');
  });
});
['sc1', 'sc3'].forEach(function (sc) {
  var c = offRuns[sc + '|tobe'].global.coordination;
  assert(c.statusSharing.deconflicted === 0 && c.duplicates === OFF_TOBE_DUP[sc],
    sc + ' OFF To-Be: 결함 보존(교전현황 소비 0건 · 중복 ' + OFF_TOBE_DUP[sc] + ')');
});

console.log('# 2 — 기본(ON): To-Be가 교전현황을 실제로 소비하고 중복이 사라진다');
var onRuns = {};
['sc1', 'sc3'].forEach(function (sc) {
  var r = run(sc, 'tobe', null); // 키 생략 = 기본 ON (ADR-068)
  onRuns[sc] = r;
  var c = r.global.coordination, g = r.global;
  assert(c.statusSharing.deconflicted > 0,
    sc + ' 기본 To-Be: 순방향 소비 발생(KILL_WEB이 군단 AOC 현황을 읽음, ' + c.statusSharing.deconflicted + '건)');
  assert(c.copDeconflicted > 0,
    sc + ' 기본 To-Be: 역방향 COP 해소 발생(' + c.copDeconflicted + '건)');
  assert(c.duplicates === 0,
    sc + ' 기본 To-Be: 중복교전 완전 해소(' + OFF_TOBE_DUP[sc] + ' → ' + c.duplicates + ')');
  assert(g.spawned === g.killed + g.leaked + g.censoredRaw, sc + ' 기본 To-Be: 보존법칙');
  assert(r.global.features.unifiedEngagementState === true, sc + ' 기본 To-Be: 플래그 ON 신고');
});

console.log('# 3 — 토글이 장식이 아님 (기본 == 명시적 ON, != 명시적 OFF)');
['sc1', 'sc3'].forEach(function (sc) {
  var explicitOn = run(sc, 'tobe', { unifiedEngagementState: true });
  assert(sha(explicitOn) === sha(onRuns[sc]), sc + ' 키 생략 == 명시적 ON (ADR-068 기본값 전환)');
  assert(sha(onRuns[sc]) !== sha(offRuns[sc + '|tobe']), sc + ' 기본(ON) != 명시적 OFF');
  assert(offRuns[sc + '|tobe'].global.features.unifiedEngagementState === false,
    sc + ' 명시적 OFF는 false를 신고(미측정 아님)');
});

console.log('# 4 — As-Is는 ON/OFF가 거동 bit-exact (비교의 공정성)');
// 이 어서션이 ADR-068 전환의 핵심 근거다 — 전환이 As-Is를 전혀 건드리지 않으므로
// "To-Be에 유리하게 기준을 옮긴 것"이 아니라 To-Be 전용 결함을 고친 것이다.
['sc1', 'sc3'].forEach(function (sc) {
  var on = run(sc, 'asis', null);
  assert(behaviourSha(on) === behaviourSha(offRuns[sc + '|asis']),
    sc + ' As-Is: 기본(ON) == 명시적 OFF (KILL_WEB 축 부재 → 거동 무변화)');
});

console.log('# 5 — 반증 경로 배선 (라우터·UI)');
var router = fs.readFileSync(path.join(repo, 'js', 'core', 'router.js'), 'utf8');
assert(/cop: '1'/.test(router), "라우터 DEFAULTS에 cop 기본 ON ('1')");
assert(/state\.cop = \(state\.cop === '0'/.test(router), "명시적 '0'만 해제로 정규화");
assert(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').indexOf('id="engagement-cop-toggle"') !== -1,
  '상단 컨트롤에 교전현황 공유 토글 존재');
['main.js', 'ui/panels.js', 'ui/sim-view.js', 'ui/mc-panel.js'].forEach(function (f) {
  assert(/unifiedEngagementState\s*[:=]\s*.*cop !== '0'/.test(fs.readFileSync(path.join(repo, 'js', f), 'utf8')),
    f + " modelConfig가 cop → features 전달 (기본 ON, '0'만 해제)");
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
