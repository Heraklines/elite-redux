/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Greater Ability Randomizer picker (Master-Ball tier - a pink reskin of the
// Ability Randomizer). Unshifted from ErGreaterAbilityRandomizerModifier.apply().
// It is Curiosity's REWARD half, simplified:
//   1. pick ANY of the mon's ability/innate slots (the PartyUiMode.ABILITY_MODIFIER
//      picker the Ability Randomizer + Curiosity use).
//   2. roll 4 RANDOM distinct abilities (excluding what the mon's slots already
//      hold) and show them WITH descriptions in the Bargain-styled picker.
//   3. the chosen ability REPLACES the picked slot (a run-state customPokemonData
//      override via setAbilityOverrideForSlot - persists for the run, NOT a permanent
//      dex unlock).
// There is NO lock cost.
//
// Back-out safe (#25): the reward screen queues a continuation copy
// (SelectModifierPhase.applyModifier); this phase removes it (tryRemovePhase) only
// once the replacement is committed - cancelling the slot pick OR the ability picker
// re-offers the item un-consumed. All sub-menus restore the base UI mode BEFORE
// resolving (the #550 softlock avoidance).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { BargainAbilityChoice } from "#data/elite-redux/er-bargain-sins";
import {
  greaterRandomizerReplaceSlot,
  rollGreaterRandomizerAbilities,
} from "#data/elite-redux/er-greater-ability-randomizer";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

const ns = "modifierType";

export class ErGreaterAbilityRandomizerPhase extends Phase {
  public readonly phaseName = "ErGreaterAbilityRandomizerPhase";

  /** Index into the player party of the mon the item was used on. */
  private readonly partyIndex: number;
  /** The UI mode active when this phase started; sub-menus restore to it. */
  private baseMode: UiMode = UiMode.MESSAGE;

  constructor(partyIndex: number) {
    super();
    this.partyIndex = partyIndex;
  }

  start(): void {
    super.start();
    this.baseMode = globalScene.ui.getMode();
    const mon = globalScene.getPlayerParty()[this.partyIndex];
    if (mon == null) {
      // Target vanished - leave the continuation copy so the player returns to the shop.
      this.end();
      return;
    }
    this.openSlotPicker(mon);
  }

  /**
   * Step 1: pick ANY of the mon's ability/innate slots. Cancelling (or picking a
   * different mon) backs out without consuming the item.
   */
  private openSlotPicker(mon: PlayerPokemon): void {
    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.ABILITY_MODIFIER,
      -1,
      (slotIndex: number, option: PartyOption) => {
        const party = globalScene.getPlayerParty();
        const picked = slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null;
        if (picked !== mon || option < PartyOption.ABILITY_SLOT_0) {
          // Backed out of the slot pick - nothing applied, capsule kept.
          globalScene.ui.setMode(this.baseMode).then(() => this.end());
          return;
        }
        const slot = option - PartyOption.ABILITY_SLOT_0;
        globalScene.ui.setMode(this.baseMode).then(() => this.openAbilityPicker(mon, slot));
      },
      (p: PlayerPokemon) => (p === mon ? null : i18next.t(`${ns}:erGreaterAbilityRandomizer.chooseSameMon`)),
    );
  }

  /**
   * Step 2: roll 4 random abilities and show the Bargain-styled picker. On a pick,
   * REPLACE the chosen slot and commit. Cancelling returns to the slot picker (still
   * un-consumed).
   */
  private openAbilityPicker(mon: PlayerPokemon, slot: number): void {
    const choices = rollGreaterRandomizerAbilities(mon);
    if (choices.length === 0) {
      // No rollable ability (should never happen with the full pool) - back out.
      this.openSlotPicker(mon);
      return;
    }

    globalScene.ui.setMode(UiMode.ER_BARGAIN, {
      picker: true,
      title: i18next.t(`${ns}:erGreaterAbilityRandomizer.name`).toUpperCase(),
      greeting: i18next.t(`${ns}:erGreaterAbilityRandomizer.pickAbility`),
      options: choices.map(c => ({ label: c.name, description: c.description })),
      onPick: (index: number) => {
        const chosen: BargainAbilityChoice | undefined = choices[index];
        if (!chosen) {
          this.restore(() => this.openSlotPicker(mon));
          return;
        }
        this.restore(() => {
          greaterRandomizerReplaceSlot(mon, slot, chosen.abilityId);
          this.commitAndEnd();
        });
      },
      onCancel: () => this.restore(() => this.openSlotPicker(mon)),
    });
  }

  /**
   * Remove the reward-screen continuation copy so the item is consumed (a
   * replacement was committed), then end this phase.
   */
  private commitAndEnd(): void {
    globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    this.end();
  }

  /**
   * Tear the current screen back down to the base mode BEFORE running the next step
   * (the #550 softlock avoidance: a non-awaited restore races the next setMode).
   */
  private restore(next: () => void): void {
    globalScene.ui.setMode(this.baseMode).then(() => next());
  }
}
