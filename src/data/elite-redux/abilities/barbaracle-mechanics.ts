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
import type { PokemonAttackCondition } from "#types/ability-types";
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
  /** Turns the field effect lasts (ability studio param; the default is the original 3). */
  public readonly turnCount: number;
  /** The field effect that is set (ability studio param; the default is the original Swirly Room). */
  public readonly tagType: ArenaTagType;
  /** Which side gets it (ability studio param; the default is the original both sides). */
  public readonly side: ArenaTagSide;

  constructor(
    turnCount: number = getSwirlyRoomDuration("ability"),
    tagType: ArenaTagType = ArenaTagType.SWIRLY_ROOM,
    side: ArenaTagSide = ArenaTagSide.BOTH,
  ) {
    super();
    this.turnCount = turnCount;
    this.tagType = tagType;
    this.side = side;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    globalScene.arena.addTag(this.tagType, this.turnCount, MoveId.NONE, pokemon.id, this.side);
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
  /**
   * Both arguments are ability studio params; the defaults are the original wiring (Fighting moves become Psychic).
   * The condition reads the move's own printed type, never a type another ability changed.
   */
  constructor(
    newType: PokemonType = PokemonType.PSYCHIC,
    condition: PokemonAttackCondition = (_pokemon, _target, move) => move.type === PokemonType.FIGHTING,
  ) {
    super(newType, condition);
  }
}

/** Runtime power rider for Brain Over Brawn. */
export class BrainOverBrawnPowerAbAttr extends MovePowerBoostAbAttr {
  /**
   * Both arguments are ability studio params; the defaults are the original wiring (native Fighting moves, x1.2).
   * The apply step is the inherited `power *= multiplier`: the old override tested the move type a second time and
   * gave the same result for every move the condition lets through (see resolveBrainOverBrawnPower).
   */
  constructor(
    condition: PokemonAttackCondition = (_pokemon, _target, move) => move.type === PokemonType.FIGHTING,
    powerMultiplier: number = BRAIN_OVER_BRAWN_POWER_MULTIPLIER,
  ) {
    super(condition, powerMultiplier);
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
  /** One of the two move properties that count as each other (ability studio param; the default is the original Horn based). */
  public readonly firstFlag: MoveFlags;
  /** The other property (ability studio param; the default is the original Slicing move). */
  public readonly secondFlag: MoveFlags;

  constructor(firstFlag: MoveFlags = MoveFlags.HORN_BASED, secondFlag: MoveFlags = MoveFlags.SLICING_MOVE) {
    super(false);
    this.firstFlag = firstFlag;
    this.secondFlag = secondFlag;
  }

  public injects(flag: MoveFlags, move: Move): boolean {
    return (
      (flag === this.firstFlag && move.hasFlag(this.secondFlag))
      || (flag === this.secondFlag && move.hasFlag(this.firstFlag))
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
