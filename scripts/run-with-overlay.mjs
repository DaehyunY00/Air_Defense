#!/usr/bin/env node
/**
 * 덮어쓰기(overlay) 적용 실행(ADR-108) — xlsx 가져오기로 만든 overlay JSON을 엔진에 얹어 돌리고, 같은 조건의
 * 기준 실행(overlay 없음)과 나란히 요약한다. 화면 없이 엔진만 쓴다.
 *
 * 실행:  node scripts/run-with-overlay.mjs [overlay.json] [--mode asis|tobe|both] [--seed 29] [--dur 1800] [--x 1]
 *                                         [--deployment HANBANDO_FULL_NORMAL] [--sc sc3] [--json 결과.json]
 *   · 기본 overlay: 저장소 루트 K-JAMDS_파라미터_overlay.json · 기본 mode both
 *   · 플래그는 [지휘 흐름] 화면 기본값(bsrc·cue·coal·rr·nocm·shpk 포함)과 같다. --flags '{"standbyCue":false}'로 덮어쓴다.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js',
  'data/threats.js', 'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js',
  'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const overlayPath = argv.find((a) => a.endsWith('.json') && argv[argv.indexOf(a) - 1] !== '--json' && argv[argv.indexOf(a) - 1] !== '--flags') || path.join(root, 'K-JAMDS_파라미터_overlay.json');
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
const modes = opt('--mode', 'both') === 'both' ? ['asis', 'tobe'] : [opt('--mode', 'both')];
const seed = +opt('--seed', 29), dur = +opt('--dur', 1800), x = +opt('--x', 1);
const depId = opt('--deployment', overlay.deploymentId || 'HANBANDO_FULL_NORMAL'), sc = opt('--sc', 'sc3');
const SCREEN = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true, selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true,
  c2DecisionTimeParity: true, approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true,
  rokUsfkCoordination: { asis: 'voice', tobe: 'datalink' }, commanderRouteRetry: true, shoradCruiseExclusion: true, shoradPkRealism: true };
const flags = Object.assign({}, SCREEN, JSON.parse(opt('--flags', '{}')));

function run(mode, withOverlay) {
  const features = Object.assign({}, flags, withOverlay ? { catalogOverlay: overlay } : {});
  const res = KJ.runDES({ scenario: KJ.scenarioById(sc), mode, intensity: x, seed, endTimeSec: dur, deploymentId: depId,
    modelFidelity: 'iads-c2', trace: true, traceCap: 5000, features });
  const g = res.global; const shots = {};
  res.threatTraces.forEach((t) => t.stages.forEach((s) => { const m = /^(발사|자위권발사):([^/]+)/.exec(s.name); if (m) shots[m[2].replace('BATTERY_', '')] = (shots[m[2].replace('BATTERY_', '')] || 0) + 1; }));
  const byType = {}; res.threatTraces.forEach((t) => { const b = byType[t.type] = byType[t.type] || { n: 0, killed: 0 }; b.n++; if (t.outcome === 'killed') b.killed++; });
  const c2 = res.nodes.filter((n) => n.category === 'c2').sort((a, b) => b.rho - a.rho).slice(0, 3).map((n) => `${n.name.replace(/\s.*$/, '')} ${n.rho.toFixed(2)}`);
  return { mode, overlay: withOverlay, spawned: g.spawned, killed: g.killed, leaked: g.leaked, unresolved: g.spawned - g.killed - g.leaked, shots: g.shotsFired,
    meanTimeToKillSec: +g.meanTimeToKillSec.toFixed(1), leakReasons: g.leakReasons, byType, topShooters: Object.entries(shots).sort((a, b) => b[1] - a[1]).slice(0, 8),
    topC2: c2, bottlenecks: res.bottlenecks.map((b) => b.name + ' ' + b.detail), features: res.global.features.catalogOverlay || null };
}
const out = [];
console.log(`overlay: ${overlayPath} (노드 ${Object.keys(overlay.nodes || {}).length} · 계선 ${(overlay.links || []).length} · 제거 ${(overlay.removeNodes || []).length}) · ${depId} · ${sc} · seed ${seed} · ${dur}s · 강도 ${x}`);
for (const mode of modes) {
  const base = run(mode, false), ov = run(mode, true); out.push(base, ov);
  const bt = (r) => Object.entries(r.byType).map(([k, v]) => `${k} ${v.killed}/${v.n}`).join(' · ');
  console.log(`\n== ${mode}`);
  console.log(`  기준    : 격추 ${base.killed} 누수 ${base.leaked} 미해결 ${base.unresolved} · 발사 ${base.shots} · 평균 격추 ${base.meanTimeToKillSec}s · ${bt(base)}`);
  console.log(`  overlay : 격추 ${ov.killed} 누수 ${ov.leaked} 미해결 ${ov.unresolved} · 발사 ${ov.shots} · 평균 격추 ${ov.meanTimeToKillSec}s · ${bt(ov)}`);
  console.log(`  overlay 적용 요약: ${JSON.stringify(ov.features)}`);
  console.log(`  최다 발사(기준)   : ${base.topShooters.map(([k, v]) => k + ':' + v).join(' ')}`);
  console.log(`  최다 발사(overlay): ${ov.topShooters.map(([k, v]) => k + ':' + v).join(' ')}`);
  console.log(`  C2 이용률 상위(overlay): ${ov.topC2.join(' · ')} · 병목: ${ov.bottlenecks.join(' | ') || '없음'}`);
  if (ov.features && (ov.features.unknownNodes || ov.features.unknownLinks)) console.log(`  ⚠ overlay에 카탈로그에 없는 항목이 있습니다(노드 ${ov.features.unknownNodes} · 계선 ${ov.features.unknownLinks})`);
}
const jsonOut = opt('--json', null); if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`\n→ ${jsonOut}`); }
