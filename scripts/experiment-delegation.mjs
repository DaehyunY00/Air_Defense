#!/usr/bin/env node
/**
 * K-JAMDS 시뮬레이터 — As-Is 동적 권한위임(분권 전환)의 부하 의존성 측정
 *
 * 강도 스윕에서 As-Is 요격 실패율이 부하 증가와 함께 오히려 **낮아지는** 현상이 관측되어,
 * 그 원인이 절단(관측종료 미해결)이 아니라 **동적 분권 전환**임을 분리 검증한다.
 * 승인권자 대기열이 임계(C2-DELEG-THRESH-01, As-Is는 서버수×4)를 넘으면 결심을 하위/자동으로
 * 위임해 승인 단계를 건너뛰므로, 고부하에서 결심 지연이 짧아지고 교전 개시율이 오른다.
 *
 * ADR-061: legacy 배치·compat 폐기 후에는 고해상도 기본 배치 × iads-c2 위에서 승인 계선을
 * 켜고(ADR-058 `approvalChain`) 같은 현상을 측정한다 — 위임·승인 대기열은 native 승인
 * 게이트(`_iadsApprovalGate`)가 계상한다. 구 legacy 측정치는 delegation-legacy-sc3.json 기록.
 *
 * 실행: node scripts/experiment-delegation.mjs
 * 산출: artifacts/experiment/delegation-hires-sc3.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, cellConfig, repSeed, ROOT } from './experiment-lib.mjs';

const KJ = loadEngine();
const REPS = Number(process.env.DELEG_REPS || 12);
const BASE_SEED = 12345;
const INTENSITIES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

const points = [];
for (const intensity of INTENSITIES) {
  const acc = { deleg: 0, decision: 0, apprRho: 0, engaged: 0, spawned: 0, killed: 0, leaked: 0, censored: 0 };
  for (let i = 0; i < REPS; i++) {
    const r = KJ.runDES(cellConfig(KJ, {
      scenario: 'sc3', mode: 'asis', deployment: 'HANBANDO_LEGACY_NORMAL', intensity,
      seed: repSeed(BASE_SEED, i), features: { approvalChain: true }
    }));
    const g = r.global;
    acc.deleg += g.delegation.count;
    acc.decision += g.everEngaged > 0 ? g.meanDecisionDelaySec : 0;
    acc.apprRho += r.nodes.reduce((m, n) =>
      n.category === 'c2' ? Math.max(m, (n.rhoByKind && n.rhoByKind.approval) || 0) : m, 0);
    acc.engaged += g.everEngaged;
    acc.spawned += g.spawned;
    acc.killed += g.killed;
    acc.leaked += g.leaked;
    acc.censored += g.censoredRaw || 0;
  }
  points.push({
    intensity,
    delegationCount: acc.deleg / REPS,
    meanDecisionDelaySec: acc.decision / REPS,
    approvalMaxRho: acc.apprRho / REPS,
    engageStartRate: acc.spawned ? acc.engaged / acc.spawned : null,
    killRateSpawn: acc.spawned ? acc.killed / acc.spawned : null,
    leakRateSpawn: acc.spawned ? acc.leaked / acc.spawned : null,
    censoredRate: acc.spawned ? acc.censored / acc.spawned : null,
    spawned: acc.spawned / REPS
  });
  console.log(`x${intensity} deleg=${(acc.deleg / REPS).toFixed(1)} decision=${(acc.decision / REPS).toFixed(0)}s ` +
    `kill=${((acc.killed / acc.spawned) * 100).toFixed(1)}%`);
}

const out = path.join(ROOT, 'artifacts', 'experiment', 'delegation-hires-sc3.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  scenario: 'sc3', deployment: 'HANBANDO_LEGACY_NORMAL', fidelity: 'iads-c2', mode: 'asis',
  features: { approvalChain: true },
  reps: REPS, baseSeed: BASE_SEED, points,
  note: 'As-Is 동적 분권 전환(C2-DELEG-THRESH-01)의 부하 의존성 — ADR-058 승인 계선(native) 기준. 승인 대기열이 서버수×4를 넘으면 전환.'
}, null, 2) + '\n');
console.log('→', out);
