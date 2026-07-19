import fs from 'node:fs';
import { ROOT, BASELINE_ROOT, FIXED, AUDIT_GENERATED_AT, loadProject, runFixed, hash, aggregateOnly, metricSummary, traceSummary, pairedThreatDiff, writeArtifact } from './audit-lib.mjs';

if (!fs.existsSync(BASELINE_ROOT)) throw new Error(`baseline not found: ${BASELINE_ROOT}`);
const oldKJ = loadProject(BASELINE_ROOT);
const newKJ = loadProject(ROOT);
const modes = {};
for (const mode of ['asis', 'tobe']) {
  const legacy = runFixed(oldKJ, { mode, trace: true });
  const v2 = runFixed(newKJ, { mode, deployment: 'legacy', trace: true });
  if (mode === 'asis') {
    writeArtifact(`legacy-${FIXED.scenario}-${FIXED.seed}.json`, { model: 'Air_Defense', result: legacy, traceSummary: traceSummary(legacy) });
    writeArtifact(`v2-${FIXED.scenario}-${FIXED.seed}.json`, { model: 'Air_Defense_v2 legacy/OFF', result: v2, traceSummary: traceSummary(v2) });
  }
  modes[mode] = {
    exactFullResult: JSON.stringify(legacy) === JSON.stringify(v2),
    exactAggregate: JSON.stringify(aggregateOnly(legacy)) === JSON.stringify(aggregateOnly(v2)),
    hashes: { legacy: hash(legacy), v2: hash(v2), legacyAggregate: hash(aggregateOnly(legacy)), v2Aggregate: hash(aggregateOnly(v2)) },
    metrics: { legacy: metricSummary(legacy), v2: metricSummary(v2) },
    pairedThreats: pairedThreatDiff(legacy, v2)
  };
}
writeArtifact('legacy-v2-diff.json', {
  generatedAt: AUDIT_GENERATED_AT, fixedExperiment: FIXED,
  baselinePath: BASELINE_ROOT, targetPath: ROOT, modes,
  verdict: Object.values(modes).every(x => x.exactFullResult) ? 'bit-exact' : 'different'
});
console.log('wrote legacy/v2 snapshots and legacy-v2-diff.json');
