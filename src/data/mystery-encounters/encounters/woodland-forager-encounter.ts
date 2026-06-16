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
//   Round haul: each surviving forage drops a berry, handed to the party as a held
//     item IMMEDIATELY (so a push that ends in a fight never costs you what you
//     already gathered). Early rounds drop common berries; later rounds drop rarer
//     ones and, deep in, a small chance at a single Rogue-tier "ingredient" (the
//     jackpot, offered as a shop pick when you finally pack up).
//   PACK UP (bank): stop foraging and leave with everything already held (plus the
//     jackpot shop, if you found the ingredient). Banking at round 0 = nothing.
//   FORAGE ON (push) + survive: one more berry, prompt again.
//   FORAGE ON (push) + the swarm INTERRUPTS: the grove's guardians (a level-scaled
//     wild Bug pair via initBattleWithEnemyConfig) attack. This is NOT a terminal
//     bust - WIN the fight and foraging RESUMES where it left off (design PART XII
//     s44 escalation: each interrupt makes the NEXT swarm tougher, so the deeper
//     you forage the deadlier the guardians get). The berries you already hold are
//     never lost. A full party wipe ends the run as any battle would - the branch
//     never softlocks the forced encounter; the player just keeps banking berries
//     until the swarm finally outscales them or they choose to pack up.
//
// Tuning lives in the constants below. The jackpot is a Rogue-tier item pick for
// now; the design's "Forager's Pack relic" can replace it later (note in report).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import {
  type PressYourLuckConfig,
  resumePressYourLuck,
  startPressYourLuck,
} from "#data/elite-redux/er-press-your-luck";
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
/** Levels added to the swarm per prior interrupt (design s44: deeper = deadlier). */
const SWARM_LEVEL_PER_INTERRUPT = 6;
/** After this many interrupts the swarm's lead becomes a BOSS (top-tier threat). */
const SWARM_BOSS_AFTER_INTERRUPTS = 3;

/** Thematic wild Bug guardians for the interrupt fight (a 2-mon swarm). */
const SWARM_SPECIES: SpeciesId[] = [SpeciesId.BEEDRILL, SpeciesId.ARIADOS, SpeciesId.SCOLIPEDE, SpeciesId.VESPIQUEN];

/** What the Forager accumulates on `encounter.misc.forage`. */
interface ForageHaul {
  /** How many berries have been gathered (each is granted to the party at once). */
  finds: number;
  /** Whether the Rogue-tier ingredient jackpot has been gathered. */
  jackpot: boolean;
  /** How many swarm interrupts have been survived (drives swarm escalation). */
  interrupts: number;
}

function defaultHaul(): ForageHaul {
  return { finds: 0, jackpot: false, interrupts: 0 };
}

function getHaul(encounter: MysteryEncounter): ForageHaul {
  if (!encounter.misc) {
    encounter.misc = {};
  }
  if (!encounter.misc.forage) {
    encounter.misc.forage = defaultHaul();
  }
  return encounter.misc.forage as ForageHaul;
}

/** Escalating per-round bust chance, clamped to [BUST_BASE, BUST_MAX]. */
function bustChance(round: number): number {
  return Math.min(BUST_BASE + round * BUST_PER_ROUND, BUST_MAX);
}

/**
 * Grant ONE berry of the given type to the first party member that has room for
 * it (a new held-item stack or a non-maxed existing one). Returns silently if no
 * mon can hold it - a full party of maxed stacks just forgoes the extra.
 */
function grantOneBerry(berryType: BerryType): void {
  const berry = generateModifierType(modifierTypes.BERRY, [berryType]) as BerryModifierType;
  for (const pokemon of globalScene.getPlayerParty()) {
    const held = globalScene.findModifier(
      m => m instanceof BerryModifier && m.pokemonId === pokemon.id && (m as BerryModifier).berryType === berryType,
      true,
    ) as BerryModifier | undefined;
    if (!held || held.getStackCount() < held.getMaxStackCount()) {
      applyModifierTypeToPlayerPokemon(pokemon, berry);
      return;
    }
  }
}

/**
 * Resolve a survived push entering `round`: gather one berry, hand it to the party
 * RIGHT AWAY as a held item (so an interrupt fight never costs it), and refresh
 * the prompt token. A deep push also has a one-time shot at the Rogue ingredient.
 */
async function gatherRound(encounter: MysteryEncounter, round: number): Promise<void> {
  const haul = getHaul(encounter);
  const pool = round >= RARE_ROUND ? RARE_BERRIES : COMMON_BERRIES;
  globalScene.playSound("item_fanfare");
  grantOneBerry(randSeedItem(pool));
  haul.finds += 1;

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
  encounter.setDialogueToken("berryCount", String(haul.finds));
  encounter.setDialogueToken("ingredientNote", haul.jackpot ? " and a rare ingredient" : "");
}

/**
 * Open the Rogue-tier "ingredient" shop pick if the jackpot was gathered. Berries
 * are already held (granted per round), so only the jackpot needs the reward phase.
 */
function awardJackpot(jackpot: boolean): void {
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

/**
 * Build the level-scaled 2-mon wild Bug swarm for the interrupt fight. Each prior
 * interrupt (`interrupts`) raises the swarm's level, and past
 * {@linkcode SWARM_BOSS_AFTER_INTERRUPTS} the lead is promoted to a BOSS - so the
 * deeper a session runs, the deadlier the guardians get (design PART XII s44).
 */
function buildSwarmBattle(interrupts: number): EnemyPartyConfig {
  const level = swarmLevel() + interrupts * SWARM_LEVEL_PER_INTERRUPT;
  const leadIsBoss = interrupts >= SWARM_BOSS_AFTER_INTERRUPTS;
  const first = randSeedItem(SWARM_SPECIES);
  let second = randSeedItem(SWARM_SPECIES);
  if (second === first) {
    second = SWARM_SPECIES[(SWARM_SPECIES.indexOf(first) + 1) % SWARM_SPECIES.length];
  }
  return {
    doubleBattle: true,
    pokemonConfigs: [
      { species: getPokemonSpecies(first), isBoss: leadIsBoss, level },
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
      if (roundsCompleted === 0 && haul.finds === 0) {
        // Walked away before gathering anything - no haul, no cost.
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
        return;
      }
      // Berries are already held (granted per round); only the jackpot shop is left.
      awardJackpot(haul.jackpot);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    },
    onBust: async () => {
      const haul = getHaul(encounter);
      // The swarm interrupts - but this is NOT terminal. Berries are already held,
      // so nothing is lost. WIN the fight and foraging RESUMES (design s44): the
      // post-battle MysteryEncounterRewardsPhase fires doContinueEncounter, which
      // re-prompts the loop with an escalated swarm. A party wipe ends the run as
      // any battle would. The interrupt count drives the next swarm's difficulty.
      haul.interrupts += 1;
      queueEncounterMessage(`${namespace}:swarmInterrupts`);
      encounter.doContinueEncounter = async () => {
        encounter.doContinueEncounter = undefined;
        await resumePressYourLuck(forageConfig(encounter));
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildSwarmBattle(haul.interrupts));
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
    encounter.misc = { forage: defaultHaul() };
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
