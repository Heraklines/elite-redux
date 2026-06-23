/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #520 - The Dormant Guardian. A RUINS puzzle->boss event (design transcript
// line 124175, maintainer ruling "Braille puzzle + 5-6 bar omni-boosted boss").
// A colossal construct sleeps sealed behind a wall of raised glyphs. Work the
// seal (a BRAILLE decode on the shared ErQuiz engine - read the raised dot-cells
// and pick the matching word):
//
//   READ THE SEAL cleanly -> you ATTUNE to the guardian and claim the relic it
//     guarded (a Rogue-tier reward + a relic), no fight.
//   BOTCH IT -> the guardian wakes ENRAGED: a 5-6 bar, omni-boosted boss. Win and
//     the relic is still yours, just the hard way.
//   LEAVE IT SEALED -> walk away, no reward, no cost.
//
// New mechanic: the Braille seal - a real new ErQuiz kind ("braille") that spells
// a word in Unicode Braille cells (no art). Boss-on-botch reuses the boss enemy
// config + the omni-boost-on-entry effect (no engine changes there).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { buildErQuizRound } from "#data/elite-redux/er-quiz";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ErQuizResult } from "#phases/er-quiz-phase";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/dormantGuardian";

const ALL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

/** Colossal ancient constructs that can be the sealed guardian. */
const GUARDIAN_SPECIES: SpeciesId[] = [SpeciesId.GOLURK, SpeciesId.REGIROCK, SpeciesId.REGISTEEL, SpeciesId.GOLEM];

/**
 * The relic the guardian was set to protect (either outcome yields one). Resolved at
 * CALL time, not module load: `modifierTypes` is populated lazily at game init, after
 * this encounter module is imported, so a module-level capture froze in `undefined`
 * relic funcs that were silently dropped from the reward (#616).
 */
function guardianRelics(): ModifierTypeFunc[] {
  return [
    modifierTypes.ER_RELIC_MORALE_BANNER,
    modifierTypes.ER_RELIC_SECOND_WIND,
    modifierTypes.ER_RELIC_TWIN_LINK,
    modifierTypes.ER_RELIC_ANCHOR,
    modifierTypes.ER_RELIC_WEATHERVANE,
    modifierTypes.ER_RELIC_MYSTERY_CHARM,
  ];
}

interface GuardianMisc {
  guardianId: SpeciesId;
}

/** Enemy level the woken guardian is pinned to: strongest party member / wave, +5. */
function guardianLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl)) + 5;
}

/** Build the enraged-guardian boss: a 5-6 bar construct that omni-boosts on entry. */
function buildGuardianBoss(): EnemyPartyConfig {
  const guardianId = (globalScene.currentBattle.mysteryEncounter!.misc as GuardianMisc).guardianId;
  return {
    pokemonConfigs: [
      {
        species: getPokemonSpecies(guardianId),
        isBoss: true,
        bossSegments: 5 + randSeedInt(2),
        level: guardianLevel(),
        tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
        mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
          globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, ALL_STATS, 1);
        },
      },
    ],
  };
}

/** Resolve the seal: clean read -> attune (relic, no fight); botch -> enraged boss. */
async function resolveSeal(clean: boolean): Promise<void> {
  const relic = randSeedItem(guardianRelics());
  setEncounterRewards({
    guaranteedModifierTypeFuncs: [relic],
    guaranteedModifierTiers: [ModifierTier.ROGUE],
    fillRemaining: false,
  });
  if (clean) {
    queueEncounterMessage(`${namespace}:attuned`);
    leaveEncounterWithoutBattle(false);
  } else {
    queueEncounterMessage(`${namespace}:enraged`);
    await initBattleWithEnemyConfig(buildGuardianBoss());
  }
}

export const DormantGuardianEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_DORMANT_GUARDIAN,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The colossal construct, dormant behind its glyph seal (Golurk), shaded dim.
    {
      species: SpeciesId.GOLURK,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      tint: 0.3,
      scale: 1.3,
      repeat: true,
      y: 5,
    },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Pick which construct sleeps here (used for the woken-boss fight).
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.misc = { guardianId: randSeedItem(GUARDIAN_SPECIES) } satisfies GuardianMisc;
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
        await transitionMysteryEncounterIntroVisuals(true, false);
        // Work the seal: read ONE Braille glyph-word (4 choices). Right = attune,
        // wrong = the guardian wakes enraged.
        const questions = buildErQuizRound("braille", 1, 4);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: false,
          onComplete: (result: ErQuizResult) => {
            void resolveSeal(result.correct >= 1);
          },
        });
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
      // Leave the seal alone - no reward, no risk.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
