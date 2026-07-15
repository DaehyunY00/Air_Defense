/**
 * 파라미터 근거 감사 (작업지시서 §1.5) — docs/params.md를 파싱해
 *   (a) 출처 누락 항목, (b) 등급 C인데 스윕 미정의 항목을 나열한다.
 * 실행: node scripts/params-audit.mjs   (run-all.js CI 게이트에 포함)
 *
 * 게이트 정책: 전 항목을 리포트하되, **신규 Fire-Unit/자체교전 파라미터**(ID에
 * ECS·MFR·TEL·ICC·BTY·SELFDEF·FIREUNIT 포함)만 위반 시 비영(非零) 종료한다.
 * 기존 항목은 경고만(스냅샷·기존 감사 결과 보존) — 신규 규율만 강제한다.
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const md = fs.readFileSync(path.join(root, 'docs', 'params.md'), 'utf8');

// 신규 규율 강제 대상 ID 패턴(Fire-Unit Layer·자체교전)
const NEW = /(ECS|MFR|TEL|ICC|BTY|SELFDEF|FIREUNIT)/;
const SWEEP = /스윕|sweep|스윕 대상|스윕 범위|\{[^}]*[,/][^}]*\}\s*(스윕|후보)/i;
const SRC = /(출처|source)\s*[:：*]/i;

// 헤딩형 항목: "### [ID] 제목" ~ 다음 "### " 또는 "## " 헤딩 전까지.
// (정규식 lookahead + multiline $ 함정을 피하려고 헤딩 경계로 직접 분할한다.)
const lines = md.split('\n');
const sections = [];
let cur = null;
lines.forEach((line) => {
  const h3 = line.match(/^###\s*\[([A-Z0-9*-]+)\]/);
  if (h3) { if (cur) sections.push(cur); cur = { id: h3[1], body: '' }; return; }
  if (/^##\s/.test(line)) { if (cur) { sections.push(cur); cur = null; } return; } // 상위 섹션 경계
  if (cur) cur.body += line + '\n';
});
if (cur) sections.push(cur);

// 표형 항목: "| WPN-XXX-COST-01 | ... | 근거 | 신뢰도 |" 행 (ID + 등급 셀)
const tableRows = [];
md.split('\n').forEach((line) => {
  const cells = line.split('|').map((s) => s.trim());
  if (cells.length < 4) return;
  const idCell = cells.find((c) => /^[A-Z]{2,4}-[A-Z0-9-]+$/.test(c));
  if (!idCell) return;
  const grade = cells.find((c) => /^[ABC]$/.test(c));
  if (grade) tableRows.push({ id: idCell, grade, line });
});

const missingSrc = [];
const cNoSweep = [];
let newViolations = 0;

sections.forEach((s) => {
  const hasSrc = SRC.test(s.body);
  const gradeC = /(신뢰도\s*)?등급\s*[:：*]{0,2}\s*\**\s*C\b/.test(s.body) || /등급\**\s*[:：]?\s*\**C\b/.test(s.body);
  if (!hasSrc) { missingSrc.push(s.id); if (NEW.test(s.id)) newViolations++; }
  if (gradeC && !SWEEP.test(s.body)) { cNoSweep.push(s.id); if (NEW.test(s.id)) newViolations++; }
});
tableRows.forEach((r) => {
  if (r.grade === 'C' && !SWEEP.test(r.line)) {
    cNoSweep.push(r.id + '(표)');
    if (NEW.test(r.id)) newViolations++;
  }
});

console.log('== 파라미터 근거 감사 (docs/params.md) ==');
console.log('헤딩 항목 ' + sections.length + '개 · 표 항목 ' + tableRows.length + '개 스캔');
console.log('\n(a) 출처 누락 (' + missingSrc.length + '): ' + (missingSrc.join(', ') || '없음'));
console.log('\n(b) 등급 C · 스윕 미정의 (' + cNoSweep.length + '): ' + (cNoSweep.join(', ') || '없음'));
console.log('\n※ 기존 항목은 경고(리포트)만. 신규 Fire-Unit/자체교전 ID(' + NEW.source + ')는 위반 시 실패.');

if (newViolations > 0) {
  console.log('\n★ 실패 — 신규 Fire-Unit/자체교전 파라미터 위반 ' + newViolations + '건 (출처·스윕 필수)');
  process.exit(1);
}
console.log('\nOK — 신규 파라미터 규율 통과');
process.exit(0);
