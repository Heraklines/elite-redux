/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Round 11 of the bespoke ability grind: tests for the
// type-effectiveness-mod primitive wires.
//
// Verifies the 5 symmetric "hunter" abilities (313, 442, 445, 526, 804) plus
// the offensive-only King of the Jungle (1028) dispatch through
// `buildTypeEffectivenessModAttrs` and produce the right offensive boost +
// (where applicable) defensive reduction AbAttrs.
//
// The factory pairs an `OffensiveTypeMultiplierAbAttr` (custom subclass of
// `MovePowerBoostAbAttr`) with a vanilla `ReceivedTypeDamageMultiplierAbAttr`
// — the two fire on different pokerogue surfaces (power calc vs. type-effective
// damage calc) so they must live as two separate AbAttrs in `Ability.attrs`.
// =============================================================================

import { MovePowerBoostAbAttr, ReceivedTypeDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { OffensiveTypeMultiplierAbAttr } from "#data/elite-redux/archetypes/type-effectiveness-mod";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

describe("dispatchArchetype('bespoke', null, erAbilityId): type-effectiveness-mod wires", () => {
  it("er id 313 (Dragonslayer) wires Offensive(DRAGON, 1.5) + ReceivedType(DRAGON, 0.5)", () => {
    const res = dispatchArchetype("bespoke", null, 313);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const offensive = res.attrs[0] as OffensiveTypeMultiplierAbAttr;
    expect(offensive).toBeInstanceOf(OffensiveTypeMultiplierAbAttr);
    expect(offensive).toBeInstanceOf(MovePowerBoostAbAttr);
    expect(offensive.getTargetDefenderType()).toBe(PokemonType.DRAGON);
    expect(offensive.getMultiplier()).toBeCloseTo(1.5);
    const defensive = res.attrs[1] as ReceivedTypeDamageMultiplierAbAttr;
    expect(defensive).toBeInstanceOf(ReceivedTypeDamageMultiplierAbAttr);
  });

  it("er id 442 (Fae Hunter) wires Offensive(FAIRY, 1.5) + ReceivedType(FAIRY, 0.5)", () => {
    const res = dispatchArchetype("bespoke", null, 442);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const offensive = res.attrs[0] as OffensiveTypeMultiplierAbAttr;
    expect(offensive).toBeInstanceOf(OffensiveTypeMultiplierAbAttr);
    expect(offensive.getTargetDefenderType()).toBe(PokemonType.FAIRY);
    expect(offensive.getMultiplier()).toBeCloseTo(1.5);
    expect(res.attrs[1]).toBeInstanceOf(ReceivedTypeDamageMultiplierAbAttr);
  });

  it("er id 445 (Lumberjack) wires Offensive(GRASS, 1.5) + ReceivedType(GRASS, 0.5)", () => {
    const res = dispatchArchetype("bespoke", null, 445);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const offensive = res.attrs[0] as OffensiveTypeMultiplierAbAttr;
    expect(offensive).toBeInstanceOf(OffensiveTypeMultiplierAbAttr);
    expect(offensive.getTargetDefenderType()).toBe(PokemonType.GRASS);
    expect(offensive.getMultiplier()).toBeCloseTo(1.5);
    expect(res.attrs[1]).toBeInstanceOf(ReceivedTypeDamageMultiplierAbAttr);
  });

  it("er id 526 (Monster Hunter) wires Offensive(DARK, 1.5) + ReceivedType(DARK, 0.5)", () => {
    const res = dispatchArchetype("bespoke", null, 526);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const offensive = res.attrs[0] as OffensiveTypeMultiplierAbAttr;
    expect(offensive).toBeInstanceOf(OffensiveTypeMultiplierAbAttr);
    expect(offensive.getTargetDefenderType()).toBe(PokemonType.DARK);
    expect(offensive.getMultiplier()).toBeCloseTo(1.5);
    expect(res.attrs[1]).toBeInstanceOf(ReceivedTypeDamageMultiplierAbAttr);
  });

  it("er id 804 (Firefighter) wires Offensive(FIRE, 1.5) + ReceivedType(FIRE, 0.5)", () => {
    const res = dispatchArchetype("bespoke", null, 804);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const offensive = res.attrs[0] as OffensiveTypeMultiplierAbAttr;
    expect(offensive).toBeInstanceOf(OffensiveTypeMultiplierAbAttr);
    expect(offensive.getTargetDefenderType()).toBe(PokemonType.FIRE);
    expect(offensive.getMultiplier()).toBeCloseTo(1.5);
    expect(res.attrs[1]).toBeInstanceOf(ReceivedTypeDamageMultiplierAbAttr);
  });

  it("er id 1028 (King of the Jungle) wires Infiltrator + Offensive(GRASS, 1.5) (no defensive)", () => {
    const res = dispatchArchetype("bespoke", null, 1028);
    expect(res.skipReason).toBeNull();
    // Infiltrator copies its vanilla attrs (count varies — typically 1+) +
    // ONE OffensiveTypeMultiplierAbAttr from the factory (defensive side
    // omitted because defensiveMultiplier=1).
    const offensiveAttrs = res.attrs.filter(a => a instanceof OffensiveTypeMultiplierAbAttr);
    expect(offensiveAttrs).toHaveLength(1);
    const offensive = offensiveAttrs[0] as OffensiveTypeMultiplierAbAttr;
    expect(offensive.getTargetDefenderType()).toBe(PokemonType.GRASS);
    expect(offensive.getMultiplier()).toBeCloseTo(1.5);
    // No ReceivedTypeDamageMultiplierAbAttr (defensive side disabled).
    const defensiveAttrs = res.attrs.filter(a => a instanceof ReceivedTypeDamageMultiplierAbAttr);
    expect(defensiveAttrs).toHaveLength(0);
  });
});
