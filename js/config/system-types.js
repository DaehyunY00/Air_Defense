/**
 * High-resolution IADS system type registry.
 *
 * Source values are adapted from the read-only IADS_codex_original registry.
 * They remain policy-research concepts, not operational performance data.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  function freeze(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.keys(o).forEach(function (k) { freeze(o[k]); });
    return Object.freeze(o);
  }

  var ALL_AXES = ['west', 'central', 'east', 'seoul'];
  var AIR = ['fighter', 'ac_low', 'heli', 'cruise'];
  var LOW = ['uav_small', 'ac_low', 'heli', 'cruise'];
  var BALLISTIC = ['srbm', 'mrl_large'];

  function sensor(name, opts) {
    return freeze({
      name: name,
      band: opts.band || 'conceptual',
      role: opts.role,
      reportingPeriod: opts.reportingPeriod,
      c2Report: opts.c2Report || null,
      ranges: opts.ranges,
      transitionTime: opts.transitionTime || { detectToTrack: 1, trackToFireControl: 1 },
      trackCapacity: opts.trackCapacity || 100,
      simultaneousEngagement: opts.simultaneousEngagement || 0,
      detectableThreats: opts.detectableThreats,
      minAltitude: opts.minAltitude || 0,
      rcsRef: opts.rcsRef || 1,
      antennaHeight: opts.antennaHeight || 10,
      jammingSusceptibility: opts.jammingSusceptibility || 0,
      azimuthHalf: opts.azimuthHalf || 180,
      elevationRange: opts.elevationRange || [-5, 90],
      rotation: opts.rotation || 0,
      defaultSectorPolicy: opts.defaultSectorPolicy || 'omni',
      detectionProbability: opts.detectionProbability,
      paramRef: opts.paramRef,
      paramClass: 'B',
      confidence: opts.confidence || 'C',
      sourceNote: opts.sourceNote,
      compatibilityAxes: opts.compatibilityAxes || ALL_AXES
    });
  }

  var SENSOR_TYPES = {
    GREEN_PINE_B: sensor('Green Pine Block-B', {
      role: 'ballistic_early_warning', reportingPeriod: 16, c2Report: 'KAMDOC',
      ranges: { detect: 900, track: 900, fireControl: null }, detectableThreats: BALLISTIC,
      detectionProbability: 0.95, paramRef: 'SEN-GPR-PD-01', confidence: 'B',
      sourceNote: 'IADS_codex_original weapon-data.js / deployment conceptual value'
    }),
    GREEN_PINE_C: sensor('Green Pine Block-C', {
      role: 'ballistic_early_warning', reportingPeriod: 16, c2Report: 'KAMDOC',
      ranges: { detect: 900, track: 900, fireControl: null }, detectableThreats: BALLISTIC,
      detectionProbability: 0.95, paramRef: 'SEN-GPR-PD-01', confidence: 'B',
      sourceNote: 'IADS_codex_original weapon-data.js / deployment conceptual value'
    }),
    FPS117: sensor('FPS-117 계열 장거리 감시레이더', {
      role: 'air_surveillance', reportingPeriod: 8, c2Report: 'MCRC',
      ranges: { detect: 470, track: 470, fireControl: null }, detectableThreats: AIR,
      detectionProbability: 0.90, paramRef: 'SEN-ACR-PD-01', confidence: 'B',
      sourceNote: 'IADS_codex_original FPS117 public/conceptual registry'
    }),
    TPS880K: sensor('TPS-880K 계열 국지방공레이더', {
      role: 'low_altitude_surveillance', reportingPeriod: 4, c2Report: 'MCRC',
      ranges: { detect: 40, track: 40, fireControl: null }, detectableThreats: LOW,
      detectionProbability: 0.60, paramRef: 'SEN-LLR-PD-01', confidence: 'B',
      sourceNote: 'IADS_codex_original TPS880K public/conceptual registry'
    }),
    LSAM_MFR: sensor('L-SAM 포대 전속 MFR', {
      role: 'battery_fire_control', reportingPeriod: 1,
      ranges: { detect: 310, track: 310, fireControl: 150 }, detectableThreats: BALLISTIC,
      detectionProbability: 0.95, paramRef: 'WPN-LSAM-RADAR-01', confidence: 'C',
      sourceNote: 'IADS_codex_original battery-owned MFR conceptual value'
    }),
    MSAM_MFR: sensor('천궁-II 포대 전속 MFR', {
      role: 'battery_fire_control', reportingPeriod: 1,
      ranges: { detect: 100, track: 100, fireControl: 40 }, detectableThreats: AIR.concat(BALLISTIC),
      detectionProbability: 0.85, paramRef: 'WPN-MSAM2-RADAR-01', confidence: 'C',
      sourceNote: 'IADS_codex_original battery-owned MFR conceptual value'
    }),
    PATRIOT_RADAR: sensor('Patriot 포대 전속 레이더', {
      role: 'battery_fire_control', reportingPeriod: 1,
      ranges: { detect: 180, track: 180, fireControl: 40 }, detectableThreats: AIR.concat(BALLISTIC),
      detectionProbability: 0.90, paramRef: 'WPN-PATRIOT-RADAR-01', confidence: 'C',
      sourceNote: 'IADS_codex_original Patriot radar conceptual value'
    }),
    AN_TPY2: sensor('AN/TPY-2 계열 센서', {
      role: 'usfk_ballistic_fire_control', reportingPeriod: 1, c2Report: 'USFK_THAAD_C2',
      ranges: { detect: 600, track: 600, fireControl: 200 }, detectableThreats: BALLISTIC,
      detectionProbability: 0.95, paramRef: 'WPN-THAAD-RADAR-01', confidence: 'B',
      sourceNote: 'IADS_codex_original ADR-036 USFK independent-axis conceptual value'
    })
  };

  function missile(name, envelope, speed, rounds, pkRef, cost, defaultPk) {
    return freeze({
      name: name,
      engagementEnvelope: envelope,
      missileSpeed: speed,
      fuelTime: null,
      launchInterval: 1,
      doctrine: 'shoot-look-shoot',
      interceptMethod: 'conceptual',
      // 상세 range/aspect 표가 이식되기 전까지 체계 정본 compatibility Pk를 사용한다.
      // 종전 공통 0.75는 비호·천마(정본 0.30)까지 고성능으로 만들어 반복 재교전 시
      // UAV 최종 격추확률을 사실상 100%로 올리는 결함이었다.
      pssekTable: { default: typeof defaultPk === 'number' ? defaultPk : 0.75 },
      bdaDelay: 5,
      costPerShot: cost,
      roundsPerLauncher: rounds,
      paramRef: pkRef,
      paramClass: 'B',
      confidence: 'C',
      sourceNote: 'IADS_codex_original type registry; native high-resolution conceptual pipeline'
    });
  }

  function shooter(name, priority, engageable, missileDef, battery, compat) {
    return freeze({
      name: name,
      priority: priority,
      engageableThreats: engageable,
      missiles: missileDef,
      battery: battery,
      integratedSensor: compat.integratedSensor || null,
      paramRef: compat.paramRef,
      paramClass: 'B',
      confidence: compat.confidence || 'C',
      sourceNote: compat.sourceNote,
      compatibility: {
        engageTimeSec: compat.engageTimeSec,
        pk: compat.pk,
        costPerShotM: compat.costPerShotM,
        wtaSuit: compat.wtaSuit,
        simulationEligible: compat.simulationEligible !== false
      }
    });
  }

  var SUIT_BALLISTIC = { low: 0, medium: 0, ballistic: 1.3, paramRef: 'C2-WTA-SUIT-01' };
  var SUIT_MULTI = { low: 0.7, medium: 0.9, ballistic: 1.2, paramRef: 'C2-WTA-SUIT-01' };
  var SUIT_SHORAD = { low: 1.3, medium: 0.5, ballistic: 0, paramRef: 'C2-WTA-SUIT-01' };
  var SHOOTER_TYPES = {
    LSAM: shooter('L-SAM', 1, BALLISTIC, {
      ABM: missile('L-SAM ABM', { Rmin: 5, Rmax: 150, Hmin: 15, Hmax: 70 }, 1500, 6, 'WPN-LSAM-PK-01', 8, 0.75)
    }, { launcherCount: 4, simultaneousEngagement: 10, reloadTime: 900 }, {
      paramRef: 'WPN-LSAM-PK-01', sourceNote: 'IADS_codex_original LSAM', engageTimeSec: 40,
      pk: 0.75, costPerShotM: 8, wtaSuit: SUIT_BALLISTIC
    }),
    CHEONGUNG2: shooter('천궁-II', 2, AIR.concat(BALLISTIC), {
      AAM: missile('천궁-II', { Rmin: 1, Rmax: 40, Hmin: 0, Hmax: 20 }, 1200, 8, 'WPN-MSAM2-PK-01', 3, 0.75)
    }, { launcherCount: 4, simultaneousEngagement: 10, reloadTime: 900 }, {
      paramRef: 'WPN-MSAM2-PK-01', sourceNote: 'IADS_codex_original CHEONGUNG2', engageTimeSec: 45,
      pk: 0.75, costPerShotM: 3, wtaSuit: SUIT_MULTI
    }),
    PAC3: shooter('한국군 PAC-3', 2, AIR.concat(BALLISTIC), {
      ABM: missile('PAC-3', { Rmin: 1, Rmax: 40, Hmin: 0, Hmax: 30 }, 1400, 16, 'WPN-PAC3-PK-01', 3, 0.75)
    }, { launcherCount: 4, simultaneousEngagement: 9, reloadTime: 900 }, {
      paramRef: 'WPN-PAC3-PK-01', sourceNote: 'IADS_codex_original PAC3', engageTimeSec: 45,
      pk: 0.75, costPerShotM: 3, wtaSuit: SUIT_MULTI
    }),
    BIHO: shooter('비호 중대', 4, LOW, {
      AAM: missile('비호 탑재탄', { Rmin: 0, Rmax: 7, Hmin: 0, Hmax: 5 }, 700, 4, 'WPN-SHORAD-PK-01', 0.2, 0.30)
    }, { launcherCount: 6, simultaneousEngagement: 24, reloadTime: 900 }, {
      integratedSensor: 'BIHO_INTEGRATED', paramRef: 'ADR-049', sourceNote: 'ADR-049 company/vehicle aggregation',
      engageTimeSec: 60, pk: 0.3, costPerShotM: 0.2, wtaSuit: SUIT_SHORAD
    }),
    CHUNMA: shooter('천마 중대', 4, LOW, {
      AAM: missile('천마 탑재탄', { Rmin: 0, Rmax: 9, Hmin: 0, Hmax: 5 }, 700, 8, 'WPN-SHORAD-PK-01', 0.2, 0.30)
    }, { launcherCount: 6, simultaneousEngagement: 48, reloadTime: 900 }, {
      integratedSensor: 'CHUNMA_INTEGRATED', paramRef: 'ADR-049', sourceNote: 'ADR-049 company/vehicle aggregation',
      engageTimeSec: 60, pk: 0.3, costPerShotM: 0.2, wtaSuit: SUIT_SHORAD
    }),
    THAAD: shooter('USFK THAAD', 1, BALLISTIC, {
      ABM: missile('THAAD interceptor', { Rmin: 5, Rmax: 200, Hmin: 40, Hmax: 150 }, 2800, 8, 'WPN-THAAD-PK-01', 8, 0.75)
    }, { launcherCount: 6, simultaneousEngagement: 6, reloadTime: 900 }, {
      paramRef: 'ADR-036', sourceNote: 'USFK THAAD independent axis; not KAMDOC integrated', engageTimeSec: 40,
      pk: 0.75, costPerShotM: 8, wtaSuit: SUIT_BALLISTIC, simulationEligible: false
    }),
    USFK_PAC3: shooter('USFK Patriot', 2, AIR.concat(BALLISTIC), {
      ABM: missile('USFK PAC-3', { Rmin: 1, Rmax: 40, Hmin: 0, Hmax: 30 }, 1400, 16, 'WPN-PAC3-PK-01', 3, 0.75)
    }, { launcherCount: 4, simultaneousEngagement: 9, reloadTime: 900 }, {
      paramRef: 'ADR-036', sourceNote: 'USFK Patriot independent axis; not Korean C2 integrated', engageTimeSec: 45,
      pk: 0.75, costPerShotM: 3, wtaSuit: SUIT_MULTI, simulationEligible: false
    })
  };

  function c2(name, tier, capacity, processing, scope, opts) {
    opts = opts || {};
    return freeze({
      name: name, tier: tier, simultaneousCapacity: capacity,
      processing: processing, commandScope: scope,
      reportingPeriod: opts.reportingPeriod || 1,
      paramRef: opts.paramRef || 'IADS-C2-COMPAT-01',
      paramClass: opts.paramClass || 'C', confidence: opts.confidence || 'C',
      integrated: opts.integrated !== false,
      sourceNote: opts.sourceNote || 'IADS_codex_original C2 type adapted for M/M/c/K compatibility'
    });
  }
  var C2_TYPES = {
    KAMD_OPS: c2('KAMD 작전통제소', 'command', 3, { system: [5, 10], operator: { high: 15, mid: 30, low: 50 } }, 'ballistic_global'),
    MCRC: c2('중앙방공통제소', 'command', 8, { system: [5, 10], operator: { high: 15, mid: 30, low: 50 } }, 'air_global'),
    ICC: c2('대대급 정보통합센터', 'battalion', 5, { system: [3, 5], operator: { high: 2, mid: 5, low: 10 } }, 'brigade'),
    ECS: c2('교전통제소', 'battery', 8, { system: [1, 2], operator: { high: 1, mid: 2, low: 3 } }, 'battery'),
    IAOC: c2('통합공중작전통제소', 'killweb_central', 20, { system: [1, 2], operator: { high: 0.5, mid: 1, low: 1.5 } }, 'global'),
    EOC: c2('교전운영센터', 'killweb_engagement', 10, { system: [0.5, 1], operator: { high: 0.5, mid: 1, low: 2 } }, 'global'),
    ARMY_LOCAL_AD: c2('육군·해병 국지방공', 'local_ad', 8, { system: [1, 2], operator: { high: 1, mid: 2, low: 3 } }, 'local', { integrated: false }),
    USFK_THAAD_C2: c2('USFK THAAD C2', 'usfk_independent', 6, { system: [1, 2], operator: { high: 1, mid: 2, low: 3 } }, 'usfk_thaad', { integrated: false }),
    USFK_PATRIOT_C2: c2('USFK Patriot C2', 'usfk_independent', 12, { system: [1, 2], operator: { high: 1, mid: 2, low: 3 } }, 'usfk_patriot', { integrated: false })
  };

  KJ.SENSOR_TYPES = freeze(SENSOR_TYPES);
  KJ.SHOOTER_TYPES = freeze(SHOOTER_TYPES);
  KJ.C2_TYPES = freeze(C2_TYPES);
  KJ.SYSTEM_TYPES = freeze({ sensor: KJ.SENSOR_TYPES, shooter: KJ.SHOOTER_TYPES, c2: KJ.C2_TYPES });
  KJ.systemType = function (category, id) {
    var group = KJ.SYSTEM_TYPES[category];
    return group ? group[id] || null : null;
  };
})();
