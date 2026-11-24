/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  CopyFaintedAllyAbilityAbAttr,
  PostAttackAbAttr,
  PostAttackAbilityGiveAbAttr,
  PostAttackApplyBattlerTagAbAttr,
  type PostDefendStealHeldItemAbAttr,
  PostKnockOutStatStageChangeAbAttr,
  PostVictoryFormChangeAbAttr,
  PostVictoryStatStageChangeAbAttr,
  SynchronizeStatusAbAttr,
} from "#abilities/ab-attrs";
// B03 chunk 1: probes the shared L1 / L2 suites cannot see. The L1 attr differential has no engine-parameter builder
// for the win and got-status moments, only ever offers the foe as the fainted Pokemon, and cannot rebuild the attrs
// whose gate is a legacy closure. This file therefore drives the REAL classes directly against a VERBATIM copy of the
// canApply they had before the Tier B split (git commit ce5d9815f), over every combination of clause results, and
// compares the result AND the ranges of the random numbers drawn, in order.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setTypesOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Params = PostMoveInteractionAbAttrParams;

/** The original first clause of every PostAttackAbAttr subclass: `super.canApply(params)` (a damaging move). */
function isDamaging(attr: PostAttackAbAttr, params: Params): boolean {
  return PostAttackAbAttr.prototype.canApply.call(attr, params);
}

const params = (holder: Pokemon, opponent: Pokemon, move: MoveId, extra: Partial<Params> = {}): Params =>
  ({
    pokemon: holder,
    opponent,
    move: allMoves[move],
    damage: 5,
    hitResult: HitResult.EFFECTIVE,
    simulated: false,
    ...extra,
  }) as Params;

describe("B03 chunk 1: Tier B splits keep the original canApply (result and random draws)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("PostAttackApplyBattlerTagAbAttr: every clause combination answers and draws like the original", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    let log: number[] = [];
    let next = 0;
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min + next;
    });
    const chances: Record<string, (u: Pokemon, t: Pokemon, m: (typeof allMoves)[number]) => number> = {
      zero: () => 0,
      fifty: () => 50,
      hundred: () => 100,
      moveDependent: (_u, _t, m) => (m.id === MoveId.TACKLE ? 100 : 0),
    };
    let combos = 0;
    let rolled = 0;
    for (const contactRequired of [false, true]) {
      for (const [chanceName, chance] of Object.entries(chances)) {
        const attr = new PostAttackApplyBattlerTagAbAttr(contactRequired, chance, BattlerTagType.CONFUSED);
        for (const move of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.SWORDS_DANCE]) {
          for (const shieldDust of [false, true]) {
            for (const target of ["foe", "self"] as const) {
              for (const draw of [0, 49, 99]) {
                const opponent = target === "foe" ? foe : holder;
                vi.spyOn(opponent, "hasAbilityWithAttr").mockImplementation(
                  name => shieldDust && name === "IgnoreMoveEffectsAbAttr",
                );
                const p = params(holder, opponent, move);
                next = draw;
                log = [];
                // The ORIGINAL canApply, verbatim: damaging move, Shield Dust block, not self, contact, roll (last).
                const original =
                  isDamaging(attr, p)
                  && !opponent.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")
                  && holder !== opponent
                  && (!contactRequired
                    || allMoves[move].doesFlagEffectApply({
                      flag: MoveFlags.MAKES_CONTACT,
                      user: holder,
                      target: opponent,
                    }))
                  && holder.randBattleSeedInt(100) < chance(holder, opponent, allMoves[move]);
                const originalLog = [...log];
                log = [];
                const now = attr.canApply(p);
                expect(
                  now,
                  `${chanceName} contact=${contactRequired} ${MoveId[move]} shield=${shieldDust} ${target} draw=${draw}`,
                ).toBe(original);
                expect(log).toEqual(originalLog);
                combos++;
                rolled += originalLog.length;
              }
            }
          }
        }
      }
    }
    expect(combos).toBe(2 * 4 * 3 * 2 * 2 * 3);
    // The roll really happens in many cases and is skipped in the others: the test is not vacuous.
    expect(rolled).toBeGreaterThan(20);
    expect(rolled).toBeLessThan(combos);
  });

  it("PostAttackApplyBattlerTagAbAttr: a chance of 0 and of 100 still draw once, and only after the damaging-move check", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const log: number[] = [];
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min;
    });
    for (const chance of [0, 100]) {
      const attr = new PostAttackApplyBattlerTagAbAttr(false, () => chance, BattlerTagType.FLINCHED);
      log.length = 0;
      attr.canApply(params(holder, foe, MoveId.TACKLE));
      expect(log, `chance ${chance} on a damaging move`).toEqual([100]);
      log.length = 0;
      attr.canApply(params(holder, foe, MoveId.SWORDS_DANCE));
      expect(log, `chance ${chance} on a status move`).toEqual([]);
    }
  });

  it("PostAttackApplyBattlerTagAbAttr: all 13 rebuilt users give the original answer for EVERY roll from 0 to 99 (the chance number is proven)", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostAttackApplyBattlerTagAbAttr")!;
    // [ability id, attr index] of every user whose gate is bound (the other eleven are legacy closures, see bindings.ts).
    const users: [number, number][] = [
      [56, 1],
      [5216, 2],
      [5238, 1],
      [5527, 1],
      [12, 3],
      [5631, 0],
      [5631, 1],
      [5053, 2],
      [5689, 2],
      [5955, 2],
      [5501, 2],
      [5714, 3],
      [5486, 12],
    ];
    let roll = 0;
    let draws = 0;
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((_range: number, min = 0) => {
      draws++;
      return min + roll;
    });
    const typeSets: PokemonType[][] = [
      [PokemonType.NORMAL],
      [PokemonType.WATER],
      [PokemonType.GHOST],
      [PokemonType.DARK],
    ];
    let yes = 0;
    let total = 0;
    for (const [id, index] of users) {
      const original = liveAbility(id).attrs[index] as PostAttackApplyBattlerTagAbAttr;
      expect(original, `ability ${id} attr ${index}`).toBeInstanceOf(PostAttackApplyBattlerTagAbAttr);
      const rebuilt = recomposeAttr(module, original, id, index);
      expect(rebuilt).not.toBe(original);
      for (const types of typeSets) {
        setTypesOf(holder, types);
        for (const hangry of [false, true]) {
          vi.spyOn(holder, "getFormKey").mockReturnValue(hangry ? "hangry" : "");
          for (const move of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.SHADOW_BALL, MoveId.BITE, MoveId.SWORDS_DANCE]) {
            for (roll = 0; roll < 100; roll++) {
              const p = params(holder, foe, move);
              draws = 0;
              const a = original.canApply(p);
              const drawsA = draws;
              draws = 0;
              const b = rebuilt.canApply(p);
              if (b !== a || draws !== drawsA) {
                expect.fail(
                  `${original.constructor.name} ${id}#${index} ${types.join("+")} hangry=${hangry} ${MoveId[move]} roll=${roll}: original ${a}/${drawsA} draws, rebuilt ${b}/${draws} draws`,
                );
              }
              total++;
              yes += a ? 1 : 0;
            }
          }
        }
      }
    }
    expect(total).toBe(13 * 4 * 2 * 5 * 100);
    // Both answers occur often, so the sweep sees the threshold of every user.
    expect(yes).toBeGreaterThan(500);
    expect(yes).toBeLessThan(total);
  }, 300_000);

  it("PostAttackAbilityGiveAbAttr: guards, gate and residual together equal the original", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const attr = new PostAttackAbilityGiveAbAttr(5377 as never);
    let combos = 0;
    for (const move of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.SWORDS_DANCE]) {
      for (const target of ["foe", "self"] as const) {
        for (const suppressable of [false, true]) {
          for (const alreadyGiver of [false, true]) {
            const opponent = target === "foe" ? foe : holder;
            const abilitySpy = vi.spyOn(opponent, "getAbility").mockReturnValue({
              suppressable,
              hasAttr: (name: string) => alreadyGiver && name === "PostAttackAbilityGiveAbAttr",
            } as never);
            const p = params(holder, opponent, move);
            const original =
              isDamaging(attr, p)
              && holder !== opponent
              && allMoves[move].doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: holder, target: opponent })
              && opponent.getAbility().suppressable
              && !opponent.getAbility().hasAttr("PostAttackAbilityGiveAbAttr");
            expect(
              attr.canApply(p),
              `${MoveId[move]} ${target} suppressable=${suppressable} giver=${alreadyGiver}`,
            ).toBe(original);
            abilitySpy.mockRestore();
            combos++;
          }
        }
      }
    }
    expect(combos).toBe(24);
  });

  it("SynchronizeStatusAbAttr: every status, with and without a source, equals the original", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const attr = new SynchronizeStatusAbAttr();
    const sync = new Set([StatusEffect.BURN, StatusEffect.PARALYSIS, StatusEffect.POISON, StatusEffect.TOXIC]);
    let yes = 0;
    for (const effect of Object.values(StatusEffect).filter((v): v is StatusEffect => typeof v === "number")) {
      for (const sourcePokemon of [foe, holder, undefined]) {
        const original = (sourcePokemon ?? false) && sync.has(effect);
        const now = attr.canApply({ pokemon: holder, effect, sourcePokemon, simulated: false } as never);
        expect(now, `${StatusEffect[effect]} source=${sourcePokemon === undefined ? "none" : "a pokemon"}`).toBe(
          Boolean(original),
        );
        yes += now ? 1 : 0;
      }
    }
    expect(yes).toBe(8);
  });

  it("CopyFaintedAllyAbilityAbAttr: the original and the rebuilt Receiver agree for every victim and copiable answer", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(222).attrs[0] as CopyFaintedAllyAbilityAbAttr;
    expect(original).toBeInstanceOf(CopyFaintedAllyAbilityAbAttr);
    const module = declRegistry.get("CopyFaintedAllyAbilityAbAttr")!;
    const rebuilt = recomposeAttr(module, original, 222, 0) as CopyFaintedAllyAbilityAbAttr;
    expect(rebuilt).not.toBe(original);
    // A fainted teammate: a stand-in on the holder's side (the single battle has none).
    const teammate = Object.create(holder) as Pokemon;
    let combos = 0;
    for (const [name, victim] of [
      ["foe", foe],
      ["itself", holder],
      ["teammate", teammate],
    ] as const) {
      for (const copiable of [false, true]) {
        vi.spyOn(victim, "getAbility").mockReturnValue({ copiable, id: 1 } as never);
        const p = { pokemon: holder, victim, simulated: false } as never;
        const expected = holder.isPlayer() === victim.isPlayer() && copiable;
        expect(original.canApply(p), `original ${name} copiable=${copiable}`).toBe(expected);
        expect(rebuilt.canApply(p), `rebuilt ${name} copiable=${copiable}`).toBe(expected);
        combos++;
      }
    }
    expect(combos).toBe(6);
    // The gate is the library form: swapping it for "never" stops the copy even for a teammate with a copiable ability.
    const never = recomposeAttr(module, original, 222, 0, { conds: { gate: { not: { all: [] } } } as never });
    vi.spyOn(teammate, "getAbility").mockReturnValue({ copiable: true, id: 1 } as never);
    expect(never.canApply({ pokemon: holder, victim: teammate, simulated: false } as never)).toBe(false);
  });
});

describe("B03 chunk 1: the effect classes rebuilt from their declarations act like the originals", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const queued = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.map(call => call.slice(2));

  it("every PostVictoryStatStageChangeAbAttr user queues the same stat change as its rebuild", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("PostVictoryStatStageChangeAbAttr")!;
    const users: [number, number][] = [
      [153, 0],
      [210, 4],
      [224, 0],
      [264, 0],
      [265, 0],
      [266, 2],
      [267, 2],
      [5004, 2],
      [5005, 2],
      [5259, 2],
      [5259, 3],
      [6087, 1],
    ];
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    for (const [id, index] of users) {
      const original = liveAbility(id).attrs[index] as PostVictoryStatStageChangeAbAttr;
      expect(original, `ability ${id} attr ${index}`).toBeInstanceOf(PostVictoryStatStageChangeAbAttr);
      const rebuilt = recomposeAttr(module, original, id, index);
      expect(rebuilt).not.toBe(original);
      spy.mockClear();
      original.apply({ pokemon: holder, simulated: false });
      const a = queued(spy);
      spy.mockClear();
      rebuilt.apply({ pokemon: holder, simulated: false } as never);
      expect(queued(spy), `ability ${id}`).toEqual(a);
      expect(a.length).toBe(1);
      // A simulated call queues nothing for either.
      spy.mockClear();
      original.apply({ pokemon: holder, simulated: true });
      rebuilt.apply({ pokemon: holder, simulated: true } as never);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("the Highest-stat rule picks the same stat as Beast Boost for every ordering of stats, ties included", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("PostVictoryStatStageChangeAbAttr")!;
    const original = liveAbility(224).attrs[0] as PostVictoryStatStageChangeAbAttr;
    const rebuilt = recomposeAttr(module, original, 224, 0);
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const tables: number[][] = [
      [100, 100, 100, 100, 100],
      [50, 200, 200, 10, 10],
      [10, 20, 30, 40, 50],
      [50, 40, 30, 20, 10],
      [1, 1, 1, 1, 2],
      [0, 0, 0, 0, 0],
    ];
    const picks = new Set<unknown>();
    for (const table of tables) {
      vi.spyOn(holder, "getStat").mockImplementation(((stat: Stat) => {
        const i = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD].indexOf(stat);
        return table[i] ?? 0;
      }) as never);
      spy.mockClear();
      original.apply({ pokemon: holder, simulated: false });
      const a = queued(spy);
      spy.mockClear();
      rebuilt.apply({ pokemon: holder, simulated: false } as never);
      expect(queued(spy), `stats ${table.join(",")}`).toEqual(a);
      picks.add(JSON.stringify(a));
    }
    // Different tables really give different picks (the test is not vacuous).
    expect(picks.size).toBeGreaterThan(2);
  });

  it("PostKnockOutStatStageChangeAbAttr: Soul-Heart, Pure Good and Fae Heart rebuild to the same stat change", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostKnockOutStatStageChangeAbAttr")!;
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    for (const [id, index] of [
      [220, 0],
      [5935, 2],
      [20007, 4],
    ] as const) {
      const original = liveAbility(id).attrs[index] as PostKnockOutStatStageChangeAbAttr;
      expect(original).toBeInstanceOf(PostKnockOutStatStageChangeAbAttr);
      const rebuilt = recomposeAttr(module, original, id, index);
      spy.mockClear();
      original.apply({ pokemon: holder, victim: foe, simulated: false });
      const a = queued(spy);
      spy.mockClear();
      rebuilt.apply({ pokemon: holder, victim: foe, simulated: false } as never);
      expect(queued(spy)).toEqual(a);
      expect(a).toEqual([[true, [Stat.SPATK], 1]]);
    }
  });

  it("PostVictoryFormChangeAbAttr: both Battle Bond attrs stay legacy closures with a written reason", async () => {
    await startWorld(phaserGame);
    const module = declRegistry.get("PostVictoryFormChangeAbAttr")!;
    for (const index of [0, 3]) {
      const attr = liveAbility(210).attrs[index];
      expect(attr).toBeInstanceOf(PostVictoryFormChangeAbAttr);
      expect(getBinding(210, index, "ctor:0")?.legacyClosure).toBeDefined();
      expect(() => recomposeAttr(module, attr, 210, index)).toThrow();
    }
  });

  it("PostDefendStealHeldItemAbAttr: Pickpocket and its rebuild draw the item pick at the same moment", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(124).attrs[0] as PostDefendStealHeldItemAbAttr;
    const module = declRegistry.get("PostDefendStealHeldItemAbAttr")!;
    const rebuilt = recomposeAttr(module, original, 124, 0) as PostDefendStealHeldItemAbAttr;
    expect(rebuilt).not.toBe(original);
    const items = [{ isTransferable: true }, { isTransferable: true }, { isTransferable: false }];
    for (const attr of [original, rebuilt]) {
      vi.spyOn(attr, "getTargetHeldItems").mockReturnValue(items as never);
    }
    vi.spyOn(globalScene, "canTransferHeldItemModifier").mockReturnValue(true);
    let log: number[] = [];
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min;
    });
    for (const move of [MoveId.TACKLE, MoveId.WATER_GUN]) {
      for (const simulated of [false, true]) {
        for (const hitResult of [HitResult.EFFECTIVE, HitResult.NO_EFFECT]) {
          const p = params(holder, foe, move, { simulated, hitResult });
          log = [];
          const a = original.canApply(p);
          const logA = [...log];
          log = [];
          const b = rebuilt.canApply(p);
          expect(b, `${MoveId[move]} simulated=${simulated} hit=${HitResult[hitResult]}`).toBe(a);
          expect(log).toEqual(logA);
          if (move === MoveId.TACKLE && !simulated && hitResult === HitResult.EFFECTIVE) {
            // Two of the three items can be taken: one draw of range 2, and the steal goes ahead.
            expect(logA).toEqual([2]);
            expect(a).toBe(true);
          } else {
            expect(logA).toEqual([]);
          }
        }
      }
    }
  });
});
