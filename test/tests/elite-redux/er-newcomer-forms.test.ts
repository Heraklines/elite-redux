/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER newcomer-patch mega form-injection seam (er-newcomer-forms.ts).
//
// Proven here for the two wired forms (Mega Xerneas, Mega Parasect):
//   - the form is injected on the base species with the exact stats + kit;
//   - EVERY active + innate ability id resolves to a real allAbilities entry
//     (incl. the 5900-range newcomer abilities + Decomposer 5945 composite);
//   - the typing is correct, and Mega Parasect renders its full N-type set
//     (Bug/Grass/Ghost) on a LIVE Pokemon spawned into the form;
//   - the mega stone is registered (isErMegaStone) and a form-change edge from
//     the base form exists in pokemonFormChanges (reward-pool reachability);
//   - Mega Parasect's learnset carries Leaf Blade.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allAbilities } from "#data/data-lists";
import { isErMegaStone } from "#data/elite-redux/er-mega-stones";
import { ER_NEWCOMER_FORMS } from "#data/elite-redux/er-newcomer-forms";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/pokemon-forms/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER newcomer mega form-injection seam", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100).startingWave(145);
  });

  it("every wired form's active + innate kit resolves to real abilities, with correct stats/typing", () => {
    for (const def of ER_NEWCOMER_FORMS) {
      const species = getPokemonSpecies(def.baseSpecies);
      const form = species.forms.find(f => f.formKey === def.formKey);
      expect(form, `${def.formName} form injected on ${SpeciesId[def.baseSpecies]}`).toBeDefined();
      if (!form) {
        continue;
      }
      // Stats verbatim.
      expect([...form.baseStats]).toEqual([...def.stats]);
      // Typing: type1/type2 + extras == the full declared type list.
      const declared = new Set<PokemonType>(def.types);
      const actual = new Set<PokemonType>([
        form.type1,
        ...(form.type2 === null ? [] : [form.type2]),
        ...form.getExtraTypes(),
      ]);
      expect(actual).toEqual(declared);
      // Active triple.
      expect([form.ability1, form.ability2, form.abilityHidden]).toEqual([...def.actives]);
      // Innate triple.
      expect([...form.getPassiveAbilities()]).toEqual([...def.innates]);
      // Every referenced ability id is a live allAbilities entry (NONE = a
      // documented parked slot, e.g. Primal Mew's Shattered Psyche — skip it).
      for (const id of [...def.actives, ...def.innates]) {
        if (id === AbilityId.NONE) {
          continue;
        }
        expect(allAbilities[id], `ability ${id} exists for ${def.formName}`).toBeDefined();
        expect(allAbilities[id].id).toBe(id);
      }
    }
  });

  it("each mega stone is registered and has a base-form form-change edge (reachability)", () => {
    for (const def of ER_NEWCOMER_FORMS) {
      if (def.item === undefined) {
        continue;
      }
      expect(isErMegaStone(def.item), `${def.formName} stone is an ER mega stone`).toBe(true);
      const species = getPokemonSpecies(def.baseSpecies);
      // The live non-mega base form keys the edge's preFormKey must match (both the
      // Pokedex form list and the reward generator key on preFormKey === current
      // form key). Hardcoding "" broke Xerneas (base forms neutral/active).
      const baseKeys = new Set(species.forms.map(f => f.formKey ?? "").filter(k => !/mega|primal/.test(k)));
      if (baseKeys.size === 0) {
        baseKeys.add("");
      }
      const edges = pokemonFormChanges[def.baseSpecies] ?? [];
      const edge = edges.find(
        fc => baseKeys.has(fc.preFormKey) && fc.formKey === def.formKey && fc.findTrigger(SpeciesFormChangeItemTrigger),
      );
      expect(
        edge,
        `${def.formName} has a live-base-form->form item edge (preFormKey in ${[...baseKeys]})`,
      ).toBeDefined();
      const trigger = edge?.findTrigger(SpeciesFormChangeItemTrigger) as { item?: number } | undefined;
      expect(trigger?.item).toBe(def.item);
    }
  });

  it("Mega Parasect renders its full N-type set (Bug/Grass/Ghost) on a live Pokemon", async () => {
    await game.classicMode.startBattle(SpeciesId.PARASECT);
    const parasect = game.scene.getPlayerPokemon()!;
    const megaIdx = parasect.species.forms.findIndex(f => f.formKey === "mega");
    expect(megaIdx).toBeGreaterThan(0);
    parasect.formIndex = megaIdx;

    const types = parasect.getTypes();
    expect(new Set(types)).toEqual(new Set([PokemonType.BUG, PokemonType.GRASS, PokemonType.GHOST]));
    // Ghost makes it immune to Normal/Fighting; Grass weak to Fire; Bug/Grass double-weak to Fire? no.
    // Fire: x1 vs Bug? Fire is x2 vs Bug and x2 vs Grass, x1 vs Ghost -> x4.
    expect(parasect.getAttackTypeEffectiveness(PokemonType.FIRE, {})).toBe(4);
    // Normal is x0 vs Ghost.
    expect(parasect.getAttackTypeEffectiveness(PokemonType.NORMAL, {})).toBe(0);
  });

  it("Mega Parasect learnset carries Leaf Blade", () => {
    const moves = pokemonSpeciesLevelMoves[SpeciesId.PARASECT];
    expect(moves.some(([, moveId]) => moveId === MoveId.LEAF_BLADE)).toBe(true);
  });

  it("covers all 20 newcomer and Alpha forms incl. the additive mega-z rows", () => {
    // 17 batch-1/Alpha forms + 3 batch-2 forms (Metagross Battle Bond,
    // Yveltal Mega Z, Mega Luxray Y).
    expect(ER_NEWCOMER_FORMS).toHaveLength(20);

    // Mega Skarmory Z is ADDITIVE: it does not disturb the existing ER Mega
    // Skarmory Y, and lands on a distinct `mega-z` formIndex.
    const skarmory = getPokemonSpecies(SpeciesId.SKARMORY);
    expect(
      skarmory.forms.some(f => f.formKey === "mega-y"),
      "existing Mega Skarmory Y untouched",
    ).toBe(true);
    const skZ = skarmory.forms.find(f => f.formKey === "mega-z");
    expect(skZ, "Mega Skarmory Z injected").toBeDefined();
    expect([...skZ!.baseStats]).toEqual([75, 135, 70, 135, 70, 110]);
    expect(new Set([skZ!.type1, skZ!.type2, ...skZ!.getExtraTypes()])).toEqual(
      new Set([PokemonType.STEEL, PokemonType.FLYING, PokemonType.DRAGON]),
    );

    // Mega Dragonite Z is a THIRD mega alongside `mega` + `mega-y`.
    const dragonite = getPokemonSpecies(SpeciesId.DRAGONITE);
    expect(
      dragonite.forms.some(f => f.formKey === "mega"),
      "existing Dragonite mega untouched",
    ).toBe(true);
    expect(
      dragonite.forms.some(f => f.formKey === "mega-y"),
      "existing Dragonite mega-y untouched",
    ).toBe(true);
    const drZ = dragonite.forms.find(f => f.formKey === "mega-z");
    expect(drZ, "Mega Dragonite Z injected").toBeDefined();
    expect([...drZ!.baseStats]).toEqual([91, 144, 144, 110, 110, 101]);
    expect(new Set([drZ!.type1, drZ!.type2, ...drZ!.getExtraTypes()])).toEqual(
      new Set([PokemonType.DRAGON, PokemonType.FLYING, PokemonType.STEEL]),
    );

    const fidough = getPokemonSpecies(SpeciesId.FIDOUGH);
    const partner = fidough.forms.find(f => f.formKey === "partner");
    expect(partner?.isStarterSelectable).toBe(true);
    const megaEdge = (pokemonFormChanges[SpeciesId.FIDOUGH] ?? []).find(fc => fc.formKey === "mega");
    expect(megaEdge?.preFormKey).toBe("partner");

    const lucarioZ = getPokemonSpecies(SpeciesId.LUCARIO).forms.find(f => f.formKey === "mega");
    expect(lucarioZ?.formName).toBe("Mega Z");
    expect(lucarioZ?.type2).toBe(PokemonType.ELECTRIC);
  });
});
