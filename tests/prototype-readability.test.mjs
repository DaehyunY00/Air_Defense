/**
 * 프로토타입 [지휘 흐름] 판독성 회귀 — 「화면이 읽히는가」를 지킨다.
 *
 * 로그(마크 원문 → 사람이 읽는 말)와 배치(노드가 어디에 서는가)를 함께 본다. 둘 다
 * **깨지지 않고 읽기만 나빠지는** 종류의 회귀라 눈으로는 놓친다.
 *
 * 왜 테스트인가: 엔진 마크는 노드 ID와 **영문 사유코드**를 그대로 물고 있다
 * (`누수:window_lost_due_to_c2`, `발사불가:BATTERY_BAT_E1(no_feasible_pip)`).
 * 프로토타입의 markView가 그 형태에 맞춰 풀어 적는데, 엔진이 마크 서식을 바꾸면
 * markView는 **조용히 원문으로 되돌아간다** — 화면이 깨지지 않고 읽기만 나빠지므로
 * 눈으로는 놓친다. 그래서 「엔진이 내는 서식」과 「프로토타입이 푸는 서식」을 맞대어 잰다.
 *
 * 검증 관점:
 *  1) 결정 불변 — 로그는 화면일 뿐, 골든 지문이 움직이면 안 된다.
 *  2) 마크 서식 — 엔진이 실제로 낸 마크가 markView의 갈래에 걸린다.
 *  3) 누수 근거 — 누수 항적마다 `누수:` 마크와 failure(계열·구조성·기여원인)가 있다.
 *  4) 「쐈는가」 — 발사 마크 유무로 누수가 실제로 갈린다(이 판: 대부분 발사에 이르지 못함).
 *  5) 한글화 — taxonomy 전 코드가 한글 라벨을 갖는다(영문이 화면으로 새지 않는다).
 *  6) 배선 — markView·계열표·둘째 줄·줄바꿈(잘림 회귀 방지)이 프로토타입에 있다.
 *  7) 배치 — 두 보기가 placeSlots 한 벌을 공유하고, 짧은 열(대표 C2)이 위 모서리에 붙지 않는다.
 */
import path from 'node:path';
import fs from 'node:fs';
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
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }

/** 프로토타입 기본 플래그 — 사용자가 실제로 보는 판. */
const PROTO = { highResolutionDeployment: true, threatTargetDispersion: true, southernAxes: true,
  linkSemanticsV2: true, sensorReportParity: true, sawtoothFreshness: true, approvalChain: true,
  unifiedEngagementState: true, selfDefenseFire: true,
  approvalPipelineRealism: true, iccRelayAuthorization: true };
function run(mode, feats, opts) {
  opts = opts || {};
  return KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: mode, intensity: 1, seed: opts.seed || 29,
    endTimeSec: 600, deploymentId: 'HANBANDO_LEGACY_NORMAL', trace: !!opts.trace, traceCap: 20000,
    features: Object.assign({ highResolutionDeployment: true }, feats) });
}

// ── 1. 결정 불변 ──
console.log('# 1) 로그는 화면 — 결정은 움직이지 않는다');
const GOLDEN = {
  asis: '94ad09ff4e595491f841bdb60f64c6addfd7aed563ff8c230ee9028d416f1e21',
  tobe: '6429f95197f36aa6447fd4af0c3724d89274566dc31a7a958dd41f6e93745b5f'
};
assert(sha(run('asis', {}, { seed: 12345 })) === GOLDEN.asis, 'SC3 As-Is 골든 지문 불변');
assert(sha(run('tobe', {}, { seed: 12345 })) === GOLDEN.tobe, 'SC3 To-Be 골든 지문 불변');

// ── 2. 마크 서식 ──
console.log('# 2) 엔진 마크가 markView의 갈래에 걸린다');
const r = run('asis', PROTO, { trace: true });
const marks = [];
r.threatTraces.forEach((t) => (t.stages || []).forEach((s) => marks.push(s.name)));
assert(marks.length > 500, `마크 표본 ${marks.length}건`);
// markView가 푸는 갈래 — 프로토타입의 정규식과 같은 모양이어야 한다.
const BRANCH = {
  '누수': /^누수:(.+)$/,
  'BDA': /^BDA:(HIT|MISS):(.+)$/,
  '발사불가': /^발사불가:([^(]+)\(([^)]*)\)$/,
  '발사': /^(발사|자위권발사):([^/]+)(?:\/(.*))?$/,
  '센서': /^(SENSOR_DETECTED|SENSOR_TRACKED|SENSOR_FIRE_CONTROL):(.+)$/,
  '위협우선순위': /^위협우선순위:([^/]+)\/(\d+)$/
};
const hit = {};
marks.forEach((m) => { for (const k in BRANCH) if (BRANCH[k].test(m)) { hit[k] = (hit[k] || 0) + 1; return; } });
for (const k of Object.keys(BRANCH)) assert(hit[k] > 0, `「${k}」 갈래에 걸린 마크 ${hit[k] || 0}건`);
// 엔진이 낸 누수·BDA·발사 계열 마크 중 **하나도** 갈래 밖으로 새지 않아야 한다.
const stray = marks.filter((m) => /^(누수|BDA|발사불가|발사|자위권발사|위협우선순위|SENSOR_(DETECTED|TRACKED|FIRE_CONTROL)):/.test(m)
  && !Object.values(BRANCH).some((re) => re.test(m)));
assert(stray.length === 0, '갈래 밖으로 샌 마크 없음' + (stray.length ? ' — ' + stray.slice(0, 3).join(' / ') : ''));
// PIP 거리는 발사 마크의 꼬리에서 읽는다 — 서식이 바뀌면 「요격점 N km」가 사라진다.
const fires = marks.filter((m) => /^발사:/.test(m));  // 자위권발사는 꼬리가 없다
assert(fires.length > 0 && fires.every((m) => /PIP[\d.]+km/.test(m)),
  `발사 마크 ${fires.length}건 전부 PIP 거리를 문다`);

// ── 3. 누수 근거 ──
console.log('# 3) 누수마다 마크와 failure 기록이 있다');
const leaks = r.threatTraces.filter((t) => /^leaked:/.test(String(t.outcome || '')));
assert(leaks.length > 10, `누수 ${leaks.length}건`);
assert(leaks.every((t) => (t.stages || []).some((s) => /^누수:/.test(s.name))), '전건에 누수 마크');
assert(leaks.every((t) => t.failure && t.failure.primaryCause), '전건에 주원인');
assert(leaks.every((t) => t.failure.family && t.failure.structurality), '전건에 계열·구조성');
// 화면의 「함께 작용: … ×N」은 contributors 순서 × evidence 횟수로 짓는다.
const withC = leaks.filter((t) => (t.failure.contributors || []).length);
assert(withC.length > 0 && withC.every((t) => t.failure.contributors.every(
  (c) => t.failure.evidence && t.failure.evidence[c] && t.failure.evidence[c].count > 0)),
  `기여원인 ${withC.length}건 전부 evidence에 횟수가 있다`);

// ── 4. 「쐈는가」로 갈린다 ──
console.log('# 4) 누수는 「쏘고 놓쳤나 / 쏘지도 못했나」로 갈린다');
const fired = (t) => (t.stages || []).some((s) => /^(발사|자위권발사):/.test(s.name));
const notFired = leaks.filter((t) => !fired(t));
assert(notFired.length > 0 && fired(leaks.find(fired) || {}) !== undefined, '두 갈래가 모두 나온다');
assert(notFired.length > leaks.length * 0.6,
  `누수 ${leaks.length}건 중 ${notFired.length}건은 발사에 이르지 못함 — 「요격 실패」로 뭉뚱그리면 안 되는 이유`);
// 명중 실패(missed)는 반드시 쏜 항적에서만 난다.
assert(leaks.filter((t) => /missed/.test(String(t.outcome))).every(fired),
  'missed 누수는 전부 발사 이력이 있다');

// ── 5. 한글화 ──
console.log('# 5) taxonomy 전 코드에 한글 라벨');
const codes = Object.keys(KJ.LEAK_TAXONOMY);
assert(codes.length >= 20, `taxonomy ${codes.length}종`);
const noKo = codes.filter((c) => !/[가-힣]/.test((KJ.leakTaxonomy(c) || {}).label || ''));
assert(noKo.length === 0, '한글 라벨 없는 코드 없음' + (noKo.length ? ' — ' + noKo.join(', ') : ''));
// 계열·구조성도 프로토타입 표가 전부 덮어야 한다(안 덮으면 영문이 화면으로 샌다).
const proto = fs.readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
const famTable = (proto.match(/const LEAK_FAMILY = \{[\s\S]*?\};/) || [''])[0];
const fams = [...new Set(codes.map((c) => KJ.LEAK_TAXONOMY[c].family))];
const missFam = fams.filter((f) => !new RegExp('\\b' + f + ':').test(famTable));
assert(missFam.length === 0, `계열 ${fams.length}종 전부 LEAK_FAMILY에 있음` + (missFam.length ? ' — 빠짐: ' + missFam.join(', ') : ''));
const structTable = (proto.match(/const LEAK_STRUCT = \{[\s\S]*?\};/) || [''])[0];
const missSt = [...new Set(codes.map((c) => KJ.LEAK_TAXONOMY[c].structurality))]
  .filter((x) => x && !new RegExp('\\b' + x + ':').test(structTable));
assert(missSt.length === 0, '구조성 전부 LEAK_STRUCT에 있음' + (missSt.length ? ' — 빠짐: ' + missSt.join(', ') : ''));

// ── 6. 배선 ──
console.log('# 6) 프로토타입 배선');
assert(/function markView\(name, trk, axis\)/.test(proto), 'markView 존재');
assert(/const mv = markView\(s\.name, t, s\.axis\)/.test(proto), 'buildLogRows가 markView를 탄다');
assert(/raw: mv\.raw/.test(proto), '원문(raw) 보존 — 인용·대조는 코드로 한다');
assert(/sensor: \/\^SENSOR_\/\.test\(s\.name\)/.test(proto),
  '센서 판정은 **원문**으로 — 화면 문구로 재면 그래프의 거르는 기준과 어긋난다');
assert(/r\.sub \? `<span class="res">/.test(proto), '둘째 줄(.res) 렌더 배선');
assert(/oc\.fired \? '발사 후 실패' : '발사 못함'/.test(proto), '로그 머리에 「쐈는가」');
assert(/fired: \(t\.fireShooters \|\| \[\]\)\.length > 0/.test(proto), 'outcomeInfo.fired');
assert(/function shortC2\(name, axis\)/.test(proto), '접두사 없는 지휘소 약칭 치환');
assert(/function humanIds\(s\)/.test(proto), '노드 ID → 배치 이름 치환');
// 잘림 회귀 방지 — 노드 이름을 풀어 적은 뒤로 nowrap+ellipsis는 사유를 통째로 삼킨다.
const xRule = (proto.match(/\.ev \.x \{[^}]*\}/) || [''])[0];
assert(!/nowrap/.test(xRule) && /white-space: normal/.test(xRule),
  '.ev .x 는 줄바꿈한다 (nowrap+ellipsis 회귀 시 사유가 화면에서 사라진다)');
assert(/const FAMILY_HINT = \{/.test(proto), '계열의 뜻(FAMILY_HINT) — 툴팁');

// ── 7. 배치 ──
console.log('# 7) 배치 — 대표 C2가 화면 위 모서리에 붙지 않는다');
assert(/function placeSlots\(W, minH, cmp\)/.test(proto), 'placeSlots 한 벌');
// 두 보기가 같은 함수를 쓴다 — 다른 자리에 그리면 눈이 매번 배치를 다시 익혀야 한다.
assert((proto.match(/placeSlots\(/g) || []).length >= 3,
  'layoutAll·layoutTrack이 같은 placeSlots를 부른다');
const slotBody = (proto.match(/function placeSlots\(W, minH, cmp\)[\s\S]*?\n\}/) || [''])[0];
assert(/const pitch = Math\.min\(ROW \* 2, rowMax \* ROW \/ Math\.max\(1, rows\)\)/.test(slotBody),
  '짧은 열은 줄 간격을 벌린다 (최대 두 배)');
assert(/const off = Math\.min\(\(rowMax \* ROW - rows \* pitch\) \* \.25, ROW \* 3\)/.test(slotBody),
  '짧은 열은 남는 높이의 1/4(최대 세 줄)만큼 내려 선다');
assert(/y: 74 \+ off \+ pitch \* \(ri \+ \.5\)/.test(slotBody), '내림값·간격이 실제 y에 들어간다');
// 배치 산술을 그대로 옮겨 최악의 경우를 훑는다. 두 가지를 동시에 지켜야 한다:
//  ① 대표 C2(열에 2개)는 기본 줄 간격보다 확실히 벌어진다
//  ② 어떤 조합에서도 캔버스 아래로 흘러넘치지 않는다
const ROW = 54, DENSE = 30;
const place = (rowMax, rows, ri) => {
  const pitch = Math.min(ROW * 2, rowMax * ROW / Math.max(1, rows));
  const off = Math.min((rowMax * ROW - rows * pitch) * 0.25, ROW * 3);
  return { y: 74 + off + pitch * (ri + 0.5), pitch: pitch };
};
let over = 0;
for (let rowMax = 1; rowMax <= 90; rowMax++) {
  const H = 74 + rowMax * ROW + 26;
  for (let rows = 1; rows <= Math.min(rowMax, DENSE); rows++) {
    if (place(rowMax, rows, rows - 1).y + 27 > H) over++;
  }
}
assert(over === 0, '어떤 열 조합에서도 캔버스 아래로 넘치지 않는다');
// LEGACY 배치의 실제 값: 최대 열은 센서 19, 대표 C2 열은 2개.
const c2 = place(19, 2, 0), c2b = place(19, 2, 1);
assert(c2b.y - c2.y > ROW * 1.5,
  `대표 C2 두 노드 간격 ${Math.round(c2b.y - c2.y)}px — 기본 줄 간격 ${ROW}px보다 확실히 넓다`);
assert(place(19, 19, 0).pitch === ROW, '가장 긴 열은 기본 줄 간격 그대로 (밀집 열이 늘어나지 않는다)');

console.log(fail ? '\n실패 ' + fail + '건' : '\n전체 통과');
process.exit(fail ? 1 : 0);
