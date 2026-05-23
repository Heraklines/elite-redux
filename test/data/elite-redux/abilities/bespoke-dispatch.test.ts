/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke tests: dispatcher per-id routing.
//
// Verifies that the dispatcher's `bespoke` branch routes the wired ER ability
// ids to the right AbAttr constructors. The dispatcher is the single place
// `init-elite-redux-custom-abilities.ts` calls into when assembling the
// ability's attrs list, so wiring correctness here propagates to the runtime.
//
// We intentionally call `dispatchArchetype("bespoke", null, erAbilityId)` —
// matching what the init layer does for `bespoke` rows.
// =============================================================================

import {
  BlockRecoilDamageAttr,
  PostDefendContactDamageAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  ProtectStatAbAttr,
} from "#abilities/ab-attrs";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ChanceBattlerTagOnHitAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";
import { CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { LifestealOnKoAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { StatTriggerOnHitAbAttr, StatTriggerOnKoAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { StatusEffectImmunityAbAttrEr } from "#data/elite-redux/archetypes/status-immunity";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { WeatherStatMultiplierAbAttr } from "#data/elite-redux/archetypes/weather-stat-multiplier";
import { WeatherDamageReductionAbAttr } from "#data/elite-redux/archetypes/weather-terrain-interaction";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { describe, expect, it } from "vitest";

describe("dispatchArchetype('bespoke', null, erAbilityId): per-id wiring", () => {
  it("er id 396 (Steel Barrel) wires BlockRecoilDamageAttr", () => {
    const res = dispatchArchetype("bespoke", null, 396);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(BlockRecoilDamageAttr);
  });

  it("er id 411 (Toxic Spill) wires PostTurnHurtNonTyped with Poison safe-type, 1/8", () => {
    const res = dispatchArchetype("bespoke", null, 411);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0];
    expect(attr).toBeInstanceOf(PostTurnHurtNonTypedAbAttr);
    const ptAttr = attr as PostTurnHurtNonTypedAbAttr;
    expect(ptAttr.getSafeTypes()).toEqual([PokemonType.POISON]);
    expect(ptAttr.getDamageFraction()).toBeCloseTo(1 / 8);
  });

  it("er id 663 (Funeral Pyre) wires PostTurnHurtNonTyped with Ghost+Dark safe-types, 1/4", () => {
    const res = dispatchArchetype("bespoke", null, 663);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const ptAttr = res.attrs[0] as PostTurnHurtNonTypedAbAttr;
    expect(ptAttr.getSafeTypes()).toEqual([PokemonType.GHOST, PokemonType.DARK]);
    expect(ptAttr.getDamageFraction()).toBeCloseTo(1 / 4);
  });

  it("er id 775 (Flame Coat) wires PostTurnHurtNonTyped with Fire safe-type, 1/8", () => {
    const res = dispatchArchetype("bespoke", null, 775);
    expect(res.skipReason).toBeNull();
    const ptAttr = res.attrs[0] as PostTurnHurtNonTypedAbAttr;
    expect(ptAttr.getSafeTypes()).toEqual([PokemonType.FIRE]);
  });

  it("er id 898 (Power Leak) wires SetTerrainOnHit with Electric Terrain", () => {
    const res = dispatchArchetype("bespoke", null, 898);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stAttr = res.attrs[0] as SetTerrainOnHitAbAttr;
    expect(stAttr).toBeInstanceOf(SetTerrainOnHitAbAttr);
    expect(stAttr.getTerrain()).toBe(TerrainType.ELECTRIC);
  });

  it("er id 906 (Drop Blocks) wires SetArenaTagOnHit with Spikes on attacker side", () => {
    const res = dispatchArchetype("bespoke", null, 906);
    expect(res.skipReason).toBeNull();
    const sAttr = res.attrs[0] as SetArenaTagOnHitAbAttr;
    expect(sAttr).toBeInstanceOf(SetArenaTagOnHitAbAttr);
    expect(sAttr.getTagType()).toBe(ArenaTagType.SPIKES);
    expect(sAttr.getSide()).toBe("attacker");
    expect(sAttr.requiresContact()).toBe(false);
  });

  it("er id 909 (Loose Thorns) wires SetArenaTagOnHit with contactRequired=true", () => {
    const res = dispatchArchetype("bespoke", null, 909);
    expect(res.skipReason).toBeNull();
    const sAttr = res.attrs[0] as SetArenaTagOnHitAbAttr;
    expect(sAttr.requiresContact()).toBe(true);
  });

  it("er id 956 (Brain Overload) wires SetTerrainOnHit with Psychic Terrain", () => {
    const res = dispatchArchetype("bespoke", null, 956);
    expect(res.skipReason).toBeNull();
    const stAttr = res.attrs[0] as SetTerrainOnHitAbAttr;
    expect(stAttr.getTerrain()).toBe(TerrainType.PSYCHIC);
  });

  it("er id 957 (Brain Mass) wires DamageReductionAbAttr with full-hp filter", () => {
    const res = dispatchArchetype("bespoke", null, 957);
    expect(res.skipReason).toBeNull();
    const drAttr = res.attrs[0] as DamageReductionAbAttr;
    expect(drAttr).toBeInstanceOf(DamageReductionAbAttr);
    expect(drAttr.getReduction()).toBeCloseTo(0.5);
    expect(drAttr.getFilter()).toEqual({ kind: "full-hp" });
  });

  it("er id 289 (Growing Tooth) wires StatBoostOnFlagAttack with BITING_MOVE +1 ATK", () => {
    const res = dispatchArchetype("bespoke", null, 289);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatBoostOnFlagAttackAbAttr;
    expect(attr).toBeInstanceOf(StatBoostOnFlagAttackAbAttr);
    expect(attr.getFlag()).toBe(MoveFlags.BITING_MOVE);
    expect(attr.getStat()).toBe(Stat.ATK);
    expect(attr.getStages()).toBe(1);
  });

  it("er id 391 (Hardened Sheath) wires StatBoostOnFlagAttack with HORN_BASED +1 ATK", () => {
    const res = dispatchArchetype("bespoke", null, 391);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as StatBoostOnFlagAttackAbAttr;
    expect(attr.getFlag()).toBe(MoveFlags.HORN_BASED);
    expect(attr.getStat()).toBe(Stat.ATK);
  });

  it("er id 400 (Scrapyard) wires SetArenaTagOnHit Spikes + contact required", () => {
    const res = dispatchArchetype("bespoke", null, 400);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as SetArenaTagOnHitAbAttr;
    expect(attr).toBeInstanceOf(SetArenaTagOnHitAbAttr);
    expect(attr.getTagType()).toBe(ArenaTagType.SPIKES);
    expect(attr.requiresContact()).toBe(true);
  });

  it("er id 401 (Loose Quills) wires SetArenaTagOnHit Spikes + contact required", () => {
    const res = dispatchArchetype("bespoke", null, 401);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as SetArenaTagOnHitAbAttr;
    expect(attr.getTagType()).toBe(ArenaTagType.SPIKES);
    expect(attr.requiresContact()).toBe(true);
  });

  it("er id 405 (Loose Rocks) wires SetArenaTagOnHit Stealth Rock + contact required", () => {
    const res = dispatchArchetype("bespoke", null, 405);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as SetArenaTagOnHitAbAttr;
    expect(attr.getTagType()).toBe(ArenaTagType.STEALTH_ROCK);
    expect(attr.requiresContact()).toBe(true);
  });

  it("er id 574 (Sharp Edges) wires vanilla PostDefendContactDamage with 1/6 ratio", () => {
    const res = dispatchArchetype("bespoke", null, 574);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(PostDefendContactDamageAbAttr);
  });

  // ---------------------------------------------------------------------------
  // Round 3 wires (passive-recovery gating, stat-debuff-on-flag, stat-trigger-
  // on-hit type-filter, weather-gated post-turn chip).
  // ---------------------------------------------------------------------------

  it("er id 333 (Sweet Dreams) wires PassiveRecovery (status: SLEEP, 1/8)", () => {
    const res = dispatchArchetype("bespoke", null, 333);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as PassiveRecoveryAbAttr;
    expect(attr).toBeInstanceOf(PassiveRecoveryAbAttr);
    expect(attr.getHealFraction()).toBeCloseTo(1 / 8);
    expect(attr.getRecoveryCondition()).toEqual({ kind: "status", status: StatusEffect.SLEEP });
  });

  it("er id 447 (Furnace) wires StatTriggerOnHit (ROCK filter, +2 SPD)", () => {
    const res = dispatchArchetype("bespoke", null, 447);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as StatTriggerOnHitAbAttr;
    expect(attr).toBeInstanceOf(StatTriggerOnHitAbAttr);
    expect(attr.getStatChanges()).toEqual([{ stat: Stat.SPD, stages: 2 }]);
    expect(attr.getFilter()).toEqual({ types: [PokemonType.ROCK] });
  });

  it("er id 591 (Celestial Blessing) wires PassiveRecovery (terrain: MISTY, 1/12)", () => {
    const res = dispatchArchetype("bespoke", null, 591);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PassiveRecoveryAbAttr;
    expect(attr.getHealFraction()).toBeCloseTo(1 / 12);
    expect(attr.getRecoveryCondition()).toEqual({ kind: "terrain", terrains: [TerrainType.MISTY] });
  });

  it("er id 643 (Denting Blows) wires StatDebuffOnFlagAttack (HAMMER -1 DEF)", () => {
    const res = dispatchArchetype("bespoke", null, 643);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as StatDebuffOnFlagAttackAbAttr;
    expect(attr).toBeInstanceOf(StatDebuffOnFlagAttackAbAttr);
    expect(attr.getFlag()).toBe(MoveFlags.HAMMER_BASED);
    expect(attr.getStat()).toBe(Stat.DEF);
    expect(attr.getStages()).toBe(-1);
  });

  it("er id 653 (Rest in Peace) wires PassiveRecovery (weather: FOG, 1/8)", () => {
    const res = dispatchArchetype("bespoke", null, 653);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PassiveRecoveryAbAttr;
    expect(attr.getHealFraction()).toBeCloseTo(1 / 8);
    expect(attr.getRecoveryCondition()).toEqual({ kind: "weather", weathers: [WeatherType.FOG] });
  });

  it("er id 787 (Cryo Architect) wires StatTriggerOnHit (WATER+ICE filter, +1 ATK/DEF)", () => {
    const res = dispatchArchetype("bespoke", null, 787);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as StatTriggerOnHitAbAttr;
    expect(attr.getStatChanges()).toEqual([
      { stat: Stat.ATK, stages: 1 },
      { stat: Stat.DEF, stages: 1 },
    ]);
    expect(attr.getFilter()).toEqual({ types: [PokemonType.WATER, PokemonType.ICE] });
  });

  it("er id 874 (Winter Throne) wires PostTurnHurtNonTyped (Ice safe-type, 1/8)", () => {
    const res = dispatchArchetype("bespoke", null, 874);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PostTurnHurtNonTypedAbAttr;
    expect(attr).toBeInstanceOf(PostTurnHurtNonTypedAbAttr);
    expect(attr.getSafeTypes()).toEqual([PokemonType.ICE]);
    expect(attr.getDamageFraction()).toBeCloseTo(1 / 8);
    expect(attr.getRequiredWeathers()).toBeNull();
  });

  it("er id 942 (Christmas Nightmare) wires PostTurnHurtNonTyped (weather-gated HAIL/SNOW)", () => {
    const res = dispatchArchetype("bespoke", null, 942);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PostTurnHurtNonTypedAbAttr;
    expect(attr.getSafeTypes()).toEqual([]);
    expect(attr.getDamageFraction()).toBeCloseTo(1 / 8);
    expect(attr.getRequiredWeathers()).toEqual([WeatherType.HAIL, WeatherType.SNOW]);
  });

  it("er id 945 (Chainsaw) wires StatDebuffOnFlagAttack (SLICING -1 DEF)", () => {
    const res = dispatchArchetype("bespoke", null, 945);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as StatDebuffOnFlagAttackAbAttr;
    expect(attr.getFlag()).toBe(MoveFlags.SLICING_MOVE);
    expect(attr.getStat()).toBe(Stat.DEF);
    expect(attr.getStages()).toBe(-1);
  });

  // ---------------------------------------------------------------------------
  // Round 4 wires (on-faint-effect attacker-tag, pp-reduction-on-contact,
  // category-keyed stat-change-on-attack, hp-below-fraction passive recovery,
  // scripted-move entry-effect).
  // ---------------------------------------------------------------------------

  it("er id 335 (Haunted Spirit) wires OnFaintEffect (attacker-battler-tag CURSED)", () => {
    const res = dispatchArchetype("bespoke", null, 335);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as OnFaintEffectAbAttr;
    expect(attr).toBeInstanceOf(OnFaintEffectAbAttr);
    expect(attr.getKind()).toBe("attacker-battler-tag");
    const effect = attr.getEffect();
    expect(effect.kind === "attacker-battler-tag" && effect.tagType).toBe(BattlerTagType.CURSED);
  });

  it("er id 518 (Spiteful) wires PpReductionOnContact (reduction: 4, contact)", () => {
    const res = dispatchArchetype("bespoke", null, 518);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PpReductionOnContactAbAttr;
    expect(attr).toBeInstanceOf(PpReductionOnContactAbAttr);
    expect(attr.getReduction()).toBe(4);
    expect(attr.requiresContact()).toBe(true);
  });

  it("er id 609 (Parasitic Spores) wires PostTurnHurtNonTyped (Ghost safe-type, 1/8)", () => {
    const res = dispatchArchetype("bespoke", null, 609);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PostTurnHurtNonTypedAbAttr;
    expect(attr.getSafeTypes()).toEqual([PokemonType.GHOST]);
    expect(attr.getDamageFraction()).toBeCloseTo(1 / 8);
  });

  it("er id 722 (Whiplash) wires StatChangeOnCategoryAttack (PHYSICAL opponent DEF -1)", () => {
    const res = dispatchArchetype("bespoke", null, 722);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as StatChangeOnCategoryAttackAbAttr;
    expect(attr).toBeInstanceOf(StatChangeOnCategoryAttackAbAttr);
    expect(attr.getCategory()).toBe(MoveCategory.PHYSICAL);
    expect(attr.getStat()).toBe(Stat.DEF);
    expect(attr.getStages()).toBe(-1);
    expect(attr.getTarget()).toBe("opponent");
  });

  it("er id 729 (Victory Bomb) wires OnFaintEffect (attacker-damage-flat 0.25)", () => {
    const res = dispatchArchetype("bespoke", null, 729);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as OnFaintEffectAbAttr;
    expect(attr.getKind()).toBe("attacker-damage-flat");
    const effect = attr.getEffect();
    expect(effect.kind === "attacker-damage-flat" && effect.maxHpFraction).toBeCloseTo(0.25);
  });

  it("er id 807 (Woodland Curse) wires EntryEffect (scripted-move FORESTS_CURSE)", () => {
    const res = dispatchArchetype("bespoke", null, 807);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as EntryEffectAbAttr;
    expect(attr).toBeInstanceOf(EntryEffectAbAttr);
    expect(attr.getKind()).toBe("scripted-move");
    const effect = attr.getEffect();
    expect(effect.kind === "scripted-move" && effect.move).toBe(MoveId.FORESTS_CURSE);
  });

  it("er id 991 (Resilience) wires PassiveRecovery (hp-below-fraction 0.5, 1/4)", () => {
    const res = dispatchArchetype("bespoke", null, 991);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PassiveRecoveryAbAttr;
    expect(attr.getHealFraction()).toBeCloseTo(1 / 4);
    expect(attr.getRecoveryCondition()).toEqual({ kind: "hp-below-fraction", fraction: 0.5 });
  });

  // ---------------------------------------------------------------------------
  // Round 6 wires (on-faint attacker-stat-change extension, KO stat triggers,
  // weather-gated damage reduction, generic damage reduction with `all` filter,
  // chance-battler-tag for ER_BLEED, lifesteal-on-KO, scripted-move Protect).
  // ---------------------------------------------------------------------------

  it("er id 429 (Coward) wires EntryEffect (scripted-move PROTECT)", () => {
    const res = dispatchArchetype("bespoke", null, 429);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as EntryEffectAbAttr;
    expect(attr).toBeInstanceOf(EntryEffectAbAttr);
    expect(attr.getKind()).toBe("scripted-move");
    const effect = attr.getEffect();
    expect(effect.kind === "scripted-move" && effect.move).toBe(MoveId.PROTECT);
  });

  it("er id 431 (Dune Terror) wires WeatherDamageReduction (SANDSTORM, 0.65)", () => {
    const res = dispatchArchetype("bespoke", null, 431);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as WeatherDamageReductionAbAttr;
    expect(attr).toBeInstanceOf(WeatherDamageReductionAbAttr);
    expect(attr.getMultiplier()).toBeCloseTo(0.65);
    expect(attr.getWeathers()).toEqual([WeatherType.SANDSTORM]);
  });

  // (er id 464 Hunter's Horn dispatch test is below — extended in Round 9.)

  it("er id 559 (Guilt Trip) wires OnFaintEffect (attacker-stat-change ATK/SPATK -2)", () => {
    const res = dispatchArchetype("bespoke", null, 559);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as OnFaintEffectAbAttr;
    expect(attr).toBeInstanceOf(OnFaintEffectAbAttr);
    expect(attr.getKind()).toBe("attacker-stat-change");
    const effect = attr.getEffect();
    if (effect.kind !== "attacker-stat-change") {
      throw new Error("expected attacker-stat-change effect kind");
    }
    expect(effect.stats).toEqual([
      { stat: Stat.ATK, stages: -2 },
      { stat: Stat.SPATK, stages: -2 },
    ]);
  });

  it("er id 673 (Blood Stain) wires ChanceBattlerTagOnHit (100% ER_BLEED on contact)", () => {
    const res = dispatchArchetype("bespoke", null, 673);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
    expect(attr.getChance()).toBe(100);
    expect(attr.getTags()).toEqual([BattlerTagType.ER_BLEED]);
    expect(attr.requiresContact()).toBe(true);
  });

  it("er id 697 (Dragon's Ritual) wires StatTriggerOnKo (+1 ATK, +1 SPD)", () => {
    const res = dispatchArchetype("bespoke", null, 697);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatTriggerOnKoAbAttr;
    expect(attr).toBeInstanceOf(StatTriggerOnKoAbAttr);
    expect(attr.getStatChanges()).toEqual([
      { stat: Stat.ATK, stages: 1 },
      { stat: Stat.SPD, stages: 1 },
    ]);
  });

  it("er id 705 (Terastal Treasure) wires DamageReduction (all, 0.4)", () => {
    const res = dispatchArchetype("bespoke", null, 705);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as DamageReductionAbAttr;
    expect(attr).toBeInstanceOf(DamageReductionAbAttr);
    expect(attr.getReduction()).toBeCloseTo(0.4);
    expect(attr.getFilter()).toEqual({ kind: "all" });
  });

  it("er id 771 (Forsaken Heart) wires StatTriggerOnKo (+1 ATK)", () => {
    const res = dispatchArchetype("bespoke", null, 771);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatTriggerOnKoAbAttr;
    expect(attr.getStatChanges()).toEqual([{ stat: Stat.ATK, stages: 1 }]);
  });

  // Round 7 — pre-faint-revive + weather-stat-multiplier + crit-trigger
  it("er id 427 (Cheating Death) wires PreFaintRevive (hp-threshold:0, first-n-hits:2)", () => {
    const res = dispatchArchetype("bespoke", null, 427);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as PreFaintReviveAbAttr;
    expect(attr).toBeInstanceOf(PreFaintReviveAbAttr);
    expect(attr.getGate()).toEqual({ kind: "hp-threshold", threshold: 0 });
    expect(attr.getUsage()).toEqual({ kind: "first-n-hits", n: 2 });
  });

  it("er id 583 (Gallantry) wires PreFaintRevive (hp-threshold:0, first-n-hits:1)", () => {
    const res = dispatchArchetype("bespoke", null, 583);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as PreFaintReviveAbAttr;
    expect(attr).toBeInstanceOf(PreFaintReviveAbAttr);
    expect(attr.getGate()).toEqual({ kind: "hp-threshold", threshold: 0 });
    expect(attr.getUsage()).toEqual({ kind: "first-n-hits", n: 1 });
  });

  it("er id 724 (Lucky Halo) wires ProtectStat + PreFaintRevive(first-n-hits:1)", () => {
    const res = dispatchArchetype("bespoke", null, 724);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs[0]).toBeInstanceOf(ProtectStatAbAttr);
    const reviveAttr = res.attrs[1] as PreFaintReviveAbAttr;
    expect(reviveAttr).toBeInstanceOf(PreFaintReviveAbAttr);
    expect(reviveAttr.getUsage()).toEqual({ kind: "first-n-hits", n: 1 });
  });

  it("er id 862 (Thermal Slide) wires WeatherStatMultiplier (SPD, 1.5x, sun/hail set)", () => {
    const res = dispatchArchetype("bespoke", null, 862);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as WeatherStatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(WeatherStatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.SPD);
    expect(attr.multiplier).toBe(1.5);
    expect(attr.getWeathers()).toEqual([WeatherType.SUNNY, WeatherType.HARSH_SUN, WeatherType.HAIL, WeatherType.SNOW]);
  });

  it("er id 488 (Tipping Point) wires StatTriggerOnHit(+1 SPATK) + PostReceiveCritStatStageChange(SPATK, 12)", () => {
    const res = dispatchArchetype("bespoke", null, 488);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const hitAttr = res.attrs[0] as StatTriggerOnHitAbAttr;
    expect(hitAttr).toBeInstanceOf(StatTriggerOnHitAbAttr);
    expect(hitAttr.getStatChanges()).toEqual([{ stat: Stat.SPATK, stages: 1 }]);
    const critAttr = res.attrs[1];
    expect(critAttr).toBeInstanceOf(PostReceiveCritStatStageChangeAbAttr);
  });

  // ---------------------------------------------------------------------------
  // Round 8 — status-immunity-all + damage-reduction-all + multi-type/flag
  // damage boost + crit-stage flag bonus + chance-trap-on-hit.
  // ---------------------------------------------------------------------------
  it("er id 674 (Blood Stigma) wires StatusEffectImmunityAbAttrEr (block-all)", () => {
    const res = dispatchArchetype("bespoke", null, 674);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatusEffectImmunityAbAttrEr;
    expect(attr).toBeInstanceOf(StatusEffectImmunityAbAttrEr);
    expect(attr.getStatuses()).toEqual([]);
  });

  it("er id 855 (Hyper Cleanse) wires StatusEffectImmunityAbAttrEr (block-all)", () => {
    const res = dispatchArchetype("bespoke", null, 855);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatusEffectImmunityAbAttrEr;
    expect(attr).toBeInstanceOf(StatusEffectImmunityAbAttrEr);
    expect(attr.getStatuses()).toEqual([]);
  });

  it("er id 1004 (Feathercoat) wires DamageReductionAbAttr (kind: all, reduction: 0.1)", () => {
    const res = dispatchArchetype("bespoke", null, 1004);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as DamageReductionAbAttr;
    expect(attr).toBeInstanceOf(DamageReductionAbAttr);
    expect(attr.getReduction()).toBeCloseTo(0.1);
    expect(attr.getFilter()).toEqual({ kind: "all" });
  });

  it("er id 944 (Dead Bark) wires EntryEffect(add-self-type GHOST) + DamageReduction(kind: all, 0.15)", () => {
    // Round 12: upgraded from damage-only to add-type + damage-reduction pair.
    // The entry-effect attaches Ghost to the holder's type list on switch-in
    // (existing `EntryEffectAddSelfType` primitive); the DamageReduction
    // covers the 15% all-moves piece. The "30% if SE" rider remains deferred.
    const res = dispatchArchetype("bespoke", null, 944);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const damageAttr = res.attrs[1] as DamageReductionAbAttr;
    expect(damageAttr).toBeInstanceOf(DamageReductionAbAttr);
    expect(damageAttr.getReduction()).toBeCloseTo(0.15);
    expect(damageAttr.getFilter()).toEqual({ kind: "all" });
  });

  it("er id 931 (Hammer Fist) wires two FlagDamageBoost instances (PUNCHING_MOVE 1.25x + HAMMER_BASED 1.25x)", () => {
    const res = dispatchArchetype("bespoke", null, 931);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const a0 = res.attrs[0] as FlagDamageBoostAbAttr;
    expect(a0).toBeInstanceOf(FlagDamageBoostAbAttr);
    expect(a0.getBoostFlag()).toBe(MoveFlags.PUNCHING_MOVE);
    expect(a0.getHighHpMultiplier()).toBeCloseTo(1.25);
    const a1 = res.attrs[1] as FlagDamageBoostAbAttr;
    expect(a1).toBeInstanceOf(FlagDamageBoostAbAttr);
    expect(a1.getBoostFlag()).toBe(MoveFlags.HAMMER_BASED);
    expect(a1.getHighHpMultiplier()).toBeCloseTo(1.25);
  });

  it("er id 544 (Airborne) wires UserFieldMoveTypePowerBoost(FLYING, 1.3x)", () => {
    // Round 12: upgraded from TypeDamageBoost (self-only) to
    // UserFieldMoveTypePowerBoost — the latter broadcasts the +30% Flying
    // boost to the holder AND its ally (vanilla Battery/Power Spot family).
    const res = dispatchArchetype("bespoke", null, 544);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    // We verify the broadcast variant — UserFieldMoveTypePowerBoostAbAttr is
    // re-exported from `#abilities/ab-attrs` and is what the round-12 wire
    // returns.
    expect(res.attrs[0].constructor.name).toBe("UserFieldMoveTypePowerBoostAbAttr");
  });

  it("er id 375 (Precise Fist) wires CritStageBonusAbAttr (+1 with PUNCHING_MOVE filter)", () => {
    const res = dispatchArchetype("bespoke", null, 375);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as CritStageBonusAbAttr;
    expect(attr).toBeInstanceOf(CritStageBonusAbAttr);
    expect(attr.getBonus()).toBe(1);
    expect(attr.getFilter()).toEqual({ flag: MoveFlags.PUNCHING_MOVE });
  });

  it("er id 278 (Antarctic Bird) wires two TypeDamageBoost instances (ICE 1.3x + FLYING 1.3x)", () => {
    const res = dispatchArchetype("bespoke", null, 278);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const a0 = res.attrs[0] as TypeDamageBoostAbAttr;
    expect(a0.getBoostType()).toBe(PokemonType.ICE);
    expect(a0.getHighHpMultiplier()).toBeCloseTo(1.3);
    const a1 = res.attrs[1] as TypeDamageBoostAbAttr;
    expect(a1.getBoostType()).toBe(PokemonType.FLYING);
    expect(a1.getHighHpMultiplier()).toBeCloseTo(1.3);
  });

  it("er id 883 (Warmonger) wires three TypeDamageBoost instances (ROCK + STEEL + FIGHTING)", () => {
    const res = dispatchArchetype("bespoke", null, 883);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    const types = (res.attrs as TypeDamageBoostAbAttr[]).map(a => a.getBoostType());
    expect(types).toEqual([PokemonType.ROCK, PokemonType.STEEL, PokemonType.FIGHTING]);
    for (const a of res.attrs as TypeDamageBoostAbAttr[]) {
      expect(a).toBeInstanceOf(TypeDamageBoostAbAttr);
      expect(a.getHighHpMultiplier()).toBeCloseTo(1.3);
    }
  });

  it("er id 975 (Talon Trap) wires ChanceBattlerTagOnHit (50%, TRAPPED, contact)", () => {
    const res = dispatchArchetype("bespoke", null, 975);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
    expect(attr.getChance()).toBe(50);
    expect(attr.getTags()).toEqual([BattlerTagType.TRAPPED]);
    expect(attr.requiresContact()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Round 9 — stab-add primitive wires.
  // ---------------------------------------------------------------------------

  it("er id 287 (Mystic Power) wires a no-targetType StabAdd (all moves gain STAB)", () => {
    const res = dispatchArchetype("bespoke", null, 287);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StabAddAbAttr;
    expect(attr).toBeInstanceOf(StabAddAbAttr);
    expect(attr.getTargetType()).toBeNull();
    expect(attr.getMultiplier()).toBe(1.5);
  });

  it("er id 291 (Aurora Borealis) wires StabAdd(ICE) at 1.5x", () => {
    const res = dispatchArchetype("bespoke", null, 291);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StabAddAbAttr;
    expect(attr).toBeInstanceOf(StabAddAbAttr);
    expect(attr.getTargetType()).toBe(PokemonType.ICE);
    expect(attr.getMultiplier()).toBe(1.5);
  });

  it("er id 297 (Amphibious) wires StabAdd(WATER) at 1.5x", () => {
    const res = dispatchArchetype("bespoke", null, 297);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StabAddAbAttr;
    expect(attr).toBeInstanceOf(StabAddAbAttr);
    expect(attr.getTargetType()).toBe(PokemonType.WATER);
  });

  it("er id 365 (Lunar Eclipse) wires two StabAdd instances (FAIRY + DARK)", () => {
    const res = dispatchArchetype("bespoke", null, 365);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const types = (res.attrs as StabAddAbAttr[]).map(a => a.getTargetType());
    expect(types).toEqual([PokemonType.FAIRY, PokemonType.DARK]);
    for (const a of res.attrs as StabAddAbAttr[]) {
      expect(a).toBeInstanceOf(StabAddAbAttr);
      expect(a.getMultiplier()).toBe(1.5);
    }
  });

  it("er id 478 (Moon Spirit) wires two StabAdd instances (FAIRY + DARK)", () => {
    const res = dispatchArchetype("bespoke", null, 478);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const types = (res.attrs as StabAddAbAttr[]).map(a => a.getTargetType());
    expect(types).toEqual([PokemonType.FAIRY, PokemonType.DARK]);
  });

  it("er id 494 (Arcane Force) wires a no-targetType StabAdd (all-moves shape)", () => {
    const res = dispatchArchetype("bespoke", null, 494);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StabAddAbAttr;
    expect(attr).toBeInstanceOf(StabAddAbAttr);
    expect(attr.getTargetType()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Round 9 — composition wires using existing primitives.
  // ---------------------------------------------------------------------------

  it("er id 464 (Hunter's Horn) wires FlagDamageBoost(HORN_BASED, 1.3) + LifestealOnKo(1/4)", () => {
    const res = dispatchArchetype("bespoke", null, 464);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs[0]).toBeInstanceOf(FlagDamageBoostAbAttr);
    expect(res.attrs[1]).toBeInstanceOf(LifestealOnKoAbAttr);
    expect((res.attrs[1] as LifestealOnKoAbAttr).getHealFraction()).toBeCloseTo(0.25);
  });

  it("er id 466 (Plasma Lamp) wires two TypeDamageBoost instances (FIRE + ELECTRIC) at 1.2x", () => {
    const res = dispatchArchetype("bespoke", null, 466);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const types = (res.attrs as TypeDamageBoostAbAttr[]).map(a => a.getBoostType());
    expect(types).toEqual([PokemonType.FIRE, PokemonType.ELECTRIC]);
    for (const a of res.attrs as TypeDamageBoostAbAttr[]) {
      expect(a).toBeInstanceOf(TypeDamageBoostAbAttr);
      expect(a.getHighHpMultiplier()).toBeCloseTo(1.2);
    }
  });

  it("er id 764 (Deep Freeze) wires two TypeDamageBoost instances (WATER + ICE) at 1.25x", () => {
    const res = dispatchArchetype("bespoke", null, 764);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const types = (res.attrs as TypeDamageBoostAbAttr[]).map(a => a.getBoostType());
    expect(types).toEqual([PokemonType.WATER, PokemonType.ICE]);
    for (const a of res.attrs as TypeDamageBoostAbAttr[]) {
      expect(a).toBeInstanceOf(TypeDamageBoostAbAttr);
      expect(a.getHighHpMultiplier()).toBeCloseTo(1.25);
    }
  });

  it("er id 941 (Devious Present) wires TypeDamageBoost(ICE, 1.5) + FlagDamageBoost(THROW_BASED, 1.5)", () => {
    const res = dispatchArchetype("bespoke", null, 941);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs[0]).toBeInstanceOf(TypeDamageBoostAbAttr);
    expect((res.attrs[0] as TypeDamageBoostAbAttr).getBoostType()).toBe(PokemonType.ICE);
    expect((res.attrs[0] as TypeDamageBoostAbAttr).getHighHpMultiplier()).toBe(1.5);
    expect(res.attrs[1]).toBeInstanceOf(FlagDamageBoostAbAttr);
  });

  it("er id 360 (Field Explorer) wires FlagDamageBoost(FIELD_BASED, 1.5)", () => {
    const res = dispatchArchetype("bespoke", null, 360);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(FlagDamageBoostAbAttr);
  });

  // ---------------------------------------------------------------------------
  // Round 11 — composition wires using existing primitives.
  // ---------------------------------------------------------------------------

  it("er id 348 (North Wind) wires EntryEffect(set-screen-or-room AURORA_VEIL 3 turns)", () => {
    const res = dispatchArchetype("bespoke", null, 348);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as EntryEffectAbAttr;
    expect(attr).toBeInstanceOf(EntryEffectAbAttr);
    expect(attr.getKind()).toBe("set-screen-or-room");
    const effect = attr.getEffect();
    if (effect.kind !== "set-screen-or-room") {
      throw new Error("expected set-screen-or-room effect kind");
    }
    expect(effect.tag).toBe(ArenaTagType.AURORA_VEIL);
    expect(effect.turns).toBe(3);
  });

  it("er id 378 (Amplifier) wires FlagDamageBoost(SOUND_BASED, 1.3)", () => {
    const res = dispatchArchetype("bespoke", null, 378);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(FlagDamageBoostAbAttr);
  });

  it("er id 438 (Jaws of Carnage) wires LifestealOnKo(0.5)", () => {
    const res = dispatchArchetype("bespoke", null, 438);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as LifestealOnKoAbAttr;
    expect(attr).toBeInstanceOf(LifestealOnKoAbAttr);
    expect(attr.getHealFraction()).toBeCloseTo(0.5);
  });

  it("er id 519 (Fortitude) wires StatTriggerOnHit(SPDEF +1) + PostReceiveCritStatStageChange(SPDEF +12)", () => {
    const res = dispatchArchetype("bespoke", null, 519);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const trigger = res.attrs[0] as StatTriggerOnHitAbAttr;
    expect(trigger).toBeInstanceOf(StatTriggerOnHitAbAttr);
    expect(trigger.getStatChanges()).toEqual([{ stat: Stat.SPDEF, stages: 1 }]);
    expect(res.attrs[1]).toBeInstanceOf(PostReceiveCritStatStageChangeAbAttr);
  });

  it("er id 627 (Ethereal Rush) wires WeatherStatMultiplier(SPD, 1.5, [FOG])", () => {
    const res = dispatchArchetype("bespoke", null, 627);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as WeatherStatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(WeatherStatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.SPD);
    expect(attr.multiplier).toBeCloseTo(1.5);
    expect(attr.getWeathers()).toEqual([WeatherType.FOG]);
  });

  it("er id 645 (Soul Crusher) wires FlagDamageBoost(HAMMER_BASED, 1.1)", () => {
    const res = dispatchArchetype("bespoke", null, 645);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(FlagDamageBoostAbAttr);
  });

  it("er id 655 (Smokey Maneuvers) wires WeatherStatMultiplier(EVA, 1.25, [FOG])", () => {
    const res = dispatchArchetype("bespoke", null, 655);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as WeatherStatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(WeatherStatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.EVA);
    expect(attr.multiplier).toBeCloseTo(1.25);
    expect(attr.getWeathers()).toEqual([WeatherType.FOG]);
  });

  it("er id 819 (Serpent Bind) wires ChanceBattlerTagOnHit(50% TRAPPED on contact)", () => {
    const res = dispatchArchetype("bespoke", null, 819);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
    expect(attr.getChance()).toBe(50);
    expect(attr.getTags()).toEqual([BattlerTagType.TRAPPED]);
    expect(attr.requiresContact()).toBe(true);
  });

  it("er id 987 (Rain Shroud) wires WeatherStatMultiplier(EVA, 1.3, [RAIN, HEAVY_RAIN])", () => {
    const res = dispatchArchetype("bespoke", null, 987);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as WeatherStatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(WeatherStatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.EVA);
    expect(attr.multiplier).toBeCloseTo(1.3);
    expect(attr.getWeathers()).toEqual([WeatherType.RAIN, WeatherType.HEAVY_RAIN]);
  });

  it("er id 1018 (Abominable Monster) wires WeatherStatMultiplier(SPDEF, 1.5, [HAIL, SNOW])", () => {
    const res = dispatchArchetype("bespoke", null, 1018);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as WeatherStatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(WeatherStatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.SPDEF);
    expect(attr.multiplier).toBeCloseTo(1.5);
    expect(attr.getWeathers()).toEqual([WeatherType.HAIL, WeatherType.SNOW]);
  });

  it("unrecognized er id falls through to default bespoke skip", () => {
    const res = dispatchArchetype("bespoke", null, 99999);
    expect(res.attrs).toHaveLength(0);
    expect(res.skipReason).toMatch(/hand-written implementation pending/);
  });

  it("bespoke without erAbilityId returns the default skip reason", () => {
    const res = dispatchArchetype("bespoke", null);
    expect(res.attrs).toHaveLength(0);
    expect(res.skipReason).toMatch(/hand-written implementation pending/);
  });
});
