/**
 * K-JAMDS 시뮬레이터 — 시드 기반 난수·분포 샘플러 (Phase 2)
 *
 * Mulberry32: 32비트 결정론적 PRNG. 동일 seed → 동일 난수열 → 재현성·딥링크 공유.
 * (근거: 본 프로젝트 계획서 4절 — Mulberry32는 UI 재현·딥링크 공유용으로 적합.
 *  통계적 엄밀성이 요구되는 대규모 배치는 Phase 3에서 주기가 긴 생성기 병행 검토.)
 *
 * 분포 샘플러: DES 엔진의 도착(지수)·서비스(지수) 및 요격확률(삼각) 등에 사용.
 * 모든 샘플러는 주입된 rng()에만 의존하므로 seed 고정 시 완전 재현된다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  /** Mulberry32 PRNG 팩토리. 반환 함수는 [0,1) 균일난수를 낸다. */
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 샘플러 묶음 생성. rng 하나를 공유해 전 분포가 같은 스트림에서 소비된다.
   * @param {number} seed 정수 시드
   */
  KJ.makeRng = function (seed) {
    var rng = mulberry32(seed >>> 0);
    var spareNormal = null;

    function uniform(a, b) {
      if (a === undefined) return rng();
      return a + (b - a) * rng();
    }

    /** 지수분포 (평균 mean). 포아송 도착의 도착간격·M/M/c 서비스시간에 사용. */
    function exponential(mean) {
      var u = 1 - rng(); // (0,1] 로 log(0) 회피
      return -mean * Math.log(u);
    }

    /** 삼각분포 Triangular(min, mode, max). 전문가 추정 최소/최빈/최대. */
    function triangular(min, mode, max) {
      if (max <= min) return min;
      var u = rng();
      var fc = (mode - min) / (max - min);
      if (u < fc) return min + Math.sqrt(u * (max - min) * (mode - min));
      return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }

    /** 표준정규 (Box-Muller, 스페어 캐시). */
    function normal(mu, sigma) {
      mu = mu || 0; sigma = sigma === undefined ? 1 : sigma;
      if (spareNormal !== null) {
        var z = spareNormal; spareNormal = null;
        return mu + sigma * z;
      }
      var u1 = 1 - rng(), u2 = rng();
      var r = Math.sqrt(-2 * Math.log(u1));
      var theta = 2 * Math.PI * u2;
      spareNormal = r * Math.sin(theta);
      return mu + sigma * (r * Math.cos(theta));
    }

    /** 로그정규 (양수·우편향 지연 모델링). 지정 평균/표준편차(선형공간)에서 파라미터 유도. */
    function lognormal(mean, stddev) {
      var variance = stddev * stddev;
      var muL = Math.log(mean * mean / Math.sqrt(variance + mean * mean));
      var sigL = Math.sqrt(Math.log(1 + variance / (mean * mean)));
      return Math.exp(normal(muL, sigL));
    }

    /** 포아송(평균 lambda) — Knuth 알고리즘. 단위시간 위협 도착수 등. */
    function poisson(lambda) {
      var L = Math.exp(-lambda), k = 0, p = 1;
      do { k++; p *= rng(); } while (p > L);
      return k - 1;
    }

    return {
      seed: seed >>> 0,
      raw: rng,
      uniform: uniform,
      exponential: exponential,
      triangular: triangular,
      normal: normal,
      lognormal: lognormal,
      poisson: poisson
    };
  };
})();
