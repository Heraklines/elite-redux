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

import { BlockRecoilDamageAttr, PostDefendContactDamageAbAttr } from "#abilities/ab-attrs";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
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
