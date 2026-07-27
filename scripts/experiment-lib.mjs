/**
 * K-JAMDS 시뮬레이터 — 실험(시나리오 × 배치 × 모델충실도) 공용 로더·집계 유틸
 *
 * audit-lib.mjs는 legacy 엔진만 로드하므로 modelFidelity='iads-c2'(고해상도 물리)를
 * 실행할 수 없다. 이 모듈은 CJS 엔진 파일과 ES module IADS 커널을 함께 올려
 * 세 가지 충실도(legacy compat · 고해상도 compat · 고해상도 iads-c2)를 모두 실행한다.
 *
 * 결정론: 모든 실행은 seed에서 파생되며 동일 config는 동일 결과를 낸다.
 * As-Is/To-Be는 항상 같은 seed로 짝지어(paired) 실행해 구조 차이만 분리한다(CRN).
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ENGINE_FILES = [
  'js/config/system-types.js', 'js/config/geo-mdl.js', 'js/config/deployments.js',
  'js/data/nodes.js', 'js/data/links.js', 'js/data/threats.js',
  'js/data/scenarios.js', 'js/data/axes.js',
  'js/config/deployment-adapter.js',
  'js/core/rng.js', 'js/core/heap.js', 'js/core/constraints.js',
  'js/analysis/bottleneck.js', 'js/engine/sim-engine.js',
  'js/analysis/mc-runner.js', 'js/analysis/transition.js',
  'js/analysis/overlap-heatmap.js', 'js/analysis/c2-report.js'
];

/** 엔진 + IADS 커널을 현재 프로세스 전역에 로드하고 KJ를 반환한다. */
export function loadEngine() {
  globalThis.window = globalThis;
  const require = createRequire(import.meta.url);
  for (const rel of ENGINE_FILES) require(path.join(ROOT, rel));
  const KJ = globalThis.KJ;
  if (!KJ || typeof KJ.runDES !== 'function') throw new Error('DES 로드 실패');
  installIadsKernel(KJ);
  return KJ;
}

/** 실험 셀 config 생성. deployment='legacy'면 고해상도 플래그를 붙이지 않는다. */
export function cellConfig(KJ, { scenario, mode, deployment, fidelity = 'compat',
  intensity = 1, seed = 12345, endTimeSec = 1800, c2Analysis = false }) {
  const cfg = {
    scenario: KJ.scenarioById(scenario), mode, intensity, seed, endTimeSec
  };
  if (deployment !== 'legacy') {
    cfg.deploymentId = deployment;
    cfg.features = { highResolutionDeployment: true };
    cfg.modelFidelity = fidelity;
  } else if (fidelity !== 'compat') {
    throw new Error('legacy 배치는 iads-c2 충실도를 지원하지 않는다');
  }
  if (c2Analysis) cfg.c2Analysis = true;
  return cfg;
}

/** 복제 i의 시드 — mc-runner와 동일한 파생식(황금비 해시)을 써 격자를 맞춘다. */
export function repSeed(baseSeed, i) {
  return ((baseSeed >>> 0) + Math.imul(i + 1, 0x9E3779B1)) >>> 0;
}

/** 단일 실행 결과에서 비교용 스칼라 지표를 뽑는다. 표본 없는 시간지표는 null. */
export function metricsOf(r) {
  const g = r.global, spawned = g.spawned || 0;
  const resolved = (g.killed || 0) + (g.leaked || 0);
  const coord = g.coordination || {};
  // 'track'은 legacy(track)와 native(iads_track) 양쪽을 함께 본다 — 두 경로는 배타적이다.
  const keysOf = kind => (kind === 'track' ? ['track', 'iads_track'] : [kind]);
  const maxRhoBy = (cat, kind) => r.nodes.reduce((m, n) => {
    if (n.category !== cat || !n.rhoByKind) return m;
    return keysOf(kind).reduce((x, k) => Math.max(x, n.rhoByKind[k] || 0), m);
  }, 0);
  const maxWqBy = (cat, kind) => r.nodes.reduce((m, n) => {
    if (n.category !== cat || !n.WqByKind) return m;
    return keysOf(kind).reduce((x, k) => {
      const v = n.WqByKind[k] || 0;
      return Number.isFinite(v) && v > x ? v : x;
    }, m);
  }, 0);
  const dropsBy = (cat, kind) => r.nodes.reduce((s, n) =>
    n.category === cat && n.dropsByKind
      ? s + keysOf(kind).reduce((x, k) => x + (n.dropsByKind[k] || 0), 0) : s, 0);
  return {
    // 결과(MoFE)
    killRateSpawn: spawned ? g.killed / spawned : null,
    leakRateSpawn: spawned ? g.leaked / spawned : null,
    killRateResolved: resolved ? g.killed / resolved : null,
    censoredRate: spawned ? (g.censoredRaw || 0) / spawned : null,
    defenseEfficiency: g.cost.defenseEfficiency,
    exchangeSat: g.cost.exchangeSat,
    highValuePreservation: g.highValuePreservation,
    interceptM: g.cost.interceptM,
    duplicateInterceptM: g.cost.duplicateInterceptM,
    // 과정(MoP)
    detectRate: spawned ? g.detected / spawned : null,
    meanDecisionDelaySec: g.everEngaged > 0 ? g.meanDecisionDelaySec : null,
    meanCoordDelaySec: g.everEngaged > 0 ? g.meanCoordDelaySec : null,
    meanTimeToEngageSec: g.everEngaged > 0 ? g.meanTimeToEngageSec : null,
    meanTimeToKillSec: g.killed > 0 ? g.meanTimeToKillSec : null,
    shotsPerEngagement: g.everEngaged > 0 ? g.shotsPerEngagement : null,
    c2MaxRhoTrack: maxRhoBy('c2', 'track'),
    c2MaxWqTrack: maxWqBy('c2', 'track'),
    c2DropsTrack: dropsBy('c2', 'track'),
    apprMaxRho: maxRhoBy('c2', 'approval'),
    apprMaxWq: maxWqBy('c2', 'approval'),
    shooterMaxRho: r.nodes.reduce((m, n) => n.category === 'shooter' && n.rho > m ? n.rho : m, 0),
    // 구조(MoCE)
    bottleneckCount: r.bottlenecks.length,
    coordGaps: coord.gaps || 0,
    duplicateEngagements: coord.duplicates || 0,
    structuralLeaks: structuralLeaks(g),
    // 규모
    spawned, killed: g.killed, leaked: g.leaked, everEngaged: g.everEngaged,
    eventCount: r.eventCount
  };
}

export function structuralLeaks(g) {
  if (g.failureSummary) return g.failureSummary.structuralPrimary || 0;
  let n = 0;
  for (const code of Object.keys(g.leakReasons || {})) {
    if (globalThis.KJ.leakTaxonomy(code).structural) n += g.leakReasons[code];
  }
  return n;
}

/** Welford 누산기 — mc-runner와 동일 정의(표본 없음은 push하지 않는다). */
export class Welford {
  constructor() { this.n = 0; this.mean = 0; this.M2 = 0; }
  push(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return;
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.M2 += d * (x - this.mean);
  }
  get variance() { return this.n > 1 ? this.M2 / (this.n - 1) : 0; }
  get std() { return Math.sqrt(this.variance); }
  ciHalf(z = 1.959963985) { return this.n > 1 ? z * this.std / Math.sqrt(this.n) : null; }
  summary() {
    const ci = this.ciHalf();
    return {
      n: this.n,
      mean: this.n ? this.mean : null,
      std: this.n > 1 ? this.std : null,
      ci, lo: ci == null ? null : this.mean - ci, hi: ci == null ? null : this.mean + ci
    };
  }
}

export const METRIC_KEYS = Object.keys(metricsOf({
  global: {
    spawned: 0, killed: 0, leaked: 0, detected: 0, everEngaged: 0, censoredRaw: 0,
    cost: {}, leakReasons: {}, coordination: {}
  },
  nodes: [], bottlenecks: [], eventCount: 0
}));

/**
 * 한 셀(시나리오·배치·충실도·강도)을 paired 복제로 실행한다.
 * 복제마다 동일 seed로 asis/tobe를 실행하고 As-Is·To-Be·Δ 세 누산기를 채운다.
 */
export function runCell(KJ, spec, reps, baseSeed = 12345) {
  const asis = {}, tobe = {}, delta = {};
  for (const k of METRIC_KEYS) { asis[k] = new Welford(); tobe[k] = new Welford(); delta[k] = new Welford(); }
  const leakReasons = { asis: {}, tobe: {} };
  const t0 = Date.now();
  for (let i = 0; i < reps; i++) {
    const seed = repSeed(baseSeed, i);
    const ra = KJ.runDES(cellConfig(KJ, { ...spec, mode: 'asis', seed }));
    const rb = KJ.runDES(cellConfig(KJ, { ...spec, mode: 'tobe', seed }));
    const ma = metricsOf(ra), mb = metricsOf(rb);
    for (const k of METRIC_KEYS) {
      asis[k].push(ma[k]); tobe[k].push(mb[k]);
      if (Number.isFinite(ma[k]) && Number.isFinite(mb[k])) delta[k].push(mb[k] - ma[k]);
    }
    for (const [arm, res] of [['asis', ra], ['tobe', rb]]) {
      for (const [code, n] of Object.entries(res.global.leakReasons || {})) {
        const key = code.startsWith('overflow:') ? 'overflow:*' : code;
        leakReasons[arm][key] = (leakReasons[arm][key] || 0) + n;
      }
    }
  }
  const sum = acc => Object.fromEntries(METRIC_KEYS.map(k => [k, acc[k].summary()]));
  return {
    spec, reps, baseSeed, elapsedMs: Date.now() - t0,
    asis: sum(asis), tobe: sum(tobe), delta: sum(delta),
    leakReasons
  };
}

/** Δ의 95% CI가 0을 제외하면 구조 차이가 통계적으로 분리된 것으로 판정한다. */
export function significant(d) {
  return d && d.lo != null && d.hi != null && (d.lo > 0 || d.hi < 0);
}
