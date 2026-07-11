/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER achievement-expansion catalog-v2 (#900): detection for the persisted-counter /
// bitset achievements (§6.3) plus the fresh-event economy / mystery-encounter feats.
//
// Split like the social tracker: PURE `evaluate*` functions (testable, no globals) return
// the achievement KEYS a threshold crosses; the `erRecord*` observers gather live state,
// mutate the persistent gameStats counters/bitsets from a FRESH event only (never a load-time
// scan, §6.6), and fire by STRING KEY (the declarations are owned by a concurrent agent, so we
// resolve keys against the achvs registry at runtime - unknown keys are simply skipped).
//
// Every observer is fully guarded: a tracker bug can never break a battle / shop / hatch flow.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { type Achv, achvs } from "#system/achv";

/** Unlock every achievement in `ids` (keys of `achvs`). Unknown keys are skipped. */
function fireAchvs(ids: readonly string[]): void {
  const registry = achvs as unknown as Record<string, Achv>;
  for (const id of ids) {
    const achv = registry[id];
    if (achv) {
      globalScene.validateAchv(achv);
    }
  }
}

/** The persistent gameStats bag (the catalog-v2 counters/bitsets live here). */
function stats() {
  return globalScene.gameData.gameStats;
}

/** Add a value to a distinct-id bitset array in place (dedupe). Returns the new size. */
function addToSet(arr: number[], value: number): number {
  if (!arr.includes(value)) {
    arr.push(value);
  }
  return arr.length;
}

/** Add a string key to a distinct-key set array in place (dedupe). Returns the new size. */
function addToKeySet(arr: string[], value: string): number {
  if (!arr.includes(value)) {
    arr.push(value);
  }
  return arr.length;
}

// --- The four egg machines (EggSourceType) ----------------------------------
/** The four gacha machines a hatch can be sourced from (GACHA_MOVE / LEGENDARY / SHINY / REDUX). */
export const ER_GACHA_MACHINE_SOURCES: readonly number[] = [0, 1, 2, 5];

// --- The seven CLASSIC deadly sins (Seven-Sins bargain) ----------------------
/** The seven CLASSIC deadly sins required by SEVEN_DEADLY_CHECKBOXES (curiosity is excluded). */
export const SEVEN_CLASSIC_SINS: readonly string[] = [
  "greed",
  "gluttony",
  "pride",
  "wrath",
  "envy",
  "sloth",
  "lust",
];

// =============================================================================
// PURE evaluators (testable): a post-increment counter / set -> the keys it unlocks.
// =============================================================================

export function evaluateNaturalTripleWin(count: number): string[] {
  return count >= 10 ? ["NATURAL_SELECTION_BIAS"] : [];
}

export function evaluateNaturalGhostWin(count: number): string[] {
  return count >= 5 ? ["EVICTION_NOTICE"] : [];
}

export function evaluateHellGhostWin(count: number): string[] {
  return count >= 25 ? ["HELL_HOUSE"] : [];
}

export function evaluateSevenSins(sins: readonly string[]): string[] {
  return SEVEN_CLASSIC_SINS.every(sin => sins.includes(sin)) ? ["SEVEN_DEADLY_CHECKBOXES"] : [];
}

export function evaluateMysteryEncounterTypes(distinctCount: number): string[] {
  return distinctCount >= 15 ? ["STRANGER_THAN_FICTION"] : [];
}

export function evaluateRelicKinds(distinctCount: number): string[] {
  return distinctCount >= 5 ? ["MUSEUM_QUALITY"] : [];
}

export function evaluateBlackMarketRuns(count: number): string[] {
  return count >= 10 ? ["BLACK_FRIDAY"] : [];
}

export function evaluateBiomeShopTypes(distinctCount: number): string[] {
  return distinctCount >= 8 ? ["BIOME_TOURIST"] : [];
}

/** FOUR_MACHINES_ONE_DREAM (rare+) + GOLDEN_TICKET (legendary): all four machines represented. */
export function evaluateGachaSources(rarePlusSources: readonly number[], legendarySources: readonly number[]): string[] {
  const ids: string[] = [];
  if (ER_GACHA_MACHINE_SOURCES.every(src => rarePlusSources.includes(src))) {
    ids.push("FOUR_MACHINES_ONE_DREAM");
  }
  if (ER_GACHA_MACHINE_SOURCES.every(src => legendarySources.includes(src))) {
    ids.push("GOLDEN_TICKET");
  }
  return ids;
}

export function evaluateLabSpecies(distinctCount: number): string[] {
  return distinctCount >= 10 ? ["LAB_RAT"] : [];
}

export function evaluatePresetJetSet(distinctNamedPresetWins: number): string[] {
  return distinctNamedPresetWins >= 5 ? ["PRESET_JET_SET"] : [];
}

export function evaluateNameRecognition(wins: number, distinctSpecies: number): string[] {
  return wins >= 25 && distinctSpecies >= 5 ? ["NAME_RECOGNITION"] : [];
}

export function evaluateDailySeeds(distinctSeeds: number): string[] {
  return distinctSeeds >= 7 ? ["GROUNDHOG_WEEK"] : [];
}

// =============================================================================
// Observers (fresh-event only). Each mutates a persistent gameStats counter/bitset.
// =============================================================================

/** NATURAL_SELECTION_BIAS: a naturally-rolled triple win while Triples Only is inactive. */
export function erRecordNaturalTripleWin(): void {
  try {
    const s = stats();
    s.naturalTripleWins = (s.naturalTripleWins ?? 0) + 1;
    fireAchvs(evaluateNaturalTripleWin(s.naturalTripleWins));
  } catch (e) {
    console.warn("[er-achv] natural triple win detection failed:", e);
  }
}

/**
 * Ghost-trainer win counters. `natural` = a naturally-occurring ghost with Ghost Trainers
 * inactive (EVICTION_NOTICE); `hell` = the win happened on Hell (HELL_HOUSE). Both may hold.
 */
export function erRecordGhostTrainerWin(natural: boolean, hell: boolean): void {
  try {
    const s = stats();
    if (natural) {
      s.naturalGhostWins = (s.naturalGhostWins ?? 0) + 1;
      fireAchvs(evaluateNaturalGhostWin(s.naturalGhostWins));
    }
    if (hell) {
      s.hellGhostWins = (s.hellGhostWins ?? 0) + 1;
      fireAchvs(evaluateHellGhostWin(s.hellGhostWins));
    }
  } catch (e) {
    console.warn("[er-achv] ghost trainer win detection failed:", e);
  }
}

/** SEVEN_DEADLY_CHECKBOXES: resolve a Seven-Sins bargain outcome (sin key). */
export function erRecordSevenSinOutcome(sinKey: string): void {
  try {
    const s = stats();
    s.sevenSinsOutcomes ??= [];
    addToKeySet(s.sevenSinsOutcomes, sinKey);
    fireAchvs(evaluateSevenSins(s.sevenSinsOutcomes));
  } catch (e) {
    console.warn("[er-achv] seven sins detection failed:", e);
  }
}

/** STRANGER_THAN_FICTION: resolve a mystery encounter of a given type (fresh event). */
export function erRecordMysteryEncounterResolved(encounterType: number): void {
  try {
    const s = stats();
    s.mysteryEncounterTypesResolved ??= [];
    const size = addToSet(s.mysteryEncounterTypesResolved, encounterType);
    fireAchvs(evaluateMysteryEncounterTypes(size));
  } catch (e) {
    console.warn("[er-achv] mystery encounter type detection failed:", e);
  }
}

/** MUSEUM_QUALITY: acquire a relic of a given kind (fresh acquisition). */
export function erRecordRelicAcquired(relicKind: string): void {
  try {
    const s = stats();
    s.relicKindsAcquired ??= [];
    const size = addToKeySet(s.relicKindsAcquired, relicKind);
    fireAchvs(evaluateRelicKinds(size));
  } catch (e) {
    console.warn("[er-achv] relic acquisition detection failed:", e);
  }
}

/** BIOME_TOURIST: make a purchase from a biome-specific shop type (fresh visit). */
export function erRecordBiomeShopPurchase(shopType: string): void {
  try {
    const s = stats();
    s.biomeShopTypesPurchased ??= [];
    const size = addToKeySet(s.biomeShopTypesPurchased, shopType);
    fireAchvs(evaluateBiomeShopTypes(size));
  } catch (e) {
    console.warn("[er-achv] biome shop detection failed:", e);
  }
}

/**
 * FOUR_MACHINES_ONE_DREAM / GOLDEN_TICKET: an egg hatched from `source` at `tier`. `rarePlus`
 * = the hatched tier is Rare-or-better; `legendary` = the hatched tier is Legendary. Records the
 * source into the matching four-bit set.
 */
export function erRecordEggHatch(source: number, rarePlus: boolean, legendary: boolean): void {
  try {
    if (!ER_GACHA_MACHINE_SOURCES.includes(source)) {
      return;
    }
    const s = stats();
    s.gachaRarePlusHatchSources ??= [];
    s.gachaLegendaryHatchSources ??= [];
    if (rarePlus) {
      addToSet(s.gachaRarePlusHatchSources, source);
    }
    if (legendary) {
      addToSet(s.gachaLegendaryHatchSources, source);
    }
    fireAchvs(evaluateGachaSources(s.gachaRarePlusHatchSources, s.gachaLegendaryHatchSources));
  } catch (e) {
    console.warn("[er-achv] egg hatch source detection failed:", e);
  }
}

/** LAB_RAT: buy a Shiny Lab effect for a species (distinct-species set). */
export function erRecordShinyLabSpeciesPurchase(speciesId: number): void {
  try {
    const s = stats();
    s.shinyLabSpeciesPurchased ??= [];
    const size = addToSet(s.shinyLabSpeciesPurchased, speciesId);
    fireAchvs(evaluateLabSpecies(size));
  } catch (e) {
    console.warn("[er-achv] lab species detection failed:", e);
  }
}

/** FINAL_ANSWER: answer every question correctly in one mystery quiz encounter. */
export function erRecordQuizPerfect(): void {
  try {
    fireAchvs(["FINAL_ANSWER"]);
  } catch (e) {
    console.warn("[er-achv] quiz perfect detection failed:", e);
  }
}

/** DELVE_TOO_DEEP: clear the deepest (boss-guardian) tier of a delve mystery encounter. */
export function erRecordDelveDeepestCleared(): void {
  try {
    fireAchvs(["DELVE_TOO_DEEP"]);
  } catch (e) {
    console.warn("[er-achv] delve detection failed:", e);
  }
}

/** ARE_YOU_NOT_ENTERTAINED: clear the Colosseum gauntlet with no allied faint across the run. */
export function erRecordColosseumFlawlessClear(): void {
  try {
    fireAchvs(["ARE_YOU_NOT_ENTERTAINED"]);
  } catch (e) {
    console.warn("[er-achv] colosseum detection failed:", e);
  }
}

/** BLACK_FRIDAY: a black-market purchase this run (one credit per run; caller handles dedupe). */
export function erRecordBlackMarketPurchase(): void {
  try {
    const s = stats();
    s.blackMarketRunCount = (s.blackMarketRunCount ?? 0) + 1;
    fireAchvs(evaluateBlackMarketRuns(s.blackMarketRunCount));
  } catch (e) {
    console.warn("[er-achv] black market detection failed:", e);
  }
}

/** NUMBER_GO_UP: a mon's money streak reached 20 qualifying waves in one run. */
export function erRecordMoneyStreakMilestone(streakWaves: number): void {
  try {
    if (streakWaves >= 20) {
      fireAchvs(["NUMBER_GO_UP"]);
    }
  } catch (e) {
    console.warn("[er-achv] money streak milestone detection failed:", e);
  }
}

/** NAME_RECOGNITION: a trainer battle win with name-FX active on >= 1 party mon. */
export function erRecordNameFxTrainerWin(speciesIds: readonly number[]): void {
  try {
    if (speciesIds.length === 0) {
      return;
    }
    const s = stats();
    s.nameFxWinSpecies ??= [];
    for (const id of speciesIds) {
      addToSet(s.nameFxWinSpecies, id);
    }
    s.nameFxTrainerWins = (s.nameFxTrainerWins ?? 0) + 1;
    fireAchvs(evaluateNameRecognition(s.nameFxTrainerWins, s.nameFxWinSpecies.length));
  } catch (e) {
    console.warn("[er-achv] name-fx trainer win detection failed:", e);
  }
}

/** PRESET_JET_SET: a boss wave win with named Shiny Lab presets equipped (distinct names, cap 5). */
export function erRecordPresetBossWin(presetNames: readonly string[]): void {
  try {
    if (presetNames.length === 0) {
      return;
    }
    const s = stats();
    s.presetNamedBossWins ??= [];
    for (const name of presetNames) {
      if (s.presetNamedBossWins.length >= 5) {
        break;
      }
      addToKeySet(s.presetNamedBossWins, name);
    }
    fireAchvs(evaluatePresetJetSet(s.presetNamedBossWins.length));
  } catch (e) {
    console.warn("[er-achv] preset jet set detection failed:", e);
  }
}

/** GROUNDHOG_WEEK: win a Daily Run of a given seed (fresh victory only). */
export function erRecordDailySeedWon(seed: string): void {
  try {
    const s = stats();
    s.dailySeedsWon ??= [];
    if (!s.dailySeedsWon.includes(seed)) {
      s.dailySeedsWon.push(seed);
    }
    fireAchvs(evaluateDailySeeds(s.dailySeedsWon.length));
  } catch (e) {
    console.warn("[er-achv] daily seed detection failed:", e);
  }
}
