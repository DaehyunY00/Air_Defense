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
  var workerReady = false;
  var workerQueue = [];
  var workerDisabled = false;
  var classicAttempted = false;
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
      modelFidelity: raw.modelFidelity,
      trace: raw.trace,
      traceCap: raw.traceCap,
      c2Analysis: raw.c2Analysis,
      c2EventCap: raw.c2EventCap,
      mult: raw.mult
    };
  }

  function runLocal(task, payload) {
    var cfg, otherMode, base;

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

    if (task === 'desPair') {
      cfg = Object.assign(scenarioConfig(payload.cfg), { c2Analysis: true });
      otherMode = cfg.mode === 'asis' ? 'tobe' : 'asis';
      var currentDes = KJ.runDES(cfg);
      // 워커 런타임과 동일 규약: tracePair=true일 때만 반대 모드도 trace한다.
      var otherDes = KJ.runDES(Object.assign({}, cfg, {
        mode: otherMode, trace: payload.tracePair ? cfg.trace : false
      }));
      currentDes.c2Analysis = KJ.buildC2Analysis(currentDes.c2Events, currentDes);
      otherDes.c2Analysis = KJ.buildC2Analysis(otherDes.c2Events, otherDes);
      var currentAudits = pickDecisionAudits(currentDes);
      var otherAudits = pickDecisionAudits(otherDes);
      delete currentDes.c2Events;
      delete otherDes.c2Events;
      var desOut = {
        current: currentDes,
        other: otherDes,
        otherMode: otherMode,
        currentAudits: currentAudits,
        otherAudits: otherAudits,
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
      var paired = KJ.runPairedMonteCarlo(base, payload.opts);
      var current = cfg.mode === 'asis' ? paired.asis : paired.tobe;
      var other = cfg.mode === 'asis' ? paired.tobe : paired.asis;
      var out = { current: current, other: other, otherMode: otherMode,
        paired: paired, execution: 'main-thread-fallback' };
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
    workerReady = false;
    workerQueue = [];
    Object.keys(pending).forEach(function (id) {
      var p = pending[id];
      delete pending[id];
      runFallback(p.task, p.payload).then(p.resolve, p.reject);
    });
    if (window.console && console.warn) console.warn('Simulation worker disabled:', reason);
  }

  function queuePendingMessages() {
    workerQueue = Object.keys(pending).map(function (id) {
      var p = pending[id];
      return { id: Number(id), task: p.task, payload: p.payload };
    });
  }

  function startWorker(kind) {
    var instance;
    try {
      instance = kind === 'module'
        ? new Worker('js/workers/sim-worker.mjs?v=20260801a', { type: 'module' })
        : new Worker('js/workers/sim-worker.js?v=20260801a');
      worker = instance;
      workerReady = false;
      worker.onmessage = function (ev) {
        if (worker !== instance) return;
        var msg = ev.data || {};
        if (msg.type === 'worker-ready') {
          workerReady = true;
          var queued = workerQueue;
          workerQueue = [];
          queued.forEach(function (item) { worker.postMessage(item); });
          return;
        }
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
        if (worker !== instance) return;
        if (kind === 'module' && !classicAttempted) {
          classicAttempted = true;
          instance.terminate();
          worker = null;
          workerReady = false;
          queuePendingMessages();
          startWorker('classic');
          return;
        }
        disableWorker((ev && ev.message) || 'worker initialization failed');
      };
    } catch (err) {
      if (kind === 'module' && !classicAttempted) {
        classicAttempted = true;
        queuePendingMessages();
        return startWorker('classic');
      }
      disableWorker(err.message || String(err));
    }
    return worker;
  }

  function ensureWorker() {
    if (worker || workerDisabled || typeof Worker === 'undefined') return worker;
    return startWorker('module');
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
        var message = { id: id, task: task, payload: payload };
        if (workerReady) w.postMessage(message);
        else workerQueue.push(message);
      });
    },
    mode: function () {
      return worker && !workerDisabled ? 'web-worker' : 'main-thread-fallback';
    },
    terminate: function () {
      if (worker) worker.terminate();
      worker = null;
      workerReady = false;
      classicAttempted = false;
      workerQueue = [];
      Object.keys(pending).forEach(function (id) {
        pending[id].reject(new Error('Computation cancelled'));
        delete pending[id];
      });
    }
  };
})();
