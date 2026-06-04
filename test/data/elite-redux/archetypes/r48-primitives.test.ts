/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Construction smoke tests for the R48 batch of bespoke primitives.
//
// Each new primitive added in the R48 grind gets one "construct without
// throwing + key fields readable" test here. Behavior tests (does the
// effect actually fire in battle?) are covered by:
//   - test/data/elite-redux/verify-all-bespoke.test.ts (dispatcher classifies
//     the wire as WIRED with the right constructor)
//   - test/tests/elite-redux/integration/bespoke-battle-smoke.test.ts
//     (the wired AbAttr survives a real one-turn battle)
//
// This file ensures the construction surface is stable so refactors of any
// of the 30 new primitives don't silently break their wiring.
// =============================================================================

import { BstConditionalAllyAuraAbAttr } from "#data/elite-redux/archetypes/bst-conditional-ally-aura";
import { ContactQuashAbAttr } from "#data/elite-redux/archetypes/contact-quash";
import { DamageCapOnResistAbAttr } from "#data/elite-redux/archetypes/damage-cap-on-resist";
import { DefenseStatSwapOnStatusedFoeAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-statused-foe";
import { FieldStatShareAbAttr } from "#data/elite-redux/archetypes/field-stat-share";
import { FoeStrongestStatSelfBoostAbAttr } from "#data/elite-redux/archetypes/foe-strongest-stat-self-boost";
import { OnCritStatBoostLowestAbAttr } from "#data/elite-redux/archetypes/on-crit-stat-boost-lowest";
import {
  OneShotTypeBoostAbAttr,
  OneShotTypeBoostFollowupAbAttr,
} from "#data/elite-redux/archetypes/one-shot-type-boost-then-lose-type";
import { OutgoingStatDropMultiplierAbAttr } from "#data/elite-redux/archetypes/outgoing-stat-drop-multiplier";
import { PostDefendChangeAttackerTypeAbAttr } from "#data/elite-redux/archetypes/post-defend-change-attacker-type";
import { PostDefendSuppressOpponentDamageBoostAbAttr } from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import { PostFaintReviveAbAttr } from "#data/elite-redux/archetypes/post-faint-revive";
import { PostSummonClearTerrainAbAttr } from "#data/elite-redux/archetypes/post-summon-clear-terrain";
import { PostSummonQuashFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-quash-foes";
import { PostSummonStackSetEffectsAbAttr } from "#data/elite-redux/archetypes/post-summon-stack-set-effects";
import { PostTurnFoeStatDropAbAttr } from "#data/elite-redux/archetypes/post-turn-foe-stat-drop";
import { PostVictoryClearTagAbAttr } from "#data/elite-redux/archetypes/post-victory-clear-tag";
import { PreSwitchOutItemRestoreAbAttr } from "#data/elite-redux/archetypes/pre-switch-out-item-restore";
import { RepeatMovePowerBoostAbAttr } from "#data/elite-redux/archetypes/repeat-move-power-boost";
import { SePriorityBonusAbAttr } from "#data/elite-redux/archetypes/se-priority-bonus";
import { SkipChargeTurnAbAttr } from "#data/elite-redux/archetypes/skip-charge-turn";
import { StabSuppressAuraAbAttr } from "#data/elite-redux/archetypes/stab-suppress-aura";
import { StatusCascadeAbAttr } from "#data/elite-redux/archetypes/status-cascade";
import { SuperEffectiveMultiplierBoostAbAttr } from "#data/elite-redux/archetypes/super-effective-multiplier-boost";
import { SuppressAttackerAbilityAbAttr } from "#data/elite-redux/archetypes/suppress-attacker-ability";
import { TargetHighestStatDropAbAttr } from "#data/elite-redux/archetypes/target-highest-stat-drop";
import { TimeLimitedDamageReductionAbAttr } from "#data/elite-redux/archetypes/time-limited-damage-reduction";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { TurnDecayDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/turn-decay-damage-multiplier";
import { TypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/type-chart-override";
import { TypeGatedStatTriggerOnAttackAbAttr } from "#data/elite-redux/archetypes/type-gated-stat-trigger-on-attack";
import { TypedImmunityWithArenaTagAbAttr } from "#data/elite-redux/archetypes/typed-immunity-with-arena-tag";
import { UserFieldFlagImmunityAbAttr } from "#data/elite-redux/archetypes/user-field-flag-immunity";
import { WeatherBasedMoveBlockAbAttr } from "#data/elite-redux/archetypes/weather-based-move-block";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TerrainType } from "#data/terrain";
import { describe, expect, it } from "vitest";

describe("R48 primitive construction smoke", () => {
  it("TypeChartOverrideAbAttr accepts a non-empty rules array", () => {
    const a = new TypeChartOverrideAbAttr({
      rules: [{ attackType: PokemonType.ELECTRIC, defenderType: PokemonType.GROUND, newMultiplier: 0.5 }],
    });
    expect(a).toBeInstanceOf(TypeChartOverrideAbAttr);
  });

  it("TypeChartOverrideAbAttr rejects empty rules", () => {
    expect(() => new TypeChartOverrideAbAttr({ rules: [] })).toThrow();
  });

  it("SuperEffectiveMultiplierBoostAbAttr constructs with a factor", () => {
    const a = new SuperEffectiveMultiplierBoostAbAttr({ factor: 1.33 });
    expect(a).toBeInstanceOf(SuperEffectiveMultiplierBoostAbAttr);
  });

  it("PostVictoryClearTagAbAttr accepts a non-empty tag list", () => {
    const a = new PostVictoryClearTagAbAttr({ tags: [BattlerTagType.RECHARGING] });
    expect(a).toBeInstanceOf(PostVictoryClearTagAbAttr);
  });

  it("PostVictoryClearTagAbAttr rejects empty tag list", () => {
    expect(() => new PostVictoryClearTagAbAttr({ tags: [] })).toThrow();
  });

  it("TimeLimitedDamageReductionAbAttr accepts positive turns", () => {
    const a = new TimeLimitedDamageReductionAbAttr({ factor: 0.5, turns: 3 });
    expect(a).toBeInstanceOf(TimeLimitedDamageReductionAbAttr);
  });

  it("TimeLimitedDamageReductionAbAttr rejects zero turns", () => {
    expect(() => new TimeLimitedDamageReductionAbAttr({ factor: 0.5, turns: 0 })).toThrow();
  });

  it("TurnDecayDamageMultiplierAbAttr constructs with start/drop/floor", () => {
    const a = new TurnDecayDamageMultiplierAbAttr({ start: 1.0, drop: 0.2, floor: 0.2 });
    expect(a).toBeInstanceOf(TurnDecayDamageMultiplierAbAttr);
  });

  it("SkipChargeTurnAbAttr constructs without args", () => {
    expect(new SkipChargeTurnAbAttr()).toBeInstanceOf(SkipChargeTurnAbAttr);
  });

  it("TargetHighestStatDropAbAttr accepts a non-empty rules array", () => {
    const a = new TargetHighestStatDropAbAttr({
      rules: [{ candidates: [Stat.ATK, Stat.SPATK], stages: -1 }],
    });
    expect(a).toBeInstanceOf(TargetHighestStatDropAbAttr);
  });

  it("TargetHighestStatDropAbAttr rejects empty rules", () => {
    expect(() => new TargetHighestStatDropAbAttr({ rules: [] })).toThrow();
  });

  it("OutgoingStatDropMultiplierAbAttr accepts factor > 1", () => {
    const a = new OutgoingStatDropMultiplierAbAttr({ factor: 2 });
    expect(a).toBeInstanceOf(OutgoingStatDropMultiplierAbAttr);
  });

  it("OutgoingStatDropMultiplierAbAttr rejects factor ≤ 1", () => {
    expect(() => new OutgoingStatDropMultiplierAbAttr({ factor: 1 })).toThrow();
  });

  it("PostDefendChangeAttackerTypeAbAttr accepts a fixed type", () => {
    const a = new PostDefendChangeAttackerTypeAbAttr({
      type: PokemonType.PSYCHIC,
      side: "attacker",
      contactOnly: true,
    });
    expect(a).toBeInstanceOf(PostDefendChangeAttackerTypeAbAttr);
  });

  it("PostDefendChangeAttackerTypeAbAttr accepts 'moveType' string", () => {
    const a = new PostDefendChangeAttackerTypeAbAttr({
      type: "moveType",
      side: "self",
      requireFlag: MoveFlags.PULSE_MOVE,
    });
    expect(a).toBeInstanceOf(PostDefendChangeAttackerTypeAbAttr);
  });

  it("SuppressAttackerAbilityAbAttr accepts contact-only", () => {
    const a = new SuppressAttackerAbilityAbAttr({ contactOnly: true });
    expect(a).toBeInstanceOf(SuppressAttackerAbilityAbAttr);
  });

  it("SuppressAttackerAbilityAbAttr accepts status-gated", () => {
    const a = new SuppressAttackerAbilityAbAttr({
      requireAttackerStatus: [StatusEffect.POISON, StatusEffect.TOXIC],
    });
    expect(a).toBeInstanceOf(SuppressAttackerAbilityAbAttr);
  });

  it("PostSummonClearTerrainAbAttr accepts on-cleared stat boost", () => {
    const a = new PostSummonClearTerrainAbAttr({ onCleared: [{ stat: Stat.ATK, stages: 1 }] });
    expect(a).toBeInstanceOf(PostSummonClearTerrainAbAttr);
  });

  it("StatusCascadeAbAttr accepts a trigger + stats", () => {
    const a = new StatusCascadeAbAttr({
      trigger: StatusEffect.POISON,
      stats: [{ stat: Stat.ATK, stages: -1 }],
    });
    expect(a).toBeInstanceOf(StatusCascadeAbAttr);
  });

  it("StatusCascadeAbAttr rejects empty stats", () => {
    expect(() =>
      new StatusCascadeAbAttr({ trigger: StatusEffect.POISON, stats: [] }),
    ).toThrow();
  });

  it("PostFaintReviveAbAttr accepts hpFraction in (0, 1]", () => {
    const a = new PostFaintReviveAbAttr({
      hpFraction: 0.25,
      requireTerrain: [TerrainType.ELECTRIC],
    });
    expect(a).toBeInstanceOf(PostFaintReviveAbAttr);
  });

  it("PostFaintReviveAbAttr rejects out-of-range fraction", () => {
    expect(() => new PostFaintReviveAbAttr({ hpFraction: 0 })).toThrow();
    expect(() => new PostFaintReviveAbAttr({ hpFraction: 1.5 })).toThrow();
  });

  it("RepeatMovePowerBoostAbAttr accepts bonus + cap", () => {
    const a = new RepeatMovePowerBoostAbAttr({ bonus: 0.1, cap: 2.0 });
    expect(a).toBeInstanceOf(RepeatMovePowerBoostAbAttr);
  });

  it("DamageCapOnResistAbAttr constructs without args", () => {
    expect(new DamageCapOnResistAbAttr()).toBeInstanceOf(DamageCapOnResistAbAttr);
  });

  it("OneShotTypeBoostAbAttr + Followup construct as a pair", () => {
    const a = new OneShotTypeBoostAbAttr({ type: PokemonType.ELECTRIC, factor: 2 });
    const b = new OneShotTypeBoostFollowupAbAttr({ type: PokemonType.ELECTRIC, factor: 2 });
    expect(a).toBeInstanceOf(OneShotTypeBoostAbAttr);
    expect(b).toBeInstanceOf(OneShotTypeBoostFollowupAbAttr);
  });

  it("OnCritStatBoostLowestAbAttr accepts n + stages", () => {
    const a = new OnCritStatBoostLowestAbAttr({ n: 3, stages: 1 });
    expect(a).toBeInstanceOf(OnCritStatBoostLowestAbAttr);
  });

  it("StabSuppressAuraAbAttr constructs without args", () => {
    expect(new StabSuppressAuraAbAttr()).toBeInstanceOf(StabSuppressAuraAbAttr);
  });

  it("BstConditionalAllyAuraAbAttr accepts bstMax + stages", () => {
    const a = new BstConditionalAllyAuraAbAttr({ bstMax: 400, stages: 1 });
    expect(a).toBeInstanceOf(BstConditionalAllyAuraAbAttr);
  });

  it("FoeStrongestStatSelfBoostAbAttr accepts physical+special counters", () => {
    const a = new FoeStrongestStatSelfBoostAbAttr({
      stages: 2,
      physicalCounter: Stat.DEF,
      specialCounter: Stat.SPDEF,
    });
    expect(a).toBeInstanceOf(FoeStrongestStatSelfBoostAbAttr);
  });

  it("SePriorityBonusAbAttr accepts a priority value", () => {
    const a = new SePriorityBonusAbAttr({ priority: 1 });
    expect(a).toBeInstanceOf(SePriorityBonusAbAttr);
  });

  it("PostSummonStackSetEffectsAbAttr accepts terrain + tags", () => {
    const a = new PostSummonStackSetEffectsAbAttr({
      terrain: TerrainType.GRASSY,
      tags: [{ type: ArenaTagType.TAILWIND, turns: 4, side: 0 }],
    });
    expect(a).toBeInstanceOf(PostSummonStackSetEffectsAbAttr);
  });

  it("WeatherBasedMoveBlockAbAttr constructs without args", () => {
    expect(new WeatherBasedMoveBlockAbAttr()).toBeInstanceOf(WeatherBasedMoveBlockAbAttr);
  });

  it("UserFieldFlagImmunityAbAttr accepts a flag", () => {
    const a = new UserFieldFlagImmunityAbAttr({ flag: MoveFlags.SOUND_BASED });
    expect(a).toBeInstanceOf(UserFieldFlagImmunityAbAttr);
  });

  it("PreSwitchOutItemRestoreAbAttr constructs without args", () => {
    expect(new PreSwitchOutItemRestoreAbAttr()).toBeInstanceOf(PreSwitchOutItemRestoreAbAttr);
  });

  it("TrapDurationModifierAbAttr accepts turns + damageFraction", () => {
    const a = new TrapDurationModifierAbAttr({ turns: 6, damageFraction: 1 / 6 });
    expect(a).toBeInstanceOf(TrapDurationModifierAbAttr);
  });

  it("TypeGatedStatTriggerOnAttackAbAttr accepts type + stats", () => {
    const a = new TypeGatedStatTriggerOnAttackAbAttr({
      type: PokemonType.FIGHTING,
      stats: [{ stat: Stat.SPD, stages: 1 }],
      clearHazards: true,
    });
    expect(a).toBeInstanceOf(TypeGatedStatTriggerOnAttackAbAttr);
  });

  it("TypedImmunityWithArenaTagAbAttr accepts type + arena tag", () => {
    const a = new TypedImmunityWithArenaTagAbAttr({
      immuneType: PokemonType.WATER,
      arenaTag: ArenaTagType.MIST,
      turns: 5,
    });
    expect(a).toBeInstanceOf(TypedImmunityWithArenaTagAbAttr);
  });

  it("ContactQuashAbAttr constructs with optional stages", () => {
    expect(new ContactQuashAbAttr()).toBeInstanceOf(ContactQuashAbAttr);
    expect(new ContactQuashAbAttr({ stages: -3 })).toBeInstanceOf(ContactQuashAbAttr);
  });

  it("PostSummonQuashFoesAbAttr constructs with optional stages", () => {
    expect(new PostSummonQuashFoesAbAttr()).toBeInstanceOf(PostSummonQuashFoesAbAttr);
  });

  it("PostTurnFoeStatDropAbAttr accepts stat + stages + trapAtStage", () => {
    const a = new PostTurnFoeStatDropAbAttr({ stat: Stat.SPD, stages: -1, trapAtStage: -3 });
    expect(a).toBeInstanceOf(PostTurnFoeStatDropAbAttr);
  });

  it("PostDefendSuppressOpponentDamageBoostAbAttr constructs without args", () => {
    expect(new PostDefendSuppressOpponentDamageBoostAbAttr()).toBeInstanceOf(
      PostDefendSuppressOpponentDamageBoostAbAttr,
    );
  });

  it("FieldStatShareAbAttr constructs without args", () => {
    expect(new FieldStatShareAbAttr()).toBeInstanceOf(FieldStatShareAbAttr);
  });

  it("DefenseStatSwapOnStatusedFoeAbAttr constructs without args", () => {
    expect(new DefenseStatSwapOnStatusedFoeAbAttr()).toBeInstanceOf(DefenseStatSwapOnStatusedFoeAbAttr);
  });
});
