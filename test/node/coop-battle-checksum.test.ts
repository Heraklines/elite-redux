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
  type CoopFieldMonView,
  coopStatusSubState,
  normalizeMonState,
  serializeMonState,
} from "#data/elite-redux/coop/coop-battle-checkpoint";
import {
  COOP_CHECKSUM_SENTINEL,
  canonicalize,
  fnv1a64,
  sortCoopChecksumArenaTags,
  sortCoopChecksumTagIds,
} from "#data/elite-redux/coop/coop-battle-checksum";
import { describe, expect, it } from "vitest";

/** A minimal host field-mon view; per-test overrides layer the status sub-state on top. */
function makeMonView(overrides: Partial<CoopFieldMonView> = {}): CoopFieldMonView {
  return {
    bi: 0,
    partyIndex: 0,
    speciesId: 25,
    hp: 100,
    maxHp: 100,
    status: 0,
    statStages: [0, 0, 0, 0, 0, 0, 0],
    fainted: false,
    ...overrides,
  };
}

/** The status projection a save-data / party digest hashes over one mon (effect + full sub-state). */
function statusDigestFields(state: {
  status: number;
  statusToxicTurnCount?: number;
  statusSleepTurnsRemaining?: number;
}) {
  const sub = coopStatusSubState(state);
  return {
    effect: state.status,
    toxicTurnCount: sub.toxicTurnCount,
    sleepTurnsRemaining: sub.sleepTurnsRemaining ?? -1,
  };
}

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

// =============================================================================
// Status SUB-STATE sync (Track R, campaign run 29634537697). The per-turn checkpoint used to carry only
// the status EFFECT enum, so a badly-toxic'd / asleep player mon's `Status.toxicTurnCount` +
// `sleepTurnsRemaining` were dropped: the pure-renderer guest reconstructed `new Status(effect)` with a 0
// counter EVERY turn, so the host (status=TOXIC, counter=N) and guest (status=TOXIC, counter=0) produced a
// PERMANENT playerParty status digest divergence that no resync could hold (the next checkpoint re-clobbered
// it). These pin the wire round-trip that heals it - build carries the sub-state, apply reconstructs it, and
// the digest reconciles - engine-free (the checkpoint transform is a zero-engine pure module).
// =============================================================================
describe("coop checkpoint status sub-state (node-pure)", () => {
  it("coopStatusSubState defaults to effect-only for the OLD (sub-fieldless) shape", () => {
    // Backward compat: a legacy payload with no sub-fields must reconstruct exactly `new Status(effect)`.
    expect(coopStatusSubState({})).toEqual({ toxicTurnCount: 0, sleepTurnsRemaining: undefined });
    // Malformed / negative values are neutralized to the safe defaults (never poison engine state).
    expect(coopStatusSubState({ statusToxicTurnCount: -3, statusSleepTurnsRemaining: -1 })).toEqual({
      toxicTurnCount: 0,
      sleepTurnsRemaining: undefined,
    });
    expect(coopStatusSubState({ statusToxicTurnCount: Number.NaN })).toEqual({
      toxicTurnCount: 0,
      sleepTurnsRemaining: undefined,
    });
  });

  it("serializeMonState carries the toxic counter + sleep turns when present", () => {
    const toxic = serializeMonState(makeMonView({ status: 5, statusToxicTurnCount: 4 }));
    expect(toxic.statusToxicTurnCount).toBe(4);
    expect(toxic.statusSleepTurnsRemaining).toBeUndefined();

    const asleep = serializeMonState(makeMonView({ status: 2, statusSleepTurnsRemaining: 3 }));
    expect(asleep.statusSleepTurnsRemaining).toBe(3);
    expect(asleep.statusToxicTurnCount).toBeUndefined();
  });

  it("serializeMonState omits the sub-state at its defaults (wire shape unchanged for a healthy mon)", () => {
    // A non-toxic / awake mon (or a freshly-toxic'd mon with counter 0) must not add the sub-fields, so an
    // OLD receiver sees the identical shape it always did.
    const healthy = serializeMonState(makeMonView({ status: 0 }));
    expect(healthy).not.toHaveProperty("statusToxicTurnCount");
    expect(healthy).not.toHaveProperty("statusSleepTurnsRemaining");

    const freshToxic = serializeMonState(makeMonView({ status: 5, statusToxicTurnCount: 0 }));
    expect(freshToxic).not.toHaveProperty("statusToxicTurnCount");
  });

  it("normalizeMonState round-trips the sub-state (guest re-clamp preserves the host's Status)", () => {
    const hostWire = serializeMonState(
      makeMonView({ status: 5, statusToxicTurnCount: 6, statusSleepTurnsRemaining: 2 }),
    );
    const guestState = normalizeMonState(hostWire);
    expect(guestState.statusToxicTurnCount).toBe(6);
    expect(guestState.statusSleepTurnsRemaining).toBe(2);
  });

  it("digest reconciles after apply: host build and guest normalize hash EQUAL", () => {
    // The whole point: the status projection a party/save digest hashes must be byte-equal on both sides
    // once the guest has applied the checkpoint.
    const hostWire = serializeMonState(makeMonView({ status: 5, statusToxicTurnCount: 7 }));
    const guestState = normalizeMonState(hostWire);
    expect(canonicalize(statusDigestFields(hostWire))).toBe(canonicalize(statusDigestFields(guestState)));
  });

  it("digest DIVERGES under the old effect-only apply (regression guard for the fix)", () => {
    // Simulate the pre-fix guest: it reconstructed Status from the effect enum ALONE, dropping the counter.
    const hostWire = serializeMonState(makeMonView({ status: 5, statusToxicTurnCount: 7 }));
    const oldGuest = { status: hostWire.status }; // effect only - the bug
    expect(canonicalize(statusDigestFields(hostWire))).not.toBe(canonicalize(statusDigestFields(oldGuest)));
  });
});
