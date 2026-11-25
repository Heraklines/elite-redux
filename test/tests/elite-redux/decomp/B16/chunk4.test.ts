/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 4 probes: what the shared L1 grid and the L2 twin cannot see.
//   - Knuckle Down: the clause order and the full truth table of canApply (attack condition, hit result, first strike, punch flag),
//     driven on the ORIGINAL attr and on its REBUILD side by side; the effect (which stat, how many stages, nothing when simulated);
//     the two replaceable slots; and an L2 twin with a real two-strike punch (the shared template has no punching move).
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { celebrate, TEMPLATES, use } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { liveAbility, twinRebuild } from "#test/tests/elite-redux/decomp/harness/twin";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const KNUCKLE_DOWN = 6099;

function moduleOf(name: string): NonNullable<ReturnType<typeof declRegistry.get>> {
  const module = declRegistry.get(name);
  expect(module, `${name} must be declared`).toBeDefined();
  return module!;
}

function hitParams(
  holder: Pokemon,
  foe: Pokemon,
  move: MoveId,
  hitResult: HitResult,
  simulated = false,
): PostMoveInteractionAbAttrParams {
  return {
    pokemon: holder,
    opponent: foe,
    move: allMoves[move],
    damage: 5,
    hitResult,
    simulated,
  } as PostMoveInteractionAbAttrParams;
}

describe("B16 chunk 4", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Knuckle Down", () => {
    it("truth table: damaging move, the hit connected, the FIRST strike, a punching move; original and rebuild agree on every row", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(KNUCKLE_DOWN).attrs[0];
      const module = moduleOf("KnuckleDownAbAttr");
      const rebuilt = recomposeAttr(module, original, KNUCKLE_DOWN, 0);
      expect(rebuilt).not.toBe(original);
      expect(readDeclParams(module, original)).toEqual({ stat: "ATK", stages: 1 });

      const moves = [MoveId.MACH_PUNCH, MoveId.THUNDER_PUNCH, MoveId.TACKLE, MoveId.WILL_O_WISP] as const;
      const results = [
        HitResult.EFFECTIVE,
        HitResult.SUPER_EFFECTIVE,
        HitResult.NOT_VERY_EFFECTIVE,
        HitResult.ONE_HIT_KO,
        HitResult.NO_EFFECT,
        HitResult.STATUS,
        HitResult.FAIL,
        HitResult.MISS,
        HitResult.INDIRECT,
        HitResult.IMMUNE,
      ];
      // [hitCount, hitsLeft] as the engine has them when the strike's PostAttack runs: equal on strike one only.
      const counters: readonly [number, number][] = [
        [1, 1],
        [2, 2],
        [3, 3],
        [2, 1],
        [3, 2],
        [3, 1],
        [0, 0],
        [-1, -1],
        [1, 0],
      ];
      let passing = 0;
      for (const move of moves) {
        for (const result of results) {
          for (const [count, left] of counters) {
            holder.turnData.hitCount = count;
            holder.turnData.hitsLeft = left;
            const punching = move === MoveId.MACH_PUNCH || move === MoveId.THUNDER_PUNCH;
            const expected =
              move !== MoveId.WILL_O_WISP && result < HitResult.NO_EFFECT && count === left && punching;
            passing += expected ? 1 : 0;
            const params = hitParams(holder, foe, move, result);
            const label = `${MoveId[move]} ${HitResult[result]} hitCount ${count} hitsLeft ${left}`;
            expect(original.canApply(params), `original ${label}`).toBe(expected);
            expect(rebuilt.canApply(params), `rebuild ${label}`).toBe(expected);
          }
        }
      }
      // 2 punches x 4 landed results x 4 equal counter pairs.
      expect(passing).toBe(2 * 4 * 5);
    });

    it("apply: raises Attack of the HOLDER by one stage through a StatStageChangePhase; nothing when simulated; the settings are live", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(KNUCKLE_DOWN).attrs[0];
      const module = moduleOf("KnuckleDownAbAttr");
      const rebuilt = recomposeAttr(module, original, KNUCKLE_DOWN, 0);
      const speedTwo = recomposeAttr(module, original, KNUCKLE_DOWN, 0, { params: { stat: "SPD", stages: 2 } });
      const built = buildAttr(module, { stat: "DEF", stages: -1 }, { "ctor:0": { all: [] }, gate: { all: [] } });

      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
      const run = (attr: AbAttr, simulated: boolean) => {
        spy.mockClear();
        attr.apply(hitParams(holder, foe, MoveId.MACH_PUNCH, HitResult.EFFECTIVE, simulated));
        return spy.mock.calls.map(call => call.slice());
      };
      const expectPhase = (calls: unknown[][], stat: Stat, stages: number) => {
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual(["StatStageChangePhase", holder.getBattlerIndex(), true, [stat], stages]);
      };

      for (const attr of [original, rebuilt]) {
        expect(run(attr, true)).toEqual([]);
        expectPhase(run(attr, false), Stat.ATK, 1);
      }
      expectPhase(run(speedTwo, false), Stat.SPD, 2);
      expect(run(speedTwo, true)).toEqual([]);
      expectPhase(run(built, false), Stat.DEF, -1);
      expect(readDeclParams(module, speedTwo)).toEqual({ stat: "SPD", stages: 2 });
      // The rebuild keeps the class name (the Endless Avalanche hook keys on it) and showAbility.
      expect(rebuilt.constructor.name).toBe("KnuckleDownAbAttr");
      expect(rebuilt.showAbility).toBe(original.showAbility);
    });

    it("both condition slots are replaceable: any damaging move, or any move at all; the locked clauses stay", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(KNUCKLE_DOWN).attrs[0];
      const module = moduleOf("KnuckleDownAbAttr");
      holder.turnData.hitCount = 1;
      holder.turnData.hitsLeft = 1;

      const anyMove = recomposeAttr(module, original, KNUCKLE_DOWN, 0, { conds: { gate: { all: [] } } });
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.EFFECTIVE))).toBe(true);
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.WILL_O_WISP, HitResult.EFFECTIVE))).toBe(false);
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.IMMUNE))).toBe(false);
      holder.turnData.hitsLeft = 0;
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.EFFECTIVE)), "first strike stays").toBe(false);
      holder.turnData.hitsLeft = 1;

      const noAttackCondition = recomposeAttr(module, original, KNUCKLE_DOWN, 0, { conds: { "ctor:0": { all: [] } } });
      expect(noAttackCondition.canApply(hitParams(holder, foe, MoveId.MACH_PUNCH, HitResult.EFFECTIVE))).toBe(true);
      expect(noAttackCondition.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.EFFECTIVE))).toBe(false);

      const soundMoves = recomposeAttr(module, original, KNUCKLE_DOWN, 0, {
        conds: { gate: { block: "move.flag", params: { flag: "SOUND_BASED" } } },
      });
      expect(soundMoves.canApply(hitParams(holder, foe, MoveId.HYPER_VOICE, HitResult.EFFECTIVE))).toBe(true);
      expect(soundMoves.canApply(hitParams(holder, foe, MoveId.MACH_PUNCH, HitResult.EFFECTIVE))).toBe(false);
    });

    it("L2 twin with a real two-strike punch: the stat rises once on strike one, original and rebuild trace identically", async () => {
      const scenario = {
        template: {
          ...TEMPLATES["holder-hits-foe"],
          id: "b16-knuckle-down-punches",
          label: "The holder uses a one-strike punch, a two-strike punch and a non-punch against a sturdy Snorlax",
          holderMoves: [MoveId.MACH_PUNCH, MoveId.DOUBLE_IRON_BASH, MoveId.TACKLE, MoveId.CELEBRATE],
          turns: [use(MoveId.MACH_PUNCH), use(MoveId.DOUBLE_IRON_BASH), use(MoveId.TACKLE), celebrate()],
        },
        axes: {},
        label: "punches",
      };
      const outcome = await twinRebuild(phaserGame, liveAbility(KNUCKLE_DOWN), declRegistry, scenario);
      expect(outcome.differences).toEqual([]);
      expect(outcome.rebuilt.rebuilt).toContain(0);
      const raises = outcome.original.messages.filter(message => /Attack rose/.test(message));
      // Mach Punch (one strike) and Double Iron Bash (two strikes, the stat rises on the first only); Tackle gives nothing.
      expect(raises, `the original must raise Attack twice: ${JSON.stringify(outcome.original.messages)}`).toHaveLength(2);
    });
  });
});

