// =============================================================================
// Elite Redux — seed starterData entries for ER-custom species.
//
// Pokerogue's `initStarterData()` initializes `gameData.starterData[id]` only
// for species listed in `speciesStarterCosts` (a hand-curated table). ER-custom
// species (ids >= 10000) are NOT in that list, so their starterData entries
// are `undefined`, causing crashes in UI code that reads
// `starterData[speciesId].classicWinCount`, `.abilityAttr`, `.candyCount`,
// etc.
//
// This initializer walks the ER-custom species set and creates a default
// starterData entry for each. The defaults match what pokerogue would set
// for a never-seen starter:
//   - moveset: null (use species default)
//   - eggMoves: 0
//   - candyCount: 0
//   - friendship: 0
//   - abilityAttr: 0 (no ability unlocked — players unlock via candy)
//   - passiveAttr: 0 (no passive unlocked)
//   - valueReduction: 0
//   - classicWinCount: 0
//
// Wire from init/init.ts AFTER `initEliteReduxCustomSpecies()` (so the species
// exist) but BEFORE the game enters a battle (so UI lookups succeed).
//
// Note: this is in-memory only. The save-data schema doesn't currently know
// about ER-custom ids — first save after init will persist them. Loading an
// older save will simply not have these entries; we re-seed on every load.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";

const VANILLA_ID_CUTOFF = 10000;

export interface InitEliteReduxStarterDataResult {
  /** Number of ER-custom species that got a starterData + dexData entry. */
  customsSeeded: number;
  /** Number skipped because they were already present (idempotent re-run). */
  customsAlreadyPresent: number;
  /** Non-fatal real issues. */
  errors: string[];
}

/**
 * Seed starterData + dexData entries for ER-custom species so pokerogue's
 * UI / game-mode code can read them without `undefined` crashes.
 *
 * Idempotent: a second call observes the seeded state and skips.
 */
export function initEliteReduxStarterData(): InitEliteReduxStarterDataResult {
  const result: InitEliteReduxStarterDataResult = {
    customsSeeded: 0,
    customsAlreadyPresent: 0,
    errors: [],
  };

  const gameData = globalScene?.gameData;
  if (!gameData) {
    result.errors.push("globalScene.gameData is undefined — initStarterData must run first");
    return result;
  }

  // Snapshot a vanilla starter to mirror its dexData shape.
  // dexData entries share a common structure across species.
  const sampleVanillaSpeciesId = Number.parseInt(Object.keys(gameData.dexData)[0] ?? "1", 10);
  const sampleDex = gameData.dexData[sampleVanillaSpeciesId];
  const sampleStarter = gameData.starterData[sampleVanillaSpeciesId];

  for (const draft of ER_SPECIES) {
    const pokerogueId = ER_ID_MAP.species[draft.id];
    if (pokerogueId === undefined || pokerogueId < VANILLA_ID_CUTOFF) {
      continue;
    }

    // starterData seed
    if (gameData.starterData[pokerogueId] === undefined) {
      gameData.starterData[pokerogueId] = {
        moveset: null,
        eggMoves: 0,
        candyCount: 0,
        friendship: 0,
        abilityAttr: 0,
        passiveAttr: 0,
        valueReduction: 0,
        classicWinCount: 0,
      };
    } else {
      result.customsAlreadyPresent++;
      continue;
    }

    // dexData seed — minimal shape; full structure depends on the
    // sample. We copy the sample's keys to be type-safe but zero out
    // the values so the species reads as "never seen".
    if (gameData.dexData[pokerogueId] === undefined && sampleDex) {
      const blank: Record<string, unknown> = {};
      for (const key of Object.keys(sampleDex)) {
        const v = (sampleDex as unknown as Record<string, unknown>)[key];
        if (Array.isArray(v)) {
          blank[key] = new Array(v.length).fill(0);
        } else if (typeof v === "number" || typeof v === "bigint") {
          blank[key] = 0;
        } else {
          blank[key] = null;
        }
      }
      gameData.dexData[pokerogueId] = blank as (typeof gameData.dexData)[number];
    }
    void sampleStarter; // reserved for future starter-shape introspection if needed
    result.customsSeeded++;
  }

  return result;
}
