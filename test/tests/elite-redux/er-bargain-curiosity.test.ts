/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Giratina's Bargain - Curiosity (#544, the 8th deal: the ability gamble).
//
// Curiosity LOCKS one of a mon's ability slots for the run (the cost) and grafts
// a player-chosen, randomly-rolled ability into another slot (the reward). The
// critical invariant the maintainer stressed: the lock is RUN-ONLY - it disables
// the slot for THIS run (gated in Pokemon.canApplyAbility, stored on the mon's
// customPokemonData so it round-trips through the session save) and NEVER touches
// the PERMANENT starter ability unlock (gameData.starterData[...].passiveAttr) -
// the candy-unlocked ability stays unlocked in starter-select and future runs.
//
// Verifies: (1) the availability gate, (2) lock + replace data effects on the
// live mon (locked slot goes dead in battle; the replaced slot holds + fires the
// chosen ability), (3) the lock does NOT mutate starterData, (4) the lock +
// replacement survive a customPokemonData (de)serialize round-trip.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import {
  bargainLockAbilitySlot,
  bargainReplaceAbilitySlot,
  bargainSinAvailable,
  CURIOSITY_ABILITY_CHOICES,
  rollCuriosityAbilities,
} from "#data/elite-redux/er-bargain-sins";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { Passive as PassiveAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Pure (no GameManager): the run-state field round-trips through serialization.
// ---------------------------------------------------------------------------
describe("ER Curiosity bargain - run-state serialization", () => {
  it("CustomPokemonData carries erLockedAbilitySlots through a (de)serialize round-trip", () => {
    const original = new CustomPokemonData();
    original.erLockedAbilitySlots = [0, 2];

    // The session save serializes via JSON; reconstruct from the plain object (the
    // constructor's Partial<CustomPokemonData> path - exactly how a loaded save rebuilds it).
    const round = new CustomPokemonData(JSON.parse(JSON.stringify(original)));
    expect(round.erLockedAbilitySlots).toEqual([0, 2]);
  });

  it("defaults to an empty lock set for a fresh mon", () => {
    expect(new CustomPokemonData().erLockedAbilitySlots).toEqual([]);
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Curiosity bargain - live effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH).enemyLevel(5);
  });

  it("the availability gate needs a mon with 2+ usable ability slots", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    // A real party mon has an active ability + at least one innate slot, so the
    // deal is offerable.
    expect(bargainSinAvailable("curiosity")).toBe(true);
  });

  it("rolls 7 distinct abilities, never a pure-downside one, excluding the requested ids", () => {
    const exclude = [AbilityId.LEVITATE];
    const choices = rollCuriosityAbilities(exclude);
    expect(choices).toHaveLength(CURIOSITY_ABILITY_CHOICES);
    const ids = choices.map(c => c.abilityId);
    // Distinct.
    expect(new Set(ids).size).toBe(ids.length);
    // Never the pure-downside set, never the excluded id, always a real ability.
    for (const c of choices) {
      expect(c.abilityId).not.toBe(AbilityId.NONE);
      expect(c.abilityId).not.toBe(AbilityId.TRUANT);
      expect(c.abilityId).not.toBe(AbilityId.SLOW_START);
      expect(c.abilityId).not.toBe(AbilityId.LEVITATE);
      expect(allAbilities[c.abilityId]).toBeDefined();
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("locking the ACTIVE slot makes the active ability go dead this run (run-state only)", async () => {
    // Force a concrete active ability so we can assert it stops firing.
    game.override.ability(AbilityId.INTIMIDATE);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    expect(mon.canApplyAbility()).toBe(true);
    expect(mon.hasAbility(AbilityId.INTIMIDATE)).toBe(true);

    bargainLockAbilitySlot(mon, 0);

    // The active ability object is still resolvable, but it no longer applies.
    expect(mon.getAbility().id).toBe(AbilityId.INTIMIDATE);
    expect(mon.canApplyAbility()).toBe(false);
    expect(mon.hasAbility(AbilityId.INTIMIDATE)).toBe(false);
    // Stored as run-state on the mon.
    expect(mon.customPokemonData.erLockedAbilitySlots).toContain(0);
  });

  it("locks an INNATE slot + grafts the chosen ability into another, never touching starterData", async () => {
    // Unlock all 3 innate slots for this run (permanent account unlock) so the
    // innate slots are LIVE to begin with - then prove the lock disables one
    // WITHOUT changing that permanent unlock.
    const rootId = SpeciesId.GARCHOMP;
    const allSlots = PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1 | PassiveAttr.UNLOCKED_2 | PassiveAttr.ENABLED_2;
    game.override.passiveAbility(AbilityId.STURDY); // forces every innate slot ON for the player

    await game.classicMode.startBattle(rootId);
    const mon = game.scene.getPlayerPokemon()!;
    const root = mon.species.getRootSpeciesId();

    // Snapshot the permanent unlock BEFORE the deal.
    const beforeAttr = game.scene.gameData.starterData[root].passiveAttr;
    game.scene.gameData.starterData[root].passiveAttr = beforeAttr | allSlots;
    const permanentAttr = game.scene.gameData.starterData[root].passiveAttr;

    const slots = mon.getAbilitySlots();
    expect(slots.length).toBeGreaterThanOrEqual(2);
    const lockSlot = slots[1].slot; // the first innate slot
    const replaceSlot = slots.find(s => s.slot !== lockSlot)!.slot;

    // Pick a concrete ability NOT already present to graft in.
    const present = new Set(slots.map(s => s.ability.id));
    const grafted = [AbilityId.DROUGHT, AbilityId.MOXIE, AbilityId.LEVITATE].find(a => !present.has(a))!;

    bargainLockAbilitySlot(mon, lockSlot);
    bargainReplaceAbilitySlot(mon, replaceSlot, grafted);

    // The locked slot is dead this run.
    const lockedPassiveSlot = (lockSlot - 1) as 0 | 1 | 2;
    expect(mon.canApplyAbility(true, lockedPassiveSlot)).toBe(false);
    // The grafted ability lives in the replace slot and IS active.
    expect(mon.hasAbility(grafted)).toBe(true);

    // The PERMANENT starter unlock is untouched - the candy-unlocked ability stays
    // unlocked for starter-select + future runs.
    expect(game.scene.gameData.starterData[root].passiveAttr).toBe(permanentAttr);
  });

  it("the lock + grafted ability survive a customPokemonData round-trip (mid-run reload)", async () => {
    game.override.ability(AbilityId.INTIMIDATE);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    bargainLockAbilitySlot(mon, 0);
    // Graft a known ability into innate slot 1 (ER slot index 1).
    bargainReplaceAbilitySlot(mon, 1, AbilityId.DROUGHT);

    // Reconstruct exactly as a loaded session does (JSON -> Partial ctor).
    const round = new CustomPokemonData(JSON.parse(JSON.stringify(mon.customPokemonData)));
    expect(round.erLockedAbilitySlots).toContain(0);
    // The grafted ability override (slot 1 -> customPokemonData.passive) round-trips too.
    expect(round.passive).toBe(AbilityId.DROUGHT);
  });
});
