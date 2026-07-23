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

import { allAbilities, modifierTypes } from "#data/data-lists";
import {
  GREATER_RANDOMIZER_ABILITY_CHOICES,
  type GreaterAbilityRandomizerChoiceCache,
  getOrRollGreaterRandomizerAbilities,
  greaterRandomizerReplaceSlot,
  rollGreaterRandomizerAbilities,
} from "#data/elite-redux/er-greater-ability-randomizer";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { ErGreaterAbilityRandomizerModifier } from "#modifiers/modifier";
import type { ErGreaterAbilityRandomizerModifierType } from "#modifiers/modifier-type";
import { ModifierTypeOption } from "#modifiers/modifier-type";
import { ErGreaterAbilityRandomizerPhase } from "#phases/er-greater-ability-randomizer-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import { unlockSlot } from "#utils/passive-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

type GreaterRandomizerSelectPhaseSeam = {
  typeOptions: ModifierTypeOption[];
  greaterAbilityRandomizerChoiceCaches: Map<string, GreaterAbilityRandomizerChoiceCache>;
  copy(): SelectModifierPhase;
  buildPokemonModifier(
    modifierType: ErGreaterAbilityRandomizerModifierType,
    slotIndex: number,
    option: number,
    offerKey: string,
  ): ErGreaterAbilityRandomizerModifier;
};

type GreaterRandomizerModifierSeam = {
  choiceCache: GreaterAbilityRandomizerChoiceCache;
};

type GreaterRandomizerPickerPhaseSeam = {
  openAbilityPicker(mon: PlayerPokemon, slot: number): void;
};

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

  it("keeps one roll after fully leaving the item while separate offers stay independent", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    const firstType = modifierTypes.ER_GREATER_ABILITY_RANDOMIZER();
    const secondType = modifierTypes.ER_GREATER_ABILITY_RANDOMIZER();
    const original = new SelectModifierPhase() as unknown as GreaterRandomizerSelectPhaseSeam;
    original.typeOptions = [new ModifierTypeOption(firstType, 0), new ModifierTypeOption(secondType, 0)];

    const firstModifier = original.buildPokemonModifier(firstType, 0, 0, "reward:0");
    const firstCache = original.greaterAbilityRandomizerChoiceCaches.get("reward:0")!;
    expect((firstModifier as unknown as GreaterRandomizerModifierSeam).choiceCache).toBe(firstCache);

    const setMode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const firstPicker = new ErGreaterAbilityRandomizerPhase(
      0,
      -1,
      false,
      firstCache,
    ) as unknown as GreaterRandomizerPickerPhaseSeam;
    firstPicker.openAbilityPicker(mon, 0);
    const firstPickerCall = setMode.mock.calls.at(-1)!;
    expect(firstPickerCall[0]).toBe(UiMode.ER_BARGAIN);
    const firstOptions = (firstPickerCall[1] as { options: unknown[] }).options;
    const firstRoll = firstCache.get(mon.id)!;

    // A full cancel ends the item phase and resumes this continuation copy. It must
    // carry the exact cache object populated by the first picker phase.
    const continued = original.copy() as unknown as GreaterRandomizerSelectPhaseSeam;
    const reopenedModifier = continued.buildPokemonModifier(firstType, 0, 0, "reward:0");
    const reopenedCache = continued.greaterAbilityRandomizerChoiceCaches.get("reward:0")!;
    const reopenedPicker = new ErGreaterAbilityRandomizerPhase(
      0,
      -1,
      false,
      reopenedCache,
    ) as unknown as GreaterRandomizerPickerPhaseSeam;
    reopenedPicker.openAbilityPicker(mon, 0);
    const reopenedOptions = (setMode.mock.calls.at(-1)![1] as { options: unknown[] }).options;
    const reopenedRoll = getOrRollGreaterRandomizerAbilities(mon, reopenedCache);
    expect(continued.greaterAbilityRandomizerChoiceCaches).toBe(original.greaterAbilityRandomizerChoiceCaches);
    expect(reopenedCache).toBe(firstCache);
    expect(reopenedRoll).toBe(firstRoll);
    expect(reopenedOptions).toEqual(firstOptions);
    expect((reopenedModifier as unknown as GreaterRandomizerModifierSeam).choiceCache).toBe(firstCache);

    // A second pink item on the same screen is a different offer, not a shared roll.
    const secondModifier = continued.buildPokemonModifier(secondType, 0, 0, "reward:1");
    const secondCache = continued.greaterAbilityRandomizerChoiceCaches.get("reward:1")!;
    expect(secondCache).not.toBe(firstCache);
    expect((secondModifier as unknown as GreaterRandomizerModifierSeam).choiceCache).toBe(secondCache);
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
