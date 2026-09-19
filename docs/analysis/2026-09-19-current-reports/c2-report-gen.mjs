import fs from 'node:fs';
import path from 'node:path';
import { HERE, DEPLOYMENTS, stats } from './report-common.mjs';
import { pagesHTML, table, escapeHTML as esc } from './report-style.mjs';

const data = JSON.parse(fs.readFileSync(path.join(HERE, 'c2-analysis-out.json'), 'utf8'));
const types = ['srbm', 'mrl_large', 'fighter', 'cruise', 'uav_small'];
const typeName = { srbm: '단거리 탄도탄', mrl_large: '대구경 방사포', fighter: '전투기', cruise: '순항미사일', uav_small: '소형 무인기' };
const keys = ['report', 'process', 'coord', 'wait', 'deliver'];
const segName = { report: '보고', process: '항적 처리', coord: '협조·회신', wait: '잔여 대기', deliver: '결심→발사' };
const colors = ['#6297c5', '#355e8e', '#9270b1', '#c99544', '#4b9488'];
const f = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '미측정';
const med = xs => stats(xs).median;
const depName = dep => dep.includes('LEGACY') ? 'LEGACY' : 'FULL';
const modeName = mode => mode === 'asis' ? 'As-Is' : 'To-Be';
const run = (dep, mode) => data.runs[`${dep}|${mode}`];
const runs = Object.values(data.runs);
const missingTiming = runs.reduce((n, r) => n + r.summary.launched - r.summary.timed, 0);
const invalidEndpoints = runs.reduce((n, r) => n + r.comm.invalidEndpoints, 0);
const truncatedRuns = runs.filter(r => r.coverage.traceTruncated || r.coverage.flowTruncated || r.coverage.c2EventsTruncated).length;
const label = (r, id) => id ? r.nodeCatalog[id]?.name || id : '항적';
const head = (n, title) => `<div class="eyebrow">COMMAND & CONTROL ANALYSIS · ${n}</div><h2>${title}</h2>`;
const pct = (n, d) => d ? `${f(100 * n / d)}%` : '미측정';
const outcomes = t => t.outcome === 'killed' ? '격추' : String(t.outcome).startsWith('leaked') ? '누수' : '진행중';
const groupCount = (xs, key) => { const m = new Map(); for (const x of xs) m.set(key(x), (m.get(key(x)) || 0) + 1); return m; };
const pages = [];

pages.push(`<div class="eyebrow">K-JAMDS · CURRENT ENGINE / 2026-09-19</div>
<h1>C2 지휘 흐름<br>분석 결과</h1><p class="subtitle">실제 관측 통신 · 명령 계보 · 같은 지휘 분기의 시간 분해</p>
<div class="box"><b>단일 실행을 정확히 읽기 위한 보고서</b><p>SC3 · seed 29 · 강도 ×1 · 600초를 네 구성에서 다시 실행했다. 현재 지휘 흐름 화면의 기본 파라미터와 기능 함수를 직접 실행해 설정을 가져왔다. 개념 모델의 실행 결과이며 실제 부대의 성능 검증은 아니다.</p></div>
${table(['배치 / 모드', '생성', '격추', '누수', '진행중', '실제 발사 항적', '시간 분해'], runs.map(r => [`${depName(r.dep)} ${modeName(r.mode)}`, r.global.spawned, r.global.killed, r.global.leaked, r.global.censoredRaw, r.summary.launched, `${r.summary.timed}/${r.summary.launched}`]))}
<p class="note">생성 = 격추 + 누수 + 진행중(censoredRaw). ‘실제 발사 항적’은 1회 이상 발사한 고유 항적 수이며 발사 횟수와 다르다. 시간 분해의 분모는 실제 발사 항적이다.</p>
<h3>이번 결과에서 확인한 점</h3><ul>
<li>${DEPLOYMENTS.map(dep => `${depName(dep)}의 격추 수는 ${run(dep, 'asis').global.killed}→${run(dep, 'tobe').global.killed}`).join(', ')}이다. 진행중 항적이 각각 ${Math.min(...runs.map(r => r.global.censoredRaw))}~${Math.max(...runs.map(r => r.global.censoredRaw))}개 남아 있으므로 ${data.meta.dur}초 결과를 최종 방어 성과로 해석할 수 없다.</li>
<li>같은 실제 발사에 연결된 탐지→발사 시간의 평균은 ${DEPLOYMENTS.map(dep => `${depName(dep)} ${f(run(dep, 'asis').summary.total.mean)}→${f(run(dep, 'tobe').summary.total.mean)}초`).join(', ')}이다. 양 모드의 발사 항적 집합이 달라 단독 인과 효과로 볼 수 없다.</li>
<li>책임 배정·역할 문맥·후보 탈락 근거는 실제 통신과 별도이다. 후보 장비나 설명용 연결선을 개입 노드 및 통신 홉에 넣지 않았다.</li>
<li>항적·통신·C2 이벤트 기록이 잘린 실행은 ${truncatedRuns}/${runs.length}개다. 최초 발사 시간의 완전한 계보 연결은 ${runs.reduce((n, r) => n + r.summary.timed, 0)}/${runs.reduce((n, r) => n + r.summary.launched, 0)}개 항적에서 가능했다.</li></ul>
<div class="box notice"><b>비교 범위</b><p>5개 위협 유형의 카드와 유형별 표는 이 고정 시드의 설명 사례다. 표본이 다른 조건부 시간 통계를 성능 우열이나 실제 운용 지침으로 일반화하지 않는다. 다중 시드 불확실성은 함께 갱신한 종합 분석 보고서에서 다룬다.</p></div>
<p class="small">소스 기준: ${esc(data.meta.sourceCommit)}<br>분석 입력: prototype/command-flow.html의 실제 typed 기본값 · 현재 로컬 수정은 끝 페이지의 SHA-256으로 식별</p>`);

pages.push(`${head('01', '측정 정의와 연결 규칙')}
<h3>세 종류의 정보를 분리한다</h3>
${table(['정보', '포함하는 것', '개입·통신 통계 사용'], [
['실제 관측', '노드 접수/처리 사건, 실제 발사, 기록된 송수신 시각', '사용 — 카탈로그 정식 ID만'],
['역할 문맥', '책임 C2, ICC·ECS·포대의 구조상 역할과 소속', '별도 표시 — 경로로 가산하지 않음'],
['판단·후보 근거', '사격통제 부재, 후보 탈락, 거절 사유 등 증거', '사유로만 표시 — 노드·홉 제외']
], '', [18, 47, 35])}
<h3>항적별 최초 실제 발사에 고정한 다섯 구간</h3>
${table(['구간', '같은 발사 계보에서의 시작과 끝'], [
['보고', '최초 탐지 → 연결된 결심 주체의 해당 버전 항적 접수'],
['항적 처리', '그 항적 접수 → 같은 C2·jobId의 항적 처리 완료 (대기열 포함)'],
['협조·회신', '같은 지휘 분기의 요청 → 승인 회신 처리 완료; 중복 구간은 합집합'],
['잔여 대기', '항적 처리 완료 → 연결된 결심 중 협조·회신 구간을 제외한 나머지'],
['결심→발사', '해당 지휘 결심 → 실제 발사; 전달·중계·ECS 처리·기타 대기 포함']
], '', [20, 80])}
<div class="box"><b>결합 키가 없으면 미측정</b><p>ENGAGEMENT_FIRED의 directiveId에서 COMMAND_DECIDED를 찾는다. ICC 재배정은 parentDirectiveId 계보를 거슬러 원 결심을 찾는다. nodeId + trackReceivedAt + jobId로 보고/처리 사건을 결합하고, 협조 마크는 axis의 정식 지휘부 ID가 일치할 때만 쓴다. BDA도 같은 directiveId + engagementId에 한정한다.</p></div>
<p>다섯 구간은 항적별로 중복 없이 탐지→실제 발사 합계와 일치한다. 잔여 대기를 ‘물리 지연’으로, 다른 구간을 ‘순수 절차 지연’으로 단정하지 않는다. 자위권 별도 경로·계보 누락·기록 절단은 분해에서 제외하고 이유와 수를 남긴다.</p>
<h3>분모와 요약 방식</h3><ul>
<li>개입 노드는 전체 관측 기간의 고유 노드 수다. 센서는 별도 보존하며 본문 계층 합계에서는 제외한다.</li>
<li>시간 표의 성분과 합계는 동일한 측정 항적 집합의 평균이다. 중앙값은 별도 열에 쓴다. 성분별 중앙값을 더해 총 중앙값으로 표시하지 않는다.</li>
<li>유형 카드의 시간선은 사건 순서다. 화살표 그림은 도착한 실제 통신 간선의 개별 목록이며 시간선과 구분한다.</li></ul>`);

pages.push(`${head('02', '유형별 관측 개입 노드와 분기')}
<p>각 항적의 전체 600초 관측 기록에서 집계한 센서 제외 고유 노드 중앙값이다. 발사 계보 하나의 노드 수와 다르며 다른 실제 분기의 접수·통신도 포함한다.</p>
${DEPLOYMENTS.map(dep => `<h3>${depName(dep)}</h3>${table(['위협 / 모드', '전체 n', '발사 n', '노드', '지휘', 'ICC', 'ECS', '포대', '책임 / 접수'], types.flatMap(type => ['asis', 'tobe'].map(mode => {
const r = run(dep, mode), ts = r.threats.filter(t => t.type === type); return [`${typeName[type]} ${mode === 'asis' ? 'A' : 'T'}`, ts.length, ts.filter(t => t.launches).length, f(med(ts.map(t => t.nodeCount))), ...['c2', 'relay', 'exec', 'battery'].map(k => f(med(ts.map(t => t.byEch[k])))), `${f(med(ts.map(t => t.responsibleNodes.length)))} / ${f(med(ts.map(t => t.observedBranches.length)))}`];
})), '', [24, 8, 8, 8, 8, 8, 8, 8, 20])}`).join('')}
<p class="note">A=As-Is, T=To-Be. ‘지휘’는 ICC·ECS를 제외한 실제 C2 노드다. ‘책임’은 역할 문맥에 지정된 C2 수, ‘접수’는 실제 TRACK_REPORT_RECEIVED를 기록한 C2 수다. 책임 수는 관측 노드 합계에 별도로 더하지 않는다. 각 열의 중앙값은 서로 다른 항적에서 정해질 수 있어 열 중앙값의 합이 총 노드 중앙값과 같을 필요는 없다.</p>
<div class="box"><b>정식 노드 ID만 사용</b><p>노드 접수·처리 사건, 실제 발사 주체, 관측된 통신 발신지/도착지에서 카탈로그 ID를 검증한다. 실패한 전송의 목적지, 아직 시작하지 않은 예약 경로, 후보 탈락 증거와 HIT/MISS 같은 문자열을 수신 참여 노드로 계산하지 않는다.</p></div>`);

pages.push(`${head('03', '같은 발사 계보의 시간 분해')}
<p>단위는 초. n은 해당 유형의 실제 최초 발사 중 다섯 구간이 모두 측정된 항적 수이다. 다섯 성분과 합계는 같은 n의 평균이며, 반올림 때문에 표시값 합에 작은 차이가 날 수 있다.</p>
${DEPLOYMENTS.map(dep => `<h3>${depName(dep)}</h3>${table(['위협 / 모드', 'n', '보고', '처리', '협조', '잔여', '결심→발사', '평균 합계', '중앙값'], types.flatMap(type => ['asis', 'tobe'].map(mode => {
 const s = run(dep, mode).byType[type]; return [`${typeName[type]} ${mode === 'asis' ? 'A' : 'T'}`, s.timed, ...keys.map(k => f(s.segments[k].mean)), f(s.total.mean), f(s.total.median)];
})), '', [22, 6, 9, 9, 9, 11, 12, 11, 11])}`).join('')}
<div class="box notice"><b>구성·생존 편향을 함께 읽는다</b><p>발사하지 못한 항적은 이 시간 표에 없다. 모드 변경으로 새로 발사할 수 있게 된 항적도 포함되므로 평균 차이는 동일 항적의 처리 개선만을 뜻하지 않는다. 특히 탄도탄과 소형 무인기의 긴 잔여 대기는 이 표만으로 교전 기하, 사격통제, 가용성, 재시도의 개별 기여를 분리할 수 없다.</p></div>
<p class="note">${runs.length}개 실행의 발사 항적 중 측정 누락은 ${missingTiming}건이다.${missingTiming ? ' 제외 사유: ' + esc(runs.map(r => `${depName(r.dep)} ${r.mode} ${JSON.stringify(r.summary.timingMissing)}`).join('; ')) : ''} ‘협조 0’은 연결된 최초 발사 분기에 측정된 협조 요청 구간이 없다는 뜻이며, 전체 항적이나 다른 분기에 협조 사건이 없다는 뜻은 아니다.</p>`);

pages.push(`${head('04', '실제 통신: 도착 · 실패 · 진행중')}
${table(['배치 / 모드', '도착', '전송중', '예약·미시작', '실패', '채널 대기'], runs.map(r => [`${depName(r.dep)} ${modeName(r.mode)}`, ...['delivered', 'inTransit', 'notStarted', 'failed', 'queued'].map(k => r.comm[k])]))}
<p class="note">단위는 기록된 통신 간선 통과/전문이다. 다중 홉 전문은 여러 간선으로 센다. cq의 전문 ID가 실제 발신 link.mid로 이어지면 대기 건수에서 제외한다. 노드 ID가 유효하지 않아 제외한 간선/대기/실패 기록은 ${runs.length}개 실행 합계 ${invalidEndpoints}건이다.</p>
<h3>통신 종류별 도착 간선 수</h3>
${table(['종류', ...runs.map(r => `${depName(r.dep)} ${r.mode === 'asis' ? 'A' : 'T'}`)], [...new Set(runs.flatMap(r => r.threats.flatMap(t => t.comm.rows.filter(e => e.state === 'delivered').map(e => e.kind))))].sort().map(kind => [esc(kind), ...runs.map(r => r.threats.reduce((n, t) => n + t.comm.rows.filter(e => e.kind === kind && e.state === 'delivered').length, 0))]))}
<h3>상태의 의미와 한계</h3><ul>
<li><b>도착:</b> 기록된 link의 도착 시각 t1이 600초 이내다. 이는 전송 도착이며, 수신 측이 유효한 최신 상태로 채택했다는 의미는 아니다.</li>
<li><b>전송중:</b> t0 ≤ 600 &lt; t1. 목적지는 도착 노드로 가산하지 않는다.</li>
<li><b>예약·미시작:</b> 기록된 후속 경로의 t0 &gt; 600. 이미 수행한 전송으로 계산하지 않는다.</li>
<li><b>실패:</b> 실제 cx 사건을 기록한 전송 실패다. 현재 이 관측 채널의 실패는 상태공유 채널 용량 초과이다. 모든 가능한 실패가 cx에 기록된다고 가정하지 않는다.</li>
<li><b>채널 대기:</b> cq 이후 같은 전문 ID로 발신/실패가 기록되지 않은 건이다. 관측 종료 시점에 미해결이다.</li></ul>
<div class="box"><b>홉을 발사 계보에 억지로 연결하지 않는다</b><p>통신 link에는 directiveId가 없다. 따라서 ‘이 발사에 필요했던 명령 홉 수’를 확정하지 않는다. 여기와 유형 카드의 홉은 해당 항적 전체의 관측된 통신이며, 시간 분해에 사용한 발사 계보와 다른 분기의 간선이 함께 있을 수 있다.</p></div>`);

let svgId = 0;
function edgesSvg(r, t) {
  const counts = groupCount(t.comm.rows.filter(e => e.state === 'delivered' && ['command', 'coord'].includes(e.kind)), e => `${e.from}|${e.to}|${e.kind}`);
  const rows = [...counts].map(([key, count]) => { const [from, to, kind] = key.split('|'); return { from, to, kind, count }; });
  const shown = rows.slice(0, 7), id = `arrow${++svgId}`;
  // Each label has at least 116 SVG units; reserve 11 for font variation.
  // Count Korean/full-width characters by width, not string length.
  const width = c => c.codePointAt(0) >= 0x2e80 || c === '…' ? 10 : /[MW@#]/.test(c) ? 8 : /[A-Z]/.test(c) ? 7 : 5.5;
  const shorten = s => {
    if ([...s].reduce((n, c) => n + width(c), 0) <= 105) return s;
    let out = '', used = 0;
    for (const c of s) { if (used + width(c) + width('…') > 105) break; out += c; used += width(c); }
    return out + '…';
  };
  return `<svg viewBox="0 0 315 ${Math.max(36, shown.length * 24 + 10)}" role="img" aria-label="실제 도착한 명령·협조 간선 목록"><defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#46789d"/></marker></defs>${shown.map((e, i) => { const y = 20 + i * 24; return `<text x="1" y="${y}" font-size="10" fill="#193f60"><title>${esc(label(r, e.from))} (${esc(e.from)})</title>${esc(shorten(label(r, e.from)))}</text><line x1="122" y1="${y - 4}" x2="188" y2="${y - 4}" stroke="#46789d" marker-end="url(#${id})"/><text x="154" y="${y - 7}" text-anchor="middle" font-size="8" fill="#526274">${e.kind} ×${e.count}</text><text x="199" y="${y}" font-size="10" fill="#193f60"><title>${esc(label(r, e.to))} (${esc(e.to)})</title>${esc(shorten(label(r, e.to)))}</text>`; }).join('')}${shown.length ? '' : '<text x="2" y="22" font-size="11">해당 종류의 도착 간선 없음</text>'}</svg><p class="note">고유 간선 ${shown.length}/${rows.length}개. 각 화살표는 독립 간선(연쇄 경로 아님). 긴 이름은 …로 축약; 전체 ID·명칭은 분석 JSON 참조.</p>`;
}
function timeBar(t, maximum) {
  let x = 0; const d = t.timing.dec;
  return `<svg viewBox="0 0 315 34" role="img" aria-label="같은 최초 발사의 다섯 시간 구간">${keys.map((k, i) => { const w = 310 * d[k] / maximum, part = `<rect x="${x}" y="2" width="${w}" height="16" fill="${colors[i]}"/>`; x += w; return part; }).join('')}<text x="1" y="31" font-size="10" fill="#526274">탐지→최초 실제 발사 ${f(d.total)}초</text></svg>`;
}
function card(r, t, max) {
  const events = t.timing.events, shown = events.slice(0, 10);
  return `<div class="trackcard"><h3>${modeName(r.mode)} · ${outcomes(t)}</h3><p class="small">정식 결심 주체: ${esc(label(r, t.timing.branch))}<br>명령 계보: ${esc(t.timing.lineage.join(' ← '))}<br>센서 제외 관측 노드 ${t.nodeCount}개 · 실제 발사 ${t.launches}회</p>
${timeBar(t, max)}<div class="segmentvalues">${keys.map((k, i) => `<span><i style="background:${colors[i]}"></i>${segName[k]} ${f(t.timing.dec[k])}</span>`).join('')}</div>
<h3>같은 발사에 연결된 사건 순서</h3>${table(['시각(s)', '관측 사건 / 실제 노드'], shown.map(e => [f(e.t), `${esc(e.label.replace(/^해당 지휘부 /, '').replace(/^해당 항적 /, '항적 ').replace(/^연결된 /, ''))} <span class="note">(${esc(label(r, e.node))})</span>`]), 'timeline', [19, 81])}
<p class="note">${shown.length}/${events.length}개 표시. 시각은 생성 후 경과가 아닌 시뮬레이션 절대 시각이다.</p>
<h3>항적 전체의 도착 명령·협조 간선</h3>${edgesSvg(r, t)}
<p class="small"><b>역할 문맥:</b> 책임 지정 ${t.responsibleNodes.length}개 / 실제 접수 분기 ${t.observedBranches.length}개. 책임 지정 자체는 위 화살표가 아니다.</p>
<p class="note"><b>누적 판단 근거:</b> ${t.evidenceCodes.length ? t.evidenceCodes.slice(0, 5).map(esc).join(', ') : '기록 없음'}${t.evidenceCodes.length > 5 ? ` 외 ${t.evidenceCodes.length - 5}종` : ''}. 최종 결과의 단일 원인으로 단정하지 않는다.</p></div>`;
}
for (const [i, type] of types.entries()) {
  const a = run(DEPLOYMENTS[0], 'asis'), b = run(DEPLOYMENTS[0], 'tobe');
  const candidates = a.threats.filter(t => t.type === type && t.timing.dec && b.threats.some(u => u.id === t.id && u.timing.dec)).sort((x, y) => x.spawnT - y.spawnT);
  const x = candidates[0], y = b.threats.find(t => t.id === x?.id);
  if (!x || !y) throw new Error(`No predeclared representative pair: ${type}`);
  const maximum = Math.max(x.timing.dec.total, y.timing.dec.total);
  pages.push(`${head(String(5 + i).padStart(2, '0'), `${typeName[type]} · 동일 항적 관측 카드`)}
<p><b>${esc(x.id)}</b> · LEGACY · 생성 ${f(x.spawnT)}초 · 두 모드 모두 시간 분해 가능한 같은 유형의 항적 중 생성 시각이 가장 빠른 사례.</p>
<p class="note">두 카드의 시간 막대는 같은 척도다. 사례 선정은 격추 여부에 조건을 두지 않는다. 이 사례를 유형 전체의 대표 성능이나 효과 크기로 해석하지 않는다.</p>
<div class="cardgrid">${card(a, x, maximum)}${card(b, y, maximum)}</div>
<div class="box small"><b>유형 전체의 분모:</b> LEGACY ${typeName[type]}는 ${a.byType[type].threats}개 발생했다. 최초 발사 시간 측정은 As-Is ${a.byType[type].timed}개, To-Be ${b.byType[type].timed}개다. FULL의 분모와 시간은 02·03절 표에 별도로 제시했다.</div>`);
}

pages.push(`${head('10', '과정 진단과 관측 지표의 범위')}
${table(['배치 / 모드', '발사 횟수', '재배정', '반송', '발사불가', '중복해소', '2회 이상 결심 항적'], runs.map(r => [`${depName(r.dep)} ${modeName(r.mode)}`, r.global.shotsFired, ...['reassign', 'bounce', 'noFire', 'dedup'].map(k => r.threats.reduce((s, t) => s + t[k], 0)), r.threats.filter(t => t.decisions > 1).length]), '', [24, 12, 11, 11, 12, 12, 18])}
<p class="note">재배정·반송·발사불가·중복해소는 관측된 해당 마크의 발생 횟수다. 후보 검사 반복 횟수나 항적 수가 아니다. 결심 횟수는 COMMAND_DECIDED의 수이며 승인 요청을 결심으로 간주하지 않는다.</p>
<h3>개입 구조와 시간은 각각 비교</h3>
${table(['배치 / 모드', '측정 항적 n', '발사 항적의 노드 중앙값', '탐지→최초 발사 중앙값(초)'], runs.map(r => [`${depName(r.dep)} ${modeName(r.mode)}`, r.summary.timed, f(r.summary.launchedNodes.median), f(r.summary.total.median)]), '', [26, 18, 26, 30])}
<p>과거 보고서의 ‘초/노드 효율’ 수치는 제시하지 않는다. 노드 수는 발사 이후와 다른 분기의 참여까지 포함한 전체 관측 기간의 값인 반면, 시간은 최초 발사까지의 값이다. 둘을 나눠 노드 처리 효율로 해석할 근거가 없다. 개입 노드와 최초 발사 시간을 서로 다른 관측 범위의 지표로 나란히 제시한다.</p>
<h3>정확히 구분해야 할 진단</h3><ul>
<li><b>재배정:</b> 원 명령과 새 명령을 parentDirectiveId로 이어 최초 발사 계보를 보존한다. 전달 구간에는 해당 중계·재배정 시간이 함께 들어간다.</li>
<li><b>중복해소:</b> 실제 중복 발사와 같지 않다. 교전 상태·이미 존재하는 명령 때문에 새 선택을 억제한 사건일 수 있다.</li>
<li><b>발사불가:</b> 한 시점·한 시도의 실패다. 이후 다른 사수·분기에서 발사하거나 격추할 수 있다.</li>
<li><b>근거 코드:</b> 후보 검토 중 누적된 사유를 보여 준다. 그 코드에 등장한 모든 장비가 명령을 받거나 통신을 수행한 것은 아니다.</li></ul>
<div class="box notice"><b>모델 수정 없이 관측 해석을 수정했다</b><p>본 갱신은 현재 엔진으로 재실행하고 보고서의 결합·집계·표현을 바로잡았다. 이 보고서를 위해 교전 알고리즘, 승인 정책, 명중 확률, 통신 지연 값을 조정하지 않았다.</p></div>`);

pages.push(`${head('11', '관측 완전성 · 재현 · 해석 한계')}
${table(['배치 / 모드', '항적', 'flow 사건', 'C2 사건', '항적/flow/C2 절단'], runs.map(r => [`${depName(r.dep)} ${modeName(r.mode)}`, `${r.coverage.traces}/${r.global.spawned}`, r.coverage.flowEvents, r.coverage.c2Events, [r.coverage.traceTruncated, r.coverage.flowTruncated, r.coverage.c2EventsTruncated].map(x => x ? '있음' : '없음').join(' / ')]), '', [27, 15, 16, 16, 26])}
<p class="note">설정 상한: traceCap 5,000 · flowTraceCap 500,000 · c2EventCap 500,000. 통신 사건 수에는 노드 접수/처리 관측도 들어가므로 통신 간선 도착 수와 다르다. 기록 절단과 600초 시점의 미해결(검열)은 별개다.</p>
<h3>현재 기본 기능</h3><p class="small">시나리오 sc3 · seed 29 · 600초 · ×1 · iads-c2. 두 배치/두 모드를 제외한 기능은 실제 화면 기본값에서 가져왔다.</p>
<div class="flaglist">${Object.entries(data.meta.flags).map(([k, v]) => `<div><code>${esc(k)}</code>: <b>${esc(v)}</b></div>`).join('')}</div>
<h3>재현 명령</h3><div class="code">node docs/analysis/2026-09-19-current-reports/c2-analysis-run.mjs --self-test
node docs/analysis/2026-09-19-current-reports/c2-analysis-run.mjs
node docs/analysis/2026-09-19-current-reports/c2-report-gen.mjs</div>
<p class="small">첫 명령은 다른 지휘 분기의 선행 선택/협조 혼입, ICC 자식 명령의 계보, 다른 발사의 BDA 혼입, 기록 절단, 도착/실패/대기 상태와 정식 노드 필터를 합성 사례로 검증한다. JSON에는 항적별 시간 계보·정식 노드·관측 통신을 보존한다. 엔진 전체 raw 상태는 포함하지 않으며 동일 명령으로 재계산한다.</p>
<h3>버전과 추적성</h3><p class="small">Git 기준 ${esc(data.meta.sourceCommit)}. 작업 중 파일 변경은 아래 내용 해시로 식별한다. 생성 시각 ${esc(data.meta.generatedAt)}.</p>
${table(['파일', 'SHA-256'], Object.entries(data.meta.sourceHashes).map(([k, v]) => [esc(k), `<code>${esc(v)}</code>`]), 'kv', [37, 63])}
<p class="small">실제 작전 체계·기밀 성능·교전 규칙의 검증 자료가 아니다. 단일 시드, 개념 좌표와 지연 가정, 미해결 항적, 발사 표본 선택, 계측 범위 때문에 일반화가 제한된다. 역할 문맥을 실제 수행 경로로 확장하거나 잔여 대기를 특정 물리 원인으로 단정하지 않는다. XLSX는 참고·내보내기 자료이며 엔진의 실행 입력으로 읽지 않는다.</p>`);

const extra = `<style>.cardgrid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.trackcard{border:1px solid #c2ccd6;border-top:3px solid #24628b;padding:8px}.trackcard h3{font-size:9.5pt;margin:7px 0 4px}.trackcard .small,.trackcard .note{font-size:7.6pt;line-height:1.35}.trackcard table{font-size:7.4pt;margin:4px 0}.trackcard th,.trackcard td{padding:3px 4px}.trackcard svg{width:100%;display:block}.segmentvalues{display:flex;flex-wrap:wrap;gap:3px 8px;font-size:7.4pt}.segmentvalues i{display:inline-block;width:7px;height:7px;margin-right:3px}.flaglist{columns:2;font-size:7.6pt;line-height:1.5;background:#f2f6fa;padding:8px 12px}.flaglist div{break-inside:avoid}.flaglist code{font-size:7.1pt}</style>`;
const html = pagesHTML('K-JAMDS C2 분석 결과 · 2026-09-19', pages, data.meta.sourceCommit).replace('</head>', `${extra}</head>`);
fs.writeFileSync(path.join(HERE, 'c2-report.html'), html);
console.log(`Generated c2-report.html: ${pages.length} explicit A4 pages`);
