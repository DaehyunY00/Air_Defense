/**
 * Heavy DES/Monte Carlo computation gateway.
 *
 * HTTP multi-file execution uses a dedicated Web Worker so long simulations do
 * not block map interaction or animation.  file:// and single-file deployments
 * retain a deterministic main-thread fallback when the worker cannot start.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var worker = null;
  var workerDisabled = false;
  var nextId = 1;
  var pending = {};

  function scenarioConfig(raw) {
    return {
      scenario: KJ.scenarioById(raw.scenarioId),
      mode: raw.mode,
      intensity: raw.intensity,
      seed: raw.seed,
      endTimeSec: raw.endTimeSec,
      deploymentId: raw.deploymentId,
      features: raw.features,
      trace: raw.trace,
      traceCap: raw.traceCap,
      mult: raw.mult
    };
  }

  function runLocal(task, payload) {
    var cfg, otherMode, base;
    if (task === 'desPair') {
      cfg = scenarioConfig(payload.cfg);
      otherMode = cfg.mode === 'asis' ? 'tobe' : 'asis';
      var desOut = {
        current: KJ.runDES(cfg),
        other: KJ.runDES(Object.assign({}, cfg, { mode: otherMode, trace: false })),
        otherMode: otherMode,
        execution: 'main-thread-fallback'
      };
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
      cfg = scenarioConfig(payload.cfg);
      otherMode = cfg.mode === 'asis' ? 'tobe' : 'asis';
      base = Object.assign({}, cfg, { trace: false });
      var current = KJ.runMonteCarlo(base, payload.opts);
      var other = KJ.runMonteCarlo(Object.assign({}, base, { mode: otherMode }), payload.opts);
      var out = { current: current, other: other, otherMode: otherMode, execution: 'main-thread-fallback' };
      if (task === 'mcBundle') out.sensitivity = KJ.sensitivitySweep(base, payload.sensitivityOpts);
      return out;
    }
    if (task === 'transition') {
      return {
        result: KJ.analyzeTransition(KJ.scenarioById(payload.scenarioId), payload.opts),
        execution: 'main-thread-fallback'
      };
    }
    throw new Error('Unknown compute task: ' + task);
  }

  function runFallback(task, payload) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(runLocal(task, payload)); }
        catch (err) { reject(err); }
      }, 0);
    });
  }

  function disableWorker(reason) {
    workerDisabled = true;
    if (worker) worker.terminate();
    worker = null;
    Object.keys(pending).forEach(function (id) {
      var p = pending[id];
      delete pending[id];
      runFallback(p.task, p.payload).then(p.resolve, p.reject);
    });
    if (window.console && console.warn) console.warn('Simulation worker disabled:', reason);
  }

  function ensureWorker() {
    if (worker || workerDisabled || typeof Worker === 'undefined') return worker;
    try {
      worker = new Worker('js/workers/sim-worker.js');
      worker.onmessage = function (ev) {
        var msg = ev.data || {};
        var p = pending[msg.id];
        if (!p) return;
        if (msg.progress) {
          if (p.onProgress) p.onProgress(msg.progress);
          return;
        }
        delete pending[msg.id];
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || 'Worker computation failed'));
      };
      worker.onerror = function (ev) {
        disableWorker((ev && ev.message) || 'worker initialization failed');
      };
    } catch (err) {
      disableWorker(err.message || String(err));
    }
    return worker;
  }

  KJ.compute = {
    run: function (task, payload, onProgress) {
      var w = ensureWorker();
      if (!w) return runFallback(task, payload);
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending[id] = {
          task: task, payload: payload, onProgress: onProgress,
          resolve: resolve, reject: reject
        };
        w.postMessage({ id: id, task: task, payload: payload });
      });
    },
    mode: function () {
      return worker && !workerDisabled ? 'web-worker' : 'main-thread-fallback';
    },
    terminate: function () {
      if (worker) worker.terminate();
      worker = null;
      Object.keys(pending).forEach(function (id) {
        pending[id].reject(new Error('Computation cancelled'));
        delete pending[id];
      });
    }
  };
})();
