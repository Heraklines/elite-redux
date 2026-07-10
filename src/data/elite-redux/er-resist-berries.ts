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

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { erBalanceMap } from "#data/elite-redux/er-balance-tuning";
import { erNotorietyItemRateMult } from "#data/elite-redux/er-biome-notoriety";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getTypeDamageMultiplier } from "#data/type";
import { PokemonType } from "#enums/pokemon-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { NumberHolder, toDmgValue } from "#utils/common";

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
  // ER (#420): doubled on Elite/Hell, Ace raised to 5 (was 1/5/10).
  ace: 5,
  elite: 10,
  hell: 20,
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

  /**
   * `apply(pokemon, damage)` — halve the incoming hit. A Ripen holder DOUBLES
   * the beneficial berry effect, so the reduction becomes a quarter (75% off)
   * instead of a half. Consult DoubleBerryEffectAbAttr on the holder to scale
   * the divisor (2 → 4).
   */
  override apply(pokemon: Pokemon, damage: NumberHolder): boolean {
    const divisor = new NumberHolder(2);
    applyAbAttrs("DoubleBerryEffectAbAttr", { pokemon, effectValue: divisor });
    damage.value = toDmgValue(damage.value / divisor.value);
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
  const weaknesses = erResistBerryWeaknesses(pokemon);
  if (weaknesses.length === 0) {
    return null;
  }
  return weaknesses[pokemon.randBattleSeedInt(weaknesses.length)];
}

/**
 * The covered attack types `pokemon` is weak to (>=2x), i.e. every resist berry
 * that would matter for it. Roseli/Fairy is absent from the berry map (no atlas
 * icon) and so is silently excluded. Order follows the berry map.
 */
function erResistBerryWeaknesses(pokemon: Pokemon): PokemonType[] {
  const defTypes = pokemon.getTypes(false, false, true);
  if (defTypes.length === 0) {
    return [];
  }
  return [...ER_RESIST_BERRY_BY_TYPE.keys()].filter(attackType => {
    let mult = 1;
    for (const defType of defTypes) {
      mult *= getTypeDamageMultiplier(attackType, defType);
    }
    return mult >= 2;
  });
}

/** Find a mon's resist berry of `resistType` (its side's modifier list). */
function findErResistBerry(pokemon: Pokemon, resistType: PokemonType): ErResistBerryModifier | undefined {
  return globalScene.findModifier(
    m => m instanceof ErResistBerryModifier && m.pokemonId === pokemon.id && m.resistType === resistType,
    pokemon.isPlayer(),
  ) as ErResistBerryModifier | undefined;
}

/**
 * GUARANTEED resist-berry grant — instead of the single ~chance roll, attaches
 * ONE resist berry for EVERY covered type-weakness of `enemy` (distinct types
 * stack as separate modifiers — they don't match each other). Used by the Hell
 * post-100 trainer-boss buff (#135 Tier 1) on the highest-BST trainer mon.
 * Idempotent: a weakness type the mon already holds a berry for is skipped, so
 * re-running the modifier pipeline can't double up. Never throws.
 */
export function grantErResistBerries(enemy: EnemyPokemon): void {
  try {
    for (const resistType of erResistBerryWeaknesses(enemy)) {
      if (findErResistBerry(enemy, resistType)) {
        continue;
      }
      const modifier = erResistBerryModifierType(resistType).newModifier(enemy) as PokemonHeldItemModifier | null;
      if (modifier) {
        globalScene.addEnemyModifier(modifier, true, true);
      }
    }
  } catch {
    // Forced grants must never break enemy generation.
  }
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
    const baseChance = erBalanceMap("er.items.resistBerryPct")[getErDifficulty()] ?? 0;
    // ER (#504): biome NOTORIETY scales the held-item drop rate up the longer the
    // player over-stays a biome (additive, capped). Gated to the World Map run and
    // LOCAL to the biome, so leaving resumes the normal rate exactly.
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const chance = erBiomeRoutingActive() ? baseChance * erNotorietyItemRateMult(wave) : baseChance;
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
