/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #512 - Into the Caldera. A VOLCANO high-danger DELVE (design PART XVI s58 /
// transcript line 124175). Descend the lava tube for a growing money haul; each
// descent past the shallows scorches every NON-Fire party member (~1/16 max HP
// heat chip), and every level down raises the chance a Fire guardian erupts.
//
//   RISE (bank): keep the money (paid per descent) and surface; deep dives cash in
//     a reward screen whose top end can yield the Molten Core relic or a Greater
//     Golden Ball plus high-tier picks.
//   DIVE DEEPER (push) + survive: the haul + danger grow.
//   DIVE DEEPER (push) + the caldera ERUPTS: a level-scaled Fire guardian attacks.
//     Money already earned is safe; WIN and the dive RESUMES.
//
// Reuses the shared press-your-luck substrate (er-press-your-luck.ts) and the
// depth-scaled guardian picker, but its OWN volcano reward pool (not the cave
// mineral loot) per the unique-per-event item-pool rule.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { guardianForDepth } from "#data/elite-redux/er-delve-guardians";
import { applyErGuardianTokens } from "#data/elite-redux/er-fight-tokens";
import { emptyMineralHaul, rollMegaStone } from "#data/elite-redux/er-mineral-loot";
import {
  type PressYourLuckConfig,
  resumePressYourLuck,
  startPressYourLuck,
} from "#data/elite-redux/er-press-your-luck";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import { applyModifierTypeToPlayerPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/intoTheCaldera";

/** Money a shallow find (levels 0-1) is worth. */
const EMBER_VALUE = 110;
/** Money a deep find (level 2+) is worth. */
const MAGMA_VALUE = 280;
/** Level at/beyond which finds + rewards become "deep" (richer, relic-capable). */
const DEEP_LEVEL = 2;

/** Base eruption chance for the first descent, in [0, 1]. */
const ERUPT_BASE = 0.12;
/** Added to the eruption chance per level. */
const ERUPT_PER_LEVEL = 0.14;
/** The eruption chance never exceeds this. */
const ERUPT_MAX = 0.8;

/** Fraction of max HP the heat chips off each non-Fire party member per descent. */
const HEAT_CHIP = 1 / 16;

/** Levels added to the guardian per prior eruption (deeper = deadlier). */
const GUARDIAN_LEVEL_PER_INTERRUPT = 6;
/** After this many eruptions the guardian becomes the chain's BOSS. */
const GUARDIAN_BOSS_AFTER_INTERRUPTS = 3;
/** A boss guardian is at least this many levels above the player's strongest mon. */
const BOSS_LEVELS_ABOVE = 5;
/** The caldera's guardians are FIRE-typed; the shared picker climbs BST with depth. */
const CALDERA_GUARDIAN_TYPES = [PokemonType.FIRE];

/** Percent chance, on a DEEP bank, the haul includes the Molten Core relic. */
const MOLTEN_CORE_CHANCE = 25;
/** Percent chance, on a DEEP bank, the haul includes a Greater Golden Ball. */
const GREATER_BALL_CHANCE = 20;
/** Percent chance, on a DEEP bank, the haul also turns up a party-line Mega Stone. */
const MEGA_STONE_CHANCE = 22;

/** Percent chance a descent pays its big haul (otherwise just embers - little/nothing). */
const PAYOUT_CHANCE = 65;
/** A paying descent is worth at least this fraction of the player's current money. */
const PAYOUT_MONEY_FRACTION = 0.1;

/** Thematic held items the lava tube can turn up (given straight to a party mon). */
const CALDERA_ITEM_FUNCS: ModifierTypeFunc[] = [
  modifierTypes.FLAME_ORB,
  modifierTypes.QUICK_CLAW,
  modifierTypes.KINGS_ROCK,
];

/** Percent chance a descent at `level` (0-indexed) also turns up a held item. */
function itemFindChance(level: number): number {
  return Math.min(25 + level * 12, 70);
}

/**
 * Give a found held item to the lead (or the next party member if the lead can't
 * take it), and announce it. Returns true if an item was found + handed over.
 */
function maybeFindCalderaItem(level: number): boolean {
  if (randSeedInt(100) >= itemFindChance(level)) {
    return false;
  }
  const itemType = generateModifierType(randSeedItem(CALDERA_ITEM_FUNCS)) as PokemonHeldItemModifierType | null;
  if (!itemType) {
    return false;
  }
  const party = globalScene.getPlayerParty().filter(p => !p.isFainted());
  const target = party[0] ?? globalScene.getPlayerParty()[0];
  if (!target) {
    return false;
  }
  applyModifierTypeToPlayerPokemon(target, itemType);
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("itemName", itemType.name);
  encounter.setDialogueToken("itemPokemon", target.getNameToRender());
  queueEncounterMessage(`${namespace}:foundItem`);
  return true;
}

interface DiveHaul {
  finds: number;
  interrupts: number;
}

function getHaul(): DiveHaul {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc?.dive) {
    encounter.misc = { dive: { finds: 0, interrupts: 0 } satisfies DiveHaul };
  }
  return encounter.misc.dive as DiveHaul;
}

/** Escalating eruption chance, clamped. */
function eruptChance(level: number): number {
  return Math.min(ERUPT_BASE + level * ERUPT_PER_LEVEL, ERUPT_MAX);
}

/** Scorch every non-Fire, non-fainted party member for the heat chip (floored at 1 HP). Returns how many were scorched. */
function applyHeatChip(): number {
  let scorched = 0;
  for (const mon of globalScene.getPlayerParty()) {
    if (mon.isFainted() || mon.getTypes(false, false, true).includes(PokemonType.FIRE)) {
      continue;
    }
    const chip = Math.max(1, Math.floor(mon.getMaxHp() * HEAT_CHIP));
    mon.hp = Math.max(1, mon.hp - chip);
    mon.updateInfo();
    scorched++;
  }
  return scorched;
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

/** Build the wild Fire guardian for the eruption fight (boss past the threshold). */
function buildGuardianBattle(interrupts: number): EnemyPartyConfig {
  const isBoss = interrupts >= GUARDIAN_BOSS_AFTER_INTERRUPTS;
  const species = guardianForDepth(CALDERA_GUARDIAN_TYPES, interrupts, isBoss);
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

/** Cash in the volcano reward screen for a dive banked at `deepestLevel`. */
function bankCalderaRewards(deepestLevel: number): void {
  const deep = deepestLevel >= DEEP_LEVEL;
  const funcs: ModifierTypeFunc[] = [];
  // A deep dive can also turn up a Mega Stone matching one of the party's lines.
  const haul = emptyMineralHaul();
  if (deep) {
    if (randSeedInt(100) < MOLTEN_CORE_CHANCE) {
      funcs.push(modifierTypes.ER_RELIC_MOLTEN_CORE);
    }
    if (randSeedInt(100) < GREATER_BALL_CHANCE) {
      funcs.push(modifierTypes.ER_GREATER_GOLDEN_BALL);
    }
    rollMegaStone(haul, deepestLevel, MEGA_STONE_CHANCE);
  }
  const picks = Math.min(1 + Math.floor(deepestLevel / 2), 3);
  const tiers = new Array(picks).fill(deep ? ModifierTier.ULTRA : ModifierTier.GREAT);
  setEncounterRewards({
    ...(funcs.length > 0 ? { guaranteedModifierTypeFuncs: funcs } : {}),
    ...(haul.options.length > 0 ? { guaranteedModifierTypeOptions: haul.options } : {}),
    guaranteedModifierTiers: tiers,
    fillRemaining: false,
  });
}

/** The press-your-luck config the caldera hands to the shared substrate. */
function diveConfig(): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:divePrompt`,
    pushLabelKey: `${namespace}:dive.push.label`,
    pushTooltipKey: `${namespace}:dive.push.tooltip`,
    bankLabelKey: `${namespace}:dive.bank.label`,
    bankTooltipKey: `${namespace}:dive.bank.tooltip`,
    bustChance: eruptChance,
    onPush: async level => {
      const haul = getHaul();
      haul.finds += 1;
      // A paying descent (~65%) is worth at least ~10% of the player's current
      // money (jittered) - the deep heat is dangerous, so the gold has to match.
      let paid = false;
      if (randSeedInt(100) < PAYOUT_CHANCE) {
        const base = Math.max(
          level >= DEEP_LEVEL ? MAGMA_VALUE : EMBER_VALUE,
          Math.floor(globalScene.money * PAYOUT_MONEY_FRACTION),
        );
        const amount = Math.round(base * (0.85 + randSeedInt(31) / 100)); // 85-115%
        if (amount > 0) {
          globalScene.playSound("item_fanfare");
          updatePlayerMoney(amount, true, false);
          paid = true;
        }
      }
      const foundItem = maybeFindCalderaItem(level);
      const scorched = applyHeatChip();
      globalScene.currentBattle.mysteryEncounter!.setDialogueToken("diveCount", String(haul.finds));
      if (!foundItem) {
        queueEncounterMessage(paid ? `${namespace}:foundMagma` : `${namespace}:foundNothing`);
      }
      // Make it clear the descent is hurting the team (non-Fire mons take the heat).
      if (scorched > 0) {
        queueEncounterMessage(`${namespace}:scorched`);
      }
    },
    onBank: async levelsCompleted => {
      const haul = getHaul();
      await transitionMysteryEncounterIntroVisuals(true, true);
      if (levelsCompleted === 0 && haul.finds === 0) {
        leaveEncounterWithoutBattle(true);
        return;
      }
      bankCalderaRewards(levelsCompleted);
      leaveEncounterWithoutBattle(false);
    },
    onBust: async () => {
      const haul = getHaul();
      haul.interrupts += 1;
      queueEncounterMessage(`${namespace}:erupts`);
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      encounter.doContinueEncounter = async () => {
        encounter.doContinueEncounter = undefined;
        await resumePressYourLuck(diveConfig());
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle(haul.interrupts));
      applyErGuardianTokens(haul.interrupts - 1);
    },
  };
}

export const IntoTheCalderaEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_INTO_THE_CALDERA,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The molten heart of the volcano, stirring (Magcargo).
    { species: SpeciesId.MAGCARGO, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.misc = { dive: { finds: 0, interrupts: 0 } satisfies DiveHaul };
    encounter.setDialogueToken("diveCount", "0");
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
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.continuousEncounter = true;
        await transitionMysteryEncounterIntroVisuals(true, false);
        await startPressYourLuck(diveConfig());
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
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
