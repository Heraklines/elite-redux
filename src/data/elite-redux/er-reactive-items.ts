/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - "reactive" held items (single-use, proc when the HOLDER is hit).
//
// Mainline items ER uses that PokeRogue didn't have. Each one watches for the
// holder being hit by a damaging move of a given TYPE (or, for Weakness Policy,
// any super-effective hit), raises a stat once, then is CONSUMED:
//   - Cell Battery   - hit by Electric -> +1 Atk.
//   - Absorb Bulb    - hit by Water    -> +1 Sp. Atk.
//   - Snowball        - hit by Ice      -> +1 Atk.
//   - Luminous Moss   - hit by Water    -> +1 Sp. Def.
//   - Weakness Policy - hit super-effectively -> +2 Atk and +2 Sp. Atk.
//
// Self-contained like er-recreated-items.ts (no modifier.ts / modifier-type.ts
// surgery): the class + runtime ModifierType factory live here, icons are
// PokeAPI item sprites hosted on er-assets (er_cell_battery etc., loaded in
// loading-scene as standalone textures). The proc fires from the move-effect
// phase via `erApplyReactiveOnHit`, beside the community-item hook.
//
// NOTE: not yet registered with the vanilla save serializer, so these are
// ENEMY-side only for now (enemy items regenerate per encounter, no round-trip
// needed). Making them player-ownable / shop-stocked is a follow-up (move the
// class to modifier.ts + a factory in modifier-type.ts, like community items).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { erIsHeldItemDisabled } from "#data/battler-tags";
import { HitResult } from "#enums/hit-result";
import { ModifierTier } from "#enums/modifier-tier";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";

export type ErReactiveKind = "cellBattery" | "absorbBulb" | "snowball" | "luminousMoss" | "weaknessPolicy";

interface ErReactiveConfig {
  name: string;
  description: string;
  /** Standalone texture key (PokeAPI sprite hosted on er-assets, loaded in loading-scene). */
  icon: string;
  /** Proc when hit by a damaging move of this type (omit for Weakness Policy). */
  triggerType?: PokemonType;
  /** Proc on any super-effective hit instead of a fixed type (Weakness Policy). */
  onSuperEffective?: boolean;
  /** Stat-stage changes applied to the holder on proc. */
  boosts: [BattleStat, number][];
}

export const ER_REACTIVE_CONFIG: Readonly<Record<ErReactiveKind, ErReactiveConfig>> = {
  cellBattery: {
    name: "Cell Battery",
    description: "When the holder is hit by an Electric-type move, its Attack rises. Single use.",
    icon: "er_cell_battery",
    triggerType: PokemonType.ELECTRIC,
    boosts: [[Stat.ATK, 1]],
  },
  absorbBulb: {
    name: "Absorb Bulb",
    description: "When the holder is hit by a Water-type move, its Sp. Atk rises. Single use.",
    icon: "er_absorb_bulb",
    triggerType: PokemonType.WATER,
    boosts: [[Stat.SPATK, 1]],
  },
  snowball: {
    name: "Snowball",
    description: "When the holder is hit by an Ice-type move, its Attack rises. Single use.",
    icon: "er_snowball",
    triggerType: PokemonType.ICE,
    boosts: [[Stat.ATK, 1]],
  },
  luminousMoss: {
    name: "Luminous Moss",
    description: "When the holder is hit by a Water-type move, its Sp. Def rises. Single use.",
    icon: "er_luminous_moss",
    triggerType: PokemonType.WATER,
    boosts: [[Stat.SPDEF, 1]],
  },
  weaknessPolicy: {
    name: "Weakness Policy",
    description: "When the holder is hit by a super-effective move, its Attack and Sp. Atk sharply rise. Single use.",
    icon: "er_weakness_policy",
    onSuperEffective: true,
    boosts: [
      [Stat.ATK, 2],
      [Stat.SPATK, 2],
    ],
  },
};

const ER_REACTIVE_KINDS = Object.keys(ER_REACTIVE_CONFIG) as ErReactiveKind[];

/** Rarity tier for distribution (shops / reward pools). */
export const ER_REACTIVE_TIER = ModifierTier.ULTRA;

/**
 * Decide whether a reactive item procs and what to boost. PURE (unit-tested) -
 * no globals, so the trigger rules are testable without a battle.
 * @returns the stat boosts to apply, or `null` if it doesn't proc.
 */
export function resolveReactiveProc(
  kind: ErReactiveKind,
  moveType: PokemonType,
  hitResult: HitResult,
  dealsDamage: boolean,
): [BattleStat, number][] | null {
  if (!dealsDamage) {
    return null;
  }
  const cfg = ER_REACTIVE_CONFIG[kind];
  if (cfg.onSuperEffective) {
    return hitResult === HitResult.SUPER_EFFECTIVE ? cfg.boosts : null;
  }
  if (cfg.triggerType !== undefined && moveType === cfg.triggerType) {
    return cfg.boosts;
  }
  return null;
}

/** A single-use reactive held item (self-contained; enemy-side for now). */
export class ErReactiveItemModifier extends PokemonHeldItemModifier {
  public readonly kind: ErReactiveKind;

  constructor(type: ModifierType, pokemonId: number, kind: ErReactiveKind, stackCount?: number) {
    super(type, pokemonId, stackCount);
    this.kind = kind;
  }

  /** Persist the reactive kind so the held item round-trips on save/load (item-persist fix). */
  override getArgs(): unknown[] {
    return [...super.getArgs(), this.kind];
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ErReactiveItemModifier && modifier.kind === this.kind;
  }

  override clone(): ErReactiveItemModifier {
    return new ErReactiveItemModifier(this.type, this.pokemonId, this.kind, this.stackCount);
  }

  override apply(): boolean {
    return true; // the effect fires at the on-hit hook, not via this channel
  }

  override getMaxHeldItemCount(): number {
    return 1;
  }

  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    if (forSummary) {
      // Standalone er-assets texture - super would render a blank "items"-atlas
      // frame in the summary/party view (the "item disappeared" report class).
      const summary = globalScene.add.container(0, 0);
      const summaryItem = globalScene.add.sprite(0, 12, ER_REACTIVE_CONFIG[this.kind].icon);
      summaryItem.setScale(0.5);
      summaryItem.setOrigin(0, 0.5);
      summary.add(summaryItem);
      const summaryStack = this.getIconStackText();
      if (summaryStack) {
        summary.add(summaryStack);
      }
      return summary;
    }
    // Item-bar layout matching the elemental gems: the HOLDER's Pokemon icon on the
    // left, THEN the reactive item's standalone er-assets sprite (it is NOT in the
    // items atlas, so draw it directly rather than via super). Without the holder
    // icon you couldn't tell WHICH mon held the item - the bar showed only the item
    // sprite, with no owner (the same bug the gems had, esp. visible on enemy-held).
    const container = globalScene.add.container(0, 0);
    const pokemon = this.getPokemon();
    if (pokemon) {
      const pokemonIcon = globalScene.addPokemonIcon(pokemon, -2, 10, 0, 0.5, undefined, true);
      container.add(pokemonIcon);
      container.setName(pokemon.id.toString());
    }
    const item = globalScene.add.sprite(16, 16, ER_REACTIVE_CONFIG[this.kind].icon);
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

/** Build a runtime ModifierType for a reactive item (no load-order cycle; icon reuses an atlas frame). */
export function erReactiveItemType(kind: ErReactiveKind): ModifierType {
  const cfg = ER_REACTIVE_CONFIG[kind];
  const type = new PokemonHeldItemModifierType(
    "",
    cfg.icon,
    (t, args) => new ErReactiveItemModifier(t, (args[0] as Pokemon).id, kind),
  );
  // Pin the modifierTypeInitObj id so the item persists from EVERY grant path
  // (off-pool grants keep id="" -> typeId="" -> dropped on reload). See the gem
  // fix in er-elemental-gems.ts. "cellBattery" -> "ER_CELL_BATTERY".
  type.id = `ER_${kind.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
  Object.defineProperty(type, "name", { get: () => cfg.name, configurable: true });
  type.getDescription = () => cfg.description;
  // Pin the tier so the reward UI renders a ball sprite (undefined tier -> blank).
  type.setTier(ER_REACTIVE_TIER);
  return type;
}

/**
 * Fire any reactive item on the TARGET after it takes a damaging hit. Called
 * from the move-effect phase beside the community-item hook.
 * @param target the Pokemon that was hit (the holder)
 * @param moveType the resolved type of the move that hit it
 */
export function erApplyReactiveOnHit(
  target: Pokemon,
  moveType: PokemonType,
  hitResult: HitResult,
  dealsDamage: boolean,
): void {
  if (!dealsDamage || !target.isActive(true)) {
    return;
  }
  // As One (Calyrex riders) prevents opponents from consuming held items — this
  // extends beyond berries to ER's single-use reactive items.
  if (target.getOpponents().some(opp => opp.hasAbilityWithAttr("PreventItemUseAbAttr"))) {
    return;
  }
  for (const kind of ER_REACTIVE_KINDS) {
    const item = target
      .getHeldItems()
      .find((m): m is ErReactiveItemModifier => m instanceof ErReactiveItemModifier && m.kind === kind);
    if (!item) {
      continue;
    }
    // ER Frisk / Supersweet Syrup / Gleam Eyes item lock (ER_ITEM_DISABLED, a
    // real turn-limited tag): while this reactive item is the suppressed one, it
    // does not fire. Honouring the tag here — not just the As-One PreventItemUse
    // ability above — is what makes Gleam Eyes' exact 2-turn Embargo window real
    // for the single-use reactive items (the permanent As-One field lock was
    // dropped from case 707). Mega Stones are never the locked item.
    if (erIsHeldItemDisabled(target, item.type?.id)) {
      continue;
    }
    const boosts = resolveReactiveProc(kind, moveType, hitResult, dealsDamage);
    if (!boosts) {
      continue;
    }
    for (const [stat, stages] of boosts) {
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", target.getBattlerIndex(), true, [stat], stages);
    }
    // Single use: consume the item.
    globalScene.removeModifier(item, !target.isPlayer());
    globalScene.updateModifiers(target.isPlayer());
    globalScene.phaseManager.queueMessage(`${target.getNameToRender()}'s ${ER_REACTIVE_CONFIG[kind].name} activated!`);
  }
}
