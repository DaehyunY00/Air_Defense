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
    return {
      killRate: r.global.killRate,
      leakRate: r.global.leakRate,
      detectRate: r.global.spawned ? r.global.detected / r.global.spawned : 0,
      meanTimeToEngageSec: r.global.meanTimeToEngageSec,
      meanTimeToKillSec: r.global.meanTimeToKillSec,
      bottleneckCount: r.bottlenecks.length
    };
  }
  var METRIC_KEYS = ['killRate', 'leakRate', 'detectRate', 'meanTimeToEngageSec', 'meanTimeToKillSec', 'bottleneckCount'];

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
        seed: repSeed(baseSeed, i), endTimeSec: cfg.endTimeSec, mult: cfg.mult
      });
      var m = metricsOf(r);
      METRIC_KEYS.forEach(function (k) { acc[k].push(m[k]); });
      reps = i + 1;
      if (reps >= minReps && acc[primary].ciHalf(z) <= tol) { convergedAt = reps; break; }
    }

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

  /** 고정 반복수의 평균 지표만 빠르게 산출 (민감도 스윕용) */
  function mcMeanLeak(cfg, reps) {
    var baseSeed = (cfg.seed >>> 0) || 12345;
    var w = new Welford();
    for (var i = 0; i < reps; i++) {
      var r = KJ.runDES({
        scenario: cfg.scenario, mode: cfg.mode, intensity: cfg.intensity,
        seed: repSeed(baseSeed, i), endTimeSec: cfg.endTimeSec, mult: cfg.mult
      });
      w.push(r.global.leakRate);
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
