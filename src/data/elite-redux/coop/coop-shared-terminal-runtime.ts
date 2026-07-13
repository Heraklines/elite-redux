/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopMembershipSnapshotV2 } from "#data/elite-redux/coop/coop-membership";
import type { CoopFrameContextV1 } from "#data/elite-redux/coop/coop-session-binding";
import {
  type CoopSharedTerminalHooks,
  CoopSharedTerminalSupervisor,
} from "#data/elite-redux/coop/coop-shared-terminal";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** Narrow authenticated-controller surface needed by the runtime terminal adapter. */
export interface CoopSharedTerminalControllerBinding {
  p33FrameContext(): CoopFrameContextV1 | null;
  p33MembershipSnapshot(): CoopMembershipSnapshotV2 | null;
  validateP33PeerFrameContext(context: CoopFrameContextV1, targetMembershipRevision: number): boolean;
}

export type CoopSharedTerminalRuntimeHooks = Omit<
  CoopSharedTerminalHooks,
  "localContext" | "membership" | "validatePeerContext"
>;

/**
 * Whether this runtime currently has all immutable P33 axes required to address a peer-ACKed terminal.
 * Authentication without an accepted run binding is deliberately false: a pre-run failure has no stable
 * session/epoch/seat identity and must use the bounded legacy teardown instead.
 */
export function hasBoundCoopSharedTerminal(controller: CoopSharedTerminalControllerBinding): boolean {
  const context = controller.p33FrameContext();
  const membership = controller.p33MembershipSnapshot();
  if (context == null || membership == null) {
    return false;
  }
  const local = membership.members.find(member => member.seatId === context.fromSeatId);
  return (
    membership.version === 2
    && membership.state === "active"
    && membership.revision === context.membershipRevision
    && membership.requiredAckSeats.includes(context.fromSeatId)
    && local?.state === "present"
    && local.connectionGeneration === context.connectionGeneration
  );
}

function unavailableMembership(): CoopMembershipSnapshotV2 {
  // The supervisor listener exists as soon as an authenticated transport is assembled, including the
  // short interval before the run binding is accepted. Returning an inert snapshot keeps forged/early
  // terminal frames fail-closed without allowing a nullable hook to throw through the transport listener.
  return {
    version: 2,
    revision: 1,
    authoritySeatId: 0,
    state: "terminated",
    members: [],
    requiredAckSeats: [],
  };
}

/** Bind the engine-free terminal supervisor to the controller's authenticated P33 seat axes. */
export function createCoopRuntimeSharedTerminal(
  transport: CoopTransport,
  controller: CoopSharedTerminalControllerBinding,
  hooks: CoopSharedTerminalRuntimeHooks,
): CoopSharedTerminalSupervisor {
  return new CoopSharedTerminalSupervisor(transport, {
    ...hooks,
    localContext: () => controller.p33FrameContext(),
    membership: () => controller.p33MembershipSnapshot() ?? unavailableMembership(),
    validatePeerContext: (context, targetMembershipRevision) =>
      controller.validateP33PeerFrameContext(context, targetMembershipRevision),
  });
}
