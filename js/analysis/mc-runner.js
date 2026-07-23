/**
 * K-JAMDS 시뮬레이터 — Monte Carlo 러너·통계 (Phase 3)
 *
 * DES 엔진(engine/sim-engine.js)의 단일 복제를 다수 반복(replication) 실행하고,
 * Welford 스트리밍 평균/분산으로 핵심 지표의 신뢰구간을 실시간 추정해 수렴을 판정한다.
 * 또한 파라미터 ±20% 민감도 스윕으로 누수율에 대한 인자별 영향을 정량화한다.
 *
 * 근거(계획서 4절·Recommendations 3):
 *  - Welford 스트리밍 분산으로 매 반복 95% CI 반폭을 모니터링, 허용오차 이하 수렴 시 정지.
 *  - 최소 반복수 보장(과소표본 방지), 상한까지 미수렴 시 상한에서 정지.
 *  - 각 복제는 baseSeed에서 파생된 독립 시드를 써 재현 가능(동일 baseSeed → 동일 요약).
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var Z95 = 1.959963985; // 표준정규 97.5% 분위수 (95% 양측 신뢰구간)

  /** Welford 온라인 평균/분산 누산기 */
  function Welford() { this.n = 0; this.mean = 0; this.M2 = 0; }
  Welford.prototype.push = function (x) {
    this.n++;
    var d = x - this.mean;
    this.mean += d / this.n;
    this.M2 += d * (x - this.mean);
  };
  Welford.prototype.variance = function () { return this.n > 1 ? this.M2 / (this.n - 1) : 0; };
  Welford.prototype.std = function () { return Math.sqrt(this.variance()); };
  /** 95% 신뢰구간 반폭 = z * s / sqrt(n) */
  Welford.prototype.ciHalf = function (z) { return this.n > 1 ? (z || Z95) * this.std() / Math.sqrt(this.n) : Infinity; };
  KJ.Welford = Welford;

  /** 복제 i의 시드: baseSeed를 정수 해시로 확산 (독립·결정론적) */
  function repSeed(baseSeed, i) {
    return ((baseSeed >>> 0) + Math.imul(i + 1, 0x9E3779B1)) >>> 0;
  }

  /** 단일 복제에서 스칼라 지표 추출 */
  function metricsOf(r) {
    var spawned = r.global.spawned || 0;
    var resolved = (r.global.killed || 0) + (r.global.leaked || 0);
    var censored = r.global.censoredRaw || 0;
    return {
      killRate: r.global.killRate,
      leakRate: r.global.leakRate,
      killRateSpawn: spawned ? r.global.killed / spawned : 0,
      leakRateSpawn: spawned ? r.global.leaked / spawned : 0,
      censoredRate: spawned ? censored / spawned : 0,
      killRateResolved: resolved ? r.global.killed / resolved : 0,
      leakRateResolved: resolved ? r.global.leaked / resolved : 0,
      detectRate: spawned ? r.global.detected / spawned : 0,
      meanTimeToEngageSec: r.global.meanTimeToEngageSec,
      meanTimeToKillSec: r.global.meanTimeToKillSec,
      bottleneckCount: r.bottlenecks.length
    };
  }
  var METRIC_KEYS = [
    'killRate', 'leakRate',
    'killRateSpawn', 'leakRateSpawn', 'censoredRate', 'killRateResolved', 'leakRateResolved',
    'detectRate', 'meanTimeToEngageSec', 'meanTimeToKillSec', 'bottleneckCount'
  ];

  var C2_MOP_META = {
    autonomousFireRatio: { label: '자율발사 비율', kind: 'rate' },
    emergencyFireRatio: { label: '비상발사 비율', kind: 'rate' },
    delegatedFireRatio: { label: 'ICC/ECS 위임발사 비율', kind: 'rate' },
    directiveActivationRate: { label: '명령 활성 성공률', kind: 'rate' },
    directiveExpiryRate: { label: '명령 만료율', kind: 'rate' },
    coordinationFailureRate: { label: '협조 실패율(생성 대비)', kind: 'rate' },
    responsibilityUnresolvedRate: { label: '책임 미해소율(생성 대비)', kind: 'rate' },
    decisionTrackAgeP50: { label: '결심 항적 age p50', kind: 'sec' },
    decisionTrackAgeP90: { label: '결심 항적 age p90', kind: 'sec' },
    staleDecisionRate: { label: 'stale 결심률', kind: 'rate' },
    detectToReportP50: { label: '탐지→C2 보고 p50', kind: 'sec' },
    lostOpportunityRate: { label: '교전 기회 손실률', kind: 'rate' },
    engagementGapPreFireP50: { label: '발사 전 교전공백 p50', kind: 'sec' },
    engagementGapBeforeLeakP50: { label: '누출 전 교전공백 p50', kind: 'sec' },
    neverEngagedLeakedRate: { label: '미교전 누출률', kind: 'rate' },
    duplicateEngagementRatio: { label: '중복교전 비율', kind: 'rate' },
    c2QueuedProcessingLeakRatio: { label: 'C2 대기·처리 귀속 누출률', kind: 'rate' },
    c2MaxPeakRho: { label: 'C2 최대 60초 peak ρ', kind: 'rho' }
  };
  var C2_MOP_KEYS = Object.keys(C2_MOP_META);
  KJ.C2_MOP_META = C2_MOP_META;

  function c2MopOf(report, result) {
    if (!report || !report.available || report.truncated) return null;
    var causes = report.c2Command.byCause || {};
    var fires = report.c2Command.total || 0;
    var spawned = result.global.spawned || 0;
    var directives = report.c2Command.directives || {};
    var peaks = Object.keys(report.c2Load.nodes || {}).map(function (id) {
      var node = report.c2Load.nodes[id];
      return node.peakRho == null ? node.rho : node.peakRho;
    }).filter(function (value) { return typeof value === 'number' && isFinite(value); });
    return {
      autonomousFireRatio: fires ? (causes.autonomous || 0) / fires : null,
      emergencyFireRatio: fires ? (causes.emergency || 0) / fires : null,
      delegatedFireRatio: fires ? ((causes.delegated_icc || 0) + (causes.delegated_ecs || 0)) / fires : null,
      directiveActivationRate: directives.available ? directives.activationRate : null,
      directiveExpiryRate: directives.available ? directives.expiryRate : null,
      coordinationFailureRate: spawned ? report.c2Command.coordinationFailures / spawned : null,
      responsibilityUnresolvedRate: spawned ? report.c2Command.responsibilityUnresolved / spawned : null,
      decisionTrackAgeP50: report.trackFreshness.available ? report.trackFreshness.decisionTrackAge.p50 : null,
      decisionTrackAgeP90: report.trackFreshness.available ? report.trackFreshness.decisionTrackAge.p90 : null,
      staleDecisionRate: report.trackFreshness.available ? report.trackFreshness.staleDecisionRate : null,
      detectToReportP50: report.trackFreshness.detectToReport.n ? report.trackFreshness.detectToReport.p50 : null,
      lostOpportunityRate: report.lostOpportunity.available ? report.lostOpportunity.lossRate : null,
      engagementGapPreFireP50: report.engagementGap.preFire.n ? report.engagementGap.preFire.p50 : null,
      engagementGapBeforeLeakP50: report.engagementGap.beforeLeak.n ? report.engagementGap.beforeLeak.p50 : null,
      neverEngagedLeakedRate: spawned ? report.engagementGap.neverEngagedLeaked / spawned : null,
      duplicateEngagementRatio: report.duplicateEngagement.ratio,
      c2QueuedProcessingLeakRatio: report.c2Attribution.queuedOrProcessingRatio,
      c2MaxPeakRho: peaks.length ? Math.max.apply(null, peaks) : null
    };
  }

  function emptyAccumulators(keys) {
    var out = {};
    keys.forEach(function (key) { out[key] = new Welford(); });
    return out;
  }

  function summarizeOptionalAccumulators(acc, z) {
    var out = {};
    Object.keys(acc).forEach(function (key) {
      var w = acc[key];
      if (!w.n) {
        out[key] = { available: false, mean: null, std: null, n: 0, ci: null, lo: null, hi: null };
        return;
      }
      var ci = w.ciHalf(z);
      out[key] = {
        available: true, mean: w.mean, std: w.std(), n: w.n,
        ci: isFinite(ci) ? ci : null,
        lo: isFinite(ci) ? w.mean - ci : null,
        hi: isFinite(ci) ? w.mean + ci : null
      };
    });
    return out;
  }

  function summarizeAccumulators(acc, z) {
    var metrics = {};
    METRIC_KEYS.forEach(function (k) {
      var w = acc[k], ci = w.ciHalf(z);
      metrics[k] = {
        mean: w.mean, std: w.std(), n: w.n,
        ci: isFinite(ci) ? ci : null,
        lo: isFinite(ci) ? w.mean - ci : null,
        hi: isFinite(ci) ? w.mean + ci : null
      };
    });
    return metrics;
  }

  /**
   * Monte Carlo 실행.
   * @param {object} cfg  { scenario, mode, intensity, seed, endTimeSec, mult? }
   * @param {object} opts { minReps=30, maxReps=500, tol=0.01, primary='leakRate', z=Z95 }
   * @returns 요약 { reps, converged, convergedAt, primary, metrics{key:{mean,std,ci,lo,hi,n}}, config }
   */
  KJ.runMonteCarlo = function (cfg, opts) {
    opts = opts || {};
    var minReps = opts.minReps || 30;
    var maxReps = opts.maxReps || 500;
    var tol = opts.tol == null ? 0.01 : opts.tol;
    var primary = opts.primary || 'leakRate';
    var z = opts.z || Z95;
    var baseSeed = (cfg.seed >>> 0) || 12345;

    var acc = {};
    METRIC_KEYS.forEach(function (k) { acc[k] = new Welford(); });

    var convergedAt = null, reps = 0;
    for (var i = 0; i < maxReps; i++) {
      var r = KJ.runDES({
        scenario: cfg.scenario, mode: cfg.mode, intensity: cfg.intensity,
        seed: repSeed(baseSeed, i), endTimeSec: cfg.endTimeSec, mult: cfg.mult,
        deploymentId: cfg.deploymentId, features: cfg.features, modelFidelity: cfg.modelFidelity
      });
      var m = metricsOf(r);
      METRIC_KEYS.forEach(function (k) { acc[k].push(m[k]); });
      reps = i + 1;
      if (reps >= minReps && acc[primary].ciHalf(z) <= tol) { convergedAt = reps; break; }
    }

    var metrics = summarizeAccumulators(acc, z);

    return {
      reps: reps, converged: convergedAt !== null, convergedAt: convergedAt,
      primary: primary, tol: tol,
      metrics: metrics,
      config: {
        scenario: cfg.scenario.id, mode: cfg.mode,
        intensity: cfg.intensity, seed: baseSeed, endTimeSec: cfg.endTimeSec
      }
    };
  };

  /**
   * As-Is/To-Be를 정확히 같은 seed 집합으로 실행하고 seed별 Δ(To-Be−As-Is)의
   * 신뢰구간으로 수렴을 판정한다. 팔별 독립 CI 비중첩보다 구조 차이 검정에 적합하다.
   */
  KJ.runPairedMonteCarlo = function (cfg, opts) {
    opts = opts || {};
    var minReps = opts.minReps || 30;
    var maxReps = opts.maxReps || 500;
    var tol = opts.tol == null ? 0.01 : opts.tol;
    var primary = opts.primary || 'leakRateSpawn';
    var z = opts.z || Z95;
    if (METRIC_KEYS.indexOf(primary) === -1) throw new Error('Unknown paired MC primary metric: ' + primary);
    var baseSeed = (cfg.seed >>> 0) || 12345;
    var asisAcc = {}, tobeAcc = {}, deltaAcc = {};
    METRIC_KEYS.forEach(function (k) {
      asisAcc[k] = new Welford();
      tobeAcc[k] = new Welford();
      deltaAcc[k] = new Welford();
    });
    // 구조화 이벤트는 복제당 메모리·후처리 비용이 크므로 명시 요청에서만 수집한다.
    // 일반/자동 paired MC의 동역학과 응답시간은 기존 경량 경로를 유지한다.
    var includeC2Mop = opts.c2Mop === true && typeof KJ.buildC2Analysis === 'function';
    var asisMopAcc = emptyAccumulators(C2_MOP_KEYS);
    var tobeMopAcc = emptyAccumulators(C2_MOP_KEYS);
    var deltaMopAcc = emptyAccumulators(C2_MOP_KEYS);
    var mopExcluded = {};
    var convergedAt = null, reps = 0;
    for (var i = 0; i < maxReps; i++) {
      var seed = repSeed(baseSeed, i);
      var base = {
        scenario: cfg.scenario, intensity: cfg.intensity, seed: seed,
        endTimeSec: cfg.endTimeSec, mult: cfg.mult,
        deploymentId: cfg.deploymentId, features: cfg.features, modelFidelity: cfg.modelFidelity,
        c2EventCap: cfg.c2EventCap
      };
      var asisResult = KJ.runDES(Object.assign({}, base, { mode: 'asis', c2Analysis: includeC2Mop }));
      var tobeResult = KJ.runDES(Object.assign({}, base, { mode: 'tobe', c2Analysis: includeC2Mop }));
      var asis = metricsOf(asisResult);
      var tobe = metricsOf(tobeResult);
      METRIC_KEYS.forEach(function (k) {
        asisAcc[k].push(asis[k]);
        tobeAcc[k].push(tobe[k]);
        deltaAcc[k].push(tobe[k] - asis[k]);
      });
      if (includeC2Mop) {
        var asisReport = KJ.buildC2Analysis(asisResult.c2Events, asisResult);
        var tobeReport = KJ.buildC2Analysis(tobeResult.c2Events, tobeResult);
        var asisMop = c2MopOf(asisReport, asisResult);
        var tobeMop = c2MopOf(tobeReport, tobeResult);
        C2_MOP_KEYS.forEach(function (key) {
          var av = asisMop && asisMop[key], tv = tobeMop && tobeMop[key];
          if (typeof av === 'number' && isFinite(av) && typeof tv === 'number' && isFinite(tv)) {
            asisMopAcc[key].push(av);
            tobeMopAcc[key].push(tv);
            deltaMopAcc[key].push(tv - av);
          } else {
            mopExcluded[key] = (mopExcluded[key] || 0) + 1;
          }
        });
        delete asisResult.c2Events;
        delete tobeResult.c2Events;
      }
      reps = i + 1;
      if (reps >= minReps && deltaAcc[primary].ciHalf(z) <= tol) {
        convergedAt = reps;
        break;
      }
    }
    var commonConfig = {
      scenario: cfg.scenario.id, intensity: cfg.intensity,
      seed: baseSeed, endTimeSec: cfg.endTimeSec
    };
    function arm(mode, acc) {
      return {
        reps: reps, converged: convergedAt !== null, convergedAt: convergedAt,
        primary: primary, tol: tol, metrics: summarizeAccumulators(acc, z),
        config: Object.assign({ mode: mode }, commonConfig)
      };
    }
    return {
      reps: reps,
      paired: true,
      converged: convergedAt !== null,
      convergedAt: convergedAt,
      primary: primary,
      tol: tol,
      asis: arm('asis', asisAcc),
      tobe: arm('tobe', tobeAcc),
      delta: summarizeAccumulators(deltaAcc, z),
      c2Mop: {
        enabled: includeC2Mop,
        asis: summarizeOptionalAccumulators(asisMopAcc, z),
        tobe: summarizeOptionalAccumulators(tobeMopAcc, z),
        delta: summarizeOptionalAccumulators(deltaMopAcc, z),
        requestedSeedCount: reps,
        excludedByMetric: mopExcluded,
        note: 'As-Is·To-Be·Δ 모두 지표별 동일 paired seed 교집합; 미계측·절삭은 0이 아니라 제외'
      },
      config: commonConfig
    };
  };

  /** 고정 반복수의 평균 지표만 빠르게 산출 (민감도 스윕용) */
  function mcMeanLeak(cfg, reps) {
    var baseSeed = (cfg.seed >>> 0) || 12345;
    var w = new Welford();
    for (var i = 0; i < reps; i++) {
      var r = KJ.runDES({
        scenario: cfg.scenario, mode: cfg.mode, intensity: cfg.intensity,
        seed: repSeed(baseSeed, i), endTimeSec: cfg.endTimeSec, mult: cfg.mult,
        deploymentId: cfg.deploymentId, features: cfg.features, modelFidelity: cfg.modelFidelity
      });
      w.push(r.global.spawned ? r.global.leaked / r.global.spawned : 0);
    }
    return { mean: w.mean, ci: w.ciHalf() };
  }

  /**
   * 민감도 스윕: 각 인자를 ±deltaPct 스케일해 누수율 변화를 측정 (토네이도용).
   * 인자: service(처리시간)·delay(통신지연)·detect(탐지확률)·pk(요격확률)·intensity(위협강도).
   * @param {object} cfg  기준 config
   * @param {object} opts { reps=50, deltaPct=0.2 }
   */
  KJ.sensitivitySweep = function (cfg, opts) {
    opts = opts || {};
    var reps = opts.reps || 50;
    var d = opts.deltaPct == null ? 0.2 : opts.deltaPct;
    var factors = [
      { key: 'service', label: '노드 처리시간', worseHigh: true },
      { key: 'delay', label: '통신 지연', worseHigh: true },
      { key: 'detect', label: '탐지확률', worseHigh: false },
      { key: 'pk', label: '요격확률', worseHigh: false },
      { key: 'intensity', label: '위협 강도(λ)', worseHigh: true }
    ];
    var base = mcMeanLeak(cfg, reps).mean;

    var rows = factors.map(function (f) {
      var lo, hi;
      if (f.key === 'intensity') {
        lo = mcMeanLeak(withIntensity(cfg, 1 - d), reps).mean;
        hi = mcMeanLeak(withIntensity(cfg, 1 + d), reps).mean;
      } else {
        lo = mcMeanLeak(withMult(cfg, f.key, 1 - d), reps).mean;
        hi = mcMeanLeak(withMult(cfg, f.key, 1 + d), reps).mean;
      }
      return {
        factor: f.key, label: f.label,
        low: lo, high: hi, base: base,
        swing: Math.abs(hi - lo), worseHigh: f.worseHigh
      };
    });
    rows.sort(function (a, b) { return b.swing - a.swing; });
    return { base: base, reps: reps, deltaPct: d, rows: rows, primary: 'leakRate' };
  };

  function withMult(cfg, key, scale) {
    var mult = Object.assign({}, cfg.mult || {});
    mult[key] = (mult[key] || 1) * scale;
    return Object.assign({}, cfg, { mult: mult });
  }
  function withIntensity(cfg, scale) {
    return Object.assign({}, cfg, { intensity: cfg.intensity * scale });
  }
})();
