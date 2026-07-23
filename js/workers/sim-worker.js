/** Classic-worker fallback. The preferred loader is sim-worker.mjs. */
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
  '../analysis/c2-report.js',
  '../engine/sim-engine.js',
  '../analysis/mc-runner.js',
  '../analysis/transition.js',
  '../analysis/overlap-heatmap.js',
  './sim-worker-runtime.js'
);
