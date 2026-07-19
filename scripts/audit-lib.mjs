import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_ROOT = path.resolve(ROOT, '..', 'Air_Defense');
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'audit');
export const FIXED = Object.freeze({ scenario: 'sc3', seed: 42, intensity: 1.5, endTimeSec: 1800 });
export const AUDIT_GENERATED_AT = '2026-07-19T00:00:00+09:00';

const DATA_FILES = [
  'js/data/nodes.js', 'js/data/links.js', 'js/data/threats.js',
  'js/data/scenarios.js', 'js/data/axes.js'
];
const ENGINE_FILES = [
  'js/core/constraints.js', 'js/core/rng.js', 'js/core/heap.js',
  'js/analysis/bottleneck.js', 'js/engine/sim-engine.js',
  'js/analysis/mc-runner.js', 'js/analysis/transition.js',
  'js/analysis/overlap-heatmap.js'
];

export function loadProject(projectRoot) {
  const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
  const sandbox = {
    console: quietConsole,
    Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Error,
    Infinity, NaN, isFinite, parseFloat, parseInt, Set, Map
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const candidates = [
    'js/config/system-types.js', 'js/config/geo-mdl.js', 'js/config/deployments.js',
    ...DATA_FILES, 'js/config/deployment-adapter.js', ...ENGINE_FILES
  ];
  for (const rel of candidates) {
    const filename = path.join(projectRoot, rel);
    if (!fs.existsSync(filename)) continue;
    vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  }
  if (!sandbox.KJ || typeof sandbox.KJ.runDES !== 'function') {
    throw new Error(`DES could not be loaded from ${projectRoot}`);
  }
  return sandbox.KJ;
}

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function ensureArtifacts() {
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
}

export function writeArtifact(name, value) {
  ensureArtifacts();
  const target = path.join(ARTIFACT_ROOT, name);
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
  return target;
}

export function configFor(KJ, { scenario = FIXED.scenario, mode = 'asis', deployment = 'legacy', trace = true, features = {}, mult } = {}) {
  const high = deployment !== 'legacy';
  const cfg = {
    scenario: KJ.scenarioById(scenario), mode,
    intensity: FIXED.intensity, seed: FIXED.seed, endTimeSec: FIXED.endTimeSec,
    trace, traceCap: 5000
  };
  if (mult) cfg.mult = mult;
  if (high) {
    cfg.deploymentId = deployment;
    cfg.features = { ...features, highResolutionDeployment: true };
  } else if (Object.keys(features).length) {
    cfg.features = { ...features };
  }
  return cfg;
}

export function runFixed(KJ, opts = {}) {
  return jsonClone(KJ.runDES(configFor(KJ, opts)));
}

export function aggregateOnly(result) {
  const out = jsonClone(result);
  delete out.threatTraces;
  delete out.nodeSeries;
  delete out.traceTruncated;
  delete out.nodeSeriesTruncated;
  return out;
}

export function metricSummary(result) {
  const g = result.global;
  return {
    spawned: g.spawned, detected: g.detected, reachedC2: g.reachedC2,
    everEngaged: g.everEngaged, killed: g.killed, leaked: g.leaked,
    censored: g.censored, killRate: g.killRate, leakRate: g.leakRate,
    meanTimeToKillSec: g.meanTimeToKillSec,
    meanTimeToEngageSec: g.meanTimeToEngageSec,
    meanDecisionDelaySec: g.meanDecisionDelaySec,
    meanCoordDelaySec: g.meanCoordDelaySec,
    shotsFired: g.shotsFired,
    interceptCostM: g.cost.interceptM,
    defenseEfficiency: g.cost.defenseEfficiency,
    coordination: g.coordination,
    leakReasons: g.leakReasons,
    eventCount: result.eventCount,
    activeNodes: result.nodes.filter(n => n.arrivals > 0).length,
    activeLinks: result.links.filter(l => l.count > 0).length,
    bottlenecks: result.bottlenecks.map(b => `${b.kind}:${b.id}`)
  };
}

function inc(obj, key, amount = 1) {
  obj[key] = (obj[key] || 0) + amount;
}

export function traceSummary(result) {
  const traces = result.threatTraces || [];
  const stageCounts = {};
  const c2ByNode = {};
  const shotsByBattery = {};
  const threats = traces.map(tr => {
    let detectionT = null;
    const c2Stages = [];
    const engagements = [];
    for (const st of tr.stages) {
      inc(stageCounts, st.name.split(':')[0].split('#')[0]);
      if (st.name === '탐지' && detectionT === null) detectionT = st.t;
      if (st.name.startsWith('C2도착:') || st.name.startsWith('C2처리완료:') || st.name.startsWith('승인완료:')) {
        const node = st.name.slice(st.name.indexOf(':') + 1);
        inc(c2ByNode, node);
        c2Stages.push({ name: st.name, t: st.t });
      }
      if (st.name.startsWith('교전명령#')) {
        const battery = st.name.slice(st.name.indexOf(':') + 1);
        inc(shotsByBattery, battery);
        engagements.push({ battery, commandT: st.t });
      }
    }
    return {
      id: tr.id, type: tr.type, axis: tr.axis, spawnT: tr.spawnT,
      detectionT, c2Stages, engagements, exitT: tr.exitT, outcome: tr.outcome
    };
  });
  return {
    traceFormat: 'legacy-free-form-stage-trace',
    canonicalEventsPresent: false,
    canonicalEventHash: null,
    legacyTraceHash: hash(traces),
    threatCount: traces.length,
    stageCounts, c2ByNode, shotsByBattery, threats
  };
}

export function runtimeCounters(result) {
  const trace = traceSummary(result);
  const reportLinks = result.links.filter(l => l.kind === 'report').reduce((n, l) => n + l.count, 0);
  return {
    counters: {
      detailedThreatPositionCalls: 0,
      geometryDetectionChecks: 0,
      sensorStateTransitions: 0,
      trackReports: reportLinks,
      trackFreshnessEvaluations: 0,
      correlationAttempts: 0,
      c2ScopeResolutions: 0,
      detailedCandidateEvaluations: 0,
      pipSearches: 0,
      pssekLookups: 0,
      launcherReservations: 0,
      reloadTransitions: 0,
      canonicalEventsCreated: 0,
      legacyFallbacks: 0,
      compatibilityPipelineThreats: result.config.compatibilityMode ? result.global.spawned : 0,
      staticAxisDetectionSelections: trace.stageCounts['탐지'] || 0,
      aggregateShooterCommands: Object.values(trace.shotsByBattery).reduce((a, b) => a + b, 0)
    },
    semantics: {
      legacyFallbacks: '명시적 런타임 fallback 분기 횟수. 고해상도 ON은 fallback 분기가 아니라 전체 항적을 compatibility adapter 출력으로 처리한다.',
      compatibilityPipelineThreats: 'phase1-axis-queue catalog로 기존 9단계 DES를 통과한 위협 수.',
      zeroCounters: '해당 런타임 훅/이벤트/상태가 코드베이스에 없으며, 단순히 trace가 꺼져서 0이 아니다.'
    }
  };
}

export function delta(a, b) {
  const ma = metricSummary(a), mb = metricSummary(b), out = {};
  for (const key of Object.keys(ma)) {
    if (typeof ma[key] === 'number' && typeof mb[key] === 'number') out[key] = mb[key] - ma[key];
  }
  return out;
}

export function catalogSummary(KJ, id, mode) {
  const cfg = id === 'legacy' ? {} : { deploymentId: id, features: { highResolutionDeployment: true } };
  const c = KJ.resolveModelCatalog ? KJ.resolveModelCatalog(cfg) : { id: 'legacy', nodes: KJ.NODES, links: KJ.LINKS };
  const nodes = KJ.nodesInMode ? KJ.nodesInMode(mode, c) : c.nodes;
  const links = KJ.linksInMode ? KJ.linksInMode(mode, c) : c.links.filter(l => l.comm[mode]);
  return {
    id: c.id, mode, compatibilityMode: c.compatibilityMode || null,
    declaredNodes: c.nodes.length, visibleNodes: nodes.length,
    visibleLinks: links.length,
    categories: nodes.reduce((o, n) => (inc(o, n.category), o), {}),
    axisCoverageEntries: nodes.reduce((n, x) => n + ((x.coverage && x.coverage.length) || 0), 0),
    nativeCounts: c.nativeCounts || null
  };
}

export function pairedThreatDiff(a, b) {
  const ta = new Map(traceSummary(a).threats.map(t => [t.id, t]));
  const tb = new Map(traceSummary(b).threats.map(t => [t.id, t]));
  const ids = [...new Set([...ta.keys(), ...tb.keys()])].sort((x, y) => x - y);
  return ids.map(id => {
    const x = ta.get(id), y = tb.get(id);
    return {
      id,
      sameInput: !!x && !!y && x.type === y.type && x.axis === y.axis && x.spawnT === y.spawnT,
      legacy: x || null, v2: y || null,
      changed: JSON.stringify(x) !== JSON.stringify(y)
    };
  });
}
