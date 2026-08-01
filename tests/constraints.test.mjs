/**
 * K-JAMDS 시뮬레이터 — 제약 어서션 회귀 테스트 (계획서 Recommendations 5, ADR-061 이관)
 * 실행:  node tests/constraints.test.mjs   (저장소 루트에서)
 *
 * "제약 준수 상시 검증(회귀 스위트에 어서션으로 고정)":
 *  (a) 신궁·천마(단거리방공)의 탄도탄 교전 시도 시 실패/거부 — iadsEngageableThreats 정본
 *  (b) LEGACY 배치의 KAMDOC↔THAAD 노드·엣지 부재
 *  (c) 디스클레이머("정책연구용 개념값 · 실제 작전자료 아님" + ADR-060 범위) 상시 표출
 *  (d) 모든 배치 카탈로그 좌표가 도시 수준 개념좌표
 *  (e) 전투기·이지스·조기경보기 미포함 — 지상배치 방공 C2 한정 (ADR-060; 구 KF-21 표기
 *      제약은 legacy FTR 노드 폐기로 소멸, ADR-061 기록)
 *
 * (a)(d)는 데이터 수준 + 행위 수준(DES·해석 모듈) 이중 검증.
 * (c)는 정적 소스 검증(마크업·CSS) — 런타임 표출은 Playwright 스모크가 담당.
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
  'engine/sim-engine.js', 'analysis/bottleneck.js', 'core/constraints.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = globalThis.KJ;
installIadsKernel(KJ);

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

// ── (a) 신궁·천마(단거리방공) 탄도탄 교전 불가 ──
console.log('# (a) 단거리방공무기 탄도탄 교전 불가');
['BIHO', 'CHUNMA'].forEach(function (tid) {
  var allowed = KJ.SHOOTER_TYPES[tid].iadsEngageableThreats;
  assert(Array.isArray(allowed) && allowed.length > 0 &&
    allowed.indexOf('srbm') === -1 && allowed.indexOf('mrl_large') === -1,
    '데이터: SHOOTER_TYPES.' + tid + '.iadsEngageableThreats에 srbm·mrl_large 부재 (정본 표, ADR-061)');
});
// 행위 검증 1: DES — 탄도탄 단독 구성(검증용 인라인 시나리오)에서 SHORAD 발사 0
var balScn = {
  id: 'test-ballistic', name: '탄도탄 단독(검증용)',
  mix: [{ type: 'srbm', axis: 'central', ratePerMin: 1.0 },
        { type: 'srbm', axis: 'east', ratePerMin: 0.5 },
        { type: 'mrl_large', axis: 'central', ratePerMin: 0.5 }]
};
var fullCat = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL');
var shoradIds = {};
fullCat.nodes.forEach(function (n) {
  if (n.category === 'shooter' && (n.typeId === 'BIHO' || n.typeId === 'CHUNMA')) shoradIds[n.id] = true;
});
assert(Object.keys(shoradIds).length >= 2, 'FULL 배치에 SHORAD 사수 존재 (' + Object.keys(shoradIds).length + '개)');
var des = KJ.runDES({
  scenario: balScn, mode: 'asis', intensity: 3, seed: 11, endTimeSec: 1800,
  deploymentId: 'HANBANDO_FULL_NORMAL', features: { highResolutionDeployment: true }
});
assert(des.nodes.filter(function (n) { return shoradIds[n.id] && (n.shots || 0) > 0; }).length === 0,
  'DES 행위: 탄도탄 단독 구성 강도 3.0에서도 SHORAD 발사 0건');
// 행위 검증 2: 해석 모듈 — SHORAD 계열(ECS 포함)에 부하 배분 0
var an = KJ.analyzeScenario(balScn, 'asis', 3,
  { deploymentId: 'HANBANDO_FULL_NORMAL', features: { highResolutionDeployment: true } });
assert(an.nodes.filter(function (n) { return /BIHO|CHUNMA|SHORAD/.test(n.id) && n.lambda > 0; }).length === 0,
  '해석 행위: 탄도탄 단독 구성에서 SHORAD 계열 부하 λ=0');

// ── (b) LEGACY 배치 THAAD 부재 (FULL 독립축은 deployment-adapter.test.mjs) ──
console.log('# (b) LEGACY 배치 KAMDOC↔THAAD 연동 부재');
['HANBANDO_LEGACY_NORMAL', 'HANBANDO_LEGACY_MCRC_DOWN', 'HANBANDO_LEGACY_KAMDOC_DOWN'].forEach(function (id) {
  var c = KJ.buildDeploymentCatalog(id);
  assert(!c.nodes.some(function (n) { return /thaad|사드/i.test(n.id + (n.name || '')); }),
    id + ' 노드 식별자(id·name)에 THAAD 부재');
  assert(!c.links.some(function (l) { return /thaad/i.test(l.from + l.to); }),
    id + ' 링크에 THAAD 부재');
});

// ── (c) 디스클레이머 정적 소스 검증 ──
console.log('# (c) 디스클레이머 상시 표출 (정적 소스)');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('id="disclaimer"') !== -1, 'index.html에 #disclaimer 요소 존재');
assert(html.indexOf('정책연구용 개념값') !== -1 && html.indexOf('실제 작전자료 아님') !== -1,
  '필수 문구("정책연구용 개념값 · 실제 작전자료 아님") 포함');
assert(html.indexOf('지상배치 방공체계 C2에 한정') !== -1 && html.indexOf('ADR-060') !== -1,
  'ADR-060 범위 축소 문구(지상배치 방공 C2 한정) 상시 표출');
var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
var discRule = css.match(/#disclaimer\s*\{[^}]*\}/);
assert(discRule && discRule[0].indexOf('display: none') === -1 && discRule[0].indexOf('display:none') === -1,
  'CSS가 디스클레이머를 숨기지 않음');
// 모든 근거 문서에도 디스클레이머 존재
['README.md', 'docs/params.md'].forEach(function (f) {
  var txt = fs.readFileSync(path.join(root, f), 'utf8');
  assert(txt.indexOf('정책연구용 개념값') !== -1, f + '에 디스클레이머 존재');
});

// ── (d) 도시 수준 개념좌표 — 배치 카탈로그 6종 전수 ──
console.log('# (d) 전 좌표 도시 수준 개념좌표');
KJ.DEPLOYMENT_IDS.forEach(function (id) {
  var c = KJ.buildDeploymentCatalog(id);
  assert(c.nodes.every(function (n) {
    return Array.isArray(n.coord) && n.coord.length === 2 &&
      typeof n.coordNote === 'string' && n.coordNote.indexOf('개념') !== -1;
  }), id + ' 전 노드(' + c.nodes.length + '개) coord + "개념" 명시 coordNote 보유');
});
// ADR-064: 남부 종심 축선 2종 추가 — 개념좌표 주석 의무는 전 축선에 동일하게 적용된다.
var axisKeys = Object.keys(KJ.AXES);
assert(axisKeys.length === 6 && axisKeys.every(function (k) {
  var a = KJ.AXES[k];
  return a.entryNote.indexOf('개념') !== -1 && a.targetNote.indexOf('개념') !== -1;
}), '전 축선(' + axisKeys.length + '개) 진입/표적 좌표 "개념" 명시');
assert(KJ.SOUTHERN_AXIS_KEYS.every(function (k) { return KJ.AXES[k]; }) &&
  KJ.SOUTHERN_AXIS_KEYS.length === 2,
  '남부 종심 축선 2종(대구·부산)이 등록됨 (ADR-064)');

// ── (e) 지상배치 방공 C2 한정 (ADR-060) — 전투기·이지스·조기경보기 미포함 ──
console.log('# (e) 전투기류 미포함 (ADR-060 범위 선언)');
KJ.DEPLOYMENT_IDS.forEach(function (id) {
  var c = KJ.buildDeploymentCatalog(id);
  assert(!c.nodes.some(function (n) { return /KF-21|FTR|이지스|SM-2|E-737|조기경보/i.test(n.id + (n.name || '')); }),
    id + '에 전투기·이지스·조기경보기 대응 노드 부재');
});

// ── (f) 협조·승인 지연 정박점 (C2-VOICE-COORD-01 · IADS-APPR-COORD-01) ──
// legacy 링크 경로총합 검증(구 asisPath===110)은 legacy LINKS 폐기로 소멸(ADR-061).
// 고해상도 정본에서 같은 취지를 검증한다: As-Is 육→공 협조는 음성 절차(대표 20초,
// Uniform 10~30)이고, To-Be 대응 채널은 킬웹 데이터링크(≤2초)로 As-Is > To-Be 방향이 성립한다.
console.log('# (f) 협조·승인 지연 정박점 (고해상도 정본)');
var apprCat = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', { approvalChain: true });
var apprLinks = apprCat.links.filter(function (l) {
  return l.kind === 'coord' && /ARMY_LOCAL_AD/.test(l.from) && /MCRC/.test(l.to);
});
assert(apprLinks.length > 0, '승인 계선(coord) 링크 존재: 군단/수방사 AOC → MCRC (ADR-058)');
assert(apprLinks.every(function (l) {
  return l.comm.asis.type === 'voice' && l.comm.asis.delaySec === 20 &&
    l.comm.asis.dist && l.comm.asis.dist.kind === 'uniform' &&
    l.comm.asis.dist.min === 10 && l.comm.asis.dist.max === 30;
}), 'As-Is 협조 채널 = 음성 절차 지연 대표 20초·Uniform(10,30) (C2-VOICE-COORD-01)');
// ADR-078: To-Be 대응 채널이 **같은 선이 아니다**. 조율층(IAOC) 신설로 군단 AOC의 협조 상대가
// MCRC에서 IAOC로 바뀌어, 위 As-Is 링크에는 tobe 측이 없다. 제약 (f)의 요지는 "As-Is 협조 20초
// > To-Be 협조"라는 **방향**이므로 대응 채널을 조율층 쪽으로 재조준해 같은 방향을 검사한다 —
// 정박점은 링크가 어디에 붙었는지가 아니라 협조 절차가 실제로 빨라졌는지다.
assert(apprLinks.every(function (l) { return !l.comm.tobe; }),
  'As-Is 협조 계선(→MCRC)은 To-Be에 없음 — 조율층 경유로 대체(ADR-078)');
var apprTobe = apprCat.links.filter(function (l) {
  return l.kind === 'coord' && /ARMY_LOCAL_AD/.test(l.from) &&
    l.to === (apprCat.roles && apprCat.roles.IAOC) && l.comm.tobe;
});
assert(apprTobe.length > 0 &&
  apprTobe.every(function (l) { return l.comm.tobe.delaySec <= 2 && l.comm.tobe.type !== 'voice'; }),
  'To-Be 협조 채널 = 군단 AOC → 조율층 킬웹 데이터링크 ≤2초 — As-Is(20) > To-Be 방향 성립');
// 교전현황(status) 채널의 정보 비대칭: As-Is 음성/VTC 180초 제한형, To-Be는 음성 계열 부재
var baseCat = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL');
var statusVoice = baseCat.links.filter(function (l) { return l.comm.asis && l.comm.asis.type === 'voice-vtc'; });
assert(statusVoice.length > 0 && statusVoice.every(function (l) { return l.comm.asis.delaySec === 180; }),
  'As-Is 교전현황 공유 = 제한형 음성/VTC 180초 (C2-ENG-STATUS-01)');
assert(!baseCat.links.some(function (l) { return l.comm.tobe && /voice/.test(l.comm.tobe.type); }),
  'To-Be에는 음성 계열 링크가 없음 (킬웹 데이터링크 일원화)');

// ── (g) UI 노출 어서션 함수 자체 검증 (KJ.runConstraintChecks) ──
// 화면 "근거자료" 탭이 호출하는 함수를 실제로 돌려 A~E가 전부 통과하는지 본다.
console.log('# (g) KJ.runConstraintChecks() 전 항목 통과');
// #disclaimer 실물 문구를 index.html에서 읽어 최소 DOM을 세운다(표출 검증은 (c)와 동일 취지).
var discText = (html.match(/id="disclaimer"[^>]*>([\s\S]*?)<\//) || [, ''])[1].replace(/<[^>]*>/g, '');
globalThis.document = { getElementById: function (id) { return id === 'disclaimer' ? { textContent: discText } : null; } };
globalThis.getComputedStyle = window.getComputedStyle = function () { return { display: 'block' }; };
var checks = KJ.runConstraintChecks();
assert(checks.length === 5, '제약 항목 5건 반환 (' + checks.length + '건)');
checks.forEach(function (c) {
  assert(c.pass, '[' + c.id + '] ' + c.name + (c.pass ? '' : ' — ' + c.detail));
});
assert(Array.isArray(KJ.NODES) && KJ.NODES.length === 0 &&
  Array.isArray(KJ.LINKS) && KJ.LINKS.length === 0,
  'legacy KJ.NODES/KJ.LINKS는 빈 stub으로 유지 (ADR-061 — 부활 방지)');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
