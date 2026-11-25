/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
// B14 chunk 2: what the shared L1 and L2 suites cannot see.
//  - The Tier B split of six classes is a pure move of code. For every combination of the clauses each test compares the
//    refactored `canApply` (or `fire`) with a literal copy of the ORIGINAL expression (copied from the commit before the
//    split), including the order of the calls that have side effects (the chance roll, `canAddTag`).
//  - `gateOverride` replaces only the gate; the guards and the residual keep running.
//  - The constructor arguments added for the editable params default to the old fixed values.
//  - Booby Trap's item-loss attr really fires through the engine (the L2 knock-off scenario cannot reach it).
import { allAbilities } from "#data/data-lists";
import {
  BitterDrillDamageAbAttr,
  BoobyTrapAbAttr,
  BoobyTrapItemLostAbAttr,
  MiracleBladeTypeChartAbAttr,
  OfudaAbAttr,
  SlabsCurseAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { getTypeDamageMultiplier } from "#data/type";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const BITTER_DRILL = 6044;
const MIRACLE_BLADE = 6064;
const SLABS_CURSE = 6066;
const BOOBY_TRAP = 6067;
const OFUDA = 6070;

const HIT_RESULTS = [
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
  HitResult.NO_EFFECT,
  HitResult.STATUS,
  HitResult.FAIL,
  HitResult.MISS,
  HitResult.IMMUNE,
  HitResult.INDIRECT,
];
const CATEGORIES = [MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS];
const DAMAGES = [0, 1, 57];

/** A Pokemon with only what these classes read. */
function mon(options: {
  readonly player: boolean;
  readonly provenance?: string[];
  readonly canAddTag?: (tag: BattlerTagType) => boolean;
  readonly tags?: readonly BattlerTagType[];
  readonly roll?: () => number;
}) {
  return {
    isPlayer: () => options.player,
    summonData: { erAbilityProvenance: options.provenance ?? [] },
    canAddTag: options.canAddTag ?? (() => true),
    getTag: (tag: BattlerTagType) => (options.tags?.includes(tag) ? { tag } : undefined),
    randBattleSeedInt: options.roll ?? (() => 0),
    addTag: () => true,
    id: 7,
  };
}

describe("B14 chunk 2: Bitter Drill power", () => {
  it("canApply equals the original expression for every flag and tag combination; apply multiplies by the argument", () => {
    const attr = liveAbility(BITTER_DRILL).attrs[1] as BitterDrillDamageAbAttr;
    expect(attr.constructor.name).toBe("BitterDrillDamageAbAttr");
    expect(attr.multiplier).toBe(2);
    let accepted = 0;
    let compared = 0;
    for (const drill of [false, true]) {
      for (const contact of [false, true]) {
        for (const embedded of [false, true]) {
          const move = { hasFlag: (flag: MoveFlags) => (flag === MoveFlags.DRILL_BASED ? drill : contact) };
          const opponent = mon({ player: false, tags: embedded ? [BattlerTagType.ER_EMBEDDED] : [] });
          // The original expression, copied from the code before the split.
          const original =
            move.hasFlag(MoveFlags.DRILL_BASED) && opponent.getTag(BattlerTagType.ER_EMBEDDED) !== undefined;
          expect(attr.canApply({ opponent, move } as never)).toBe(original);
          compared++;
          accepted += original ? 1 : 0;
        }
      }
    }
    expect(accepted).toBe(2);
    expect(compared - accepted).toBeGreaterThan(5);
    const power = new NumberHolder(40);
    attr.apply({ power } as never);
    expect(power.value).toBe(80);
    const tripled = new NumberHolder(40);
    new BitterDrillDamageAbAttr(3).apply({ power: tripled } as never);
    expect(tripled.value).toBe(120);
    expect(new BitterDrillDamageAbAttr().multiplier).toBe(2);
  });

  it("a replaced gate replaces the whole rule (there is no guard or residual)", () => {
    const attr = new BitterDrillDamageAbAttr();
    attr.gateOverride = () => true;
    const move = { hasFlag: () => false };
    expect(attr.canApply({ opponent: mon({ player: false }), move } as never)).toBe(true);
  });
});

describe("B14 chunk 2: Slab's Curse", () => {
  it("canApply equals the original expression for every culprit and move", () => {
    const attr = liveAbility(SLABS_CURSE).attrs[0] as SlabsCurseAbAttr;
    expect(attr.constructor.name).toBe("SlabsCurseAbAttr");
    expect([attr.ppLoss, attr.allyPpLoss]).toEqual([2, 1]);
    const holder = mon({ player: true });
    const culprits = {
      none: undefined,
      self: holder,
      ally: mon({ player: true }),
      foe: mon({ player: false }),
    } as const;
    const moves = {
      none: undefined,
      status: { category: MoveCategory.STATUS },
      physical: { category: MoveCategory.PHYSICAL },
      special: { category: MoveCategory.SPECIAL },
    } as const;
    let accepted = 0;
    let compared = 0;
    for (const [culpritName, attacker] of Object.entries(culprits)) {
      for (const [moveName, move] of Object.entries(moves)) {
        // The original expression, copied from the code before the split.
        const original =
          attacker !== undefined
          && attacker !== holder
          && attacker.isPlayer() !== holder.isPlayer()
          && move !== undefined
          && move.category !== MoveCategory.STATUS;
        expect(attr.canApply({ pokemon: holder, attacker, move } as never), `${culpritName} ${moveName}`).toBe(
          original,
        );
        compared++;
        accepted += original ? 1 : 0;
      }
    }
    expect(accepted).toBe(2);
    expect(compared - accepted).toBeGreaterThan(5);
  });

  it("a replaced gate keeps the two guards (nobody, or myself, is never cursed)", () => {
    const attr = new SlabsCurseAbAttr();
    attr.gateOverride = () => true;
    const holder = mon({ player: true });
    expect(attr.canApply({ pokemon: holder, attacker: undefined, move: undefined } as never)).toBe(false);
    expect(attr.canApply({ pokemon: holder, attacker: holder, move: undefined } as never)).toBe(false);
    expect(attr.canApply({ pokemon: holder, attacker: mon({ player: true }), move: undefined } as never)).toBe(true);
  });

  it("apply lays the curse with the PP numbers of its arguments on the culprit and its standing neighbours", () => {
    const calls: { who: string; tag: unknown; turns: number }[] = [];
    const record = (who: string) => (tag: unknown, turns: number) => {
      calls.push({ who, tag, turns });
      return true;
    };
    const standing = { isFainted: () => false, addTag: record("standing") };
    const fainted = { isFainted: () => true, addTag: record("fainted") };
    const attacker = { addTag: record("culprit"), getAdjacentAllies: () => [standing, fainted] };
    new SlabsCurseAbAttr(3, 2).apply({ pokemon: { id: 1 }, attacker, simulated: false } as never);
    expect(calls).toEqual([
      { who: "culprit", tag: BattlerTagType.ER_SLAB_CURSE, turns: 3 },
      { who: "standing", tag: BattlerTagType.ER_SLAB_CURSE, turns: 2 },
    ]);
    calls.length = 0;
    new SlabsCurseAbAttr().apply({ pokemon: { id: 1 }, attacker, simulated: true } as never);
    expect(calls).toEqual([]);
  });
});

describe("B14 chunk 2: Booby Trap (the hit)", () => {
  it("canApply equals the original expression for every combination of the eight clauses", () => {
    const attr = liveAbility(BOOBY_TRAP).attrs[0] as BoobyTrapAbAttr;
    expect(attr.constructor.name).toBe("BoobyTrapAbAttr");
    expect(attr.tag).toBe(BattlerTagType.CURSED);
    let accepted = 0;
    let compared = 0;
    for (const simulated of [false, true]) {
      for (const damage of DAMAGES) {
        for (const hitResult of HIT_RESULTS) {
          for (const category of CATEGORIES) {
            for (const relation of ["foe", "ally", "self"] as const) {
              for (const canAdd of [false, true]) {
                for (const claimed of [false, true]) {
                  const holder = mon({ player: true, provenance: claimed ? ["booby-trap:entry"] : [] });
                  const opponent =
                    relation === "self" ? holder : mon({ player: relation === "ally", canAddTag: () => canAdd });
                  if (relation === "self") {
                    // the holder is its own attacker: canAddTag answers like everybody else
                    (holder as { canAddTag: () => boolean }).canAddTag = () => canAdd;
                  }
                  const move = { category };
                  // The original expression, copied from the code before the split.
                  const original =
                    !simulated
                    && damage > 0
                    && hitResult < HitResult.NO_EFFECT
                    && move.category !== MoveCategory.STATUS
                    && opponent !== holder
                    && opponent.isPlayer() !== holder.isPlayer()
                    && opponent.canAddTag(BattlerTagType.CURSED)
                    && !holder.summonData.erAbilityProvenance.includes("booby-trap:entry");
                  const params = { pokemon: holder, opponent, move, hitResult, damage, simulated } as never;
                  expect(attr.canApply(params)).toBe(original);
                  compared++;
                  accepted += original ? 1 : 0;
                }
              }
            }
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(5);
    expect(compared - accepted).toBeGreaterThan(5);
  });

  it("asks canAddTag only after every earlier clause passed (short-circuit order)", () => {
    const attr = new BoobyTrapAbAttr();
    let asked = 0;
    const holder = mon({ player: true });
    const opponent = mon({
      player: false,
      canAddTag: () => {
        asked++;
        return true;
      },
    });
    const base = {
      pokemon: holder,
      opponent,
      move: { category: MoveCategory.PHYSICAL },
      hitResult: HitResult.EFFECTIVE,
      damage: 5,
      simulated: false,
    };
    expect(attr.canApply({ ...base, simulated: true } as never)).toBe(false);
    expect(attr.canApply({ ...base, damage: 0 } as never)).toBe(false);
    expect(attr.canApply({ ...base, hitResult: HitResult.NO_EFFECT } as never)).toBe(false);
    expect(attr.canApply({ ...base, move: { category: MoveCategory.STATUS } } as never)).toBe(false);
    expect(asked).toBe(0);
    expect(attr.canApply(base as never)).toBe(true);
    expect(asked).toBe(1);
  });

  it("a replaced gate keeps the guards and the residual", () => {
    const attr = new BoobyTrapAbAttr();
    attr.gateOverride = () => true;
    const holder = mon({ player: true });
    const opponent = mon({ player: true });
    const base = {
      pokemon: holder,
      opponent,
      move: { category: MoveCategory.STATUS },
      hitResult: HitResult.EFFECTIVE,
      damage: 5,
      simulated: false,
    };
    expect(attr.canApply(base as never)).toBe(true);
    expect(attr.canApply({ ...base, simulated: true } as never)).toBe(false);
    expect(attr.canApply({ ...base, hitResult: HitResult.MISS } as never)).toBe(false);
    expect(attr.canApply({ ...base, opponent: mon({ player: true, canAddTag: () => false }) } as never)).toBe(false);
    expect(attr.canApply({ ...base, pokemon: mon({ player: true, provenance: ["booby-trap:entry"] }) } as never)).toBe(
      false,
    );
  });
});

describe("B14 chunk 2: Booby Trap (the item loss)", () => {
  it("canApply equals the original expression; apply marks the culprit once", () => {
    const attr = liveAbility(BOOBY_TRAP).attrs[1] as BoobyTrapItemLostAbAttr;
    expect(attr.constructor.name).toBe("BoobyTrapItemLostAbAttr");
    expect(attr.tag).toBe(BattlerTagType.CURSED);
    let accepted = 0;
    let compared = 0;
    for (const simulated of [false, true]) {
      for (const relation of ["none", "self", "ally", "foe"] as const) {
        const holder = mon({ player: true });
        const opponent =
          relation === "none" ? undefined : relation === "self" ? holder : mon({ player: relation === "ally" });
        // The original expression, copied from the code before the split.
        const original =
          !simulated && opponent !== undefined && opponent !== holder && opponent.isPlayer() !== holder.isPlayer();
        expect(attr.canApply({ pokemon: holder, opponent, simulated } as never), `${simulated} ${relation}`).toBe(
          original,
        );
        compared++;
        accepted += original ? 1 : 0;
      }
    }
    expect(accepted).toBe(1);
    expect(compared - accepted).toBe(7);
    // apply: tag with no turn limit and no source move, then the mark
    const added: unknown[][] = [];
    const holder = { id: 1, isPlayer: () => true, summonData: { erAbilityProvenance: [] as string[] } };
    const culprit = { id: 9, isPlayer: () => false, addTag: (...args: unknown[]) => added.push(args) };
    attr.apply({ pokemon: holder, opponent: culprit, simulated: false } as never);
    expect(added).toEqual([[BattlerTagType.CURSED, 0, MoveId.NONE, 1]]);
    expect(holder.summonData.erAbilityProvenance).toEqual(["booby-trap:9"]);
    attr.apply({ pokemon: holder, opponent: culprit, simulated: true } as never);
    expect(added.length).toBe(1);
  });

  it("a replaced gate keeps the two guards", () => {
    const attr = new BoobyTrapItemLostAbAttr();
    attr.gateOverride = () => true;
    const holder = mon({ player: true });
    expect(attr.canApply({ pokemon: holder, opponent: undefined, simulated: false } as never)).toBe(false);
    expect(attr.canApply({ pokemon: holder, opponent: mon({ player: true }), simulated: true } as never)).toBe(false);
    expect(attr.canApply({ pokemon: holder, opponent: mon({ player: true }), simulated: false } as never)).toBe(true);
  });
});

describe("B14 chunk 2: Ofuda", () => {
  it("canApply equals the original expression, with the same draws in the same order", () => {
    const attr = liveAbility(OFUDA).attrs[0] as OfudaAbAttr;
    expect(attr.constructor.name).toBe("OfudaAbAttr");
    expect([attr.chance, attr.tag]).toEqual([30, BattlerTagType.CURSED]);
    let accepted = 0;
    let compared = 0;
    for (const simulated of [false, true]) {
      for (const hitResult of HIT_RESULTS) {
        for (const relation of ["foe", "ally", "self"] as const) {
          for (const roll of [0, 29, 30, 99]) {
            for (const canAdd of [false, true]) {
              // Two identical worlds, one per implementation, each counting its own draws and its own canAddTag asks.
              const world = () => {
                const log: string[] = [];
                const holder = mon({
                  player: true,
                  roll: () => {
                    log.push("roll");
                    return roll;
                  },
                });
                const opponent =
                  relation === "self"
                    ? holder
                    : mon({
                        player: relation === "ally",
                        canAddTag: () => {
                          log.push("canAdd");
                          return canAdd;
                        },
                      });
                if (relation === "self") {
                  (holder as { canAddTag: () => boolean }).canAddTag = () => {
                    log.push("canAdd");
                    return canAdd;
                  };
                }
                return { log, holder, opponent };
              };
              const a = world();
              // The original expression, copied from the code before the split.
              const original =
                !simulated
                && hitResult < HitResult.NO_EFFECT
                && a.opponent !== a.holder
                && a.holder.randBattleSeedInt(100) < 30
                && a.opponent.canAddTag(BattlerTagType.CURSED);
              const b = world();
              const actual = attr.canApply({ pokemon: b.holder, opponent: b.opponent, hitResult, simulated } as never);
              expect(actual).toBe(original);
              expect(b.log).toEqual(a.log);
              compared++;
              accepted += original ? 1 : 0;
            }
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(5);
    expect(compared - accepted).toBeGreaterThan(5);
  });

  it("a replaced gate keeps the guards (no roll, no result) and the residual", () => {
    const attr = new OfudaAbAttr(50);
    attr.gateOverride = () => true;
    let draws = 0;
    const holder = mon({ player: true, roll: () => draws++ });
    const opponent = mon({ player: false });
    expect(
      attr.canApply({ pokemon: holder, opponent, hitResult: HitResult.EFFECTIVE, simulated: false } as never),
    ).toBe(true);
    expect(attr.canApply({ pokemon: holder, opponent, hitResult: HitResult.MISS, simulated: false } as never)).toBe(
      false,
    );
    expect(attr.canApply({ pokemon: holder, opponent, hitResult: HitResult.EFFECTIVE, simulated: true } as never)).toBe(
      false,
    );
    expect(
      attr.canApply({
        pokemon: holder,
        opponent: mon({ player: false, canAddTag: () => false }),
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as never),
    ).toBe(false);
    expect(draws).toBe(0);
  });

  it("the chance argument moves the roll boundary", () => {
    const holder = mon({ player: true, roll: () => 49 });
    const opponent = mon({ player: false });
    const params = { pokemon: holder, opponent, hitResult: HitResult.EFFECTIVE, simulated: false } as never;
    expect(new OfudaAbAttr(50).canApply(params)).toBe(true);
    expect(new OfudaAbAttr(49).canApply(params)).toBe(false);
  });
});

/** The ORIGINAL `fire` of Miracle Blade, copied from the code before the split (Keen Edge, Dark, 2 as literals). */
function originalMiracleBladeFire(
  move: {
    hasFlag(flag: MoveFlags): boolean;
    doesFlagEffectApply(options: { flag: MoveFlags; user: unknown }): boolean;
  },
  defenderTypes: readonly PokemonType[],
  multi: NumberHolder,
  moveType?: PokemonType,
  user?: unknown,
): void {
  const slicing =
    user === undefined || user === null
      ? move.hasFlag(MoveFlags.SLICING_MOVE)
      : move.doesFlagEffectApply({ flag: MoveFlags.SLICING_MOVE, user });
  if (!slicing || !defenderTypes.includes(PokemonType.DARK)) {
    return;
  }
  if (moveType === undefined) {
    multi.value = 2;
    return;
  }
  const natural = getTypeDamageMultiplier(moveType, PokemonType.DARK);
  if (natural === 0) {
    let rest = 1;
    let consumed = false;
    for (const defenderType of defenderTypes) {
      if (!consumed && defenderType === PokemonType.DARK) {
        consumed = true;
        continue;
      }
      rest *= getTypeDamageMultiplier(moveType, defenderType);
    }
    multi.value = rest * 2;
    return;
  }
  multi.value = (multi.value / natural) * 2;
}

/** The type chart reads the global scene, so a real battle is started first (nothing in it is used). */
async function startAnyBattle(phaserGame: Phaser.Game): Promise<void> {
  const game = new GameManager(phaserGame);
  game.override
    .battleStyle("single")
    .moveset([MoveId.CELEBRATE])
    .ability(AbilityId.BALL_FETCH)
    .startingLevel(100)
    .enemySpecies(SpeciesId.MAGIKARP)
    .enemyLevel(30)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset([MoveId.SPLASH]);
  await game.classicMode.startBattle(SpeciesId.BLISSEY);
}

describe("B14 chunk 2: Miracle Blade type chart", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("fire equals the original for every flag, defender types, move type and user", async () => {
    await startAnyBattle(phaserGame);
    const attr = liveAbility(MIRACLE_BLADE).attrs[0] as MiracleBladeTypeChartAbAttr;
    expect(attr.constructor.name).toBe("MiracleBladeTypeChartAbAttr");
    expect([attr.flag, attr.defenderType, attr.factor]).toEqual([MoveFlags.SLICING_MOVE, PokemonType.DARK, 2]);
    const defenders: PokemonType[][] = [
      [PokemonType.DARK],
      [PokemonType.DARK, PokemonType.GHOST],
      [PokemonType.DARK, PokemonType.FAIRY],
      [PokemonType.FIGHTING, PokemonType.DARK],
      [PokemonType.STEEL],
      [PokemonType.NORMAL, PokemonType.FLYING],
    ];
    const moveTypes: (PokemonType | undefined)[] = [
      undefined,
      PokemonType.PSYCHIC,
      PokemonType.FIGHTING,
      PokemonType.NORMAL,
      PokemonType.GHOST,
      PokemonType.DARK,
      PokemonType.FAIRY,
    ];
    let changed = 0;
    let compared = 0;
    for (const sliceOwn of [false, true]) {
      for (const sliceWithUser of [false, true]) {
        const move = {
          hasFlag: (flag: MoveFlags) => flag === MoveFlags.SLICING_MOVE && sliceOwn,
          doesFlagEffectApply: ({ flag }: { flag: MoveFlags }) => flag === MoveFlags.SLICING_MOVE && sliceWithUser,
        };
        for (const user of [undefined, null, {}]) {
          for (const defenderTypes of defenders) {
            for (const moveType of moveTypes) {
              for (const start of [0, 0.5, 1, 2, 4]) {
                const expected = new NumberHolder(start);
                originalMiracleBladeFire(move, defenderTypes, expected, moveType, user);
                const actual = new NumberHolder(start);
                attr.fire(move as never, defenderTypes, actual, moveType, user as never);
                expect(actual.value).toBe(expected.value);
                compared++;
                changed += expected.value === start ? 0 : 1;
              }
            }
          }
        }
      }
    }
    expect(changed).toBeGreaterThan(20);
    expect(compared - changed).toBeGreaterThan(20);
  });

  it("a replaced gate decides alone, and the arguments change the rewrite", async () => {
    await startAnyBattle(phaserGame);
    const move = { hasFlag: () => false, doesFlagEffectApply: () => false };
    const forced = new MiracleBladeTypeChartAbAttr();
    forced.gateOverride = () => true;
    const holder = new NumberHolder(1);
    forced.fire(move as never, [PokemonType.NORMAL], holder, PokemonType.NORMAL, {} as never);
    expect(holder.value).toBe(2 / getTypeDamageMultiplier(PokemonType.NORMAL, PokemonType.DARK));
    // Another property, type and factor: Biting moves against Steel count x4
    const biting = new MiracleBladeTypeChartAbAttr(MoveFlags.BITING_MOVE, PokemonType.STEEL, 4);
    const bite = {
      hasFlag: (flag: MoveFlags) => flag === MoveFlags.BITING_MOVE,
      doesFlagEffectApply: ({ flag }: { flag: MoveFlags }) => flag === MoveFlags.BITING_MOVE,
    };
    const value = new NumberHolder(0.5);
    biting.fire(bite as never, [PokemonType.STEEL], value, PokemonType.DARK, {} as never);
    expect(value.value).toBe((0.5 / getTypeDamageMultiplier(PokemonType.DARK, PokemonType.STEEL)) * 4);
    const untouched = new NumberHolder(0.5);
    biting.fire(bite as never, [PokemonType.DARK], untouched, PokemonType.DARK, {} as never);
    expect(untouched.value).toBe(0.5);
  });
});

describe("B14 chunk 2: Booby Trap through the engine", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("a foe that takes my item is cursed and marked; an ally is not", async () => {
    const game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.CELEBRATE])
      .ability(BOOBY_TRAP as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset([MoveId.SPLASH])
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    expect(allAbilities[BOOBY_TRAP]).toBeDefined();
    applyAbAttrs("PostItemLostAbAttr", { pokemon: holder, opponent: foe });
    expect(foe.getTag(BattlerTagType.CURSED)).toBeDefined();
    expect(holder.summonData.erAbilityProvenance).toContain(`booby-trap:${foe.id}`);
    // nobody caused the loss: nothing happens
    const provenanceBefore = holder.summonData.erAbilityProvenance.length;
    applyAbAttrs("PostItemLostAbAttr", { pokemon: holder });
    expect(holder.summonData.erAbilityProvenance.length).toBe(provenanceBefore);
  });

  it("Slab's Curse: a foe's damaging move that knocks the holder out lays the PP curse on that foe", async () => {
    const game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.CELEBRATE])
      .ability(SLABS_CURSE as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset([MoveId.TACKLE])
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.MAGIKARP);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    holder.hp = 1;
    game.move.select(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("FaintPhase");
    expect(holder.isFainted()).toBe(true);
    const curse = foe.getTag(BattlerTagType.ER_SLAB_CURSE);
    expect(curse, "the culprit carries the PP curse").toBeDefined();
    expect((curse as unknown as { ppLoss: number }).ppLoss).toBe(2);
  });
});
