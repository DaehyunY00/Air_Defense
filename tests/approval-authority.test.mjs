/**
 * ADR-077 — 교전승인권자 해소 정합 회귀.
 *
 * 두 가지를 잠근다.
 *
 * A) **미등록 역할 이름은 조용히 승인을 없앤다** — 이 파일의 존재 이유.
 *    `KJ.resolveRoleId`는 catalog.roles에 없는 키를 **그대로 반환한다**. 그 문자열은
 *    nodeId가 아니므로 엔진의 `!this.nodeState[approvalId]` 가드에 걸려 "승인권자 부재
 *    → 승인 불필요"로 처리된다. 승인 홉이 통째로 사라지는데 **실행은 성공하고 결과는
 *    빨라진다**. 즉 오타 하나가 "To-Be가 개선됐다"로 위장된다. ADR-062가 경계하는
 *    "0과 미측정의 혼동"과 같은 함정이다. 그래서 threats.js가 쓰는 모든 역할 이름이
 *    실제 노드로, 그것도 **해당 모드에 존재하는** 노드로 해소되는지 검사한다.
 *
 * B) **To-Be ABT 승인은 조율층(IAOC)이 받는다** — ADR-077의 실질.
 *    To-Be 구조의 요체는 기존 C2 체계 위에 얹힌 합동방공C2 조율층인데, 종전에는 승인만
 *    옛 계선(MCRC)으로 붙어 조율층을 건너뛰었다. 실행 흔적(마크)에 찍힌 승인권자를
 *    직접 세어 고정한다 — 데이터 값만 보면 resolveRoleId 단계의 함정을 못 잡는다.
 *
 * ⚠️ 여기서 As-Is는 **불변이어야 한다**. approvalLevel.asis를 손대지 않았으므로
 *    As-Is 승인권자는 여전히 MCRC다. 이 대비가 변경 범위의 하드 체크다.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
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

console.log('# 0 — 함정 자체를 명문화한다 (미등록 키는 입력을 그대로 돌려준다)');
{
  const bogus = KJ.resolveRoleId('THIS_ROLE_DOES_NOT_EXIST', catalog);
  assert(bogus === 'THIS_ROLE_DOES_NOT_EXIST',
    '미등록 역할 이름은 그대로 반환된다 — nodeId가 아니므로 엔진이 "승인권자 부재"로 넘어간다');
  assert(!catalog.nodeMap[bogus],
    '그 반환값은 카탈로그 노드가 아니다 (= 승인 홉이 조용히 사라지는 조건)');
  note('그래서 #1이 필요하다: threats.js의 모든 역할 이름을 실제 노드로 강제한다');
}

console.log('\n# 1 — threats.js의 모든 승인권자가 해당 모드의 실제 노드로 해소된다');
{
  const inMode = {};
  ['asis', 'tobe'].forEach(function (mode) {
    inMode[mode] = {};
    KJ.nodesInMode(mode, catalog).forEach(function (n) { inMode[mode][n.id] = n; });
  });
  Object.keys(KJ.THREAT_TYPES).forEach(function (key) {
    const tt = KJ.THREAT_TYPES[key];
    ['asis', 'tobe'].forEach(function (mode) {
      const role = tt.approvalLevel ? tt.approvalLevel[mode] : null;
      if (role === null || role === undefined) return;  // 승인권자 없음 = 의도된 값
      const id = KJ.resolveRoleId(role, catalog);
      assert(!!catalog.nodeMap[id],
        key + '.' + mode + ' 승인권자 "' + role + '" → 카탈로그 노드(' + id + ')');
      // 모드에 없는 노드로 해소되면 nodeState에도 없어 결국 같은 함정에 빠진다.
      assert(!!inMode[mode][id],
        key + '.' + mode + ' 승인권자가 ' + mode + ' 편성에 존재(' + id + ')');
      assert(catalog.nodeMap[id] && catalog.nodeMap[id].category === 'c2',
        key + '.' + mode + ' 승인권자가 C2 노드(큐를 가져 승인 처리 시간이 실제로 붙는다)');
    });
  });
}

console.log('\n# 2 — IAOC는 fusionC2와 같은 노드다 (별칭이지 새 노드가 아니다)');
{
  assert(KJ.resolveRoleId('IAOC', catalog) === catalog.roles.fusionC2 &&
    catalog.roles.fusionC2 !== null,
    "roles.IAOC === roles.fusionC2 === " + catalog.roles.fusionC2);
  // 엔진의 카탈로그 부재 폴백(sim-engine.js)도 같은 대응을 가져야 한다 — 안 그러면
  // 그 경로에서만 조용히 승인이 사라진다.
  const engineSrc = fs.readFileSync(path.join(root, 'js', 'engine', 'sim-engine.js'), 'utf8');
  assert(/roles:\s*\{[^}]*fusionC2[^}]*IAOC[^}]*\}/.test(engineSrc),
    '엔진 폴백 roles에도 IAOC 등록 (카탈로그 부재 경로에서 승인이 사라지지 않게)');
}

console.log('\n# 3 — 실행 흔적: To-Be ABT 승인은 조율층이 받는다 (ADR-077의 실질)');
{
  const approvers = {};
  ['asis', 'tobe'].forEach(function (mode) {
    const r = KJ.runDES({
      scenario: KJ.scenarioById('sc3'), mode, intensity: 1.5, seed: 12345, endTimeSec: 600,
      deploymentId: DEPLOY, modelFidelity: 'iads-c2',
      trace: true, traceCap: 300, features: { highResolutionDeployment: true }
    });
    const seen = {};
    (r.threatTraces || []).forEach(function (t) {
      t.stages.forEach(function (s) {
        // '감독승인개시:<id>' (human-on-loop) · '협조개시:<from>→<to>' (human-in-loop)
        let m = /^감독승인개시:(.+)$/.exec(s.name) || /^협조개시:.+→(.+)$/.exec(s.name);
        if (m) seen[m[1]] = (seen[m[1]] || 0) + 1;
      });
    });
    approvers[mode] = seen;
    note(mode + ' 승인 요청 수신처: ' + JSON.stringify(seen));
  });

  const iaocId = catalog.roles.IAOC;
  const mcrcId = catalog.roles.MCRC;
  const tobeKeys = Object.keys(approvers.tobe);
  assert(tobeKeys.length === 1 && tobeKeys[0] === iaocId,
    'To-Be 승인 요청은 전부 합동방공C2(' + iaocId + ')로 간다 — 조율층 경유');
  assert(approvers.tobe[iaocId] > 0,
    'To-Be 승인 홉이 0건이 아니다 (미등록 키로 승인이 증발하면 여기서 걸린다)');
  assert(!approvers.tobe[mcrcId],
    'To-Be에서 MCRC로 가는 승인 요청 0건 (옛 계선 우회 제거)');

  // As-Is 불변 — asis 필드를 안 건드렸으니 승인권자는 여전히 MCRC뿐이어야 한다.
  const asisKeys = Object.keys(approvers.asis);
  assert(asisKeys.length === 1 && asisKeys[0] === mcrcId,
    'As-Is 승인 요청은 여전히 전부 MCRC(' + mcrcId + ') — 변경이 tobe에만 닿았다');
  assert(!approvers.asis[iaocId],
    'As-Is에는 조율층 승인 0건 (IAOC는 As-Is 편성에 없다)');
}

console.log('\n# 4 — 이득의 출처를 밝혀 둔다 (인용 시 함께 밝혀야 하는 파라미터)');
{
  // 격추 개선의 대부분은 조율층 "위상"이 아니라 승인권자 노드의 **서비스시간**에서 온다.
  // 이 수치가 조용히 바뀌면 ADR-077의 결론 문장도 같이 바뀌어야 하므로 여기 고정한다.
  const iaoc = catalog.nodeMap[catalog.roles.IAOC];
  const mcrc = catalog.nodeMap[catalog.roles.MCRC];
  assert(iaoc.queue.serviceTimeSec.tobe === 2.5 && iaoc.queue.servers === 20,
    'IAOC 승인 처리 2.5초 × 20서버');
  assert(mcrc.queue.serviceTimeSec.tobe === 37.5 && mcrc.queue.servers === 8,
    'MCRC 승인 처리 37.5초 × 8서버');
  note('승인 1건당 15배 차이 — ADR-077 §이득의 출처. 이 값이 바뀌면 ADR 결론도 갱신할 것.');
}

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
