/**
 * K-JAMDS 시뮬레이터 — 제약 어서션 회귀 테스트 (Phase 5, 계획서 Recommendations 5)
 * 실행:  node tests/constraints.test.js   (저장소 루트에서)
 *
 * "제약 준수 상시 검증(회귀 스위트에 어서션으로 고정)":
 *  (a) KP-SAM(신궁)·천마(K-31)의 탄도탄 교전 시도 시 실패/거부
 *  (b) KAMDOC↔THAAD 연동 노드·엣지 부재
 *  (c) 디스클레이머("정책연구용 개념값 · 실제 작전자료 아님") 상시 표출
 *  (d) 모든 좌표가 도시 수준 개념좌표
 *  (e) KF-21이 국산 4.5세대 보라매(F-21 인도수출형 아님)로 표기
 *
 * (a)(d)는 데이터 수준 + 행위 수준(DES·해석 모듈) 이중 검증.
 * (c)는 정적 소스 검증(마크업·CSS) — 런타임 표출은 Playwright 스모크가 담당.
 */
'use strict';
global.window = global;
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'data/fire-units.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js', 'analysis/bottleneck.js'].forEach(function (f) {
  require(path.join(root, 'js', f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

// ── (a) 신궁·천마(단거리방공) 탄도탄 교전 불가 ──
console.log('# (a) 단거리방공무기 탄도탄 교전 불가');
var shorads = KJ.NODES.filter(function (n) { return n.id.indexOf('SHORAD') === 0; });
assert(shorads.length >= 2, 'SHORAD 노드 존재 (' + shorads.length + '개)');
assert(shorads.every(function (n) { return n.canEngage.srbm === false && n.canEngage.mrl_large === false; }),
  '데이터: 전 SHORAD canEngage.srbm/mrl_large = false');
// 행위 검증 1: DES — 탄도탄 단독 구성(검증용 인라인 시나리오)에서 SHORAD 교전 투입 0
var balScn = {
  id: 'test-ballistic', name: '탄도탄 단독(검증용)',
  mix: [{ type: 'srbm', axis: 'central', ratePerMin: 1.0 },
        { type: 'srbm', axis: 'east', ratePerMin: 0.5 }]
};
var des = KJ.runDES({ scenario: balScn, mode: 'asis', intensity: 3, seed: 11, endTimeSec: 1800 });
assert(des.nodes.filter(function (n) { return n.id.indexOf('SHORAD') === 0 && n.arrivals > 0; }).length === 0,
  'DES 행위: 탄도탄 단독 구성 강도 3.0에서도 SHORAD 도착 0건');
// 행위 검증 2: 해석 모듈 — SHORAD에 부하 배분 0
var an = KJ.analyzeScenario(balScn, 'asis', 3);
assert(an.nodes.filter(function (n) { return n.id.indexOf('SHORAD') === 0 && n.lambda > 0; }).length === 0,
  '해석 행위: 탄도탄 단독 구성에서 SHORAD 부하 λ=0');
// (a-2) 세분화(fireUnitLayer) 후 — 인스턴스 단위 제약 상속 검증 (§1 절대규칙 2)
console.log('# (a-2) Fire-Unit 세분화 후 인스턴스 단위 탄도탄 불가 상속');
var vfu = KJ.validateFireUnits();
assert(vfu.ok, 'validateFireUnits: 전 포대 제약 상속·재고상한·개념좌표 (' + (vfu.errors.join('|') || 'OK') + ')');
var shBats = KJ.FIRE_UNITS.filter(function (n) { return n.category === 'battery' && n.legacyOf.indexOf('SHORAD') === 0; });
assert(shBats.length >= 1 && shBats.every(function (b) { return b.canEngage.srbm === false && b.canEngage.mrl_large === false; }),
  '데이터: 전 SHORAD 포대 인스턴스 canEngage.srbm/mrl_large = false');
// 행위: fireUnitLayer ON에서도 SHORAD 포대는 탄도탄 교전 투입 0
var desFU = KJ.runDES({ scenario: balScn, mode: 'asis', intensity: 3, seed: 11, endTimeSec: 1800, features: { fireUnitLayer: true } });
assert(desFU.nodes.filter(function (n) { return n.category === 'battery' && n.id.indexOf('SHORAD') === 0 && n.arrivals > 0; }).length === 0,
  'DES 행위(세분화 ON): 탄도탄 단독 강도3에서 SHORAD 포대 도착 0건');

// ── (b) THAAD 미모델링 ──
console.log('# (b) KAMDOC↔THAAD 연동 부재');
assert(!KJ.NODES.some(function (n) { return /thaad|사드/i.test(n.id + n.name); }),
  '노드 식별자(id·name)에 THAAD 부재');
// role 설명문에 THAAD가 등장한다면 반드시 "모델링하지 않음" 등 부정(제외 선언) 문맥이어야 함
assert(KJ.NODES.every(function (n) {
  if (!/thaad/i.test(n.role || '')) return true;
  return /(않음|않는다|제외|미모델링|불가)/.test(n.role);
}), 'role의 THAAD 언급은 제외 선언 문맥만 허용');
assert(!KJ.LINKS.some(function (l) { return /thaad/i.test(l.from + l.to); }),
  '링크에 THAAD 부재');

// ── (c) 디스클레이머 정적 소스 검증 ──
console.log('# (c) 디스클레이머 상시 표출 (정적 소스)');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('id="disclaimer"') !== -1, 'index.html에 #disclaimer 요소 존재');
assert(html.indexOf('정책연구용 개념값') !== -1 && html.indexOf('실제 작전자료 아님') !== -1,
  '필수 문구("정책연구용 개념값 · 실제 작전자료 아님") 포함');
var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
var discRule = css.match(/#disclaimer\s*\{[^}]*\}/);
assert(discRule && discRule[0].indexOf('display: none') === -1 && discRule[0].indexOf('display:none') === -1,
  'CSS가 디스클레이머를 숨기지 않음');
// 모든 근거 문서에도 디스클레이머 존재
['README.md', 'docs/params.md'].forEach(function (f) {
  var txt = fs.readFileSync(path.join(root, f), 'utf8');
  assert(txt.indexOf('정책연구용 개념값') !== -1, f + '에 디스클레이머 존재');
});

// ── (d) 도시 수준 개념좌표 ──
console.log('# (d) 전 좌표 도시 수준 개념좌표');
assert(KJ.NODES.every(function (n) {
  return Array.isArray(n.coord) && n.coord.length === 2 &&
    typeof n.coordNote === 'string' && n.coordNote.indexOf('개념') !== -1;
}), '전 노드(' + KJ.NODES.length + '개) coord + "개념" 명시 coordNote 보유');
var axisKeys = Object.keys(KJ.AXES);
assert(axisKeys.length === 4 && axisKeys.every(function (k) {
  var a = KJ.AXES[k];
  return a.entryNote.indexOf('개념') !== -1 && a.targetNote.indexOf('개념') !== -1;
}), '전 축선(' + axisKeys.length + '개) 진입/표적 좌표 "개념" 명시 (Phase 4 axes.js 포함)');

// ── (e) KF-21 보라매 표기 ──
console.log('# (e) KF-21 보라매 표기');
var ftr = KJ.nodeById('FTR');
assert(ftr && ftr.name.indexOf('KF-21') !== -1 && ftr.role.indexOf('보라매') !== -1,
  'FTR 노드에 KF-21 + 보라매 표기');
assert(ftr.role.indexOf('인도수출형') !== -1 || !/F-21[^0-9]/.test(ftr.name.replace('KF-21', '')),
  'F-21 인도수출형과의 구별 명시');

// ── (f) 경로 총합 캘리브레이션 (C2-RESP-E2E-01, Phase 2 음성 지연 정박점) ──
// 원 출처 "3분 이상 → 30초"는 end-to-end 작전반응시간이다. 링크 1홉 지연으로 오적용하던 것을
// 용도별로 재배분한 뒤, As-Is 대표 경로(음성 계통) 총합이 원 출처 범위에 들어오는지 검증한다.
console.log('# (f) 경로 총합 (C2-RESP-E2E-01 — 음성 지연 정박점)');
function legDelay(from, to, mode) {
  var l = KJ.LINKS.find(function (x) { return x.from === from && x.to === to && x.comm[mode]; });
  return l ? l.comm[mode].delaySec : 0; // 대표값(delaySec) — 경로 총합 검증용
}
// As-Is 음성 계통 대표 경로: 음성보고 + 음성협조 + 교전명령(KVMF)
var asisPath = legDelay('ADC2A-W', 'AOC-1C', 'asis') + legDelay('AOC-1C', 'MCRC', 'asis') + legDelay('AOC-1C', 'SHORAD-1C', 'asis');
assert(asisPath >= 180 && asisPath <= 300,
  'As-Is 대표 경로 총합 ' + asisPath + 's ∈ [180, 300] (C2-RESP-E2E-01 재해석 범위 — 홉당 오적용 이중계상 제거)');
// To-Be 데이터링크 계통 대표 경로: report + coord + command 전부 데이터링크
var tobePath = legDelay('LLR-1C', 'AOC-1C', 'tobe') + legDelay('AOC-1C', 'MCRC', 'tobe') + legDelay('AOC-1C', 'SHORAD-1C', 'tobe');
assert(tobePath <= 30,
  'To-Be 대표 경로 총합 ' + tobePath + 's ≤ 30 (원 출처 "30초 수준으로 단축")');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
