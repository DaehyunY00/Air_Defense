/**
 * K-JAMDS — 단일본(자기완결 HTML) 빌드 공용 조각
 *
 * 두 단일본 빌더가 함께 쓴다:
 *  - scripts/build-single.mjs               → K-JAMDS_시뮬레이터_단일본.html (본 앱)
 *  - scripts/build-command-flow-single.mjs  → K-JAMDS_지휘흐름_단일본.html ([지휘 흐름] 프로토타입)
 *
 * 특히 IADS 커널 IIFE 번들(ADR-061)은 한 벌만 존재해야 한다 — 두 빌더가 각자 변환 규칙을
 * 들고 있으면 한쪽만 고쳐져 두 단일본의 커널이 조용히 갈라진다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** 파일 하나를 `<tag>/* 라벨 *\/ … </tag>` 블록으로 인라인 */
export function inlineFile(root, relPath, tag, label) {
  let body = readFileSync(path.join(root, relPath), 'utf-8');
  if (!body.endsWith('\n')) body += '\n';
  return '<' + tag + '>/* ' + (label || relPath + ' (inlined)') + ' */\n' + body + '</' + tag + '>';
}

/**
 * ── IADS 커널 IIFE 번들 (ADR-061 옵션 b) ──
 * 커널은 ES module 8종 + index.js 인데, 단일본은 file:// 로 열리므로 모듈 상대 import가 CORS로
 * 차단된다. iads-c2가 유일 충실도가 된 이상(ADR-061) 커널 없는 단일본은 실행 자체가 불가능하므로,
 * 모듈들을 의존 순서대로 텍스트 변환(import 제거·export 키워드 탈피)해 하나의 IIFE로 동봉한다.
 * 변환 규약(이 파일들이 지키는 전제 — 어기면 빌드가 던진다):
 *  - import는 전부 패키지 내부 상대 경로(외부 의존 없음)
 *  - export는 `export (const|function|class) NAME` 또는 단일 행 `export {...}`/`export * from`
 *
 * @param {string} root 저장소 루트
 * @param {{label: string, footer: string}} opts
 *   label  — `<script>/* … *\/` 라벨 (재생성 명령을 적는 자리)
 *   footer — IIFE 끝에서 installIadsKernel을 바깥으로 내보내는 방식. 본 앱은 bootstrap.js 동치
 *            (KJ.IADS 즉시 설치), 프로토타입은 함수만 window에 걸어 두고 자기 순서에 맞춰 부른다.
 */
export function bundleIadsKernel(root, { label, footer }) {
  const dir = 'js/model/iads';
  // 의존 순서 (event-queue/rng ← sensor ← track, engagement/c2/c2-policy는 말단)
  const modules = ['event-queue.js', 'rng-substream.js', 'physics.js', 'sensor-model.js',
    'track-model.js', 'engagement-model.js', 'c2-agent.js', 'c2-policy.js'];
  // index.js의 `import * as NS` 네임스페이스 재구성용: 모듈별 export 명 수집
  const nsOf = { 'sensor-model.js': 'sensor', 'physics.js': 'physics', 'track-model.js': 'track',
    'engagement-model.js': 'engagement', 'c2-agent.js': 'c2', 'c2-policy.js': 'c2policy' };
  const exportsByNs = {};
  const seen = new Map(); // 최상위 식별자 충돌 검사 (단일 스코프 병합의 전제)
  let body = '';
  function strip(rel, collectNs) {
    const src = readFileSync(path.join(root, dir, rel), 'utf-8');
    const names = [];
    const out = src.split('\n').map((line) => {
      if (/^import\s/.test(line)) {
        if (!/from '\.\//.test(line)) throw new Error(dir + '/' + rel + ': 외부 import는 번들 불가 — ' + line);
        return null;
      }
      if (/^export \* from/.test(line) || /^export \{/.test(line)) return null;
      const m = line.match(/^export (const|function|class) (\w+)/);
      if (m) {
        names.push(m[2]);
        if (seen.has(m[2])) throw new Error('커널 번들 식별자 충돌: ' + m[2] + ' (' + seen.get(m[2]) + ' ↔ ' + rel + ')');
        seen.set(m[2], rel);
        return line.replace(/^export /, '');
      }
      if (/^export\s/.test(line)) throw new Error(dir + '/' + rel + ': 지원하지 않는 export 형태 — ' + line);
      return line;
    }).filter((l) => l !== null).join('\n');
    if (collectNs) exportsByNs[collectNs] = names;
    return '// ── ' + dir + '/' + rel + ' ──\n' + out;
  }
  for (const m of modules) body += strip(m, nsOf[m]) + '\n';
  // index.js 본문 (installIadsKernel 포함) — `...sensor` 스프레드가 참조하는 네임스페이스
  // 객체를 수집된 export 명으로 재구성해 원본 index.js와 동일한 KJ.IADS 표면을 만든다.
  for (const ns of Object.values(nsOf)) {
    body += 'const ' + ns + ' = { ' + exportsByNs[ns].map((n) => n + ': ' + n).join(', ') + ' };\n';
  }
  body += strip('index.js', null) + '\n';
  body += footer;
  return '<script>/* ' + label + ' */\n' +
    '(function () {\n\'use strict\';\n' + body + '})();\n</script>';
}

/**
 * 반드시 1회 치환. 안 맞으면 던진다 — 조용히 넘어가면 원본의 태그가 그대로 남은 채
 * "빌드 성공"으로 보고되고, 그 단일본은 외부 참조를 안고 배포된다.
 */
export function replaceOnce(src, pattern, replacement, what) {
  if (!pattern.test(src)) throw new Error('치환 대상을 찾지 못함: ' + what);
  return src.replace(pattern, replacement);
}

/**
 * 잔여 외부 참조 검증 — 로컬(css/·js/·vendor/) 태그도, 모듈 src 태그도, CDN 태그도 남아 있으면 안 된다.
 * 태그 단위로만 검사한다 — 인라인된 JS 본문에는 타일 URL 등 https 문자열이 정상적으로 들어 있다.
 */
export function assertSelfContained(out) {
  if (/<link rel="stylesheet" href="(css|vendor)\//.test(out) || /<script src="(js|vendor)\//.test(out) ||
      /<script type="module" src=/.test(out)) {
    throw new Error('인라인되지 않은 로컬 참조가 남아 있음');
  }
  const cdnTag = out.match(/<(?:script|link)\b[^>]*\b(?:src|href)="https?:\/\/[^"]*"/);
  if (cdnTag) throw new Error('단일본에 외부 CDN 참조가 남아 있음: ' + cdnTag[0].slice(0, 100));
}
