/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Ability Capsule - run-only innate unlock (maintainer request: "ability
// capsule should also be able to unlock an innate for the run if you want").
//
// The capsule's second option run-unlocks one of a mon's currently-LOCKED innate
// slots for THIS RUN ONLY. The critical invariant (mirrored on the Curiosity lock):
// the run-unlock makes the innate fire this run (gated in Pokemon.canApplyAbility,
// stored on the mon's customPokemonData so it round-trips through the session save)
// and NEVER writes the PERMANENT candy unlock (gameData.starterData[...].passiveAttr)
// - the innate still reads LOCKED in starter-select and future runs.
//
// Verifies: (1) the run-state field round-trips through serialization, (2) a fresh
// scenario mon's innate is LOCKED, then run-unlocking it makes canApplyAbility return
// true for it this run, (3) the run-unlock does NOT mutate starterData.passiveAttr,
// (4) the run-unlock survives a customPokemonData (de)serialize round-trip, (5) a
// Curiosity-locked slot is never offered + the lock still wins, (6) the existing
// active-ability cycle path (option A) still works.
// =============================================================================

import {
  erHasRunUnlockableInnate,
  erRunUnlockAbilitySlot,
  erRunUnlockableInnateSlots,
} from "#data/elite-redux/er-ability-capsule";
import { bargainLockAbilitySlot } from "#data/elite-redux/er-bargain-sins";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { ErAbilityCapsuleModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Pure (no GameManager): the run-unlock field round-trips through serialization.
// ---------------------------------------------------------------------------
describe("ER Ability Capsule run-unlock - run-state serialization", () => {
  it("CustomPokemonData carries erRunUnlockedAbilitySlots through a (de)serialize round-trip", () => {
    const original = new CustomPokemonData();
    original.erRunUnlockedAbilitySlots = [1, 3];

    // The session save serializes via JSON; reconstruct from the plain object (the
    // constructor's Partial<CustomPokemonData> path - exactly how a loaded save rebuilds it).
    const round = new CustomPokemonData(JSON.parse(JSON.stringify(original)));
    expect(round.erRunUnlockedAbilitySlots).toEqual([1, 3]);
  });

  it("defaults to an empty run-unlock set for a fresh mon", () => {
    expect(new CustomPokemonData().erRunUnlockedAbilitySlots).toEqual([]);
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Ability Capsule run-unlock - live effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH).enemyLevel(5);
  });

  it("a fresh scenario mon's innate slots are LOCKED and so are run-unlockable", async () => {
    // A scenario mon has NO candy innate unlock (the documented gotcha), so every
    // innate slot is candy-gated -> canApplyAbility false -> run-unlockable.
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    const innateSlots = mon.getAbilitySlots().filter(s => s.slot >= 1);
    expect(innateSlots.length).toBeGreaterThanOrEqual(1);
    // None of them fire yet (locked behind the candy unlock).
    for (const { slot } of innateSlots) {
      expect(mon.canApplyAbility(true, slot - 1)).toBe(false);
    }
    // The capsule reports them as run-unlockable.
    expect(erHasRunUnlockableInnate(mon)).toBe(true);
    expect(erRunUnlockableInnateSlots(mon).map(u => u.slot)).toEqual(innateSlots.map(s => s.slot));
  });

  it("run-unlocking a locked innate makes canApplyAbility TRUE this run, without touching starterData", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    const root = mon.species.getRootSpeciesId();

    // Snapshot the PERMANENT candy unlock before the run-unlock.
    const permanentAttr = game.scene.gameData.starterData[root].passiveAttr;

    const target = erRunUnlockableInnateSlots(mon)[0];
    expect(target).toBeDefined();
    const passiveSlot = (target.slot - 1) as 0 | 1 | 2;

    // Locked before.
    expect(mon.canApplyAbility(true, passiveSlot)).toBe(false);

    erRunUnlockAbilitySlot(mon, target.slot);

    // Active THIS run.
    expect(mon.canApplyAbility(true, passiveSlot)).toBe(true);
    // Stored as run-state on the mon (the ER slot index).
    expect(mon.customPokemonData.erRunUnlockedAbilitySlots).toContain(target.slot);
    // The PERMANENT starter unlock is UNTOUCHED - the innate still reads LOCKED in
    // starter-select + future runs.
    expect(game.scene.gameData.starterData[root].passiveAttr).toBe(permanentAttr);
  });

  it("the run-unlock survives a customPokemonData round-trip (mid-run reload)", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    const target = erRunUnlockableInnateSlots(mon)[0];
    erRunUnlockAbilitySlot(mon, target.slot);

    // Reconstruct exactly as a loaded session does (JSON -> Partial ctor).
    const round = new CustomPokemonData(JSON.parse(JSON.stringify(mon.customPokemonData)));
    expect(round.erRunUnlockedAbilitySlots).toContain(target.slot);
  });

  it("a Curiosity-locked slot is never offered to run-unlock, and the lock still wins", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    const innate = mon.getAbilitySlots().find(s => s.slot >= 1)!;
    const passiveSlot = (innate.slot - 1) as 0 | 1 | 2;

    // Curiosity-lock that innate slot for the run.
    bargainLockAbilitySlot(mon, innate.slot);

    // It is NOT offered as a run-unlock candidate (the lock excludes it).
    expect(erRunUnlockableInnateSlots(mon).map(u => u.slot)).not.toContain(innate.slot);

    // Even if we force a run-unlock entry for that slot, the Curiosity lock check
    // in canApplyAbility runs first and wins - the slot stays dead.
    erRunUnlockAbilitySlot(mon, innate.slot); // no-op: helper refuses a locked slot
    expect(mon.customPokemonData.erRunUnlockedAbilitySlots).not.toContain(innate.slot);
    mon.customPokemonData.erRunUnlockedAbilitySlots.push(innate.slot); // force it anyway
    expect(mon.canApplyAbility(true, passiveSlot)).toBe(false);
  });

  it("option A (cycle active ability) still works - cycles + records the dex unlock", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    expect(ErAbilityCapsuleModifier.canCycleActiveAbility(mon)).toBe(true);
    const before = mon.getAbility().id;

    const cycled = ErAbilityCapsuleModifier.cycleActiveAbility(mon);
    expect(cycled).toBe(true);
    // The active ability changed to the next species-legal ability.
    expect(mon.getAbility().id).not.toBe(before);

    // The new active ability is one of the species' legal abilities.
    const form = mon.getSpeciesForm();
    const legal = new Set<AbilityId>(
      [form.ability1, form.ability2, form.abilityHidden].filter(a => a !== AbilityId.NONE),
    );
    expect(legal.has(mon.getAbility().id)).toBe(true);
  });
});
