// 기준 4실행(SC3 · seed 29 · 1배)의 항적별 기록을 다시 뽑는다.
// ../2026-09-21-sc3-final/summary-results.json의 meta.memoryPatches(생성 마감 1800초 · 모든 항적의 결과가
// 확정될 때까지 진행)를 **메모리에서만** 엔진에 적용한다. 저장소의 엔진 파일은 고치지 않는다.
// 재현이 맞는지는 네 실행의 생성·격추·누수·발사·중복·발사 항적 수를 그 JSON과 대조해 검사한다.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../../../js/model/iads/index.js';
import { DEPLOYMENTS, config } from '../2026-09-19-current-reports/report-common.mjs';
import { analyzeTrace } from '../2026-09-19-current-reports/c2-analysis-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..');
const SUMMARY = JSON.parse(fs.readFileSync(path.join(HERE, '../2026-09-21-sc3-final/summary-results.json'), 'utf8'));
const ENGINE_FILES = ['js/config/system-types.js', 'js/config/geo-mdl.js', 'js/config/deployments.js', 'js/data/nodes.js',
  'js/data/links.js', 'js/data/threats.js', 'js/data/scenarios.js', 'js/data/axes.js', 'js/config/deployment-adapter.js',
  'js/core/rng.js', 'js/core/heap.js', 'js/core/constraints.js', 'js/analysis/bottleneck.js', 'js/engine/sim-engine.js',
  'js/analysis/mc-runner.js', 'js/analysis/transition.js', 'js/analysis/overlap-heatmap.js', 'js/analysis/c2-report.js'];

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
for (const rel of ENGINE_FILES) {
  if (rel !== 'js/engine/sim-engine.js') { require(path.join(ROOT, rel)); continue; }
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const p of SUMMARY.meta.memoryPatches) {
    assert.equal(src.split(p.from).length - 1, 1, `patch target must occur exactly once: ${p.name}`);
    src = src.replace(p.from, p.to);
  }
  vm.runInThisContext(src, { filename: 'sim-engine.js (memory-patched: final outcomes)' });
}
const KJ = globalThis.KJ; installIadsKernel(KJ);

const group = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
const out = { meta: { generatedAt: new Date().toISOString(), scenario: 'sc3', seed: 29, intensity: 1,
  birthCutoffSec: SUMMARY.meta.birthCutoffSec, patches: SUMMARY.meta.memoryPatches.map(p => p.name),
  note: 'Engine patched in memory only, exactly as recorded in 2026-09-21-sc3-final/summary-results.json' }, runs: {} };
for (const dep of DEPLOYMENTS) for (const mode of ['asis', 'tobe']) {
  const cfg = config(KJ, { dep, mode, sc: 'sc3', seed: 29, dur: SUMMARY.meta.birthCutoffSec, trace: true, traceCap: 5000,
    flowTrace: true, flowTraceCap: 1000000, c2Analysis: true, c2EventCap: 1000000 });
  const r = KJ.runDES(cfg), g = r.global;
  const ref = SUMMARY.baseline.find(b => b.dep === dep && b.mode === mode);
  assert.deepEqual([g.spawned, g.killed, g.leaked, g.censoredRaw, g.shotsFired, (g.coordination || {}).duplicates ?? ref.dup],
    [ref.spawned, ref.killed, ref.leaked, 0, ref.shots, ref.dup], `${dep} ${mode}: does not reproduce the summary`);
  assert.ok(!r.traceTruncated && !r.flowTruncated && !r.c2EventsTruncated, 'records truncated');
  const catalog = KJ.resolveModelCatalog(cfg), nodeMap = new Map(catalog.nodes.map(n => [n.id, n]));
  const flows = group(r.flowEvents, e => e.th), metrics = group(r.c2Events, e => e.threatId);
  const threats = r.threatTraces.map(t => {
    const a = analyzeTrace(t, flows.get(t.id) || [], metrics.get(t.id) || [], nodeMap, r.config.endTimeSec, true);
    const fired = (metrics.get(t.id) || []).filter(e => e.type === 'ENGAGEMENT_FIRED');
    return { id: t.id, type: t.type, axis: t.axis, spawnT: t.spawnT, outcome: a.outcome, leakReason: t.leakReason || null,
      launches: a.launches, firstFireT: fired.length ? Math.min(...fired.map(e => e.t)) : null,
      selfDefenseShots: fired.filter(e => e.cause === 'self_defense' || /self/.test(String(e.cause))).length,
      decisions: a.decisions, reassign: a.reassign, bounce: a.bounce, noFire: a.noFire, dedup: a.dedup, evidence: a.evidenceCodes };
  });
  assert.equal(threats.filter(t => t.launches).length, ref.decN, `${dep} ${mode}: launched tracks differ from summary`);
  assert.equal(threats.reduce((n, t) => n + t.launches, 0), ref.shots, `${dep} ${mode}: recorded launches differ from shots`);
  out.runs[`${dep}|${mode}`] = { dep, mode, global: { spawned: g.spawned, killed: g.killed, leaked: g.leaked, shots: g.shotsFired, dup: ref.dup },
    observationEndSec: r.config.endTimeSec, threats };
  console.log(dep, mode, 'ok', g.spawned, g.killed, g.leaked, 'shots', g.shotsFired, 'launchedTracks', ref.decN);
}
fs.writeFileSync(path.join(HERE, 'records-out.json'), JSON.stringify(out, null, 1) + '\n');
