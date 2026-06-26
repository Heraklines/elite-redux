/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Greater Ability Randomizer (Master-Ball tier - pink reskin of the Ability
// Randomizer). It is Curiosity's REWARD half, simplified: pick ANY of the mon's
// ability/innate slots, roll 4 RANDOM distinct abilities (shown with descriptions),
// pick one, and it REPLACES that slot. There is NO lock cost. The replacement is
// run-state (a customPokemonData override via setAbilityOverrideForSlot, persisted
// for the run by the session save) - NOT a permanent dex unlock.
//
// Verifies: (1) rolls exactly 4 DISTINCT abilities, never a pure-downside one, never
// a duplicate of what the mon's slots already hold + each carries a name/description;
// (2) the chosen ability lands in the PICKED slot via the override (active slot 0 and
// an innate slot); (3) the run-state override round-trips on customPokemonData; (4)
// it writes NO permanent dex unlock (starterData untouched).
// =============================================================================

import { allAbilities } from "#data/data-lists";
import {
  GREATER_RANDOMIZER_ABILITY_CHOICES,
  greaterRandomizerReplaceSlot,
  rollGreaterRandomizerAbilities,
} from "#data/elite-redux/er-greater-ability-randomizer";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { unlockSlot } from "#utils/passive-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Greater Ability Randomizer - live effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH).enemyLevel(5);
  });

  it("rolls exactly 4 DISTINCT abilities, never a pure-downside one, with name + description", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    const choices = rollGreaterRandomizerAbilities(mon);
    expect(choices).toHaveLength(GREATER_RANDOMIZER_ABILITY_CHOICES);

    const ids = choices.map(c => c.abilityId);
    // Distinct.
    expect(new Set(ids).size).toBe(ids.length);
    // The mon's own slot abilities are excluded (so a roll never offers a duplicate of
    // a slot it could replace).
    const present = new Set(mon.getAbilitySlots().map(s => s.ability.id));
    for (const c of choices) {
      expect(present.has(c.abilityId)).toBe(false);
      // Never a pure-downside ability, always a real one with a name.
      expect(c.abilityId).not.toBe(AbilityId.NONE);
      expect(c.abilityId).not.toBe(AbilityId.TRUANT);
      expect(c.abilityId).not.toBe(AbilityId.SLOW_START);
      expect(allAbilities[c.abilityId]).toBeDefined();
      expect(c.name.length).toBeGreaterThan(0);
      expect(typeof c.description).toBe("string");
    }
  });

  it("honors an extra exclude list on top of the mon's present abilities", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    const banned = [AbilityId.LEVITATE, AbilityId.DROUGHT, AbilityId.MOXIE];
    const choices = rollGreaterRandomizerAbilities(mon, banned);
    for (const c of choices) {
      expect(banned).not.toContain(c.abilityId);
    }
  });

  it("the chosen ability REPLACES the ACTIVE slot (slot 0) via the run-state override", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    const root = mon.species.getRootSpeciesId();

    // Snapshot the PERMANENT dex unlock state before (it must not change - run-state only).
    const permanentAttr = game.scene.gameData.starterData[root].passiveAttr;
    const permanentAbilityAttr = game.scene.gameData.starterData[root].abilityAttr;

    // Graft a concrete ability NOT already on any slot into the active slot (so the
    // change is observable; no ability/passive Override is used because those would
    // shadow the per-slot customPokemonData override this item writes).
    const present = new Set(mon.getAbilitySlots().map(s => s.ability.id));
    const grafted = [AbilityId.DROUGHT, AbilityId.MOXIE, AbilityId.LEVITATE, AbilityId.PROTEAN].find(
      a => !present.has(a),
    )!;
    greaterRandomizerReplaceSlot(mon, 0, grafted);

    // The active ability is now the grafted one, and it is LIVE.
    expect(mon.getAbility().id).toBe(grafted);
    expect(mon.hasAbility(grafted)).toBe(true);
    // Stored as a run-state override on the mon.
    expect(mon.customPokemonData.ability).toBe(grafted);
    // NO permanent dex write (neither passiveAttr nor abilityAttr changed).
    expect(game.scene.gameData.starterData[root].passiveAttr).toBe(permanentAttr);
    expect(game.scene.gameData.starterData[root].abilityAttr).toBe(permanentAbilityAttr);
  });

  it("the chosen ability REPLACES a chosen INNATE slot via the run-state override", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    const root = mon.species.getRootSpeciesId();

    const innate = mon.getAbilitySlots().find(s => s.slot >= 1)!;
    const passiveSlot = (innate.slot - 1) as 0 | 1 | 2;
    const present = new Set(mon.getAbilitySlots().map(s => s.ability.id));
    const grafted = [AbilityId.DROUGHT, AbilityId.MOXIE, AbilityId.REGENERATOR, AbilityId.PROTEAN].find(
      a => !present.has(a),
    )!;

    // The randomizer writes only a per-slot override - it does NOT unlock the innate.
    // Snapshot the permanent dex unlock BEFORE so we can prove the randomizer left it alone.
    const permanentAttrBefore = game.scene.gameData.starterData[root].passiveAttr;
    greaterRandomizerReplaceSlot(mon, innate.slot, grafted);

    // The chosen innate slot now holds the grafted ability (the per-slot override
    // changed what occupies it, regardless of unlock state).
    expect(mon.getAbilitySlots().find(s => s.slot === innate.slot)?.ability.id).toBe(grafted);
    // Run-state only: the randomizer wrote NO permanent dex unlock.
    expect(game.scene.gameData.starterData[root].passiveAttr).toBe(permanentAttrBefore);

    // Unlock that slot in starterData (a deliberate test-only step, NOT something the
    // randomizer does) and confirm the grafted innate is then LIVE - i.e. the override
    // occupies a real, fireable slot.
    game.scene.gameData.starterData[root].passiveAttr = unlockSlot(
      game.scene.gameData.starterData[root].passiveAttr,
      passiveSlot,
    );
    expect(mon.canApplyAbility(true, passiveSlot)).toBe(true);
    expect(mon.hasAbility(grafted)).toBe(true);
  });

  it("the grafted ability survives a customPokemonData round-trip (mid-run reload)", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    // Graft into the first innate slot (ER slot 1 -> customPokemonData.passive).
    greaterRandomizerReplaceSlot(mon, 1, AbilityId.DROUGHT);

    const round = new CustomPokemonData(JSON.parse(JSON.stringify(mon.customPokemonData)));
    expect(round.passive).toBe(AbilityId.DROUGHT);
  });
});
