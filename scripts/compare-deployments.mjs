import { ROOT, FIXED, AUDIT_GENERATED_AT, loadProject, runFixed, metricSummary, delta, hash, aggregateOnly, catalogSummary, jsonClone, writeArtifact } from './audit-lib.mjs';

const KJ = loadProject(ROOT);
const deployments = ['legacy', ...KJ.DEPLOYMENT_IDS];
const runs = [];
for (const deployment of deployments) {
  for (const mode of ['asis', 'tobe']) {
    const result = runFixed(KJ, { deployment, mode, trace: true });
    runs.push({ deployment, mode, catalog: catalogSummary(KJ, deployment, mode), metrics: metricSummary(result), aggregateHash: hash(aggregateOnly(result)) });
  }
}

const pairs = [
  ['HANBANDO_MINI_NORMAL', 'HANBANDO_MINI_MCRC_DOWN'],
  ['HANBANDO_MINI_NORMAL', 'HANBANDO_MINI_KAMDOC_DOWN'],
  ['HANBANDO_FULL_NORMAL', 'HANBANDO_FULL_MCRC_DOWN'],
  ['HANBANDO_FULL_NORMAL', 'HANBANDO_FULL_KAMDOC_DOWN'],
  ['HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL']
];
const comparisons = [];
for (const [a, b] of pairs) {
  for (const mode of ['asis', 'tobe']) {
    const ra = runFixed(KJ, { deployment: a, mode, trace: false });
    const rb = runFixed(KJ, { deployment: b, mode, trace: false });
    comparisons.push({ from: a, to: b, mode, delta: delta(ra, rb), exactAggregate: JSON.stringify(ra) === JSON.stringify(rb) });
  }
}

function runCatalogMutation(label, mutate) {
  const baseCatalog = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL');
  const clone = jsonClone(baseCatalog);
  mutate(clone);
  const originalResolver = KJ.resolveModelCatalog;
  KJ.resolveModelCatalog = () => clone;
  try {
    const result = runFixed(KJ, { deployment: 'HANBANDO_FULL_NORMAL', mode: 'tobe', trace: false });
    return { label, aggregateHash: hash(result), metrics: metricSummary(result) };
  } finally {
    KJ.resolveModelCatalog = originalResolver;
  }
}

const baselineMutation = runCatalogMutation('unmodified cloned catalog', () => {});
const controlledMutations = [
  baselineMutation,
  runCatalogMutation('quantity and launcherConfig only', c => {
    for (const n of c.nodes) if (n.category === 'shooter') { n.quantity = 9999; n.launcherConfig = { diagnostic: true, launchers: 9999 }; }
  }),
  runCatalogMutation('reloadConfig only', c => {
    for (const n of c.nodes) if (n.category === 'shooter') n.reloadConfig = { reloadSec: 1, diagnostic: true };
  }),
  runCatalogMutation('declared sensor/shooter range only; precomputed coverage unchanged', c => {
    for (const n of c.nodes) {
      if (n.category === 'sensor') n.rangeKm = 0;
      if (n.category === 'shooter') n.engage.rangeKm = 0;
    }
  }),
  runCatalogMutation('legacy decision field coverage removed', c => {
    for (const n of c.nodes) if (n.category === 'sensor' || n.category === 'shooter') n.coverage = [];
  })
].map(x => ({ ...x, sameAsUnmodified: x.aggregateHash === baselineMutation.aggregateHash }));

const extremes = [
  { label: 'detect multiplier 0.01', result: runFixed(KJ, { deployment: 'HANBANDO_FULL_NORMAL', mode: 'tobe', trace: false, mult: { detect: 0.01 } }) },
  { label: 'delay multiplier 10', result: runFixed(KJ, { deployment: 'HANBANDO_FULL_NORMAL', mode: 'tobe', trace: false, mult: { delay: 10 } }) },
  { label: 'aggregate magazine size 1', result: runFixed(KJ, { deployment: 'HANBANDO_FULL_NORMAL', mode: 'tobe', trace: false, features: { magazine: true, magazineSize: 1 } }) }
].map(x => ({ label: x.label, metrics: metricSummary(x.result), hash: hash(x.result) }));

writeArtifact('deployment-diff.json', {
  generatedAt: AUDIT_GENERATED_AT, fixedExperiment: FIXED, runs, comparisons,
  controlledMutations, extremes,
  interpretation: {
    unchangedFields: ['quantity', 'launcherConfig', 'reloadConfig', 'rangeKm after adapter coverage generation'],
    activeCompatibilityFields: ['coverage axis list', 'detectProb', 'queue servers/capacity/service time', 'canEngage', 'aggregate engage channels/magazine/Pk', 'links and their delays'],
    warning: '통제 변형은 운영 정본을 변경하지 않고 메모리 복제 catalog에서만 수행했다.'
  }
});
console.log('wrote deployment-diff.json');
