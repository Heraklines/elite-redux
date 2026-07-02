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
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getCoopController } from "#data/elite-redux/coop/coop-runtime";
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

  start(): void {
    super.start();

    // Co-op (#633): the Stay/Leave map choice is interactive and runs INDEPENDENTLY
    // on each client - two players could pick different paths and split the run into
    // different biomes. Auto-resolve it DETERMINISTICALLY (no prompt): leave once the
    // locals have turned hostile (past the notoriety-free window), else stay. Both
    // clients compute this identically from the shared wave index, so they stay in
    // lockstep with no extra messaging (same desync-avoidance as the battle-start
    // switch prompt, the save-slot screen, and the challenge screen). Solo unaffected.
    if (globalScene.gameMode.isCoop && getCoopController() != null) {
      this.resolve(erHasNotoriety(globalScene.currentBattle?.waveIndex ?? 0));
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

  private resolve(moveOn: boolean): void {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    // #record-replay (single-player): capture the crossroads Stay(0)/Leave(1) choice. No-op unless
    // recording / in co-op (co-op auto-resolves this deterministically, so it never records here).
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
