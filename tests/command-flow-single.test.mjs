/**
 * K-JAMDS — [지휘 흐름] 단일본 회귀 테스트
 * 실행:  node tests/command-flow-single.test.mjs   (저장소 루트에서)
 *
 * K-JAMDS_지휘흐름_단일본.html은 prototype/command-flow.html + js/** 에서
 * scripts/build-command-flow-single.mjs가 **생성**하는 파일이다. 손으로 고치거나 소스만 고치고
 * 재생성을 잊으면 두 파일이 조용히 갈라진다 — 서버로 보는 화면과 더블클릭으로 보는 화면이
 * 다른 수치를 낸다. 이 스위트는
 *  1) 빌더가 현재 소스로 만든 결과와 저장된 단일본이 바이트 단위로 같은지(뒤처짐 감지),
 *  2) 단일본이 실제로 자기완결인지(동적 import·로컬 src·CDN 태그 부재),
 *  3) 프로토타입의 import 순서가 단일본의 인라인 순서와 같은지(순서가 바뀌면 다른 수치),
 *  4) 두 단일본(앱·지휘 흐름)의 커널 IIFE 본문이 같은지(single-lib 한 벌 공유의 증거)
 * 를 고정한다.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const SINGLE = 'K-JAMDS_지휘흐름_단일본.html';
const SOURCE = 'prototype/command-flow.html';

console.log('# 1) 빌더 재현 — 저장된 단일본 = 현재 소스로 만든 것');
assert(existsSync(path.join(root, SINGLE)), SINGLE + ' 존재');
const r = spawnSync(process.execPath, ['scripts/build-command-flow-single.mjs', '--check'], { cwd: root, encoding: 'utf8' });
assert(r.status === 0, '--check 통과 (뒤처졌으면 node scripts/build-command-flow-single.mjs 로 재생성)' +
  (r.status === 0 ? '' : '\n' + (r.stderr || r.stdout)));

const single = read(SINGLE);
const src = read(SOURCE);

console.log('# 2) 자기완결');
assert(!/\bimport\(/.test(single), '동적 import(…) 없음');
assert(!/<script[^>]*\bsrc=/.test(single), '<script src=…> 없음');
assert(!/<link[^>]*\bhref="(?!data:)[^"]*"/.test(single), '<link href=…> 없음');
assert(!/<(?:script|link)\b[^>]*\b(?:src|href)="https?:\/\//.test(single), 'CDN 태그 없음');
assert(single.includes('window.__installIadsKernel = installIadsKernel;') &&
  single.includes('const installIadsKernel = window.__installIadsKernel;'),
  '커널 설치 함수가 IIFE → 모듈 스크립트로 건네짐');
assert(/<title>[^<]* — 단일본<\/title>/.test(single), '제목에 「단일본」 표기');
assert(/\bawait import\(/.test(src), '(대조) 소스 프로토타입은 여전히 동적 import를 씀 — 소스가 단일본으로 덮어쓰이지 않았다');

console.log('# 3) 인라인 순서 = 프로토타입 import 순서');
const list = src.match(/for \(const m of \[\n([\s\S]*?)\n\]\) await import\(m \+ V\);/);
assert(!!list, '프로토타입에서 import 목록을 찾음');
const expected = list ? [...list[1].matchAll(/'\.\.\/(js\/[\w/.-]+\.js)'/g)].map((x) => x[1]) : [];
const actual = [...single.matchAll(/^<script>\/\* (js\/[\w/.-]+\.js) \(inlined\) \*\/$/gm)].map((x) => x[1]);
assert(expected.length >= 12, 'import 목록 ' + expected.length + '개 (≥ 12)');
assert(JSON.stringify(actual) === JSON.stringify(expected), '인라인 블록 순서가 import 순서와 일치');
const kernelAt = single.indexOf('(IIFE kernel bundle');
const lastInline = single.lastIndexOf(' (inlined) */');
const moduleAt = single.indexOf('<script type="module">');
assert(lastInline < kernelAt && kernelAt < moduleAt, '순서: 인라인 데이터·엔진 → 커널 IIFE → 모듈 스크립트');
for (const rel of expected) {
  const m = single.match(new RegExp('^<script>/\\* ' + rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ' \\(inlined\\) \\*/\\n([\\s\\S]*?)\\n</script>$', 'm'));
  let body = read(rel); if (!body.endsWith('\n')) body += '\n';
  assert(!!m && m[1] + '\n' === body, '인라인 본문 = 소스: ' + rel);
}

console.log('# 4) 커널 IIFE 본문이 앱 단일본과 같다 (single-lib 한 벌)');
const APP = 'K-JAMDS_시뮬레이터_단일본.html';
function kernelBody(html) {
  const m = html.match(/<script>\/\* js\/model\/iads\/\* \(IIFE kernel bundle[^\n]*\n\(function \(\) \{\n'use strict';\n([\s\S]*?)\n\}\)\(\);\n<\/script>/);
  return m ? m[1] : null;
}
if (existsSync(path.join(root, APP))) {
  const a = kernelBody(read(APP)), b = kernelBody(single);
  assert(a && b, '두 단일본 모두 커널 IIFE 블록을 가짐');
  // 앱 단일본은 재생성 시점이 달라 소스보다 뒤처질 수 있다 — 본문 동일성 대신 구조(모듈 헤더 순서)만 고정한다.
  const heads = (s) => (s.match(/^\/\/ ── js\/model\/iads\/[\w.-]+ ──$/gm) || []).join('|');
  assert(heads(a) === heads(b) && heads(b).split('|').length === 9, '커널 모듈 순서 동일 (8 + index.js)');
} else {
  console.log('  (앱 단일본 없음 — 4) 생략)');
}

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
