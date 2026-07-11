/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER tier-1 ability AUDIT FIXES (batch) — wiring-level regression tests.
//
// Each ER ability below diverged from its ER 2.65 dex text; this file pins the
// DISPATCHED AbAttr set so a future refactor can't silently regress the
// magnitude / stat / turn-count / scope. Pure config/structure checks (no
// GameManager boot). Combat-observable proofs are run via the headless
// scenario runner (see the batch report).
// =============================================================================

import { MovePowerBoostAbAttr, PostTurnRandomBerryEffectAbAttr, PreventItemUseAbAttr } from "#abilities/ab-attrs";
import type { AbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import {
  ChanceBattlerTagOnAttackAbAttr,
  ChanceStatusOnAttackAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { OffensiveTypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { describe, expect, it } from "vitest";

/** Resolve an ER ability id to its dispatched AbAttr list via its archetype row. */
function attrsFor(erId: number): readonly AbAttr[] {
  const row = ER_ABILITY_ARCHETYPES[erId];
  expect(row, `no archetype row for er ability ${erId}`).toBeDefined();
  return dispatchArchetype(row.archetype, row.params, erId).attrs;
}

function findOne<T extends AbAttr>(attrs: readonly AbAttr[], ctor: new (...a: never[]) => T): T {
  const hits = attrs.filter((a): a is T => a instanceof ctor);
  expect(hits, `expected exactly one instance of ${ctor.name}`).toHaveLength(1);
  return hits[0];
}

/** Collect every offensive-type-chart rule across all such attrs on an ability. */
function allOverrideRules(attrs: readonly AbAttr[]) {
  return attrs
    .filter((a): a is OffensiveTypeChartOverrideAbAttr => a instanceof OffensiveTypeChartOverrideAbAttr)
    .flatMap(a => [...a.getRules()]);
}

const POISON_STEEL_SE = {
  attackType: PokemonType.POISON,
  defenderType: PokemonType.STEEL,
  newMultiplier: 2,
} as const;

describe("ER tier-1 ability fixes — wiring", () => {
  it("World Serpent (849): +20% physical-non-contact boost + 50% WRAP trap (4-5 turns, contact)", () => {
    const attrs = attrsFor(849);
    // The physical non-contact +20% (no other MovePowerBoost on this ability).
    const boost = findOne(attrs, MovePowerBoostAbAttr);
    expect(boost.getPowerMultiplier()).toBeCloseTo(1.2);
    // The 50% contact trap for 4-5 turns.
    const trap = findOne(attrs, ChanceBattlerTagOnAttackAbAttr);
    expect(trap.getChance()).toBe(50);
    expect(trap.getTags()).toContain(BattlerTagType.WRAP);
    expect(trap.requiresContact()).toBe(true);
    expect(trap.getTurnRange()).toEqual([4, 5]);
    // Long Reach / Grip Pincer riders must be GONE (no StabAdd, no always-hit,
    // no Def-ignore — those would show as extra attrs). Only the two above.
    expect(attrs).toHaveLength(2);
  });

  it("Haunting Frenzy (594): 20% FLINCH fires on ALL attacks (contactRequired:false)", () => {
    const flinch = findOne(attrsFor(594), ChanceBattlerTagOnAttackAbAttr);
    expect(flinch.getChance()).toBe(20);
    expect(flinch.getTags()).toContain(BattlerTagType.FLINCHED);
    expect(flinch.requiresContact()).toBe(false);
  });

  it("Poseidon's Dominion (784): on-entry Whirlpool is cast at 50 BP (not vanilla 35)", () => {
    const cast = findOne(attrsFor(784), PostSummonScriptedMoveAbAttr);
    expect(cast.getMoveId()).toBe(MoveId.WHIRLPOOL);
    expect(cast.getPower()).toBe(50);
  });

  it("Faraday Cage (759): keeps the 50 BP Thunder Cage counter AND adds 0.8x incoming damage", () => {
    const attrs = attrsFor(759);
    const counter = findOne(attrs, CounterAttackOnHitAbAttr);
    expect(counter.getMoveId()).toBe(MoveId.THUNDER_CAGE);
    expect(counter.getPower()).toBe(50);
    const dr = findOne(attrs, DamageReductionAbAttr);
    expect(dr.getReduction()).toBeCloseTo(0.2);
    expect(dr.getFilter()).toEqual({ kind: "all" });
  });

  it("Storm Cloud (989): grants Electric STAB (StabAdd), NOT a defensive Electric typing", () => {
    const attrs = attrsFor(989);
    const stab = findOne(attrs, StabAddAbAttr);
    expect(stab.getTargetType()).toBe(PokemonType.ELECTRIC);
    // No add-self-type entry effect (would graft a Ground weakness). The only
    // EntryEffect should be the RAIN(8) set-weather.
    const entryEffects = attrs.filter((a): a is EntryEffectAbAttr => a instanceof EntryEffectAbAttr);
    expect(entryEffects).toHaveLength(1);
    expect(entryEffects[0].getKind()).toBe("set-weather");
  });

  it("Crowned King (530): blocks ALL held-item consumption (PreventItemUse), not just berries", () => {
    expect(attrsFor(530).some(a => a instanceof PreventItemUseAbAttr)).toBe(true);
  });

  it("Acidic Slime (760): Poison STAB + Poison→Steel super-effective override", () => {
    const attrs = attrsFor(760);
    expect(findOne(attrs, StabAddAbAttr).getTargetType()).toBe(PokemonType.POISON);
    expect(allOverrideRules(attrs)).toContainEqual(POISON_STEEL_SE);
  });

  it("Pyroclastic Flow (635): carries the Poison→Steel super-effective override", () => {
    // (Molten Down also contributes a Fire→Rock override — assert Poison→Steel is
    // present across all override attrs, not the sole one.)
    expect(allOverrideRules(attrsFor(635))).toContainEqual(POISON_STEEL_SE);
  });

  it("Blight Scale (779): adds the OFFENSIVE 30% poison-on-contact half", () => {
    const off = findOne(attrsFor(779), ChanceStatusOnAttackAbAttr);
    expect(off.getChance()).toBe(30);
    expect(off.getEffects()).toContain(StatusEffect.POISON);
    expect(off.requiresContact()).toBe(true);
  });

  it("Angelic Wings (962): wires Huge Wings — AIR_BASED moves at 1.3x", () => {
    const boost = findOne(attrsFor(962), FlagDamageBoostAbAttr);
    expect(boost.getBoostFlag()).toBe(MoveFlags.AIR_BASED);
    expect(boost.getHighHpMultiplier()).toBeCloseTo(1.3);
  });

  it("Craving (890): random berry pick is restricted to the curated dex pool", () => {
    const berry = findOne(attrsFor(890), PostTurnRandomBerryEffectAbAttr);
    const pool = berry.getBerryPool();
    expect(pool).toBeDefined();
    expect([...(pool ?? [])].sort((a, b) => a - b)).toEqual(
      [
        BerryType.SITRUS,
        BerryType.LIECHI,
        BerryType.GANLON,
        BerryType.SALAC,
        BerryType.PETAYA,
        BerryType.APICOT,
        BerryType.LANSAT,
        BerryType.STARF,
      ].sort((a, b) => a - b),
    );
    // Off-list berries the audit flagged must NOT be in the pool.
    expect(pool).not.toContain(BerryType.LUM);
    expect(pool).not.toContain(BerryType.ENIGMA);
    expect(pool).not.toContain(BerryType.LEPPA);
  });
});

describe("Peaceful Slumber (490) — Sweet Dreams heal fires for Comatose holders", () => {
  // The 1/8 SLEEP-gated heal must also fire when the holder is "considered
  // asleep" via Comatose (no real SLEEP status). The gate lives in
  // PassiveRecoveryAbAttr.matchesCondition.
  function stub(opts: { comatose: boolean; status?: StatusEffect }): Pokemon {
    return {
      hasAbility: (id: AbilityId) => opts.comatose && id === AbilityId.COMATOSE,
      status: opts.status === undefined ? null : { effect: opts.status },
      getTypes: () => [],
    } as unknown as Pokemon;
  }

  const sleepGate = { kind: "status", status: StatusEffect.SLEEP } as const;

  it("fires for a Comatose holder with no real SLEEP status", () => {
    expect(PassiveRecoveryAbAttr.matchesCondition(sleepGate, stub({ comatose: true }))).toBe(true);
  });

  it("fires for a genuinely asleep holder", () => {
    expect(
      PassiveRecoveryAbAttr.matchesCondition(sleepGate, stub({ comatose: false, status: StatusEffect.SLEEP })),
    ).toBe(true);
  });

  it("does NOT fire for a non-Comatose, non-sleeping holder", () => {
    expect(PassiveRecoveryAbAttr.matchesCondition(sleepGate, stub({ comatose: false }))).toBe(false);
  });
});
