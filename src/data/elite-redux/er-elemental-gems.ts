/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - elemental Gems (one-shot 1.3x to a move of the matching type).
//
// 18 type Gems (Stellar has none). The first damaging move whose TYPE matches
// the held Gem is boosted 1.3x, then the Gem SHATTERS (consumed). Rides the same
// damage-calc hook as the Omni Gem - consumed only on REAL (non-simulated) calcs
// so the AI's damage previews don't burn it.
//
// Self-contained (no modifier.ts / modifier-type.ts surgery): class + runtime
// ModifierType factory live here; icons are PokeAPI gem sprites on er-assets
// (er_<type>_gem, loaded in loading-scene). Enemy-side for now (see
// er-reactive-items.ts for the save-registration follow-up note).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { type NumberHolder, toDmgValue } from "#utils/common";

/** The 18 elemental Gem types (no Stellar gem). */
export const ER_GEM_TYPES: readonly PokemonType[] = [
  PokemonType.NORMAL,
  PokemonType.FIRE,
  PokemonType.WATER,
  PokemonType.ELECTRIC,
  PokemonType.GRASS,
  PokemonType.ICE,
  PokemonType.FIGHTING,
  PokemonType.POISON,
  PokemonType.GROUND,
  PokemonType.FLYING,
  PokemonType.PSYCHIC,
  PokemonType.BUG,
  PokemonType.ROCK,
  PokemonType.GHOST,
  PokemonType.DRAGON,
  PokemonType.DARK,
  PokemonType.STEEL,
  PokemonType.FAIRY,
];

export const ER_GEM_MULTIPLIER = 1.3;
/** Rarity tier for distribution (shops / reward pools). */
export const ER_GEM_TIER = ModifierTier.GREAT;

/** Texture key for a gem (PokeAPI sprite on er-assets), e.g. PokemonType.FIRE -> "er_fire_gem". */
export function erGemTextureKey(type: PokemonType): string {
  return `er_${PokemonType[type].toLowerCase()}_gem`;
}
function gemName(type: PokemonType): string {
  const lower = PokemonType[type].toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)} Gem`;
}


/** A single-use elemental Gem (self-contained; enemy-side for now). */
export class ErGemModifier extends PokemonHeldItemModifier {
  public readonly gemType: PokemonType;

  constructor(type: ModifierType, pokemonId: number, gemType: PokemonType, stackCount?: number) {
    super(type, pokemonId, stackCount);
    this.gemType = gemType;
  }

  /** Persist the gem type so the held item round-trips on save/load (item-persist fix). */
  override getArgs(): unknown[] {
    return [...super.getArgs(), this.gemType];
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ErGemModifier && modifier.gemType === this.gemType;
  }

  override clone(): ErGemModifier {
    return new ErGemModifier(this.type, this.pokemonId, this.gemType, this.stackCount);
  }

  override apply(): boolean {
    return true; // the boost is applied at the damage-calc hook, not via this channel
  }

  override getMaxHeldItemCount(): number {
    return 1;
  }

  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    if (forSummary) {
      // Standalone er-assets texture - super would render a blank "items"-atlas
      // frame in the summary/party view (the "item disappeared" report class).
      const summary = globalScene.add.container(0, 0);
      const summaryItem = globalScene.add.sprite(0, 12, erGemTextureKey(this.gemType));
      summaryItem.setScale(0.5);
      summaryItem.setOrigin(0, 0.5);
      summary.add(summaryItem);
      const summaryStack = this.getIconStackText();
      if (summaryStack) {
        summary.add(summaryStack);
      }
      return summary;
    }
    // Mirror PokemonHeldItemModifier.getIcon's item-bar layout so the gem shows
    // WHOSE it is: the holder's Pokemon icon on the left, then the gem sprite
    // offset to x=16 (the gem is a standalone er-assets texture, not the items
    // atlas, so we draw it directly instead of via super). (#fix: gems were
    // rendering with no holder icon, so you couldn't tell which mon held them.)
    const container = globalScene.add.container(0, 0);
    const pokemon = this.getPokemon();
    if (pokemon) {
      const pokemonIcon = globalScene.addPokemonIcon(pokemon, -2, 10, 0, 0.5, undefined, true);
      container.add(pokemonIcon);
      container.setName(pokemon.id.toString());
    }
    const item = globalScene.add.sprite(16, 16, erGemTextureKey(this.gemType));
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

/** Build a runtime ModifierType for a gem of the given type. */
export function erGemItemType(type: PokemonType): ModifierType {
  const mt = new PokemonHeldItemModifierType(
    "",
    erGemTextureKey(type),
    (t, args) => new ErGemModifier(t, (args[0] as Pokemon).id, type),
  );
  // Pin the modifierTypeInitObj id (ER_<TYPE>_GEM) so the gem persists across
  // reload from EVERY grant path. Reward-pool grants get their id stamped by the
  // reward-screen fix-up, but gems handed out off-pool (mineral loot, events,
  // direct grants) keep id="" -> ModifierData records typeId="" -> the load drops
  // them (this is why gems vanished only "for some people"). Mirrors the relic fix.
  mt.id = `ER_${PokemonType[type]}_GEM`;
  const name = gemName(type);
  Object.defineProperty(mt, "name", { get: () => name, configurable: true });
  mt.getDescription = () =>
    `Boosts the power of the holder's first ${PokemonType[type].toLowerCase()}-type move by 30%, then shatters.`;
  mt.setTier(ER_GEM_TIER);
  return mt;
}

/**
 * Gem hook (called from getAttackDamage beside the Omni Gem): if the attacker
 * holds a Gem matching the move's type, multiply the damage and shatter it.
 * The shatter only happens on a REAL (non-simulated) calc.
 */
export function erTryApplyGem(
  source: Pokemon,
  moveType: PokemonType,
  damage: NumberHolder,
  simulated: boolean,
): void {
  if (damage.value <= 0) {
    return;
  }
  // Foe item-use suppression (Unnerve 127, As-One 266/267 — anything carrying
  // PreventItemUseAbAttr): a Pokemon whose opponent suppresses held-item use may
  // not consume its elemental Gem. Same gate the ER reactive-item consume path
  // uses (er-reactive-items.ts). Applies to simulated calcs too, so the AI does
  // not "see" a Gem boost that will not fire.
  if (source.getOpponents().some(opp => opp.hasAbilityWithAttr("PreventItemUseAbAttr"))) {
    return;
  }
  const gem = source
    .getHeldItems()
    .find((m): m is ErGemModifier => m instanceof ErGemModifier && m.gemType === moveType);
  if (!gem) {
    return;
  }
  damage.value = toDmgValue(damage.value * ER_GEM_MULTIPLIER);
  if (!simulated) {
    globalScene.removeModifier(gem, !source.isPlayer());
    globalScene.updateModifiers(source.isPlayer());
    // ER Fetch (er move 969) ledger: a shattered Gem is a "lost item". Record it
    // with its gemType so Fetch can rebuild the exact Gem (Gems are consumed via
    // removeModifier here, NOT Pokemon.loseHeldItem, so they need their own tap).
    source.battleData.lostItems.push({ typeId: gem.type?.id ?? "", gemType: gem.gemType });
    globalScene.phaseManager.queueMessage(`The ${gemName(gem.gemType)} strengthened ${source.getNameToRender()}'s move!`);
  }
}
