/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #510 - The Buried City. A DESERT press-your-luck DELVE (design PART XV s55 /
// transcript line 124156). Dig down through a sand-buried city for a growing
// money haul; every level down raises the chance its Ground guardians stir, and
// deep enough the ancient warden RUNERIGUS itself rises as a multi-bar boss.
//
//   RISE (bank): keep the money (paid per descent) and surface. Banking after you
//     BEAT RUNERIGUS yields the Pharaoh's Ankh relic - it drops ONLY then; an
//     ordinary dive cashes in money + depth-scaled item picks.
//   DIG DEEPER (push) + survive: the haul + danger grow.
//   DIG DEEPER (push) + the sand STIRS: a level-scaled Ground guardian (or, deep,
//     Runerigus) attacks. Money already earned is safe; WIN and the dig RESUMES.
//
// Reuses the shared press-your-luck substrate + depth-scaled guardian picker, with
// its OWN desert reward pool (not the cave mineral loot).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { guardianForDepth } from "#data/elite-redux/er-delve-guardians";
import { applyErGuardianTokens } from "#data/elite-redux/er-fight-tokens";
import { rollMineralMoney } from "#data/elite-redux/er-mineral-loot";
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
import { randSeedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/buriedCity";

/** Money a shallow find (levels 0-1) is worth. */
const RELIC_VALUE = 110;
/** Money a deep find (level 2+) is worth. */
const HOARD_VALUE = 280;
/** Level at/beyond which finds + rewards become "deep". */
const DEEP_LEVEL = 2;

/** Base stir chance for the first dig, in [0, 1]. */
const STIR_BASE = 0.12;
/** Added to the stir chance per level. */
const STIR_PER_LEVEL = 0.14;
/** The stir chance never exceeds this. */
const STIR_MAX = 0.8;

/** Levels added to the guardian per prior stir (deeper = deadlier). */
const GUARDIAN_LEVEL_PER_INTERRUPT = 6;
/** After this many stirs the warden Runerigus rises as the boss. */
const GUARDIAN_BOSS_AFTER_INTERRUPTS = 3;
/** Runerigus is at least this many levels above the player's strongest mon. */
const BOSS_LEVELS_ABOVE = 5;
/** Non-boss guardians are GROUND-typed; the shared picker climbs BST with depth. */
const CITY_GUARDIAN_TYPES = [PokemonType.GROUND];

interface DigHaul {
  finds: number;
  interrupts: number;
  /** True once Runerigus (the boss) has been beaten this dive (gates the Ankh). */
  beatBoss: boolean;
}

function getHaul(): DigHaul {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc?.dig) {
    encounter.misc = { dig: { finds: 0, interrupts: 0, beatBoss: false } satisfies DigHaul };
  }
  return encounter.misc.dig as DigHaul;
}

function stirChance(level: number): number {
  return Math.min(STIR_BASE + level * STIR_PER_LEVEL, STIR_MAX);
}

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

/** Build the stir fight: a Ground guardian, or - deep - the warden Runerigus boss (3-4 bars). */
function buildGuardianBattle(interrupts: number): EnemyPartyConfig {
  const isBoss = interrupts >= GUARDIAN_BOSS_AFTER_INTERRUPTS;
  if (isBoss) {
    const level = Math.max(
      guardianLevel() + interrupts * GUARDIAN_LEVEL_PER_INTERRUPT,
      guardianLevel() + BOSS_LEVELS_ABOVE,
    );
    return {
      pokemonConfigs: [
        { species: getPokemonSpecies(SpeciesId.RUNERIGUS), isBoss: true, bossSegments: 3 + randSeedInt(2), level },
      ],
    };
  }
  const species = guardianForDepth(CITY_GUARDIAN_TYPES, interrupts, false);
  return {
    pokemonConfigs: [{ species, isBoss: false, level: guardianLevel() + interrupts * GUARDIAN_LEVEL_PER_INTERRUPT }],
  };
}

/** Cash in the desert reward screen for a dig banked at `deepestLevel`. */
function bankCityRewards(deepestLevel: number, beatBoss: boolean): void {
  const deep = deepestLevel >= DEEP_LEVEL;
  const funcs: ModifierTypeFunc[] = [];
  // The Pharaoh's Ankh drops ONLY for besting Runerigus.
  if (beatBoss) {
    funcs.push(modifierTypes.ER_RELIC_PHARAOH_ANKH);
  }
  const picks = Math.min(1 + Math.floor(deepestLevel / 2), 3);
  const tiers = new Array(picks).fill(deep || beatBoss ? ModifierTier.ULTRA : ModifierTier.GREAT);
  setEncounterRewards({
    ...(funcs.length > 0 ? { guaranteedModifierTypeFuncs: funcs } : {}),
    guaranteedModifierTiers: tiers,
    fillRemaining: false,
  });
}

function diveConfig(): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:digPrompt`,
    pushLabelKey: `${namespace}:dig.push.label`,
    pushTooltipKey: `${namespace}:dig.push.tooltip`,
    bankLabelKey: `${namespace}:dig.bank.label`,
    bankTooltipKey: `${namespace}:dig.bank.tooltip`,
    bustChance: stirChance,
    onPush: async level => {
      const haul = getHaul();
      haul.finds += 1;
      const money = rollMineralMoney(level >= DEEP_LEVEL ? HOARD_VALUE : RELIC_VALUE);
      if (money.amount > 0) {
        globalScene.playSound("item_fanfare");
        updatePlayerMoney(money.amount, true, false);
      }
      globalScene.currentBattle.mysteryEncounter!.setDialogueToken("diveCount", String(haul.finds));
      queueEncounterMessage(money.kind === "dud" ? `${namespace}:foundNothing` : `${namespace}:foundRelics`);
    },
    onBank: async levelsCompleted => {
      const haul = getHaul();
      await transitionMysteryEncounterIntroVisuals(true, true);
      if (levelsCompleted === 0 && haul.finds === 0) {
        leaveEncounterWithoutBattle(true);
        return;
      }
      bankCityRewards(levelsCompleted, haul.beatBoss);
      leaveEncounterWithoutBattle(false);
    },
    onBust: async () => {
      const haul = getHaul();
      haul.interrupts += 1;
      const isBoss = haul.interrupts >= GUARDIAN_BOSS_AFTER_INTERRUPTS;
      queueEncounterMessage(isBoss ? `${namespace}:wardenRises` : `${namespace}:sandStirs`);
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      encounter.doContinueEncounter = async () => {
        encounter.doContinueEncounter = undefined;
        // Surviving a boss-tier stir means Runerigus was beaten -> the Ankh is earned.
        if (isBoss) {
          getHaul().beatBoss = true;
        }
        await resumePressYourLuck(diveConfig());
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildGuardianBattle(haul.interrupts));
      applyErGuardianTokens(haul.interrupts - 1);
    },
  };
}

export const BuriedCityEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_BURIED_CITY,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The buried city's ancient warden (Runerigus).
    { species: SpeciesId.RUNERIGUS, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.misc = { dig: { finds: 0, interrupts: 0, beatBoss: false } satisfies DigHaul };
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
