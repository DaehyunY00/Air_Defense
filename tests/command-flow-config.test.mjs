/** Execute the browser's configuration, observation, and result rendering without copying their logic. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { installIadsKernel } from '../js/model/iads/index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Browser source section exists: ${start}`);
  return source.slice(from, to);
}
const paramsCode = section('const PARAMS = [', 'const INTENSITY = ');
const featuresCode = section('function features() {', '/* ═');
const observationCode = section('function observationSummary(', 'function doRun()');
const tracksCode = section('function buildTracks(res) {', '/* ═');
function browserConfig(search = '') {
  const ctx = vm.createContext({ URLSearchParams, location: { search } });
  vm.runInContext(paramsCode + featuresCode + observationCode + tracksCode +
    '\nglobalThis.api = { params: PARAMS, values: P, features: features(), observationSummary, buildTracks };', ctx);
  return ctx.api;
}
// Values leave the VM realm before structural comparisons.
const plain = (value) => JSON.parse(JSON.stringify(value));

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ;
installIadsKernel(KJ);

test('omitted, empty, and explicit default URL flags produce the same typed features', () => {
  const defaults = browserConfig();
  const explicit = new URLSearchParams();
  const empty = new URLSearchParams();
  defaults.params.forEach((p) => {
    explicit.set(p.k, String(p.d));
    empty.set(p.k, '');
    if (p.t === 'bool') assert.equal(typeof defaults.values[p.k], 'boolean', p.k);
  });
  assert.deepEqual(plain(defaults.features), plain(browserConfig(explicit).features));
  assert.deepEqual(plain(defaults.features), plain(browserConfig(empty).features));
  for (const [enabled, disabled] of [['1', '0'], ['true', 'false'], ['TRUE', 'FALSE']]) {
    assert.equal(browserConfig(`?par=${enabled}`).features.c2DecisionTimeParity, true);
    assert.equal(browserConfig(`?par=${disabled}`).features.c2DecisionTimeParity, false);
  }
  assert.equal(browserConfig('').values.dur, 1800);
  assert.equal(browserConfig('?dur=invalid').values.dur, 1800);
  assert.equal(browserConfig('?dur=600').values.dur, 600);
});

test('default browser features reach the catalog as parity ON, matching explicit ?par=1', () => {
  const catalog = (search) => {
    const ui = browserConfig(search);
    return KJ.resolveModelCatalog({ deploymentId: ui.values.dep, features: ui.features });
  };
  const defaults = catalog(''), explicit = catalog('?par=1'), off = catalog('?par=0');
  const node = (c, type) => c.nodes.find((n) => n.typeId === type);
  const iaoc = node(defaults, 'IAOC');
  assert.deepEqual(iaoc.queue, node(explicit, 'IAOC').queue);
  assert.equal(iaoc.queue.serviceParts.operatorSec, 30);
  assert.equal(iaoc.queue.serviceParts.operatorSec, node(defaults, 'KAMD_OPS').queue.serviceParts.operatorSec);
  assert.equal(node(off, 'IAOC').queue.serviceParts.operatorSec, 1);
});

test('actual capped runs show whole-run outcomes and distinguish both observation limits', () => {
  const ui = browserConfig();
  const cfg = { scenario: KJ.scenarioById(ui.values.sc), deploymentId: ui.values.dep,
    mode: 'tobe', seed: ui.values.seed, endTimeSec: 600, intensity: 1,
    modelFidelity: 'iads-c2', features: ui.features, trace: true, flowTrace: true };
  const full = KJ.runDES({ ...cfg, traceCap: 300 });
  const traceCapped = KJ.runDES({ ...cfg, traceCap: 2 });
  const bothCapped = KJ.runDES({ ...cfg, traceCap: 2, flowTraceCap: 1000 });
  assert.deepEqual(full.global, traceCapped.global, 'trace cap cannot change outcomes');
  assert.deepEqual(full.global, bothCapped.global, 'flow cap cannot change outcomes');
  assert.equal(traceCapped.traceTruncated, true);
  assert.equal(traceCapped.flowTruncated, false);
  assert.equal(bothCapped.flowTruncated, true);
  assert.ok(full.global.censoredRaw > 0, 'finite observation window includes unresolved threats');
  for (const res of [full, traceCapped, bothCapped]) {
    const tracks = ui.buildTracks(res).tracks;
    const summary = ui.observationSummary(res, tracks);
    const g = res.global;
    assert.equal(g.spawned, g.killed + g.leaked + g.censoredRaw);
    assert.ok(summary.status.includes(`전체 생성 ${g.spawned}개`));
    assert.ok(summary.status.includes(`상세 기록 ${tracks.length}/${g.spawned}개`));
    assert.ok(summary.status.includes(`격추 ${g.killed} / 누수 ${g.leaked} / 종료 미해결 ${g.censoredRaw}`));
    assert.equal(summary.status.includes('항적 기록 상한 절삭'), res.traceTruncated);
    assert.equal(summary.status.includes('흐름 기록 상한 절삭'), res.flowTruncated);
    assert.equal(summary.trackTitle.includes('표본'), res.traceTruncated);
    assert.equal(summary.mapScope.includes('표본 기준'), res.traceTruncated);
    assert.equal(summary.multiFireLabel.includes('표본 기준'), res.traceTruncated);
  }
});

test('long-run display keeps 455 global threats separate from 300 detailed records', () => {
  const ui = browserConfig();
  const tracks = Array.from({ length: 300 }, (_, i) => ({ fireShooters: i < 2 ? ['A', 'B'] : ['A'] }));
  const summary = ui.observationSummary({
    global: { spawned: 455, killed: 300, leaked: 123, censoredRaw: 32 },
    traceTruncated: true, flowTruncated: false, flowEvents: []
  }, tracks);
  assert.ok(summary.status.includes('전체 생성 455개 · 상세 기록 300/455개'));
  assert.equal(summary.multiFireLabel, '복수 사수 발사 2건 · 300개 표본 기준');
  assert.equal(summary.trackCountLabel, '300/455개 표본');
  assert.ok(summary.mapScope.includes('300/455개 표본 기준'));
});

test('recorded routes retain active communication stroke emphasis', () => {
  const recordedRule = source.match(/(\.edge\.recorded-route[^{}]*)\{([^}]+)\}/);
  assert.ok(recordedRule, 'completed-route style exists');
  assert.ok(recordedRule[1].includes(':not(.hot)'),
    'completed-route styling must exclude active edges regardless of stylesheet order');
  const activeRule = source.match(/\.edge\.hot\s*\{([^}]+)\}/);
  assert.ok(activeRule && /stroke-width:\s*calc\(var\(--w,\s*2\)\s*\*\s*2\.1\)/.test(activeRule[1]),
    'active edges retain their traffic-dependent width multiplier');
});

test('BDA result replaces flight at the exact recorded result time and remains visible at track end', () => {
  const shotsCode = section('function shotsSvg() {', '/** 발사불가 사유 코드');
  const flashDeclaration = source.match(/const SHOT_FLASH = [^;]+;/);
  assert.ok(flashDeclaration, 'browser flash duration exists');
  for (const hit of [true, false]) {
    const track = { id: 'BOUNDARY', endT: 10, exitT: hit ? 10 : null,
      shots: [{ shooter: 'BATTERY', t0: 2, t1: 10, hit }], noFire: [] };
    const ctx = vm.createContext({
      mapGeo: {}, view: 'track', sel: track, speed: 1, simT: 0,
      run: { tracks: [track], nodes: { BATTERY: { coord: [0, 0] } } },
      // Geometry and text helpers are independent of the result-time boundary.
      mproj: (pos) => pos, threatPosAt: () => [1, 1],
      nodeName: (id) => id, fmt: (time) => String(time), esc: (text) => String(text)
    });
    vm.runInContext(flashDeclaration[0] + shotsCode, ctx);
    const renderAt = (at) => { ctx.simT = at; return vm.runInContext('shotsSvg()', ctx); };
    assert.equal(renderAt(1), '', 'no shot is drawn before launch');
    assert.match(renderAt(9.999), /class="mshot"/, 'flight is visible immediately before BDA');
    const atResult = renderAt(track.endT);
    assert.doesNotMatch(atResult, /class="mshot"/, 'flight ends at BDA, including the final playback instant');
    assert.match(atResult, hit ? /class="mhit"/ : /class="mmiss"/,
      'the recorded HIT or MISS marker is visible at the exact BDA timestamp');
    assert.match(renderAt(30), hit ? /class="mhit"/ : /class="mmiss"/,
      'individual-track result remains visible after the result time');
    ctx.view = 'all';
    assert.match(renderAt(10), hit ? /class="mhit"/ : /class="mmiss"/,
      'overview also starts its result flash at BDA');
    assert.equal(renderAt(30), '', 'overview result still disappears after its flash interval');
  }
});
