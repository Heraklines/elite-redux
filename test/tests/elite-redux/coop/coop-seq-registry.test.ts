/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #840 SEQ-BAND COLLISION guard. The relay routes purely by numeric `seq`, so a
// numeric overlap between two bands is a wire-desync generator. This test proves
// the whole band set is pairwise DISJOINT at realistic magnitudes.
//
// THE BUG IT CAUGHT: `COOP_LEARN_MOVE_SEQ` was `9_000_001`, INSIDE the
// `COOP_ME_TERM_SEQ_BASE (9_000_000) + interactionCounter` band (reached at
// counter == 1). It was "safe" only by lifecycle separation (temporal), not
// numerically. If you set COOP_LEARN_MOVE_SEQ back to 9_000_001 the disjointness
// assertion below FAILS (the learn-move singleton falls inside the 9M ME-terminal
// range) - which is exactly why it was relocated to a free base (9_500_000).
// =============================================================================

import {
  COOP_BIOME_TRANSITION_SEQ_BASE,
  COOP_CATCH_FULL_SEQ,
  COOP_LEARN_MOVE_SEQ,
  COOP_MAX_REACHABLE_COUNTER,
  COOP_ME_TERM_SEQ_BASE,
  COOP_SEQ_BANDS,
  COOP_STORMGLASS_SEQ,
  type CoopSeqBand,
  coopSeqBandRange,
} from "#data/elite-redux/coop/coop-seq-registry";
import { describe, expect, it } from "vitest";

/** Find the first overlapping pair among the bands (or null if all disjoint). */
function firstOverlap(bands: readonly CoopSeqBand[]): { a: CoopSeqBand; b: CoopSeqBand } | null {
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const ra = coopSeqBandRange(bands[i]);
      const rb = coopSeqBandRange(bands[j]);
      // Closed ranges [lo, hi] overlap iff neither is entirely left of the other.
      if (ra.lo <= rb.hi && rb.lo <= ra.hi) {
        return { a: bands[i], b: bands[j] };
      }
    }
  }
  return null;
}

describe("#840 co-op seq-band registry (collision guard)", () => {
  it("every band is pairwise DISJOINT at realistic magnitudes", () => {
    const overlap = firstOverlap(COOP_SEQ_BANDS);
    expect(
      overlap,
      overlap == null
        ? ""
        : `bands "${overlap.a.key}" [${coopSeqBandRange(overlap.a).lo}, ${coopSeqBandRange(overlap.a).hi}] and `
            + `"${overlap.b.key}" [${coopSeqBandRange(overlap.b).lo}, ${coopSeqBandRange(overlap.b).hi}] OVERLAP - `
            + "relocate one to a free base",
    ).toBeNull();
  });

  it("the learn-move singleton does NOT fall inside the 9M ME-terminal band (the #840 fix)", () => {
    // The audit's near-collision: a level-up move-learn and an in-progress ME terminal were disjoint
    // only by timing. Encode the numeric guarantee so it can never regress.
    const termLo = COOP_ME_TERM_SEQ_BASE;
    const termHi = COOP_ME_TERM_SEQ_BASE + COOP_MAX_REACHABLE_COUNTER;
    const inside = COOP_LEARN_MOVE_SEQ >= termLo && COOP_LEARN_MOVE_SEQ <= termHi;
    expect(
      inside,
      `COOP_LEARN_MOVE_SEQ (${COOP_LEARN_MOVE_SEQ}) must NOT sit inside the ME-terminal band `
        + `[${termLo}, ${termHi}] - it was 9_000_001 (inside), relocated to a free base`,
    ).toBe(false);
  });

  it("the interaction-counter ceiling stays below the faint-switch band (reward channel can't reach it)", () => {
    // The raw-counter reward channel is base 0; the faint band at 90_000 is deliberately seated above
    // the realistic counter ceiling so the reward channel never climbs into it.
    const faint = COOP_SEQ_BANDS.find(b => b.key === "faintSwitch");
    expect(faint).toBeDefined();
    expect(COOP_MAX_REACHABLE_COUNTER).toBeLessThan(faint!.base);
  });

  it("the deterministic biome-transition band excludes Stormglass and stays below catch-full", () => {
    expect(COOP_BIOME_TRANSITION_SEQ_BASE).toBe(COOP_STORMGLASS_SEQ + 1);
    expect(COOP_BIOME_TRANSITION_SEQ_BASE + COOP_MAX_REACHABLE_COUNTER - 1).toBeLessThan(COOP_CATCH_FULL_SEQ);
  });

  it("bands are declared in ascending base order (readability + the disjointness scan)", () => {
    for (let i = 1; i < COOP_SEQ_BANDS.length; i++) {
      // Two singletons could tie on base only if identical - they never should.
      expect(
        COOP_SEQ_BANDS[i].base >= COOP_SEQ_BANDS[i - 1].base,
        `band "${COOP_SEQ_BANDS[i].key}" base ${COOP_SEQ_BANDS[i].base} < previous "${COOP_SEQ_BANDS[i - 1].key}"`,
      ).toBe(true);
    }
  });

  it("SANITY: a hypothetical learn-move singleton at 9_000_001 WOULD collide (proves the test bites)", () => {
    // Demonstrate the guard actually fails for the old value, so a future re-introduction is caught.
    const withOldLearnMove: CoopSeqBand[] = COOP_SEQ_BANDS.map(b =>
      b.key === "learnMove" ? { ...b, base: 9_000_001 } : b,
    );
    expect(firstOverlap(withOldLearnMove)).not.toBeNull();
  });
});
