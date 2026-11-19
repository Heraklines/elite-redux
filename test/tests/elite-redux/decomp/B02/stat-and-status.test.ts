/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 4: what the shared L1 and L2 suites cannot see.
//  - StatMultiplierAbAttr and AllyStatMultiplierAbAttr: the harness has no engine-parameter builder for `calc.stat-value`
//    (request B02-39), so every rebuilt attr is driven directly here: canApply and apply over every stat, a move that
//    deals damage and one that does not, and three holder states. The original is compared with the rebuild.
//  - Victory Star's ally share: a real double battle, original ability against the rebuilt one.
//  - PostAttackApplyStatusEffectAbAttr and PostAttackContactApplyStatusEffectAbAttr: the Tier B split moved two pure safety
//    clauses in front of the first clause. A reference copy of the ORIGINAL canApply (written from the source before the
//    split) is compared with the new class and with a rebuild, on result AND on the recorded random draws, over every
//    state that can change the order.
//  - GorillaTacticsAbAttr and SagePowerMoveLockAbAttr: canApply and apply against a plain reference of the source.
import {
  GorillaTacticsAbAttr,
  PostAttackApplyStatusEffectAbAttr,
  PostAttackContactApplyStatusEffectAbAttr,
  SagePowerMoveLockAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId, liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

function sitesOf(className: string) {
  return allAttrSites().filter(site => site.className === className);
}

const ALL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;
const MOVES = [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.EMBER, MoveId.THUNDERBOLT, MoveId.GROWL] as const;
const HOLDER_STATUSES = [StatusEffect.NONE, StatusEffect.BURN, StatusEffect.PARALYSIS] as const;

describe("B02 chunk 4: stat multipliers driven directly", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every rebuilt StatMultiplierAbAttr gives the same canApply and the same stat value as the original", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("StatMultiplierAbAttr")!;
    const sites = sitesOf("StatMultiplierAbAttr");
    expect(sites).toHaveLength(62);
    let rebuiltCount = 0;
    let legacy = 0;
    let appliedSomewhere = 0;
    for (const site of sites) {
      let rebuilt: StatMultiplierAbAttr;
      try {
        rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as StatMultiplierAbAttr;
      } catch {
        // Propeller Tail and Jungle Fever: a legacy-closure, counted as not rebuilt
        legacy++;
        continue;
      }
      rebuiltCount++;
      const original = site.attr as StatMultiplierAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const status of HOLDER_STATUSES) {
        setStatusOf(holder, status);
        for (const move of MOVES) {
          for (const stat of ALL_STATS) {
            const run = (attr: StatMultiplierAbAttr): [boolean, number] => {
              const statVal = new NumberHolder(100);
              const params = { pokemon: holder, stat, statVal, move: allMoves[move], simulated: false };
              const can = attr.canApply(params);
              if (can) {
                attr.apply(params);
              }
              return [can, statVal.value];
            };
            const a = run(original);
            const b = run(rebuilt);
            expect(b, `${site.abilityName} attr ${site.attrIndex} ${Stat[stat]} ${MoveId[move]} status ${status}`).toEqual(a);
            if (a[0]) {
              appliedSomewhere++;
            }
          }
        }
      }
    }
    setStatusOf(holder, StatusEffect.NONE);
    void foe;
    expect(legacy).toBe(2);
    expect(rebuiltCount).toBe(60);
    expect(appliedSomewhere).toBeGreaterThan(100);
  });

  it("the stat settings reach the constructor: a built attr multiplies only its own stat", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("StatMultiplierAbAttr")!;
    for (const stat of ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] as const) {
      const attr = buildAttr(module, { stat, multiplier: 0.75 }) as StatMultiplierAbAttr;
      for (const other of ALL_STATS) {
        const statVal = new NumberHolder(200);
        const params = { pokemon: holder, stat: other, statVal, move: allMoves[MoveId.TACKLE], simulated: false };
        const can = attr.canApply(params);
        expect(can).toBe(Stat[other] === stat);
        if (can) {
          attr.apply(params);
          expect(statVal.value).toBe(150);
        }
      }
    }
  });

  it("every rebuilt AllyStatMultiplierAbAttr agrees on the ignorable rule, for every stat", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("AllyStatMultiplierAbAttr")!;
    const sites = sitesOf("AllyStatMultiplierAbAttr");
    expect(sites).toHaveLength(1);
    const site = sites[0];
    const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
    for (const ignorable of [true, false]) {
      for (const [label, attr] of [
        ["original", site.attr],
        ["rebuilt", rebuilt],
      ] as const) {
        const variant = ignorable
          ? (buildAttr(module, { stat: "ACC", multiplier: 1.2, canBeIgnored: true }) as typeof attr)
          : attr;
        for (const ignoreAbility of [true, false]) {
          for (const stat of ALL_STATS) {
            const statVal = new NumberHolder(100);
            const params = {
              pokemon: holder,
              target: foe,
              stat,
              statVal,
              move: allMoves[MoveId.TACKLE],
              ignoreAbility,
              simulated: false,
            };
            const can = (variant as typeof site.attr).canApply(params as never);
            // Victory Star is not ignorable: it applies to ACC whatever the engine says. A built ignorable one yields to it.
            const expected = stat === Stat.ACC && !(ignoreAbility && ignorable);
            expect(can, `${label} ignorable=${ignorable} ignoreAbility=${ignoreAbility} ${Stat[stat]}`).toBe(expected);
          }
        }
      }
    }
  });
});

describe("B02 chunk 4: Victory Star in a real double battle", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    unregisterShadows();
  });

  async function accuracies(abilityId: number): Promise<Record<string, number>> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("double")
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .startingWave(5)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.SHUCKLE);
    const [first, second] = game.scene.getPlayerField();
    const foe = game.scene.getEnemyField()[0];
    const result: Record<string, number> = {};
    // the engine asks for Accuracy and Evasion in getAccuracyMultiplier and for the other stats in getEffectiveStat
    for (const move of [MoveId.TACKLE, MoveId.THUNDERBOLT]) {
      result[`first accuracy ${MoveId[move]}`] = first.getAccuracyMultiplier(foe, allMoves[move]);
      result[`second accuracy ${MoveId[move]}`] = second.getAccuracyMultiplier(foe, allMoves[move]);
    }
    for (const stat of ALL_STATS) {
      result[`first ${Stat[stat]}`] = first.getEffectiveStat(stat as never);
      result[`second ${Stat[stat]}`] = second.getEffectiveStat(stat as never);
    }
    return result;
  }

  it("the rebuilt ability changes the partner exactly like the original, and the original really changes it", async () => {
    const original = liveAbility(AbilityId.VICTORY_STAR);
    expect(original.attrs.map(attr => attr.constructor.name)).toContain("AllyStatMultiplierAbAttr");
    const shadowId = allocateShadowId();
    const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry });
    expect(rebuilt.rebuilt.length).toBeGreaterThan(1);
    const baseline = await accuracies(AbilityId.BALL_FETCH);
    const before = await accuracies(AbilityId.VICTORY_STAR);
    registerShadow(shadowId, rebuilt.ability);
    const after = await accuracies(shadowId);
    expect(after).toEqual(before);
    // The owner's own accuracy goes up (attr 0) and the PARTNER's goes up too (attr 1, the ally class).
    expect(before["first accuracy TACKLE"]).toBeGreaterThan(baseline["first accuracy TACKLE"]);
    expect(before["second accuracy TACKLE"]).toBeGreaterThan(baseline["second accuracy TACKLE"]);
  }, 120000);
});

// ---------------------------------------------------------------------------------------------------------------------
// The two PostAttack status classes

interface ReferenceFields {
  contactRequired: boolean;
  chance: number;
  effects: readonly StatusEffect[];
  attackCondition: (user: Pokemon, target: Pokemon, move: unknown) => boolean;
}

/** The ORIGINAL canApply, copied from the source as it was before the Tier B split (ab-attrs.ts, git history). */
function referenceCanApply(attr: object, params: PostMoveInteractionAbAttrParams): boolean {
  const fields = attr as unknown as ReferenceFields;
  const { simulated, pokemon, move, opponent } = params;
  if (
    fields.attackCondition(pokemon, opponent, move)
    && (simulated
      || (!opponent.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")
        && pokemon !== opponent
        && (!fields.contactRequired
          || move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent }))
        && pokemon.randBattleSeedInt(100) < fields.chance))
  ) {
    const effect =
      fields.effects.length === 1 ? fields.effects[0] : fields.effects[pokemon.randBattleSeedInt(fields.effects.length)];
    return simulated || opponent.canSetStatus(effect, true, false, pokemon);
  }
  return false;
}

describe("B02 chunk 4: attack-then-status classes keep their clause order and random draws", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const params = (holder: Pokemon, foe: Pokemon, move: MoveId, simulated: boolean): PostMoveInteractionAbAttrParams =>
    ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[move],
      damage: 5,
      hitResult: HitResult.EFFECTIVE,
      simulated,
    }) as PostMoveInteractionAbAttrParams;

  const BASE_GATE = { all: [{ block: "move.damaging", params: {} }, { block: "rng.chance", params: { pct: 30 } }] };
  const CONTACT_GATE = {
    all: [
      { block: "move.damaging", params: {} },
      { block: "move.flag", params: { flag: "MAKES_CONTACT" } },
      { block: "rng.chance", params: { pct: 30 } },
    ],
  };

  it("the split class, the reference of the old code and the rebuild agree on result and draws in every state", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const baseModule = declRegistry.get("PostAttackApplyStatusEffectAbAttr")!;
    const contactModule = declRegistry.get("PostAttackContactApplyStatusEffectAbAttr")!;
    const several = [StatusEffect.POISON, StatusEffect.PARALYSIS, StatusEffect.SLEEP];
    const variants: [string, PostAttackApplyStatusEffectAbAttr, PostAttackApplyStatusEffectAbAttr][] = [
      [
        "base, one status",
        new PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.POISON),
        buildAttr(baseModule, { chance: 30, statuses: "POISON" }, { gate: BASE_GATE }) as PostAttackApplyStatusEffectAbAttr,
      ],
      [
        "base, several statuses",
        new PostAttackApplyStatusEffectAbAttr(false, 30, ...several),
        buildAttr(
          baseModule,
          { chance: 30, statuses: "POISON,PARALYSIS,SLEEP" },
          { gate: BASE_GATE },
        ) as PostAttackApplyStatusEffectAbAttr,
      ],
      [
        "contact, one status",
        new PostAttackContactApplyStatusEffectAbAttr(30, StatusEffect.BURN),
        buildAttr(contactModule, { chance: 30, statuses: "BURN" }, { gate: CONTACT_GATE }) as PostAttackApplyStatusEffectAbAttr,
      ],
      [
        "contact, several statuses",
        new PostAttackContactApplyStatusEffectAbAttr(30, ...several),
        buildAttr(
          contactModule,
          { chance: 30, statuses: "POISON,PARALYSIS,SLEEP" },
          { gate: CONTACT_GATE },
        ) as PostAttackApplyStatusEffectAbAttr,
      ],
    ];
    let log: number[] = [];
    let nextDraw = 0;
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min + (nextDraw % range);
    });
    const run = (fn: () => boolean): [boolean, number[]] => {
      log = [];
      const result = fn();
      return [result, [...log]];
    };
    const shielded = vi.spyOn(foe, "hasAbilityWithAttr");
    let sawTrue = 0;
    let sawChanceDraw = 0;
    let checked = 0;
    for (const [label, original, rebuilt] of variants) {
      for (const move of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.GROWL]) {
        for (const foeStatus of [StatusEffect.NONE, StatusEffect.BURN]) {
          for (const shield of [false, true]) {
            for (const simulated of [false, true]) {
              for (const draw of [0, 5, 29, 30, 99]) {
                for (const self of [false, true]) {
                  nextDraw = draw;
                  setStatusOf(foe, foeStatus);
                  shielded.mockImplementation((attr: string) => shield && attr === "IgnoreMoveEffectsAbAttr");
                  const target = self ? holder : foe;
                  const p = params(holder, target, move, simulated);
                  const expected = run(() => referenceCanApply(original, p));
                  const split = run(() => original.canApply(p));
                  const rebuild = run(() => rebuilt.canApply(p));
                  const where = `${label}, ${MoveId[move]}, foe status ${foeStatus}, shield ${shield}, simulated ${simulated}, draw ${draw}, self ${self}`;
                  expect(split, `${where}: the split class against the old code`).toEqual(expected);
                  // A rebuild evaluates every atom for a simulated call, the class does not (notes): compare it unsimulated only.
                  if (!simulated) {
                    expect(rebuild, `${where}: the rebuild against the old code`).toEqual(expected);
                  }
                  checked++;
                  if (expected[0]) {
                    sawTrue++;
                  }
                  if (expected[1].includes(100)) {
                    sawChanceDraw++;
                  }
                }
              }
            }
          }
        }
      }
    }
    setStatusOf(foe, StatusEffect.NONE);
    expect(checked).toBe(4 * 3 * 2 * 2 * 2 * 5 * 2);
    expect(sawTrue).toBeGreaterThan(0);
    expect(sawChanceDraw).toBeGreaterThan(0);
  }, 120000);

  it("apply draws its own pick with several statuses and none with one", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const several = [StatusEffect.POISON, StatusEffect.PARALYSIS, StatusEffect.SLEEP];
    const trySetStatus = vi.spyOn(foe, "trySetStatus").mockImplementation(() => true);
    const log: number[] = [];
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min + (range - 1);
    });
    new PostAttackContactApplyStatusEffectAbAttr(30, StatusEffect.BURN).apply(params(holder, foe, MoveId.TACKLE, false));
    expect(log).toEqual([]);
    expect(trySetStatus).toHaveBeenLastCalledWith(StatusEffect.BURN, holder);
    new PostAttackContactApplyStatusEffectAbAttr(30, ...several).apply(params(holder, foe, MoveId.TACKLE, false));
    expect(log).toEqual([3]);
    expect(trySetStatus).toHaveBeenLastCalledWith(StatusEffect.SLEEP, holder);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The two move locks

describe("B02 chunk 4: Gorilla Tactics and Sage Power move locks", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const [name, ctor, tag] of [
    ["Gorilla Tactics", GorillaTacticsAbAttr, BattlerTagType.GORILLA_TACTICS],
    ["Sage Power", SagePowerMoveLockAbAttr, BattlerTagType.ER_SAGE_POWER_LOCK],
  ] as const) {
    it(`${name}: canApply is "not locked yet", apply adds its own tag once and not when simulated`, async () => {
      const { holder } = await startWorld(phaserGame);
      const attr = new ctor();
      const base = { pokemon: holder, simulated: false };
      expect(attr.canApply(base as never)).toBe(true);
      const addTag = vi.spyOn(holder, "addTag").mockImplementation(() => true);
      attr.apply({ ...base, simulated: true } as never);
      expect(addTag).not.toHaveBeenCalled();
      attr.apply(base as never);
      expect(addTag).toHaveBeenCalledTimes(1);
      expect(addTag).toHaveBeenCalledWith(tag);
      vi.spyOn(holder, "getTag").mockImplementation(t => (t === tag ? ({} as never) : undefined));
      expect(attr.canApply(base as never)).toBe(false);
      // the other lock's tag does not block this one
      const other = tag === BattlerTagType.GORILLA_TACTICS ? BattlerTagType.ER_SAGE_POWER_LOCK : BattlerTagType.GORILLA_TACTICS;
      vi.spyOn(holder, "getTag").mockImplementation(t => (t === other ? ({} as never) : undefined));
      expect(attr.canApply(base as never)).toBe(true);
      vi.restoreAllMocks();
    });
  }
});

describe("B02 chunk 4: the move locks in a real battle, original against rebuilt", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    unregisterShadows();
  });

  // The shared L2 scenario uses Tackle and then Double Slap, which a lock answers with "can only use Tackle", so the twin
  // run cannot pass for these two classes (request B02-40). Here the same Pokemon uses Tackle twice and is then asked for others.
  async function lockState(abilityId: number): Promise<Record<string, unknown>> {
    const game = freshGame(phaserGame);
    game.override
      .moveset([MoveId.TACKLE, MoveId.DOUBLE_SLAP, MoveId.WATER_GUN])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.scene.getPlayerPokemon()!;
    const result: Record<string, unknown> = {};
    const snapshot = (when: string): void => {
      result[`${when} gorilla tag`] = holder.getTag(BattlerTagType.GORILLA_TACTICS) !== undefined;
      result[`${when} sage tag`] = holder.getTag(BattlerTagType.ER_SAGE_POWER_LOCK) !== undefined;
      result[`${when} attack`] = holder.getStat(Stat.ATK, false);
      for (const move of [MoveId.TACKLE, MoveId.DOUBLE_SLAP, MoveId.WATER_GUN]) {
        result[`${when} ${MoveId[move]} selectable`] = holder.isMoveSelectable(move)[0];
      }
    };
    snapshot("before");
    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    snapshot("after the first move");
    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    snapshot("after the second move");
    return result;
  }

  for (const [name, id, tagKey] of [
    ["Gorilla Tactics", 255, "gorilla tag"],
    ["Sage Power", 5090, "sage tag"],
  ] as const) {
    it(`${name}: the rebuilt ability locks the Pokemon exactly like the original`, async () => {
      const original = liveAbility(id);
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry });
      expect(rebuilt.rebuilt.length).toBeGreaterThan(0);
      const before = await lockState(id);
      registerShadow(shadowId, rebuilt.ability);
      const after = await lockState(shadowId);
      expect(after).toEqual(before);
      // the original really locks: nothing before the first move, the tag afterwards, other moves refused
      expect(before["before " + tagKey]).toBe(false);
      expect(before["after the first move " + tagKey]).toBe(true);
      expect(before["after the first move TACKLE selectable"]).toBe(true);
      expect(before["after the first move DOUBLE_SLAP selectable"]).toBe(false);
      expect(before["after the first move WATER_GUN selectable"]).toBe(false);
    }, 120000);
  }
});
