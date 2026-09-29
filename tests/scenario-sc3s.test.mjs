/**
 * SC3-S(남부 강화 변형) 회귀.
 *  ① SC3 불변 — sc3의 mix·southernMix가 종전 값 그대로(배분비 0.1)이고 sc3 실행 결과가 변형 추가 전과 같다(결정론 지문).
 *  ② 파생 — sc3s.mix === sc3.mix(동일 참조) · southernMix는 sc3의 5배(배분비 0.5) · 축선·위협 조합 동일.
 *  ③ 사거리 정합 — sc3s southernMix 전 항목이 ENV-AXIS-FIT-01을 통과한다.
 *  ④ 효과 — sc3s에서 남부 포대(남부 L-SAM · THAAD 성주 · 안동·대구·부산·울산·포항 천궁-II · 부산 PAC-3 · 캠프워커 Patriot) 발사 합이 sc3보다 크고,
 *     발사한 포대 수가 sc3보다 많다(FULL · As-Is · seed 29 · 900초).
 *  ⑤ 목록 — KJ.SCENARIOS에 sc3s가 있고 scenarioById('sc3s')가 그것을 돌려준다.
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

const sc3 = KJ.scenarioById('sc3'), sc3s = KJ.scenarioById('sc3s');
assert(sc3s && sc3s.id === 'sc3s' && KJ.SCENARIOS.some((s) => s.id === 'sc3s'), '⑤ sc3s 등록');
const EXPECT_SC3_SOUTH = [['srbm','southcentral',0.15],['mrl_large','southcentral',0.10],['cruise','southcentral',0.03],['fighter','southcentral',0.03],['srbm','southeast',0.15],['cruise','southeast',0.03],['fighter','southeast',0.03]];
assert(JSON.stringify(sc3.southernMix.map((e) => [e.type, e.axis, e.ratePerMin])) === JSON.stringify(EXPECT_SC3_SOUTH), '① sc3 southernMix 불변(배분비 0.1)');
assert(sc3s.mix === sc3.mix, '② sc3s.mix는 sc3.mix와 동일 참조');
assert(sc3s.southernMix.length === sc3.southernMix.length && sc3s.southernMix.every((e, i) =>
  e.type === sc3.southernMix[i].type && e.axis === sc3.southernMix[i].axis && Math.abs(e.ratePerMin - sc3.southernMix[i].ratePerMin * 5) < 1e-9),
  '② sc3s southernMix = sc3 × 5 (축선·위협 조합 동일)');
sc3s.southernMix.forEach((m) => assert(KJ.checkAxisThreatFit(m.type, m.axis).ok, `③ ${m.type}@${m.axis} 사거리 정합`));

const F = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true };
const run = (sc) => KJ.runDES({ scenario: KJ.scenarioById(sc), mode: 'asis', intensity: 1, seed: 29, endTimeSec: 900,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 2000, features: F });
const shots = (res) => { const o = {}; res.threatTraces.forEach((t) => t.stages.forEach((s) => { const m = /^(발사|자위권발사):([^/]+)/.exec(s.name); if (m) o[m[2]] = (o[m[2]] || 0) + 1; })); return o; };
// 남부 축선 탄도탄은 남부 L-SAM·THAAD(성주)가 먼저 맡고, 남부 천궁-II·PAC-3는 그 둘이 포화되기 전에는 차례가 오지 않는다(실측).
const SOUTH = /^BATTERY_(MSAM2_(ANDONG|DAEGU|BUSAN|ULSAN|POHANG)|PAC3_BUSAN|LSAM_SOUTH|THAAD_SEONGJU|USFK_PATRIOT_CAMP_WALKER)$/;
const a = run('sc3'), a2 = run('sc3'), b = run('sc3s');
assert(sha(a) === sha(a2), '① sc3 결정론(같은 입력 = 같은 결과)');
const sa = shots(a), sb = shots(b);
const south = (o) => Object.entries(o).filter(([k]) => SOUTH.test(k)).reduce((n, [, v]) => n + v, 0);
assert(b.global.spawned > a.global.spawned, `④ 생성 ${a.global.spawned} → ${b.global.spawned}`);
assert(south(sb) > south(sa), `④ 남부 포대 발사 ${south(sa)} → ${south(sb)}`);
assert(Object.keys(sb).length > Object.keys(sa).length, `④ 발사 포대 수 ${Object.keys(sa).length} → ${Object.keys(sb).length}`);
console.log(fail ? `\n${fail} FAIL` : '\nALL PASS'); process.exit(fail ? 1 : 0);
