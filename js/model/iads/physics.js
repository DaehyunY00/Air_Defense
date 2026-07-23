const DEG2RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

export function radarHorizon(antennaAltM, targetAltM) {
  const h1 = Math.max(0, antennaAltM) / 1000;
  const h2 = Math.max(0, targetAltM) / 1000;
  return Math.sqrt(2 * EARTH_RADIUS_KM * h1) + Math.sqrt(2 * EARTH_RADIUS_KM * h2);
}

export function slantRange(a, b) {
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLon = (b.lon - a.lon) * DEG2RAD;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const ground = 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
  const dz = ((b.alt || 0) - (a.alt || 0)) / 1000;
  return Math.sqrt(ground * ground + dz * dz);
}

export function isInSector(sensorPos, targetPos, maxRange, azimuthCenter = 0, azimuthHalf = 180,
  elevationMax = 90, minAltitude = 0, elevationMin = 0) {
  if (targetPos.alt < minAltitude || slantRange(sensorPos, targetPos) > maxRange) return false;
  const dLon = (targetPos.lon - sensorPos.lon) * DEG2RAD;
  const dLat = (targetPos.lat - sensorPos.lat) * DEG2RAD;
  const east = dLon * Math.cos(sensorPos.lat * DEG2RAD) * EARTH_RADIUS_KM * 1000;
  const north = dLat * EARTH_RADIUS_KM * 1000;
  const up = targetPos.alt - sensorPos.alt;
  const azimuth = Math.atan2(east, north) / DEG2RAD;
  const elevation = Math.atan2(up, Math.sqrt(east * east + north * north)) / DEG2RAD;
  const azimuthDelta = ((azimuth - azimuthCenter + 540) % 360) - 180;
  return Math.abs(azimuthDelta) <= azimuthHalf && elevation >= elevationMin && elevation <= elevationMax;
}
