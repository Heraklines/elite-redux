/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — recreated held items (trainer-only).
//
// A few competitive items ER trainers use have no PokeRogue equivalent. We
// recreate them as PokeRogue held-item modifiers (NOT added to the shop pool —
// trainer-only), using the ER ROM's own item icons (loaded as standalone
// textures `er_life_orb` / `er_assault_vest` / `er_rocky_helmet`).
//
//   - Life Orb     — outgoing damage ×1.3, then ~1/10 max-HP recoil to the user.
//   - Assault Vest — Sp. Def ×1.5 (the iconic special-wall boost).
//   - Rocky Helmet — a contact attacker takes 1/6 of its max HP.
//
// Damage ×1.3 is applied in `Pokemon.getAttackDamage`; Life Orb recoil and
// Rocky Helmet contact damage are applied in the move-effect phase via the
// exported helpers (kept here so all three live together).
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { Move } from "#data/moves/move";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { type Modifier, PokemonHeldItemModifier, StatBoosterModifier } from "#modifiers/modifier";
import { type NumberHolder, toDmgValue } from "#utils/common";

// --- texture keys for the ER ROM icons (loaded in loading-scene) ------------
export const ER_LIFE_ORB_TEXTURE = "er_life_orb";
export const ER_ASSAULT_VEST_TEXTURE = "er_assault_vest";
export const ER_ROCKY_HELMET_TEXTURE = "er_rocky_helmet";

/** Build the held-item icon from a standalone ER texture (not the items atlas). */
function erIconContainer(textureKey: string, stackText: () => Phaser.GameObjects.BitmapText | null) {
  const container = globalScene.add.container(0, 0);
  const item = globalScene.add.sprite(0, 12, textureKey);
  item.setScale(0.5);
  item.setOrigin(0, 0.5);
  container.add(item);
  const text = stackText();
  if (text) {
    container.add(text);
  }
  return container;
}

// --- Life Orb ---------------------------------------------------------------
export class ErLifeOrbModifier extends PokemonHeldItemModifier {
  matchType(modifier: Modifier): boolean {
    return modifier instanceof ErLifeOrbModifier;
  }
  clone(): ErLifeOrbModifier {
    return new ErLifeOrbModifier(this.type, this.pokemonId, this.stackCount);
  }
  /** `apply(pokemon, damage)` — boost outgoing damage by 1.3×. */
  override apply(_pokemon: Pokemon, damage: NumberHolder): boolean {
    damage.value = toDmgValue(damage.value * 1.3);
    return true;
  }
  getMaxHeldItemCount(): number {
    return 1;
  }
  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    return forSummary ? super.getIcon(forSummary) : erIconContainer(ER_LIFE_ORB_TEXTURE, () => this.getIconStackText());
  }
}

// --- Assault Vest (Sp. Def ×1.5) -------------------------------------------
export class ErAssaultVestModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    super(type, pokemonId, [Stat.SPDEF], 1.5, stackCount);
  }
  // The stats/multiplier are fixed in the ctor, so serialize ONLY the pokemonId -
  // StatBoosterModifier.getArgs would emit [pokemonId, stats, multiplier], which
  // this 1-arg ctor would mis-reconstruct (stats array landing in stackCount).
  override getArgs(): unknown[] {
    return [this.pokemonId];
  }
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ErAssaultVestModifier;
  }
  override clone(): ErAssaultVestModifier {
    return new ErAssaultVestModifier(this.type, this.pokemonId, this.stackCount);
  }
  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    return forSummary
      ? super.getIcon(forSummary)
      : erIconContainer(ER_ASSAULT_VEST_TEXTURE, () => this.getIconStackText());
  }
}

// --- Rocky Helmet (presence-checked in move-effect phase) -------------------
export class ErRockyHelmetModifier extends PokemonHeldItemModifier {
  matchType(modifier: Modifier): boolean {
    return modifier instanceof ErRockyHelmetModifier;
  }
  clone(): ErRockyHelmetModifier {
    return new ErRockyHelmetModifier(this.type, this.pokemonId, this.stackCount);
  }
  override apply(): boolean {
    return true; // effect is applied at the contact hook, not via this channel
  }
  getMaxHeldItemCount(): number {
    return 1;
  }
  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    return forSummary
      ? super.getIcon(forSummary)
      : erIconContainer(ER_ROCKY_HELMET_TEXTURE, () => this.getIconStackText());
  }
}

// --- modifier-types (trainer-only — never registered in the shop pool) ------
// These factories build a plain PokemonHeldItemModifierType at RUNTIME (not via
// a load-time `class … extends`), which avoids a module load-order cycle with
// modifier-type.ts. The held-item visual comes from the modifier's getIcon
// override, so a custom modifier-type subclass isn't needed.
//
// `name`/`getDescription` are normally i18n-backed (via `localeKey`), but these
// ER-only items have no locale entries, so we attach a fixed name + description
// per instance — that's what shows in the held-item tooltip on an enemy mon.
function withErText(type: ModifierType, name: string, description: string): ModifierType {
  Object.defineProperty(type, "name", { get: () => name, configurable: true });
  type.getDescription = () => description;
  return type;
}

export const ER_LIFE_ORB_TYPE = (): ModifierType =>
  withErText(
    new PokemonHeldItemModifierType("", ER_LIFE_ORB_TEXTURE, (type, args) =>
      new ErLifeOrbModifier(type, (args[0] as Pokemon).id),
    ),
    "Life Orb",
    "Boosts the holder's attacks by 30%, but the holder takes a little recoil damage each time it attacks.",
  );
export const ER_ASSAULT_VEST_TYPE = (): ModifierType =>
  withErText(
    new PokemonHeldItemModifierType("", ER_ASSAULT_VEST_TEXTURE, (type, args) =>
      new ErAssaultVestModifier(type, (args[0] as Pokemon).id),
    ),
    "Assault Vest",
    "Raises the holder's Sp. Def by 50%.",
  );
export const ER_ROCKY_HELMET_TYPE = (): ModifierType =>
  withErText(
    new PokemonHeldItemModifierType("", ER_ROCKY_HELMET_TEXTURE, (type, args) =>
      new ErRockyHelmetModifier(type, (args[0] as Pokemon).id),
    ),
    "Rocky Helmet",
    "If the holder is hit by a contact move, the attacker loses 1/6 of its max HP.",
  );

// --- move-effect-phase helpers ---------------------------------------------
/** Life Orb recoil: ~1/10 max HP to the user after a damaging hit connects. */
export function applyErLifeOrbRecoil(user: Pokemon, damageDealt: number): void {
  if (damageDealt <= 0) {
    return;
  }
  const hasOrb = globalScene.findModifier(
    m => m instanceof ErLifeOrbModifier && m.pokemonId === user.id,
    user.isPlayer(),
  );
  if (hasOrb) {
    user.damageAndUpdate(toDmgValue(user.getMaxHp() / 10), { result: HitResult.INDIRECT });
  }
}

/** Rocky Helmet: a contact attacker takes 1/6 of its max HP. */
export function applyErRockyHelmet(user: Pokemon, target: Pokemon, move: Move, damageDealt: number): void {
  if (damageDealt <= 0 || !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target })) {
    return;
  }
  const targetHasHelmet = globalScene.findModifier(
    m => m instanceof ErRockyHelmetModifier && m.pokemonId === target.id,
    target.isPlayer(),
  );
  if (targetHasHelmet && !user.isFainted()) {
    user.damageAndUpdate(toDmgValue(user.getMaxHp() / 6), { result: HitResult.INDIRECT });
  }
}
