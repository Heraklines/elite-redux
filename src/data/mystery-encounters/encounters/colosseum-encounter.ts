/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - a press-your-luck trainer gauntlet mystery encounter.
//
// You enter a dojo/arena and fight a rising ladder of trainers back-to-back.
// After EACH win you choose: CONTINUE (risk it for a higher reward tier) or
// CASH OUT (bank the current tier's reward and leave). The reward tier ramps
// D -> C -> B -> A -> S -> EX; clearing all six auto-awards the EX tier. Between
// rounds your survivors are patched up to half HP (statuses are NOT cured).
//
// SKELETON (#439): the LOOP + the tier UI + reward GRANTING all work end-to-end.
// The exact reward CONTENTS per tier are placeholders to be workshopped - right
// now each tier grants a wave-scaled money payout plus one reward-shop item of
// the mapped engine tier, and EX additionally drops a guaranteed-shiny egg and a
// 50-candy bag for the lead. Built on the Winstrate Challenge consecutive-battle
// pattern (doContinueEncounter), with the choice surfaced through the bespoke
// ColosseumUiHandler.
// =============================================================================

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import type { IEggOptions } from "#data/egg";
import { BattlerTagType } from "#enums/battler-tag-type";
import { EggSourceType } from "#enums/egg-source-types";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { COLOSSEUM_CASH_OUT, COLOSSEUM_CONTINUE, type ColosseumViewData } from "#ui/colosseum-ui-handler";
import i18next from "i18next";

/** The i18n namespace for the encounter. */
const namespace = "mysteryEncounters/colosseum";

/** Number of rounds / tiers in the gauntlet. */
const MAX_ROUNDS = 6;

/** Display tier ladder, lowest first. The banked tier after N wins is LADDER[N-1]. */
const TIER_LADDER = ["D", "C", "B", "A", "S", "EX"];

/**
 * Each display tier maps to an engine ModifierTier for the item roll. EX reuses
 * MASTER for its item and stacks bonus rewards on top (see endColosseum).
 */
const TIER_TO_MODIFIER: ModifierTier[] = [
  ModifierTier.COMMON, // D
  ModifierTier.GREAT, // C
  ModifierTier.ULTRA, // B
  ModifierTier.ROGUE, // A
  ModifierTier.MASTER, // S
  ModifierTier.MASTER, // EX
];

/**
 * The trainer fought in each round (1-indexed). A rising-difficulty ladder of
 * vanilla trainer classes; later rounds also scale levels up via
 * levelAdditiveModifier. SKELETON rosters - the curated ghost/gym-leader ladder
 * from the design doc is a follow-up.
 */
const TRAINER_LADDER: TrainerType[] = [
  TrainerType.YOUNGSTER,
  TrainerType.ACE_TRAINER,
  TrainerType.ACE_TRAINER,
  TrainerType.VETERAN,
  TrainerType.VETERAN,
  TrainerType.VETERAN,
];

/** Build the enemy config for a given round (1..MAX_ROUNDS). */
function getColosseumRoundConfig(round: number): EnemyPartyConfig {
  const idx = Math.min(round, MAX_ROUNDS) - 1;
  return {
    trainerType: TRAINER_LADDER[idx],
    // Levels climb with the round so the ladder gets meaningfully harder.
    levelAdditiveModifier: 2 + round,
  };
}

export const ColosseumEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.COLOSSEUM,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(40, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withScenePartySizeRequirement(2, 6)
  .withMaxAllowedEncounters(1)
  .withIntroSpriteConfigs([
    {
      spriteKey: "black_belt_m",
      fileRoot: "trainer",
      hasShadow: true,
      x: 0,
      y: 0,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withAutoHideIntroVisuals(false)
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.misc = { wins: 0 };
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.1.selected`,
        },
      ],
    },
    async () => {
      // Enter the gauntlet. The Winstrate pattern: doContinueEncounter fires
      // after every won battle (in MysteryEncounterRewardsPhase) so the encounter
      // never ends until we explicitly clear the hook.
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      encounter.misc = { wins: 0 };
      encounter.doContinueEncounter = async () => {
        await colosseumBetweenBattles();
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(getColosseumRoundConfig(1));
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    },
    async () => {
      // Decline - leave with nothing.
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    },
  )
  .build();

/**
 * Runs after EACH won gauntlet battle. Patches up survivors, then either
 * auto-ends (cleared the whole ladder) or surfaces the CONTINUE / CASH OUT
 * choice. Returns a Promise that resolves only once the NEXT action (next battle
 * or the leave/reward flow) has been queued, so the rewards phase ends cleanly.
 */
async function colosseumBetweenBattles(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.misc.wins += 1;
  const wins: number = encounter.misc.wins;

  halfHealSurvivors();

  if (wins >= MAX_ROUNDS) {
    // Cleared the entire ladder - award the top (EX) tier automatically.
    await endColosseum(wins);
    return;
  }

  const choice = await openColosseumChoice(wins);
  if (choice === COLOSSEUM_CONTINUE) {
    await startNextColosseumBattle(wins + 1);
  } else {
    await endColosseum(wins);
  }
}

/** Show the press-your-luck screen; resolves with the player's choice. */
function openColosseumChoice(wins: number): Promise<number> {
  return new Promise(resolve => {
    const data: ColosseumViewData = { wins, maxRounds: MAX_ROUNDS, ladder: TIER_LADDER };
    globalScene.ui.setMode(UiMode.COLOSSEUM, data, (choice: number) => {
      resolve(choice === COLOSSEUM_CASH_OUT ? COLOSSEUM_CASH_OUT : COLOSSEUM_CONTINUE);
    });
  });
}

/**
 * Reset per-battle/arena state and start the next gauntlet battle. Mirrors the
 * Winstrate between-battle reset so carried-over weather/tags/tera don't corrupt
 * the next fight. `round` is the upcoming (1-indexed) battle number.
 */
async function startNextColosseumBattle(round: number): Promise<void> {
  const playerField = globalScene.getPlayerField();
  for (const pokemon of playerField) {
    pokemon.lapseTag(BattlerTagType.COMMANDED);
  }
  playerField.forEach((_, p) => globalScene.phaseManager.unshiftNew("ReturnPhase", p));

  globalScene.arena.resetArenaEffects();
  for (const pokemon of globalScene.getPlayerParty()) {
    // Each round is a fresh fight - clear per-battle activation state.
    pokemon.resetBattleAndWaveData();
    applyAbAttrs("PostBattleInitAbAttr", { pokemon });
  }

  globalScene.phaseManager.unshiftNew("ShowTrainerPhase");
  await initBattleWithEnemyConfig(getColosseumRoundConfig(round));
}

/**
 * Heal each STILL-STANDING party member up to at least half HP (no status cure).
 * Fainted members stay down - that's the gauntlet's risk. (Reviving fainted mons
 * to half is a design-doc follow-up.)
 */
function halfHealSurvivors(): void {
  for (const pokemon of globalScene.getPlayerParty()) {
    if (pokemon.hp <= 0) {
      continue;
    }
    const half = Math.floor(pokemon.getMaxHp() / 2);
    if (pokemon.hp < half) {
      pokemon.hp = half;
      pokemon.updateInfo();
    }
  }
}

/**
 * End the gauntlet: clear the continue hook, pay out the money for the reached
 * tier, queue the tiered item reward (+ EX bonuses), and leave the encounter.
 */
async function endColosseum(reachedRound: number): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.doContinueEncounter = undefined;

  const tierIdx = Math.min(reachedRound, MAX_ROUNDS) - 1;
  const tierLabel = TIER_LADDER[tierIdx];

  // Money reward scales with how deep you went.
  const money = globalScene.getWaveMoneyAmount(1 + reachedRound);
  globalScene.addMoney(money);

  await showEncounterText(i18next.t(`${namespace}:reward`, { tier: tierLabel, money }));

  const tiers: ModifierTier[] = [TIER_TO_MODIFIER[tierIdx]];
  const eggRewards: IEggOptions[] = [];
  if (reachedRound >= MAX_ROUNDS) {
    // EX bonuses: a second top-tier item, a guaranteed-shiny egg, and 50 candies
    // for the lead. (Placeholder "crazy" rewards - to be workshopped.)
    tiers.push(ModifierTier.MASTER);
    eggRewards.push({ isShiny: true, hatchWaves: 10, sourceType: EggSourceType.EVENT });
    const lead = globalScene.getPlayerParty()[0];
    if (lead) {
      globalScene.gameData.addStarterCandy(lead.species.getRootSpeciesId(), 50, true);
    }
  }

  setEncounterRewards(
    { guaranteedModifierTiers: tiers, fillRemaining: false },
    eggRewards.length > 0 ? eggRewards : undefined,
  );
  leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
}
