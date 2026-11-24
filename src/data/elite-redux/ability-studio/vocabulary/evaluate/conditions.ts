/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EVALUATE (game) side of the condition library. Every atom calls the SAME engine predicate the
// original lambda used (isFullHp(), doesFlagEffectApply(), hpCrossedBelow(), ...). Conditions are
// compiled ONCE into closures; they are never interpreted per call on a hot path.

import { hpCrossedBelow, isComatoseLike } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { TrappedTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { DAMAGING_HIT_RESULTS } from "#data/elite-redux/archetypes/chance-status-on-hit";
import { ConditionalDamageAbAttr } from "#data/elite-redux/archetypes/conditional-damage";
import { Gender } from "#data/gender";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import { matchesAbilityStudioMoveFilter } from "../../rule-ab-attrs";
import { type BlockRef, type ConditionNode, isGroupAll, isGroupAny, isGroupNot } from "../composition-types";
import { type ConditionDef, getCondition } from "../conditions";
import type { CompareOp, HpRounding } from "../enums";
import { getGuard } from "../guards";
import { compareNumbers as compare, hpAtLeast, hpAtMost, hpCrossedBelowRounded } from "../hp-math";
import { type ParamValues, withParamDefaults } from "../params";
import { type Condition, type Frame, frameFromAttrParams, holderLikeOf } from "./frame";
import { evaluateGuard } from "./guards";

type Resolved = Readonly<Record<string, string | number | boolean>>;
type Factory = (p: Resolved, def: ConditionDef) => Condition;

/**
 * hp.crossed-below. `exact` calls the shared free function the original class now uses (Wimp Out,
 * Emergency Exit), Shell Bell term included. `floor-half` is the Berserk-style integer form. Do not
 * unify the two: the spec forbids it.
 */
export function crossedBelow(pokemon: Pokemon, damage: number, ratio: number, rounding: HpRounding): boolean {
  if (rounding === "exact") {
    return hpCrossedBelow(pokemon, damage, ratio);
  }
  return hpCrossedBelowRounded(pokemon.hp, pokemon.getMaxHp(), damage, ratio, rounding, 0);
}

function enumValue<T extends Record<string, string | number>>(table: T, name: string, what: string): T[keyof T] {
  if (!(name in table)) {
    throw new Error(`"${name}" is not a known ${what}`);
  }
  return table[name] as T[keyof T];
}

const STAT_BY_NAME = Stat as unknown as Record<string, number>;
const STATS_ALL = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"];

function sideOf(pokemon: Pokemon, side: string): ArenaTagSide {
  if (side === "both") {
    return ArenaTagSide.BOTH;
  }
  const own = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
  const opposing = pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
  return side === "holder-side" ? own : opposing;
}

function partyOf(pokemon: Pokemon): Pokemon[] {
  return pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
}

const TARGET_KINDS: Readonly<Record<string, readonly MoveTarget[]>> = {
  single: [MoveTarget.OTHER, MoveTarget.NEAR_OTHER, MoveTarget.NEAR_ENEMY, MoveTarget.RANDOM_NEAR_ENEMY],
  "all-foes": [MoveTarget.ALL_NEAR_ENEMIES, MoveTarget.ALL_ENEMIES, MoveTarget.ENEMY_SIDE],
  "all-others": [MoveTarget.ALL_OTHERS, MoveTarget.ALL_NEAR_OTHERS],
  "user-or-ally": [
    MoveTarget.USER,
    MoveTarget.NEAR_ALLY,
    MoveTarget.ALLY,
    MoveTarget.USER_OR_NEAR_ALLY,
    MoveTarget.USER_AND_ALLIES,
  ],
  field: [MoveTarget.BOTH_SIDES, MoveTarget.USER_SIDE, MoveTarget.ALL, MoveTarget.PARTY],
};

/** The player word of an exact aim (MOVE_AIM_OPTIONS) and the MoveTarget it stands for. */
const EXACT_TARGETS: Readonly<Record<string, MoveTarget>> = {
  "one other Pokemon, any distance": MoveTarget.OTHER,
  "one adjacent Pokemon": MoveTarget.NEAR_OTHER,
  "one adjacent foe": MoveTarget.NEAR_ENEMY,
  "one random adjacent foe": MoveTarget.RANDOM_NEAR_ENEMY,
  "all adjacent Pokemon": MoveTarget.ALL_NEAR_OTHERS,
  "all adjacent foes": MoveTarget.ALL_NEAR_ENEMIES,
  "all foes": MoveTarget.ALL_ENEMIES,
  "all other Pokemon": MoveTarget.ALL_OTHERS,
  "the foe's side of the field": MoveTarget.ENEMY_SIDE,
  "my side of the field": MoveTarget.USER_SIDE,
  "both sides of the field": MoveTarget.BOTH_SIDES,
  "only the user": MoveTarget.USER,
  "an adjacent ally": MoveTarget.NEAR_ALLY,
  "an ally, any distance": MoveTarget.ALLY,
  "the user or an adjacent ally": MoveTarget.USER_OR_NEAR_ALLY,
  "the user and its allies": MoveTarget.USER_AND_ALLIES,
  "every Pokemon": MoveTarget.ALL,
  "the whole party": MoveTarget.PARTY,
  "the Pokemon that last hit the user": MoveTarget.ATTACKER,
  "the Curse aim": MoveTarget.CURSE,
};

// ---- once-per / nth-use memory -----------------------------------------------------------
// State is keyed by (pokemon.battleData, key) through a WeakMap, never in static fields.
const onceMemory = new WeakMap<object, Map<string, unknown>>();

function memoryOf(pokemon: Pokemon): Map<string, unknown> {
  let map = onceMemory.get(pokemon.battleData);
  if (map === undefined) {
    map = new Map();
    onceMemory.set(pokemon.battleData, map);
  }
  return map;
}

/** Writes now when no rule is collecting commits, otherwise when the rule actually applies. */
function deferMemoryWrite(frame: Frame, write: () => void): void {
  if (frame.simulated) {
    return;
  }
  if (frame.commits === undefined) {
    write();
  } else {
    frame.commits.push(write);
  }
}

/** Like deferMemoryWrite, but the carrier runs it right after the IF list, whatever its outcome. */
function deferCount(frame: Frame, write: () => void): void {
  if (frame.simulated) {
    return;
  }
  if (frame.counts === undefined) {
    write();
  } else {
    frame.counts.push(write);
  }
}

function scopeMarker(pokemon: Pokemon, scope: string): unknown {
  switch (scope) {
    case "battle":
      return "battle";
    case "wave":
      return globalScene.currentBattle?.waveIndex ?? -1;
    case "turn":
      return `${globalScene.currentBattle?.waveIndex ?? -1}:${globalScene.currentBattle?.turn ?? -1}`;
    case "entry":
    case "switch":
      return pokemon.tempSummonData;
    default:
      return scope;
  }
}

const FACTORIES: Readonly<Record<string, Factory>> = {
  // HP
  "hp.full": p => frame => holderLikeOf(frame, String(p.who))?.isFullHp() ?? false,
  "hp.at-most": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    return target !== undefined && hpAtMost(target.hp, target.getMaxHp(), Number(p.pct), p.rounding as HpRounding);
  },
  "hp.at-least": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    return target !== undefined && hpAtLeast(target.hp, target.getMaxHp(), Number(p.pct), p.rounding as HpRounding);
  },
  "hp.between": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    const rounding = p.rounding as HpRounding;
    return (
      target !== undefined
      && hpAtLeast(target.hp, target.getMaxHp(), Number(p.minPct), rounding)
      && hpAtMost(target.hp, target.getMaxHp(), Number(p.maxPct), rounding)
    );
  },
  "hp.crossed-below": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    return (
      target !== undefined
      && frame.damage !== undefined
      && crossedBelow(target, frame.damage, Number(p.ratio), p.rounding as HpRounding)
    );
  },

  // Move
  "move.type": p => {
    const type = String(p.type) as keyof typeof PokemonType;
    enumValue(PokemonType, type, "type");
    return frame => {
      if (frame.move === undefined || frame.moveUser === undefined) {
        return false;
      }
      return p.effective === false
        ? frame.move.type === PokemonType[type]
        : matchesAbilityStudioMoveFilter(frame.moveUser, frame.move, { type: type as never });
    };
  },
  "move.category": p => frame =>
    frame.move !== undefined
    && frame.moveUser !== undefined
    && matchesAbilityStudioMoveFilter(frame.moveUser, frame.move, { category: String(p.category) as never }),
  "move.flag": p => {
    const flag = enumValue(MoveFlags, String(p.flag), "move property") as MoveFlags;
    return frame =>
      frame.move !== undefined
      && frame.moveUser !== undefined
      && frame.move.doesFlagEffectApply({
        flag,
        user: frame.moveUser,
        target: frame.moveUser === frame.holder ? frame.other : frame.holder,
      });
  },
  "move.power": p => frame => frame.move !== undefined && compare(frame.move.power, p.cmp as CompareOp, Number(p.n)),
  "move.damaging": () => frame =>
    frame.move !== undefined
    && frame.moveUser !== undefined
    && matchesAbilityStudioMoveFilter(frame.moveUser, frame.move, { damaging: true }),
  "move.target-kind": p => {
    const targets = TARGET_KINDS[String(p.kind)];
    return frame => frame.move !== undefined && (targets ?? []).includes(frame.move.moveTarget);
  },
  "move.aimed-at": p => {
    const target = EXACT_TARGETS[String(p.target)];
    if (target === undefined) {
      throw new Error(`"${String(p.target)}" is not a way a move can be aimed`);
    }
    return frame => frame.move !== undefined && frame.move.moveTarget === target;
  },
  "move.priority": p => frame =>
    frame.move !== undefined && compare(frame.move.priority, p.cmp as CompareOp, Number(p.n)),
  "move.multi-hit": () => frame => frame.hits !== undefined && frame.hits.count > 1,
  "move.hit-index": p => frame =>
    frame.hits !== undefined && compare(frame.hits.index, p.cmp as CompareOp, Number(p.n)),
  "move.last-hit": () => frame => frame.hits !== undefined && frame.hits.index >= frame.hits.count,
  "move.effectiveness": p => frame => {
    if (frame.move === undefined || frame.moveUser === undefined) {
      return false;
    }
    const defender = frame.moveUser === frame.holder ? frame.other : frame.holder;
    return (
      defender !== undefined
      && compare(defender.getMoveEffectiveness(frame.moveUser, frame.move), p.cmp as CompareOp, Number(p.n))
    );
  },
  "move.inherent-flag": p => {
    const flag = enumValue(MoveFlags, String(p.flag), "move property") as MoveFlags;
    return frame => frame.move?.hasFlag(flag) ?? false;
  },
  "move.drains": () => frame => frame.move?.hasAttr("HitHealAttr") ?? false,
  "hit.landed-damage": () => frame => frame.hitResult !== undefined && DAMAGING_HIT_RESULTS.has(frame.hitResult),
  "hit.critical": () => frame => !!frame.other?.turnData?.attacksReceived?.[0]?.critical,
  "move.has-effect-chance": () => frame => frame.move !== undefined && frame.move.chance >= 0,
  "move.is-move": p => {
    const id = enumValue(MoveId, String(p.moveId), "move");
    return frame => frame.move !== undefined && frame.move.id === id;
  },

  // Field
  "field.weather": p => {
    const weather = enumValue(WeatherType, String(p.weather), "weather");
    return () => globalScene.arena.weatherType === weather;
  },
  "field.terrain": p => {
    const terrain = enumValue(TerrainType, String(p.terrain), "terrain");
    return () => globalScene.arena.terrainType === terrain;
  },
  "field.arena-tag": p => {
    const tag = enumValue(ArenaTagType, String(p.tag), "field effect") as ArenaTagType;
    return frame => globalScene.arena.getTagOnSide(tag, sideOf(frame.holder, String(p.side))) !== undefined;
  },
  "field.anyone-asleep": () => frame =>
    globalScene
      .getField(true)
      .some(p => p.status?.effect === StatusEffect.SLEEP || (p === frame.holder && isComatoseLike(p))),
  "field.gravity": () => () => globalScene.arena.hasActiveGravity(),
  "field.trick-room": () => () => globalScene.arena.getTag(ArenaTagType.TRICK_ROOM) !== undefined,

  // Status and tags
  "status.has": p => {
    const status = String(p.status);
    return frame => {
      const target = holderLikeOf(frame, String(p.who));
      if (target === undefined) {
        return false;
      }
      if (status === "ANY") {
        return target.status != null;
      }
      if (status === "NONE") {
        return target.status == null;
      }
      return target.status?.effect === StatusEffect[status as keyof typeof StatusEffect];
    };
  },
  "status.confused": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    return target !== undefined && target.getTag(BattlerTagType.CONFUSED) !== undefined;
  },
  "tag.has": p => {
    const tag = enumValue(BattlerTagType, String(p.tag), "battle effect") as BattlerTagType;
    return frame => {
      const target = holderLikeOf(frame, String(p.who));
      return target !== undefined && target.getTag(tag) !== undefined;
    };
  },

  "tag.trapped": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    return target !== undefined && !!target.getTag(TrappedTag);
  },

  // Stat stages
  "stage.compare": p => {
    const stats = p.stat === "ANY" ? STATS_ALL : [String(p.stat)];
    return frame => {
      const target = holderLikeOf(frame, String(p.who));
      return (
        target !== undefined
        && stats.some(name =>
          compare(target.getStatStage(STAT_BY_NAME[name] as never), p.cmp as CompareOp, Number(p.n)),
        )
      );
    };
  },
  "stage.just-changed": p => frame => {
    if (frame.stat === undefined || frame.stages === undefined) {
      return false;
    }
    switch (p.direction) {
      case "raised":
        return frame.stages > 0;
      case "lowered":
        return frame.stages < 0;
      default:
        return frame.stages !== 0;
    }
  },

  // Time and memory
  "time.first-turn": () => frame => frame.holder.tempSummonData.waveTurnCount === 1,
  "time.turn-count": p => frame => compare(frame.holder.tempSummonData.turnCount, p.cmp as CompareOp, Number(p.n)),
  "time.last-move": p => {
    const id = enumValue(MoveId, String(p.moveId), "move");
    return frame => holderLikeOf(frame, String(p.who))?.getLastXMoves()[0]?.move === id;
  },
  "time.last-move-flag": p => {
    const flag = enumValue(MoveFlags, String(p.flag), "move property") as MoveFlags;
    return frame => {
      const last = holderLikeOf(frame, String(p.who))?.getLastXMoves(1)[0];
      return last !== undefined && allMoves[last.move]?.hasFlag(flag) === true;
    };
  },
  "time.once-per": p => {
    const scope = String(p.scope);
    // The wave scope is the per-wave memory the ER archetypes already use (pokemon.waveData.entryEffectsFired, a
    // plain Set of keys that is reset every wave), so a class that keeps its own once-per-wave flag there and its
    // library form read and write the same memory. Every other scope lives in the (battleData, key) WeakMap.
    if (scope === "wave") {
      const waveKey = String(p.key);
      return frame => {
        const fired = frame.holder.waveData.entryEffectsFired;
        if (fired.has(waveKey)) {
          return false;
        }
        deferMemoryWrite(frame, () => fired.add(waveKey));
        return true;
      };
    }
    const key = `once:${scope}:${String(p.key)}`;
    return frame => {
      const memory = memoryOf(frame.holder);
      const marker = scopeMarker(frame.holder, scope);
      if (memory.get(key) === marker) {
        return false;
      }
      deferMemoryWrite(frame, () => memory.set(key, marker));
      return true;
    };
  },
  "time.once-per-unused": p => {
    const scope = String(p.scope);
    // Read only: the same memory as time.once-per, without ever spending it.
    if (scope === "wave") {
      const waveKey = String(p.key);
      return frame => !frame.holder.waveData.entryEffectsFired.has(waveKey);
    }
    const key = `once:${scope}:${String(p.key)}`;
    return frame => memoryOf(frame.holder).get(key) !== scopeMarker(frame.holder, scope);
  },
  "time.acted": p => frame => holderLikeOf(frame, String(p.who))?.turnData?.acted ?? false,
  "time.nth-use": p => {
    const key = `nth:${String(p.key)}`;
    return frame => {
      const memory = memoryOf(frame.holder);
      const next = ((memory.get(key) as number | undefined) ?? 0) + 1;
      // The count advances on every occasion evaluation reaches this atom (the carrier runs counts after the list); simulated calls never write.
      deferCount(frame, () => memory.set(key, next));
      return next === Number(p.n);
    };
  },

  // Items
  "item.holds": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    if (target === undefined) {
      return false;
    }
    const items = target.getHeldItems();
    return p.kind === "berry" ? items.some(item => item instanceof BerryModifier) : items.length > 0;
  },
  "item.none": p => frame => holderLikeOf(frame, String(p.who))?.getHeldItems().length === 0,
  "item.lost": p => frame => {
    const data = holderLikeOf(frame, String(p.who))?.battleData;
    return data !== undefined && (data.lostItems.length > 0 || data.berriesEaten.length > 0);
  },

  // Party and side
  "side.is": p => frame => {
    const other = frame.other;
    if (other === undefined) {
      return false;
    }
    switch (p.kind) {
      case "self":
        return other === frame.holder;
      case "ally":
        return other !== frame.holder && other.isPlayer() === frame.holder.isPlayer();
      default:
        return other.isPlayer() !== frame.holder.isPlayer();
    }
  },
  "side.is-player": p => frame => holderLikeOf(frame, String(p.who))?.isPlayer() ?? false,
  "party.ally-exists": () => frame => frame.holder.getAlly() !== undefined,
  "party.ally-ability": p => {
    const ability = enumValue(AbilityId, String(p.ability), "ability") as AbilityId;
    return frame => frame.holder.getAlly()?.hasAbility(ability) ?? false;
  },
  "party.count": p => frame =>
    compare(partyOf(frame.holder).filter(member => !member.isFainted()).length, p.cmp as CompareOp, Number(p.n)),
  "party.fainted-count": p => frame =>
    compare(partyOf(frame.holder).filter(member => member.isFainted()).length, p.cmp as CompareOp, Number(p.n)),
  "party.last-pokemon": () => frame => partyOf(frame.holder).filter(member => !member.isFainted()).length === 1,
  "party.doubles": () => () => globalScene.currentBattle?.double === true,

  // Type and ability
  "mon.has-type": p => {
    const type = enumValue(PokemonType, String(p.type), "type") as PokemonType;
    return frame => holderLikeOf(frame, String(p.who))?.isOfType(type) ?? false;
  },
  "mon.opposite-gender": () => frame => {
    const { holder, other } = frame;
    return (
      other !== undefined
      && holder.gender !== Gender.GENDERLESS
      && other.gender !== Gender.GENDERLESS
      && holder.gender !== other.gender
    );
  },
  "mon.grounded": p => frame => holderLikeOf(frame, String(p.who))?.isGrounded() ?? false,
  "mon.has-ability": p => {
    const ability = enumValue(AbilityId, String(p.ability), "ability") as AbilityId;
    return frame => holderLikeOf(frame, String(p.who))?.hasAbility(ability) ?? false;
  },
  "mon.protected-from-effects": p => frame =>
    holderLikeOf(frame, String(p.who))?.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr") ?? false,
  "mon.switching-out": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    return target !== undefined && ConditionalDamageAbAttr.isTargetMidVoluntarySwitch(target);
  },
  "mon.ability-ignorable": () => frame => frame.holder.getAbility().ignorable,
  "mon.in-form": p => frame => holderLikeOf(frame, String(p.who))?.getFormKey() === String(p.key),
  "mon.in-form-number": p => frame => holderLikeOf(frame, String(p.who))?.formIndex === Number(p.formIndex),
  "mon.can-change-form": p => frame => {
    const target = holderLikeOf(frame, String(p.who));
    if (target === undefined) {
      return false;
    }
    // Both edges must be registered, otherwise the form change is a silent no-op (spec 3.4).
    const edges =
      (pokemonFormChanges as Record<number, readonly { preFormKey: string; formKey: string; trigger: unknown }[]>)[
        target.species.speciesId
      ] ?? [];
    const manual = edges.filter(edge => edge.trigger instanceof SpeciesFormChangeManualTrigger);
    return (
      manual.some(edge => edge.formKey === String(p.key)) && manual.some(edge => edge.preFormKey === String(p.key))
    );
  },

  // RNG: evaluated at its own position in the IF list, the only impure atom.
  "rng.chance": p => frame => {
    const pct = Number(p.pct);
    return frame.simulated || pct >= 100 || frame.holder.randBattleSeedInt(100) < pct;
  },

  // Escape hatches
  "escape.engine-guard": p => {
    const name = String(p.name);
    if (getGuard(name) === undefined) {
      throw new Error(`"${name}" is not a known safety rule`);
    }
    return frame => evaluateGuard(name, frame);
  },
};

function resolveParams(def: ConditionDef, params: ParamValues | undefined): Resolved {
  return withParamDefaults(def.params, params) as Resolved;
}

export function compileConditionBlock(ref: BlockRef): Condition {
  const def = getCondition(ref.block);
  if (def === undefined) {
    throw new Error(`there is no condition called "${ref.block}"`);
  }
  const factory = FACTORIES[def.id];
  if (factory === undefined) {
    throw new Error(
      `the condition "${def.id}" cannot be built from settings; it only exists on already-bound abilities`,
    );
  }
  return factory(resolveParams(def, ref.params), def);
}

/** Compiles an IF tree once. The returned closure is what runs on every hit. */
export function compileCondition(node: ConditionNode): Condition {
  if (isGroupNot(node)) {
    const inner = compileCondition(node.not);
    return frame => !inner(frame);
  }
  if (isGroupAll(node)) {
    const all = node.all.map(compileCondition);
    return frame => all.every(condition => condition(frame));
  }
  if (isGroupAny(node)) {
    const any = node.any.map(compileCondition);
    return frame => any.some(condition => condition(frame));
  }
  return compileConditionBlock(node);
}

/** Compiles an implicit-AND list in order (order matters for the one RNG atom). */
export function compileConditionList(nodes: readonly ConditionNode[]): Condition {
  const compiled = nodes.map(compileCondition);
  return frame => {
    for (const condition of compiled) {
      if (!condition(frame)) {
        return false;
      }
    }
    return true;
  };
}

/** The ids that have a game-side implementation (a test keeps this equal to the pure registry). */
export function implementedConditionIds(): string[] {
  return Object.keys(FACTORIES).sort();
}

// ---- Adapters from engine signatures to the frame -----------------------------------------

/** AbAttrCondition: (pokemon) => boolean. */
export function asHolderCondition(condition: Condition): (pokemon: Pokemon) => boolean {
  return pokemon => condition({ holder: pokemon, simulated: true });
}

/** PokemonAttackCondition: (user, target, move) => boolean. */
export function asAttackCondition(
  condition: Condition,
): (user: Pokemon, target: Pokemon | null, move: Frame["move"]) => boolean {
  return (user, target, move) =>
    condition({ holder: user, other: target ?? undefined, move, moveUser: user, simulated: true });
}

/** PokemonDefendCondition: (target, user, move) => boolean. */
export function asDefendCondition(
  condition: Condition,
): (target: Pokemon, user: Pokemon, move: Frame["move"]) => boolean {
  return (target, user, move) => condition({ holder: target, other: user, move, moveUser: user, simulated: true });
}

/**
 * A library IF tree installed as the Tier B `gate` slot (decl condition ctx "params"). The gate receives
 * the engine parameter object of the WHEN, exactly like `canApply`, and builds the frame the way the
 * composition carrier does (so the effective-damage rewrite of after-taking-damage applies here too).
 *
 * It follows the carrier's evaluation protocol: atoms answer their real value in order, nth-use counts
 * are written right after the list, and once-per memory writes WAIT in `commit`, which `buildAttr`
 * runs when `apply` runs. The pending writes are keyed by the holder, so a `prepare` step that hands the
 * gate a different parameter object than the engine's does not lose them.
 */
export interface ParamsGate {
  readonly gate: (params: object) => boolean;
  readonly commit: (params: object) => void;
}

export function asParamsGate(whenId: string, condition: Condition): ParamsGate {
  const pending = new WeakMap<object, (() => void)[]>();
  const holderOf = (params: object): object => (params as { pokemon: object }).pokemon;
  return {
    gate: params => {
      const frame = frameFromAttrParams(whenId, params);
      frame.commits = [];
      frame.counts = [];
      const passed = condition(frame);
      const { commits, counts } = frame;
      frame.commits = undefined;
      frame.counts = undefined;
      for (const count of counts ?? []) {
        count();
      }
      if (passed) {
        pending.set(holderOf(params), commits ?? []);
      } else {
        pending.delete(holderOf(params));
      }
      return passed;
    },
    commit: params => {
      const key = holderOf(params);
      for (const write of pending.get(key) ?? []) {
        write();
      }
      pending.delete(key);
    },
  };
}
