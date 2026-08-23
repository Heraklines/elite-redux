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
import { Gender } from "#data/gender";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/pokemon-forms/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { PartyUiHandler } from "#ui/handlers/party-ui-handler";
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
      const species = getPokemonSpecies(def.baseSpecies as SpeciesId);
      const form = species.forms.find(f => f.formKey === def.formKey);
      expect(form, `${def.formName} form injected on ${SpeciesId[def.baseSpecies as SpeciesId]}`).toBeDefined();
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
      const species = getPokemonSpecies(def.baseSpecies as SpeciesId);
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

  it("covers all 42 newcomer, Partner, and Alpha forms incl. the additive mega-z rows", () => {
    // 28 existing newcomer/Alpha/Discord/Power Plant forms plus Mega Calyrex,
    // Mega Hypno, gender-split Mega Alolan Raichu, Mega Barbaracle Y, Mega
    // Verdant Lilligant, Mega Lilligant Verdant, and Corrupted Uxie.
    // The BerNerd batch adds Partner Rowlet/Onix/Gimmighoul and four megas.
    expect(ER_NEWCOMER_FORMS).toHaveLength(42);

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

    for (const [speciesId, slug] of [
      [SpeciesId.ROWLET, "rowlet_partner"],
      [SpeciesId.ONIX, "onix_partner"],
      [SpeciesId.GIMMIGHOUL, "gimmighoul_partner"],
    ] as const) {
      const species = getPokemonSpecies(speciesId);
      const partnerFormIndex = species.forms.findIndex(form => form.formKey === "partner");
      expect(partnerFormIndex, `${slug} partner form`).toBeGreaterThan(0);
      expect(species.forms[partnerFormIndex].isStarterSelectable).toBe(true);
      expect(species.getSpriteAtlasPath(false, partnerFormIndex)).toBe(`elite-redux/${slug}/front`);
      expect(species.getSpriteAtlasPath(false, partnerFormIndex, false, 0, true)).toBe(`elite-redux/${slug}/back`);
      expect(species.getIconAtlasKey(partnerFormIndex)).toBe(`er_icon__${slug}`);
      // Cycling back to form 0 must restore the ordinary species sprite path.
      expect(species.getSpriteAtlasPath(false, 0)).not.toContain(slug);
    }

    const lucarioZ = getPokemonSpecies(SpeciesId.LUCARIO).forms.find(f => f.formKey === "mega");
    expect(lucarioZ?.formName).toBe("Mega Z");
    expect(lucarioZ?.type2).toBe(PokemonType.ELECTRIC);
  });
  it("matches the source-backed form contracts and preserves Barbaracle's generic mega", () => {
    const expected = [
      {
        slug: "calyrex_chariot_mega",
        formName: "Mega",
        baseSpecies: SpeciesId.CALYREX,
        formKey: "mega",
        types: [PokemonType.GRASS, PokemonType.PSYCHIC, PokemonType.ICE, PokemonType.GHOST],
        stats: [100, 155, 135, 155, 135, 100],
        actives: [5158, 231, AbilityId.STAMINA],
        innates: [6054, 6055, 5259],
        item: FormChangeItem.CALYRITE,
        preFormKeys: ["ice", "shadow"],
      },
      {
        slug: "hypno_mega",
        baseSpecies: SpeciesId.HYPNO,
        formKey: "mega",
        types: [PokemonType.PSYCHIC],
        stats: [95, 73, 124, 120, 150, 73],
        actives: [6056, AbilityId.BAD_DREAMS, AbilityId.PSYCHIC_SURGE],
        innates: [6057, 5043, 6058],
        item: FormChangeItem.HYPNITE,
      },
      {
        slug: "raichu_alolan_mega_male",
        baseSpecies: SpeciesId.ALOLA_RAICHU,
        formKey: "mega-male",
        types: [PokemonType.ELECTRIC, PokemonType.PSYCHIC],
        stats: [60, 125, 80, 105, 95, 125],
        actives: [6059, 6059, 6059],
        innates: [6061, 6062, 6063],
        item: FormChangeItem.ALORAICHUNITE,
        gender: Gender.MALE,
      },
      {
        slug: "raichu_alolan_mega_female",
        baseSpecies: SpeciesId.ALOLA_RAICHU,
        formKey: "mega-female",
        types: [PokemonType.ELECTRIC, PokemonType.PSYCHIC],
        stats: [60, 105, 70, 115, 95, 145],
        actives: [6060, 6060, 6060],
        innates: [6061, 6062, 6063],
        item: FormChangeItem.ALORAICHUNITE,
        gender: Gender.FEMALE,
      },
      {
        slug: "barbaracle_mega_y",
        baseSpecies: SpeciesId.BARBARACLE,
        formKey: "mega-y",
        types: [PokemonType.ROCK, PokemonType.PSYCHIC],
        stats: [72, 88, 130, 140, 106, 64],
        actives: [6075, AbilityId.LIMBER, AbilityId.PSYCHIC_SURGE],
        innates: [6076, 6077, AbilityId.SOLID_ROCK],
        item: FormChangeItem.BARBARACITE_Y,
      },
      {
        slug: "lilligant_verdant_mega",
        baseSpecies: 70057,
        formKey: "mega",
        types: [PokemonType.WATER, PokemonType.FAIRY, PokemonType.GHOST],
        stats: [90, 50, 101, 129, 120, 110],
        actives: [6071, 6078, 6072],
        innates: [5596, 6073, 6074],
        item: FormChangeItem.LILLIGANITE_VERDANT,
      },
      {
        slug: "uxie_corrupted",
        baseSpecies: SpeciesId.UXIE,
        formKey: "primal",
        types: [PokemonType.PSYCHIC, PokemonType.DARK],
        stats: [75, 125, 130, 125, 130, 95],
        actives: [5224, AbilityId.MOODY, 5158],
        innates: [5464, 5314, 5475],
        item: FormChangeItem.DISTORTED_CHAIN,
      },
    ] as const;

    for (const contract of expected) {
      const def = ER_NEWCOMER_FORMS.find(candidate => candidate.slug === contract.slug);
      expect(def, `${contract.slug} definition`).toBeDefined();
      expect(def).toMatchObject(contract);
    }

    const barbaracle = getPokemonSpecies(SpeciesId.BARBARACLE);
    expect(
      barbaracle.forms.some(form => form.formKey === "mega"),
      "generic Barbaracle mega remains",
    ).toBe(true);
  });

  it("keeps Alolan Raichu stone edges mutually exclusive by gender", () => {
    const edges = pokemonFormChanges[SpeciesId.ALOLA_RAICHU] ?? [];
    const raichuEdges = edges.filter(fc => fc.formKey === "mega-male" || fc.formKey === "mega-female");
    expect(raichuEdges).toHaveLength(2);
    expect(raichuEdges.map(fc => fc.formKey).sort()).toEqual(["mega-female", "mega-male"]);
    const male = raichuEdges.find(fc => fc.formKey === "mega-male");
    const female = raichuEdges.find(fc => fc.formKey === "mega-female");
    expect(male?.conditions).toHaveLength(1);
    expect(female?.conditions).toHaveLength(1);
    if (!male || !female) {
      return;
    }
    const maleCondition = male.conditions[0].predicate;
    const femaleCondition = female.conditions[0].predicate;
    expect(maleCondition({ gender: Gender.MALE } as never)).toBe(true);
    expect(maleCondition({ gender: Gender.FEMALE } as never)).toBe(false);
    expect(femaleCondition({ gender: Gender.FEMALE } as never)).toBe(true);
    expect(femaleCondition({ gender: Gender.MALE } as never)).toBe(false);
  });

  it("registers Mega Calyrex from both rider preforms", () => {
    const megaEdges = (pokemonFormChanges[SpeciesId.CALYREX] ?? []).filter(fc => fc.formKey === "mega");
    expect(megaEdges.map(fc => fc.preFormKey)).toEqual(["ice", "shadow"]);
  });

  it("registers rider-specific inactive Mega Calyrex reverts", () => {
    const edges = pokemonFormChanges[SpeciesId.CALYREX] ?? [];
    const reverses = edges.filter(fc => fc.preFormKey === "mega" && (fc.formKey === "ice" || fc.formKey === "shadow"));
    expect(reverses.map(fc => fc.formKey).sort()).toEqual(["ice", "shadow"]);
    for (const reverse of reverses) {
      const trigger = reverse.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | undefined;
      expect(trigger?.item).toBe(FormChangeItem.CALYRITE);
      expect(trigger?.active).toBe(false);
      expect(reverse.conditions).toHaveLength(1);
    }
  });
  it("hides Reins toggles while active Calyrite owns the Mega form", async () => {
    await game.classicMode.startBattle(SpeciesId.CALYREX);
    const calyrex = game.field.getPlayerPokemon();
    const reins = new FormChangeItemModifierType(FormChangeItem.ICY_REINS_OF_UNITY).newModifier(calyrex);
    const calyrite = new FormChangeItemModifierType(FormChangeItem.CALYRITE).newModifier(calyrex);
    (calyrite as PokemonFormChangeItemModifier).active = false;
    await game.scene.addModifier(reins);
    await game.scene.addModifier(calyrite);

    const partyUi = new PartyUiHandler();
    expect(partyUi.getFormChangeItemsModifiers(calyrex).map(modifier => modifier.formChangeItem)).toEqual([
      FormChangeItem.ICY_REINS_OF_UNITY,
      FormChangeItem.CALYRITE,
    ]);

    (calyrite as PokemonFormChangeItemModifier).active = true;
    expect(partyUi.getFormChangeItemsModifiers(calyrex).map(modifier => modifier.formChangeItem)).toEqual([
      FormChangeItem.CALYRITE,
    ]);
  });
});
