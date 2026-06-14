/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the between-rounds press-your-luck choice phase.
//
// A DEDICATED phase that owns the full-screen Colosseum choice UI (UiMode.
// COLOSSEUM), modeled on BiomeShopPhase. The Colosseum mystery encounter
// unshifts this after each won battle (instead of opening the UI from inside its
// doContinueEncounter callback - doing that raced the UI fade system and
// softlocked the next trainer's intro dialogue, #439). This phase IS the UI: it
// opens the mode on start, and on the player's choice it either starts the next
// gauntlet battle (CONTINUE) or runs the cash-out reward flow (CASH OUT), then
// hands the UI back to MESSAGE and ends.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import {
  CHALLENGER_NAMES,
  endColosseum,
  MAX_ROUNDS,
  startNextColosseumBattle,
  TIER_LADDER,
} from "#mystery-encounters/colosseum-encounter";
import { COLOSSEUM_CONTINUE, type ColosseumViewData } from "#ui/colosseum-ui-handler";

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
    const data: ColosseumViewData = {
      round: this.wins,
      totalRounds: MAX_ROUNDS,
      tierLabel: TIER_LADDER[this.wins - 1],
      nextTierLabel: TIER_LADDER[Math.min(this.wins, MAX_ROUNDS - 1)],
      challengers: CHALLENGER_NAMES,
    };
    globalScene.ui.setMode(UiMode.COLOSSEUM, data, (choice: number) => this.onChoice(choice));
  }

  private async onChoice(choice: number): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;

    if (choice === COLOSSEUM_CONTINUE) {
      await startNextColosseumBattle(this.wins + 1);
    } else {
      await endColosseum(this.wins);
    }

    // Hand the UI back to a known mode before the next phase runs, then end -
    // exactly like the encounter phases do on exit.
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
  }
}
