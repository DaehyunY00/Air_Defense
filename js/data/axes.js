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

  KJ.AXES = {
    west: {
      label: '서부축(서해)',
      entry: [37.90, 125.30], entryNote: '백령도 인근 개념좌표(서해 북방)',
      target: [37.55, 126.98], targetNote: '서울 개념좌표(방호 표적권역)',
      launchZones: ['coastal', 'deep'], conceptReachKm: 150,
      reachNote: '서해 연안·종심 개념 발사권→수도권 표적 개념거리 (ENV-AXIS-FIT-01)'
    },
    central: {
      label: '중부축(DMZ)',
      entry: [38.25, 127.31], entryNote: '철원 인근 개념좌표(중부전선)',
      target: [37.15, 127.10], targetNote: '수도권 남부 개념좌표(오산·평택 권역)',
      launchZones: ['dmz', 'deep'], conceptReachKm: 130,
      reachNote: 'DMZ 인접·종심 개념 발사권→수도권 남부 표적 개념거리 (ENV-AXIS-FIT-01)'
    },
    east: {
      label: '동부축(DMZ~동해)',
      entry: [38.30, 128.40], entryNote: '고성 인근 개념좌표(동부전선)',
      target: [37.80, 128.90], targetNote: '강릉 인근 개념좌표(동해 함대 권역)',
      launchZones: ['dmz', 'deep'], conceptReachKm: 130,
      reachNote: 'DMZ 인접·종심 개념 발사권→동해 권역 표적 개념거리 (ENV-AXIS-FIT-01)'
    },
    seoul: {
      label: '수도권 직접침투',
      entry: [37.75, 126.90], entryNote: '고양 인근 개념좌표(2022.12.26 재현 진입점)',
      target: [37.56, 126.99], targetNote: '서울 도심 개념좌표',
      launchZones: ['dmz'], conceptReachKm: 60,
      reachNote: 'DMZ 인접 근거리 개념 발사권→서울 도심 개념거리 — 근거리 위협 전용 축선 (ENV-AXIS-FIT-01)'
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

  /** 위협 위치(t) 선형보간: entry→target, [0,1] 클램프 진행률 */
  KJ.axisPosition = function (axisKey, progress) {
    var a = KJ.AXES[axisKey];
    if (!a) return null;
    var p = Math.max(0, Math.min(1, progress));
    return [
      a.entry[0] + (a.target[0] - a.entry[0]) * p,
      a.entry[1] + (a.target[1] - a.entry[1]) * p
    ];
  };
})();
