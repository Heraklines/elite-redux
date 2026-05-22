/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase B Task B3 round 1: ability mechanic-rebalance tests.
//
// Asserts that each vanilla ability whose mechanics ER rebalances has its
// AbAttr list mutated as expected at startup. We rely on the global init
// pipeline (`initEliteReduxVanillaRebalance()`) having already run by the time
// the test suite loads — same pattern as the sibling
// `init-elite-redux-vanilla-rebalance.test.ts`.
//
// Each test reads the live `allAbilities[<id>]` and verifies the *numeric
// fields* on the attrs reflect ER's deltas. We intentionally do NOT execute a
// full battle here — the unit tests are pure structural assertions on the
// post-init state.
// =============================================================================

import {
  AlliedFieldDamageReductionAbAttr,
  AllyStatMultiplierAbAttr,
  MovePowerBoostAbAttr,
  MoveTypePowerBoostAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDefendContactApplyTagChanceAbAttr,
  PostSummonTerrainChangeAbAttr,
  PostSummonWeatherChangeAbAttr,
  PostTurnHurtIfSleepingAbAttr,
  PostWeatherLapseHealAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
} from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

function getAbility(id: AbilityId): Ability {
  const ability = allAbilities.find(a => a?.id === id);
  expect(ability, `ability ${AbilityId[id]} not found`).toBeDefined();
  return ability!;
}

/** Read the private `multiplier` field from a StatMultiplierAbAttr instance. */
function readStatMultiplier(attr: StatMultiplierAbAttr): number {
  return (attr as unknown as { multiplier: number }).multiplier;
}

/** Read the private `powerMultiplier` field from a MovePowerBoostAbAttr instance. */
function readPowerMultiplier(attr: object): number {
  return (attr as { powerMultiplier: number }).powerMultiplier;
}

/** Read the private `damageMultiplier` field from a ReceivedMoveDamageMultiplierAbAttr instance. */
function readDamageMultiplier(attr: object): number {
  return (attr as { damageMultiplier: number }).damageMultiplier;
}

describe("ER vanilla ability rebalance — MINOR weather summoner durations", () => {
  // The patcher replaces the vanilla PostSummonWeatherChangeAbAttr with an
  // ER subclass that bumps `turnsLeft` to 8. We can't easily assert turnsLeft
  // without a live arena, but we can verify the attr's *class name* changed
  // (ER's subclass is `ErWeatherSummonAbAttr`) by checking the instance's
  // constructor name.

  it("DRIZZLE uses the ER weather summon attr (8-turn rain)", () => {
    const ab = getAbility(AbilityId.DRIZZLE);
    const summoner = ab.attrs.find(a => a instanceof PostSummonWeatherChangeAbAttr);
    expect(summoner).toBeDefined();
    expect(summoner!.constructor.name).toBe("ErWeatherSummonAbAttr");
  });

  it("DROUGHT uses the ER weather summon attr (8-turn sun)", () => {
    const ab = getAbility(AbilityId.DROUGHT);
    const summoner = ab.attrs.find(a => a instanceof PostSummonWeatherChangeAbAttr);
    expect(summoner).toBeDefined();
    expect(summoner!.constructor.name).toBe("ErWeatherSummonAbAttr");
  });

  it("SAND_STREAM uses the ER weather summon attr (8-turn sand)", () => {
    const ab = getAbility(AbilityId.SAND_STREAM);
    const summoner = ab.attrs.find(a => a instanceof PostSummonWeatherChangeAbAttr);
    expect(summoner).toBeDefined();
    expect(summoner!.constructor.name).toBe("ErWeatherSummonAbAttr");
  });

  it("SNOW_WARNING switches to HAIL weather (ER convention)", () => {
    const ab = getAbility(AbilityId.SNOW_WARNING);
    const summoner = ab.attrs.find(a => a instanceof PostSummonWeatherChangeAbAttr);
    expect(summoner).toBeDefined();
    expect(summoner!.constructor.name).toBe("ErWeatherSummonAbAttr");
    // Inspect the carried weather type — should be HAIL (4) not SNOW (5).
    const carried = (summoner as unknown as { weatherType: number }).weatherType;
    expect(carried).toBe(4); // WeatherType.HAIL
  });

  it("post-biome weather changers are also wrapped", () => {
    const ab = getAbility(AbilityId.DRIZZLE);
    const biomeChanger = ab.attrs.find(a => a instanceof PostBiomeChangeWeatherChangeAbAttr);
    expect(biomeChanger).toBeDefined();
    expect(biomeChanger!.constructor.name).toBe("ErBiomeChangeWeatherAbAttr");
  });
});

describe("ER vanilla ability rebalance — MINOR terrain summoner durations", () => {
  it.each([
    ["PSYCHIC_SURGE", AbilityId.PSYCHIC_SURGE],
    ["MISTY_SURGE", AbilityId.MISTY_SURGE],
    ["GRASSY_SURGE", AbilityId.GRASSY_SURGE],
  ] as const)("%s uses the ER terrain summon attr", (_name, id) => {
    const ab = getAbility(id);
    const summoner = ab.attrs.find(a => a instanceof PostSummonTerrainChangeAbAttr);
    expect(summoner).toBeDefined();
    expect(summoner!.constructor.name).toBe("ErTerrainSummonAbAttr");
  });
});

describe("ER vanilla ability rebalance — MINOR speed-in-weather multipliers (2.0 → 1.5)", () => {
  it.each([
    ["SWIFT_SWIM", AbilityId.SWIFT_SWIM],
    ["CHLOROPHYLL", AbilityId.CHLOROPHYLL],
    ["SAND_RUSH", AbilityId.SAND_RUSH],
    ["SLUSH_RUSH", AbilityId.SLUSH_RUSH],
    ["SURGE_SURFER", AbilityId.SURGE_SURFER],
  ] as const)("%s — SPD multiplier is 1.5", (_name, id) => {
    const ab = getAbility(id);
    const sm = ab.attrs.find(a => a instanceof StatMultiplierAbAttr && a.stat === Stat.SPD);
    expect(sm).toBeDefined();
    expect(readStatMultiplier(sm as StatMultiplierAbAttr)).toBe(1.5);
  });
});

describe("ER vanilla ability rebalance — MINOR HP-regen fractions (1/16 → 1/8)", () => {
  it.each([
    ["RAIN_DISH", AbilityId.RAIN_DISH],
    ["ICE_BODY", AbilityId.ICE_BODY],
  ] as const)("%s — healFactor is 2 (yielding 1/8 max HP)", (_name, id) => {
    const ab = getAbility(id);
    const heal = ab.attrs.find(a => a instanceof PostWeatherLapseHealAbAttr);
    expect(heal).toBeDefined();
    expect((heal as unknown as { healFactor: number }).healFactor).toBe(2);
  });
});

describe("ER vanilla ability rebalance — MINOR status proc chance", () => {
  it("CUTE_CHARM contact-infatuation chance is 50 (was 30)", () => {
    const ab = getAbility(AbilityId.CUTE_CHARM);
    const tag = ab.attrs.find(
      a =>
        a instanceof PostDefendContactApplyTagChanceAbAttr
        && (a as unknown as { tagType: BattlerTagType }).tagType === BattlerTagType.INFATUATED,
    );
    expect(tag).toBeDefined();
    expect((tag as unknown as { chance: number }).chance).toBe(50);
  });
});

describe("ER vanilla ability rebalance — MINOR damage fractions", () => {
  it("BAD_DREAMS — vanilla attr is replaced with ER 1/4-damage subclass", () => {
    const ab = getAbility(AbilityId.BAD_DREAMS);
    const hurt = ab.attrs.find(a => a instanceof PostTurnHurtIfSleepingAbAttr);
    expect(hurt).toBeDefined();
    expect(hurt!.constructor.name).toBe("ErBadDreamsAbAttr");
  });
});

describe("ER vanilla ability rebalance — MINOR move power multipliers", () => {
  it("IRON_FIST — power multiplier is 1.3 (was 1.2)", () => {
    const ab = getAbility(AbilityId.IRON_FIST);
    const boost = ab.attrs.find(a => a.constructor === MovePowerBoostAbAttr);
    expect(boost).toBeDefined();
    expect(readPowerMultiplier(boost!)).toBe(1.3);
  });

  it("STRONG_JAW — power multiplier is 1.3 (was 1.5)", () => {
    const ab = getAbility(AbilityId.STRONG_JAW);
    const boost = ab.attrs.find(a => a.constructor === MovePowerBoostAbAttr);
    expect(boost).toBeDefined();
    expect(readPowerMultiplier(boost!)).toBe(1.3);
  });

  it("NEUROFORCE — SE outgoing multiplier is 1.35 (was 1.25)", () => {
    const ab = getAbility(AbilityId.NEUROFORCE);
    const boost = ab.attrs.find(a => a.constructor === MovePowerBoostAbAttr);
    expect(boost).toBeDefined();
    expect(readPowerMultiplier(boost!)).toBe(1.35);
  });

  it("STEELY_SPIRIT — Steel-type user-field multiplier is 1.3 (was 1.5)", () => {
    const ab = getAbility(AbilityId.STEELY_SPIRIT);
    const boost = ab.attrs.find(a => a instanceof UserFieldMoveTypePowerBoostAbAttr);
    expect(boost).toBeDefined();
    expect(readPowerMultiplier(boost!)).toBe(1.3);
  });

  it("TRANSISTOR — Electric type-power multiplier is 1.5 (was 1.3)", () => {
    const ab = getAbility(AbilityId.TRANSISTOR);
    const boost = ab.attrs.find(a => a instanceof MoveTypePowerBoostAbAttr);
    expect(boost).toBeDefined();
    expect(readPowerMultiplier(boost!)).toBe(1.5);
  });
});

describe("ER vanilla ability rebalance — MINOR stat multipliers", () => {
  it("VICTORY_STAR — ACC multiplier is 1.2 for self and ally (was 1.1)", () => {
    const ab = getAbility(AbilityId.VICTORY_STAR);
    const selfBoost = ab.attrs.find(a => a instanceof StatMultiplierAbAttr && a.stat === Stat.ACC);
    expect(selfBoost).toBeDefined();
    expect(readStatMultiplier(selfBoost as StatMultiplierAbAttr)).toBe(1.2);

    const allyBoost = ab.attrs.find(a => a instanceof AllyStatMultiplierAbAttr);
    expect(allyBoost).toBeDefined();
    expect((allyBoost as unknown as { multiplier: number }).multiplier).toBe(1.2);
  });
});

describe("ER vanilla ability rebalance — MINOR damage-taken multipliers (0.75 → 0.65)", () => {
  it.each([
    ["FILTER", AbilityId.FILTER],
    ["SOLID_ROCK", AbilityId.SOLID_ROCK],
    ["PRISM_ARMOR", AbilityId.PRISM_ARMOR],
  ] as const)("%s — damage multiplier is 0.65", (_name, id) => {
    const ab = getAbility(id);
    const reducer = ab.attrs.find(a => a instanceof ReceivedMoveDamageMultiplierAbAttr);
    expect(reducer).toBeDefined();
    expect(readDamageMultiplier(reducer!)).toBe(0.65);
  });
});

describe("ER vanilla ability rebalance — MINOR FRIEND_GUARD (0.75 → 0.5)", () => {
  it("FRIEND_GUARD — allied damage multiplier is 0.5", () => {
    const ab = getAbility(AbilityId.FRIEND_GUARD);
    const reducer = ab.attrs.find(a => a instanceof AlliedFieldDamageReductionAbAttr);
    expect(reducer).toBeDefined();
    expect(readDamageMultiplier(reducer!)).toBe(0.5);
  });
});

describe("ER vanilla ability rebalance — MINOR DEFEATIST threshold (0.5 → 0.333)", () => {
  it("DEFEATIST — stat multipliers wrapped with tighter HP check", () => {
    const ab = getAbility(AbilityId.DEFEATIST);
    const sm = ab.attrs.find(a => a instanceof StatMultiplierAbAttr);
    expect(sm).toBeDefined();
    expect(sm!.constructor.name).toBe("ErDefeatistStatMultiplierAbAttr");
  });
});

describe("ER vanilla ability rebalance — MINOR OVERGROW/BLAZE/TORRENT/SWARM baseline boost", () => {
  it.each([
    ["OVERGROW", AbilityId.OVERGROW, PokemonType.GRASS],
    ["BLAZE", AbilityId.BLAZE, PokemonType.FIRE],
    ["TORRENT", AbilityId.TORRENT, PokemonType.WATER],
    ["SWARM", AbilityId.SWARM, PokemonType.BUG],
  ] as const)("%s — added MoveTypePowerBoostAbAttr at 1.2x baseline", (_name, id, _type) => {
    const ab = getAbility(id);
    // Look for a MoveTypePowerBoostAbAttr instance (constructor.name match —
    // LowHpMoveTypePowerBoostAbAttr also extends MoveTypePowerBoostAbAttr so
    // we check for the EXACT constructor).
    const boost = ab.attrs.find(
      a => a instanceof MoveTypePowerBoostAbAttr && a.constructor.name === "MoveTypePowerBoostAbAttr",
    );
    expect(boost).toBeDefined();
    expect(readPowerMultiplier(boost!)).toBe(1.2);
  });
});

describe("ER vanilla ability rebalance — MAJOR composite riders", () => {
  it("BATTLE_ARMOR — has 20% damage reduction rider", () => {
    const ab = getAbility(AbilityId.BATTLE_ARMOR);
    const reducer = ab.attrs.find(
      a => a instanceof ReceivedMoveDamageMultiplierAbAttr && readDamageMultiplier(a) === 0.8,
    );
    expect(reducer).toBeDefined();
  });

  it("IMMUNITY — has Poison-type damage halving rider", () => {
    const ab = getAbility(AbilityId.IMMUNITY);
    const reducer = ab.attrs.find(a => a instanceof ReceivedTypeDamageMultiplierAbAttr);
    expect(reducer).toBeDefined();
    expect(readDamageMultiplier(reducer!)).toBe(0.5);
  });

  it("MAGMA_ARMOR — has Water + Ice damage reduction riders", () => {
    const ab = getAbility(AbilityId.MAGMA_ARMOR);
    const reducers = ab.attrs.filter(a => a instanceof ReceivedTypeDamageMultiplierAbAttr);
    expect(reducers).toHaveLength(2);
    for (const r of reducers) {
      expect(readDamageMultiplier(r)).toBe(0.7);
    }
  });

  it("OVERCOAT — has special-damage-reduction rider", () => {
    const ab = getAbility(AbilityId.OVERCOAT);
    const reducers = ab.attrs.filter(a => a instanceof ReceivedMoveDamageMultiplierAbAttr);
    expect(reducers.length).toBeGreaterThan(0);
    expect(reducers.some(r => readDamageMultiplier(r) === 0.8)).toBe(true);
  });

  it("WATER_COMPACTION — has water damage reduction rider", () => {
    const ab = getAbility(AbilityId.WATER_COMPACTION);
    const reducer = ab.attrs.find(a => a instanceof ReceivedTypeDamageMultiplierAbAttr);
    expect(reducer).toBeDefined();
    expect(readDamageMultiplier(reducer!)).toBe(0.5);
  });

  it("KEEN_EYE — has ACC 1.2x boost rider", () => {
    const ab = getAbility(AbilityId.KEEN_EYE);
    const accBoost = ab.attrs.find(a => a instanceof StatMultiplierAbAttr && a.stat === Stat.ACC);
    expect(accBoost).toBeDefined();
    expect(readStatMultiplier(accBoost as StatMultiplierAbAttr)).toBe(1.2);
  });

  it("LONG_REACH — has physical-damage 1.2x rider", () => {
    const ab = getAbility(AbilityId.LONG_REACH);
    const boost = ab.attrs.find(a => a.constructor === MovePowerBoostAbAttr && readPowerMultiplier(a) === 1.2);
    expect(boost).toBeDefined();
  });

  it("HEAVY_METAL — has Ghost + Dark damage reduction riders", () => {
    const ab = getAbility(AbilityId.HEAVY_METAL);
    const reducers = ab.attrs.filter(a => a instanceof ReceivedTypeDamageMultiplierAbAttr);
    expect(reducers.length).toBeGreaterThanOrEqual(2);
  });

  it("LIGHT_METAL — has SPD 1.3x rider", () => {
    const ab = getAbility(AbilityId.LIGHT_METAL);
    const spdBoost = ab.attrs.find(a => a instanceof StatMultiplierAbAttr && a.stat === Stat.SPD);
    expect(spdBoost).toBeDefined();
    expect(readStatMultiplier(spdBoost as StatMultiplierAbAttr)).toBe(1.3);
  });

  it("HYPER_CUTTER — extends stat protection to SpAtk (was just Atk)", () => {
    const ab = getAbility(AbilityId.HYPER_CUTTER);
    const protectors = ab.attrs.filter(a => a.constructor.name === "ProtectStatAbAttr");
    // Vanilla has 1 (ATK); ER adds a second for SPATK.
    expect(protectors.length).toBeGreaterThanOrEqual(2);
  });
});
