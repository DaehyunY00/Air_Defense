import fs from 'node:fs';
import path from 'node:path';
import { ROOT, FIXED, AUDIT_GENERATED_AT, loadProject, runFixed, aggregateOnly, hash, traceSummary, catalogSummary, writeArtifact } from './audit-lib.mjs';

const KJ = loadProject(ROOT);
const deployments = ['legacy', 'HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL'];
const checks = [];
for (const deployment of deployments) {
  for (const mode of ['asis', 'tobe']) {
    const on = runFixed(KJ, { deployment, mode, trace: true });
    const off = runFixed(KJ, { deployment, mode, trace: false });
    const traces = on.threatTraces || [];
    const monotonic = traces.every(tr => tr.stages.every((s, i) => i === 0 || s.t >= tr.stages[i - 1].t));
    const idsUnique = new Set(traces.map(t => t.id)).size === traces.length;
    checks.push({
      deployment, mode,
      aggregateUnchangedByTrace: JSON.stringify(aggregateOnly(on)) === JSON.stringify(off),
      aggregateHashes: { traceOn: hash(aggregateOnly(on)), traceOff: hash(off) },
      monotonicStageTime: monotonic, uniqueThreatIds: idsUnique,
      canonicalTracePresent: false, summary: traceSummary(on)
    });
  }
}
writeArtifact('trace-consistency.json', {
  generatedAt: AUDIT_GENERATED_AT, fixedExperiment: FIXED, checks,
  verdict: checks.every(x => x.aggregateUnchangedByTrace && x.monotonicStageTime && x.uniqueThreatIds) ? 'legacy trace is internally consistent and observational' : 'trace consistency failure',
  limitation: 'Canonical event schema/type/source/payload and detailed sensor/launcher state transitions do not exist, so semantic replay equivalence cannot be verified.'
});

const files = {
  simulation: fs.readFileSync(path.join(ROOT, 'js/ui/sim-view.js'), 'utf8'),
  map: fs.readFileSync(path.join(ROOT, 'js/ui/map-view.js'), 'utf8'),
  main: fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8')
};
writeArtifact('visualization-path.json', {
  generatedAt: AUDIT_GENERATED_AT,
  deploymentVisualization: {
    source: 'resolveModelCatalog → nodesInMode/linksInMode → Leaflet or SVG fallback',
    connected: files.map.includes('catalogFor(state)') && files.map.includes('KJ.nodesInMode(mode, catalog)'),
    catalogs: ['legacy', 'HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL'].flatMap(id => ['asis', 'tobe'].map(mode => catalogSummary(KJ, id, mode)))
  },
  threatReplay: {
    source: 'runDES(trace=true) → threatTraces → buildThreats → KJ.axisPosition',
    usesLegacyTrace: files.simulation.includes('res.threatTraces') && files.simulation.includes('KJ.axisPosition'),
    usesCanonicalEvents: false,
    usesDetailedKinematics: false,
    deterministicDisplayOffsets: true
  },
  analysisAndMc: {
    sameDeploymentForwarded: files.main.includes('deploymentId: state.dep') && files.main.includes('highResolutionDeployment: true'),
    note: 'Analysis/MC use the same compatibility catalog and DES; they are not independent high-resolution consumers.'
  },
  disclaimer: {
    alwaysShownForHighResolutionSelection: files.main.includes('Phase 1 배치·큐·축선 호환 실행'),
    textClass: 'transitional compatibility warning'
  }
});
console.log('wrote trace-consistency.json and visualization-path.json');
