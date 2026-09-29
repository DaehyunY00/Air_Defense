/**
 * ADR-105 한미 교전 협조(음성) — rokUsfkCoordination 회귀.
 *
 * 지키려는 계약:
 *  ① OFF bit-exact — 플래그를 주지 않으면 결과·카탈로그가 종전과 같다(협조 계선 0건 · features 미신고).
 *  ② 계선 — ON이면 미군 C2(THAAD·Patriot C2) ↔ 한국군 결심 C2(As-Is KAMDOC·MCRC / To-Be IAOC) 사이에
 *     coord 계선만 생기고(항적 report·교전현황 status는 여전히 없다), 매체는 요청한 것(voice)이다.
 *  ③ 절차 — 협조 요청은 상대 진영 결심 C2에게만 가고 음성 계선을 탄다. 접수마다 회신이 나가고, 회신은
 *     같은 계선을 되짚는다(from/to 역방향). 「양보」한 C2는 상대 계획이 살아 있는 동안 정식 발사·긴급발사를
 *     내지 않는다. 최적 사수가 한국군 자산이면 미군이 양보한다(allocatedRok > 0).
 *  ④ 계정 — proposals = concur + counter + alreadyEngaged + crossed + (도착 못 한 제안); 진영별 배정·양보 합이 맞는다;
 *     생성 = 격추 + 누수 + 미해결; 협조 ON에서 한미가 각각 쏜 항적 수는 duplicates 계정 이상이 아니다(생략·시한 몫).
 *  ⑤ 관측 순수성 — flowTrace ON/OFF 동역학 지문 동일.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'
].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
const assert = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const sha = (r) => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const dyn = (r) => { const c = Object.assign({}, r); ['flowEvents', 'flowTruncated', 'flowCap'].forEach((k) => { delete c[k]; }); return sha(c); };

// [지휘 흐름] 화면 기본 플래그(ADR-103·104 포함) — 협조는 그 위에 얹는다.
const SCREEN = Object.freeze({
  highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true, linkSemanticsV2: true,
  sensorReportParity: true, sawtoothFreshness: true, approvalChain: true, unifiedEngagementState: true,
  selfDefenseFire: true, ballisticLaunchAxes: true, threatAimpoints: true, c2DecisionTimeParity: true,
  approvalPipelineRealism: true, iccRelayAuthorization: true, ballisticReportSource: true, standbyCue: true
});
const DEP = 'HANBANDO_FULL_NORMAL';
const run = (mode, extra, opts) => KJ.runDES(Object.assign({
  scenario: KJ.scenarioById('sc3'), mode, intensity: 1, seed: 29, endTimeSec: 900,
  deploymentId: DEP, modelFidelity: 'iads-c2', trace: true, traceCap: 1000,
  features: Object.assign({}, SCREEN, extra || {})
}, opts || {}));
const isUsfk = (id) => /USFK|THAAD|AN_TPY2/.test(id);   // 노드 소속(미군 C2·ECS·포대·레이더)
const usfkC2 = (id) => /^C2_USFK_/.test(id);
const rokDecider = (id) => /^C2_(KAMD_OPS|MCRC|IAOC)_/.test(id);

console.log('# 1) OFF — 협조 계선 0건 · features 미신고 · 결과는 플래그 없는 실행과 동일');
for (const mode of ['asis', 'tobe']) {
  const cat = KJ.resolveModelCatalog({ deploymentId: DEP, mode, features: SCREEN });
  const coal = cat.links.filter((l) => l.axis === 'coalition_coord');
  assert(coal.length === 0, `${mode}: OFF 카탈로그에 coalition_coord 계선 없음`);
  const cross = cat.links.filter((l) => isUsfk(l.from) !== isUsfk(l.to) && l.comm[mode]);
  assert(cross.length === 0, `${mode}: OFF에서 미군 C2 ↔ 한국군 노드 활성 계선 0건 (${cross.length})`);
  const a = run(mode), b = run(mode, { rokUsfkCoordination: null });
  assert(sha(a) === sha(b), `${mode}: 플래그 null = 미지정과 bit-exact`);
  assert(a.global.features.rokUsfkCoordination === undefined && a.global.coalition === undefined, `${mode}: OFF wire shape에 협조 키 없음`);
}

for (const mode of ['asis', 'tobe']) {
  console.log(`\n# 2~5) ON — FULL ${mode}`);
  const cat = KJ.resolveModelCatalog({ deploymentId: DEP, mode, features: Object.assign({}, SCREEN, { rokUsfkCoordination: 'voice' }) });
  const coal = cat.links.filter((l) => l.axis === 'coalition_coord' && l.comm[mode]);
  const deciders = mode === 'asis' ? ['C2_KAMD_OPS_KAMD_OPS', 'C2_MCRC_MCRC'] : ['C2_IAOC_IAOC'];
  assert(coal.length > 0 && coal.every((l) => l.kind === 'coord' && l.comm[mode].type === 'voice'),
    `${mode}: coalition_coord 계선 ${coal.length}건 · 전부 coord/voice`);
  assert(coal.every((l) => (usfkC2(l.from) && deciders.includes(l.to)) || (usfkC2(l.to) && deciders.includes(l.from))),
    `${mode}: 계선 양끝이 미군 C2와 ${deciders.join('·')}`);
  const nonCoord = cat.links.filter((l) => isUsfk(l.from) !== isUsfk(l.to) && l.comm[mode] && l.kind !== 'coord');
  assert(nonCoord.length === 0, `${mode}: 미군 ↔ 한국군 사이 report/status/command 계선은 여전히 0건`);

  const on = run(mode, { rokUsfkCoordination: 'voice' }, { flowTrace: true, flowTraceCap: 400000 });
  const onNoFlow = run(mode, { rokUsfkCoordination: 'voice' });
  assert(on.global.features.rokUsfkCoordination === 'voice', `${mode}: features에 voice 신고`);
  assert(dyn(on) === sha(onNoFlow), `${mode}: flowTrace ON/OFF 동역학 지문 동일`);
  const sc = on.global.coalition;
  assert(sc && sc.proposals > 0, `${mode}: 협조 제안 ${sc && sc.proposals}건`);
  assert(sc.proposals >= sc.concur + sc.counter + sc.alreadyEngaged + sc.crossed,
    `${mode}: proposals ${sc.proposals} ≥ concur ${sc.concur} + counter ${sc.counter} + alreadyEngaged ${sc.alreadyEngaged} + crossed ${sc.crossed}`);
  assert(sc.allocatedRok > 0, `${mode}: 최적 사수가 한국군 자산으로 정해진 협조 ${sc.allocatedRok}건 (> 0)`);
  assert(sc.allocatedUsfk > 0, `${mode}: 미군 자산으로 정해진 협조 ${sc.allocatedUsfk}건 (> 0)`);
  assert(sc.expired === 0, `${mode}: 회신 시한 초과 ${sc.expired}건 (음성 왕복 ≪ 90초)`);

  // 협조 교신은 coalition 계선(음성)만 탄다 · 회신은 역방향
  const links = on.flowEvents.filter((e) => e.k === 'link');
  const coalKeys = new Set(coal.map((l) => l.from + '>' + l.to));
  const coalLinks = links.filter((l) => coalKeys.has(l.from + '>' + l.to));
  assert(coalLinks.length > 0 && coalLinks.every((l) => l.mt === 'voice' && l.kind === 'coord'), `${mode}: 협조 교신 ${coalLinks.length}건 전부 음성 coord`);
  const req = coalLinks.filter((l) => usfkC2(l.from) || rokDecider(l.from)).length;
  assert(req === coalLinks.length, `${mode}: 협조 교신의 발신자는 전부 결심 C2`);

  // 마크 정합: 요청 → 접수 → 회신 · 접수 수 ≤ 요청 수 · 회신 수 = 접수 수
  let reqN = 0, arrN = 0, repN = 0, yieldN = 0, skipN = 0;
  const trs = on.threatTraces;
  trs.forEach((t) => t.stages.forEach((s) => {
    if (s.name.startsWith('연합협조요청:')) reqN++;
    else if (s.name.startsWith('연합협조접수:')) arrN++;
    else if (s.name.startsWith('연합협조회신:')) repN++;
    else if (s.name.startsWith('연합양보:')) yieldN++;
    else if (s.name.startsWith('연합협조생략:')) skipN++;
  }));
  assert(reqN === sc.proposals && arrN === sc.arrivals, `${mode}: 마크 요청 ${reqN} = 계정 ${sc.proposals} · 접수 ${arrN} = ${sc.arrivals}`);
  assert(repN === arrN, `${mode}: 접수마다 회신 (${repN}/${arrN})`);
  assert(skipN === sc.skippedDeadline, `${mode}: 마감 임박 생략 마크 ${skipN} = 계정 ${sc.skippedDeadline}`);
  assert(sc.cededRok + sc.cededUsfk >= yieldN, `${mode}: 양보 계정 ${sc.cededRok + sc.cededUsfk} ≥ 양보 마크 ${yieldN}`);

  // 양보를 지킨다: 「연합양보:X→Y」 뒤 상대(Y 진영) 첫 발사 ~ 그 BDA 사이에 X 진영 발사 0건
  let violations = 0, checked = 0;
  trs.forEach((t) => {
    const yields = t.stages.filter((s) => s.name.startsWith('연합양보:'));
    yields.forEach((y) => {
      const m = /^연합양보:([^→]+)→([^(]+)\(/.exec(y.name);
      const myUsfk = /USFK/.test(m[1]);
      const otherFire = t.stages.find((s) => s.t >= y.t && /^발사:/.test(s.name) && isUsfk(s.name.split(':')[1]) !== myUsfk);
      if (!otherFire) return;
      const bda = t.stages.find((s) => s.t > otherFire.t && /^BDA:/.test(s.name) && isUsfk(s.name.split(':')[2]) !== myUsfk);
      const end = bda ? bda.t : Infinity;
      checked++;
      if (t.stages.some((s) => s.t > y.t && s.t < end && /^발사:/.test(s.name) && isUsfk(s.name.split(':')[1]) === myUsfk)) violations++;
    });
  });
  assert(violations === 0, `${mode}: 양보 뒤 상대 계획이 살아 있는 동안 내 진영 발사 0건 (검사 ${checked}건)`);

  // 계정 대사
  const g = on.global;
  assert(g.spawned === g.killed + g.leaked + g.censoredRaw, `${mode}: 생성 ${g.spawned} = 격추 ${g.killed} + 누수 ${g.leaked} + 미해결 ${g.censoredRaw}`);
  const both = trs.filter((t) => { const sh = new Set(t.stages.filter((s) => /^발사:/.test(s.name)).map((s) => s.name.split(':')[1].split('/')[0])); return [...sh].some(isUsfk) && [...sh].some((x) => !isUsfk(x)); }).length;
  console.log(`  info ${mode}: 한미가 각각 쏜 항적 ${both} · 계정 duplicates ${sc.duplicates} · 생략 ${sc.skippedDeadline} · 교차 ${sc.crossed} · 긴급발사 보류 ${sc.standbyHeld}`);
  const off = run(mode);
  console.log(`  info ${mode}: 격추/누수 OFF ${off.global.killed}/${off.global.leaked} → ON ${g.killed}/${g.leaked}`);
}

console.log(fail ? `\n실패 ${fail}건` : '\n전체 통과');
process.exit(fail ? 1 : 0);
