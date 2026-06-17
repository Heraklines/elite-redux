/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #519 - Reactor Meltdown. A POWER_PLANT pick-the-right-Pokemon event (design
// PART XVI s59 / transcript line 124175). The core is melting down and the way to
// the shutdown is blocked. Three of your kind of Pokemon are on hand, near-equal
// in the ONE stat the job needs - but only the best of them can pull it off. Read
// the situation, send the right one in:
//
//   The hazard hints WHICH stat matters (force a door = Attack, shrug off the heat
//   = Sp. Def, sprint to the button = Speed, etc.). The three candidates sit within
//   a few points of each other on that stat (never equal), so you have to KNOW your
//   mons. Send the one with the highest value -> the core stabilizes and discharges
//   into a Capacitor relic. Send a lesser one -> the reactor blows and your whole
//   team is BURNED.
//
// Built on the standard 3-option ME; the candidates + stat are rolled per run for
// variety. No battle.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { allSpecies, modifierTypes } from "#data/data-lists";
import { isErGenericPoolBanned } from "#data/elite-redux/er-generic-pool-bans";
import type { PokemonSpecies } from "#data/pokemon-species";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedItem, randSeedShuffle } from "#utils/common";

const namespace = "mysteryEncounters/reactorMeltdown";

/** Candidates only count a stat as a real choice if its base value is under this. */
const STAT_CEILING = 100;
/** The three candidates' chosen-stat values all sit within this span (never equal). */
const STAT_SPAN = 5;

/** The crucial stats the meltdown can hinge on (never HP). */
const CRUCIAL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;
type CrucialStat = (typeof CRUCIAL_STATS)[number];

/** The hazard line for each stat - hints WHICH stat matters without naming it. */
const JOB_LINE: Record<CrucialStat, string> = {
  [Stat.ATK]: "A blast door is fused shut across the only way in - it'll take raw muscle to force it.",
  [Stat.DEF]: "The corridor is choked with white-hot wreckage - only a tough hide can bull through to the switch.",
  [Stat.SPATK]: "The control panel is sealed behind plating - it'll take a focused energy blast to crack it open.",
  [Stat.SPDEF]:
    "The core spews searing radiation - only something that shrugs off that kind of punishment can reach the controls.",
  [Stat.SPD]: "The timer is almost out - only the quickest could ever sprint to the shutdown before it blows.",
};

interface MeltdownState {
  /** Display-order index (0-2) of the candidate with the highest crucial-stat value. */
  correct: number;
}

/** Eligible candidate species: not legendary, not a banned/battle-only entry. */
function candidatePool(stat: CrucialStat): PokemonSpecies[] {
  return allSpecies.filter(sp => {
    if (sp.legendary || sp.subLegendary || sp.mythical) {
      return false;
    }
    if (isErGenericPoolBanned(sp.speciesId, sp.name)) {
      return false;
    }
    const v = sp.baseStats[stat];
    return v > 0 && v < STAT_CEILING;
  });
}

/**
 * Pick three species whose `stat` values are DISTINCT and span at most STAT_SPAN
 * points (a genuinely close call). Returns them in a random display order, or null
 * if the pool can't supply such a trio (the caller falls back to another stat).
 */
function pickTrio(stat: CrucialStat): PokemonSpecies[] | null {
  const byValue = new Map<number, PokemonSpecies[]>();
  for (const sp of candidatePool(stat)) {
    const v = sp.baseStats[stat];
    let bucket = byValue.get(v);
    if (!bucket) {
      bucket = [];
      byValue.set(v, bucket);
    }
    bucket.push(sp);
  }
  const values = randSeedShuffle([...byValue.keys()]);
  for (const anchor of values) {
    // Distinct values in [anchor, anchor + SPAN]: guarantees span <= SPAN, no ties.
    const windowVals = values.filter(v => v >= anchor && v <= anchor + STAT_SPAN);
    if (windowVals.length >= 3) {
      const picked = randSeedShuffle(windowVals).slice(0, 3);
      return picked.map(v => randSeedItem(byValue.get(v)!));
    }
  }
  return null;
}

/** Roll the whole puzzle: a crucial stat + three close candidates. */
function rollMeltdown(): { stat: CrucialStat; species: PokemonSpecies[] } {
  for (const stat of randSeedShuffle([...CRUCIAL_STATS])) {
    const species = pickTrio(stat);
    if (species) {
      return { stat, species };
    }
  }
  // Failsafe (should never happen): three arbitrary low-stat mons on Speed.
  const fallback = [SpeciesId.SHUCKLE, SpeciesId.MUNCHLAX, SpeciesId.FERROSEED].map(getCandidate);
  return { stat: Stat.SPD, species: fallback };
}

function getCandidate(id: SpeciesId): PokemonSpecies {
  return allSpecies.find(sp => sp.speciesId === id) ?? allSpecies[0];
}

/** Burn every non-fainted party member (the meltdown's blowback on a wrong call). */
function burnParty(): void {
  for (const mon of globalScene.getPlayerParty()) {
    if (!mon.isFainted() && mon.canSetStatus(StatusEffect.BURN, true)) {
      mon.doSetStatus(StatusEffect.BURN);
      mon.updateInfo();
    }
  }
}

/** Resolve sending candidate `chosen` (display index) into the reactor. */
async function resolveChoice(chosen: number): Promise<void> {
  const { correct } = globalScene.currentBattle.mysteryEncounter!.misc as MeltdownState;
  await transitionMysteryEncounterIntroVisuals(true, true);
  if (chosen === correct) {
    queueEncounterMessage(`${namespace}:stabilized`);
    setEncounterRewards({ guaranteedModifierTypeFuncs: [modifierTypes.ER_RELIC_CAPACITOR], fillRemaining: false });
    leaveEncounterWithoutBattle(false);
  } else {
    queueEncounterMessage(`${namespace}:blowout`);
    burnParty();
    leaveEncounterWithoutBattle(true);
  }
}

/** Build one "send candidate N" option (label shows that candidate's species name). */
function candidateOption(slot: number) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${slot + 1}.label`,
      buttonTooltip: `${namespace}:option.${slot + 1}.tooltip`,
      selected: [{ text: `${namespace}:option.${slot + 1}.selected` }],
    })
    .withOptionPhase(async () => {
      await resolveChoice(slot);
      return true;
    })
    .build();
}

export const ReactorMeltdownEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_REACTOR_MELTDOWN,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The overloading reactor made flesh (Electrode, one spark from blowing).
    { species: SpeciesId.ELECTRODE, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Roll the crucial stat + three close (within a few points, never equal)
    // candidates. The hazard line hints the stat; the candidate with the highest
    // value in it is the correct call.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const { stat, species } = rollMeltdown();
    const values = species.map(sp => sp.baseStats[stat]);
    const correct = values.indexOf(Math.max(...values));
    encounter.misc = { correct } satisfies MeltdownState;
    encounter.setDialogueToken("job", JOB_LINE[stat]);
    species.forEach((sp, i) => encounter.setDialogueToken(`mon${i + 1}`, sp.name));
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(candidateOption(0))
  .withOption(candidateOption(1))
  .withOption(candidateOption(2))
  .build();
