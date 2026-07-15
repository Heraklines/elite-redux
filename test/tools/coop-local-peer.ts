/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";

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
