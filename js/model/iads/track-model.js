import { deriveStream, RNG_DOMAIN } from './rng-substream.js';
import { SENSOR_STATE, trackFreshness } from './sensor-model.js';

export const TRACK_CORRELATION = Object.freeze({ CORRECT: 'correct', MIS: 'mis', FAILED: 'failed' });
export const TRACK_IDENTITY = Object.freeze({ UNKNOWN: 'unknown', ASSUMED_HOSTILE: 'assumed_hostile', HOSTILE: 'hostile' });
export const CORRELATION_RETRY_SECONDS = 5;

const EARLY_WARNING_TYPES = new Set(['GREEN_PINE_B', 'GREEN_PINE_C', 'FPS117', 'TPS880K']);

export function correlationProbabilities(sensorTypeId) {
  return EARLY_WARNING_TYPES.has(sensorTypeId)
    ? { failed: 0.02, mis: 0.01 }
    : { failed: 0.10, mis: 0.05 };
}

export function correlationKey(sensorId, threatId, architecture) {
  return `${sensorId}::${threatId}::${architecture}`;
}

export function resolveCorrelation(cache, seed, sensorId, sensorTypeId, threatId, architecture, simTime) {
  const key = correlationKey(sensorId, threatId, architecture);
  const cached = cache[key];
  if (cached === TRACK_CORRELATION.CORRECT || cached === TRACK_CORRELATION.MIS) return cached;
  const attempt = Math.floor(Math.max(0, simTime) / CORRELATION_RETRY_SECONDS);
  const draw = deriveStream(seed, RNG_DOMAIN.CORRELATION, sensorId, threatId, attempt)();
  const probs = correlationProbabilities(sensorTypeId);
  const value = draw < probs.failed ? TRACK_CORRELATION.FAILED
    : (draw < probs.failed + probs.mis ? TRACK_CORRELATION.MIS : TRACK_CORRELATION.CORRECT);
  if (value !== TRACK_CORRELATION.FAILED) cache[key] = value;
  return value;
}

export function overrideCorrelationCorrect(cache, sensorId, threatId, architecture) {
  cache[correlationKey(sensorId, threatId, architecture)] = TRACK_CORRELATION.CORRECT;
}

export function createTrackReport(opts) {
  const freshness = trackFreshness(opts.physicalTrack, opts.simTime, opts.maxAgeSeconds);
  if (!freshness.fresh || opts.physicalTrack.state === SENSOR_STATE.UNDETECTED) return null;
  const correlationType = resolveCorrelation(opts.cache, opts.seed, opts.sensorId, opts.sensorTypeId,
    opts.threatId, opts.architecture, opts.simTime);
  if (correlationType === TRACK_CORRELATION.FAILED) return null;
  return {
    sensorId: opts.sensorId,
    sensorTypeId: opts.sensorTypeId,
    state: opts.physicalTrack.state,
    lastUpdateAt: opts.physicalTrack.lastUpdateAt,
    staleness: freshness.age,
    confidence: freshness.confidence,
    correlationType,
    identity: correlationType === TRACK_CORRELATION.CORRECT ? TRACK_IDENTITY.ASSUMED_HOSTILE : TRACK_IDENTITY.UNKNOWN
  };
}

export function fuseTrackReports(reports) {
  const correct = reports.filter((r) => r.correlationType === TRACK_CORRELATION.CORRECT).length;
  const freshest = reports.reduce((best, r) => (!best || r.staleness < best.staleness ? r : best), null);
  return {
    sources: reports,
    fused: reports.length > 1,
    state: reports.some((r) => r.state === SENSOR_STATE.FIRE_CONTROL) ? SENSOR_STATE.FIRE_CONTROL
      : (reports.some((r) => r.state === SENSOR_STATE.TRACKED) ? SENSOR_STATE.TRACKED : SENSOR_STATE.DETECTED),
    staleness: freshest ? freshest.staleness : Infinity,
    lastUpdateAt: freshest ? freshest.lastUpdateAt : null,
    confidence: reports.reduce((m, r) => Math.max(m, r.confidence), 0),
    correlationType: correct ? TRACK_CORRELATION.CORRECT : TRACK_CORRELATION.MIS,
    identity: correct >= 2 ? TRACK_IDENTITY.HOSTILE : (correct ? TRACK_IDENTITY.ASSUMED_HOSTILE : TRACK_IDENTITY.UNKNOWN)
  };
}
