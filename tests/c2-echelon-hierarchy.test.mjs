/**
 * ADR-078 — IAOC는 MCRC·KAMDOC의 상위 제대다 (대체가 아니다).
 *
 * 종전 To-Be는 IAOC가 두 체계를 **대체**했다. `_resolveIadsCommanders`의 To-Be 분기가
 * IAOC 하나만 책임 C2로 세우고, 어댑터가 모든 센서를 IAOC로 직결시켜, MCRC·KAMDOC의
 * 도착 건수가 **0**이었다. 그런데 [C2 구조] 탭에는 체계층→조율층 계선이 그려져 있었다
 * — 그림이 코드보다 앞서 있었고, 그 그림과 함께 수치를 제시하면 근거 없는 인상을 준다.
 *
 * 이 파일이 잠그는 것:
 *  1) 두 제대가 To-Be에서 **실제 부하**를 갖는다 (0이면 즉시 실패)
 *  2) 도메인 분담이 As-Is 책임 분담과 같다 — 공중=MCRC, 탄도=KAMDOC
 *  3) 병렬 통보다 — 제대 처리가 조율층 결심을 **gate하지 않는다**
 *  4) 군단 AOC 교전현황이 조율층으로 간다 (도착 0건 노드의 사서함이 아니라)
 *  5) As-Is 음성 협조 직결선은 To-Be에 없다 (구조 변화가 그림에서 대비된다)
 *  6) As-Is는 전부 불변
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

function run(mode, opts) {
  return KJ.runDES(Object.assign({
    scenario: KJ.scenarioById('sc3'), mode, intensity: 1.5, seed: 12345, endTimeSec: 900,
    deploymentId: DEPLOY, modelFidelity: 'iads-c2',
    features: { highResolutionDeployment: true }
  }, opts || {}));
}
function node(r, id) { return (r.nodes || []).find(function (n) { return n.id === id; }) || null; }

const asis = run('asis'), tobe = run('tobe');

console.log('# 1 — To-Be에서 두 도메인 제대가 실제 부하를 갖는다 (대체가 아니라 하위 제대)');
{
  const m = node(tobe, MCRC), k = node(tobe, KAMDOC), i = node(tobe, IAOC);
  note('To-Be 도착: MCRC ' + m.arrivals + '(ρ' + m.rho.toFixed(3) + ') · KAMDOC ' +
    k.arrivals + '(ρ' + k.rho.toFixed(3) + ') · IAOC ' + i.arrivals + '(ρ' + i.rho.toFixed(3) + ')');
  assert(m.arrivals > 0, 'MCRC가 To-Be에서 항적을 처리한다 (종전 0건 — 역할 소멸이 결함이었다)');
  assert(k.arrivals > 0, 'KAMDOC이 To-Be에서 항적을 처리한다 (종전 0건)');
  assert(i.arrivals > 0, 'IAOC도 처리한다 — 상위 제대이지 우회로가 아니다');
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
  // 직렬이면 제대 큐 대기가 조율층 도착에 얹혀 IAOC의 Wq/처리시각이 제대에 종속된다.
  // KAMDOC은 포화(ρ≈0.97·드롭 발생) 상태인데도 IAOC가 막히지 않아야 한다.
  const k = node(tobe, KAMDOC), i = node(tobe, IAOC);
  note('KAMDOC 포화: ρ=' + k.rho.toFixed(3) + ' 드롭=' + k.drops + ' Wq=' + k.Wq.toFixed(1) +
    ' / IAOC Wq=' + i.Wq.toFixed(1) + ' 드롭=' + i.drops);
  assert(i.drops === 0 && i.Wq < 1,
    '도메인 제대가 포화여도 조율층은 대기 없이 결심한다 (병렬 통보 — "거치되 시간은 그대로")');
  assert(k.drops > 0,
    'KAMDOC 포화는 실재한다 — 통합해도 제대 용량은 늘지 않는다(상황인식 손실로 계상)');
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
  // As-Is는 60건 중 4건만 도달해(음성/VTC 드롭 49) 항적 마크 표본이 비는 실행이 있다.
  // 그래서 As-Is 쪽은 "조율층이 받는 일은 없다"는 부재로 잠근다 — 계선 자체는 #5가 본다.
  assert(a.delivered > 0 && !aTo[IAOC],
    'As-Is 교전현황이 조율층으로 가는 일은 없다 (As-Is 편성에 IAOC가 없다 · 도달 ' + a.delivered + '건)');
  assert(Object.keys(bTo).length === 1 && bTo[IAOC] > 0,
    'To-Be 교전현황은 조율층(IAOC)이 받는다 — 도착 0건 노드의 사서함이 아니다');
  assert(b.delivered > a.delivered && b.dropped < a.dropped,
    '데이터링크 전환으로 손실이 줄었다 (' + a.delivered + '/' + a.sent + ' → ' + b.delivered + '/' + b.sent + ')');
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

console.log('\n# 6 — As-Is 기준값 고정');
{
  // ADR-078 시점에는 여기가 "As-Is 불변" 하드 체크였다(변경이 To-Be에만 닿았다는 증거).
  // ADR-079가 As-Is 육↔공 항적 중계를 데이터링크 1초 → 문자(서버 채팅) 45초로 바꾸면서
  // As-Is가 **의도적으로** 움직였다(격추 64→57). 그래서 이 절은 불변 주장이 아니라
  // 현행 As-Is 기준값 고정으로 역할이 바뀐다 — To-Be 불변 쪽은 #1·#3이 계속 잠근다.
  // ADR-081이 방공C2A 사이 상급 경유 계선(KVMF 30초)을 깔면서 As-Is가 다시 움직였다
  // (격추 64→59 · MCRC 도착 139→145). ⚠️ 이 방향을 효과로 읽지 말 것 — 30 seed
  // As-Is 자기쌍체에서 Δ격추 −0.57 [−2.57, +1.44]로 **임무 지표는 유의하지 않다**.
  // 단일 seed 값은 항적 도착 순서 재배열의 결과이며 기준값 고정 용도로만 쓴다.
  // ADR-082가 육↔공 세 채널의 분포를 정규화하며 As-Is가 다시 움직였다
  // (격추 59→65 · MCRC 도착 145→148). ⚠️ 방향을 효과로 읽지 말 것 — As-Is
  // 자기쌍체 12 seed에서 Δ격추 +0.83 [−3.09, +4.75]로 **유의하지 않다.**
  assert(asis.global.killed === 65 && asis.global.leaked === 106,
    'SC3 As-Is 격추 65 · 누수 106 (ADR-082 육↔공 분포 정규화 반영)');
  const m = node(asis, MCRC), k = node(asis, KAMDOC);
  assert(m.arrivals === 148 && k.arrivals === 145,
    'As-Is MCRC 148 · KAMDOC 145 (문자·VTC 정규분포 전환 후)');
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
