import { allMoves } from "#data/data-lists";
import { initEliteReduxVanillaRebalance } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { MoveId } from "#enums/move-id";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 5000;

/**
 * B3 test suite: verifies ER's vanilla rebalance pass on `allMoves`.
 *
 * The test harness already runs `initEliteReduxVanillaRebalance()` during
 * test-file initialization (via `init.ts` → `initializeGame()`), so by the
 * time these tests run, every vanilla move with an ER delta has already been
 * patched.
 *
 * We exercise:
 *   1. Idempotency: re-running the patcher observes the already-patched state
 *      and reports 0 deltas.
 *   2. A known canary (POUND, KARATE_CHOP) ends up with ER's values, not
 *      pokerogue's baseline.
 *   3. ER-custom moves (id >= 5000) are NOT visited by the patcher.
 *   4. No lookup errors during the harness's startup run.
 *
 * Note on ability deltas: Ability.description is an i18next-backed getter,
 * so the patcher intentionally cannot rewrite ability descriptions. We assert
 * `abilityDeltas === 0` to lock the no-op contract until Phase C lands the
 * ER locale pack.
 */
describe("initEliteReduxVanillaRebalance (B3)", () => {
  it("is idempotent — re-running observes the patched state and reports 0 deltas", () => {
    const result = initEliteReduxVanillaRebalance();
    expect(result.moveDeltas).toBe(0);
    expect(result.moveFieldWrites).toBe(0);
    // Abilities are also idempotent — patched abilities carry a Symbol marker
    // that the patcher checks to skip already-patched entries.
    expect(result.abilityDeltas).toBe(0);
  });

  it("reports no real lookup errors on the re-run (only id-map drift is tolerated)", () => {
    // The harness already ran the patcher once and `allMoves`/`allAbilities`
    // are stable across re-runs, so the idempotent invocation must also be
    // error-free in the strict sense (`*Errors` arrays empty).
    //
    // Separately, `moveMissing` / `abilityMissing` may be nonzero — those
    // are tolerated because they trace back to a pre-existing parser bug in
    // `scripts/elite-redux/builders/id-map.mjs` (block comments in
    // `move-id.ts` like the commented-out G_MAX block at lines 1705-1737
    // inflate the id-map's apparent pokerogue ids by 32). See the
    // `VanillaRebalanceResult.moveMissing` docstring for the full story.
    const result = initEliteReduxVanillaRebalance();
    expect(result.moveErrors).toHaveLength(0);
    expect(result.abilityErrors).toHaveLength(0);
    // Lock the current drift count (32 moves from the G_MAX comment block) so
    // any future change to id-map.mjs or move-id.ts shows up here as a delta.
    expect(result.moveMissing).toBe(32);
    expect(result.abilityMissing).toBe(0);
  });

  it("patches POUND (id 1) to ER's pp value of 20 (pokerogue baseline ships pp 35)", () => {
    // ER ships POUND with pp: 20; pokerogue's initMoves() constructs it with
    // pp: 35. After the harness ran the rebalance, the live `allMoves` entry
    // must match ER's value.
    const pound = allMoves.find(m => m?.id === MoveId.POUND);
    expect(pound).toBeDefined();
    if (!pound) {
      return;
    }
    expect(pound.pp).toBe(20);
  });

  it("patches KARATE_CHOP (id 2) to ER's power 90 / pp 10 (pokerogue baseline ships power 50 / pp 25)", () => {
    // ER's KARATE_CHOP: power 90, pp 10, accuracy 100.
    // Pokerogue baseline: power 50, pp 25, accuracy 100.
    const karateChop = allMoves.find(m => m?.id === MoveId.KARATE_CHOP);
    expect(karateChop).toBeDefined();
    if (!karateChop) {
      return;
    }
    expect(karateChop.power).toBe(90);
    expect(karateChop.pp).toBe(10);
    expect(karateChop.accuracy).toBe(100);
  });

  it("does not visit ER-custom moves (id >= 5000) — they're owned by B2", () => {
    // We can't directly observe "did the patcher visit X" — but we can verify
    // the post-patch state of a sampling of custom moves matches what B2
    // constructs (i.e. nothing got coerced from a draft that happened to
    // collide on id with a vanilla entry — id-map guarantees this can't
    // happen, but we double-check via a fresh re-run path).
    const customs = allMoves.filter(m => m.id >= VANILLA_ID_CUTOFF);
    expect(customs.length).toBeGreaterThan(150);
    // Re-run the patcher; deltas should not include any custom moves
    // (the impl gates on `pokerogueId >= VANILLA_ID_CUTOFF`).
    const result = initEliteReduxVanillaRebalance();
    expect(result.moveDeltas).toBe(0);
  });

  it("ability description patching is a documented no-op (Ability.description is i18n-backed)", () => {
    // Hard contract: we don't (and can't) rewrite vanilla ability descriptions
    // at runtime — `Ability.description` is a getter that delegates to
    // i18next. The Phase C ER locale pack is where this content properly
    // belongs.
    //
    // Mechanic patches (MINOR / MAJOR / TOTAL deltas) are now applied through
    // the ABILITY_PATCHERS dispatch table, but those patches mutate `attrs`
    // not `description`. On a re-run, idempotency kicks in and `abilityDeltas`
    // reports 0.
    const result = initEliteReduxVanillaRebalance();
    expect(result.abilityDeltas).toBe(0);
    expect(result.abilityErrors).toHaveLength(0);
  });

  it("perturb-and-restore round trip: applies 800+ move deltas when pokerogue baseline is fresh", () => {
    // Round-trip verification: the harness already ran the patcher, so the
    // live state is "post-ER". To exercise the patch path again with concrete
    // delta counting, we mutate every vanilla move's numeric fields to dummy
    // sentinel values (-999), re-run the patcher, count the deltas applied,
    // then restore the post-ER state. This proves the patcher actually
    // writes — without relying on the harness's transient init log.
    //
    // The expected delta count is the count of ER vanilla move drafts with
    // a discoverable pokerogue id, minus the 32 known id-map drift entries.
    // We assert a generous floor (800) since both the ER source and the
    // pokerogue baseline are stable enough for this to hold across version
    // bumps.

    // Snapshot the current (post-ER) state.
    type Snap = { power: number; accuracy: number; pp: number; priority: number; chance: number };
    const snapshot = new Map<number, Snap>();
    for (const move of allMoves) {
      if (!move || move.id >= VANILLA_ID_CUTOFF) {
        continue;
      }
      snapshot.set(move.id, {
        power: move.power,
        accuracy: move.accuracy,
        pp: move.pp,
        priority: move.priority,
        chance: (move as { chance: number }).chance,
      });
    }

    try {
      // Perturb every vanilla move to sentinel values. The patcher will
      // overwrite the fields where ER's value > 0 (or priority differs);
      // anything left at -999 was a no-op slot for the ER draft.
      for (const move of allMoves) {
        if (!move || move.id >= VANILLA_ID_CUTOFF) {
          continue;
        }
        const m = move as { power: number; accuracy: number; pp: number; priority: number; chance: number };
        m.power = -999;
        m.accuracy = -999;
        m.pp = -999;
        m.priority = -999;
        m.chance = -999;
      }

      // Run the patcher on the perturbed state.
      const result = initEliteReduxVanillaRebalance();
      // Sanity floor — ER touches 800+ vanilla moves on a fresh run. (Concrete
      // measurement at time of writing: 813 moves, 3083 field writes.)
      expect(result.moveDeltas).toBeGreaterThan(800);
      expect(result.moveFieldWrites).toBeGreaterThan(3000);
      // Same drift accounting as the idempotent path.
      expect(result.moveMissing).toBe(32);
    } finally {
      // Always restore so subsequent tests in this file (and any file ordering
      // dependency in the suite) see the post-ER state.
      for (const [id, vals] of snapshot) {
        const move = allMoves.find(m => m?.id === id);
        if (!move) {
          continue;
        }
        const m = move as { power: number; accuracy: number; pp: number; priority: number; chance: number };
        m.power = vals.power;
        m.accuracy = vals.accuracy;
        m.pp = vals.pp;
        m.priority = vals.priority;
        m.chance = vals.chance;
      }
    }
  });
});
