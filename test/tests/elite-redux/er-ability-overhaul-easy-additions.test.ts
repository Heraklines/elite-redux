/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  MoveImmunityAbAttr,
  MovePowerBoostAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  FirstEntryPartyHealAbAttr,
  FirstTurnDirectDamageMultiplierAbAttr,
  HolderAndAlliesRecoveryAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/index";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { WeatherBasedMoveBlockAbAttr } from "#data/elite-redux/archetypes/weather-based-move-block";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { initEliteReduxAbilityUpgrades } from "#data/elite-redux/init-elite-redux-ability-upgrades";
import { refreshEliteReduxComposites } from "#data/elite-redux/init-elite-redux-custom-abilities";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const attrNames = (ability: Ability): string[] => ability.attrs.map(attr => attr.constructor.name);

function erAbility(erDraftId: number): Ability {
  const runtimeId = ER_ID_MAP.abilities[erDraftId];
  expect(runtimeId, `ER ability ${erDraftId} must resolve`).toBeDefined();
  const ability = allAbilities[runtimeId];
  expect(ability, `ER ability ${erDraftId} -> ${runtimeId} must be initialized`).toBeDefined();
  return ability;
}

function expectIncludesAbility(target: Ability, source: Ability): void {
  const targetNames = attrNames(target);
  for (const sourceName of new Set(attrNames(source))) {
    expect(targetNames, `${target.name} must include ${source.name}'s ${sourceName}`).toContain(sourceName);
  }
}

function expectDescription(ability: Ability, ...phrases: string[]): void {
  const description = ability.description.toLowerCase();
  for (const phrase of phrases) {
    expect(description, `${ability.name} description must mention ${phrase}`).toContain(phrase.toLowerCase());
  }
}

describe("ability overhaul easy additions - vanilla abilities", () => {
  it("adds the next safe primitive batch without removing existing effects", () => {
    expect(attrNames(allAbilities[AbilityId.INSOMNIA])).toContain("PostSummonScriptedMoveAbAttr");
    expect(attrNames(allAbilities[AbilityId.TELEPATHY])).toEqual(
      expect.arrayContaining(["MoveImmunityAbAttr", "DodgeFirstSuperEffectiveAbAttr", "BiomeRevealBonusAbAttr"]),
    );
    expect(attrNames(allAbilities[AbilityId.MARVEL_SCALE])).toContain("BlockStatusDamageAbAttr");
    expect(attrNames(allAbilities[AbilityId.WHITE_SMOKE])).toContain("EntryEffectAbAttr");
    for (const id of [AbilityId.WIMP_OUT, AbilityId.RATTLED, AbilityId.EMERGENCY_EXIT]) {
      expect(attrNames(allAbilities[id]), `${AbilityId[id]} needs Run Away`).toContain("RunSuccessAbAttr");
    }
  });
  it("makes Healer guaranteed for both the holder and its ally", () => {
    const healer = allAbilities[AbilityId.HEALER];
    expect(attrNames(healer).filter(name => name === "PostTurnResetStatusAbAttr")).toHaveLength(2);
    expectDescription(healer, "always", "user", "ally");
  });

  it("adds Unnerve to Klutz while retaining its existing implementation marker", () => {
    const klutz = allAbilities[AbilityId.KLUTZ];
    expectIncludesAbility(klutz, allAbilities[AbilityId.UNNERVE]);
    expect(klutz.unimplemented).toBe(true);
    expectDescription(klutz, "held items", "berries");
  });

  it("adds first-entry party healing to Sweet Veil and Pastel Veil", () => {
    for (const id of [AbilityId.SWEET_VEIL, AbilityId.PASTEL_VEIL]) {
      const ability = allAbilities[id];
      const heal = ability.attrs.find(attr => attr instanceof FirstEntryPartyHealAbAttr);
      expect(heal, `${ability.name} must heal the party on first entry`).toBeInstanceOf(FirstEntryPartyHealAbAttr);
      expectDescription(ability, "10%", "party", "first");
    }
  });

  it("adds the complete ER Limber package to Steadfast", () => {
    const steadfast = allAbilities[AbilityId.STEADFAST];
    expectIncludesAbility(steadfast, allAbilities[AbilityId.LIMBER]);
    expectDescription(steadfast, "paralysis", "recoil");
  });

  it("adds sound damage reduction to Heavy Metal without removing its existing effects", () => {
    const heavyMetal = allAbilities[AbilityId.HEAVY_METAL];
    expect(attrNames(heavyMetal)).toContain("WeightMultiplierAbAttr");
    expect(heavyMetal.attrs.filter(attr => attr instanceof ReceivedMoveDamageMultiplierAbAttr)).toHaveLength(1);
    expectDescription(heavyMetal, "sound", "ghost", "dark", "weight");
  });

  it("adds the current ER Aftermath package to Perish Body", () => {
    const perishBody = allAbilities[AbilityId.PERISH_BODY];
    expectIncludesAbility(perishBody, allAbilities[AbilityId.AFTERMATH]);
    expectDescription(perishBody, "aftermath");
  });

  it("adds 1.2x accuracy to Dazzling", () => {
    const dazzling = allAbilities[AbilityId.DAZZLING];
    expect(
      dazzling.attrs.some(
        attr => attr instanceof StatMultiplierAbAttr && attr.stat === Stat.ACC && attr.multiplier === 1.2,
      ),
    ).toBe(true);
    expectDescription(dazzling, "accuracy", "1.2");
  });

  it("adds 20% incoming damage reduction to Gulp Missile", () => {
    const gulpMissile = allAbilities[AbilityId.GULP_MISSILE];
    expect(gulpMissile.attrs.some(attr => attr instanceof ReceivedMoveDamageMultiplierAbAttr)).toBe(true);
    expectDescription(gulpMissile, "20%", "damage");
  });

  it("adds Air Blower to Delta Stream", () => {
    const deltaStream = allAbilities[AbilityId.DELTA_STREAM];
    expectIncludesAbility(deltaStream, erAbility(320));
    expectDescription(deltaStream, "tailwind", "3 turn");
  });
});

describe("ability overhaul easy additions - ER custom abilities", () => {
  it("adds Run Away to Coward and Tactical Retreat", () => {
    for (const draftId of [429, 564]) {
      expect(attrNames(erAbility(draftId))).toContain("RunSuccessAbAttr");
    }
  });
  it("adds sound immunity to Parroting", () => {
    const parroting = erAbility(545);
    expect(parroting.attrs.some(attr => attr instanceof MoveImmunityAbAttr)).toBe(true);
    expectDescription(parroting, "immune", "sound");
  });

  it("adds Water offense to Antarctic Bird", () => {
    const antarcticBird = erAbility(278);
    const waterBoost = antarcticBird.attrs.find(
      attr => attr instanceof TypeDamageBoostAbAttr && attr.getBoostType() === PokemonType.WATER,
    );
    expect(waterBoost).toBeInstanceOf(TypeDamageBoostAbAttr);
    expect((waterBoost as TypeDamageBoostAbAttr).getHighHpMultiplier()).toBe(1.3);
    expectDescription(antarcticBird, "water", "1.3");
  });

  it("halves Water damage for Moon Spirit", () => {
    const moonSpirit = erAbility(478);
    expect(moonSpirit.attrs.some(attr => attr instanceof ReceivedTypeDamageMultiplierAbAttr)).toBe(true);
    expectDescription(moonSpirit, "water", "half");
  });

  it("heals Soothing Aroma's holder and adjacent allies by one sixteenth", () => {
    const soothingAroma = erAbility(485);
    expect(soothingAroma.attrs.some(attr => attr instanceof HolderAndAlliesRecoveryAbAttr)).toBe(true);
    expectDescription(soothingAroma, "1/16", "ally", "each turn");
  });

  it("adds Weather Control to Neutralizing Fog", () => {
    const neutralizingFog = erAbility(839);
    expect(neutralizingFog.attrs.some(attr => attr instanceof WeatherBasedMoveBlockAbAttr)).toBe(true);
    expectDescription(neutralizingFog, "weather-based", "enemy");
  });

  it("adds Mystic Power to Color Spectrum", () => {
    const colorSpectrum = erAbility(700);
    expect(colorSpectrum.attrs.some(attr => attr instanceof StabAddAbAttr)).toBe(true);
    expectDescription(colorSpectrum, "all moves", "stab");
  });

  it("raises Higher Rank's priority boost to 1.3x", () => {
    const higherRank = erAbility(662);
    const priorityBoost = higherRank.attrs.find(attr => attr instanceof MovePowerBoostAbAttr);
    expect(priorityBoost).toBeInstanceOf(MovePowerBoostAbAttr);
    expect((priorityBoost as MovePowerBoostAbAttr).getPowerMultiplier()).toBe(1.3);
    expectDescription(higherRank, "30%", "priority");
  });

  it("adds one-eighth Grassy Terrain healing to Flourish", () => {
    const flourish = erAbility(603);
    const recovery = flourish.attrs.find(attr => attr instanceof PassiveRecoveryAbAttr) as
      | PassiveRecoveryAbAttr
      | undefined;
    expect(recovery).toBeInstanceOf(PassiveRecoveryAbAttr);
    expect(recovery?.getHealFraction()).toBe(1 / 8);
    expect(recovery?.getRecoveryCondition()).toEqual({ kind: "terrain", terrains: [TerrainType.GRASSY] });
    expectDescription(flourish, "1/8", "grassy terrain");
  });

  it("raises Celestial Blessing's Misty Terrain healing to one eighth", () => {
    const celestialBlessing = erAbility(591);
    const recoveries = celestialBlessing.attrs.filter(
      attr => attr instanceof PassiveRecoveryAbAttr,
    ) as PassiveRecoveryAbAttr[];
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0].getHealFraction()).toBe(1 / 8);
    expect(recoveries[0].getRecoveryCondition()).toEqual({ kind: "terrain", terrains: [TerrainType.MISTY] });
    expectDescription(celestialBlessing, "1/8", "misty terrain");
  });

  it("uses first-turn direct damage for Readied Action and Demolitionist", () => {
    for (const draftId of [557, 616]) {
      const ability = erAbility(draftId);
      expect(ability.attrs.some(attr => attr instanceof FirstTurnDirectDamageMultiplierAbAttr)).toBe(true);
      expect(attrNames(ability)).not.toContain("FirstTurnStatMultiplierAbAttr");
      expectDescription(ability, "damage", "first turn");
    }
  });

  it("adds powder immunity to Powder Burst", () => {
    const powderBurst = erAbility(514);
    expect(powderBurst.attrs.some(attr => attr instanceof MoveImmunityAbAttr)).toBe(true);
    expectDescription(powderBurst, "immune", "powder");
  });

  it("propagates upgraded recovery attrs into dependent composites", () => {
    const eternalBlessingRecoveries = erAbility(651).attrs.filter(
      attr => attr instanceof PassiveRecoveryAbAttr,
    ) as PassiveRecoveryAbAttr[];
    expect(eternalBlessingRecoveries.some(attr => attr.getHealFraction() === 1 / 8)).toBe(true);
    expectDescription(erAbility(651), "1/8", "misty terrain", "1/3", "switching out");
    expect(erAbility(686).attrs.some(attr => attr instanceof HolderAndAlliesRecoveryAbAttr)).toBe(true);
    expectDescription(erAbility(686), "25%", "party status", "1/16", "adjacent allies");
  });

  it("keeps the full patched Heavy Metal package on Superheavy after composite refresh", () => {
    const superheavy = erAbility(848);
    expectIncludesAbility(superheavy, allAbilities[AbilityId.HEAVY_METAL]);

    refreshEliteReduxComposites();
    initEliteReduxAbilityUpgrades();

    expectIncludesAbility(superheavy, allAbilities[AbilityId.HEAVY_METAL]);
    expectDescription(superheavy, "heavy metal", "sound");
  });
});
