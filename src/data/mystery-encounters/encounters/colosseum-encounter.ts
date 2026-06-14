/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - a press-your-luck trainer gauntlet mystery encounter.
//
// You enter a dojo/arena and fight a 15-trainer ladder of rising threat (rookies
// -> trained classes -> ace/veteran -> gym leaders -> dragon master -> Champion),
// each TrainerType bringing its OWN sprite + curated team. After EACH win you
// choose: CONTINUE (risk it for a higher reward GRADE) or CASH OUT (bank the
// current grade and leave). The grade ramps one rung per round across
// D, D+, C ... SS, SSS, SSS+, EX; clearing all 15 auto-awards EX. Survivors are
// patched up to half HP between rounds (statuses are NOT cured); lose a battle
// and the prize is gone.
//
// SKELETON (#439): the LOOP + the grade UI + reward GRANTING all work end-to-end.
// Cash-out pays wave-scaled money and opens an ESCALATING GUARANTEED-RARITY shop:
// every slot is locked to the banked grade's engine rarity (a full shop of
// commons low, ramping to a full shop of MASTER-tier items by S..EX) with the
// slot count growing too. Built on the Winstrate Challenge consecutive-battle
// pattern (doContinueEncounter), with the choice surfaced through the bespoke
// ColosseumUiHandler.
// =============================================================================

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { TrainerType } from "#enums/trainer-type";
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
import i18next from "i18next";

/** The i18n namespace for the encounter. */
const namespace = "mysteryEncounters/colosseum";

/** Number of rounds in the gauntlet (one trainer + one tier rung per round). */
export const MAX_ROUNDS = 15;

/**
 * Display tier ladder, lowest first - one rung per round, with "+" gradations and
 * SS/SSS prestige steps near the top. The banked tier after N wins is LADDER[N-1].
 */
export const TIER_LADDER = ["D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+", "SS", "SS+", "SSS", "SSS+", "EX"];

/**
 * Each display rung maps to an engine ModifierTier for the reward SHOP. The
 * engine only has COMMON..MASTER, so rarity ramps COMMON -> MASTER over the first
 * nine rungs and then SATURATES at MASTER; the SS/SSS/EX rungs keep escalating
 * the shop SIZE instead (see colosseumShopSize).
 */
const TIER_TO_MODIFIER: ModifierTier[] = [
  ModifierTier.COMMON, // D
  ModifierTier.COMMON, // D+
  ModifierTier.GREAT, // C
  ModifierTier.GREAT, // C+
  ModifierTier.ULTRA, // B
  ModifierTier.ULTRA, // B+
  ModifierTier.ROGUE, // A
  ModifierTier.ROGUE, // A+
  ModifierTier.MASTER, // S
  ModifierTier.MASTER, // S+
  ModifierTier.MASTER, // SS
  ModifierTier.MASTER, // SS+
  ModifierTier.MASTER, // SSS
  ModifierTier.MASTER, // SSS+
  ModifierTier.MASTER, // EX
];

/**
 * The trainer fought each round (1-indexed), in rising threat: rookies -> trained
 * classes -> ace/veteran -> gym leaders -> a dragon master -> the Champion. Each
 * TrainerType supplies its own battle sprite AND its curated team, so the roster
 * escalates in both look and difficulty. (Curated ghost-team rungs are a follow-up.)
 */
const TRAINER_LADDER: TrainerType[] = [
  TrainerType.YOUNGSTER, // 1
  TrainerType.BUG_CATCHER, // 2
  TrainerType.SCHOOL_KID, // 3
  TrainerType.CYCLIST, // 4
  TrainerType.HIKER, // 5
  TrainerType.BLACK_BELT, // 6
  TrainerType.RANGER, // 7
  TrainerType.ACE_TRAINER, // 8
  TrainerType.VETERAN, // 9
  TrainerType.NORMAN, // 10 - gym leader
  TrainerType.GIOVANNI, // 11 - gym leader
  TrainerType.SABRINA, // 12 - gym leader
  TrainerType.CLAIR, // 13 - gym leader
  TrainerType.LANCE, // 14 - dragon master
  TrainerType.CYNTHIA, // 15 - the Champion (final challenger)
];

/**
 * Human-readable challenger labels, parallel to TRAINER_LADDER, for the
 * tournament-bracket display on the between-rounds screen.
 */
export const CHALLENGER_NAMES = [
  "Youngster",
  "Bug Catcher",
  "School Kid",
  "Cyclist",
  "Hiker",
  "Black Belt",
  "Ranger",
  "Ace Trainer",
  "Veteran",
  "Norman",
  "Giovanni",
  "Sabrina",
  "Clair",
  "Lance",
  "Cynthia",
];

/** Cash-out reward-shop size for a display-tier index (0..14): 3 -> 8 slots. */
function colosseumShopSize(tierIndex: number): number {
  return Math.min(3 + Math.floor(tierIndex / 2), 8);
}

/** Build the enemy config for a given round (1..MAX_ROUNDS). */
function getColosseumRoundConfig(round: number): EnemyPartyConfig {
  const idx = Math.min(round, MAX_ROUNDS) - 1;
  return {
    trainerType: TRAINER_LADDER[idx],
    // A modest per-round level bump on top of the wave-appropriate base level;
    // the real difficulty ramp is the team QUALITY (gym leaders -> Champion).
    levelAdditiveModifier: 1 + round * 0.5,
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
      // After EACH won battle, MysteryEncounterRewardsPhase calls this. We tally
      // the win, patch up survivors, then EITHER auto-end (cleared all 15) OR
      // hand the CONTINUE / CASH OUT choice to a dedicated ColosseumChoicePhase.
      // The choice MUST be a real phase (not a setMode/setOverlayMode opened from
      // inside this callback): doing UI transitions from within the awaited
      // rewards-phase callback raced the fade system and softlocked the next
      // trainer's intro dialogue (#439, diagnosed via Oracle).
      encounter.doContinueEncounter = async () => {
        const enc = globalScene.currentBattle.mysteryEncounter!;
        enc.misc.wins += 1;
        halfHealSurvivors();
        if (enc.misc.wins >= MAX_ROUNDS) {
          await endColosseum(enc.misc.wins);
        } else {
          globalScene.phaseManager.unshiftNew("ColosseumChoicePhase", enc.misc.wins);
        }
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
 * Reset per-battle/arena state and start the next gauntlet battle. Mirrors the
 * Winstrate between-battle reset so carried-over weather/tags/tera don't corrupt
 * the next fight. `round` is the upcoming (1-indexed) battle number. Called by
 * ColosseumChoicePhase when the player picks CONTINUE.
 */
export async function startNextColosseumBattle(round: number): Promise<void> {
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
 * tier, and open an ESCALATING GUARANTEED-RARITY reward shop - every slot is
 * locked to the banked tier's engine rarity (D = a full shop of commons, ramping
 * to a full shop of MASTER-tier items by S/SS/SSS/EX), with the slot count also
 * growing the deeper you went. Then leave the encounter.
 */
export async function endColosseum(reachedRound: number): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.doContinueEncounter = undefined;

  const tierIdx = Math.min(reachedRound, MAX_ROUNDS) - 1;
  const tierLabel = TIER_LADDER[tierIdx];
  const shopTier = TIER_TO_MODIFIER[tierIdx];
  const shopSize = colosseumShopSize(tierIdx);

  // Money reward scales with how deep you went.
  const money = globalScene.getWaveMoneyAmount(1 + reachedRound);
  globalScene.addMoney(money);

  await showEncounterText(i18next.t(`${namespace}:reward`, { tier: tierLabel, money }));

  // A full shop where EVERY slot is guaranteed at the banked tier's rarity.
  setEncounterRewards({
    guaranteedModifierTiers: new Array(shopSize).fill(shopTier),
    fillRemaining: false,
  });
  leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
}
