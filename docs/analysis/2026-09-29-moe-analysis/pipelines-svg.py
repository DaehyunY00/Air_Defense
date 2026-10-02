"""fig/pipelines.json → fig/pipeline-<type>.svg. 위협 유형마다 As-Is(위)·To-Be(아래) 블록, 블록 안의 한 줄이 실제로 관측된 결심 사슬 한 가지
(레이더 → 지휘소·사격통제소 … → 발사 포대). 상자 색 = 노드 종류, 화살표 색·점선 = 매체, 화살표 위 숫자 = 그 구간 전송 중앙 지연(초).
실행: python3 docs/analysis/2026-09-29-moe-analysis/pipelines-svg.py"""
import json, os, re, html
HERE=os.path.dirname(os.path.abspath(__file__)); FIG=os.path.join(HERE,'fig')
d=json.load(open(os.path.join(FIG,'pipelines.json'),encoding='utf-8'))
TYPE_KO={'srbm':'탄도탄','mrl_large':'방사포(대형)','cruise':'순항미사일','fighter':'전투기','uav_small':'소형 무인기'}
LOC={'SEONGJU':'성주','CHUNGBUK':'충북','CHUNGNAM':'충남','CAPITAL':'수도','MID_NORTH':'중북','SOUTH':'남부','BUKAKSAN':'북악산','CHEONAN':'천안','YEONCHEON':'연천','CHUNGJU':'충주','INCHEON':'인천','GIMPO':'김포','YEONPYEONG':'연평','CHEONGJU':'청주','GWANGJU':'광주','ICHEON':'이천','POHANG':'포항','DAEGU':'대구','CASEY':'케이시','OSAN':'오산','HUMPHREYS':'험프리스','KUNSAN':'군산','CHEORWON':'철원','GANGHWA':'강화','DANGJIN':'당진','WONJU':'원주','SUWON':'수원','BUSAN':'부산','ULSAN':'울산','ANDONG':'안동','JEONNAM':'전남','JEONBUK':'전북','GYEONGGI':'경기','GANGWON_N':'강원북','GANGWON_S':'강원남','GYEONGBUK_N':'경북북','GYEONGBUK_S':'경북남','BAENGNYEONG':'백령','ULLEUNG':'울릉','MOKPO':'목포','YEOSU':'여수','CAMP_WALKER':'캠프워커','PYEONGTAEK':'평택','SEOUL':'서울','HWASEONG':'화성'}
C2_KO=[('KAMD_OPS','탄도탄작전통제소'),('IAOC','통합공중작전통제소'),('MCRC','중앙방공통제소'),('ICC_BRIGADE_1','방공여단 통제소 1'),('ICC_BRIGADE_2','방공여단 통제소 2'),('ICC_BRIGADE_3','방공여단 통제소 3'),('WEST_FRONT','서부 군단 방공'),('CENTRAL_FRONT','중부 군단 방공'),('EAST_FRONT','동부 군단 방공'),('CAPITAL_DEF','수방사 방공'),('USFK_THAAD_C2','THAAD 지휘소'),('USFK_PATRIOT_C2','Patriot 지휘소')]
TYPEKO={'THAAD':'THAAD','LSAM':'L-SAM','PAC3':'PAC-3','USFK_PAC3':'미군 Patriot','USFK_PATRIOT':'미군 Patriot','MSAM2':'천궁-II','CHEONGUNG2':'천궁-II','CHUNMA':'천마','BIHO':'비호','GREEN_PINE':'그린파인','AN_TPY2':'AN/TPY-2','FPS117':'FPS-117','TPS880K':'TPS-880K','PATRIOT_MFR':'Patriot 레이더','LSAM_MFR':'L-SAM 레이더','MSAM2':'천궁-II'}
def loc(id_):
    for k,v in sorted(LOC.items(), key=lambda kv:-len(kv[0])):
        if re.search(r'(^|_)'+k+r'(_|$)', id_): return v
    m=re.search(r'CO(\d+)$', id_); 
    if m: return m.group(1)+'중대'
    return ''
def nm(id_, cat, name):
    if cat=='c2' and not id_.startswith('ECS_'):
        for k,v in C2_KO:
            if k in id_: return v
        return name
    core=re.sub(r'^(SENSOR_|BATTERY_|ECS_)','',id_)
    typ=''
    for k,v in sorted(TYPEKO.items(), key=lambda kv:-len(kv[0])):
        if core.startswith(k): typ=v; break
    if core.startswith('USFK_PATRIOT'): typ='미군 Patriot'
    if core.endswith('_MFR') or 'MFR' in core: typ=(typ or '')+' 레이더' if '레이더' not in typ else typ
    l=loc(core)
    if id_.startswith('ECS_'): return (typ+' 사격통제소'+(' '+l if l else '')).strip()
    if cat=='sensor': return (typ+(' '+l if l else '')).strip() or name
    return (typ+(' '+l if l else '')).strip() or name
FILL={'sensor':('#e0f7fa','#0e7490'),'c2':('#e8edf1','#143d5c'),'ecs':('#f3f4f6','#6b7280'),'shooter':('#e3f2e8','#1b7f3b')}
MEDIA={'voice':('#b3261e','6 4','음성'),'chat':('#7c3aed','4 3','채팅'),'voice-vtc':('#b3261e','6 4','음성/VTC'),'datalink':('#143d5c','','데이터링크'),'ifcn':('#143d5c','','통합 사격통제망'),'report-cycle':('#0e7490','','보고 주기'),'internal':('#6b7280','','내부'),'self':('#1b7f3b','2 3','포대 자체 판단'),'kvmf-relay':('#143d5c','3 3','KVMF'),'fanout':('#6b7280','2 3','')}
MAXROWS=8
for ty in ['srbm','mrl_large','cruise','fighter','uav_small']:
    blocks=[]; 
    for mode,label in [('asis','As-Is (분절형)'),('tobe','To-Be (Kill-web 통합형)')]:
        T=d['modes'][mode]['types'][ty]; chains=T['chains']; shown=chains[:MAXROWS]; rest=chains[MAXROWS:]
        blocks.append((mode,label,T,shown,rest))
    maxn=max(len(c['nodes']) for _,_,_,sh,_ in blocks for c in sh)
    W=1240; left=150; bw=max(104,min(150,int((W-left-30)/maxn)-30)); gap=30; rowh=74; bh=44
    rows=sum(len(sh) for *_,sh,_ in blocks)
    H=70+sum(56+len(sh)*rowh+(22 if rest else 0) for *_,sh,rest in blocks)+30
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Apple SD Gothic Neo, Noto Sans KR, Malgun Gothic, WenQuanYi Zen Hei, sans-serif">',
       '<defs><marker id="ah" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 z" fill="#334155"/></marker></defs>',
       f'<rect width="{W}" height="{H}" fill="#fff"/>',
       f'<text x="16" y="26" font-size="15" font-weight="700" fill="#143d5c">{html.escape(TYPE_KO[ty])} — 결심 사슬 전수 (seed 29 · 발사에 이른 항적 · 줄마다 관측된 경우 하나)</text>',
       f'<text x="16" y="44" font-size="10.5" fill="#44525e">상자 색: <tspan fill="#0e7490" font-weight="700">레이더</tspan> · <tspan fill="#143d5c" font-weight="700">지휘소</tspan> · <tspan fill="#6b7280" font-weight="700">포대 사격통제소</tspan> · <tspan fill="#1b7f3b" font-weight="700">발사 포대</tspan>  —  화살표: 실선 데이터링크/통합망 · <tspan fill="#b3261e">붉은 점선 음성</tspan> · <tspan fill="#7c3aed">보라 점선 채팅</tspan> · <tspan fill="#1b7f3b">초록 점선 포대 자체 판단(긴급발사)</tspan> · 숫자 = 구간 전송 중앙 지연(초) · 같은 지휘소가 두 번 나오면 협조 왕복</text>']
    y=62
    for mode,label,T,shown,rest in blocks:
        o.append(f'<rect x="8" y="{y}" width="{W-16}" height="{40+len(shown)*rowh+(22 if rest else 0)}" rx="8" fill="{"#fbfcfd" if mode=="asis" else "#f6fbf7"}" stroke="#d6dde3"/>')
        o.append(f'<text x="20" y="{y+24}" font-size="13.5" font-weight="700" fill="#143d5c">{label} — 발사 도달 {T["fired"]}/{T["total"]}개 · 사슬 {len(T["chains"])}가지</text>')
        yy=y+40
        for c in shown:
            cy=yy+bh/2+6
            o.append(f'<text x="18" y="{cy-4}" font-size="12" font-weight="700" fill="#1d2a35">{c["n"]}건</text>')
            sub=f'노드 {len(c["nodes"])} · 탐지→발사 {round(c["detToFireMed"] or 0)}초'+(f' · 긴급 {c["emergency"]}' if c["emergency"] else '')
            o.append(f'<text x="18" y="{cy+12}" font-size="9.5" fill="#44525e">{html.escape(sub)}</text>')
            x=left
            for i,(nid,cat,name) in enumerate(zip(c['nodes'],c['categories'],c['names'])):
                catk='ecs' if nid.startswith('ECS_') else cat
                f,st=FILL.get(catk,FILL['c2'])
                lab=nm(nid,cat,name)
                o.append(f'<rect x="{x}" y="{yy+6}" width="{bw}" height="{bh}" rx="5" fill="{f}" stroke="{st}" stroke-width="1.4"/>')
                words=lab.split(' '); l1=lab; l2=''
                if len(lab)>12 and len(words)>1: l1=' '.join(words[:-1]); l2=words[-1]
                if l2: o.append(f'<text x="{x+bw/2}" y="{yy+6+bh/2-2}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1d2a35">{html.escape(l1)}</text><text x="{x+bw/2}" y="{yy+6+bh/2+12}" text-anchor="middle" font-size="10" fill="#1d2a35">{html.escape(l2)}</text>')
                else: o.append(f'<text x="{x+bw/2}" y="{yy+6+bh/2+4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1d2a35">{html.escape(l1)}</text>')
                if i<len(c['nodes'])-1:
                    mt=c['media'][i]; col,dash,mlab=MEDIA.get(mt,('#334155','',mt)); dl=c['linkDelayMed'][i]
                    dd=f' stroke-dasharray="{dash}"' if dash else ''
                    o.append(f'<line x1="{x+bw}" y1="{cy}" x2="{x+bw+gap-2}" y2="{cy}" stroke="{col}" stroke-width="1.8"{dd} marker-end="url(#ah)"/>')
                    o.append(f'<text x="{x+bw+gap/2}" y="{cy-6}" text-anchor="middle" font-size="9" fill="{col}" font-weight="700">{round(dl or 0)}</text>')
                x+=bw+gap
            yy+=rowh
        if rest:
            o.append(f'<text x="18" y="{yy+10}" font-size="10" fill="#44525e">그 밖 {sum(r["n"] for r in rest)}건 · {len(rest)}가지 사슬(각 {max(r["n"] for r in rest)}건 이하) — fig/pipelines.json에 전부 있음</text>')
        y+=40+len(shown)*rowh+(22 if rest else 0)+16
    o.append('</svg>')
    open(os.path.join(FIG,f'pipeline-{ty}.svg'),'w',encoding='utf-8').write('\n'.join(o))
    print('wrote',f'pipeline-{ty}.svg',rows,'rows',H)
