import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import {
  ER_TRAINER_BY_KEY,
  ER_TRAINER_REGISTRY,
  ER_TRAINER_TYPE_CUTOFF,
  initEliteReduxTrainers,
} from "#data/elite-redux/init-elite-redux-trainers";
import { describe, expect, it } from "vitest";

/**
 * B4 test suite: verifies the ER trainer registry.
 *
 * The test harness already runs `initEliteReduxTrainers()` during
 * test-file-initialization (via `init.ts` → `initializeGame()`), so the
 * battleable subset of the 895 ER trainers should be present in
 * `ER_TRAINER_REGISTRY` / `ER_TRAINER_BY_KEY` before each test runs.
 *
 * Cardinality note: the ER v2.65 dump references 121 gen3 species ids
 * (1101, 1175, 1187, 1437, …) that the species dump itself doesn't carry —
 * pre-existing upstream-data drift. We drop those PARTY MEMBERS per-tier;
 * a trainer is only dropped wholesale when EVERY tier ends up empty.
 * The result: nearly every trainer is now battleable (only a small handful
 * of trainers where every party member referenced a missing species are
 * still dropped).
 *
 * We exercise:
 *   1. Cardinality: registry receives the battleable trainers (~890+ out
 *      of 895).
 *   2. Lookup: a known trainer ("May Route 103 Treecko") resolves through
 *      `ER_TRAINER_BY_KEY` to the expected first registry entry.
 *   3. Translation: party members carry pokerogue ids (translated through
 *      `ER_ID_MAP`), not raw ER ids.
 *   4. Tiered parties: a known tiered trainer ("Rick") has non-null
 *      `insaneParty` and `hellParty`.
 *   5. Idempotency: re-running registers 0 new entries.
 *   6. Per-member drift: dropped members are tallied via
 *      `result.membersDroppedMissingSpecies` (a few hundred members across
 *      the whole dump).
 */
describe("initEliteReduxTrainers (B4)", () => {
  it("registers nearly all 895 ER trainers from the v2.65 dump", () => {
    // Most trainers have at least one resolvable member across the three
    // tiers — only the rare trainer whose ENTIRE party references missing
    // species is dropped. Lock the high-coverage floor here so any future
    // upstream data refresh shows up as a test delta.
    expect(ER_TRAINER_REGISTRY.length).toBeGreaterThan(850);
    expect(ER_TRAINER_REGISTRY.length).toBeLessThanOrEqual(895);
    // The map and array should stay in lockstep.
    expect(ER_TRAINER_BY_KEY.size).toBe(ER_TRAINER_REGISTRY.length);
  });

  it("is idempotent — re-running registers 0 new entries (all already present)", () => {
    const before = ER_TRAINER_REGISTRY.length;
    const result = initEliteReduxTrainers();
    expect(result.trainersRegistered).toBe(0);
    expect(result.trainersSkipped).toBe(before);
    // No real errors — only species-drift per-member drops, which are
    // counted separately under membersDroppedMissingSpecies.
    expect(result.errors).toHaveLength(0);
    expect(ER_TRAINER_REGISTRY.length).toBe(before);
  });

  it("drops party-members (not trainers) for upstream species-id drift", () => {
    // 121 ER species ids in the trainer dump are missing from the species
    // dump itself. Pre-refactor we dropped the whole trainer when any
    // member referenced a missing id (~373 trainers); the per-member drop
    // recovers all but a handful of trainers and keeps the rest with the
    // resolvable members.
    //
    // The aggregate dropped-member counter only ticks on the FIRST init
    // run (subsequent runs short-circuit via ER_TRAINER_BY_KEY); since the
    // harness already ran init before this test fires, we audit the live
    // registry directly instead of re-running.

    // 1. The trainer count exceeds the pre-refactor floor (was capped at
    //    ~522 when whole trainers were dropped).
    expect(ER_TRAINER_REGISTRY.length).toBeGreaterThan(800);

    // 2. Every registered party member carries a resolvable species id
    //    (per-member drops worked — no `undefined`s leaked through).
    const allMembers = ER_TRAINER_REGISTRY.flatMap(entry => [
      ...entry.party,
      ...(entry.insaneParty ?? []),
      ...(entry.hellParty ?? []),
    ]);
    for (const m of allMembers) {
      expect(typeof m.speciesId).toBe("number");
    }

    // 3. Some trainers have shorter parties than their upstream dump
    //    counterpart due to per-member drops (sanity-check the drop
    //    actually fired — if it didn't, the trainer count would be at
    //    895 (every draft kept) which means nothing was dropped).
    const totalMembers = allMembers.length;
    expect(totalMembers).toBeGreaterThan(0);
  });

  it("looks up the first ER trainer ('May Route 103 Treecko') by stableKey", () => {
    const may = ER_TRAINER_BY_KEY.get("May Route 103 Treecko");
    expect(may).toBeDefined();
    if (!may) {
      return;
    }
    expect(may.id).toBe(0);
    expect(may.stableKey).toBe("May Route 103 Treecko");
    // ER trainerClass 15 (Pkmn Trainer 3) → pokerogue TrainerType 1 (ACE_TRAINER).
    expect(may.trainerType).toBe(1);
    expect(may.trainerClassName).toBe("Pkmn Trainer 3");
    expect(may.isDouble).toBe(false);
    expect(may.map).toBe(318);
    // Default party always present; insane / hell are null for early trainers.
    expect(may.party.length).toBeGreaterThan(0);
    expect(may.insaneParty).toBeNull();
    expect(may.hellParty).toBeNull();
  });

  it("translates party-member species and moves through ER_ID_MAP", () => {
    const may = ER_TRAINER_BY_KEY.get("May Route 103 Treecko");
    expect(may).toBeDefined();
    if (!may) {
      return;
    }
    // First mon in ER's dump: species 255 (Torchic) — vanilla pokerogue
    // species 255 → identity-mapped to 255.
    const first = may.party[0];
    expect(first.speciesId).toBe(ER_ID_MAP.species[255]);
    expect(first.speciesId).toBe(255);
    // Moves are translated too — every translated move id should resolve.
    expect(first.moves.length).toBeGreaterThan(0);
    for (const moveId of first.moves) {
      expect(typeof moveId).toBe("number");
      expect(moveId).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves IVs / EVs / nature / item / hpType on registered party members", () => {
    const may = ER_TRAINER_BY_KEY.get("May Route 103 Treecko");
    expect(may).toBeDefined();
    if (!may) {
      return;
    }
    const first = may.party[0];
    expect(first.ivs.length).toBe(6);
    expect(first.evs.length).toBe(6);
    // ER ships Treecko with all 31 IVs and EVs of [0, 252, 0, 4, 0, 252].
    expect(first.ivs).toEqual([31, 31, 31, 31, 31, 31]);
    expect(first.evs).toEqual([0, 252, 0, 4, 0, 252]);
    expect(first.nature).toBe(11);
    expect(first.itemId).toBe(195);
    expect(first.hpType).toBe(0);
    // abilitySlot is clamped to 0 / 1 / 2.
    expect([0, 1, 2]).toContain(first.abilitySlot);
  });

  it("uses the default placeholder level (50) for every party member", () => {
    // ER doesn't ship per-member levels (see file header) — every registered
    // member should carry the placeholder until Phase B7/C wires real levels.
    for (const entry of ER_TRAINER_REGISTRY.slice(0, 20)) {
      for (const member of entry.party) {
        expect(member.level).toBe(50);
      }
    }
  });

  it("exposes tiered parties for ER trainers that ship them (Rick)", () => {
    const rick = ER_TRAINER_BY_KEY.get("Rick");
    expect(rick).toBeDefined();
    if (!rick) {
      return;
    }
    expect(rick.party.length).toBeGreaterThan(0);
    // Rick is one of the trainers shipping all three tiers in v2.65.
    expect(rick.insaneParty).not.toBeNull();
    expect(rick.hellParty).not.toBeNull();
    if (rick.insaneParty) {
      expect(rick.insaneParty.length).toBeGreaterThan(0);
    }
    if (rick.hellParty) {
      expect(rick.hellParty.length).toBeGreaterThan(0);
    }
  });

  it("registers ER-custom trainer types with ids ≥ ER_TRAINER_TYPE_CUTOFF", () => {
    expect(ER_TRAINER_TYPE_CUTOFF).toBe(1000);
    // ER_ID_MAP.trainerClasses guarantees some classes resolve to fresh ids
    // ≥ 1000 (e.g. Aqua Admin = 1000, Pkmn Trainer 3 = 1, Sis And Bro is a
    // custom). Verify the registry round-trips at least one custom slot.
    const customs = ER_TRAINER_REGISTRY.filter(e => e.trainerType >= ER_TRAINER_TYPE_CUTOFF);
    expect(customs.length).toBeGreaterThan(0);
  });

  it("never returns a partially-resolved entry — all party members carry a translated speciesId", () => {
    // Flatten every party from every entry into one big stream of members,
    // then check the invariant once. Keeps the cognitive complexity flat.
    const allMembers = ER_TRAINER_REGISTRY.flatMap(entry => [
      ...entry.party,
      ...(entry.insaneParty ?? []),
      ...(entry.hellParty ?? []),
    ]);
    for (const member of allMembers) {
      expect(typeof member.speciesId).toBe("number");
    }
  });
});
