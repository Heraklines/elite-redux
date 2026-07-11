/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { coopResyncSnapshotIsStale } from "#phases/coop-replay-phases";
import { describe, expect, it } from "vitest";

describe("co-op resync snapshot ordering", () => {
  it("applies a next-turn snapshot returned for a prior-turn mismatch", () => {
    expect(
      coopResyncSnapshotIsStale(2, 3, 3),
      "the host captured turn 3 after receiving the turn-2 request; this is current authority, not stale",
    ).toBe(false);
  });

  it("still rejects a genuinely old snapshot and preserves the legacy request-turn fallback", () => {
    expect(coopResyncSnapshotIsStale(2, 2, 3)).toBe(true);
    expect(coopResyncSnapshotIsStale(2, undefined, 3)).toBe(true);
  });
});
