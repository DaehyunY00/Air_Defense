/**
 * ADR-099 — C2 결심 시간 동일화(c2DecisionTimeParity) 회귀.
 *  1) OFF bit-exact — 골든 지문 불변, wire shape에 키 없음.
 *  2) As-Is 불변 — ON이어도 As-Is 결과는 features 키를 제외하면 bit-exact(IAOC가 As-Is에 없다).
 *  3) 카탈로그 — ON에서 IAOC 운용자 성분 = KAMD_OPS 운용자 성분, 체계 성분 불변, 다른 C2 불변.
 *  4) 동역학 — To-Be 평균 결심지연이 ON에서 OFF보다 길다(사람 판단 시간이 들어왔다).
 *  5) 배선 — 프로토타입 파라미터·features·칩.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js', 'data/threats.js',
  'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js']
  .forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; let fail = 0; installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
const sha = (r) => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
function run(f, opts = {}) {
  return KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: opts.mode || 'asis', intensity: 1, seed: 12345, endTimeSec: 600,
    deploymentId: 'HANBANDO_LEGACY_NORMAL', features: Object.assign({ highResolutionDeployment: true }, f) });
}
const stripFeat = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.global.features; return c; };

console.log('# 1) OFF bit-exact');
const GOLDEN = { asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21', tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f' };
const offA = run({}), offT = run({}, { mode: 'tobe' });
assert(sha(offA) === GOLDEN.asis, 'As-Is OFF = 골든'); assert(sha(offT) === GOLDEN.tobe, 'To-Be OFF = 골든');
assert(!('c2DecisionTimeParity' in offA.global.features) && !('c2DecisionTimeParity' in offT.global.features), 'OFF wire shape에 키 없음');
assert(sha(run({ c2DecisionTimeParity: false })) === GOLDEN.asis, '명시 false = 미지정');

console.log('# 2) As-Is 불변');
const onA = run({ c2DecisionTimeParity: true });
assert(onA.global.features.c2DecisionTimeParity === true, 'ON wire shape 신고');
assert(sha(stripFeat(onA)) === sha(stripFeat(offA)), 'As-Is 결과 bit-exact(features 제외)');

console.log('# 3) 카탈로그');
const catOff = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL', features: { highResolutionDeployment: true } });
const catOn = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL', features: { highResolutionDeployment: true, c2DecisionTimeParity: true } });
const iaocOff = catOff.nodes.find((n) => n.typeId === 'IAOC'), iaocOn = catOn.nodes.find((n) => n.typeId === 'IAOC');
const kamdOn = catOn.nodes.find((n) => n.typeId === 'KAMD_OPS'), kamdOff = catOff.nodes.find((n) => n.typeId === 'KAMD_OPS');
assert(iaocOn.queue.serviceParts.operatorSec === kamdOn.queue.serviceParts.operatorSec, `IAOC 운용자 = KAMD_OPS 운용자 (${iaocOn.queue.serviceParts.operatorSec}초)`);
assert(iaocOn.queue.serviceParts.systemSec[0] === iaocOff.queue.serviceParts.systemSec[0] && iaocOn.queue.serviceParts.systemSec[1] === iaocOff.queue.serviceParts.systemSec[1], 'IAOC 체계 성분 불변');
assert(iaocOff.queue.serviceParts.operatorSec < iaocOn.queue.serviceParts.operatorSec, `OFF 운용자 ${iaocOff.queue.serviceParts.operatorSec}초 < ON ${iaocOn.queue.serviceParts.operatorSec}초`);
assert(iaocOn.queue.servers === iaocOff.queue.servers, 'IAOC 석수 불변');
assert(JSON.stringify(kamdOn.queue) === JSON.stringify(kamdOff.queue), 'KAMD_OPS 큐 불변');
const mcrcOn = catOn.nodes.find((n) => n.typeId === 'MCRC'), mcrcOff = catOff.nodes.find((n) => n.typeId === 'MCRC');
assert(JSON.stringify(mcrcOn.queue) === JSON.stringify(mcrcOff.queue), 'MCRC 큐 불변');
assert(catOn !== catOff, '캐시 키 분리(다른 객체)');
const hiOn = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL', features: { highResolutionDeployment: true, c2DecisionTimeParity: true, c2OperatorLevel: 'high' } });
assert(hiOn.nodes.find((n) => n.typeId === 'IAOC').queue.serviceParts.operatorSec === KJ.C2_TYPES.KAMD_OPS.processing.operator.high, '운용 수준 high도 같은 키로 적용');

console.log('# 4) 동역학');
const onT = run({ c2DecisionTimeParity: true }, { mode: 'tobe' });
assert(onT.global.meanDecisionDelaySec > offT.global.meanDecisionDelaySec, `To-Be 평균 결심지연 OFF ${offT.global.meanDecisionDelaySec.toFixed(1)}초 < ON ${onT.global.meanDecisionDelaySec.toFixed(1)}초`);
assert(sha(stripFeat(onT)) !== sha(stripFeat(offT)), 'To-Be 결과가 달라진다');

console.log('# 5) 배선');
const proto = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
assert(/\{ k: 'par',\s+d: 1,/.test(proto), '프로토타입 파라미터 par 기본 1');
assert(/c2DecisionTimeParity: P\.par/.test(proto), 'features() 배선');
assert(proto.includes("out.push('결심 시간 동일화 ON')"), '켜진 동안 상태줄 칩');
const eng = fs.readFileSync(path.join(root, 'js/engine/sim-engine.js'), 'utf8');
assert(/ff\('c2DecisionTimeParity', false\)/.test(eng), '엔진 기본 OFF');
console.log(fail ? `\nFAILED — ${fail}건` : '\nALL PASS'); process.exit(fail ? 1 : 0);
