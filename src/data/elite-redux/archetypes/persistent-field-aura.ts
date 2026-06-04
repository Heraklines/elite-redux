/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `persistent-field-aura` archetype.
//
// True field-aura: applies a percentage multiplier to one or more battle
// stats of allies (and optionally the holder), gated on a predicate
// (e.g. ally BST below a threshold). Hooks pokerogue's existing
// StatMultiplierAbAttr (which fires on every getStat call) so the boost
// re-evaluates whenever any battler's stat is read — meaning allies that
// switch in AFTER the holder still benefit.
//
// Wires:
//   - 891 Rat King — "Allies with a BST below 400 get stats boosted by 50%"
//     (boost: 1.5, stats: ATK/DEF/SPATK/SPDEF/SPD, gate: ally.BST < 400)
//   - 933 Polarity — "Increases the party's highest stat by 30%"
//     (boost: 1.3, stats: ATK/DEF/SPATK/SPDEF/SPD where ally has highest,
//      gate: ally is on the same side as holder)
//
// Pokerogue uses AbAttr-on-self for stat lookups; we extend that surface
// so the holder's ability re-runs against each on-field battler when
// getStat is called via the field-aware aliased machinery.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { Stat, type EffectiveStat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { NumberHolder } from "#utils/common";

export interface PersistentFieldAuraOptions {
  /** Stats the aura modifies. */
  readonly stats: readonly EffectiveStat[];
  /** Multiplier applied (e.g. 1.5 = +50%). */
  readonly multiplier: number;
  /**
   * Per-ally predicate. Returns true if the ally should receive the boost.
   * Holder is provided for context (BST checks, mega status, etc.).
   * If omitted, every ally on the holder's side gets the boost.
   */
  readonly predicate?: (ally: Pokemon, holder: Pokemon) => boolean;
  /** If true, the holder also receives the boost (default: false). */
  readonly includeSelf?: boolean;
}

/**
 * Custom AbAttr that hooks Pokemon.getStat via direct constructor.name
 * lookup at the call-site. Each time pokemon.getStat() is called, the
 * engine should call PersistentFieldAuraAbAttr.fire(pokemon, stat, value)
 * to potentially boost the value. Wiring on the holder side ensures the
 * aura persists as long as the holder is on the field.
 *
 * NB: this primitive registers itself for opt-in lookup via the
 * holder.getAbility().attrs scan in field-aura-hook.ts (added to
 * pokemon.ts:getStat). Allies who want the boost have to be on the
 * holder's side; the scan walks the active field for any aura holder.
 */
export class PersistentFieldAuraAbAttr extends AbAttr {
  public readonly stats: readonly EffectiveStat[];
  public readonly multiplier: number;
  public readonly predicate: (ally: Pokemon, holder: Pokemon) => boolean;
  public readonly includeSelf: boolean;

  constructor(opts: PersistentFieldAuraOptions) {
    super(false);
    if (opts.stats.length === 0) {
      throw new Error("[PersistentFieldAuraAbAttr] stats must be non-empty");
    }
    this.stats = opts.stats;
    this.multiplier = opts.multiplier;
    this.predicate = opts.predicate ?? ((_a, _h) => true);
    this.includeSelf = opts.includeSelf ?? false;
  }

  /**
   * Engine-side: called from pokemon.ts:getStat to apply the aura to
   * `subject`'s stat lookup. Iterates the on-field battlers, looking for
   * any holder of this attr; if the predicate matches for (subject as
   * ally, holder), multiplies the value.
   */
  public static applyAuras(subject: Pokemon, stat: EffectiveStat, value: NumberHolder): void {
    const field = globalScene.getField().filter(p => p && !p.isFainted());
    for (const holder of field) {
      const allAttrs = [
        ...holder.getAbility().attrs,
        ...holder.getPassiveAbilities().flatMap(pa => pa?.attrs ?? []),
      ];
      for (const attr of allAttrs) {
        if (!attr || attr.constructor.name !== "PersistentFieldAuraAbAttr") {
          continue;
        }
        const aura = attr as PersistentFieldAuraAbAttr;
        if (!aura.stats.includes(stat)) {
          continue;
        }
        // Same side?
        if (subject.isPlayer() !== holder.isPlayer()) {
          continue;
        }
        // Self-exclusion unless includeSelf.
        if (subject === holder && !aura.includeSelf) {
          continue;
        }
        if (!aura.predicate(subject, holder)) {
          continue;
        }
        value.value *= aura.multiplier;
      }
    }
  }
}
