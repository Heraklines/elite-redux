/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - terrain Seeds (one-shot stat boost while the matching terrain
// is active).
//
//   - Electric Seed - Electric Terrain -> +1 Def
//   - Grassy Seed    - Grassy Terrain   -> +1 Def
//   - Misty Seed     - Misty Terrain    -> +1 Sp. Def
//   - Psychic Seed   - Psychic Terrain  -> +1 Sp. Def
//
// Triggers on SWITCH-IN when the holder is grounded and the matching terrain is
// already up (the common case: terrain biomes set their terrain on entry, so a
// mon that switches in pops its seed), then the seed is CONSUMED.
//
// Self-contained (no modifier.ts / modifier-type.ts surgery); icons are PokeAPI
// seed sprites on er-assets (er_<x>_seed, loaded in loading-scene). Enemy-side
// for now (see er-reactive-items.ts for the save-registration follow-up note).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { TerrainType } from "#data/terrain";
import { type BattleStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";

export type ErSeedKind = "electricSeed" | "grassySeed" | "mistySeed" | "psychicSeed";

interface ErSeedConfig {
  name: string;
  description: string;
  icon: string;
  terrain: TerrainType;
  stat: BattleStat;
}

export const ER_SEED_CONFIG: Readonly<Record<ErSeedKind, ErSeedConfig>> = {
  electricSeed: {
    name: "Electric Seed",
    description: "Raises the holder's Defense once if Electric Terrain is active. Single use.",
    icon: "er_electric_seed",
    terrain: TerrainType.ELECTRIC,
    stat: Stat.DEF,
  },
  grassySeed: {
    name: "Grassy Seed",
    description: "Raises the holder's Defense once if Grassy Terrain is active. Single use.",
    icon: "er_grassy_seed",
    terrain: TerrainType.GRASSY,
    stat: Stat.DEF,
  },
  mistySeed: {
    name: "Misty Seed",
    description: "Raises the holder's Sp. Def once if Misty Terrain is active. Single use.",
    icon: "er_misty_seed",
    terrain: TerrainType.MISTY,
    stat: Stat.SPDEF,
  },
  psychicSeed: {
    name: "Psychic Seed",
    description: "Raises the holder's Sp. Def once if Psychic Terrain is active. Single use.",
    icon: "er_psychic_seed",
    terrain: TerrainType.PSYCHIC,
    stat: Stat.SPDEF,
  },
};

const ER_SEED_KINDS = Object.keys(ER_SEED_CONFIG) as ErSeedKind[];

/** Rarity tier for distribution (shops / reward pools). */
export const ER_SEED_TIER = ModifierTier.GREAT;

/** Which seed (if any) should pop given the active terrain. PURE (unit-tested). */
export function seedProcsForTerrain(kind: ErSeedKind, terrain: TerrainType): boolean {
  return ER_SEED_CONFIG[kind].terrain === terrain;
}

/** Build the held-item icon from a standalone er-assets texture (not the items atlas). */
/** A single-use terrain Seed (self-contained; enemy-side for now). */
export class ErSeedModifier extends PokemonHeldItemModifier {
  public readonly kind: ErSeedKind;

  constructor(type: ModifierType, pokemonId: number, kind: ErSeedKind, stackCount?: number) {
    super(type, pokemonId, stackCount);
    this.kind = kind;
  }

  /** Persist the seed kind so the held item round-trips on save/load (item-persist fix). */
  override getArgs(): unknown[] {
    return [...super.getArgs(), this.kind];
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ErSeedModifier && modifier.kind === this.kind;
  }

  override clone(): ErSeedModifier {
    return new ErSeedModifier(this.type, this.pokemonId, this.kind, this.stackCount);
  }

  override apply(): boolean {
    return true; // the boost is applied on switch-in, not via this channel
  }

  override getMaxHeldItemCount(): number {
    return 1;
  }

  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    if (forSummary) {
      // Standalone er-assets texture - super would render a blank "items"-atlas
      // frame in the summary/party view (the "item disappeared" report class).
      const summary = globalScene.add.container(0, 0);
      const summaryItem = globalScene.add.sprite(0, 12, ER_SEED_CONFIG[this.kind].icon);
      summaryItem.setScale(0.5);
      summaryItem.setOrigin(0, 0.5);
      summary.add(summaryItem);
      const summaryStack = this.getIconStackText();
      if (summaryStack) {
        summary.add(summaryStack);
      }
      return summary;
    }
    // Mirror the base held-item item-bar layout so the seed shows WHOSE it is: the
    // holder Pokemon icon on the left, then the seed sprite offset to x=16 (a
    // standalone er-assets texture, drawn directly rather than via the items atlas).
    const container = globalScene.add.container(0, 0);
    const pokemon = this.getPokemon();
    if (pokemon) {
      const pokemonIcon = globalScene.addPokemonIcon(pokemon, -2, 10, 0, 0.5, undefined, true);
      container.add(pokemonIcon);
      container.setName(pokemon.id.toString());
    }
    const item = globalScene.add.sprite(16, 16, ER_SEED_CONFIG[this.kind].icon);
    item.setScale(0.5);
    item.setOrigin(0, 0.5);
    container.add(item);
    const stackText = this.getIconStackText();
    if (stackText) {
      container.add(stackText);
    }
    return container;
  }
}

/** Build a runtime ModifierType for a terrain seed. */
export function erSeedItemType(kind: ErSeedKind): ModifierType {
  const cfg = ER_SEED_CONFIG[kind];
  const mt = new PokemonHeldItemModifierType("", cfg.icon, (t, args) => new ErSeedModifier(t, (args[0] as Pokemon).id, kind));
  // Pin the modifierTypeInitObj id so the seed persists from EVERY grant path
  // (off-pool grants keep id="" -> typeId="" -> dropped on reload). See the gem
  // fix in er-elemental-gems.ts. "electricSeed" -> "ER_ELECTRIC_SEED".
  mt.id = `ER_${kind.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
  Object.defineProperty(mt, "name", { get: () => cfg.name, configurable: true });
  mt.getDescription = () => cfg.description;
  mt.setTier(ER_SEED_TIER);
  return mt;
}

/**
 * Seed hook (called from PostSummonPhase): if the grounded holder has a seed
 * whose terrain is currently active, raise the stat once and consume the seed.
 */
export function erApplyTerrainSeeds(pokemon: Pokemon): void {
  if (!pokemon.isActive(true) || !pokemon.isGrounded()) {
    return;
  }
  const terrain = globalScene.arena.terrainType;
  if (terrain === TerrainType.NONE) {
    return;
  }
  for (const kind of ER_SEED_KINDS) {
    const seed = pokemon
      .getHeldItems()
      .find((m): m is ErSeedModifier => m instanceof ErSeedModifier && m.kind === kind);
    if (!seed || !seedProcsForTerrain(kind, terrain)) {
      continue;
    }
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [ER_SEED_CONFIG[kind].stat],
      1,
    );
    globalScene.removeModifier(seed, !pokemon.isPlayer());
    globalScene.updateModifiers(pokemon.isPlayer());
  }
}
