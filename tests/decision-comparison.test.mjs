/**
 * ADR-075 → ADR-076 — [분석] 탭 회귀 (구 [결심 비교]).
 *
 * ⚠️ ADR-076에서 이 탭은 **[분석]으로 개명·단순화**됐다. 종전 화면(게이지·두 분포·후보
 * 팝오버)은 읽는 데 사전지식이 필요해 걷어내고, **시간 중심 3층**(합계 → 구간별 차이 →
 * 항적 로그 병렬 비교)으로 다시 세웠다. 아래 §1~§3(순수 후처리·미측정 규율·게이지 정의)은
 * 후처리기 계약이라 화면과 무관하게 그대로 유효하다 — §4~§6만 새 구조로 옮겼다.
 *
 * 시각화 계층은 **순수 후처리**여야 한다. 이 스위트가 고정하는 것:
 *  1) 순수성 — `buildC2Analysis`가 c2Events를 읽기만 하고 되쓰지 않으며, 두 번 불러도 같은 값
 *  2) 미측정 표시 규율 — 계측 OFF 런은 0이 아니라 available=false(미측정)로 나온다
 *  3) 게이지 정의 — 놓침률 분모는 위협 전수(생존 편향 제거), 일치율 분모는 측정된 결심
 *  4) 딥링크 하위호환 — 신규 탭 추가가 기존 4탭·구 탭ID·4파라미터 스킴을 깨지 않는다
 *  5) UI 계약 — index.html의 패널·컨테이너 ID와 렌더러가 서로 맞고, 디스클레이머 2곳이 남아있다
 *  6) 단일본 — 신규 자원이 단일본에 인라인돼 있다
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(dir, '..');
const root = path.join(repo, 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/c2-report.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function note(m) { console.log('  NOTE ' + m); }

const INSTRUMENTED = {
  highResolutionDeployment: true, decisionAudit: true, shadowEval: true, windowMargin: true
};
function run(mode, features) {
  return KJ.runDES({
    scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 12345, endTimeSec: 900,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', modelFidelity: 'iads-c2', c2Analysis: true,
    features: features
  });
}

console.log('== 1) 순수 후처리 ==');
const resA = run('asis', INSTRUMENTED), resB = run('tobe', INSTRUMENTED);
{
  const before = JSON.stringify(resA.c2Events);
  const first = KJ.buildC2Analysis(resA.c2Events, resA);
  const after = JSON.stringify(resA.c2Events);
  assert(before === after, '후처리가 원본 c2Events를 변형하지 않음(되쓰기 없음)');
  const second = KJ.buildC2Analysis(resA.c2Events, resA);
  assert(JSON.stringify(first.decisionComparison) === JSON.stringify(second.decisionComparison),
    '같은 입력을 두 번 후처리하면 완전히 같은 결과(결정론)');
}
const dcA = KJ.buildC2Analysis(resA.c2Events, resA).decisionComparison;
const dcB = KJ.buildC2Analysis(resB.c2Events, resB).decisionComparison;
assert(dcA.available && dcB.available, '계측 ON 런은 available=true');

console.log('\n== 2) 미측정 표시 규율 (ADR-062·073 계승) ==');
{
  const plain = run('asis', { highResolutionDeployment: true });
  const dc = KJ.buildC2Analysis(plain.c2Events, plain).decisionComparison;
  assert(dc.available === false, '계측 OFF 런은 available=false — 0이 아니라 미측정');
  assert(typeof dc.reason === 'string' && dc.reason.length > 0, '미측정 사유를 명시');
  assert(dc.gauges === undefined && dc.threats === undefined,
    'OFF 런은 게이지·위협 배열 자체를 만들지 않음(0으로 위장 금지)');
  // 판정 출처가 "런이 보고한 값"인지: features를 지우면 available이 꺼져야 한다.
  const forged = JSON.parse(JSON.stringify(resA));
  delete forged.global.features.decisionAudit;
  assert(KJ.buildC2Analysis(resA.c2Events, forged).decisionComparison.available === false,
    '판정은 이벤트 존재가 아니라 런이 보고한 global.features.decisionAudit에서 취함');

  // 부분 계측: audit만 켜고 shadow/window를 끄면 해당 게이지만 미측정이어야 한다.
  const partial = run('asis', { highResolutionDeployment: true, decisionAudit: true });
  const pdc = KJ.buildC2Analysis(partial.c2Events, partial).decisionComparison;
  assert(pdc.available === true && pdc.shadowEval === false && pdc.windowMargin === false,
    '부분 계측: available=true이지만 shadowEval·windowMargin은 false');
  assert(pdc.gauges.missRate === null && pdc.gauges.optimalRate === null,
    '해당 기준값이 없으면 게이지는 0이 아니라 null(미측정)');
}

console.log('\n== 3) 게이지 정의 ==');
{
  const spawnedA = resA.c2Events.filter(function (e) { return e.type === 'THREAT_SPAWNED'; }).length;
  assert(dcA.gauges.missRate.total <= spawnedA,
    '놓침률 분모 ≤ 생성 위협 수 (창 없는 위협은 분모에서 제외)');
  assert(dcA.gauges.missRate.missed ===
    dcA.gauges.missRate.undecided + dcA.gauges.missRate.lateDecision,
    '놓침 = 미결심 + 창 마감 뒤 결심 (두 경로의 합으로 분해)');
  assert(dcA.gauges.missRate.undecided > 0,
    '미결심 위협이 실제로 분자에 포함됨 (' + dcA.gauges.missRate.undecided + '건) — 생존 편향 제거');
  const scoredA = dcA.threats.reduce(function (s, t) {
    return s + t.decisions.filter(function (d) { return d.regret != null; }).length;
  }, 0);
  assert(dcA.gauges.optimalRate.n === scoredA, '일치율 분모 = 그림자 평가가 가능했던 결심 수');
  assert(dcA.gauges.optimalRate.optimal <= dcA.gauges.optimalRate.n, '일치 건수 ≤ 분모');
  // CRN 짝: 두 모드가 같은 위협집합을 마주해야 페어드 타임라인이 성립한다.
  const idsA = dcA.threats.map(function (t) { return t.threatId; }).sort().join(',');
  const idsB = dcB.threats.map(function (t) { return t.threatId; }).sort().join(',');
  assert(idsA === idsB, 'CRN — As-Is/To-Be가 동일 위협집합 (페어드 타임라인 전제)');
  assert(dcA.threats.every(function (t) {
    return t.decisions.every(function (d) { return d.t >= (t.firstDecisionT - 1e-9); });
  }), '위협별 최초 결심 시각이 실제 결심 중 최소값');
  note('SC3 놓침률 As-Is ' + (dcA.gauges.missRate.rate * 100).toFixed(1) + '% / To-Be ' +
    (dcB.gauges.missRate.rate * 100).toFixed(1) + '% · 일치율 ' +
    (dcA.gauges.optimalRate.rate * 100).toFixed(1) + '% / ' +
    (dcB.gauges.optimalRate.rate * 100).toFixed(1) + '%');
}

console.log('\n== 4) 딥링크 하위호환 ==');
{
  const routerSrc = fs.readFileSync(path.join(root, 'core/router.js'), 'utf8');
  assert(/VALID_TABS\s*=\s*\[[^\]]*'analysis'/.test(routerSrc), "'analysis' 탭이 유효 탭에 등록");
  assert(/VALID_TABS\s*=\s*\[[^\]]*'structure'/.test(routerSrc), "'structure'(C2 구조) 탭이 유효 탭에 등록");
  ['sim', 'mc', 'data'].forEach(function (tab) {
    assert(routerSrc.indexOf("'" + tab + "'") !== -1, '기존 탭 ' + tab + ' 유지');
  });
  assert(/LEGACY_TAB\s*=\s*\{[^}]*map:\s*'sim'/.test(routerSrc), '구 탭ID 폴백(map→sim) 유지');
  // 개명 전 딥링크(#tab=decision)가 죽으면 안 된다 — [분석]으로 흡수한다.
  assert(/LEGACY_TAB\s*=\s*\{[^}]*decision:\s*'analysis'/.test(routerSrc),
    "구 'decision' 딥링크가 [분석]으로 폴백");
  // v4가 신설한 모델 조건 토글(ADR-065~072)도 함께 살아 있어야 한다 — 신규 탭 추가가
  // 기존 딥링크 스킴을 조금이라도 깎지 않았음을 고정한다.
  ['sc', 'mode', 'dep', 'seed', 'dur', 'x', 't', 'open',
    'appr', 'disp', 'south', 'linkv2', 'rp', 'cop', 'saw', 'sdf', 'eor'].forEach(function (k) {
    assert(new RegExp('\\b' + k + ':').test(routerSrc), '딥링크 파라미터 ' + k + ' 유지');
  });
  assert(routerSrc.indexOf("fid: 'iads-c2'") !== -1, '구 fid= 하위호환 정규화 유지(ADR-061)');
}

console.log('\n== 5) UI 계약 ==');
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const panels = fs.readFileSync(path.join(root, 'ui/panels.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert(html.indexOf('data-tab="analysis"') !== -1, '[분석] 탭 버튼 존재');
  assert(html.indexOf('id="panel-analysis"') !== -1, '[분석] 패널 존재 (main.js의 panel-<tab> 규약)');
  assert(html.indexOf('data-tab="structure"') !== -1, '[C2 구조] 탭 버튼 존재');
  assert(html.indexOf('id="panel-structure"') !== -1, '[C2 구조] 패널 존재');
  // ADR-083: 시간표 두 장(analysis-decision·analysis-gates)을 한 장(analysis-pipeline)으로
  // 합쳤다. 정합·오분류 교정은 analysis-pipeline-table 스위트가 맡고, 여기서는 컨테이너
  // 계약만 본다.
  ['analysis-context', 'analysis-headline', 'analysis-pipeline', 'analysis-threat-log',
    'structure-diagram'].forEach(function (id) {
    assert(html.indexOf('id="' + id + '"') !== -1, '컨테이너 ' + id + ' 존재');
    assert(panels.indexOf("'" + id + "'") !== -1, '렌더러가 ' + id + '를 채움');
  });
  assert(/KJ\.panels\.renderAnalysis/.test(mainSrc), 'main.js가 analysis 탭을 렌더러로 디스패치');
  assert(/KJ\.panels\.renderStructure/.test(mainSrc), 'main.js가 structure 탭을 렌더러로 디스패치');
  assert(/renderAnalysis:\s*function/.test(panels), 'panels.renderAnalysis 정의');
  assert(/renderStructure:\s*function/.test(panels), 'panels.renderStructure 정의');
  // 계측 플래그는 카탈로그 해석이 아니라 DES 실행에만 얹는다.
  assert(/runFeatures[\s\S]{0,400}decisionAudit:\s*true/.test(panels),
    'runFeatures가 계측 3종을 DES 실행에 얹음');
  assert(!/function modelConfig[\s\S]{0,200}decisionAudit/.test(panels),
    'modelConfig(카탈로그 해석)에는 계측 플래그를 넣지 않음');
  // ⚠️ 구간별 표는 **전 구간을 같은 코호트**로 내야 한다. 구간마다 표본이 다르면 부분의 합이
  //    합계와 어긋나 각 줄이 서로 다른 위협을 말하게 된다(실측: 구간합 −9.8초 vs 합계 −21.9초).
  assert(/cohort/.test(panels) && /한 관문이라도 빠지면 제외/.test(panels),
    '구간별 표가 단일 코호트로 계산됨 (부분의 합 = 합계 보장)');
  // 항적 로그 병렬 비교는 결과 모달과 **같은 렌더러**를 재사용한다(중복 구현 금지).
  assert(/KJ\.simView\.renderThreatCompare/.test(panels),
    '[분석] 탭이 결과 모달과 같은 병렬 비교 렌더러를 재사용');
  // C2 구조도는 카탈로그를 넘겨야 한다 — 빼면 기본 배치로 폴백해 조용히 틀린 구조를 그린다.
  assert(/linksInMode\s*\?\s*KJ\.linksInMode\(mode,\s*cat\)/.test(panels),
    'linksInMode에 카탈로그 전달 (기본 배치 폴백 방지)');
  // [C2 구조]는 As-Is/To-Be를 **병렬 세로 계층**으로 놓고, 항적 재생을 지원한다.
  assert(/function c2Column\(cat, mode, act\)/.test(panels), 'C2 구조도가 모드별 컬럼 렌더러로 분리됨');
  // ⚠️ [C2 구조]와 [분석]의 항적별 다이어그램은 **같은 레이아웃**이어야 한다 —
  //    두 벌로 두면 계층 정의가 갈라져 같은 항적이 화면마다 다르게 보인다.
  assert(/c2Column: c2Column/.test(panels), 'C2 계층 레이아웃을 공용으로 노출');
  const simSrc = fs.readFileSync(path.join(root, 'ui/sim-view.js'), 'utf8');
  assert(/KJ\.panels\.c2Column/.test(simSrc),
    '[분석] 탭의 항적별 다이어그램이 같은 C2 계층 레이아웃을 재사용');
  assert(/'상위 작전사'/.test(panels) && /'합동방공 C2 \(조율층\)'/.test(panels) &&
    /'C2 체계'/.test(panels) && /'교전통제 \(ICC · ECS\)'/.test(panels),
    '세로 계층이 작전사 → 합동방공C2 → C2 체계 → 교전통제 순으로 정의됨');
  // To-Be의 핵심 차이 = 조율층. As-Is에는 그 노드(IAOC)가 아예 없어야 한다.
  // ADR-078: 종전에는 EOC를 나란히 뒀는데 도착 0건의 유령 노드여서 IAOC로 흡수하고 지웠다.
  assert(/var COORD = \{ IAOC: 1 \}/.test(panels), '조율층 노드가 IAOC 하나로 정의됨');
  assert(/조율층 없음/.test(panels),
    'As-Is에서 조율층이 비었음을 글자로 남김 (빈 칸이 곧 구조 차이)');
  // 모델 범위 밖 요소는 맥락으로만 — 링크를 그으면 시뮬레이션이 계산하는 것처럼 오도한다.
  assert(/OUT_OF_SCOPE/.test(panels) && /모델 범위 밖/.test(panels),
    '상위 작전사·해상 계통을 모델 범위 밖으로 명시 (ADR-060)');
  assert(/bindStructurePlay/.test(panels) && /sv-play/.test(panels),
    '항적 재생(탐지→요격) 컨트롤 배선');
  // 좌우가 **같은 시계**를 써야 어느 쪽이 먼저 끝나는지 읽을 수 있다.
  assert(/data-t0="'\s*\+\s*\(span \? span\.t0/.test(panels),
    '좌우 두 계층도가 하나의 시간 구간을 공유');
  // 노드 해석기는 결과 모달과 공용 — C2가 typeId로 기록되는 문제를 한 곳에서만 푼다.
  assert(/KJ\.simView\.buildNodeResolver/.test(panels),
    'C2 구조 탭이 공용 노드 해석기를 재사용 (id/typeId 이중 색인)');
  // rAF는 백그라운드 탭에서 멈춘다 — 타이머 안전장치가 없으면 재생이 굳는다.
  assert(/guard = setTimeout\(finish/.test(panels),
    'C2 구조 재생에 타이머 확정 장치 존재');
  // 디스클레이머 2곳(헤더 pill·푸터 성격 문구) 불변 — 제약 (c)
  assert(html.indexOf('정책연구용 개념값 · 실제 작전자료 아님') !== -1, '헤더 디스클레이머 유지');
  assert(html.indexOf('지상배치 방공체계 C2에 한정') !== -1, 'ADR-060 범위 문구 유지');
  assert((html.match(/tab-btn/g) || []).length >= 5, '탭 버튼 5개 이상');
}

console.log('\n== 6) 단일본 인라인 ==');
{
  const singlePath = path.join(repo, 'K-JAMDS_시뮬레이터_단일본.html');
  if (!fs.existsSync(singlePath)) {
    assert(false, '단일본 파일이 존재해야 한다');
  } else {
    const single = fs.readFileSync(singlePath, 'utf8');
    assert(single.indexOf('id="panel-analysis"') !== -1, '단일본에 [분석] 패널 인라인');
    assert(single.indexOf('id="panel-structure"') !== -1, '단일본에 [C2 구조] 패널 인라인');
    assert(single.indexOf('renderAnalysis:') !== -1, '단일본에 [분석] 렌더러 인라인');
    assert(single.indexOf('renderStructure:') !== -1, '단일본에 [C2 구조] 렌더러 인라인');
    assert(single.indexOf('decisionComparison') !== -1, '단일본에 후처리기 인라인');
    assert(single.indexOf('.an-table') !== -1, '단일본에 신규 CSS 인라인');
    assert(single.indexOf('_emitDecisionAudit') !== -1, '단일본에 엔진 계측 인라인');
  }
}

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
