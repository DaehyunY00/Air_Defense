import fs from 'node:fs';
const D = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const DEP = { HANBANDO_LEGACY_NORMAL: '기본 배치', HANBANDO_FULL_NORMAL: '확대 배치' };
const MODE = { asis: 'As-Is', tobe: 'To-Be' };
const TYPE = { srbm: '탄도탄(SRBM)', mrl_large: '방사포', fighter: '전투기', cruise: '순항미사일', uav_small: '소형 무인기', ac_low: '저속 항공기', heli: '헬기' };
const TYPES = ['srbm', 'mrl_large', 'fighter', 'cruise', 'uav_small'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const mean = a => { const s = a.filter(Number.isFinite); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
const f1 = v => v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1);
const f0 = v => v == null ? '–' : String(Math.round(v));
const pct = v => v == null ? '–' : Math.round(v * 100) + '%';
function tbl(head, rows, cls = '') {
  return `<table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const run = (dep, mode) => D.runs[dep + '|' + mode];
const ECH = n => /^센서_/.test(n) ? 'sensor' : /ICC/.test(n) ? 'relay' : /^ECS_/.test(n) ? 'exec' : /^포대_/.test(n) ? 'battery' : 'c2';
const ECH_COLOR = { sensor: '#9ca3af', c2: '#2563eb', relay: '#7c3aed', exec: '#16a34a', battery: '#d97706' };
const ECH_NAME = { sensor: '센서', c2: '지휘소', relay: '중계(ICC)', exec: '실행(ECS)', battery: '포대' };
const nice = n => n.replace(/^센서_/, '').replace(/^포대_/, '포대 ').replace(/^ECS_/, 'ECS ').replace(/^ICC_/, 'ICC ').replace(/^군단AOC_/, '군단AOC ');

// ── 대표 항적 카드 SVG
function cardSvg(th, mode) {
  const ev = th.events, PER = 9, colW = 78, W = 720, rowH = 72;
  const rows = []; for (let i = 0; i < ev.length; i += PER) rows.push(ev.slice(i, i + PER));
  const H = 18 + rows.length * rowH;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="font-family:inherit">`;
  s += `<text x="0" y="12" font-size="10" font-weight="700" fill="#1f4e79">${MODE[mode]} · ${esc(th.outcome === 'killed' ? '격추' : th.outcome === 'leaked' ? '놓침' : th.outcome)} · 개입 노드 ${th.nodeCount} · 명령 전달 단계 ${th.cmdHops ?? '–'} · 탐지→발사 ${th.dec ? f1(th.dec.total) + '초' : '–'}</text>`;
  rows.forEach((row, ri) => { const y0 = 18 + ri * rowH; let x = 10;
    row.forEach((e, j) => { const i = ri * PER + j; const ech = ECH(e.node); const cx = x + colW / 2;
      if (i > 0) { const dt = e.t - ev[i - 1].t; const lab = '+' + (dt < 10 ? dt.toFixed(1) : Math.round(dt)) + '초';
        if (j > 0) { s += `<line x1="${x - colW / 2 + 26}" y1="${y0 + 22}" x2="${cx - 26}" y2="${y0 + 22}" stroke="#94a3b8" stroke-width="1.2" marker-end="url(#ar)"/>`; s += `<text x="${x}" y="${y0 + 17}" font-size="7.5" text-anchor="middle" fill="#64748b">${lab}</text>`; }
        else { s += `<text x="${cx - 30}" y="${y0 + 17}" font-size="7.5" text-anchor="end" fill="#64748b">↳ ${lab}</text>`; } }
      s += `<rect x="${cx - 26}" y="${y0 + 10}" width="52" height="24" rx="4" fill="${ECH_COLOR[ech]}" opacity="0.9"/>`;
      s += `<text x="${cx}" y="${y0 + 25}" font-size="7.5" text-anchor="middle" fill="#fff" font-weight="600">${esc(nice(e.node)).slice(0, 12)}</text>`;
      s += `<text x="${cx}" y="${y0 + 46}" font-size="7.5" text-anchor="middle" fill="#1e293b">${esc(e.label)}</text>`;
      s += `<text x="${cx}" y="${y0 + 57}" font-size="7" text-anchor="middle" fill="#64748b">${e.t}초</text>`;
      x += colW; });
    if (ri < rows.length - 1) s += `<text x="${x - colW / 2 + 30}" y="${y0 + 26}" font-size="9" fill="#94a3b8">⤵</text>`; });
  s += `<defs><marker id="ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#94a3b8"/></marker></defs></svg>`;
  return s;
}
function pickRep(ty) {
  const A = run('HANBANDO_LEGACY_NORMAL', 'asis').threats.filter(t => t.type === ty), B = run('HANBANDO_LEGACY_NORMAL', 'tobe').threats;
  const cand = A.filter(a => a.dec && B.find(b => b.id === a.id && b.dec));
  const both = cand.filter(a => a.outcome === 'killed' && B.find(b => b.id === a.id).outcome === 'killed');
  const pick = (both[0] || cand[0]); if (!pick) return null;
  return { asis: pick, tobe: B.find(b => b.id === pick.id) };
}
const cards = TYPES.map(ty => { const p = pickRep(ty); if (!p) return `<h3>${TYPE[ty]}</h3><p>양쪽 구조 모두에서 발사까지 간 항적이 없어 카드를 만들 수 없다.</p>`;
  const a = p.asis, b = p.tobe;
  const nodesLine = m => m.nodes.map(n => `<span class="chip" style="border-color:${ECH_COLOR[ECH(n)]}">${esc(nice(n))}</span>`).join(' ');
  return `<div class="card"><h3>${TYPE[ty]} — 항적 ${esc(a.id)} (출현 ${f0(a.spawnT)}초, 최초 탐지 ${esc(a.firstSensor || '–')})</h3>
  ${cardSvg(a, 'asis')}<div class="chips">As-Is 개입 노드: ${nodesLine(a)}</div>
  ${cardSvg(b, 'tobe')}<div class="chips">To-Be 개입 노드: ${nodesLine(b)}</div>
  <div class="legend">보고 ${f1(a.dec.report)}→${f1(b.dec.report)}초 · 처리 ${f1(a.dec.process)}→${f1(b.dec.process)}초 · 협조 ${f1(a.dec.coord)}→${f1(b.dec.coord)}초 · 교전창 대기 ${f1(a.dec.wait)}→${f1(b.dec.wait)}초 · 전달·실행 ${f1(a.dec.deliver)}→${f1(b.dec.deliver)}초</div></div>`; }).join('');

// ── 노드·전달 단계 표
function nodeRows(dep) {
  return TYPES.map(ty => { const cells = [TYPE[ty]];
    for (const mode of ['asis', 'tobe']) { const T = run(dep, mode).threats.filter(t => t.type === ty), L = T.filter(t => t.dec);
      cells.push(T.length + ' / ' + L.length, f0(med(T.map(t => t.nodeCount))), L.length ? `${f0(med(L.map(t => t.nodeCount)))} (${Math.min(...L.map(t => t.nodeCount))}~${Math.max(...L.map(t => t.nodeCount))})` : '–',
        L.length ? `${f0(med(L.map(t => t.byEch.c2)))}/${f0(med(L.map(t => t.byEch.relay)))}/${f0(med(L.map(t => t.byEch.exec)))}` : '–', f0(med(L.map(t => t.cmdHops))), f0(med(T.map(t => t.parallel)))); }
    return cells; });
}
const nodeHead = ['위협', 'As-Is<br>항적/발사', 'As-Is<br>인지 노드', 'As-Is<br>결심 노드(범위)', 'As-Is<br>지휘/중계/실행', 'As-Is<br>명령 전달 단계', 'As-Is<br>병렬 C2', 'To-Be<br>항적/발사', 'To-Be<br>인지 노드', 'To-Be<br>결심 노드(범위)', 'To-Be<br>지휘/중계/실행', 'To-Be<br>명령 전달 단계', 'To-Be<br>병렬 C2'];

// ── 시간 분해
const SEG = [['report', '① 보고 도달', '#94a3b8'], ['process', '② C2 처리', '#2563eb'], ['coord', '③ 교전 협조', '#7c3aed'], ['wait', '④ 교전창 대기', '#e2e8f0'], ['deliver', '⑤ 전달·실행', '#16a34a']];
function decRows(dep) {
  return TYPES.flatMap(ty => ['asis', 'tobe'].map(mode => { const L = run(dep, mode).threats.filter(t => t.type === ty && t.dec); if (!L.length) return [TYPE[ty], MODE[mode], 0, '–', '–', '–', '–', '–', '–', '–'];
    const m = k => med(L.map(t => t.dec[k])); const proc = m('process') + m('coord') + m('deliver'), tot = m('total');
    return [TYPE[ty], MODE[mode], L.length, f1(m('report')), f1(m('process')), f1(m('coord')) + (L.filter(t => t.dec.coord > 0).length ? ` <small>(${L.filter(t => t.dec.coord > 0).length}건)</small>` : ''), f1(m('wait')), f1(m('deliver')), f1(tot), pct(tot ? proc / tot : null)]; }));
}
function barSvg(dep) {
  const rows = []; for (const ty of TYPES) for (const mode of ['asis', 'tobe']) { const L = run(dep, mode).threats.filter(t => t.type === ty && t.dec); if (!L.length) continue; rows.push({ ty, mode, v: Object.fromEntries(SEG.map(([k]) => [k, med(L.map(t => t.dec[k])) || 0])) }); }
  const W = 720, rowH = 22, left = 150, H = rows.length * rowH + 30; const maxT = Math.max(...rows.map(r => SEG.reduce((s, [k]) => s + r.v[k], 0)));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="font-family:inherit">`;
  rows.forEach((r, i) => { const y = 8 + i * rowH; let x = left; s += `<text x="${left - 6}" y="${y + 13}" font-size="8.5" text-anchor="end" fill="#1e293b">${esc(TYPE[r.ty])} · ${MODE[r.mode]}</text>`;
    for (const [k, , c] of SEG) { const w = r.v[k] / maxT * (W - left - 60); if (w > 0) { s += `<rect x="${x}" y="${y + 2}" width="${w}" height="16" fill="${c}" stroke="#fff" stroke-width="0.5"/>`; if (w > 22) s += `<text x="${x + w / 2}" y="${y + 13}" font-size="7.5" text-anchor="middle" fill="${k === 'wait' || k === 'report' ? '#334155' : '#fff'}">${Math.round(r.v[k])}</text>`; x += w; } }
    s += `<text x="${x + 4}" y="${y + 13}" font-size="8" fill="#334155">${Math.round(SEG.reduce((a, [k]) => a + r.v[k], 0))}초</text>`; });
  const ly = H - 8; let lx = left; for (const [, n, c] of SEG) { s += `<rect x="${lx}" y="${ly - 8}" width="10" height="10" fill="${c}" stroke="#94a3b8" stroke-width="0.5"/><text x="${lx + 13}" y="${ly}" font-size="8" fill="#334155">${n}</text>`; lx += 105; }
  return s + '</svg>';
}
// ── 효율 지표
function effRows(dep) {
  return TYPES.map(ty => { const cells = [TYPE[ty]];
    for (const mode of ['asis', 'tobe']) { const T = run(dep, mode).threats.filter(t => t.type === ty), L = T.filter(t => t.dec);
      const tot = med(L.map(t => t.dec.total)), proc = L.length ? med(L.map(t => t.dec.process + t.dec.coord + t.dec.deliver)) : null;
      cells.push(L.length ? f1(proc) : '–', L.length ? f1(proc / med(L.map(t => t.nodeCount))) : '–', T.reduce((s, t) => s + t.reassign + t.bounce, 0), T.reduce((s, t) => s + t.noFire, 0), T.filter(t => t.selects > 1).length, T.reduce((s, t) => s + t.dedup, 0)); }
    return cells; });
}
const effHead = ['위협', 'As-Is<br>절차 시간(초)', 'As-Is<br>노드당 절차 초', 'As-Is<br>재배정·반송', 'As-Is<br>발사 불가', 'As-Is<br>재선정 항적', 'As-Is<br>중복 해소', 'To-Be<br>절차 시간(초)', 'To-Be<br>노드당 절차 초', 'To-Be<br>재배정·반송', 'To-Be<br>발사 불가', 'To-Be<br>재선정 항적', 'To-Be<br>중복 해소'];

// ── 요약 수치
const LA = run('HANBANDO_LEGACY_NORMAL', 'asis'), LT = run('HANBANDO_LEGACY_NORMAL', 'tobe'), FA = run('HANBANDO_FULL_NORMAL', 'asis'), FT = run('HANBANDO_FULL_NORMAL', 'tobe');
const launched = r => r.threats.filter(t => t.dec);
const sumProc = r => med(launched(r).map(t => t.dec.process + t.dec.coord + t.dec.deliver)), sumTot = r => med(launched(r).map(t => t.dec.total));
const relayShare = r => launched(r).filter(t => t.byEch.relay > 0).length / Math.max(1, launched(r).length);
const hopsMed = r => med(launched(r).map(t => t.cmdHops)), nodesMed = r => med(launched(r).map(t => t.nodeCount));

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>K-JAMDS C2 분석결과</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
body { font-family: "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif; font-size: 10.5pt; line-height: 1.55; color: #1a1a1a; margin: 0; }
h1 { font-size: 22pt; margin: 0 0 4px; } h2 { font-size: 15pt; margin: 22px 0 8px; border-bottom: 2px solid #1f4e79; padding-bottom: 3px; color: #1f4e79; }
h3 { font-size: 11.5pt; margin: 14px 0 6px; color: #333; page-break-after: avoid; break-after: avoid; }
p { margin: 6px 0; } small { color: #555; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 8.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #bbb; padding: 3px 4px; text-align: center; vertical-align: middle; } th { background: #e8eef5; font-weight: 600; white-space: nowrap; } td:first-child { text-align: left; white-space: nowrap; }
.kv td:first-child { width: 22%; font-weight: 600; background: #fafafa; } .kv td { text-align: left; }
.box { border: 1px solid #1f4e79; background: #f3f7fb; padding: 8px 12px; margin: 8px 0; border-radius: 4px; page-break-inside: avoid; } .warn { border-color: #b7791f; background: #fff8e6; }
.card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; margin: 10px 0; page-break-inside: avoid; }
.card h3 { margin: 0 0 4px; font-size: 10.5pt; } .chips { font-size: 8pt; color: #334155; margin: 2px 0 6px; } .chip { display: inline-block; border: 1.5px solid; border-radius: 3px; padding: 0 4px; margin: 1px 2px 1px 0; font-size: 7.5pt; }
.legend { font-size: 8.5pt; color: #555; } .pb { page-break-before: always; }
.cover { padding-top: 60px; } .cover .sub { font-size: 13pt; color: #444; margin-top: 6px; } .cover .meta { margin-top: 40px; color: #555; font-size: 10pt; }
ul, ol { margin: 4px 0 6px 18px; padding: 0; } li { margin: 2px 0; }
</style></head><body>
<div class="cover"><h1>K-JAMDS C2 분석결과</h1>
<div class="sub">위협 항적별 지휘통제·결심 흐름의 재구성 — 어느 노드가 개입했고, 결심이 얼마나 효율적으로 흘렀나</div>
<div class="meta">조건: SC3 복합 동시 포화 · seed 29 · 관측 600초 · 위협 강도 ×1 · 기본 배치(15개 포대)와 확대 배치(84개 포대) · C2 결심 시간 동일화 ON(ADR-099)<br>
자료: 엔진 실행 트레이스(항적 단계 마크 + 계선 통과 이벤트) 4회 실행 × 위협 89발<br>작성일: 2026-09-11 · 모든 수치는 같은 엔진으로 직접 실행해 재구성한 값이다.</div></div>

<h2 class="pb">한 장 요약</h2>
<div class="box">
<p><b>무엇을 했나.</b> 위협 한 발이 탐지되고 요격탄이 발사될 때까지 <b>어느 지휘소·중계소·실행소가 개입했는지</b>를 항적마다 재구성하고, 탐지→발사 시간을 다섯 구간(보고 도달 / C2 처리 / 교전 협조 / 교전창 대기 / 전달·실행)으로 나눴다. As-Is와 To-Be는 같은 seed라 같은 위협을 본다.</p>
<p><b>핵심 결과 (기본 배치, 발사까지 간 항적 기준 중앙값).</b></p>
<ul>
<li>결심 네트워크 크기(발사 항적 중앙값): As-Is ${f0(nodesMed(LA))}개 노드 · 명령 전달 ${f0(hopsMed(LA))}단계 → To-Be ${f0(nodesMed(LT))}개 노드 · 명령 전달 ${f0(hopsMed(LT))}단계. To-Be는 ICC 중계를 거치지 않아 전달 단계가 하나 준다. 노드 수가 그만큼 줄지 않는 것은 통합 지휘소가 KAMDOC·MCRC를 도메인 처리로 병렬 참여시키기 때문이다.</li>
<li>절차가 잡아먹는 시간(② C2 처리 + ③ 협조 + ⑤ 전달·실행): As-Is ${f1(sumProc(LA))}초 → To-Be ${f1(sumProc(LT))}초. 탐지→발사 전체는 As-Is ${f1(sumTot(LA))}초 → To-Be ${f1(sumTot(LT))}초.</li>
<li>ICC 중계를 거친 교전 항적 비율: As-Is ${pct(relayShare(LA))}, To-Be ${pct(relayShare(LT))}.</li>
<li>탄도탄은 어느 구조에서든 ④ 교전창 대기가 전체의 대부분이다. 결심은 수십 초 안에 끝나고 요격점이 열리길 기다린다. C2 차이는 항공기·순항미사일·무인기에서 드러난다.</li>
<li>확대 배치에서는 결심 네트워크가 커진다(As-Is ${f0(nodesMed(FA))}개, To-Be ${f0(nodesMed(FT))}개). 미군 축이 병렬 책임 C2로 추가되기 때문이다.</li>
</ul></div>

<h2>1. 분석 방법</h2>
<h3>1-1. 무엇을 추적했나</h3>
<p>엔진은 항적마다 단계 마크(탐지, 책임 C2 지정, 항적 접수, 식별·표적할당 준비, 교전 협조 요청·완료, 사수선정, 명령 중계·인가·접수, 발사, BDA)와, 계선을 통과한 모든 메시지(출발 노드, 도착 노드, 종류, 매체, 출발·도착 시각)를 남긴다. 이 둘을 항적 id로 묶으면 그 항적을 둘러싼 결심 네트워크가 복원된다.</p>
<h3>1-2. 결심 네트워크를 세는 규칙</h3>
${tbl(['용어', '정의'], [
  ['인지 노드', '그 항적에 대해 마크를 남겼거나 메시지를 주고받은 모든 지휘소·중계소·실행소·포대(센서 제외). 발사에 이르지 못한 항적도 포함'],
  ['결심 노드', '발사까지 간 항적의 인지 노드 수. "이 한 발을 잡는 데 몇 개 노드가 움직였나"'],
  ['지휘 / 중계 / 실행', '지휘소(KAMDOC·MCRC·IAOC·군단 AOC·미군 C2) / ICC / ECS. 포대는 별도'],
  ['명령 전달 단계', '최초 사수선정부터 최초 발사 사이에 명령이 거쳐 간 계선의 수. 지휘소 → ICC → ECS → 포대면 3단계'],
  ['병렬 책임 C2', '엔진이 그 항적에 지정한 책임 지휘소의 수. 항공 표적은 MCRC(또는 IAOC)와 군단 AOC가 동시에, 확대 배치에서는 미군 C2도 추가'],
], 'kv')}
<h3>1-3. 결심 시간 다섯 구간</h3>
${tbl(['구간', '정의', '무엇의 몫인가'], [
  ['① 보고 도달', '최초 탐지 → 사수를 고른 지휘소에 항적이 접수된 시각', '센서 보고 주기와 계선(물리·통신)'],
  ['② C2 처리', '접수 → 식별·표적할당 준비 완료', '지휘소 대기행렬 + 처리시간(절차)'],
  ['③ 교전 협조', '협조 요청 → 협조 완료(회신 처리까지). 협조가 없으면 0', '사람 채널(절차)'],
  ['④ 교전창 대기', '준비 완료(또는 협조 완료) → 사수선정', '요격점 기하가 열리길 기다림(물리)'],
  ['⑤ 전달·실행', '사수선정 → 발사. ICC 중계·인가, ECS 접수·발사 준비 포함', '명령 계선 + 중계·실행 처리(절차)'],
], 'kv')}
<p class="legend">절차 몫 = ②+③+⑤, 물리 몫 = ①+④. 효율은 절차 몫으로 읽는다. 물리 몫은 지휘구조를 바꿔도 줄지 않는다. 조건: To-Be 결심 노드의 운용자 판단 시간은 As-Is와 같은 30초(ADR-099).</p>
<h3>1-4. 효율 지표</h3>
<ul><li><b>절차 시간</b>(②+③+⑤)과 <b>노드당 절차 초</b>(절차 시간 ÷ 결심 노드 수).</li>
<li><b>재배정·반송</b>: ICC가 명령을 권역 안에서 다른 포대로 돌리거나 상급으로 되돌린 횟수. <b>발사 불가</b>: 명령은 닿았는데 못 쏜 횟수.</li>
<li><b>재선정 항적</b>: 사수선정이 두 번 이상 일어난 항적 수(명중 실패 후 재교전 포함). <b>중복 해소</b>: 통합 교전현황(COP)이 중복 교전 후보를 걸러낸 판정 횟수(To-Be 전용, 2.5초 주기 판정이라 횟수가 크게 나온다).</li></ul>

<h2 class="pb">2. 결과</h2>
<h3>2-1. 대표 항적의 결심 경로 — 같은 위협을 두 구조가 어떻게 처리했나</h3>
<p>위협 유형마다 양쪽 구조 모두에서 발사까지 간 항적 하나를 골랐다. 상자 색: <span style="color:${ECH_COLOR.sensor}">■</span> 센서 <span style="color:${ECH_COLOR.c2}">■</span> 지휘소 <span style="color:${ECH_COLOR.relay}">■</span> 중계(ICC) <span style="color:${ECH_COLOR.exec}">■</span> 실행(ECS) <span style="color:${ECH_COLOR.battery}">■</span> 포대. 화살표 위 숫자는 앞 사건과의 간격(초). 사건 사이 간격은 시간에 비례하지 않는다(교전창 대기 수백 초를 접어서 그린다).</p>
${cards}

<h3 class="pb">2-2. 개입 노드 수와 명령 전달 단계 — 기본 배치</h3>
${tbl(nodeHead, nodeRows('HANBANDO_LEGACY_NORMAL'))}
<h3>2-2b. 개입 노드 수와 명령 전달 단계 — 확대 배치</h3>
${tbl(nodeHead, nodeRows('HANBANDO_FULL_NORMAL'))}
<p class="legend">항적/발사 = 그 유형의 위협 수 / 발사까지 간 항적 수. 인지 노드는 전체 항적 중앙값, 결심 노드는 발사 항적 중앙값(괄호는 최소~최대). 지휘/중계/실행은 결심 노드의 제대별 중앙값.</p>

<h3>2-3. 결심 시간 분해 — 기본 배치 (발사 항적 중앙값, 초)</h3>
${barSvg('HANBANDO_LEGACY_NORMAL')}
${tbl(['위협', '구조', '발사 항적', '① 보고', '② 처리', '③ 협조', '④ 교전창 대기', '⑤ 전달·실행', '탐지→발사', '절차 몫'], decRows('HANBANDO_LEGACY_NORMAL'))}
<h3 class="pb">2-3b. 결심 시간 분해 — 확대 배치</h3>
${barSvg('HANBANDO_FULL_NORMAL')}
${tbl(['위협', '구조', '발사 항적', '① 보고', '② 처리', '③ 협조', '④ 교전창 대기', '⑤ 전달·실행', '탐지→발사', '절차 몫'], decRows('HANBANDO_FULL_NORMAL'))}
<p class="legend">③ 협조의 괄호는 협조가 실제로 발생한 항적 수. 중앙값이 0이어도 일부 항적은 협조를 거쳤다.</p>

<h3>2-4. 효율 지표 — 기본 배치</h3>
${tbl(effHead, effRows('HANBANDO_LEGACY_NORMAL'))}
<h3>2-4b. 효율 지표 — 확대 배치</h3>
${tbl(effHead, effRows('HANBANDO_FULL_NORMAL'))}

<h3>2-5. 읽는 법</h3>
<div class="box"><ul>
<li><b>명령 전달 단계는 하나 줄고 노드는 조금 준다.</b> To-Be는 ICC 중계를 거치지 않아 명령 전달 단계이 3 → 2로 준다. 결심 노드 수는 유형별로 같거나 1~2개 적은데(2-2 표), 통합 지휘소가 KAMDOC·MCRC를 "도메인 처리"로 병렬 참여시키고 군단 AOC도 함께 항적을 받기 때문이다. 노드 수는 "느리다"의 지표가 아니라 "누가 알고 있었나"의 지표다.</li>
<li><b>절차 몫이 구조 차이다.</b> 이 문서는 To-Be 결심 노드(IAOC)의 운용자 판단 시간을 As-Is 결심 노드와 같은 30초로 둔 상태(ADR-099, codex 정합)다. 그래서 ② 처리의 차이는 값이 아니라 대기행렬(석수 20 vs 6·10)과 체계 성분(자동화 1~2초 vs 5~10초)에서 나오고, ⑤ 전달·실행의 차이는 ICC 중계 단계 제거에서 나온다. 종전 1초 설정과의 차이는 앞 보고서 3-3의 「결심 시간 동일화 끄기」 행이 보여 준다.</li>
<li><b>탄도탄은 물리가 지배한다.</b> ④ 교전창 대기가 수백 초라 C2가 빨라져도 발사 시각은 거의 같다. 그래서 탄도탄 놓침 Δ가 작다.</li>
<li><b>병렬 책임 C2는 As-Is에서 정보 비대칭을 만든다.</b> 항공 표적을 군단 AOC는 MCRC보다 45초 늦게, 소형 무인기는 MCRC가 군단 AOC보다 20초 늦게 안다. 카드의 "항적 접수" 시각 차이가 그것이다.</li>
</ul></div>

<h2 class="pb">3. 주의할 점</h2>
<ul>
<li>대표 항적 카드는 한 발의 사례다. 유형 전체의 경향은 2-2·2-3 표(중앙값)로 읽어야 한다.</li>
<li>결심 노드 수는 마크와 메시지 기록에서 재구성한 것이라, 항적을 받기만 하고 아무 것도 하지 않은 지휘소도 인지 노드에 들어간다. 이것은 결함이 아니라 "정보가 어디까지 퍼졌나"의 정의다.</li>
<li>seed 하나(29)의 결과다. 분포는 seed 반복으로 확인해야 하며, 앞 보고서의 seed 20개 결과가 놓침 Δ의 분포를 담고 있다.</li>
<li>③ 협조는 국지방공 축의 항공 표적에서만 발생하고, 협조가 끝나기 전에 다른 지휘소가 먼저 사수를 고르면 0으로 잡힌다. 협조가 결과에 미친 영향은 앞 보고서의 "교전 협조 끄기" 실험으로 본다.</li>
<li>값의 신뢰 등급은 대부분 C(개념 추정)다. 절대 초보다 As-Is↔To-Be 차이와 구간 비율을 믿어야 한다.</li>
</ul>
<h2>4. 다음에 할 수 있는 것</h2>
<ul>
<li>같은 재구성을 seed 20개에 걸쳐 돌려 노드 수·전달 단계·절차 시간의 분포를 만든다.</li>
<li>놓친 항적에도 같은 카드를 만들어 "어느 노드에서 멈췄나"를 그린다. 마크와 실패 증거가 이미 있다.</li>
<li>지휘흐름 화면에서 항적을 고르면 이 카드와 같은 경로가 강조되므로, 화면 캡처를 카드 옆에 붙이면 지도·네트워크·시간표가 한 장에 들어간다.</li>
</ul>
</body></html>`;
fs.writeFileSync(process.argv[3], html); console.log('written', html.length);
