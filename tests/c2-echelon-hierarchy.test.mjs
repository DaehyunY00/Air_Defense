/**
 * ADR-078 — IAOC는 MCRC·KAMDOC의 상위 제대다 (대체가 아니다).
 *
 * 종전 To-Be는 IAOC가 두 체계를 **대체**했다. `_resolveIadsCommanders`의 To-Be 분기가
 * IAOC 하나만 책임 C2로 세우고, 어댑터가 모든 센서를 IAOC로 직결시켜, MCRC·KAMDOC의
 * 도착 건수가 **0**이었다. 그런데 [C2 구조] 탭에는 체계층→조율층 계선이 그려져 있었다
 * — 그림이 코드보다 앞서 있었고, 그 그림과 함께 수치를 제시하면 근거 없는 인상을 준다.
 *
 * 이 파일이 잠그는 것:
 *  1) 두 제대가 To-Be에서 **통보 처리 부하**를 갖는다 (0이면 즉시 실패)
 *  2) 도메인 분담이 As-Is 책임 분담과 같다 — 공중=MCRC, 탄도=KAMDOC
 *  3) 병렬 통보다 — 제대 처리가 조율층 결심을 **gate하지 않는다**
 *  4) 군단 AOC 교전현황이 조율층으로 간다 (도착 0건 노드의 사서함이 아니라)
 *  5) As-Is 음성 협조 직결선은 To-Be에 없다 (구조 변화가 그림에서 대비된다)
 *  6) As-Is 책임 C2는 위협 도메인별로 배정되고 IAOC를 사용하지 않는다
 *
 * 도메인 통보 완료는 승인·식별 결과를 조율층에 되돌려 주지 않는다. 여기서 검증하는
 * 관계는 통보·부하와 책임 배정이며, 도메인별 결정권을 보존한 합동 지휘의 검증은 아니다.
 * 특정 seed의 격추 수나 "KAMDOC은 항상 포화" 같은 경험적 결과는 계약으로 고정하지 않는다.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/bottleneck.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
const KJ = globalThis.KJ;
installIadsKernel(KJ);

let fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function note(m) { console.log('  NOTE ' + m); }

const DEPLOY = 'HANBANDO_LEGACY_NORMAL';
const catalog = KJ.buildDeploymentCatalog(DEPLOY, {});
const MCRC = catalog.roles.MCRC, KAMDOC = catalog.roles.KAMDOC, IAOC = catalog.roles.IAOC;
const AOCS = catalog.roles.corpsAocs;

function config(mode, opts) {
  return Object.assign({
    scenario: KJ.scenarioById('sc3'), mode, intensity: 1.5, seed: 12345, endTimeSec: 900,
    deploymentId: DEPLOY, modelFidelity: 'iads-c2',
    features: { highResolutionDeployment: true }
  }, opts || {});
}
function run(mode, opts) { return KJ.runDES(config(mode, opts)); }
function node(r, id) { return (r.nodes || []).find(function (n) { return n.id === id; }) || null; }

const asis = run('asis'), tobe = run('tobe');

console.log('# 1 — To-Be에서 두 도메인 제대가 통보 처리 부하를 갖는다');
{
  const m = node(tobe, MCRC), k = node(tobe, KAMDOC), i = node(tobe, IAOC);
  note('To-Be 도착: MCRC ' + m.arrivals + '(ρ' + m.rho.toFixed(3) + ') · KAMDOC ' +
    k.arrivals + '(ρ' + k.rho.toFixed(3) + ') · IAOC ' + i.arrivals + '(ρ' + i.rho.toFixed(3) + ')');
  assert(m.arrivals > 0, 'MCRC가 To-Be에서 항적을 처리한다 (종전 0건 — 역할 소멸이 결함이었다)');
  assert(k.arrivals > 0, 'KAMDOC이 To-Be에서 항적을 처리한다 (종전 0건)');
  assert(i.arrivals > 0, '책임 C2인 IAOC도 항적을 처리한다');
  assert(m.arrivalsByKind.iads_track > 0 && k.arrivalsByKind.iads_track > 0,
    '두 제대의 부하가 항적 처리(iads_track)다 — 자기 도메인 plot/항적 업무');
}

console.log('\n# 2 — 도메인 분담이 As-Is 책임 분담과 같다 (공중=MCRC · 탄도=KAMDOC)');
{
  const marks = { MCRC: {}, KAMD_OPS: {} };
  const traced = run('tobe', { trace: true, traceCap: 400, endTimeSec: 900 });
  (traced.threatTraces || []).forEach(function (t) {
    t.stages.forEach(function (s) {
      const mm = /^도메인처리:(.+)$/.exec(s.name);
      if (mm && marks[mm[1]]) marks[mm[1]][t.type] = (marks[mm[1]][t.type] || 0) + 1;
    });
  });
  note('MCRC 처리 유형: ' + JSON.stringify(marks.MCRC));
  note('KAMDOC 처리 유형: ' + JSON.stringify(marks.KAMD_OPS));
  const BALLISTIC = { srbm: 1, mrl_large: 1 };
  assert(Object.keys(marks.MCRC).length > 0 && Object.keys(marks.MCRC).every(function (k) { return !BALLISTIC[k]; }),
    'MCRC는 공중(ABT) 위협만 처리한다');
  assert(Object.keys(marks.KAMD_OPS).length > 0 && Object.keys(marks.KAMD_OPS).every(function (k) { return BALLISTIC[k]; }),
    'KAMDOC은 탄도 위협만 처리한다');
}

console.log('\n# 3 — 병렬 통보다: 제대 처리가 조율층 결심을 gate하지 않는다');
{
  // ADR-088에서 KAMDOC 용량이 3→6으로 바뀌어 종전 SC3 표본은 더 이상 포화가 아니다.
  // 통보의 비차단 계약은 용량·seed와 분리된 대조 조건에서 검증한다. 서비스 추첨만 평균값으로
  // 고정하고 실제 fanout/도착/큐/완료 경로를 실행한다. 결심 경계에서 기록을 끝낸다.
  function probe(type, saturated) {
    const sim = new KJ.Simulation(config('tobe', { flowTrace: true }));
    const echelonId = sim._iadsDomainEchelonFor({ type });
    const domain = sim.nodeState[echelonId], upper = sim.nodeState[IAOC];
    domain.c = domain.K = 1;
    domain.mean = 100;
    upper.mean = 1;
    sim.c2ServiceFloor = false;
    sim.rng.exponential = (mean) => mean;
    const decisions = [];
    sim._iadsDecide = (threat, at, commander) => decisions.push({ id: threat.id, at, commanderId: commander.id });
    if (saturated) {
      sim._nodeArrive(echelonId, 0, {
        kind: 'iads_track', threat: { id: 'occupant', alive: true }, priority: 0
      }, () => {});
    }
    const threat = { id: 'probe_' + type, type, alive: true, spawnT: 0, dwellSec: 1000 };
    const commander = { id: IAOC, typeId: 'IAOC', axis: 'KILL_WEB' };
    const track = { priority: 1, freshUntil: 1000, sources: [{ sensorId: 'probe_sensor', lastUpdateAt: 5 }] };
    sim._fanoutDomainEchelon(threat, commander, track, 5);
    sim._onIadsC2Arrive(5, { threat, commander, track });
    while (sim.heap.size() > 0) {
      const event = sim.heap.pop();
      sim.now = event.t;
      sim._dispatch(event);
    }
    return { sim, domain, upper, threat, decisions };
  }
  ['fighter', 'srbm'].forEach((type) => {
    const free = probe(type, false), full = probe(type, true);
    assert(free.decisions.length === 1 && free.decisions[0].at === 6 &&
      JSON.stringify(full.decisions) === JSON.stringify(free.decisions),
    type + ': 제대 통보가 처리되거나 드롭되어도 IAOC 결심은 자체 처리 완료(6초)에서 한 번 발생');
    assert(free.domain.drops === 0 && full.domain.drops === 1 && full.upper.drops === 0 &&
      full.sim.global.trackQuality.domainEchelonDropped === 1,
    type + ': 강제 포화한 제대에만 통보 드롭 1건이 계상되고 IAOC에는 전파되지 않는다');
    assert(full.threat.alive && !full.threat.pipelineDead && !full.threat.leakReason,
      type + ': 통보 손실은 항적 전체의 처리 중단이나 누수로 바뀌지 않는다');
    const fanout = full.sim.flowEvents.filter((event) => event.k === 'link' && event.mt === 'fanout');
    assert(fanout.length === 1 && fanout[0].from === IAOC && fanout[0].to === full.domain.node.id &&
      fanout[0].t0 === 5 && fanout[0].t1 === 5,
    type + ': 통보 간선은 IAOC 도착과 같은 시각의 전달(0초)로 관측된다');
  });
}

console.log('\n# 4 — 군단 AOC 교전현황은 To-Be에서 조율층이 받는다');
{
  const a = asis.global.coordination.statusSharing, b = tobe.global.coordination.statusSharing;
  note('As-Is 발신/도달/드롭 = ' + a.sent + '/' + a.delivered + '/' + a.dropped +
    '  To-Be = ' + b.sent + '/' + b.delivered + '/' + b.dropped);
  // ⚠️ `r.links`로 판정하면 안 된다 — 링크 레코드는 (from,to)로 집약되어 같은 노드쌍의
  //    coord/status가 한 칸에 겹치고 kind가 마지막 것으로 덮인다(실측: As-Is status 간선이
  //    빈 배열로 나왔다). 실제 수신처는 항적 마크가 이름으로 적는다.
  function statusRecipients(mode) {
    const r = run(mode, { trace: true, traceCap: 400 });
    const to = {};
    (r.threatTraces || []).forEach(function (t) {
      t.stages.forEach(function (s) {
        const mm = /^교전현황수신:([^←]+)←/.exec(s.name);
        if (mm) to[mm[1]] = (to[mm[1]] || 0) + 1;
      });
    });
    return to;
  }
  const aTo = statusRecipients('asis'), bTo = statusRecipients('tobe');
  note('As-Is 교전현황 수신처: ' + JSON.stringify(aTo));
  note('To-Be 교전현황 수신처: ' + JSON.stringify(bTo));
  // As-Is는 도착 전에 항적이 종결되어 항적 마크 표본이 비는 실행이 있다.
  // 그래서 As-Is 쪽은 "조율층이 받는 일은 없다"는 부재로 잠근다 — 계선 자체는 #5가 본다.
  assert(a.delivered > 0 && !aTo[IAOC],
    'As-Is 교전현황이 조율층으로 가는 일은 없다 (As-Is 편성에 IAOC가 없다 · 도달 ' + a.delivered + '건)');
  assert(Object.keys(bTo).length === 1 && bTo[IAOC] > 0,
    'To-Be 교전현황은 조율층(IAOC)이 받는다 — 도착 0건 노드의 사서함이 아니다');
  [a, b].forEach((sharing, index) => {
    assert(sharing.sent >= sharing.delivered + sharing.dropped && sharing.delivered >= 0 && sharing.dropped >= 0,
      ['As-Is', 'To-Be'][index] + ': 수신·채널 드롭 합계가 발신 수를 넘지 않는다 (미도착은 종료 시점에 남을 수 있음)');
  });
}

console.log('\n# 5 — As-Is 음성 협조 직결선은 To-Be 그림에 없다');
{
  function hasEdge(mode, from, to, kind) {
    return KJ.linksInMode(mode, catalog).some(function (l) {
      return l.from === from && l.to === to && l.kind === kind;
    });
  }
  AOCS.forEach(function (aoc) {
    assert(hasEdge('asis', aoc, MCRC, 'status'), 'As-Is: 군단 AOC → MCRC 교전현황 직결선 존재');
    assert(!hasEdge('tobe', aoc, MCRC, 'status'),
      'To-Be: 군단 AOC → MCRC 직결선 제거 (조율층 재편이 [C2 구조] 그림에서 대비된다)');
    assert(hasEdge('tobe', aoc, IAOC, 'status'), 'To-Be: 군단 AOC → IAOC 교전현황 계선 존재');
    assert(!hasEdge('tobe', MCRC, aoc, 'report'), 'To-Be: MCRC → 군단 AOC 항적 직결선 제거');
  });
  assert(!KJ.nodesInMode('asis', catalog).some(function (n) { return n.id === IAOC; }),
    'As-Is 편성에는 조율층이 없다 (그림 대비의 전제)');
}

console.log('\n# 6 — As-Is 책임 C2의 도메인 배정 계약');
{
  // 정확한 결과 지문은 hires-baseline 스위트가 별도로 담당한다. 계층 검사는 카탈로그의
  // 정상 배치에서 누가 책임을 갖는지 검증하며 특정 시나리오의 임무 성과를 고정하지 않는다.
  const sim = new KJ.Simulation(config('asis'));
  ['fighter', 'cruise', 'uav_small', 'heli', 'ac_low', 'srbm', 'mrl_large'].forEach((type) => {
    const threat = { id: 'routing_' + type, type, axis: 'NW', spawnT: 0, dwellSec: 600 };
    const expected = type === 'srbm' || type === 'mrl_large' ? KAMDOC : MCRC;
    const commanders = sim._resolveIadsCommanders(threat);
    const primary = commanders.filter((commander) => commander.axis === 'MCRC' || commander.axis === 'KAMD');
    assert(primary.length === 1 && primary[0].id === expected && primary[0].batteryIds.length > 0,
      type + ': 정상 배치의 책임 C2가 ' + expected + '이며 담당 자산이 있다');
    assert(commanders.every((commander) => commander.id !== IAOC) && sim._iadsDomainEchelonFor(threat) === null,
      type + ': As-Is에는 IAOC 책임 배정이나 To-Be 도메인 통보가 없다');
  });
  assert(!node(asis, IAOC), 'As-Is에는 IAOC 노드 자체가 없다');
}

console.log('\n# 7 — 두 도메인 제대의 C2 흐름은 대칭이다 (다른 건 위협·자산뿐)');
{
  // 요구: "KAMDOC과 MCRC는 다루는 위협·자산이 다른 것이지, C2 관점의 흐름은 유사해야 한다."
  // 그래서 **관계의 종류**를 비교한다 — 개수(레이더 몇 대·서버 몇 개)는 자산 차이라 제외한다.
  const links = KJ.linksInMode('tobe', catalog);
  function flowShape(id) {
    const set = new Set();
    links.forEach(function (l) {
      const other = l.from === id ? l.to : (l.to === id ? l.from : null);
      if (!other) return;
      const n = catalog.nodeMap[other];
      if (!n) return;
      const role = other === IAOC ? '조율층' : (n.category === 'sensor' ? '도메인감시레이더' : n.typeId);
      set.add((l.from === id ? '→' : '←') + role + '(' + l.kind + ')');
    });
    return Array.from(set).sort();
  }
  const m = flowShape(MCRC), k = flowShape(KAMDOC);
  note('MCRC   : ' + m.join(' · '));
  note('KAMDOC : ' + k.join(' · '));
  assert(m.join('|') === k.join('|'),
    '두 제대의 C2 관계 종류가 동일하다 (조율층 상행 report/coord · 하행 coord · ICC 양방향 · 도메인 레이더 수신)');

  const ms = catalog.nodeMap[MCRC].queue.servers, ks = catalog.nodeMap[KAMDOC].queue.servers;
  note('자산 차이(정당): MCRC ' + ms + '서버 vs KAMDOC ' + ks + '서버');
  assert(ms !== ks, '용량은 다르다 — 흐름 대칭과 자산 비대칭은 별개다');

  // 엔진 쪽 대칭: 병렬 통보가 두 제대에 **같은 job kind**로 들어간다.
  const t = node(tobe, MCRC), b = node(tobe, KAMDOC);
  assert(t.arrivalsByKind.iads_track > 0 && b.arrivalsByKind.iads_track > 0 &&
    t.arrivalsByKind.directive_reception === 0 && b.arrivalsByKind.directive_reception === 0,
    '두 제대 모두 항적 처리(iads_track) 한 종류로만 부하를 받는다 — 처리 경로도 대칭');
}

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
