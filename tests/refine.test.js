/**
 * K-JAMDS 시뮬레이터 — 정밀화(Refine) 회귀 테스트 (Phase A~D)
 * 실행:  node tests/refine.test.js   (저장소 루트에서)
 *
 * Phase A: 위협 사거리대·발사권역 데이터 존재 + 축선-사거리 정합(ENV-AXIS-FIT-01)
 *          + 시드 고정 스냅샷(엔진 의미 불변 확인 — 엔진 변경 Phase에서 의도적 갱신)
 * Phase B: Best-Shooter 적합도 WTA·부하 기반 동적 권한위임(부하의 함수)·제약 유지
 * Phase C: 실패원인 taxonomy 완전성 + To-Be 원인분포 구조적 개선 방향
 * Phase D: 신규 지표(결심지연·비용교환비) 계산·결정론
 */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..', 'js');
['data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
 'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach(function (f) {
  require(path.join(root, f));
});
var KJ = global.KJ;

var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
function run(id, mode, x, seed, dur) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: dur || 1800 });
}

// ══════════ Phase A — 위협 출발점 정합화 ══════════
console.log('# A-1 위협별 사거리대·발사권역 데이터 (개념값, THR-*-RNG-*)');
var typeKeys = Object.keys(KJ.THREAT_TYPES);
assert(typeKeys.every(function (k) {
  var t = KJ.THREAT_TYPES[k];
  return t.rangeBandKm && t.rangeBandKm.min > 0 && t.rangeBandKm.max >= t.rangeBandKm.min &&
    Array.isArray(t.originZones) && t.originZones.length > 0 && typeof t.rangeRef === 'string';
}), '전 위협(' + typeKeys.length + '종) rangeBandKm{min,max}·originZones·rangeRef 보유');
assert(typeKeys.every(function (k) {
  return KJ.THREAT_TYPES[k].originZones.every(function (z) { return z in KJ.ORIGIN_ZONES; });
}), '전 originZones 태그가 KJ.ORIGIN_ZONES 정의에 존재');
assert(KJ.THREAT_TYPES.srbm.originZones.join() === 'deep' &&
  KJ.THREAT_TYPES.mrl_large.originZones.join() === 'deep',
  '탄도탄(srbm·mrl_large)은 종심(deep) 발사권역 전용');
assert(KJ.THREAT_TYPES.uav_small.originZones.indexOf('deep') === -1,
  '근거리 무인기는 종심(deep) 발사권역 미포함 (근거리 정합)');

console.log('# A-2 축선 발사권역·개념거리 (ENV-AXIS-FIT-01)');
var axisKeys = Object.keys(KJ.AXES);
assert(axisKeys.every(function (k) {
  var a = KJ.AXES[k];
  return Array.isArray(a.launchZones) && a.launchZones.length > 0 &&
    a.conceptReachKm > 0 && typeof a.reachNote === 'string' && a.reachNote.indexOf('개념') !== -1;
}), '전 축선(' + axisKeys.length + '개) launchZones·conceptReachKm·"개념" 명시 reachNote 보유');
assert(KJ.AXES.seoul.launchZones.join() === 'dmz',
  'seoul 축선은 DMZ 인접 근거리 전용 (종심 위협 배분 차단)');

console.log('# A-3 시나리오 배분의 축선-사거리 정합');
KJ.SCENARIOS.forEach(function (sc) {
  var v = KJ.validateScenarioOrigins(sc);
  assert(v.length === 0, sc.id + ': 위반 0건' +
    (v.length ? ' — ' + JSON.stringify(v) : ''));
});
assert(!KJ.checkAxisThreatFit('srbm', 'seoul').ok,
  '부정 케이스: 종심 전용 srbm의 seoul(근거리) 축선 배분은 거부됨');
assert(!KJ.checkAxisThreatFit('uav_small', '없는축선').ok, '부정 케이스: 미정의 축선 거부');

console.log('# A-4 정합화는 데이터 계층 — 병목 도출·통계의 부하 함수성 유지 (스냅샷)');
// 시드 고정 스냅샷: 엔진 의미가 바뀌면(의도된 Phase B 등) 이 값을 갱신하고 커밋 메시지에 명시.
var SNAPSHOT = require('./refine-snapshot.json');
Object.keys(SNAPSHOT).forEach(function (key) {
  var p = key.split('/'); // sc/mode
  var r = run(p[0], p[1], 1.5, 42);
  var got = {
    spawned: r.global.spawned, killed: r.global.killed, leaked: r.global.leaked,
    bn: r.bottlenecks.map(function (b) { return b.kind + ':' + b.id; }).sort().join(',')
  };
  assert(JSON.stringify(got) === JSON.stringify(SNAPSHOT[key]),
    '스냅샷 ' + key + ' 일치 (기대 ' + JSON.stringify(SNAPSHOT[key]) + ' / 실제 ' + JSON.stringify(got) + ')');
});

// ══════════ Phase B — C2 고도화 ══════════
console.log('# B-1 Best-Shooter 적합도 WTA (C2-WTA-SUIT-01)');
var shooters = KJ.NODES.filter(function (n) { return n.category === 'shooter'; });
assert(shooters.every(function (n) {
  return n.wtaSuit && ['low', 'medium', 'ballistic'].every(function (b) {
    return typeof n.wtaSuit[b] === 'number' && n.wtaSuit[b] >= 0;
  }) && n.wtaSuit.paramRef === 'C2-WTA-SUIT-01';
}), '전 무기(' + shooters.length + '기) wtaSuit(low/medium/ballistic)·paramRef 보유');
assert(shooters.filter(function (n) { return n.canEngage.srbm === false; })
  .every(function (n) { return n.wtaSuit.ballistic === 0; }),
  '탄도탄 교전불가 무기는 wtaSuit.ballistic=0 (데이터 정합)');
// 행위: 저고도 소형표적 단독 구성 — To-Be는 저고도 적합 무기(SHORAD)에 집중, 부적합(FTR) 회피
var uavScn = {
  id: 'test-uav', name: '무인기 단독(검증용)',
  mix: [{ type: 'uav_small', axis: 'west', ratePerMin: 1.2 },
        { type: 'uav_small', axis: 'seoul', ratePerMin: 0.8 }]
};
function shooterArr(r, prefix) {
  return r.nodes.filter(function (n) { return n.id.indexOf(prefix) === 0; })
    .reduce(function (s, n) { return s + n.arrivals; }, 0);
}
var uavA = KJ.runDES({ scenario: uavScn, mode: 'asis', intensity: 1.5, seed: 7, endTimeSec: 1800 });
var uavB = KJ.runDES({ scenario: uavScn, mode: 'tobe', intensity: 1.5, seed: 7, endTimeSec: 1800 });
assert(shooterArr(uavB, 'SHORAD') > shooterArr(uavB, 'FTR'),
  'To-Be: 저고도 표적을 SHORAD(적합)에 집중 (SHORAD ' + shooterArr(uavB, 'SHORAD') + ' > FTR ' + shooterArr(uavB, 'FTR') + ')');
assert(shooterArr(uavB, 'FTR') / Math.max(1, uavB.global.engaged) <=
       shooterArr(uavA, 'FTR') / Math.max(1, uavA.global.engaged),
  'To-Be의 부적합 무기(FTR) 배정 비율 ≤ As-Is (적합 무기로 더 자주 교전)');

console.log('# B-2 부하 기반 동적 권한위임 (C2-DELEG-THRESH-01 — 부하의 함수)');
function runX(id, mode, x, seed) {
  return KJ.runDES({ scenario: KJ.scenarioById(id), mode: mode, intensity: x, seed: seed, endTimeSec: 1800 });
}
// 저강도(0.5×)에서는 전환 0건 — 전환은 하드코딩이 아니라 부하의 함수.
// (feat/stage2-track-overhaul Phase 4: 중복항적 팬아웃이 각 군 C2 부하를 배가시켜 SC3는 이제
//  x1.0부터도 승인노드 큐가 임계를 넘어 전환이 발생한다 — 권한위임 기능의 실사용 구간 부활이지
//  회귀가 아님. 견고한 "미발동" 대조는 최저강도 0.5×로 좁힌다.)
assert(runX('sc3', 'asis', 0.5, 42).global.delegation.count === 0,
  'SC3 As-Is 최저강도(0.5×): 전환 0건 (전환은 하드코딩이 아니라 부하의 함수)');
var d3 = runX('sc3', 'asis', 3, 42).global.delegation;
assert(d3.count > 0 && d3.byNode.KAOC > 0 && d3.firstT !== null,
  'SC3 As-Is 강도 3.0: 승인 포화 → 분권 전환 발생 (' + d3.count + '건, 최초 t=' + (d3.firstT || 0).toFixed(0) + 's)');
// 동일 포화 구성에서 To-Be가 더 자주 전환 (COP 기반 임계 차등: 대기 c×1 vs c×4)
// ※ 공통난수(CRN) 이식 후: As-Is와 To-Be가 "동일 위협열"을 마주하게 되면서, 종전 단일 seed(5)로
//   검증하던 "To-Be 최초 전환이 더 이름" 주장이 seed별로 흔들린다(5/10). 이는 두 상반된 효과가
//   경쟁하기 때문이다 — 낮은 임계(c×1)는 전환을 늘리나, To-Be의 빠른 처리(덜 혼잡)는 승인 대기를
//   줄여 전환을 늦춘다. 따라서 단일 seed "더 이름"은 CRN 하에서 견고하지 않다(CRN이 드러낸 발견).
//   legacy MFR 10개 확장 후 As-Is에는 중복 항적 팬아웃 부하가 추가되고 To-Be는 JAMDC2가
//   이를 융합한다. 따라서 전환 총량은 As-Is가 더 큰 것이 새 토폴로지의 견고한 결과다.
var ftrScn = {
  id: 'test-ftr', name: '전투기 포화(검증용)',
  mix: [{ type: 'fighter', axis: 'west', ratePerMin: 6 },
        { type: 'fighter', axis: 'east', ratePerMin: 6 }]
};
var fA5 = KJ.runDES({ scenario: ftrScn, mode: 'asis', intensity: 1, seed: 5, endTimeSec: 1800 }).global.delegation;
var fB5 = KJ.runDES({ scenario: ftrScn, mode: 'tobe', intensity: 1, seed: 5, endTimeSec: 1800 }).global.delegation;
assert(fA5.count > 0 && fB5.count > 0, '포화 구성: 양 모드 전환 발생 (As-Is ' + fA5.count + ' · To-Be ' + fB5.count + ')');
var poolA = 0, poolB = 0;
for (var fsd = 1; fsd <= 10; fsd++) {
  poolA += KJ.runDES({ scenario: ftrScn, mode: 'asis', intensity: 1, seed: fsd, endTimeSec: 1800 }).global.delegation.count;
  poolB += KJ.runDES({ scenario: ftrScn, mode: 'tobe', intensity: 1, seed: fsd, endTimeSec: 1800 }).global.delegation.count;
}
assert(poolA > poolB && poolB > 0,
  '확장 MFR 중복항적 부하로 As-Is 전환 총량 > To-Be [pooled seed1~10] (' + poolA + ' > ' + poolB + ')');
var fB2 = KJ.runDES({ scenario: ftrScn, mode: 'tobe', intensity: 1, seed: 5, endTimeSec: 1800 }).global.delegation;
assert(JSON.stringify(fB5) === JSON.stringify(fB2), '전환 기록도 동일 seed → 완전 동일 (결정론)');

console.log('# B-3 위협별 자동화 차등 플래그 (C2-AUTO-LEVEL-01)');
var AUTO_LEVELS = ['human-in-loop', 'human-on-loop', 'auto-preauth'];
assert(typeKeys.every(function (k) {
  var a = KJ.THREAT_TYPES[k].automation;
  return a && AUTO_LEVELS.indexOf(a.asis) !== -1 && AUTO_LEVELS.indexOf(a.tobe) !== -1;
}), '전 위협 automation{asis,tobe} 플래그 보유 (유효값)');
assert(typeKeys.every(function (k) { return KJ.THREAT_TYPES[k].automation.asis === 'human-in-loop'; }),
  'As-Is는 전 위협 human-in-loop (기존 승인 동작 보존)');
assert(KJ.THREAT_TYPES.srbm.automation.tobe === 'auto-preauth' &&
       KJ.THREAT_TYPES.uav_small.automation.tobe === 'auto-preauth',
  '탄도탄·무인기 To-Be 사전승인 자동교전 (note 텍스트의 플래그 승격)');

console.log('# B 종합 — 제약·개선 방향');
var balScn3 = {
  id: 'test-ballistic', name: '탄도탄 단독(검증용)',
  mix: [{ type: 'srbm', axis: 'central', ratePerMin: 1.0 },
        { type: 'mrl_large', axis: 'east', ratePerMin: 1.5 }]
};
['asis', 'tobe'].forEach(function (m) {
  var r = KJ.runDES({ scenario: balScn3, mode: m, intensity: 3, seed: 11, endTimeSec: 1800 });
  assert(r.nodes.filter(function (n) { return n.id.indexOf('SHORAD') === 0 && n.arrivals > 0; }).length === 0,
    m + ' 강도 3.0: 신궁·천마 탄도탄 교전투입 0 (새 WTA에서도 canEngage 제약 우선)');
});
var cmpA = runX('sc3', 'asis', 1.5, 42), cmpB = runX('sc3', 'tobe', 1.5, 42);
assert(cmpB.global.leakRate < cmpA.global.leakRate, 'To-Be 누수율 < As-Is (동일 seed)');
assert(cmpB.global.meanDecisionDelaySec < cmpA.global.meanDecisionDelaySec,
  'To-Be 결심 지연 < As-Is (' + cmpB.global.meanDecisionDelaySec.toFixed(0) + 's < ' +
  cmpA.global.meanDecisionDelaySec.toFixed(0) + 's)');

// ══════════ Phase C — 실패원인 taxonomy·모드 대조 ══════════
console.log('# C-1 실패원인 taxonomy v2 필수 필드 (KJ.LEAK_TAXONOMY)');
assert(Object.keys(KJ.LEAK_TAXONOMY).every(function (c) {
  var t = KJ.LEAK_TAXONOMY[c];
  return t && t.label && t.group && t.family && t.structurality &&
    typeof t.structural === 'boolean';
}), '전 taxonomy v2 원인코드에 label·group·family·structurality·structural 부여');
assert(KJ.leakTaxonomy('overflow:KAOC').label.indexOf('KAOC') !== -1 &&
       KJ.leakTaxonomy('overflow:KAOC').group === KJ.LEAK_TAXONOMY.overflow.group,
  'overflow:<노드> 접두 코드가 노드명 포함 라벨로 해석됨');
// 행위: 고강도 실행에서 관측되는 모든 leakReason이 taxonomy로 해석 가능(기타 없음)
(function () {
  var unknown = [];
  [0, 21, 42].forEach(function (sd) {
    ['sc2', 'sc3'].forEach(function (id) {
      ['asis', 'tobe'].forEach(function (m) {
        var r = runX(id, m, 3, sd);
        Object.keys(r.global.leakReasons).forEach(function (code) {
          if (KJ.leakTaxonomy(code).group === '기타') unknown.push(code);
        });
      });
    });
  });
  assert(unknown.length === 0, '관측된 전 leakReason이 taxonomy에 매핑 (미지 코드: ' + unknown.join(',') + ')');
})();

console.log('# C-2 As-Is↔To-Be 원인분포 — 구조적 개선의 이동 경로');
function aggReasons(id, x, mode, seeds) {
  var agg = { structuralRate: 0, missedShare: 0, byCode: {}, spawned: 0, structural: 0, missed: 0, leaked: 0 };
  seeds.forEach(function (sd) {
    var r = runX(id, mode, x, sd);
    agg.spawned += r.global.spawned;
    Object.keys(r.global.leakReasons).forEach(function (code) {
      var n = r.global.leakReasons[code];
      agg.leaked += n;
      var key = code.indexOf('overflow:') === 0 ? 'overflow' : code;
      agg.byCode[key] = (agg.byCode[key] || 0) + n;
      if (KJ.leakTaxonomy(code).structural) agg.structural += n; else if (key === 'missed') agg.missed += n;
    });
  });
  agg.structuralRate = agg.spawned ? agg.structural / agg.spawned : 0;
  agg.missedShare = agg.leaked ? agg.missed / agg.leaked : 0;
  return agg;
}
var SEEDS = [0, 21, 42, 77, 100];
[['sc2', 2], ['sc3', 3]].forEach(function (p) {
  var a = aggReasons(p[0], p[1], 'asis', SEEDS), b = aggReasons(p[0], p[1], 'tobe', SEEDS);
  assert(b.structuralRate <= a.structuralRate,
    p[0] + ' x' + p[1] + ': To-Be 확정 구조적 주원인 비율 ≤ As-Is (' +
    (b.structuralRate * 100).toFixed(1) + '% ≤ ' + (a.structuralRate * 100).toFixed(1) + '%; conditional은 별도)');
  assert(b.missedShare >= a.missedShare,
    p[0] + ' x' + p[1] + ': To-Be에서 실패 중 명중실패 비중 ≥ As-Is (구조적→종말 성능으로 이동: ' +
    (a.missedShare * 100).toFixed(1) + '% → ' + (b.missedShare * 100).toFixed(1) + '%)');
  assert((b.byCode.responsibility_gap || 0) <= (a.byCode.responsibility_gap || 0),
    p[0] + ' x' + p[1] + ': To-Be responsibility_gap ≤ As-Is');
  assert((b.byCode.no_report_path || 0) <= (a.byCode.no_report_path || 0),
    p[0] + ' x' + p[1] + ': To-Be no_report_path ≤ As-Is');
});

console.log('# C-3 trace 실패 항적에 멈춘 단계 식별 가능');
(function () {
  var r = KJ.runDES({ scenario: KJ.scenarioById('sc3'), mode: 'asis', intensity: 2, seed: 21, endTimeSec: 1800, trace: true, traceCap: 300 });
  var failed = r.threatTraces.filter(function (tr) { return tr.outcome && tr.outcome.indexOf('leaked:') === 0; });
  assert(failed.length > 0, '실패 항적 trace 존재 (' + failed.length + '건)');
  assert(failed.every(function (tr) {
    return tr.stages[tr.stages.length - 1].name.indexOf('누수:') === 0;
  }), '실패 trace의 마지막 단계는 누수 마감(멈춘 단계 = 그 직전 단계로 식별 가능)');
  assert(failed.every(function (tr) {
    var reason = tr.outcome.slice(7);
    return KJ.leakTaxonomy(reason).group !== '기타';
  }), '실패 trace의 사유가 전부 taxonomy로 분류됨');
})();

// ══════════ Phase D — 지표 정리·추가 (MoM) ══════════
console.log('# D-1 비용 개념값 데이터 (WPN/THR-*-COST-01)');
assert(shooters.every(function (n) {
  return n.engage && n.engage.costPerShotM > 0 && typeof n.engage.costRef === 'string';
}), '전 무기 costPerShotM·costRef 보유 (개념 단가)');
assert(typeKeys.every(function (k) {
  var t = KJ.THREAT_TYPES[k];
  return t.unitCostM > 0 && typeof t.costRef === 'string';
}), '전 위협 unitCostM·costRef 보유 (개념 단가)');
assert(KJ.THREAT_TYPES.uav_small.unitCostM < KJ.THREAT_TYPES.fighter.unitCostM,
  '저가 포화위협(무인기) 단가 < 고가 위협(전투기) — 서열 정합');

console.log('# D-2 비용교환비(MoFE) 계산·결정론');
var dRun = runX('sc2', 'asis', 2, 42);
var dc = dRun.global.cost;
assert(dc.interceptM > 0 && dRun.global.engaged > 0, '교전 발생 시 요격탄 소모비용 > 0');
assert(dc.exchange !== null && Math.abs(dc.exchange - dc.interceptM / dc.killedThreatM) < 1e-9,
  'exchange = interceptM / killedThreatM (항등식)');
assert(dc.interceptSatM <= dc.interceptM && dc.killedThreatSatM <= dc.killedThreatM,
  '저가 포화위협 부분집합 ≤ 전체 (보존)');
var dRun2 = runX('sc2', 'asis', 2, 42);
assert(JSON.stringify(dRun.global.cost) === JSON.stringify(dRun2.global.cost),
  '비용 지표도 동일 seed → 완전 동일 (결정론)');
// 단일 seed exchangeSat는 RNG 스트림 이동(②라우팅 변경 등)에 민감하다(감사 발견 3).
// SC2 To-Be 비용교환비 개선은 seed 평균에서 견고하게 성립하므로 pooled로 검증한다.
function poolExchSat(mode) {
  var sum = 0, n = 0;
  for (var i = 1; i <= 20; i++) {
    var e = runX('sc2', mode, 2, i).global.cost.exchangeSat;
    if (e != null) { sum += e; n++; }
  }
  return sum / n;
}
var exchAsis = poolExchSat('asis'), exchTobe = poolExchSat('tobe');
assert(exchTobe < exchAsis,
  'SC2(무인기 포화): To-Be 비용교환비 < As-Is [pooled seed1~20] (' +
  exchTobe.toFixed(1) + ' < ' + exchAsis.toFixed(1) + ')');
// 극한값: 교전 0이면 비용 0·exchange null (NaN 없음)
var dEmpty = KJ.runDES({ scenario: { id: 'e', name: 'e', mix: [] }, mode: 'asis', intensity: 1, seed: 1, endTimeSec: 600 });
assert(dEmpty.global.cost.interceptM === 0 && dEmpty.global.cost.exchange === null,
  '위협 0: 비용 0·exchange null (0나눗셈 없음)');

console.log('# D-3 결심 지연·통신지연 대비 (MoP)');
var dA = runX('sc3', 'asis', 1.5, 42), dB = runX('sc3', 'tobe', 1.5, 42);
assert(typeof dA.global.meanDecisionDelaySec === 'number' && dA.global.meanDecisionDelaySec >= 0,
  'meanDecisionDelaySec 제공 (trace 무관)');
function commMean(res, kind) {
  var num = 0, den = 0;
  res.links.forEach(function (l) { if (kind && l.kind !== kind) return; num += l.delaySec * l.count; den += l.count; });
  return den ? num / den : 0;
}
// ②단계 지표는 report 링크만 집계한다(panels.js commMeanDelay(res,'report')와 동일 정본).
// coord/command 지연을 섞으면 ②가 아닌 링크(⑥⑦ 협조 180s·⑧ 교전명령)가 값을 지배한다(Phase 1 사실 e).
assert(commMean(dB, 'report') < commMean(dA, 'report'),
  'To-Be report 전달지연 < As-Is (' + commMean(dB, 'report').toFixed(1) + 's < ' + commMean(dA, 'report').toFixed(1) + 's — ②단계 report 링크만)');
// kind 필터가 실제로 작동함을 증명 — report만과 전 링크가 다르다(coord/command가 섞이면 값이 달라짐)
assert(commMean(dA, 'report') !== commMean(dA),
  'kind 필터 작동: report만(' + commMean(dA, 'report').toFixed(1) + 's) ≠ 전 링크(' + commMean(dA).toFixed(1) + 's) — coord/command 혼입 제거 확인');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
