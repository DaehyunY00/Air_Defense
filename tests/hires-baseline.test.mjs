/**
 * ADR-061 — 고해상도 기준선 (기준선 이관).
 *
 * 폐기 직전(2026-07-28) LEGACY_HIRES × iads-c2 × seed 12345 × 900초 × 기본 플래그의
 * SHA-256 6케이스(SC1/SC2/SC3 × As-Is/To-Be)를 tests/hires-baseline.json으로 잠근다.
 * ⚠️ "개선 이전 지문"이 아니라 "이관 시점 지문"이다 — 되돌리기 증명의 의미가
 * "이관 후 회귀 없음"으로 약해진다(ADR-061 §한계). legacy 폐기 커밋에서 이 6케이스가
 * 폐기 전과 bit-exact임이 실측 증명되었다(전후 해시 6/6 일치).
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..', 'js');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, f)); });
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

var baseline = JSON.parse(fs.readFileSync(path.join(dir, 'hires-baseline.json'), 'utf8'));
Object.keys(baseline.cases).forEach(function (key) {
  var parts = key.split('|'), exp = baseline.cases[key];
  var r = KJ.runDES({
    scenario: KJ.scenarioById(parts[0]), mode: parts[1],
    intensity: baseline.config.intensity, seed: baseline.config.seed,
    endTimeSec: baseline.config.endTimeSec,
    deploymentId: baseline.config.deploymentId, modelFidelity: 'iads-c2',
    features: { highResolutionDeployment: true }
  });
  var h = crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
  assert(h === exp.sha256, key + ' SHA-256 기준선 일치');
  assert(r.global.killed === exp.killed && r.global.leaked === exp.leaked, key + ' 격추/누수 일치');
});
console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
