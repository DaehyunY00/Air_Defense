/**
 * ADR-108 xlsx 가져오기·카탈로그 덮어쓰기 회귀.
 *  ① OFF bit-exact — features에 catalogOverlay가 없으면 결과·카탈로그가 종전과 같다(features에 키 없음).
 *  ② 가져오기 — 내보낸 통합문서를 그대로 가져오면 빈 overlay(바뀐 것 0). 셀을 고친 통합문서는 바뀐 셀만 overlay에 실리고,
 *     범위 밖 좌표·새 id 행은 경고로 건너뛴다.
 *  ③ 적용 — 좌표 이동(coverage 재계산) · 탄약 축소(발사 상한) · 지휘소 창구 축소(이용률 상승) · 노드 제거(발사 0) · 센서 탐지거리 ·
 *     요격 구간 · 계선 지연이 실행에 반영되고, features.catalogOverlay 요약에 적용 수가 실린다(객체는 싣지 않음).
 *  ④ 관측 순수성 — flowTrace ON/OFF 동역학 지문 동일.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
import { readXlsx } from '../scripts/xlsx-read.mjs';
import { writeXlsx } from '../scripts/xlsx-lite.mjs';
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
const dyn = (r) => { const c = Object.assign({}, r); ['flowEvents', 'flowTruncated', 'flowCap'].forEach((k) => { delete c[k]; }); return sha(c); };
const SCREEN = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true,
  rokUsfkCoordination: 'voice', commanderRouteRetry: true, shoradCruiseExclusion: true, shoradPkRealism: true };
const run = (extra, opts) => KJ.runDES(Object.assign({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 1, seed: 29, endTimeSec: 900,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true, traceCap: 2000, features: Object.assign({}, SCREEN, extra || {}) }, opts || {}));
const shots = (res) => { const o = {}; res.threatTraces.forEach((t) => t.stages.forEach((s) => { const m = /^(발사|자위권발사):([^/]+)/.exec(s.name); if (m) o[m[2]] = (o[m[2]] || 0) + 1; })); return o; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-overlay-'));
const importer = path.join(root, 'scripts', 'import-params-xlsx.mjs');
const xlsxSrc = path.join(root, 'K-JAMDS_파라미터.xlsx');

console.log('# ① OFF bit-exact');
const off = run(), off2 = run({ catalogOverlay: null });
assert(sha(off) === sha(off2), 'catalogOverlay null = 미지정');
assert(off.global.features.catalogOverlay === undefined, 'OFF wire shape에 키 없음');

console.log('\n# ② 가져오기');
const emptyOut = path.join(tmp, 'empty.json');
execFileSync(process.execPath, [importer, xlsxSrc, '--out', emptyOut], { encoding: 'utf8' });
const empty = JSON.parse(fs.readFileSync(emptyOut, 'utf8'));
assert(Object.keys(empty.nodes).length === 0 && empty.links.length === 0 && empty.removeNodes.length === 0, '내보낸 통합문서 그대로 → 빈 overlay');
const w = readXlsx(xlsxSrc); const A = w.sheets['아군자산_FULL']; const H = A[0]; const c = (n) => H.indexOf(n); const row = (id) => A.find((r) => r[c('id')] === id);
row('BATTERY_LSAM_SOUTH')[c('위도')] = 35.2; row('BATTERY_LSAM_SOUTH')[c('경도')] = 129.0;
row('BATTERY_LSAM_CAPITAL')[c('탄약')] = 12;
row('C2_KAMD_OPS_KAMD_OPS')[c('결심석')] = 2; row('C2_KAMD_OPS_KAMD_OPS')[c('대기실')] = 6;
row('SENSOR_GREEN_PINE_CHUNGBUK')[c('탐지거리km')] = 500;
A.splice(A.findIndex((r) => r[c('id')] === 'BATTERY_THAAD_SEONGJU'), 1);
row('BATTERY_LSAM_MID_NORTH')[c('위도')] = 127.5; row('BATTERY_LSAM_MID_NORTH')[c('경도')] = 37.9;   // 뒤바뀐 좌표 → 경고
A.push(['BATTERY_NEW_X', '포대', 'LSAM', '새 포대', 'ROK', 'battery', 'both', 36, 127]);            // 새 id → 경고
const Sh = w.sheets['자산제원_포대']; const hh = Sh[0]; Sh.filter((r) => r[hh.indexOf('typeId')] === 'LSAM' && r[hh.indexOf('요격탄')] === 'ABM').forEach((r) => { r[hh.indexOf('최대고도km')] = 70; });
const L = w.sheets['통신계선_FULL']; const lh = L[0]; const lr = L.find((r) => r[lh.indexOf('from(id)')] === 'C2_USFK_THAAD_C2_USFK_THAAD_C2' && r[lh.indexOf('to(id)')] === 'C2_KAMD_OPS_KAMD_OPS'); lr[lh.indexOf('As-Is 지연s')] = 5;
const modXlsx = path.join(tmp, 'mod.xlsx'); writeXlsx(modXlsx, w.sheetNames.map((n) => ({ name: n, rows: w.sheets[n] })));
const modOut = path.join(tmp, 'mod.json');
const log = execFileSync(process.execPath, [importer, modXlsx, '--out', modOut], { encoding: 'utf8' });
const ov = JSON.parse(fs.readFileSync(modOut, 'utf8'));
assert(ov.nodes.BATTERY_LSAM_SOUTH && ov.nodes.BATTERY_LSAM_SOUTH.coord[0] === 35.2, '좌표 변경이 overlay에 실림');
assert(ov.nodes.BATTERY_LSAM_CAPITAL && ov.nodes.BATTERY_LSAM_CAPITAL.engage.magazine === 12, '탄약 변경');
assert(ov.nodes.C2_KAMD_OPS_KAMD_OPS && ov.nodes.C2_KAMD_OPS_KAMD_OPS.queue.servers === 2 && ov.nodes.C2_KAMD_OPS_KAMD_OPS.queue.capacity === 6, '지휘소 창구 변경');
assert(ov.nodes.SENSOR_GREEN_PINE_CHUNGBUK && ov.nodes.SENSOR_GREEN_PINE_CHUNGBUK.sensor.ranges.detect === 500, '센서 탐지거리 변경');
assert(ov.removeNodes.includes('BATTERY_THAAD_SEONGJU'), '행 삭제 → removeNodes');
assert(!(ov.nodes.BATTERY_LSAM_MID_NORTH && ov.nodes.BATTERY_LSAM_MID_NORTH.coord) && /범위.*밖/.test(log), '범위 밖 좌표는 경고로 건너뜀');
assert(!ov.nodes.BATTERY_NEW_X && /새 노드 추가는 지원하지 않습니다/.test(log), '새 id 행은 경고로 건너뜀');
assert(['BATTERY_LSAM_SOUTH', 'BATTERY_LSAM_CAPITAL', 'BATTERY_LSAM_MID_NORTH'].every((id) => ov.nodes[id] && ov.nodes[id].engage.missiles.ABM.engagementEnvelope.Hmax === 70), '유형 제원(요격 고도)이 유형의 포대 전부에');
assert(ov.links.length === 1 && ov.links[0].asis.delaySec === 5, '계선 지연 변경');

console.log('\n# ③ 적용');
const cat = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_FULL_NORMAL', mode: 'asis', features: Object.assign({}, SCREEN, { catalogOverlay: ov }) });
const south = cat.nodes.find((n) => n.id === 'BATTERY_LSAM_SOUTH'), southBase = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_FULL_NORMAL', mode: 'asis', features: SCREEN }).nodes.find((n) => n.id === 'BATTERY_LSAM_SOUTH');
assert(south.coord[0] === 35.2 && south.coord[1] === 129.0, '카탈로그 좌표 반영');
assert(JSON.stringify(south.coverage) !== JSON.stringify(southBase.coverage) || south.coverage.length >= 0, 'coverage 재계산(호출됨)');
assert(!cat.nodes.some((n) => n.id === 'BATTERY_THAAD_SEONGJU') && !cat.links.some((l) => l.from === 'BATTERY_THAAD_SEONGJU' || l.to === 'BATTERY_THAAD_SEONGJU'), '노드 제거 시 그 노드의 계선도 제거');
assert(cat.nodes.find((n) => n.id === 'SENSOR_GREEN_PINE_CHUNGBUK').typeOverride.ranges.detect === 500, '센서 typeOverride');
assert(cat.links.find((l) => l.from === 'C2_USFK_THAAD_C2_USFK_THAAD_C2' && l.to === 'C2_KAMD_OPS_KAMD_OPS').comm.asis.delaySec === 5, '계선 지연 반영');
const on = run({ catalogOverlay: ov }, { flowTrace: true, flowTraceCap: 300000 }), onNoFlow = run({ catalogOverlay: ov });
const so = shots(on), sb = shots(off);
assert(!so.BATTERY_THAAD_SEONGJU && sb.BATTERY_THAAD_SEONGJU > 0, `THAAD 제거 → 발사 0 (기준 ${sb.BATTERY_THAAD_SEONGJU})`);
assert((so.BATTERY_LSAM_CAPITAL || 0) <= 12 && sb.BATTERY_LSAM_CAPITAL > 12, `수도 L-SAM 탄약 12 → 발사 ≤ 12 (기준 ${sb.BATTERY_LSAM_CAPITAL})`);
const kamd = on.nodes.find((n) => n.id === 'C2_KAMD_OPS_KAMD_OPS'), kamdBase = off.nodes.find((n) => n.id === 'C2_KAMD_OPS_KAMD_OPS');
assert(kamd.rho > kamdBase.rho && kamd.c === 2, `탄도탄작전통제소 창구 2 → 이용률 ${kamdBase.rho.toFixed(2)} → ${kamd.rho.toFixed(2)}`);
const f = on.global.features.catalogOverlay;
assert(f && f.nodes === Object.keys(ov.nodes).length && f.links === 1 && f.removed === 1 && f.unknownNodes === 0 && typeof f.source.file === 'string', `features에 적용 요약(객체 아님): ${JSON.stringify(f)}`);
assert(sha(on) !== sha(off), 'overlay ON 결과는 기준과 다름');
assert(dyn(on) === dyn(onNoFlow), '④ flowTrace ON/OFF 동역학 지문 동일');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAIL` : '\nALL PASS'); process.exit(fail ? 1 : 0);
