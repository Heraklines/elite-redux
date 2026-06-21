/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (tester): a Pokemon with the ER ability CORROSION used Acid Spray
// (a Poison damaging move) on a Steel target and it "did not work" - it dealt 0
// (the Poison-vs-Steel immunity) instead of super effective. ER Corrosion (dex
// 212) is "Poison is super effective vs Steel. Can poison any type." The port
// only wired the "poison any type" half (IgnoreTypeStatusEffectImmunity); the
// OFFENSIVE half (the holder's Poison moves hit Steel for 2x) was missing from
// the STANDALONE ability (the composites Trash Heap / Acidic Slime had it). This
// pins that AbilityId.CORROSION now carries an OffensiveTypeChartOverride that
// forces Poison-vs-Steel to 2x (overriding the immunity), without dropping the
// status-immunity half. (Composites that name "Corrosion" as a part inherit it
// via resolveCompositePartAttrs, which copies allAbilities[CORROSION].attrs.)
// =============================================================================

import { allAbilities } from "#data/data-lists";
import type { OffensiveTypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Corrosion — the holder's Poison moves are super effective (2×) vs Steel", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Boots init (populates allAbilities with the ER-patched Corrosion). No battle.
    void new GameManager(phaserGame);
  });

  function corrosionOverride(): OffensiveTypeChartOverrideAbAttr {
    const overrides = allAbilities[AbilityId.CORROSION].attrs.filter(
      (a): a is OffensiveTypeChartOverrideAbAttr => a.constructor.name === "OffensiveTypeChartOverrideAbAttr",
    );
    expect(overrides.length, "Corrosion must carry exactly one offensive type-chart override").toBe(1);
    return overrides[0];
  }

  it("Corrosion keeps BOTH halves: the status bypass AND the new offensive override", () => {
    const names = allAbilities[AbilityId.CORROSION].attrs.map(a => a.constructor.name);
    // "Can poison any type" half (unchanged).
    expect(names).toContain("IgnoreTypeStatusEffectImmunityAbAttr");
    // "Poison is super effective vs Steel" half (the fix).
    expect(names).toContain("OffensiveTypeChartOverrideAbAttr");
  });

  it("the wired rule is exactly Poison → Steel = 2×", () => {
    const rules = corrosionOverride().getRules();
    expect(rules).toEqual([{ attackType: PokemonType.POISON, defenderType: PokemonType.STEEL, newMultiplier: 2 }]);
  });

  it("forces Poison to 2× vs Steel, overriding the immunity, and combines dual-types correctly", () => {
    const attr = corrosionOverride();

    // Pure Steel (Registeel): 0× immunity → 2× super effective.
    const steel = new NumberHolder(0);
    attr.fire(PokemonType.POISON, [PokemonType.STEEL], steel);
    expect(steel.value).toBe(2);

    // Skarmory (Steel/Flying): forced Steel (2×) × Poison-vs-Flying (1×) = 2× — the tester's case.
    const skarmory = new NumberHolder(0);
    attr.fire(PokemonType.POISON, [PokemonType.STEEL, PokemonType.FLYING], skarmory);
    expect(skarmory.value).toBe(2);

    // Steel/Poison (e.g. a hypothetical): forced Steel (2×) × Poison-vs-Poison (0.5×) = 1×.
    const steelPoison = new NumberHolder(0);
    attr.fire(PokemonType.POISON, [PokemonType.STEEL, PokemonType.POISON], steelPoison);
    expect(steelPoison.value).toBe(1);
  });

  it("does NOT touch non-Poison moves, nor non-Steel targets", () => {
    const attr = corrosionOverride();

    // Normal vs Steel stays resisted (the rule only matches Poison).
    const normalVsSteel = new NumberHolder(0.5);
    attr.fire(PokemonType.NORMAL, [PokemonType.STEEL], normalVsSteel);
    expect(normalVsSteel.value).toBe(0.5);

    // Poison vs a non-Steel target is left to the natural chart (attr declines).
    const poisonVsWater = new NumberHolder(1);
    attr.fire(PokemonType.POISON, [PokemonType.WATER], poisonVsWater);
    expect(poisonVsWater.value).toBe(1);
  });
});
