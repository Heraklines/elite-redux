/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #500 - The Fortune Teller. A settlement seer (Metropolis / Slum) who reads
// the road ahead: she NAMES the mystery encounter waiting in a biome you can
// travel to next (a scouting preview), and - if you let her - bends fate so that
// prophecy comes to pass, QUEUEING that encounter to spawn at your next mystery
// wave (via mysteryEncounterSaveData.queuedEncounters). She also charts that
// biome onto the World Map as an event-revealed (blue) onward route, so you can
// actually steer toward the foretold place.
//
// Pure foresight: no fee, no fight. The value is information + a nudged route.
// Heavy lifting (which biome / which ME) is resolved in withOnInit so the
// description can already name the prophecy, then committed on the first option.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { addErEventRevealedNode, getErPendingNodes } from "#data/elite-redux/er-biome-routing";
import type { BiomeId } from "#enums/biome-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { getBiomeName, randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/fortuneTeller";

/** Chance (out of 100) the foretold encounter is then forced to actually spawn. */
const PROPHECY_SPAWN_PERCENT = 100;

// The biome->ME map + registry live in mystery-encounters.ts, which imports THIS
// file to register the encounter. Importing them back would form a module cycle
// (CI-gated), so mystery-encounters injects them via registerFortuneTellerLookups
// during initMysteryEncounters() instead. Read lazily at encounter time.
let biomeEncounterLookup: Map<BiomeId, MysteryEncounterType[]> | null = null;
let allEncounterLookup: Record<number, MysteryEncounter> | null = null;

/** Called once from initMysteryEncounters() so the seer can read the ME pools. */
export function registerFortuneTellerLookups(
  byBiome: Map<BiomeId, MysteryEncounterType[]>,
  all: Record<number, MysteryEncounter>,
): void {
  biomeEncounterLookup = byBiome;
  allEncounterLookup = all;
}

/** What the seer resolved on init, read by the "hear the prophecy" option. */
interface FortuneMisc {
  /** The encounter she foresaw, or null if no candidate could be found. */
  type: MysteryEncounterType | null;
  /** The biome it waits in (also charted onto the map when heard). */
  biome: BiomeId;
}

/** Title-case a raw encounter enum name: ER_GLITTERING_VEIN -> "Glittering Vein". */
function prettyEncounterName(type: MysteryEncounterType): string {
  return MysteryEncounterType[type]
    .replace(/^ER_/, "")
    .toLowerCase()
    .split("_")
    .map(w => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Pick the biome the seer reads (a revealed onward route if any, else the biome
 * you stand in) and a concrete mystery encounter that haunts it. Returns the
 * biome plus the chosen encounter type (null if that biome has no eligible ME).
 */
function eligibleEncountersFor(biome: BiomeId): MysteryEncounterType[] {
  return (biomeEncounterLookup?.get(biome) ?? []).filter(
    t => t !== MysteryEncounterType.ER_FORTUNE_TELLER && allEncounterLookup?.[t] != null,
  );
}

function readFortune(): FortuneMisc {
  const current = globalScene.arena.biomeId;
  // Prophecy points AHEAD: only revealed ONWARD routes (a biome you can travel to
  // next), never the settlement you are standing in - "an event will happen in
  // Town" while you ARE in Town reads as nonsense. If no onward route is charted
  // yet, biome stays = current as a sentinel, and the dialogue token renders it as
  // "the road ahead" rather than naming this town.
  const onward = getErPendingNodes().filter(n => n.revealed && n.biome !== current);
  const biome = onward.length > 0 ? randSeedItem(onward).biome : current;

  // Fall back to the current biome's pool if the foretold biome offers nothing.
  const eligible = eligibleEncountersFor(biome);
  const pool = eligible.length > 0 ? eligible : eligibleEncountersFor(current);

  return { type: pool.length > 0 ? randSeedItem(pool) : null, biome };
}

export const FortuneTellerEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FORTUNE_TELLER,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A mystic foreseer - Xatu, the bird that gazes at the sun and reads what is
    // to come. Uses the species sprite directly (no new asset upload needed).
    { species: SpeciesId.XATU, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([
    { text: `${namespace}:intro` },
    { speaker: `${namespace}:speaker`, text: `${namespace}:introDialogue` },
  ])
  .withOnInit(() => {
    // Synchronous: resolve the prophecy now so the description/options can name
    // it. Stash on misc for the "hear it" option to commit.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const fortune = readFortune();
    encounter.misc = fortune satisfies FortuneMisc;
    // Name a concrete onward biome when we have one; otherwise a vague "road
    // ahead" so the seer never claims the event happens in the town you're in.
    const ahead = fortune.biome !== globalScene.arena.biomeId;
    encounter.setDialogueToken("biomeName", ahead ? getBiomeName(fortune.biome) : "the lands ahead");
    encounter.setDialogueToken(
      "eventName",
      fortune.type == null ? "a fateful meeting" : prettyEncounterName(fortune.type),
    );
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
        const { type, biome } = globalScene.currentBattle.mysteryEncounter!.misc as FortuneMisc;
        if (type != null) {
          // Bend fate: queue the foreseen encounter so it spawns at the next ME
          // wave (consumed once - see battle-scene getMysteryEncounter), and chart
          // its biome as an event-revealed (blue) onward route on the World Map.
          globalScene.mysteryEncounterSaveData.queuedEncounters.push({ type, spawnPercent: PROPHECY_SPAWN_PERCENT });
          // Chart it as an event-revealed (blue) onward route on the World Map -
          // but only when it is a real ONWARD biome (not the current-biome
          // sentinel, which is not a travel destination).
          if (biome !== globalScene.arena.biomeId) {
            addErEventRevealedNode(biome);
          }
        }
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
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
