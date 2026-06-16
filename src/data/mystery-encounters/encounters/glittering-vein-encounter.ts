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
import {
  emptyMineralHaul,
  type MineralLootHaul,
  mineralHaulHasItems,
  openMineralHaul,
  rollMegaStone,
  rollMineralFind,
} from "#data/elite-redux/er-mineral-loot";
import {
  type PressYourLuckConfig,
  resumePressYourLuck,
  startPressYourLuck,
} from "#data/elite-redux/er-press-your-luck";
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
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedItem } from "#utils/common";
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
/** Levels added to the guardian per prior cave-in (deeper = deadlier). */
const GUARDIAN_LEVEL_PER_INTERRUPT = 6;
/** After this many cave-ins the guardian becomes a BOSS. */
const GUARDIAN_BOSS_AFTER_INTERRUPTS = 3;
/** Percent chance per deep strike to turn up a party-line mega stone (once/session). */
const MEGA_STONE_CHANCE = 4;

/** Thematic wild Rock/Ground guardians for the cave-in fight. */
const GUARDIAN_SPECIES: SpeciesId[] = [SpeciesId.ONIX, SpeciesId.GRAVELER, SpeciesId.RHYDON, SpeciesId.GIGALITH];

/** What the Vein accumulates on `encounter.misc.mine`. */
interface MineHaul {
  /** How many ore/gem strikes have landed (each pays its money at once). */
  finds: number;
  /** The item haul (themed gems/stones/vitamins/TMs + a rare party-line mega stone),
   * cashed in as a reward shop on bank; lost if a party wipe ends the run first. */
  loot: MineralLootHaul;
  /** How many cave-ins have been survived (drives guardian escalation). */
  interrupts: number;
}

function defaultHaul(): MineHaul {
  return { finds: 0, loot: emptyMineralHaul(), interrupts: 0 };
}

function getHaul(encounter: MysteryEncounter): MineHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.mine) {
    encounter.misc.mine = defaultHaul();
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
  // Pay the strike's value RIGHT AWAY (visible +money each round, and a cave-in
  // fight never costs what was already chipped out).
  globalScene.playSound("item_fanfare");
  updatePlayerMoney(round >= GEM_ROUND ? GEM_VALUE : ORE_VALUE, true, false);
  haul.finds += 1;

  // Each strike can also turn up an ITEM for the bank haul (deeper = better tier),
  // and a deep strike has a rare shot at a party-line mega stone.
  const gotMega = rollMegaStone(haul.loot, round, MEGA_STONE_CHANCE);
  const gotItem = rollMineralFind(haul.loot, round, "mineral");
  setHaulTokens(encounter);
  if (gotMega) {
    queueEncounterMessage(`${namespace}:foundMegaStone`);
  } else if (gotItem) {
    queueEncounterMessage(`${namespace}:foundTreasure`);
  } else {
    queueEncounterMessage(`${namespace}:foundOre`);
  }
}

/** Refresh the {{oreCount}} / {{jackpotNote}} dialogue tokens from the live haul. */
function setHaulTokens(encounter: MysteryEncounter): void {
  const haul = getHaul(encounter);
  encounter.setDialogueToken("oreCount", String(haul.finds));
  encounter.setDialogueToken(
    "jackpotNote",
    mineralHaulHasItems(haul.loot) ? " and a glittering hoard of treasure" : "",
  );
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

/**
 * Build the level-scaled wild Rock/Ground guardian for the cave-in fight. Each
 * prior cave-in raises its level, and past {@linkcode GUARDIAN_BOSS_AFTER_INTERRUPTS}
 * it becomes a BOSS - so the deeper a dig session runs, the deadlier it gets.
 */
function buildGuardianBattle(interrupts: number): EnemyPartyConfig {
  const level = guardianLevel() + interrupts * GUARDIAN_LEVEL_PER_INTERRUPT;
  const species = randSeedItem(GUARDIAN_SPECIES);
  return {
    pokemonConfigs: [
      { species: getPokemonSpecies(species), isBoss: interrupts >= GUARDIAN_BOSS_AFTER_INTERRUPTS, level },
    ],
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
      if (roundsCompleted === 0 && haul.finds === 0) {
        // Walked away before digging anything - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      // Money was paid per strike; cash in the item haul as a reward shop (if any).
      const hasShop = openMineralHaul(haul.loot);
      await transitionMysteryEncounterIntroVisuals(true, true);
      if (hasShop) {
        leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
      } else {
        leaveEncounterWithoutBattle(true);
      }
    },
    onBust: async () => {
      const haul = getHaul(encounter);
      // The cave-in is NOT terminal: the money you have is already paid, so nothing
      // is lost. WIN the fight and mining RESUMES (each cave-in makes the next
      // guardian tougher). A full party wipe ends the run as any battle would.
      haul.interrupts += 1;
      queueEncounterMessage(`${namespace}:caveInAmbush`);
      encounter.doContinueEncounter = async () => {
        encounter.doContinueEncounter = undefined;
        await resumePressYourLuck(mineConfig(encounter));
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle(haul.interrupts));
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
    encounter.misc = { mine: defaultHaul() };
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
