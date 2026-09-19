import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { HERE, stats } from './report-common.mjs';
import { escapeHTML as esc, table as tbl, pagesHTML } from './report-style.mjs';
const D=JSON.parse(fs.readFileSync(process.argv[2]||path.join(HERE,'analysis-out.json'),'utf8'));
const output=process.argv[3]||path.join(HERE,'report.html');
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
const pages=[];
pages.push(`<div class="eyebrow">CURRENT SOURCE · 재실행 보고서</div><h1>K-JAMDS 지휘통제 모의분석<br>분석 방법과 결과</h1><p class="subtitle">수정된 상태·설정·관측 계정과 현재 화면 기본값을 적용한 재현 결과</p>
<p>작성일 2026-09-19 · 소스 ${esc(D.meta.sourceCommit.slice(0,7))}<br>지상배치 방공 C2 개념 시뮬레이션 · 실제 작전 성능의 검증 자료가 아님</p>
<div class="metrics"><div class="metric"><strong>182 + 1</strong><span>분석 실행 + 별도 탐침 실행</span></div><div class="metric"><strong>20쌍</strong><span>배치별 SC3 동일 seed 비교</span></div><div class="metric"><strong>16종</strong><span>한 번에 하나씩 바꾸는 조건</span></div></div>
<h3>현재 기본 예시: SC3 · seed 29 · 600초 · 강도 ×1</h3>
${tbl(['배치','구조','생성','격추','확정 누수','종료 미해결','중복 사건'],[la,lt,fa,ft].map(r=>[DEP[r.dep].split(' · ')[0],MOD[r.mode],r.spawned,r.killed,r.leaked,r.censored,r.dup]))}
<div class="box"><b>핵심 관측</b><p>기본 배치의 확정 누수 차이(To-Be−As-Is)는 ${sign(lt.leaked-la.leaked)}개, 확대 배치는 ${sign(ft.leaked-fa.leaked)}개다. 같은 실행에서도 각각 ${la.censored}/${lt.censored}개와 ${fa.censored}/${ft.censored}개가 미해결 상태다. 종료 전에 확정된 결과와 남은 위협을 함께 읽어야 한다.</p>
<p>20개 seed의 평균 누수율 차이(전체 생성 분모)는 기본 배치 ${ci(D.paired[deps[0]].leakRateSpawn,100)}%p, 확대 배치 ${ci(D.paired[deps[1]].leakRateSpawn,100)}%p다. 대괄호는 쌍대 차이의 95% 신뢰구간이다.</p></div>
<p class="note">동일화 ON은 IAOC 운용자 평균을 30초로 맞춘다. 서버 수·체계 성분·절차·정보 경로까지 모두 같게 만드는 설정은 아니다. seed 29는 재현 예시이며 평균 성능을 대표한다고 가정하지 않는다.</p>
<p class="small">이전 문서의 178회·15조건 표기를 182개 분석 셀·16조건으로 정정했다. 최신 역할 문맥도는 책임 관계 설명이며 실제 통신 기록을 추가하지 않는다.</p>`);

pages.push(`<h2>1. 분석 방법과 실행 조건</h2><h3>1-1. 분석 설계와 표본</h3>
${tbl(['구분','실험 설계','실행 수'],[['기준선','2배치 × SC1/SC2/SC3 × 2구조',12],['조건별 OAT','2배치 × 2구조 × 16조건; SC3, seed 29',64],['seed 반복','2배치 × 2구조 × seed 20개; SC3',80],['강도 스윕','2배치 × 2구조 × 강도 1/1.5/2/2.5/3',20],['관측창 비교','LEGACY × 2구조 × 600/1200/1800초',6],['별도 탐침','LEGACY As-Is 기본 조건; 분석 182셀에 미포함',1]],'kv',[20,66,14])}
<h3>1-2. 화면의 실제 기본값을 그대로 읽기</h3><p>러너가 <code>prototype/command-flow.html</code>의 PARAMS, 타입 파서, features 함수를 격리된 JavaScript 문맥에서 직접 실행한다. 숫자 1과 불리언 true의 불일치가 남지 않도록 실제 카탈로그에 전달되는 값을 저장한다.</p>
${tbl(['항목','기준 조건'],[['공통','SC3 · seed 29 · 600초 · ×1; 표에서 명시한 요소만 변경'],['기본 ON','협조계선, COP, 자위권, 탄도 발사점 연장, 표적 카탈로그, 결심 시간 동일화, 협조 파이프라인, ICC 중계 인가'],['기본 OFF','원격 교전, 적합도, 무인기 자체 교전, 조기경보 추가 보고, 처리시간 바닥, ECS 추가 집행시간, 별도 명령 발령 작업'],['공유·시간 옵션','연합 공유 null; ICC/ECS/발령 시간은 명시적 재정의 없음'],['코드 기본 ON','고해상도 배치, 표적 산포, 남부 축선, 링크 의미론, 보고주기 동일화, 신선도 모델']],'kv')}
<h3>1-3. 비교가 말해 주는 범위</h3><p>모드 비교는 동일 seed의 위협 생성열을 사용한다. OAT는 한 조건의 모델 내부 효과를 보는 단일 seed 탐색이며, 설정 간 상호작용과 난수 소비 순서 변화가 남는다. 표의 0은 해당 지표가 같았다는 뜻으로, 절차가 실행되지 않았거나 현실에서도 불필요하다는 증거가 아니다.</p>
<p class="note">강도 스윕은 연구 러너에서만 바꾼다. 현재 지휘흐름 화면의 강도는 ×1 고정이며 URL의 x 값은 사용하지 않는다. 이 문서의 입력은 JavaScript 카탈로그와 기능 설정이다. xlsx는 참조·내보내기용이고 엔진에 불러오지 않는다.</p>`);

pages.push(`<h2>2. 기준선과 seed 반복</h2><h3>2-1. 시나리오 전체 기준선: seed 29 · 600초 · ×1</h3>
${tbl(['배치','시나리오','구조','생성','격추','누수','미해결','누수/생성','중복','발사'],baselineRows)}
<p class="note">SC2는 위협 비행 시간이 길어 600초 종료 시 확정 결과가 적을 수 있다. 0% 누수를 방어 성공으로 해석하지 않는다. 중복은 엔진의 중복교전 사건 수이며 피해 위협 수나 단순 재발사 수와 같지 않다.</p>
<h3>2-2. SC3의 20개 쌍대 seed: 차이 = To-Be−As-Is</h3>
${tbl(['배치','쌍 수','누수 개수 Δ<br>평균 [95% CI]','누수율 Δ<br>%p [95% CI]','미해결률 Δ<br>%p [95% CI]','누수 감소/<br>동일/증가'],pairedRows)}
<p>seed 집합은 29부터 162까지 7 간격의 20개다. 각 seed의 차이를 먼저 구한 뒤 평균·표본표준편차를 계산한다. 95% CI = 평균 ± t(19, 0.975) × 표준편차/√20이며, 양쪽 실행의 독립 신뢰구간이 겹치는지로 판단하지 않는다.</p>
${tbl(['배치','누수 Δ 중앙값','누수 Δ 최소 / 최대','중복 Δ 평균 [95% CI]','발사 Δ 평균 [95% CI]'],deps.map(dep=>{const p=D.paired[dep];return [DEP[dep],sign(p.leaked.median,1),`${sign(p.leaked.min)} / ${sign(p.leaked.max)}`,ci(p.dup),ci(p.shots)];}))}
<div class="box notice">신뢰구간은 이 개념 모델과 지정한 조건에서의 seed 변동을 요약한다. 실제 군사 효과의 오차 범위가 아니다. 여러 지표·배치를 동시에 살펴본 탐색 분석이며 다중 비교 보정을 하지 않았다.</div>`);

for(const dep of deps)pages.push(`<h2>3. 조건 하나씩 바꾸기 · ${DEP[dep].split(' · ')[0]}</h2><p>SC3 · seed 29 · 600초 · ×1. 각 행은 기준값에서 해당 조건 하나만 바꾼다. Δ는 <b>변경 실행−같은 모드의 기준 실행</b>이다. 미해결 증감을 함께 제시한다.</p>
${tbl(['변경 조건','변경 내용','As-Is<br>Δ누수','As-Is<br>Δ미해결','As-Is<br>Δ중복','To-Be<br>Δ누수','To-Be<br>Δ미해결','To-Be<br>Δ중복'],oatRows(dep),'oat',[17,35,8,8,8,8,8,8])}
<div class="box"><b>읽는 법</b><p>음수 Δ누수는 600초까지 확정된 누수가 줄었다는 관측이다. Δ미해결이 함께 늘면 일부 결과가 뒤로 밀린 것일 수 있다. 개별 조건의 우열·효과 크기를 일반화하려면 그 조건 자체를 여러 seed와 관측창에서 반복해야 한다.</p></div>
<p class="note">계선·생성 위치·시간 분포를 바꾸는 조건도 포함되므로 전부 순수한 지휘구조 개입은 아니다. 본 표만으로 현실의 절차를 제거하거나 자산 배치를 최적화하도록 권고하지 않는다. 전체 실행별 발사·비용·노드 계정은 analysis-out.json에 보존한다.</p>`);

pages.push(`<h2>4. 부하 변화와 관측 대기</h2><p>SC3 · seed 29 · 600초. 노드의 전체 작업 평균 대기(Wq)와 관측 이용률(ρ)을 표시한다. 제대별 작업 종류가 다르므로 같은 수치도 역할을 확인해야 한다.</p>
<h3>4-1. 기본 배치</h3>${tbl(['강도','생성','누수<br>A/T','미해결<br>A/T','Δ누수<br>T−A','As-Is 최장 평균대기','To-Be 최장 평균대기'],sweepRows(deps[0]),'',[9,9,11,12,10,24.5,24.5])}
<h3>4-2. 확대 배치</h3>${tbl(['강도','생성','누수<br>A/T','미해결<br>A/T','Δ누수<br>T−A','As-Is 최장 평균대기','To-Be 최장 평균대기'],sweepRows(deps[1]),'',[9,9,11,12,10,24.5,24.5])}
<div class="box"><b>병목의 정의를 결과보다 먼저 고정한다.</b><p>엔진의 노드 경고는 ρ≥0.7, 병목 표시는 ρ≥0.9 또는 관측 드롭에 근거한다. 임의의 80%를 포화 기준이나 처리 가능한 위협 수의 보장으로 사용하지 않는다. 평균 이용률만으로 순간 혼잡이나 개별 항적의 인과적 지연을 설명할 수 없다.</p></div>
<p>To-Be MCRC·KAMDOC의 도메인 통보 큐는 IAOC 판단을 차단하지 않는다. 도메인 노드의 대기와 IAOC 결심 경로의 대기를 구분해야 한다. 병목 위치가 협조·무기체계 중 어느 쪽이어야 한다는 결론을 통과 조건으로 고정하지 않는다.</p>
<p class="note">각 강도는 단일 seed 예시다. 증가한 부하가 누수율·병목 개수를 항상 단조 증가시키는 것은 아니다. 종료 미해결, 비선형 상호작용, 표본 경로 변화가 함께 작용한다.</p>`);

pages.push(`<h2>5. 관측창과 누수 원인</h2><h3>5-1. LEGACY · SC3 · seed 29 · ×1</h3>
${tbl(['관측창','생성','누수 A/T','미해결 A/T','누수/생성 A/T','미해결/생성 A/T'],[600,1200,1800].map(dur=>{const a=find('dur',{dur,mode:'asis'}),t=find('dur',{dur,mode:'tobe'});return [dur+'초',a.spawned,`${a.leaked}/${t.leaked}`,`${a.censored}/${t.censored}`,`${rate(a.leakRateSpawn)}/${rate(t.leakRateSpawn)}`,`${rate(a.censoredRate)}/${rate(t.censoredRate)}`];}))}
<p class="note">관측창을 늘리면 기존 항적의 결과뿐 아니라 새 위협도 추가된다. 따라서 이 비교는 동일 코호트 추적이나 정상상태 확인이 아니다. 1800초도 종료 미해결이 있으면 최종 생애 누수율이 아니다.</p>
<h3>5-2. 600초에 확정된 누수의 주원인 · LEGACY</h3>${tbl(['모델의 원인 분류','As-Is','To-Be','Δ'],reasonsRows(deps[0]),'',[58,14,14,14])}
<h3>5-3. 600초에 확정된 누수의 주원인 · FULL</h3>${tbl(['모델의 원인 분류','As-Is','To-Be','Δ'],reasonsRows(deps[1]),'',[58,14,14,14])}
<p class="note">각 표의 원인 합계는 확정 누수와 일치한다. 주원인은 엔진의 규칙으로 귀속한 분류다. 「요격점 미형성」을 모든 C2 반사실에서 불변인 수치로 단정하거나, 그 외 누수 전체를 C2로 제거할 수 있는 몫으로 계산하지 않는다.</p>`);

const dupFlags=['cop','sdf','suit','eor','pipe','icc','aim','par'];
pages.push(`<h2>6. 중복·비용과 시간 지표 읽기</h2><h3>6-1. FULL To-Be의 조건별 중복 변화</h3>
${tbl(['변경 조건','기준 중복','변경 중복','Δ중복','Δ누수','Δ발사'],dupFlags.map(flag=>{const r=find('oat',{dep:deps[1],mode:'tobe',flag});return [FLAGS[flag][0],ft.dup,r.dup,sign(r.dup-ft.dup),sign(r.leaked-ft.leaked),sign(r.shots-ft.shots)];}))}
<p>같은 표적에 대한 복수 발사는 발사 시각·사수·명령·격추 판정을 함께 추적해야 해석할 수 있다. OAT에서 차이가 작다는 이유만으로 중복의 원인을 구조 자체로 확정하지 않는다. 관련 기록의 재구성은 동반 문서 「K-JAMDS C2 분석결과」에서 별도로 다룬다.</p>
<h3>6-2. 기준 실행의 엔진 시간·비용 계정</h3>
${tbl(['배치/구조','생성→최초 실제 발사<br>평균초 / 표본수','탐지→최초 실제 발사<br>평균초 / 표본수','발사수','소모비용<br>개념 $M'],[la,lt,fa,ft].map(r=>[DEP[r.dep].split(' · ')[0]+' '+MOD[r.mode],`${num(r.tte)} / ${r.tteN}`,`${num(r.dec)} / ${r.decN}`,r.shots,num(r.costM)]))}
<div class="box notice"><b>시간 이름을 고쳤다.</b><p>위 표는 성공적으로 발사한 _onIadsFire 경계에서 수집한 값이다. 결과 필드 주석의 「최초 교전명령」은 실제 수집 위치와 다르다. 과거 문서의 첫 지표 「탐지→사격」도 실제로는 생성 시각부터의 값이었다. 발사한 항적만의 평균이며 양 모드의 포함 항적이 다를 수 있다.</p></div>
<p class="note">비용·가치 입력은 개념값이다. 소모비용이나 중복 사건을 실제 예산 손실로 환산하지 않는다. 중복비용(duplicateCostM)은 비용 단위이며 발사 수가 아니다. 시간표의 잔여 대기는 여러 규칙의 영향을 받으므로 전부 물리 대기 또는 지휘구조와 무관한 시간으로 단정하지 않는다.</p>`);

pages.push(`<h2>7. 화면, 모델 범위, xlsx의 역할</h2><h3>7-1. 실제 기록과 역할 문맥을 구분하기</h3><p>최신 지휘흐름 화면의 역할 문맥도는 책임 지휘소·통보 제대·중계·실행 주체의 개념적 관계를 설명한다. 문맥도나 사수 후보 목록에 등장했다는 이유만으로 해당 항적이 그 노드를 통과했거나 명령을 주고받았다고 세지 않는다. 실제 경로는 기록된 전문과 작업 사건으로 확인한다. 기록 패널 접기는 화면 공간만 바꾸며, 선택 항적·탭·기록과 집계값을 유지한다.</p>
<p>도메인 통보는 MCRC·KAMDOC의 통보 처리량·대기·손실을 관측한다. 완료 결과는 IAOC의 결정·명령 발령을 바꾸지 않는다. 도메인별 승인·거부권이 보존된 합동 지휘를 검증했다는 의미가 아니다.</p>
<h3>7-2. K-JAMDS_파라미터.xlsx 활용</h3><div class="box">현재 xlsx는 코드 카탈로그와 설정을 읽기 쉽게 내보낸 참조표다. <b>xlsx 수정값을 엔진에 불러오는 기능은 없다.</b> 이 보고서도 xlsx를 입력으로 사용하지 않았다.</div>
${tbl(['시트 묶음','참조 목적'],[['안내·기본설정','내보낸 코드 버전·기본값·플래그와 화면 적용값 확인'],['아군자산_LEGACY / FULL','카탈로그 자산 ID·유형·개념좌표·소속 확인'],['자산제원_센서 / 포대 / C2','유형별 값·단위·근거와 유효 처리시간 구분'],['위협제원·공격경로·조준점','시나리오 입력의 구조와 개념 범위 확인'],['시나리오','유형·축선·도착률·동시 생성 조건 확인'],['통신계선_LEGACY / FULL','모드별 간선·매체·지연 설정 확인']],'kv')}
<h3>7-3. 해석 한계</h3><ul><li>군사 운용 자료로 교정·인정된 시뮬레이터가 아니며, 지상배치 방공 범위의 개념 모델이다.</li><li>결심 시간 평균을 동일화해도 구조·처리 자리·자동화·정보·샘플 선택의 차이가 남는다. 차이 전체를 순수 구조 효과로 부르지 않는다.</li><li>정확한 코드 실행과 기록 계정 검증은 실제 C2의 타당성 검증과 다르다. 불확실한 식별, 위임·회수, 단절·복구, 인적 요소는 별도 근거와 설계가 필요하다.</li><li>현실 자산 배치·교전 절차·공격 경로의 최적화를 이 결과로 권고하지 않는다.</li></ul>`);

pages.push(`<h2>8. 재현, 변경 이력, 확인 항목</h2><h3>8-1. 재실행 명령</h3><div class="code">node docs/analysis/2026-09-19-current-reports/analysis-run.mjs \\
  docs/analysis/2026-09-19-current-reports/analysis-out.json --workers 2
node docs/analysis/2026-09-19-current-reports/report-gen.mjs
node docs/analysis/2026-09-19-current-reports/render-reports.mjs</div>
<p>마지막 명령은 두 HTML을 Chrome 인쇄 엔진으로 저장소 루트의 기존 PDF 이름에 출력한다. 보고서의 HTML·원시 JSON·생성 스크립트를 함께 보존하여 집계표를 검산할 수 있다.</p>
<h3>8-2. 이번 갱신에 반영한 코드 상태</h3>${tbl(['항목','내용'],[['입력 HEAD',`<code>${esc(D.meta.sourceCommit)}</code><br>분석 시작 시점 식별자; UI 표시 변경의 스냅샷 해시는 JSON에 별도 보존`],['엔진 수정','계통별 실패 격리, 상태정보 생성시각·순서, 명령 발령자·부모 명령 계보'],['설정·관측 수정','기본 플래그 타입 정규화, 전체 생성·격추·누수·미해결과 상세 기록 표본 분리'],['표시 변경','역할 문맥·명령 기록·실제 통신의 구분; 개념도는 관측을 추가하지 않음'],['실행 규모','기준선 12 + OAT 64 + MC 80 + 강도 20 + 관측창 6 = 182; 탐침 1 별도'],['동반 C2 분석','기본·확대 배치 × 2모드 = 4개 기록 실행; 본 182셀과 별도']],'kv')}
<h3>8-3. 기계적 검산</h3><ul><li>모든 분석 셀에서 생성 = 격추 + 확정 누수 + 종료 미해결.</li><li>모든 실행의 주원인 합계 = 확정 누수. 20쌍의 각 seed에서 양 모드의 생성 위협 수 일치.</li><li>UI 파서의 실제 불리언 설정을 카탈로그에 전달하며 엔진·어댑터·프로토타입 SHA-256을 JSON 메타데이터에 저장.</li><li>표·본문 수치는 재실행 JSON에서 생성. 과거 하드코딩된 우열·대표성·효율 주장은 제거.</li></ul>
<p class="note">검산은 코드·기록 일관성의 검사다. 신뢰구간의 좁음, 회귀 통과, PDF의 시각 검토가 현실의 군사적 검증을 대신하지 않는다. 결과 인용에는 커밋·설정·배치·시나리오·seed 집합·종료 시점을 함께 기재한다.</p>`);

fs.writeFileSync(output,pagesHTML('K-JAMDS 분석 방법과 결과',pages,D.meta.sourceCommit));
console.log('written',output,'pages',pages.length);
