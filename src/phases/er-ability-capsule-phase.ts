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
  adoptAbilityWatcherOutcome,
  type CoopAbilityOperationBinding,
  captureCoopAbilityOperationBinding,
} from "#data/elite-redux/coop/coop-ability-operation";
import {
  COOP_ABILITY_OP,
  COOP_ABILITY_WAIT_MS,
  coopAbilityOpName,
  coopAbilityPickerSeq,
  sendCoopAbilityPickerOutcome,
} from "#data/elite-redux/coop/coop-ability-picker-relay";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  advanceCoopInteractionForContinuation,
  getCoopController,
  getCoopInteractionRelay,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_ABILITY_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
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

  // ---- Co-op (#633 B9c): owner-drives / watcher-applies ----
  /** The shop's pinned interaction seq this picker belongs to (-1 = solo / not in co-op). */
  private readonly coopSeq: number;
  /** True only on the WATCHER's phase: it NEVER opens a picker - it applies the owner's outcome. */
  private readonly coopIsWatcher: boolean;
  /** Stable owner-runtime selectors carried across every picker callback / watcher await. */
  private readonly coopOperationBinding: CoopAbilityOperationBinding | null;
  /** OWNER-side outcome buffer, relayed exactly once at end. Default = CANCEL so EVERY non-commit
   *  end-path (cancels, guards, mon-vanished) still relays an outcome and the watcher never stalls. */
  private coopOutcome: number[] = [COOP_ABILITY_OP.CANCEL];

  constructor(partyIndex: number, coopSeq = -1, coopIsWatcher = false) {
    super();
    this.partyIndex = partyIndex;
    this.coopSeq = coopSeq;
    this.coopIsWatcher = coopIsWatcher;
    this.coopOperationBinding = coopSeq >= 0 ? captureCoopAbilityOperationBinding() : null;
  }

  start(): void {
    super.start();
    this.baseMode = globalScene.ui.getMode();
    const mon = globalScene.getPlayerParty()[this.partyIndex];
    if (mon == null) {
      // The target vanished (should not happen mid-shop); leave the continuation
      // copy in place so the player is returned to the reward screen. Co-op (#633 B9c):
      // the OWNER still relays a CANCEL so a parked watcher never stalls.
      this.cancelAndEnd();
      return;
    }
    // Co-op (#633 B9c) WATCHER: never open the picker - await + apply the owner's literal outcome.
    if (this.coopIsWatcher) {
      coopLog(
        "ability",
        `capsule WATCHER-APPLIES-RELAYED seq=${this.coopSeq} slot=${this.partyIndex} mon=${mon.name} (no local picker)`,
      );
      void this.coopApplyRelayedOutcome(mon);
      return;
    }
    if (this.coopSeq >= 0) {
      coopLog("ability", `capsule OWNER-DRIVES-PICKER seq=${this.coopSeq} slot=${this.partyIndex} mon=${mon.name}`);
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
      // Co-op (#633 B9c): route through cancelAndEnd so the watcher gets a CANCEL outcome.
      this.cancelAndEnd();
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
        // Co-op (#633 B9c): relay a CANCEL so a parked watcher re-offers in parity.
        this.restore(() => this.cancelAndEnd());
        return true;
      },
    });

    globalScene.ui.setMode(UiMode.OPTION_SELECT, { options });
  }

  /** Option (A): cycle the active ability, commit (consume the capsule), end. */
  private doCycle(mon: PlayerPokemon): void {
    ErAbilityCapsuleModifier.cycleActiveAbility(mon);
    // Co-op (#633 B9c): record the committed outcome; commitAndEnd relays it (owner only).
    this.coopOutcome = [COOP_ABILITY_OP.CAP_CYCLE];
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
          // Co-op (#633 B9c): relay the resolved slot so the watcher run-unlocks the SAME slot.
          this.coopOutcome = [COOP_ABILITY_OP.CAP_RUNUNLOCK, slot];
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
    // Co-op (#633 B9c): OWNER relays the committed outcome (set by the caller) before consuming
    // the copy, so the watcher applies the SAME pick. No-op off the owner / outside co-op.
    if (!this.coopIsWatcher) {
      this.relayEnd();
    }
    globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    // Co-op (#789, found by the duo exploration probe): a committed capsule ENDS the whole
    // alternating interaction, but the shop deliberately skipped its advance (queuesContinuation)
    // and nothing here advanced either - so the rotation stalled on the same owner every wave.
    // BOTH sides run this same commit (owner drives, watcher applies the relayed outcome), so
    // each advances its own counter locally and they stay lockstep. Cancel paths do NOT advance
    // (the shop re-offers and its own LEAVE advances later).
    advanceCoopInteractionForContinuation(this.coopSeq);
    this.end();
  }

  /**
   * Co-op (#633 B9c): every NON-committing owner end-path (cancel, the neither-option guard, the
   * mon-vanished guard) routes here so the watcher always receives an outcome (CANCEL) and never
   * stalls. Leaves the continuation copy in place, so the capsule is re-offered (back-out safe #25).
   */
  private cancelAndEnd(): void {
    this.coopOutcome = [COOP_ABILITY_OP.CANCEL];
    if (!this.coopIsWatcher) {
      this.relayEnd();
    }
    this.end();
  }

  /** OWNER (#633 B9c): relay the buffered outcome on a DEDICATED derived seq (coopAbilityPickerSeq) the
   *  shop watch loop never awaits - exactly once. No-op in solo (coopSeq < 0) / off the owner. */
  private relayEnd(): void {
    if (this.coopSeq < 0) {
      return;
    }
    coopLog(
      "ability",
      `capsule OWNER relay OUTCOME seq=${this.coopSeq} op=${coopAbilityOpName(this.coopOutcome[0])} data=[${this.coopOutcome.join(",")}]`,
    );
    const controller = getCoopController();
    sendCoopAbilityPickerOutcome(
      getCoopInteractionRelay(),
      this.coopSeq,
      this.coopOutcome,
      controller == null
        ? undefined
        : {
            localRole: controller.role,
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          },
      this.coopOperationBinding,
    );
  }

  /**
   * WATCHER (#633 B9c): await the owner's literal outcome and apply it - NEVER opening a picker.
   * On a committed pick, remove the continuation copy (capsule consumed); on CANCEL / timeout,
   * leave the copy so this client's continuation copy re-enters the shop watch in parity.
   */
  private async coopApplyRelayedOutcome(mon: PlayerPokemon): Promise<void> {
    const relay = getCoopInteractionRelay();
    if (this.coopSeq < 0 || relay == null) {
      this.end();
      return;
    }
    const action = await relay.awaitInteractionChoice(
      coopAbilityPickerSeq(this.coopSeq),
      COOP_ABILITY_WAIT_MS,
      COOP_ABILITY_CHOICE_KINDS,
    );
    const controller = getCoopController();
    const relayedData = action?.data ?? null;
    const adopted =
      controller != null
      && adoptAbilityWatcherOutcome(
        {
          pinned: this.coopSeq,
          data: relayedData,
          localRole: controller.role,
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopOperationBinding,
      );
    const data = adopted && relayedData != null ? relayedData : [COOP_ABILITY_OP.CANCEL];
    const op = data[0];
    coopLog(
      "ability",
      `capsule WATCHER apply OUTCOME seq=${this.coopSeq} op=${coopAbilityOpName(op)} data=[${data.join(",")}] timedOut=${action == null} mon=${mon.name}`,
    );
    if (op !== COOP_ABILITY_OP.CANCEL) {
      if (op === COOP_ABILITY_OP.CAP_CYCLE) {
        ErAbilityCapsuleModifier.cycleActiveAbility(mon);
      } else if (op === COOP_ABILITY_OP.CAP_RUNUNLOCK) {
        erRunUnlockAbilitySlot(mon, data[1]);
      }
      // Committed -> consume this client's continuation copy, matching the owner.
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
      // #789: the watcher's committed capsule ALSO ends the whole alternating interaction -
      // advance locally exactly like the owner's commitAndEnd (from-pinned, so the owner's
      // broadcast merging first makes this a no-op; both engines stay lockstep either way).
      advanceCoopInteractionForContinuation(this.coopSeq);
    }
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
