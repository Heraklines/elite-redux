/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "Seven Sins" - the shared, UI-agnostic deal logic for Giratina's
// Bargain. The presentation lives in TheBargainPhase (a dialogue event that fires
// in the Abyss at the every-10-waves shop slot). Everything here is pure run-state
// mutation (stat curses, vitamins, candy, level, shiny fields) - no party size
// change, no new serialized save state - so the save / ghost / trainer systems are
// untouched. i18n strings live under the `mysteryEncounters/theBargain` namespace.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { playerHasErBlackShiny, resetErBlackShinyState } from "#data/elite-redux/er-black-shinies";
import { getLevelTotalExp } from "#data/exp";
import { Stat } from "#enums/stat";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import type { ModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { randSeedInt } from "#utils/common";

export type BargainSinKey = "greed" | "gluttony" | "pride" | "wrath" | "envy" | "sloth" | "lust";

/** All sins, in canonical order. */
export const BARGAIN_SIN_ORDER: readonly BargainSinKey[] = [
  "greed",
  "gluttony",
  "pride",
  "wrath",
  "envy",
  "sloth",
  "lust",
];

/**
 * Sins temporarily withheld from the offered pool because their reward/cost rides
 * a system with an open bug. Re-enable by removing the key.
 *   - "lust": its black-shiny reroll depends on the black-shiny system, which has an
 *     open in-battle regression (black shinies showing as red / Luck 3).
 */
export const DISABLED_BARGAIN_SINS: ReadonlySet<BargainSinKey> = new Set<BargainSinKey>(["lust"]);

/** Stat choices offered for the Pride boost (HP excluded - a chosen combat stat). */
export const BARGAIN_STAT_CHOICES: { label: string; stat: Stat }[] = [
  { label: "Attack", stat: Stat.ATK },
  { label: "Defense", stat: Stat.DEF },
  { label: "Sp. Atk", stat: Stat.SPATK },
  { label: "Sp. Def", stat: Stat.SPDEF },
  { label: "Speed", stat: Stat.SPD },
];

/** Relics offered by Envy (the strong + the double-edged Cursed Idol). */
export const BARGAIN_RELIC_CHOICES: { label: string; make: () => ModifierType }[] = [
  { label: "Cursed Idol", make: () => modifierTypes.ER_RELIC_CURSED_IDOL() },
  { label: "Second Wind", make: () => modifierTypes.ER_RELIC_SECOND_WIND() },
  { label: "Molten Core", make: () => modifierTypes.ER_RELIC_MOLTEN_CORE() },
  { label: "Capacitor", make: () => modifierTypes.ER_RELIC_CAPACITOR() },
];

/** Non-form-change held items a mon carries (the strippable ones for Envy). */
export function bargainHeldCount(pokemon: PlayerPokemon): number {
  return pokemon.getHeldItems().filter(m => !(m instanceof PokemonFormChangeItemModifier)).length;
}

/** Whether a Sin's preconditions are met against the current party. */
export function bargainSinAvailable(key: BargainSinKey): boolean {
  const party = globalScene.getPlayerParty();
  switch (key) {
    case "greed":
      return party.length > 0;
    case "gluttony":
    case "wrath":
    case "sloth":
      return party.length >= 2;
    case "pride":
      return party.some(p => p.isShiny());
    case "envy":
      return party.some(p => bargainHeldCount(p) >= 3);
    case "lust":
      return party.length > 0 && !playerHasErBlackShiny();
  }
}

/** Seeded Fisher-Yates pick of up to `count` keys. */
export function pickBargainSins(keys: BargainSinKey[], count: number): BargainSinKey[] {
  const arr = [...keys];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randSeedInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

/** The mon's strongest base combat stat (ATK..SPD) - target of the Wrath boost. */
export function bargainBestCombatStat(pokemon: PlayerPokemon): Stat {
  const base = pokemon.getSpeciesForm().baseStats;
  const candidates = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];
  let best = candidates[0];
  for (const s of candidates) {
    if (base[s] > base[best]) {
      best = s;
    }
  }
  return best;
}

/** Permanently boost one stat by `stacks` * 10% via the real vitamin modifier (so
 * it serializes exactly like a bought vitamin). Capped by the mon's IV in the stat. */
export function bargainGrantStatBoost(pokemon: PlayerPokemon, stat: Stat, stacks: number): void {
  const generator = modifierTypes.BASE_STAT_BOOSTER() as ModifierTypeGenerator;
  const vitamin = generator.generateType(globalScene.getPlayerParty(), [stat]);
  if (!vitamin) {
    return;
  }
  for (let i = 0; i < stacks; i++) {
    const mod = vitamin.newModifier(pokemon);
    if (mod) {
      globalScene.addModifier(mod, true, false);
    }
  }
  pokemon.calculateStats();
  pokemon.updateInfo(true);
}

/** Reset one mon to Lv 1 (exp consistent) and recompute stats. */
export function bargainResetToLevelOne(pokemon: PlayerPokemon): void {
  pokemon.level = 1;
  pokemon.exp = getLevelTotalExp(1, pokemon.species.growthRate);
  pokemon.calculateStats();
  pokemon.hp = Math.min(pokemon.hp, pokemon.getMaxHp());
  pokemon.updateInfo(true);
}

/** Zero a mon's starter-line candy (the only account-level cost; consciously spent). */
export function bargainWipeCandy(pokemon: PlayerPokemon): void {
  const entry = globalScene.gameData.getStarterDataEntry(pokemon.species.speciesId);
  entry.candyCount = 0;
}

/** Strip the live shine + Luck off a mon for the run (instance-only, dex-safe). */
export function bargainDullShine(pokemon: PlayerPokemon): void {
  if (pokemon.customPokemonData?.erBlackShiny) {
    resetErBlackShinyState(pokemon);
  }
  pokemon.shiny = false;
  pokemon.variant = 0;
  pokemon.luck = 0;
  pokemon.fusionShiny = false;
  pokemon.fusionVariant = 0;
  pokemon.fusionLuck = 0;
}

/** Apply a persistent -10% curse to a random base stat (the Bog Witch pattern). */
export function bargainCurseRandomStat(pokemon: PlayerPokemon): void {
  pokemon.customPokemonData.erCursedStat = randSeedInt(6) as Stat;
  pokemon.calculateStats();
  pokemon.updateInfo();
}
