/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AbAttr,
  type AbAttrBaseParams,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  PostSummonAbAttr,
  type PreAttackModifyPowerAbAttrParams,
} from "#abilities/ab-attrs";
import type { AbBuilder } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { type EffectiveStat, Stat } from "#enums/stat";
import type { Move } from "#moves/move";
import {
  ER_BRAIN_OVER_BRAWN_ABILITY_ID,
  ER_MAGIC_TOUCH_ABILITY_ID,
  ER_RAPIER_ABILITY_ID,
  ER_SWIRLIFY_ABILITY_ID,
} from "./fakemon-pitch-abilities";

export const BRAIN_OVER_BRAWN_POWER_MULTIPLIER = 1.2;

/** Returns the room duration for the source that created it. */
export function getSwirlyRoomDuration(source: "ability" | "move"): number {
  return source === "ability" ? 3 : 5;
}

/** Whether Swirly Room is currently present on the field. */
export function isSwirlyRoomActive(): boolean {
  return !!globalScene.arena.getTag(ArenaTagType.SWIRLY_ROOM);
}

/** Swap Physical/Special without mutating the move singleton. */
export function resolveSwirlyRoomCategory(category: MoveCategory, active: boolean): MoveCategory {
  if (!active) {
    return category;
  }
  return swirlyRoomCategory(category);
}

/** Swap one damaging category; Status moves never change category. */
export function swirlyRoomCategory(category: MoveCategory): MoveCategory {
  if (category === MoveCategory.PHYSICAL) {
    return MoveCategory.SPECIAL;
  }
  if (category === MoveCategory.SPECIAL) {
    return MoveCategory.PHYSICAL;
  }
  return category;
}

/** Resolve the category used by battle damage and battle UI. */
export function getSwirlyRoomMoveCategory(move: Move, active = isSwirlyRoomActive()): MoveCategory {
  return resolveSwirlyRoomCategory(move.category, active);
}

/** Swirlify's independent three-turn entry effect. */
export class SwirlifyAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    globalScene.arena.addTag(
      ArenaTagType.SWIRLY_ROOM,
      getSwirlyRoomDuration("ability"),
      MoveId.NONE,
      pokemon.id,
      ArenaTagSide.BOTH,
    );
  }
}

/** Magic Touch keeps the move category while selecting Special Attack on contact. */
export function resolveMagicTouchStat(move: Move, _isPhysical: boolean): EffectiveStat | null {
  return move.hasFlag(MoveFlags.MAKES_CONTACT) ? Stat.SPATK : null;
}

/** Brain Over Brawn's type conversion is intentionally based on the native move type. */
export function resolveBrainOverBrawnType(type: PokemonType): PokemonType {
  return type === PokemonType.FIGHTING ? PokemonType.PSYCHIC : type;
}

/** Brain Over Brawn's power rider applies to the same native Fighting moves. */
export function resolveBrainOverBrawnPower(power: number, type: PokemonType): number {
  return type === PokemonType.FIGHTING ? power * BRAIN_OVER_BRAWN_POWER_MULTIPLIER : power;
}

/** Runtime MoveTypeChange attr for Brain Over Brawn. */
export class BrainOverBrawnTypeAbAttr extends MoveTypeChangeAbAttr {
  constructor() {
    super(PokemonType.PSYCHIC, (_pokemon, _target, move) => move.type === PokemonType.FIGHTING);
  }
}

/** Runtime power rider for Brain Over Brawn. */
export class BrainOverBrawnPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super((_pokemon, _target, move) => move.type === PokemonType.FIGHTING, BRAIN_OVER_BRAWN_POWER_MULTIPLIER);
  }

  override apply(params: PreAttackModifyPowerAbAttrParams): void {
    params.power.value = resolveBrainOverBrawnPower(params.power.value, params.move.type);
  }
}

/**
 * Returns the effective offensive stat for a Magic Touch contact move.
 * The ability is wired with the ordinary AttackStatSubstituteAbAttr in the
 * registry so the central damage path also applies defensive-stat rules.
 */
export function magicTouchAttackStat(): EffectiveStat {
  return Stat.SPATK;
}

/** Attribute-presence check used by both actual damage and preview paths. */
export function hasMultiHeadedAttr(attrs: readonly AbAttr[]): boolean {
  return attrs.some(attr => attr?.constructor?.name === "ErMultiHeadedAbAttr");
}

/** Multi-Headed's later-hit scale, or 1 for ordinary/non-composite users. */
export function getMultiHeadedHitScale(attrs: readonly AbAttr[], strikeIndex: number, hitCount: number): number {
  if (!hasMultiHeadedAttr(attrs) || strikeIndex <= 0) {
    return 1;
  }
  return hitCount <= 2 ? 0.25 : strikeIndex === 1 ? 0.2 : 0.15;
}

/** Resolve the aggregate preview multiplier for an attr-based Multi-Headed user. */
export function getMultiHeadedPreviewScale(attrs: readonly AbAttr[], headCount: number): number {
  if (!hasMultiHeadedAttr(attrs) || headCount <= 1) {
    return 1;
  }
  return headCount <= 2 ? 1.25 : 1.35;
}

/** Bidirectional Hunter's Horn ↔ Keen Edge flag injection used by Rapier. */
export class RapierFlagInjectionAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  public injects(flag: MoveFlags, move: Move): boolean {
    return (
      (flag === MoveFlags.HORN_BASED && move.hasFlag(MoveFlags.SLICING_MOVE))
      || (flag === MoveFlags.SLICING_MOVE && move.hasFlag(MoveFlags.HORN_BASED))
    );
  }
}

/** Narrow helper for central user-aware flag consumers. */
export function rapierInjectsFlag(flag: MoveFlags, move: Move): boolean {
  return (
    (flag === MoveFlags.HORN_BASED && move.hasFlag(MoveFlags.SLICING_MOVE))
    || (flag === MoveFlags.SLICING_MOVE && move.hasFlag(MoveFlags.HORN_BASED))
  );
}

/** Wires Mega Barbaracle Y's bespoke abilities. */
export function wireBarbaracleAbility(builder: AbBuilder, id: number): void {
  switch (id) {
    case ER_SWIRLIFY_ABILITY_ID:
      builder.attr(SwirlifyAbAttr);
      break;
    case ER_MAGIC_TOUCH_ABILITY_ID:
      builder.attr(AttackStatSubstituteAbAttr, {
        physicalStat: magicTouchAttackStat(),
        specialStat: magicTouchAttackStat(),
        contactOnly: true,
      });
      break;
    case ER_BRAIN_OVER_BRAWN_ABILITY_ID:
      builder.attr(BrainOverBrawnTypeAbAttr);
      builder.attr(BrainOverBrawnPowerAbAttr);
      break;
    case ER_RAPIER_ABILITY_ID:
      builder.attrs.push(new RapierFlagInjectionAbAttr());
      break;
  }
}
