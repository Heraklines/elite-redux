/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane pilot (optimization brief R8): the co-op checksum oracle core.
// coop-battle-checksum.ts is a ZERO-IMPORT module, so these run in pure Node
// in milliseconds. The properties pinned here are load-bearing for the whole
// authoritative-replication design: if canonicalize is key-order sensitive or
// fnv1a64 drifts, host/guest checksums diverge on IDENTICAL state and every
// turn heals - the exact false-desync class the coop audit documents.
// =============================================================================

import {
  COOP_CHECKSUM_SENTINEL,
  canonicalize,
  fnv1a64,
  sortCoopChecksumArenaTags,
  sortCoopChecksumTagIds,
} from "#data/elite-redux/coop/coop-battle-checksum";
import { describe, expect, it } from "vitest";

describe("coop-battle-checksum (node-pure pilot)", () => {
  it("canonicalize is object-key-order independent", () => {
    const a = canonicalize({ hp: 10, id: 7, tags: ["A", "B"], nested: { x: 1, y: 2 } });
    const b = canonicalize({ nested: { y: 2, x: 1 }, tags: ["A", "B"], id: 7, hp: 10 });
    expect(a).toBe(b);
  });

  it("canonicalize distinguishes values that differ, preserves array order", () => {
    expect(canonicalize({ a: [1, 2] })).not.toBe(canonicalize({ a: [2, 1] }));
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: "1" }));
  });

  it("fnv1a64 is deterministic, 16 hex chars, and input-sensitive", () => {
    const h = fnv1a64("coop");
    expect(h).toBe(fnv1a64("coop"));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toBe(fnv1a64("coop "));
    expect(fnv1a64("")).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toBe(COOP_CHECKSUM_SENTINEL);
  });

  it("tag-id sorting is order-insensitive and stable for duplicates", () => {
    expect(sortCoopChecksumTagIds(["SEEDED", "ENCORE", "AQUA_RING"])).toEqual(
      sortCoopChecksumTagIds(["AQUA_RING", "SEEDED", "ENCORE"]),
    );
    expect(sortCoopChecksumTagIds(["B", "A", "B"])).toEqual(["A", "B", "B"]);
  });

  it("arena-tag sorting orders identically regardless of arrival order", () => {
    const hostOrder = sortCoopChecksumArenaTags([
      ["TRICK_ROOM", 3],
      ["SPIKES", 2],
      ["SPIKES", 1],
    ]);
    const guestOrder = sortCoopChecksumArenaTags([
      ["SPIKES", 1],
      ["SPIKES", 2],
      ["TRICK_ROOM", 3],
    ]);
    expect(hostOrder).toEqual(guestOrder);
  });
});
