/**
 * K-JAMDS 시뮬레이터 — 전체 회귀 스위트 단일 실행기 (Phase 5)
 * 실행:  node tests/run-all.js   (저장소 루트에서)
 *
 * 1) 전 JS 파일 구문 검증(node --check)
 * 2) 등록된 회귀 테스트 순차 실행
 * 하나라도 실패하면 비영(非零) 종료 — CI 게이트로 사용.
 */
'use strict';
var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

var failures = 0;

// ── 1) 구문 검증 ──
function walk(dir) {
  return fs.readdirSync(dir).reduce(function (acc, name) {
    var p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) return acc.concat(walk(p));
    if (/\.m?js$/.test(name)) acc.push(p);
    return acc;
  }, []);
}
var jsFiles = walk(path.join(root, 'js'));
console.log('== 구문 검증 (' + jsFiles.length + '개 파일) ==');
jsFiles.forEach(function (f) {
  var r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failures++;
    console.log('  SYNTAX FAIL ' + path.relative(root, f) + '\n' + r.stderr);
  }
});
if (!failures) console.log('  전체 통과');

// ── 2) 회귀 테스트 스위트 ──
var suites = [
  ['engine.test.js', 'DES 엔진 (재현성·극한값·시나리오 병목·보존·trace)'],
  ['mc.test.js', 'Monte Carlo (Welford·샘플러·수렴·유의성·민감도)'],
  ['overlap.test.js', '중복교전 히트맵 (순수성·스케일링·융합허브)'],
  ['transition.test.js', '임계 전환점 (Rec.6 — ρ>0.9 구간 개선폭)'],
  ['constraints.test.js', '제약 어서션 (Rec.5 — a~e)'],
  ['detect.test.js', '① 탐지 융합 (센서 Pd × 위협난이도 · 모드별 융합 · 단일센서 대조군)'],
  ['track.test.js', '② 추적생성 (센서→JAMDC2 직결 · ①②독립성)'],
  ['refine.test.js', '정밀화 (Phase A~D — 정합·WTA·권한위임·원인분포·신규지표)'],
  ['metrics-verification.test.js', '지표 검증 감사 (Lq·overlapRiskSum·분권전환·비용교환비 방향성)'],
  ['nodekind.test.js', '작업종류 분리 (③④⑤ track vs ⑥⑦ approval — 합보존·귀속·분리·결정론)'],
  ['coord.test.js', '⑥⑦ 결심·협조 (다익스트라 최소지연 경로 · 결심지연 분해)'],
  ['coord2.test.js', '⑥⑦ 수평 교전협조·중복교전 (책임공백 부활·중복교전·보존·결정론)'],
  ['wta.test.js', '⑧ 교전/요격명령 (교전창·축선 필터·canEngage·결정론·병목이동)'],
  ['reengage.test.js', '⑨ BDA·재교전 (되돌리기 플래그·무기별 pk 차등·폴백 경계·결정론)'],
  ['deadcode.test.js', '死 코드 레지스트리 (Gate 3 — 부활/영구死 정본·정직한 미부활)'],
  ['resource.test.js', '자원 최적화 (원칙 5 — As-Is불변·MDU-L생존·제약유지·SC2보호·되돌리기)']
  ,['legacy-deployment-expansion.test.js', 'legacy 배치 확장 (서4·중3·동3 ICC–ECS–MFR–포대 10세트)']
  ,['baseline.test.js', 'Phase 0 legacy 기준선 (SC1–SC3·양모드·SHA-256·OFF bit-exact)']
  ,['deployment.test.js', '고해상도 배치 선언 (6개 ID·수량·참조·SHORAD·USFK·MDL)']
  ,['deployment-adapter.test.js', '배치 호환 어댑터 (토폴로지·DOWN·결정론·보존법칙)']
  ,['high-resolution-connection.test.js', '고해상도 C2 연결 (ICC 상향 승인경로·As-Is 주교전)']
  ,['iads-native-pipeline.test.js', '원본 IADS 파이프라인 (책임 C2·scope WTA·PIP·발사대·실제 중복 BDA)']
  ,['c2a-asis.test.js', 'FULL As-Is 군단 AOC C2A (MCRC+국지 융합·우선순위·제한형 현황공유)']
  ,['iads-failure-realism.test.js', '고해상도 요격 실패 현실성 (SHORAD Pk·2발 SLS·무한 재교전 방지·분모 보존)']
  ,['failure-classification.test.js', '실패 분류 v2 (주원인·기여원인·구조성·PIP 세분화·사수부하)']
  ,['ui-performance.test.js', 'UI 응답성·지도 제어 (Worker·병목배지·C2링크·범례)']
  ,['map-visualization.test.js', '지도 시각화 (접이식 범례·공동 포대 중첩 마커·Leaflet/SVG·범위 링)']
  ,['overlap-performance.test.js', 'FULL 중복교전 계산 성능·정본 동등성']
  ,['iads-kernel.test.mjs', 'IADS_C2 공통 커널 (ES module·이벤트 큐·도메인 RNG·SNR/RCS/수평선 센서)']
  ,['c2-analysis.test.js', 'C2 구조화 계측·병목 귀속·동일 seed paired Monte Carlo']
];
suites.forEach(function (s) {
  console.log('\n== ' + s[1] + ' ==');
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, s[0])], {
    encoding: 'utf8', cwd: root, timeout: 120000
  });
  var out = (r.stdout || '') + (r.stderr || '');
  var tail = out.trim().split('\n');
  var passCount = (out.match(/PASS /g) || []).length;
  var failCount = (out.match(/FAIL /g) || []).length;
  if (r.status === 0) {
    console.log('  통과 (어서션 ' + passCount + '건)');
  } else {
    failures++;
    console.log('  ★ 실패 (통과 ' + passCount + ' / 실패 ' + failCount + ')');
    console.log(out.split('\n').filter(function (l) { return l.indexOf('FAIL') !== -1; }).join('\n'));
    console.log('  마지막 출력: ' + tail.slice(-3).join(' | '));
  }
});

console.log('\n' + (failures === 0
  ? '════ 전체 회귀 스위트 통과 ════'
  : '════ 실패 ' + failures + '건 — 커밋 금지 ════'));
process.exit(failures ? 1 : 0);
