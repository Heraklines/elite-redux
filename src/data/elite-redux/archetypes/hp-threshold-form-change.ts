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
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";

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
}

/**
 * Parameterized AbAttr implementing the `hp-threshold-form-change` archetype.
 *
 * Fires once per battle (tracked via `pokemon.summonData.transformedTurn`)
 * when the holder's post-damage HP drops below the configured threshold.
 */
export class HpThresholdFormChangeAbAttr extends PostDefendAbAttr {
  private readonly hpThreshold: number;
  private readonly targetFormKey: string;
  private readonly cureStatus: boolean;

  constructor(options: HpThresholdFormChangeOptions) {
    super(false);
    if (!(options.hpThreshold > 0 && options.hpThreshold <= 1)) {
      throw new Error(
        `[HpThresholdFormChangeAbAttr] hpThreshold must be in (0, 1]; got ${options.hpThreshold}`,
      );
    }
    if (!options.targetFormKey) {
      throw new Error("[HpThresholdFormChangeAbAttr] targetFormKey must be non-empty");
    }
    this.hpThreshold = options.hpThreshold;
    this.targetFormKey = options.targetFormKey;
    this.cureStatus = options.cureStatus ?? false;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon } = params;
    if (pokemon.isFainted()) {
      return false;
    }
    // Don't re-fire if already in the target form.
    const currentForm = pokemon.species.forms[pokemon.formIndex];
    if (currentForm?.formKey === this.targetFormKey) {
      return false;
    }
    // Only fire when HP is at or below the threshold.
    return pokemon.hp / pokemon.getMaxHp() <= this.hpThreshold;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    // Find the target form index by key.
    const targetIdx = pokemon.species.forms.findIndex(f => f.formKey === this.targetFormKey);
    if (targetIdx < 0) {
      // Form not present on this species — silent no-op so the ability
      // doesn't crash when injected onto a mon without the matching form.
      return;
    }
    // Trigger the form change via pokerogue's standard pipeline.
    globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger);
    // Cure status if configured.
    if (this.cureStatus && pokemon.status) {
      pokemon.resetStatus(false);
    }
  }
}
