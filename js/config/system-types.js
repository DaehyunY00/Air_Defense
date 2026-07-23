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
      compatibilityRanges: opts.compatibilityRanges || opts.ranges,
      transitionTime: opts.transitionTime || { detectToTrack: 1, trackToFireControl: 1 },
      trackCapacity: opts.trackCapacity || 100,
      simultaneousEngagement: opts.simultaneousEngagement || 0,
      detectableThreats: opts.detectableThreats,
      minAltitude: opts.minAltitude == null ? 0 : opts.minAltitude,
      rcsRef: opts.rcsRef == null ? 1 : opts.rcsRef,
      antennaHeight: opts.antennaHeight == null ? 10 : opts.antennaHeight,
      jammingSusceptibility: opts.jammingSusceptibility == null ? 0 : opts.jammingSusceptibility,
      azimuthHalf: opts.azimuthHalf == null ? 180 : opts.azimuthHalf,
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
      band: 'L', role: 'ballistic_early_warning', reportingPeriod: 16, c2Report: 'KAMDOC',
      ranges: { detect: 900, track: 600, fireControl: 500 },
      compatibilityRanges: { detect: 900, track: 900, fireControl: null },
      transitionTime: { detectToTrack: 10, trackToFireControl: 12 },
      trackCapacity: 30, detectableThreats: BALLISTIC,
      minAltitude: 5000, rcsRef: .1, antennaHeight: 10, jammingSusceptibility: .3,
      detectionProbability: 0.95, paramRef: 'SEN-GPR-PD-01', confidence: 'B',
      sourceNote: 'IADS_C2 weapon-data.js GREEN_PINE_B (2026-07-23 parameter parity)'
    }),
    GREEN_PINE_C: sensor('Green Pine Block-C', {
      band: 'L', role: 'ballistic_early_warning', reportingPeriod: 16, c2Report: 'KAMDOC',
      ranges: { detect: 900, track: 600, fireControl: null },
      compatibilityRanges: { detect: 900, track: 900, fireControl: null },
      transitionTime: { detectToTrack: 10 }, trackCapacity: 30, detectableThreats: BALLISTIC,
      minAltitude: 5000, rcsRef: .1, antennaHeight: 10, jammingSusceptibility: .3,
      detectionProbability: 0.95, paramRef: 'SEN-GPR-PD-01', confidence: 'B',
      sourceNote: 'IADS_C2 weapon-data.js GREEN_PINE_C (2026-07-23 parameter parity)'
    }),
    FPS117: sensor('FPS-117 계열 장거리 감시레이더', {
      band: 'L', role: 'air_surveillance', reportingPeriod: 8, c2Report: 'MCRC',
      ranges: { detect: 470, track: 350, fireControl: null },
      compatibilityRanges: { detect: 470, track: 470, fireControl: null },
      transitionTime: { detectToTrack: 15 }, trackCapacity: 100,
      detectableThreats: AIR.concat(['mrl_large']),
      minAltitude: 1000, rcsRef: 1, antennaHeight: 10, jammingSusceptibility: .3,
      detectionProbability: 0.90, paramRef: 'SEN-ACR-PD-01', confidence: 'B',
      sourceNote: 'IADS_C2 weapon-data.js FPS117 (2026-07-23 parameter parity)'
    }),
    TPS880K: sensor('TPS-880K 계열 국지방공레이더', {
      band: 'X', role: 'low_altitude_surveillance', reportingPeriod: 4, c2Report: 'MCRC',
      ranges: { detect: 40, track: 30, fireControl: null },
      compatibilityRanges: { detect: 40, track: 40, fireControl: null },
      transitionTime: { detectToTrack: 5 }, trackCapacity: 30,
      detectableThreats: AIR.concat(['uav_small', 'mrl_large']),
      minAltitude: 50, rcsRef: .03, antennaHeight: 5, jammingSusceptibility: .7,
      elevationRange: [-3, 90],
      detectionProbability: 0.60, paramRef: 'SEN-LLR-PD-01', confidence: 'B',
      sourceNote: 'IADS_C2 weapon-data.js TPS880K (2026-07-23 parameter parity)'
    }),
    LSAM_MFR: sensor('L-SAM 포대 전속 MFR', {
      band: 'S', role: 'battery_fire_control', reportingPeriod: 1,
      ranges: {
        detect: { ballistic: 310, aircraft: 400 },
        track: { ballistic: 250, aircraft: 300 },
        fireControl: { ballistic: 200, aircraft: 250 }
      },
      compatibilityRanges: { detect: 310, track: 310, fireControl: 150 },
      transitionTime: { detectToTrack: 5, trackToFireControl: 8 },
      trackCapacity: { aircraft: 100, ballistic: 10 },
      simultaneousEngagement: { aircraft: 20, ballistic: 10 },
      detectableThreats: AIR.concat(BALLISTIC, ['uav_small']),
      minAltitude: 50, rcsRef: 1, antennaHeight: 8, jammingSusceptibility: .5,
      elevationRange: [-3, 90],
      detectionProbability: 0.95, paramRef: 'WPN-LSAM-RADAR-01', confidence: 'C',
      sourceNote: 'IADS_C2 weapon-data.js LSAM_MFR (2026-07-23 parameter parity)'
    }),
    MSAM_MFR: sensor('천궁-II 포대 전속 MFR', {
      band: 'X', role: 'battery_fire_control', reportingPeriod: 1,
      ranges: {
        detect: { ballistic: 100, aircraft: 100 },
        track: { ballistic: 80, aircraft: 80 },
        fireControl: { ballistic: 60, aircraft: 60 }
      },
      compatibilityRanges: { detect: 100, track: 100, fireControl: 40 },
      transitionTime: { detectToTrack: 5, trackToFireControl: 3 },
      trackCapacity: { ballistic: 5, aircraft: 10 },
      simultaneousEngagement: { ballistic: 5, aircraft: 10 },
      detectableThreats: AIR.concat(BALLISTIC, ['uav_small']),
      minAltitude: 30, rcsRef: 1, antennaHeight: 6, jammingSusceptibility: .7,
      elevationRange: [-3, 85],
      detectionProbability: 0.85, paramRef: 'WPN-MSAM2-RADAR-01', confidence: 'C',
      sourceNote: 'IADS_C2 weapon-data.js MSAM_MFR (2026-07-23 parameter parity)'
    }),
    PATRIOT_RADAR: sensor('Patriot 포대 전속 레이더', {
      band: 'C', role: 'battery_fire_control', reportingPeriod: 1,
      ranges: {
        detect: { ballistic: 180, aircraft: 180 },
        track: { ballistic: 150, aircraft: 150 },
        fireControl: { ballistic: 100, aircraft: 100 }
      },
      compatibilityRanges: { detect: 180, track: 180, fireControl: 40 },
      transitionTime: { detectToTrack: 6, trackToFireControl: 4 },
      trackCapacity: { ballistic: 9, aircraft: 9 },
      simultaneousEngagement: { ballistic: 9, aircraft: 9 },
      detectableThreats: AIR.concat(BALLISTIC),
      minAltitude: 50, rcsRef: 1, antennaHeight: 5, jammingSusceptibility: .5,
      azimuthHalf: 45, elevationRange: [-3, 83], rotation: 'none',
      detectionProbability: 0.90, paramRef: 'WPN-PATRIOT-RADAR-01', confidence: 'C',
      sourceNote: 'IADS_C2 weapon-data.js PATRIOT_RADAR (2026-07-23 parameter parity)'
    }),
    AN_TPY2: sensor('AN/TPY-2 계열 센서', {
      band: 'X', role: 'usfk_ballistic_fire_control', reportingPeriod: 1, c2Report: 'USFK_THAAD_C2',
      ranges: { detect: 600, track: 500, fireControl: 400 },
      compatibilityRanges: { detect: 600, track: 600, fireControl: 200 },
      transitionTime: { detectToTrack: 5, trackToFireControl: 10 }, trackCapacity: 100,
      detectableThreats: ['srbm'],
      minAltitude: 10000, rcsRef: 1, antennaHeight: 9, jammingSusceptibility: .7,
      azimuthHalf: 90,
      detectionProbability: 0.95, paramRef: 'WPN-THAAD-RADAR-01', confidence: 'B',
      sourceNote: 'IADS_C2 weapon-data.js AN_TPY2 (2026-07-23 parameter parity)'
    })
  };

  function missile(name, envelope, speed, rounds, pkRef, cost, defaultPk, pssekTable, fuelTime, compatibility, physics) {
    physics = physics || {};
    return freeze({
      name: name,
      engagementEnvelope: envelope,
      missileSpeed: speed,
      fuelTime: fuelTime || null,
      launchInterval: physics.launchInterval == null ? 1 : physics.launchInterval,
      doctrine: physics.doctrine || 'SLS',
      interceptMethod: physics.interceptMethod || 'conceptual',
      guidance: physics.guidance || null,
      killRadius: physics.killRadius == null ? null : physics.killRadius,
      // 상세 range/aspect 표가 이식되기 전까지 체계 정본 compatibility Pk를 사용한다.
      // 종전 공통 0.75는 비호·천마(정본 0.30)까지 고성능으로 만들어 반복 재교전 시
      // UAV 최종 격추확률을 사실상 100%로 올리는 결함이었다.
      pssekTable: Object.assign({ default: typeof defaultPk === 'number' ? defaultPk : 0.75 }, pssekTable || {}),
      bdaDelay: physics.bdaDelay == null ? 5 : physics.bdaDelay,
      costPerShot: cost,
      roundsPerLauncher: rounds,
      paramRef: pkRef,
      paramClass: 'B',
      confidence: 'C',
      sourceNote: 'IADS_C2 weapon-data.js; 2026-07-23 physical/probability parameter parity',
      compatibility: compatibility || { enabled: true, engagementEnvelope: envelope, missileSpeed: speed }
    });
  }

  function shooter(name, priority, engageable, missileDef, battery, compat, iadsEngageable) {
    return freeze({
      name: name,
      priority: priority,
      engageableThreats: engageable,
      iadsEngageableThreats: iadsEngageable || engageable,
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
      ABM: missile('L-SAM ABM', { Rmin: 20, Rmax: 150, Hmin: 40, Hmax: 60 }, 3100, 6, 'WPN-LSAM-PK-01', 8, 0.75, {
        SRBM: { front: { '20-60': .90, '60-100': .85, '100-150': .70 }, side: { '20-60': .75, '60-100': .65, '100-150': .50 }, rear: { '20-60': .60, '60-100': .50, '100-150': .35 } },
        MLRS_GUIDED: { front: { '20-60': .94, '60-100': .90, '100-150': .82 }, side: { '20-60': .92, '60-100': .88, '100-150': .80 }, rear: { '20-60': .90, '60-100': .86, '100-150': .78 } }
      }, 60, { enabled: true, engagementEnvelope: { Rmin: 5, Rmax: 150, Hmin: 15, Hmax: 70 }, missileSpeed: 1500 },
      { doctrine: 'SLS', interceptMethod: 'hit-to-kill', guidance: 'PNG', killRadius: 50, bdaDelay: 8, launchInterval: 5 }),
      AAM: missile('L-SAM AAM', { Rmin: 10, Rmax: 150, Hmin: .05, Hmax: 25 }, 1700, 6, 'WPN-LSAM-PK-01', 8, .75, {
        AIRCRAFT: { front: { '10-50': .92, '50-100': .88, '100-150': .75 }, side: { '10-50': .92, '50-100': .88, '100-150': .75 }, rear: { '10-50': .92, '50-100': .88, '100-150': .75 } },
        CRUISE_MISSILE: { front: { '10-50': 1, '50-100': 1, '100-150': 1 }, side: { '10-50': 1, '50-100': 1, '100-150': 1 }, rear: { '10-50': 1, '50-100': 1, '100-150': 1 } },
        MLRS_GUIDED: { front: { '10-50': .91, '50-100': .87, '100-150': .80 }, side: { '10-50': .90, '50-100': .86, '100-150': .79 }, rear: { '10-50': .89, '50-100': .85, '100-150': .78 } },
        UAS: { front: { '10-50': 1, '50-100': 1, '100-150': 1 }, side: { '10-50': 1, '50-100': 1, '100-150': 1 }, rear: { '10-50': 1, '50-100': 1, '100-150': 1 } }
      }, 98, { enabled: false },
      { doctrine: 'SLS', interceptMethod: 'guided', guidance: 'PNG', killRadius: 500, bdaDelay: 10, launchInterval: 5 })
    }, { launcherCount: 4, simultaneousEngagement: 10, reloadTime: 900 }, {
      paramRef: 'WPN-LSAM-PK-01', sourceNote: 'IADS_codex_original LSAM', engageTimeSec: 40,
      pk: 0.75, costPerShotM: 8, wtaSuit: SUIT_BALLISTIC
    }, AIR.concat(BALLISTIC, ['uav_small'])),
    CHEONGUNG2: shooter('천궁-II', 2, AIR.concat(BALLISTIC), {
      ABM: missile('천궁-II ABM', { Rmin: 3, Rmax: 50, Hmin: .5, Hmax: 20 }, 2040, 8, 'WPN-MSAM2-PK-01', 3, .75, {
        SRBM: { front: { '5-15': .85, '15-30': .78, '30-50': .55 }, side: { '5-15': .765, '15-30': .702, '30-50': .495 }, rear: { '5-15': .425, '15-30': .39, '30-50': .275 } },
        MLRS_GUIDED: { front: { '5-15': .91, '15-30': .87, '30-50': .80 }, side: { '5-15': .90, '15-30': .86, '30-50': .79 }, rear: { '5-15': .89, '15-30': .85, '30-50': .78 } }
      }, 40, { enabled: false },
      { doctrine: 'SLS', interceptMethod: 'PNG', guidance: 'PNG', killRadius: 200, bdaDelay: 8, launchInterval: 4 }),
      AAM: missile('천궁-II AAM', { Rmin: 3, Rmax: 40, Hmin: .02, Hmax: 20 }, 2040, 8, 'WPN-MSAM2-PK-01', 3, 0.75, {
        AIRCRAFT: { front: { '5-15': .90, '15-30': .83, '30-40': .70 }, side: { '5-15': .90, '15-30': .83, '30-40': .70 }, rear: { '5-15': .90, '15-30': .83, '30-40': .70 } },
        CRUISE_MISSILE: { front: { '5-15': 1, '15-30': 1, '30-40': 1 }, side: { '5-15': 1, '15-30': 1, '30-40': 1 }, rear: { '5-15': 1, '15-30': 1, '30-40': 1 } },
        MLRS_GUIDED: { front: { '5-15': .91, '15-30': .86, '30-40': .80 }, side: { '5-15': .90, '15-30': .85, '30-40': .79 }, rear: { '5-15': .89, '15-30': .84, '30-40': .78 } }
      }, 35, { enabled: true, engagementEnvelope: { Rmin: 1, Rmax: 40, Hmin: 0, Hmax: 20 }, missileSpeed: 1200 },
      { doctrine: 'SLS', interceptMethod: 'PNG', guidance: 'PNG', killRadius: 200, bdaDelay: 8, launchInterval: 4 })
    }, { launcherCount: 4, simultaneousEngagement: 10, reloadTime: 900 }, {
      paramRef: 'WPN-MSAM2-PK-01', sourceNote: 'IADS_codex_original CHEONGUNG2', engageTimeSec: 45,
      pk: 0.75, costPerShotM: 3, wtaSuit: SUIT_MULTI
    }, AIR.concat(BALLISTIC, ['uav_small'])),
    PAC3: shooter('한국군 PAC-3', 2, AIR.concat(BALLISTIC), {
      ABM: missile('PAC-3', { Rmin: 3, Rmax: 60, Hmin: .06, Hmax: 40 }, 2040, 12, 'WPN-PAC3-PK-01', 3, 0.75, {
        SRBM: { front: { '3-20': .90, '20-40': .80, '40-60': .60 }, side: { '3-20': .75, '20-40': .65, '40-60': .45 }, rear: { '3-20': .45, '20-40': .40, '40-60': .30 } },
        MLRS_GUIDED: { front: { '3-20': .94, '20-40': .90, '40-60': .84 }, side: { '3-20': .92, '20-40': .88, '40-60': .82 }, rear: { '3-20': .90, '20-40': .86, '40-60': .80 } },
        CRUISE_MISSILE: { front: { '3-20': 1, '20-40': 1, '40-60': 1 }, side: { '3-20': 1, '20-40': 1, '40-60': 1 }, rear: { '3-20': 1, '20-40': 1, '40-60': 1 } },
        AIRCRAFT: { front: { '3-20': .92, '20-40': .88, '40-60': .75 }, side: { '3-20': .92, '20-40': .88, '40-60': .75 }, rear: { '3-20': .92, '20-40': .88, '40-60': .75 } }
      }, 50, { enabled: true, engagementEnvelope: { Rmin: 1, Rmax: 40, Hmin: 0, Hmax: 30 }, missileSpeed: 1400 },
      { doctrine: 'SS', interceptMethod: 'hit-to-kill', guidance: 'hit-to-kill', killRadius: 1, bdaDelay: 5, launchInterval: 3 })
    }, { launcherCount: 6, simultaneousEngagement: 9, reloadTime: 900 }, {
      paramRef: 'WPN-PAC3-PK-01', sourceNote: 'IADS_codex_original PAC3', engageTimeSec: 45,
      pk: 0.75, costPerShotM: 3, wtaSuit: SUIT_MULTI
    }),
    BIHO: shooter('비호 중대', 4, LOW, {
      AAM: missile('비호 탑재탄', { Rmin: .5, Rmax: 7, Hmin: .01, Hmax: 3.5 }, 600, 4, 'WPN-SHORAD-PK-01', 0.2, 0.30, {
        AIRCRAFT: { front: { '.5-3': .55, '3-5': .45, '5-7': .30 }, side: { '.5-3': .55, '3-5': .45, '5-7': .30 }, rear: { '.5-3': .55, '3-5': .45, '5-7': .30 } },
        CRUISE_MISSILE: { front: { '.5-3': 1, '3-5': 1, '5-7': 1 }, side: { '.5-3': 1, '3-5': 1, '5-7': 1 }, rear: { '.5-3': 1, '3-5': 1, '5-7': 1 } },
        UAS: { front: { '.5-3': 1, '3-5': 1, '5-7': 1 }, side: { '.5-3': 1, '3-5': 1, '5-7': 1 }, rear: { '.5-3': 1, '3-5': 1, '5-7': 1 } }
      }, 15, { enabled: true, engagementEnvelope: { Rmin: 0, Rmax: 7, Hmin: 0, Hmax: 5 }, missileSpeed: 700 },
      { doctrine: 'SLS', interceptMethod: 'guided', guidance: 'PNG', killRadius: 500, bdaDelay: 5, launchInterval: 2 })
    }, { launcherCount: 6, simultaneousEngagement: 24, reloadTime: 900 }, {
      integratedSensor: 'BIHO_INTEGRATED', paramRef: 'ADR-049', sourceNote: 'ADR-049 company/vehicle aggregation',
      engageTimeSec: 60, pk: 0.3, costPerShotM: 0.2, wtaSuit: SUIT_SHORAD
    }, AIR.concat(['uav_small'])),
    CHUNMA: shooter('천마 중대', 4, LOW, {
      AAM: missile('천마 탑재탄', { Rmin: .5, Rmax: 9, Hmin: .02, Hmax: 5 }, 750, 8, 'WPN-SHORAD-PK-01', 0.2, 0.30, {
        AIRCRAFT: { front: { '.5-3': .62, '3-6': .52, '6-9': .36 }, side: { '.5-3': .62, '3-6': .52, '6-9': .36 }, rear: { '.5-3': .62, '3-6': .52, '6-9': .36 } },
        CRUISE_MISSILE: { front: { '.5-3': 1, '3-6': 1, '6-9': 1 }, side: { '.5-3': 1, '3-6': 1, '6-9': 1 }, rear: { '.5-3': 1, '3-6': 1, '6-9': 1 } },
        UAS: { front: { '.5-3': 1, '3-6': 1, '6-9': 1 }, side: { '.5-3': 1, '3-6': 1, '6-9': 1 }, rear: { '.5-3': 1, '3-6': 1, '6-9': 1 } }
      }, 18, { enabled: true, engagementEnvelope: { Rmin: 0, Rmax: 9, Hmin: 0, Hmax: 5 }, missileSpeed: 700 },
      { doctrine: 'SLS', interceptMethod: 'guided', guidance: 'PNG', killRadius: 500, bdaDelay: 5, launchInterval: 2 })
    }, { launcherCount: 6, simultaneousEngagement: 48, reloadTime: 900 }, {
      integratedSensor: 'CHUNMA_INTEGRATED', paramRef: 'ADR-049', sourceNote: 'ADR-049 company/vehicle aggregation',
      engageTimeSec: 60, pk: 0.3, costPerShotM: 0.2, wtaSuit: SUIT_SHORAD
    }, AIR.concat(['uav_small'])),
    THAAD: shooter('USFK THAAD', 1, BALLISTIC, {
      ABM: missile('THAAD interceptor', { Rmin: 30, Rmax: 200, Hmin: 40, Hmax: 150 }, 3100, 8, 'WPN-THAAD-PK-01', 8, 0.75, {
        SRBM: { front: { '30-80': .95, '80-150': .90, '150-200': .75 }, side: { '30-80': .80, '80-150': .72, '150-200': .55 }, rear: { '30-80': .475, '80-150': .45, '150-200': .375 } },
        MLRS_GUIDED: { front: { '30-80': .92, '80-150': .88, '150-200': .80 }, side: { '30-80': .90, '80-150': .86, '150-200': .79 }, rear: { '30-80': .88, '80-150': .84, '150-200': .78 } }
      }, 85, { enabled: true, engagementEnvelope: { Rmin: 5, Rmax: 200, Hmin: 40, Hmax: 150 }, missileSpeed: 2800 },
      { doctrine: 'SLS', interceptMethod: 'hit-to-kill', guidance: 'hit-to-kill', killRadius: 50, bdaDelay: 10, launchInterval: 5 })
    }, { launcherCount: 6, simultaneousEngagement: 6, reloadTime: 900 }, {
      paramRef: 'ADR-036', sourceNote: 'USFK THAAD independent axis; not KAMDOC integrated', engageTimeSec: 40,
      pk: 0.75, costPerShotM: 8, wtaSuit: SUIT_BALLISTIC, simulationEligible: false
    }, ['srbm']),
    USFK_PAC3: shooter('USFK Patriot', 2, AIR.concat(BALLISTIC), {
      ABM: missile('USFK PAC-3', { Rmin: 3, Rmax: 60, Hmin: .06, Hmax: 40 }, 2040, 12, 'WPN-PAC3-PK-01', 3, 0.75, {
        SRBM: { front: { '3-20': .90, '20-40': .80, '40-60': .60 }, side: { '3-20': .75, '20-40': .65, '40-60': .45 }, rear: { '3-20': .45, '20-40': .40, '40-60': .30 } },
        MLRS_GUIDED: { front: { '3-20': .94, '20-40': .90, '40-60': .84 }, side: { '3-20': .92, '20-40': .88, '40-60': .82 }, rear: { '3-20': .90, '20-40': .86, '40-60': .80 } },
        CRUISE_MISSILE: { front: { '3-20': 1, '20-40': 1, '40-60': 1 }, side: { '3-20': 1, '20-40': 1, '40-60': 1 }, rear: { '3-20': 1, '20-40': 1, '40-60': 1 } },
        AIRCRAFT: { front: { '3-20': .92, '20-40': .88, '40-60': .75 }, side: { '3-20': .92, '20-40': .88, '40-60': .75 }, rear: { '3-20': .92, '20-40': .88, '40-60': .75 } }
      }, 50, { enabled: true, engagementEnvelope: { Rmin: 1, Rmax: 40, Hmin: 0, Hmax: 30 }, missileSpeed: 1400 },
      { doctrine: 'SS', interceptMethod: 'hit-to-kill', guidance: 'hit-to-kill', killRadius: 1, bdaDelay: 5, launchInterval: 3 })
    }, { launcherCount: 6, simultaneousEngagement: 9, reloadTime: 900 }, {
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
    ARMY_LOCAL_AD: c2('육군 군단·권역 방공 C2A/AOC', 'corps_aoc', 8, { system: [1, 2], operator: { high: 1, mid: 2, low: 3 } }, 'corps_local', {
      integrated: false,
      paramRef: 'C2-CORPS-AOC-01',
      sourceNote: '군단 AOC의 MCRC+국지레이더 항적융합·자체 자동교전을 모사하는 공개자료 기반 개념 C2A'
    }),
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
