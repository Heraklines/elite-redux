/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_CAP_AUTHORITY_V2_SHADOW,
  COOP_CAP_AUTHORITY_V2_TURN,
  clearNegotiatedCoopCapabilities,
  setNegotiatedCoopCapabilities,
} from "#data/elite-redux/coop/coop-capabilities";
import { type CoopRuntime, getCoopV2Shadow } from "#data/elite-redux/coop/coop-runtime";

/**
 * Complete the same-build CPU peer handshake for a legacy one-engine fixture.
 *
 * `startLocalCoopSession` deliberately constructs but does not connect its spoof:
 * some fixtures attach a real second controller to `partnerTransport`, while
 * renderer fixtures change the local controller's seat after assembly. Those
 * topologies must opt in at the point where the CPU is genuinely their peer.
 */
export async function negotiateLocalSpoofPeer(
  runtime: CoopRuntime,
  options: { disposeAfter?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  const spoof = runtime.spoof;
  if (spoof == null) {
    throw new Error("local co-op fixture has no spoof peer to negotiate");
  }

  try {
    spoof.connect();
    const compatible = await runtime.controller.awaitPartnerCompatibility(options.timeoutMs ?? 5_000);
    if (compatible == null || runtime.controller.sessionEpoch <= 0 || runtime.controller.runId === "") {
      throw new Error("local spoof peer did not establish a complete co-op identity/compatibility barrier");
    }
  } finally {
    if (options.disposeAfter === true) {
      spoof.dispose();
    }
  }
}

/**
 * Install the real Authority V2 turn-replica boundary for a single-scene presentation fixture.
 *
 * A {@linkcode negotiateLocalSpoofPeer CPU spoof} intentionally advertises no Authority V2
 * capabilities because it owns no replica engine or receipt ledger. Renderer-only tests which begin
 * after authenticated V2 admission must therefore replace that deliberately legacy negotiation with
 * the exact turn capability pair before calling `ingestAuthoritativeV2Turn`. Keeping this exceptional
 * seam here makes the topology explicit; production and end-to-end tests must use two real runtimes.
 */
export function installLocalV2TurnReplicaFixture(runtime: CoopRuntime): void {
  if (runtime.controller.sessionEpoch <= 0 || runtime.controller.runId === "") {
    throw new Error("single-scene V2 replica fixture requires a completed identity handshake");
  }
  const capabilities = [COOP_CAP_AUTHORITY_V2_SHADOW, COOP_CAP_AUTHORITY_V2_TURN] as const;
  clearNegotiatedCoopCapabilities();
  setNegotiatedCoopCapabilities(capabilities, capabilities);
  if (getCoopV2Shadow(runtime) == null) {
    throw new Error("single-scene V2 replica fixture could not install the real turn cutover");
  }
}
