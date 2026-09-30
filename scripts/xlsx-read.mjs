/**
 * xlsx-read — 의존성 없는 최소 .xlsx 읽기(ZIP + OOXML). 값만 읽는다(서식·수식 무시).
 *
 * 왜 직접 쓰는가: 이 저장소는 외부 패키지를 두지 않는다(xlsx-lite와 짝). ZIP은 Node 내장 zlib(inflateRaw)로 풀고,
 * 워크북·시트 XML은 정규식으로 셀 단위만 뽑는다. Artifact Tool이 쓴 `x:` 접두 네임스페이스와 xlsx-lite의
 * 접두 없는 XML을 모두 읽는다. 문자열은 sharedStrings(t="s")·inlineStr·t="str" 세 형식을 지원한다.
 *
 * 쓰임: readXlsx(path) → { sheetNames: [..], sheets: { name: rows } } · rows는 2차원 배열(빈 셀은 '').
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function unzip(buf) {
  // 중앙 디렉터리에서 항목을 찾는다(EOCD → CD → 로컬 헤더).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('ZIP EOCD not found');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const files = {}; let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(loff + 26), lelen = buf.readUInt16LE(loff + 28);
    const dataStart = loff + 30 + lnlen + lelen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    files[name] = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    if (method !== 0 && files[name].length !== usize) throw new Error('inflate size mismatch: ' + name);
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const colIndex = (col) => { let n = 0; for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export function readXlsx(path) {
  const files = unzip(readFileSync(path));
  const wb = files['xl/workbook.xml'].toString('utf8');
  const sheetNames = [...wb.matchAll(/<(?:\w+:)?sheet\b[^>]*?\bname="([^"]*)"[^>]*?\br:id="([^"]*)"/g)].map((m) => [unesc(m[1]), m[2]]);
  const relsXml = (files['xl/_rels/workbook.xml.rels'] || Buffer.alloc(0)).toString('utf8');
  const rels = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\bId="([^"]*)"[^>]*?\bTarget="([^"]*)"/g)) rels[m[1]] = m[2];
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\bTarget="([^"]*)"[^>]*?\bId="([^"]*)"/g)) rels[m[2]] = rels[m[2]] || m[1];
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    for (const m of files['xl/sharedStrings.xml'].toString('utf8').matchAll(/<(?:\w+:)?si>(.*?)<\/(?:\w+:)?si>/gs)) shared.push(unesc(stripTags(m[1])));
  }
  const sheets = {};
  sheetNames.forEach(([name, rid], idx) => {
    let target = rels[rid] || `worksheets/sheet${idx + 1}.xml`;
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const xml = (files['xl/' + target] || files[target] || Buffer.alloc(0)).toString('utf8');
    const rows = [];
    for (const m of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>(.*?)<\/(?:\w+:)?c>)/gs)) {
      const attrs = m[1], body = m[2] || '';
      const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs); if (!ref) continue;
      const t = (/\bt="(\w+)"/.exec(attrs) || [])[1];
      let v = '';
      if (t === 's') { const idx2 = /<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/.exec(body); v = idx2 ? shared[+idx2[1]] : ''; }
      else if (t === 'inlineStr') v = unesc(stripTags(body));
      else { const vv = /<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/.exec(body); v = vv ? unesc(vv[1]) : ''; if (t !== 'str' && v !== '' && !Number.isNaN(Number(v))) v = Number(v); }
      const r = +ref[2] - 1, c = colIndex(ref[1]);
      rows[r] = rows[r] || []; rows[r][c] = v;
    }
    for (let r = 0; r < rows.length; r++) { rows[r] = rows[r] || []; for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === undefined) rows[r][c] = ''; }
    sheets[name] = rows;
  });
  return { sheetNames: sheetNames.map((x) => x[0]), sheets };
}
