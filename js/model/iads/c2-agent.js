export const ORDER_STATE = Object.freeze({
  CREATED: 'created', IN_TRANSIT: 'in_transit', RECEIVED: 'received', ACKNOWLEDGED: 'acknowledged',
  ACTIVE: 'active', COMMITTED: 'committed', EXECUTING: 'executing', BDA_PENDING: 'bda_pending',
  HIT: 'hit', MISS: 'miss', RELEASED: 'released', CANCELLED: 'cancelled', EXPIRED: 'expired'
});

export const CLAIM_STATE = Object.freeze({
  RESERVED: 'reserved', FIRED: 'fired', BDA_PENDING: 'bda_pending', HIT: 'hit', MISS: 'miss', RELEASED: 'released'
});

export function createEngagementOrder(id, commander, shooterId, at, options = {}) {
  return {
    id,
    directiveId: id,
    threatId: options.threatId ?? null,
    directiveType: options.directiveType ?? 'ENGAGE',
    commander,
    issuedByC2Id: commander?.id ?? null,
    targetEcsId: options.targetEcsId ?? null,
    targetBatteryId: shooterId,
    shooterId,
    authorityLevel: options.authorityLevel ?? commander?.typeId ?? null,
    delegationLevel: options.delegationLevel ?? null,
    launchCause: options.launchCause ?? 'commanded',
    trackVersion: options.trackVersion ?? null,
    trackLastUpdateAt: options.trackLastUpdateAt ?? null,
    trackReceivedAt: options.trackReceivedAt ?? null,
    validFrom: options.validFrom ?? at,
    validUntil: options.validUntil ?? null,
    sentAt: null,
    receivedAt: null,
    acknowledgedAt: null,
    activeAt: null,
    expiredAt: null,
    cancelledAt: null,
    expiryReason: null,
    cancellationReason: null,
    engagementId: options.engagementId ?? `ENG_${id}`,
    createdAt: at, state: ORDER_STATE.CREATED,
    claimState: CLAIM_STATE.RESERVED, history: [{ state: ORDER_STATE.CREATED, at }],
    fired: false, resolved: false, released: false
  };
}

export function transitionOrder(order, state, at, claimState = null, reason = null) {
  order.state = state;
  order.history.push({ state, at, reason });
  if (state === ORDER_STATE.IN_TRANSIT && order.sentAt == null) order.sentAt = at;
  if (state === ORDER_STATE.RECEIVED && order.receivedAt == null) order.receivedAt = at;
  if (state === ORDER_STATE.ACKNOWLEDGED && order.acknowledgedAt == null) order.acknowledgedAt = at;
  if (state === ORDER_STATE.ACTIVE && order.activeAt == null) order.activeAt = at;
  if (state === ORDER_STATE.EXPIRED) {
    order.expiredAt = at;
    order.expiryReason = reason ?? order.expiryReason ?? 'unknown';
  }
  if (state === ORDER_STATE.CANCELLED) {
    order.cancelledAt = at;
    order.cancellationReason = reason ?? order.cancellationReason ?? 'unknown';
  }
  if (claimState) order.claimState = claimState;
  order.fired = order.fired || claimState === CLAIM_STATE.FIRED || claimState === CLAIM_STATE.BDA_PENDING;
  order.resolved = [ORDER_STATE.HIT, ORDER_STATE.MISS, ORDER_STATE.CANCELLED, ORDER_STATE.EXPIRED].includes(state);
  order.released = order.released || state === ORDER_STATE.RELEASED || order.resolved;
  return order;
}

export function isActiveClaim(order) {
  return order && [CLAIM_STATE.RESERVED, CLAIM_STATE.FIRED, CLAIM_STATE.BDA_PENDING].includes(order.claimState)
    && !order.released;
}
