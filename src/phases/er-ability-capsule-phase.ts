/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Ability Capsule picker (maintainer request: "ability capsule should also be
// able to unlock an innate for the run if you want").
//
// Unshifted from ErAbilityCapsuleModifier.apply() when the capsule is used. Offers
// a small option-select:
//   (A) "Change ability"  -> the existing active-ability cycle (unchanged).
//   (B) "Unlock an innate for the run" -> a party-UI ability-slot pick (the same
//       PartyUiMode.ABILITY_MODIFIER picker the Ability Randomizer + Curiosity use),
//       restricted to the mon's currently-LOCKED innate slots, then run-unlocks the
//       chosen slot for THIS RUN ONLY (erRunUnlockedAbilitySlots - never the
//       permanent candy unlock). See #data/elite-redux/er-ability-capsule.
//
// Back-out safe (#25): the reward screen queues a continuation copy of itself for
// the capsule (SelectModifierPhase.applyModifier). This phase removes that copy
// (tryRemovePhase("SelectModifierPhase")) ONLY once a choice is committed; backing
// out at any step leaves the copy, so the capsule is re-offered and NOT consumed.
//
// All sub-menus restore the base UI mode BEFORE resolving (the bargain sub-menu
// softlock class, #550): a non-awaited restore lets the next setMode race the dead
// menu and freeze the flow. The base mode is whatever was active when this phase
// started (MESSAGE, after the reward screen tore down in applyModifier).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  erHasRunUnlockableInnate,
  erRunUnlockAbilitySlot,
  erRunUnlockableInnateSlots,
} from "#data/elite-redux/er-ability-capsule";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { ErAbilityCapsuleModifier } from "#modifiers/modifier";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

const ns = "modifierType";

export class ErAbilityCapsulePhase extends Phase {
  public readonly phaseName = "ErAbilityCapsulePhase";

  /** Index into the player party of the mon the capsule was used on. */
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
      // The target vanished (should not happen mid-shop); leave the continuation
      // copy in place so the player is returned to the reward screen.
      this.end();
      return;
    }
    this.openChoice(mon);
  }

  /** The top-level "Change ability" / "Unlock an innate for the run" menu. */
  private openChoice(mon: PlayerPokemon): void {
    const canCycle = ErAbilityCapsuleModifier.canCycleActiveAbility(mon);
    const canRunUnlock = erHasRunUnlockableInnate(mon);

    // Both filters are also enforced by the modifier-type select filter, so at
    // least one option is always present here. Guard anyway: if somehow neither
    // is available, just back out (capsule re-offered).
    if (!canCycle && !canRunUnlock) {
      this.end();
      return;
    }

    const options: OptionSelectItem[] = [];
    if (canCycle) {
      options.push({
        label: i18next.t(`${ns}:erAbilityCapsule.changeAbility`),
        handler: () => {
          this.restore(() => this.doCycle(mon));
          return true;
        },
      });
    }
    if (canRunUnlock) {
      options.push({
        label: i18next.t(`${ns}:erAbilityCapsule.unlockInnate`),
        handler: () => {
          this.restore(() => this.openInnatePicker(mon));
          return true;
        },
      });
    }
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        // Leave the continuation copy -> back to the reward screen, capsule kept.
        this.restore(() => this.end());
        return true;
      },
    });

    globalScene.ui.setMode(UiMode.OPTION_SELECT, { options });
  }

  /** Option (A): cycle the active ability, commit (consume the capsule), end. */
  private doCycle(mon: PlayerPokemon): void {
    ErAbilityCapsuleModifier.cycleActiveAbility(mon);
    this.commitAndEnd();
  }

  /**
   * Option (B): open the party ability-slot picker (PartyUiMode.ABILITY_MODIFIER,
   * the same one the Ability Randomizer + Curiosity use). Validate the picked slot
   * is one of this mon's currently run-unlockable LOCKED innate slots; on a valid
   * pick, run-unlock it and commit. An invalid pick (the active ability or an
   * already-active innate) shows a short message and reopens the picker. Cancelling
   * the picker returns to the top-level choice.
   */
  private openInnatePicker(mon: PlayerPokemon): void {
    const unlockable = erRunUnlockableInnateSlots(mon);
    if (unlockable.length === 0) {
      // Raced away (e.g. another effect unlocked them) - return to the choice.
      this.openChoice(mon);
      return;
    }
    const unlockableSlots = new Set(unlockable.map(u => u.slot));

    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.ABILITY_MODIFIER,
      -1,
      (slotIndex: number, option: PartyOption) => {
        // Only follow up on this mon's own slot picks; any other resolution
        // (cancel, a different slot) returns to the top-level choice.
        const party = globalScene.getPlayerParty();
        const picked = slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null;
        if (picked !== mon || option < PartyOption.ABILITY_SLOT_0) {
          globalScene.ui.setMode(this.baseMode).then(() => this.openChoice(mon));
          return;
        }
        const slot = option - PartyOption.ABILITY_SLOT_0;
        if (!unlockableSlots.has(slot)) {
          // The active ability or an already-unlocked innate - nothing to run-unlock.
          globalScene.ui.setMode(this.baseMode).then(() => {
            globalScene.ui.showText(
              i18next.t(`${ns}:erAbilityCapsule.notLockedInnate`),
              null,
              () => this.openInnatePicker(mon),
              null,
              true,
            );
          });
          return;
        }
        // Commit the run-unlock and consume the capsule.
        globalScene.ui.setMode(this.baseMode).then(() => {
          erRunUnlockAbilitySlot(mon, slot);
          this.commitAndEnd();
        });
      },
      (p: PlayerPokemon) => (p === mon ? null : i18next.t(`${ns}:erAbilityCapsule.chooseSameMon`)),
    );
  }

  /**
   * Remove the reward-screen continuation copy so the capsule is consumed (the
   * choice was committed), then end this phase. Mirrors the LearnMovePhase MEMORY
   * cleanup that drops the queued SelectModifierPhase on a successful learn.
   */
  private commitAndEnd(): void {
    globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    this.end();
  }

  /**
   * Tear the current OPTION_SELECT back down to the base mode BEFORE running the
   * next step. Without the awaited restore the next setMode races the dead menu and
   * softlocks the flow (the bargain sub-menu fix, #550).
   */
  private restore(next: () => void): void {
    globalScene.ui.setMode(this.baseMode).then(() => next());
  }
}
