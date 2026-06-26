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
import {
  COOP_ABILITY_KIND,
  COOP_ABILITY_OP,
  COOP_ABILITY_OUTCOME,
  COOP_ABILITY_WAIT_MS,
  coopAbilityPickerSeq,
} from "#data/elite-redux/coop/coop-ability-picker-relay";
import { getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
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

  // ---- Co-op (#633 B9c): owner-drives / watcher-applies (see ErAbilityCapsulePhase) ----
  private readonly coopSeq: number;
  private readonly coopIsWatcher: boolean;
  private coopOutcome: number[] = [COOP_ABILITY_OP.CANCEL];

  constructor(partyIndex: number, coopSeq = -1, coopIsWatcher = false) {
    super();
    this.partyIndex = partyIndex;
    this.coopSeq = coopSeq;
    this.coopIsWatcher = coopIsWatcher;
  }

  start(): void {
    super.start();
    this.baseMode = globalScene.ui.getMode();
    const mon = globalScene.getPlayerParty()[this.partyIndex];
    if (mon == null) {
      // Target vanished - leave the continuation copy so the player returns to the shop.
      this.cancelAndEnd();
      return;
    }
    // Co-op (#633 B9c) WATCHER: apply the owner's literal outcome - never opening a picker AND
    // never rolling RNG (the host rolled once; the watcher must not advance its seed cursor).
    if (this.coopIsWatcher) {
      void this.coopApplyRelayedOutcome(mon);
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
          // Co-op (#633 B9c): relay a CANCEL so a parked watcher re-offers in parity.
          globalScene.ui.setMode(this.baseMode).then(() => this.cancelAndEnd());
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
          // Co-op (#633 B9c): relay the slot + the host's LITERAL rolled abilityId so the watcher
          // applies the SAME ability WITHOUT re-rolling (mirrors the watcher-doesn't-reroll contract).
          this.coopOutcome = [COOP_ABILITY_OP.GRAND, slot, chosen.abilityId];
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
    // Co-op (#633 B9c): OWNER relays the committed outcome (slot + literal abilityId) before
    // consuming the copy, so the watcher replaces the SAME slot with the SAME ability.
    if (!this.coopIsWatcher) {
      this.relayEnd();
    }
    globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    this.end();
  }

  /** Co-op (#633 B9c): every NON-committing owner end-path relays a CANCEL so the watcher never
   *  stalls; leaves the continuation copy so the item is re-offered (back-out safe #25). */
  private cancelAndEnd(): void {
    this.coopOutcome = [COOP_ABILITY_OP.CANCEL];
    if (!this.coopIsWatcher) {
      this.relayEnd();
    }
    this.end();
  }

  /** OWNER (#633 B9c): relay the buffered outcome on the shop seq exactly once. No-op in solo. */
  private relayEnd(): void {
    if (this.coopSeq < 0) {
      return;
    }
    getCoopInteractionRelay()?.sendInteractionChoice(
      coopAbilityPickerSeq(this.coopSeq),
      COOP_ABILITY_KIND,
      COOP_ABILITY_OUTCOME,
      [...this.coopOutcome],
    );
  }

  /**
   * WATCHER (#633 B9c): await + apply the owner's literal outcome. CRITICAL: it applies the host's
   * relayed abilityId via greaterRandomizerReplaceSlot WITHOUT calling rollGreaterRandomizerAbilities,
   * so the watcher's RNG seed cursor never advances (the host rolled once; the seed reconciles at the
   * ME terminal / next stateSync - same contract as the reward-options watcher-doesn't-reroll path).
   */
  private async coopApplyRelayedOutcome(mon: PlayerPokemon): Promise<void> {
    const relay = getCoopInteractionRelay();
    if (this.coopSeq < 0 || relay == null) {
      this.end();
      return;
    }
    const action = await relay.awaitInteractionChoice(coopAbilityPickerSeq(this.coopSeq), COOP_ABILITY_WAIT_MS);
    const data = action?.data ?? [COOP_ABILITY_OP.CANCEL];
    const op = data[0];
    if (op === COOP_ABILITY_OP.GRAND) {
      greaterRandomizerReplaceSlot(mon, data[1], data[2]);
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    }
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
