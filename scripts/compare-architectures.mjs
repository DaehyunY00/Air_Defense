import { ROOT, FIXED, AUDIT_GENERATED_AT, loadProject, runFixed, metricSummary, delta, traceSummary, pairedThreatDiff, writeArtifact } from './audit-lib.mjs';

const KJ = loadProject(ROOT);
const deployments = ['legacy', 'HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL', 'HANBANDO_FULL_MCRC_DOWN', 'HANBANDO_FULL_KAMDOC_DOWN'];
const comparisons = [];
for (const deployment of deployments) {
  const asis = runFixed(KJ, { deployment, mode: 'asis', trace: true });
  const tobe = runFixed(KJ, { deployment, mode: 'tobe', trace: true });
  const paired = pairedThreatDiff(asis, tobe);
  comparisons.push({
    deployment,
    sameThreatInputCount: paired.filter(x => x.sameInput).length,
    totalPaired: paired.length,
    metrics: { asis: metricSummary(asis), tobe: metricSummary(tobe), tobeMinusAsis: delta(asis, tobe) },
    traceHashes: { asis: traceSummary(asis).legacyTraceHash, tobe: traceSummary(tobe).legacyTraceHash },
    changedThreatOutcomes: paired.filter(x => x.changed).length,
    architectureInputs: {
      common: ['same deployment catalog', 'same threat arrivals through dedicated arrival RNG', 'same physical type Pk/range declarations'],
      asis: ['best single-sensor Pd', 'distributed C2/approval and coord links', 'minimum observed aggregate shooter load'],
      tobe: ['any-sensor Pd fusion', 'IAOC/JAMDC2 fusion path where present', 'automation/preauthorization', 'suitability/cost-aware aggregate WTA']
    }
  });
}
writeArtifact('architecture-diff.json', { generatedAt: AUDIT_GENERATED_AT, fixedExperiment: FIXED, comparisons });
console.log('wrote architecture-diff.json');
