#!/usr/bin/env node
/**
 * K-JAMDS [지휘 흐름] 프로토타입 — 단일본 HTML 빌드 스크립트
 *
 * prototype/command-flow.html + 그것이 import하는 js/** 를 인라인해
 * `K-JAMDS_지휘흐름_단일본.html`을 재생성한다. 현재 소스만으로 결정론적으로 동작한다 —
 * 직전 단일본을 읽지 않는다.
 *
 * 왜 필요한가: 프로토타입은 `<script type="module">` 안에서 `await import('../js/…')`로 커널·
 * 데이터·엔진을 싣는다. file:// 에서는 모듈 상대 import가 CORS로 차단되므로 서버 없이는
 * 열리지 않는다(README [프로토타입] 절). 단일본은 그 import 블록을 인라인 `<script>`로 바꿔
 * 더블클릭으로 열리게 한다. 계산은 워커 없이 메인 스레드에서 돈다(프로토타입도 원래 그렇다).
 *
 * 실행:  node scripts/build-command-flow-single.mjs            (저장소 루트에서)
 *        node scripts/build-command-flow-single.mjs --check    파일을 쓰지 않고, 저장된 단일본이
 *                                                              현재 소스로 만든 것과 같은지만 확인
 *                                                              (다르면 비영 종료 — 회귀 테스트 게이트)
 *
 * 변환 규약(검증 대상):
 *  - <title> 끝에 " — 단일본"을 붙인다
 *  - 모듈 스크립트 앞에 `<script>/* js/<경로> (inlined) *\/ … </script>` 를 **프로토타입의
 *    import 순서 그대로** 넣고, 마지막에 IADS 커널 IIFE 번들을 넣는다
 *    ⚠️ 순서는 프로토타입 소스에서 읽는다 — 여기 하드코딩하지 않는다. 순서를 바꾸면 조용히
 *       다른 수치가 나온다(js/workers/sim-worker.mjs 주석 참조).
 *  - 모듈 스크립트의 `const V = …` ~ `await import(m + V);` 블록을 주석 한 줄로 바꾸고,
 *    `installIadsKernel`은 IIFE가 window에 걸어 둔 `__installIadsKernel`로 받는다
 *    (KJ.IADS 설치 시점을 프로토타입이 스스로 정하도록 — 본 앱 단일본의 bootstrap 동치와 다른 점)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineFile, bundleIadsKernel, replaceOnce, assertSelfContained } from './single-lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'prototype/command-flow.html';
const SINGLE = path.join(root, 'K-JAMDS_지휘흐름_단일본.html');
const REGEN = 'node scripts/build-command-flow-single.mjs';

export function buildCommandFlowSingle() {
  let out = readFileSync(path.join(root, SOURCE), 'utf-8');

  // 제목: 단일본임을 명시
  out = replaceOnce(out, /(<title>[^<]*)(<\/title>)/, '$1 — 단일본$2', '<title>');

  // 모듈 스크립트의 커널 적재 블록. 여기서 import 목록을 **읽어** 인라인 순서로 쓴다.
  const LOAD_BLOCK = new RegExp(
    "const V = '\\?v=[\\w.-]+';\\n" +
    "const \\{ installIadsKernel \\} = await import\\('\\.\\./js/model/iads/index\\.js' \\+ V\\);\\n" +
    'for \\(const m of \\[\\n([\\s\\S]*?)\\n\\]\\) await import\\(m \\+ V\\);\\n' +
    'const KJ = globalThis\\.KJ;\\n'
  );
  const m = out.match(LOAD_BLOCK);
  if (!m) throw new Error(SOURCE + ': 커널 적재 블록(const V … await import(m + V) … const KJ)을 찾지 못함');
  const modules = [...m[1].matchAll(/'\.\.\/(js\/[\w/.-]+\.js)'/g)].map((x) => x[1]);
  if (modules.length === 0) throw new Error(SOURCE + ': import 목록이 비어 있음');
  for (const rel of modules) {
    if (!existsSync(path.join(root, rel))) throw new Error(SOURCE + ': import 대상이 없음 — ' + rel);
  }
  out = out.replace(LOAD_BLOCK,
    '// [단일본] 커널·데이터·엔진은 위의 인라인 <script>로 이미 적재됨 (재생성: ' + REGEN + ')\n' +
    'const KJ = globalThis.KJ;\n' +
    'const installIadsKernel = window.__installIadsKernel;\n');

  // 인라인 블록들 → 모듈 스크립트 바로 앞 (정확히 하나여야 한다)
  const kernel = bundleIadsKernel(root, {
    label: 'js/model/iads/* (IIFE kernel bundle — ADR-061, 재생성: ' + REGEN + ')',
    footer: 'window.__installIadsKernel = installIadsKernel;\n'
  });
  const blocks = modules.map((rel) => inlineFile(root, rel, 'script')).concat(kernel).join('\n');
  if ((out.match(/<script type="module">/g) || []).length !== 1) {
    throw new Error(SOURCE + ': <script type="module"> 이 정확히 하나여야 한다');
  }
  out = replaceOnce(out, /<script type="module">/, blocks + '\n<script type="module">', '모듈 스크립트 태그');

  // 잔여 참조 검증 — 동적 import·로컬 태그·CDN 태그가 남아 있으면 단일본이 아니다
  if (/\bimport\(/.test(out)) throw new Error('동적 import(…)가 남아 있음 — file:// 에서 실패한다');
  if (/\bfrom '\.\.?\//.test(out)) throw new Error("정적 import … from './…' 가 남아 있음");
  assertSelfContained(out);

  return { out, modules };
}

// ── CLI ──
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { out, modules } = buildCommandFlowSingle();
  if (check) {
    const cur = existsSync(SINGLE) ? readFileSync(SINGLE, 'utf-8') : null;
    if (cur === out) {
      console.log('단일본 최신: ' + path.basename(SINGLE) + ' (인라인 ' + modules.length + ' + 커널)');
    } else {
      console.error(cur === null
        ? '단일본 없음: ' + path.basename(SINGLE) + ' — ' + REGEN + ' 로 생성하십시오'
        : '단일본이 소스보다 뒤처짐: ' + path.basename(SINGLE) + ' — ' + REGEN + ' 로 재생성하십시오');
      process.exit(1);
    }
  } else {
    writeFileSync(SINGLE, out);
    console.log('단일본 재생성 완료: ' + SINGLE);
    console.log('  인라인 JS 블록:', modules.length + '개 + IADS 커널 IIFE');
    console.log('  원본:', SOURCE);
  }
}
