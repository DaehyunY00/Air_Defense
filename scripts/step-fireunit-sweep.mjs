/**
 * WP1 스윕 — MFR 동시교전 채널 수 민감도 (작업지시서 §5-3).
 * MFR 채널 {2,3,4,6} × SC1/SC2/SC3 × seed 1~20 × 양모드. fireUnitLayer ON.
 * (자체교전 selfDefenseWindowSec·selfDefensePkMult 스윕은 WP2에서 확장 — 본 스크립트에 추가.)
 * 실행: node scripts/step-fireunit-sweep.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
global.window = global;
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'data/fire-units.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(f => require(path.join(root, 'js', f)));
const KJ = global.KJ;

const CHANNELS = [2, 3, 4, 6];
const SCEN = ['sc1', 'sc2', 'sc3'];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

console.log('WP1 MFR 채널 스윕 (fireUnitLayer ON, intensity 1.5, seed 1~20 평균)');
console.log('scenario/mode | ch=2 | ch=3 | ch=4 | ch=6   (격추율 %, no_ammo·overflow 누수 포함)');
SCEN.forEach(sc => {
  ['asis', 'tobe'].forEach(mode => {
    const row = CHANNELS.map(ch => {
      const kr = SEEDS.map(seed => {
        const g = KJ.runDES({ scenario: KJ.scenarioById(sc), mode, intensity: 1.5, seed, endTimeSec: 1800,
          features: { fireUnitLayer: true, mfrChannels: ch } }).global;
        return g.killRate * 100;
      });
      return mean(kr).toFixed(1);
    });
    console.log(`${sc}/${mode}  | ${row.join(' | ')}`);
  });
});
console.log('\n해석: MFR 채널이 늘수록 동시교전 상한이 풀려 격추율↑(포화 SC3에서 민감). ch=2에서 채널 포화가 병목.');

// ── WP2 자체교전 스윕: selfDefenseWindowSec {30,60,90} × selfDefensePkMult {0.7,0.8,0.9} ──
const WINDOWS = [30, 60, 90];
const PKMULTS = [0.7, 0.8, 0.9];
console.log('\nWP2 자체교전 스윕 (fireUnitLayer+selfDefense ON, SC3, seed 1~20 평균)');
console.log('mode | window×pkMult → 격추율 % (자체격추 수) · timeout:c2 구제');
['asis', 'tobe'].forEach(mode => {
  WINDOWS.forEach(win => {
    const cells = PKMULTS.map(pm => {
      const acc = SEEDS.map(seed => {
        const g = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode, intensity: 1.5, seed, endTimeSec: 1800,
          features: { fireUnitLayer: true, selfDefense: true, selfDefenseWindowSec: win, selfDefensePkMult: pm } }).global;
        return { kr: g.killRate * 100, sk: g.selfDefense.kills };
      });
      return `${mean(acc.map(x => x.kr)).toFixed(1)}%(${mean(acc.map(x => x.sk)).toFixed(0)})`;
    });
    console.log(`${mode} w=${win} | pk0.7 ${cells[0]} | pk0.8 ${cells[1]} | pk0.9 ${cells[2]}`);
  });
});
console.log('\n해석: 창(window)이 길수록 자체교전 기회↑, pkMult 높을수록 자체격추↑. As-Is에서 효과가 크다(C2 실패 구제 = 하한 상승, ADR-011).');
