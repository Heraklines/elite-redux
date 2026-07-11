/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `-ate`-conditional archetype helper.
//
// Models the ER "-ate + conditional" cluster whose ROM text is:
//
//   "Changes the user's Normal-type moves to <T>. If the user IS <T>-type, its
//    <T>-type moves get a 10% chance to <status>; otherwise it gains <T> STAB."
//
// Three abilities share this exact shape (only <T>/<status> differ):
//   - Intoxicate (er 325): Normal → POISON; if Poison-type, 10% badly poison
//     (TOXIC), else Poison STAB.
//   - Emanate    (er 459): Normal → PSYCHIC; if Psychic-type, 10% confusion
//     (CONFUSED tag), else Psychic STAB.
//   - Immolate   (er 279): Normal → FIRE; if Fire-type, 10% burn (BURN), else
//     Fire STAB. (Immolate is also the second half of Solar Flare / er 366.)
//   - Mineralize (er 404): Normal → ROCK; if Rock-type, 10% bleed (ER_BLEED tag),
//     else Rock STAB.
//
// A fourth member replaces the probabilistic on-type secondary with a
// DETERMINISTIC self-heal (the `{ kind: "heal" }` outcome, NO random roll):
//   - Fertilize  (er 507): Normal → GRASS; if Grass-type, its Grass moves heal
//     10% of the damage dealt, else Grass STAB.
//
// Composition (three primitives, all self-gating so they never overlap):
//   1. `TypeConversionAbAttr` — every Normal move becomes <T> (no flat power
//      boost; the old `type-conversion` classification wrongly added ×1.2).
//   2. `StabAddAbAttr({ targetType: T })` — grants <T> STAB, but SELF-GATES to
//      "holder does NOT already have <T> STAB" (`sourceTypes.includes(moveType)`
//      check). So it fires only in the "otherwise it gains <T> STAB" branch.
//   3. `AteConditionalStatusAbAttr` — the 10% secondary, gated to the OTHER
//      branch: only when the holder IS <T>-type AND the move's resolved type is
//      <T>. The two branches are therefore mutually exclusive by construction.
// =============================================================================

import type { AbAttr } from "#abilities/ab-attrs";
import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { TypeConversionAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { PokemonType } from "#enums/pokemon-type";
import type { StatusEffect } from "#enums/status-effect";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

/**
 * The secondary the on-type branch inflicts. A `status`/`tag` is rolled at
 * `chance`% on the TARGET; a `heal` fires DETERMINISTICALLY (no roll) and heals
 * the HOLDER by a fraction of the damage dealt (the Fertilize / er 507 shape).
 */
export type AteSecondaryOutcome =
  | { readonly kind: "status"; readonly effect: StatusEffect }
  | { readonly kind: "tag"; readonly tag: BattlerTagType }
  | { readonly kind: "heal"; readonly fraction: number };

/** Construction options for the `-ate`-conditional helper. */
export interface AteConditionalOptions {
  /** The target type <T> that Normal moves are converted to, and that gates STAB / the secondary. */
  readonly newType: PokemonType;
  /** The secondary outcome (TOXIC / BURN status, or CONFUSED tag) rolled at `chance`% when the holder IS <T>-type. */
  readonly outcome: AteSecondaryOutcome;
  /**
   * Roll chance for the secondary (0-100). Defaults to `10` — every ER member
   * of this cluster uses 10%.
   * @defaultValue `10`
   */
  readonly chance?: number;
}

/**
 * The 10% type-gated secondary of the `-ate`-conditional cluster. Fires on the
 * holder's own damaging attack, but ONLY when the holder is of the target type
 * AND the move's RESOLVED type (post-conversion) equals the target type — i.e.
 * the "If the user IS <T>-type, its <T>-type moves have a 10% chance to
 * <status>" branch. When the holder is NOT <T>-type this never fires and the
 * paired {@linkcode StabAddAbAttr} grants STAB instead.
 */
export class AteConditionalStatusAbAttr extends PostAttackAbAttr {
  private readonly newType: PokemonType;
  private readonly outcome: AteSecondaryOutcome;
  private readonly chance: number;

  constructor(opts: AteConditionalOptions) {
    // Default attackCondition (damaging moves only) is exactly what we want —
    // a status move can't inflict this secondary.
    super();
    if (opts.newType === PokemonType.UNKNOWN) {
      throw new Error("[AteConditionalStatusAbAttr] newType cannot be PokemonType.UNKNOWN");
    }
    const chance = opts.chance ?? 10;
    if (!(chance >= 0 && chance <= 100)) {
      throw new Error(`[AteConditionalStatusAbAttr] chance must be in [0, 100]; got ${chance}`);
    }
    if (opts.outcome.kind === "heal" && !(opts.outcome.fraction > 0 && opts.outcome.fraction <= 1)) {
      throw new Error(`[AteConditionalStatusAbAttr] heal fraction must be in (0, 1]; got ${opts.outcome.fraction}`);
    }
    this.newType = opts.newType;
    this.outcome = opts.outcome;
    this.chance = chance;
  }

  /** The configured secondary chance (0-100). */
  public getChance(): number {
    return this.chance;
  }

  /** The configured target type <T>. */
  public getNewType(): PokemonType {
    return this.newType;
  }

  /** The configured secondary outcome (status or tag). */
  public getOutcome(): AteSecondaryOutcome {
    return this.outcome;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    const { pokemon, opponent: target, move, hitResult } = params;
    if (pokemon === target) {
      return false;
    }
    // Only a genuinely-connecting damaging attack qualifies (mirrors the other
    // PostAttack procs — a no-effect / missed hit reports NO_EFFECT or worse).
    if (hitResult >= HitResult.NO_EFFECT) {
      return false;
    }
    // Branch gate: holder IS <T>-type AND the move's resolved (post-conversion)
    // type is <T>. `getMoveType` runs the paired TypeConversionAbAttr, so a
    // converted Normal → <T> move counts, as do natively-<T> moves.
    if (!pokemon.isOfType(this.newType) || pokemon.getMoveType(move) !== this.newType) {
      return false;
    }
    // Heal branch (Fertilize / er 507): DETERMINISTIC self-heal off damage dealt
    // — no random roll, and it targets the HOLDER, so the target-facing gates
    // (IgnoreMoveEffects / canSetStatus / canAddTag) don't apply. Only require a
    // genuine damaging hit and that the holder can still benefit from healing.
    if (this.outcome.kind === "heal") {
      return params.damage > 0 && !pokemon.isFullHp();
    }
    if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")) {
      return false;
    }
    // 10% roll.
    if (this.chance !== 100 && pokemon.randBattleSeedInt(100) >= this.chance) {
      return false;
    }
    if (this.outcome.kind === "status") {
      return target.canSetStatus(this.outcome.effect, true, false, pokemon);
    }
    return target.canAddTag(this.outcome.tag);
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon, opponent: target } = params;
    if (this.outcome.kind === "heal") {
      const healAmount = toDmgValue(params.damage * this.outcome.fraction);
      if (healAmount <= 0) {
        return;
      }
      globalScene.phaseManager.unshiftNew(
        "PokemonHealPhase",
        pokemon.getBattlerIndex(),
        healAmount,
        i18next.t("abilityTriggers:postAttackHeal", {
          pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
          abilityName: pokemon.getAbility()?.name ?? "",
        }),
        true,
      );
      return;
    }
    if (this.outcome.kind === "status") {
      target.trySetStatus(this.outcome.effect, pokemon);
      return;
    }
    // CONFUSED is a CUSTOM-lapse tag — a 0-turn count expires it before it ever
    // takes effect, so roll the standard 2-5 turns (matching move-based
    // confusion). Other tags self-manage their duration.
    const turns = this.outcome.tag === BattlerTagType.CONFUSED ? pokemon.randBattleSeedIntRange(2, 5) : undefined;
    target.addTag(this.outcome.tag, turns, undefined, pokemon.id);
  }
}

/**
 * Build the three AbAttrs implementing one `-ate`-conditional ability. Wire the
 * result directly into the dispatcher for Intoxicate / Emanate / Immolate.
 */
export function ateConditionalAttrs(opts: AteConditionalOptions): AbAttr[] {
  return [
    new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, newType: opts.newType }),
    new StabAddAbAttr({ targetType: opts.newType }),
    new AteConditionalStatusAbAttr(opts),
  ];
}
