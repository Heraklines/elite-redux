/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Overgrown Temple. A JUNGLE-biome press-your-luck DELVE through an
// ancient ruin reclaimed by the jungle (design PART XII s41). A third consumer of
// the reusable press-your-luck substrate (er-press-your-luck.ts), it mirrors the
// Glittering Vein: each chamber the player either LEAVES with the safe haul, or
// presses DEEPER for older, richer treasure - but every step raises the chance a
// trap springs or the temple guardian (a Grass/Rock golem) awakens and attacks.
//
//   Chamber haul: early chambers yield loose tribute (a small money payout); deeper
//     chambers turn up real antiquities (a bigger payout) and, deep in, a small
//     chance at a single relic - a Rogue-tier item or an evolution stone (an early
//     evo-item source). Money is paid on leave/win; the relic is a post-win pick.
//   LEAVE (bank): keep everything found so far and climb back out. Leaving at
//     chamber 0 = nothing, no cost.
//   PRESS DEEPER (push) + survive: the haul grows, prompt again.
//   PRESS DEEPER (push) + the temple WAKES: a level-scaled wild Grass/Rock guardian
//     (Cradily / Sudowoodo / Torterra / Tangrowth, via initBattleWithEnemyConfig)
//     attacks. The trap scatters PART of the haul up front; the kept money is paid
//     immediately and any relic is set as the reward shop, which opens after the
//     win (Graves/Vein combat-branch pattern). A party wipe ends the run as any
//     battle would - the branch never softlocks the forced encounter.
//
// Tuning lives in the constants below. This is a THIN config on top of the shared
// substrate - the loop itself lives in er-press-your-luck.ts.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { type PressYourLuckConfig, startPressYourLuck } from "#data/elite-redux/er-press-your-luck";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/overgrownTemple";

// --- Delve tuning ---------------------------------------------------------- //

/** Money a shallow-chamber find (chambers 0-1) is worth. */
const TRIBUTE_VALUE = 90;
/** Money a deep-chamber antiquity (chamber 2+) is worth. */
const ANTIQUITY_VALUE = 240;

/** Base wake chance for the very first step, in [0, 1]. */
const WAKE_BASE = 0.12;
/** Added to the wake chance per chamber (chamber 0 = WAKE_BASE). */
const WAKE_PER_CHAMBER = 0.13;
/** The wake chance never exceeds this, so a deep delve is risky but not hopeless. */
const WAKE_MAX = 0.8;

/** Chamber (0-indexed step count) at and beyond which finds become antiquities. */
const ANTIQUITY_CHAMBER = 2;
/** Chamber at/after which each survived step has a small shot at the relic. */
const RELIC_CHAMBER = 3;
/** Chance per qualifying step to turn up the relic. */
const RELIC_CHANCE = 0.2;
/** Fraction of the gathered money the trap scatters when the temple wakes. */
const WAKE_HAUL_LOSS = 0.5;

/** The relic's evo-item half (an early evolution-item source). */
const RELIC_EVO_FUNC: ModifierTypeFunc = modifierTypes.RARE_EVOLUTION_ITEM;

/** Thematic wild Grass/Rock guardians for the temple-wakes fight. */
const GUARDIAN_SPECIES: SpeciesId[] = [SpeciesId.CRADILY, SpeciesId.SUDOWOODO, SpeciesId.TORTERRA, SpeciesId.TANGROWTH];

/** What the Temple accumulates on `encounter.misc.delve`. */
interface DelveHaul {
  /** Money found so far (paid to the player on leave/win). */
  money: number;
  /** How many finds have been made (drives the {{findCount}} token). */
  finds: number;
  /** Whether the relic has been found (an evolution-stone / Rogue shop pick). */
  relic: boolean;
}

function getHaul(encounter: MysteryEncounter): DelveHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.delve) {
    encounter.misc.delve = { money: 0, finds: 0, relic: false } satisfies DelveHaul;
  }
  return encounter.misc.delve as DelveHaul;
}

/** Escalating per-chamber wake chance, clamped to [WAKE_BASE, WAKE_MAX]. */
function wakeChance(chamber: number): number {
  return Math.min(WAKE_BASE + chamber * WAKE_PER_CHAMBER, WAKE_MAX);
}

/** Grow the haul for a survived step entering `chamber`, and refresh the prompt token. */
async function delveChamber(encounter: MysteryEncounter, chamber: number): Promise<void> {
  const haul = getHaul(encounter);
  haul.money += chamber >= ANTIQUITY_CHAMBER ? ANTIQUITY_VALUE : TRIBUTE_VALUE;
  haul.finds += 1;

  // Deep chambers can also turn up the relic (only once).
  if (!haul.relic && chamber >= RELIC_CHAMBER && randSeedInt(10000) < Math.round(RELIC_CHANCE * 10000)) {
    haul.relic = true;
    setHaulTokens(encounter);
    queueEncounterMessage(`${namespace}:foundRelic`);
    return;
  }

  setHaulTokens(encounter);
  queueEncounterMessage(`${namespace}:foundTribute`);
}

/** Refresh the {{findCount}} / {{relicNote}} dialogue tokens from the live haul. */
function setHaulTokens(encounter: MysteryEncounter): void {
  const haul = getHaul(encounter);
  encounter.setDialogueToken("findCount", String(haul.finds));
  encounter.setDialogueToken("relicNote", haul.relic ? " and an ancient relic" : "");
}

/**
 * Hand the player the kept haul. The gathered money is paid out directly; the
 * relic, if found, is offered as a single post-resolution shop pick (a Rogue-tier
 * item or an evolution stone). With no money and no relic, nothing is granted.
 */
function awardHaul(money: number, relic: boolean): void {
  if (money > 0) {
    globalScene.playSound("item_fanfare");
    updatePlayerMoney(money, true, false);
  }
  if (relic) {
    // Half the time an evolution stone, half the time a Rogue-tier pick.
    if (randSeedInt(2) === 0) {
      setEncounterRewards({ guaranteedModifierTypeFuncs: [RELIC_EVO_FUNC], fillRemaining: false });
    } else {
      setEncounterRewards({ guaranteedModifierTiers: [ModifierTier.ROGUE], fillRemaining: false });
    }
  }
}

/** Enemy level for the guardian: the player's strongest mon, floored at the wave level. */
function guardianLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

/** Build the level-scaled wild Grass/Rock guardian for the temple-wakes fight. */
function buildGuardianBattle(): EnemyPartyConfig {
  const level = guardianLevel();
  const species = randSeedItem(GUARDIAN_SPECIES);
  return {
    pokemonConfigs: [{ species: getPokemonSpecies(species), isBoss: false, level }],
  };
}

/** The press-your-luck config the Temple hands to the shared substrate. */
function delveConfig(encounter: MysteryEncounter): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:delvePrompt`,
    pushLabelKey: `${namespace}:delve.push.label`,
    pushTooltipKey: `${namespace}:delve.push.tooltip`,
    bankLabelKey: `${namespace}:delve.bank.label`,
    bankTooltipKey: `${namespace}:delve.bank.tooltip`,
    bustChance: wakeChance,
    onPush: chamber => delveChamber(encounter, chamber),
    onBank: async chambersCompleted => {
      const haul = getHaul(encounter);
      if (chambersCompleted === 0) {
        // Turned back before entering - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      awardHaul(haul.money, haul.relic);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    },
    onBust: async () => {
      const haul = getHaul(encounter);
      // The trap buries part of the haul up front; the rest rides on the win.
      const kept = Math.floor(haul.money * (1 - WAKE_HAUL_LOSS));
      const scatteredFinds = Math.ceil(haul.finds * WAKE_HAUL_LOSS);
      encounter.setDialogueToken("scattered", String(scatteredFinds));
      queueEncounterMessage(`${namespace}:templeWakes`);
      // Pay the reduced haul now (relic shop opens after the win); a full party
      // wipe ends the run.
      awardHaul(kept, haul.relic);
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle());
    },
  };
}

export const OvergrownTempleEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_OVERGROWN_TEMPLE,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served chest key from Mysterious Chest (reads as a tribute
    // cache in the temple). Swap to a dedicated ruin/idol sprite once one is
    // uploaded to er-assets (images/mystery-encounters/<key>.png + .json).
    { spriteKey: "mysterious_chest_blue", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Reset the haul + prompt tokens so a re-rolled/forced encounter starts clean.
    encounter.misc = { delve: { money: 0, finds: 0, relic: false } satisfies DelveHaul };
    setHaulTokens(encounter);
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        // Start the delve loop: mark the encounter continuous, clear the intro
        // art, then hand off to the shared press-your-luck substrate.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.continuousEncounter = true;
        await transitionMysteryEncounterIntroVisuals(true, false);
        await startPressYourLuck(delveConfig(encounter));
        return true;
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      // Leave the temple undisturbed - no haul, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
