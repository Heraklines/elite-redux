/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the between-rounds press-your-luck choice phase.
//
// A DEDICATED phase that owns the full-screen Colosseum standings UI (UiMode.
// COLOSSEUM), modeled on BiomeShopPhase. The Colosseum mystery encounter unshifts
// this after each won battle (instead of opening the UI from inside its
// doContinueEncounter callback - that raced the UI fade system and softlocked the
// next trainer's intro dialogue, #439). It builds the standings view from the
// rolled gauntlet (revealing only cleared + next challengers), preloads their
// trainer-class portraits, opens the mode, and on the player's choice either
// starts the next battle (CONTINUE) or runs the cash-out flow (CASH OUT).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  coopColosseumAwaitDecision,
  coopColosseumBoardIsCoop,
  coopColosseumBoardOwnedLocally,
  coopColosseumSendDecision,
  coopColosseumStreamBoard,
} from "#data/elite-redux/coop/coop-colosseum";
import { coopMeInteractionStartValue, setCoopMeColosseumControl } from "#data/elite-redux/coop/coop-me-pin-state";
import { coopSessionGeneration, failCoopSharedSession, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import {
  endColosseum,
  MAX_ROUNDS,
  startNextColosseumBattle,
  TIER_LADDER,
} from "#mystery-encounters/colosseum-encounter";
import type { ColosseumChallenger } from "#mystery-encounters/colosseum-gauntlet";
import {
  COLOSSEUM_CASH_OUT,
  COLOSSEUM_CONTINUE,
  type ColosseumChallengerView,
  type ColosseumViewData,
} from "#ui/colosseum-ui-handler";
import { hideCoopControllerTag, showCoopControllerTagFor } from "#ui/coop-controller-tag";

const TIER_TAG: Record<ColosseumChallenger["tier"], string> = {
  normal: "Normal",
  ghost: "Ghost",
  boss: "Boss",
  gym: "Gym",
  champion: "Champion",
};

export class ColosseumChoicePhase extends Phase {
  public readonly phaseName = "ColosseumChoicePhase";

  /** Battles won so far (1..MAX_ROUNDS - 1); the banked grade is TIER_LADDER[wins-1]. */
  private readonly wins: number;
  /** Guards against a double input firing the resolution twice. */
  private resolving = false;

  constructor(wins: number) {
    super();
    this.wins = wins;
  }

  start(): void {
    super.start();
    void this.open();
  }

  /** Preload the revealed challengers' portraits, then open the standings board. */
  private async open(): Promise<void> {
    const runtime = getCoopRuntime();
    const generation = coopSessionGeneration();
    const pinned = coopMeInteractionStartValue();
    const live = (): boolean =>
      globalScene.phaseManager.getCurrentPhase() === this
      && getCoopRuntime() === runtime
      && coopSessionGeneration() === generation
      && coopMeInteractionStartValue() === pinned;
    const gauntlet = (globalScene.currentBattle.mysteryEncounter?.misc?.gauntlet as ColosseumChallenger[]) ?? [];

    // Load every challenger's class atlas: revealed ones render in colour, the
    // rest as dark silhouettes (so the board shows shadowy figures ahead).
    const types = new Set<number>(gauntlet.map(g => g.trainerType));
    await Promise.all(
      [...types].map(t => trainerConfigs[t]?.loadAssets(TrainerVariant.DEFAULT).catch(() => undefined)),
    );
    if (!live()) {
      return;
    }

    const challengers: ColosseumChallengerView[] = gauntlet.map((ch, i) => ({
      name: ch.name,
      spriteKey: ch.spriteKey,
      tier: TIER_TAG[ch.tier],
      revealed: i <= this.wins,
    }));

    const data: ColosseumViewData = {
      round: this.wins,
      totalRounds: MAX_ROUNDS,
      tierLabel: TIER_LADDER[this.wins - 1],
      nextTierLabel: TIER_LADDER[Math.min(this.wins, MAX_ROUNDS - 1)],
      challengers,
    };
    // Co-op (#829): stream the board's two decision labels so the partner client can render the SAME
    // CONTINUE / CASH-OUT choice (the guest's own encounter.misc.gauntlet is empty - it never ran the
    // engine). Index 0 == COLOSSEUM_CONTINUE, index 1 == COLOSSEUM_CASH_OUT, aligned with onChoice.
    // FIRE-AND-FORGET + hard no-op off the authoritative host / in solo, so solo is byte-identical and
    // the host never blocks on the partner. No em dashes in the labels (project rule).
    if (
      !coopColosseumStreamBoard(
        [`CONTINUE (risk for ${data.nextTierLabel})`, `CASH OUT (claim ${data.tierLabel})`],
        data.round,
      )
    ) {
      return;
    }
    // Co-op (#829): on a GUEST-OWNED board the partner (guest) drives the CONTINUE / CASH-OUT decision on
    // its own capture UI + relays it; the host (sole engine) AWAITS the relayed index and applies it, taking
    // NO local input (mirrors coopHostAwaitGuestIndex for the top-level ME pick). A null resolution retains
    // the shared boundary and terminates recovery safely; it is never synthesized as CASH OUT. Host-owned board / solo drive off
    // local input below - coopColosseumBoardIsCoop() is false in solo, so solo is byte-identical.
    if (coopColosseumBoardIsCoop() && !coopColosseumBoardOwnedLocally()) {
      showCoopControllerTagFor(false); // amber: the partner is deciding
      const idx = await coopColosseumAwaitDecision();
      if (!live()) {
        return;
      }
      hideCoopControllerTag();
      if (idx !== COLOSSEUM_CONTINUE && idx !== COLOSSEUM_CASH_OUT) {
        getCoopRuntime()?.durability?.reconnect();
        failCoopSharedSession(`Colosseum host decision ${String(idx)} unavailable or malformed`);
        return;
      }
      void this.onChoice(idx);
      return;
    }
    const opened = await globalScene.ui.setModeBoundedWhen(UiMode.COLOSSEUM, 2_000, live, data, (choice: number) => {
      if (live()) {
        void this.onChoice(choice);
      }
    });
    if (opened === "superseded" && live()) {
      failCoopSharedSession(`Colosseum board UI could not bind for ${pinned}`);
    }
  }

  private async onChoice(choice: number): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;

    // Co-op (#829): relay the resolved board decision on the dedicated board seq so the partner adopts the
    // SAME branch - but ONLY when the LOCAL client owns the board (host-owned, or solo where the send is a
    // hard no-op anyway). On a GUEST-owned board the guest already relayed its pick and the host is APPLYING
    // it here (open() awaited it), so re-sending would echo a second pick onto the board seq. FIRE-AND-FORGET.
    if ((!coopColosseumBoardIsCoop() || coopColosseumBoardOwnedLocally()) && !coopColosseumSendDecision(choice)) {
      return;
    }

    // Hand the UI back to MESSAGE FIRST. endColosseum/startNextColosseumBattle
    // run dialogue + reward flow (showEncounterText, leaveEncounterWithoutBattle)
    // that need a normal mode; running them while still in UiMode.COLOSSEUM
    // stalled the cash-out (#439).
    const runtime = getCoopRuntime();
    const generation = coopSessionGeneration();
    const pinned = coopMeInteractionStartValue();
    const live = (): boolean =>
      getCoopRuntime() === runtime
      && coopSessionGeneration() === generation
      && coopMeInteractionStartValue() === pinned;
    const opened = await globalScene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, live);
    if (opened === "superseded" || !live()) {
      failCoopSharedSession(`Colosseum resolution UI became stale for ${pinned}`);
      return;
    }

    try {
      if (choice === COLOSSEUM_CONTINUE) {
        await startNextColosseumBattle(this.wins + 1);
        if (coopColosseumBoardIsCoop() && !setCoopMeColosseumControl(pinned, { expectedRound: this.wins + 1 })) {
          throw new Error("next Colosseum round control could not be retained");
        }
      } else {
        await endColosseum(this.wins);
      }
    } catch (error) {
      failCoopSharedSession(
        `Colosseum ${choice === COLOSSEUM_CONTINUE ? "continue" : "cash-out"} transition failed: ${String(error)}`,
      );
      return;
    }

    this.end();
  }
}
