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
import { guardianForDepth } from "#data/elite-redux/er-delve-guardians";
import { applyErGuardianTokens } from "#data/elite-redux/er-fight-tokens";
import {
  emptyMineralHaul,
  type MineralLootHaul,
  mineralHaulHasItems,
  openMineralHaul,
  rollDelveWardOrBerry,
  rollKingsRock,
  rollMegaStone,
  rollMineralFind,
  rollMineralMoney,
} from "#data/elite-redux/er-mineral-loot";
import {
  type PressYourLuckConfig,
  resumePressYourLuck,
  startPressYourLuck,
} from "#data/elite-redux/er-press-your-luck";
import { ErSpeciesId } from "#enums/er-species-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
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
import { randSeedInt } from "#utils/common";
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
/** Levels added to the guardian per prior wake (deeper = deadlier). */
const GUARDIAN_LEVEL_PER_INTERRUPT = 6;
/** After this many wakes the temple's guardian becomes the chain's BOSS. */
const GUARDIAN_BOSS_AFTER_INTERRUPTS = 3;
/** A boss guardian is at least this many levels above the player's strongest mon. */
const BOSS_LEVELS_ABOVE = 5;
/** Percent chance per deep chamber to turn up a party-line mega stone (once/session). */
const MEGA_STONE_CHANCE = 4;

/** The Temple's guardians are GRASS/BUG-typed (jungle ruin); shared picker climbs BST. */
const TEMPLE_GUARDIAN_TYPES = [PokemonType.GRASS, PokemonType.BUG];

/**
 * The temple's awakened guardian and chain BOSS: Burmy Eterna, the Redux
 * Eterna-cloak cocoon ("Eternaburm"). A jungle-ruin god-bug, fitting as the
 * deepest threat of the delve.
 */
const TEMPLE_BOSS_SPECIES = ErSpeciesId.BURMY_ETERNA as unknown as SpeciesId;

/** What the Temple accumulates on `encounter.misc.delve`. */
interface DelveHaul {
  /** How many finds have been made (each pays its money at once). */
  finds: number;
  /** The item haul (ruin-found HELD items - relic stones, lenses, a sacred gem -
   * plus a rare party-line mega stone), cashed in as a reward shop on bank; lost
   * if a party wipe ends the run first. */
  loot: MineralLootHaul;
  /** How many temple-wakes have been survived (drives guardian escalation). */
  interrupts: number;
}

function defaultHaul(): DelveHaul {
  return { finds: 0, loot: emptyMineralHaul(), interrupts: 0 };
}

function getHaul(encounter: MysteryEncounter): DelveHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.delve) {
    encounter.misc.delve = defaultHaul();
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
  haul.finds += 1;

  // Roll this chamber's money: usually a jittered payout, sometimes nothing (a
  // dud), sometimes a big NUGGET. Pay it RIGHT AWAY (a temple-wakes fight never
  // costs what was already recovered).
  const money = rollMineralMoney(chamber >= ANTIQUITY_CHAMBER ? ANTIQUITY_VALUE : TRIBUTE_VALUE);
  if (money.amount > 0) {
    globalScene.playSound("item_fanfare");
    updatePlayerMoney(money.amount, true, false);
  }

  // An empty chamber turns up nothing. Otherwise a chamber can also turn up an
  // ITEM for the bank haul (deeper digs have better odds): a rare King's Rock, an
  // uncommon Eviolite / Mystical Rock, or, deep in, a party-line mega stone.
  let messageKey: string;
  if (money.kind === "dud") {
    messageKey = `${namespace}:foundNothing`;
  } else if (rollMegaStone(haul.loot, chamber, MEGA_STONE_CHANCE)) {
    messageKey = `${namespace}:foundMegaStone`;
  } else if (rollKingsRock(haul.loot, chamber)) {
    messageKey = `${namespace}:foundKingsRock`;
  } else if (chamber >= 1 && randSeedInt(100) < 12) {
    // The vines reclaiming the temple yield a Grassy Seed (jungle Grassy terrain).
    haul.loot.funcs.push(modifierTypes.ER_GRASSY_SEED);
    messageKey = `${namespace}:foundRelic`;
  } else if (rollDelveWardOrBerry(haul.loot, chamber)) {
    // Ward Stone / resist berry pried from the deeper chambers (find chance climbs with depth).
    messageKey = `${namespace}:foundRelic`;
  } else if (rollMineralFind(haul.loot, chamber, "relic")) {
    messageKey = `${namespace}:foundRelic`;
  } else if (money.kind === "nugget") {
    messageKey = `${namespace}:foundNugget`;
  } else {
    messageKey = `${namespace}:foundTribute`;
  }
  setHaulTokens(encounter);
  queueEncounterMessage(messageKey);
}

/** Refresh the {{findCount}} / {{relicNote}} dialogue tokens from the live haul. */
function setHaulTokens(encounter: MysteryEncounter): void {
  const haul = getHaul(encounter);
  encounter.setDialogueToken("findCount", String(haul.finds));
  encounter.setDialogueToken("relicNote", mineralHaulHasItems(haul.loot) ? " and a trove of relics" : "");
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
 * Build the wild guardian for the temple-wakes fight. Each prior wake pulls a
 * tougher species and raises its level (BST + level climb beyond the wave cap).
 * Past {@linkcode GUARDIAN_BOSS_AFTER_INTERRUPTS} the temple fully wakes: the
 * guardian becomes the chain BOSS - Burmy Eterna ({@linkcode TEMPLE_BOSS_SPECIES})
 * with 2-3 health bars and at least {@linkcode BOSS_LEVELS_ABOVE} levels over the
 * player's strongest mon.
 */
function buildGuardianBattle(interrupts: number): EnemyPartyConfig {
  const isBoss = interrupts >= GUARDIAN_BOSS_AFTER_INTERRUPTS;
  if (isBoss) {
    const level = Math.max(
      guardianLevel() + interrupts * GUARDIAN_LEVEL_PER_INTERRUPT,
      guardianLevel() + BOSS_LEVELS_ABOVE,
    );
    // Guard against the ER custom not being registered (the unresolved-species
    // class of crash, cf. Graves): fall back to a top-BST themed guardian.
    const bossSpecies =
      getPokemonSpecies(TEMPLE_BOSS_SPECIES) ?? guardianForDepth(TEMPLE_GUARDIAN_TYPES, interrupts, true);
    return {
      pokemonConfigs: [{ species: bossSpecies, isBoss: true, bossSegments: 2 + randSeedInt(2), level }],
    };
  }
  // A Grass/Bug guardian whose BST climbs with depth (shared picker).
  const level = guardianLevel() + interrupts * GUARDIAN_LEVEL_PER_INTERRUPT;
  return {
    pokemonConfigs: [{ species: guardianForDepth(TEMPLE_GUARDIAN_TYPES, interrupts, false), isBoss: false, level }],
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
      if (chambersCompleted === 0 && haul.finds === 0) {
        // Turned back before entering - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      // Money was paid per chamber; cash in the item haul as a reward shop (if any).
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
      // The temple-wakes fight is NOT terminal: the money you have is already paid,
      // so nothing is lost. WIN and delving RESUMES (each wake makes the next
      // guardian tougher). A full party wipe ends the run as any battle would.
      haul.interrupts += 1;
      queueEncounterMessage(`${namespace}:templeWakes`);
      encounter.doContinueEncounter = async () => {
        encounter.doContinueEncounter = undefined;
        await resumePressYourLuck(delveConfig(encounter));
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle(haul.interrupts));
      // Depth-scaled challenge tokens for this delve fight only (Poison-themed for
      // the overgrown jungle); cleared after the battle by doPostBattleCleanup.
      applyErGuardianTokens(haul.interrupts - 1, { statusType: StatusEffect.POISON });
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
    // An ancient living-fossil sentinel of the ruin (Cradily).
    { species: SpeciesId.CRADILY, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Reset the haul + prompt tokens so a re-rolled/forced encounter starts clean.
    encounter.misc = { delve: defaultHaul() };
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
