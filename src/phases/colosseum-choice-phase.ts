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
import { COLOSSEUM_CONTINUE, type ColosseumChallengerView, type ColosseumViewData } from "#ui/colosseum-ui-handler";

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
    const gauntlet = (globalScene.currentBattle.mysteryEncounter?.misc?.gauntlet as ColosseumChallenger[]) ?? [];

    // Reveal cleared (index < wins) + the next-up challenger (index === wins).
    const revealedTypes = new Set<number>();
    for (let i = 0; i < gauntlet.length; i++) {
      if (i <= this.wins) {
        revealedTypes.add(gauntlet[i].trainerType);
      }
    }
    await Promise.all(
      [...revealedTypes].map(t => trainerConfigs[t]?.loadAssets(TrainerVariant.DEFAULT).catch(() => undefined)),
    );

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

    // Hand the UI back to a known mode before the next phase runs, then end.
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
  }
}
