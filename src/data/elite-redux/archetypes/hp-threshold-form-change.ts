/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `hp-threshold-form-change` archetype.
//
// Subclasses pokerogue's PostDefendAbAttr. When the holder's HP drops below
// a configured threshold AFTER taking damage, enqueues a form change to a
// target form key. Optionally cures the holder's status as part of the
// transformation. Wires ER abilities like:
//
//   - Ape Shift (734)        — "Transforms below 50% HP, curing status and
//                              always critting." → form key "transformed"
//   - Locust Swarm (884)     — "Changes into Hivemind form until 1/4 HP or
//                              less." → form key "hivemind"
//   - Revelation (885)       — same shape as Locust Swarm
//
// Implementation note: triggers via pokerogue's existing pokemonFormChanges
// pipeline rather than mutating the species directly. The form must already
// be present on the species (typically injected via init-elite-redux-species
// form-injection). Uses `globalScene.triggerPokemonFormChange` to fire the
// change phase, matching how Zen Mode / Bibarel-style triggers work.
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

/** Construction options for {@linkcode HpThresholdFormChangeAbAttr}. */
export interface HpThresholdFormChangeOptions {
  /**
   * HP fraction (0..1) below which the form change fires. E.g. 0.5 = below
   * 50% HP, 0.25 = below 25% HP.
   */
  readonly hpThreshold: number;
  /**
   * Form key to switch to (must exist on the holder's species). Common
   * values: "transformed", "hivemind", "revelation", "berserk".
   */
  readonly targetFormKey: string;
  /**
   * Whether to clear the holder's status on transformation (matches Ape Shift's
   * "curing status" rider).
   * @defaultValue `false`
   */
  readonly cureStatus?: boolean;
  /**
   * Direction of the HP gate:
   *  - `false` (default): the target form is the LOW-HP form — transform when HP
   *    is AT/BELOW the threshold, revert when it recovers above (Ape Shift).
   *  - `true`: the target form is the HIGH-HP form — be in it while ABOVE the
   *    threshold, revert AT/BELOW it (Wishiwashi-style School; Locust Swarm /
   *    Hivemind: "Hivemind form UNTIL 1/4 HP or less").
   * @defaultValue `false`
   */
  readonly formAboveThreshold?: boolean;
}

/**
 * Parameterized AbAttr implementing the `hp-threshold-form-change` archetype.
 *
 * Bidirectional and re-checkable every time the holder is hit:
 *
 *   - HP at/below the threshold AND not yet in the target form -> transform
 *     into `targetFormKey` (the original "below X% HP -> transform" behavior).
 *   - HP above the threshold AND currently in the target form -> revert toward
 *     the base form (the previously-MISSING recovery path — e.g. Locust Swarm
 *     stayed in Hivemind form even after healing back above 25%).
 *
 * Both edges fire through pokerogue's `triggerPokemonFormChange` pipeline, which
 * REQUIRES (a) the target form to exist on the holder's species and (b) matching
 * `pokemonFormChanges` entries for the `<base> -> targetFormKey` (transform) and
 * `targetFormKey -> ""` (revert) edges. ER models several of these forms as
 * separate dump species (e.g. SPECIES_WISPYWASPY_HIVEMIND, mirroring
 * SPECIES_UNOWN_REVELATION) that are NOT automatically forms on the base
 * species. Without a Revelation-style init wiring (form injection + form-change
 * registration; see `init-elite-redux-unown-school.ts`) the form key is absent
 * and the change is a no-op — now logged once via a console.warn so the missing
 * wiring is VISIBLE rather than silently swallowed.
 */
export class HpThresholdFormChangeAbAttr extends PostDefendAbAttr {
  private readonly hpThreshold: number;
  private readonly targetFormKey: string;
  private readonly cureStatus: boolean;
  private readonly formAboveThreshold: boolean;
  /** Guards the missing-form warning so it logs at most once per attr instance. */
  private warnedMissingForm = false;

  constructor(options: HpThresholdFormChangeOptions) {
    // showAbility = true (default): the HP-threshold form change is a discrete,
    // player-visible activation, so the ability banner must flash — matching
    // vanilla convention for form-change abilities (same popup-display defect
    // class as the counter-attack archetype).
    super();
    if (!(options.hpThreshold > 0 && options.hpThreshold <= 1)) {
      throw new Error(`[HpThresholdFormChangeAbAttr] hpThreshold must be in (0, 1]; got ${options.hpThreshold}`);
    }
    if (!options.targetFormKey) {
      throw new Error("[HpThresholdFormChangeAbAttr] targetFormKey must be non-empty");
    }
    this.hpThreshold = options.hpThreshold;
    this.targetFormKey = options.targetFormKey;
    this.cureStatus = options.cureStatus ?? false;
    this.formAboveThreshold = options.formAboveThreshold ?? false;
  }

  /** Whether the holder is currently in the target (transformed) form. */
  private isInTargetForm(pokemon: { species: { forms: { formKey: string }[] }; formIndex: number }): boolean {
    return pokemon.species.forms[pokemon.formIndex]?.formKey === this.targetFormKey;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon } = params;
    if (pokemon.isFainted()) {
      return false;
    }
    const belowThreshold = pokemon.hp / pokemon.getMaxHp() <= this.hpThreshold;
    const inTargetForm = this.isInTargetForm(pokemon);
    // Whether the holder SHOULD currently be in the target form given its HP:
    //  - default (low-HP form, Ape Shift): target form active at/below threshold.
    //  - formAboveThreshold (high-HP form, Locust Swarm/Hivemind): target form
    //    active ABOVE the threshold ("Hivemind UNTIL 1/4 HP or less").
    const shouldBeInTargetForm = this.formAboveThreshold ? !belowThreshold : belowThreshold;
    // Transform edge: should be in target but isn't. Revert edge: shouldn't but is.
    return shouldBeInTargetForm ? !inTargetForm : inTargetForm;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    // The target form must exist on this species for either edge to resolve.
    const targetIdx = pokemon.species.forms.findIndex(f => f.formKey === this.targetFormKey);
    if (targetIdx < 0) {
      // Form not injected — flag the missing wiring (once) instead of silently
      // doing nothing, then bail so the ability doesn't crash.
      if (!this.warnedMissingForm) {
        console.warn(
          `[HpThresholdFormChangeAbAttr] species ${pokemon.species.speciesId} has no "${this.targetFormKey}" form; `
            + "form change is a no-op. Inject the form + register pokemonFormChanges edges "
            + "(see init-elite-redux-unown-school.ts for the Revelation precedent).",
        );
        this.warnedMissingForm = true;
      }
      return;
    }
    // The form-change phase is queued (runs next), so the holder is still in its
    // CURRENT form here — i.e. on a transform edge it is NOT yet in the target.
    const enteringTargetForm = !this.isInTargetForm(pokemon);
    // Trigger the form change via pokerogue's standard pipeline. The registered
    // `pokemonFormChanges` edges decide the direction (transform vs revert);
    // `triggerPokemonFormChange` returns false (no-op) if no edge matches.
    globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger);
    // Cure status only on the transform edge — entering the target form (matches
    // Ape Shift's rider; direction-agnostic so it's correct for both HP gates).
    if (enteringTargetForm && this.cureStatus && pokemon.status) {
      pokemon.resetStatus(false);
    }
  }
}
