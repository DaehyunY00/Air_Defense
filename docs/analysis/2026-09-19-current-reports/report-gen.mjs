// Integrated SC3 report — one document from two fresh runs; never reads XLSX.
//   analysis-out.json    : 182 experiment cells + 1 probe (baseline · OAT · paired seeds · sweep · window)
//   c2-analysis-out.json : 4 fully recorded SC3 runs (observed nodes · command lineage · timing · links)
// The former separate C2 report was merged here; duplicated cover/limits/reproduction pages appear once.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { HERE, DEPLOYMENTS, stats } from './report-common.mjs';
import { escapeHTML as esc, table as tbl, pagesHTML } from './report-style.mjs';
const table = tbl;
const D=JSON.parse(fs.readFileSync(path.join(HERE,'analysis-out.json'),'utf8'));
const data=JSON.parse(fs.readFileSync(path.join(HERE,'c2-analysis-out.json'),'utf8'));
const output=path.join(HERE,'report.html');
// ADR-101: the observation window is the screen default (1800 s). PREV is the 600 s edition, kept only for comparison.
const DUR=D.meta.defaultValues.dur;
const PREV=JSON.parse(fs.readFileSync(path.join(HERE,'previous-600s-summary.json'),'utf8'));
assert.equal(data.meta.dur,DUR,'C2 record runs must use the same observation window as the experiment cells');
assert.equal(PREV.engineSha256,D.meta.sourceHashes['js/engine/sim-engine.js'],'600 s edition used a different engine');
assert.equal(PREV.adapterSha256,D.meta.sourceHashes['js/config/deployment-adapter.js'],'600 s edition used a different adapter');
assert.deepEqual(PREV.seeds,D.meta.seeds,'600 s edition used a different seed set');
const DEP={HANBANDO_LEGACY_NORMAL:'LEGACY · 기본 배치',HANBANDO_FULL_NORMAL:'FULL · 확대 배치'};
const MOD={asis:'As-Is',tobe:'To-Be'};
const SC={sc1:'SC1 경계 침투',sc2:'SC2 무인기',sc3:'SC3 복합 포화'};
const num=(v,d=1)=>v==null?'미측정':Number(v).toFixed(d);
const sign=(v,d=0)=>v==null?'미측정':(v>0?'+':'')+Number(v).toFixed(d);
const rate=v=>num(v*100,1)+'%';
const find=(section,q)=>{const r=D[section].find(r=>Object.entries(q).every(([k,v])=>r[k]===v));assert.ok(r,JSON.stringify(q));return r;};
const base=(dep,mode,sc='sc3')=>find('baseline',{dep,mode,sc});
const FLAGS={
  appr:['교전 협조 OFF','국지방공 축의 협조 요청·처리 관문 생략'],
  cop:['교전현황 공유 OFF','To-Be의 공유 상태 소비·중복 해소 비활성화'],
  sdf:['자위권 사격 OFF','기존 자위권 발사 규칙 비활성화'],
  eor:['원격 교전 ON','모델의 원격 사격통제 정보 사용 허용'],
  share:['연합 항적 공유 ON','datalink 항적 공유 반사실; 지휘권 통합 아님'],
  suit:['고도 적합도 ON','모델의 사수 적합도 가중치 활성화'],
  uavsd:['무인기 자체 교전 ON','무인기 국지방공 자체 교전 반사실'],
  ew:['조기경보 보고 ON','추가 보고원 규칙 활성화'],
  lx:['탄도 발사점 연장 OFF','탄도 궤적의 생성 위치 가정 변경'],
  aim:['표적 카탈로그 OFF','탄도 표적 배정 가정 변경'],
  floor:['처리시간 바닥 ON','체계 성분·운용자 성분의 시간 분포 변경'],
  pipe:['협조 파이프라인 OFF','실행가능 사수 확인·역방향 회신·회신 처리 큐 생략'],
  icc:['ICC 중계 인가 OFF','중계 접수·인가·재배정·반송 처리 비활성화'],
  ecs:['ECS 집행시간 ON','ECS 명령 실행 작업 평균을 10초로 설정'],
  issue:['명령 발령 작업 ON','명령을 발령할 때 결심 노드의 별도 큐 작업 추가'],
  par:['결심 시간 동일화 OFF','IAOC 운용자 평균을 30초에서 1초로 변경']
};
const REASONS={engagement_geometry_gap:'전 교전창 요격점 미형성','timeout:c2':'C2 지연 초과 (조건부 원인)',window_lost_due_to_c2:'C2 지연으로 교전창 상실',
  'timeout:engage':'교전 중 체공창 종료',correlation_failed:'항적 상관 실패',capacity_full:'동시교전 한도',missed:'명중 실패',
  no_fire_control:'사격통제 미형성',no_capable_weapon:'호환 무기 부재',no_shooter:'가용 교전수단 부재',no_engage_window:'잔여 교전창 부족',
  ammo_depleted:'탄약 소진',pk_too_low:'확률 기준 미달',fuel_insufficient:'요격 운동학 조건 미달',responsibility_gap:'책임·명령 경로 공백'};
for(const [section,count] of Object.entries(D.meta.sectionCounts))assert.equal(D[section].length,count);
assert.equal(Object.values(D.meta.sectionCounts).reduce((a,b)=>a+b,0),182);
for(const section of Object.keys(D.meta.sectionCounts))for(const r of D[section])assert.equal(r.spawned,r.killed+r.leaked+r.censored);
const deps=Object.keys(DEP), la=base(deps[0],'asis'),lt=base(deps[0],'tobe'),fa=base(deps[1],'asis'),ft=base(deps[1],'tobe');
const ci=(s,scale=1)=>`${sign(s.mean*scale,1)} [${sign(s.lo*scale,1)}, ${sign(s.hi*scale,1)}]`;
const pairedRows=deps.map(dep=>{const p=D.paired[dep];return [DEP[dep],p.leaked.n,ci(p.leaked),ci(p.leakRateSpawn,100),ci(p.censoredRate,100),`${p.direction.lowerLeak}/${p.direction.tie}/${p.direction.higherLeak}`];});
const baselineRows=D.baseline.map(r=>[DEP[r.dep].split(' · ')[0],SC[r.sc],MOD[r.mode],r.spawned,r.killed,r.leaked,r.censored,rate(r.leakRateSpawn),r.dup,r.shots]);
function oatRows(dep){return Object.entries(FLAGS).map(([flag,[label,explain]])=>{
  const a=find('oat',{dep,mode:'asis',flag}),t=find('oat',{dep,mode:'tobe',flag}),ab=base(dep,'asis'),tb=base(dep,'tobe');
  return [label,explain,sign(a.leaked-ab.leaked),sign(a.censored-ab.censored),sign(a.dup-ab.dup),sign(t.leaked-tb.leaked),sign(t.censored-tb.censored),sign(t.dup-tb.dup)];
});}
function sweepRows(dep){return [1,1.5,2,2.5,3].map(x=>{const a=find('sweep',{dep,x,mode:'asis'}),t=find('sweep',{dep,x,mode:'tobe'});
  const top=r=>`${esc(r.top[0].name)}<br>${num(r.top[0].wq)}秒 / ρ ${num(r.top[0].rho,2)}`.replace('秒','초');
  return ['×'+x,a.spawned,`${a.leaked}/${t.leaked}`,`${a.censored}/${t.censored}`,sign(t.leaked-a.leaked),top(a),top(t)];});}
function reasonsRows(dep){const a=base(dep,'asis'),t=base(dep,'tobe');return [...new Set([...Object.keys(a.reasons),...Object.keys(t.reasons)])].sort((x,y)=>(a.reasons[y]||0)+(t.reasons[y]||0)-(a.reasons[x]||0)-(t.reasons[x]||0)).map(code=>[esc(REASONS[code]||code),a.reasons[code]||0,t.reasons[code]||0,sign((t.reasons[code]||0)-(a.reasons[code]||0))]);}
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
const outcomes = t => t.outcome === 'killed' ? '격추' : String(t.outcome).startsWith('leaked') ? '누수' : '진행중';
const groupCount = (xs, key) => { const m = new Map(); for (const x of xs) m.set(key(x), (m.get(key(x)) || 0) + 1); return m; };
// The two inputs must describe the same source and the same four SC3 baseline runs.
assert.equal(D.meta.sourceCommit,data.meta.sourceCommit,'analysis/C2 source commit differ');
assert.deepEqual(D.meta.sourceHashes,data.meta.sourceHashes,'analysis/C2 source hashes differ');
const h2=(n,title)=>`<h2>${n}. ${title}</h2>`;
const crossRows=[];
for(const dep of DEPLOYMENTS)for(const mode of ['asis','tobe']){
  const b=base(dep,mode),r=run(dep,mode);
  assert.deepEqual([b.spawned,b.killed,b.leaked,b.censored,b.shots],
    [r.global.spawned,r.global.killed,r.global.leaked,r.global.censoredRaw,r.global.shotsFired],`${dep} ${mode}: cell/C2 accounts differ`);
  // Engine timing covers every launched track. The lineage reconstruction can omit launches that have no
  // command ancestry (self-defense fire); only when nothing is omitted must the two means be identical.
  assert.equal(b.decN,r.summary.launched,`${dep} ${mode}: engine timing sample differs from launched tracks`);
  assert.equal(r.summary.launched-r.summary.timed,Object.values(r.summary.timingMissing).reduce((n,x)=>n+x,0),`${dep} ${mode}: unexplained timing omissions`);
  if(r.summary.timed===r.summary.launched)assert.ok(Math.abs(b.dec-r.summary.total.mean)<1e-6,`${dep} ${mode}: engine mean vs lineage mean`);
  crossRows.push({dep,mode,b,r});
}
const launchedAll=runs.reduce((n,r)=>n+r.summary.launched,0),timedAll=runs.reduce((n,r)=>n+r.summary.timed,0);
const omittedAll=launchedAll-timedAll;
const identicalRuns=crossRows.filter(({r})=>r.summary.timed===r.summary.launched).length;
const tracesAll=runs.reduce((n,r)=>n+r.coverage.traces,0);
const prevBase=(dep,mode)=>{const r=PREV.baseline.find(r=>r.dep===dep&&r.mode===mode);assert.ok(r,`600 s baseline ${dep} ${mode}`);return r;};
const acct=r=>`${r.spawned} / ${r.killed} / ${r.leaked} / ${r.censored}`;
const MISSING={self_defense_separate_path:'명령 계보가 없는 자위권 발사'};
const pages=[];
pages.push(`<div class="eyebrow">CURRENT SOURCE · SC3 통합 재실행 보고서</div><h1>K-JAMDS 지휘통제 모의분석<br>분석 방법과 결과</h1><p class="subtitle">SC3 복합 포화 · 관측 ${DUR}초 기준 — 실험 집계와 C2 기록(통신 · 명령 계보 · 시간 분해)의 통합본</p>
<p>작성일 2026-09-19 · 소스 ${esc(D.meta.sourceCommit.slice(0,7))}<br>지상배치 방공 C2 개념 시뮬레이션 · 실제 작전 성능의 검증 자료가 아님</p>
<div class="metrics"><div class="metric"><strong>182 + 1</strong><span>분석 실행 + 별도 탐침 실행</span></div><div class="metric"><strong>20쌍</strong><span>배치별 SC3 동일 seed 비교</span></div><div class="metric"><strong>16종</strong><span>한 번에 하나씩 바꾸는 조건</span></div><div class="metric"><strong>4실행</strong><span>항적·통신·C2 사건 전수 기록</span></div></div>
<h3>기준 실행: SC3 · seed 29 · ${DUR}초 · 강도 ×1</h3>
${tbl(['배치','구조','생성','격추','확정<br>누수','종료<br>미해결','중복<br>사건','발사<br>횟수','발사<br>항적','탐지→최초 발사<br>평균초'],crossRows.map(({dep,mode,b,r})=>[DEP[dep].split(' · ')[0],MOD[mode],b.spawned,b.killed,b.leaked,b.censored,b.dup,b.shots,r.summary.launched,num(b.dec)]),'',[11,10,8,8,8,9,8,8,8,22])}
<div class="box"><b>핵심 관측</b><p>확정 누수 차이(To-Be−As-Is)는 기본 배치 ${sign(lt.leaked-la.leaked)}개, 확대 배치 ${sign(ft.leaked-fa.leaked)}개다. 같은 실행에서 각각 ${la.censored}/${lt.censored}개와 ${fa.censored}/${ft.censored}개가 미해결로 남았다. 종료 전에 확정된 결과와 남은 위협을 함께 읽어야 한다.</p>
<p>20개 seed의 평균 누수율 차이(전체 생성 분모)는 기본 배치 ${ci(D.paired[deps[0]].leakRateSpawn,100)}%p, 확대 배치 ${ci(D.paired[deps[1]].leakRateSpawn,100)}%p다. 대괄호는 쌍대 차이의 95% 신뢰구간이다.</p>
<p>탐지→최초 실제 발사 평균은 ${DEPLOYMENTS.map(dep=>`${depName(dep)} ${num(base(dep,'asis').dec)}→${num(base(dep,'tobe').dec)}초`).join(', ')}다(엔진 집계, 발사한 항적 전부). 양 모드의 발사 항적 집합이 달라 단독 인과 효과로 볼 수 없다. 기록이 잘린 실행은 ${truncatedRuns}/${runs.length}개이고, 최초 발사의 계보 연결은 ${timedAll}/${launchedAll}개 항적에서 가능했다${omittedAll?`(제외 ${omittedAll}개는 명령 계보가 없는 자위권 발사)`:''}.</p></div>
<p class="note">동일화 ON은 IAOC 운용자 평균을 30초로 맞춘다. 서버 수·체계 성분·절차·정보 경로까지 모두 같게 만드는 설정은 아니다. seed 29는 600초 조건에서 고른 재현 예시이며 평균 성능을 대표한다고 가정하지 않는다.</p>
<p class="small"><b>관측 시간.</b> 지휘흐름 화면의 기본 관측 시간을 600초에서 ${DUR}초로 올리고(ADR-101) 모든 실행을 다시 돌렸다. 600초에서는 항적의 3분의 1 이상이 미해결로 끝났다. 600초판과의 비교는 3-2절에 둔다.</p>
<p class="small"><b>통합 안내.</b> 종전의 별도 문서 「K-JAMDS C2 분석결과」를 이 문서에 합쳤다. 측정 정의는 2절, 과정·시간·통신·항적 카드는 7~11절이다. 두 문서에 따로 있던 요약·해석 한계·재현 절차·버전 표는 한 번만 싣는다. 본문은 SC3만 다루고 SC1·SC2는 3-3절의 참고 표로 남긴다.</p>`);
pages.push(`<h2>1. 분석 방법과 실행 조건</h2><h3>1-1. 분석 설계와 표본</h3>
${tbl(['구분','실험 설계','실행 수'],[['기준선','2배치 × SC1/SC2/SC3 × 2구조',12],['조건별 OAT','2배치 × 2구조 × 16조건; SC3, seed 29',64],['seed 반복','2배치 × 2구조 × seed 20개; SC3',80],['강도 스윕','2배치 × 2구조 × 강도 1/1.5/2/2.5/3',20],['관측창 비교','LEGACY × 2구조 × 600/1200/1800초',6],['C2 기록 실행','2배치 × 2구조; SC3 · seed 29. 항적·통신·C2 사건 전수 기록 (2·7~11절)',4],['별도 탐침','LEGACY As-Is 기본 조건; 분석 182셀에 미포함',1]],'kv',[20,66,14])}
<h3>1-2. 화면의 실제 기본값을 그대로 읽기</h3><p>러너가 <code>prototype/command-flow.html</code>의 PARAMS, 타입 파서, features 함수를 격리된 JavaScript 문맥에서 직접 실행한다. 숫자 1과 불리언 true의 불일치가 남지 않도록 실제 카탈로그에 전달되는 값을 저장한다.</p>
${tbl(['항목','기준 조건'],[['공통',`SC3 · seed 29 · ${DUR}초 · ×1; 표에서 명시한 요소만 변경`],['기본 ON','협조계선, COP, 자위권, 탄도 발사점 연장, 표적 카탈로그, 결심 시간 동일화, 협조 파이프라인, ICC 중계 인가'],['기본 OFF','원격 교전, 적합도, 무인기 자체 교전, 조기경보 추가 보고, 처리시간 바닥, ECS 추가 집행시간, 별도 명령 발령 작업'],['공유·시간 옵션','연합 공유 null; ICC/ECS/발령 시간은 명시적 재정의 없음'],['코드 기본 ON','고해상도 배치, 표적 산포, 남부 축선, 링크 의미론, 보고주기 동일화, 신선도 모델']],'kv',[18,82])}
<h3>1-3. 비교가 말해 주는 범위</h3><p>모드 비교는 동일 seed의 위협 생성열을 사용한다. OAT는 한 조건의 모델 내부 효과를 보는 단일 seed 탐색이며, 설정 간 상호작용과 난수 소비 순서 변화가 남는다. 표의 0은 해당 지표가 같았다는 뜻으로, 절차가 실행되지 않았거나 현실에서도 불필요하다는 증거가 아니다.</p>
<p class="note">강도 스윕은 연구 러너에서만 바꾼다. 현재 지휘흐름 화면의 강도는 ×1 고정이며 URL의 x 값은 사용하지 않는다. 이 문서의 입력은 JavaScript 카탈로그와 기능 설정이다. xlsx는 참조·내보내기용이고 엔진에 불러오지 않는다.</p>`);
pages.push(`${h2(2,'C2 기록의 측정 정의와 연결 규칙')}
<h3>2-1. 세 종류의 정보를 분리한다</h3>
${table(['정보', '포함하는 것', '개입·통신 통계 사용'], [
['실제 관측', '노드 접수/처리 사건, 실제 발사, 기록된 송수신 시각', '사용 — 카탈로그 정식 ID만'],
['역할 문맥', '책임 C2, ICC·ECS·포대의 구조상 역할과 소속', '별도 표시 — 경로로 가산하지 않음'],
['판단·후보 근거', '사격통제 부재, 후보 탈락, 거절 사유 등 증거', '사유로만 표시 — 노드·홉 제외']
], '', [18, 47, 35])}
<h3>2-2. 항적별 최초 실제 발사에 고정한 다섯 구간</h3>
${table(['구간', '같은 발사 계보에서의 시작과 끝'], [
['보고', '최초 탐지 → 연결된 결심 주체의 해당 버전 항적 접수'],
['항적 처리', '그 항적 접수 → 같은 C2·jobId의 항적 처리 완료 (대기열 포함)'],
['협조·회신', '같은 지휘 분기의 요청 → 승인 회신 처리 완료; 중복 구간은 합집합'],
['잔여 대기', '항적 처리 완료 → 연결된 결심 중 협조·회신 구간을 제외한 나머지'],
['결심→발사', '해당 지휘 결심 → 실제 발사; 전달·중계·ECS 처리·기타 대기 포함']
], '', [20, 80])}
<div class="box"><b>결합 키가 없으면 미측정</b><p>ENGAGEMENT_FIRED의 directiveId에서 COMMAND_DECIDED를 찾는다. ICC 재배정은 parentDirectiveId 계보를 거슬러 원 결심을 찾는다. nodeId + trackReceivedAt + jobId로 보고/처리 사건을 결합하고, 협조 마크는 axis의 정식 지휘부 ID가 일치할 때만 쓴다. BDA도 같은 directiveId + engagementId에 한정한다.</p></div>
<p>다섯 구간은 항적별로 중복 없이 탐지→실제 발사 합계와 일치한다. 잔여 대기를 ‘물리 지연’으로, 다른 구간을 ‘순수 절차 지연’으로 단정하지 않는다. 자위권 별도 경로·계보 누락·기록 절단은 분해에서 제외하고 이유와 수를 남긴다.</p>
<h3>2-3. 분모와 요약 방식</h3><ul>
<li>개입 노드는 전체 관측 기간의 고유 노드 수다. 센서는 별도 보존하며 본문 계층 합계에서는 제외한다.</li>
<li>시간 표의 성분과 합계는 동일한 측정 항적 집합의 평균이다. 중앙값은 별도 열에 쓴다. 성분별 중앙값을 더해 총 중앙값으로 표시하지 않는다.</li>
<li>유형 카드의 시간선은 사건 순서다. 화살표 그림은 도착한 실제 통신 간선의 개별 목록이며 시간선과 구분한다.</li></ul>`);
pages.push(`${h2(3,'SC3 seed 반복 · 관측 시간 · 참고 기준선')}<h3>3-1. SC3의 20개 쌍대 seed: 차이 = To-Be−As-Is</h3>
${tbl(['배치','쌍 수','누수 개수 Δ<br>평균 [95% CI]','누수율 Δ<br>%p [95% CI]','미해결률 Δ<br>%p [95% CI]','누수 감소/<br>동일/증가'],pairedRows)}
<p>seed 집합은 29부터 162까지 7 간격의 20개다. 각 seed의 차이를 먼저 구한 뒤 평균·표본표준편차를 계산한다. 95% CI = 평균 ± t(19, 0.975) × 표준편차/√20이며, 양쪽 실행의 독립 신뢰구간이 겹치는지로 판단하지 않는다.</p>
${tbl(['배치','격추 Δ 평균 [95% CI]','누수 Δ 중앙값','누수 Δ 최소 / 최대','중복 Δ 평균 [95% CI]','발사 Δ 평균 [95% CI]'],deps.map(dep=>{const p=D.paired[dep];return [DEP[dep],ci(p.killed),sign(p.leaked.median,1),`${sign(p.leaked.min)} / ${sign(p.leaked.max)}`,ci(p.dup),ci(p.shots)];}))}
<div class="box notice">신뢰구간은 이 개념 모델과 지정한 조건에서의 seed 변동을 요약한다. 실제 군사 효과의 오차 범위가 아니다. 여러 지표·배치를 동시에 살펴본 탐색 분석이며 다중 비교 보정을 하지 않았다.</div>
<h3>3-2. 관측 시간을 늘린 효과: 600초판 → ${DUR}초</h3>
${tbl(['기준 실행 · seed 29','600초<br>생성 / 격추 / 누수 / 미해결','600초<br>미해결률',`${DUR}초<br>생성 / 격추 / 누수 / 미해결`,`${DUR}초<br>미해결률`],crossRows.map(({dep,mode,b})=>{const o=prevBase(dep,mode);return [DEP[dep].split(' · ')[0]+' '+MOD[mode],acct(o),rate(o.censoredRate),acct(b),rate(b.censoredRate)];}),'',[22,26,13,26,13])}
${tbl(['20개 쌍대 seed','누수율 Δ %p<br>600초','누수율 Δ %p<br>'+DUR+'초','격추 Δ<br>600초','격추 Δ<br>'+DUR+'초','누수 감소/동일/증가<br>600초 → '+DUR+'초'],deps.map(dep=>{const o=PREV.paired[dep],n=D.paired[dep];return [DEP[dep].split(' · ')[0],ci(o.leakRateSpawn,100),ci(n.leakRateSpawn,100),ci(o.killed),ci(n.killed),`${o.direction.lowerLeak}/${o.direction.tie}/${o.direction.higherLeak} → ${n.direction.lowerLeak}/${n.direction.tie}/${n.direction.higherLeak}`];}),'',[14,18,18,15,15,20])}
<p class="note">같은 엔진·같은 seed 집합이며 관측 시간만 다르다(생성기가 엔진·어댑터 해시와 seed 집합의 일치를 검사). 관측창이 길어지면 앞선 항적의 결과가 확정되는 동시에 새 위협도 생성되므로, 두 열은 같은 항적 집합의 전후 비교가 아니다. Δ는 To-Be−As-Is, 대괄호는 95% 신뢰구간이다.</p>
<h3>3-3. 참고: SC1·SC2 기준선 · seed 29 · ${DUR}초 · ×1</h3>
${tbl(['배치','시나리오','생성','격추 A/T','누수 A/T','미해결 A/T','누수/생성 A/T','중복 A/T','발사 A/T'],deps.flatMap(dep=>['sc1','sc2'].map(sc=>{const a=base(dep,'asis',sc),t=base(dep,'tobe',sc);return [DEP[dep].split(' · ')[0],SC[sc],a.spawned,`${a.killed}/${t.killed}`,`${a.leaked}/${t.leaked}`,`${a.censored}/${t.censored}`,`${rate(a.leakRateSpawn)}/${rate(t.leakRateSpawn)}`,`${a.dup}/${t.dup}`,`${a.shots}/${t.shots}`];})),'',[10,16,7,11,11,12,15,9,9])}
<p class="note">A/T = As-Is/To-Be. 이 문서의 나머지 절은 모두 SC3다. SC1·SC2는 같은 설정의 단일 seed 참고값이며 OAT·seed 반복·C2 기록을 수행하지 않았다. 중복은 엔진의 중복교전 사건 수이며 피해 위협 수나 단순 재발사 수와 같지 않다.</p>`);
for(const dep of deps)pages.push(`<h2>4. 조건 하나씩 바꾸기 · ${DEP[dep].split(' · ')[0]}</h2><p>SC3 · seed 29 · ${DUR}초 · ×1. 각 행은 기준값에서 해당 조건 하나만 바꾼다. Δ는 <b>변경 실행−같은 모드의 기준 실행</b>이다. 미해결 증감을 함께 제시한다.</p>
${tbl(['변경 조건','변경 내용','As-Is<br>Δ누수','As-Is<br>Δ미해결','As-Is<br>Δ중복','To-Be<br>Δ누수','To-Be<br>Δ미해결','To-Be<br>Δ중복'],oatRows(dep),'oat',[17,35,8,8,8,8,8,8])}
<div class="box"><b>읽는 법</b><p>음수 Δ누수는 ${DUR}초까지 확정된 누수가 줄었다는 관측이다. Δ미해결이 함께 늘면 일부 결과가 뒤로 밀린 것일 수 있다. 개별 조건의 우열·효과 크기를 일반화하려면 그 조건 자체를 여러 seed와 관측창에서 반복해야 한다.</p></div>
<p class="note">계선·생성 위치·시간 분포를 바꾸는 조건도 포함되므로 전부 순수한 지휘구조 개입은 아니다. 본 표만으로 현실의 절차를 제거하거나 자산 배치를 최적화하도록 권고하지 않는다. 전체 실행별 발사·비용·노드 계정은 analysis-out.json에 보존한다.</p>`);
pages.push(`<h2>5. 부하 변화와 관측 대기</h2><p>SC3 · seed 29 · ${DUR}초. 노드의 전체 작업 평균 대기(Wq)와 관측 이용률(ρ)을 표시한다. 제대별 작업 종류가 다르므로 같은 수치도 역할을 확인해야 한다.</p>
<h3>5-1. 기본 배치</h3>${tbl(['강도','생성','누수<br>A/T','미해결<br>A/T','Δ누수<br>T−A','As-Is 최장 평균대기','To-Be 최장 평균대기'],sweepRows(deps[0]),'',[9,9,11,12,10,24.5,24.5])}
<h3>5-2. 확대 배치</h3>${tbl(['강도','생성','누수<br>A/T','미해결<br>A/T','Δ누수<br>T−A','As-Is 최장 평균대기','To-Be 최장 평균대기'],sweepRows(deps[1]),'',[9,9,11,12,10,24.5,24.5])}
<div class="box"><b>병목의 정의를 결과보다 먼저 고정한다.</b><p>엔진의 노드 경고는 ρ≥0.7, 병목 표시는 ρ≥0.9 또는 관측 드롭에 근거한다. 임의의 80%를 포화 기준이나 처리 가능한 위협 수의 보장으로 사용하지 않는다. 평균 이용률만으로 순간 혼잡이나 개별 항적의 인과적 지연을 설명할 수 없다.</p></div>
<p>To-Be MCRC·KAMDOC의 도메인 통보 큐는 IAOC 판단을 차단하지 않는다. 도메인 노드의 대기와 IAOC 결심 경로의 대기를 구분해야 한다. 병목 위치가 협조·무기체계 중 어느 쪽이어야 한다는 결론을 통과 조건으로 고정하지 않는다.</p>
<p class="note">각 강도는 단일 seed 예시다. 증가한 부하가 누수율·병목 개수를 항상 단조 증가시키는 것은 아니다. 종료 미해결, 비선형 상호작용, 표본 경로 변화가 함께 작용한다.</p>`);
pages.push(`<h2>6. 관측창과 누수 원인</h2><h3>6-1. LEGACY · SC3 · seed 29 · ×1</h3>
${tbl(['관측창','생성','누수 A/T','미해결 A/T','누수/생성 A/T','미해결/생성 A/T'],[600,1200,1800].map(dur=>{const a=find('dur',{dur,mode:'asis'}),t=find('dur',{dur,mode:'tobe'});return [dur+'초',a.spawned,`${a.leaked}/${t.leaked}`,`${a.censored}/${t.censored}`,`${rate(a.leakRateSpawn)}/${rate(t.leakRateSpawn)}`,`${rate(a.censoredRate)}/${rate(t.censoredRate)}`];}))}
<p class="note">관측창을 늘리면 기존 항적의 결과뿐 아니라 새 위협도 추가된다. 따라서 이 비교는 동일 코호트 추적이나 정상상태 확인이 아니다. 1800초도 종료 미해결이 있으면 최종 생애 누수율이 아니다. 이 문서의 다른 절은 모두 ${DUR}초 창이다.</p>
<h3>6-2. ${DUR}초에 확정된 누수의 주원인 · LEGACY</h3>${tbl(['모델의 원인 분류','As-Is','To-Be','Δ'],reasonsRows(deps[0]),'',[58,14,14,14])}
<h3>6-3. ${DUR}초에 확정된 누수의 주원인 · FULL</h3>${tbl(['모델의 원인 분류','As-Is','To-Be','Δ'],reasonsRows(deps[1]),'',[58,14,14,14])}
<p class="note">${(()=>{const fresh=deps.map(dep=>{const was=new Set(['asis','tobe'].flatMap(m=>Object.keys(prevBase(dep,m).reasons)));const a=base(dep,'asis'),t=base(dep,'tobe');
  return [...new Set([...Object.keys(a.reasons),...Object.keys(t.reasons)])].filter(c=>!was.has(c)).map(c=>`${esc(REASONS[c]||c)} ${a.reasons[c]||0}/${t.reasons[c]||0}건`).join(', ');});
  return fresh.some(Boolean)?`<b>600초판의 원인 표에 없던 분류</b>(As-Is/To-Be): ${deps.map((dep,i)=>`${DEP[dep].split(' · ')[0]} — ${fresh[i]||'없음'}`).join(' · ')}. 관측창이 길어지며 드러난 원인이며, 600초 결과만으로는 보이지 않았다. `:'';})()}각 표의 원인 합계는 확정 누수와 일치한다. 주원인은 엔진의 규칙으로 귀속한 분류다. 「요격점 미형성」을 모든 C2 반사실에서 불변인 수치로 단정하거나, 그 외 누수 전체를 C2로 제거할 수 있는 몫으로 계산하지 않는다.</p>`);
const dupFlags=['cop','sdf','suit','eor','pipe','icc','aim','par'];
pages.push(`${h2(7,'교전 과정: 중복 · 재시도 · 시간 계정')}<h3>7-1. 기준 실행의 과정 진단</h3>
${tbl(['배치 / 모드','발사 횟수','중복 사건','재배정','반송','발사불가','중복해소','2회 이상<br>결심 항적'],crossRows.map(({b,r})=>[`${depName(r.dep)} ${modeName(r.mode)}`,r.global.shotsFired,b.dup,...['reassign','bounce','noFire','dedup'].map(k=>r.threats.reduce((s,t)=>s+t[k],0)),r.threats.filter(t=>t.decisions>1).length]),'',[22,11,11,10,10,11,11,14])}
<p class="note">중복 사건은 엔진 계정, 나머지는 기록된 해당 마크의 발생 횟수다. 후보 검사 반복 횟수나 항적 수가 아니다. 결심 횟수는 COMMAND_DECIDED의 수이며 협조 요청을 결심으로 간주하지 않는다. 용어의 뜻은 12-2절에 적는다.</p>
<h3>7-2. FULL To-Be의 조건별 중복 변화</h3>
${tbl(['변경 조건','기준 중복','변경 중복','Δ중복','Δ누수','Δ발사'],dupFlags.map(flag=>{const r=find('oat',{dep:deps[1],mode:'tobe',flag});return [FLAGS[flag][0],ft.dup,r.dup,sign(r.dup-ft.dup),sign(r.leaked-ft.leaked),sign(r.shots-ft.shots)];}))}
<p>같은 표적에 대한 복수 발사는 발사 시각·사수·명령·격추 판정을 함께 추적해야 해석할 수 있다. 단일 seed OAT의 증감만으로 중복의 원인을 구조 자체로 확정하지 않는다. 개별 항적의 기록은 11절 카드에서 확인한다.</p>
<h3>7-3. 시간·비용 계정: 엔진 집계와 기록 계보의 대사</h3>
${tbl(['배치/구조','생성→최초 발사<br>엔진 평균초 / n','탐지→최초 발사<br>엔진 평균초 / n','탐지→최초 발사<br>계보 재구성 평균초 / n','발사수','소모비용<br>개념 $M'],crossRows.map(({dep,mode,b,r})=>[DEP[dep].split(' · ')[0]+' '+MOD[mode],`${num(b.tte)} / ${b.tteN}`,`${num(b.dec)} / ${b.decN}`,`${f(r.summary.total.mean)} / ${r.summary.timed}`,b.shots,num(b.costM)]),'',[18,18,18,22,9,15])}
<div class="box notice"><b>두 경로의 값을 대사했다.</b><p>엔진 값은 성공적으로 발사한 _onIadsFire 경계에서 수집하며 표본은 발사한 항적 전부다. 계보 재구성은 기록된 발사에서 명령·결심·항적 접수를 거슬러 올라가 다시 계산한 값이다. ${identicalRuns===crossRows.length?'네 실행 모두 표본과 평균이 엔진 값과 일치한다(생성기가 검사).':`표본이 같은 ${identicalRuns}개 실행은 평균도 일치한다(생성기가 검사). 나머지 ${crossRows.length-identicalRuns}개 실행은 명령 계보가 없는 자위권 발사 ${omittedAll}개가 재구성에서 빠져 n과 평균이 그만큼 다르며, 제외 수는 기록된 사유의 합과 같다.`} 결과 필드 주석의 「최초 교전명령」은 실제 수집 위치와 다르다. 발사한 항적만의 평균이며 양 모드의 포함 항적이 다를 수 있다.</p></div>
<p class="note">비용·가치 입력은 개념값이다. 소모비용이나 중복 사건을 실제 예산 손실로 환산하지 않는다. 중복비용(duplicateCostM)은 비용 단위이며 발사 수가 아니다.</p>`);
pages.push(`${h2(8,'유형별 관측 개입 노드와 분기')}
<p>각 항적의 전체 ${DUR}초 관측 기록에서 집계한 센서 제외 고유 노드 중앙값이다. 발사 계보 하나의 노드 수와 다르며 다른 실제 분기의 접수·통신도 포함한다.</p>
${DEPLOYMENTS.map(dep => `<h3>${depName(dep)}</h3>${table(['위협 / 모드', '전체 n', '발사 n', '노드', '지휘', 'ICC', 'ECS', '포대', '책임 / 접수'], types.flatMap(type => ['asis', 'tobe'].map(mode => {
const r = run(dep, mode), ts = r.threats.filter(t => t.type === type); return [`${typeName[type]} ${mode === 'asis' ? 'A' : 'T'}`, ts.length, ts.filter(t => t.launches).length, f(med(ts.map(t => t.nodeCount))), ...['c2', 'relay', 'exec', 'battery'].map(k => f(med(ts.map(t => t.byEch[k])))), `${f(med(ts.map(t => t.responsibleNodes.length)))} / ${f(med(ts.map(t => t.observedBranches.length)))}`];
})), '', [24, 8, 8, 8, 8, 8, 8, 8, 20])}`).join('')}
<p class="note">A=As-Is, T=To-Be. ‘지휘’는 ICC·ECS를 제외한 실제 C2 노드다. ‘책임’은 역할 문맥에 지정된 C2 수, ‘접수’는 실제 TRACK_REPORT_RECEIVED를 기록한 C2 수다. 책임 수는 관측 노드 합계에 별도로 더하지 않는다. 각 열의 중앙값은 서로 다른 항적에서 정해질 수 있어 열 중앙값의 합이 총 노드 중앙값과 같을 필요는 없다.</p>
<div class="box"><b>정식 노드 ID만 사용</b><p>노드 접수·처리 사건, 실제 발사 주체, 관측된 통신 발신지/도착지에서 카탈로그 ID를 검증한다. 실패한 전송의 목적지, 아직 시작하지 않은 예약 경로, 후보 탈락 증거와 HIT/MISS 같은 문자열을 수신 참여 노드로 계산하지 않는다.</p></div>`);
pages.push(`${h2(9,'같은 발사 계보의 시간 분해')}
<p>단위는 초. n은 해당 유형의 실제 최초 발사 중 다섯 구간이 모두 측정된 항적 수이다. 다섯 성분과 합계는 같은 n의 평균이며, 반올림 때문에 표시값 합에 작은 차이가 날 수 있다.</p>
${DEPLOYMENTS.map(dep => `<h3>${depName(dep)}</h3>${table(['위협 / 모드', 'n', '보고', '처리', '협조', '잔여', '결심→발사', '평균 합계', '중앙값'], types.flatMap(type => ['asis', 'tobe'].map(mode => {
 const s = run(dep, mode).byType[type]; return [`${typeName[type]} ${mode === 'asis' ? 'A' : 'T'}`, s.timed, ...keys.map(k => f(s.segments[k].mean)), f(s.total.mean), f(s.total.median)];
})), '', [22, 6, 9, 9, 9, 11, 12, 11, 11])}`).join('')}
<div class="box notice"><b>구성·생존 편향을 함께 읽는다</b><p>발사하지 못한 항적은 이 시간 표에 없다. 모드 변경으로 새로 발사할 수 있게 된 항적도 포함되므로 평균 차이는 동일 항적의 처리 개선만을 뜻하지 않는다. 특히 탄도탄과 소형 무인기의 긴 잔여 대기는 이 표만으로 교전 기하, 사격통제, 가용성, 재시도의 개별 기여를 분리할 수 없다.</p></div>
<p class="note">${runs.length}개 실행의 발사 항적 중 측정 누락은 ${missingTiming}건이다.${missingTiming ? ' 제외 사유: ' + esc(runs.filter(r => r.summary.launched > r.summary.timed).map(r => `${depName(r.dep)} ${modeName(r.mode)} — ${Object.entries(r.summary.timingMissing).map(([k, n]) => `${MISSING[k] || k} ${n}건`).join(', ')}`).join('; ')) + '.' : ''} ‘협조 0’은 연결된 최초 발사 분기에 측정된 협조 요청 구간이 없다는 뜻이며, 전체 항적이나 다른 분기에 협조 사건이 없다는 뜻은 아니다.</p>`);
pages.push(`${h2(10,'실제 통신: 도착 · 실패 · 진행중')}
${table(['배치 / 모드', '도착', '전송중', '예약·미시작', '실패', '채널 대기'], runs.map(r => [`${depName(r.dep)} ${modeName(r.mode)}`, ...['delivered', 'inTransit', 'notStarted', 'failed', 'queued'].map(k => r.comm[k])]))}
<p class="note">단위는 기록된 통신 간선 통과/전문이다. 다중 홉 전문은 여러 간선으로 센다. cq의 전문 ID가 실제 발신 link.mid로 이어지면 대기 건수에서 제외한다. 노드 ID가 유효하지 않아 제외한 간선/대기/실패 기록은 ${runs.length}개 실행 합계 ${invalidEndpoints}건이다.</p>
<h3>10-1. 통신 종류별 도착 간선 수</h3>
${table(['종류', ...runs.map(r => `${depName(r.dep)} ${r.mode === 'asis' ? 'A' : 'T'}`)], [...new Set(runs.flatMap(r => r.threats.flatMap(t => t.comm.rows.filter(e => e.state === 'delivered').map(e => e.kind))))].sort().map(kind => [esc(kind), ...runs.map(r => r.threats.reduce((n, t) => n + t.comm.rows.filter(e => e.kind === kind && e.state === 'delivered').length, 0))]))}
<h3>10-2. 상태의 의미와 한계</h3><ul>
<li><b>도착:</b> 기록된 link의 도착 시각 t1이 ${DUR}초 이내다. 이는 전송 도착이며, 수신 측이 유효한 최신 상태로 채택했다는 의미는 아니다.</li>
<li><b>전송중:</b> t0 ≤ ${DUR} &lt; t1. 목적지는 도착 노드로 가산하지 않는다.</li>
<li><b>예약·미시작:</b> 기록된 후속 경로의 t0 &gt; ${DUR}. 이미 수행한 전송으로 계산하지 않는다.</li>
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
  pages.push(`${h2(`11-${i + 1}`, `${typeName[type]} · 동일 항적 관측 카드`)}
<p><b>${esc(x.id)}</b> · LEGACY · 생성 ${f(x.spawnT)}초 · 두 모드 모두 시간 분해 가능한 같은 유형의 항적 중 생성 시각이 가장 빠른 사례.</p>
<p class="note">두 카드의 시간 막대는 같은 척도다. 사례 선정은 격추 여부에 조건을 두지 않는다. 이 사례를 유형 전체의 대표 성능이나 효과 크기로 해석하지 않는다.</p>
<div class="cardgrid">${card(a, x, maximum)}${card(b, y, maximum)}</div>
<div class="box small"><b>유형 전체의 분모:</b> LEGACY ${typeName[type]}는 ${a.byType[type].threats}개 발생했다. 최초 발사 시간 측정은 As-Is ${a.byType[type].timed}개, To-Be ${b.byType[type].timed}개다. FULL의 분모와 시간은 8·9절 표에 별도로 제시했다.</div>`);
}
pages.push(`${h2(12,'화면 · 모델 범위 · 해석 한계')}<h3>12-1. 실제 기록과 역할 문맥을 구분하기</h3><p>지휘흐름 화면의 항적 개별 보기는 기록을 하단 「교신·선정·발사 기록」 패널 한 곳에서 보여 준다(2026-09-19 개편으로 같은 사실을 되풀이하던 상단 설명 영역을 없앴다). 그래프의 회색 점선은 배치에 선언된 ICC·ECS·요격부대의 역할 관계이고 실제 명령 전송·접수가 아니다. 역할 관계나 사수 후보 목록에 등장했다는 이유만으로 해당 항적이 그 노드를 통과했다고 세지 않는다. 실제 경로는 기록된 전문과 작업 사건으로 확인한다. 지도의 항적 이름 표시와 패널 접기는 표시만 바꾸며 집계값에 영향이 없다.</p>
<p>도메인 통보는 MCRC·KAMDOC의 통보 처리량·대기·손실을 관측한다. 완료 결과는 IAOC의 결정·명령 발령을 바꾸지 않는다. 도메인별 승인·거부권이 보존된 합동 지휘를 검증했다는 의미가 아니다.</p>
<h3>12-2. 정확히 구분해야 할 진단 용어</h3><ul>
<li><b>재배정:</b> 원 명령과 새 명령을 parentDirectiveId로 이어 최초 발사 계보를 보존한다. 전달 구간에는 해당 중계·재배정 시간이 함께 들어간다.</li>
<li><b>중복해소:</b> 실제 중복 발사와 같지 않다. 교전 상태·이미 존재하는 명령 때문에 새 선택을 억제한 사건일 수 있다.</li>
<li><b>발사불가:</b> 한 시점·한 시도의 실패다. 이후 다른 사수·분기에서 발사하거나 격추할 수 있다.</li>
<li><b>근거 코드:</b> 후보 검토 중 누적된 사유다. 그 코드에 등장한 모든 장비가 명령을 받거나 통신을 수행한 것은 아니다.</li></ul>
<p><b>개입 구조와 시간은 나란히만 제시한다.</b> 아래는 네 기준 실행에서 발사한 항적의 값이다.</p>
${table(['배치 / 모드','측정 항적 n','발사 항적의 노드 중앙값','탐지→최초 발사 중앙값(초)'],runs.map(r=>[`${depName(r.dep)} ${modeName(r.mode)}`,r.summary.timed,f(r.summary.launchedNodes.median),f(r.summary.total.median)]),'',[26,18,26,30])}
<p class="note">개입 노드와 최초 발사 시간은 관측 범위가 다른 지표라 나란히만 제시한다. 과거 보고서의 「초/노드 효율」은 제시하지 않는다. 노드 수는 발사 이후와 다른 분기까지 포함한 전체 관측 기간의 값이고 시간은 최초 발사까지의 값이라, 둘을 나눠 처리 효율로 해석할 근거가 없다.</p>
<h3>12-3. K-JAMDS_파라미터.xlsx의 역할</h3><div class="box">xlsx는 코드 카탈로그와 설정을 읽기 쉽게 내보낸 참조표다. <b>xlsx 수정값을 엔진에 불러오는 기능은 없고</b>, 이 보고서도 xlsx를 입력으로 쓰지 않았다. 시트는 안내·기본설정, 아군자산(LEGACY/FULL), 자산제원(센서·포대·C2), 위협제원·공격경로·조준점, 시나리오, 통신계선(LEGACY/FULL)으로 묶인다.</div>
<h3>12-4. 해석 한계</h3><ul><li>군사 운용 자료로 교정·인정된 시뮬레이터가 아니며, 지상배치 방공 범위의 개념 모델이다.</li><li>결심 시간 평균을 동일화해도 구조·처리 자리·자동화·정보·샘플 선택의 차이가 남는다. 차이 전체를 순수 구조 효과로 부르지 않는다.</li><li>7~11절은 단일 seed의 기록이다. 발사한 항적만 시간 분해에 들어가고, 유형 카드는 설명 사례이지 유형의 대표 성능이 아니다. 잔여 대기를 특정 물리 원인으로 단정하지 않는다.</li><li>정확한 코드 실행과 기록 계정 검증은 실제 C2의 타당성 검증과 다르다. 불확실한 식별, 위임·회수, 단절·복구, 인적 요소는 별도 근거와 설계가 필요하다.</li><li>현실 자산 배치·교전 절차·공격 경로의 최적화를 이 결과로 권고하지 않는다.</li></ul>`);
pages.push(`${h2(13,'재현 · 관측 완전성 · 검산')}<h3>13-1. 재실행 명령</h3><div class="code">D=docs/analysis/2026-09-19-current-reports
node $D/analysis-run.mjs $D/analysis-out.json --workers 2
node $D/c2-analysis-run.mjs --self-test
node $D/c2-analysis-run.mjs
node $D/report-gen.mjs
node $D/render-reports.mjs
node $D/verify-pdfs.mjs</div>
<p>앞의 세 명령이 두 입력 JSON을 새로 만든다. 생성기는 두 JSON의 소스 해시와 네 기준 실행의 계정이 서로 같은지 검사한 뒤 HTML을 쓰고, 마지막 두 명령이 Chrome 인쇄 엔진으로 저장소 루트의 <code>K-JAMDS_분석_방법과_결과.pdf</code>를 출력하고 검사한다. HTML·원시 JSON·생성 스크립트를 함께 보존하여 집계표를 검산할 수 있다.</p>
<h3>13-2. C2 기록 실행의 관측 완전성</h3>
${table(['배치 / 모드','항적','flow 사건','C2 사건','항적/flow/C2 절단'],runs.map(r=>[`${depName(r.dep)} ${modeName(r.mode)}`,`${r.coverage.traces}/${r.global.spawned}`,r.coverage.flowEvents,r.coverage.c2Events,[r.coverage.traceTruncated,r.coverage.flowTruncated,r.coverage.c2EventsTruncated].map(x=>x?'있음':'없음').join(' / ')]),'',[24,14,18,18,26])}
<p class="note">설정 상한: traceCap 5,000 · flowTraceCap 500,000 · c2EventCap 500,000. 통신 사건 수에는 노드 접수/처리 관측도 들어가므로 통신 간선 도착 수와 다르다. 기록 절단과 ${DUR}초 시점의 미해결(검열)은 별개다. JSON에는 항적별 시간 계보·정식 노드·관측 통신을 보존하고, 엔진 전체 raw 상태는 포함하지 않는다.</p>
<h3>13-3. 기계적 검산</h3><ul><li>모든 분석 셀에서 생성 = 격추 + 확정 누수 + 종료 미해결. 모든 실행의 주원인 합계 = 확정 누수.</li><li>20쌍의 각 seed에서 양 모드의 생성 위협 수 일치.</li><li>네 기준 실행의 생성·격추·누수·미해결·발사 횟수와 발사 항적 수가 실험 집계와 C2 기록 사이에서 일치. 계보에서 빠진 발사가 없는 실행은 탐지→최초 발사 평균도 일치하고, 빠진 수는 기록된 제외 사유의 합과 같다.</li><li>C2 파서 self-test: 다른 지휘 분기의 혼입, ICC 자식 명령의 계보, 다른 발사의 BDA 혼입, 기록 절단, 도착/실패/대기 상태와 정식 노드 필터를 합성 사례로 검증.</li><li>UI 파서의 실제 불리언 설정을 카탈로그에 전달하며 엔진·어댑터·프로토타입 SHA-256을 두 JSON에 저장. 표·본문 수치는 재실행 JSON에서 생성.</li></ul>
<p class="note">검산은 코드·기록 일관성의 검사다. 신뢰구간의 좁음, 회귀 통과, PDF의 시각 검토가 현실의 군사적 검증을 대신하지 않는다. 결과 인용에는 커밋·설정·배치·시나리오·seed 집합·종료 시점을 함께 기재한다.</p>`);
pages.push(`${h2(14,'버전 · 기본 기능 · 변경 이력')}<h3>14-1. 버전과 추적성</h3><p class="small">Git 기준 <code>${esc(D.meta.sourceCommit)}</code>. 실험 집계 생성 ${esc(D.meta.generatedAt)} · C2 기록 생성 ${esc(data.meta.generatedAt)}. 작업 중 파일 변경은 아래 내용 해시로 식별한다.</p>
${table(['파일','SHA-256'],Object.entries(D.meta.sourceHashes).map(([k,v])=>[esc(k),`<code>${esc(v)}</code>`]),'kv',[37,63])}
<h3>14-2. 현재 기본 기능</h3><p class="small">시나리오 sc3 · seed 29 · ${DUR}초 · ×1 · iads-c2. 두 배치/두 모드를 제외한 기능은 실제 화면 기본값에서 가져왔다.</p>
<div class="flaglist">${Object.entries(D.meta.flags).map(([k,v])=>`<div><code>${esc(k)}</code>: <b>${esc(v)}</b></div>`).join('')}</div>
<h3>14-3. 이번 갱신에 반영한 내용</h3>${tbl(['항목','내용'],[['문서 통합','「분석 방법과 결과」와 「C2 분석결과」를 SC3 기준 한 권으로 통합. 중복되던 요약·한계·재현·버전 절은 한 번만 수록'],['기본 관측 시간',`600초 → ${DUR}초(ADR-101). 모든 셀과 C2 기록을 새 기본값으로 다시 실행. 600초판의 요약은 previous-600s-summary.json에 보존하고 3-2절에서 비교`],['엔진 불변','엔진·카탈로그 어댑터의 해시는 600초판과 같다. 수치 변화는 관측 시간에서만 온다'],['엔진 상태','계통별 실패 격리, 상태정보 생성시각·순서, 명령 발령자·부모 명령 계보(ADR-100)'],['설정·관측','기본 플래그 타입 정규화, 전체 생성·격추·누수·미해결과 상세 기록 표본 분리'],['화면 표시','항적 기록을 하단 패널 하나로 통합, 지도 항적 이름 표시; 집계값 불변'],['실행 규모','기준선 12 + OAT 64 + seed 반복 80 + 강도 20 + 관측창 6 = 182; 탐침 1, C2 기록 4 별도']],'kv',[18,82])}
<p class="small">실제 작전 체계·기밀 성능·교전 규칙의 검증 자료가 아니다. XLSX는 참고·내보내기 자료이며 엔진의 실행 입력으로 읽지 않는다.</p>`);
const extra = `<style>.cardgrid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.trackcard{border:1px solid #c2ccd6;border-top:3px solid #24628b;padding:8px}.trackcard h3{font-size:9.5pt;margin:7px 0 4px}.trackcard .small,.trackcard .note{font-size:7.6pt;line-height:1.35}.trackcard table{font-size:7.4pt;margin:4px 0}.trackcard th,.trackcard td{padding:3px 4px}.trackcard svg{width:100%;display:block}.segmentvalues{display:flex;flex-wrap:wrap;gap:3px 8px;font-size:7.4pt}.segmentvalues i{display:inline-block;width:7px;height:7px;margin-right:3px}.flaglist{columns:2;font-size:7.6pt;line-height:1.5;background:#f2f6fa;padding:8px 12px}.flaglist div{break-inside:avoid}.flaglist code{font-size:7.1pt}</style>`;
const html=pagesHTML('K-JAMDS 분석 방법과 결과 · SC3 통합',pages,D.meta.sourceCommit).replace('</head>',`${extra}</head>`);
fs.writeFileSync(output,html);
console.log('written',output,'pages',pages.length);
