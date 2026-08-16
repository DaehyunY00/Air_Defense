/**
 * ADR-085 연합 항적 공유 반사실(usfkTrackSharing) 회귀.
 *
 * 현행 모델은 미군 축과 한국군 계통 사이에 계선을 **한 가닥도** 두지 않는다(ADR-036 승계).
 * 이 플래그는 그중 **상황인식(report)만** 국소적으로 열어 「지휘는 분리한 채 항적만
 * 공유했다면」을 보게 한다.
 *
 * 지키려는 계약 넷:
 *  ① **OFF는 종전 그대로.** 키가 없거나 null이면 계선이 한 가닥도 생기지 않고 결과에
 *     원장 키도 없다. (기준선 bit-exact는 hires-baseline.test.mjs가 별도로 잠근다.)
 *  ② **켜면 실제로 물린다.** 계선이 깔리고, 한국군 상급의 항적 접수가 빨라진다.
 *     ⚠️ 이 어서션이 없으면 "켰는데 아무 일도 안 일어난" 실행을 못 잡는다 — 필터 완화와
 *     카탈로그 변형은 **짝으로** 켜져야 하고, 한쪽만 켜지면 조용히 무효가 된다.
 *  ③ **격리는 유지된다.** 지휘·승인은 열지 않았다. 이게 깨지면 이 반사실은 ADR-036을
 *     통째로 뒤집은 것이 되어 "정보 공유의 효과"가 아니라 "통합의 효과"를 재게 된다.
 *  ④ **근거 없는 매체를 만들 수 없다.**
 */
import path from 'node:path';
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
].forEach((f) => require(path.join(root, f)));
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };

const F = {
  highResolutionDeployment: true, approvalChain: true, threatTargetDispersion: true,
  southernAxes: true, linkSemanticsV2: true, sensorReportParity: true,
  unifiedEngagementState: true, sawtoothFreshness: true, selfDefenseFire: true
};
const cfg = (mode, extra) => ({
  scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 12345, endTimeSec: 480,
  deploymentId: 'HANBANDO_FULL_NORMAL', modelFidelity: 'iads-c2', trace: true,
  features: Object.assign({}, F, extra || {})
});
const run = (mode, extra) => KJ.runDES(cfg(mode, extra));
const isUsfkAsset = (id) => /USFK|THAAD/.test(id);

/** 한국군 상급(KAMDOC·MCRC·IAOC)의 「책임C2 → 항적정보접수」 평균 지연. */
function upperIntakeLatency(res) {
  const ds = [];
  res.threatTraces.forEach((tr) => {
    const resp = {}, recv = {};
    tr.stages.forEach((s) => {
      let m = s.name.match(/^책임C2:(KAMD_OPS|MCRC|IAOC)\(/);
      if (m && resp[m[1]] == null) resp[m[1]] = s.t;
      m = s.name.match(/^항적정보접수:(KAMD_OPS|MCRC|IAOC)\(/);
      if (m && recv[m[1]] == null) recv[m[1]] = s.t;
    });
    Object.keys(recv).forEach((k) => { if (resp[k] != null) ds.push(recv[k] - resp[k]); });
  });
  return ds.length ? ds.reduce((s, x) => s + x, 0) / ds.length : NaN;
}

for (const mode of ['asis', 'tobe']) {
  console.log(`\n-- ${mode} --`);

  // ① OFF — 계선도 원장도 없다
  const off = run(mode);
  assert(off.usfkTrackSharing === undefined,
    `${mode}: OFF에서는 결과에 반사실 원장 키가 없다`);
  const catOff = KJ.resolveModelCatalog(cfg(mode));
  const shareOff = catOff.links.filter((l) => l.axis === 'coalition_track_share');
  assert(shareOff.length === 0, `${mode}: OFF 카탈로그에 연합 공유 계선이 0가닥이다`);
  // 명시적 null도 OFF와 같아야 한다(키 부재와 null을 다르게 처리하면 조용한 분기가 생긴다)
  const offNull = run(mode, { usfkTrackSharing: null });
  assert(JSON.stringify(off) === JSON.stringify(offNull),
    `${mode}: usfkTrackSharing=null은 키 부재와 완전히 같다`);

  // ② ON — 계선이 깔리고 원장이 남는다
  const on = run(mode, { usfkTrackSharing: 'datalink' });
  const led = on.usfkTrackSharing;
  assert(!!led && led.media === 'datalink', `${mode}: ON이면 원장에 매체가 남는다`);
  assert(led.links === 12, `${mode}: 연합 공유 계선 12가닥 생성 (실측 ${led && led.links})`);
  assert(led.activeInMode > 0,
    `${mode}: 이 모드에서 실제 활성 계선이 있다 (${led && led.activeInMode}가닥)` +
    ' — 0이면 켜도 아무 일이 없는 실행이다');

  // ②-b 메커니즘 — 한국군 상급이 실제로 더 빨리 항적을 접수한다.
  //     계선만 깔고 센서 소유 필터를 안 풀면 여기서 잡힌다(보고가 버려져 지연이 그대로다).
  const latOff = upperIntakeLatency(off), latOn = upperIntakeLatency(on);
  assert(latOn < latOff,
    `${mode}: 상급 항적접수가 빨라진다 ${latOff.toFixed(2)}초 → ${latOn.toFixed(2)}초`);

  // ③ 격리 유지 — 지휘·승인은 열지 않았다
  const rokCmdUsfkAsset = [], usfkCmdRokAsset = [], usfkApproval = [];
  on.threatTraces.forEach((tr) => tr.stages.forEach((s) => {
    const m = s.name.match(/^사수선정·표적할당:([A-Z_0-9]+)→(.+)$/);
    if (m) {
      const usfkAxis = m[1].indexOf('USFK') === 0;
      if (usfkAxis && !isUsfkAsset(m[2])) usfkCmdRokAsset.push(s.name);
      if (!usfkAxis && isUsfkAsset(m[2])) rokCmdUsfkAsset.push(s.name);
    }
    if (/^(협조개시|승인완료|감독승인개시|권한위임)/.test(s.name) &&
        s.axis && s.axis.indexOf('USFK') === 0) usfkApproval.push(s.name);
  }));
  assert(usfkCmdRokAsset.length === 0,
    `${mode}: 미군 축이 한국군 자산을 지휘하지 않는다` +
    (usfkCmdRokAsset.length ? ' — ' + usfkCmdRokAsset[0] : ''));
  assert(rokCmdUsfkAsset.length === 0,
    `${mode}: 한국군 축이 미군 자산을 지휘하지 않는다` +
    (rokCmdUsfkAsset.length ? ' — ' + rokCmdUsfkAsset[0] : ''));
  assert(usfkApproval.length === 0,
    `${mode}: 미군 축에 승인 계선이 적용되지 않는다(ADR-036 유지)` +
    (usfkApproval.length ? ' — ' + usfkApproval[0] : ''));

  // ③-b 공유 계선은 report 종류뿐이다 — status(교전현황)·coord(승인)를 섞으면
  //     이 반사실이 "정보 공유"가 아니라 "지휘 통합"을 재게 된다.
  const catOn = KJ.resolveModelCatalog(cfg(mode, { usfkTrackSharing: 'datalink' }));
  const shareOn = catOn.links.filter((l) => l.axis === 'coalition_track_share');
  assert(shareOn.length > 0 && shareOn.every((l) => l.kind === 'report'),
    `${mode}: 연합 공유 계선은 전부 kind='report'다 (상황인식만)`);
  // 양 끝 중 정확히 하나가 미군이어야 한다(미군 내부·한국군 내부를 건드리지 않았다)
  assert(shareOn.every((l) => isUsfkAsset(l.from) !== isUsfkAsset(l.to)),
    `${mode}: 공유 계선은 전부 미군↔한국군 교차 계선이다`);
}

// ④ 매체는 카탈로그 선언에서만 고른다
console.log('\n-- 매체 검증 --');
let threw = false;
try { run('asis', { usfkTrackSharing: '초광속' }); }
catch (e) { threw = /알 수 없는 usfkTrackSharing 매체/.test(e.message); }
assert(threw, '카탈로그에 없는 매체는 예외로 거부한다 — 근거 없는 수치를 만들 수 없다');

// 매체를 바꾸면 계선 지연이 실제로 달라진다(같은 계선을 다른 속도로 켜는 것이 목적)
const catFast = KJ.resolveModelCatalog(cfg('asis', { usfkTrackSharing: 'datalink' }));
const catSlow = KJ.resolveModelCatalog(cfg('asis', { usfkTrackSharing: 'voice' }));
const pick = (c) => c.links.find((l) => l.axis === 'coalition_track_share' && l.comm.asis);
assert(pick(catFast).comm.asis.type === 'datalink' && pick(catSlow).comm.asis.type === 'voice',
  '매체 키가 계선 comm에 그대로 반영된다 (datalink ↔ voice)');
// 캐시 분리 — 같은 배치라도 매체가 다르면 다른 카탈로그다(같은 객체를 돌려주면 조용히 섞인다)
assert(catFast !== catSlow, '매체가 다르면 카탈로그 캐시가 분리된다');

console.log(fail ? `\n실패 ${fail}건` : '\nOK — 전체 통과');
process.exit(fail ? 1 : 0);
