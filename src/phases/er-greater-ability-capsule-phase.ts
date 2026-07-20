/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Greater Ability Capsule picker - the rarer, stronger Ability Capsule (a
// violet reskin). Unshifted from ErGreaterAbilityCapsuleModifier.apply(). Offers a
// small option-select:
//   (A) "Permanently unlock an innate" -> an ability-slot pick restricted to the
//       mon's currently-LOCKED innate slots, then PERMANENTLY unlocks the chosen
//       slot (the real candy-style starterData.passiveAttr unlock - stays unlocked
//       in starter-select + future runs). See #data/elite-redux/er-greater-ability-capsule.
//   (B) "Run-unlock two innates" -> pick TWO of the mon's currently-LOCKED innate
//       slots (one at a time), then run-unlocks BOTH for THIS RUN ONLY (the normal
//       Ability Capsule's run-unlock, applied to two slots - never the permanent unlock).
//
// Mirrors ErAbilityCapsulePhase exactly: same OPTION_SELECT/party-UI flow, the same
// awaited-restore-before-resolve softlock avoidance (#550), and the same #25 back-out
// safety - the reward screen queues a continuation copy (SelectModifierPhase.applyModifier),
// removed here (tryRemovePhase) ONLY once a choice is committed, so backing out at any
// step leaves the capsule un-consumed and re-offered.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  adoptAbilityWatcherOutcome,
  type CoopAbilityOperationBinding,
  captureCoopAbilityOperationBinding,
  commitAbilityWatcherOutcome,
  commitCoopAbilityPresentation,
  isCoopAbilityPresentationAuthorityActive,
  settleCoopAbilityAuthorityResult,
  settleCoopAbilityOperation,
  settleCoopAbilityOwnerProposal,
} from "#data/elite-redux/coop/coop-ability-operation";
import {
  COOP_ABILITY_OP,
  COOP_ABILITY_WAIT_MS,
  coopAbilityOpName,
  coopAbilityPickerSeq,
  sendCoopAbilityPickerOutcome,
} from "#data/elite-redux/coop/coop-ability-picker-relay";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import type { CoopAbilityPresentationPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  advanceCoopInteractionForContinuation,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  isCoopV2InteractionHumanInputFrozen,
  notifyCoopV2InteractionSurfaceReady,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_ABILITY_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { erRunUnlockableInnateSlots } from "#data/elite-redux/er-ability-capsule";
import {
  GREATER_CAPSULE_RUN_UNLOCK_COUNT,
  greaterCapsuleCanPermanentlyUnlock,
  greaterCapsuleCanRunUnlockTwo,
  greaterCapsulePermanentlyUnlockableInnateSlots,
  greaterCapsulePermanentlyUnlockInnate,
  greaterCapsuleRunUnlockInnates,
} from "#data/elite-redux/er-greater-ability-capsule";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

const ns = "modifierType";

export class ErGreaterAbilityCapsulePhase extends Phase {
  public readonly phaseName = "ErGreaterAbilityCapsulePhase";
  /** Exact V2 presentation address owned by this phase generation. */
  public coopV2ControlOperationId: string | null = null;

  /** Index into the player party of the mon the capsule was used on. */
  public readonly partyIndex: number;
  /** The UI mode active when this phase started; sub-menus restore to it. */
  private baseMode: UiMode = UiMode.MESSAGE;

  // ---- Co-op (#633 B9c): owner-drives / watcher-applies (see ErAbilityCapsulePhase) ----
  public readonly coopSeq: number;
  private readonly coopIsWatcher: boolean;
  /** Stable owner-runtime selectors carried across every picker callback / watcher await. */
  private readonly coopOperationBinding: CoopAbilityOperationBinding | null;
  /** Exact runtime that owns this phase; never re-read after a picker callback or await. */
  private readonly coopOwningRuntime = getCoopRuntime();
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
      // copy in place so the player is returned to the reward screen.
      this.cancelAndEnd();
      return;
    }
    const controller = this.coopSeq >= 0 ? getCoopController() : null;
    if (controller?.role === "host" && isCoopAbilityPresentationAuthorityActive(this.coopOperationBinding)) {
      const operationId = commitCoopAbilityPresentation(
        {
          pinned: this.coopSeq,
          partyIndex: this.partyIndex,
          workflow: "greater-capsule",
          localRole: "host",
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopOperationBinding,
      );
      if (operationId == null) {
        failCoopSharedSession(`Ability presentation ${this.coopSeq} could not enter durable authority`);
        return;
      }
      this.coopV2ControlOperationId = operationId;
    }
    // Co-op (#633 B9c) WATCHER: apply the owner's literal outcome, never opening a picker.
    if (this.coopIsWatcher) {
      coopLog(
        "ability",
        `greaterCapsule WATCHER-APPLIES-RELAYED seq=${this.coopSeq} slot=${this.partyIndex} mon=${mon.name} (no local picker)`,
      );
      notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
      void this.coopApplyRelayedOutcome(mon);
      return;
    }
    if (this.coopSeq >= 0) {
      coopLog(
        "ability",
        `greaterCapsule OWNER-DRIVES-PICKER seq=${this.coopSeq} slot=${this.partyIndex} mon=${mon.name}`,
      );
    }
    this.openChoice(mon);
  }

  /** Install the authority presentation before this phase can satisfy a V2 input lease. */
  public installCoopV2AbilityPresentation(operationId: string, presentation: CoopAbilityPresentationPayload): boolean {
    if (
      operationId.length === 0
      || presentation.workflow !== "greater-capsule"
      || presentation.pinned !== this.coopSeq
      || presentation.partyIndex !== this.partyIndex
      || presentation.rolledAbilityIds !== undefined
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopV2ControlOperationId = operationId;
    return true;
  }

  /** The top-level "Permanently unlock an innate" / "Run-unlock two innates" menu. */
  private openChoice(mon: PlayerPokemon): void {
    const canPermanent = greaterCapsuleCanPermanentlyUnlock(mon);
    const canRunTwo = greaterCapsuleCanRunUnlockTwo(mon);

    // The modifier-type select filter already requires at least one locked innate,
    // so the permanent option is always available here. Guard anyway.
    if (!canPermanent) {
      // Co-op (#633 B9c): relay a CANCEL so a parked watcher re-offers in parity.
      this.cancelAndEnd();
      return;
    }

    const options: OptionSelectItem[] = [];
    options.push({
      label: i18next.t(`${ns}:erGreaterAbilityCapsule.permanentUnlock`),
      handler: () => {
        this.restore(() => this.openPermanentPicker(mon));
        return true;
      },
    });
    if (canRunTwo) {
      options.push({
        label: i18next.t(`${ns}:erGreaterAbilityCapsule.runUnlockTwo`),
        handler: () => {
          this.restore(() => this.openRunUnlockPicker(mon, []));
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

    Promise.resolve(globalScene.ui.setMode(UiMode.OPTION_SELECT, { options })).then(() =>
      notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime),
    );
  }

  /**
   * Option (A): pick ONE currently-locked innate slot, then PERMANENTLY unlock it.
   * An invalid pick (the active ability or an already-unlocked innate) shows a short
   * message and reopens the picker. Cancelling returns to the top-level choice.
   */
  private openPermanentPicker(mon: PlayerPokemon): void {
    const unlockable = greaterCapsulePermanentlyUnlockableInnateSlots(mon);
    if (unlockable.length === 0) {
      this.openChoice(mon);
      return;
    }
    const unlockableSlots = new Set(unlockable.map(u => u.slot));

    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.ABILITY_MODIFIER,
      -1,
      (slotIndex: number, option: PartyOption) => {
        const party = globalScene.getPlayerParty();
        const picked = slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null;
        if (picked !== mon || option < PartyOption.ABILITY_SLOT_0) {
          globalScene.ui.setMode(this.baseMode).then(() => this.openChoice(mon));
          return;
        }
        const slot = option - PartyOption.ABILITY_SLOT_0;
        if (!unlockableSlots.has(slot)) {
          globalScene.ui.setMode(this.baseMode).then(() => {
            globalScene.ui.showText(
              i18next.t(`${ns}:erGreaterAbilityCapsule.notLockedInnate`),
              null,
              () => this.openPermanentPicker(mon),
              null,
              true,
            );
          });
          return;
        }
        // Commit the PERMANENT unlock and consume the capsule.
        globalScene.ui.setMode(this.baseMode).then(() => {
          greaterCapsulePermanentlyUnlockInnate(mon, slot);
          // Co-op (#633 B9c): relay the resolved slot so the watcher permanently unlocks the SAME one.
          this.coopOutcome = [COOP_ABILITY_OP.GCAP_PERM, slot];
          this.commitAndEnd();
        });
      },
      (p: PlayerPokemon) => (p === mon ? null : i18next.t(`${ns}:erGreaterAbilityCapsule.chooseSameMon`)),
    );
  }

  /**
   * Option (B): pick TWO currently-locked innate slots (one per picker open), then
   * run-unlock BOTH for the run. `picked` accumulates the slots chosen so far; once
   * {@linkcode GREATER_CAPSULE_RUN_UNLOCK_COUNT} are chosen we commit. Re-derives the
   * still-locked set each open (so an already-picked slot is never offered twice).
   * Cancelling at any point returns to the top-level choice (nothing applied yet).
   */
  private openRunUnlockPicker(mon: PlayerPokemon, picked: number[]): void {
    // Only slots that are still LOCKED and not already chosen this session are valid.
    const remaining = erRunUnlockableInnateSlots(mon).filter(u => !picked.includes(u.slot));
    if (remaining.length === 0) {
      // Nothing left to pick; if we have not yet gathered enough, fall back to the
      // choice rather than committing a partial unlock.
      this.openChoice(mon);
      return;
    }
    const remainingSlots = new Set(remaining.map(u => u.slot));

    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.ABILITY_MODIFIER,
      -1,
      (slotIndex: number, option: PartyOption) => {
        const party = globalScene.getPlayerParty();
        const target = slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null;
        if (target !== mon || option < PartyOption.ABILITY_SLOT_0) {
          globalScene.ui.setMode(this.baseMode).then(() => this.openChoice(mon));
          return;
        }
        const slot = option - PartyOption.ABILITY_SLOT_0;
        if (!remainingSlots.has(slot)) {
          globalScene.ui.setMode(this.baseMode).then(() => {
            globalScene.ui.showText(
              i18next.t(`${ns}:erGreaterAbilityCapsule.notLockedInnate`),
              null,
              () => this.openRunUnlockPicker(mon, picked),
              null,
              true,
            );
          });
          return;
        }
        const next = [...picked, slot];
        if (next.length < GREATER_CAPSULE_RUN_UNLOCK_COUNT) {
          // Need a second slot - reopen the picker for the next pick.
          globalScene.ui.setMode(this.baseMode).then(() => this.openRunUnlockPicker(mon, next));
          return;
        }
        // Commit both run-unlocks and consume the capsule.
        globalScene.ui.setMode(this.baseMode).then(() => {
          greaterCapsuleRunUnlockInnates(mon, next);
          // Co-op (#633 B9c): relay BOTH resolved slots so the watcher run-unlocks the SAME pair.
          this.coopOutcome = [COOP_ABILITY_OP.GCAP_RUN2, next[0], next[1]];
          this.commitAndEnd();
        });
      },
      (p: PlayerPokemon) => (p === mon ? null : i18next.t(`${ns}:erGreaterAbilityCapsule.chooseSameMon`)),
    );
  }

  /**
   * Remove the reward-screen continuation copy so the capsule is consumed (the
   * choice was committed), then end this phase.
   */
  private commitAndEnd(): void {
    const relayOutcome = !this.coopIsWatcher;
    globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    // #789 (same hole as the regular capsule, probe-verified there): a committed capsule ends
    // the whole alternating interaction, but nothing advanced the counter - rotation stalled.
    advanceCoopInteractionForContinuation(this.coopSeq);
    this.end();
    if (relayOutcome) {
      this.relayEnd();
    }
  }

  /** Co-op (#633 B9c): every NON-committing owner end-path relays a CANCEL so the watcher never
   *  stalls; leaves the continuation copy so the capsule is re-offered (back-out safe #25). */
  private cancelAndEnd(): void {
    this.coopOutcome = [COOP_ABILITY_OP.CANCEL];
    const relayOutcome = !this.coopIsWatcher;
    this.end();
    if (relayOutcome) {
      this.relayEnd();
    }
  }

  /** OWNER (#633 B9c): relay the buffered outcome on the shop seq exactly once. No-op in solo. */
  private relayEnd(): void {
    if (this.coopSeq < 0) {
      return;
    }
    coopLog(
      "ability",
      `greaterCapsule OWNER relay OUTCOME seq=${this.coopSeq} op=${coopAbilityOpName(this.coopOutcome[0])} data=[${this.coopOutcome.join(",")}]`,
    );
    const controller = getCoopController();
    const operationId =
      controller?.role === "host"
        ? settleCoopAbilityAuthorityResult(this.coopSeq, this.coopOperationBinding)
        : controller?.role === "guest"
          ? settleCoopAbilityOwnerProposal(this.coopSeq, this.coopOperationBinding)
          : null;
    if (operationId != null) {
      settleCoopV2InteractionOperation(operationId, this.coopOwningRuntime);
    }
    if (
      !sendCoopAbilityPickerOutcome(
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
      )
    ) {
      failCoopSharedSession(`Ability result ${this.coopSeq} could not enter durable authority`);
    }
  }

  /** WATCHER (#633 B9c): await + apply the owner's literal outcome; never opens a picker. */
  private async coopApplyRelayedOutcome(mon: PlayerPokemon): Promise<void> {
    isCoopV2InteractionHumanInputFrozen();
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
    const adoption =
      controller == null
        ? null
        : adoptAbilityWatcherOutcome(
            {
              pinned: this.coopSeq,
              data: relayedData,
              localRole: controller.role,
              wave: globalScene.currentBattle?.waveIndex ?? 0,
              turn: globalScene.currentBattle?.turn ?? 0,
            },
            this.coopOperationBinding,
          );
    const data = adoption?.accepted === true && relayedData != null ? relayedData : [COOP_ABILITY_OP.CANCEL];
    const op = data[0];
    coopLog(
      "ability",
      `greaterCapsule WATCHER apply OUTCOME seq=${this.coopSeq} op=${coopAbilityOpName(op)} data=[${data.join(",")}] timedOut=${action == null} mon=${mon.name}`,
    );
    if (op !== COOP_ABILITY_OP.CANCEL) {
      if (adoption?.projectionApplied === true) {
        // Complete authority state already carries the permanent/run unlock result.
      } else if (op === COOP_ABILITY_OP.GCAP_PERM) {
        greaterCapsulePermanentlyUnlockInnate(mon, data[1]);
      } else if (op === COOP_ABILITY_OP.GCAP_RUN2) {
        greaterCapsuleRunUnlockInnates(mon, [data[1], data[2]]);
      }
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
      // #789: the watcher's committed capsule advances too (from-pinned; lockstep with the owner).
      advanceCoopInteractionForContinuation(this.coopSeq);
    }
    this.end();
    if (adoption?.accepted === true) {
      settleCoopAbilityOperation(adoption.operationId, this.coopOperationBinding);
      settleCoopV2InteractionOperation(adoption.operationId);
    }
    if (
      adoption?.accepted === true
      && adoption.requiresAuthorityCommit
      && !commitAbilityWatcherOutcome(
        adoption.operationId,
        {
          pinned: this.coopSeq,
          data,
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopOperationBinding,
      )
    ) {
      failCoopSharedSession(`Ability result ${adoption.operationId} could not retain complete authority state`);
    }
  }

  /**
   * Tear the current OPTION_SELECT back down to the base mode BEFORE running the
   * next step (the #550 softlock avoidance).
   */
  private restore(next: () => void): void {
    globalScene.ui.setMode(this.baseMode).then(() => next());
  }
}
