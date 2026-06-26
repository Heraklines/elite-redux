/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "Seven Sins" - the shared, UI-agnostic deal logic for Giratina's
// Bargain. The presentation lives in TheBargainPhase (a dialogue event that fires
// in the Abyss at the every-10-waves shop slot). Most sins are pure run-state
// mutation (stat curses, vitamins, candy, level, shiny fields) - no party size
// change - so the save / ghost / trainer systems are untouched. The 8th deal,
// Curiosity, adds PER-MON run-state (an ability-slot lock + a chosen-ability
// override) stored on the mon's customPokemonData, so it round-trips through the
// SESSION save like the other per-mon run state (erInnateShrineUnlocked /
// erCursedStat) and NEVER writes the permanent starterData ability unlock. i18n
// strings live under the `mysteryEncounters/theBargain` namespace.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities, modifierTypes } from "#data/data-lists";
import { getErAbilityDescription, getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { resetErBlackShinyState } from "#data/elite-redux/er-black-shinies";
import { getLevelTotalExp } from "#data/exp";
import { AbilityId } from "#enums/ability-id";
import { Stat } from "#enums/stat";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import type { ModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { randSeedInt, randSeedShuffle } from "#utils/common";

export type BargainSinKey = "greed" | "gluttony" | "pride" | "wrath" | "envy" | "sloth" | "lust" | "curiosity";

/** All sins, in canonical order. */
export const BARGAIN_SIN_ORDER: readonly BargainSinKey[] = [
  "greed",
  "gluttony",
  "pride",
  "wrath",
  "envy",
  "sloth",
  "lust",
  "curiosity",
];

/** Candy a single mon must hold for the Lust deal to be offered + accepted. */
export const LUST_CANDY_COST = 100;

/**
 * Sins temporarily withheld from the offered pool because their reward/cost rides a
 * system with an open bug. Re-enable by removing the key. (None right now: Lust was
 * re-enabled once it stopped touching the black-shiny system - it now grants a normal
 * tier-1 shiny at a Lv1 + zero-IV + candy-wipe cost.)
 */
export const DISABLED_BARGAIN_SINS: ReadonlySet<BargainSinKey> = new Set<BargainSinKey>();

/** Stat choices offered for the Pride boost (HP excluded - a chosen combat stat). */
export const BARGAIN_STAT_CHOICES: { label: string; stat: Stat }[] = [
  { label: "Attack", stat: Stat.ATK },
  { label: "Defense", stat: Stat.DEF },
  { label: "Sp. Atk", stat: Stat.SPATK },
  { label: "Sp. Def", stat: Stat.SPDEF },
  { label: "Speed", stat: Stat.SPD },
];

/** Relics offered by Envy (the strong + the double-edged Cursed Idol / Gambler's Coin). */
export const BARGAIN_RELIC_CHOICES: { label: string; make: () => ModifierType }[] = [
  { label: "Cursed Idol", make: () => modifierTypes.ER_RELIC_CURSED_IDOL() },
  { label: "Second Wind", make: () => modifierTypes.ER_RELIC_SECOND_WIND() },
  { label: "Molten Core", make: () => modifierTypes.ER_RELIC_MOLTEN_CORE() },
  { label: "Capacitor", make: () => modifierTypes.ER_RELIC_CAPACITOR() },
  { label: "Gambler's Coin", make: () => modifierTypes.ER_RELIC_GAMBLERS_COIN() },
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
      return party.some(
        p => globalScene.gameData.getStarterDataEntry(p.species.speciesId).candyCount >= LUST_CANDY_COST,
      );
    case "curiosity":
      // Needs a mon with at least 2 usable ability slots: one to LOCK (the cost)
      // and at least one remaining to REPLACE with the rolled ability (the reward).
      return party.some(p => bargainUsableAbilitySlotCount(p) >= 2);
  }
}

/** How many ER ability slots (active + present innates) this mon exposes. */
export function bargainUsableAbilitySlotCount(pokemon: PlayerPokemon): number {
  return pokemon.getAbilitySlots().length;
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

// --- Curiosity (the 8th deal: the ability gamble) ---

/** How many random abilities the Curiosity gamble rolls for the player to choose from. */
export const CURIOSITY_ABILITY_CHOICES = 7;

/**
 * Abilities the Curiosity roll never offers - the same pure-downside set the ER
 * Ability Randomizer excludes (gambling FOR one of these is never a "reward").
 */
const CURIOSITY_EXCLUDED_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>([
  AbilityId.NONE,
  AbilityId.TRUANT,
  AbilityId.SLOW_START,
]);

/** A rolled Curiosity choice: the ability id, its display name, and its description. */
export interface BargainAbilityChoice {
  abilityId: AbilityId;
  name: string;
  description: string;
}

/**
 * The detailed description shown for a rolled ability, resolved exactly like the
 * in-game ability "Detail" view / abilities menu: the full ER ROM text, then the
 * short ER description, then pokerogue's own description.
 */
export function bargainAbilityDescription(abilityId: AbilityId): string {
  const ability = allAbilities[abilityId];
  if (!ability) {
    return "";
  }
  return getErAbilityRomDescription(ability.name) ?? getErAbilityDescription(abilityId) ?? ability.description ?? "";
}

/**
 * Seeded roll of `count` DISTINCT abilities from the real registered ability pool
 * (minus the pure-downside set). Each comes with its resolved name + description for
 * the picker. Excludes the abilities passed in `exclude` (e.g. the abilities the
 * mon's surviving slots already hold) so a roll never offers a duplicate of what it
 * would replace. Order is shuffled via the global seed for reproducibility.
 *
 * `count` defaults to {@linkcode CURIOSITY_ABILITY_CHOICES} (7) for Curiosity; the
 * Greater Ability Randomizer reuses this with a count of 4 (its simplified, no-lock
 * "Curiosity reward half"). The same exclusion + pure-downside filtering applies to
 * both, so the two share one roller instead of duplicating the picker logic.
 */
export function rollCuriosityAbilities(
  exclude: Iterable<AbilityId> = [],
  count: number = CURIOSITY_ABILITY_CHOICES,
): BargainAbilityChoice[] {
  const blocked = new Set<AbilityId>(CURIOSITY_EXCLUDED_ABILITIES);
  for (const id of exclude) {
    blocked.add(id);
  }
  const pool = allAbilities.filter(a => a != null && !blocked.has(a.id)).map(a => a.id);
  const shuffled = randSeedShuffle(pool);
  return shuffled.slice(0, count).map(abilityId => ({
    abilityId,
    name: allAbilities[abilityId]?.name ?? "",
    description: bargainAbilityDescription(abilityId),
  }));
}

/**
 * Lock one of the mon's ability slots for the REST OF THE RUN (the Curiosity cost).
 * Stored on customPokemonData (run-scoped, serialized) - it disables that slot in
 * battle + on the ability panels but NEVER touches the permanent starterData
 * ability unlock, so the ability stays unlocked in starter-select and future runs.
 */
export function bargainLockAbilitySlot(pokemon: PlayerPokemon, slot: number): void {
  const locked = pokemon.customPokemonData.erLockedAbilitySlots;
  if (!locked.includes(slot)) {
    locked.push(slot);
  }
  pokemon.updateInfo();
}

/**
 * Write the player-chosen rolled ability into one of the mon's ability slots (the
 * Curiosity reward), reusing the same per-mon override path as the ER Ability
 * Randomizer ({@linkcode Pokemon.setAbilityOverrideForSlot} -> customPokemonData).
 */
export function bargainReplaceAbilitySlot(pokemon: PlayerPokemon, slot: number, abilityId: AbilityId): void {
  pokemon.setAbilityOverrideForSlot(slot, abilityId);
  pokemon.updateInfo();
}
