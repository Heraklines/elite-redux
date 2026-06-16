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
import { erBiomeCrossroadsVerb } from "#data/elite-redux/er-biome-routing";
import { setErLeaveBiomeNow } from "#data/elite-redux/er-biome-structure";
import { UiMode } from "#enums/ui-mode";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { getBiomeName } from "#utils/common";

export class ErCrossroadsPhase extends Phase {
  public readonly phaseName = "ErCrossroadsPhase";

  /** Guards against a double input firing the resolution twice. */
  private resolving = false;

  start(): void {
    super.start();

    const biomeName = getBiomeName(globalScene.arena.biomeId);
    const options: OptionSelectItem[] = [
      {
        // #502: the "keep exploring this biome" action carries the biome's
        // interaction-grammar verb (Delve deeper / Forage on / Scout ahead /
        // Browse on / Wade on), surfacing the grammar on the Crossroads panel.
        label: erBiomeCrossroadsVerb(globalScene.arena.biomeId),
        handler: () => {
          this.resolve(false);
          return true;
        },
      },
      {
        label: "Move on",
        handler: () => {
          this.resolve(true);
          return true;
        },
      },
    ];

    globalScene.ui.showText(`You reach a crossroads in ${biomeName}. Press on, or move to a new area?`, null, () => {
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, delay: 500 });
    });
  }

  private resolve(moveOn: boolean): void {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    globalScene.ui.setMode(UiMode.MESSAGE);

    if (moveOn) {
      // End the biome now: flag the early exit (isNewBiome honors it) and open the
      // World Map node picker ahead of the queued NewBattlePhase.
      setErLeaveBiomeNow();
      globalScene.phaseManager.unshiftNew("SelectBiomePhase");
    }
    // STAY: nothing to do - the run continues to NewBattlePhase in this biome.
    this.end();
  }
}
