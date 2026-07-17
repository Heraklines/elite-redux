/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import { failCoopSharedSession } from "#data/elite-redux/coop/coop-runtime";

/** Route an unrecoverable authority boundary to the same visible, non-gameplay terminal on either peer. */
export function terminateCoopAuthoritySession(reason: string): void {
  coopWarn("checkpoint", `TERMINAL authority failure: ${reason}`);
  // The runtime owns the sole terminal contract. Bound P33 sessions retain an addressed peer-ACKed
  // transaction; legacy/unbound sessions use its immediate fail-closed fallback. Keeping this historical
  // call-site adapter prevents authority phases from bypassing terminal retention with a local teardown.
  failCoopSharedSession(reason, {
    boundary: "authority",
    reasonCode: "invalid-authority",
  });
}
