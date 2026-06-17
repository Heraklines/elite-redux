/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Abyssal Vent. A SEABED-biome press-your-luck DELVE down a
// hydrothermal trench, and another consumer of the reusable press-your-luck
// substrate (er-press-your-luck.ts). It mirrors the Overgrown Temple: each
// descent the player either RISES with the safe haul, or dives DEEPER for richer
// mineral wealth - but every level down raises the chance a deep-sea guardian
// stirs from the dark and attacks.
//
//   Descent haul: shallow vents yield loose shards (a small money payout); deeper
//     vents turn up real mineral wealth (a bigger payout) and, deep in, a chance
//     at a held curio (Eviolite / Mystical Rock), a rare King's Rock, or a
//     party-line mega stone. Money is paid per descent; items cash in on bank.
//   RISE (bank): keep everything found and surface. Banking at level 0 = nothing.
//   DIVE DEEPER (push) + survive: the haul grows, prompt again.
//   DIVE DEEPER (push) + the trench STIRS: a level-scaled wild deep-sea guardian
//     attacks. Money already earned is safe; WIN and the dive RESUMES (each stir
//     escalates the next guardian). A party wipe ends the run as any battle would.
//
// Tuning lives in the constants below. This is a THIN config on top of the shared
// substrate - the loop itself lives in er-press-your-luck.ts.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { guardianForDepth } from "#data/elite-redux/er-delve-guardians";
import { applyErGuardianTokens } from "#data/elite-redux/er-fight-tokens";
import {
  emptyMineralHaul,
  type MineralLootHaul,
  mineralHaulHasItems,
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
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { CustomModifierSettings } from "#modifiers/modifier-type";
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
import { randSeedInt } from "#utils/common";

const namespace = "mysteryEncounters/abyssalVent";

// --- Descent tuning -------------------------------------------------------- //

/** Money a shallow-vent find (levels 0-1) is worth. */
const SHARD_VALUE = 90;
/** Money a deep-vent find (level 2+) is worth. */
const WEALTH_VALUE = 240;

/** Base stir chance for the very first descent, in [0, 1]. */
const STIR_BASE = 0.12;
/** Added to the stir chance per level. The Vent is much more DANGEROUS than the
 * surface delves, so it ramps faster than the others. */
const STIR_PER_LEVEL = 0.18;
/** The stir chance never exceeds this, so a deep dive is risky but not hopeless. */
const STIR_MAX = 0.85;

/** Fraction of max HP the crushing pressure/cold chips off each non-Water mon per descent. */
const VENT_CHIP = 1 / 16;
/** The dive turns up at most this many held items (rare bonus; the depth reward is the draw). */
const MAX_VENT_ITEMS = 2;

/** Level (0-indexed descent count) at and beyond which finds become mineral wealth. */
const WEALTH_LEVEL = 2;
/** Levels added to the guardian per prior stir (deeper = deadlier). */
const GUARDIAN_LEVEL_PER_INTERRUPT = 6;
/** After this many stirs the trench's guardian becomes the chain's BOSS. */
const GUARDIAN_BOSS_AFTER_INTERRUPTS = 3;
/** A boss guardian is at least this many levels above the player's strongest mon (the abyss is deadly). */
const BOSS_LEVELS_ABOVE = 8;
/** Percent chance per deep descent to turn up a party-line mega stone (once/session). */
const MEGA_STONE_CHANCE = 4;

/** The Vent's guardians are WATER-typed (deep-sea); the shared picker climbs BST. */
const VENT_GUARDIAN_TYPES = [PokemonType.WATER];

/** What the Vent accumulates on `encounter.misc.dive`. */
interface DiveHaul {
  /** How many descents have been made (each pays its money at once). */
  finds: number;
  /** The item haul (deep-sea curios - plus a rare party-line mega stone), cashed
   * in as a reward shop on bank; lost if a party wipe ends the run first. */
  loot: MineralLootHaul;
  /** How many trench-stirs have been survived (drives guardian escalation). */
  interrupts: number;
}

function defaultHaul(): DiveHaul {
  return { finds: 0, loot: emptyMineralHaul(), interrupts: 0 };
}

function getHaul(encounter: MysteryEncounter): DiveHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.dive) {
    encounter.misc.dive = defaultHaul();
  }
  return encounter.misc.dive as DiveHaul;
}

/** Escalating per-level stir chance, clamped to [STIR_BASE, STIR_MAX]. */
function stirChance(level: number): number {
  return Math.min(STIR_BASE + level * STIR_PER_LEVEL, STIR_MAX);
}

/** Crush every non-Water, non-fainted party member for the pressure chip (floored at 1 HP). Returns how many were hit. */
function applyVentChip(): number {
  let strained = 0;
  for (const mon of globalScene.getPlayerParty()) {
    if (mon.isFainted() || mon.getTypes(false, false, true).includes(PokemonType.WATER)) {
      continue;
    }
    const chip = Math.max(1, Math.floor(mon.getMaxHp() * VENT_CHIP));
    mon.hp = Math.max(1, mon.hp - chip);
    mon.updateInfo();
    strained++;
  }
  return strained;
}

/** How many held items the dive has turned up so far (funcs + pre-genned options). */
function ventItemCount(haul: DiveHaul): number {
  return haul.loot.funcs.length + haul.loot.options.length;
}

/**
 * The guaranteed reward TIER for surfacing after `deepest` descents - it ramps
 * with depth (the deeper you push the abyss, the better the prize): 2 -> Great,
 * 4 -> Ultra, 8 -> Rogue, 16+ -> Master (the cap).
 */
function rewardTierForDepth(deepest: number): ModifierTier {
  if (deepest >= 16) {
    return ModifierTier.MASTER;
  }
  if (deepest >= 8) {
    return ModifierTier.ROGUE;
  }
  if (deepest >= 4) {
    return ModifierTier.ULTRA;
  }
  return ModifierTier.GREAT;
}

/** Grow the haul for a survived descent entering `level`, and refresh the prompt token. */
async function diveLevel(encounter: MysteryEncounter, level: number): Promise<void> {
  const haul = getHaul(encounter);
  haul.finds += 1;

  // Roll this descent's money: usually a jittered payout, sometimes nothing (a
  // dud), sometimes a big NUGGET. Pay it RIGHT AWAY (a trench-stir fight never
  // costs what was already gathered).
  const money = rollMineralMoney(level >= WEALTH_LEVEL ? WEALTH_VALUE : SHARD_VALUE);
  if (money.amount > 0) {
    globalScene.playSound("item_fanfare");
    updatePlayerMoney(money.amount, true, false);
  }

  // The Vent pays in MONEY first. ITEMS are a RARE bonus: only attempt a find on
  // ~18% of descents, and the dive turns up AT MOST MAX_VENT_ITEMS in total - the
  // real draw is the depth-scaled reward on surfacing.
  const mayFindItem = ventItemCount(haul) < MAX_VENT_ITEMS && randSeedInt(100) < 18;
  let messageKey: string;
  if (money.kind === "dud") {
    messageKey = `${namespace}:foundNothing`;
  } else if (mayFindItem && rollMegaStone(haul.loot, level, MEGA_STONE_CHANCE)) {
    messageKey = `${namespace}:foundMegaStone`;
  } else if (mayFindItem && rollKingsRock(haul.loot, level)) {
    messageKey = `${namespace}:foundKingsRock`;
  } else if (mayFindItem && rollDelveWardOrBerry(haul.loot, level)) {
    // Ward Stone / resist berry dug from the deep vent.
    messageKey = `${namespace}:foundCurio`;
  } else if (mayFindItem && rollMineralFind(haul.loot, level, "relic")) {
    messageKey = `${namespace}:foundCurio`;
  } else if (money.kind === "nugget") {
    messageKey = `${namespace}:foundNugget`;
  } else {
    messageKey = `${namespace}:foundShards`;
  }
  setHaulTokens(encounter);
  queueEncounterMessage(messageKey);

  // The abyss crushes non-Water mons each descent - make the toll clear.
  if (applyVentChip() > 0) {
    queueEncounterMessage(`${namespace}:strained`);
  }
}

/** Refresh the {{diveCount}} / {{treasureNote}} dialogue tokens from the live haul. */
function setHaulTokens(encounter: MysteryEncounter): void {
  const haul = getHaul(encounter);
  encounter.setDialogueToken("diveCount", String(haul.finds));
  encounter.setDialogueToken("treasureNote", mineralHaulHasItems(haul.loot) ? " and a trove of curios" : "");
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
 * Build the wild deep-sea guardian for the trench-stir fight. Each prior stir
 * pulls a tougher species (ascending BST) and raises its level beyond the wave
 * cap. Past {@linkcode GUARDIAN_BOSS_AFTER_INTERRUPTS} it becomes the chain's
 * BOSS: 2-3 health bars and at least {@linkcode BOSS_LEVELS_ABOVE} levels over
 * the player's strongest mon.
 */
function buildGuardianBattle(interrupts: number): EnemyPartyConfig {
  const isBoss = interrupts >= GUARDIAN_BOSS_AFTER_INTERRUPTS;
  // A Water guardian whose BST climbs with depth (shared picker), boss at the top.
  const species = guardianForDepth(VENT_GUARDIAN_TYPES, interrupts, isBoss);
  let level = guardianLevel() + interrupts * GUARDIAN_LEVEL_PER_INTERRUPT;
  if (isBoss) {
    level = Math.max(level, guardianLevel() + BOSS_LEVELS_ABOVE);
  }
  return {
    pokemonConfigs: [
      isBoss ? { species, isBoss: true, bossSegments: 3 + randSeedInt(2), level } : { species, isBoss: false, level },
    ],
  };
}

/** The press-your-luck config the Vent hands to the shared substrate. */
function diveConfig(encounter: MysteryEncounter): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:divePrompt`,
    pushLabelKey: `${namespace}:dive.push.label`,
    pushTooltipKey: `${namespace}:dive.push.tooltip`,
    bankLabelKey: `${namespace}:dive.bank.label`,
    bankTooltipKey: `${namespace}:dive.bank.tooltip`,
    bustChance: stirChance,
    onPush: level => diveLevel(encounter, level),
    onBank: async levelsCompleted => {
      const haul = getHaul(encounter);
      if (levelsCompleted === 0 && haul.finds === 0) {
        // Surfaced before diving - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      // Money was paid per descent. On surfacing, the depth itself is the prize: a
      // guaranteed reward whose rarity RAMPS with how deep you pushed (Great ->
      // Ultra -> Rogue -> Master), plus any rare curios the dive turned up.
      const settings: CustomModifierSettings = {
        fillRemaining: false,
        guaranteedModifierTiers: [rewardTierForDepth(levelsCompleted)],
      };
      if (haul.loot.options.length > 0) {
        settings.guaranteedModifierTypeOptions = haul.loot.options;
      }
      if (haul.loot.funcs.length > 0) {
        settings.guaranteedModifierTypeFuncs = haul.loot.funcs;
      }
      setEncounterRewards(settings);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    },
    onBust: async () => {
      const haul = getHaul(encounter);
      // The trench-stir is NOT terminal: the money you have is already paid, so
      // nothing is lost. WIN the fight and the dive RESUMES (each stir makes the
      // next guardian tougher). A full party wipe ends the run as any battle would.
      haul.interrupts += 1;
      queueEncounterMessage(`${namespace}:trenchStirs`);
      encounter.doContinueEncounter = async () => {
        encounter.doContinueEncounter = undefined;
        await resumePressYourLuck(diveConfig(encounter));
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle(haul.interrupts));
      // Depth-scaled challenge tokens for this dive fight only; cleared after the
      // battle by doPostBattleCleanup.
      applyErGuardianTokens(haul.interrupts - 1);
    },
  };
}

export const AbyssalVentEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_ABYSSAL_VENT,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served chest key (reads as a mineral-encrusted cache on
    // the trench floor). Swap to a dedicated vent sprite once one is uploaded to
    // er-assets (images/mystery-encounters/<key>.png + .json).
    // An anglerfish lighting the trench dark (Lanturn).
    { species: SpeciesId.LANTURN, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Reset the haul + prompt tokens so a re-rolled/forced encounter starts clean.
    encounter.misc = { dive: defaultHaul() };
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
        // Start the dive loop: mark the encounter continuous, clear the intro art,
        // then hand off to the shared press-your-luck substrate.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.continuousEncounter = true;
        await transitionMysteryEncounterIntroVisuals(true, false);
        await startPressYourLuck(diveConfig(encounter));
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
      // Move on without diving - no haul, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
