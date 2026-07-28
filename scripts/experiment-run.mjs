#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — As-Is ↔ To-Be 비교 실험 러너
 *
 * 시나리오(SC1/SC2/SC3) × 배치(legacy/LEGACY_HIRES/FULL) × 모델충실도(compat/iads-c2)의
 * 각 셀에서 As-Is와 To-Be를 **동일 seed로 짝지어(paired)** 반복 실행하고,
 * seed별 Δ(To-Be − As-Is)의 95% 신뢰구간으로 구조 차이의 통계적 분리를 판정한다.
 *
 * 실행:
 *   node scripts/experiment-run.mjs --out artifacts/experiment/cell.json --cell "sc3|legacy|compat|1|30"
 *   node scripts/experiment-run.mjs --out artifacts/experiment/sweep.json --sweep "legacy|compat|20"
 *
 * 셀 사양: "<시나리오>|<배치>|<충실도>|<강도>|<복제수>"
 * 스윕 사양: "<배치>|<충실도>|<복제수>"  (강도 0.5~3.0을 0.25 간격 11점)
 *
 * 결정론: 동일 인자 → 동일 결과(JSON). 복제 시드는 mc-runner와 같은 격자를 쓴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, runCell, ROOT } from './experiment-lib.mjs';

function arg(name, dflt = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const BASE_SEED = Number(arg('seed', '12345'));
const DURATION = Number(arg('dur', '1800'));

const KJ = loadEngine();

function writeOut(outRel, value) {
  const out = path.isAbsolute(outRel) ? outRel : path.join(ROOT, outRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(value, null, 2) + '\n');
  return out;
}

const cellSpec = arg('cell');
const sweepSpec = arg('sweep');

if (cellSpec) {
  const [scenario, deployment, fidelity, intensity, reps] = cellSpec.split('|');
  const spec = {
    scenario, deployment, fidelity,
    intensity: Number(intensity), endTimeSec: DURATION
  };
  const result = runCell(KJ, spec, Number(reps), BASE_SEED);
  const out = writeOut(arg('out', `artifacts/experiment/${scenario}-${deployment}-${fidelity}-x${intensity}.json`), result);
  console.log(`[cell] ${cellSpec} reps=${reps} ${(result.elapsedMs / 1000).toFixed(1)}s → ${out}`);
} else if (sweepSpec) {
  // 강도 스윕: 임계 전환점(As-Is C2 포화)과 개선폭의 부하 의존성을 본다.
  const [deployment, fidelity, reps] = sweepSpec.split('|');
  const points = [];
  for (let s = 0; s <= 10; s++) {
    const intensity = +(0.5 + s * 0.25).toFixed(4);
    for (const scenario of ['sc1', 'sc2', 'sc3']) {
      const spec = { scenario, deployment, fidelity, intensity, endTimeSec: DURATION };
      const cell = runCell(KJ, spec, Number(reps), BASE_SEED);
      points.push({
        scenario, intensity,
        asis: {
          leakRateSpawn: cell.asis.leakRateSpawn.mean,
          killRateSpawn: cell.asis.killRateSpawn.mean,
          censoredRate: cell.asis.censoredRate.mean,
          spawned: cell.asis.spawned.mean,
          c2MaxRhoTrack: cell.asis.c2MaxRhoTrack.mean,
          apprMaxRho: cell.asis.apprMaxRho.mean
        },
        tobe: {
          leakRateSpawn: cell.tobe.leakRateSpawn.mean,
          killRateSpawn: cell.tobe.killRateSpawn.mean,
          censoredRate: cell.tobe.censoredRate.mean
        },
        deltaLeak: cell.delta.leakRateSpawn
      });
      console.log(`[sweep] ${scenario} x${intensity} done (${(cell.elapsedMs / 1000).toFixed(1)}s)`);
    }
  }
  const out = writeOut(arg('out', `artifacts/experiment/sweep-${deployment}-${fidelity}.json`),
    { deployment, fidelity, reps: Number(reps), baseSeed: BASE_SEED, endTimeSec: DURATION, points });
  console.log(`[sweep] → ${out}`);
} else {
  console.error('사용법: --cell "sc3|legacy|compat|1|30"  또는  --sweep "legacy|compat|20"');
  process.exit(2);
}
