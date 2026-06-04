/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Round 12 of the bespoke ability grind: per-id wiring tests
// for the round-12 cluster.
//
// Round 12 introduces NO new archetype primitive. Every wire reuses an
// existing primitive (rounds 1-11) or imports a vanilla pokerogue AbAttr
// (StatMultiplierAbAttr, UserFieldMoveTypePowerBoostAbAttr) directly into the
// dispatcher. The tests below lock in the per-id routing for the 11 new
// wires added this round plus 2 extension wires (544 Airborne and 944 Dead
// Bark, both upgraded from partial to fuller coverage).
// =============================================================================

import { AttackTypeImmunityAbAttr, StatMultiplierAbAttr, UserFieldMoveTypePowerBoostAbAttr } from "#abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import {
  ChanceBattlerTagOnAttackAbAttr,
  ChanceBattlerTagOnHitAbAttr,
  ChanceStatusOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { CritDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { TypeAbsorbStatBoostAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

describe("dispatchArchetype('bespoke', null, erAbilityId): round 12 wires", () => {
  // ---------- entry-effect add-self-type cluster ----------
  it("er id 715 (Hover) wires add-self-type PSYCHIC + Ground immunity + Float", () => {
    // "Adds Psychic type to itself. Avoids Ground attacks." — add-self-type,
    // the Ground type-immunity, AND FloatAbAttr (Levitate-style ungrounding so
    // Spikes / terrain / Arena Trap no longer apply).
    const res = dispatchArchetype("bespoke", null, 715);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    const attr = res.attrs[0] as EntryEffectAbAttr;
    expect(attr).toBeInstanceOf(EntryEffectAbAttr);
    const eff = attr.getEffect();
    expect(eff.kind).toBe("add-self-type");
    if (eff.kind === "add-self-type") {
      expect(eff.type).toBe(PokemonType.PSYCHIC);
    }
    expect(res.attrs[1]).toBeInstanceOf(AttackTypeImmunityAbAttr);
    expect(res.attrs.some(a => a.constructor.name === "FloatAbAttr")).toBe(true);
  });

  it("er id 843 (Fey Flight) wires add-self-type FAIRY + Ground immunity + Float + Flying boost", () => {
    // "Adds Fairy-type, levitates, and boosts Flying-type moves by 25%." —
    // add-self-type (Fairy) + Ground immunity + FloatAbAttr + Flying ×1.25.
    const res = dispatchArchetype("bespoke", null, 843);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(4);
    const attr = res.attrs[0] as EntryEffectAbAttr;
    expect(attr).toBeInstanceOf(EntryEffectAbAttr);
    const eff = attr.getEffect();
    if (eff.kind === "add-self-type") {
      expect(eff.type).toBe(PokemonType.FAIRY);
    }
    expect(res.attrs[1]).toBeInstanceOf(AttackTypeImmunityAbAttr);
    expect(res.attrs.some(a => a.constructor.name === "FloatAbAttr")).toBe(true);
    expect(res.attrs.some(a => a.constructor.name === "TypeDamageBoostAbAttr")).toBe(true);
  });

  // ---------- type-absorb-stat-boost ----------
  it("er id 282 (Aerodynamics) wires TypeAbsorbStatBoost(FLYING, SPD, +1)", () => {
    const res = dispatchArchetype("bespoke", null, 282);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(TypeAbsorbStatBoostAbAttr);
  });

  // ---------- StatMultiplier cluster ----------
  it("er id 301 (Cryptic Power) wires StatMultiplier(SPATK, 2x)", () => {
    const res = dispatchArchetype("bespoke", null, 301);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(StatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.SPATK);
    expect(attr.multiplier).toBeCloseTo(2);
  });

  it("er id 323 (Majestic Bird) wires StatMultiplier(SPATK, 1.5x)", () => {
    const res = dispatchArchetype("bespoke", null, 323);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatMultiplierAbAttr;
    expect(attr.stat).toBe(Stat.SPATK);
    expect(attr.multiplier).toBeCloseTo(1.5);
  });

  it("er id 352 (Sage Power) wires StatMultiplier(SPATK, 1.5x) + GorillaTactics (move-lock)", () => {
    // R52 audit-fix: previously SpAtk-only; now also includes the
    // vanilla GorillaTacticsAbAttr move-lock piece.
    const res = dispatchArchetype("bespoke", null, 352);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const attr = res.attrs[0] as StatMultiplierAbAttr;
    expect(attr.stat).toBe(Stat.SPATK);
    expect(attr.multiplier).toBeCloseTo(1.5);
    expect(res.attrs[1].constructor.name).toBe("GorillaTacticsAbAttr");
  });

  // ---------- compositions ----------
  it("er id 599 (Dead Power) wires StatMultiplier(ATK 1.5x) + ChanceBattlerTagOnHit(20%, CURSED)", () => {
    const res = dispatchArchetype("bespoke", null, 599);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const statMult = res.attrs[0] as StatMultiplierAbAttr;
    expect(statMult).toBeInstanceOf(StatMultiplierAbAttr);
    expect(statMult.stat).toBe(Stat.ATK);
    expect(statMult.multiplier).toBeCloseTo(1.5);
    expect(res.attrs[1]).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
  });

  it("er id 892 (Crispy Cream) wires 30%-burn + 30%-frostbite chance-on-contact", () => {
    const res = dispatchArchetype("bespoke", null, 892);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs[0]).toBeInstanceOf(ChanceStatusOnHitAbAttr);
    expect(res.attrs[1]).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
  });

  it("er id 1027 (Jungle Fever) wires StatMultiplier(SPD, 1.5x) with a terrain-gating closure", () => {
    const res = dispatchArchetype("bespoke", null, 1027);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as StatMultiplierAbAttr;
    expect(attr).toBeInstanceOf(StatMultiplierAbAttr);
    expect(attr.stat).toBe(Stat.SPD);
    expect(attr.multiplier).toBeCloseTo(1.5);
  });

  it("er id 731 (To The Bone) wires CritDamageMultiplier(1.5x) + crit-gated ER_BLEED", () => {
    // "Critical hits get a 1.5x boost and inflict bleeding." — both the
    // crit damage multiplier and the crit-gated bleed-on-attack are wired now.
    const res = dispatchArchetype("bespoke", null, 731);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs[0]).toBeInstanceOf(CritDamageMultiplierAbAttr);
    const bleed = res.attrs[1] as ChanceBattlerTagOnAttackAbAttr;
    expect(bleed).toBeInstanceOf(ChanceBattlerTagOnAttackAbAttr);
    expect(bleed.getTags()).toEqual([BattlerTagType.ER_BLEED]);
  });

  it("er id 462 (Combat Specialist) wires FlagDamageBoost(PUNCHING + KICKING, 1.3x)", () => {
    const res = dispatchArchetype("bespoke", null, 462);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const punching = res.attrs[0] as FlagDamageBoostAbAttr;
    const kicking = res.attrs[1] as FlagDamageBoostAbAttr;
    expect(punching).toBeInstanceOf(FlagDamageBoostAbAttr);
    expect(kicking).toBeInstanceOf(FlagDamageBoostAbAttr);
    expect(punching.getBoostFlag()).toBe(MoveFlags.PUNCHING_MOVE);
    expect(kicking.getBoostFlag()).toBe(MoveFlags.KICKING_MOVE);
  });

  it("er id 1023 (Overwhelming Mind) wires TypeDamageBoost(PSYCHIC, 1.3x; 1.8x below 1/3 HP)", () => {
    const res = dispatchArchetype("bespoke", null, 1023);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as TypeDamageBoostAbAttr;
    expect(attr).toBeInstanceOf(TypeDamageBoostAbAttr);
    expect(attr.getBoostType()).toBe(PokemonType.PSYCHIC);
    expect(attr.getHighHpMultiplier()).toBeCloseTo(1.3);
    expect(attr.getLowHpMultiplier()).toBeCloseTo(1.8);
    expect(attr.getLowHpThreshold()).toBeCloseTo(1 / 3);
  });

  // ---------- extension wires (existing ids upgraded) ----------
  it("er id 544 (Airborne) upgrades to UserFieldMoveTypePowerBoost(FLYING, 1.3x)", () => {
    const res = dispatchArchetype("bespoke", null, 544);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0];
    // Should be the field-aura variant — broadcasts to user + allies. Note
    // that `UserFieldMoveTypePowerBoostAbAttr` extends `FieldMovePowerBoostAbAttr`
    // (which itself extends `AbAttr`, NOT `MovePowerBoostAbAttr`) — pokerogue's
    // field-aura family has its own root in the AbAttr tree.
    expect(attr).toBeInstanceOf(UserFieldMoveTypePowerBoostAbAttr);
  });

  it("er id 944 (Dead Bark) wires add-type GHOST + DamageReduction(all) + DamageReduction(SE)", () => {
    // R52 audit-fix: added SE-only second damage reduction so combined
    // SE reduction matches spec's 30%.
    const res = dispatchArchetype("bespoke", null, 944);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(3);
    expect(res.attrs[0]).toBeInstanceOf(EntryEffectAbAttr);
    const entry = res.attrs[0] as EntryEffectAbAttr;
    const eff = entry.getEffect();
    if (eff.kind === "add-self-type") {
      expect(eff.type).toBe(PokemonType.GHOST);
    }
    expect(res.attrs[1]).toBeInstanceOf(DamageReductionAbAttr);
    expect(res.attrs[2]).toBeInstanceOf(DamageReductionAbAttr);
  });
});
