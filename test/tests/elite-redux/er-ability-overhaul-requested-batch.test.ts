/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  FieldPriorityMoveImmunityAbAttr,
  IntimidateImmunityAbAttr,
  PostSummonStatStageChangeAbAttr,
} from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  AllyHigherStatMultiplierAbAttr,
  AttackerTypeDamageReductionAbAttr,
  BallRecoveryAbAttr,
  BreakScreensOnAttackAbAttr,
  FaintedAllyStatMultiplierAbAttr,
  FullHpMoveTypeDamageReductionAbAttr,
  HigherStatMultiplierAbAttr,
  IgnoreOptionalMoveEffectsAbAttr,
  MoveFlagImmunityAbAttr,
  MoveHpCostModifierAbAttr,
  OnceLowHpStatRaiseAbAttr,
  PostDefendAddTagAbAttr,
  ReverseNegativeStatChangesAbAttr,
  SameTypeStabOtherwiseBoostAbAttr,
  TypeImmunityHigherDefenseStatRaiseAbAttr,
  UserFieldIgnoreOptionalMoveEffectsAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/index";
import { ChanceBattlerTagOnAttackAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";
import { CopyMoveByFilterAbAttr } from "#data/elite-redux/archetypes/copy-move-by-filter";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { PostSummonQuashFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-quash-foes";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { RepeatMovePowerBoostAbAttr } from "#data/elite-redux/archetypes/repeat-move-power-boost";
import {
  ActivateOncePerBattleEntryWindowAbAttr,
  TimeLimitedEffectivenessFloorAbAttr,
} from "#data/elite-redux/archetypes/time-limited-effectiveness-floor";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

function erAbility(draftId: number): Ability {
  const runtimeId = ER_ID_MAP.abilities[draftId];
  expect(runtimeId, `ER ability ${draftId} must resolve`).toBeDefined();
  return allAbilities[runtimeId];
}

describe("requested ability overhaul - vanilla final pass", () => {
  it("adds the Shed Tail, Aroma Veil, and Forewarn riders", () => {
    expect(allAbilities[AbilityId.SHED_SKIN].attrs.some(attr => attr instanceof MoveHpCostModifierAbAttr)).toBe(true);
    expect(allAbilities[AbilityId.AROMA_VEIL].attrs).toEqual(
      expect.arrayContaining([
        expect.any(IgnoreOptionalMoveEffectsAbAttr),
        expect.any(UserFieldIgnoreOptionalMoveEffectsAbAttr),
      ]),
    );
    expect(
      allAbilities[AbilityId.FOREWARN].attrs.some(attr => attr instanceof TimeLimitedEffectivenessFloorAbAttr),
    ).toBe(true);
    expect(
      allAbilities[AbilityId.FOREWARN].attrs.some(attr => attr instanceof ActivateOncePerBattleEntryWindowAbAttr),
    ).toBe(true);
  });

  it("adds Defeatist's comeback and Rain Dish's Water-defense absorb", () => {
    const defeatist = allAbilities[AbilityId.DEFEATIST].attrs.find(attr => attr instanceof OnceLowHpStatRaiseAbAttr);
    expect(defeatist).toBeInstanceOf(OnceLowHpStatRaiseAbAttr);
    expect((defeatist as OnceLowHpStatRaiseAbAttr).threshold).toBe(0.1);
    expect((defeatist as OnceLowHpStatRaiseAbAttr).stages).toBe(2);

    expect(
      allAbilities[AbilityId.RAIN_DISH].attrs.some(attr => attr instanceof TypeImmunityHigherDefenseStatRaiseAbAttr),
    ).toBe(true);
  });

  it("replaces Ball Fetch with move interception plus battle ball recovery", () => {
    expect(allAbilities[AbilityId.BALL_FETCH].conditions).toHaveLength(0);
    expect(allAbilities[AbilityId.BALL_FETCH].attrs).toEqual(
      expect.arrayContaining([
        expect.any(MoveFlagImmunityAbAttr),
        expect.any(CopyMoveByFilterAbAttr),
        expect.any(BallRecoveryAbAttr),
      ]),
    );
  });

  it("adds the Intimidate callback, Imposter boost, and dynamic Flower Gift stats", () => {
    expect(allAbilities[AbilityId.INTIMIDATE].attrs.some(attr => attr instanceof PostSummonStatStageChangeAbAttr)).toBe(
      true,
    );
    expect(allAbilities[AbilityId.IMPOSTER].description).toContain("30% more damage");
    expect(
      allAbilities[AbilityId.FLOWER_GIFT].attrs.filter(attr => attr instanceof HigherStatMultiplierAbAttr),
    ).toHaveLength(2);
    expect(
      allAbilities[AbilityId.FLOWER_GIFT].attrs.filter(attr => attr instanceof AllyHigherStatMultiplierAbAttr),
    ).toHaveLength(2);
  });
});

describe("requested ability overhaul - replacements and riders", () => {
  it("adds Avenger's 5% Attack and Sp. Atk scaling per fainted ally", () => {
    const attrs = erAbility(292).attrs.filter(
      attr => attr instanceof FaintedAllyStatMultiplierAbAttr,
    ) as FaintedAllyStatMultiplierAbAttr[];
    expect(attrs).toHaveLength(2);
    expect(attrs.map(attr => attr.stat).sort()).toEqual([Stat.ATK, Stat.SPATK]);
    expect(attrs.every(attr => attr.perFaintedAlly === 0.05)).toBe(true);
  });

  // Hyper Aggressive (358) plus its composites that carry the same kit:
  // Raging Goddess (721), Balloon Blitz (755), Frenzied Phantom (790),
  // Witch Broom (961), Ghost Frenzy (999).
  it.each([
    358, 721, 755, 790, 961, 999,
  ])("keeps ability %i's base second strike unconditional and adds an enrage-gated third strike", id => {
    const attrs = erAbility(id).attrs;
    const strikes = attrs.filter(attr => attr instanceof HitMultiplierAbAttr) as HitMultiplierAbAttr[];
    const power = attrs.find(
      attr => attr instanceof HitMultiplierPowerAbAttr && attr.isExtraStrikesOnly() && attr.getMultiplier() === 0.25,
    ) as HitMultiplierPowerAbAttr | undefined;
    // Two strike-count layers: an always-on base +1 (2 hits) and an enrage-gated
    // +1 (3 hits while enraged).
    const unconditional = strikes.filter(attr => attr.getExtraStrikes() === 1 && attr.getCondition() === null);
    const enrageGated = strikes.filter(attr => attr.getExtraStrikes() === 1 && attr.getCondition() !== null);
    expect(unconditional.length).toBeGreaterThanOrEqual(1);
    expect(enrageGated).toHaveLength(1);
    // The per-strike 25% power scaling stays UNCONDITIONAL and applies to every
    // strike past the first (covers both the 2nd and the enraged 3rd hit).
    expect(power).toBeDefined();
    expect(power?.getCondition()).toBeNull();
  });

  it("replaces Grappler and Chokehold with four-turn quarter-HP binding", () => {
    for (const id of [523, 837]) {
      const ability = erAbility(id);
      expect(ability.attrs).toHaveLength(1);
      const binding = ability.attrs[0];
      expect(binding).toBeInstanceOf(ChanceBattlerTagOnAttackAbAttr);
      expect((binding as ChanceBattlerTagOnAttackAbAttr).getTags()).toEqual([BattlerTagType.BIND]);
      expect((binding as ChanceBattlerTagOnAttackAbAttr).getTurns()).toBe(4);
      expect((binding as ChanceBattlerTagOnAttackAbAttr).getDamageDenominator()).toBe(4);
    }
  });

  it("replaces Frost Dragon, Malodor, and Rain Shroud without retaining obsolete effects", () => {
    const frostDragon = erAbility(1009);
    expect(frostDragon.attrs).toHaveLength(1);
    expect(frostDragon.attrs[0]).toBeInstanceOf(PostAttackScriptedMoveAbAttr);
    expect((frostDragon.attrs[0] as PostAttackScriptedMoveAbAttr).getMoveId()).toBe(MoveId.BREAKING_SWIPE);
    expect((frostDragon.attrs[0] as PostAttackScriptedMoveAbAttr).getPower()).toBe(40);

    const malodor = erAbility(808);
    expect(malodor.attrs).toHaveLength(1);
    expect(malodor.attrs[0]).toBeInstanceOf(CounterAttackOnHitAbAttr);
    expect((malodor.attrs[0] as CounterAttackOnHitAbAttr).getMoveId()).toBe(MoveId.POISON_GAS);
    expect((malodor.attrs[0] as CounterAttackOnHitAbAttr).getPower()).toBe(20);

    const rainShroud = erAbility(987);
    expect(rainShroud.attrs).toHaveLength(3);
    expect(rainShroud.attrs).toEqual(
      expect.arrayContaining([expect.any(DamageReductionAbAttr), expect.any(FieldPriorityMoveImmunityAbAttr)]),
    );
  });

  it("adds screen, defense, field, and charged riders", () => {
    expect(erAbility(321).attrs.some(attr => attr instanceof BreakScreensOnAttackAbAttr)).toBe(true);
    expect(erAbility(375).attrs.some(attr => attr instanceof BreakScreensOnAttackAbAttr)).toBe(true);
    expect(erAbility(389).attrs.some(attr => attr instanceof AttackerTypeDamageReductionAbAttr)).toBe(true);
    expect(erAbility(498).attrs.some(attr => attr instanceof PostSummonQuashFoesAbAttr)).toBe(true);
    expect(erAbility(504).attrs.some(attr => attr instanceof ReverseNegativeStatChangesAbAttr)).toBe(true);
    expect(erAbility(815).attrs.some(attr => attr instanceof IntimidateImmunityAbAttr)).toBe(true);
    expect(erAbility(847).attrs.some(attr => attr instanceof PostDefendAddTagAbAttr)).toBe(true);
    expect(erAbility(932).attrs.some(attr => attr instanceof FullHpMoveTypeDamageReductionAbAttr)).toBe(true);
    expect(erAbility(1028).attrs.some(attr => attr instanceof AttackerTypeDamageReductionAbAttr)).toBe(true);
  });

  it("updates sound repeats, scripted follow-ups, Wildfire, Warmonger, and Electro Booster", () => {
    const rhythmic = erAbility(640).attrs.find(attr => attr instanceof RepeatMovePowerBoostAbAttr);
    expect(rhythmic).toBeInstanceOf(RepeatMovePowerBoostAbAttr);
    expect((rhythmic as RepeatMovePowerBoostAbAttr).getFlag()).toBe(MoveFlags.SOUND_BASED);

    const reverberate = erAbility(812).attrs.find(attr => attr instanceof PostAttackScriptedMoveAbAttr);
    expect(reverberate).toBeInstanceOf(PostAttackScriptedMoveAbAttr);
    expect((reverberate as PostAttackScriptedMoveAbAttr).getMoveId()).toBe(MoveId.ROUND);

    expect(erAbility(717).attrs.some(attr => attr instanceof TrapDurationModifierAbAttr)).toBe(true);
    expect(erAbility(1006).attrs.some(attr => attr instanceof PostSummonScriptedMoveAbAttr)).toBe(true);

    const boosts = erAbility(883).attrs.filter(
      attr => attr instanceof TypeDamageBoostAbAttr,
    ) as TypeDamageBoostAbAttr[];
    expect(boosts).toHaveLength(3);
    expect(boosts.every(attr => attr.getHighHpMultiplier() === 1.5)).toBe(true);
  });

  it("uses conditional STAB for Raw Wood and Fossilized and renames Ninja's Blade", () => {
    expect(erAbility(303).attrs.some(attr => attr instanceof SameTypeStabOtherwiseBoostAbAttr)).toBe(true);
    expect(erAbility(337).attrs.some(attr => attr instanceof SameTypeStabOtherwiseBoostAbAttr)).toBe(true);
    expect(erAbility(460).name).toBe("Ninja's Blade");
  });
});
