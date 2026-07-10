/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER dex-fidelity tier-8 batch 2 — WIRING (dispatch-structure) regression tests.
//
// Pins the dispatched AbAttr set for each of the abilities fixed in this batch
// against their ER 2.65 ROM dex text. Pure config checks (no GameManager boot),
// mirroring er-ability-audit-fixes.test.ts. Behaviour-level proofs live in
// er-dex-tier8-batch2-behavior.test.ts.
//
//   - 794 Deadly Precision   — SE-gated always-hit + SE-gated ability bypass.
//   - 921 Flawless Precision — same two + SE crit.
//   - 325 Intoxicate         — Normal→Poison + Poison STAB + 10% TOXIC.
//   - 459 Emanate            — Normal→Psychic + Psychic STAB + 10% CONFUSED.
//   - 279 Immolate           — Normal→Fire + Fire STAB + 10% BURN.
//   - 366 Solar Flare        — Chloroplast + Immolate (composite).
//   - 541 Web Spinner        — on-entry String Shot vs ALL opponents.
// =============================================================================

import {
  AlwaysHitAbAttr,
  ConditionalCritAbAttr,
  MoveAbilityBypassAbAttr,
  SuperEffectiveMoveAbilityBypassAbAttr,
} from "#abilities/ab-attrs";
import type { AbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { AteConditionalStatusAbAttr } from "#data/elite-redux/archetypes/ate-conditional";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { TypeConversionAbAttr, TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { ER_COMPOSITE_PARTS } from "#data/elite-redux/er-composite-parts";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
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

/** Assert the standard "-ate + conditional" trio (D/E/F) for a given target type + secondary. */
function expectAteTrio(attrs: readonly AbAttr[], targetType: PokemonType, outcome: AteConditionalStatusAbAttr): void {
  // 1. Normal → targetType conversion.
  const conv = findOne(attrs, TypeConversionAbAttr);
  expect(conv.getSource()).toEqual({ kind: "type", type: PokemonType.NORMAL });
  expect(conv.getNewType()).toBe(targetType);
  // 2. targetType STAB (self-gating: only fires on an off-type holder).
  const stab = findOne(attrs, StabAddAbAttr);
  expect(stab.getTargetType()).toBe(targetType);
  expect(stab.getMultiplier()).toBeCloseTo(1.5);
  // 3. 10% type-gated secondary.
  const sec = findOne(attrs, AteConditionalStatusAbAttr);
  expect(sec.getNewType()).toBe(targetType);
  expect(sec.getChance()).toBe(10);
  expect(sec.getOutcome()).toEqual(outcome.getOutcome());
  // 4. NO flat power boost (the old type-conversion ×1.2 bug).
  expect(attrs.some(a => a instanceof TypeConversionPowerBoostAbAttr)).toBe(false);
}

describe("ER dex tier-8 batch 2 — wiring", () => {
  it("Deadly Precision (794): SE-gated always-hit + SE-gated ability bypass, no unconditional halves", () => {
    const attrs = attrsFor(794);
    const hit = findOne(attrs, ConditionalAlwaysHitAbAttr);
    expect(hit.opts.superEffective).toBe(true);
    findOne(attrs, SuperEffectiveMoveAbilityBypassAbAttr);
    // The OLD wiring used an UNCONDITIONAL AlwaysHitAbAttr + a plain (unconditional)
    // MoveAbilityBypassAbAttr. Neither should be present now.
    expect(attrs.some(a => a instanceof AlwaysHitAbAttr)).toBe(false);
    expect(
      attrs.some(a => a instanceof MoveAbilityBypassAbAttr && !(a instanceof SuperEffectiveMoveAbilityBypassAbAttr)),
    ).toBe(false);
  });

  it("Flawless Precision (921): SE always-hit + SE bypass + SE crit", () => {
    const attrs = attrsFor(921);
    expect(findOne(attrs, ConditionalAlwaysHitAbAttr).opts.superEffective).toBe(true);
    findOne(attrs, SuperEffectiveMoveAbilityBypassAbAttr);
    findOne(attrs, ConditionalCritAbAttr);
    expect(attrs.some(a => a instanceof AlwaysHitAbAttr)).toBe(false);
  });

  it("Intoxicate (325): Normal→Poison + Poison STAB + 10% TOXIC, no flat boost", () => {
    expectAteTrio(
      attrsFor(325),
      PokemonType.POISON,
      new AteConditionalStatusAbAttr({
        newType: PokemonType.POISON,
        outcome: { kind: "status", effect: StatusEffect.TOXIC },
      }),
    );
  });

  it("Emanate (459): Normal→Psychic + Psychic STAB + 10% CONFUSED, no flat boost", () => {
    expectAteTrio(
      attrsFor(459),
      PokemonType.PSYCHIC,
      new AteConditionalStatusAbAttr({
        newType: PokemonType.PSYCHIC,
        outcome: { kind: "tag", tag: BattlerTagType.CONFUSED },
      }),
    );
  });

  it("Immolate (279): Normal→Fire + Fire STAB + 10% BURN, no flat boost", () => {
    expectAteTrio(
      attrsFor(279),
      PokemonType.FIRE,
      new AteConditionalStatusAbAttr({
        newType: PokemonType.FIRE,
        outcome: { kind: "status", effect: StatusEffect.BURN },
      }),
    );
  });

  it("Solar Flare (366 = Chloroplast + Immolate): the Immolate half is the corrected trio, Chloroplast still wired", () => {
    const attrs = attrsFor(366);
    // Immolate half — the corrected trio.
    expectAteTrio(
      attrs,
      PokemonType.FIRE,
      new AteConditionalStatusAbAttr({
        newType: PokemonType.FIRE,
        outcome: { kind: "status", effect: StatusEffect.BURN },
      }),
    );
    // Chloroplast half still wired: it is a pure MARKER ability (case 268 returns
    // no attrs; its effect is applied move-side via userActsInSun), so it adds no
    // AbAttrs — assert instead that the composite still references it as a part.
    const parts = ER_COMPOSITE_PARTS[366]?.parts ?? [];
    expect(parts.some(p => p.kind === "er" && p.erAbilityId === 268)).toBe(true);
    expect(parts.some(p => p.kind === "er" && p.erAbilityId === 279)).toBe(true);
  });

  it("Web Spinner (541): on-entry String Shot targets ALL opponents", () => {
    const cast = findOne(attrsFor(541), PostSummonScriptedMoveAbAttr);
    expect(cast.getMoveId()).toBe(MoveId.STRING_SHOT);
    expect(cast.targetsAllOpponents()).toBe(true);
  });
});
