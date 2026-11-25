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
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { abilityQuery, ENGINE_QUERY } from "#data/elite-redux/ability-studio/runtime-capabilities";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { AbilityId } from "#enums/ability-id";
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

/** The engine parameters of the "power of a move I use" moment, as `MovePowerBoostAbAttr.canApply` reads them. */
type MovePowerParams = Parameters<MovePowerBoostAbAttr["canApply"]>[0];

/** Marks every battler currently present as Poison-weak for this field entry. */
export class FieldPoisonWeaknessOnEntryAbAttr extends PostSummonAbAttr {
  /** The type everyone present becomes weak to (Poison by default). */
  private readonly weakType: PokemonType;

  constructor(weakType: PokemonType = PokemonType.POISON) {
    super();
    this.weakType = weakType;
  }

  override apply({ simulated }: Parameters<PostSummonAbAttr["apply"]>[0]): void {
    if (!simulated) {
      for (const pokemon of globalScene.getField(true)) {
        pokemon.tempSummonData.erWeakToType = this.weakType;
      }
    }
  }
}

/** Forces the first living opposing lead to use Struggle for its next turn only. */
export class TelekineticStruggleOnEntryAbAttr extends PostSummonAbAttr {
  /** Foe types that are not affected (Psychic and Dark by default). */
  private readonly immuneTypes: readonly PokemonType[];

  constructor(immuneTypes: readonly PokemonType[] = [PokemonType.PSYCHIC, PokemonType.DARK]) {
    super();
    this.immuneTypes = immuneTypes;
  }

  override apply({ pokemon, simulated }: Parameters<PostSummonAbAttr["apply"]>[0]): void {
    if (simulated) {
      return;
    }
    const superheavyId = ER_ID_MAP.abilities[848] as AbilityId | undefined;
    // Use the same automatic lead-target convention as other single-foe
    // on-entry effects: no target-selection prompt and no spillover to the
    // remaining doubles/triples slots. `onField=false` is deliberate because
    // the player's initial PostSummon hook can run before the enemy lead has
    // completed its own summon presentation, even though the field slot is
    // already assigned.
    const opponent = pokemon.getOpponents(false).find(candidate => !candidate.isFainted());
    if (
      !opponent
      || this.immuneTypes.some(type => opponent.isOfType(type))
      || abilityQuery(opponent, ENGINE_QUERY.HEAVY_METAL_WEIGHT)
      || (superheavyId !== undefined && opponent.hasAbility(superheavyId))
    ) {
      return;
    }
    opponent.tempSummonData.erTelekineticStruggle = true;
  }
}

/** Removes Blistering Sun's linked Tailwind when its source leaves the field. */
export class PreLeaveFieldRemoveLinkedTailwindAbAttr extends PreLeaveFieldAbAttr {
  /** The field effect that ends on the holder's side (Tailwind by default). */
  private readonly tag: ArenaTagType;

  constructor(tag: ArenaTagType = ArenaTagType.TAILWIND) {
    super();
    this.tag = tag;
  }

  override apply({ pokemon, simulated }: Parameters<PreLeaveFieldAbAttr["apply"]>[0]): void {
    if (!simulated) {
      globalScene.arena.removeTagOnSide(this.tag, pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY);
    }
  }
}

export interface BreakScreensOnAttackOptions {
  readonly contactRequired?: boolean;
  readonly flag?: MoveFlags;
}

/** Removes the target side's screens after a qualifying damaging hit. */
export class BreakScreensOnAttackAbAttr extends PostAttackAbAttr {
  constructor(
    private readonly options: BreakScreensOnAttackOptions = {},
    /** The field effects removed from the target's side (the three screens by default). */
    private readonly screens: readonly ArenaTagType[] = SCREEN_TAGS,
  ) {
    super(undefined, false);
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was `damaging && opponent standing && contact && flag`.
   * Every clause is a pure read (no draw, no write), so the "opponent standing" safety rule now runs first and the
   * three replaceable clauses are one gate; the answer for every input is unchanged.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The target must still be standing. Moved verbatim from the old `canApply`. */
  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return !!params.opponent && !params.opponent.isFainted();
  }

  /**
   * The replaceable conditions, in the old order: the move deals damage (the inherited default attack condition),
   * it makes contact (when the option asks for it), it carries the option's move flag. Moved verbatim from the old `canApply`.
   */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params)) {
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
      [...this.screens],
      opponent.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY,
    );
  }
}

/** The engine parameters of the "damage I take" moment, as `ReceivedMoveDamageMultiplierAbAttr.canApply` reads them. */
type DefendDamageParams = Parameters<ReceivedMoveDamageMultiplierAbAttr["canApply"]>[0];

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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: DefendDamageParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was the inherited `this.condition(...)`, the constructor's
   * closure `move is not a status move && attacker.isOfType(attackerType)`. That whole rule is now the replaceable gate;
   * there is no guard and no residual. Every clause is a pure read, so the answer for every input is unchanged.
   */
  override canApply(params: DefendDamageParams): boolean {
    return gatedCanApply<DefendDamageParams>(this, params);
  }

  /** The replaceable condition: the inherited rule (the closure above), moved verbatim. */
  public gate(params: DefendDamageParams): boolean {
    return super.canApply(params);
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: DefendDamageParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was the inherited `this.condition(...)`, the constructor's
   * closure `holder is at full HP && move is not a status move && the attacker's move type is moveType`. That whole rule is
   * now the replaceable gate, in the same clause order; there is no guard and no residual. Every clause is a pure read.
   */
  override canApply(params: DefendDamageParams): boolean {
    return gatedCanApply<DefendDamageParams>(this, params);
  }

  /** The replaceable conditions: the inherited rule (the closure above), moved verbatim. */
  public gate(params: DefendDamageParams): boolean {
    return super.canApply(params);
  }
}

/**
 * Turns an externally-caused negative stat change into an equal positive
 * change. The original drop is cancelled and the reflected boost is queued.
 */
export class ReverseNegativeStatChangesAbAttr extends PreStatStageChangeAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreStatStageChangeAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was `!cancelled.value && stages < 0 && source !== null`.
   * The three clauses keep their order: the safety rule (guard), the stat drop test (gate), then the source test
   * (residual: it has no library condition yet, see request R-B18-25). Every clause is a pure read.
   */
  override canApply(params: PreStatStageChangeAbAttrParams): boolean {
    return gatedCanApply<PreStatStageChangeAbAttrParams>(this, params);
  }

  /** Nothing is reversed when another effect already blocked the drop. Moved verbatim from the old `canApply`. */
  public guards({ cancelled }: PreStatStageChangeAbAttrParams): boolean {
    return !cancelled.value;
  }

  /** The replaceable condition: the stat is being lowered. Moved verbatim from the old `canApply`. */
  public gate({ stages }: PreStatStageChangeAbAttrParams): boolean {
    return stages < 0;
  }

  /** The drop must come from somewhere (source is not null). Moved verbatim; it has no library condition yet. */
  public residual({ source }: PreStatStageChangeAbAttrParams): boolean {
    return source !== null;
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was
   * `pokemon !== opponent && move is not a status move && (no moveType || opponent.getMoveType(move) === moveType) && !pokemon.getTag(tag)`.
   * The first three clauses are the replaceable gate, the last one (I do not have the effect yet) stays as the residual,
   * in the old order. Every clause is a pure read (no draw, no write).
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable conditions, in the old order. Moved verbatim from the old `canApply`. */
  public gate({ pokemon, opponent, move }: PostMoveInteractionAbAttrParams): boolean {
    return (
      pokemon !== opponent
      && move.category !== MoveCategory.STATUS
      && (this.moveType === undefined || opponent.getMoveType(move) === this.moveType)
    );
  }

  /** Feasibility: the holder does not carry the effect yet. Moved verbatim from the old `canApply`. */
  public residual({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return !pokemon.getTag(this.tag);
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: MovePowerParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). Two clauses, both pure reads, both now in the gate in this order:
   * the move's type is `type` (the inherited rule, the constructor's closure) and the holder is NOT of that type
   * (this used to be an `if` inside `apply`; `apply` only runs after `canApply` passed, so moving it here gives the same
   * answer, and the power is multiplied exactly when both held before). No guard and no residual.
   */
  override canApply(params: MovePowerParams): boolean {
    return gatedCanApply<MovePowerParams>(this, params);
  }

  /** The replaceable conditions: the inherited type rule, then "the holder is not of that type". */
  public gate(params: MovePowerParams): boolean {
    return super.canApply(params) && !params.pokemon.isOfType(this.type);
  }

  override apply(params: MovePowerParams): void {
    params.power.value *= this.fallbackMultiplier;
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: StatMultiplierAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was: not Accuracy or Evasion and one of the listed stats
   * (the guard, which stat the boost may touch), then the loop that finds the highest listed stat (the gate). Both parts
   * are pure reads and keep their order; there is no residual.
   */
  override canApply(params: StatMultiplierAbAttrParams): boolean {
    return gatedCanApply<StatMultiplierAbAttrParams>(this, params);
  }

  /** Which stats the boost may touch: one of the listed stats, never Accuracy or Evasion. Moved verbatim. */
  public guards({ stat }: StatMultiplierAbAttrParams): boolean {
    return !(stat === Stat.ACC || stat === Stat.EVA || !this.candidates.includes(stat));
  }

  /** The replaceable condition: the stat being calculated is the highest of the listed stats (ties go to the first listed). */
  public gate({ pokemon, stat }: StatMultiplierAbAttrParams): boolean {
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AllyStatMultiplierAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was: abilities are being ignored, or Accuracy or Evasion, or
   * not one of the listed stats (the guard), then the loop that finds the receiving ally's highest listed stat (the gate).
   * Both parts are pure reads and keep their order; there is no residual.
   */
  override canApply(params: AllyStatMultiplierAbAttrParams): boolean {
    return gatedCanApply<AllyStatMultiplierAbAttrParams>(this, params);
  }

  /** Mold Breaker style effects switch it off, and only the listed stats (never Accuracy or Evasion) count. Moved verbatim. */
  public guards({ stat, ignoreAbility }: AllyStatMultiplierAbAttrParams): boolean {
    return !(ignoreAbility || stat === Stat.ACC || stat === Stat.EVA || !this.candidates.includes(stat));
  }

  /** The replaceable condition: the stat is the highest of the listed stats of the ally that receives it (ties go to the first listed). */
  public gate({ target, stat }: AllyStatMultiplierAbAttrParams): boolean {
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was: the once-per-wave key is already set, or the move is a status
   * move (false), then `isOpponent(opponent) && hp <= threshold && hp + damage > threshold`, where
   * `threshold = max(1, floor(maxHp * this.threshold))`. Every clause is a pure read (no draw, no write), so the three first
   * clauses form the replaceable gate in the old order and the HP line crossing is the residual, still last as before.
   * The crossing stays in the class only because the library has no `hp.crossed-below` rounding with a minimum of 1
   * (request R-B18-30); once it exists the crossing moves into the gate.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable conditions, in the old order: not used up yet this wave, a damaging move, from an opponent. */
  public gate({ pokemon, opponent, move }: PostMoveInteractionAbAttrParams): boolean {
    return (
      !pokemon.waveData.entryEffectsFired.has(this.key)
      && move.category !== MoveCategory.STATUS
      && pokemon.isOpponent(opponent)
    );
  }

  /** The hit took my HP down to the line (at or below it, from above it). Moved verbatim from the old `canApply`. */
  public residual({ pokemon, damage }: PostMoveInteractionAbAttrParams): boolean {
    const hpThreshold = Math.max(1, Math.floor(pokemon.getMaxHp() * this.threshold));
    return pokemon.hp <= hpThreshold && pokemon.hp + damage > hpThreshold;
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

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostFaintAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was one expression, in this order: an attacker exists, a move
   * exists (the guard: without them nothing knocked me out), the move is not a status move, the attacker is not me (the gate),
   * the attacker has not fainted (the residual: there is still somebody to affect). Every clause is a pure read.
   */
  override canApply(params: PostFaintAbAttrParams): boolean {
    return gatedCanApply<PostFaintAbAttrParams>(this, params);
  }

  /** Something knocked me out: there is an attacker and a move. Moved verbatim from the old `canApply`. */
  public guards({ attacker, move }: PostFaintAbAttrParams): boolean {
    return !!attacker && !!move;
  }

  /** The replaceable conditions, in the old order: the move deals damage, the attacker is not myself. */
  public gate({ pokemon, attacker, move }: PostFaintAbAttrParams): boolean {
    return move !== undefined && move.category !== MoveCategory.STATUS && attacker !== pokemon;
  }

  /** Feasibility: the Pokemon that knocked me out is still standing. Moved verbatim from the old `canApply`. */
  public residual({ attacker }: PostFaintAbAttrParams): boolean {
    return attacker !== undefined && !attacker.isFainted();
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
  readonly berryOnly?: boolean | undefined;
  readonly contactRequired?: boolean | undefined;
  readonly moveIds?: readonly MoveId[] | undefined;
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
    // Every option key is kept, `undefined` when it was not given: the ability studio rebuilds this class from named settings, and a
    // rebuild must not look different from an original that simply left a key out. The closure above reads the object it was given.
    this.options = {
      chance: options.chance,
      berryOnly: options.berryOnly,
      contactRequired: options.contactRequired,
      moveIds: options.moveIds,
    };
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was `(simulated || randBattleSeedInt(100) < chance) && super.canApply`:
   * the chance roll first (the one draw of this clause, never while simulated), then the inherited rules. The roll is the gate; the
   * inherited rules (a damaging move, not simulated, the hit dealt damage, the move and contact filters built from `options`, and
   * the choice of a random transferable item, which draws a second number) are the residual, unchanged and still last.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable condition: the chance roll. Moved verbatim from the old `canApply`. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    return params.simulated || params.pokemon.randBattleSeedInt(100) < this.options.chance;
  }

  /** The inherited rules, unchanged: they stay in the parent classes and run after the roll, as before. */
  public residual(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params);
  }

  override getTargetHeldItems(target: Pokemon): PokemonHeldItemModifier[] {
    const items = super.getTargetHeldItems(target);
    return this.options.berryOnly ? items.filter(item => item instanceof BerryModifier) : items;
  }
}
