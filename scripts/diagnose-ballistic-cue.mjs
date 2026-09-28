#!/usr/bin/env node
/**
 * ADR-103·104 §C-1 — 탄도 킬체인 정합 2단계 진단표. FULL_NORMAL · seed 29 · 1800초 · 화면 기본 플래그.
 * 4조건(OFF / A / A+B gain0 / A+B gain0.3) × As-Is·To-Be. 구현 변경 없음(보고서 전용).
 * 실행: node scripts/diagnose-ballistic-cue.mjs [seed] [dur] [--json]
 * 항적별 (a) 그린파인 시작 보고 도착 시각 (b) 큐 도착 시각·자격 포대 수 (c) 천궁-II MFR 사통 최초 시각과 ABM 봉투 체류 겹침
 * (d) 발사 원인별 수 (e) findEarliestPip 실패 이유(flyout > timeToReach / 봉투 밖)를 표로 낸다.
 * ⚠️ 엔진 탄도 고도는 threatPhysics: maxAltitude(srbm 150·mrl 35km) × 거리계수(0.55/1/1.35) × sin(π·progress)다 —
 *    codex 운동학과의 차이는 기록만 한다(수정은 별도 ADR).
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel, findEarliestPip } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js', 'data/threats.js',
  'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = +(args[0] || 29), dur = +(args[1] || 1800), json = process.argv.includes('--json');
const dep = 'HANBANDO_FULL_NORMAL';
const SCREEN = { highResolutionDeployment: true, ballisticLaunchAxes: true, threatAimpoints: true, c2DecisionTimeParity: true,
  approvalPipelineRealism: true, iccRelayAuthorization: true };
const CONDS = [
  ['OFF', {}], ['A', { ballisticReportSource: true }],
  ['A+B g0', { ballisticReportSource: true, standbyCue: true }],
  ['A+B g0.3', { ballisticReportSource: true, standbyCue: true, cueAcquisitionGain: 0.3 }]
];
const R = 6371;
const hav = (a, b) => { const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const g = 2 * R * Math.asin(Math.sqrt(h)); return Math.sqrt(g * g + (b.altKm || 0) ** 2); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +(s[Math.floor(s.length / 2)]).toFixed(1) : null; };
const isBallistic = (t) => t === 'srbm' || t === 'mrl_large';
const abm = KJ.SHOOTER_TYPES.CHEONGUNG2.missiles.ABM, env = abm.engagementEnvelope;
const rows = [];
for (const mode of ['asis', 'tobe']) for (const [label, extra] of CONDS) {
  const features = Object.assign({}, SCREEN, extra);
  const t0 = Date.now();
  const res = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed, endTimeSec: dur, deploymentId: dep,
    modelFidelity: 'iads-c2', features, trace: true, traceCap: 5000, flowTrace: true });
  const cat = KJ.resolveModelCatalog({ deploymentId: dep, mode, modelFidelity: 'iads-c2', features });
  const nodes = KJ.nodesInMode(mode, cat), byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
  const balC2 = mode === 'tobe' ? cat.roles.IAOC : cat.roles.KAMDOC;
  const g = res.global, traces = res.threatTraces, ballistic = traces.filter((tr) => isBallistic(tr.type));
  const links = res.flowEvents.filter((e) => e.k === 'link' && e.mt !== 'fanout'), byTh = {};
  links.forEach((l) => (byTh[l.th] = byTh[l.th] || []).push(l)); Object.values(byTh).forEach((a) => a.sort((x, y) => x.t0 - y.t0));
  const perType = {}, gpArrive = [], cueArrive = [], cueEligible = [], pathCount = {}, fcOverlap = { total: 0, overlap: 0, feasible: 0, flyout: 0 };
  const shotsBy = { CHEONGUNG2: 0, PAC3: 0, LSAM: 0 };
  const batteries = nodes.filter((n) => n.category === 'shooter' && n.typeId === 'CHEONGUNG2');
  for (const tr of traces) {
    const b = perType[tr.type] = perType[tr.type] || { spawned: 0, killed: 0, leaked: 0, d2f: [] };
    b.spawned++; if (tr.outcome === 'killed') b.killed++; else if (tr.outcome && tr.outcome.startsWith('leaked')) b.leaked++;
    const det = tr.stages.find((s) => s.name === '탐지'), fire = tr.stages.find((s) => s.name.startsWith('발사:'));
    if (det && fire) b.d2f.push(fire.t - det.t);
  }
  for (const tr of ballistic) {
    const ls = byTh[tr.id] || [];
    const gp = ls.find((l) => l.to === balC2 && /GREEN_PINE/.test(l.from)); if (gp) gpArrive.push(gp.t1 - tr.spawnT);
    const cueMark = tr.stages.find((s) => s.name.startsWith('사전대기큐발행:'));
    if (cueMark) { const m = cueMark.name.match(/\((\d+)포대\)/); cueEligible.push(m ? +m[1] : 0); }
    const cueArr = tr.stages.filter((s) => s.name.startsWith('사전대기큐도착:')); if (cueArr.length) cueArrive.push(cueArr[0].t - tr.spawnT);
    for (const s of tr.stages.filter((x) => x.name.startsWith('발사:'))) { const sid = s.name.slice(3).split('/')[0]; const n = byId[sid]; if (n && shotsBy[n.typeId] != null) shotsBy[n.typeId]++; }
    const seq = []; ls.filter((l) => l.kind !== 'cue').forEach((l) => { if (seq[seq.length - 1] !== l.from) seq.push(l.from); seq.push(l.to); });
    const key = tr.type + ' | ' + seq.slice(0, 6).map((n) => n.replace(/^(SENSOR|C2|BATTERY)_/, '')).join(' → ');
    pathCount[key] = (pathCount[key] || 0) + 1;
    // (c)(e) 천궁-II 봉투 × MFR 사통
    const th = { axis: tr.axis, target: tr.target, type: tr.type, spawnT: tr.spawnT, dwellSec: tr.dwellSec, _launchExtKm: tr.launchExtKm };
    for (const bt of batteries) {
      const bp = { lat: bt.coord[0], lon: bt.coord[1], altKm: 0 }; let tin = null, tout = null;
      for (let e = 0; e <= Math.floor(tr.dwellSec); e++) { const p = KJ.iadsThreatPosition(th, tr.spawnT + e); const r = hav(bp, p);
        if (r >= env.Rmin && r <= env.Rmax && p.altKm >= env.Hmin && p.altKm <= env.Hmax) { if (tin === null) tin = e; tout = e; } }
      if (tin === null) continue;
      fcOverlap.total++;
      const fcOn = tr.stages.filter((s) => s.name === 'SENSOR_FIRE_CONTROL:' + bt.mfrSensorId).map((s) => s.t - tr.spawnT);
      const fcOff = tr.stages.filter((s) => s.name === 'SENSOR_TRACK_LOST:' + bt.mfrSensorId || s.name === 'SENSOR_FC_DEGRADED:' + bt.mfrSensorId).map((s) => s.t - tr.spawnT);
      if (fcOn.some((on) => { const off = fcOff.find((x) => x > on) ?? Infinity; return on <= tout && off >= tin; })) fcOverlap.overlap++;
      const pip = findEarliestPip({ now: tr.spawnT + tin, remainingSeconds: Math.max(0, tr.dwellSec - tin), missile: abm,
        positionAt: (at) => KJ.iadsThreatPosition(th, at), rangeTo: (pos) => hav(bp, pos) });
      if (pip) fcOverlap.feasible++; else fcOverlap.flyout++;
    }
  }
  const idle = res.nodes.filter((n) => n.category === 'shooter' && !(n.shots > 0)).length;
  const c2 = (id) => { const n = id && res.nodes.find((x) => x.id === id); return n ? +n.rho.toFixed(3) : null; };
  rows.push({ mode, label, ms: Date.now() - t0, killed: g.killed, leaked: g.leaked, censored: g.spawned - g.killed - g.leaked,
    byType: Object.fromEntries(Object.entries(perType).map(([k, v]) => [k, `${v.killed}/${v.leaked}` + (isBallistic(k) ? ` d2f ${median(v.d2f)}` : '')])),
    shotsBy, fireByCause: g.c2Orders.fireByCause, gpArriveMedian: median(gpArrive), cueArriveMedian: median(cueArrive), cueEligibleMedian: median(cueEligible),
    cue: g.standbyCue || null, rhoKAMDOC: c2(cat.roles.KAMDOC), rhoIAOC: c2(cat.roles.IAOC), idleBatteries: idle, fcOverlap,
    topPaths: Object.entries(pathCount).sort((a, b) => b[1] - a[1]).slice(0, 2) });
  console.error(`${mode} ${label}: ${g.killed}/${g.leaked} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
if (json) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
console.log(`# 탄도 킬체인 정합 2단계 진단 — ${dep} · seed ${seed} · ${dur}초 · 화면 기본 플래그\n`);
console.log('| 모드 | 조건 | 격추/누수/미해결 | 방사포 격추/누수·탐지→발사 중앙값 | SRBM | 천궁-II·PAC-3·L-SAM 탄도 발사 | 발사 원인 | 그린파인 시작 도착(초) | 큐 도착(초)·자격 포대 | KAMDOC ρ · IAOC ρ | 유휴 포대 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.mode} | ${r.label} | ${r.killed}/${r.leaked}/${r.censored} | ${r.byType.mrl_large || '-'} | ${r.byType.srbm || '-'} | ${r.shotsBy.CHEONGUNG2}·${r.shotsBy.PAC3}·${r.shotsBy.LSAM} | ${Object.entries(r.fireByCause).map(([k, v]) => k + ' ' + v).join(' · ')} | ${r.gpArriveMedian ?? '-'} | ${r.cueArriveMedian ?? '-'}·${r.cueEligibleMedian ?? '-'} | ${r.rhoKAMDOC ?? '-'} · ${r.rhoIAOC ?? '-'} | ${r.idleBatteries} |`);
console.log('\n(c)(e) 천궁-II ABM 봉투 체류 (항적×포대) — 총 / MFR 사통 겹침 / 봉투 진입 시점 PIP 가능 / 요격탄 비행시간 초과');
for (const r of rows) console.log(`  ${r.mode} ${r.label}: ${r.fcOverlap.total} / ${r.fcOverlap.overlap} / ${r.fcOverlap.feasible} / ${r.fcOverlap.flyout}` + (r.cue ? ` · 큐 계정 ${JSON.stringify(r.cue)}` : ''));
console.log('\n최빈 경로(앞 6노드):'); for (const r of rows) r.topPaths.forEach((p) => console.log(`  ${r.mode} ${r.label}: ${p[1]}× ${p[0]}`));
