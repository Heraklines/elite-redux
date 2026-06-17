/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #519 - Reactor Meltdown. A POWER_PLANT read-the-gauges event (design PART XVI
// s59 / transcript line 124175). The reactor is melting down: three coolant units
// read different output, and the shutdown order must go to the one running HOTTEST
// (the highest gauge). Call it right -> the core stabilises and discharges into a
// Capacitor relic. Call it wrong -> a partial blowout chips the whole party, and
// you grab what loose energy you can.
//
// This is the OTHER power-plant event - distinct from Overcharge the Core (the
// permanent stat-surge). No new battle; a 3-way gauge read with the reading shown
// in each option tooltip.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedInt, randSeedShuffle } from "#utils/common";

const namespace = "mysteryEncounters/reactorMeltdown";

/** Fraction of max HP a partial blowout chips off each party member. */
const BLOWOUT_CHIP = 1 / 8;

interface MeltdownState {
  /** Index (0-2) of the hottest unit - the correct shutdown target. */
  correct: number;
}

/** Chip every non-fainted party member from the partial blowout (floored at 1 HP). */
function blowoutChip(): void {
  for (const mon of globalScene.getPlayerParty()) {
    if (mon.isFainted()) {
      continue;
    }
    const chip = Math.max(1, Math.floor(mon.getMaxHp() * BLOWOUT_CHIP));
    mon.hp = Math.max(1, mon.hp - chip);
    mon.updateInfo();
  }
}

/** Resolve a shutdown call on unit `chosen`. */
async function resolveShutdown(chosen: number): Promise<void> {
  const { correct } = globalScene.currentBattle.mysteryEncounter!.misc as MeltdownState;
  await transitionMysteryEncounterIntroVisuals(true, true);
  if (chosen === correct) {
    queueEncounterMessage(`${namespace}:stabilized`);
    setEncounterRewards({
      guaranteedModifierTypeFuncs: [modifierTypes.ER_RELIC_CAPACITOR],
      guaranteedModifierTiers: [ModifierTier.ULTRA],
      fillRemaining: false,
    });
  } else {
    queueEncounterMessage(`${namespace}:blowout`);
    blowoutChip();
    setEncounterRewards({ guaranteedModifierTiers: [ModifierTier.GREAT], fillRemaining: false });
  }
  leaveEncounterWithoutBattle(false);
}

/** Build one "Shut down Unit N" option (1-indexed label, 0-indexed slot). */
function unitOption(slot: number) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${slot + 1}.label`,
      buttonTooltip: `${namespace}:option.${slot + 1}.tooltip`,
      selected: [{ text: `${namespace}:option.${slot + 1}.selected` }],
    })
    .withOptionPhase(async () => {
      await resolveShutdown(slot);
      return true;
    })
    .build();
}

export const ReactorMeltdownEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_REACTOR_MELTDOWN,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The overloading reactor made flesh (Electrode, one spark from blowing).
    { species: SpeciesId.ELECTRODE, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Roll three distinct gauge readings (high / mid / low bands) into random unit
    // slots; the hottest is the correct shutdown target. Show each in its tooltip.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const bands = [70 + randSeedInt(30), 40 + randSeedInt(20), 12 + randSeedInt(16)];
    const slots = randSeedShuffle([0, 1, 2]);
    const readings = [0, 0, 0];
    slots.forEach((slot, k) => {
      readings[slot] = bands[k];
    });
    const correct = readings.indexOf(Math.max(...readings));
    encounter.misc = { correct } satisfies MeltdownState;
    readings.forEach((r, i) => encounter.setDialogueToken(`reading${i + 1}`, String(r)));
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(unitOption(0))
  .withOption(unitOption(1))
  .withOption(unitOption(2))
  .build();
