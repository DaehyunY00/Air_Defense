/** Dedicated worker for DES, Monte Carlo, sensitivity and transition analysis. */
'use strict';
self.window = self;

importScripts(
  '../config/system-types.js',
  '../config/geo-mdl.js',
  '../config/deployments.js',
  '../data/nodes.js',
  '../data/links.js',
  '../data/threats.js',
  '../data/scenarios.js',
  '../data/axes.js',
  '../config/deployment-adapter.js',
  '../core/rng.js',
  '../core/heap.js',
  '../analysis/bottleneck.js',
  '../engine/sim-engine.js',
  '../analysis/mc-runner.js',
  '../analysis/transition.js',
  '../analysis/overlap-heatmap.js'
);

function config(raw) {
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

function progress(id, stage) {
  self.postMessage({ id: id, progress: stage });
}

function execute(id, task, payload) {
  var cfg, otherMode, base;
  if (task === 'desPair') {
    cfg = config(payload.cfg);
    otherMode = cfg.mode === 'asis' ? 'tobe' : 'asis';
    progress(id, 'current-des');
    var current = KJ.runDES(cfg);
    progress(id, 'comparison-des');
    var other = KJ.runDES(Object.assign({}, cfg, { mode: otherMode, trace: false }));
    var desOut = { current: current, other: other, otherMode: otherMode, execution: 'web-worker' };
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
    progress(id, 'current-mc');
    var currentMc = KJ.runMonteCarlo(base, payload.opts);
    progress(id, 'comparison-mc');
    var otherMc = KJ.runMonteCarlo(Object.assign({}, base, { mode: otherMode }), payload.opts);
    var mcOut = { current: currentMc, other: otherMc, otherMode: otherMode, execution: 'web-worker' };
    if (task === 'mcBundle') {
      progress(id, 'sensitivity');
      mcOut.sensitivity = KJ.sensitivitySweep(base, payload.sensitivityOpts);
    }
    return mcOut;
  }
  if (task === 'transition') {
    progress(id, 'transition');
    return {
      result: KJ.analyzeTransition(KJ.scenarioById(payload.scenarioId), payload.opts),
      execution: 'web-worker'
    };
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
