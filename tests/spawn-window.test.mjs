/**
 * 위협 생성 구간(spawnUntilSec) 회귀.
 *  ① 미지정 = endTimeSec와 같음(bit-exact) · 생성 구간을 따로 준 경우만 결과 cfg에 spawnUntilSec 신고.
 *  ② 생성 구간 뒤에는 새 위협이 생기지 않는다(마지막 생성 시각 ≤ spawnUntilSec).
 *  ③ 생성 1800초 · 관측 3600초면 SC3 강도 1배(seed 29)에서 미해결(관측 절단) 0.
 *  ④ 생성 구간이 같으면 관측을 늘려도 생성 집합(수·시각)이 같다(도착 스트림 불변).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js', 'data/threats.js',
 'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);
let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const sha = (r) => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const SCREEN = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true,
  rokUsfkCoordination: 'voice', commanderRouteRetry: true, shoradCruiseExclusion: true, shoradPkRealism: true, earlyShooterAssignment: true };
const run = (opts) => KJ.runDES(Object.assign({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1, seed: 29, endTimeSec: 900,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 2000, features: SCREEN }, opts || {}));

const base = run(), same = run({ spawnUntilSec: 900 }), bigger = run({ spawnUntilSec: 5000 });
assert(sha(base) === sha(same) && sha(base) === sha(bigger), '① 미지정 = endTimeSec · 관측보다 큰 값은 관측으로 잘림 (bit-exact)');
assert(base.config.spawnUntilSec === undefined && same.config.spawnUntilSec === undefined, '① 기본·관측과 같은 값은 cfg에 신고하지 않음(wire shape 불변)');

const win = run({ endTimeSec: 900, spawnUntilSec: 300 });
const lastSpawn = Math.max(...win.threatTraces.map((t) => t.spawnT));
assert(lastSpawn <= 300 && win.global.spawned < base.global.spawned, `② 생성 구간 300초 뒤 생성 0 (마지막 생성 ${lastSpawn.toFixed(0)}초 · ${win.global.spawned} < ${base.global.spawned})`);
assert(win.config.spawnUntilSec === 300, '② cfg 신고 300');

const full = run({ endTimeSec: 3600, spawnUntilSec: 1800 });
const unresolved = full.global.spawned - full.global.killed - full.global.leaked;
assert(unresolved === 0 && full.global.censored === 0, `③ 생성 1800 · 관측 3600: 미해결 ${unresolved} (생성 ${full.global.spawned} = 격추 ${full.global.killed} + 누수 ${full.global.leaked})`);

const short = run({ endTimeSec: 1800 });
const key = (r) => r.threatTraces.map((t) => t.id + '@' + t.spawnT.toFixed(3)).join('|');
assert(key(short) === key(full), '④ 생성 1800초가 같으면 관측 1800/3600의 생성 집합 동일');

console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
