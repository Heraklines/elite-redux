/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER resistance berries (#357) — Occa/Passho/… type-resist berries.
//
// Official mechanic: while held, the berry HALVES the damage of an incoming
// SUPER-EFFECTIVE move of its type BEFORE it lands, then is consumed (one
// use). Chilan is the official outlier: it halves ANY Normal-type hit.
//
// ER twist: these are TRAINER-ONLY drops — when a trainer's party is built,
// each mon gets ONE roll (1% Ace / 5% Elite / 10% Hell); on success it holds
// one berry matching one of its weaknesses. The berries are normal held items
// otherwise: visible on the enemy, and STEALABLE (Thief/Covet/Trick), which is
// the only way players obtain them.
//
// Icons come from the vanilla items atlas (it already ships occa_berry …
// chilan_berry frames). Fairy (Roseli) has no atlas icon and is excluded from
// the weakness pick.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getTypeDamageMultiplier } from "#data/type";
import { PokemonType } from "#enums/pokemon-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { type NumberHolder, toDmgValue } from "#utils/common";

/** Berry name + items-atlas icon per covered attack type (Roseli/Fairy: no icon → excluded). */
export const ER_RESIST_BERRY_BY_TYPE: ReadonlyMap<PokemonType, { name: string; icon: string }> = new Map([
  [PokemonType.FIRE, { name: "Occa Berry", icon: "occa_berry" }],
  [PokemonType.WATER, { name: "Passho Berry", icon: "passho_berry" }],
  [PokemonType.ELECTRIC, { name: "Wacan Berry", icon: "wacan_berry" }],
  [PokemonType.GRASS, { name: "Rindo Berry", icon: "rindo_berry" }],
  [PokemonType.ICE, { name: "Yache Berry", icon: "yache_berry" }],
  [PokemonType.FIGHTING, { name: "Chople Berry", icon: "chople_berry" }],
  [PokemonType.POISON, { name: "Kebia Berry", icon: "kebia_berry" }],
  [PokemonType.GROUND, { name: "Shuca Berry", icon: "shuca_berry" }],
  [PokemonType.FLYING, { name: "Coba Berry", icon: "coba_berry" }],
  [PokemonType.PSYCHIC, { name: "Payapa Berry", icon: "payapa_berry" }],
  [PokemonType.BUG, { name: "Tanga Berry", icon: "tanga_berry" }],
  [PokemonType.ROCK, { name: "Charti Berry", icon: "charti_berry" }],
  [PokemonType.GHOST, { name: "Kasib Berry", icon: "kasib_berry" }],
  [PokemonType.DRAGON, { name: "Haban Berry", icon: "haban_berry" }],
  [PokemonType.DARK, { name: "Colbur Berry", icon: "colbur_berry" }],
  [PokemonType.STEEL, { name: "Babiri Berry", icon: "babiri_berry" }],
  [PokemonType.NORMAL, { name: "Chilan Berry", icon: "chilan_berry" }],
]);

/** Per-mon roll chance (%) that a trainer mon holds a resist berry. */
export const ER_RESIST_BERRY_CHANCE_PCT: Readonly<Record<string, number>> = {
  ace: 1,
  elite: 5,
  hell: 10,
};

/**
 * Held-item modifier: halves one incoming super-effective hit of `resistType`
 * (any hit for Chilan/Normal), then the berry is consumed. Transferable —
 * stealing it off trainer mons is how players get one.
 */
export class ErResistBerryModifier extends PokemonHeldItemModifier {
  public readonly resistType: PokemonType;

  constructor(type: PokemonHeldItemModifierType, pokemonId: number, resistType: PokemonType, stackCount?: number) {
    super(type, pokemonId, stackCount);
    this.resistType = resistType;
  }

  matchType(modifier: Modifier): boolean {
    return modifier instanceof ErResistBerryModifier && modifier.resistType === this.resistType;
  }

  clone(): ErResistBerryModifier {
    return new ErResistBerryModifier(this.type as PokemonHeldItemModifierType, this.pokemonId, this.resistType, this.stackCount);
  }

  override getArgs(): unknown[] {
    return [...super.getArgs(), this.resistType];
  }

  /** `apply(pokemon, damage)` — halve the incoming hit. */
  override apply(_pokemon: Pokemon, damage: NumberHolder): boolean {
    damage.value = toDmgValue(damage.value / 2);
    return true;
  }

  getMaxHeldItemCount(): number {
    return 1;
  }
}

/** Build the ModifierType for a resist berry of `resistType`. */
export function erResistBerryModifierType(resistType: PokemonType): PokemonHeldItemModifierType {
  const info = ER_RESIST_BERRY_BY_TYPE.get(resistType);
  const typeName = PokemonType[resistType];
  const typeLabel = typeName.charAt(0) + typeName.slice(1).toLowerCase();
  const mt = new PokemonHeldItemModifierType(
    "",
    info?.icon ?? "berry",
    (type, args) => new ErResistBerryModifier(type as PokemonHeldItemModifierType, (args[0] as Pokemon).id, resistType),
  );
  // ER items live outside the i18n catalogue — pin the live strings (the
  // `name` accessor is an i18n GETTER, so it must be redefined, same pattern
  // as er-recreated-items' withErText).
  Object.defineProperty(mt, "name", { get: () => info?.name ?? `${typeLabel} Resist Berry`, configurable: true });
  mt.getDescription = () =>
    resistType === PokemonType.NORMAL
      ? "Halves the damage of one Normal-type hit, then is eaten."
      : `Halves the damage of one super-effective ${typeLabel}-type hit, then is eaten.`;
  return mt;
}

/**
 * Damage hook (#357), called from `Pokemon.getAttackDamage` once the move
 * type + effectiveness are known. Returns true (and halves `damage`) when the
 * defender holds the matching berry; consumes the berry on a REAL (non
 * simulated) hit. Chilan triggers on any Normal hit; the rest require the hit
 * to be super-effective.
 */
export function applyErResistBerry(
  defender: Pokemon,
  moveType: PokemonType,
  typeMultiplier: number,
  damage: NumberHolder,
  simulated: boolean,
): boolean {
  if (typeMultiplier <= 0) {
    return false; // immune — nothing to weaken
  }
  // Chilan (Normal) triggers on ANY Normal hit; every other berry requires
  // the hit to be super-effective.
  if (moveType !== PokemonType.NORMAL && typeMultiplier < 2) {
    return false;
  }
  const berry = globalScene.findModifier(
    m =>
      m instanceof ErResistBerryModifier && m.pokemonId === defender.id && m.resistType === moveType,
    defender.isPlayer(),
  ) as ErResistBerryModifier | undefined;
  if (!berry) {
    return false;
  }
  berry.apply(defender, damage);
  if (!simulated) {
    defender.loseHeldItem(berry);
    globalScene.updateModifiers(defender.isPlayer());
    globalScene.phaseManager.queueMessage(
      `${defender.getNameToRender()}'s ${berry.type.name} weakened the attack!`,
    );
  }
  return true;
}

// -----------------------------------------------------------------------------
// Trainer assignment (#357) — the only way these enter the game.
// -----------------------------------------------------------------------------

/**
 * Pick the resist-berry type for `pokemon`, or `null` if it has no covered
 * weakness. The berry always matches one of the holder's type weaknesses
 * (seeded pick, stable per battle).
 */
export function pickErResistBerryType(pokemon: Pokemon): PokemonType | null {
  const defTypes = pokemon.getTypes(false, false, true);
  if (defTypes.length === 0) {
    return null;
  }
  const weaknesses = [...ER_RESIST_BERRY_BY_TYPE.keys()].filter(attackType => {
    let mult = 1;
    for (const defType of defTypes) {
      mult *= getTypeDamageMultiplier(attackType, defType);
    }
    return mult >= 2;
  });
  if (weaknesses.length === 0) {
    return null;
  }
  return weaknesses[pokemon.randBattleSeedInt(weaknesses.length)];
}

/**
 * Per-mon trainer roll (1% Ace / 5% Elite / 10% Hell): on success the mon
 * holds ONE resist berry matching one of its weaknesses. Called from
 * applyErTrainerHeldItems when a trainer's party is built. Never throws.
 */
export function maybeAssignErResistBerry(enemy: EnemyPokemon): void {
  try {
    if (!globalScene.currentBattle?.trainer) {
      return; // trainer-only drops — wild mons never hold one
    }
    const chance = ER_RESIST_BERRY_CHANCE_PCT[getErDifficulty()] ?? 0;
    if (chance <= 0 || enemy.randBattleSeedInt(100) >= chance) {
      return;
    }
    const resistType = pickErResistBerryType(enemy);
    if (resistType === null) {
      return;
    }
    const modifier = erResistBerryModifierType(resistType).newModifier(enemy) as PokemonHeldItemModifier | null;
    if (modifier) {
      globalScene.addEnemyModifier(modifier, true, true);
    }
  } catch {
    // Berry assignment must never break trainer generation.
  }
}

// -----------------------------------------------------------------------------
// Session persistence — a STOLEN berry on the player's team must survive
// save/reload. ER runtime modifier types aren't in the vanilla modifier
// registry (PersistentModifierData silently drops them on load), so the
// player's berries ride the session save as a tiny side-channel field, like
// erMoneyStreaks. Enemy-held berries are per-battle state and aren't restored
// (same limitation as all ER recreated trainer items).
// -----------------------------------------------------------------------------

/** [pokemonId, resistType] for every player-owned resist berry. */
export function getErResistBerryEntries(): [number, number][] {
  try {
    const berries = globalScene.findModifiers(m => m instanceof ErResistBerryModifier, true) as ErResistBerryModifier[];
    return berries.map(b => [b.pokemonId, b.resistType]);
  } catch {
    return [];
  }
}

/** Re-attach saved player berries after a session load (additive, validated). */
export function restoreErResistBerries(entries: readonly [number, number][] | undefined): void {
  if (!entries) {
    return;
  }
  try {
    for (const [pokemonId, resistType] of entries) {
      if (!ER_RESIST_BERRY_BY_TYPE.has(resistType as PokemonType)) {
        continue;
      }
      const already = globalScene.findModifier(
        m =>
          m instanceof ErResistBerryModifier && m.pokemonId === pokemonId && m.resistType === (resistType as PokemonType),
        true,
      );
      if (already) {
        continue;
      }
      const mt = erResistBerryModifierType(resistType as PokemonType);
      globalScene.addModifier(new ErResistBerryModifier(mt, pokemonId, resistType as PokemonType), true);
    }
    globalScene.updateModifiers(true);
  } catch {
    // Best-effort: a malformed save entry must not break session load.
  }
}
