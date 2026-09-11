// C2 결심 흐름 분석 러너 — 항적별 개입 노드·홉·결심 시간 분해를 트레이스에서 재구성한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = fs.existsSync(path.join(here, '../../../scripts/experiment-lib.mjs')) ? path.join(here, '../../..') : '/Users/daehyunyoo/Library/CloudStorage/GoogleDrive-dhyoo970111@gmail.com/내 드라이브/Air_Defense';
const { loadEngine } = await import(path.join(ROOT, 'scripts/experiment-lib.mjs'));
const KJ = loadEngine();
const F = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true,
  sensorReportParity: true, sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true,
  approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true };
const SHORT = id => String(id)
  .replace(/^C2_KAMD_OPS_KAMD_OPS$/, 'KAMDOC').replace(/^KAMD_OPS$/, 'KAMDOC')
  .replace(/^C2_MCRC_MCRC$/, 'MCRC').replace(/^C2_IAOC_IAOC$/, 'IAOC')
  .replace(/^C2_ARMY_LOCAL_AD_ARMY_(\w+?)_AD$/, '군단AOC_$1').replace(/^ARMY_LOCAL_AD$/, '군단AOC')
  .replace(/^C2_ARMY_LOCAL_AD_(.+)$/, '군단AOC_$1')
  .replace(/^C2_ICC_ICC_(\w+)$/, 'ICC_$1').replace(/^ECS_(\w+)$/, 'ECS_$1').replace(/^BATTERY_(\w+)$/, '포대_$1')
  .replace(/^SENSOR_(\w+)$/, '센서_$1');
const ECH = id => /^SENSOR_|^센서_/.test(id) ? 'sensor' : /ICC/.test(id) ? 'relay' : /^ECS_/.test(id) ? 'exec' : /^BATTERY_|^포대_/.test(id) ? 'battery' : 'c2';
function parse(t, links) {
  const st = t.stages, ev = [];
  const first = re => st.find(s => re.test(s.name));
  const all = re => st.filter(s => re.test(s.name));
  const nodeOf = s => { const m = /:([^\s(→←/]+)/.exec(s.name); return m ? m[1] : null; };
  const detect = first(/^탐지$/) || first(/^SENSOR_DETECTED:/);
  const detectT = detect ? detect.t : null;
  const firstSensor = (first(/^SENSOR_DETECTED:/) || {}).name?.slice(16) || null;
  const commanders = [...new Set(all(/^책임C2:/).map(s => s.name.slice(5)))];
  const arrivals = {}; for (const s of all(/^항적정보접수:/)) { const n = nodeOf(s); if (!(n in arrivals)) arrivals[n] = s.t; }
  const preps = {}; for (const s of all(/^위협판단·표적할당준비:/)) { const n = nodeOf(s); if (!(n in preps)) preps[n] = s.t; }
  const coordStart = first(/^협조개시:|^감독승인개시:/), coordEnd = first(/^승인완료:/), coordDone = first(/^승인회신처리완료:/);
  const selects = all(/^사수선정·표적할당:/).map(s => { const m = /:([^→]+)→(\S+)/.exec(s.name); return { t: s.t, by: m[1], battery: m[2] }; });
  const relayIn = first(/^교전명령중계접수:/), relayOk = first(/^교전명령인가:/), ecsIn = first(/^교전명령접수:/);
  const reassign = all(/^교전명령재배정:/).length, bounce = all(/^교전명령반송:/).length, noFire = all(/^발사불가:/).length;
  const launches = all(/^발사:|^자위권발사:/).map(s => ({ t: s.t, battery: nodeOf(s), self: s.name.startsWith('자위권') }));
  const hits = all(/^BDA:HIT/).length, misses = all(/^BDA:MISS/).length;
  const dedup = all(/^교전중복해소:/).length;
  // 개입 노드 — 마크와 링크 양쪽에서 모은다(센서 제외)
  const nodes = new Set();
  for (const s of st) { if (/^SENSOR_/.test(s.name)) continue; const n = nodeOf(s); if (n && !/^SENSOR_/.test(n) && n !== 'COP' && !/^\d/.test(n)) nodes.add(SHORT(n)); const m = /→([^\s(→←/]+)/.exec(s.name); if (m && !/^SENSOR_/.test(m[1]) && !/^교전중복해소/.test(s.name)) nodes.add(SHORT(m[1])); }
  for (const l of links) { for (const x of [l.from, l.to]) if (!/^SENSOR_/.test(x)) nodes.add(SHORT(x)); }
  // 정규화: 'KAMDOC'와 'KAMDOC'(같은), '군단AOC'(인스턴스 미상)는 인스턴스가 있으면 제거
  if ([...nodes].some(n => /^군단AOC_/.test(n))) nodes.delete('군단AOC');
  for (const n of [...nodes]) if (/^(HIT|MISS|L\d|PIP)/.test(n)) nodes.delete(n);
  const nodeList = [...nodes];
  const byEch = { c2: 0, relay: 0, exec: 0, battery: 0 };
  for (const n of nodeList) { const e = /ICC/.test(n) ? 'relay' : /^ECS_/.test(n) ? 'exec' : /^포대_/.test(n) ? 'battery' : 'c2'; byEch[e]++; }
  // 결심 시간 분해 — 최초 발사 기준
  let dec = null;
  const sel = selects[0], launch = launches.find(l => !l.self) || launches[0];
  if (sel && launch && detectT != null) {
    const by = sel.by;
    const arr = arrivals[by] ?? Math.min(...Object.values(arrivals).filter(Number.isFinite), Infinity);
    const prep = preps[by] ?? arr;
    const coord = (coordStart && coordStart.t < sel.t && coordEnd) ? Math.max(0, (coordDone || coordEnd).t - coordStart.t) : 0;
    const readyAt = Math.max(prep, (coordStart && coordStart.t < sel.t && coordEnd) ? (coordDone || coordEnd).t : prep);
    dec = { report: arr - detectT, process: prep - arr, coord, wait: Math.max(0, sel.t - readyAt), deliver: launch.t - sel.t, total: launch.t - detectT };
    dec.procedure = dec.process + dec.coord + dec.deliver; dec.physics = dec.report + dec.wait;
  }
  const cmdHops = sel && launch ? links.filter(l => (l.kind === 'command' || l.kind === 'coord') && l.t0 >= sel.t - 0.01 && l.t0 <= launch.t + 0.01).length : null;
  const reportHops = detectT != null ? links.filter(l => l.kind === 'report' && l.t0 <= (Math.min(...Object.values(arrivals).filter(Number.isFinite), Infinity)) + 0.01).length : null;
  // 카드용 사건 열
  const push = (s, label, node) => ev.push({ t: +s.t.toFixed(1), label, node: SHORT(node || nodeOf(s) || '') });
  if (detect) push(detect, '탐지', firstSensor);
  for (const [n, tt] of Object.entries(arrivals)) ev.push({ t: +tt.toFixed(1), label: '항적 접수', node: SHORT(n) });
  for (const [n, tt] of Object.entries(preps)) ev.push({ t: +tt.toFixed(1), label: '식별·표적할당 준비', node: SHORT(n) });
  if (coordStart) push(coordStart, '교전 협조 요청', /→(\S+)/.exec(coordStart.name)?.[1] || nodeOf(coordStart));
  if (coordEnd) push(coordEnd, '교전 협조 완료', nodeOf(coordEnd));
  if (sel) ev.push({ t: +sel.t.toFixed(1), label: '사수선정 → ' + SHORT(sel.battery), node: SHORT(sel.by) });
  if (relayIn) push(relayIn, '명령 중계 접수'); if (relayOk) push(relayOk, '명령 인가'); if (ecsIn) push(ecsIn, '명령 접수');
  if (launch) ev.push({ t: +launch.t.toFixed(1), label: launch.self ? '자위권 발사' : '발사', node: SHORT(launch.battery) });
  const bda = first(/^BDA:/); if (bda) ev.push({ t: +bda.t.toFixed(1), label: bda.name.includes('HIT') ? '격추' : '명중 실패', node: SHORT(nodeOf({ name: bda.name.replace(/^BDA:(HIT|MISS)/, 'x') }) || '') });
  ev.sort((a, b) => a.t - b.t);
  if (bda) { const cut = +bda.t.toFixed(1); while (ev.length && ev[ev.length - 1].t > cut) ev.pop(); }
  return { id: t.id, type: t.type, outcome: t.outcome, spawnT: t.spawnT, detectT, firstSensor: firstSensor ? SHORT(firstSensor) : null, commanders, nodes: nodeList, byEch,
    nodeCount: nodeList.length, cmdHops, reportHops, parallel: commanders.length, selects: selects.length, launches: launches.length, hits, misses, reassign, bounce, noFire, dedup, dec, events: ev,
    links: links.map(l => ({ from: SHORT(l.from), to: SHORT(l.to), kind: l.kind, mt: l.mt, t0: +l.t0.toFixed(1), d: +l.d.toFixed(1) })) };
}
const out = { meta: { sc: 'sc3', seed: 29, dur: 600, flags: F }, runs: {} };
for (const dep of ['HANBANDO_LEGACY_NORMAL', 'HANBANDO_FULL_NORMAL']) for (const mode of ['asis', 'tobe']) {
  const r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 600, deploymentId: dep, modelFidelity: 'iads-c2',
    trace: true, traceCap: 5000, flowTrace: true, flowCap: 500000, features: F });
  const linksByTh = {}; for (const e of r.flowEvents) if (e.k === 'link' && e.th) (linksByTh[e.th] = linksByTh[e.th] || []).push(e);
  const threats = r.threatTraces.map(t => parse(t, linksByTh[t.id] || []));
  out.runs[dep + '|' + mode] = { dep, mode, flowTruncated: !!r.flowTruncated, spawned: r.global.spawned, killed: r.global.killed, leaked: r.global.leaked, threats };
  console.error(dep.slice(9, 13), mode, 'threats', threats.length, 'flowTruncated', !!r.flowTruncated, 'launched', threats.filter(t => t.dec).length);
}
fs.writeFileSync(process.argv[2] || 'c2-analysis-out.json', JSON.stringify(out));
// 요약 출력
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
for (const [k, run] of Object.entries(out.runs)) {
  console.error('\n== ' + k);
  const types = [...new Set(run.threats.map(t => t.type))];
  for (const ty of types) { const T = run.threats.filter(t => t.type === ty), L = T.filter(t => t.dec);
    console.error(ty.padEnd(10), 'n', T.length, 'launched', L.length, 'nodes', med(T.map(t => t.nodeCount)), 'c2', med(T.map(t => t.byEch.c2)), 'relay', med(T.map(t => t.byEch.relay)), 'hops', med(L.map(t => t.cmdHops)), 'par', med(T.map(t => t.parallel)),
      'rep', med(L.map(t => t.dec.report))?.toFixed(1), 'proc', med(L.map(t => t.dec.process))?.toFixed(1), 'coord', med(L.map(t => t.dec.coord))?.toFixed(1), 'wait', med(L.map(t => t.dec.wait))?.toFixed(1), 'deliv', med(L.map(t => t.dec.deliver))?.toFixed(1), 'total', med(L.map(t => t.dec.total))?.toFixed(1)); }
}
