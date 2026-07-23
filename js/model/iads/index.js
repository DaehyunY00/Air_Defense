import { EventQueue, LegacyEventQueueAdapter } from './event-queue.js';
import { RNG_DOMAIN, RngRegistry, deriveStream } from './rng-substream.js';
import * as sensor from './sensor-model.js';
import * as physics from './physics.js';
import * as track from './track-model.js';
import * as engagement from './engagement-model.js';
import * as c2 from './c2-agent.js';

export { EventQueue, LegacyEventQueueAdapter, RNG_DOMAIN, RngRegistry, deriveStream };
export * from './sensor-model.js';
export * from './physics.js';
export * from './track-model.js';
export * from './engagement-model.js';
export * from './c2-agent.js';

export const MODEL_REVISION = 'iads-c2-physics-probability-parity-command-mop-2026-07-23';

export const THREAT_PHYSICS = Object.freeze({
  srbm: { sourceType: 'SRBM', baseSpeed: 3060, maxAltitude: 150000,
    phaseBounds: [.25, .70], rcs: [3.0, 0.1, 0.05], maneuverG: 3, ecmFactor: 0 },
  mrl_large: { sourceType: 'MLRS_GUIDED', baseSpeed: 2040, maxAltitude: 35000,
    phaseBounds: [.25, .70], rcs: [0.5, 0.2, 0.15], maneuverG: 2, ecmFactor: 0 },
  cruise: { sourceType: 'CRUISE_MISSILE', baseSpeed: 272, cruiseAltitude: 1000,
    phaseBounds: [.85, .92], rcs: [0.01, 0.02, 0.015], maneuverG: 5, ecmFactor: 0.15 },
  fighter: { sourceType: 'AIRCRAFT', baseSpeed: 340, cruiseAltitude: 10000,
    phaseBounds: [], rcs: [5.0], maneuverG: 6, ecmFactor: 0.20 },
  ac_low: { sourceType: 'AIRCRAFT', baseSpeed: 340, cruiseAltitude: 10000,
    phaseBounds: [], rcs: [5.0], maneuverG: 6, ecmFactor: 0.20 },
  heli: { sourceType: 'AIRCRAFT', baseSpeed: 340, cruiseAltitude: 10000,
    phaseBounds: [], rcs: [5.0], maneuverG: 6, ecmFactor: 0.20 },
  uav_small: { sourceType: 'UAS', baseSpeed: 55, cruiseAltitude: 100,
    phaseBounds: [], rcs: [0.03], maneuverG: 2, ecmFactor: 0.05 }
});

export function threatPhysics(type, progress, distanceKm = null) {
  const spec = THREAT_PHYSICS[type] || THREAT_PHYSICS.fighter;
  const p = Math.max(0, Math.min(1, progress));
  let index = 0;
  if (spec.rcs.length === 3) index = p < spec.phaseBounds[0] ? 0 : (p < spec.phaseBounds[1] ? 1 : 2);
  let altitude = spec.cruiseAltitude || 0;
  if (spec.maxAltitude) {
    let scale = 1;
    if (Number.isFinite(distanceKm)) {
      const bounds = spec.sourceType === 'MLRS_GUIDED' ? [80, 160] : [180, 380];
      scale = distanceKm <= bounds[0] ? .55 : (distanceKm <= bounds[1] ? 1 : 1.35);
    }
    altitude = spec.maxAltitude * scale * Math.sin(Math.PI * p);
  } else if (spec.sourceType === 'CRUISE_MISSILE') {
    if (p <= .85) altitude = spec.cruiseAltitude;
    else if (p <= .92) altitude = spec.cruiseAltitude + (500 - spec.cruiseAltitude) * ((p - .85) / .07);
    else altitude = 500 * (1 - (p - .92) / .08);
  }
  return {
    type, sourceType: spec.sourceType, rcs: spec.rcs[index], ecmFactor: spec.ecmFactor,
    baseSpeed: spec.baseSpeed, maneuverG: spec.maneuverG, altitude
  };
}

export function installIadsKernel(KJ) {
  if (!KJ) throw new Error('KJ namespace is required');
  const api = Object.freeze({
    MODEL_REVISION, EventQueue, LegacyEventQueueAdapter,
    RNG_DOMAIN, RngRegistry, deriveStream, threatPhysics,
    ...sensor, ...physics, ...track, ...engagement, ...c2
  });
  KJ.IADS = api;
  KJ.createIadsEventQueue = () => new LegacyEventQueueAdapter();
  return api;
}
