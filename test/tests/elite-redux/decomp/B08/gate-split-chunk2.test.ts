/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2: proof that the Tier B refactors of the eight classes are a pure move of code, and that every bound gate
// equals the class's own gate in states the shared L1 grid cannot reach (critical hits, the target's lasting effects and
// stat stages, who is asleep, a target that is about to switch, the holder's first turn, what the foe did this turn,
// Shield Dust, a roll that passes and a roll that fails).
//
//   1. ORACLE: the original `canApply` bodies of ChanceBattlerTagOnHitAbAttr, ChanceStatusOnAttackAbAttr,
//      ChanceBattlerTagOnAttackAbAttr, ConditionalDamageAbAttr, FirstDefendDamageReductionAbAttr,
//      FirstDefendAttackerAtkDropAbAttr and ContactQuashAbAttr are copied below VERBATIM from the commit before the split
//      (git show b32c5d829). The refactored class must give the same answer AND draw the same random ranges, in the same
//      order, for every live user and every state.
//   2. BOUND GATE: for every user whose gate is bound (not legacy), the rebuilt attr (the library gate) must agree with the
//      class's own canApply in the same states, draws included.
import {
  MovePowerBoostAbAttr,
  PostAttackAbAttr,
  PostDefendStatStageChangeAbAttr,
  type PostMoveInteractionAbAttrParams,
  ReceivedMoveDamageMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setStatusOf, type World } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Params = Record<string, any>;
type Fields = Record<string, any>;

// ---------------------------------------------------------------------------------------------
// The original canApply bodies (frozen copies)

const DAMAGING_HIT_RESULTS: ReadonlySet<HitResult> = new Set([
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
]);

function checkFilter(filter: Fields, move: Fields): boolean {
  if ("flag" in filter) {
    return move.hasFlag(filter.flag);
  }
  if ("moveId" in filter) {
    return move.id === filter.moveId;
  }
  if ("category" in filter) {
    return move.category === filter.category;
  }
  return move.type === filter.type;
}

function legacyTagOnHit(attr: Fields, params: Params): boolean {
  const { pokemon, move, opponent: attacker } = params;
  if (attr.contactExcluded && (move.hasFlag(MoveFlags.MAKES_CONTACT) || !DAMAGING_HIT_RESULTS.has(params.hitResult))) {
    return false;
  }
  if (
    attr.contactRequired
    && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
  ) {
    return false;
  }
  if (attr.filter !== undefined && !checkFilter(attr.filter, move)) {
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
  const tag = attr.pickTag(pokemon);
  return attacker.canAddTag(tag);
}

function legacyStatusOnAttack(attr: Fields, params: Params): boolean {
  const { simulated, pokemon, move, opponent: target } = params;
  if (!PostAttackAbAttr.prototype.canApply.call(attr, params as never)) {
    return false;
  }
  if (simulated) {
    return true;
  }
  if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr") || pokemon === target) {
    return false;
  }
  const makesContact = move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target });
  const inherentlyMakesContact = move.hasFlag(MoveFlags.MAKES_CONTACT);
  if (attr.contactExcluded && inherentlyMakesContact) {
    return false;
  }
  if (attr.contactRequired && !makesContact) {
    return false;
  }
  if (attr.filter !== undefined && !checkFilter(attr.filter, move)) {
    return false;
  }
  if (attr.critRequired && !target.turnData?.attacksReceived?.[0]?.critical) {
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
    return target.canSetStatus(outcome.value, true, false, pokemon);
  }
  return !target.getTag(outcome.value);
}

function legacyTagOnAttack(attr: Fields, params: Params): boolean {
  const { pokemon, move, opponent: target } = params;
  if (!PostAttackAbAttr.prototype.canApply.call(attr, params as never)) {
    return false;
  }
  if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr") || pokemon === target) {
    return false;
  }
  if (!attr.matchesMove(move, pokemon, target)) {
    return false;
  }
  if (!attr.matchesTarget(target)) {
    return false;
  }
  if (!attr.passesChance(pokemon, target, move)) {
    return false;
  }
  const tag = attr.pickTag(pokemon);
  return target.canAddTag(tag);
}

function legacyConditionalDamage(attr: Fields, params: Params): boolean {
  return MovePowerBoostAbAttr.prototype.canApply.call(attr, params as never);
}

function legacyFirstDefendReduction(attr: Fields, params: Params): boolean {
  return (
    ReceivedMoveDamageMultiplierAbAttr.prototype.canApply.call(attr, params as never)
    && !params.pokemon.waveData.firstDefendConsumed
  );
}

function legacyFirstDefendDrop(attr: Fields, params: Params): boolean {
  return (
    PostDefendStatStageChangeAbAttr.prototype.canApply.call(attr, params as never)
    && !params.pokemon.waveData.firstDefendConsumed
  );
}

function legacyContactQuash(_attr: Fields, params: Params): boolean {
  const { move, opponent, pokemon } = params;
  if (!opponent || !move.is("AttackMove")) {
    return false;
  }
  return move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: opponent, target: pokemon });
}

const LEGACY: Readonly<Record<string, (attr: Fields, params: Params) => boolean>> = {
  ChanceBattlerTagOnHitAbAttr: legacyTagOnHit,
  ChanceStatusOnAttackAbAttr: legacyStatusOnAttack,
  ChanceBattlerTagOnAttackAbAttr: legacyTagOnAttack,
  ConditionalDamageAbAttr: legacyConditionalDamage,
  FirstDefendDamageReductionAbAttr: legacyFirstDefendReduction,
  FirstDefendAttackerAtkDropAbAttr: legacyFirstDefendDrop,
  ContactQuashAbAttr: legacyContactQuash,
};

// ---------------------------------------------------------------------------------------------
// The state space

const MOVES: readonly MoveId[] = [
  MoveId.TACKLE, // normal, contact, physical
  MoveId.WATER_GUN, // water, no contact
  MoveId.EMBER, // fire
  MoveId.THUNDER_SHOCK, // electric
  MoveId.POISON_STING, // poison
  MoveId.ICE_BEAM, // ice
  MoveId.SHADOW_BALL, // ghost
  MoveId.DARK_PULSE, // dark
  MoveId.DAZZLING_GLEAM, // fairy
  MoveId.EARTHQUAKE, // ground
  MoveId.ROCK_SLIDE, // rock
  MoveId.VINE_WHIP, // grass, contact
  MoveId.PSYCHIC, // psychic
  MoveId.BITE, // biting, contact
  MoveId.HYPER_VOICE, // sound
  MoveId.SLASH, // slicing, contact
  MoveId.MEGAHORN, // horn, contact
  MoveId.HYPNOSIS, // a status move (Hypnotic Trance)
  MoveId.GROWL, // a status sound move
  MoveId.SWORDS_DANCE, // a status move
];

/** The lasting effects the target may carry. */
const FOE_TAGS: readonly (readonly BattlerTagType[])[] = [
  [],
  [BattlerTagType.CONFUSED],
  [BattlerTagType.ER_BLEED],
  [BattlerTagType.ER_FROSTBITE],
  [BattlerTagType.ER_ENRAGE],
];

interface State {
  readonly label: string;
  readonly move: MoveId;
  readonly hitResult: HitResult;
  readonly foeStatus: StatusEffect;
  readonly foeTags: readonly BattlerTagType[];
  readonly crit: boolean;
  readonly firstTurn: boolean;
  /** 0 = the foe has not moved, 1 = moved with a sound move, 2 = moved with a plain move. */
  readonly foeActed: 0 | 1 | 2;
  readonly shieldDust: boolean;
  readonly self: boolean;
  readonly simulated: boolean;
  readonly canAdd: boolean;
  readonly canSet: boolean;
  /** 0 = every roll comes up lowest (passes), 1 = every roll comes up highest (fails a chance below 100). */
  readonly roll: 0 | 1;
  readonly consumed: boolean;
}

function chanceStates(allowSimulated: boolean): State[] {
  const states: State[] = [];
  const hits = [HitResult.EFFECTIVE, HitResult.SUPER_EFFECTIVE, HitResult.NO_EFFECT, HitResult.STATUS];
  let index = 0;
  for (const move of MOVES) {
    for (const foeTags of FOE_TAGS) {
      for (const crit of [false, true]) {
        for (const roll of [0, 1] as const) {
          for (const foeStatus of [StatusEffect.NONE, StatusEffect.BURN]) {
            index++;
            states.push({
              label: `${MoveId[move]}, foe ${StatusEffect[foeStatus]}/${foeTags.join("+") || "no tag"}, crit ${crit}, roll ${roll}, #${index}`,
              move,
              hitResult: hits[index % hits.length],
              foeStatus,
              foeTags,
              crit,
              firstTurn: index % 2 === 0,
              foeActed: (index % 3) as 0 | 1 | 2,
              shieldDust: index % 11 === 0,
              self: index % 17 === 0,
              simulated: allowSimulated && index % 7 === 0,
              canAdd: index % 5 !== 0,
              canSet: index % 5 !== 1,
              roll,
              consumed: false,
            });
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

function paramsFor(world: World, state: State, kind: string): Params {
  const { holder, foe } = world;
  const move = allMoves[state.move];
  const base = { pokemon: holder, opponent: state.self ? holder : foe, move, simulated: state.simulated };
  if (kind === "defend-damage") {
    return { ...base, damage: new NumberHolder(10) };
  }
  if (kind === "attack-power") {
    return { ...base, power: new NumberHolder(40) };
  }
  return { ...base, damage: 7, hitResult: state.hitResult } as unknown as PostMoveInteractionAbAttrParams as Params;
}

function observe(world: World, state: State, kind: string, run: (params: Params) => boolean): Observation {
  const { game, holder, foe } = world;
  const foeAny = foe as any;
  const holderAny = holder as any;
  setStatusOf(foe, state.foeStatus);
  const saved = {
    getTag: foeAny.getTag,
    canAddTag: foeAny.canAddTag,
    canSetStatus: foeAny.canSetStatus,
    hasAbilityWithAttr: foeAny.hasAbilityWithAttr,
    getLastXMoves: foeAny.getLastXMoves,
    acted: foeAny.turnData.acted,
    attacksReceived: foeAny.turnData.attacksReceived,
    waveTurnCount: holderAny.tempSummonData.waveTurnCount,
    consumed: holderAny.waveData.firstDefendConsumed,
  };
  const realGetTag = foeAny.getTag.bind(foe);
  foeAny.getTag = ((tag: unknown) =>
    state.foeTags.includes(tag as BattlerTagType) ? { tagType: tag } : realGetTag(tag)) as never;
  foeAny.canAddTag = (() => state.canAdd) as never;
  foeAny.canSetStatus = (() => state.canSet) as never;
  const realHasAbilityWithAttr = foeAny.hasAbilityWithAttr.bind(foe);
  foeAny.hasAbilityWithAttr = ((name: string, ...rest: unknown[]) =>
    name === "IgnoreMoveEffectsAbAttr" ? state.shieldDust : (realHasAbilityWithAttr as any)(name, ...rest)) as never;
  foeAny.turnData.acted = state.foeActed !== 0;
  foeAny.getLastXMoves = (() =>
    state.foeActed === 0 ? [] : [{ move: state.foeActed === 1 ? MoveId.HYPER_VOICE : MoveId.TACKLE }]) as never;
  foeAny.turnData.attacksReceived = state.crit ? [{ critical: true }] : [];
  holderAny.tempSummonData.waveTurnCount = state.firstTurn ? 1 : 2;
  holderAny.waveData.firstDefendConsumed = state.consumed;
  const draws: number[] = [];
  const spy = vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
    draws.push(range);
    return state.roll === 0 ? min : min + range - 1;
  });
  try {
    return { result: run(paramsFor(world, state, kind)), draws };
  } finally {
    spy.mockRestore();
    foeAny.getTag = saved.getTag;
    foeAny.canAddTag = saved.canAddTag;
    foeAny.canSetStatus = saved.canSetStatus;
    foeAny.hasAbilityWithAttr = saved.hasAbilityWithAttr;
    foeAny.getLastXMoves = saved.getLastXMoves;
    foeAny.turnData.acted = saved.acted;
    foeAny.turnData.attacksReceived = saved.attacksReceived;
    holderAny.tempSummonData.waveTurnCount = saved.waveTurnCount;
    holderAny.waveData.firstDefendConsumed = saved.consumed;
  }
}

/** ConditionalDamage reads who is asleep, the target's stat stages and tags, and whether the target is about to switch. */
interface DamageState {
  readonly label: string;
  readonly foeTags: readonly BattlerTagType[];
  readonly lowered: "none" | "atk" | "acc" | "eva" | "spd";
  readonly asleep: "nobody" | "holder" | "foe";
  readonly switching: boolean;
}

function damageStates(): DamageState[] {
  const states: DamageState[] = [];
  for (const foeTags of FOE_TAGS) {
    for (const lowered of ["none", "atk", "acc", "eva", "spd"] as const) {
      for (const asleep of ["nobody", "holder", "foe"] as const) {
        for (const switching of [false, true]) {
          states.push({
            label: `foe tags ${foeTags.join("+") || "none"}, lowered ${lowered}, asleep ${asleep}, switching ${switching}`,
            foeTags,
            lowered,
            asleep,
            switching,
          });
        }
      }
    }
  }
  return states;
}

function observeDamage(world: World, state: DamageState, run: (params: Params) => boolean): boolean {
  const { holder, foe } = world;
  const foeAny = foe as any;
  const savedGetTag = foeAny.getTag;
  const savedStage = foeAny.getStatStage;
  const savedCommands = (globalScene.currentBattle as any).turnCommands;
  const realGetTag = foeAny.getTag.bind(foe);
  foeAny.getTag = ((tag: unknown) =>
    state.foeTags.includes(tag as BattlerTagType) ? { tagType: tag } : realGetTag(tag)) as never;
  const stageStat = { none: -1, atk: Stat.ATK, acc: Stat.ACC, eva: Stat.EVA, spd: Stat.SPD }[state.lowered];
  foeAny.getStatStage = ((stat: number) => (stat === stageStat ? -1 : 0)) as never;
  setStatusOf(holder, state.asleep === "holder" ? StatusEffect.SLEEP : StatusEffect.NONE);
  setStatusOf(foe, state.asleep === "foe" ? StatusEffect.SLEEP : StatusEffect.NONE);
  (globalScene.currentBattle as any).turnCommands = {
    ...savedCommands,
    [foe.getBattlerIndex()]: state.switching ? { command: Command.POKEMON, skip: false } : undefined,
  };
  try {
    return run({
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      power: new NumberHolder(40),
      simulated: false,
    });
  } finally {
    foeAny.getTag = savedGetTag;
    foeAny.getStatStage = savedStage;
    (globalScene.currentBattle as any).turnCommands = savedCommands;
    setStatusOf(holder, StatusEffect.NONE);
    setStatusOf(foe, StatusEffect.NONE);
  }
}

/** The state the apply check runs in: nothing special, someone asleep so every user of the class has a reason to boost. */
function applyDamageStates(): DamageState[] {
  return [
    { label: "foe bleeding", foeTags: [BattlerTagType.ER_BLEED], lowered: "none", asleep: "nobody", switching: false },
    { label: "foe confused", foeTags: [BattlerTagType.CONFUSED], lowered: "none", asleep: "nobody", switching: false },
    { label: "foe lowered", foeTags: [], lowered: "atk", asleep: "nobody", switching: false },
    { label: "foe asleep", foeTags: [], lowered: "none", asleep: "foe", switching: false },
    { label: "nothing", foeTags: [], lowered: "none", asleep: "nobody", switching: false },
  ];
}

function kindOf(className: string): string {
  if (className === "FirstDefendDamageReductionAbAttr") {
    return "defend-damage";
  }
  if (className === "ConditionalDamageAbAttr") {
    return "attack-power";
  }
  return "interaction";
}

function sitesOf(className: string): AttrSite[] {
  // A studio carrier has its own canApply and is not a use of the class.
  return allAttrSites().filter(site => site.className === className && !Object.hasOwn(site.attr, "canApply"));
}

/** Classes whose canApply reads the draws and the simulated flag in a way the library atom answers differently when simulated. */
const SIMULATED_OK = new Set(["ChanceStatusOnAttackAbAttr"]);

describe("B08 chunk 2 Tier B: the split is a pure move of code and every bound gate equals the class's own gate", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const [className, legacy] of Object.entries(LEGACY)) {
    const damageClass = className === "ConditionalDamageAbAttr";
    const kind = kindOf(className);

    it(`${className}: the refactored canApply equals the frozen original for every live user`, async () => {
      const world = await startWorld(phaserGame);
      const sites = sitesOf(className);
      expect(sites.length).toBeGreaterThan(0);
      const mismatches: string[] = [];
      const neverTrue: string[] = [];
      let evaluations = 0;
      let positives = 0;
      for (const site of sites) {
        let siteTrue = 0;
        if (damageClass) {
          for (const state of damageStates()) {
            const before = observeDamage(world, state, params => legacy(site.attr as unknown as Fields, params));
            const after = observeDamage(world, state, params => site.attr.canApply(params as never));
            evaluations++;
            positives += before ? 1 : 0;
            siteTrue += before ? 1 : 0;
            if (before !== after) {
              mismatches.push(`${site.abilityName} (${state.label}): original ${before}, refactor ${after}`);
            }
          }
        } else {
          const states = chanceStates(SIMULATED_OK.has(className)).flatMap(state =>
            className === "FirstDefendDamageReductionAbAttr"
            || className === "FirstDefendAttackerAtkDropAbAttr"
            || className === "ContactQuashAbAttr"
              ? [state, { ...state, consumed: true }]
              : [state],
          );
          for (const state of states) {
            const before = observe(world, state, kind, params => legacy(site.attr as unknown as Fields, params));
            const after = observe(world, state, kind, params => site.attr.canApply(params as never));
            evaluations++;
            positives += before.result ? 1 : 0;
            siteTrue += before.result ? 1 : 0;
            if (before.result !== after.result || JSON.stringify(before.draws) !== JSON.stringify(after.draws)) {
              mismatches.push(
                `${site.abilityName} (${state.label}): original ${before.result} draws ${JSON.stringify(before.draws)}, refactor ${after.result} draws ${JSON.stringify(after.draws)}`,
              );
            }
            if (mismatches.length > 10) {
              break;
            }
          }
        }
        if (siteTrue === 0) {
          neverTrue.push(`${site.abilityName} (attr ${site.attrIndex})`);
        }
        expect(mismatches.slice(0, 10)).toEqual([]);
      }
      console.log(`B08_C2_GATE_SPLIT ${className} evaluations=${evaluations} canApplyTrue=${positives}`);
      // The grid must really reach the true branch of EVERY user, or the proof would be vacuous for that user.
      expect(neverTrue).toEqual([]);
      expect(positives).toBeGreaterThan(0);
    }, 900_000);

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
        let siteTrue = 0;
        if (damageClass) {
          for (const state of damageStates()) {
            const original = observeDamage(world, state, params => site.attr.canApply(params as never));
            const library = observeDamage(world, state, params => rebuilt.canApply(params as never));
            compared++;
            positives += original ? 1 : 0;
            siteTrue += original ? 1 : 0;
            if (original !== library) {
              mismatches.push(`${site.abilityName} (${state.label}): class ${original}, library ${library}`);
            }
          }
        } else {
          const states = chanceStates(SIMULATED_OK.has(className)).flatMap(state =>
            className === "FirstDefendDamageReductionAbAttr"
            || className === "FirstDefendAttackerAtkDropAbAttr"
            || className === "ContactQuashAbAttr"
              ? [state, { ...state, consumed: true }]
              : [state],
          );
          for (const state of states) {
            const original = observe(world, state, kind, params => site.attr.canApply(params as never));
            const library = observe(world, state, kind, params => rebuilt.canApply(params as never));
            compared++;
            positives += original.result ? 1 : 0;
            siteTrue += original.result ? 1 : 0;
            if (
              original.result !== library.result
              || JSON.stringify(original.draws) !== JSON.stringify(library.draws)
            ) {
              mismatches.push(
                `${site.abilityName} (${state.label}): class ${original.result} draws ${JSON.stringify(original.draws)}, library ${library.result} draws ${JSON.stringify(library.draws)}`,
              );
            }
          }
        }
        if (siteTrue === 0) {
          neverTrue.push(`${site.abilityName} (attr ${site.attrIndex})`);
        }
        expect(mismatches.slice(0, 10)).toEqual([]);
      }
      console.log(`B08_C2_BOUND_GATE ${className} compared=${compared} canApplyTrue=${positives}`);
      expect(neverTrue).toEqual([]);
      expect(compared).toBeGreaterThan(0);
      expect(positives).toBeGreaterThan(0);
    }, 900_000);
  }

  it("ConditionalDamageAbAttr: applying the rebuilt attr multiplies the power like the original", async () => {
    const world = await startWorld(phaserGame);
    const module = declRegistry.get("ConditionalDamageAbAttr")!;
    let boosted = 0;
    let untouched = 0;
    for (const site of sitesOf("ConditionalDamageAbAttr")) {
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
      for (const state of [...damageStates(), ...applyDamageStates()]) {
        const powerAfter = (attr: { canApply: (p: never) => boolean; apply: (p: never) => void }): number => {
          let value = -1;
          observeDamage(world, state, params => {
            if (attr.canApply(params as never)) {
              attr.apply(params as never);
            }
            value = params.power.value;
            return true;
          });
          return value;
        };
        const a = powerAfter(site.attr as never);
        const b = powerAfter(rebuilt as never);
        expect(b, `${site.abilityName} (${state.label}): power after apply`).toBe(a);
        if (a === 40) {
          untouched++;
        } else {
          boosted++;
        }
      }
    }
    // Both outcomes (a boost and no boost) must have been seen, or the comparison would be vacuous.
    expect(boosted).toBeGreaterThan(0);
    expect(untouched).toBeGreaterThan(0);
  }, 600_000);
});
