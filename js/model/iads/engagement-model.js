export const PIP_SEARCH_HORIZON_SECONDS = 300;
export const MIN_ENGAGEMENT_PK = 0.10;

const TYPE_ALIASES = Object.freeze({
  srbm: 'SRBM', mrl_large: 'MLRS_GUIDED', cruise: 'CRUISE_MISSILE',
  fighter: 'AIRCRAFT', ac_low: 'AIRCRAFT', heli: 'AIRCRAFT', uav_small: 'UAS'
});

export function canonicalThreatType(type) { return TYPE_ALIASES[type] || type; }

export function classifyAspect(shooterPosition, threatPosition, nextThreatPosition) {
  const cosLat = Math.cos((threatPosition.lat || 0) * Math.PI / 180);
  const vx = (nextThreatPosition.lon - threatPosition.lon) * cosLat;
  const vy = nextThreatPosition.lat - threatPosition.lat;
  const sx = (shooterPosition.lon - threatPosition.lon) * cosLat;
  const sy = shooterPosition.lat - threatPosition.lat;
  const denom = Math.hypot(vx, vy) * Math.hypot(sx, sy);
  if (!denom) return 'side';
  const angle = Math.acos(Math.max(-1, Math.min(1, (vx * sx + vy * sy) / denom))) * 180 / Math.PI;
  return angle < 60 ? 'front' : (angle > 120 ? 'rear' : 'side');
}

export function lookupPssek(table, threatType, rangeKm, aspect) {
  if (!table) return null;
  const row = table[canonicalThreatType(threatType)];
  if (!row) return typeof table.default === 'number' ? table.default : null;
  let bins = row[aspect];
  let fallbackMultiplier = 1;
  if (!bins && row.front) {
    const ballistic = ['SRBM', 'MLRS_GUIDED', 'MRBM'].includes(canonicalThreatType(threatType));
    fallbackMultiplier = ballistic ? (aspect === 'side' ? .8 : (aspect === 'rear' ? .5 : 1)) : 1;
    bins = row.front;
  }
  bins = bins || row.side || row.rear;
  if (!bins) return null;
  const entries = Object.keys(bins).map((key) => {
    const parts = key.split('-').map(Number);
    return { lo: parts[0], hi: parts[1], value: bins[key] };
  }).filter((x) => Number.isFinite(x.lo) && Number.isFinite(x.hi)).sort((a, b) => a.lo - b.lo);
  const hit = entries.find((x) => rangeKm >= x.lo && rangeKm <= x.hi);
  if (hit) return hit.value * fallbackMultiplier;
  if (!entries.length) return null;
  if (rangeKm < entries[0].lo) return entries[0].value * fallbackMultiplier;
  if (rangeKm > entries[entries.length - 1].hi) return entries[entries.length - 1].value * fallbackMultiplier;
  return null;
}

export function applyEngagementProbabilityCorrections(basePk, opts = {}) {
  if (!Number.isFinite(basePk)) return null;
  const jam = Math.max(0, Math.min(1, Number(opts.jammingLevel) || 0));
  const susceptibility = Math.max(0, Math.min(1,
    opts.jammingSusceptibility == null ? .5 : Number(opts.jammingSusceptibility)));
  const ecm = opts.ecmActive ? Math.max(0, Math.min(1, Number(opts.ecmFactor) || 0)) : 0;
  const multiplier = Number.isFinite(opts.pkMultiplier) ? opts.pkMultiplier : 1;
  return Math.max(0, Math.min(.99, basePk * (1 - jam * susceptibility) * (1 - ecm) * multiplier));
}

export function findEarliestPip(opts) {
  const max = Math.min(PIP_SEARCH_HORIZON_SECONDS, Math.floor(opts.remainingSeconds));
  for (let dt = 0; dt <= max; dt += 1) {
    const position = opts.positionAt(opts.now + dt);
    const rangeKm = opts.rangeTo(position);
    const env = opts.missile.engagementEnvelope;
    if (rangeKm < env.Rmin || rangeKm > env.Rmax || position.altKm < env.Hmin || position.altKm > env.Hmax) continue;
    const flyout = rangeKm * 1000 / opts.missile.missileSpeed;
    if (flyout <= dt) return { position, timeToReach: dt, flyout, rangeKm };
  }
  return null;
}
