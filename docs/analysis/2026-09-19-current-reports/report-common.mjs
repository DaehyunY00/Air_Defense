import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
const prototypePath = path.join(ROOT, 'prototype/command-flow.html');
const source = fs.readFileSync(prototypePath, 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error('Prototype section missing: ' + start);
  return source.slice(from, to);
}
export function currentUIConfig(search = '') {
  const context = vm.createContext({ URLSearchParams, location: { search } });
  vm.runInContext(section('const PARAMS = [', 'const INTENSITY = ') +
    section('function features() {', '/* ═') +
    '\nglobalThis.result = { params: PARAMS, values: P, features: features() };', context);
  return JSON.parse(JSON.stringify(context.result));
}
export const UI = currentUIConfig();
export const BASE = UI.features;
export const DEPLOYMENTS = ['HANBANDO_LEGACY_NORMAL', 'HANBANDO_FULL_NORMAL'];
export function metadata() {
  const files = ['js/engine/sim-engine.js', 'js/config/deployment-adapter.js', 'prototype/command-flow.html'];
  return { generatedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')])),
    defaultValues: UI.values, flags: BASE, intensity: 1,
    defaultsSource: 'prototype/command-flow.html: PARAMS + parseCommandFlowParams + features (executed in isolated VM)',
    scope: 'Conceptual ground-based air-defense command-flow simulation; no operational validation',
    workbookRole: 'Reference/export only; no XLSX import into engine' };
}
export function config(KJ, options = {}) {
  const { dep = UI.values.dep, mode = UI.values.mode, sc = UI.values.sc, seed = UI.values.seed,
    dur = UI.values.dur, x = 1, feat = {}, ...observation } = options;
  return { scenario: KJ.scenarioById(sc), mode, intensity: x, seed, endTimeSec: dur,
    deploymentId: dep, modelFidelity: 'iads-c2', features: { ...BASE, ...feat }, ...observation };
}
export function stats(values) {
  const xs = values.filter(Number.isFinite), n = xs.length;
  if (!n) return { n: 0, mean: null, median: null, lo: null, hi: null, min: null, max: null };
  const mean = xs.reduce((s,x) => s+x, 0)/n;
  const sorted = xs.slice().sort((a,b)=>a-b), m = Math.floor(n/2);
  const sd = n > 1 ? Math.sqrt(xs.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)) : null;
  // Student t(19) for the predeclared 20 paired seeds; no CI for single-seed experiments.
  const half = n === 20 ? 2.093024054 * sd / Math.sqrt(n) : null;
  return { n, mean, median: n%2 ? sorted[m] : (sorted[m-1]+sorted[m])/2, sd,
    lo: half === null ? null : mean-half, hi: half === null ? null : mean+half,
    min: sorted[0], max: sorted[n-1] };
}
