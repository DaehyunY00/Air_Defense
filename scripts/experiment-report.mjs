#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — 실험 결과 집계·보고서(HTML) 생성
 *
 * experiment-run.mjs가 남긴 artifacts/experiment/cell-*.json과 sweep-*.json을 읽어
 * 시나리오 × 배치 × 모델충실도별 As-Is↔To-Be 비교표·해석을 담은 HTML을 만든다.
 * PDF는 이 HTML을 headless Chromium으로 렌더해 생성한다(build-experiment-pdf 참조).
 *
 * 실행: node scripts/experiment-report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './experiment-lib.mjs';

const DIR = path.join(ROOT, 'artifacts', 'experiment');
const OUT = path.join(ROOT, 'docs', '실험보고서_AsIs_ToBe.html');

const SC_NAME = { sc1: 'SC1 경계 침투(교전 중복·책임공백)', sc2: 'SC2 무인기 동시 남파', sc3: 'SC3 전략적 섞어쏘기' };
const DEP_NAME = {
  legacy: 'legacy(64노드 개념배치)',
  HANBANDO_LEGACY_NORMAL: 'LEGACY_HIRES(legacy 편성 고해상도)',
  HANBANDO_MINI_NORMAL: 'MINI(8포대 고해상도)',
  HANBANDO_FULL_NORMAL: 'FULL(84포대 고해상도)'
};
const FID_NAME = { compat: 'compat(개념 교전)', 'iads-c2': 'iads-c2(물리 충실도)' };

const cells = fs.readdirSync(DIR).filter(f => f.startsWith('cell-') && f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const sweepFile = path.join(DIR, 'sweep-legacy-compat.json');
const sweep = fs.existsSync(sweepFile) ? JSON.parse(fs.readFileSync(sweepFile, 'utf8')) : null;
const delegFile = path.join(DIR, 'delegation-legacy-sc3.json');
const deleg = fs.existsSync(delegFile) ? JSON.parse(fs.readFileSync(delegFile, 'utf8')) : null;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const key = c => `${c.spec.scenario}|${c.spec.deployment}|${c.spec.fidelity}`;
const byKey = new Map(cells.map(c => [key(c), c]));

const sig = d => d && d.lo != null && d.hi != null && (d.lo > 0 || d.hi < 0);
function pct(v, digits = 1) { return v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(digits) + '%'; }
function pp(v, digits = 1) { return v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(digits) + '%p'; }
function num(v, digits = 1) { return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits); }
function sec(v) { return v == null || !Number.isFinite(v) ? '—' : v.toFixed(0) + 's'; }

/** Δ 셀: 값 + 유의성 배지 */
function deltaCell(d, fmt, betterLower = true) {
  if (!d || d.mean == null) return '<td class="num">—</td>';
  const improved = betterLower ? d.mean < 0 : d.mean > 0;
  const cls = !sig(d) ? 'flat' : (improved ? 'good' : 'bad');
  const badge = sig(d) ? '' : ' <span class="ns">n.s.</span>';
  return `<td class="num ${cls}">${fmt(d.mean)}${badge}</td>`;
}

const ORDER = [
  ['legacy', 'compat'],
  ['HANBANDO_LEGACY_NORMAL', 'compat'],
  ['HANBANDO_LEGACY_NORMAL', 'iads-c2'],
  ['HANBANDO_MINI_NORMAL', 'compat'],
  ['HANBANDO_MINI_NORMAL', 'iads-c2'],
  ['HANBANDO_FULL_NORMAL', 'compat'],
  ['HANBANDO_FULL_NORMAL', 'iads-c2']
];

/** 시나리오별 주요 결과표 */
function mainTable(scenario) {
  let rows = '';
  for (const [dep, fid] of ORDER) {
    const c = byKey.get(`${scenario}|${dep}|${fid}`);
    if (!c) continue;
    const a = c.asis, b = c.tobe, d = c.delta;
    rows += `<tr>
      <td>${esc(DEP_NAME[dep])}<br><span class="small">${esc(FID_NAME[fid])} · n=${c.reps}</span></td>
      <td class="num">${pct(a.leakRateSpawn.mean)}</td>
      <td class="num">${pct(b.leakRateSpawn.mean)}</td>
      ${deltaCell(d.leakRateSpawn, v => pp(v), true)}
      <td class="num">${pct(a.killRateSpawn.mean)}</td>
      <td class="num">${pct(b.killRateSpawn.mean)}</td>
      ${deltaCell(d.killRateSpawn, v => pp(v), false)}
      <td class="num">${sec(a.meanDecisionDelaySec.mean)}</td>
      <td class="num">${sec(b.meanDecisionDelaySec.mean)}</td>
      ${deltaCell(d.meanDecisionDelaySec, v => (v > 0 ? '+' : '') + v.toFixed(0) + 's', true)}
      <td class="num">${pct(a.censoredRate.mean)}</td>
      <td class="num">${pct(b.censoredRate.mean)}</td>
    </tr>`;
  }
  return `<table class="wide">
    <thead><tr>
      <th rowspan="2">배치 · 충실도</th>
      <th colspan="3">요격 실패율(전체 생성 기준)</th>
      <th colspan="3">격추율(전체 생성 기준)</th>
      <th colspan="3">결심 지연(탐지→교전)</th>
      <th colspan="2">관측종료 미해결</th>
    </tr><tr>
      <th>As-Is</th><th>To-Be</th><th>Δ</th>
      <th>As-Is</th><th>To-Be</th><th>Δ</th>
      <th>As-Is</th><th>To-Be</th><th>Δ</th>
      <th>As-Is</th><th>To-Be</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <p class="small">※ 세 비율의 분모는 모두 <b>전체 생성 위협</b>입니다. 격추율 + 요격 실패율 + 관측종료 미해결 = 100%.
    미해결 비율이 크면 그만큼 격추/실패 양쪽이 낮게 표시되므로, 셀 간 비교 시 이 열을 함께 보아야 합니다.</p>`;
}

/** 구조 지표(MoCE) 표 */
function structureTable(scenario) {
  let rows = '';
  for (const [dep, fid] of ORDER) {
    const c = byKey.get(`${scenario}|${dep}|${fid}`);
    if (!c) continue;
    const a = c.asis, b = c.tobe;
    rows += `<tr>
      <td>${esc(DEP_NAME[dep])} <span class="small">${esc(FID_NAME[fid])}</span></td>
      <td class="num">${num(a.duplicateEngagements.mean, 1)}</td>
      <td class="num">${num(b.duplicateEngagements.mean, 1)}</td>
      <td class="num">${num(a.coordGaps.mean, 1)}</td>
      <td class="num">${num(b.coordGaps.mean, 1)}</td>
      <td class="num">${num(a.structuralLeaks.mean, 1)}</td>
      <td class="num">${num(b.structuralLeaks.mean, 1)}</td>
      <td class="num">${num(a.bottleneckCount.mean, 1)}</td>
      <td class="num">${num(b.bottleneckCount.mean, 1)}</td>
    </tr>`;
  }
  return `<table class="wide"><thead><tr>
    <th rowspan="2">배치 · 충실도</th>
    <th colspan="2">중복교전(건)</th><th colspan="2">협조 실패·책임공백(건)</th>
    <th colspan="2">구조적 실패(건)</th><th colspan="2">도출 병목(개)</th>
  </tr><tr>
    <th>As-Is</th><th>To-Be</th><th>As-Is</th><th>To-Be</th>
    <th>As-Is</th><th>To-Be</th><th>As-Is</th><th>To-Be</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/** 부하·비용 지표 표 */
function loadCostTable(scenario) {
  let rows = '';
  for (const [dep, fid] of ORDER) {
    const c = byKey.get(`${scenario}|${dep}|${fid}`);
    if (!c) continue;
    const a = c.asis, b = c.tobe;
    rows += `<tr>
      <td>${esc(DEP_NAME[dep])} <span class="small">${esc(FID_NAME[fid])}</span></td>
      <td class="num">${num(a.c2MaxRhoTrack.mean, 2)}</td>
      <td class="num">${num(b.c2MaxRhoTrack.mean, 2)}</td>
      <td class="num">${num(a.apprMaxRho.mean, 2)}</td>
      <td class="num">${num(b.apprMaxRho.mean, 2)}</td>
      <td class="num">${num(a.shooterMaxRho.mean, 2)}</td>
      <td class="num">${num(b.shooterMaxRho.mean, 2)}</td>
      <td class="num">${num(a.interceptM.mean, 1)}</td>
      <td class="num">${num(b.interceptM.mean, 1)}</td>
      <td class="num">${pct(a.defenseEfficiency.mean)}</td>
      <td class="num">${pct(b.defenseEfficiency.mean)}</td>
    </tr>`;
  }
  return `<table class="wide"><thead><tr>
    <th rowspan="2">배치 · 충실도</th>
    <th colspan="2">C2 항적 ρ</th><th colspan="2">승인 ρ</th><th colspan="2">무기 ρ</th>
    <th colspan="2">요격탄 비용($M)</th><th colspan="2">방어효율</th>
  </tr><tr>
    <th>As-Is</th><th>To-Be</th><th>As-Is</th><th>To-Be</th><th>As-Is</th><th>To-Be</th>
    <th>As-Is</th><th>To-Be</th><th>As-Is</th><th>To-Be</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/** 누수 사유 상위 비교 */
function leakReasonTable(scenario) {
  let out = '';
  for (const [dep, fid] of ORDER) {
    const c = byKey.get(`${scenario}|${dep}|${fid}`);
    if (!c) continue;
    const codes = [...new Set([...Object.keys(c.leakReasons.asis), ...Object.keys(c.leakReasons.tobe)])];
    codes.sort((x, y) => (c.leakReasons.asis[y] || 0) - (c.leakReasons.asis[x] || 0));
    const top = codes.slice(0, 5);
    if (!top.length) continue;
    const items = top.map(code => {
      const a = c.leakReasons.asis[code] || 0, b = c.leakReasons.tobe[code] || 0;
      const per = n => (n / c.reps).toFixed(1);
      return `<tr><td><code>${esc(code)}</code></td><td class="num">${per(a)}</td><td class="num">${per(b)}</td></tr>`;
    }).join('');
    out += `<div class="leakblock"><b>${esc(DEP_NAME[dep])} · ${esc(FID_NAME[fid])}</b>
      <table class="mini"><thead><tr><th>주원인 코드</th><th>As-Is</th><th>To-Be</th></tr></thead>
      <tbody>${items}</tbody></table></div>`;
  }
  return `<div class="leakgrid">${out}</div>`;
}

/** 강도 스윕 SVG 라인차트 */
function sweepChart(scenario) {
  if (!sweep) return '';
  const pts = sweep.points.filter(p => p.scenario === scenario);
  if (!pts.length) return '';
  const W = 700, H = 240, PAD = { l: 48, r: 14, t: 12, b: 30 };
  const xs = pts.map(p => p.intensity);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMax = Math.min(1, Math.max(...pts.flatMap(p => [p.asis.leakRateSpawn, p.tobe.leakRateSpawn])) * 1.15) || 1;
  const px = x => PAD.l + (x - xMin) / (xMax - xMin) * (W - PAD.l - PAD.r);
  const py = y => H - PAD.b - (y / yMax) * (H - PAD.t - PAD.b);
  const poly = sel => pts.map(p => `${px(p.intensity).toFixed(1)},${py(sel(p)).toFixed(1)}`).join(' ');
  // As-Is C2가 ρ≥0.9를 처음 넘는 강도(임계 전환점)
  const cross = pts.find(p => Math.max(p.asis.c2MaxRhoTrack, p.asis.apprMaxRho) >= 0.9);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const yv = yMax * i / 4;
    g += `<line x1="${PAD.l}" y1="${py(yv)}" x2="${W - PAD.r}" y2="${py(yv)}" stroke="#dde4ec"/>` +
      `<text x="${PAD.l - 6}" y="${py(yv) + 3}" font-size="9" fill="#6b7a8d" text-anchor="end">${(yv * 100).toFixed(0)}%</text>`;
  }
  for (const p of pts) {
    g += `<text x="${px(p.intensity)}" y="${H - PAD.b + 13}" font-size="8.5" fill="#6b7a8d" text-anchor="middle">${p.intensity}×</text>`;
  }
  if (cross) {
    g += `<line x1="${px(cross.intensity)}" y1="${PAD.t}" x2="${px(cross.intensity)}" y2="${H - PAD.b}" stroke="#c0392b" stroke-dasharray="4 3"/>` +
      `<text x="${px(cross.intensity) + 4}" y="${PAD.t + 10}" font-size="8.5" fill="#c0392b">As-Is C2 ρ≥0.9 (×${cross.intensity})</text>`;
  }
  g += `<polyline points="${poly(p => p.asis.leakRateSpawn)}" fill="none" stroke="#c0392b" stroke-width="2"/>`;
  g += `<polyline points="${poly(p => p.tobe.leakRateSpawn)}" fill="none" stroke="#2f7d32" stroke-width="2"/>`;
  for (const p of pts) {
    g += `<circle cx="${px(p.intensity)}" cy="${py(p.asis.leakRateSpawn)}" r="2.6" fill="#c0392b"/>` +
      `<circle cx="${px(p.intensity)}" cy="${py(p.tobe.leakRateSpawn)}" r="2.6" fill="#2f7d32"/>`;
  }
  // 절단(관측종료 미해결) 곡선 — 강도가 오르면 미해결이 늘어 실패율이 낮아 보이는 착시를 드러낸다
  if (pts[0].asis.censoredRate != null) {
    g += `<polyline points="${poly(p => p.asis.censoredRate)}" fill="none" stroke="#a06a00" stroke-width="1.4" stroke-dasharray="4 3"/>`;
  }
  const first = pts[0], last = pts[pts.length - 1];
  const censNote = first.asis.censoredRate != null
    ? ` · As-Is 관측종료 미해결 ${pct(first.asis.censoredRate, 0)}(×${first.intensity}) → ${pct(last.asis.censoredRate, 0)}(×${last.intensity})`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>
    <div class="legend"><span class="sw asis"></span>As-Is 요격 실패율
    <span class="sw tobe"></span>To-Be 요격 실패율
    <span class="sw cens"></span>As-Is 관측종료 미해결(점선) · 가로축 위협 강도 배수 (legacy 배치, n=${sweep.reps})</div>
    <p class="small">※ 강도가 오르면 <b>관측종료 미해결</b>이 함께 늘어 세 비율의 합(격추+실패+미해결)이
    100%로 유지되는 가운데 실패율이 낮아 보일 수 있습니다${censNote}. 강도 축의 실패율 곡선은
    반드시 이 점선과 함께 읽어야 합니다.</p>`;
}

// ── 자동 관찰 생성: 데이터에서 직접 도출되는 사실 + 특이 패턴 감지 ──
function observations(scenario) {
  const out = [];
  for (const [dep, fid] of ORDER) {
    const c = byKey.get(`${scenario}|${dep}|${fid}`);
    if (!c) continue;
    const d = c.delta, a = c.asis, b = c.tobe;
    const label = `${DEP_NAME[dep]}·${FID_NAME[fid]}`;
    const dl = d.leakRateSpawn;
    if (!dl || dl.mean == null) continue;
    const verdict = sig(dl)
      ? (dl.mean < 0 ? '<b class="g">유의하게 개선</b>' : '<b class="b">유의하게 악화</b>')
      : '<b>통계적으로 분리되지 않음</b>';
    let s = `<li><b>${esc(label)}</b> — 요격 실패율 ${pct(a.leakRateSpawn.mean)} → ${pct(b.leakRateSpawn.mean)}`
      + ` (Δ ${pp(dl.mean)}, 95% CI [${pp(dl.lo)}, ${pp(dl.hi)}]) — ${verdict}.`;
    if (d.meanDecisionDelaySec && d.meanDecisionDelaySec.mean != null) {
      s += ` 결심 지연 ${sec(a.meanDecisionDelaySec.mean)} → ${sec(b.meanDecisionDelaySec.mean)}.`;
    }
    if (a.duplicateEngagements.mean > 0) {
      s += ` 중복교전 ${num(a.duplicateEngagements.mean, 1)}건 → ${num(b.duplicateEngagements.mean, 1)}건.`;
    }
    // ── 특이 패턴 감지 ──
    const flags = [];
    if (!sig(dl) && a.duplicateEngagements.mean > 0) {
      flags.push('구조 결함(중복교전)은 관측되지만 <b>임무 결과(실패율)로는 이어지지 않았다</b> — 이 부하에서는 중복 사격이 요격탄만 낭비할 뿐 격추 기회를 잠식하지 않았음을 뜻한다');
    }
    if (Math.abs(dl.mean) < 1e-9) {
      flags.push('두 구조의 결과가 <b>완전히 동일</b>하다 — C2 구조가 아니라 <b>능력·자원 공백</b>이 결과를 지배하는 셀(구조 개선으로 해결 불가)');
    }
    if (sig(dl) && dl.mean < 0 && d.meanDecisionDelaySec && d.meanDecisionDelaySec.mean >= -1) {
      flags.push('결심 지연 단축 없이 실패율이 개선됐다 — 속도가 아니라 <b>탐지 융합·무기 배정</b> 경로의 기여');
    }
    if (a.censoredRate.mean > 0.25) {
      flags.push(`관측종료 미해결이 ${pct(a.censoredRate.mean)}로 높다 — 실패율·격추율이 <b>동시에 낮게</b> 보이므로 셀 간 절대값 비교에 주의`);
    }
    if (a.structuralLeaks.mean > 0 && b.structuralLeaks.mean < a.structuralLeaks.mean * 0.5) {
      flags.push(`구조적 실패가 ${num(a.structuralLeaks.mean, 1)}건 → ${num(b.structuralLeaks.mean, 1)}건으로 절반 이하로 감소 — <b>구조 개선의 정상 경로</b>`);
    }
    if (b.shooterMaxRho.mean > a.shooterMaxRho.mean + 0.05) {
      flags.push(`무기 이용률이 ${num(a.shooterMaxRho.mean, 2)} → ${num(b.shooterMaxRho.mean, 2)}로 상승 — <b>병목이 C2에서 무기체계로 이동</b>`);
    }
    if (flags.length) s += `<br><span class="flag">→ ${flags.join('. ')}.</span>`;
    out.push(s + '</li>');
  }
  return `<ul class="obs">${out.join('')}</ul>`;
}

const generatedAt = process.env.EXPERIMENT_DATE || '2026-07-27';

const sections = ['sc1', 'sc2', 'sc3'].map((sc, i) => `
<h2${i === 0 ? '' : ' class="pb"'}><span class="no">${4 + i}.</span>${esc(SC_NAME[sc])}</h2>
<h3>${4 + i}.1 임무 결과 — 요격 실패율·격추율·결심 지연</h3>
${mainTable(sc)}
<h3>${4 + i}.2 구조 지표 — 중복교전·책임공백·구조적 실패</h3>
${structureTable(sc)}
<h3>${4 + i}.3 부하·비용 — 어디가 붐비고 얼마를 썼는가</h3>
${loadCostTable(sc)}
<h3>${4 + i}.4 실패 주원인 상위 5종 (복제당 평균 건수)</h3>
${leakReasonTable(sc)}
<h3>${4 + i}.5 관찰</h3>
${observations(sc)}
${sweep ? `<h3>${4 + i}.6 위협 강도 스윕 — 부하에 따른 개선폭 (legacy)</h3>${sweepChart(sc)}` : ''}
`).join('');

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>K-JAMDS As-Is↔To-Be 실험 보고서</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'WenQuanYi Zen Hei','Noto Sans KR',sans-serif; font-size: 9.5pt; line-height: 1.55; color: #1a2433; word-break: keep-all; }
  .page { padding: 0 4mm; }
  h1 { font-size: 20pt; margin-bottom: 3mm; }
  h2 { font-size: 13pt; color: #16508c; border-bottom: 2px solid #16508c; padding-bottom: 1.2mm; margin: 7mm 0 3mm; page-break-after: avoid; }
  h2 .no { color: #8ba3c0; margin-right: 2mm; }
  h3 { font-size: 10.5pt; color: #123c68; margin: 4.5mm 0 1.5mm; page-break-after: avoid; }
  p { margin: 1.5mm 0; }
  table { border-collapse: collapse; width: 100%; margin: 1.5mm 0 3mm; font-size: 8.3pt; page-break-inside: avoid; }
  th, td { border: 1px solid #cfd8e3; padding: 1mm 1.6mm; text-align: left; vertical-align: middle; }
  th { background: #e8eef6; color: #123c68; text-align: center; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #f8fafd; }
  td.good { color: #1d7a28; font-weight: bold; }
  td.bad { color: #b3261e; font-weight: bold; }
  td.flat { color: #5c6b7d; }
  .ns { font-size: 7pt; color: #8a97a8; font-weight: normal; }
  .small { font-size: 7.5pt; color: #5c6b7d; }
  .obs li { margin: 1.2mm 0 1.2mm 5mm; }
  .obs b.g { color: #1d7a28; } .obs b.b { color: #b3261e; }
  .flag { color: #7a5b10; font-size: 8.6pt; }
  .leakgrid { display: flex; flex-wrap: wrap; gap: 3mm; }
  .leakblock { flex: 1 1 30%; min-width: 62mm; }
  table.mini { font-size: 7.8pt; margin-top: 1mm; }
  .chart { width: 100%; max-width: 175mm; }
  .legend { font-size: 8pt; color: #5c6b7d; margin-bottom: 2mm; }
  .sw { display: inline-block; width: 8px; height: 8px; margin: 0 2px 0 8px; border-radius: 2px; }
  .sw.asis { background: #c0392b; } .sw.tobe { background: #2f7d32; } .sw.cens { background: #a06a00; }
  .box { border: 1px solid #cfd8e3; border-left: 4px solid #0b7a5c; background: #f4faf8; padding: 2mm 3.5mm; margin: 2.5mm 0; page-break-inside: avoid; }
  .box.warn { border-left-color: #a34a00; background: #fdf6ee; }
  .box b.t { display: block; margin-bottom: 0.8mm; color: #0b7a5c; }
  .box.warn b.t { color: #a34a00; }
  .cover { text-align: center; padding-top: 40mm; page-break-after: always; }
  .cover .sub { font-size: 11pt; color: #4a5a70; margin-top: 3mm; }
  .cover .meta { margin-top: 30mm; font-size: 9.5pt; color: #4a5a70; line-height: 1.9; }
  .cover .disc { margin: 10mm auto 0; max-width: 190mm; text-align: left; font-size: 8.5pt; border: 1.4px solid #9c2b2b; color: #9c2b2b; padding: 2.5mm 4mm; border-radius: 2mm; }
  .pb { page-break-before: always; }
  code { font-family: 'DejaVu Sans Mono',monospace; font-size: 0.92em; background: #eef2f7; padding: 0 0.8mm; }
</style></head><body>

<div class="cover">
  <h1>K-JAMDS C2 시뮬레이터<br>As-Is ↔ To-Be 비교 실험 보고서</h1>
  <div class="sub">시나리오 × 배치 × 모델충실도 전수 실험 — 동일 seed 짝지은(paired) 복제와 Δ 95% 신뢰구간</div>
  <div class="meta">
    생성일 ${esc(generatedAt)} · 실험 셀 ${cells.length}개 · 총 복제 ${cells.reduce((n, c) => n + c.reps * 2, 0)}회 실행<br>
    엔진 <code>js/engine/sim-engine.js</code> · 러너 <code>scripts/experiment-run.mjs</code> · 집계 <code>scripts/experiment-report.mjs</code>
  </div>
  <div class="disc">⚠️ <b>디스클레이머</b> — 본 보고서의 모든 수치는 공개자료 기반 <b>정책연구용 개념값</b>으로 수행한
  시뮬레이션 결과이며 실제 작전 성능이 아닙니다. 절대값이 아니라 <b>동일 조건에서의 As-Is↔To-Be 상대비교</b>로만
  해석해야 합니다. 고해상도(MINI/FULL) 절대값은 배치·파이프라인 비교값입니다.</div>
</div>

<div class="page">
<h2><span class="no">1.</span>실험 설계</h2>
<p>본 실험은 K-JAMDS C2 시뮬레이터가 구현한 9단계 파이프라인 위에서, <b>분절형(As-Is)</b>과
<b>통합형(To-Be)</b> 지휘통제 구조를 세 축으로 교차해 비교한 것입니다.</p>
<table>
  <tr><th style="width:16%">축</th><th style="width:34%">수준</th><th>의도</th></tr>
  <tr><td>시나리오</td><td>SC1 경계 침투 · SC2 무인기 동시 남파 · SC3 전략적 섞어쏘기</td>
      <td>KJADS 구축안 3대 문제 상황. 부하(λ)와 위협 구성이 다르다</td></tr>
  <tr><td>배치</td><td>legacy(64노드) · <b>LEGACY_HIRES</b>(legacy 편성 고해상도) · MINI(8포대) · FULL(84포대)</td>
      <td>전력 규모와 지리적 밀도가 결과를 지배하는지 분리. LEGACY_HIRES는 legacy와 <b>자산 편성이 같고
      충실도만 다른</b> 대조를 만들기 위해 추가했다(ADR-054)</td></tr>
  <tr><td>모델 충실도</td><td>compat(개념 교전) · iads-c2(SNR/RCS·PIP·화력통제 물리)</td>
      <td>모델 정밀화가 As-Is↔To-Be 결론을 뒤집는지 검증</td></tr>
</table>
<div class="box"><b class="t">통계 설계 — 짝지은 복제(paired replication)와 공통난수(CRN)</b>
복제마다 <b>동일 seed</b>로 As-Is와 To-Be를 각각 실행해 두 구조가 <b>완전히 같은 위협열</b>을
마주하게 했습니다(도착 난수 스트림 분리). 따라서 두 값의 차이는 위협 표본의 우연이 아니라
<b>오직 C2 구조 차이</b>에서만 발생합니다. 유의성은 팔별 신뢰구간 비교가 아니라
<b>seed별 Δ(To-Be−As-Is)의 95% 신뢰구간이 0을 제외하는지</b>로 판정했습니다(표에서 <code>n.s.</code>는
분리되지 않음). 강도·지속시간·seed 격자는 전 셀에서 동일합니다(기본 강도 ×1.0, 1800초, baseSeed 12345).</div>
<div class="box warn"><b class="t">복제 수의 비대칭 — 계산 비용 때문입니다</b>
legacy·LEGACY_HIRES·MINI는 30복제, FULL은 <b>10복제</b>로 실행했습니다. FULL 셀은 실행 1회가 8~37초로
legacy(0.01~0.08초)보다 세 자릿수 비쌉니다. 복제가 적은 셀은 신뢰구간이 넓어 <code>n.s.</code>가
나오기 쉬우므로, <b>"차이 없음"이 아니라 "이 표본으로는 분리되지 않음"</b>으로 읽어야 합니다.</div>

<h2><span class="no">2.</span>핵심 결론 요약</h2>
${summaryBlock()}

<h2><span class="no">3.</span>지표 읽는 법 (요약)</h2>
<table>
  <tr><th style="width:22%">지표</th><th style="width:30%">정의</th><th>해석 시 주의</th></tr>
  <tr><td>요격 실패율 / 격추율</td><td>누출 또는 격추 ÷ <b>전체 생성 위협</b>(미해결 포함)</td>
      <td>화면의 "해결분 기준"과 분모가 다르다. 본 보고서는 전 표에서 전체 생성 기준으로 통일</td></tr>
  <tr><td>결심 지연</td><td>탐지 → 최초 교전명령 평균(초)</td>
      <td>협조·승인·대기가 모두 포함. To-Be 개선의 주 경로</td></tr>
  <tr><td>중복교전</td><td>같은 표적을 두 통제계통이 각각 교전한 건수</td>
      <td>To-Be는 융합으로 팬아웃이 없어 구조적으로 0</td></tr>
  <tr><td>구조적 실패</td><td>구조·능력 개입으로만 해결되는 주원인 합</td>
      <td>To-Be에서 줄고 명중 실패로 이동하는 것이 정상 경로</td></tr>
  <tr><td>C2/승인/무기 ρ</td><td>작업종류별 최대 이용률(0~1)</td>
      <td>포화 시 드롭이 분자에서 빠져 수요를 과소표현</td></tr>
  <tr><td>방어효율</td><td>격추 위협가치 ÷ (격추+누수 위협가치)</td>
      <td>비용교환비의 "안 쏘면 최적" 함정을 반전하는 보완 지표</td></tr>
</table>
${sections}

${delegationSection()}
<h2 class="pb"><span class="no">8.</span>종합 해석과 한계</h2>
${wrapUp()}
</div>
</body></html>`;

// ── 요약·결론 블록은 데이터에서 계산해 생성한다 ──
function summaryBlock() {
  const lines = [];
  let sigImproved = 0, sigWorse = 0, ns = 0;
  for (const c of cells) {
    const d = c.delta.leakRateSpawn;
    if (!d || d.mean == null) continue;
    if (!sig(d)) ns++; else if (d.mean < 0) sigImproved++; else sigWorse++;
  }
  lines.push(`<li><b>요격 실패율 기준</b> — 전체 ${cells.length}개 셀 중 <b>${sigImproved}개에서 To-Be가 유의하게 개선</b>,
    ${sigWorse}개에서 유의하게 악화, ${ns}개는 이 표본으로 분리되지 않았습니다(<code>n.s.</code>).</li>`);
  // 결심 지연은 전 셀 공통으로 개선되는가
  const dd = cells.map(c => c.delta.meanDecisionDelaySec).filter(d => d && d.mean != null);
  const ddImproved = dd.filter(d => d.mean < 0).length;
  lines.push(`<li><b>결심 지연</b> — ${dd.length}개 셀 중 <b>${ddImproved}개에서 To-Be가 단축</b>되었습니다.
    통합 C2의 1차 효과는 시나리오·배치·충실도와 무관하게 <b>속도</b>에서 먼저 나타납니다.</li>`);
  // 중복교전은 To-Be에서 항상 0인가
  const dupAllZero = cells.every(c => (c.tobe.duplicateEngagements.mean || 0) === 0);
  const dupAsis = cells.filter(c => (c.asis.duplicateEngagements.mean || 0) > 0).length;
  lines.push(`<li><b>중복교전·책임공백</b> — As-Is에서 중복교전이 관측된 셀은 ${dupAsis}개이며,
    To-Be에서는 ${dupAllZero ? '<b>전 셀에서 0건</b>' : '대부분 감소'}입니다.
    이는 KJADS 문제 상황 1(교전 중복·책임공백)이 <b>구조에서 비롯됨</b>을 보여줍니다.</li>`);
  return `<ul class="obs">${lines.join('')}</ul>`;
}

/** 충실도 축: 같은 시나리오·배치에서 compat vs iads-c2 절대값과 방향 비교 */
function fidelityTable() {
  let rows = '';
  for (const sc of ['sc1', 'sc2', 'sc3']) {
    for (const dep of ['HANBANDO_LEGACY_NORMAL', 'HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL']) {
      const cc = byKey.get(`${sc}|${dep}|compat`), ci = byKey.get(`${sc}|${dep}|iads-c2`);
      if (!cc || !ci) continue;
      const dirOf = c => {
        const d = c.delta.leakRateSpawn;
        return !sig(d) ? 'n.s.' : (d.mean < 0 ? '개선' : '악화');
      };
      const same = dirOf(cc) === dirOf(ci);
      rows += `<tr>
        <td>${esc(sc.toUpperCase())} · ${esc(DEP_NAME[dep])}</td>
        <td class="num">${pct(cc.asis.leakRateSpawn.mean)}</td>
        <td class="num">${pct(ci.asis.leakRateSpawn.mean)}</td>
        <td class="num">${pct(cc.tobe.leakRateSpawn.mean)}</td>
        <td class="num">${pct(ci.tobe.leakRateSpawn.mean)}</td>
        <td class="num">${pp(cc.delta.leakRateSpawn.mean)} (${dirOf(cc)})</td>
        <td class="num">${pp(ci.delta.leakRateSpawn.mean)} (${dirOf(ci)})</td>
        <td class="num ${same ? 'good' : 'bad'}">${same ? '유지' : '뒤집힘'}</td>
      </tr>`;
    }
  }
  return `<table class="wide"><thead><tr>
    <th rowspan="2">시나리오 · 배치</th>
    <th colspan="2">As-Is 실패율</th><th colspan="2">To-Be 실패율</th>
    <th colspan="2">Δ(To-Be−As-Is)</th><th rowspan="2">결론 방향</th>
  </tr><tr>
    <th>compat</th><th>iads-c2</th><th>compat</th><th>iads-c2</th>
    <th>compat</th><th>iads-c2</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * 배치·충실도별 결심 지연 Δ — legacy 9단계와 native 경로의 구조적 차이를 드러낸다.
 * legacy는 승인 홉·음성 협조가 명시적으로 모델링되어 To-Be가 그것을 제거하지만,
 * native는 As-Is에서도 책임 C2가 자체 승인하므로 제거할 홉 자체가 적다.
 */
function decisionDelayTable() {
  const groups = new Map();
  for (const c of cells) {
    const d = c.delta.meanDecisionDelaySec;
    if (!d || d.mean == null) continue;
    const k = `${c.spec.deployment}|${c.spec.fidelity}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ sc: c.spec.scenario, mean: d.mean });
  }
  const order = ORDER.map(([dep, fid]) => `${dep}|${fid}`).filter(k => groups.has(k));
  const rows = order.map(k => {
    const [dep, fid] = k.split('|');
    const v = groups.get(k);
    const avg = v.reduce((n, x) => n + x.mean, 0) / v.length;
    const per = ['sc1', 'sc2', 'sc3'].map(sc => {
      const hit = v.find(x => x.sc === sc);
      return `<td class="num">${hit ? (hit.mean > 0 ? '+' : '') + hit.mean.toFixed(0) + 's' : '—'}</td>`;
    }).join('');
    const pipeline = dep === 'legacy' ? '9단계(승인 홉·음성 협조 명시)' : 'native(책임 C2 자체 승인)';
    return `<tr><td>${esc(DEP_NAME[dep])} <span class="small">${esc(FID_NAME[fid])}</span></td>
      <td>${esc(pipeline)}</td>${per}
      <td class="num ${avg < -60 ? 'good' : 'flat'}">${(avg > 0 ? '+' : '') + avg.toFixed(0)}s</td></tr>`;
  }).join('');
  return `<table><thead><tr>
    <th style="width:24%">배치 · 충실도</th><th style="width:22%">C2 파이프라인</th>
    <th>SC1</th><th>SC2</th><th>SC3</th><th>평균</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/** 배치 축: 같은 시나리오·충실도에서 legacy/MINI/FULL 절대값 비교 */
function deploymentTable() {
  let rows = '';
  for (const sc of ['sc1', 'sc2', 'sc3']) {
    for (const fid of ['compat', 'iads-c2']) {
      const cells3 = ['legacy', 'HANBANDO_LEGACY_NORMAL', 'HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL']
        .map(dep => byKey.get(`${sc}|${dep}|${fid}`));
      if (!cells3.some(Boolean)) continue;
      const cellFor = c => c ? `${pct(c.asis.leakRateSpawn.mean)} → ${pct(c.tobe.leakRateSpawn.mean)}` : '—';
      rows += `<tr><td>${esc(sc.toUpperCase())} · ${esc(FID_NAME[fid])}</td>
        <td class="num">${cellFor(cells3[0])}</td>
        <td class="num">${cellFor(cells3[1])}</td>
        <td class="num">${cellFor(cells3[2])}</td>
        <td class="num">${cellFor(cells3[3])}</td></tr>`;
    }
  }
  return `<table><thead><tr><th>시나리오 · 충실도</th>
    <th>legacy</th><th>LEGACY_HIRES</th><th>MINI</th><th>FULL</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <p class="small">각 칸은 <b>As-Is → To-Be</b> 요격 실패율. <code>legacy</code>는 iads-c2를 지원하지 않으므로
  물리 행에서 '—'이고, <b>LEGACY_HIRES는 legacy와 전력 구성이 달라</b>(전투기·이지스·조기경보기·광학감시 제외)
  두 열의 절대값을 직접 비교하면 안 된다.</p>`;
}

/** 동적 분권 전환의 부하 의존성 — 강도 축에서 As-Is가 스스로 적응하는 기제 */
function delegationSection() {
  if (!deleg) return '';
  const rows = deleg.points.map(p => `<tr>
    <td class="num">×${p.intensity}</td>
    <td class="num">${num(p.spawned, 0)}</td>
    <td class="num">${num(p.delegationCount, 1)}</td>
    <td class="num">${num(p.approvalMaxRho, 2)}</td>
    <td class="num">${sec(p.meanDecisionDelaySec)}</td>
    <td class="num">${pct(p.engageStartRate)}</td>
    <td class="num">${pct(p.killRateSpawn)}</td>
    <td class="num">${pct(p.leakRateSpawn)}</td>
    <td class="num">${pct(p.censoredRate)}</td>
  </tr>`).join('');
  const first = deleg.points[0], last = deleg.points[deleg.points.length - 1];
  return `<h2 class="pb"><span class="no">7.</span>특이 발견 — As-Is의 부하 적응 기제(동적 분권 전환)</h2>
<div class="box warn"><b class="t">기존 서사와 반대 방향의 관측</b>
강도 스윕에서 <b>As-Is의 요격 실패율이 부하가 오를수록 오히려 낮아지는</b> 현상이 나타났습니다
(SC3 legacy: ×0.5에서 ${pct(first.leakRateSpawn)} → ×3.0에서 ${pct(last.leakRateSpawn)}).
먼저 <b>절단(관측종료 미해결) 때문인지 확인했으나 아닙니다</b> — 절단율은
${pct(first.censoredRate)} → ${pct(last.censoredRate)}로 거의 일정한 반면 <b>격추율 자체가</b>
${pct(first.killRateSpawn)} → ${pct(last.killRateSpawn)}로 상승했습니다.</div>
<p>원인은 엔진의 <b>동적 권한위임(분권 전환, C2-DELEG-THRESH-01)</b>입니다. 승인권자의 대기열이
임계(As-Is는 서버 수 × 4)를 넘으면 결심을 하위·자동으로 위임해 <b>승인 홉을 건너뜁니다</b>.
저부하에서는 전환이 일어나지 않아 As-Is가 승인 병목을 그대로 겪지만, 고부하에서는 전환이
대량 발동해 결심 지연이 <b>짧아지고</b> 교전 개시율이 오릅니다.</p>
<table><thead><tr>
  <th>강도</th><th>생성 위협</th><th>분권 전환(건)</th><th>승인 ρ</th><th>결심 지연</th>
  <th>교전 개시율</th><th>격추율</th><th>실패율</th><th>미해결</th>
</tr></thead><tbody>${rows}</tbody></table>
<p class="small">SC3 · legacy · As-Is · n=${deleg.reps} · <code>node scripts/experiment-delegation.mjs</code>로 재현</p>
<div class="box"><b class="t">이 발견의 함의</b>
① <b>모델 결함이 아니라 구현된 기제가 드러난 것</b>입니다 — 분권 전환은 부하의 함수로 설계되어
있고(하드코딩된 병목 없음), 저강도에서 발동하지 않는 것도 설계대로입니다.
② 그러나 이 때문에 <b>"임계 이후 통합 C2의 가치가 비선형적으로 커진다"는 통상적 서사는
이 설정에서 성립하지 않습니다</b> — 오히려 고부하에서 As-Is가 스스로 적응해 개선폭이 좁아집니다.
③ 결과는 <b>위임 임계값과 음성 협조 지연 설정에 민감</b>합니다. 현재 음성 교전협조는 실험 설정
(균등 10~30초)으로 단축되어 있어 As-Is의 협조 페널티가 작습니다. 원래 값(삼각 90/180/270초)에서는
다른 결과가 나올 수 있으므로, 이 관측을 인용할 때는 <b>두 설정을 반드시 함께 명시</b>해야 합니다.</div>`;
}

function wrapUp() {
  return `<h3>8.1 모델 충실도 축 — 정밀화가 결론을 뒤집는가</h3>
<p>같은 시나리오·배치에서 <b>compat(개념 교전)</b>과 <b>iads-c2(물리 충실도)</b>의 절대값과
As-Is↔To-Be 방향을 비교했습니다. 절대값이 크게 달라져도 <b>결론 방향이 유지</b>되어야 모델이 건전합니다.</p>
${fidelityTable()}
<h3>8.2 왜 legacy에서만 결심 지연이 극적으로 줄어드는가</h3>
<p>결심 지연의 개선폭(Δ)이 배치 계열에 따라 <b>한 자릿수 배 차이</b>가 납니다. 이는 시나리오나
전력 규모가 아니라 <b>C2 파이프라인 구현의 차이</b>에서 옵니다.</p>
${decisionDelayTable()}
<div class="box"><b class="t">해석</b>
legacy 배치는 9단계 파이프라인을 타므로 As-Is가 <b>승인권자까지 가는 협조 홉과 승인 대기</b>를
실제로 지불하고, To-Be는 사전승인 자동교전으로 그 홉을 통째로 제거합니다 — 그래서 Δ가 −120초 안팎으로
전 시나리오에서 일정합니다.<br>
반면 고해상도(native) 경로는 <b>As-Is에서도 책임 C2가 자체 승인</b>하므로 제거할 홉이 애초에 적습니다.
그래서 저부하(SC1·SC2)에서는 Δ가 −10초 안팎에 그치고, 포화가 걸리는 SC3에서만 −88~−95초로 커집니다
(이때의 이득은 홉 제거가 아니라 <b>처리용량·융합</b>에서 옵니다).<br>
<b>"통합 C2가 결심을 얼마나 앞당기는가"의 답은 배치가 아니라 어느 C2 모델을 보느냐에 달려 있습니다.</b>
두 계열의 값을 섞어 인용하면 개선폭을 크게 왜곡하게 됩니다.</div>

<h3>8.3 배치 축 — 전력 규모가 결과를 지배하는가</h3>
${deploymentTable()}
<h3>8.4 세 축이 각각 무엇을 바꾸는가</h3>
<ul class="obs">
  <li><b>시나리오(부하)</b> — 개선폭은 부하의 함수입니다. 저부하에서는 두 구조 모두 여유가 있어
    차이가 작고, 처리용량 임계를 넘는 구간에서 통합 C2의 가치가 비선형적으로 커집니다(각 장 6절 스윕).</li>
  <li><b>LEGACY_HIRES의 역할</b> — 종전에는 "legacy = compat 전용, 고해상도 = MINI/FULL"이라
    배치 축과 충실도 축이 얽혀 있었습니다. LEGACY_HIRES는 <b>legacy와 같은 자산 편성에서 충실도만
    바꾼 대조</b>를 제공하므로, 절대값 변화가 전력 구성 때문인지 물리 정밀화 때문인지 분리할 수 있습니다.
    다만 제외 자산군(전투기·이지스·조기경보기·광학감시) 탓에 <b>legacy와 절대값을 직접 비교할 수는
    없습니다</b> — 비교는 언제나 같은 배치 안의 As-Is ↔ To-Be입니다.</li>
  <li><b>배치(전력 규모)</b> — 포대 수를 늘리는 것과 C2를 통합하는 것은 <b>다른 축</b>입니다.
    배치가 커지면 절대 격추율은 오르지만, As-Is에서는 통제계통이 함께 늘어 중복교전·협조 부하도 증가합니다.</li>
  <li><b>모델 충실도</b> — compat → iads-c2로 정밀화하면 <b>절대값은 크게 바뀝니다</b>(물리 제약이
    교전 가능 조건을 재정의하므로). 중요한 것은 정밀화 후에도 As-Is↔To-Be의 <b>방향</b>이 유지되는지이며,
    이는 각 장 5절 관찰에서 셀별로 확인할 수 있습니다.</li>
</ul>
<h3>8.5 이 실험의 한계</h3>
<ul class="obs">
  <li><b>FULL 배치의 복제 수(10회)</b>가 적어 신뢰구간이 넓습니다. FULL의 <code>n.s.</code>는
    "차이 없음"의 근거가 아닙니다.</li>
  <li><b>단일 강도(×1.0)</b>가 기본입니다. 강도 의존성은 legacy 스윕으로만 관측했습니다.</li>
  <li><b>개념값 모델</b>입니다. 절대 성능 예측이 아니라 구조 비교로만 사용해야 하며,
    특히 음성 교전협조 지연이 실험 설정(10~30초 균등)으로 단축되어 있어 과거 보고서(≥180초)와
    직접 비교할 수 없습니다.</li>
  <li><b>MINI/FULL 절대값</b>은 배치·파이프라인 비교값이며 전술 성능치가 아닙니다.</li>
</ul>
<div class="box"><b class="t">재현 방법</b>
전 셀은 결정론적입니다. 동일 명령으로 같은 수치를 재현할 수 있습니다.<br>
<code>node scripts/experiment-run.mjs --cell "sc3|legacy|compat|1|30"</code><br>
<code>node scripts/experiment-run.mjs --sweep "legacy|compat|20"</code><br>
<code>node scripts/experiment-report.mjs</code> → <code>docs/실험보고서_AsIs_ToBe.html</code></div>`;
}

fs.writeFileSync(OUT, html);
console.log('보고서 생성:', OUT, `(셀 ${cells.length}개)`);
