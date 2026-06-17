/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Tide Pools. A BEACH-biome press-your-luck COMB loop along a rocky
// shoreline at low tide, and another consumer of the reusable press-your-luck
// substrate (er-press-your-luck.ts). It mirrors the Glittering Vein: each round
// the player either PACKS UP and leaves with the safe haul, or KEEPS COMBING for
// more - but every reach into the pools raises the chance a territorial Water mon
// sweeps in on the tide and forces a fight.
//
//   Round haul: early combs turn up loose shells (a small money payout); later
//     rounds reach the deeper pools for finer pickings (a bigger payout) and, deep
//     in, a chance at a held curio (Eviolite / Mystical Rock), a rare King's Rock,
//     or a party-line mega stone. Money is paid per round; the items are cashed in
//     as a reward shop on bank.
//   PACK UP (bank): keep everything combed so far, leave in peace. Banking at
//     round 0 = nothing, no cost.
//   KEEP COMBING (push) + survive: the haul grows, prompt again.
//   KEEP COMBING (push) + the tide TURNS: a level-scaled wild Water mon attacks.
//     The money you have is already paid; WIN and combing RESUMES (each interrupt
//     escalates the next guardian). A full party wipe ends the run as any battle
//     would - the branch never softlocks the forced encounter.
//
// Tuning lives in the constants below. This is a THIN config on top of the shared
// substrate - the loop itself lives in er-press-your-luck.ts.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import {
  emptyMineralHaul,
  type MineralLootHaul,
  mineralHaulHasItems,
  openMineralHaul,
  rollMegaStone,
  rollMineralMoney,
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
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/tidePools";

// --- Combing tuning -------------------------------------------------------- //

/** Money a shallow-pool comb (rounds 0-1) is worth. */
const SHELL_VALUE = 80;
/** Money a deep-pool comb (round 2+) is worth. */
const DEEP_VALUE = 200;

/** Base bust chance for the very first comb, in [0, 1]. */
const BUST_BASE = 0.12;
/** Added to the bust chance per round (round 0 = BUST_BASE). */
const BUST_PER_ROUND = 0.13;
/** The bust chance never exceeds this, so a deep comb is risky but not hopeless. */
const BUST_MAX = 0.8;

/** Round (0-indexed comb count) at and beyond which the pools turn to finer pickings. */
const DEEP_ROUND = 2;
/** Levels added to the guardian per prior interrupt (deeper = deadlier). */
const GUARDIAN_LEVEL_PER_INTERRUPT = 6;
/** After this many interrupts the guardian becomes the chain's BOSS. */
const GUARDIAN_BOSS_AFTER_INTERRUPTS = 3;
/** A boss guardian is at least this many levels above the player's strongest mon. */
const BOSS_LEVELS_ABOVE = 5;
/** Percent chance per deep comb to turn up a party-line mega stone (once/session). */
const MEGA_STONE_CHANCE = 3;

// --- Beach find pool (Tide Pools' OWN items, not the shared mineral pool) --- //
//
// A tide pool is mostly MONEY (shells/pearls, paid per comb). On top of that a
// comb can wash up a piece of gear - common, sea-worn held items - and, rarely,
// the standout SHELL BELL. Deliberately humble and money-first: this is a beach,
// not a treasure vault.

// Common washed-up gear by KEY (resolved lazily - modifierTypes is empty until
// initModifierTypes() runs, so module-load func capture would freeze undefined).
const BEACH_FIND_KEYS = ["LEFTOVERS", "WIDE_LENS", "QUICK_CLAW", "SCOPE_LENS"] as const;

/** Of the combs that DO wash up gear, this % are the rare Shell Bell instead. */
const SHELL_BELL_SHARE = 14;

/**
 * Percent chance a comb at depth `d` (0-indexed) washes up a held item at all.
 * Intentionally lower than the mineral delves - the beach pays in money first,
 * an item is the uncommon bonus on a deeper reach.
 */
function beachFindChance(d: number): number {
  // Probabilistic from the first comb (no hard-zero gate); the beach is still
  // money-first, so these stay lower than the mineral delves.
  if (d <= 0) {
    return 8;
  }
  if (d === 1) {
    return 12;
  }
  if (d === 2) {
    return 18;
  }
  if (d === 3) {
    return 24;
  }
  return 30;
}

/**
 * Roll for a washed-up item find at comb depth `d`. Mostly common sea-worn gear;
 * rarely the standout Shell Bell. Adds the find to the haul's funcs on a hit.
 */
function rollBeachFind(haul: MineralLootHaul, d: number): boolean {
  if (randSeedInt(100) >= beachFindChance(d)) {
    return false;
  }
  const registry = modifierTypes as Record<string, ModifierTypeFunc | undefined>;
  const func = randSeedInt(100) < SHELL_BELL_SHARE ? registry.SHELL_BELL : registry[randSeedItem([...BEACH_FIND_KEYS])];
  if (!func) {
    return false;
  }
  haul.funcs.push(func);
  return true;
}

/**
 * Thematic wild Water guardians, ordered weakest -> strongest. Deeper interrupts
 * pull from further down the list (escalating BST beyond the wave cap); the boss
 * is the last, toughest entry.
 */
const GUARDIAN_SPECIES: SpeciesId[] = [SpeciesId.CORSOLA, SpeciesId.CRAWDAUNT, SpeciesId.KINGLER, SpeciesId.GYARADOS];

/** What Tide Pools accumulates on `encounter.misc.comb`. */
interface CombHaul {
  /** How many combs have landed (each pays its money at once). */
  finds: number;
  /** The item haul (shore curios - plus a rare party-line mega stone), cashed in
   * as a reward shop on bank; lost if a party wipe ends the run first. */
  loot: MineralLootHaul;
  /** How many tide-turns have been survived (drives guardian escalation). */
  interrupts: number;
}

function defaultHaul(): CombHaul {
  return { finds: 0, loot: emptyMineralHaul(), interrupts: 0 };
}

function getHaul(encounter: MysteryEncounter): CombHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.comb) {
    encounter.misc.comb = defaultHaul();
  }
  return encounter.misc.comb as CombHaul;
}

/** Escalating per-round bust chance, clamped to [BUST_BASE, BUST_MAX]. */
function bustChance(round: number): number {
  return Math.min(BUST_BASE + round * BUST_PER_ROUND, BUST_MAX);
}

/** Grow the haul for a survived comb entering `round`, and refresh the prompt token. */
async function combRound(encounter: MysteryEncounter, round: number): Promise<void> {
  const haul = getHaul(encounter);
  haul.finds += 1;

  // Roll this comb's money: usually a jittered payout, sometimes nothing (a dud),
  // sometimes a big NUGGET. Pay it RIGHT AWAY (a tide-turn fight never costs what
  // was already gathered).
  const money = rollMineralMoney(round >= DEEP_ROUND ? DEEP_VALUE : SHELL_VALUE);
  if (money.amount > 0) {
    globalScene.playSound("item_fanfare");
    updatePlayerMoney(money.amount, true, false);
  }

  // An empty comb turns up nothing. Otherwise the beach pays in MONEY first; a
  // deeper comb can also wash up a held item for the bank haul (common sea-worn
  // gear, rarely a Shell Bell), or - deep in, very rarely - a party-line mega stone.
  let messageKey: string;
  if (money.kind === "dud") {
    messageKey = `${namespace}:foundNothing`;
  } else if (rollMegaStone(haul.loot, round, MEGA_STONE_CHANCE)) {
    messageKey = `${namespace}:foundMegaStone`;
  } else if (rollBeachFind(haul.loot, round)) {
    messageKey = `${namespace}:foundCurio`;
  } else if (money.kind === "nugget") {
    messageKey = `${namespace}:foundPearl`;
  } else {
    messageKey = `${namespace}:foundShells`;
  }
  setHaulTokens(encounter);
  queueEncounterMessage(messageKey);
}

/** Refresh the {{combCount}} / {{treasureNote}} dialogue tokens from the live haul. */
function setHaulTokens(encounter: MysteryEncounter): void {
  const haul = getHaul(encounter);
  encounter.setDialogueToken("combCount", String(haul.finds));
  encounter.setDialogueToken("treasureNote", mineralHaulHasItems(haul.loot) ? " and a stash of curios" : "");
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
 * Build the wild Water guardian for the tide-turn fight. Each prior interrupt
 * pulls a tougher species (ascending BST) and raises its level beyond the wave
 * cap. Past {@linkcode GUARDIAN_BOSS_AFTER_INTERRUPTS} it becomes the chain's
 * BOSS: 2-3 health bars and at least {@linkcode BOSS_LEVELS_ABOVE} levels over
 * the player's strongest mon.
 */
function buildGuardianBattle(interrupts: number): EnemyPartyConfig {
  const isBoss = interrupts >= GUARDIAN_BOSS_AFTER_INTERRUPTS;
  const speciesIdx = Math.min(interrupts, GUARDIAN_SPECIES.length - 1);
  const toughestIdx = GUARDIAN_SPECIES.length - 1;
  const species = getPokemonSpecies(GUARDIAN_SPECIES[isBoss ? toughestIdx : speciesIdx]);
  let level = guardianLevel() + interrupts * GUARDIAN_LEVEL_PER_INTERRUPT;
  if (isBoss) {
    level = Math.max(level, guardianLevel() + BOSS_LEVELS_ABOVE);
  }
  return {
    pokemonConfigs: [
      isBoss ? { species, isBoss: true, bossSegments: 2 + randSeedInt(2), level } : { species, isBoss: false, level },
    ],
  };
}

/** The press-your-luck config Tide Pools hands to the shared substrate. */
function combConfig(encounter: MysteryEncounter): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:combPrompt`,
    pushLabelKey: `${namespace}:comb.push.label`,
    pushTooltipKey: `${namespace}:comb.push.tooltip`,
    bankLabelKey: `${namespace}:comb.bank.label`,
    bankTooltipKey: `${namespace}:comb.bank.tooltip`,
    bustChance,
    onPush: round => combRound(encounter, round),
    onBank: async roundsCompleted => {
      const haul = getHaul(encounter);
      if (roundsCompleted === 0 && haul.finds === 0) {
        // Walked away before combing anything - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      // Money was paid per comb; cash in the item haul as a reward shop (if any).
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
      // The tide-turn is NOT terminal: the money you have is already paid, so
      // nothing is lost. WIN the fight and combing RESUMES (each interrupt makes
      // the next guardian tougher). A full party wipe ends the run as any battle would.
      haul.interrupts += 1;
      queueEncounterMessage(`${namespace}:tideTurns`);
      encounter.doContinueEncounter = async () => {
        encounter.doContinueEncounter = undefined;
        await resumePressYourLuck(combConfig(encounter));
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle(haul.interrupts));
    },
  };
}

export const TidePoolsEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_TIDE_POOLS,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served chest key (reads as a wave-washed cache among the
    // rocks). Swap to a dedicated tide-pool sprite once one is uploaded to
    // er-assets (images/mystery-encounters/<key>.png + .json).
    // A reef-dweller stranded in the low-tide pools (Corsola).
    { species: SpeciesId.CORSOLA, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Reset the haul + prompt tokens so a re-rolled/forced encounter starts clean.
    encounter.misc = { comb: defaultHaul() };
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
        // Start the combing loop: mark the encounter continuous, clear the intro
        // art, then hand off to the shared press-your-luck substrate.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.continuousEncounter = true;
        await transitionMysteryEncounterIntroVisuals(true, false);
        await startPressYourLuck(combConfig(encounter));
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
      // Move on without combing - no haul, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
