/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Glittering Vein. A CAVE-biome press-your-luck MINING loop in a
// gem-rich seam, and a second consumer of the reusable press-your-luck substrate
// (er-press-your-luck.ts). It mirrors the Woodland Forager exactly: each round the
// player either PACKS UP and leaves with the safe haul, or KEEPS DIGGING for more
// - but every strike raises the chance a cave-in / territorial Rock-or-Ground mon
// AMBUSHES and forces a fight.
//
//   Round haul: early strikes chip out plain ore (a small money payout); later
//     rounds turn up finer gems (a bigger money payout) and, deep in, a small
//     chance at a single jackpot - a Rogue-tier item or an evolution stone (an
//     early evo-item source, mirroring the design's mega-stone idea). The money is
//     paid on bank/win; the jackpot is offered as a single post-resolution shop pick.
//   PACK UP (bank): keep everything dug out so far, leave in peace. Banking at
//     round 0 = nothing, no cost.
//   KEEP DIGGING (push) + survive: the haul grows, prompt again.
//   KEEP DIGGING (push) + the wall GIVES WAY: a level-scaled wild Rock/Ground mon
//     (Onix / Graveler / Rhydon / Gigalith, built via initBattleWithEnemyConfig)
//     attacks. The cave-in scatters PART of the haul (a fraction of the gathered
//     money is lost up front); the kept money is paid immediately and any jackpot
//     is set as the reward shop, which opens after the win (Graves combat-branch
//     pattern). A full party wipe ends the run as any battle would - the branch
//     never softlocks a forced encounter.
//
// Tuning lives in the constants below. This is intentionally a THIN config on top
// of the shared substrate - the loop itself lives in er-press-your-luck.ts.
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

const namespace = "mysteryEncounters/glitteringVein";

// --- Mining tuning --------------------------------------------------------- //

/** Money a plain-ore strike (rounds 0-1) is worth. */
const ORE_VALUE = 80;
/** Money a fine-gem strike (round 2+) is worth. */
const GEM_VALUE = 200;

/** Base bust chance for the very first strike, in [0, 1]. */
const BUST_BASE = 0.12;
/** Added to the bust chance per round (round 0 = BUST_BASE). */
const BUST_PER_ROUND = 0.13;
/** The bust chance never exceeds this, so a deep dig is risky but not hopeless. */
const BUST_MAX = 0.8;

/** Round (0-indexed strike count) at and beyond which the seam turns to fine gems. */
const GEM_ROUND = 2;
/** Round at/after which each surviving strike has a small shot at the jackpot. */
const JACKPOT_ROUND = 3;
/** Chance per qualifying strike to turn up the jackpot. */
const JACKPOT_CHANCE = 0.2;
/** Fraction of the gathered money the cave-in scatters when it interrupts. */
const BUST_HAUL_LOSS = 0.5;

/** The two jackpot prizes (one is rolled when the jackpot hits): a Rogue-tier pick
 * or an evolution stone (an early evo-item source, mirroring the mega-stone idea). */
const JACKPOT_EVO_FUNC: ModifierTypeFunc = modifierTypes.RARE_EVOLUTION_ITEM;

/** Thematic wild Rock/Ground guardians for the cave-in fight. */
const GUARDIAN_SPECIES: SpeciesId[] = [SpeciesId.ONIX, SpeciesId.GRAVELER, SpeciesId.RHYDON, SpeciesId.GIGALITH];

/** What the Vein accumulates on `encounter.misc.mine`. */
interface MineHaul {
  /** Money chipped out so far (paid to the player on bank/win). */
  money: number;
  /** How many ore/gem strikes have landed (drives the {{oreCount}} token). */
  finds: number;
  /** Whether the jackpot has been struck (an evolution-stone / Rogue shop pick). */
  jackpot: boolean;
}

function getHaul(encounter: MysteryEncounter): MineHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.mine) {
    encounter.misc.mine = { money: 0, finds: 0, jackpot: false } satisfies MineHaul;
  }
  return encounter.misc.mine as MineHaul;
}

/** Escalating per-round bust chance, clamped to [BUST_BASE, BUST_MAX]. */
function bustChance(round: number): number {
  return Math.min(BUST_BASE + round * BUST_PER_ROUND, BUST_MAX);
}

/** Grow the haul for a survived strike entering `round`, and refresh the prompt token. */
async function mineRound(encounter: MysteryEncounter, round: number): Promise<void> {
  const haul = getHaul(encounter);
  haul.money += round >= GEM_ROUND ? GEM_VALUE : ORE_VALUE;
  haul.finds += 1;

  // Deep strikes can also turn up the jackpot (only once).
  if (!haul.jackpot && round >= JACKPOT_ROUND && randSeedInt(10000) < Math.round(JACKPOT_CHANCE * 10000)) {
    haul.jackpot = true;
    setHaulTokens(encounter);
    queueEncounterMessage(`${namespace}:foundJackpot`);
    return;
  }

  setHaulTokens(encounter);
  queueEncounterMessage(`${namespace}:foundOre`);
}

/** Refresh the {{oreCount}} / {{jackpotNote}} dialogue tokens from the live haul. */
function setHaulTokens(encounter: MysteryEncounter): void {
  const haul = getHaul(encounter);
  encounter.setDialogueToken("oreCount", String(haul.finds));
  encounter.setDialogueToken("jackpotNote", haul.jackpot ? " and a glittering treasure" : "");
}

/**
 * Hand the player the kept haul. The gathered money is paid out directly; the
 * jackpot, if struck, is offered as a single post-resolution shop pick (a Rogue-
 * tier item or an evolution stone). With no money and no jackpot, nothing is
 * granted (no empty shop is opened).
 */
function awardHaul(money: number, jackpot: boolean): void {
  if (money > 0) {
    globalScene.playSound("item_fanfare");
    updatePlayerMoney(money, true, false);
  }
  if (jackpot) {
    // Half the time an evolution stone, half the time a Rogue-tier pick.
    if (randSeedInt(2) === 0) {
      setEncounterRewards({ guaranteedModifierTypeFuncs: [JACKPOT_EVO_FUNC], fillRemaining: false });
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

/** Build the level-scaled wild Rock/Ground guardian for the cave-in fight. */
function buildGuardianBattle(): EnemyPartyConfig {
  const level = guardianLevel();
  const species = randSeedItem(GUARDIAN_SPECIES);
  return {
    pokemonConfigs: [{ species: getPokemonSpecies(species), isBoss: false, level }],
  };
}

/** The press-your-luck config the Vein hands to the shared substrate. */
function mineConfig(encounter: MysteryEncounter): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:minePrompt`,
    pushLabelKey: `${namespace}:mine.push.label`,
    pushTooltipKey: `${namespace}:mine.push.tooltip`,
    bankLabelKey: `${namespace}:mine.bank.label`,
    bankTooltipKey: `${namespace}:mine.bank.tooltip`,
    bustChance,
    onPush: round => mineRound(encounter, round),
    onBank: async roundsCompleted => {
      const haul = getHaul(encounter);
      if (roundsCompleted === 0) {
        // Walked away before digging anything - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      awardHaul(haul.money, haul.jackpot);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    },
    onBust: async () => {
      const haul = getHaul(encounter);
      // The cave-in buries part of the haul up front; the rest rides on the win.
      const kept = Math.floor(haul.money * (1 - BUST_HAUL_LOSS));
      const scatteredFinds = Math.ceil(haul.finds * BUST_HAUL_LOSS);
      encounter.setDialogueToken("scattered", String(scatteredFinds));
      queueEncounterMessage(`${namespace}:caveInAmbush`);
      // Pay the reduced haul now (jackpot shop opens after the win - Graves combat-
      // branch pattern); a full party wipe ends the run.
      awardHaul(kept, haul.jackpot);
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle());
    },
  };
}

export const GlitteringVeinEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_GLITTERING_VEIN,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served chest key from Mysterious Chest (reads as a buried
    // treasure cache in the cave wall). Swap to a dedicated vein/ore sprite once one
    // is uploaded to er-assets (images/mystery-encounters/<key>.png + .json).
    { spriteKey: "mysterious_chest_blue", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Reset the haul + prompt tokens so a re-rolled/forced encounter starts clean.
    encounter.misc = { mine: { money: 0, finds: 0, jackpot: false } satisfies MineHaul };
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
        // Start the mining loop: mark the encounter continuous, clear the intro
        // art, then hand off to the shared press-your-luck substrate.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.continuousEncounter = true;
        await transitionMysteryEncounterIntroVisuals(true, false);
        await startPressYourLuck(mineConfig(encounter));
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
      // Move on without mining - no haul, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
