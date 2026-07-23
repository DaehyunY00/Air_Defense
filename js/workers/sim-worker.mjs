/** IADS_C2-style ES-module worker. Classic application modules are loaded in dependency order. */
globalThis.window = globalThis;

const { installIadsKernel } = await import('../model/iads/index.js');
const classicModules = [
  '../config/system-types.js', '../config/geo-mdl.js', '../config/deployments.js',
  '../data/nodes.js', '../data/links.js', '../data/threats.js', '../data/scenarios.js', '../data/axes.js',
  '../config/deployment-adapter.js', '../core/rng.js', '../core/heap.js',
  '../analysis/bottleneck.js', '../analysis/c2-report.js', '../engine/sim-engine.js', '../analysis/mc-runner.js',
  '../analysis/transition.js', '../analysis/overlap-heatmap.js'
];

for (const modulePath of classicModules) await import(modulePath);
installIadsKernel(globalThis.KJ);
await import('./sim-worker-runtime.js');
