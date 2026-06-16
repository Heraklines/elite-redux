/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Woodland Forager. A FOREST-biome press-your-luck FORAGE loop in a
// berry-rich grove, and the first consumer of the reusable press-your-luck
// substrate (er-press-your-luck.ts). Each round the player either PACKS UP and
// leaves with the safe haul, or FORAGES ON for more - but every push raises the
// chance a territorial wild Bug swarm interrupts and forces a fight.
//
//   Round haul: early rounds drop common berries; later rounds drop rarer berries
//     and, deep in, a small chance at a single Rogue-tier "ingredient" item (the
//     jackpot). Each surviving push grows the haul - berries are handed over as
//     held items when the haul is kept, plus the Rogue ingredient as a shop pick.
//   PACK UP (bank): keep everything gathered so far, leave in peace. Banking at
//     round 0 = nothing, no cost.
//   FORAGE ON (push) + survive: the haul grows, prompt again.
//   FORAGE ON (push) + the swarm INTERRUPTS: the grove's guardians (a level-scaled
//     wild Bug pair built via initBattleWithEnemyConfig) attack. The interrupt
//     itself scatters PART of the haul (a fraction of the gathered berries are
//     lost up front); the kept berries are granted immediately and any jackpot is
//     set as the reward shop, which opens after the win (exactly like the Graves
//     combat branch). A full party wipe ends the run as any battle would - the
//     branch never softlocks a forced encounter.
//
// Tuning lives in the constants below. The jackpot is a Rogue-tier item pick for
// now; the design's "Forager's Pack relic" can replace it later (note in report).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { type PressYourLuckConfig, startPressYourLuck } from "#data/elite-redux/er-press-your-luck";
import { BerryType } from "#enums/berry-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { BerryModifier } from "#modifiers/modifier";
import type { BerryModifierType } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { applyModifierTypeToPlayerPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/woodlandForager";

// --- Foraging tuning ------------------------------------------------------- //

/** Common berries the early grove yields (rounds 0-1). */
const COMMON_BERRIES: BerryType[] = [BerryType.SITRUS, BerryType.LUM, BerryType.LEPPA, BerryType.LANSAT];
/** Rarer berries later rounds yield (round 2+). */
const RARE_BERRIES: BerryType[] = [
  BerryType.APICOT,
  BerryType.GANLON,
  BerryType.SALAC,
  BerryType.PETAYA,
  BerryType.LIECHI,
  BerryType.STARF,
  BerryType.ENIGMA,
];

/** Base bust chance for the very first push, in [0, 1]. */
const BUST_BASE = 0.12;
/** Added to the bust chance per round (round 0 = BUST_BASE). */
const BUST_PER_ROUND = 0.13;
/** The bust chance never exceeds this, so a deep push is risky but not hopeless. */
const BUST_MAX = 0.8;

/** Round (0-indexed push count) at and beyond which the haul turns to rarer berries. */
const RARE_ROUND = 2;
/** Round at/after which each surviving push has a small shot at the Rogue ingredient. */
const JACKPOT_ROUND = 3;
/** Chance per qualifying push to gather the Rogue-tier "ingredient" jackpot. */
const JACKPOT_CHANCE = 0.2;
/** Fraction of the gathered berries the swarm scatters when it interrupts. */
const BUST_HAUL_LOSS = 0.5;

/** Thematic wild Bug guardians for the interrupt fight (a 2-mon swarm). */
const SWARM_SPECIES: SpeciesId[] = [SpeciesId.BEEDRILL, SpeciesId.ARIADOS, SpeciesId.SCOLIPEDE, SpeciesId.VESPIQUEN];

/** What the Forager accumulates on `encounter.misc.forage`. */
interface ForageHaul {
  /** Berries gathered so far, in pick order (granted to the party on bank/win). */
  berries: BerryType[];
  /** Whether the Rogue-tier ingredient jackpot has been gathered. */
  jackpot: boolean;
}

function getHaul(encounter: MysteryEncounter): ForageHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.forage) {
    encounter.misc.forage = { berries: [], jackpot: false } satisfies ForageHaul;
  }
  return encounter.misc.forage as ForageHaul;
}

/** Escalating per-round bust chance, clamped to [BUST_BASE, BUST_MAX]. */
function bustChance(round: number): number {
  return Math.min(BUST_BASE + round * BUST_PER_ROUND, BUST_MAX);
}

/** Grow the haul for a survived push entering `round`, and refresh the prompt token. */
async function gatherRound(encounter: MysteryEncounter, round: number): Promise<void> {
  const haul = getHaul(encounter);
  const pool = round >= RARE_ROUND ? RARE_BERRIES : COMMON_BERRIES;
  haul.berries.push(randSeedItem(pool));

  // Deep pushes can also turn up the Rogue-tier ingredient (only once).
  if (!haul.jackpot && round >= JACKPOT_ROUND && randSeedInt(10000) < Math.round(JACKPOT_CHANCE * 10000)) {
    haul.jackpot = true;
    setHaulTokens(encounter);
    queueEncounterMessage(`${namespace}:foundIngredient`);
    return;
  }

  setHaulTokens(encounter);
  queueEncounterMessage(`${namespace}:foundBerry`);
}

/** Refresh the {{berryCount}} / {{ingredientNote}} dialogue tokens from the live haul. */
function setHaulTokens(encounter: MysteryEncounter): void {
  const haul = getHaul(encounter);
  encounter.setDialogueToken("berryCount", String(haul.berries.length));
  encounter.setDialogueToken("ingredientNote", haul.jackpot ? " and a rare ingredient" : "");
}

/**
 * Grant the gathered berries to the party as held items (the reward-phase
 * callback), one per gathered berry, spread across mons that have room.
 */
function grantBerries(berries: BerryType[]): void {
  const party = globalScene.getPlayerParty();
  for (const berryType of berries) {
    const berry = generateModifierType(modifierTypes.BERRY, [berryType]) as BerryModifierType;
    for (const pokemon of party) {
      const held = globalScene.findModifier(
        m => m instanceof BerryModifier && m.pokemonId === pokemon.id && (m as BerryModifier).berryType === berryType,
        true,
      ) as BerryModifier | undefined;
      if (!held || held.getStackCount() < held.getMaxStackCount()) {
        applyModifierTypeToPlayerPokemon(pokemon, berry);
        break;
      }
    }
  }
}

/**
 * Hand the player the kept haul. The gathered berries are granted directly as
 * held items (they ride into and through any following battle); the Rogue-tier
 * jackpot, if gathered, is offered as a single post-resolution shop pick. With no
 * berries and no jackpot, nothing is granted (no empty shop is opened).
 */
function awardHaul(berries: BerryType[], jackpot: boolean): void {
  if (berries.length > 0) {
    globalScene.playSound("item_fanfare");
    grantBerries(berries);
  }
  if (jackpot) {
    setEncounterRewards({ guaranteedModifierTiers: [ModifierTier.ROGUE], fillRemaining: false });
  }
}

/** Enemy level for the swarm: the player's strongest mon, floored at the wave level. */
function swarmLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

/** Build the level-scaled 2-mon wild Bug swarm for the interrupt fight. */
function buildSwarmBattle(): EnemyPartyConfig {
  const level = swarmLevel();
  const first = randSeedItem(SWARM_SPECIES);
  let second = randSeedItem(SWARM_SPECIES);
  if (second === first) {
    second = SWARM_SPECIES[(SWARM_SPECIES.indexOf(first) + 1) % SWARM_SPECIES.length];
  }
  return {
    doubleBattle: true,
    pokemonConfigs: [
      { species: getPokemonSpecies(first), isBoss: false, level },
      { species: getPokemonSpecies(second), isBoss: false, level },
    ],
  };
}

/** The press-your-luck config the Forager hands to the shared substrate. */
function forageConfig(encounter: MysteryEncounter): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:foragePrompt`,
    pushLabelKey: `${namespace}:forage.push.label`,
    pushTooltipKey: `${namespace}:forage.push.tooltip`,
    bankLabelKey: `${namespace}:forage.bank.label`,
    bankTooltipKey: `${namespace}:forage.bank.tooltip`,
    bustChance,
    onPush: round => gatherRound(encounter, round),
    onBank: async roundsCompleted => {
      const haul = getHaul(encounter);
      if (roundsCompleted === 0) {
        // Walked away before gathering anything - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      awardHaul(haul.berries, haul.jackpot);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    },
    onBust: async () => {
      const haul = getHaul(encounter);
      // The swarm scatters part of the haul up front; the rest rides on the win.
      const kept = Math.floor(haul.berries.length * (1 - BUST_HAUL_LOSS));
      const keptBerries = haul.berries.slice(0, kept);
      encounter.setDialogueToken("scattered", String(haul.berries.length - kept));
      queueEncounterMessage(`${namespace}:swarmInterrupts`);
      // Hand over the reduced haul (berries granted now, jackpot shop opens after
      // the win - Graves combat-branch pattern); a full party wipe ends the run.
      awardHaul(keptBerries, haul.jackpot);
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildSwarmBattle());
    },
  };
}

export const WoodlandForagerEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_WOODLAND_FORAGER,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served berry-bush key from Berries Abound (reads as a
    // berry-rich grove). Swap to a dedicated grove sprite once one is uploaded to
    // er-assets (images/mystery-encounters/<key>.png + .json).
    { spriteKey: "berries_abound_bush", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Reset the haul + prompt tokens so a re-rolled/forced encounter starts clean.
    encounter.misc = { forage: { berries: [], jackpot: false } satisfies ForageHaul };
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
        // Start the forage loop: mark the encounter continuous, clear the intro
        // art, then hand off to the shared press-your-luck substrate.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.continuousEncounter = true;
        await transitionMysteryEncounterIntroVisuals(true, false);
        await startPressYourLuck(forageConfig(encounter));
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
      // Move on without foraging - no haul, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
