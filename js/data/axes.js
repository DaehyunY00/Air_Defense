/**
 * K-JAMDS 시뮬레이터 — 축선별 개념 궤적 좌표 (Phase 4)
 *
 * 시나리오의 위협은 'west'|'central'|'east'|'seoul' 축선만 가지고 있어 정확한 좌표가 없다.
 * Phase 4 위협궤적 애니메이션·히트맵을 위해, 각 축선에 진입점(entry)→표적권역(target)
 * 개념 좌표를 부여한다. 실제 침투경로·표적이 아닌 시각화용 개념 근사이며, 다른 모든 좌표와
 * 동일하게 도시 수준 개념좌표다(디스클레이머 동일 적용).
 *
 * 위치(t) = lerp(entry, target, clamp((t - spawnT) / dwellSec, 0, 1))
 *
 * ── 발사권역·사거리 정합(정밀화 Phase A, ENV-AXIS-FIT-01) ──
 * 각 축선에 이 축선을 경유할 수 있는 개념 발사권역 태그(launchZones)와, 개념
 * 발사원점→표적권역 거리(conceptReachKm)를 부여한다. threats.js의 위협별
 * originZones(허용 발사권역)·rangeBandKm(개념 사거리대)와 대조해,
 *  (1) 권역 정합: 위협의 originZones ∩ 축선의 launchZones ≠ ∅
 *      (예: 근거리 무인기가 지나치게 종심('deep')에서 출발하지 않도록 —
 *       'seoul' 축선은 'dmz' 전용이라 종심 전용 위협의 배분이 거부됨)
 *  (2) 사거리 정합: 위협 rangeBandKm.max ≥ 축선 conceptReachKm
 *      (min은 저각·단축발사 가능성 때문에 검증에 쓰지 않음 — threats.js 주석)
 * 을 KJ.checkAxisThreatFit / KJ.validateScenarioOrigins 가 검증한다.
 * entry 좌표·권역·거리는 전부 개념값이며 실제 침투경로·발사원점이 아니다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  /** 개념 발사권역 태그 정의 (실제 배치·발사원점 아님) */
  KJ.ORIGIN_ZONES = {
    dmz: 'DMZ 인접 근거리 발사권역(개념)',
    coastal: '서해·연안 발사권역(개념)',
    deep: '종심 발사권역(개념)'
  };

  // 진입점(entry)은 북측 발사권역의 도시 수준 개념좌표 — 지도에서 위협이 북한 지역에서
  // 출발하는 것으로 보이도록 한다. 실제 발사원점·배치가 아닌 개념 표시이며, targetNote와
  // 함께 전 좌표에 '개념' 표기를 유지한다(제약 어서션 d).
  KJ.AXES = {
    west: {
      label: '서부축(서해)',
      entry: [38.04, 125.70], entryNote: '해주 인근 개념좌표(북측 서해안 발사권)',
      target: [37.55, 126.98], targetNote: '서울 개념좌표(방호 표적권역)',
      launchZones: ['coastal', 'deep'], conceptReachKm: 150,
      reachNote: '북측 서해안·종심 개념 발사권→수도권 표적 개념거리 (ENV-AXIS-FIT-01)'
    },
    central: {
      label: '중부축(DMZ)',
      entry: [38.42, 127.30], entryNote: '평강 인근 개념좌표(북측 중부 종심 발사권)',
      target: [37.15, 127.10], targetNote: '수도권 남부 개념좌표(오산·평택 권역)',
      launchZones: ['dmz', 'deep'], conceptReachKm: 140,
      reachNote: '북측 중부 종심 개념 발사권→수도권 남부 표적 개념거리 (ENV-AXIS-FIT-01)'
    },
    east: {
      label: '동부축(동해안)',
      entry: [39.16, 127.44], entryNote: '원산 인근 개념좌표(북측 동해안 발사권)',
      target: [37.80, 128.90], targetNote: '강릉 인근 개념좌표(동해 함대 권역)',
      launchZones: ['dmz', 'deep'], conceptReachKm: 200,
      reachNote: '북측 동해안 개념 발사권→동해 권역 표적 개념거리 (ENV-AXIS-FIT-01)'
    },
    seoul: {
      label: '수도권 직접침투',
      entry: [37.96, 126.55], entryNote: '개성 인근 개념좌표(2022.12.26 침투경로 북측 재현 진입점)',
      target: [37.56, 126.99], targetNote: '서울 도심 개념좌표',
      launchZones: ['dmz'], conceptReachKm: 70,
      reachNote: '북측 DMZ 인접 근거리 개념 발사권→서울 도심 개념거리 — 근거리 위협 전용 축선 (ENV-AXIS-FIT-01)'
    }
  };

  /**
   * 위협 유형 × 축선의 발사권역·사거리 정합성 검증 (ENV-AXIS-FIT-01).
   * @returns { ok:boolean, reasons:string[] } — ok=false면 reasons에 모순 사유
   */
  KJ.checkAxisThreatFit = function (typeKey, axisKey) {
    var tt = KJ.threatType(typeKey), ax = KJ.AXES[axisKey];
    var reasons = [];
    if (!tt || !ax) return { ok: false, reasons: ['알 수 없는 위협/축선: ' + typeKey + '@' + axisKey] };
    var zones = tt.originZones || [];
    var zoneOk = (ax.launchZones || []).some(function (z) { return zones.indexOf(z) !== -1; });
    if (!zoneOk) {
      reasons.push(tt.name + '의 발사권역(' + zones.join(',') + ')이 ' + ax.label +
        ' 축선의 발사권역(' + (ax.launchZones || []).join(',') + ')과 불일치');
    }
    if (tt.rangeBandKm && ax.conceptReachKm && tt.rangeBandKm.max < ax.conceptReachKm) {
      reasons.push(tt.name + '의 개념 최대사거리 ' + tt.rangeBandKm.max + 'km < 축선 개념거리 ' +
        ax.conceptReachKm + 'km');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  };

  /** 시나리오 mix 전체의 축선-사거리 정합 위반 목록 (회귀 어서션·데이터 탭 표출용) */
  KJ.validateScenarioOrigins = function (scenario) {
    var violations = [];
    (scenario.mix || []).forEach(function (entry) {
      var fit = KJ.checkAxisThreatFit(entry.type, entry.axis);
      if (!fit.ok) violations.push({ type: entry.type, axis: entry.axis, reasons: fit.reasons });
    });
    return violations;
  };

  /** 위협 위치(t) 선형보간: entry→target, [0,1] 클램프 진행률.
   * target을 넘기면 축선 표적점 대신 그 좌표를 종점으로 쓴다(ADR-063 표적 산포).
   * 생략하면 종전과 동일하게 축선의 고정 표적점을 쓴다(하위호환·OFF bit-exact). */
  KJ.axisPosition = function (axisKey, progress, target) {
    var a = KJ.AXES[axisKey];
    if (!a) return null;
    var tgt = (target && target.length === 2) ? target : a.target;
    var p = Math.max(0, Math.min(1, progress));
    return [
      a.entry[0] + (tgt[0] - a.entry[0]) * p,
      a.entry[1] + (tgt[1] - a.entry[1]) * p
    ];
  };

  // ── ADR-063: 표적권역 산포 ──
  // 종전에는 같은 축선의 모든 위협이 **정확히 같은 한 점**으로 향해, seed를 바꿔도 착탄점이
  // 변하지 않고 표적권역 주변 자산만 반복 교전했다. 표적을 권역(disk) 안에서 뽑아 위협마다
  // 다른 착탄점을 갖게 한다. 반경은 THREAT-TARGET-DISP-01(개념 설정·등급 C, docs/params.md).
  KJ.THREAT_TARGET_SPREAD_KM = 15;

  /**
   * 표적권역 내 균등(면적 기준) 착탄점. u1·u2는 [0,1) 난수 2개 — 호출자가 스트림을 소유한다.
   * r = R√u1 이 균등 면적 분포이며(단순 R·u1은 중심 편향), θ = 2π·u2.
   * @returns [lat, lon] — 산포 반경이 0 이하이면 축선 표적점 그대로
   */
  KJ.axisImpactPoint = function (axisKey, u1, u2, spreadKm) {
    var a = KJ.AXES[axisKey];
    if (!a) return null;
    var R = (typeof spreadKm === 'number' && spreadKm >= 0) ? spreadKm : KJ.THREAT_TARGET_SPREAD_KM;
    if (!R) return [a.target[0], a.target[1]];
    var r = R * Math.sqrt(Math.max(0, Math.min(1, u1)));
    var th = 2 * Math.PI * Math.max(0, Math.min(1, u2));
    var dLatKm = r * Math.cos(th), dLonKm = r * Math.sin(th);
    var lat = a.target[0] + dLatKm / 110.574;
    var lon = a.target[1] + dLonKm / (111.320 * Math.cos(a.target[0] * Math.PI / 180));
    return [lat, lon];
  };
})();
