/**
 * ADR-064 — 남부 종심 축선 회귀.
 *
 * 검증 관점:
 *  1) OFF bit-exact — 축선 정의가 coverage 파생을 통해 OFF 결과를 오염시키지 않는다(변형 카탈로그).
 *  2) 도착 스트림 분리 — ON이 기존 축선의 도착 스케줄을 전혀 바꾸지 않는다("추가"이지 "재추첨"이 아님).
 *  3) 사거리 정합 — 배정된 위협만 ENV-AXIS-FIT-01 통과, 무인기·헬기는 자동 거부.
 *  4) 체공 환산 — 남부 축선 함의 속도가 기준축(중부)과 동일, 기존 축선 dwell 불변.
 *  5) 남부 자산 활성화 — 종전 0문이던 36.5°N 이남 사수가 실제로 교전한다.
 *  6) 제약 불변 — 신궁·천마 탄도탄 불가.
 *  7) UI·라우터·params 배선.
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
  'config/deployment-adapter.js', 'core/rng.js', 'core/heap.js',
  'analysis/bottleneck.js', 'engine/sim-engine.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = globalThis.KJ, fail = 0;
installIadsKernel(KJ);
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function sha(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
function run(f, opts) {
  opts = opts || {};
  return KJ.runDES({
    scenario: KJ.scenarioById(opts.sc || 'sc3'), mode: opts.mode || 'asis', intensity: 1.5,
    seed: opts.seed || 12345, endTimeSec: opts.dur || 900, trace: true, traceCap: 5000,
    deploymentId: opts.dep || 'HANBANDO_FULL_NORMAL',
    // ADR-065: 남부 축선이 기본 ON이라 키 생략 = ON이다. 호출자가 항상 명시한다.
    features: Object.assign({ highResolutionDeployment: true, southernAxes: false }, f)
  });
}
var SOUTH = KJ.SOUTHERN_AXIS_KEYS;

// ── 1. OFF bit-exact (coverage 파생 오염 방지) ──
console.log('# OFF bit-exact — 축선 정의가 OFF 결과를 오염시키지 않음');
var off = run({});
assert(sha(off) === sha(run({})), 'OFF 결정론');
assert(!off.global.features.southernAxes, 'OFF는 features에 노출되지 않음');
assert(off.threatTraces.every(function (t) { return SOUTH.indexOf(t.axis) === -1; }),
  'OFF에서는 남부 축선 위협이 하나도 생성되지 않음');
// coverage 파생: OFF 카탈로그에는 남부 축선 키가 없어야 한다(있으면 기존 자산의 교전 자격이 바뀜)
var catOff = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL', { southernAxes: false });
var catOn = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL', { southernAxes: true });
assert(catOff.nodes.every(function (n) {
  return !n.coverage || n.coverage.every(function (a) { return SOUTH.indexOf(a) === -1; });
}), 'OFF 카탈로그의 coverage에 남부 축선 키 부재 (변형 카탈로그로 분리)');
var gained = catOn.nodes.filter(function (n) {
  return n.coverage && n.coverage.some(function (a) { return SOUTH.indexOf(a) !== -1; });
});
assert(gained.length > 0, 'ON 카탈로그에서는 남부 축선을 담당하는 노드가 생김 (' + gained.length + '개)');
var onRes = run({ southernAxes: true });
assert(sha(onRes) !== sha(off), 'ON은 실제로 다른 결과');
assert(onRes.global.features.southernAxes === true, 'ON은 features에 신고');

// ── 2. 도착 스트림 분리 — 기존 축선 스케줄 완전 보존 ──
console.log('# 도착 스트림 분리');
function sig(r) {
  return r.threatTraces.filter(function (t) { return SOUTH.indexOf(t.axis) === -1; })
    .map(function (t) { return t.type + '@' + t.axis + '@' + t.spawnT.toFixed(3); }).join('|');
}
assert(sig(off) === sig(onRes),
  '기존 축선의 도착 스케줄(시각·유형·수) 완전 동일 — 남부는 전용 스트림(southRng)으로 "추가"만 됨');
var southCount = onRes.threatTraces.filter(function (t) { return SOUTH.indexOf(t.axis) !== -1; }).length;
assert(southCount > 0, '남부 축선 위협이 실제로 생성됨 (' + southCount + '건)');

// ── 3. 사거리 정합 (ENV-AXIS-FIT-01) ──
console.log('# 사거리 정합');
SOUTH.forEach(function (a) {
  ['srbm', 'cruise', 'fighter'].forEach(function (t) {
    assert(KJ.checkAxisThreatFit(t, a).ok, t + '@' + a + ' 사거리·권역 정합 통과');
  });
  ['uav_small', 'heli'].forEach(function (t) {
    assert(!KJ.checkAxisThreatFit(t, a).ok, t + '@' + a + ' 자동 거부 (개념 사거리·권역 미달)');
  });
});
var R = KJ.THREAT_TARGET_SPREAD_KM;
var southMix = KJ.scenarioById('sc3').southernMix || [];
assert(southMix.length > 0, 'SC3에 남부 mix 선언 존재 (' + southMix.length + '항목)');
southMix.forEach(function (m) {
  var tt = KJ.threatType(m.type), ax = KJ.AXES[m.axis];
  assert(KJ.checkAxisThreatFit(m.type, m.axis).ok &&
    (!tt.rangeBandKm || tt.rangeBandKm.max >= ax.conceptReachKm + R),
    m.type + '@' + m.axis + ' 산포 포함 최악거리(' + (ax.conceptReachKm + R) + 'km)까지 사거리 정합');
});
assert(!southMix.some(function (m) { return m.type === 'mrl_large' && m.axis === 'southeast'; }),
  '방사포는 부산축에 배정되지 않음 (400km + 산포 15km > 개념 최대사거리 400km)');

// ── 4. 체공시간 거리 환산 ──
console.log('# 체공시간 거리 환산');
['west', 'central', 'east', 'seoul'].forEach(function (a) {
  assert(KJ.axisDwellSec(a, 120) === 120, a + ' 축선 dwell 불변 (기존 축선 bit-exact 보존)');
});
SOUTH.forEach(function (a) {
  var ax = KJ.AXES[a];
  ['srbm', 'cruise', 'fighter'].forEach(function (t) {
    var base = KJ.threatType(t).dwellSec;
    var dw = KJ.axisDwellSec(a, base);
    var vSouth = ax.conceptReachKm / dw;
    var vRef = KJ.AXIS_DWELL_REFERENCE_KM / base;
    assert(dw > base && Math.abs(vSouth - vRef) < 1e-9,
      t + '@' + a + ' dwell ' + base + '→' + dw.toFixed(0) + 's · 함의속도 ' +
      vSouth.toFixed(2) + 'km/s = 기준축 동일');
  });
});

// ── 5. 남부 자산 활성화 (도입 목적) ──
console.log('# 남부 자산 활성화');
// ⚠️ ADR-072 정정 — **ROK 자산만** 센다.
// ADR-064의 주장은 "ROK 남부 배치 자산 14문이 표적 회랑 미도달로 유휴"다. USFK THAAD(성주,
// 36.13°N)는 ADR-036 독립축이라 KAMDOC 표적 회랑 설정과 무관하게 자기 축에서 교전하며,
// 사거리(개념 ~200km)상 오산·서울로 향하는 탄도 위협을 성주에서 요격하는 것이 배치 목적 자체다.
// ADR-069(톱니)·ADR-071(자위권)이 기본 ON이 되어 항적 신선도·발사 기회가 바뀌자 그 교전이
// 실제로 발현했고(각 플래그 단독으로도 발현), 종전 "0문" 관측은 정보 타이밍의 우연이었음이
// 드러났다. 제약 위반이 아니라 관측 전제가 무너진 것이므로 **주장의 범위대로** 좁힌다.
function southFired(r, cat, rokOnly) {
  return r.nodes.filter(function (n) {
    if (n.category !== 'shooter' || !(n.shots > 0)) return false;
    var nd = cat.nodeMap[n.id];
    if (!nd || nd.coord[0] >= 36.6) return false;
    return rokOnly ? nd.forceOwner !== 'USFK' : true;
  });
}
var firedOff = southFired(off, catOff, true);
var longRun = run({ southernAxes: true }, { dur: 1800 });
var firedOn = southFired(longRun, catOn, true);
assert(firedOff.length === 0,
  'OFF: 36.6°N 이남 **ROK** 사수 발사 0문 (표적 회랑 미도달 — USFK 독립축 제외)');
// USFK가 남쪽에서 교전하는 것은 정상이므로, 그 사실 자체를 기록해 회귀 시 눈에 보이게 한다.
var usfkSouthOff = southFired(off, catOff, false).filter(function (n) {
  return catOff.nodeMap[n.id].forceOwner === 'USFK';
});
console.log('  NOTE USFK 남부 교전(정상 · ADR-036 독립축): ' +
  (usfkSouthOff.map(function (n) { return n.id.replace('BATTERY_', ''); }).join(', ') || '없음'));
assert(firedOn.length > 0,
  'ON: 남부 사수가 실제로 교전 (' + firedOn.length + '문: ' +
  firedOn.map(function (n) { return n.id.replace('BATTERY_', ''); }).join(', ') + ')');
var southThreats = longRun.threatTraces.filter(function (t) { return SOUTH.indexOf(t.axis) !== -1; });
assert(southThreats.some(function (t) { return t.outcome === 'killed'; }),
  '남부 축선 위협이 실제로 격추됨 (도달 가능성 확인)');

// ── 6. 제약 불변 ──
console.log('# 제약 불변');
var shoradIds = {};
catOn.nodes.forEach(function (n) {
  if (n.category === 'shooter' && (n.typeId === 'BIHO' || n.typeId === 'CHUNMA')) shoradIds[n.id] = true;
});
// SC3에는 비호·천마가 정당하게 교전하는 위협(무인기·순항·전투기)이 섞여 있으므로
// "발사 0건"이 아니라 **탄도 위협에 대한 발사 0건**이 제약의 내용이다(constraints (a)와 동일 취지).
var ballisticShots = 0;
longRun.threatTraces.forEach(function (t) {
  if (t.type !== 'srbm' && t.type !== 'mrl_large') return;
  t.stages.forEach(function (st) {
    if (st.name.indexOf('발사:') !== 0) return;
    if (shoradIds[st.name.split(':')[1].split('/')[0]]) ballisticShots++;
  });
});
assert(ballisticShots === 0,
  '남부 축선 ON에서도 비호·천마의 탄도 위협 발사 0건 (제약 어서션 a 불변)');
// ⚠️ ADR-072 정정 — 종전 어서션은 "남부 축선 위협은 전부 장거리 유형이라 단거리 방공 사거리
// 미달"을 전제로 발사 0건을 요구했다. **그 전제가 틀렸다**: 위협 유형이 장거리라는 것은
// 발사 지점이 멀다는 뜻이지, 종말단계 착탄점 상공에서 단거리 방공 사거리 밖이라는 뜻이 아니다.
// 대구·부산 상공에 도달한 순항미사일은 그곳 비호의 교전 봉투 안이며, 요격하는 것이 정상이다.
// ADR-069·071 기본 ON으로 그 교전이 발현했다(각 플래그 단독으로도 1건). 제약의 실제 내용은
// **유형 제약**이므로 그것으로 대체한다 — 위 ballisticShots와 함께 이중으로 고정된다.
var shoradSouthByType = {};
longRun.threatTraces.forEach(function (t) {
  if (SOUTH.indexOf(t.axis) === -1) return;
  t.stages.forEach(function (st) {
    if (st.name.indexOf('발사:') !== 0) return;
    if (shoradIds[st.name.split(':')[1].split('/')[0]]) {
      shoradSouthByType[t.type] = (shoradSouthByType[t.type] || 0) + 1;
    }
  });
});
var southBallistic = (shoradSouthByType.srbm || 0) + (shoradSouthByType.mrl_large || 0);
assert(southBallistic === 0,
  '남부 축선 위협 중 비호·천마가 발사한 탄도 위협 0건 (유형 제약 — 발사 분포: ' +
  (JSON.stringify(shoradSouthByType) || '{}') + ')');

// ── 7. UI·라우터·문서 배선 ──
console.log('# 배선');
var router = fs.readFileSync(path.join(root, 'js', 'core', 'router.js'), 'utf8');
// ADR-065: 기본 ON 전환 — 라우터 기본값 '1', 명시적 '0'만 해제로 읽는다.
assert(/south: '1'/.test(router), "라우터 DEFAULTS에 south 기본 ON ('1')");
assert(/state\.south = \(state\.south === '0'/.test(router), "명시적 '0'만 해제로 정규화");
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('id="southern-axes-toggle"') !== -1, '상단 컨트롤에 남부 축선 토글 존재');
['main.js', 'ui/panels.js', 'ui/sim-view.js'].forEach(function (f) {
  var src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  assert(/features\.southernAxes = .*south !== '0'/.test(src),
    f + " modelConfig가 south → features 전달 (기본 ON, '0'만 해제)");
});
var params = fs.readFileSync(path.join(root, 'docs', 'params.md'), 'utf8');
['THREAT-SOUTH-SHARE-01', 'THREAT-AXIS-DWELL-SCALE-01'].forEach(function (id) {
  assert(params.indexOf(id) !== -1, id + ' params.md 등록');
});

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
