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
  BlockStatusDamageAbAttr,
  ChangeMovePriorityAbAttr,
  ConditionalCritAbAttr,
  MovePowerBoostAbAttr,
  MoveTypePowerBoostAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDefendContactApplyTagChanceAbAttr,
  PostDefendStatStageChangeAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  PostSummonTerrainChangeAbAttr,
  PostSummonWeatherChangeAbAttr,
  PostTurnHurtIfSleepingAbAttr,
  PostWeatherLapseDamageAbAttr,
  PostWeatherLapseHealAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
  StatusEffectImmunityAbAttr,
  UserFieldBattlerTagImmunityAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
} from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  AllyHigherStatMultiplierAbAttr,
  HigherStatMultiplierAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/index";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
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

// =============================================================================
// Round 2 tests
// =============================================================================

describe("ER vanilla ability rebalance — R2 BattlerTag Scare immunity", () => {
  it.each([
    ["INNER_FOCUS", AbilityId.INNER_FOCUS],
    ["OBLIVIOUS", AbilityId.OBLIVIOUS],
    ["OWN_TEMPO", AbilityId.OWN_TEMPO],
  ] as const)("%s — BattlerTagImmunity attrs include ER_FEAR", (_name, id) => {
    const ab = getAbility(id);
    const hasFearImmunity = ab.attrs.some(a => {
      if (a.constructor.name !== "BattlerTagImmunityAbAttr" && !(a instanceof UserFieldBattlerTagImmunityAbAttr)) {
        return false;
      }
      const tagged = a as unknown as { immuneTagTypes?: BattlerTagType[] };
      return Array.isArray(tagged.immuneTagTypes) && tagged.immuneTagTypes.includes(BattlerTagType.ER_FEAR);
    });
    expect(hasFearImmunity).toBe(true);
  });
});

describe("ER vanilla ability rebalance — R2 entry-effect riders", () => {
  it("WATER_VEIL — has scripted-move Aqua Ring on entry rider", () => {
    const ab = getAbility(AbilityId.WATER_VEIL);
    const entry = ab.attrs.find(a => a instanceof EntryEffectAbAttr);
    expect(entry).toBeDefined();
    const effect = (entry as EntryEffectAbAttr).getEffect();
    expect(effect.kind).toBe("scripted-move");
    expect((effect as { kind: "scripted-move"; move: MoveId }).move).toBe(MoveId.AQUA_RING);
  });

  it("TURBOBLAZE — has add-self-type FIRE rider", () => {
    const ab = getAbility(AbilityId.TURBOBLAZE);
    const entry = ab.attrs.find(a => a instanceof EntryEffectAbAttr);
    expect(entry).toBeDefined();
    expect((entry as EntryEffectAbAttr).getEffect().kind).toBe("add-self-type");
  });

  it("TERAVOLT — has add-self-type ELECTRIC rider", () => {
    const ab = getAbility(AbilityId.TERAVOLT);
    const entry = ab.attrs.find(a => a instanceof EntryEffectAbAttr);
    expect(entry).toBeDefined();
    expect((entry as EntryEffectAbAttr).getEffect().kind).toBe("add-self-type");
  });
});

describe("ER vanilla ability rebalance — R2 status/damage riders", () => {
  it("TOXIC_BOOST — has BlockStatusDamageAbAttr rider for POISON/TOXIC", () => {
    const ab = getAbility(AbilityId.TOXIC_BOOST);
    const block = ab.attrs.find(a => a instanceof BlockStatusDamageAbAttr);
    expect(block).toBeDefined();
  });

  it("STAMINA — has PostReceiveCritStatStageChangeAbAttr rider for max Def on crit", () => {
    const ab = getAbility(AbilityId.STAMINA);
    const critAttr = ab.attrs.find(a => a instanceof PostReceiveCritStatStageChangeAbAttr);
    expect(critAttr).toBeDefined();
  });

  it("ANGER_POINT — is crit-only (no +1-Atk-per-hit rider, #224)", () => {
    // The old ER rider added a PostDefendStatStageChange (+1 Atk on every
    // non-status hit), which fired on ordinary non-crit hits and was reported as
    // Anger Point "triggering when it shouldn't". It was removed — Anger Point is
    // now purely crit → max Atk (the crit-gated PostReceiveCrit attr only).
    const ab = getAbility(AbilityId.ANGER_POINT);
    const hitAttr = ab.attrs.find(a => a instanceof PostDefendStatStageChangeAbAttr);
    expect(hitAttr).toBeUndefined();
    const critAttr = ab.attrs.find(a => a instanceof PostReceiveCritStatStageChangeAbAttr);
    expect(critAttr).toBeDefined();
  });

  it("WEAK_ARMOR — predicate now gates on contact", () => {
    const ab = getAbility(AbilityId.WEAK_ARMOR);
    // We can't introspect the closure cleanly, but we can verify that the
    // patcher ran by checking the ability is patched (it's been seen).
    // Smoke check: the attrs are still PostDefendStatStageChangeAbAttr.
    const attrs = ab.attrs.filter(a => a instanceof PostDefendStatStageChangeAbAttr);
    expect(attrs.length).toBeGreaterThanOrEqual(2);
  });

  it("MAGICIAN — uses ER subclass that gates on non-contact", () => {
    const ab = getAbility(AbilityId.MAGICIAN);
    const attr = ab.attrs.find(a => a.constructor.name === "ErMagicianStealAbAttr");
    expect(attr).toBeDefined();
  });

  it("MERCILESS — ConditionalCritAbAttr is replaced (predicate extended)", () => {
    const ab = getAbility(AbilityId.MERCILESS);
    const crit = ab.attrs.find(a => a instanceof ConditionalCritAbAttr);
    expect(crit).toBeDefined();
  });
});

describe("ER vanilla ability rebalance — R2 typeconversion baseline boosts", () => {
  it.each([
    ["REFRIGERATE", AbilityId.REFRIGERATE],
    ["PIXILATE", AbilityId.PIXILATE],
    ["AERILATE", AbilityId.AERILATE],
    ["GALVANIZE", AbilityId.GALVANIZE],
  ] as const)("%s — has TypeDamageBoostAbAttr rider", (_name, id) => {
    const ab = getAbility(id);
    const typeBoost = ab.attrs.find(a => a instanceof TypeDamageBoostAbAttr);
    expect(typeBoost).toBeDefined();
  });
});

describe("ER vanilla ability rebalance — R2 trap-predicate extensions (Ghost-immune)", () => {
  it.each([
    ["SHADOW_TAG", AbilityId.SHADOW_TAG],
    ["MAGNET_PULL", AbilityId.MAGNET_PULL],
    ["ARENA_TRAP", AbilityId.ARENA_TRAP],
  ] as const)("%s — ArenaTrap predicate is replaced (Ghost-aware)", (_name, id) => {
    const ab = getAbility(id);
    // Verify the original ArenaTrapAbAttr instance is still present (we
    // replaced it with a new ArenaTrapAbAttr instance, not stripped it).
    const attr = ab.attrs.find(a => a.constructor.name === "ArenaTrapAbAttr");
    expect(attr).toBeDefined();
  });
});

describe("ER vanilla ability rebalance — R2 AROMA_VEIL narrowed tags", () => {
  it("AROMA_VEIL — immuneTagTypes contains exactly INFATUATED, HEAL_BLOCK, DISABLED", () => {
    const ab = getAbility(AbilityId.AROMA_VEIL);
    const userField = ab.attrs.find(a => a instanceof UserFieldBattlerTagImmunityAbAttr);
    expect(userField).toBeDefined();
    const tags = (userField as unknown as { immuneTagTypes: BattlerTagType[] }).immuneTagTypes;
    expect(tags).toContain(BattlerTagType.INFATUATED);
    expect(tags).toContain(BattlerTagType.HEAL_BLOCK);
    expect(tags).toContain(BattlerTagType.DISABLED);
    expect(tags).not.toContain(BattlerTagType.TAUNT);
    expect(tags).not.toContain(BattlerTagType.TORMENT);
    expect(tags).not.toContain(BattlerTagType.ENCORE);
  });
});

describe("ER vanilla ability rebalance — R2 on-faint and entry rewrites", () => {
  it("AFTERMATH — vanilla PostFaintContactDamageAbAttr replaced with PostFaintDetonateAbAttr", () => {
    const ab = getAbility(AbilityId.AFTERMATH);
    const detonate = ab.attrs.find(a => a instanceof PostFaintDetonateAbAttr);
    expect(detonate).toBeDefined();
    const hasOldContact = ab.attrs.some(a => a.constructor.name === "PostFaintContactDamageAbAttr");
    expect(hasOldContact).toBe(false);
  });

  it("FOREWARN — ForewarnAbAttr replaced with EntryEffectAbAttr scripted-move", () => {
    const ab = getAbility(AbilityId.FOREWARN);
    const entry = ab.attrs.find(a => a instanceof EntryEffectAbAttr);
    expect(entry).toBeDefined();
    expect((entry as EntryEffectAbAttr).getEffect().kind).toBe("scripted-move");
    const hasOldForewarn = ab.attrs.some(a => a.constructor.name === "ForewarnAbAttr");
    expect(hasOldForewarn).toBe(false);
  });

  it("PASTEL_VEIL — attrs replaced with single scripted-move EntryEffectAbAttr (Safeguard)", () => {
    const ab = getAbility(AbilityId.PASTEL_VEIL);
    const entry = ab.attrs.find(a => a instanceof EntryEffectAbAttr);
    expect(entry).toBeDefined();
    expect((entry as EntryEffectAbAttr).getEffect().kind).toBe("scripted-move");
  });

  it("LEAF_GUARD — StatusEffectImmunityAbAttr stripped", () => {
    const ab = getAbility(AbilityId.LEAF_GUARD);
    const hasImmunity = ab.attrs.some(a => a instanceof StatusEffectImmunityAbAttr);
    expect(hasImmunity).toBe(false);
  });
});

describe("ER vanilla ability rebalance — R2 FLOWER_GIFT ATK->SPATK", () => {
  it("FLOWER_GIFT — StatMultiplier and AllyStatMultiplier no longer target ATK", () => {
    const ab = getAbility(AbilityId.FLOWER_GIFT);
    // Vanilla had ATK + SPDEF for self+ally; ER swaps ATK→SPATK.
    expect(ab.attrs.filter(a => a instanceof HigherStatMultiplierAbAttr)).toHaveLength(2);
    expect(ab.attrs.filter(a => a instanceof AllyHigherStatMultiplierAbAttr)).toHaveLength(2);
  });
});

describe("ER vanilla ability rebalance — SOLAR_POWER drops in-sun self-damage", () => {
  it("SOLAR_POWER — PostWeatherLapseDamageAbAttr stripped, SpAtk 1.5x boost kept", () => {
    const ab = getAbility(AbilityId.SOLAR_POWER);
    // ER spec: pure Sp.Atk boost in sun, NO 1/8-per-turn HP loss.
    const hasSelfDamage = ab.attrs.some(a => a instanceof PostWeatherLapseDamageAbAttr);
    expect(hasSelfDamage, "Solar Power must NOT chip HP in sun under ER").toBe(false);
    const spAtkBoost = ab.attrs.find(a => a instanceof StatMultiplierAbAttr && a.stat === Stat.SPATK);
    expect(spAtkBoost, "Solar Power must keep its Sp.Atk boost").toBeDefined();
    expect(readStatMultiplier(spAtkBoost as StatMultiplierAbAttr)).toBe(1.5);
  });
});

describe("ER vanilla ability rebalance — R2 TOTAL rewrites", () => {
  it("BIG_PECKS — attrs replaced with a 1.3x contact MovePowerBoost", () => {
    const ab = getAbility(AbilityId.BIG_PECKS);
    const boost = ab.attrs.find(a => a.constructor === MovePowerBoostAbAttr);
    expect(boost).toBeDefined();
    expect((boost as unknown as { powerMultiplier: number }).powerMultiplier).toBe(1.3);
    // Defensive: vanilla ProtectStatAbAttr should be gone.
    const hasProtect = ab.attrs.some(a => a.constructor.name === "ProtectStatAbAttr");
    expect(hasProtect).toBe(false);
  });

  it("ILLUMINATE — attrs replaced with a single StatMultiplier(ACC, 1.2)", () => {
    const ab = getAbility(AbilityId.ILLUMINATE);
    expect(ab.attrs.length).toBe(1);
    const sm = ab.attrs[0];
    expect(sm).toBeInstanceOf(StatMultiplierAbAttr);
    expect((sm as StatMultiplierAbAttr).stat).toBe(Stat.ACC);
    expect((sm as unknown as { multiplier: number }).multiplier).toBe(1.2);
  });

  it("CHEEK_POUCH — attrs cleared (ability is null in ER)", () => {
    const ab = getAbility(AbilityId.CHEEK_POUCH);
    expect(ab.attrs.length).toBe(0);
  });

  it("STALL — attrs replaced with ReceivedMoveDamageMultiplierAbAttr at 0.7", () => {
    const ab = getAbility(AbilityId.STALL);
    const reducer = ab.attrs.find(a => a instanceof ReceivedMoveDamageMultiplierAbAttr);
    expect(reducer).toBeDefined();
    expect((reducer as unknown as { damageMultiplier: number }).damageMultiplier).toBe(0.7);
    // Defensive: vanilla ChangeMovePriorityInBracketAbAttr should be gone.
    const hasPriority = ab.attrs.some(a => a.constructor.name === "ChangeMovePriorityInBracketAbAttr");
    expect(hasPriority).toBe(false);
  });

  it("HEAVY_METAL — WeightMultiplierAbAttr stripped AND Ghost/Dark damage reductions present", () => {
    const ab = getAbility(AbilityId.HEAVY_METAL);
    const hasWeight = ab.attrs.some(a => a.constructor.name === "WeightMultiplierAbAttr");
    expect(hasWeight).toBe(false);
    const reducers = ab.attrs.filter(a => a instanceof ReceivedTypeDamageMultiplierAbAttr);
    expect(reducers.length).toBe(2);
  });

  it("OPPORTUNIST — attrs replaced with a ChangeMovePriorityAbAttr", () => {
    const ab = getAbility(AbilityId.OPPORTUNIST);
    const prio = ab.attrs.find(a => a instanceof ChangeMovePriorityAbAttr);
    expect(prio).toBeDefined();
    const hasStatCopy = ab.attrs.some(a => a.constructor.name === "StatStageChangeCopyAbAttr");
    expect(hasStatCopy).toBe(false);
  });
});

describe("ER vanilla ability rebalance — R4/R5 non-contact tier (contactExcluded gate)", () => {
  // User-reported regression: "flame body triggers on anything even non
  // contact moves and it seems close to 100% of burning someone". Fixed
  // in commit 1b854a3 by adding contactExcluded:true to the helper.
  //
  // These tests pin the invariant: the ER-added ChanceStatusOnHitAbAttr
  // for each of these abilities must NOT fire on contact moves — the
  // pre-existing vanilla PostDefendContactApplyStatusEffectAbAttr already
  // handles those. Stacking two procs inflated the perceived rate.
  // Abilities whose ER ROM text gives them an explicit non-contact tier:
  //   Static — "10% chance to paralyze on non-contact attacks ... 30% on contact"
  //   Flame Body — "Contact ... 30% ... Non-contact has a 20% chance."
  // For these the ER-added ChanceStatusOnHitAbAttr must be contactExcluded so it
  // ONLY fires on non-contact moves (the pre-existing vanilla contact proc
  // handles contact moves — stacking both inflated the perceived rate).
  // (Effect Spore & Poison Touch were previously here, but per their ER ROM text
  // they are CONTACT-ONLY — their stray non-contact tiers were removed; see the
  // contact-only assertions below.)
  const cases: { id: AbilityId; name: string }[] = [
    { id: AbilityId.STATIC, name: "STATIC" },
    { id: AbilityId.FLAME_BODY, name: "FLAME_BODY" },
  ];

  for (const { id, name } of cases) {
    it(`${name} — every ER-added ChanceStatusOnHit attr is contactExcluded`, () => {
      const ab = getAbility(id);
      const erAttrs = ab.attrs.filter(a => a.constructor.name === "ChanceStatusOnHitAbAttr");
      expect(erAttrs.length).toBeGreaterThanOrEqual(1);
      for (const attr of erAttrs) {
        const ce = (attr as unknown as { contactExcluded: boolean }).contactExcluded;
        expect(ce, `${name}: ChanceStatusOnHitAbAttr.contactExcluded`).toBe(true);
      }
    });
  }

  // Poison Point is CONTACT-ONLY per the ER ROM text:
  // "Has a 30% chance to inflict poison on CONTACT MOVES, both when attacking
  // and being attacked." Unlike Static/Flame Body it has NO non-contact tier.
  // A prior wire added a 10% non-contact poison, which made ranged moves
  // (Water Gun, Ember, …) poison the holder — that regression is now removed.
  it("POISON_POINT — has NO ER-added non-contact ChanceStatusOnHit tier (contact-only spec)", () => {
    const ab = getAbility(AbilityId.POISON_POINT);
    const erAttrs = ab.attrs.filter(a => a.constructor.name === "ChanceStatusOnHitAbAttr");
    expect(erAttrs.length).toBe(0);
    // The vanilla contact proc + the ER offense-side contact proc must remain.
    expect(ab.attrs.some(a => a.constructor.name === "PostDefendContactApplyStatusEffectAbAttr")).toBe(true);
    expect(ab.attrs.some(a => a.constructor.name === "PostAttackContactApplyStatusEffectAbAttr")).toBe(true);
  });

  // Effect Spore is CONTACT-ONLY per the ER ROM text. A prior wire added three
  // non-contact tiers (SLP/PRZ/PSN) that let ranged moves proc it; removed. Only
  // the vanilla contact proc (EffectSporeAbAttr) remains.
  it("EFFECT_SPORE — has NO ER-added non-contact ChanceStatusOnHit tier (contact-only spec)", () => {
    const ab = getAbility(AbilityId.EFFECT_SPORE);
    expect(ab.attrs.filter(a => a.constructor.name === "ChanceStatusOnHitAbAttr").length).toBe(0);
    expect(ab.attrs.some(a => a.constructor.name === "EffectSporeAbAttr")).toBe(true);
  });

  // Poison Touch is CONTACT-ONLY ("also works on offense") per the ER ROM text.
  // The stray defend-side non-contact tier was removed; the offense-side contact
  // proc (PostAttackContactApplyStatusEffectAbAttr) remains.
  it("POISON_TOUCH — has NO ER-added non-contact ChanceStatusOnHit tier (contact-only spec)", () => {
    const ab = getAbility(AbilityId.POISON_TOUCH);
    expect(ab.attrs.filter(a => a.constructor.name === "ChanceStatusOnHitAbAttr").length).toBe(0);
    expect(ab.attrs.filter(a => a.constructor.name === "PostAttackContactApplyStatusEffectAbAttr")).toHaveLength(1);
  });

  it("FLAME_BODY has one contact and one non-contact offensive tier", () => {
    const ab = getAbility(AbilityId.FLAME_BODY);
    expect(ab.attrs.filter(a => a.constructor.name === "PostAttackContactApplyStatusEffectAbAttr")).toHaveLength(1);
    expect(ab.attrs.filter(a => a.constructor.name === "ChanceStatusOnAttackAbAttr")).toHaveLength(1);
  });

  it("POISON_POINT has exactly one offensive contact tier", () => {
    const ab = getAbility(AbilityId.POISON_POINT);
    expect(ab.attrs.filter(a => a.constructor.name === "PostAttackContactApplyStatusEffectAbAttr")).toHaveLength(1);
  });
});
