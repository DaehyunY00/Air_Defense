"""pubexp-FULL/PUBLIC JSON → 결과 표(markdown). 실행: python3 docs/analysis/2026-10-03-public-deployment/pubsum.py <json dir>"""
import json, sys, os
d=sys.argv[1]
F=json.load(open(os.path.join(d,'pubexp-HANBANDO_FULL_NORMAL.json'))); P=json.load(open(os.path.join(d,'pubexp-HANBANDO_PUBLIC_NORMAL.json')))
TY={'srbm':'탄도탄','mrl_large':'방사포','cruise':'순항미사일','fighter':'전투기','uav_small':'소형 무인기'}
out=[]
out.append('### 3-1. 전체 결과\n')
out.append('| 배치 · 체계 | seed 29 격추/누수 | seed 30 | seed 31 | 평균 격추 | 격추까지 평균(29) | 발사(29) | 수행 불가 회신(29) | 한미 중복(29) |')
out.append('|---|---|---|---|---|---|---|---|---|')
for lab,D in [('FULL',F),('PUBLIC',P)]:
    for m,mk in [('asis','As-Is'),('tobe','To-Be')]:
        ks=[D[f'{m}#{s}']['g'] for s in (29,30,31)]
        out.append(f"| {lab} · {mk} | {ks[0]['killed']}/{ks[0]['leaked']} | {ks[1]['killed']}/{ks[1]['leaked']} | {ks[2]['killed']}/{ks[2]['leaked']} | {sum(k['killed'] for k in ks)/3:.0f} | {ks[0]['mttk']:.0f}초 | {ks[0]['shots']} | {ks[0]['cantco']} | {ks[0]['dup']} |")
out.append('\n### 3-2. 위협별 격추와 결심 시간 (seed 29 · 격추/전체 · 접수→결심 평균 · 탐지→명중 평균)\n')
out.append('| 위협 | FULL As-Is | FULL To-Be | PUBLIC As-Is | PUBLIC To-Be |'); out.append('|---|---|---|---|---|')
for t,tk in TY.items():
    cells=[]
    for D in (F,P):
        for m in ('asis','tobe'):
            b=D[f'{m}#29']['byType'][t]; cells.append(f"{b['k']}/{b['n']} · {b['dec'] if b['dec'] is not None else '—'}초 · {b['total'] if b['total'] is not None else '—'}초")
    out.append(f"| {tk} | "+' | '.join(cells)+' |')
out.append('\n### 3-3. 포대 부하 (seed 29)\n')
out.append('| 배치 · 체계 | 발사한 포대/전체 | 0발 포대 | 상위 3개 비중 | 최다 발사 |'); out.append('|---|---|---|---|---|')
for lab,D in [('FULL',F),('PUBLIC',P)]:
    for m,mk in [('asis','As-Is'),('tobe','To-Be')]:
        s=D[f'{m}#29']['shots']; out.append(f"| {lab} · {mk} | {s['firing']}/{s['batteries']} | {s['zero']} | {s['top3Share']*100:.0f}% | "+' · '.join(f"{k} {v}" for k,v in s['top'][:5])+' |')
out.append('\n### 3-4. 육군 방공 지휘소 — 전문 수·도착 항적·이용률 (seed 29)\n')
out.append('| 배치 · 체계 | 지휘소별 (전문 / 도착 / 이용률) |'); out.append('|---|---|')
for lab,D in [('FULL',F),('PUBLIC',P)]:
    for m,mk in [('asis','As-Is'),('tobe','To-Be')]:
        out.append(f"| {lab} · {mk} | "+' · '.join(f"{x['name'].replace('육군 ','').replace(' AOC/C2A','').replace(' 상황실','')} {x['msgs']}/{x['arrivals']}/{x['rho']:.2f}" for x in D[f'{m}#29']['lad'])+' |')
out.append('\n### 3-5. 가장 바쁜 지휘소 (seed 29 · 관측 3600초 기준 이용률)\n')
out.append('| 배치 · 체계 | 상위 지휘소 (이용률 · 도착 · 대기) |'); out.append('|---|---|')
for lab,D in [('FULL',F),('PUBLIC',P)]:
    for m,mk in [('asis','As-Is'),('tobe','To-Be')]:
        out.append(f"| {lab} · {mk} | "+' · '.join(f"{x['name'].replace(' 중앙방공통제소','')} {x['rho']:.2f}/{x['arrivals']}/{x['Wq']}초" for x in D[f'{m}#29']['c2top'][:4])+' |')
out.append('\n전문 0건 노드(흐리게 보이는 노드): '+' · '.join(f"{lab} {mk} {D[f'{m}#29']['idle']}/{D[f'{m}#29']['nodes']}" for lab,D in [('FULL',F),('PUBLIC',P)] for m,mk in [('asis','As-Is'),('tobe','To-Be')]))
print('\n'.join(out))
