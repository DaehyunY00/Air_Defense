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
    },
    // ── ADR-064: 남부 종심 축선 2종 ──
    // 종전 4개 축선의 표적은 서울·오산평택·강릉 3권역뿐이라, 남부 배치 자산(대구·부산·울산·
    // 포항·광주 등 14문)은 어떤 seed에서도 교전 기회가 없었다. 종심 발사권에서 남부 산업·항만
    // 권역을 노리는 축선을 추가한다. 사거리 정합(ENV-AXIS-FIT-01)상 **장거리 위협만** 배정
    // 가능하다(무인기·헬기는 개념 최대사거리 미달 — checkAxisThreatFit가 거부).
    southcentral: {
      label: '남부중앙축(대구·구미)',
      entry: [38.42, 127.30], entryNote: '평강 인근 개념좌표(북측 중부 종심 발사권 — central과 동일 발사권)',
      target: [35.87, 128.60], targetNote: '대구 개념좌표(남부 내륙 산업·군수 권역)',
      launchZones: ['deep'], conceptReachKm: 306,
      reachNote: '북측 중부 종심 개념 발사권→남부 내륙 표적 개념거리 (ENV-AXIS-FIT-01, ADR-064)'
    },
    southeast: {
      label: '남동축(부산·울산)',
      entry: [38.42, 127.30], entryNote: '평강 인근 개념좌표(북측 중부 종심 발사권)',
      target: [35.18, 129.08], targetNote: '부산 개념좌표(항만·병참 권역)',
      launchZones: ['deep'], conceptReachKm: 400,
      reachNote: '북측 중부 종심 개념 발사권→남동 항만 표적 개념거리 (ENV-AXIS-FIT-01, ADR-064)'
    }
  };

  // ADR-064: 남부 축선 키 — 시나리오 mix 배정·회귀 검증이 이 목록을 정본으로 쓴다.
  KJ.SOUTHERN_AXIS_KEYS = Object.freeze(['southcentral', 'southeast']);

  /**
   * ADR-064: 축선 거리에 비례한 체공시간(dwell) 환산.
   * 위협 위치는 lerp(entry, target, (t−spawnT)/dwellSec)이므로 **거리와 무관하게 dwellSec을
   * 그대로 쓰면 먼 축선일수록 함의 속도가 비례해 빨라진다**(예: 순항미사일 120초에 400km =
   * 3.3km/s — 자기 baseSpeed 272m/s의 12배). 남부 축선은 기존 중부축(140km)을 기준으로
   * 거리에 비례해 체공시간을 늘려, 모델이 이미 쓰던 함의 속도를 그대로 유지한다.
   * 새 속도 값을 만들지 않는다 — 기준거리만 정의한다(THREAT-AXIS-DWELL-SCALE-01, 등급 C).
   */
  KJ.AXIS_DWELL_REFERENCE_KM = 140;
  KJ.axisDwellSec = function (axisKey, baseDwellSec) {
    var a = KJ.AXES[axisKey];
    if (!a || !a.conceptReachKm || !KJ.AXIS_DWELL_REFERENCE_KM) return baseDwellSec;
    if (KJ.SOUTHERN_AXIS_KEYS.indexOf(axisKey) === -1) return baseDwellSec; // 기존 축선 불변
    return baseDwellSec * (a.conceptReachKm / KJ.AXIS_DWELL_REFERENCE_KM);
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
  // ADR-071: 자위권 반경 — IADS_codex ADR-050 `SELF_DEFENSE_RADIUS_KM = 10`
  // ("조정 가능한 교리 상수"). 낙하 예측점이 포대 이 반경 안이면 자위권 발동 대상.
  KJ.SELF_DEFENSE_RADIUS_KM = 10;
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
