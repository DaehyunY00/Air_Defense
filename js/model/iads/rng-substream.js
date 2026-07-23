/** Purpose/entity scoped deterministic RNG streams, aligned with IADS_C2. */
export const RNG_DOMAIN = Object.freeze({
  SENSOR_SCAN: 'sensor-scan',
  COMMS_DELAY: 'comms-delay',
  KILLCHAIN_DURATION: 'killchain-duration',
  PK_DRAW: 'pk-draw',
  THREAT_SPAWN: 'threat-spawn',
  CORRELATION: 'correlation'
});

function hashSeed(masterSeed, domain, keys) {
  const material = `${masterSeed}|${domain}|${keys.map(String).join('|')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

export function deriveStream(masterSeed, domain, ...keys) {
  let state = hashSeed(masterSeed, domain, keys);
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RngRegistry {
  constructor(masterSeed) {
    this.masterSeed = masterSeed;
    this.streams = new Map();
  }

  stream(domain, ...keys) {
    const key = `${domain}|${keys.map(String).join('|')}`;
    if (!this.streams.has(key)) this.streams.set(key, deriveStream(this.masterSeed, domain, ...keys));
    return this.streams.get(key);
  }

  reset() { this.streams.clear(); }
}
