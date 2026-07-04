/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability AUDIT FIXES — wiring-level regression tests.
//
// Each ER ability below diverged from its ER 2.65 ROM dex text; this file
// asserts the DISPATCHED AbAttr set now matches the dex. These are pure
// config/structure checks (no GameManager boot) that pin the exact params so a
// future refactor can't silently regress the magnitude/stat/turn-count/scope.
// Behaviour-level (GameManager) proofs live in
// `er-ability-audit-fixes-behavior.test.ts`.
// =============================================================================

import {
  IgnoreGenderInfatuationAbAttr,
  MovePowerBoostAbAttr,
  PreserveBaseStatAbilitiesAbAttr,
  PreventItemUseAbAttr,
} from "#abilities/ab-attrs";
import type { AbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ChanceBattlerTagOnAttackAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";
import { ConditionalDamageAbAttr } from "#data/elite-redux/archetypes/conditional-damage";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { HpScalingStatMultiplierAbAttr } from "#data/elite-redux/archetypes/hp-scaling-stat-multiplier";
import { TypeAbsorbHighestAttackStatBoostAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { TypeConversionAbAttr, TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

/** Resolve an ER ability id to its dispatched AbAttr list via its archetype row. */
function attrsFor(erId: number): readonly AbAttr[] {
  const row = ER_ABILITY_ARCHETYPES[erId];
  expect(row, `no archetype row for er ability ${erId}`).toBeDefined();
  return dispatchArchetype(row.archetype, row.params, erId).attrs;
}

function findOne<T extends AbAttr>(attrs: readonly AbAttr[], ctor: new (...a: never[]) => T): T {
  const hit = attrs.find((a): a is T => a instanceof ctor);
  expect(hit, `expected an instance of ${ctor.name}`).toBeDefined();
  return hit as T;
}

describe("ER ability audit fixes — wiring", () => {
  it("Strategic Pause (814): power boost is +30% (1.3x), not the ER Analytic 1.5x", () => {
    const boosts = attrsFor(814).filter((a): a is MovePowerBoostAbAttr => a instanceof MovePowerBoostAbAttr);
    expect(boosts).toHaveLength(1);
    expect(boosts[0].getPowerMultiplier()).toBeCloseTo(1.3);
  });

  it("Faraday Cage (759): Thunder Cage counter is cast at 50 BP (not its natural 80)", () => {
    const counter = findOne(attrsFor(759), CounterAttackOnHitAbAttr);
    expect(counter.getMoveId()).toBe(MoveId.THUNDER_CAGE);
    expect(counter.getPower()).toBe(50);
  });

  it("Tentalock (818): trap proc is 6 turns / 1/6 HP (not Serpent Bind's 4-5 / 1/8)", () => {
    const proc = findOne(attrsFor(818), ChanceBattlerTagOnAttackAbAttr);
    expect(proc.getChance()).toBe(50);
    expect(proc.getTurnRange()).toEqual([6, 6]);
    expect(proc.getDamageDenominator()).toBe(6);
  });

  it("Last Stand (634): Def/SpDef scale LINEARLY 1.0x (full) -> 1.6x (empty), 1.3x at 50%", () => {
    const scalers = attrsFor(634).filter(
      (a): a is HpScalingStatMultiplierAbAttr => a instanceof HpScalingStatMultiplierAbAttr,
    );
    expect(scalers.map(s => s.stat).sort()).toEqual([Stat.DEF, Stat.SPDEF].sort());
    for (const s of scalers) {
      expect(s.multiplierAt(100, 100)).toBeCloseTo(1.0); // full HP → no boost
      expect(s.multiplierAt(50, 100)).toBeCloseTo(1.3); // 50% → 1.3x
      expect(s.multiplierAt(25, 100)).toBeCloseTo(1.45); // 25% → 1.45x
      expect(s.multiplierAt(0, 100)).toBeCloseTo(1.6); // empty → 1.6x
    }
  });

  it("Heat Sink (865): boosts the HIGHEST attacking stat, not a fixed Attack", () => {
    findOne(attrsFor(865), TypeAbsorbHighestAttackStatBoostAbAttr);
  });

  it("Snow Song (624): power boost covers ALL sound moves; conversion only Normal ones", () => {
    const attrs = attrsFor(624);
    const conv = findOne(attrs, TypeConversionAbAttr);
    const boost = findOne(attrs, TypeConversionPowerBoostAbAttr);
    // Conversion is Normal-sound -> Ice (requireType Normal).
    const convSrc = conv.getSource();
    expect(convSrc.kind).toBe("flag");
    expect(convSrc.kind === "flag" && convSrc.requireType).toBe(PokemonType.NORMAL);
    expect(conv.getNewType()).toBe(PokemonType.ICE);
    // Boost is EVERY sound move (no requireType gate).
    const boostSrc = boost.getSource();
    expect(boostSrc.kind).toBe("flag");
    expect(boostSrc.kind === "flag" && boostSrc.flag).toBe(MoveFlags.SOUND_BASED);
    expect(boostSrc.kind === "flag" && boostSrc.requireType).toBeUndefined();
    expect(boost.getMultiplier()).toBeCloseTo(1.2);
  });

  it("Pollinate/Steel Beetle (381): Normal->Bug gains real STAB (1.5x), not a flat 1.2x", () => {
    const attrs = attrsFor(381);
    // No leftover 1.2x -ate boost.
    expect(attrs.some(a => a instanceof TypeConversionPowerBoostAbAttr)).toBe(false);
    const stab = findOne(attrs, StabAddAbAttr);
    expect(stab.getTargetType()).toBe(PokemonType.BUG);
    expect(stab.getMultiplier()).toBeCloseTo(1.5);
  });

  it("Dreamcatcher (305): 2x when ANY active mon is asleep (not target-only)", () => {
    const cond = findOne(attrsFor(305), ConditionalDamageAbAttr);
    expect(cond.getDamageCondition().kind).toBe("any-active-asleep");
    expect(cond.getMultiplier()).toBe(2);
  });

  it("Dreamscape (859): composites Dreamcatcher's any-active-asleep 2x + the +20% rider", () => {
    const attrs = attrsFor(859);
    const conds = attrs.filter((a): a is ConditionalDamageAbAttr => a instanceof ConditionalDamageAbAttr);
    expect(conds.some(c => c.getDamageCondition().kind === "any-active-asleep" && c.getMultiplier() === 2)).toBe(true);
    // The flat +20% all-move rider is still present.
    const boosts = attrs.filter((a): a is MovePowerBoostAbAttr => a instanceof MovePowerBoostAbAttr);
    expect(boosts.some(b => Math.abs(b.getPowerMultiplier() - 1.2) < 1e-6)).toBe(true);
  });

  it("Beautiful Music (622): 50% SOUND-gated infatuate + gender-ignore marker", () => {
    const attrs = attrsFor(622);
    const proc = findOne(attrs, ChanceBattlerTagOnAttackAbAttr);
    expect(proc.getChance()).toBe(50);
    findOne(attrs, IgnoreGenderInfatuationAbAttr);
  });

  it("Blind Rage (694): carries the preserve-base-stat marker (Mold Breaker won't nuke Grass Pelt)", () => {
    findOne(attrsFor(694), PreserveBaseStatAbilitiesAbAttr);
  });

  it("As One (266 Ice / 267 Shadow): carries the block-all-held-items marker", () => {
    findOne(attrsFor(266), PreventItemUseAbAttr);
    findOne(attrsFor(267), PreventItemUseAbAttr);
  });

  it("Sludge Spit (876): follows up AFTER attacking with a 35 BP scripted move (not a defensive counter)", () => {
    const attrs = attrsFor(876);
    const followup = findOne(attrs, PostAttackScriptedMoveAbAttr);
    expect(followup.getPower()).toBe(35);
  });
});
