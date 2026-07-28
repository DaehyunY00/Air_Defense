/**
 * C2 정책 객체 (ADR-058) — `docs/high-resolution-iads-architecture.md` §5의 명시적 정책 계층.
 *
 * 역할 분담:
 *  - c2-agent.js  = 교전명령의 **상태기계**(ORDER_STATE/CLAIM_STATE 수명주기) — "명령이 어떤
 *    상태를 거치는가".
 *  - c2-policy.js = 교전 **권한의 정책**(승인권자·자동화 수준·위임 임계·해제 권한) — "누가
 *    승인하고, 언제 사람을 거치며, 언제 분권되는가".
 *
 * 수치를 새로 만들지 않는다: 자동화·승인권자는 `js/data/threats.js`의 `automation`/
 * `approvalLevel` 선언(파라미터 원장 참조 포함)을 그대로 소비하고, 위임 임계는 legacy
 * `DELEG_QUEUE_MULT`(sim-engine.js — asis 4 / tobe 1, C2-DELEG-01 계열)를 승계한다.
 */

/** 동적 권한위임 임계 배수 — legacy DELEG_QUEUE_MULT 승계(값 동일·단일 출처는 이 모듈).
 *  승인권자 노드의 관측 대기열이 (서버 수 × 배수)를 넘으면 분권 전환한다. */
export const DELEGATION_QUEUE_MULT = Object.freeze({ asis: 4, tobe: 1 });

/** 결심 자동화 수준: 'human-in-loop' | 'human-on-loop' | 'auto-preauth' | null */
export function automationLevel(threatSpec, mode) {
  return threatSpec && threatSpec.automation ? threatSpec.automation[mode] || null : null;
}

/** 승인권자 역할명('KAOC'|'MCRC'|'KAMDOC'|null). 노드 해소는 호출자(resolveRole) 책임. */
export function approvalAuthority(threatSpec, mode) {
  return threatSpec && threatSpec.approvalLevel ? threatSpec.approvalLevel[mode] || null : null;
}

export function delegationThreshold(mode) {
  return DELEGATION_QUEUE_MULT[mode] || DELEGATION_QUEUE_MULT.asis;
}

/** 교전 해제 권한 = 책임 C2 자신 (현행 native 의미론 — 계획을 만든 지휘관이 해제한다). */
export function releaseAuthority(commander) {
  return commander ? commander.id : null;
}

/**
 * 승인 정책 종합 판정. 반환: { auto, approvalRole }
 *  - counterfactual(approvalChainTobe): To-Be에도 As-Is 승인 계선을 강제 — 정책 조회만
 *    'asis' 열로 바꾼다(반증 실험 전용, 선례 costAwareWtaAsis).
 */
export function approvalPolicy(threatSpec, mode, counterfactual) {
  var policyMode = counterfactual && mode === 'tobe' ? 'asis' : mode;
  return {
    auto: automationLevel(threatSpec, policyMode),
    approvalRole: approvalAuthority(threatSpec, policyMode),
    policyMode: policyMode
  };
}
