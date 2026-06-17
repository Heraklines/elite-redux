/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #509 - The Sinking Mire. A SWAMP read-the-typing event (design PART XIV /
// transcript line 124137). Your footing gives way and one of your Pokemon starts
// going under. You pick another mon to haul it out - but whether it can depends
// on physics the swamp respects:
//
//   HAUL IT OUT: choose a rescuer. It succeeds if it can stay above the muck or
//     muscle the sinking mon free - a FLYING type, a LEVITATE mon, a LIGHT mon,
//     OR a strong enough ATTACKER (its Attack clears a wave-scaled bar). Succeed
//     -> you also dredge up the cache the mire swallowed long ago (a Rogue-tier
//     reward), and the freed mon shakes off the muck (status cleared). Pick a
//     heavy, grounded weakling and it flounders: the sinking mon takes mire
//     damage and the bog swallows one of its held items.
//   LEAVE IT: don't risk a second mon. The sinking mon claws out on its own, but
//     the bog keeps one of its held items as the toll (or chips it if it holds
//     none). No reward.
//
// Pure SCOUT skill: read typing + bulk + power against the bog. Reuses the
// select-a-mon picker (selectPokemonForOption) - no new engine.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { getEncounterText, queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/sinkingMire";

/** A rescuer at or under this weight (kg) is light enough to stay atop the mire. */
const LIGHT_WEIGHT_KG = 25;
/** Fraction of max HP the mire chips when a rescue flounders / the toll is paid. */
const MIRE_CHIP = 1 / 4;

interface MireMisc {
  /** Id of the party mon that is going under. */
  sinkingId: number;
  rescuer?: Pokemon;
}

function getMisc(): MireMisc {
  return globalScene.currentBattle.mysteryEncounter!.misc as MireMisc;
}

function getSinking(): Pokemon | undefined {
  return globalScene.getPlayerParty().find(p => p.id === getMisc().sinkingId);
}

/** The Attack a roughly base-100 attacker would have at this wave's level. */
function rescueAtkThreshold(): number {
  const level = globalScene.currentBattle?.getLevelForWave?.() ?? 30;
  return Math.floor(((2 * 100 + 20) * level) / 100) + 5;
}

/** A rescuer can haul the sinking mon out if it can stay up or muscle it free. */
function canRescue(p: Pokemon): boolean {
  return (
    p.isOfType(PokemonType.FLYING)
    || p.hasAbility(AbilityId.LEVITATE)
    || p.getWeight() <= LIGHT_WEIGHT_KG
    || p.getStat(Stat.ATK) >= rescueAtkThreshold()
  );
}

/** The bog swallows one transferable held item from `mon` (one stack). Returns its name, or null. */
function swallowAnItem(mon: Pokemon): string | null {
  const items = mon.getHeldItems().filter(it => it.isTransferable);
  if (items.length === 0) {
    return null;
  }
  const taken = randSeedItem(items);
  const name = taken.type.name;
  if (taken.stackCount > 1) {
    taken.stackCount--;
  } else {
    globalScene.removeModifier(taken);
  }
  void globalScene.updateModifiers(true);
  return name;
}

/** Chip `mon` for a fraction of its max HP, never below 1. */
function mireChip(mon: Pokemon): void {
  const chip = Math.max(1, Math.floor(mon.getMaxHp() * MIRE_CHIP));
  mon.hp = Math.max(1, mon.hp - chip);
  mon.updateInfo();
}

export const SinkingMireEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_SINKING_MIRE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A denizen of the bog watching from the muck (Quagsire), shaded murky.
    { species: SpeciesId.QUAGSIRE, spriteKey: "", fileRoot: "", hasShadow: true, tint: 0.3, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Pick which party mon went under, and name it in the prompt.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const sinking = randSeedItem(globalScene.getPlayerParty());
    encounter.misc = { sinkingId: sinking.id } satisfies MireMisc;
    encounter.setDialogueToken("sinkingName", sinking.getNameToRender());
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
        secondOptionPrompt: `${namespace}:option.1.selectPrompt`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          getMisc().rescuer = pokemon;
        };
        const selectableFilter = (pokemon: Pokemon) => {
          // The sinking mon can't haul itself out.
          return pokemon.id === getMisc().sinkingId
            ? (getEncounterText(`${namespace}:invalidSelection`) ?? null)
            : null;
        };
        return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
      })
      .withOptionPhase(async () => {
        const sinking = getSinking();
        const rescuer = getMisc().rescuer;
        await transitionMysteryEncounterIntroVisuals(true, false);
        if (rescuer && canRescue(rescuer)) {
          // Hauled free, and the rescuer dredges up the mire's preserved cache.
          if (sinking && !sinking.isFainted()) {
            sinking.resetStatus(false);
            sinking.updateInfo();
          }
          queueEncounterMessage(`${namespace}:rescued`);
          setEncounterRewards({ guaranteedModifierTiers: [ModifierTier.ROGUE], fillRemaining: false });
          leaveEncounterWithoutBattle(false);
        } else {
          // The rescue flounders: the sinking mon takes mire damage and loses an item.
          if (sinking && !sinking.isFainted()) {
            mireChip(sinking);
            swallowAnItem(sinking);
          }
          globalScene.playSound("se/error");
          queueEncounterMessage(`${namespace}:floundered`);
          leaveEncounterWithoutBattle(true);
        }
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
      // Leave it: the sinking mon claws out alone, but the bog keeps a held item
      // as the toll (or chips it if it holds none). No reward, no second mon risked.
      const sinking = getSinking();
      if (sinking && !sinking.isFainted()) {
        const swallowed = swallowAnItem(sinking);
        if (!swallowed) {
          mireChip(sinking);
        }
      }
      await transitionMysteryEncounterIntroVisuals(true, true);
      queueEncounterMessage(`${namespace}:left`);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
