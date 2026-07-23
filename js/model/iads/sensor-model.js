import { isInSector, radarHorizon, slantRange } from './physics.js';

export const SENSOR_STATE = Object.freeze({
  UNDETECTED: 'UNDETECTED', DETECTED: 'DETECTED', TRACKED: 'TRACKED', FIRE_CONTROL: 'FIRE_CONTROL'
});
export const SENSOR_SCAN_CADENCE_SECONDS = 0.2;
export const MAX_CONSECUTIVE_MISSES = 3;
const BASE_SECONDS = 0.02;

export function sensorRangeCategory(threatType) {
  return threatType === 'srbm' || threatType === 'mrl_large' ||
    threatType === 'SRBM' || threatType === 'MLRS_GUIDED' ? 'ballistic' : 'aircraft';
}

export function resolveSensorRanges(sensorType, threatType) {
  const source = sensorType && sensorType.ranges;
  if (!source) return null;
  const category = sensorRangeCategory(threatType);
  const value = (key) => {
    const field = source[key];
    if (field == null || typeof field === 'number') return field;
    return field[category] == null ? null : field[category];
  };
  return { detect: value('detect'), track: value('track'), fireControl: value('fireControl') };
}

export function hasFireControlCapability(sensorType, threatType = null) {
  const ranges = resolveSensorRanges(sensorType, threatType);
  return !!sensorType && /fire_control/.test(sensorType.role || '') && Number.isFinite(ranges && ranges.fireControl);
}

export function calculateDetectionProbability(rRef, distanceKm, rcs, rcsRef) {
  if (distanceKm <= 0 || rcsRef <= 0) return 0.99;
  const snr = (rRef / distanceKm) ** 4 * (rcs / rcsRef);
  return Math.min(0.99, Math.max(0, Math.sqrt(snr) * 0.95));
}

export function hazardScanProbability(pBase, deltaSeconds, baseSeconds = BASE_SECONDS) {
  const p = Math.max(0, Math.min(1, pBase));
  if (p === 0 || p === 1) return p;
  return 1 - (1 - p) ** (deltaSeconds / baseSeconds);
}

export function hazardLossProbability(pBase, deltaSeconds, maxMisses = 3, baseSeconds = BASE_SECONDS) {
  const p = Math.max(0, Math.min(1, pBase));
  const windowLoss = (1 - p) ** maxMisses;
  if (windowLoss === 0 || windowLoss === 1) return windowLoss;
  return 1 - (1 - windowLoss) ** (deltaSeconds / (maxMisses * baseSeconds));
}

export function computeScanPFinal(sensor, target, sensorType, effects = {}) {
  const ranges = resolveSensorRanges(sensorType, target.type);
  if (!ranges || !Number.isFinite(ranges.detect)) return null;
  if ((sensorType.detectableThreats || []).indexOf(target.type) === -1) return null;
  const minAltitude = sensorType.minAltitude || 0;
  if (target.position.alt < minAltitude) return null;
  const antennaAlt = sensor.position.alt + (sensorType.antennaHeight || 0);
  const distance = slantRange(sensor.position, target.position);
  if (distance > radarHorizon(antennaAlt, target.position.alt)) return null;
  const elevationRange = sensorType.elevationRange || [-5, 90];
  if (!isInSector(sensor.position, target.position, ranges.detect, sensor.azimuthCenter || 0,
    sensorType.azimuthHalf == null ? 180 : sensorType.azimuthHalf,
    elevationRange[1], minAltitude, elevationRange[0])) return null;
  const raw = calculateDetectionProbability(ranges.detect, distance, target.rcs, sensorType.rcsRef || 1);
  const jam = Math.max(0, Math.min(1, effects.jammingLevel || 0));
  const susceptibility = sensorType.jammingSusceptibility || 0;
  const ecm = Math.max(0, Math.min(1, target.ecmFactor || 0));
  return raw * (1 - jam * susceptibility) * (1 - ecm);
}

export function createTrackState() {
  return {
    state: SENSOR_STATE.UNDETECTED,
    transitionTimer: 0,
    consecutiveMisses: 0,
    lastPFinal: 0,
    lastScanAt: null,
    lastUpdateAt: null,
    stateChangedAt: null
  };
}

export function stepSensorTrack(track, pFinal, dt, random, simTime = null) {
  let event = null;
  track.lastScanAt = simTime;
  track.lastPFinal = pFinal == null ? 0 : pFinal;
  // IADS_C2 event-sensor ADR-039: sector/horizon/altitude gated scans do not
  // consume RNG and do not destroy an already established track.
  if (!(pFinal > 0)) return { state: track.state, event: null, transitioned: false };

  const detected = random() < hazardScanProbability(pFinal, dt);
  if (track.state === SENSOR_STATE.UNDETECTED) {
    if (detected) {
      track.state = SENSOR_STATE.DETECTED;
      track.transitionTimer = 0;
      track.consecutiveMisses = 0;
      track.lastUpdateAt = simTime;
      track.stateChangedAt = simTime;
      event = 'SENSOR_DETECTED';
    }
  } else {
    // Draw 2 is unconditional for every in-sector tracking-state scan. This
    // keeps the RNG ledger independent of hit/miss while preserving the legacy
    // 3×0.02 s consecutive-miss loss hazard at the 0.2 s coarse cadence.
    const lossDraw = random();
    const lost = !detected && lossDraw < hazardLossProbability(pFinal, dt, MAX_CONSECUTIVE_MISSES);
    if (detected) {
      track.consecutiveMisses = 0;
      track.transitionTimer += dt;
      track.lastUpdateAt = simTime;
    } else {
      track.consecutiveMisses += 1;
    }
    if (lost) {
      if (track.state === SENSOR_STATE.FIRE_CONTROL) {
        track.state = SENSOR_STATE.TRACKED;
        event = 'SENSOR_FC_DEGRADED';
      } else {
        track.state = SENSOR_STATE.UNDETECTED;
        event = 'SENSOR_TRACK_LOST';
      }
      track.transitionTimer = 0;
      track.consecutiveMisses = 0;
      track.stateChangedAt = simTime;
    }
  }
  return { state: track.state, event, transitioned: event !== null };
}

export function advanceTransitions(track, sensorType, simTime = null, threatType = null) {
  const times = sensorType.transitionTime || {};
  if (track.state === SENSOR_STATE.DETECTED && track.transitionTimer >= (times.detectToTrack || 0)) {
    track.state = SENSOR_STATE.TRACKED; track.transitionTimer = 0; track.stateChangedAt = simTime; return 'SENSOR_TRACKED';
  }
  if (track.state === SENSOR_STATE.TRACKED && hasFireControlCapability(sensorType, threatType)
    && track.transitionTimer >= (times.trackToFireControl || 0)) {
    track.state = SENSOR_STATE.FIRE_CONTROL; track.transitionTimer = 0; track.stateChangedAt = simTime; return 'SENSOR_FIRE_CONTROL';
  }
  return null;
}

export function trackFreshness(track, now, maxAgeSeconds = 120) {
  const age = track && Number.isFinite(track.lastUpdateAt) ? Math.max(0, now - track.lastUpdateAt) : Infinity;
  return {
    age,
    fresh: age <= maxAgeSeconds && track && track.state !== SENSOR_STATE.UNDETECTED,
    confidence: Number.isFinite(age) ? Math.max(0, Math.min(1, 1 - age / 120)) : 0
  };
}
