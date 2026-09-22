// 「지휘흐름 분석결과」 — SC3 · 생성된 모든 항적의 최종 결과.
// 입력: ../2026-09-21-sc3-final/summary-results.json (168개 조건의 집계) + ./records-out.json (기준 4실행의 항적별 기록).
// 이 판의 편집 기준(사용자 결정 2026-09-21):
//   · 제목은 「지휘흐름 분석결과」. 분석 방법 3종은 결과와 분리해 뒤쪽 별도 페이지에 둔다.
//   · 모든 항적이 격추 또는 누수로 끝나므로, 종료 전 미확정 상태에 관한 열·용어·설명은 싣지 않는다.
//   · 시나리오 가정 두 가지(탄도 위협 출발점 연장, 여러 지상 목적지 배정)의 켜기/끄기 비교는 뺀다 — 위협이 어디서 와서
//     어디로 가는지를 바꾸는 조건이지 지휘 조건이 아니다. 네 값이 모두 0인 조건 행도 뺀다.
//   · 위협 생성 강도는 1배만 다룬다.
//   · 기관·부대 수, 탐지→첫 발사 시간 분해, 통신, 항적 사례, 읽을 때 알아둘 점, 선정부터 발사까지의 사건 수 장은 싣지 않는다.
//   · 2장 뒤에 조건별 설명 페이지(3장)를 둔다. 「무엇을 비교했나」 장과 분석 방법 A~C는 빼고, 맨 뒤에 xlsx 사용 방법 부록을 둔다.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = JSON.parse(fs.readFileSync(path.join(HERE, '../2026-09-21-sc3-final/summary-results.json'), 'utf8'));
const R = JSON.parse(fs.readFileSync(path.join(HERE, 'records-out.json'), 'utf8'));
const DEPS = ['HANBANDO_LEGACY_NORMAL', 'HANBANDO_FULL_NORMAL'], MODES = ['asis', 'tobe'];
const DEP = { HANBANDO_LEGACY_NORMAL: '기본 배치 (LEGACY)', HANBANDO_FULL_NORMAL: '확대 배치 (FULL)' };
const SHORT = { HANBANDO_LEGACY_NORMAL: 'LEGACY', HANBANDO_FULL_NORMAL: 'FULL' }, MOD = { asis: 'As-Is', tobe: 'To-Be' };
// 조건의 세 묶음. 분류 근거는 README.md의 「조건을 나눈 기준」.
//   C2_FLAGS     : 지휘 절차·권한·정보를 바꾸는 조건 (3장의 주 표)
//   TIME_FLAGS   : 절차가 아니라 시간 값을 바꾸는 조건 (3장의 「시간 가정에 얼마나 민감한가」 표)
//   EXCLUDED     : 시나리오 가정(lx·aim)과 모델 세부 가정(floor·pipe) — 지휘 대안이 아니어서 분석에서 제외
const EXCLUDED_FLAGS = ['lx', 'aim', 'floor', 'pipe'];
const C2_FLAGS = { appr: '지휘소 간 교전 협조 생략', cop: '교전 상황 공유 끄기', icc: '권역통제의 명령 확인 생략',
  uavsd: '무인기 교전의 상급 승인 면제', eor: '다른 센서 정보로 교전 허용', share: '연합 측 표적 정보 공유',
  sdf: '자위권 사격 끄기', suit: '무기 선택에 표적 고도 반영', ew: '조기경보 센서 보고 추가' };
const TIME_FLAGS = { ecs: '포대통제에 추가 처리시간 적용', issue: '명령을 내리는 작업 추가', par: '통합 지휘소 판단시간 변경' };
const FLAGS = { ...C2_FLAGS, ...TIME_FLAGS };
const REASONS = { engagement_geometry_gap: '후보 자산에서 요격 가능한 지점을 찾지 못함', ammo_depleted: '사용 가능한 탄약이 없음',
  'timeout:engage': '교전을 시작했지만 비행 종료 전 막지 못함', 'timeout:c2': '발사 전 시간 종료(세부 원인 미분류)',
  capacity_full: '동시에 처리할 수 있는 교전 수를 넘음', no_fire_control: '발사에 필요한 사격통제 정보가 준비되지 않음',
  window_lost_due_to_c2: '요격 가능한 시기를 놓친 것으로 분류', correlation_failed: '같은 표적인지 연결하는 데 실패함',
  missed: '발사했으나 명중하지 못함' };
const TYPES = ['srbm', 'mrl_large', 'fighter', 'cruise', 'uav_small'];
const TYPE = { srbm: '단거리 탄도탄', mrl_large: '대구경 방사포', fighter: '전투기', cruise: '순항미사일', uav_small: '소형 무인기' };

const esc = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const num = (v, d = 1) => Number(v).toFixed(d);
const sign = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '+') + Math.abs(Number(v)).toFixed(d);
const delta = v => v === 0 ? '<span class="nil">–</span>' : sign(v);
const pct = v => num(v * 100, 1) + '%';
const ci = (s, k = 1, d = 1) => `${sign(s.mean * k, d)} [${sign(s.lo * k, d)}, ${sign(s.hi * k, d)}]`;
const money = v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const base = (dep, mode) => { const r = S.baseline.find(b => b.dep === dep && b.mode === mode); assert.ok(r); return r; };
const oat = (dep, mode, flag) => { const r = S.oat.find(b => b.dep === dep && b.mode === mode && b.flag === flag); assert.ok(r, `${dep} ${mode} ${flag}`); return r; };
const rec = (dep, mode) => R.runs[`${dep}|${mode}`];
const table = (head, rows, cls = '', widths = []) => `<table class="${cls}">${widths.length ? '<colgroup>' + widths.map(w => `<col style="width:${w}%">`).join('') + '</colgroup>' : ''}<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr${r.cls ? ` class="${r.cls}"` : ''}>${(r.cells || r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

// ── 검산: 이 판이 전제하는 사실을 입력에서 직접 확인한다 ──
for (const section of ['baseline', 'oat', 'mc']) for (const r of S[section]) {
  assert.equal(r.censored, 0, `${section}: every track must end as killed or leaked`);
  assert.equal(r.spawned, r.killed + r.leaked, `${section}: spawned = killed + leaked`);
  assert.equal(Object.values(r.reasons).reduce((a, b) => a + b, 0), r.leaked, `${section}: leak reasons sum`);
}
for (const dep of DEPS) for (const mode of MODES) {
  const b = base(dep, mode), t = rec(dep, mode).threats;
  assert.deepEqual([t.length, t.filter(x => x.outcome === 'killed').length, t.reduce((n, x) => n + x.launches, 0), t.filter(x => x.launches).length],
    [b.spawned, b.killed, b.shots, b.decN], `${dep} ${mode}: track records differ from the summary`);
  assert.equal(t.filter(x => x.outcome !== 'killed' && !String(x.outcome).startsWith('leaked')).length, 0);
}
const usedFlags = Object.keys(FLAGS);
assert.deepEqual([...new Set(S.oat.map(r => r.flag))].sort(), [...usedFlags, ...EXCLUDED_FLAGS].sort(), 'unexpected condition set');

// ── 조건 하나씩: 네 값이 모두 0인 행은 뺀다 ──
function oatRows(dep, group) {
  const kept = [], dropped = [];
  for (const flag of Object.keys(group)) {
    const a = oat(dep, 'asis', flag), t = oat(dep, 'tobe', flag), ab = base(dep, 'asis'), tb = base(dep, 'tobe');
    const d = [a.leaked - ab.leaked, t.leaked - tb.leaked, a.shots - ab.shots, t.shots - tb.shots];
    if (d.every(x => x === 0)) dropped.push(group[flag]); else kept.push([group[flag], ...d.map(delta)]);
  }
  return { kept, dropped };
}
const mcMean = (dep, mode) => { const xs = S.mc.filter(r => r.dep === dep && r.mode === mode); assert.equal(xs.length, 20); return xs.reduce((s, r) => s + r.leakRateSpawn, 0) / xs.length; };
const four = DEPS.flatMap(dep => MODES.map(mode => ({ dep, mode, b: base(dep, mode), r: rec(dep, mode) })));
const conditionCount = usedFlags.length;

const pages = [];
const head = (part, n, title) => `<div class="eyebrow"><b>${part}${n ? ' ' + n : ''}</b> · SC3 · 모든 항적의 최종 결과</div><h2>${title}</h2>`;

// 표지
pages.push(`<div class="eyebrow">SC3 전용 분석 · 생성된 모든 항적의 결과 확인</div>
<h1>지휘흐름<br>분석결과</h1>
<p class="subtitle">As-Is와 To-Be 비교 · 기본 배치와 확대 배치</p>
<p>생성된 모든 항적이 격추되거나, 끝내 막지 못한 것으로 확정될 때까지 진행했습니다.</p>
${table(['배치·구조', '생성', '격추', '막지 못함', '막지 못한 비율'], four.map(({ dep, mode, b }) => [`${SHORT[dep]} ${MOD[mode]}`, b.spawned, b.killed, b.leaked, pct(b.leakRateSpawn)]), 'plain', [32, 17, 17, 17, 17])}
<div class="bars">${four.map(({ dep, mode, b }) => `<div class="bar"><span class="lab">${SHORT[dep]} · ${MOD[mode]}</span><span class="track"><i class="k" style="width:${(100 * b.killed / b.spawned).toFixed(2)}%"></i><i class="l" style="width:${(100 * b.leaked / b.spawned).toFixed(2)}%"></i></span><span class="val">${pct(b.leakRateSpawn)}</span></div>`).join('')}
<div class="legend"><span><i class="k"></i>격추</span><span><i class="l"></i>막지 못함</span><span class="right">오른쪽 숫자: 막지 못한 비율</span></div></div>
${DEPS.map(dep => { const a = base(dep, 'asis'), t = base(dep, 'tobe'); return `<p><b>${DEP[dep]}</b>: To-Be에서 막지 못한 항적은 As-Is보다 ${a.leaked - t.leaked}개 적습니다. 격추 수 차이는 ${sign(t.killed - a.killed)}개입니다.</p>`; }).join('')}
<p class="note">지상 방공 지휘통제의 개념 모델에서 나온 결과입니다. 실제 작전 성능이나 피해를 측정한 자료는 아닙니다.</p>`);

// 2
pages.push(`${head('결과', '01', '1. 여러 번 반복하면 결과가 어떤가')}
<p>같은 난수 시작값의 To-Be 결과에서 As-Is 결과를 뺀 차이입니다. 각 배치에서 20쌍을 비교했습니다.</p>
${table(['배치', '막지 못한 항적 수 차이<br>평균 [95% 신뢰구간]', '막지 못한 비율 차이<br>%p [95% 신뢰구간]', '막지 못한 항적<br>감소 / 같음 / 증가'], DEPS.map(dep => { const p = S.paired[dep]; return [DEP[dep], ci(p.leaked), ci(p.leakRateSpawn, 100), `${p.direction.lowerLeak} / ${p.direction.tie} / ${p.direction.higherLeak}`]; }), 'plain', [26, 26, 26, 22])}
<h3>표 읽는 법</h3>
<p>음수이면 To-Be에서 막지 못한 항적이 줄었다는 뜻입니다. %p는 두 비율을 뺀 차이입니다. 대괄호는 20쌍의 반복 실행으로 계산한 평균 차이의 95% 신뢰구간입니다. 이 범위는 모델 안에서 난수 시작값이 달라질 때의 불확실성을 나타냅니다.</p>
${table(['배치', '격추 수 차이<br>평균 [95% 신뢰구간]', '발사 수 차이<br>평균 [95% 신뢰구간]', '중복 사건 차이<br>평균 [95% 신뢰구간]'], DEPS.map(dep => { const p = S.paired[dep]; return [DEP[dep], ci(p.killed), ci(p.shots), ci(p.dup)]; }), 'plain', [26, 25, 25, 24])}
${DEPS.map(dep => `<p>${DEP[dep]}의 실행별 막지 못한 비율 평균은 As-Is ${pct(mcMean(dep, 'asis'))}, To-Be ${pct(mcMean(dep, 'tobe'))}입니다. 각 시작값의 두 실행을 먼저 비교한 뒤 평균을 냈습니다.</p>`).join('')}
<div class="box"><b>한 번의 실행과 반복 결과를 구분합니다</b><p>기준 시작값 29의 결과는 한 번의 사례입니다. 여러 번의 결과를 대표한다고 가정하지 않습니다. 여러 지표를 함께 살펴본 탐색 결과이며, 현실의 효과에 대한 신뢰구간은 아닙니다.</p></div>`);

// 3 (배치별 한 쪽) — 지휘 조건과 시간 가정을 다른 표로 나눈다
const DIFF_HEAD = ['바꾼 조건', 'As-Is<br>막지 못함 차이', 'To-Be<br>막지 못함 차이', 'As-Is<br>발사 차이', 'To-Be<br>발사 차이'];
for (const [i, dep] of DEPS.entries()) { const c2 = oatRows(dep, C2_FLAGS), tm = oatRows(dep, TIME_FLAGS);
  pages.push(`${head('결과', i ? '' : '02', '2. 조건 하나를 바꾸면 어떤가')}
<h3>${DEP[dep]} · 난수 시작값 29 · 위협 생성 강도 1배</h3>
<p class="note">각 행은 기준 조건에서 한 가지 설정만 바꿨습니다. 아래 수치는 변경한 실행에서 같은 구조의 기준 실행을 뺀 차이입니다. –는 차이가 없었다는 뜻입니다.</p>
<h3>지휘 절차·권한·정보를 바꾸는 조건</h3>
${table(DIFF_HEAD, c2.kept, 'plain', [40, 15, 15, 15, 15])}
<p class="note">${c2.dropped.length ? `막지 못한 항적 수와 발사 수가 하나도 달라지지 않아 표에서 뺀 조건: ${c2.dropped.map(esc).join(', ')}. ` : ''}각 조건이 무엇을 바꾸는지는 3장에 적었습니다.</p>
<h3>시간 가정에 얼마나 민감한가</h3>
${table(DIFF_HEAD, tm.kept, 'plain', [40, 15, 15, 15, 15])}
<p class="note">${tm.dropped.length ? `차이가 없어 뺀 조건: ${tm.dropped.map(esc).join(', ')}. ` : ''}절차가 아니라 시간 값을 바꾸는 조건입니다. 뜻은 3장에 적었습니다.</p>
<div class="box"><b>차이의 해석</b><p>막지 못함 차이가 음수이면 이 실행에서 막지 못한 항적이 줄었다는 뜻입니다. 같은 시작값끼리 비교한 구조 간 차이도 시작값에 따라 5~6개쯤 흔들리므로(1장의 20쌍), 한 번의 실행에서 그보다 작은 차이는 효과로 단정하지 않습니다. 설정 간 상호작용과 실행 경로 차이가 포함됩니다.</p></div>`); }

// 4 — 3장의 조건 하나하나가 엔진에서 무엇을 바꾸는지. 수치는 3장 표의 「막지 못함 차이」(As-Is/To-Be · LEGACY, FULL).
const cond = (dep, mode, flag) => { const a = oat(dep, mode, flag), b = base(dep, mode); return a.leaked - b.leaked; };
const cv = flag => DEPS.map(dep => `${SHORT[dep]} ${MODES.map(m => { const v = cond(dep, m, flag); return v === 0 ? '–' : sign(v); }).join('/')}`).join(', ');
const item = (flag, change, text) => `<div class="cond"><b>${esc(FLAGS[flag])}</b> <span class="chg">${esc(change)}</span><p>${text}</p><p class="val">막지 못함 차이 As-Is/To-Be · ${cv(flag)}</p></div>`;
pages.push(`${head('결과', '03', '3. 바꾼 조건은 각각 무엇인가')}
<p class="note">2장 표의 조건이 모델에서 실제로 무엇을 바꾸는지입니다. 각 항목 끝의 수치는 2장의 「막지 못함 차이」이며, –는 차이가 없었다는 뜻입니다.</p>
<h3>지휘 절차·권한·정보를 바꾸는 조건</h3>
${item('appr', '기본 켜짐 → 끔', 'As-Is에서 육군 국지방공(군단 AOC)이 교전하려면 공군 MCRC와 음성·VTC로 협조하고 승인 처리를 거칩니다. 이 조건은 그 협조 단계를 통째로 없애 국지방공이 바로 쏘게 합니다. As-Is에만 있는 절차라 To-Be는 거의 움직이지 않습니다. 협조 병목이 얼마나 막고 있었는지를 보는 조건입니다.')}
${item('cop', '기본 켜짐 → 끔', 'To-Be의 통합 지휘소(IAOC)가 국지방공의 교전 현황을 받아, 이미 교전 중인 표적에는 새로 명령하지 않는 기능입니다. 끄면 IAOC가 그 정보를 받고도 쓰지 않아 같은 표적을 두 계통이 각각 쏩니다. To-Be 전용이라 As-Is는 불변입니다. 통합 상황도의 가치를 보는 조건입니다.')}
${item('icc', '기본 켜짐 → 끔', '켜져 있으면 교전명령이 ICC를 거칠 때 ICC 대기열에서 처리된 뒤에야 내려갑니다. 그 사이 대상 포대가 못 쏘게 됐으면 같은 권역의 다른 포대로 재배정하거나 반송합니다. 끄면 ICC를 그냥 통과합니다. As-Is는 명령이 ICC를 거치므로 효과가 나고, To-Be는 거치지 않아 불변입니다.')}
${item('uavsd', '기본 꺼짐 → 켬', '현재 데이터에서는 육군 레이더가 잡고 육군 천마·비호가 쏘는 소형 무인기도 공군 MCRC의 승인을 기다립니다. 이 조건은 국지방공 축에서만 그 승인을 면제합니다. 교전 현황 공유는 그대로여서, 승인 없이 쏜 뒤 알리는 방식입니다. 자위권과는 다른 설정입니다.')}
${item('eor', '기본 꺼짐 → 켬', '기본은 포대가 자기 다기능 레이더로 사격통제급 추적을 해야만 쏠 수 있습니다. 켜면 To-Be 킬웹 안의 다른 포대 레이더가 사격통제급으로 보고 있으면 자기 레이더가 못 봐도 쏩니다. 탐지 전용 레이더의 정보로는 쏘지 못합니다. To-Be 전용이며, 배치에 따라 방향이 갈립니다.')}
${item('share', '없음 → 데이터링크', '미군과 한국군 사이에 항적 정보만 데이터링크로 오가게 하는 반사실입니다. 지휘·승인·교전 현황은 여전히 분리됩니다. 상황인식만 공유되면 얼마나 달라지는지를 보는 조건입니다.')}
${item('sdf', '기본 켜짐 → 끔', '자위권은 명령이 전혀 없어도 자기 레이더로 본 탄도 위협이 자기 근처에 떨어질 것으로 예측되면 마지막 발사 시점에 쏘는 권리입니다. 탐지·보고·식별이 늦어 명령이 오지 못한 경우를 구제하는 경로이며 양 구조에 공통입니다. 끄면 그 구제가 사라집니다.')}
`);
pages.push(`${head('결과', '', '3. 바꾼 조건은 각각 무엇인가')}
<h3>시간 가정에 얼마나 민감한가</h3>
<p class="note">절차가 아니라 시간 값을 바꾸는 조건입니다. 각 항목 끝의 수치는 2장의 「막지 못함 차이」입니다.</p>
${item('ecs', '기본 꺼짐 → 켬', 'ECS가 교전명령을 실행하는 시간을 이 모델의 3.5초에서 다른 시뮬레이터(ADSIM)가 쓰는 10초로 바꿉니다. 양 구조에 같은 크기로 더해지므로 구조 차이보다는 절대 시간이 늘어, 요격 시기를 놓치는 항적이 늘어납니다.')}
${item('issue', '기본 꺼짐 → 켬', '결심한 지휘소가 명령을 낼 때마다 자기 처리 대기열을 한 번 더 거치게 합니다. 첫 발령이든 반송 뒤 재발령이든 같습니다. 기본은 명령 발령을 시간이 들지 않는 일로 봅니다. 결심 지휘소가 바쁠수록 영향이 큽니다.')}
${item('par', '기본 켜짐 → 끔', '기본 조건에서는 To-Be 통합 지휘소의 운용자 판단시간을 As-Is 결심 지휘소와 같은 30초로 맞춰 둡니다. 구조가 달라져도 사람의 판단 시간은 같아야 한다는 결정입니다. 이 조건은 그 판단시간을 원래 값인 1초로 되돌립니다. To-Be 우위가 구조에서 오는지 판단시간 값에서 오는지를 가르는 조건입니다.')}
<div class="box"><b>읽을 때</b><p>지휘 조건 대부분은 As-Is 또는 To-Be 한쪽에만 효과가 나타납니다. 그 구조에만 있는 절차를 건드리기 때문입니다. 배치에 따라 방향이 갈리는 조건은 여러 시작값으로 반복해야 확정할 수 있습니다.</p></div>`);

// 5
pages.push(`${head('결과', '04', '4. 지휘소의 작업 대기는 어느 정도였나')}
<p>위협 생성 강도 1배 · 난수 시작값 29의 기준 실행입니다. 각 실행에서 평균 대기가 가장 길었던 지휘소를 적었습니다.</p>
${table(['배치·구조', '생성', '막지 못함', '평균 대기가 가장 긴 지휘소', '평균 대기'], four.map(({ dep, mode, b }) => [`${SHORT[dep]} ${MOD[mode]}`, b.spawned, b.leaked, esc(b.top[0].name), `${num(b.top[0].wq)}초`]), 'plain', [24, 14, 14, 30, 18])}
<p class="note">대기는 해당 기관에 들어온 작업이 처리를 시작하기 전 기다린 시간입니다. 기관마다 맡는 작업이 달라, 평균 대기가 같아도 역할까지 같다는 뜻은 아닙니다. 지휘소 이름은 시뮬레이터의 명칭을 그대로 썼습니다.</p>
<div class="box"><b>평균 이용률을 주된 결론으로 쓰지 않았습니다</b><p>모든 항적을 끝까지 추적하면 뒤쪽에 작업이 적은 시간이 포함됩니다. 이 때문에 기간 전체의 평균 이용률이 낮아질 수 있습니다. 여기서는 생성량·막지 못한 항적 수·작업 대기를 함께 제시합니다. 시작값 29의 한 사례입니다.</p></div>`);

// 6
const reasonTable = dep => { const a = base(dep, 'asis'), t = base(dep, 'tobe');
  const codes = [...new Set([...Object.keys(a.reasons), ...Object.keys(t.reasons)])].filter(c => (a.reasons[c] || 0) + (t.reasons[c] || 0) > 0)
    .sort((x, y) => (a.reasons[y] || 0) + (t.reasons[y] || 0) - (a.reasons[x] || 0) - (t.reasons[x] || 0));
  for (const c of codes) assert.ok(REASONS[c], `unlabelled leak reason ${c}`);
  return table(['모델이 정한 주된 이유', 'As-Is', 'To-Be', '차이'], [...codes.map(c => [esc(REASONS[c]), a.reasons[c] || 0, t.reasons[c] || 0, delta((t.reasons[c] || 0) - (a.reasons[c] || 0))]),
    { cls: 'total', cells: ['합계', a.leaked, t.leaked, delta(t.leaked - a.leaked)] }], 'plain', [58, 14, 14, 14]); };
pages.push(`${head('결과', '05', '5. 막지 못한 항적은 어떤 이유로 분류됐나')}
<p class="note">기준 실행에서 끝내 막지 못한 항적입니다. 그 항적마다 하나씩 붙인 주원인의 수이며, 후보 검토 사유의 발생 횟수가 아닙니다.</p>
${DEPS.map(dep => `<h3>${DEP[dep]}</h3>${reasonTable(dep)}`).join('')}
<div class="box"><b>막지 못했다는 것이 실제 피해 확정은 아닙니다</b><p>막지 못한 항적은 모델의 비행 종료까지 격추되지 않았다는 결과입니다. 지상 표적 명중, 피해 규모, 현실의 방어 실패 확률을 별도로 계산한 것은 아닙니다. 탄약 부족이나 발사불가가 한 번 기록돼도 다른 시도에서 격추될 수 있습니다.</p></div>`);

// 7
const typeTable = dep => table(['위협 종류', '생성', '격추<br>As-Is / To-Be', '막지 못함<br>As-Is / To-Be', '막지 못함 차이<br>To-Be − As-Is'], TYPES.map(type => {
  const [a, t] = MODES.map(m => rec(dep, m).threats.filter(x => x.type === type)); assert.equal(a.length, t.length);
  const k = xs => xs.filter(x => x.outcome === 'killed').length, l = xs => xs.length - k(xs);
  return [TYPE[type], a.length, `${k(a)} / ${k(t)}`, `${l(a)} / ${l(t)}`, delta(l(t) - l(a))]; }), 'plain', [28, 14, 20, 20, 18]);
pages.push(`${head('결과', '06', '6. 위협 종류별 결과')}
<p>각 유형의 모든 항적을 끝까지 확인한 결과입니다. 셀 안 숫자는 As-Is / To-Be 순서입니다.</p>
${DEPS.map(dep => `<h3>${DEP[dep]}</h3>${typeTable(dep)}`).join('')}
<div class="box"><b>유형별 결과도 같은 분모로 비교합니다</b><p>같은 배치·같은 시작값에서는 두 구조에 생성된 항적이 같습니다. 따라서 위 표의 차이는 다른 수의 위협을 비교해서 생긴 차이가 아닙니다. 각 유형의 생성 수는 격추 수와 막지 못한 항적 수를 더한 값과 일치합니다.</p></div>`);

// 부록 — K-JAMDS_파라미터.xlsx 사용 방법
pages.push(`${head('부록', '', '부록. 파라미터 파일(K-JAMDS_파라미터.xlsx) 사용 방법')}
<p>이 보고서의 모델에 들어 있는 자산·제원·위협·경로·시나리오·통신 값을 엑셀 13장으로 내보낸 파일입니다. <b>읽고 확인하는 용도</b>이며, 엑셀에서 값을 고쳐도 시뮬레이터에는 반영되지 않습니다. 값을 바꾸려면 소스 코드의 카탈로그를 고치고 파일을 다시 내보내야 합니다.</p>
<h3>시트 구성</h3>
${table(['시트', '무엇이 들어 있나', '이렇게 씁니다'], [
['안내', '좌표 순서, 시트별 주의점, 내보낸 소스 버전', '가장 먼저 읽습니다. 「기본설정」과 함께 이 파일이 어느 코드 버전의 값인지 확인합니다.'],
['기본설정', '배치 목록, 노드 수, 화면 기본값, 조건(플래그)별 적용값과 뜻', '보고서의 기준 조건이 어떤 설정인지 확인할 때. 2장 표의 조건 이름이 어느 플래그인지 여기서 찾습니다.'],
['아군자산_LEGACY · _FULL', '배치별 자산 하나하나의 종류·소속·제대·좌표·보고 대상·탐지거리·사거리·교전 채널·Pk', '특정 부대가 어디에 있고 누구에게 보고하는지, 몇 발을 동시에 다룰 수 있는지 볼 때. 좌표는 위도, 경도 순서의 도시 수준 개념값입니다.'],
['자산제원_센서 · _포대 · _C2', '유형별 원시 값 — 센서의 탐지·추적·사통 거리와 전환 시간, 포대의 요격탄·사거리·고도·Pk·발사 간격, 지휘소의 결심석·체계 처리시간·운용자 판단시간', '한 유형의 값이 어디서 왔는지(등급·출처 열) 볼 때. C 등급은 개념 추정값입니다.'],
['위협제원', '위협 5종의 속도·고도·체공 시간·단가·교전권을 가진 지휘소·자동화 수준', '위협별로 As-Is와 To-Be에서 누가 교전을 결정하는지 볼 때.'],
['공격경로 · 조준점', '진입 경로의 발사점·표적 좌표와 거리, 탄도탄 출발점 연장량, 개념 표적 후보 10곳', '위협이 어디서 어디로 가는지 볼 때. 시나리오 가정이며 실제 침투 경로가 아닙니다.'],
['시나리오', 'SC1~SC3의 위협 유형·경로·분당 도착률·동시 발생 수', 'SC3에 어떤 위협이 얼마나 들어오는지 볼 때.'],
['통신계선_LEGACY · _FULL', '노드 간 연결마다 As-Is·To-Be의 매체·지연·분포·채널 수·현황 유효기간', '두 구조의 차이가 통신에서 어떻게 나는지 볼 때. 같은 연결의 As-Is 열과 To-Be 열을 나란히 비교합니다.']
], 'plain kv', [20, 40, 40])}
<h3>읽을 때 주의할 점</h3>
<ul><li><b>보고서 수치와 연결하기:</b> 2장의 조건 이름은 「기본설정」 시트의 플래그 설명과 짝이 됩니다. 3장의 설명에서 언급한 3.5초·10초·30초 같은 값은 「자산제원_C2」와 「기본설정」에서 찾을 수 있습니다.</li>
<li><b>화면 기본값과 엔진 기본값이 다른 항목이 있습니다.</b> 「기본설정」에 두 값이 모두 적혀 있습니다. 이 보고서는 지휘흐름 화면의 기본값을 따릅니다.</li>
<li><b>빈 칸</b>은 해당 속성의 값이 없거나 해당 없음이라는 뜻입니다.</li>
<li><b>등급·출처 열</b>은 값의 근거 수준입니다. 실제 절차의 검증값이 아니라 정책연구용 개념값이며, 사용자가 고친 값은 코드 원본과 구분해 두어야 합니다.</li>
<li><b>다시 내보내면</b> 카탈로그 값은 모두 현재 소스 기준으로 바뀌고, 작성자 메모·서식·수식은 보존됩니다.</li></ul>
<div class="box"><b>이 파일이 하지 않는 것</b><p>구조 효과의 평균이나 통계적 유의성을 제공하지 않습니다. 그 값은 이 보고서의 1장에 있습니다. 항적별 기록도 들어 있지 않으며, 그 기록은 보고서 소스 폴더의 항적 기록 파일에 있습니다.</p></div>`);

const STYLE = `
@page { size:A4; margin:16mm 15mm; }
* { box-sizing:border-box; }
body { margin:0; color:#1c2b3a; font-family:"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif; font-size:10pt; line-height:1.55; }
.page { width:180mm; height:265mm; position:relative; padding-bottom:11mm; break-after:page; }
.page:last-child { break-after:auto; }
.eyebrow { font-size:8.6pt; color:#1f7a72; letter-spacing:.3px; margin:0 0 12px; } .eyebrow b { font-weight:700; }
h1 { font-size:30pt; line-height:1.22; margin:22px 0 18px; color:#16324f; }
h2 { font-size:18pt; line-height:1.3; color:#16324f; margin:0 0 14px; padding-bottom:9px; border-bottom:2px solid #1f7a72; }
h3 { font-size:11.4pt; color:#16324f; margin:17px 0 6px; break-after:avoid; }
p { margin:7px 0; } ul { margin:6px 0; padding-left:18px; } li { margin:4px 0; }
.subtitle { font-size:12.5pt; font-weight:700; color:#16324f; margin:0 0 6px; }
.note { font-size:8.7pt; color:#566575; line-height:1.5; }
.box { background:#edf3f6; border-left:3px solid #1f7a72; padding:10px 13px; margin:14px 0 8px; font-size:8.9pt; color:#44525f; } .box b { color:#16324f; font-size:9.4pt; } .box p { margin:4px 0 0; }
table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9pt; line-height:1.4; margin:9px 0 12px; break-inside:avoid; }
th { background:#eaf1f5; color:#16324f; font-weight:700; text-align:left; padding:7px 9px; vertical-align:middle; }
td { padding:7px 9px; border-bottom:1px solid #d3dde5; vertical-align:middle; overflow-wrap:anywhere; }
tbody tr:nth-child(even) td { background:#f8fafb; }
.kv td:first-child { font-weight:700; color:#16324f; }
tr.total td { font-weight:700; border-top:1.5px solid #16324f; background:#fff !important; }
.nil { color:#7d8a96; }
.cond { margin:0 0 9px; padding:0 0 8px; border-bottom:1px solid #dfe6ec; } .cond > b { color:#16324f; font-size:10pt; } .cond .chg { font-size:8.4pt; color:#1f7a72; margin-left:6px; } .cond p { margin:3px 0 0; font-size:9.3pt; line-height:1.5; } .cond .val { font-size:8.4pt; color:#566575; }
.bars { margin:14px 0 10px; } .bar { display:flex; align-items:center; gap:10px; margin:7px 0; font-size:8.8pt; }
.bar .lab { width:27%; } .bar .track { flex:1; display:flex; height:17px; } .bar .val { width:9%; text-align:right; }
.k { background:#237f70; display:block; } .l { background:#b96a28; display:block; }
.legend { display:flex; gap:18px; font-size:8.2pt; color:#566575; margin:9px 0 0 calc(27% + 10px); } .legend i { display:inline-block; width:9px; height:9px; margin-right:5px; vertical-align:-1px; } .legend .right { margin-left:auto; }
.footer { position:absolute; bottom:0; left:0; right:0; border-top:1px solid #cfd8e0; padding-top:5px; font-size:8pt; color:#66737f; display:flex; justify-content:space-between; }
`;
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>지휘흐름 분석결과</title><style>${STYLE}</style></head><body>${pages.map((p, i) => `<section class="page">${p}<footer class="footer"><span>지휘흐름 분석결과 | 2026-09-21</span><span>${i + 1} / ${pages.length}</span></footer></section>`).join('')}</body></html>`;
fs.writeFileSync(path.join(HERE, 'report.html'), html);
console.log('written report.html · pages', pages.length);
