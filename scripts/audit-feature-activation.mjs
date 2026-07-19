import fs from 'node:fs';
import path from 'node:path';
import { ROOT, BASELINE_ROOT, FIXED, AUDIT_GENERATED_AT, loadProject, catalogSummary, writeArtifact } from './audit-lib.mjs';

const KJ = loadProject(ROOT);
const execution = {
  generatedAt: AUDIT_GENERATED_AT,
  comparisonPriority: ['Air_Defense read-only sibling', 'legacy mode', 'phase0 baseline fixture'],
  paths: { target: ROOT, baseline: BASELINE_ROOT, baselineExists: fs.existsSync(BASELINE_ROOT) },
  fixedExperiment: FIXED,
  uiDefaults: { deployment: 'legacy', scenario: 'sc1', architecture: 'asis', seed: 12345, intensity: 1, durationSec: 1800 },
  engineDefaults: { deployment: 'legacy', intensity: 1, seed: 1, durationSec: 1800, highResolutionDeployment: false },
  auditApplied: { deployment: ['legacy', 'HANBANDO_MINI_NORMAL', 'HANBANDO_FULL_NORMAL', 'HANBANDO_FULL_MCRC_DOWN', 'HANBANDO_FULL_KAMDOC_DOWN'], scenario: 'sc3', architecture: ['asis', 'tobe'], seed: 42, intensity: 1.5, durationSec: 1800 },
  urlState: { scheme: '#tab=&sc=&mode=&dep=&t=&open=&x=&seed=&dur=', invalidDeploymentFallsBackTo: 'legacy' },
  notes: [
    'UI deployment selection is converted to deploymentId plus features.highResolutionDeployment=true.',
    'Headless runDES uses the legacy catalog unless the feature is explicitly true.',
    'MC and transition analysis pass the same deploymentId/features into runDES.'
  ]
};
writeArtifact('execution-config.json', execution);

const rows = [
  ['고해상도 배치', 'js/config/deployments.js; deployment-adapter.js', 'Simulation constructor → resolveModelCatalog', 'highResolutionDeployment', false, '실행', '노드·링크·정적 축선 후보·집계 queue/WTA'],
  ['개별 위협 운동학', '정의 없음', '없음', '없음', false, '미실행', '없음'],
  ['센서 기하', '사거리 선언만 존재', 'adapter가 coverage axis를 1회 생성', '없음', false, '런타임 미실행', '정적 axis coverage로 평탄화'],
  ['센서 상태머신', '정의 없음', '없음', '없음', false, '미실행', '없음'],
  ['재밍·ECM', '구현 없음', '없음', '없음', false, '미실행', '없음'],
  ['항적 신선도', '구현 없음', '없음', '없음', false, '미실행', '없음'],
  ['항적 상관', '상세 구현 없음', '없음', '없음', false, '미실행', '없음'],
  ['C2 scope resolver', '역할 ID 정적 매핑만 존재', '_resolveRole', '없음', false, '동적 resolver 미실행', 'USFK WTA 제외'],
  ['PIP', '구현 없음', '없음', '없음', false, '미실행', '없음'],
  ['상세 교전봉투', '사거리 선언만 존재', '_doEngage', '없음', false, '런타임 미실행', '정적 axis coverage+체공시간으로 대체'],
  ['PSSEK', '구현 없음', '없음', '없음', false, '미실행', '없음'],
  ['발사대별 자원', 'launcherConfig/quantity 선언', 'adapter node field copy', '없음', false, '필드는 존재·동역학 미실행', '포대 합산 channels/magazine로 평탄화'],
  ['재장전', 'reloadConfig 선언', 'adapter node field copy', '없음', false, '미실행', '없음'],
  ['canonical trace', '구현 없음', '없음', 'trace(구 형식)', false, '미실행', '자유형 한국어 stages만 존재'],
  ['trace 기반 분석', 'sim-view stageLabel', 'threatTraces/nodeSeries', 'trace', false, '부분 실행', '기존 trace 표시·집계'],
  ['신규 replay', '구현 없음', '없음', '없음', false, '미실행', 'axisPosition 기반 기존 replay 사용']
].map(([feature, definition, entry, flag, defaultState, evidence, impact]) => ({ feature, definition, entry, flag, defaultState, evidence, impact }));

const activation = {
  generatedAt: AUDIT_GENERATED_AT,
  verdict: 'Only the deployment/catalog adapter is active; detailed high-resolution dynamics and canonical observability are absent.',
  lifecycleLegend: ['defined', 'imported', 'instantiated', 'called', 'return-used', 'canonical-event', 'metric', 'UI'],
  features: rows,
  catalogs: ['legacy', ...KJ.DEPLOYMENT_IDS].flatMap(id => ['asis', 'tobe'].map(mode => catalogSummary(KJ, id, mode)))
};
writeArtifact('feature-activation.json', activation);
console.log('wrote execution-config.json and feature-activation.json');
