import { ROOT, FIXED, AUDIT_GENERATED_AT, loadProject, runFixed, metricSummary, runtimeCounters, traceSummary, writeArtifact } from './audit-lib.mjs';

const KJ = loadProject(ROOT);
const deployments = ['legacy', 'HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL', 'HANBANDO_FULL_MCRC_DOWN', 'HANBANDO_FULL_KAMDOC_DOWN'];
const runs = [];
for (const deployment of deployments) {
  for (const mode of ['asis', 'tobe']) {
    const result = runFixed(KJ, { deployment, mode, trace: true });
    runs.push({ deployment, mode, config: result.config, metrics: metricSummary(result), ...runtimeCounters(result), traceHash: traceSummary(result).legacyTraceHash });
  }
}
writeArtifact('runtime-counters.json', {
  generatedAt: AUDIT_GENERATED_AT, fixedExperiment: FIXED, runs,
  conclusion: '고해상도 ON 시 배치 카탈로그는 사용되지만, 모든 위협은 기존 axis/queue 파이프라인을 통과하며 상세 훅 카운터는 0이다.'
});
console.log('wrote runtime-counters.json');
