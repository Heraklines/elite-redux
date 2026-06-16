/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Press-Your-Luck substrate (#439 Phase A3) - the reusable BANK-OR-RISK loop.
//
// A whole family of biome events share one shape: each round the player either
// BANKS a growing haul (take what you have, stop safely) or PUSHES for more,
// where every push carries an escalating chance to BUST. The first consumer is
// the Forest "Woodland Forager" (forage in a berry grove; push too far and a
// territorial swarm interrupts). The next ones (Glittering Vein, Great Forge)
// reuse this same loop with different flavor + bust outcomes.
//
// It is driven entirely by the STANDARD mystery-encounter dialogue + option
// select machinery (showEncounterText + a 2-option `initSubsequentOptionSelect`
// re-prompt each round) - NOT a bespoke full-screen UiMode. The host encounter
// must set `encounter.continuousEncounter = true` before starting the loop (the
// looping ME contract; see safari-zone-encounter.ts) and the loop clears it when
// it ends.
//
// The host supplies a {@linkcode PressYourLuckConfig}: i18n keys for the round
// prompt + the two button options, the per-round bust chance, and three
// callbacks - one to advance the haul when a push SURVIVES, one to resolve a
// BANK (the player kept the haul), and one to resolve a BUST (the push failed).
// The bust callback is what differs most between events: the Forager turns it
// into a level-scaled swarm battle, while a simpler event could just dock the
// haul with no fight. RNG flows through randSeedInt so saves stay deterministic.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { initSubsequentOptionSelect } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedInt } from "#utils/common";

/** Resolution states a single press-your-luck round can produce. */
export const enum PressYourLuckOutcome {
  /** The player chose to bank - they keep the current haul, the loop ends. */
  BANKED = "banked",
  /** The player pushed and survived - the haul grew, the loop continues. */
  SURVIVED = "survived",
  /** The player pushed and busted - the bust outcome fires, the loop ends. */
  BUSTED = "busted",
}

/**
 * Host-supplied configuration for a press-your-luck loop. One instance per event
 * type; the loop reads it every round.
 */
export interface PressYourLuckConfig {
  /**
   * i18n key (or literal) for the round prompt shown BEFORE the bank/push choice
   * each round. Dialogue tokens already set on the encounter (e.g. the current
   * haul size or round number) are injected, so the host can show "You have
   * gathered {{haulCount}} so far." here.
   */
  promptKey: string;
  /** i18n key for the PUSH option's button label (e.g. "Forage on"). */
  pushLabelKey: string;
  /** i18n key for the PUSH option's button tooltip. */
  pushTooltipKey: string;
  /** i18n key for the BANK option's button label (e.g. "Pack up and leave"). */
  bankLabelKey: string;
  /** i18n key for the BANK option's button tooltip. */
  bankTooltipKey: string;
  /**
   * The chance in [0, 1) that PUSHING on `round` (0-indexed, 0 = the very first
   * push) busts. Implementations return an escalating value. Clamped to [0, 1].
   */
  bustChance: (round: number) => number;
  /**
   * Advance the haul for a SURVIVED push entering `round` (0-indexed). The host
   * mutates its own state (on `encounter.misc`) and refreshes any dialogue
   * tokens used by `promptKey`. May show its own flavor text (await it).
   */
  onPush: (round: number) => Promise<void>;
  /**
   * Resolve a BANK: the player kept the haul gathered over `roundsCompleted`
   * pushes (0 = banked immediately, walked away with nothing). The host grants
   * rewards / leaves the encounter here. The loop has already cleared
   * `continuousEncounter` before calling this.
   */
  onBank: (roundsCompleted: number) => Promise<void>;
  /**
   * Resolve a BUST on `round` (0-indexed, the push that failed). The host
   * resolves the failure (e.g. a swarm battle, or docking the haul) and is
   * responsible for ending the encounter (battle or leave). The loop has
   * already cleared `continuousEncounter` before calling this.
   */
  onBust: (round: number) => Promise<void>;
}

/** Per-encounter loop state stashed on `encounter.misc.pressYourLuck`. */
interface PressYourLuckState {
  /** How many pushes have SURVIVED so far. Also the index of the next push. */
  round: number;
}

function getState(encounter: MysteryEncounter): PressYourLuckState {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.pressYourLuck) {
    encounter.misc.pressYourLuck = { round: 0 } satisfies PressYourLuckState;
  }
  return encounter.misc.pressYourLuck as PressYourLuckState;
}

/**
 * Roll whether a push on `round` busts, using the seeded run RNG so the outcome
 * is stable within a save. `bustChance` is clamped to [0, 1] and converted to a
 * 0..9999 integer threshold.
 */
function rollBust(round: number, chance: number): boolean {
  const pct = Math.min(Math.max(chance, 0), 1);
  return randSeedInt(10000) < Math.round(pct * 10000);
}

/**
 * Begin a press-your-luck loop on the CURRENT encounter. Call this from the host
 * encounter's first `withOptionPhase` (the "start foraging" option) AFTER setting
 * `encounter.continuousEncounter = true` and clearing the intro visuals. It shows
 * the first round prompt and the bank/push select; every subsequent round is
 * re-queued automatically until the player banks or busts.
 */
export async function startPressYourLuck(config: PressYourLuckConfig): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  getState(encounter).round = 0;
  await promptRound(config);
}

/** Show the round prompt, then queue the bank/push option select. */
async function promptRound(config: PressYourLuckConfig): Promise<void> {
  await showEncounterText(config.promptKey);
  initSubsequentOptionSelect({
    overrideOptions: buildRoundOptions(config),
    hideDescription: true,
  });
}

/**
 * Build the two-option select for a round: PUSH (index 0) and BANK (index 1).
 * Rebuilt each round so the option phases close over the live `config`.
 */
function buildRoundOptions(config: PressYourLuckConfig): MysteryEncounterOption[] {
  const push = MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: config.pushLabelKey,
      buttonTooltip: config.pushTooltipKey,
    })
    .withOptionPhase(async () => {
      await resolvePush(config);
      return true;
    })
    .build();

  const bank = MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: config.bankLabelKey,
      buttonTooltip: config.bankTooltipKey,
    })
    .withOptionPhase(async () => {
      await resolveBank(config);
      return true;
    })
    .build();

  return [push, bank];
}

/** Resolve a PUSH: roll the bust, then either grow the haul or bust out. */
async function resolvePush(config: PressYourLuckConfig): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const state = getState(encounter);
  const round = state.round;

  if (rollBust(round, config.bustChance(round))) {
    endLoop(encounter);
    await config.onBust(round);
    return;
  }

  // Survived: grow the haul, advance, and re-prompt the next round.
  await config.onPush(round);
  state.round = round + 1;
  await promptRound(config);
}

/** Resolve a BANK: end the loop and hand control to the host's onBank. */
async function resolveBank(config: PressYourLuckConfig): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const roundsCompleted = getState(encounter).round;
  endLoop(encounter);
  await config.onBank(roundsCompleted);
}

/** Clear the looping-encounter flag so the host's resolution can end the ME. */
function endLoop(encounter: MysteryEncounter): void {
  encounter.continuousEncounter = false;
}
