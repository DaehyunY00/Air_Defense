/**
 * K-JAMDS 시뮬레이터 — 전체 회귀 스위트 단일 실행기 (Phase 5)
 * 실행:  node tests/run-all.js   (저장소 루트에서)
 *
 * 1) 전 JS 파일 구문 검증(node --check)
 * 2) 회귀 테스트 5종 순차 실행 (엔진·MC·중복교전 히트맵·임계 전환점·제약 어서션)
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
    if (name.slice(-3) === '.js') acc.push(p);
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
  ['constraints.test.js', '제약 어서션 (Rec.5 — a~e)']
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
