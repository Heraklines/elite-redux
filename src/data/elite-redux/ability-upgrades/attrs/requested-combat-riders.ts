/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AllyStatMultiplierAbAttr,
  type AllyStatMultiplierAbAttrParams,
  MovePowerBoostAbAttr,
  PostAttackAbAttr,
  PostAttackStealHeldItemAbAttr,
  PostDefendAbAttr,
  PostFaintAbAttr,
  type PostFaintAbAttrParams,
  PostSummonAbAttr,
  PreLeaveFieldAbAttr,
  PreStatStageChangeAbAttr,
  type PreStatStageChangeAbAttrParams,
  ReceivedMoveDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
  type StatMultiplierAbAttrParams,
  TypeImmunityAbAttr,
  type TypeMultiplierAbAttrParams,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, type EffectiveStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

const SCREEN_TAGS = [ArenaTagType.REFLECT, ArenaTagType.LIGHT_SCREEN, ArenaTagType.AURORA_VEIL] as const;

/** Marks every battler currently present as Poison-weak for this field entry. */
export class FieldPoisonWeaknessOnEntryAbAttr extends PostSummonAbAttr {
  override apply({ simulated }: Parameters<PostSummonAbAttr["apply"]>[0]): void {
    if (!simulated) {
      for (const pokemon of globalScene.getField(true)) {
        pokemon.tempSummonData.erPoisonWeakness = true;
      }
    }
  }
}

/** Forces eligible opponents to use Struggle for their next turn only. */
export class TelekineticStruggleOnEntryAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: Parameters<PostSummonAbAttr["apply"]>[0]): void {
    if (simulated) {
      return;
    }
    const superheavyId = ER_ID_MAP.abilities[848] as AbilityId | undefined;
    for (const opponent of pokemon.getOpponents()) {
      if (
        opponent.isOfType(PokemonType.PSYCHIC)
        || opponent.isOfType(PokemonType.DARK)
        || opponent.hasAbility(AbilityId.HEAVY_METAL)
        || (superheavyId !== undefined && opponent.hasAbility(superheavyId))
      ) {
        continue;
      }
      opponent.tempSummonData.erTelekineticStruggle = true;
    }
  }
}

/** Removes Blistering Sun's linked Tailwind when its source leaves the field. */
export class PreLeaveFieldRemoveLinkedTailwindAbAttr extends PreLeaveFieldAbAttr {
  override apply({ pokemon, simulated }: Parameters<PreLeaveFieldAbAttr["apply"]>[0]): void {
    if (!simulated) {
      globalScene.arena.removeTagOnSide(
        ArenaTagType.TAILWIND,
        pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY,
      );
    }
  }
}

export interface BreakScreensOnAttackOptions {
  readonly contactRequired?: boolean;
  readonly flag?: MoveFlags;
}

/** Removes the target side's screens after a qualifying damaging hit. */
export class BreakScreensOnAttackAbAttr extends PostAttackAbAttr {
  constructor(private readonly options: BreakScreensOnAttackOptions = {}) {
    super(undefined, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params) || !params.opponent || params.opponent.isFainted()) {
      return false;
    }
    if (
      this.options.contactRequired
      && !params.move.doesFlagEffectApply({
        flag: MoveFlags.MAKES_CONTACT,
        user: params.pokemon,
        target: params.opponent,
      })
    ) {
      return false;
    }
    return this.options.flag === undefined || params.move.hasFlag(this.options.flag);
  }

  override apply({ opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated || !opponent) {
      return;
    }
    globalScene.arena.removeTagsOnSide(
      [...SCREEN_TAGS],
      opponent.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY,
    );
  }
}

/**
 * Halves damage from attacks used by a Pokemon of a configured type. This is
 * intentionally attacker-type based, not move-type based.
 */
export class AttackerTypeDamageReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor(
    readonly attackerType: PokemonType,
    multiplier = 0.5,
  ) {
    super(
      (_target: Pokemon, attacker: Pokemon, move: Move) =>
        move.category !== MoveCategory.STATUS && attacker.isOfType(attackerType),
      multiplier,
    );
  }
}

/** Halves one incoming move type, but only while the holder is at full HP. */
export class FullHpMoveTypeDamageReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor(
    readonly moveType: PokemonType,
    multiplier = 0.5,
  ) {
    super(
      (target: Pokemon, attacker: Pokemon, move: Move) =>
        target.isFullHp() && move.category !== MoveCategory.STATUS && attacker.getMoveType(move) === moveType,
      multiplier,
    );
  }
}

/**
 * Turns an externally-caused negative stat change into an equal positive
 * change. The original drop is cancelled and the reflected boost is queued.
 */
export class ReverseNegativeStatChangesAbAttr extends PreStatStageChangeAbAttr {
  override canApply({ cancelled, source, stages }: PreStatStageChangeAbAttrParams): boolean {
    return !cancelled.value && stages < 0 && source !== null;
  }

  override apply({ pokemon, stat, stages, cancelled, simulated }: PreStatStageChangeAbAttrParams): void {
    cancelled.value = true;
    if (!simulated) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [stat],
        Math.abs(stages),
      );
    }
  }
}

/** Applies a battler tag to the holder after it is hit by a qualifying move. */
export class PostDefendAddTagAbAttr extends PostDefendAbAttr {
  constructor(
    readonly tag: BattlerTagType,
    private readonly moveType?: PokemonType,
  ) {
    super(false);
  }

  override canApply({ pokemon, opponent, move }: PostMoveInteractionAbAttrParams): boolean {
    return (
      pokemon !== opponent
      && move.category !== MoveCategory.STATUS
      && (this.moveType === undefined || opponent.getMoveType(move) === this.moveType)
      && !pokemon.getTag(this.tag)
    );
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      pokemon.addTag(this.tag);
    }
  }
}

/**
 * Gives configured moves natural STAB when the holder has the same type,
 * otherwise applies a fallback multiplier.
 */
export class SameTypeStabOtherwiseBoostAbAttr extends MovePowerBoostAbAttr {
  constructor(
    readonly type: PokemonType,
    readonly fallbackMultiplier = 1.2,
  ) {
    super((pokemon, _target, move) => pokemon.getMoveType(move) === type, 1);
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    if (!params.pokemon.isOfType(this.type)) {
      params.power.value *= this.fallbackMultiplier;
    }
  }
}

/** Raises one selected stat when the holder gains either of the supplied tags. */
export class TaggedStateStatRaiseAbAttr extends PostDefendAbAttr {
  constructor(
    private readonly tags: readonly BattlerTagType[],
    private readonly selectStat: (pokemon: Pokemon) => BattleStat,
    private readonly stages = 1,
  ) {
    super(false);
  }

  override canApply({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return this.tags.some(tag => pokemon.getTag(tag) !== undefined);
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [this.selectStat(pokemon)],
        this.stages,
      );
    }
  }
}

/** Multiplies one offense by 5% for every fainted ally in the holder's party. */
export class FaintedAllyStatMultiplierAbAttr extends StatMultiplierAbAttr {
  constructor(
    stat: Stat.ATK | Stat.SPATK,
    readonly perFaintedAlly = 0.05,
  ) {
    super(stat, 1);
  }

  override apply({ pokemon, statVal }: StatMultiplierAbAttrParams): void {
    const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
    const faintedAllies = party.filter(ally => ally.id !== pokemon.id && ally.isFainted()).length;
    statVal.value *= 1 + faintedAllies * this.perFaintedAlly;
  }
}

/** Multiplies whichever candidate stat is naturally highest on the holder. */
export class HigherStatMultiplierAbAttr extends StatMultiplierAbAttr {
  constructor(
    readonly candidates: readonly EffectiveStat[],
    multiplier: number,
  ) {
    super(candidates[0], multiplier);
  }

  override canApply({ pokemon, stat }: StatMultiplierAbAttrParams): boolean {
    if (stat === Stat.ACC || stat === Stat.EVA || !this.candidates.includes(stat)) {
      return false;
    }
    let highest = this.candidates[0];
    for (const candidate of this.candidates.slice(1)) {
      if (pokemon.getStat(candidate, false) > pokemon.getStat(highest, false)) {
        highest = candidate;
      }
    }
    return stat === highest;
  }
}

/** Ally-facing counterpart that selects the receiving ally's highest stat. */
export class AllyHigherStatMultiplierAbAttr extends AllyStatMultiplierAbAttr {
  constructor(
    readonly candidates: readonly EffectiveStat[],
    multiplier: number,
  ) {
    super(candidates[0], multiplier);
  }

  override canApply({ target, stat, ignoreAbility }: AllyStatMultiplierAbAttrParams): boolean {
    if (ignoreAbility || stat === Stat.ACC || stat === Stat.EVA || !this.candidates.includes(stat)) {
      return false;
    }
    let highest = this.candidates[0];
    for (const candidate of this.candidates.slice(1)) {
      if (target.getStat(candidate, false) > target.getStat(highest, false)) {
        highest = candidate;
      }
    }
    return stat === highest;
  }
}

/**
 * Once per battle, raises configured stats when direct damage crosses the
 * supplied low-HP threshold.
 */
export class OnceLowHpStatRaiseAbAttr extends PostDefendAbAttr {
  constructor(
    private readonly key: string,
    readonly threshold: number,
    readonly stats: readonly BattleStat[],
    readonly stages: number,
  ) {
    super(true);
  }

  override canApply({ pokemon, opponent, move, damage }: PostMoveInteractionAbAttrParams): boolean {
    if (pokemon.waveData.entryEffectsFired.has(this.key) || move.category === MoveCategory.STATUS) {
      return false;
    }
    const hpThreshold = Math.max(1, Math.floor(pokemon.getMaxHp() * this.threshold));
    return pokemon.isOpponent(opponent) && pokemon.hp <= hpThreshold && pokemon.hp + damage > hpThreshold;
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    pokemon.waveData.entryEffectsFired.add(this.key);
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [...this.stats],
      this.stages,
    );
  }
}

/** Water immunity that raises whichever defensive stat is currently higher. */
export class TypeImmunityHigherDefenseStatRaiseAbAttr extends TypeImmunityAbAttr {
  constructor(
    type: PokemonType,
    readonly stages = 1,
  ) {
    super(type);
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    const { cancelled, pokemon, simulated, typeMultiplier } = params;
    typeMultiplier.value = 0;
    cancelled.value = true;
    if (simulated) {
      return;
    }
    const stat = pokemon.getStat(Stat.SPDEF, false) > pokemon.getStat(Stat.DEF, false) ? Stat.SPDEF : Stat.DEF;
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [stat], this.stages);
  }
}

/** Immunity to moves carrying any configured move flag. */
export class MoveFlagImmunityAbAttr extends TypeImmunityAbAttr {
  constructor(readonly flags: readonly MoveFlags[]) {
    super(PokemonType.UNKNOWN);
  }

  override canApply({ move, cancelled }: TypeMultiplierAbAttrParams): boolean {
    return !cancelled.value && this.blocks(move);
  }

  public blocks(move: Move): boolean {
    return this.flags.some(flag => move.hasFlag(flag));
  }

  override apply({ cancelled, typeMultiplier }: TypeMultiplierAbAttrParams): void {
    typeMultiplier.value = 0;
    cancelled.value = true;
  }
}

/** Applies Gastro Acid or Torment to the living direct-damage attacker on faint. */
export class OnDirectFaintRetaliationAbAttr extends PostFaintAbAttr {
  constructor(readonly moveId: MoveId.GASTRO_ACID | MoveId.TORMENT) {
    super(false);
  }

  override canApply({ pokemon, attacker, move }: PostFaintAbAttrParams): boolean {
    return (
      !!attacker && !!move && move.category !== MoveCategory.STATUS && attacker !== pokemon && !attacker.isFainted()
    );
  }

  override apply({ attacker, simulated }: PostFaintAbAttrParams): void {
    if (simulated || !attacker) {
      return;
    }
    if (this.moveId === MoveId.GASTRO_ACID) {
      attacker.suppressAbility();
      globalScene.arena.triggerWeatherBasedFormChangesToNormal();
    } else {
      attacker.addTag(BattlerTagType.TORMENT, 1);
    }
  }
}

export interface ChanceStealHeldItemOptions {
  readonly chance: number;
  readonly berryOnly?: boolean;
  readonly contactRequired?: boolean;
  readonly moveIds?: readonly MoveId[];
}

/** Chance-gated item theft with optional berry/contact/move filters. */
export class ChancePostAttackStealHeldItemAbAttr extends PostAttackStealHeldItemAbAttr {
  constructor(private readonly options: ChanceStealHeldItemOptions) {
    super((user, target, move) => {
      if (options.moveIds !== undefined && !options.moveIds.includes(move.id)) {
        return false;
      }
      return (
        !options.contactRequired
        || (target != null && move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target }))
      );
    });
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (params.simulated || params.pokemon.randBattleSeedInt(100) < this.options.chance) && super.canApply(params);
  }

  override getTargetHeldItems(target: Pokemon): PokemonHeldItemModifier[] {
    const items = super.getTargetHeldItems(target);
    return this.options.berryOnly ? items.filter(item => item instanceof BerryModifier) : items;
  }
}
