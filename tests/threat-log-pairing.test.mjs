/**
 * 위협 항적 CRN 짝맞춤 · trace 비침습성 회귀.
 *
 * ⚠️ 원래는 [분석] 탭의 As-Is↔To-Be 병렬 로그를 위한 스위트였다. 그 탭은 전면 개편을 위해
 * 제거됐고, **병렬 대조 자체는 결과 모달(js/ui/sim-view.js)로 옮겨 살아 있다.** ④의 검증
 * 대상 파일이 panels.js → sim-view.js로 바뀌었을 뿐 잠그는 명제는 같다. 여기에 더해
 * "어디가 다른지"를 색으로 구분하는 배선(sd-only/diff/shift/same)도 함께 고정한다 —
 * 색만으로 뜻을 싣지 않도록 아이콘 채널이 함께 있는지까지 본다.
 *
 * 이 로그의 전제는 하나다: **동일 seed에서 두 모드의 위협 집단이 같다**(CRN — 공통난수).
 * 도착 스트림이 모드 의존 로직과 분리돼 있어야만 성립하며, 이것이 깨지면 좌·우를 나란히
 * 놓는 비교 자체가 무의미해진다(다른 위협을 비교하게 된다). 그래서 주석이 아니라
 * 실측으로 고정한다.
 *
 * 검증 관점:
 *  1) CRN 짝맞춤: 두 모드의 threatTraces가 ID·발생시각·축선·유형까지 동일 순서로 일치.
 *  2) 판정 분기 실재: 그럼에도 결과(outcome)가 갈리는 항적이 존재 — 없으면 이 화면은
 *     보여줄 것이 없다는 뜻이므로 유의미한 대조가 성립하는지 함께 고정한다.
 *  3) desPair 배선: tracePair 없이는 반대 모드 trace가 없고(기존 재생 경로 성능 보존),
 *     tracePair=true면 양쪽 다 생긴다.
 *  4) UI 배선: sim-view.js(결과 모달)가 tracePair를 요청하고 desPair 결과를 쓰며,
 *     좌=As-Is·우=To-Be가 현재 모드와 무관하게 고정되고, 차이 강조가 색 + 아이콘
 *     **두 채널**로 표시된다.
 */
import path from 'node:path';
import fs from 'node:fs';
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

var FEATURES = {
  highResolutionDeployment: true, approvalChain: true, threatTargetDispersion: true,
  southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  unifiedEngagementState: true, sawtoothFreshness: true, selfDefenseFire: true
};
function run(mode, extra) {
  return KJ.runDES(Object.assign({
    scenario: KJ.scenarioById('sc3'), mode: mode, intensity: 1.5, seed: 12345,
    endTimeSec: 900, deploymentId: 'HANBANDO_LEGACY_NORMAL', features: FEATURES,
    trace: true, traceCap: 300
  }, extra || {}));
}

console.log('# ① CRN — 두 모드의 위협 집단 동일성 (병렬 대조의 전제)');
var a = run('asis'), b = run('tobe');
var ta = a.threatTraces || [], tb = b.threatTraces || [];
assert(ta.length > 0 && tb.length > 0, '양 모드 모두 항적 추적 생성 (asis ' + ta.length + ' · tobe ' + tb.length + ')');
assert(ta.length === tb.length, '추적 항적 수 동일 (' + ta.length + ' = ' + tb.length + ')');
assert(ta.map(function (t) { return t.id; }).join('|') === tb.map(function (t) { return t.id; }).join('|'),
  '위협 ID가 같은 순서로 완전 일치 — ID 기준 1:1 대응이 성립');
assert(ta.every(function (t, i) { return tb[i] && Math.abs(t.spawnT - tb[i].spawnT) < 1e-9; }),
  '발생시각(spawnT) 전건 일치 — 도착 스트림이 모드 불변');
assert(ta.every(function (t, i) { return tb[i] && t.axis === tb[i].axis && t.type === tb[i].type; }),
  '축선·위협유형 전건 일치');

console.log('# ② 판정 분기 — 대조가 실제로 보여줄 것이 있는가');
var diverged = ta.filter(function (t, i) { return tb[i] && t.outcome !== tb[i].outcome; });
assert(diverged.length > 0, '결과가 갈린 항적 존재 (' + diverged.length + '/' + ta.length + '건) — 구조 차이의 항적 단위 증거');
var gained = ta.filter(function (t, i) {
  return tb[i] && t.outcome !== 'killed' && tb[i].outcome === 'killed';
});
assert(gained.length > 0, 'As-Is 실패 → To-Be 격추로 뒤집힌 항적 존재 (' + gained.length + '건)');
assert(ta.some(function (t) { return typeof t.outcome === 'string' && t.outcome.indexOf('leaked:') === 0; }),
  "요격 실패 outcome이 'leaked:<코드>' 형식 — UI의 사유 라벨 파싱 전제");

console.log('# ③ desPair 배선 — tracePair 옵트인');
var runtime = fs.readFileSync(path.join(root, 'js/workers/sim-worker-runtime.js'), 'utf8');
var client = fs.readFileSync(path.join(root, 'js/core/sim-worker-client.js'), 'utf8');
assert(/tracePair\s*\?\s*cfg\.trace\s*:\s*false/.test(runtime),
  '워커 런타임: tracePair일 때만 반대 모드 trace (기본은 종전대로 off)');
assert(/tracePair\s*\?\s*cfg\.trace\s*:\s*false/.test(client),
  '메인스레드 폴백: 동일 규약 — 실행 경로에 따라 화면이 달라지지 않음');

console.log('# ④ UI 배선 — 병렬 대조가 단일 실행이 아니라 쌍 실행을 쓴다');
// [분석] 탭이 제거되면서 이 병렬 대조는 **결과 모달(js/ui/sim-view.js)**로 옮겨졌다.
// 검증 대상 파일만 바뀌었을 뿐 잠그는 명제는 종전과 같다.
var sim = fs.readFileSync(path.join(root, 'js/ui/sim-view.js'), 'utf8');
assert(/tracePair:\s*true/.test(sim), 'sim-view.js가 desPair에 tracePair를 요청');
assert(/trace:\s*true,\s*traceCap:\s*300/.test(sim), 'sim-view.js가 cfg에 trace를 켬 — 없으면 양쪽 다 빈 로그');
assert(/threatTraces/.test(sim), 'sim-view.js가 desPair 결과의 threatTraces를 직접 읽음');
assert(/run\.cfg\.mode === 'asis' \? run\.res : run\.resOther/.test(sim),
  '좌=As-Is·우=To-Be가 현재 모드와 무관하게 고정 (상단 토글이 좌우를 뒤집지 않는다)');
assert(/As-Is/.test(sim) && /To-Be/.test(sim), '좌우 라벨이 코드에 고정');
// 차이 강조는 색만으로 뜻을 싣지 않는다 — 아이콘·글자 채널이 함께 있어야 한다.
assert(/sd-only/.test(sim) && /sd-diff/.test(sim) && /sd-shift/.test(sim) && /sd-same/.test(sim),
  '단계 차이 4분류(only·diff·shift·same)가 배선됨');
assert(/＋/.test(sim) && /◆/.test(sim) && /⏱/.test(sim),
  '차이 표시가 색 외에 아이콘 채널도 사용 (색각 이상·흑백에서도 구분 가능)');
var css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
assert(/\.alog-stages li\.sd-only/.test(css) && /\.alog-stages li\.sd-diff/.test(css) &&
  /\.alog-stages li\.sd-shift/.test(css), '단계 차이 3종 스타일 존재');
assert(/\.dv-gain-row/.test(css) && /\.dv-loss-row/.test(css),
  '판정이 갈린 행의 좌측 색 띠 스타일 존재');

console.log('# ④-2 참여 노드 타임라인 — 개발 중 실제로 밟은 결함 2건을 고정한다');
assert(/timelineHtml/.test(sim) && /ptl-wrap/.test(sim), '참여 노드 타임라인이 배선됨');
// ① C2는 노드 id가 아니라 typeId로 기록된다(`책임C2:KAMD_OPS`). id만 색인하면
//    **지휘소 행이 통째로 사라진다** — 실제로 그렇게 나왔다.
assert(/책임C2:'\s*\+\s*commander\.typeId/.test(
  fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8')),
  '엔진이 책임 C2를 typeId로 기록 (색인 전제)');
assert(/n\.typeId/.test(sim) && /byType/.test(sim),
  'sim-view.js 노드 색인이 id와 typeId를 모두 잡음 — 지휘소 행 누락 방지');
// ② rAF는 백그라운드 탭에서 멈춘다. 타이머 안전장치가 없으면 막대가 흐린 채,
//    버튼이 비활성인 채로 굳는다 — 실측으로 확인한 상태다.
assert(/_guard\s*=\s*setTimeout\(finish/.test(sim),
  '재생 애니메이션에 타이머 확정 장치 존재 (rAF throttle 시 UI 고착 방지)');
assert(/\.ptl-row\s*\{[^}]*display:\s*grid/.test(css),
  '타임라인 행이 grid — 레거시 .tl-row(flex)와 클래스가 충돌하지 않음');
assert(!/class="tl-(row|label|bar|track)"/.test(sim),
  '레거시 .tl-* 클래스명을 재사용하지 않음 (충돌로 트랙 폭이 0이 됐던 회귀)');

console.log('# ④-3 C2 계통 다이어그램 — 간선은 카탈로그 링크만');
assert(/diagramHtml/.test(sim) && /cdg-wrap/.test(sim), 'C2 계통 다이어그램이 배선됨');
// ⚠️ [분석] 탭의 항적별 다이어그램과 [C2 구조] 탭은 **같은 레이아웃**이어야 한다.
//    두 벌로 두면 계층 정의가 갈라져 같은 항적이 화면마다 다른 모양으로 보인다.
var panelsSrc = fs.readFileSync(path.join(root, 'js/ui/panels.js'), 'utf8');
assert(/KJ\.panels\.c2Column/.test(sim) && /c2Column: c2Column/.test(panelsSrc),
  '항적별 다이어그램이 [C2 구조]와 같은 c2Column 레이아웃을 재사용');
// 핵심 규율: 항적 단계가 시간상 인접하다고 선을 그으면 **모델에 없는 연결을 지어낸다.**
// 간선은 카탈로그 링크(linksInMode)에서만 나와야 한다.
assert(/KJ\.linksInMode\(mode, cat\)/.test(panelsSrc),
  '간선이 카탈로그 링크에서만 생성됨 (시간 인접으로 선을 긋지 않음)');
assert(/sv-bridge/.test(panelsSrc) && /경로상 노드/.test(panelsSrc),
  '기록에 없는 경로상 홉(ECS 등)은 별도 표기로 구분');
// 항적은 C2를 typeId로 적는다 — 노드 id로 환산하지 않으면 관여 노드가 조용히 빠진다.
assert(/act\[n\.typeId\] != null/.test(panelsSrc),
  '관여 시각 조회가 id·typeId 두 키를 모두 봄 (지휘소 누락 방지)');
assert(/\.sv-cols\.sv-playing/.test(css),
  '다이어그램 소등은 재생 중에만 — 정지 화면은 전부 켜져 보고서 캡처가 가능해야 한다');

console.log('# ④-4 결심 순간 해부 (ADR-073 감사 + ADR-074 그림자 평가)');
assert(/anatomyHtml/.test(sim) && /dca-wrap/.test(sim), '결심 순간 해부 섹션이 배선됨');
assert(/decisionAudit: true, shadowEval: true, windowMargin: true/.test(sim),
  '결심 감사 계측을 실행에 켠다 (OFF/ON bit-exact가 ADR-073·074에서 증명됨)');
// 감사 이벤트는 c2Events에 실려 오는데 워커가 그걸 지운다 — **지우기 전에** 뽑아야 하고,
// 워커와 메인스레드 폴백이 같은 규약이어야 실행 경로에 따라 화면이 달라지지 않는다.
assert(/pickDecisionAudits/.test(runtime) && /pickDecisionAudits/.test(client),
  '워커·폴백 양쪽이 동일하게 decision_audit을 추출 (c2Events 삭제 전에)');
assert(/currentAudits/.test(runtime) && /currentAudits/.test(client),
  '양 경로가 같은 필드명으로 감사 이벤트를 실어 보냄');
// regret null은 0이 아니라 미측정이다(USFK 독립 축 — ADR-036/074).
assert(/미측정/.test(sim) && /d\.regret == null/.test(sim),
  'regret null을 0이 아니라 미측정으로 표기');
// 결심이 없었으면 빈칸으로 두지 않고 그 사실을 적는다.
assert(/결심에 도달하지 못했습니다/.test(sim), '결심 미도달을 빈칸이 아니라 문장으로 표기');
// ⚠️ 회귀 방지: .dca-block을 닫지 않아 To-Be 블록이 As-Is 안에 중첩됐고, 그 결과
//    두 블록의 표가 겹쳐 읽혀 As-Is에 To-Be 지휘소가 표시됐다(실측).
var anatomy = sim.slice(sim.indexOf('function anatomyBlock'), sim.indexOf('function anatomyHtml'));
assert((anatomy.match(/<div/g) || []).length === (anatomy.match(/<\/div>/g) || []).length,
  'anatomyBlock의 <div> 개폐 수가 일치 (닫기 누락 시 좌우 블록이 중첩된다)');

console.log('# ⑤ 기존 경로 보존 — tracePair 없는 호출은 반대 모드 trace를 만들지 않음');
var other = run('tobe', { trace: false });
assert(!other.threatTraces, 'trace:false 실행은 threatTraces를 내지 않음 (재생 경로 비용 보존 전제)');

console.log('# ⑥ trace 중립성 — 관측을 켠다고 결과가 바뀌면 안 된다');
// 반대 모드에 trace를 켠 것이 이번 변경의 핵심이다. trace가 RNG를 소비하거나 분기를
// 바꾸면 분석 탭의 기존 파이프라인 지표(To-Be 열)가 조용히 달라진다 — bit-exact로 고정한다.
function fingerprint(r) {
  var g = r.global;
  return JSON.stringify({
    spawned: g.spawned, killed: g.killed, leaked: g.leaked, reasons: g.leakReasons,
    nodes: r.nodes.map(function (n) { return [n.id, n.served, n.drops, n.rho.toFixed(9)]; }),
    links: r.links.map(function (l) { return [l.id, l.count, l.delaySec.toFixed(9)]; })
  });
}
['asis', 'tobe'].forEach(function (mode) {
  assert(fingerprint(run(mode, { trace: false })) === fingerprint(run(mode, { trace: true })),
    mode + ': trace on/off 결과 지문 일치 — trace는 순수 관측(비침습)');
});

console.log(fail ? '\nFAIL — ' + fail + '건' : '\nOK — 전체 통과');
process.exit(fail ? 1 : 0);
