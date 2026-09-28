#!/usr/bin/env node
/**
 * ADR-103 §진단 A — FULL_NORMAL에서 천궁-II(22개 포대)가 탄도 위협(srbm·mrl_large)에 한 발도 쏘지 않는 이유를 센다.
 * 구현 변경 없음(보고서 전용). 실행: node scripts/diagnose-cheongung2-ballistic.mjs [bsrc 0|1] [seed] [dur] [mode]
 *
 * 탄도 항적 × 천궁-II 포대마다
 *  (a) ABM 봉투(R 3~50km · H 0.5~20km) 체류 구간(초) — KJ.iadsThreatPosition(엔진과 같은 함수)로 되짚는다
 *  (b) 그 구간에서 해당 포대 MFR의 사격통제(FIRE_CONTROL) 상태 여부 — trace의 SENSOR_* 전이 마크로 복원
 *      (신선도 3초는 마크로 복원할 수 없어 「FC 상태 구간」으로 근사한다)
 *  (c) 결심 시점(사수선정·표적할당 마크, 없으면 봉투 진입 시각)부터 findEarliestPip와 같은 탐색(dt ≤ 300초)을 돌려
 *      실패 이유를 가른다: never_in_envelope(봉투 밖) · flyout_exceeds_dt(봉투 안이나 요격탄 비행시간 > 도달 시간) · feasible
 * 그리고 엔진의 탄도 고도 프로파일(threatPhysics: maxAltitude × 거리계수 × sin(π·progress))이 문서와 어떻게 다른지 적는다.
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

const bsrc = process.argv[2] === '1', seed = +(process.argv[3] || 29), dur = +(process.argv[4] || 1800), mode = process.argv[5] || 'asis';
const dep = 'HANBANDO_FULL_NORMAL';
const features = { highResolutionDeployment: true, ballisticLaunchAxes: true, threatAimpoints: true, c2DecisionTimeParity: true,
  approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: bsrc };
const res = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed, endTimeSec: dur, deploymentId: dep,
  modelFidelity: 'iads-c2', features, trace: true, traceCap: 5000 });
const cat = KJ.resolveModelCatalog({ deploymentId: dep, mode, modelFidelity: 'iads-c2', features });
const nodes = KJ.nodesInMode(mode, cat);
const batteries = nodes.filter((n) => n.category === 'shooter' && n.typeId === 'CHEONGUNG2');
const abm = KJ.SHOOTER_TYPES.CHEONGUNG2.missiles.ABM, env = abm.engagementEnvelope;
const R = 6371;
const hav = (a, b) => { const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const ground = 2 * R * Math.asin(Math.sqrt(h)); return Math.sqrt(ground * ground + (b.altKm || 0) ** 2); };
const ballistic = res.threatTraces.filter((tr) => tr.type === 'srbm' || tr.type === 'mrl_large');
const shots = ballistic.flatMap((tr) => tr.stages.filter((s) => s.name.startsWith('발사:')).map((s) => s.name));
const cheongungShots = shots.filter((s) => /MSAM2|CHEONGUNG/.test(s)).length;

const rows = [], perType = {};
for (const tr of ballistic) {
  const th = { axis: tr.axis, target: tr.target, type: tr.type, spawnT: tr.spawnT, dwellSec: tr.dwellSec, _launchExtKm: tr.launchExtKm };
  const decisions = tr.stages.filter((s) => s.name.startsWith('사수선정·표적할당:')).map((s) => s.t);
  const agg = perType[tr.type] = perType[tr.type] || { threats: 0, anyEnvelope: 0, anyFcOverlap: 0, anyFcAtDecision: 0, anyFeasibleFromDecision: 0, anyFeasibleFromEntry: 0, shotsByCheongung: 0, minAltKm: [] };
  agg.threats++;
  let anyEnv = false, anyFc = false, anyFcAtDecision = false, anyFeasD = false, anyFeasE = false, minAlt = Infinity;
  for (let e = 0; e <= Math.floor(tr.dwellSec); e++) { const p = KJ.iadsThreatPosition(th, tr.spawnT + e); if (p.altKm < minAlt) minAlt = p.altKm; }
  agg.minAltKm.push(minAlt);
  for (const b of batteries) {
    const bp = { lat: b.coord[0], lon: b.coord[1], altKm: 0 };
    let tin = null, tout = null;
    for (let e = 0; e <= Math.floor(tr.dwellSec); e++) {
      const p = KJ.iadsThreatPosition(th, tr.spawnT + e);
      const r = hav(bp, p), inside = r >= env.Rmin && r <= env.Rmax && p.altKm >= env.Hmin && p.altKm <= env.Hmax;
      if (inside) { if (tin === null) tin = e; tout = e; }
    }
    if (tin === null) continue;
    anyEnv = true;
    // (b) MFR FC 구간
    const mfr = b.mfrSensorId;
    const fcOn = tr.stages.filter((s) => s.name === 'SENSOR_FIRE_CONTROL:' + mfr).map((s) => s.t - tr.spawnT);
    const fcOff = tr.stages.filter((s) => (s.name === 'SENSOR_TRACK_LOST:' + mfr || s.name === 'SENSOR_FC_DEGRADED:' + mfr)).map((s) => s.t - tr.spawnT);
    let fcOverlap = false, fcAtDecision = false;
    for (const on of fcOn) { const off = fcOff.find((x) => x > on) ?? Infinity; if (on <= tout && off >= tin) fcOverlap = true;
      if (decisions.length && on <= decisions[0] - tr.spawnT && off >= decisions[0] - tr.spawnT) fcAtDecision = true; }
    if (fcOverlap) anyFc = true;
    if (fcAtDecision) anyFcAtDecision = true;
    // (c) PIP 탐색 — 결심 시점과 봉투 진입 시점
    const pipFrom = (t0) => findEarliestPip({ now: t0, remainingSeconds: Math.max(0, tr.spawnT + tr.dwellSec - t0), missile: abm,
      positionAt: (at) => KJ.iadsThreatPosition(th, at), rangeTo: (pos) => hav(bp, pos) });
    const fromEntry = pipFrom(tr.spawnT + tin);
    const fromDecision = decisions.length ? pipFrom(decisions[0]) : null;
    if (fromEntry) anyFeasE = true;
    if (fromDecision) anyFeasD = true;
    // 실패 이유: 봉투 안인데 flyout > dt?
    let reason = fromEntry ? 'feasible' : 'flyout_exceeds_dt';
    rows.push({ threat: tr.id, battery: b.id, tin, tout, fcOverlap, fcAtDecision, fcOnCount: fcOn.length, decisionT: decisions[0] != null ? +(decisions[0] - tr.spawnT).toFixed(1) : null,
      pipFromEntry: fromEntry ? +fromEntry.timeToReach.toFixed(1) : null, pipFromDecision: fromDecision ? +fromDecision.timeToReach.toFixed(1) : null, reason });
  }
  if (anyEnv) agg.anyEnvelope++; if (anyFc) agg.anyFcOverlap++; if (anyFcAtDecision) agg.anyFcAtDecision++; if (anyFeasD) agg.anyFeasibleFromDecision++; if (anyFeasE) agg.anyFeasibleFromEntry++;
}
const evidence = {};
for (const tr of ballistic) { const ev = (tr.failure && tr.failure.evidence) || tr.evidence || {}; for (const k of Object.keys(ev)) evidence[k] = (evidence[k] || 0) + 1; }
const apex = (type, distKm) => { const p = KJ.IADS.threatPhysics(type, 0.5, distKm); return +(p.altitude / 1000).toFixed(1); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

console.log(`# 천궁-II 탄도 미교전 진단 — ${dep} · ${mode} · seed ${seed} · ${dur}초 · bsrc=${bsrc ? 1 : 0}`);
console.log(`천궁-II 포대 ${batteries.length}개 · ABM 봉투 R ${env.Rmin}~${env.Rmax}km · H ${env.Hmin}~${env.Hmax}km · 요격탄 ${abm.missileSpeed}m/s`);
console.log(`탄도 항적 ${ballistic.length}개 · 전체 발사 마크 ${shots.length}건 중 천궁-II 발사 ${cheongungShots}건`);
console.log('\n| 유형 | 항적 | 어느 천궁-II 봉투라도 체류 | 봉투∩MFR 사격통제 | **첫 결심 시점에 MFR 사격통제** | 봉투 진입 시점 PIP 가능 | 첫 결심 시점 PIP 가능 | 최저 고도 중앙값(km) |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [t, a] of Object.entries(perType)) console.log(`| ${t} | ${a.threats} | ${a.anyEnvelope} | ${a.anyFcOverlap} | ${a.anyFcAtDecision} | ${a.anyFeasibleFromEntry} | ${a.anyFeasibleFromDecision} | ${median(a.minAltKm).toFixed(1)} |`);
const reasons = {}; rows.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
console.log(`\n(항적×포대) 봉투 체류 쌍 ${rows.length}건 — PIP 이유 분포: ${JSON.stringify(reasons)} · MFR FC 겹침 ${rows.filter((r) => r.fcOverlap).length}건 · 첫 결심 시점 FC ${rows.filter((r) => r.fcAtDecision).length}건`);
const decDelay = rows.filter((r) => r.decisionT != null).map((r) => r.tin - r.decisionT);
console.log(`첫 결심 시점 → 봉투 진입까지(초): 중앙값 ${median(decDelay)} · 최소 ${Math.min(...decDelay)} — 결심은 봉투 진입 훨씬 전에 나고, 그 순간 천궁-II MFR은 사격통제 상태가 아니다(사거리 밖)`);
const dwell = rows.map((r) => r.tout - r.tin + 1);
console.log(`봉투 체류 길이(초): 중앙값 ${median(dwell)} · 최대 ${Math.max(...dwell, 0)}`);
console.log(`\n탄도 항적 증거 코드 분포(trace): ${JSON.stringify(evidence)}`);
console.log(`\n엔진 고도 프로파일(threatPhysics · 진행률 0.5의 정점, km): srbm 거리 140→${apex('srbm', 140)} · 545→${apex('srbm', 545)} / mrl_large 거리 197→${apex('mrl_large', 197)} · 372→${apex('mrl_large', 372)}`);
console.log('  (= maxAltitude srbm 150km·mrl 35km × 거리계수 0.55/1/1.35 × sin(π·progress). ADR-097 본문의 「정점 70km」와 다르다 — 문서 대조는 ADR-103 §진단 A 참조)');
console.log('\n예시 행(최초 5건):'); rows.slice(0, 5).forEach((r) => console.log('  ' + JSON.stringify(r)));
