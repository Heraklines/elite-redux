/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Audit fixes (chunk 7, ids 200–225): three ER-altered vanilla abilities whose
// descriptions carry clauses the vanilla pokerogue wiring omitted.
//   - 225 RKS System: spec adds Protean (PokemonTypeChange) + Adaptability
//     (StabBoost) on top of the NoFusion form-marker.
//   - 202 Slush Rush: spec grants hail/snow damage immunity on top of the
//     1.5x Speed boost (vanilla only had the speed boost).
//   - 50 Run Away: ER "raises Speed if a stat is lowered by a foe" rider is +2
//     stages per spec (was wired +1).
//
// Note: we match against `.attrs` via `instanceof` rather than the public
// `Ability.hasAttr("...")` because that helper resolves names through the
// vanilla `AbilityAttrs` registry, which does not include ER archetype classes
// (e.g. StatTriggerOnStatLoweredAbAttr).
import {
  AiMovegenMoveStatsAbAttr,
  type AiMovegenMoveStatsAbAttrParams,
  BlockCritAbAttr,
  BlockWeatherDamageAttr,
  PokemonTypeChangeAbAttr,
  StabBoostAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { StatTriggerOnStatLoweredAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { Stat } from "#enums/stat";
import { NumberHolder } from "#utils/common";
import { describe, expect, it } from "vitest";

const hasAlwaysHit = (id: number): boolean =>
  (allAbilities[id]?.attrs ?? []).some(a => a.constructor.name === "ConditionalAlwaysHitAbAttr");

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER rebalance attr patches (audit chunk 7)", () => {
  it("RKS System carries Protean (PokemonTypeChange) + Adaptability (StabBoost)", () => {
    const attrs = allAbilities[AbilityId.RKS_SYSTEM].attrs;
    expect(attrs.some(a => a instanceof PokemonTypeChangeAbAttr)).toBe(true);
    expect(attrs.some(a => a instanceof StabBoostAbAttr)).toBe(true);
  });

  it("Slush Rush blocks hail/snow weather damage", () => {
    const attrs = allAbilities[AbilityId.SLUSH_RUSH].attrs;
    expect(attrs.some(a => a instanceof BlockWeatherDamageAttr)).toBe(true);
  });

  it("Propeller Tail gains a Speed multiplier (Swift Swim) alongside redirection immunity", () => {
    const attrs = allAbilities[AbilityId.PROPELLER_TAIL].attrs;
    const spd = attrs.find((a): a is StatMultiplierAbAttr => a instanceof StatMultiplierAbAttr);
    expect(spd).toBeDefined();
    expect(spd?.stat).toBe(Stat.SPD);
    expect(spd?.multiplier).toBe(1.5);
  });

  it("Stalwart gains crit immunity alongside redirection immunity", () => {
    const attrs = allAbilities[AbilityId.STALWART].attrs;
    expect(attrs.some(a => a instanceof BlockCritAbAttr)).toBe(true);
  });

  it("Anger Shell raises ATK/SpAtk/Spd by +2 (full Shell Smash, per ER desc), -1 Def/SpDef", () => {
    const attrs = allAbilities[AbilityId.ANGER_SHELL].attrs.filter(
      a => a.constructor.name === "PostDefendHpGatedStatStageChangeAbAttr",
    );
    const stagesOf = (a: (typeof attrs)[number]) => (a as unknown as { stages: number }).stages;
    expect(attrs.some(a => stagesOf(a) === 2)).toBe(true); // offensive boost bumped 1→2
    expect(attrs.some(a => stagesOf(a) === -1)).toBe(true); // defensive drop unchanged
    expect(attrs.some(a => stagesOf(a) === 1)).toBe(false); // no leftover +1
  });

  it("Tangled Feet substitutes Speed for the defensive stat (no leftover evasion boost)", () => {
    const attrs = allAbilities[AbilityId.TANGLED_FEET].attrs;
    // Vanilla's confusion-gated evasion ×2 must be gone.
    expect(attrs.some(a => a instanceof StatMultiplierAbAttr && (a as StatMultiplierAbAttr).stat === Stat.EVA)).toBe(
      false,
    );
    const sub = attrs.find(a => a.constructor.name === "DefensiveStatSubstituteAbAttr");
    expect(sub).toBeDefined();
    expect((sub as unknown as { substituteStat: number }).substituteStat).toBe(Stat.SPD);
    // The substitute is gated on "confused or enraged" (enrage === the vanilla
    // TAUNT tag in ER), not unconditional.
    expect(sub?.getCondition()).not.toBeNull();
  });

  it("Supersweet Syrup is reworked to Sticky Hold + on-contact item disable (no entry evasion drop)", () => {
    const attrs = allAbilities[AbilityId.SUPERSWEET_SYRUP].attrs;
    expect(attrs.some(a => a.constructor.name === "BlockItemTheftAbAttr")).toBe(true);
    expect(attrs.some(a => a.constructor.name === "DisableTargetItemOnContactAbAttr")).toBe(true);
    // The vanilla entry evasion-drop is gone.
    expect(attrs.some(a => a.constructor.name === "PostSummonStatStageChangeAbAttr")).toBe(false);
  });

  it("Inner Focus gains 'Focus Blast never misses' (ConditionalAlwaysHit), cascading to its composites", () => {
    // ER Inner Focus adds a Focus-Blast-never-miss clause; patched on the
    // vanilla ability so composites that embed it inherit via attr-copy.
    expect(hasAlwaysHit(AbilityId.INNER_FOCUS)).toBe(true);
    // Cascade check: Enlightened (489) embeds Inner Focus as a composite part.
    const enlightened = ER_ID_MAP.abilities[489];
    expect(enlightened).toBeDefined();
    if (enlightened !== undefined) {
      expect(hasAlwaysHit(enlightened)).toBe(true);
    }
  });

  it("Teraform Zero gains Tera Shell (FullHpResistType) on top of the weather/terrain clear", () => {
    const attrs = allAbilities[AbilityId.TERAFORM_ZERO].attrs;
    expect(attrs.some(a => a.constructor.name === "FullHpResistTypeAbAttr")).toBe(true);
    // The vanilla weather/terrain clear is preserved.
    expect(attrs.some(a => a.constructor.name === "PostSummonWeatherChangeAbAttr")).toBe(true);
    expect(attrs.some(a => a.constructor.name === "PostSummonTerrainChangeAbAttr")).toBe(true);
  });

  it("Leaf Guard cures the HOLDER's own status in sun (allyTarget=false, not the ally)", () => {
    const cure = allAbilities[AbilityId.LEAF_GUARD].attrs.find(a => a.constructor.name === "PostTurnResetStatusAbAttr");
    expect(cure).toBeDefined();
    expect((cure as unknown as { allyTarget: boolean }).allyTarget).toBe(false);
    // The vanilla sun-gated status immunity must be gone (ER replaced it with the cure).
    expect(
      allAbilities[AbilityId.LEAF_GUARD].attrs.some(a => a.constructor.name === "StatusEffectImmunityAbAttr"),
    ).toBe(false);
  });

  it("Justified (#397) NULLIFIES Dark moves (Sap-Sipper-style absorb), not hit-then-boost", () => {
    const attrs = allAbilities[AbilityId.JUSTIFIED].attrs;
    // The vanilla PostDefend boost (take the hit, then +1 Atk) must be gone...
    expect(attrs.some(a => a.constructor.name === "PostDefendStatStageChangeAbAttr")).toBe(false);
    // ...replaced by full Dark immunity that grants the +1 Atk on absorb.
    expect(attrs.some(a => a.constructor.name === "TypeImmunityStatStageChangeAbAttr")).toBe(true);
  });

  it("Run Away's stat-lowered rider raises Speed by +2", () => {
    const trigger = allAbilities[AbilityId.RUN_AWAY].attrs.find(
      (a): a is StatTriggerOnStatLoweredAbAttr => a instanceof StatTriggerOnStatLoweredAbAttr,
    );
    expect(trigger).toBeDefined();
    const spd = trigger?.getStatChanges().find(s => s.stat === Stat.SPD);
    expect(spd?.stages).toBe(2);
  });

  it("Pure Power doubles SP.ATK (not ATK) and its AI moveset hint favors SPECIAL moves", () => {
    const attrs = allAbilities[AbilityId.PURE_POWER].attrs;
    // Stat swap: the boost is SPATK ×2, and the vanilla ATK ×2 is gone.
    const stat = attrs.find((a): a is StatMultiplierAbAttr => a instanceof StatMultiplierAbAttr);
    expect(stat?.stat).toBe(Stat.SPATK);
    expect(stat?.multiplier).toBe(2);
    expect(attrs.some(a => a instanceof StatMultiplierAbAttr && a.stat === Stat.ATK)).toBe(false);
    // AI moveset-gen hint: doubles effective power for SPECIAL, leaves PHYSICAL alone
    // (the vanilla hint was the reverse, which mis-tuned the AI after the stat swap).
    const hint = attrs.find((a): a is AiMovegenMoveStatsAbAttr => a instanceof AiMovegenMoveStatsAbAttr);
    expect(hint).toBeDefined();
    const special = new NumberHolder(1);
    hint?.apply({
      move: { category: MoveCategory.SPECIAL },
      powerMult: special,
    } as unknown as AiMovegenMoveStatsAbAttrParams);
    expect(special.value).toBe(2);
    const physical = new NumberHolder(1);
    hint?.apply({
      move: { category: MoveCategory.PHYSICAL },
      powerMult: physical,
    } as unknown as AiMovegenMoveStatsAbAttrParams);
    expect(physical.value).toBe(1);
  });
});
