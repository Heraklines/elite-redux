/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - immutable session identity selection.
//
// Public P33 sessions negotiate capabilities before their authority-authored
// session binding is accepted. That interval MUST be a defer: synthesizing an
// identity from each browser's provisional run/epoch would create two valid but
// different logs that correctly reject every cross-peer entry. Only genuinely
// unauthenticated loopback/dev sessions may use the compatibility identity.
// =============================================================================

import type { CoopV2ShadowIdentity } from "#data/elite-redux/coop/authority-v2/shadow";
import type { CoopMembershipSnapshotV2 } from "#data/elite-redux/coop/coop-membership";
import type { CoopSessionBindingV1 } from "#data/elite-redux/coop/coop-session-binding";

export interface CoopV2SessionIdentityInput {
  readonly hasAuthenticatedPairing: boolean;
  readonly authenticatedBinding: CoopSessionBindingV1 | null;
  readonly membership: CoopMembershipSnapshotV2 | null;
  readonly localSeatId: number;
  readonly authoritySeatId: number;
  readonly runId: string;
  readonly sessionEpoch: number;
  readonly connectionGeneration: number;
}

/**
 * Resolve the immutable axes used by one Authority V2 log.
 *
 * Authenticated sessions fail closed until the shared binding and membership
 * are both ready. Unauthenticated loopback/dev peers retain the stable shared
 * run-id compatibility path.
 */
export function resolveCoopV2SessionIdentity(input: CoopV2SessionIdentityInput): CoopV2ShadowIdentity | null {
  const { authenticatedBinding: binding, membership, localSeatId, authoritySeatId, connectionGeneration } = input;
  if (binding != null) {
    if (membership == null) {
      return null;
    }
    const peerBindings = membership.requiredAckSeats
      .filter(seatId => seatId !== localSeatId)
      .map(seatId => membership.members.find(member => member.seatId === seatId))
      .filter(member => member != null)
      .map(member => ({ seatId: member.seatId, connectionGeneration: member.connectionGeneration }));
    if (peerBindings.length !== membership.requiredAckSeats.length - 1 || peerBindings.length === 0) {
      return null;
    }
    return {
      runtimeId: `${binding.sessionId}:seat${localSeatId}`,
      sessionId: binding.sessionId,
      runId: binding.runId ?? input.runId,
      epoch: binding.sessionEpoch,
      localSeatId,
      authoritySeatId: binding.authoritySeatId,
      membershipRevision: membership.revision,
      seatMapId: binding.seatMap.seatMapId,
      connectionGeneration,
      peerBindings,
    };
  }

  // Capability negotiation precedes the authenticated binding. This is a
  // readiness defer, never permission to mint a browser-local identity.
  if (input.hasAuthenticatedPairing) {
    return null;
  }

  const { runId, sessionEpoch: epoch } = input;
  if (typeof runId !== "string" || runId.length === 0 || !Number.isSafeInteger(epoch) || epoch < 0) {
    return null;
  }
  return {
    runtimeId: `${runId}:seat${localSeatId}`,
    sessionId: runId,
    runId,
    epoch,
    localSeatId,
    authoritySeatId,
    membershipRevision: 1,
    seatMapId: `coop-v2-shadow-seatmap:${runId}`,
    connectionGeneration,
    // The unbound compatibility path is currently a two-seat transport. Both
    // endpoints share the channel generation; authenticated multi-seat sessions
    // use the membership-derived bindings above.
    peerBindings: [{ seatId: localSeatId === 0 ? 1 : 0, connectionGeneration }],
  };
}
