/** Shared message runtime for module and classic simulation workers. */
(function () {
  'use strict';

  function config(raw) {
    return {
      scenario: KJ.scenarioById(raw.scenarioId), mode: raw.mode,
      intensity: raw.intensity, seed: raw.seed, endTimeSec: raw.endTimeSec,
      deploymentId: raw.deploymentId, features: raw.features,
      modelFidelity: raw.modelFidelity,
      trace: raw.trace, traceCap: raw.traceCap, mult: raw.mult,
      c2Analysis: raw.c2Analysis, c2EventCap: raw.c2EventCap
    };
  }

  function progress(id, stage) { self.postMessage({ id: id, progress: stage }); }

  /**
   * ADR-073/074 결심 감사 이벤트를 결과에 실어 보낸다.
   * ⚠️ c2Events는 곧 삭제되므로(용량) **삭제 전에** 여기서 뽑아야 한다.
   * decision_audit만 남기고 나머지 이벤트는 버린다 — 결과 화면이 쓰는 것은 이것뿐이다.
   * 계측이 꺼져 있으면 undefined를 남겨 wire shape를 종전과 같게 둔다.
   */
  function pickDecisionAudits(res) {
    if (!res || !res.c2Events) return undefined;
    var out = res.c2Events.filter(function (e) { return e.type === 'decision_audit'; });
    return out.length ? out : undefined;
  }


  function execute(id, task, payload) {
    var cfg, otherMode, base;
    if (task === 'desPair') {
      cfg = Object.assign(config(payload.cfg), { c2Analysis: true });
      otherMode = cfg.mode === 'asis' ? 'tobe' : 'asis';
      progress(id, 'current-des');
      var current = KJ.runDES(cfg);
      progress(id, 'comparison-des');
      // 반대 모드는 기본적으로 trace를 끈다(재생 애니메이션은 current만 쓰므로 낭비).
      // tracePair=true인 호출(분석 탭 As-Is↔To-Be 병렬 항적 로그)만 양쪽 trace를 요구한다.
      var other = KJ.runDES(Object.assign({}, cfg, {
        mode: otherMode, trace: payload.tracePair ? cfg.trace : false
      }));
      current.c2Analysis = KJ.buildC2Analysis(current.c2Events, current);
      other.c2Analysis = KJ.buildC2Analysis(other.c2Events, other);
      var currentAudits = pickDecisionAudits(current);
      var otherAudits = pickDecisionAudits(other);
      delete current.c2Events;
      delete other.c2Events;
      var desOut = { current: current, other: other, otherMode: otherMode,
        currentAudits: currentAudits, otherAudits: otherAudits,
        execution: 'web-worker', workerLoader: KJ.IADS ? 'module' : 'classic' };
      if (payload.includeHeat) {
        var modelCfg = { deploymentId: cfg.deploymentId, features: cfg.features };
        var heatCurrent = KJ.computeOverlapHeat(cfg.scenario, cfg.mode, cfg.intensity, modelCfg);
        var heatOther = KJ.computeOverlapHeat(cfg.scenario, otherMode, cfg.intensity, modelCfg);
        desOut.heatCurrentAxes = heatCurrent.axes;
        desOut.heatOtherAxes = heatOther.axes;
        desOut.heatCurrent = heatCurrent.axes.reduce(function (sum, axis) { return sum + axis.raw; }, 0);
        desOut.heatOther = heatOther.axes.reduce(function (sum, axis) { return sum + axis.raw; }, 0);
      }
      return desOut;
    }
    if (task === 'mcPair' || task === 'mcBundle') {
      cfg = config(payload.cfg);
      otherMode = cfg.mode === 'asis' ? 'tobe' : 'asis';
      base = Object.assign({}, cfg, { trace: false });
      progress(id, 'paired-mc');
      var pairedMc = KJ.runPairedMonteCarlo(base, payload.opts);
      var currentMc = cfg.mode === 'asis' ? pairedMc.asis : pairedMc.tobe;
      var otherMc = cfg.mode === 'asis' ? pairedMc.tobe : pairedMc.asis;
      var mcOut = { current: currentMc, other: otherMc, otherMode: otherMode,
        paired: pairedMc,
        execution: 'web-worker', workerLoader: KJ.IADS ? 'module' : 'classic' };
      if (task === 'mcBundle') {
        progress(id, 'sensitivity');
        mcOut.sensitivity = KJ.sensitivitySweep(base, payload.sensitivityOpts);
      }
      return mcOut;
    }
    if (task === 'transition') {
      progress(id, 'transition');
      return { result: KJ.analyzeTransition(KJ.scenarioById(payload.scenarioId), payload.opts),
        execution: 'web-worker', workerLoader: KJ.IADS ? 'module' : 'classic' };
    }
    throw new Error('Unknown compute task: ' + task);
  }

  self.onmessage = function (ev) {
    var msg = ev.data || {};
    try {
      self.postMessage({ id: msg.id, ok: true, result: execute(msg.id, msg.task, msg.payload || {}) });
    } catch (err) {
      self.postMessage({ id: msg.id, ok: false, error: err && err.stack ? err.stack : String(err) });
    }
  };

  self.postMessage({ type: 'worker-ready', loader: KJ.IADS ? 'module' : 'classic' });
})();
