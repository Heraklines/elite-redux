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
  BadDreamsImmunityAbAttr,
  BlockRecoilDamageAttr,
  CritUseLowerDefensiveStatAbAttr,
  PostDefendContactDamageAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  SelfStatDropImmunityAbAttr,
  SetMoveAccuracyAbAttr,
  SpreadTargetByFlagAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import {
  ChanceBattlerTagOnAttackAbAttr,
  ChanceBattlerTagOnHitAbAttr,
  ChanceStatusOnAttackAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { ConditionalDamageAbAttr } from "#data/elite-redux/archetypes/conditional-damage";
import { CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { EffectChanceModifierAbAttr } from "#data/elite-redux/archetypes/effect-chance-modifier";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { LifestealOnKoAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { PostDefendHpGatedSelfTagAbAttr } from "#data/elite-redux/archetypes/post-defend-hp-gated-self-tag";
import { PostFaintSpreadDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-spread-detonate";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import { PriorityModifierAbAttr } from "#data/elite-redux/archetypes/priority-modifier";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { StatTriggerOnHitAbAttr, StatTriggerOnKoAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { StatusEffectImmunityAbAttrEr } from "#data/elite-redux/archetypes/status-immunity";
import { SuperEffectiveMultiplierBoostAbAttr } from "#data/elite-redux/archetypes/super-effective-multiplier-boost";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { WeatherStatMultiplierAbAttr } from "#data/elite-redux/archetypes/weather-stat-multiplier";
import {
  WeatherDamageReductionAbAttr,
  WeatherTypeBoostAbAttr,
  WeatherTypeDebuffCancelAbAttr,
} from "#data/elite-redux/archetypes/weather-terrain-interaction";
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
  it("er id 439 (Angel's Wrath) alters its attacking moves: never-miss + exact power boosts", () => {
    const res = dispatchArchetype("bespoke", null, 439);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a instanceof ConditionalAlwaysHitAbAttr)).toBe(true);
    const tagAttrs = res.attrs.filter(
      (a): a is ChanceBattlerTagOnAttackAbAttr => a instanceof ChanceBattlerTagOnAttackAbAttr,
    );
    expect(tagAttrs).toHaveLength(0);
    expect(res.attrs.some(a => a.constructor.name === "ChanceStatusOnAttackAbAttr")).toBe(false);
    expect(res.attrs.filter(a => a.constructor.name === "MovePowerBoostAbAttr")).toHaveLength(4);
  });

  it("er id 715 (Hover) wires Psychic type-add + Ground-move immunity + FloatAbAttr ungrounding", () => {
    const res = dispatchArchetype("bespoke", null, 715);
    expect(res.skipReason).toBeNull();
    const names = res.attrs.map(a => a.constructor.name);
    expect(names).toContain("EntryEffectAbAttr");
    expect(names).toContain("AttackTypeImmunityAbAttr");
    expect(names).toContain("FloatAbAttr");
  });

  it("er id 720 (Stun Shock) wires a 60% paralyze-OR-poison roll (two effects)", () => {
    const res = dispatchArchetype("bespoke", null, 720);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs.find(a => a.constructor.name === "ChanceStatusOnAttackAbAttr");
    expect(attr).toBeDefined();
    expect((attr as unknown as { getEffects(): readonly number[] }).getEffects()).toEqual([
      StatusEffect.PARALYSIS,
      StatusEffect.POISON,
    ]);
  });

  it("er id 716 (Depravity) is faithful: crit-on-status + Electric-SE-vs-Electric + paralyze-Electric", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Merciless", "Overcharge"] }, 716);
    expect(res.skipReason).toBeNull();
    const names = res.attrs.map(a => a.constructor.name);
    expect(names).toContain("ConditionalCritAbAttr");
    expect(names).toContain("OffensiveTypeChartOverrideAbAttr");
    expect(names).toContain("IgnoreTypeStatusEffectImmunityAbAttr");
  });

  it("er id 725 (Trash Heap) appends the Poison-super-effective-vs-Steel override", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Corrosion", "Toxic Spill"] }, 725);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "OffensiveTypeChartOverrideAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "IgnoreTypeStatusEffectImmunityAbAttr")).toBe(true);
  });

  it("er id 726 (Sludgy Mix) appends the Poison-type 10% toxic rider", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Intoxicate", "Punk Rock"] }, 726);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "ChanceStatusOnAttackAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "TypeConversionAbAttr")).toBe(true);
  });

  it("er id 841 (Draconic Might) appends the Dragon-neutral-vs-Fairy override (gated on holder Dragon)", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Draconize", "Half Drake"] }, 841);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "TypeConversionAbAttr")).toBe(true);
    const override = res.attrs.find(a => a.constructor.name === "OffensiveTypeChartOverrideAbAttr");
    expect(override).toBeDefined();
    expect(override?.getCondition()).not.toBeNull();
  });

  it("er id 852 (Envenom) poisons after ANY move, not contact-only", () => {
    const res = dispatchArchetype(
      "chance-status-on-hit",
      { chance: 30, status: "POISON", direction: "offense", onContactOnly: false },
      852,
    );
    expect(res.skipReason).toBeNull();
    const proc = res.attrs.find(a => a.constructor.name === "ChanceStatusOnAttackAbAttr");
    expect(proc).toBeDefined();
    expect((proc as unknown as { contactRequired: boolean }).contactRequired).toBe(false);
  });

  it("er id 758 (Brute Force) appends the enraged-all-moves boost (TAUNT-gated) on top of Reckless", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Rock Head", "Reckless"] }, 758);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "BlockRecoilDamageAttr")).toBe(true);
    // Reckless (recoil-move boost) + the while-enraged all-moves boost = 2 MovePowerBoost.
    expect(res.attrs.filter(a => a.constructor.name === "MovePowerBoostAbAttr").length).toBeGreaterThanOrEqual(2);
  });

  it("er id 924 (Taste the Rainbow) sets the WATER_FIRE_PLEDGE (rainbow) arena tag, not a rain approximation", () => {
    const res = dispatchArchetype("bespoke", null, 924);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "EntryArenaTagOnFoeSideAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "PostSummonScriptedMoveAbAttr")).toBe(false);
  });

  it("er id 908 (Lightsaber) Keen-Edge status proc can inflict burn OR paralysis (not burn only)", () => {
    const res = dispatchArchetype("bespoke", null, 908);
    expect(res.skipReason).toBeNull();
    const cs = res.attrs.find(a => a.constructor.name === "ChanceStatusOnAttackAbAttr");
    expect(cs).toBeDefined();
    const effects = (cs as unknown as { getEffects(): StatusEffect[] }).getEffects();
    expect(effects).toEqual(expect.arrayContaining([StatusEffect.BURN, StatusEffect.PARALYSIS]));
  });

  it("er id 880 (Paint Shot) repaints the FOE offensively on pulse moves (not defensive self-change)", () => {
    const res = dispatchArchetype("bespoke", null, 880);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "PostAttackChangeTargetTypeAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "PostDefendChangeAttackerTypeAbAttr")).toBe(false);
  });

  it("er id 887 (Crystalline Armor) wires crit immunity + Mirror Armor (reflects stat drops)", () => {
    const res = dispatchArchetype("bespoke", null, 887);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "CritImmunityAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "ReflectStatStageChangeAbAttr")).toBe(true);
  });

  it("er id 886 (Curse of Famine) clears terrain → +1 Def AND restores HP", () => {
    const res = dispatchArchetype("bespoke", null, 886);
    expect(res.skipReason).toBeNull();
    const clear = res.attrs.find(a => a.constructor.name === "PostSummonClearTerrainAbAttr");
    expect(clear).toBeDefined();
    expect((clear as unknown as { healFractionOnCleared: number }).healFractionOnCleared).toBeGreaterThan(0);
  });

  it("er id 879 (Chilling Pellets) counters with 13BP Icicle Spear on contact", () => {
    const res = dispatchArchetype("bespoke", null, 879);
    expect(res.skipReason).toBeNull();
    const counter = res.attrs.find(a => a.constructor.name === "CounterAttackOnHitAbAttr");
    expect(counter).toBeDefined();
    expect((counter as unknown as { power?: number }).power).toBe(13);
  });

  it("er id 868 (Lightning Aspect) absorbs Electric + boosts the HIGHER attacking stat (not hardcoded SpAtk)", () => {
    const res = dispatchArchetype("bespoke", null, 868);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "TypeImmunityHighestAttackStatStageAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "TypeImmunityStatStageChangeAbAttr")).toBe(false);
  });

  it("er id 864 (Chuckster) wires once-per-entry contact 50% reduction + force-switch", () => {
    const res = dispatchArchetype("bespoke", null, 864);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "OncePerEntryContactDamageReductionAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "PostDamageForceAttackerOutAbAttr")).toBe(true);
  });

  it("er id 861 (Hungry Maws) KO-heal is biting-conditional (0.25 base, 0.5 on biting moves)", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Strong Jaw", "Jaws of Carnage"] }, 861);
    expect(res.skipReason).toBeNull();
    const ko = res.attrs.find(a => a.constructor.name === "LifestealOnKoAbAttr");
    expect(ko).toBeDefined();
    // Base fraction dropped to 0.25 (biting bonus 0.5 lives in flagBonus).
    expect((ko as unknown as { getHealFraction(): number }).getHealFraction()).toBe(0.25);
  });

  it("er id 862 (Thermal Slide) wires sun/hail Speed ×1.5 + hail-damage immunity", () => {
    const res = dispatchArchetype("bespoke", null, 862);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "WeatherStatMultiplierAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "BlockWeatherDamageAttr")).toBe(true);
  });

  it("er id 865 (Heat Sink) wires Fire redirection + absorb + highest-attack boost", () => {
    const res = dispatchArchetype(
      "type-resist-or-absorb",
      { type: "FIRE", effect: { kind: "absorb", redirect: true, statBoost: { stat: "ATK", stages: 1 } } },
      865,
    );
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "RedirectTypeMoveAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "TypeAbsorbStatBoostAbAttr")).toBe(true);
  });

  it("er id 837 (Chokehold) wires per-turn -1 SPD + paralysis on TRAPPED foes (not on-any-hit)", () => {
    const res = dispatchArchetype("bespoke", null, 837);
    expect(res.skipReason).toBeNull();
    const drop = res.attrs.find(a => a.constructor.name === "PostTurnFoeStatDropAbAttr");
    expect(drop).toBeDefined();
    const opts = (drop as unknown as { opts: { onlyIfTrapped?: boolean; inflictStatus?: number } }).opts;
    expect(opts.onlyIfTrapped).toBe(true);
    expect(opts.inflictStatus).toBe(StatusEffect.PARALYSIS);
    expect(res.attrs.some(a => a.constructor.name === "StatTriggerOnHitAbAttr")).toBe(false);
  });

  it("er id 838 (Guardian Coat) wires -20% physical + weather-damage block + powder immunity", () => {
    const res = dispatchArchetype("bespoke", null, 838);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "DamageReductionAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "BlockWeatherDamageAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "MoveImmunityAbAttr")).toBe(true);
  });

  it("er id 843 (Fey Flight) wires Fairy-add + Ground immunity + Float + Flying ×1.25", () => {
    const res = dispatchArchetype("bespoke", null, 843);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "FloatAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "TypeDamageBoostAbAttr")).toBe(true);
  });

  it("er id 815 (Overrule) wires the OverruleCrit marker (crit ignores def-abilities + resisted ×2)", () => {
    const res = dispatchArchetype("bespoke", null, 815);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "OverruleCritAbAttr")).toBe(true);
    // No leftover flat crit-damage multiplier from the old crit-mod wiring.
    expect(res.attrs.some(a => a.constructor.name === "CritDamageMultiplierAbAttr")).toBe(false);
  });

  it("er id 825 (Glacial Ghost) wires Snow Cloak as a 25% incoming-accuracy reduction (not an evasion boost)", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Slush Rush", "Snow Cloak"] }, 825);
    expect(res.skipReason).toBeNull();
    const acc = res.attrs.find(a => a.constructor.name === "IncomingAccuracyMultiplierAbAttr");
    expect(acc).toBeDefined();
    expect((acc as unknown as { getMultiplier(): number }).getMultiplier()).toBe(0.75);
    // The hail gate is preserved (carried over from the Snow Cloak evasion attr).
    expect(acc?.getCondition()).not.toBeNull();
  });

  it("er id 819 (Serpent Bind) wires 50% trap-on-contact AND the per-turn -1 SPD on trapped foes", () => {
    const res = dispatchArchetype("bespoke", null, 819);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr")).toBe(true);
    const drop = res.attrs.find(a => a.constructor.name === "PostTurnFoeStatDropAbAttr");
    expect(drop).toBeDefined();
    expect((drop as unknown as { opts: { onlyIfTrapped?: boolean } }).opts.onlyIfTrapped).toBe(true);
  });

  it("er id 818 (Tentalock) inherits Serpent Bind's per-turn trapped-foe speed drop", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Grappler", "Serpent Bind"] }, 818);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "TrapDurationModifierAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "PostTurnFoeStatDropAbAttr")).toBe(true);
  });

  it.each([398, 408, 599])("er id %i uses an offensive battler-tag proc", id => {
    const res = dispatchArchetype("bespoke", null, id);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a instanceof ChanceBattlerTagOnAttackAbAttr)).toBe(true);
    expect(res.attrs.some(a => a instanceof ChanceBattlerTagOnHitAbAttr)).toBe(false);
  });

  it("er id 373 wires offensive trap, trapped-target stat bypass, and trapped-target always-hit", () => {
    const res = dispatchArchetype("bespoke", null, 373);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a instanceof ChanceBattlerTagOnAttackAbAttr)).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "IgnoreOpponentStatStagesAbAttr")).toBe(true);
    const alwaysHit = res.attrs.find(a => a instanceof ConditionalAlwaysHitAbAttr) as ConditionalAlwaysHitAbAttr;
    expect(alwaysHit.opts.targetTrapped).toBe(true);
  });

  it("er id 492 splits contact and non-contact tiers on offense and defense", () => {
    const res = dispatchArchetype("bespoke", null, 492);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.filter(a => a instanceof ChanceBattlerTagOnHitAbAttr)).toHaveLength(2);
    expect(res.attrs.filter(a => a instanceof ChanceBattlerTagOnAttackAbAttr)).toHaveLength(2);
  });

  it("er id 829 (Stainless Steel) appends Steel STAB (Steelworker's 'otherwise' clause)", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Fort Knox", "Steelworker"] }, 829);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "MoveTypeChangeAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "StabAddAbAttr")).toBe(true);
  });

  it("er id 783 (Caretaker) cures BOTH ally and self (two PostTurnResetStatus, one per target)", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Healer", "Friend Guard"] }, 783);
    expect(res.skipReason).toBeNull();
    const cures = res.attrs.filter(a => a.constructor.name === "PostTurnResetStatusAbAttr");
    expect(cures).toHaveLength(2);
    const allyFlags = cures.map(a => (a as unknown as { allyTarget: boolean }).allyTarget).sort();
    expect(allyFlags).toEqual([false, true]); // one self-cure + one ally-cure
  });

  it("er id 806 (Super Sniper) wires Sniper crit + the real switch-out strike (Pursuit)", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Sniper", "switch-strike"] }, 806);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "MultCritAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "OnOpponentSwitchOutAbAttr")).toBe(true);
  });

  it("er id 760 (Acidic Slime) appends the Poison-super-effective-vs-Steel override", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Corrosion", "Poison STAB"] }, 760);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "OffensiveTypeChartOverrideAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "IgnoreTypeStatusEffectImmunityAbAttr")).toBe(true);
  });

  it("er id 762 (Qigong) appends the Fighting Spirit conversion (Normal→Fighting + STAB)", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Always hits", "Rampage"] }, 762);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "AlwaysHitAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "TypeConversionAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "StabAddAbAttr")).toBe(true);
  });

  it("er id 772 (Relentless) appends the 1.25× statused-foe damage boost", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", { parts: ["Exploit Weakness", "Merciless"] }, 772);
    expect(res.skipReason).toBeNull();
    // Exploit Weakness (284) now wires the real defensive-stat swap primitive
    // (the archetype alias subclasses LowerDefensiveStatVsStatusedFoeAbAttr).
    expect(res.attrs.some(a => a.constructor.name === "DefenseStatSwapOnStatusedFoeAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "ConditionalCritAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "MovePowerBoostAbAttr")).toBe(true);
  });

  it("er id 699 (Energized) wires entry CHARGED + recharge on Electric Terrain + recharge on Electric KO", () => {
    const res = dispatchArchetype("bespoke", null, 699);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "PostSummonAddBattlerTagAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "RechargeChargedOnElectricTerrainAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "RechargeChargedOnElectricKoAbAttr")).toBe(true);
  });

  it("er id 704 (Hot Coals) wires the HOT_COALS foe-side burn-trap entry effect", () => {
    const res = dispatchArchetype("bespoke", null, 704);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "EntryEffectAbAttr")).toBe(true);
  });

  it("er id 708 (Megabite) wires BITING 1.3x boost AND the SpAtk attack-stat substitute", () => {
    const res = dispatchArchetype("bespoke", null, 708);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "FlagDamageBoostAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "AttackStatSubstituteAbAttr")).toBe(true);
  });

  it("er id 756 (Twinkle Toes) wires kicking boost + Pixilate (Normal→Fairy + STAB) + gated infatuate", () => {
    const res = dispatchArchetype("bespoke", null, 756);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "FlagDamageBoostAbAttr")).toBe(true);
    const conv = res.attrs.find(a => a.constructor.name === "TypeConversionAbAttr");
    expect(conv).toBeDefined();
    expect(res.attrs.some(a => a.constructor.name === "StabAddAbAttr")).toBe(true);
    const infatuate = res.attrs.find(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr");
    expect(infatuate).toBeDefined();
    // Infatuate is gated on the holder being Fairy-type.
    expect(infatuate?.getCondition()).not.toBeNull();
  });

  it("er id 774 (Corrupted Mind) wires the psychic type-chart override + a type-filtered ×1.4 effect chance", () => {
    const res = dispatchArchetype("bespoke", null, 774);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "OffensiveTypeChartOverrideAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "TypeFilteredEffectChanceMultiplierAbAttr")).toBe(true);
  });

  it("er id 800 (Deviate) wires Normal→Dark conversion + a Dark-type-gated 10% enrage rider", () => {
    const res = dispatchArchetype("bespoke", null, 800);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "TypeConversionAbAttr")).toBe(true);
    const rider = res.attrs.find(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr");
    expect(rider).toBeDefined();
    expect((rider as unknown as { getTags(): BattlerTagType[] }).getTags()).toContain(BattlerTagType.TAUNT);
    expect(rider?.getCondition()).not.toBeNull(); // gated on holder being Dark-type
  });

  it("er id 809 (Blur) gates the Speed-as-defense substitute to CONTACT moves", () => {
    const res = dispatchArchetype("bespoke", null, 809);
    expect(res.skipReason).toBeNull();
    const sub = res.attrs.find(a => a.constructor.name === "SpeedBonusToStatAbAttr");
    expect(sub).toBeDefined();
    expect((sub as unknown as { bonusFilter: { contact?: string } }).bonusFilter.contact).toBe("only");
  });

  it("er id 810 (Elude) gates the Speed-as-defense substitute to NON-contact moves", () => {
    const res = dispatchArchetype("bespoke", null, 810);
    expect(res.skipReason).toBeNull();
    const sub = res.attrs.find(a => a.constructor.name === "SpeedBonusToStatAbAttr");
    expect(sub).toBeDefined();
    expect((sub as unknown as { bonusFilter: { contact?: string } }).bonusFilter.contact).toBe("non");
  });

  it("er id 812 (Reverberate) grants the SOUND_BASED flag to Normal moves (not a power boost)", () => {
    const res = dispatchArchetype("bespoke", null, 812);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "AddMoveFlagAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "MovePowerBoostAbAttr")).toBe(false);
  });

  it("er id 814 (Strategic Pause) wires moving-last-gated +2 crit AND the Analytic +30% power", () => {
    const res = dispatchArchetype("bespoke", null, 814);
    expect(res.skipReason).toBeNull();
    const crit = res.attrs.find(a => a.constructor.name === "CritStageBonusAbAttr");
    expect(crit).toBeDefined();
    expect(crit?.getCondition()).not.toBeNull(); // gated on moving last
    expect(res.attrs.some(a => a.constructor.name === "MovePowerBoostAbAttr")).toBe(true);
  });

  // --- ER "Enrage" === vanilla TAUNT tag (per ER's TM12/Taunt text) ---
  it("er id 529 (Berserk DNA) wires highest-stat boost + self-enrage (TAUNT) on entry", () => {
    const res = dispatchArchetype("bespoke", null, 529);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "SelfHighestStatBoostOnSummonAbAttr")).toBe(true);
    const tag = res.attrs.find(a => a.constructor.name === "PostSummonAddBattlerTagAbAttr");
    expect(tag).toBeDefined();
    expect((tag as unknown as { tagType: BattlerTagType }).tagType).toBe(BattlerTagType.TAUNT);
    // No leftover self-damage proxy from the old enrage model.
    expect(res.attrs.some(a => a.constructor.name === "SelfDamageOnAttackAbAttr")).toBe(false);
  });

  it("er id 534 (Cosmic Daze) wires 2x vs CONFUSED or TAUNT(enraged) foes", () => {
    const res = dispatchArchetype("bespoke", null, 534);
    expect(res.skipReason).toBeNull();
    const cd = res.attrs.find(a => a.constructor.name === "ConditionalDamageAbAttr");
    expect(cd).toBeDefined();
    const cond = (
      cd as unknown as { getDamageCondition(): { kind: string; tags?: BattlerTagType[] } }
    ).getDamageCondition();
    expect(cond.kind).toBe("target-has-any-tag");
    expect(cond.tags).toEqual(expect.arrayContaining([BattlerTagType.CONFUSED, BattlerTagType.TAUNT]));
  });

  it("er id 816 (Mental Pollution) suppresses attacker ability, gated on the holder being enraged (TAUNT)", () => {
    const res = dispatchArchetype("bespoke", null, 816);
    expect(res.skipReason).toBeNull();
    const sup = res.attrs.find(a => a.constructor.name === "SuppressAttackerAbilityAbAttr");
    expect(sup).toBeDefined();
    expect(sup?.getCondition()).not.toBeNull();
  });

  it("er id 817 (Madness Enhancement) halves damage when enraged + self-enrages (TAUNT) in fog", () => {
    const res = dispatchArchetype("bespoke", null, 817);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "ReceivedMoveDamageMultiplierAbAttr")).toBe(true);
    const tag = res.attrs.find(a => a.constructor.name === "PostSummonAddBattlerTagAbAttr");
    expect(tag).toBeDefined();
    expect((tag as unknown as { tagType: BattlerTagType }).tagType).toBe(BattlerTagType.TAUNT);
    expect(tag?.getCondition()).not.toBeNull(); // gated on fog
  });

  it("er id 738 (Rude Awakening) wires gated sleep immunity + the on-wake stat boost", () => {
    const res = dispatchArchetype("bespoke", null, 738);
    expect(res.skipReason).toBeNull();
    // Sleep immunity is present but CONDITIONALLY gated (not active until first wake).
    const imm = res.attrs.find(a => a.constructor.name === "StatusEffectImmunityAbAttrEr");
    expect(imm).toBeDefined();
    expect(imm?.getCondition()).not.toBeNull();
    // The on-wake hook that grants the once-per-battle omniboost + flips the gate.
    expect(res.attrs.some(a => a.constructor.name === "WakeStatBoostAbAttr")).toBe(true);
  });

  it("er id 742 (Magical Fists) wires PUNCHING 1.3x boost AND the SpAtk attack-stat substitute", () => {
    const res = dispatchArchetype("bespoke", null, 742);
    expect(res.skipReason).toBeNull();
    const boost = res.attrs.find(a => a.constructor.name === "FlagDamageBoostAbAttr");
    expect(boost).toBeDefined();
    expect((boost as unknown as { flag: number }).flag).toBe(MoveFlags.PUNCHING_MOVE);
    expect(res.attrs.some(a => a.constructor.name === "AttackStatSubstituteAbAttr")).toBe(true);
  });

  it("er id 751 (Energy Horns) wires HORN_BASED 1.3x boost AND the SpAtk attack-stat substitute", () => {
    const res = dispatchArchetype("bespoke", null, 751);
    expect(res.skipReason).toBeNull();
    const boost = res.attrs.find(a => a.constructor.name === "FlagDamageBoostAbAttr");
    expect(boost).toBeDefined();
    expect((boost as unknown as { flag: number }).flag).toBe(MoveFlags.HORN_BASED);
    expect(res.attrs.some(a => a.constructor.name === "AttackStatSubstituteAbAttr")).toBe(true);
  });

  it("er id 753 (Crust Coat) wires crit immunity AND a 0.8 all-damage reduction", () => {
    const res = dispatchArchetype("bespoke", null, 753);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "CritImmunityAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "DamageReductionAbAttr")).toBe(true);
  });

  it("er id 754 (Puffy) wires contact 0.5 reduction AND a Fire ×2 weakness", () => {
    const res = dispatchArchetype("bespoke", null, 754);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "DamageReductionAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "ReceivedTypeDamageMultiplierAbAttr")).toBe(true);
  });

  it("er id 703 (Rage Point) wires the statused boost + on-crit boost + burn/frostbite bypass", () => {
    const res = dispatchArchetype("bespoke", null, 703);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.filter(a => a.constructor.name === "StatMultiplierAbAttr")).toHaveLength(2);
    expect(res.attrs.filter(a => a.constructor.name === "PostReceiveCritStatStageChangeAbAttr")).toHaveLength(2);
    expect(res.attrs.some(a => a.constructor.name === "BypassBurnDamageReductionAbAttr")).toBe(true);
  });

  it("er id 698 (Pinnacle Blade) wires never-miss + slicing protect-bypass", () => {
    const res = dispatchArchetype("bespoke", null, 698);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "ConditionalAlwaysHitAbAttr")).toBe(true);
    const byFlag = res.attrs.find(a => a.constructor.name === "IgnoreProtectByFlagAbAttr");
    expect(byFlag).toBeDefined();
    expect((byFlag as unknown as { flag: number }).flag).toBe(MoveFlags.SLICING_MOVE);
  });

  it("er id 700 (Color Spectrum) wires STAB power boost + per-turn random-type rotation", () => {
    const res = dispatchArchetype("bespoke", null, 700);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "MovePowerBoostAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "PostTurnRandomPureTypeAbAttr")).toBe(true);
  });

  it("er id 381 (Pollinate) wires Normal→Bug conversion + Bug powder immunity", () => {
    const res = dispatchArchetype("bespoke", null, 381);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "TypeConversionAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "BugPowderImmunityAbAttr")).toBe(true);
  });

  it("er id 709 (Dream State) wires crit immunity AND a 0.8 all-damage reduction", () => {
    const res = dispatchArchetype("bespoke", null, 709);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "CritImmunityAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "DamageReductionAbAttr")).toBe(true);
  });

  it("er id 713 (Aquatic Dweller) wires Water 1.5x boost AND an entry Water type-add", () => {
    const res = dispatchArchetype("bespoke", null, 713);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "TypeDamageBoostAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "EntryEffectAbAttr")).toBe(true);
  });

  it("er id 589 (Catastrophe) wires two type×weather boosts AND two weather-debuff cancels, no flat WeatherStatMultiplier", () => {
    const res = dispatchArchetype("bespoke", null, 589);
    expect(res.skipReason).toBeNull();
    // Each weather→type pairing (Water-in-sun, Fire-in-rain) gets a ×1.5 power
    // boost PLUS a debuff-cancel so the adverse weather ×0.5 doesn't swallow it.
    const boosts = res.attrs.filter((a): a is WeatherTypeBoostAbAttr => a instanceof WeatherTypeBoostAbAttr);
    expect(boosts).toHaveLength(2);
    const cancels = res.attrs.filter(
      (a): a is WeatherTypeDebuffCancelAbAttr => a instanceof WeatherTypeDebuffCancelAbAttr,
    );
    expect(cancels).toHaveLength(2);
    expect(boosts.every(b => b.getMultiplier() === 1.5)).toBe(true);
    // The prior flat-stat approximation must remain absent.
    expect(res.attrs.some(a => a.constructor.name === "WeatherStatMultiplierAbAttr")).toBe(false);
  });

  it("er id 668 (No Turning Back) wires a one-time +1 all-stats boost + NO_RETREAT self-trap (no continuous mult)", () => {
    const res = dispatchArchetype("bespoke", null, 668);
    expect(res.skipReason).toBeNull();
    const boost = res.attrs.find(a => a.constructor.name === "PostDefendHpGatedStatStageChangeAbAttr");
    expect(boost).toBeDefined();
    const trap = res.attrs.find(
      (a): a is PostDefendHpGatedSelfTagAbAttr => a instanceof PostDefendHpGatedSelfTagAbAttr,
    );
    expect(trap).toBeDefined();
    expect(trap?.getTagType()).toBe(BattlerTagType.NO_RETREAT);
    expect(trap?.getHpGate()).toBe(0.5);
    // The prior continuous-1.2x StatMultiplier approximation must be gone.
    expect(res.attrs.some(a => a instanceof StatMultiplierAbAttr)).toBe(false);
  });

  it("er id 376 (Deadeye) wires never-miss for arrow+cannon flags and a crit-only weaker-defense retarget", () => {
    const res = dispatchArchetype("bespoke", null, 376);
    expect(res.skipReason).toBeNull();
    const alwaysHit = res.attrs.filter((a): a is ConditionalAlwaysHitAbAttr => a instanceof ConditionalAlwaysHitAbAttr);
    expect(alwaysHit).toHaveLength(2);
    const flags = alwaysHit.map(a => a.opts.flag);
    expect(flags).toContain(MoveFlags.ARROW_BASED);
    expect(flags).toContain(MoveFlags.BALLBOMB_MOVE);
    expect(res.attrs.some(a => a instanceof CritUseLowerDefensiveStatAbAttr)).toBe(true);
    // The botched extra-crit-stage approximation must be gone.
    expect(res.attrs.some(a => a instanceof CritStageBonusAbAttr)).toBe(false);
  });

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

  it("er id 333 (Sweet Dreams) wires PassiveRecovery (status: SLEEP, 1/8) + Bad Dreams immunity", () => {
    const res = dispatchArchetype("bespoke", null, 333);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const recovery = res.attrs.find((a): a is PassiveRecoveryAbAttr => a instanceof PassiveRecoveryAbAttr);
    expect(recovery).toBeDefined();
    expect(recovery?.getHealFraction()).toBeCloseTo(1 / 8);
    expect(recovery?.getRecoveryCondition()).toEqual({ kind: "status", status: StatusEffect.SLEEP });
    expect(res.attrs.some(a => a instanceof BadDreamsImmunityAbAttr)).toBe(true);
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
    expect(attr.getRecoveryCondition()).toEqual({
      kind: "weather",
      weathers: [WeatherType.FOG, WeatherType.EERIE_FOG],
    });
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

  it("er id 729 (Victory Bomb) wires PostFaintSpreadDetonate (100 BP Fire, no flinch)", () => {
    const res = dispatchArchetype("bespoke", null, 729);
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as PostFaintSpreadDetonateAbAttr;
    expect(attr).toBeInstanceOf(PostFaintSpreadDetonateAbAttr);
    expect(attr.getPower()).toBe(100);
    expect(attr.getType()).toBe(PokemonType.FIRE);
    expect(attr.getFlinch()).toBe(false);
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

  it("er id 429 (Coward) wires CowardOnceProtectAbAttr (once-per-battle PROTECT)", () => {
    const res = dispatchArchetype("bespoke", null, 429);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    // Round 11: Coward upgraded from the EntryEffect scripted-move stub to
    // a real CowardOnceProtectAbAttr that adds the PROTECTED tag on first
    // entry only.
    const attr = res.attrs[0];
    expect(attr.constructor.name).toBe("CowardOnceProtectAbAttr");
  });

  it("er id 431 (Dune Terror) wires WeatherDamageReduction (SANDSTORM, 0.65) + Ground +20%", () => {
    // "Sand reduces incoming damage by 35% AND Ground moves get +20% power."
    const res = dispatchArchetype("bespoke", null, 431);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const attr = res.attrs[0] as WeatherDamageReductionAbAttr;
    expect(attr).toBeInstanceOf(WeatherDamageReductionAbAttr);
    expect(attr.getMultiplier()).toBeCloseTo(0.65);
    expect(attr.getWeathers()).toEqual([WeatherType.SANDSTORM]);
    const groundBoost = res.attrs[1] as TypeDamageBoostAbAttr;
    expect(groundBoost).toBeInstanceOf(TypeDamageBoostAbAttr);
    expect(groundBoost.getBoostType()).toBe(PokemonType.GROUND);
    expect(groundBoost.getHighHpMultiplier()).toBeCloseTo(1.2);
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

  it("er id 673 (Blood Stain) wires self-bleed + spreads ER_BLEED on contact (offense + defense)", () => {
    // "Is always bleeding if not immune. Spreads on contact." — full wire:
    // entry self-bleed + persistent re-apply + spread on being hit AND on
    // landing a contact hit.
    const res = dispatchArchetype("bespoke", null, 673);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(4);
    const onHit = res.attrs.find(a => a instanceof ChanceBattlerTagOnHitAbAttr) as ChanceBattlerTagOnHitAbAttr;
    expect(onHit).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
    expect(onHit.getChance()).toBe(100);
    expect(onHit.getTags()).toEqual([BattlerTagType.ER_BLEED]);
    expect(onHit.requiresContact()).toBe(true);
    const onAttack = res.attrs.find(a => a instanceof ChanceBattlerTagOnAttackAbAttr) as ChanceBattlerTagOnAttackAbAttr;
    expect(onAttack).toBeInstanceOf(ChanceBattlerTagOnAttackAbAttr);
    expect(onAttack.getTags()).toEqual([BattlerTagType.ER_BLEED]);
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

  it("er id 705 (Terastal Treasure) wires DamageReduction (all, 0.4) + SPD x0.8 penalty", () => {
    // "Reduces damage taken by 40%, but lowers speed by 20%." — both halves.
    const res = dispatchArchetype("bespoke", null, 705);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const attr = res.attrs[0] as DamageReductionAbAttr;
    expect(attr).toBeInstanceOf(DamageReductionAbAttr);
    expect(attr.getReduction()).toBeCloseTo(0.4);
    expect(attr.getFilter()).toEqual({ kind: "all" });
    const spdPenalty = res.attrs[1] as StatMultiplierAbAttr;
    expect(spdPenalty).toBeInstanceOf(StatMultiplierAbAttr);
    expect(spdPenalty.stat).toBe(Stat.SPD);
    expect(spdPenalty.multiplier).toBeCloseTo(0.8);
  });

  it("er id 771 (Forsaken Heart) wires StatTriggerOnKo (+1 ATK)", () => {
    const res = dispatchArchetype("bespoke", null, 771);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatTriggerOnKoAbAttr;
    expect(attr.getStatChanges()).toEqual([{ stat: Stat.ATK, stages: 1 }]);
  });

  // Round 7 — pre-faint-revive + weather-stat-multiplier + crit-trigger
  it("er id 427 (Cheating Death) wires NullifyFirstNHits(2)", () => {
    // "Negates the first two instances of damage received." — the literal
    // reading is full damage-negation for the first 2 damaging hits (each set
    // to 0), wired via NullifyFirstNHits rather than an endure/revive gate.
    const res = dispatchArchetype("bespoke", null, 427);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as NullifyFirstNHitsAbAttr;
    expect(attr).toBeInstanceOf(NullifyFirstNHitsAbAttr);
    expect(attr.getN()).toBe(2);
  });

  it("er id 583 (Gallantry) wires NullifyFirstNHits(1)", () => {
    // "Negates the first instance of damage received." — full damage-negation
    // of the first incoming hit (set to 0), the N=1 sibling of Cheating Death.
    // NOT an endure/Sturdy-shaped PreFaintRevive clamp.
    const res = dispatchArchetype("bespoke", null, 583);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as NullifyFirstNHitsAbAttr;
    expect(attr).toBeInstanceOf(NullifyFirstNHitsAbAttr);
    expect(attr.getN()).toBe(1);
  });

  it("er id 724 (Lucky Halo) wires SelfStatDropImmunity + PreFaintRevive(first-n-hits:1)", () => {
    const res = dispatchArchetype("bespoke", null, 724);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs[0]).toBeInstanceOf(SelfStatDropImmunityAbAttr);
    const reviveAttr = res.attrs[1] as PreFaintReviveAbAttr;
    expect(reviveAttr).toBeInstanceOf(PreFaintReviveAbAttr);
    expect(reviveAttr.getUsage()).toEqual({ kind: "first-n-hits", n: 1 });
  });

  it("er id 862 (Thermal Slide) wires WeatherStatMultiplier (SPD, 1.5x, sun/hail set) + hail-damage immunity", () => {
    const res = dispatchArchetype("bespoke", null, 862);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const attr = res.attrs.find((a): a is WeatherStatMultiplierAbAttr => a instanceof WeatherStatMultiplierAbAttr)!;
    expect(attr).toBeInstanceOf(WeatherStatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.SPD);
    expect(attr.multiplier).toBe(1.5);
    expect(attr.getWeathers()).toEqual([WeatherType.SUNNY, WeatherType.HARSH_SUN, WeatherType.HAIL, WeatherType.SNOW]);
    // "Also grants immunity to hail damage."
    expect(res.attrs.some(a => a.constructor.name === "BlockWeatherDamageAttr")).toBe(true);
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
  it("er id 674 (Blood Stigma) wires status immunity (block-all) + 2x vs bleeding foes", () => {
    const res = dispatchArchetype("bespoke", null, 674);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const immunity = res.attrs[0] as StatusEffectImmunityAbAttrEr;
    expect(immunity).toBeInstanceOf(StatusEffectImmunityAbAttrEr);
    expect(immunity.getStatuses()).toEqual([]);
    const boost = res.attrs[1] as ConditionalDamageAbAttr;
    expect(boost).toBeInstanceOf(ConditionalDamageAbAttr);
    expect(boost.getMultiplier()).toBe(2);
    expect(boost.getDamageCondition()).toEqual({ kind: "target-has-tag", tag: BattlerTagType.ER_BLEED });
  });

  it("er id 855 (Hyper Cleanse) wires status immunity (block-all) + halves incoming Poison", () => {
    // "Immune to status. Halves poison damage taken." — block-all status
    // immunity plus a defensive move-type Poison damage reduction.
    const res = dispatchArchetype("bespoke", null, 855);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const attr = res.attrs[0] as StatusEffectImmunityAbAttrEr;
    expect(attr).toBeInstanceOf(StatusEffectImmunityAbAttrEr);
    expect(attr.getStatuses()).toEqual([]);
    const poisonReduction = res.attrs[1] as DamageReductionAbAttr;
    expect(poisonReduction).toBeInstanceOf(DamageReductionAbAttr);
    expect(poisonReduction.getReduction()).toBeCloseTo(0.5);
    expect(poisonReduction.getFilter()).toEqual({ kind: "move-type", type: PokemonType.POISON });
  });

  it("er id 1004 (Feathercoat) wires 10% all + extra resisted reduction (→20% on resisted)", () => {
    const res = dispatchArchetype("bespoke", null, 1004);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const all = res.attrs[0] as DamageReductionAbAttr;
    expect(all).toBeInstanceOf(DamageReductionAbAttr);
    expect(all.getReduction()).toBeCloseTo(0.1);
    expect(all.getFilter()).toEqual({ kind: "all" });
    const resisted = res.attrs[1] as DamageReductionAbAttr;
    expect(resisted.getFilter()).toEqual({ kind: "resisted" });
    // 1 - (1-0.10)*(1-0.1111) ≈ 0.20 total on resisted hits.
    expect(resisted.getReduction()).toBeCloseTo(0.1111);
  });

  it("er id 944 (Dead Bark) wires add-type GHOST + DamageReduction(all 15%) + DamageReduction(SE 17.6%)", () => {
    // R52 audit-fix: previously a 2-attr wire missing the "30% if SE"
    // piece. Now stacks a second DamageReduction (super-effective filter,
    // ~17.6%) so combined SE reduction = 1 - 0.85*0.824 ≈ 30%.
    const res = dispatchArchetype("bespoke", null, 944);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    const allReducer = res.attrs.find(a => {
      if (!(a instanceof DamageReductionAbAttr)) {
        return false;
      }
      const f = a.getFilter();
      return f.kind === "all";
    }) as DamageReductionAbAttr;
    expect(allReducer).toBeDefined();
    expect(allReducer.getReduction()).toBeCloseTo(0.15);
    const seReducer = res.attrs.find(a => {
      if (!(a instanceof DamageReductionAbAttr)) {
        return false;
      }
      const f = a.getFilter();
      return f.kind === "super-effective";
    }) as DamageReductionAbAttr;
    expect(seReducer).toBeDefined();
    expect(seReducer.getReduction()).toBeCloseTo(0.176);
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

  it("er id 375 (Precise Fist) wires +1 crit + 5x punch effect chance (both PUNCHING_MOVE-gated)", () => {
    const res = dispatchArchetype("bespoke", null, 375);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const crit = res.attrs[0] as CritStageBonusAbAttr;
    expect(crit).toBeInstanceOf(CritStageBonusAbAttr);
    expect(crit.getBonus()).toBe(1);
    expect(crit.getFilter()).toEqual({ flag: MoveFlags.PUNCHING_MOVE });
    const ecm = res.attrs[1] as EffectChanceModifierAbAttr;
    expect(ecm).toBeInstanceOf(EffectChanceModifierAbAttr);
    expect(ecm.getMultiplier()).toBe(5);
    expect(ecm.getFlag()).toBe(MoveFlags.PUNCHING_MOVE);
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

  it("er id 975 (Talon Trap) wires ChanceBattlerTag on BOTH defense (on-hit) and offense (on-attack)", () => {
    // "50% chance to trap on contact (offense AND defense), 100% if entered
    // this turn." Faithfully wired as two halves: the defensive on-hit proc
    // and the offensive on-attack proc, both 50%/100%-first-turn, contact-gated.
    const res = dispatchArchetype("bespoke", null, 975);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const defAttr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(defAttr).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
    expect(defAttr.getChance()).toBe(50);
    expect(defAttr.getTags()).toEqual([BattlerTagType.TRAPPED]);
    expect(defAttr.requiresContact()).toBe(true);
    const offAttr = res.attrs[1] as ChanceBattlerTagOnAttackAbAttr;
    expect(offAttr).toBeInstanceOf(ChanceBattlerTagOnAttackAbAttr);
    expect(offAttr.getTags()).toEqual([BattlerTagType.TRAPPED]);
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

  it("er id 365 (Lunar Eclipse) wires two StabAdd instances (FAIRY + DARK) + Hypnosis accuracy set", () => {
    const res = dispatchArchetype("bespoke", null, 365);
    expect(res.skipReason).toBeNull();
    const stabs = res.attrs.filter((a): a is StabAddAbAttr => a instanceof StabAddAbAttr);
    expect(stabs).toHaveLength(2);
    expect(stabs.map(a => a.getTargetType())).toEqual([PokemonType.FAIRY, PokemonType.DARK]);
    for (const a of stabs) {
      expect(a.getMultiplier()).toBe(1.5);
    }
    const acc = res.attrs.find((a): a is SetMoveAccuracyAbAttr => a instanceof SetMoveAccuracyAbAttr);
    expect(acc).toBeDefined();
    expect(acc?.moveIds).toContain(MoveId.HYPNOSIS);
  });

  it("er id 327 (Hypnotist) wires a Hypnosis base-accuracy set (90), not a never-miss", () => {
    const res = dispatchArchetype("bespoke", null, 327);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const acc = res.attrs[0];
    expect(acc).toBeInstanceOf(SetMoveAccuracyAbAttr);
    expect((acc as SetMoveAccuracyAbAttr).moveIds).toContain(MoveId.HYPNOSIS);
  });

  it("er id 786 (Lullaby) wires a Sing base-accuracy set (90)", () => {
    const res = dispatchArchetype("bespoke", null, 786);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(SetMoveAccuracyAbAttr);
    expect((res.attrs[0] as SetMoveAccuracyAbAttr).moveIds).toContain(MoveId.SING);
  });

  it("er id 478 (Moon Spirit) wires two StabAdd instances (FAIRY + DARK)", () => {
    const res = dispatchArchetype("bespoke", null, 478);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const types = (res.attrs as StabAddAbAttr[]).map(a => a.getTargetType());
    expect(types).toEqual([PokemonType.FAIRY, PokemonType.DARK]);
  });

  it("er id 494 (Arcane Force) wires all-moves StabAdd + super-effective +10% rider", () => {
    // "All moves gain STAB. Ups super-effective by 10%." — both halves.
    const res = dispatchArchetype("bespoke", null, 494);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const attr = res.attrs[0] as StabAddAbAttr;
    expect(attr).toBeInstanceOf(StabAddAbAttr);
    expect(attr.getTargetType()).toBeNull();
    expect(res.attrs[1]).toBeInstanceOf(SuperEffectiveMultiplierBoostAbAttr);
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

  it("er id 466 (Plasma Lamp) wires FIRE+ELECTRIC 1.2x power + type-gated 1.2x accuracy", () => {
    const res = dispatchArchetype("bespoke", null, 466);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    const boosts = res.attrs.slice(0, 2) as TypeDamageBoostAbAttr[];
    expect(boosts.map(a => a.getBoostType())).toEqual([PokemonType.FIRE, PokemonType.ELECTRIC]);
    for (const a of boosts) {
      expect(a).toBeInstanceOf(TypeDamageBoostAbAttr);
      expect(a.getHighHpMultiplier()).toBeCloseTo(1.2);
    }
    const acc = res.attrs[2] as StatMultiplierAbAttr;
    expect(acc).toBeInstanceOf(StatMultiplierAbAttr);
    expect(acc.stat).toBe(Stat.ACC);
    expect(acc.multiplier).toBeCloseTo(1.2);
  });

  it("er id 764 (Deep Freeze) wires WATER+ICE 1.25x boosts + halves incoming Fire", () => {
    // "Boosts Water and Ice by 1.25x. Halves Fire damage taken." — two
    // offensive TypeDamageBoosts plus a defensive move-type Fire reduction.
    const res = dispatchArchetype("bespoke", null, 764);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    const boosts = res.attrs.slice(0, 2) as TypeDamageBoostAbAttr[];
    expect(boosts.map(a => a.getBoostType())).toEqual([PokemonType.WATER, PokemonType.ICE]);
    for (const a of boosts) {
      expect(a).toBeInstanceOf(TypeDamageBoostAbAttr);
      expect(a.getHighHpMultiplier()).toBeCloseTo(1.25);
    }
    const fireReduction = res.attrs[2] as DamageReductionAbAttr;
    expect(fireReduction).toBeInstanceOf(DamageReductionAbAttr);
    expect(fireReduction.getReduction()).toBeCloseTo(0.5);
    expect(fireReduction.getFilter()).toEqual({ kind: "move-type", type: PokemonType.FIRE });
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

  it("er id 348 (North Wind) wires EntryEffect(AURORA_VEIL 3t) + BlockWeatherDamage(HAIL)", () => {
    // R51 audit-fix: ER spec is "3 turns Aurora Veil on entry. Immune to
    // Hail damage." Prior wire was AURORA_VEIL only; now also includes
    // BlockWeatherDamageAttr for HAIL.
    const res = dispatchArchetype("bespoke", null, 348);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const entry = res.attrs.find(a => a instanceof EntryEffectAbAttr) as EntryEffectAbAttr;
    expect(entry).toBeDefined();
    expect(entry.getKind()).toBe("set-screen-or-room");
    const effect = entry.getEffect();
    if (effect.kind !== "set-screen-or-room") {
      throw new Error("expected set-screen-or-room effect kind");
    }
    expect(effect.tag).toBe(ArenaTagType.AURORA_VEIL);
    expect(effect.turns).toBe(3);
    const blockHail = res.attrs.find(a => a.constructor.name === "BlockWeatherDamageAttr");
    expect(blockHail).toBeDefined();
  });

  it("er id 269 (Whiteout) wires SelfHighestStatMultiplier(1.5, hail) + BlockWeatherDamage(HAIL/SNOW)", () => {
    // Audit-fix: ER spec is "Ups highest attacking stat by 1.5x in hail. Also
    // grants immunity to hail damage." Prior wire had the stat multiplier only.
    const res = dispatchArchetype("bespoke", null, 269);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "SelfHighestStatMultiplierAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "BlockWeatherDamageAttr")).toBeDefined();
  });

  it("er id 296 (Lead Coat) wires DamageReduction(physical, 0.4) + StatMultiplier(SPD, 0.9)", () => {
    // Audit-fix: ER spec is "Takes 40% less from physical moves. Speed is
    // 0.9x." Was archetype-classified as damage-reduction-generic, dropping
    // the Speed penalty; now a composite bespoke wiring both halves.
    const res = dispatchArchetype("bespoke", null, 296);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const dr = res.attrs.find(a => a instanceof DamageReductionAbAttr);
    expect(dr).toBeDefined();
    const spd = res.attrs.find(
      (a): a is StatMultiplierAbAttr => a instanceof StatMultiplierAbAttr,
    ) as StatMultiplierAbAttr;
    expect(spd).toBeDefined();
    expect(spd.multiplier).toBe(0.9);
  });

  it("er id 306 (Nocturnal) wires TypeDamageBoost(Dark,1.25) + ReceivedTypeDamageMultiplier x2 (Dark/Fairy 0.75)", () => {
    // Audit-fix: ER spec is "Boosts own Dark moves by 1.25x. Takes -25% dmg
    // from Dark/Fairy." Was type-damage-boost (offensive only); defensive
    // Dark+Fairy reduction was dropped.
    const res = dispatchArchetype("bespoke", null, 306);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    expect(res.attrs.find(a => a.constructor.name === "TypeDamageBoostAbAttr")).toBeDefined();
    expect(res.attrs.filter(a => a.constructor.name === "ReceivedTypeDamageMultiplierAbAttr")).toHaveLength(2);
  });

  it("er id 311 (Liquified) wires DamageReduction(contact,0.5) + ReceivedTypeDamageMultiplier(Water 2x)", () => {
    // Audit-fix: ER spec is "1/2 dmg from contact but Water moves hurt 2x
    // more." Was damage-reduction-generic (contact only); Water vulnerability
    // was dropped.
    const res = dispatchArchetype("bespoke", null, 311);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a instanceof DamageReductionAbAttr)).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ReceivedTypeDamageMultiplierAbAttr")).toBeDefined();
  });

  it("er id 312 (Dragonfly) wires EntryEffect(add-self-type Dragon) + AttackTypeImmunity(Ground)", () => {
    // Audit-fix: ER spec is "Adds Dragon type on entry. Avoids Ground
    // attacks." Was entry-effect (add-Dragon only); Ground immunity was dropped.
    const res = dispatchArchetype("bespoke", null, 312);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const entry = res.attrs.find(a => a instanceof EntryEffectAbAttr) as EntryEffectAbAttr;
    expect(entry).toBeDefined();
    expect(entry.getEffect().kind).toBe("add-self-type");
    expect(res.attrs.find(a => a.constructor.name === "AttackTypeImmunityAbAttr")).toBeDefined();
  });

  it("er id 422 (Gifted Mind) grants flat immunity to Dark/Ghost/Bug + status-move always-hit", () => {
    // 2.65 dex: "grants immunity to Dark, Ghost, and Bug-type moves while making
    // all status moves used by this Pokemon never miss." Flat x0 immunity to all
    // three attacking types (regardless of the holder's typing), NOT a Psychic-
    // weakness patch - so it is wired as three AttackTypeImmunityAbAttr.
    const res = dispatchArchetype("bespoke", null, 422);
    expect(res.skipReason).toBeNull();
    const immunities = res.attrs.filter(a => a.constructor.name === "AttackTypeImmunityAbAttr");
    expect(immunities).toHaveLength(3);
    expect(res.attrs.find(a => a.constructor.name === "ConditionalAlwaysHitAbAttr")).toBeDefined();
    // The earlier (wrong) wirings must be gone: no PSYCHIC damage reduction and no
    // type-chart-neutralize primitive (it is full immunity now).
    expect(res.attrs.find(a => a.constructor.name === "DamageReductionAbAttr")).toBeUndefined();
    expect(res.attrs.find(a => a.constructor.name === "DefensiveTypeWeaknessNullAbAttr")).toBeUndefined();
  });

  it("er id 433 (Dual Wield) wires HitMultiplier + HitMultiplierPower(0.7) on Pulse/Slicing moves", () => {
    // Audit-fix: was Keen-Edge-only with no power cut (2nd hit 100%). Now both
    // Mega Launcher (Pulse) and Keen Edge (Slicing) moves hit twice at 70%.
    const res = dispatchArchetype("bespoke", null, 433);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "HitMultiplierAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "HitMultiplierPowerAbAttr")).toBeDefined();
  });

  it("er id 435 (Ambush) wires a first-turn ConditionalCrit (not a permanent crit-stage bonus)", () => {
    // Audit-fix: spec is "guaranteed crit on first turn"; was a permanent +1
    // crit-stage on all moves.
    const res = dispatchArchetype("bespoke", null, 435);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0].constructor.name).toBe("ConditionalCritAbAttr");
  });

  it("er id 465 (Pixie Power) wires field-wide Fairy aura + 1.2x accuracy", () => {
    const res = dispatchArchetype("bespoke", null, 465);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "FieldMoveTypePowerBoostAbAttr")).toBeDefined();
    const acc = res.attrs.find((a): a is StatMultiplierAbAttr => a instanceof StatMultiplierAbAttr);
    expect(acc?.multiplier).toBe(1.2);
  });

  it("er id 302 (Coil Up) gates the biting +1 priority to the entry turn", () => {
    const res = dispatchArchetype("bespoke", null, 302);
    expect(res.skipReason).toBeNull();
    // Coil Up's dex: "+1 priority once to the first biting move USED." Wired via the
    // dedicated first-flagged-priority primitive + the on-USE consumer (#632) - the
    // boost is spent the first time a biting move is used even if it misses/fails, NOT
    // only on a landed hit (the old ConsumeFirstFlaggedMovePriorityAbAttr, which now
    // serves only Sidewinder's consume-on-land + regain-on-KO variant).
    const prio = res.attrs.find(a => a.constructor.name === "FirstFlaggedMovePriorityAbAttr");
    expect(prio).toBeDefined();
    expect(res.attrs.some(a => a.constructor.name === "ConsumeFirstFlaggedMoveOnUseAbAttr")).toBe(true);
  });

  it("er id 644 (Ice Cold Hunter) wires hail-gated Ice HitMultiplier + hail immunity", () => {
    const res = dispatchArchetype("bespoke", null, 644);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const hm = res.attrs.find(a => a.constructor.name === "HitMultiplierAbAttr");
    expect(hm).toBeDefined();
    expect(hm?.getCondition()).not.toBeNull(); // gated to hail
    expect(res.attrs.find(a => a.constructor.name === "BlockWeatherDamageAttr")).toBeDefined();
  });

  it("er id 482 (Sand Guard) wires special-in-sand reduction + sand-gated priority immunity", () => {
    const res = dispatchArchetype("bespoke", null, 482);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a instanceof DamageReductionAbAttr)).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "FieldPriorityMoveImmunityAbAttr")).toBeDefined();
  });

  it("er id 585 (Sun Basking) wires physical-in-sun reduction + sun-gated priority immunity", () => {
    const res = dispatchArchetype("bespoke", null, 585);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a instanceof DamageReductionAbAttr)).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "FieldPriorityMoveImmunityAbAttr")).toBeDefined();
  });

  it("er id 407 (Retribution Blow) wires OnOpponentStatRaiseScriptedMove (Hyper Beam)", () => {
    // Audit-fix: was the wrong mechanic (boost own ATK) on a broken base attr.
    const res = dispatchArchetype("bespoke", null, 407);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0].constructor.name).toBe("OnOpponentStatRaiseScriptedMoveAbAttr");
  });

  it("er id 334 (Bad Luck) wires crit-immune + ignore-effects + 0.95 acc + EnemyMinDamageRoll", () => {
    const res = dispatchArchetype("bespoke", null, 334);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.find(a => a.constructor.name === "EnemyMinDamageRollAbAttr")).toBeDefined();
  });

  it("er id 671 (Bad Omen) wires crit-damage reduction + EnemyMinDamageRoll", () => {
    const res = dispatchArchetype("bespoke", null, 671);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.find(a => a.constructor.name === "EnemyMinDamageRollAbAttr")).toBeDefined();
  });

  it("er id 349 (Overcharge) wires the Electric-vs-Electric override + paralyze-Electric bypass", () => {
    // Audit-fix: "can paralyze Electric-types" added via the existing
    // IgnoreTypeStatusEffectImmunity hook (no core edit).
    const res = dispatchArchetype("bespoke", null, 349);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.find(a => a.constructor.name === "OffensiveTypeChartOverrideAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "IgnoreTypeStatusEffectImmunityAbAttr")).toBeDefined();
  });

  it("er id 387 (Discipline) wires Intimidate immunity + confusion immunity (BattlerTagImmunity)", () => {
    // Audit-fix: CONFUSION isn't a vanilla StatusEffect; status-immunity dropped
    // it. Now wired via BattlerTagImmunity(CONFUSED).
    const res = dispatchArchetype("bespoke", null, 387);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.find(a => a.constructor.name === "IntimidateImmunityAbAttrEr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "BattlerTagImmunityAbAttr")).toBeDefined();
  });

  it("er id 678 (Fluffiest) wires DamageReduction(contact,0.75) + ReceivedTypeDamageMultiplier(Fire 4x)", () => {
    // Audit-fix: ¼ contact damage ✓; added the Fire ×4 vulnerability.
    const res = dispatchArchetype("bespoke", null, 678);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a instanceof DamageReductionAbAttr)).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ReceivedTypeDamageMultiplierAbAttr")).toBeDefined();
  });

  it("er id 642 (Jackhammer) wires HitMultiplier(HAMMER) + HitMultiplierPower(0.7)", () => {
    // Audit-fix: was all-moves, full power; now hammer-gated, 70% per hit.
    const res = dispatchArchetype("bespoke", null, 642);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "HitMultiplierAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "HitMultiplierPowerAbAttr")).toBeDefined();
  });

  it("er id 646 (Arc Flash) wires defensive 50% burn (OnHit) + offensive 50% paralyze (OnAttack)", () => {
    // Audit-fix: prior wire had only the defensive burn; added offensive paralyze.
    const res = dispatchArchetype("bespoke", null, 646);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "ChanceStatusOnHitAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ChanceStatusOnAttackAbAttr")).toBeDefined();
  });

  it("er id 618 (Fragrant Daze) wires confuse both defensively (OnHit) and offensively (OnAttack)", () => {
    // Audit-fix: spec "both when attacking and being attacked"; prior wire had only defensive.
    const res = dispatchArchetype("bespoke", null, 618);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.filter(a => a.constructor.name === "ChanceBattlerTagOnHitAbAttr")).toHaveLength(1);
    expect(res.attrs.filter(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr")).toHaveLength(1);
  });

  it("er id 344 (Poison Absorb) wires RedirectTypeMove(Poison) + TypeAbsorbHeal(Poison) + terrain-gated PassiveRecovery", () => {
    // Audit-fix: absorb-heal ✓, Toxic-Terrain 1/8 heal ✓; added the Storm-Drain-style
    // Poison-move REDIRECT (short_desc "Redirects Poison moves") as the third attr.
    const res = dispatchArchetype("bespoke", null, 344);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    expect(res.attrs.find(a => a.constructor.name === "RedirectTypeMoveAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "TypeAbsorbHealAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "PassiveRecoveryAbAttr")).toBeDefined();
  });

  it("er id 593 (Molten Blades) wires FlagDamageBoost(Keen Edge +30%) + 20% burn", () => {
    // Audit-fix: prior wire had only the 20% burn; the Keen Edge +30% boost was missing.
    const res = dispatchArchetype("bespoke", null, 593);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "FlagDamageBoostAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ChanceStatusOnAttackAbAttr")).toBeDefined();
  });

  it("er id 594 (Haunting Frenzy) wires 20% flinch + StatTriggerOnKo(+1 Speed)", () => {
    // Audit-fix: prior wire had only the flinch; the +1 Speed on KO was missing.
    const res = dispatchArchetype("bespoke", null, 594);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "StatTriggerOnKoAbAttr")).toBeDefined();
  });

  it("er id 539 (Chrome Coat) wires DamageReduction(special,0.4) + StatMultiplier(SPD,0.9)", () => {
    // Audit-fix: special-side twin of Lead Coat; the Speed penalty was dropped.
    const res = dispatchArchetype("bespoke", null, 539);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a instanceof DamageReductionAbAttr)).toBeDefined();
    const spd = res.attrs.find((a): a is StatMultiplierAbAttr => a instanceof StatMultiplierAbAttr);
    expect(spd?.multiplier).toBe(0.9);
  });

  it("er id 529 (Berserk DNA) wires +2 highest-attack boost AND self-enrage (TAUNT) on entry", () => {
    // ER "enrage" === the vanilla TAUNT tag (per ER's TM12/Taunt text). Berserk
    // DNA enrages ITSELF on entry; the previous self-damage-on-attack proxy was
    // replaced with the canonical TAUNT-apply model.
    const res = dispatchArchetype("bespoke", null, 529);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "SelfHighestStatBoostOnSummonAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "PostSummonAddBattlerTagAbAttr")).toBeDefined();
  });

  it("er id 497 (Yuki Onna) wires entry Intimidate+Scare + infatuate offensively & defensively", () => {
    // Audit-fix: spec "Scare + Intimidate; 30% infatuate offensively AND
    // defensively". Prior wire had only the offensive infatuate.
    const res = dispatchArchetype("bespoke", null, 497);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    expect(res.attrs.find(a => a.constructor.name === "PostSummonStatStageChangeAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ChanceBattlerTagOnHitAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr")).toBeDefined();
  });

  it("er id 492 (Freezing Point) wires frostbite both defensively (OnHit) and offensively (OnAttack)", () => {
    // Audit-fix: spec "works offensively AND defensively"; prior wire had only
    // the two defensive OnHit procs. Now 4 procs: OnHit + OnAttack, each split
    // contact(20%)/non-contact(30%).
    const res = dispatchArchetype("bespoke", null, 492);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.filter(a => a.constructor.name === "ChanceBattlerTagOnHitAbAttr")).toHaveLength(2);
    expect(res.attrs.filter(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr")).toHaveLength(2);
  });

  it("er id 403 (Roundhouse) wires ConditionalAlwaysHit(kicking) + DefenseStatSwap(lower-defense)", () => {
    // Audit-fix: kicks always hit ✓; "damages foe's weaker defense" added via
    // the def-stat-swap lower-defense variant.
    const res = dispatchArchetype("bespoke", null, 403);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "ConditionalAlwaysHitAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "DefenseStatSwapOnFlagAbAttr")).toBeDefined();
  });

  it("er id 399 (Parry) wires DamageReduction(all,0.2) + CounterAttackOnHit(Mach Punch 20 BP)", () => {
    // Audit-fix: ER spec is "Counters contact with Mach Punch. Takes 20% less
    // damage." Was damage-reduction-generic (reduction only); the counter was dropped.
    const res = dispatchArchetype("bespoke", null, 399);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a instanceof DamageReductionAbAttr)).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "CounterAttackOnHitAbAttr")).toBeDefined();
  });

  it("er id 408 (Fearmonger) wires entry Intimidate+Scare (ATK/SpAtk -1) + 10% fear on contact", () => {
    // Audit-fix: ER spec is "Intimidate + Scare; 10% chance to fear with contact
    // moves." Was chance-status-on-hit (fear only); the entry stat drop was dropped.
    const res = dispatchArchetype("bespoke", null, 408);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "PostSummonStatStageChangeAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ChanceBattlerTagOnAttackAbAttr")).toBeDefined();
  });

  it("er id 368 (Sighting System) wires AlwaysHit + PriorityModifier(-3 for <80% acc moves)", () => {
    // Audit-fix: ER spec is "Moves always hit. Moves with <80% base accuracy
    // receive -3 priority." Was always-hit only; the priority penalty needed a
    // maxAccuracy filter on the priority-modifier primitive.
    const res = dispatchArchetype("bespoke", null, 368);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "AlwaysHitAbAttr")).toBeDefined();
    const prio = res.attrs.find((a): a is PriorityModifierAbAttr => a instanceof PriorityModifierAbAttr);
    expect(prio).toBeDefined();
    expect(prio?.getPriority()).toBe(-3);
    expect(prio?.getFilter()).toEqual({ maxAccuracy: 80 });
  });

  it("er id 304 (Magical Dust) wires both defense + offense type-change (Psychic on contact)", () => {
    // Audit-fix: ER spec is "Makes foe Psychic-type on contact. Also works on
    // offense." Was defense-only (PostDefendChangeAttackerType); added the
    // offense-side PostAttackChangeTargetType.
    const res = dispatchArchetype("bespoke", null, 304);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "PostDefendChangeAttackerTypeAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "PostAttackChangeTargetTypeAbAttr")).toBeDefined();
  });

  it("er id 385 (Nosferatu) wires LifestealOnHit(contact,0.5) + MovePowerBoost(contact 1.2)", () => {
    // Audit-fix: ER spec is "Contact moves do +20% damage and heal 1/2 of dmg
    // dealt." Was lifesteal (heal only, all moves); the +20% contact power
    // boost was dropped.
    const res = dispatchArchetype("bespoke", null, 385);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "LifestealOnHitAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "MovePowerBoostAbAttr")).toBeDefined();
  });

  it("er id 386 (Spectral Shroud) wires Spectralize (TypeConversion+boost) + 30% Toxic chance", () => {
    // Audit-fix: ER spec is "Spectralize + 30% chance to badly poison." Was
    // chance-status-on-hit (poison only); the Spectralize half was dropped.
    const res = dispatchArchetype("bespoke", null, 386);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    expect(res.attrs.find(a => a.constructor.name === "TypeConversionAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "TypeConversionPowerBoostAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "ChanceStatusOnAttackAbAttr")).toBeDefined();
  });

  it("er id 328 (Overwhelm) wires IntimidateImmunity + OffensiveTypeChartOverride(Dragon→Fairy 1x)", () => {
    // Audit-fix: ER spec is "Hits Fairies with Dragon moves. Immune to
    // Intimidate and Scare." Was status-immunity (Intimidate/Scare only); the
    // Dragon-hits-Fairy type-chart override was dropped.
    const res = dispatchArchetype("bespoke", null, 328);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "IntimidateImmunityAbAttrEr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "OffensiveTypeChartOverrideAbAttr")).toBeDefined();
  });

  it("er id 378 (Amplifier) wires FlagDamageBoost(SOUND_BASED, 1.3) + spread targeting for sound moves", () => {
    const res = dispatchArchetype("bespoke", null, 378);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a instanceof FlagDamageBoostAbAttr)).toBe(true);
    const spread = res.attrs.find((a): a is SpreadTargetByFlagAbAttr => a instanceof SpreadTargetByFlagAbAttr);
    expect(spread).toBeDefined();
    expect(spread?.flag).toBe(MoveFlags.SOUND_BASED);
  });

  it("er id 377 (Artillery) wires never-miss + spread targeting for pulse/mega-launcher moves", () => {
    const res = dispatchArchetype("bespoke", null, 377);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a instanceof ConditionalAlwaysHitAbAttr)).toBe(true);
    const spread = res.attrs.find((a): a is SpreadTargetByFlagAbAttr => a instanceof SpreadTargetByFlagAbAttr);
    expect(spread?.flag).toBe(MoveFlags.PULSE_MOVE);
  });

  it("er id 421 (Sweeping Edge) wires never-miss + spread targeting for slicing moves", () => {
    const res = dispatchArchetype("bespoke", null, 421);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a instanceof ConditionalAlwaysHitAbAttr)).toBe(true);
    const spread = res.attrs.find((a): a is SpreadTargetByFlagAbAttr => a instanceof SpreadTargetByFlagAbAttr);
    expect(spread?.flag).toBe(MoveFlags.SLICING_MOVE);
  });

  it("er id 438 (Jaws of Carnage) wires LifestealOnKo(0.25) with a BITING_MOVE 0.5 flagBonus", () => {
    // Audit-fix: base 25% heal-on-KO, upgraded to 50% when the KO move is biting.
    const res = dispatchArchetype("bespoke", null, 438);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as LifestealOnKoAbAttr;
    expect(attr).toBeInstanceOf(LifestealOnKoAbAttr);
    expect(attr.getHealFraction()).toBeCloseTo(0.25);
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
    expect(attr.getWeathers()).toEqual([WeatherType.FOG, WeatherType.EERIE_FOG]);
  });

  it("er id 645 (Soul Crusher) wires DefenseStatSwapOnFlag(HAMMER→SpDef) + FlagDamageBoost(1.1)", () => {
    // Spec is "Hammer moves hit SpDef AND get a 1.1x power boost" — BOTH halves.
    // (A prior R50 pass dropped the 1.1x boost treating it as a mere
    // approximation of the swap; the audit restored it.)
    const res = dispatchArchetype("bespoke", null, 645);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs.find(a => a.constructor.name === "DefenseStatSwapOnFlagAbAttr")).toBeDefined();
    expect(res.attrs.find(a => a.constructor.name === "FlagDamageBoostAbAttr")).toBeDefined();
  });

  it("er id 655 (Smokey Maneuvers) wires WeatherStatMultiplier(EVA, 4/3, [FOG])", () => {
    const res = dispatchArchetype("bespoke", null, 655);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as WeatherStatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(WeatherStatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.EVA);
    // Dex: "-25% foe accuracy in fog" => the foe's hit chance is x0.75, i.e. the
    // holder's evasion multiplier is 1/0.75 = 4/3 (audit tier-8 batch-1 fix; was
    // an incorrect flat 1.25).
    expect(attr.multiplier).toBeCloseTo(4 / 3);
    expect(attr.getWeathers()).toEqual([WeatherType.FOG, WeatherType.EERIE_FOG]);
  });

  it("er id 819 (Serpent Bind) wires an offensive 50% damaging trap + per-turn trapped speed drop", () => {
    const res = dispatchArchetype("bespoke", null, 819);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const attr = res.attrs.find(a => a instanceof ChanceBattlerTagOnAttackAbAttr) as ChanceBattlerTagOnAttackAbAttr;
    expect(attr).toBeInstanceOf(ChanceBattlerTagOnAttackAbAttr);
    expect(attr.getChance()).toBe(50);
    expect(attr.getTags()).toEqual([BattlerTagType.WRAP]);
    expect(attr.requiresContact()).toBe(false);
    // The "speed drops by one stage each turn they remain on the field" piece.
    expect(res.attrs.some(a => a.constructor.name === "PostTurnFoeStatDropAbAttr")).toBe(true);
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

  it("er id 955 (Hypnotic Trance) wires Hypnosis never-miss + 100% confuse rider", () => {
    const res = dispatchArchetype("bespoke", null, 955);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const alwaysHit = res.attrs[0] as ConditionalAlwaysHitAbAttr;
    expect(alwaysHit).toBeInstanceOf(ConditionalAlwaysHitAbAttr);
    expect(alwaysHit.opts.moveIds).toEqual([MoveId.HYPNOSIS]);
    const confuse = res.attrs[1] as ChanceBattlerTagOnAttackAbAttr;
    expect(confuse).toBeInstanceOf(ChanceBattlerTagOnAttackAbAttr);
    expect(confuse.getChance()).toBe(100);
    expect(confuse.getTags()).toEqual([BattlerTagType.CONFUSED]);
  });

  it("er id 951 (Foamy Web) wires a foe-side FOAMY_WEB entry hazard", () => {
    const res = dispatchArchetype("bespoke", null, 951);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as EntryEffectAbAttr;
    expect(attr).toBeInstanceOf(EntryEffectAbAttr);
    expect(attr.getKind()).toBe("set-hazard");
    const effect = attr.getEffect();
    expect(effect.kind === "set-hazard" && effect.hazard).toBe(ArenaTagType.FOAMY_WEB);
    expect(effect.kind === "set-hazard" && effect.side).toBe("foe");
  });

  it("er id 998 (Acid Reflux) wires a 20BP Acid counter (power overridden from 40)", () => {
    const res = dispatchArchetype("bespoke", null, 998);
    expect(res.skipReason).toBeNull();
    const counter = res.attrs.find(a => a.constructor.name === "CounterAttackOnHitAbAttr");
    expect(counter).toBeDefined();
    expect((counter as unknown as { power?: number }).power).toBe(20);
  });

  it("er id 1008 (Daredevil) HALVES recoil (RecoilDamageMultiplier 0.5), not full block", () => {
    const res = dispatchArchetype("bespoke", null, 1008);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "RecoilDamageMultiplierAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "BlockRecoilDamageAttr")).toBe(false);
    expect(res.attrs.some(a => a.constructor.name === "StatBoostOnFlagAttackAbAttr")).toBe(true);
  });

  it("er id 1022 (Deflect) wires 20% reduction + a 20BP Vacuum Wave counter", () => {
    const res = dispatchArchetype("bespoke", null, 1022);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "DamageReductionAbAttr")).toBe(true);
    const counter = res.attrs.find(a => a.constructor.name === "CounterAttackOnHitAbAttr");
    expect(counter).toBeDefined();
    expect((counter as unknown as { power?: number }).power).toBe(20);
  });

  it("er id 1031 (Rock Armor) wires add-Rock-type on entry + 10% reduction", () => {
    const res = dispatchArchetype("bespoke", null, 1031);
    expect(res.skipReason).toBeNull();
    expect(res.attrs.some(a => a.constructor.name === "EntryEffectAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "DamageReductionAbAttr")).toBe(true);
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

  // ---------------------------------------------------------------------------
  // Audit follow-up (CRITICAL blanket-effect fixes vs the v2.65 dex).
  // ---------------------------------------------------------------------------

  it("er id 471 (Cold Plasma) burns only on ELECTRIC moves, not every move", () => {
    const res = dispatchArchetype("bespoke", null, 471);
    expect(res.skipReason).toBeNull();
    // The prior wire was an unfiltered PostAttackApplyStatusEffectAbAttr (every move).
    expect(res.attrs.some(a => a.constructor.name === "PostAttackApplyStatusEffectAbAttr")).toBe(false);
    const attr = res.attrs.find((a): a is ChanceStatusOnAttackAbAttr => a instanceof ChanceStatusOnAttackAbAttr);
    expect(attr).toBeDefined();
    expect(attr!.getEffects()).toEqual([StatusEffect.BURN]);
    expect(attr!.getFilter()).toEqual({ type: PokemonType.ELECTRIC });
  });

  it("er id 342 (Seaweed) gates BOTH Fire modifiers on the holder being Grass-type", () => {
    const res = dispatchArchetype("bespoke", null, 342);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    // Both the offensive 2x-vs-Fire and the defensive 0.5-from-Fire carry a self-Grass gate.
    expect(res.attrs.every(a => a.getCondition() != null)).toBe(true);
  });

  it("er id 463 (Jungle's Guard) is Flower Veil: Grass-ally status + stat-drop protection", () => {
    const res = dispatchArchetype("bespoke", null, 463);
    expect(res.skipReason).toBeNull();
    const names = res.attrs.map(a => a.constructor.name);
    expect(names).toContain("ConditionalUserFieldStatusEffectImmunityAbAttr");
    expect(names).toContain("ConditionalUserFieldProtectStatAbAttr");
    expect(names).toContain("ConditionalUserFieldBattlerTagImmunityAbAttr");
    // The old blanket all-allies immunity must be gone.
    expect(names).not.toContain("UserFieldStatusEffectImmunityAbAttr");
  });
});
