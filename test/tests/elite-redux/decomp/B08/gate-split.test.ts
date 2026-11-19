/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 1: proof that the three Tier B refactors are a pure move of code, and that every bound gate equals the
// class's own gate in states the shared L1 grid and the L2 twin cannot reach (the foe's status, every hit result, a
// Terastallized attacker, Shield Dust on the target, the holder carrying the type, a roll that passes and one that fails).
//
//   1. ORACLE: the original `canApply` of AddTypeToAttackerOnContactAbAttr, AteConditionalStatusAbAttr and
//      ChanceStatusOnHitAbAttr is copied below VERBATIM from the commit before the split (git show ce5d9815f). The
//      refactored class must give the same answer AND draw the same random ranges, in the same order, for every
//      live user and every state.
//   2. BOUND GATE: for every user whose gate is bound (not legacy), the rebuilt attr (the library gate) must agree
//      with the class's own gate in the same states, draws included.
import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setStatusOf, setTypesOf, type World } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Params = PostMoveInteractionAbAttrParams;
type Fields = Record<string, any>;

// ---------------------------------------------------------------------------------------------
// The original canApply bodies (frozen copies)

function legacyAddType(attr: Fields, params: Params): boolean {
  const { pokemon, move, opponent: attacker } = params;
  if (!move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })) {
    return false;
  }
  return !attacker.isTerastallized && !attacker.isOfType(attr.addedType);
}

function legacyAte(attr: Fields, params: Params): boolean {
  if (!PostAttackAbAttr.prototype.canApply.call(attr, params)) {
    return false;
  }
  const { pokemon, opponent: target, move, hitResult } = params;
  if (pokemon === target) {
    return false;
  }
  if (hitResult >= HitResult.NO_EFFECT) {
    return false;
  }
  if (!pokemon.isOfType(attr.newType) || pokemon.getMoveType(move) !== attr.newType) {
    return false;
  }
  if (attr.outcome.kind === "heal") {
    return params.damage > 0 && !pokemon.isFullHp();
  }
  if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")) {
    return false;
  }
  if (attr.chance !== 100 && pokemon.randBattleSeedInt(100) >= attr.chance) {
    return false;
  }
  if (attr.outcome.kind === "status") {
    return target.canSetStatus(attr.outcome.effect, true, false, pokemon);
  }
  return target.canAddTag(attr.outcome.tag);
}

const DAMAGING_HIT_RESULTS: ReadonlySet<HitResult> = new Set([
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
]);

function legacyChanceStatus(attr: Fields, params: Params): boolean {
  const { pokemon, move, opponent: attacker } = params;
  const makesContact = move.doesFlagEffectApply({
    flag: MoveFlags.MAKES_CONTACT,
    user: attacker,
    target: pokemon,
  });
  const inherentlyMakesContact = move.hasFlag(MoveFlags.MAKES_CONTACT);
  if (attr.contactExcluded) {
    if (inherentlyMakesContact) {
      return false;
    }
    if (!DAMAGING_HIT_RESULTS.has(params.hitResult)) {
      return false;
    }
  }
  if (attr.contactRequired && !makesContact) {
    return false;
  }
  if (attr.filter !== undefined) {
    throw new Error("no live user sets a filter");
  }
  if (!attr.hasTagOutcomes && attacker.status) {
    return false;
  }
  {
    const effChance =
      attr.firstTurnChance !== undefined && pokemon.tempSummonData?.waveTurnCount === 1
        ? attr.firstTurnChance
        : attr.chance;
    if (effChance !== 100 && pokemon.randBattleSeedInt(100) >= effChance) {
      return false;
    }
  }
  const outcome = attr.pickOutcome(pokemon);
  if (outcome.kind === "status") {
    return attacker.canSetStatus(outcome.value, true, false, pokemon);
  }
  return !attacker.getTag(outcome.value);
}

const LEGACY: Readonly<Record<string, (attr: Fields, params: Params) => boolean>> = {
  AddTypeToAttackerOnContactAbAttr: legacyAddType,
  AteConditionalStatusAbAttr: legacyAte,
  ChanceStatusOnHitAbAttr: legacyChanceStatus,
};

// ---------------------------------------------------------------------------------------------
// The state space

const MOVES: readonly MoveId[] = [
  MoveId.TACKLE,
  MoveId.EMBER,
  MoveId.FLAME_WHEEL,
  MoveId.WATER_GUN,
  MoveId.ROCK_SLIDE,
  MoveId.PSYCHIC,
  MoveId.SLUDGE_BOMB,
  MoveId.VINE_WHIP,
  MoveId.BITE,
  MoveId.DOUBLE_SLAP,
  MoveId.GROWL,
  MoveId.SWORDS_DANCE,
];

const HIT_RESULTS: readonly HitResult[] = [
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
  HitResult.NO_EFFECT,
  HitResult.STATUS,
  HitResult.IMMUNE,
];

interface State {
  readonly label: string;
  readonly move: MoveId;
  readonly hitResult: HitResult;
  readonly damage: number;
  readonly foeStatus: StatusEffect;
  readonly holderTypes: readonly PokemonType[] | undefined;
  readonly shieldDust: boolean;
  readonly tera: boolean;
  /** 0 = every roll comes up lowest (passes), 1 = every roll comes up highest (fails a chance below 100). */
  readonly roll: 0 | 1;
  readonly holderFull: boolean;
  /** Some states force foe.canSetStatus to true (the test world blocks paralysis for a reason outside this class). */
  readonly canSet: boolean;
  readonly foeTypes: readonly PokemonType[] | undefined;
}

function statesFor(
  types: readonly PokemonType[],
  foeTypeChoices: readonly (readonly PokemonType[] | undefined)[] = [undefined],
): State[] {
  const states: State[] = [];
  const holderTypeChoices: (readonly PokemonType[] | undefined)[] = [
    undefined,
    [PokemonType.GHOST],
    ...types.map(t => [t]),
  ];
  for (const move of MOVES) {
    for (const hitResult of HIT_RESULTS) {
      for (const foeStatus of [StatusEffect.NONE, StatusEffect.BURN]) {
        for (const holderTypes of holderTypeChoices) {
          for (const shieldDust of [false, true]) {
            for (const tera of [false, true]) {
              for (const foeTypes of foeTypeChoices) {
                for (const roll of [0, 1] as const) {
                  const holderFull = (move.valueOf() + hitResult + roll) % 2 === 0;
                  states.push({
                    label: `${MoveId[move]}, hit ${HitResult[hitResult]}, foe ${StatusEffect[foeStatus]}, holder ${holderTypes?.map(t => PokemonType[t]).join("/") ?? "natural"}, shield dust ${shieldDust}, tera ${tera}, roll ${roll}`,
                    move,
                    hitResult,
                    damage: hitResult === HitResult.EFFECTIVE ? 7 : hitResult === HitResult.NO_EFFECT ? 0 : 3,
                    foeStatus,
                    holderTypes,
                    shieldDust,
                    tera,
                    roll,
                    holderFull,
                    canSet: (hitResult + move.valueOf() + (tera ? 1 : 0)) % 3 === 0,
                    foeTypes,
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  return states;
}

interface Observation {
  readonly result: boolean;
  readonly draws: readonly number[];
}

function observe(world: World, state: State, run: (params: Params) => boolean): Observation {
  const { game, holder, foe } = world;
  setStatusOf(foe, state.foeStatus);
  setTypesOf(holder, state.holderTypes);
  setTypesOf(foe, state.foeTypes);
  foe.isTerastallized = state.tera;
  holder.hp = state.holderFull ? holder.getMaxHp() : holder.getMaxHp() - 1;
  const realCanSetStatus = foe.canSetStatus.bind(foe);
  if (state.canSet) {
    foe.canSetStatus = (() => true) as never;
  }
  const hasAbilityWithAttr = foe.hasAbilityWithAttr.bind(foe);
  foe.hasAbilityWithAttr = ((name: string, ...rest: unknown[]) =>
    name === "IgnoreMoveEffectsAbAttr" ? state.shieldDust : (hasAbilityWithAttr as any)(name, ...rest)) as never;
  const draws: number[] = [];
  const spy = vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
    draws.push(range);
    return state.roll === 0 ? min : min + range - 1;
  });
  try {
    const params = {
      pokemon: holder,
      opponent: foe,
      move: allMoves[state.move],
      damage: state.damage,
      hitResult: state.hitResult,
      simulated: false,
    } as unknown as Params;
    const result = run(params);
    return { result, draws };
  } finally {
    spy.mockRestore();
    foe.hasAbilityWithAttr = hasAbilityWithAttr as never;
    foe.canSetStatus = realCanSetStatus as never;
  }
}

function sitesOf(className: string): AttrSite[] {
  // A studio carrier has its own canApply and is not a use of the class.
  return allAttrSites().filter(site => site.className === className && !Object.hasOwn(site.attr, "canApply"));
}

function reset(world: World): void {
  setStatusOf(world.foe, StatusEffect.NONE);
  setTypesOf(world.holder, undefined);
  setTypesOf(world.foe, undefined);
  world.foe.isTerastallized = false;
}

describe("B08 Tier B: the split is a pure move of code and every bound gate equals the class's own gate", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const [className, legacy] of Object.entries(LEGACY)) {
    it(`${className}: the refactored canApply equals the frozen original for every live user`, async () => {
      const world = await startWorld(phaserGame);
      const sites = sitesOf(className);
      expect(sites.length).toBeGreaterThan(0);
      const mismatches: string[] = [];
      const neverTrue: string[] = [];
      let evaluations = 0;
      let positives = 0;
      for (const site of sites) {
        const attr = site.attr as unknown as Fields;
        const own = [attr.addedType, attr.newType].filter(t => t !== undefined) as PokemonType[];
        let siteTrue = 0;
        for (const state of statesFor(own)) {
          const before = observe(world, state, params => legacy(attr, params));
          const after = observe(world, state, params => site.attr.canApply(params as never));
          evaluations++;
          positives += before.result ? 1 : 0;
          siteTrue += before.result ? 1 : 0;
          if (before.result !== after.result || JSON.stringify(before.draws) !== JSON.stringify(after.draws)) {
            mismatches.push(
              `${site.abilityName} (${state.label}): original ${before.result} draws ${JSON.stringify(before.draws)}, refactor ${after.result} draws ${JSON.stringify(after.draws)}`,
            );
            if (mismatches.length > 10) {
              break;
            }
          }
        }
        reset(world);
        if (siteTrue === 0) {
          neverTrue.push(`${site.abilityName} (attr ${site.attrIndex})`);
        }
      }
      console.log(`B08_GATE_SPLIT ${className} evaluations=${evaluations} canApplyTrue=${positives}`);
      expect(mismatches).toEqual([]);
      // The grid must really reach the true branch of EVERY user, or the proof would be vacuous for that user.
      expect(neverTrue).toEqual([]);
      expect(positives).toBeGreaterThan(0);
    }, 600_000);

    it(`${className}: every bound gate equals the class's own gate (draws included)`, async () => {
      const world = await startWorld(phaserGame);
      const sites = sitesOf(className);
      const module = declRegistry.get(className);
      expect(module).toBeDefined();
      const mismatches: string[] = [];
      const neverTrue: string[] = [];
      let compared = 0;
      let positives = 0;
      for (const site of sites) {
        let rebuilt: ReturnType<typeof recomposeAttr>;
        try {
          rebuilt = recomposeAttr(module!, site.attr, site.abilityId, site.attrIndex);
        } catch {
          continue; // legacy gate: nothing to compare
        }
        const attr = site.attr as unknown as Fields;
        const own = [attr.addedType, attr.newType].filter(t => t !== undefined) as PokemonType[];
        let siteTrue = 0;
        for (const state of statesFor(own)) {
          const original = observe(world, state, params => site.attr.canApply(params as never));
          const library = observe(world, state, params => rebuilt.canApply(params as never));
          compared++;
          positives += original.result ? 1 : 0;
          siteTrue += original.result ? 1 : 0;
          if (original.result !== library.result || JSON.stringify(original.draws) !== JSON.stringify(library.draws)) {
            mismatches.push(
              `${site.abilityName} (${state.label}): class ${original.result} draws ${JSON.stringify(original.draws)}, library ${library.result} draws ${JSON.stringify(library.draws)}`,
            );
            if (mismatches.length > 10) {
              break;
            }
          }
        }
        reset(world);
        if (siteTrue === 0) {
          neverTrue.push(`${site.abilityName} (attr ${site.attrIndex})`);
        }
      }
      console.log(`B08_BOUND_GATE ${className} compared=${compared} canApplyTrue=${positives}`);
      expect(mismatches).toEqual([]);
      expect(neverTrue).toEqual([]);
      expect(compared).toBeGreaterThan(0);
      expect(positives).toBeGreaterThan(0);
    }, 600_000);
  }
});
