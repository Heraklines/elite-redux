/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - World Map core, the every-5-waves CROSSROADS.
//
// After the post-wave reward, every ~5 waves spent in the current biome (and only
// while the biome is NOT already ending), the run raises a "Stay / Move on" choice:
//   - STAY     -> keep going in this biome (the rolled length still bounds it).
//   - MOVE ON  -> end the biome NOW: flag an early exit (so isNewBiome honors it)
//                 and open the World Map node picker (SelectBiomePhase) before the
//                 next battle starts.
//
// Pushed by VictoryPhase (after the reward, before NewBattlePhase) when
// erShouldRaiseCrossroads() is true. The "Move on" path UNSHIFTS SelectBiomePhase
// so it runs immediately, ahead of the already-queued NewBattlePhase - mirroring
// the normal biome-end flow (SelectBiomePhase -> SwitchBiomePhase -> NewBattle).
//
// Gated entirely by erBiomeRoutingActive() at the push site (VictoryPhase), so it
// never appears in production / non-classic / daily / endless / random-biome runs.
//
// Co-op (#848): the crossroads is the ENTRY POINT of an owner-alternated interaction.
// The interaction OWNER (shared-counter parity, same alternation as reward shop / ME /
// bargain) drives the real Stay/Leave screen; the WATCHER opens a mirrored read-only
// copy that follows the owner's live cursor and adopts the owner's relayed pick. On
// STAY the crossroads is the terminal (it advances the counter once). On LEAVE it DEFERS
// its terminal to the chained SelectBiomePhase (setCoopBiomeInteractionStart), so the
// whole Stay/Leave->biome decision is ONE interaction with ONE counter advance at the
// map terminal - one player drives the whole chain. A disconnect / stall backstops to
// the deterministic auto-resolve on BOTH clients identically (same wave seed), so the
// fallback can never desync.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  coopBiomePickerAutoResolvesInTest,
  setCoopBiomeInteractionStart,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_BIOME_WAIT_MS } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  advanceCoopInteractionForContinuation,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  getCoopUiMirror,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_CROSSROADS_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { erHasNotoriety } from "#data/elite-redux/er-biome-notoriety";
import { erMarkBiomeStay, setErLeaveBiomeNow } from "#data/elite-redux/er-biome-structure";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { UiMode } from "#enums/ui-mode";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { getBiomeName } from "#utils/common";

export class ErCrossroadsPhase extends Phase {
  public readonly phaseName = "ErCrossroadsPhase";

  /** Guards against a double input firing the resolution twice. */
  private resolving = false;

  /** Co-op (#848): interaction counter pinned at open (-1 = solo / not pinned). */
  private coopStartCounter = -1;

  start(): void {
    super.start();

    // Co-op (#848): the crossroads ALTERNATES like the reward shop / ME / bargain. The OWNER
    // drives the real Stay/Leave screen; the WATCHER mirrors it and adopts the relayed pick.
    // Solo / non-coop keeps the plain prompt below.
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    if (coopController != null) {
      void this.coopStart(coopController);
      return;
    }

    const biomeName = getBiomeName(globalScene.arena.biomeId);
    const options: OptionSelectItem[] = [
      {
        // Plain "Stay" (keep exploring this biome) - clearer than the biome verb.
        label: "Stay",
        handler: () => {
          this.resolve(false);
          return true;
        },
      },
      {
        label: "Leave",
        handler: () => {
          this.resolve(true);
          return true;
        },
      },
    ];

    // Warn once the player is past the free window: from here, staying makes the
    // locals hostile (enemies grow stronger the longer you linger).
    const overstaying = erHasNotoriety(globalScene.currentBattle?.waveIndex ?? 0);
    const prompt = overstaying
      ? `The locals in ${biomeName} grow hostile. Stay anyway, or leave?`
      : `A crossroads in ${biomeName}. Stay (locals turn hostile over time), or leave?`;

    globalScene.ui.showText(prompt, null, () => {
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, delay: 500 });
    });
  }

  // ---------------------------------------------------------------------------
  // Co-op (#848) owner / watcher / mirror / relay.
  // ---------------------------------------------------------------------------

  /** The crossroads prompt text (owner + watcher render the identical line). */
  private crossroadsPrompt(): string {
    const biomeName = getBiomeName(globalScene.arena.biomeId);
    return erHasNotoriety(globalScene.currentBattle?.waveIndex ?? 0)
      ? `The locals in ${biomeName} grow hostile. Stay anyway, or leave?`
      : `A crossroads in ${biomeName}. Stay (locals turn hostile over time), or leave?`;
  }

  /** Decide owner vs watcher off the pinned interaction counter and branch. */
  private async coopStart(controller: CoopSessionController): Promise<void> {
    if (this.coopStartCounter < 0) {
      this.coopStartCounter = controller.interactionCounter();
    }
    const pinned = this.coopStartCounter;
    // #848 test-scoped: a headless multi-wave test never answers the real Stay/Leave prompt. Under vitest
    // (unless the test drives the picker) resolve it DETERMINISTICALLY + SYNCHRONOUSLY, exactly like the
    // pre-#848 co-op bypass: NO interaction-counter tick and NO chained pin. This is required because the
    // authoritative soak's driver drives the guest's reward shop but NOT its crossroads, so only the host
    // would run this phase - a counter tick here would advance the host alone and breach the two-engine
    // LOCKSTEP invariant. Ticking is production behavior (both engines run the phase in lockstep, or the
    // guest runs it via VictoryPhase); the opted-in duo test exercises + asserts that path for real. Live
    // builds (no VITEST) keep the real owner/watcher prompt with the counter tick below.
    if (coopBiomePickerAutoResolvesInTest()) {
      const moveOn = erHasNotoriety(globalScene.currentBattle?.waveIndex ?? 0);
      coopLog(
        "reward",
        `crossroads AUTO-RESOLVE (vitest, picker not driven, no counter tick) -> moveOn=${moveOn} pinned=${pinned} (#848)`,
      );
      globalScene.ui.setMode(UiMode.MESSAGE);
      if (moveOn) {
        setErLeaveBiomeNow();
        globalScene.phaseManager.unshiftNew("SelectBiomePhase");
      } else {
        erMarkBiomeStay(globalScene.currentBattle?.waveIndex ?? 0);
      }
      this.end();
      return;
    }
    const spoofed = getCoopRuntime()?.spoof != null;
    const owns = spoofed || controller.isLocalOwnerAtCounter(pinned);
    coopLog(
      "reward",
      `crossroads owner/watcher decision: pinnedStart=${pinned} role=${controller.role} spoof=${spoofed} -> ${owns ? "OWNER" : "WATCHER"} (#848)`,
    );
    if (owns) {
      this.coopOwnerFlow(pinned);
    } else {
      await this.coopWatchFlow(pinned);
    }
  }

  /** OWNER: drive the real Stay/Leave screen; each pick relays out + applies. */
  private coopOwnerFlow(pinned: number): void {
    const mirrorSeq = COOP_CROSSROADS_SEQ_BASE + pinned;
    const options: OptionSelectItem[] = [
      {
        label: "Stay",
        handler: () => {
          this.coopOwnerCommit(pinned, false);
          return true;
        },
      },
      {
        label: "Leave",
        handler: () => {
          this.coopOwnerCommit(pinned, true);
          return true;
        },
      },
    ];
    globalScene.ui.showText(this.crossroadsPrompt(), null, () => {
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, delay: 500 });
      // Relay the owner's live cursor to the watcher's read-only copy (cosmetic).
      getCoopUiMirror()?.beginSession("owner", UiMode.OPTION_SELECT, mirrorSeq);
    });
  }

  /** OWNER terminal: relay the Stay(0)/Leave(1) choice, then apply it locally. */
  private coopOwnerCommit(pinned: number, moveOn: boolean): void {
    if (this.resolving) {
      return;
    }
    getCoopUiMirror()?.endSession();
    try {
      getCoopInteractionRelay()?.sendInteractionChoice(COOP_CROSSROADS_SEQ_BASE + pinned, "crossroads", moveOn ? 1 : 0);
      coopLog("reward", `crossroads OWNER commit moveOn=${moveOn} pinnedStart=${pinned} (#848)`);
    } catch {
      coopWarn("reward", "crossroads OWNER relay send threw (handled - watcher heals on timeout) (#848)");
    }
    this.coopApply(pinned, moveOn);
  }

  /** WATCHER: open a read-only mirrored copy, await the owner's pick, apply it. (Not reached under the
   *  vitest auto-resolve - coopStart resolves synchronously before the owner/watcher split.) */
  private async coopWatchFlow(pinned: number): Promise<void> {
    const mirrorSeq = COOP_CROSSROADS_SEQ_BASE + pinned;
    // Read-only copy of the SAME screen for the cursor mirror. The handlers are cosmetic
    // no-ops: the awaited relay is the sole authority (a replayed owner ACTION must never
    // resolve the watcher against its own possibly-drifted cursor).
    const watchOptions: OptionSelectItem[] = [
      { label: "Stay", handler: () => true },
      { label: "Leave", handler: () => true },
    ];
    try {
      // Show the prompt COSMETICALLY (never block the relay-await on a text-advance callback), then
      // open the mirrored menu.
      globalScene.ui.showText(this.crossroadsPrompt());
      await globalScene.ui.setMode(UiMode.OPTION_SELECT, { options: watchOptions, delay: 500 });
      getCoopUiMirror()?.beginSession("watcher", UiMode.OPTION_SELECT, mirrorSeq);
    } catch {
      /* cosmetic - the awaited relay still drives the authoritative apply below */
    }
    const relay = getCoopInteractionRelay();
    const res =
      relay == null ? null : await relay.awaitInteractionChoice(COOP_CROSSROADS_SEQ_BASE + pinned, COOP_BIOME_WAIT_MS);
    getCoopUiMirror()?.endSession();
    let moveOn: boolean;
    if (res == null) {
      // ANTI-HANG (#848): disconnect / stall backstop. Both clients fall back to the SAME
      // deterministic auto-resolve (leave once the locals turned hostile), so the fallback
      // cannot desync - it is what both would independently compute off the shared wave index.
      moveOn = erHasNotoriety(globalScene.currentBattle?.waveIndex ?? 0);
      coopWarn(
        "reward",
        `crossroads WATCHER: owner pick TIMEOUT/disconnect -> deterministic fallback moveOn=${moveOn} (#848)`,
      );
    } else {
      moveOn = res.choice === 1;
      coopLog("reward", `crossroads WATCHER: owner pick received moveOn=${moveOn} pinnedStart=${pinned} (#848)`);
    }
    this.coopApply(pinned, moveOn);
  }

  /**
   * Apply the resolved Stay/Leave on BOTH clients (owner after its pick, watcher after the
   * relay). STAY is the terminal here (advance the shared counter once). LEAVE DEFERS the
   * terminal to the chained SelectBiomePhase - it pins the interaction counter so that phase
   * completes the SAME interaction with the single advance at the map pick.
   */
  private coopApply(pinned: number, moveOn: boolean): void {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    globalScene.ui.setMode(UiMode.MESSAGE);
    if (moveOn) {
      // End the biome now; open the World Map picker ahead of the queued NewBattlePhase. The
      // chained SelectBiomePhase owns the single terminal advance for the whole decision.
      setErLeaveBiomeNow();
      setCoopBiomeInteractionStart(pinned);
      globalScene.phaseManager.unshiftNew("SelectBiomePhase");
    } else {
      // STAY: arm the overstay anchor (a no-op inside the free window) and terminate the
      // interaction here with the single from-pinned advance.
      erMarkBiomeStay(globalScene.currentBattle?.waveIndex ?? 0);
      advanceCoopInteractionForContinuation(pinned);
    }
    this.end();
  }

  // ---------------------------------------------------------------------------
  // Solo.
  // ---------------------------------------------------------------------------

  private resolve(moveOn: boolean): void {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    // #record-replay (single-player): capture the crossroads Stay(0)/Leave(1) choice. No-op unless
    // recording (co-op captures via the relay taps instead).
    recordSinglePlayerInteraction("crossroads", moveOn ? 1 : 0);
    globalScene.ui.setMode(UiMode.MESSAGE);

    if (moveOn) {
      // End the biome now: flag the early exit (isNewBiome honors it) and open the
      // World Map node picker ahead of the queued NewBattlePhase.
      setErLeaveBiomeNow();
      globalScene.phaseManager.unshiftNew("SelectBiomePhase");
    } else {
      // STAY: the run continues in this biome. If this is a deliberate choice to
      // linger PAST the notoriety-free window, arm the overstay anchor - from here
      // the locals grow hostile (enemies climb in level + power the longer you
      // stay). Inside the free window this is a no-op (staying is still free).
      erMarkBiomeStay(globalScene.currentBattle?.waveIndex ?? 0);
    }
    this.end();
  }
}
