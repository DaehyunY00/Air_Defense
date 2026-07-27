#!/usr/bin/env node
/**
 * 동봉 Leaflet을 업스트림 원본과 대조한다. **외부망(unpkg.com)이 필요하다.**
 *
 * 배경: vendor/leaflet-1.9.4/leaflet.js는 업스트림 SRI와 바이트 단위로 일치하지만,
 * leaflet.css는 일치하지 않는다. 동봉 작업을 한 컨테이너는 egress 허용목록에
 * unpkg/registry.npmjs.org가 없어 원본을 받아 대조할 수 없었다. 이 스크립트는
 * 외부망이 있는 환경에서 그 미해결 항목을 끝내기 위한 것이다.
 *
 * 실행:  node scripts/verify-vendor-leaflet.mjs          (요약)
 *        node scripts/verify-vendor-leaflet.mjs --diff   (줄 단위 차이까지)
 *
 * 종료코드: 0 = 두 파일 모두 업스트림과 일치 / 1 = 불일치 / 2 = 내려받기 실패
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.9.4';
const BASE = `https://unpkg.com/leaflet@${VERSION}/dist/`;
const showDiff = process.argv.includes('--diff');

const FILES = [
  { name: 'leaflet.js', known: 'db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a' },
  { name: 'leaflet.css', known: '5f236f11b6ca29a549c06be1c1c786ec53523fb39a1bae2f2ba61f6fef889edb' }
];

const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/** 첫 차이 지점을 바이트 오프셋·줄 번호·주변 문맥으로 보고 */
function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  if (i === n && a.length === b.length) return null;
  const line = a.slice(0, i).split('\n').length;
  const ctx = s => JSON.stringify(s.slice(Math.max(0, i - 40), i + 40));
  return { offset: i, line, local: ctx(a), upstream: ctx(b),
    lenLocal: a.length, lenUpstream: b.length };
}

/** 줄 단위 차이 (양쪽에만 있는 줄) */
function lineDiff(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const setB = new Map(); lb.forEach(l => setB.set(l, (setB.get(l) || 0) + 1));
  const setA = new Map(); la.forEach(l => setA.set(l, (setA.get(l) || 0) + 1));
  const onlyLocal = [], onlyUpstream = [];
  setA.forEach((n, l) => { const m = setB.get(l) || 0; for (let k = 0; k < n - m; k++) onlyLocal.push(l); });
  setB.forEach((n, l) => { const m = setA.get(l) || 0; for (let k = 0; k < n - m; k++) onlyUpstream.push(l); });
  return { onlyLocal, onlyUpstream, lines: [la.length, lb.length] };
}

let bad = 0;
for (const f of FILES) {
  const local = readFileSync(path.join(root, 'vendor', 'leaflet-' + VERSION, f.name));
  const localSha = sha(local);
  console.log(`\n── ${f.name} ──`);
  console.log(`  로컬 sha256 ${localSha}${localSha === f.known ? ' (기록값과 일치)' : ' ⚠ 기록값과 다름 — vendor README·테스트 갱신 필요'}`);

  let upstream;
  try {
    const res = await fetch(BASE + f.name);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    upstream = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.log(`  ❌ 업스트림 내려받기 실패: ${e.message}`);
    console.log(`     (egress 허용목록에 unpkg.com이 없으면 이 스크립트는 실행할 수 없다)`);
    process.exit(2);
  }
  const upSha = sha(upstream);
  console.log(`  업스트림 sha256 ${upSha}`);
  console.log(`  크기 로컬 ${local.length}B · 업스트림 ${upstream.length}B`);

  if (localSha === upSha) { console.log('  ✅ 바이트 단위 일치'); continue; }

  bad++;
  console.log('  ❌ 불일치');
  const d = firstDifference(local.toString('utf8'), upstream.toString('utf8'));
  if (d) {
    console.log(`     첫 차이: ${d.offset}바이트째 (${d.line}번째 줄)`);
    console.log(`       로컬   …${d.local}`);
    console.log(`       업스트림 …${d.upstream}`);
  }
  const ld = lineDiff(local.toString('utf8'), upstream.toString('utf8'));
  console.log(`     줄 수 로컬 ${ld.lines[0]} · 업스트림 ${ld.lines[1]}`);
  console.log(`     로컬에만 ${ld.onlyLocal.length}줄 · 업스트림에만 ${ld.onlyUpstream.length}줄`);
  if (!ld.onlyLocal.length && !ld.onlyUpstream.length) {
    console.log('     → 줄 집합은 동일. 차이는 줄 순서 또는 줄바꿈/공백뿐이다.');
  }
  if (showDiff) {
    ld.onlyLocal.slice(0, 25).forEach(l => console.log('       - ' + JSON.stringify(l)));
    ld.onlyUpstream.slice(0, 25).forEach(l => console.log('       + ' + JSON.stringify(l)));
  } else if (ld.onlyLocal.length || ld.onlyUpstream.length) {
    console.log('     (줄 단위 차이를 보려면 --diff)');
  }
}

console.log(bad === 0
  ? '\n✅ 동봉본 전부 업스트림과 일치 — vendor/leaflet-1.9.4/README.md의 미해결 항목을 닫아도 된다.'
  : `\n❌ ${bad}개 파일 불일치 — 위 차이를 vendor/leaflet-1.9.4/README.md에 기록할 것.`);
process.exit(bad ? 1 : 0);
