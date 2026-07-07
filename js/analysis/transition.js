/**
 * K-JAMDS 시뮬레이터 — 임계 전환점 분석 (Phase 5)
 *
 * 계획서 Recommendations 6: "이용률 ρ가 0.9를 넘는 위협 도착률 구간에서 As-Is 대비
 * To-Be(Track Fusion·자동 WTA·통신 30초)의 평균 대기시간·누수율 개선폭을 핵심 산출물로
 * 제시하라. 이 구간이 K-JAMDS 투자정당화의 정책적 핵심이다."
 *
 * 방법: 위협 강도(intensity)를 스윕하면서 각 점에서 As-Is/To-Be를 동일 파생시드로
 * 다중복제(DES) 실행 → 강도별 [누수율·격추율·C2 최대 이용률·평균 격추시간] 곡선을 얻고,
 *  - As-Is C2 최대 ρ가 임계(0.9)를 최초로 넘는 강도(rho09CrossX),
 *  - As-Is·To-Be 누수율 격차가 최대인 강도(maxGapX)
 * 를 도출한다. 임계 초과 구간에서 격차가 벌어지는 것이 "포화 시 통합 C2의 가치" 논증이다.
 *
 * 병목·전환점은 여기서도 하드코딩되지 않는다 — 시나리오·강도·토폴로지에서 관측된다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var RHO_CRIT = 0.9; // 임계 이용률 (ENV-RHO-THRESH-01과 동일 기준)

  /** 복제 i의 파생 시드 (mc-runner.js와 동일한 정수 해시 확산 — 결정론적) */
  function repSeed(baseSeed, i) {
    return ((baseSeed >>> 0) + Math.imul(i + 1, 0x9E3779B1)) >>> 0;
  }

  /** 한 (시나리오, 모드, 강도) 점을 reps회 복제해 평균 지표 산출 */
  function meanPoint(scenario, mode, x, baseSeed, endTimeSec, reps) {
    var leak = new KJ.Welford(), kill = new KJ.Welford();
    var maxRho = new KJ.Welford(), ttk = new KJ.Welford();
    for (var i = 0; i < reps; i++) {
      var r = KJ.runDES({
        scenario: scenario, mode: mode, intensity: x,
        seed: repSeed(baseSeed, i), endTimeSec: endTimeSec
      });
      leak.push(r.global.leakRate);
      kill.push(r.global.killRate);
      var m = 0;
      r.nodes.forEach(function (n) { if (n.category === 'c2' && n.rho > m) m = n.rho; });
      maxRho.push(m);
      if (r.global.killed > 0) ttk.push(r.global.meanTimeToKillSec);
    }
    return {
      leakRate: leak.mean, leakCI: leak.ciHalf(),
      killRate: kill.mean,
      maxC2Rho: maxRho.mean,
      meanTTK: ttk.n ? ttk.mean : null
    };
  }

  /**
   * 임계 전환점 스윕.
   * @param {object} scenario KJ.SCENARIOS 항목
   * @param {object} opts { xMin=0.5, xMax=3.0, xStep=0.25, reps=30, seed=12345, endTimeSec=1800 }
   * @returns { points:[{x, asis:{...}, tobe:{...}, gap}], rho09CrossX, maxGapX, maxGap, summary }
   */
  KJ.analyzeTransition = function (scenario, opts) {
    opts = opts || {};
    var xMin = opts.xMin || 0.5, xMax = opts.xMax || 3.0, xStep = opts.xStep || 0.25;
    var reps = opts.reps || 30;
    var seed = opts.seed === undefined ? 12345 : (opts.seed >>> 0);
    var endTimeSec = opts.endTimeSec || 1800;

    var points = [];
    // 부동소수 누적 오차 방지: 정수 스텝 카운트로 순회
    var nSteps = Math.round((xMax - xMin) / xStep);
    for (var s = 0; s <= nSteps; s++) {
      var x = +(xMin + s * xStep).toFixed(4);
      var a = meanPoint(scenario, 'asis', x, seed, endTimeSec, reps);
      var b = meanPoint(scenario, 'tobe', x, seed, endTimeSec, reps);
      points.push({ x: x, asis: a, tobe: b, gap: a.leakRate - b.leakRate });
    }

    // As-Is C2 최대 이용률이 임계(0.9)를 최초로 넘는 강도
    var rho09CrossX = null;
    for (var i = 0; i < points.length; i++) {
      if (points[i].asis.maxC2Rho >= RHO_CRIT) { rho09CrossX = points[i].x; break; }
    }
    // 누수율 격차 최대 지점
    var maxGap = -Infinity, maxGapX = null;
    points.forEach(function (p) {
      if (p.gap > maxGap) { maxGap = p.gap; maxGapX = p.x; }
    });

    // 임계 이후 구간의 평균 개선폭 (정책 논증의 핵심 수치)
    var post = points.filter(function (p) { return rho09CrossX !== null && p.x >= rho09CrossX; });
    var postGapMean = post.length
      ? post.reduce(function (s2, p) { return s2 + p.gap; }, 0) / post.length : null;
    var pre = points.filter(function (p) { return rho09CrossX === null || p.x < rho09CrossX; });
    var preGapMean = pre.length
      ? pre.reduce(function (s2, p) { return s2 + p.gap; }, 0) / pre.length : null;

    return {
      scenario: scenario.id, seed: seed, reps: reps, endTimeSec: endTimeSec,
      rhoCrit: RHO_CRIT,
      points: points,
      rho09CrossX: rho09CrossX,
      maxGapX: maxGapX, maxGap: maxGap,
      preGapMean: preGapMean, postGapMean: postGapMean
    };
  };
})();
