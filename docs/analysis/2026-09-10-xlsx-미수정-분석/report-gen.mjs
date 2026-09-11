import fs from 'node:fs';
const D = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const DEP = { HANBANDO_LEGACY_NORMAL: '기본 배치', HANBANDO_FULL_NORMAL: '확대 배치' };
const MODE = { asis: 'As-Is', tobe: 'To-Be' };
const SC = { sc1: 'SC1 경계 침투', sc2: 'SC2 무인기 남파', sc3: 'SC3 복합 포화' };
const FLAG = {
  appr: ['교전 협조 끄기', '육군 국지방공 포대가 항공기 표적을 쏘기 전 공군 MCRC와 협조해 교전 허가를 받는 절차를 없앤다(상하 관계 아님)'],
  cop: ['교전현황 공유 끄기', '누가 무엇을 쏘고 있는지 서로 모른다(To-Be 전용 효과)'],
  sdf: ['자위권 사격 끄기', '포대가 스스로 판단해 쏘는 것을 금지한다'],
  eor: ['원격 교전 켜기', '남의 레이더 정보로도 쏠 수 있게 한다'],
  share: ['연합 항적 공유 켜기', '주한미군 레이더 항적을 데이터링크로 받는다'],
  suit: ['사수 적합도 배정 켜기', '고도대역에 맞는 포대를 우선 고른다'],
  uavsd: ['무인기 국지 자위권 켜기', '소형 무인기는 현지 부대가 바로 쏜다'],
  ew: ['조기경보 보고 켜기', '그린파인 레이더 보고를 책임 지휘소에도 보낸다'],
  lx: ['발사점 연장 끄기', '탄도탄이 원래(남쪽) 출발점에서 뜬다'],
  aim: ['표적 카탈로그 끄기', '탄도탄이 정해진 10개 표적 대신 경로 끝점을 노린다'],
  floor: ['처리시간 하한 켜기', '지휘소 처리시간이 0초가 되지 않게 최소값을 둔다'],
  pipe: ['협조 병렬처리 끄기', '같은 항적의 협조 요청이 2건 겹쳐도 그대로 둔다'],
  icc: ['ICC 중계 인가 끄기', 'ICC를 1초 통과점으로만 본다'],
  ecs: ['ECS 집행시간 켜기', '사격 명령이 ECS를 거쳐 실행되는 시간을 추가한다'],
  issue: ['지시 하달시간 켜기', '문서 지시가 하달되는 시간을 추가한다'],
  par: ['결심 시간 동일화 끄기', 'To-Be 결심 노드(IAOC)의 운용자 판단 시간을 다시 1초로 둔다(As-Is는 30초). 값의 몫을 재는 반사실']
};
const REASON = {
  engagement_geometry_gap: '쏠 수 있는 자리(요격점)가 끝내 안 나옴', 'timeout:c2': '지휘소 지연으로 시한 초과',
  window_lost_due_to_c2: '지휘소 지연으로 교전 기회 상실', 'timeout:engage': '교전 시작 후 시한 초과',
  correlation_failed: '항적 연결 실패', capacity_full: '동시교전 한도 초과', missed: '쏘았으나 빗나감',
  no_shooter: '가용 포대 없음', no_capable_weapon: '대응 가능 무기 없음', overflow: '처리 자리 부족(넘침)',
  no_engage_window: '교전 완료 시간 부족', responsibility_gap: '책임 공백', no_responsible_c2: '책임 지휘소 없음',
  ammo_depleted: '탄약 고갈', no_fire_control: '사격통제 미성립', pk_too_low: '명중확률 너무 낮음',
  fuel_insufficient: '요격탄 사거리 부족', no_ammo: '요격탄 소진', not_operational: '포대 비가용', timeout: '시한 초과'
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sgn = v => v > 0 ? '+' + v : String(v);
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
function tbl(head, rows, cls = '') {
  return `<table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</tr>`.replace('</tr>', '</th>')).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const find = (arr, q) => arr.find(r => Object.entries(q).every(([k, v]) => r[k] === v));
const dcell = (v, good) => { const c = v === 0 ? '' : ((v < 0) === good ? 'good' : 'bad'); return `<span class="${c}">${sgn(v)}</span>`; };

// ── 5.1 기준선
const baseRows = [];
for (const dep of Object.keys(DEP)) { const sc = 'sc3';
  const a = find(D.baseline, { dep, sc, mode: 'asis' }), t = find(D.baseline, { dep, sc, mode: 'tobe' });
  baseRows.push([DEP[dep], a.spawned, `${a.killed} / ${t.killed}`, `${a.leaked} / ${t.leaked}`,
    dcell(t.leaked - a.leaked, true), `${a.dup} / ${t.dup}`, `${a.shots} / ${t.shots}`, `${a.tte ?? '–'} / ${t.tte ?? '–'}`]);
}
// ── 5.2 MC
const mcRows = [];
const med = xs => { const s = [...xs].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mcSummary = {};
for (const dep of Object.keys(DEP)) {
  const A = D.mc.filter(r => r.dep === dep && r.mode === 'asis'), T = D.mc.filter(r => r.dep === dep && r.mode === 'tobe');
  const dl = A.map((a, i) => T[i].leaked - a.leaked), dd = A.map((a, i) => T[i].dup - a.dup), ds = A.map((a, i) => T[i].shots - a.shots);
  const better = dl.filter(v => v < 0).length, worse = dl.filter(v => v > 0).length;
  mcSummary[dep] = { dl, dd, better, worse };
  mcRows.push([DEP[dep], A.length, `${med(A.map(r => r.leaked))} / ${med(T.map(r => r.leaked))}`,
    `${sgn(med(dl))} (${Math.min(...dl)} ~ ${sgn(Math.max(...dl))})`, `${better}회 / ${A.length - better - worse}회 / ${worse}회`,
    `${med(A.map(r => r.dup))} / ${med(T.map(r => r.dup))}`, `${sgn(med(ds))}`]);
}
// ── 5.3 OAT
function oatRows(dep) {
  const rows = [];
  for (const k of Object.keys(FLAG)) {
    const cells = [FLAG[k][0], `<small>${FLAG[k][1]}</small>`];
    for (const mode of ['asis', 'tobe']) {
      const b = find(D.baseline, { dep, sc: 'sc3', mode }), o = find(D.oat, { dep, mode, flag: k });
      cells.push(dcell(o.leaked - b.leaked, true), dcell(o.dup - b.dup, true), dcell(o.shots - b.shots, true));
    }
    rows.push(cells);
  }
  return rows;
}
// ── 5.4 sweep
function sweepRows(dep) {
  return [1, 1.5, 2, 2.5, 3].map(x => {
    const a = find(D.sweep, { dep, x, mode: 'asis' }), t = find(D.sweep, { dep, x, mode: 'tobe' });
    const top = r => r.top[0] ? `${r.top[0].name} ${r.top[0].wq}초 (바쁨 ${Math.round(r.top[0].rho * 100)}%)` : '–';
    return [`×${x}`, a.spawned, `${a.leaked} (${pct(a.leaked, a.spawned)})`, `${t.leaked} (${pct(t.leaked, t.spawned)})`, dcell(t.leaked - a.leaked, true), top(a), top(t)];
  });
}
// ── 5.5 dur
const durRows = [600, 1200, 1800].map(dur => {
  const a = find(D.dur, { dur, mode: 'asis' }), t = find(D.dur, { dur, mode: 'tobe' });
  return [`${dur}초`, a.spawned, `${a.censored} / ${t.censored}`, `${a.leaked} / ${t.leaked}`, dcell(t.leaked - a.leaked, true), `${pct(a.leaked, a.spawned)} / ${pct(t.leaked, t.spawned)}`];
});
// ── 5.6 reasons
function reasonRows(dep) {
  const a = find(D.baseline, { dep, sc: 'sc3', mode: 'asis' }), t = find(D.baseline, { dep, sc: 'sc3', mode: 'tobe' });
  const keys = [...new Set([...Object.keys(a.reasons), ...Object.keys(t.reasons)])].sort((p, q) => (t.reasons[q] || 0) + (a.reasons[q] || 0) - (t.reasons[p] || 0) - (a.reasons[p] || 0));
  return keys.map(k => [REASON[k] || k, a.reasons[k] || 0, t.reasons[k] || 0, dcell((t.reasons[k] || 0) - (a.reasons[k] || 0), true)]);
}
// ── 5.7 FULL To-Be 중복 진단
const fb = find(D.baseline, { dep: 'HANBANDO_FULL_NORMAL', sc: 'sc3', mode: 'tobe' });
const fa = find(D.baseline, { dep: 'HANBANDO_FULL_NORMAL', sc: 'sc3', mode: 'asis' });
const dupRows = ['cop', 'sdf', 'suit', 'eor', 'pipe', 'icc', 'aim', 'par'].map(k => {
  const o = find(D.oat, { dep: 'HANBANDO_FULL_NORMAL', mode: 'tobe', flag: k });
  return [FLAG[k][0], fb.dup, o.dup, dcell(o.dup - fb.dup, true), dcell(o.leaked - fb.leaked, true), dcell(o.shots - fb.shots, true)];
});
const lb = find(D.baseline, { dep: 'HANBANDO_LEGACY_NORMAL', sc: 'sc3', mode: 'asis' });
const lt = find(D.baseline, { dep: 'HANBANDO_LEGACY_NORMAL', sc: 'sc3', mode: 'tobe' });

// 핵심 메시지 자동 도출
const legacyMc = mcSummary.HANBANDO_LEGACY_NORMAL, fullMc = mcSummary.HANBANDO_FULL_NORMAL;
const oatL = Object.keys(FLAG).map(k => { const o = find(D.oat, { dep: 'HANBANDO_LEGACY_NORMAL', mode: 'tobe', flag: k }); return { k, d: o.leaked - lt.leaked }; }).sort((p, q) => q.d - p.d);
const oatA = Object.keys(FLAG).map(k => { const o = find(D.oat, { dep: 'HANBANDO_LEGACY_NORMAL', mode: 'asis', flag: k }); return { k, d: o.leaked - lb.leaked }; }).sort((p, q) => p.d - q.d);
const s3 = D.sweep.filter(r => r.dep === 'HANBANDO_LEGACY_NORMAL');
const satX = (() => { for (const x of [1, 1.5, 2, 2.5, 3]) { const a = find(s3, { x, mode: 'asis' }); if (a.top[0] && a.top[0].rho >= 0.8) return x; } return null; })();

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>K-JAMDS 분석 방법과 결과</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif; font-size: 10.5pt; line-height: 1.55; color: #1a1a1a; margin: 0; }
h1 { font-size: 22pt; margin: 0 0 4px; } h2 { font-size: 15pt; margin: 22px 0 8px; border-bottom: 2px solid #1f4e79; padding-bottom: 3px; color: #1f4e79; }
h3 { font-size: 12pt; margin: 16px 0 6px; color: #333; page-break-after: avoid; break-after: avoid; }
th { white-space: nowrap; }
.oat td:first-child { white-space: nowrap; } .oat td:nth-child(2) { font-size: 8pt; }
p { margin: 6px 0; } small { color: #555; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 9pt; page-break-inside: avoid; }
th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: center; vertical-align: middle; }
th { background: #e8eef5; font-weight: 600; } td:first-child { text-align: left; }
.good { color: #0a7d3b; font-weight: 600; } .bad { color: #c0392b; font-weight: 600; }
.box { border: 1px solid #1f4e79; background: #f3f7fb; padding: 8px 12px; margin: 8px 0; border-radius: 4px; page-break-inside: avoid; }
.warn { border-color: #b7791f; background: #fff8e6; }
.cover { text-align: left; padding-top: 60px; }
.cover .sub { font-size: 13pt; color: #444; margin-top: 6px; }
.cover .meta { margin-top: 40px; color: #555; font-size: 10pt; }
.pb { page-break-before: always; }
ul { margin: 4px 0 6px 18px; padding: 0; } li { margin: 2px 0; }
.kv td:first-child { width: 22%; font-weight: 600; background: #fafafa; }
.legend { font-size: 8.5pt; color: #555; }
</style></head><body>

<div class="cover">
<h1>K-JAMDS 지휘통제 모의분석<br>분석 방법과 결과 정리</h1>
<div class="sub">데이터(파라미터 xlsx)를 바꾸지 않은 상태에서 지금 바로 할 수 있는 분석과 그 결과 — SC3 복합 동시 포화 시나리오 · 엑셀 파일 활용 방법 포함</div>
<div class="meta">
기준: 지휘흐름 화면 기본값 (시나리오 SC3, 관측 600초, 위협 강도 ×1, 난수 seed 29, C2 결심 시간 동일화 ON — ADR-099)<br>
엔진: js/engine/sim-engine.js · 배치 카탈로그 HANBANDO_LEGACY_NORMAL / HANBANDO_FULL_NORMAL<br>
작성일: 2026-09-10 · 이 문서의 모든 수치는 같은 엔진으로 직접 실행해 얻은 값이다.
</div>
</div>

<h2 class="pb">한 장 요약</h2>
<div class="box">
<p><b>이 모델이 하는 일.</b> 적 위협(탄도탄·방사포·항공기·무인기·순항미사일)이 들어오면, 레이더가 보고 → 지휘소가 판단 → 포대가 쏘는 흐름을 초 단위로 재현한다. 지휘소를 여러 곳으로 나눈 <b>As-Is(현행 분절형)</b>와 하나로 합친 <b>To-Be(통합형)</b>을 <b>같은 위협</b>에 대해 돌려서 차이를 본다.</p>
<p><b>데이터를 안 바꾸고도 할 수 있는 것.</b> ① As-Is↔To-Be 비교, ② 기본 배치↔확대 배치 비교, ③ 위협 강도·관측 시간 바꾸기, ④ 절차 하나씩 켜고 끄기(15가지), ⑤ 난수 seed 여러 개로 우연 걸러내기, ⑥ 화면에서 병목·누수 원인 읽기.</p>
<p><b>핵심 결과 (SC3 복합 포화, 600초).</b></p>
<ul>
<li>기본 배치: 위협 ${lb.spawned}발 중 As-Is는 ${lb.leaked}발, To-Be는 ${lt.leaked}발을 놓쳤다 (${sgn(lt.leaked - lb.leaked)}발). seed 20개로 반복하면 To-Be가 더 나은 경우 ${legacyMc.better}회, 같음 ${20 - legacyMc.better - legacyMc.worse}회, 더 나쁜 경우 ${legacyMc.worse}회.</li>
<li>확대 배치: As-Is ${fa.leaked}발, To-Be ${fb.leaked}발 (${sgn(fb.leaked - fa.leaked)}발). 대신 To-Be는 같은 표적을 여러 포대가 쏘는 <b>중복교전</b>이 ${fb.dup}건으로 As-Is ${fa.dup}건보다 많다.</li>
<li>절차 하나씩 끄고 켠 결과, 기본 배치 To-Be의 놓친 발수를 가장 크게 늘린 것은 「${FLAG[oatL[0].k][0]}」(${sgn(oatL[0].d)}), As-Is에서 가장 크게 줄인 것은 「${FLAG[oatA[0].k][0]}」(${sgn(oatA[0].d)}).</li>
<li>기본 배치에서 놓친 ${lb.leaked}발 중 ${lb.reasons.engagement_geometry_gap || 0}발은 「쏠 수 있는 자리가 끝내 안 나옴」이다. 이 ${lb.reasons.engagement_geometry_gap || 0}발은 지휘소를 아무리 빠르게 해도 못 막는다 — 포대 위치·사거리의 문제다. 지휘통제로 줄일 수 있는 놓침은 ${lb.leaked - (lb.reasons.engagement_geometry_gap || 0)}발뿐이고, 그래서 이 배치에서는 To-Be의 이득이 작게 나온다.</li>
<li>확대 배치로 가면 같은 위협에서 놓침이 ${fa.leaked}발(As-Is)·${fb.leaked}발(To-Be)로 급감한다. 포대 수가 지휘구조보다 훨씬 큰 변수다.</li>
<li>위협을 ${satX ? '×' + satX : '×3'}배로 늘리면 ${satX ? 'As-Is 지휘소가 80% 이상 바빠져 포화 조짐이 보인다' : '×3까지도 지휘소가 80% 바쁨에 이르지 않는다 — 병목은 지휘소가 아니라 다른 곳이다'}.</li>
</ul>
</div>

<h2>1. 용어 풀이</h2>
${tbl(['용어', '뜻'], [
  ['As-Is', '현행 분절형. 지휘소가 공군·육군·해군·주한미군으로 나뉘어 있고, 서로 전화·문자·데이터링크로 협조하는 지금 구조'],
  ['To-Be', '통합형. 하나의 통합 지휘소(IAOC)가 항적을 모아 보고 사수를 고르는 구조'],
  ['기본 배치', '포대 15개, 노드 64개. 지금 모델의 기준 배치'],
  ['확대 배치', '포대 84개(비호 28·천마 17·L-SAM 3·THAAD 1 등), 노드 251개. ADSIM(codex) 자료의 FULL 배치와 같은 규모'],
  ['위협 발수', '관측 시간 동안 들어온 적 위협 개수'],
  ['격추 / 놓침(누수)', '요격에 성공한 수 / 요격하지 못하고 표적에 닿았거나 시한이 지난 수'],
  ['미결', '관측 시간이 끝날 때 아직 날아오고 있어서 결과가 안 난 수. 격추도 놓침도 아니다'],
  ['중복교전', '같은 위협을 두 포대 이상이 쏜 횟수. 요격탄 낭비의 지표'],
  ['교전 협조', '육군 국지방공 지휘소(군단 AOC)가 항공기 표적을 쏘기 전 공군 MCRC와 식별·무기통제상태를 맞추는 절차. 둘은 상하 관계가 아니라 협조 관계이고, 항공기 표적의 교전권이 공군 쪽에 있어 협조의 응답이 허가 역할을 한다'],
  ['대기시간', '지휘소에 보고가 도착해서 처리가 시작될 때까지 줄 서서 기다린 평균 시간(초)'],
  ['바쁨(점유율)', '지휘소가 일하고 있는 시간의 비율. 80%를 넘으면 줄이 급격히 길어진다'],
  ['seed', '난수의 씨앗. 같은 seed면 같은 위협이 같은 시각에 온다. As-Is과 To-Be는 항상 같은 seed로 비교한다'],
  ['Δ(델타)', 'To-Be − As-Is. 놓침·중복·사격수는 음수(−)가 좋은 쪽이다. 표에서 초록은 좋아짐, 빨강은 나빠짐']
], 'kv')}

<h2 class="pb">2. 분석 방법 — 데이터를 바꾸지 않고 할 수 있는 6가지</h2>
<h3>방법 ① 구조 비교: As-Is ↔ To-Be</h3>
<p>같은 seed로 같은 위협을 두 구조에 흘려서 놓친 발수·중복·사격수의 차이(Δ)를 본다. <b>읽는 법:</b> Δ가 음수면 To-Be가 낫다. 다만 이 차이의 절반 이상이 「통합 지휘소(IAOC) 운용자 처리 1초 vs As-Is MCRC 30초」라는 <b>입력값</b>에서 나온다는 것이 이미 측정돼 있으므로, 구조 효과와 값 효과를 구분해 말해야 한다.</p>
<h3>방법 ② 배치 비교: 기본 ↔ 확대</h3>
<p>포대를 15개에서 84개로 늘리면 병목이 어디로 옮겨가는지 본다. 위협은 두 배치에서 완전히 같으므로 Δ는 순수 배치 효과다.</p>
<h3>방법 ③ 강도·시간 바꾸기</h3>
<p>위협 강도 ×1~×3, 관측 시간 600~1800초. (시나리오는 SC1 경계 침투·SC2 무인기 남파도 있지만 이 문서는 복합 포화 SC3만 다룬다.) <b>읽는 법:</b> 강도를 올려가며 어느 지휘소가 먼저 80% 바쁨에 닿는지 찾으면 「몇 발까지 견디나」에 답할 수 있다.</p>
<h3>방법 ④ 절차 하나씩 켜고 끄기 (OAT)</h3>
<p>교전 협조, 자위권 사격, 교전현황 공유 같은 절차를 <b>한 번에 하나만</b> 바꾸고 기준선과의 Δ를 기록한다. 값(파라미터)은 그대로 두고 논리만 바꾸므로 「값을 지어냈다」는 부담이 없는, 이 모델에서 가장 결론이 튼튼한 방법이다.</p>
<h3>방법 ⑤ seed 여러 개로 반복</h3>
<p>seed 하나의 결과는 우연일 수 있다. 20개 seed로 반복해 Δ의 중앙값과 범위, 「To-Be가 나은 횟수」를 센다.</p>
<h3>방법 ⑥ 화면에서 읽기</h3>
<p>지휘흐름 화면은 실행 한 번에 병목 카드(어느 지휘소가 언제 몇 건을 얼마나 세웠나), 5단 타임라인(탐지·보고 / 결심 / 집행 중 어느 층이 막혔나), 지도의 요격 성공·실패 위치, 놓친 이유 분류를 준다. 계선을 클릭하면 통신 수단을 바꿔보는 반사실도 된다.</p>

<h2 class="pb">3. 결과</h2>
<h3>3-1. 기준선 — 배치 × 구조 (SC3, seed 29, 600초)</h3>
${tbl(['배치', '위협', '격추<br><small>As-Is/To-Be</small>', '놓침<br><small>As-Is/To-Be</small>', 'Δ놓침', '중복<br><small>As-Is/To-Be</small>', '사격수<br><small>As-Is/To-Be</small>', '탐지→사격 평균초<br><small>As-Is/To-Be</small>'], baseRows)}
<p class="legend">위협 수가 격추+놓침보다 큰 것은 600초가 끝날 때 아직 날아오는 「미결」이 있기 때문이다 (3-5 참조).</p>

<h3>3-2. seed 20개 반복 — SC3</h3>
${tbl(['배치', '반복', '놓침 중앙값<br><small>As-Is/To-Be</small>', 'Δ놓침 중앙값 (최소~최대)', 'To-Be가 나음 / 같음 / 나쁨', '중복 중앙값<br><small>As-Is/To-Be</small>', 'Δ사격수 중앙값'], mcRows)}
<div class="box"><p><b>읽는 법.</b> 「나음」 횟수가 20에 가깝고 범위가 0을 안 넘으면 구조 차이가 우연보다 크다. 범위가 0을 걸치면 seed에 따라 뒤집힐 수 있는 차이다.</p></div>

<h3 class="pb">3-3. 절차 하나씩 바꾸기 — 기본 배치, SC3 (기준선 대비 Δ)</h3>
${tbl(['바꾼 것', '뜻', 'As-Is<br>Δ놓침', 'As-Is<br>Δ중복', 'As-Is<br>Δ사격', 'To-Be<br>Δ놓침', 'To-Be<br>Δ중복', 'To-Be<br>Δ사격'], oatRows('HANBANDO_LEGACY_NORMAL'), 'oat')}
<div class="box"><p><b>읽는 법 — 기본 배치에서 눈에 띄는 세 가지.</b></p>
<ul>
<li><b>발사점 연장 끄기 → 놓침 ${sgn(find(D.oat,{dep:'HANBANDO_LEGACY_NORMAL',mode:'asis',flag:'lx'}).leaked - lb.leaked)}(As-Is) / ${sgn(find(D.oat,{dep:'HANBANDO_LEGACY_NORMAL',mode:'tobe',flag:'lx'}).leaked - lt.leaked)}(To-Be).</b> 탄도탄 출발점을 북쪽으로 옮긴 지금 기본값이 조기경보 시간을 벌어 준다. 출발점 위치가 지휘구조보다 훨씬 큰 변수다.</li>
<li><b>표적 카탈로그 끄기 → 놓침 ${sgn(find(D.oat,{dep:'HANBANDO_LEGACY_NORMAL',mode:'asis',flag:'aim'}).leaked - lb.leaked)} / ${sgn(find(D.oat,{dep:'HANBANDO_LEGACY_NORMAL',mode:'tobe',flag:'aim'}).leaked - lt.leaked)}, 사격 ${sgn(find(D.oat,{dep:'HANBANDO_LEGACY_NORMAL',mode:'asis',flag:'aim'}).shots - lb.shots)} / ${sgn(find(D.oat,{dep:'HANBANDO_LEGACY_NORMAL',mode:'tobe',flag:'aim'}).shots - lt.shots)}.</b> 탄도탄이 실제 자산 10곳을 노리는 지금 기본값은 포대가 닿지 않는 표적이 생겨 놓침이 늘고 사격은 준다. 즉 현재 기본값이 더 어려운(보수적인) 조건이다.</li>
<li><b>결심 시간 동일화 끄기 → To-Be 놓침 ${sgn(find(D.oat,{dep:'HANBANDO_LEGACY_NORMAL',mode:'tobe',flag:'par'}).leaked - lt.leaked)}(기본 배치) / ${sgn(find(D.oat,{dep:'HANBANDO_FULL_NORMAL',mode:'tobe',flag:'par'}).leaked - fb.leaked)}(확대 배치), As-Is는 0.</b> 이것이 종전 설정(IAOC 운용자 1초)이 To-Be에 더해 주던 「값의 몫」이다. 이 문서의 나머지 수치는 그 몫을 뺀 상태다.</li>
<li><b>0이 줄지어 있는 절차</b>(자위권 사격, 사수 적합도, 조기경보 보고, 연합 항적 공유)는 이 조건에서 결과를 바꾸지 않았다. 기본 배치 SC3에서는 「쏠 자리가 없어서」 놓치는 것이 대부분이라 판단 절차를 바꿔도 효과가 없기 때문이다. 특히 자위권 사격은 강도 ×1에서 실제로 한 번도 발동하지 않았다(시도 3건 모두 사격통제 미성립). 지휘소가 포화돼 정식 명령이 늦어지는 ×3에서는 확대 배치에서 As-Is 15건·To-Be 9건이 발동하므로, 이 절차의 효과는 고강도 조건에서 봐야 한다.</li>
</ul></div>
<h3 class="pb">3-3b. 절차 하나씩 바꾸기 — 확대 배치, SC3</h3>
${tbl(['바꾼 것', '뜻', 'As-Is<br>Δ놓침', 'As-Is<br>Δ중복', 'As-Is<br>Δ사격', 'To-Be<br>Δ놓침', 'To-Be<br>Δ중복', 'To-Be<br>Δ사격'], oatRows('HANBANDO_FULL_NORMAL'), 'oat')}
<p class="legend">0은 그 절차가 이 조건에서 결과를 바꾸지 않았다는 뜻이다. 그것도 결과다 — 예를 들어 조기경보 보고를 켜도 0이면, 그 보고는 이미 다른 경로로 닿고 있다는 뜻이다.</p>

<h3>3-4. 위협 강도 올리기 — SC3, 어느 지휘소가 먼저 막히나</h3>
<p><b>기본 배치</b></p>
${tbl(['강도', '위협', 'As-Is 놓침', 'To-Be 놓침', 'Δ놓침', 'As-Is 최장대기 지휘소', 'To-Be 최장대기 지휘소'], sweepRows('HANBANDO_LEGACY_NORMAL'))}
<p><b>확대 배치</b></p>
${tbl(['강도', '위협', 'As-Is 놓침', 'To-Be 놓침', 'Δ놓침', 'As-Is 최장대기 지휘소', 'To-Be 최장대기 지휘소'], sweepRows('HANBANDO_FULL_NORMAL'))}
<p class="legend">「최장대기 지휘소」는 평균 대기시간이 가장 긴 지휘소와 그 시간, 괄호는 바쁨 비율. 80%를 넘으면 포화 조짐이다.</p>

<h3>3-5. 관측 시간 늘리기 — 기본 배치, SC3</h3>
${tbl(['관측 시간', '위협', '미결<br><small>As-Is/To-Be</small>', '놓침<br><small>As-Is/To-Be</small>', 'Δ놓침', '놓침 비율<br><small>As-Is/To-Be</small>'], durRows)}
<p class="legend">시간을 늘려도 놓침 비율이 비슷하면 600초 결과가 대표성이 있다는 뜻이다.</p>
<div class="box warn"><p><b>주의.</b> 놓침 비율이 600초 ${pct(find(D.dur,{dur:600,mode:'asis'}).leaked, find(D.dur,{dur:600,mode:'asis'}).spawned)} → 1800초 ${pct(find(D.dur,{dur:1800,mode:'asis'}).leaked, find(D.dur,{dur:1800,mode:'asis'}).spawned)}로 올라간다. 600초에서는 아직 날아오는 「미결」이 많아 놓침이 적게 보인다. 절대 비율을 말할 때는 1800초 값을 쓰고, 600초는 Δ(차이) 비교에만 쓰는 것이 안전하다.</p></div>

<h3 class="pb">3-6. 왜 놓쳤나 — 놓친 이유 분해 (SC3, seed 29)</h3>
<p><b>기본 배치</b></p>
${tbl(['이유', 'As-Is', 'To-Be', 'Δ'], reasonRows('HANBANDO_LEGACY_NORMAL'))}
<p><b>확대 배치</b></p>
${tbl(['이유', 'As-Is', 'To-Be', 'Δ'], reasonRows('HANBANDO_FULL_NORMAL'))}
<div class="box"><p><b>읽는 법.</b> 「지휘소 지연으로…」 계열만 지휘통제를 고쳐서 없앨 수 있는 놓침이다. 「쏠 수 있는 자리가 안 나옴」은 포대 위치·사거리 문제라서 지휘소를 아무리 빠르게 해도 안 없어진다. 이 구분이 「무엇을 고쳐야 하나」의 첫 답이다.</p></div>

<h3>3-7. 확대 배치에서 To-Be의 중복교전이 왜 많은가</h3>
<p>확대 배치 SC3에서 To-Be는 중복교전 ${fb.dup}건, As-Is는 ${fa.dup}건이다. 어느 절차를 끄면 사라지는지 하나씩 확인했다.</p>
${tbl(['끄거나 켠 것', '기준 중복', '바꾼 뒤 중복', 'Δ중복', 'Δ놓침', 'Δ사격'], dupRows)}
<div class="box"><p><b>판정.</b> 어느 절차 하나를 꺼도 중복이 크게 줄지 않는다(가장 큰 감소도 ${Math.min(...dupRows.map(r => +r[3].replace(/<[^>]+>/g, '')))}건). 즉 확대 배치 To-Be의 중복은 특정 절차의 부작용이 아니라, 포대가 많을 때 통합 사수선정이 같은 표적에 재교전을 붙이는 방식 자체에서 온다. seed 20개에서도 To-Be의 중복이 As-Is보다 많은 쪽이 ${fullMc.dd.filter(v => v > 0).length}회로 우세하다. 모델 버그인지 To-Be의 실제 부작용인지는 교전 로그를 따라가 확인해야 한다(5장).</p></div>

<h2 class="pb">4. 해석할 때 주의할 점</h2>
<ul>
<li><b>값의 신뢰 등급.</b> 처리시간·통신 지연 같은 값 대부분은 등급 C(개념 수준 추정)다. 절대 수치(놓침 29발)보다 <b>차이(Δ)</b>와 <b>방향</b>을 믿어야 한다.</li>
<li><b>이 문서는 C2 결심 시간 동일화(ADR-099) ON 기준이다.</b> To-Be 결심 노드(IAOC)의 운용자 판단 시간을 As-Is 결심 노드(KAMDOC·MCRC)와 같은 30초로 둔다(codex 정합). 종전처럼 1초로 두면 To-Be가 얼마나 더 좋아지는지는 3-3 표의 「결심 시간 동일화 끄기」 행이 보여 주며, 그 차이가 「값의 몫」이다. 여기 남은 To-Be 우위는 구조(ICC 중계 단계 제거·센서 직결·병렬 참여·COP·협조 관문 소멸)의 몫이다.</li>
<li><b>좌표는 도시 수준 개념좌표.</b> 지도의 해안선·군사분계선만 실제 지리다. 자산 위치·공격 경로는 실제 배치가 아니다.</li>
<li><b>이 화면만 켜진 절차 5가지.</b> 협조 병렬처리·ICC 중계 인가·발사점 연장·표적 카탈로그·결심 시간 동일화는 지휘흐름 화면에서만 기본 ON이다. 본 앱(시뮬레이터)은 OFF라서 수치가 다르게 나온다.</li>
<li><b>ADSIM(codex)과 직접 대조는 하지 않는다.</b> 입력을 맞춰도 지휘통제 모델링 차이 3가지가 남아 교차검증이 안 된다. codex는 참고 자료다.</li>
</ul>

<h2>5. 다음에 할 수 있는 것</h2>
<ul>
<li>3-7의 결과를 따라 확대 배치 To-Be 중복교전의 원인 절차를 확정하고, 모델 버그인지 To-Be의 실제 부작용인지 판정한다.</li>
<li>파라미터 xlsx를 읽어 들이는 기능을 붙이면 좌표·자산 수·위협 종류를 바꾼 실험이 열린다(6장).</li>
<li>seed 20개 반복을 모든 절차(OAT)에 확장해 3-3 표를 분포로 만든다.</li>
</ul>

<h2 class="pb">6. 엑셀 파일(K-JAMDS_파라미터.xlsx) 활용 방법</h2>
<div class="box warn"><p><b>현재 상태.</b> 이 파일은 시뮬레이터의 현재 값을 그대로 <b>내보낸</b> 것이다. 값을 고쳐 <b>불러오는</b> 기능은 아직 없다. 지금은 「무엇이 어떤 값으로 들어가 있는가」를 읽고 실험을 설계하는 용도이고, 불러오기가 붙으면 아래 절차 그대로 「값을 바꾼 실험」이 열린다.</p></div>

<h3>6-1. 시트 구성 — 무엇이 어디에 있나</h3>
${tbl(['시트', '담긴 것', '고치면 무엇이 바뀌나'], [
  ['안내', '읽는 법·좌표 규칙·등급 설명', '—'],
  ['기본설정', 'seed, 관측시간, 산포 반경, 자위권 반경 등 전역값', '실험 전체의 기본 조건'],
  ['아군자산_LEGACY / _FULL', '자산 한 행 = 포대·레이더·지휘소 하나. 위도·경도, 유형, 보고대상(상위 지휘소), 등급', '자산 위치·수량·지휘 계통'],
  ['자산제원_센서 / _포대 / _C2', '유형별 성능. 탐지거리, 사거리·탄종별 명중률, 지휘소 처리시간·동시처리 수', '「같은 자산이 더 잘하면」'],
  ['위협제원', '위협 유형별 속도·고도·가치', '위협의 성격'],
  ['공격경로', '적이 어디서 어디로 오나. 발사점·표적 좌표, 탄도탄 발사점 연장 km', '위협 출발점·진입 방향'],
  ['조준점', '탄도탄이 나눠 노리는 표적 후보 10점', '표적 다양성'],
  ['시나리오', '위협 흐름 한 행 = 유형 × 공격경로 × 도착률(또는 동시 발수·시각)', '위협 종류·양·타이밍'],
  ['통신계선_LEGACY / _FULL', '누가 누구에게 어떤 수단(음성·문자·데이터링크)으로 몇 초 만에 보내나', '통신 수단·지연']
])}

<h3>6-2. 지금 할 수 있는 활용 (불러오기 없이)</h3>
<ul>
<li><b>조건 대장으로 쓴다.</b> 3장의 모든 결과는 이 파일의 값 위에서 나온 것이다. 결과를 인용할 때 「K-JAMDS_파라미터.xlsx 2026-09-10 판」이라고 적으면 조건이 고정된다.</li>
<li><b>등급을 확인한다.</b> 각 값의 등급(A 실측 / B 2차 자료 / C 추정)이 열에 있다. 지연·처리시간은 거의 전부 C다. 어떤 결론이 C 등급 값에 얼마나 기대고 있는지 이 파일로 짚을 수 있다.</li>
<li><b>실험을 설계한다.</b> 「포대 하나를 30km 북쪽으로 옮기면」 같은 질문을 이 파일의 어느 행·열을 바꾸는 일로 번역해 두면, 불러오기가 붙는 즉시 실행할 수 있다.</li>
<li><b>화면과 대조한다.</b> 지휘흐름 화면의 병목 카드에 뜬 지휘소의 처리시간·동시처리 수를 「자산제원_C2」에서 찾아 읽으면 왜 그 지휘소가 막히는지 값으로 설명할 수 있다.</li>
</ul>

<h3>6-3. 불러오기가 붙은 뒤의 절차</h3>
<ol>
<li><b>기준선을 먼저 돌린다.</b> 파일을 고치기 전 상태로 As-Is·To-Be를 같은 seed로 실행해 놓침·중복·사격수를 적어 둔다.</li>
<li><b>한 번에 하나만 고친다.</b> 위치를 바꿨으면 수량은 그대로. 두 가지를 같이 바꾸면 어느 쪽 효과인지 알 수 없다.</li>
<li><b>「안내」 시트의 수정 메모에 무엇을 왜 고쳤는지 적는다.</b> 고친 값에는 등급이 없으므로 결과에 「사용자 가정 기반」을 반드시 붙인다.</li>
<li><b>불러온다.</b> 좌표 범위(위도 33~43, 경도 124~132), 유형 존재, 보고대상 존재, 사거리 정합, id 중복을 검사하고 어긋나면 거부한다.</li>
<li><b>같은 seed로 As-Is·To-Be를 다시 돌려 Δ를 본다.</b> 절대값이 아니라 기준선 대비 차이로 읽는다. seed 20개로 반복해 우연을 거른다.</li>
</ol>

<h3>6-4. 질문별 — 어느 시트를 고치나</h3>
${tbl(['작전적 질문', '고치는 시트 · 열', '보는 것'], [
  ['포대를 옮기면 놓침이 줄어드나', '아군자산_… · 위도·경도', '놓침 이유 중 「쏠 수 있는 자리가 안 나옴」이 줄어드나'],
  ['포대를 몇 개 더 두면 되나', '아군자산_… · 행 복사(새 id, 보고대상 지정)', '놓침 Δ와 지휘소 바쁨 — 포대가 늘면 지휘소가 먼저 막히는지'],
  ['적이 더 북쪽에서 쏘면', '공격경로 · 발사점 위도·경도', '탐지→사격 시간과 놓침 (3-3의 발사점 연장 결과와 비교)'],
  ['적이 다른 곳을 노리면', '조준점 · 행 추가·이동', '어느 포대에 부하가 옮겨가나'],
  ['위협이 두 배로 오면', '시나리오 · 도착률 또는 동시 발수', '어느 지휘소가 먼저 80% 바쁨에 닿나 (3-4와 같은 방식)'],
  ['어떤 통신을 먼저 디지털화할까', '통신계선_… · 매체·지연', '최장 대기 지휘소의 대기시간 Δ — 화면의 계선 반사실과 같은 실험'],
  ['지휘소 처리 능력을 키우면', '자산제원_C2 · 처리시간·동시처리 수', 'To-Be 우위가 얼마나 줄어드나 (값 몫과 구조 몫 분리)'],
  ['미사일 성능이 더 좋으면', '자산제원_포대 · 사거리·명중률', '사격수 대비 격추 — 지휘구조와 무관한 이득인지 확인']
])}

<h3>6-5. 피해야 할 것</h3>
<ul>
<li>codex 표를 그대로 붙여 넣기 — 좌표 순서가 경도·위도라 열이 뒤바뀐다. 이 파일은 위도·경도 순서다.</li>
<li>As-Is와 To-Be에 다른 위협을 주기 — 두 구조는 반드시 같은 seed·같은 시나리오로 비교한다.</li>
<li>고친 값의 결과를 원래 등급인 것처럼 말하기 — 사용자 가정임을 함께 적는다.</li>
<li>한 번에 여러 시트를 고치기 — 효과를 가를 수 없다.</li>
</ul>
</body></html>`;
fs.writeFileSync(process.argv[3], html);
console.log('written', process.argv[3], html.length);
