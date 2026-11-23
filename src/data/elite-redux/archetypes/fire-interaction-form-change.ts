/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `fire-interaction-form-change` archetype.
//
// Models Flammable Coat (669, on Lumbering Sloth): "Transforms Lumbering Sloth
// into its Engulfed form when hit by Fire-type moves or when using Fire-type
// moves." Two sibling AbAttrs cover the two interaction surfaces:
//
//   - {@linkcode FireUseFormChangeAbAttr}  (PostAttack) — the holder USES a
//     Fire-type move.
//   - {@linkcode FireHitFormChangeAbAttr}  (PostDefend) — the holder is HIT by
//     a Fire-type move.
//
// Both fire the SAME one-way form change through pokerogue's standard pipeline
// (`triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger)`), which
// resolves against the registered `<base> -> engulfed` edge (a one-way "manual"
// edge injected by init-elite-redux-er-custom-form-changes.ts; there is NO
// revert edge, so once Engulfed the manual trigger has nothing to match and the
// change is a no-op). The Engulfed form is itself a separate ER dump species
// injected AS a form on the base — the exact Wispywaspy ⇄ Hivemind precedent.
// =============================================================================

import { PostAttackAbAttr, PostDefendAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

/** Whether the holder is currently in the given form. */
function isInForm(pokemon: Pokemon, formKey: string): boolean {
  return pokemon.species.forms[pokemon.formIndex]?.formKey === formKey;
}

/**
 * Fire the one-way manual form change, warning once (per attr instance) if the
 * target form was never injected onto the species (so the missing wiring is
 * VISIBLE rather than silently swallowed — mirrors HpThresholdFormChangeAbAttr).
 */
function tryTriggerEngulf(pokemon: Pokemon, targetFormKey: string, warnState: { warned: boolean }): void {
  if (!pokemon.species.forms.some(f => f.formKey === targetFormKey)) {
    if (!warnState.warned) {
      console.warn(
        `[FireInteractionFormChangeAbAttr] species ${pokemon.species.speciesId} has no "${targetFormKey}" form; `
          + "form change is a no-op. Inject the form + register the pokemonFormChanges edge "
          + "(see init-elite-redux-er-custom-form-changes.ts).",
      );
      warnState.warned = true;
    }
    return;
  }
  globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger);
}

/**
 * PostAttack surface: the holder USING a Fire-type move triggers the form change.
 */
export class FireUseFormChangeAbAttr extends PostAttackAbAttr {
  private readonly targetFormKey: string;
  private readonly warnState = { warned: false };

  constructor(targetFormKey: string) {
    // Fire on any USE of a qualifying move (incl. status Fire moves like
    // Will-O-Wisp): the dex says "when using Fire-type moves", not "damaging".
    // showAbility = true (2nd arg): the form change is a discrete, player-visible
    // activation, so the ability banner must flash (same popup-display defect
    // class as the counter-attack archetype).
    super((_user, _target, _move) => true, true);
    this.targetFormKey = targetFormKey;
  }

  /** Read-only accessor: the form the holder transforms into. */
  public getTargetFormKey(): string {
    return this.targetFormKey;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1): `guards`, then `gate`. The original order was fainted, in the form, last
   * strike, Fire type. The split evaluates fainted and last strike first, then in the form and Fire type; every one of
   * the four is a side-effect-free read, so the conjunction (and the absence of any draw) is unchanged.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Safety rules: a fainted holder never changes form, and the change waits for the last strike of a multi-hit move. */
  public guards({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    if (pokemon.isFainted()) {
      return false;
    }
    // Fire once per move use (not once per multi-hit strike).
    return !(pokemon.turnData.hitsLeft > 1);
  }

  /** The replaceable condition: I am not in the form yet AND the move I used is Fire type (after type-changing abilities). */
  public gate({ pokemon, move }: PostMoveInteractionAbAttrParams): boolean {
    if (isInForm(pokemon, this.targetFormKey)) {
      return false;
    }
    return pokemon.getMoveType(move) === PokemonType.FIRE;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    tryTriggerEngulf(params.pokemon, this.targetFormKey, this.warnState);
  }
}

/**
 * PostDefend surface: the holder being HIT by a Fire-type move triggers the form
 * change.
 */
export class FireHitFormChangeAbAttr extends PostDefendAbAttr {
  private readonly targetFormKey: string;
  private readonly warnState = { warned: false };

  constructor(targetFormKey: string) {
    // showAbility = true (default): the fire-interaction form change is a
    // discrete, player-visible activation, so the ability banner must flash —
    // matching vanilla convention for form-change abilities (same popup-display
    // defect class as the counter-attack archetype).
    super();
    this.targetFormKey = targetFormKey;
  }

  /** Read-only accessor: the form the holder transforms into. */
  public getTargetFormKey(): string {
    return this.targetFormKey;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): `guards` (not fainted), then `gate`, in the original clause order. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Safety rule: a fainted holder never changes form. Moved verbatim from `canApply`. */
  public guards({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return !pokemon.isFainted();
  }

  /** The replaceable condition: I am not in the form yet AND the attacker's move is Fire type (after its type-changing abilities). */
  public gate({ pokemon, opponent: attacker, move }: PostMoveInteractionAbAttrParams): boolean {
    if (isInForm(pokemon, this.targetFormKey)) {
      return false;
    }
    // The move's resolved type from the ATTACKER's perspective (honors the
    // attacker's type-changing abilities, e.g. Normalize/Pixilate).
    return attacker.getMoveType(move) === PokemonType.FIRE;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    tryTriggerEngulf(params.pokemon, this.targetFormKey, this.warnState);
  }
}
