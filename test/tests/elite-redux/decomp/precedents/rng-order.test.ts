/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT probe for RNG inside canApply (PostDefendContactApplyStatusEffectAbAttr). The class draws random numbers
// in canApply (a status pick when it has several statuses, then the chance roll) and again in apply. A rebuild with a
// library gate must draw the SAME ranges in the SAME order, including the cases where the chance roll is skipped
// (no contact, attacker already has a status). The ranges are recorded, not just counted, so a swapped order fails.
import { PostDefendContactApplyStatusEffectAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("precedent: RNG inside canApply (contact status)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const params = (holder: Pokemon, foe: Pokemon, move: MoveId): PostMoveInteractionAbAttrParams =>
    ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[move],
      damage: 5,
      hitResult: HitResult.EFFECTIVE,
      simulated: false,
    }) as PostMoveInteractionAbAttrParams;

  it("draws the status pick first, then the chance roll only after the cheap checks, exactly like the original", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostDefendContactApplyStatusEffectAbAttr");
    expect(module).toBeDefined();
    const several = [StatusEffect.POISON, StatusEffect.PARALYSIS, StatusEffect.SLEEP];
    const original = new PostDefendContactApplyStatusEffectAbAttr(30, ...several);
    const rebuilt = buildAttr(
      module!,
      { chance: 30, statuses: "POISON,PARALYSIS,SLEEP" },
      {
        gate: {
          all: [
            { block: "move.flag", params: { flag: "MAKES_CONTACT" } },
            { block: "status.has", params: { who: "other", status: "NONE" } },
            { block: "rng.chance", params: { pct: 30 } },
          ],
        },
      },
    );
    const draws: number[][] = [];
    let log: number[] = [];
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min + (range - 1);
    });
    const record = (attr: PostDefendContactApplyStatusEffectAbAttr, move: MoveId): [boolean, number[]] => {
      log = [];
      const result = attr.canApply(params(holder, foe, move));
      return [result, [...log]];
    };
    const cases: { label: string; move: MoveId; foeStatus: StatusEffect; expectedRanges: number[] }[] = [
      // contact, no status: pick (3), then the chance roll (100)
      { label: "contact, no status", move: MoveId.TACKLE, foeStatus: StatusEffect.NONE, expectedRanges: [3, 100] },
      // no contact: the pick is still drawn first, the chance roll is skipped
      { label: "no contact", move: MoveId.WATER_GUN, foeStatus: StatusEffect.NONE, expectedRanges: [3] },
      // contact but the attacker already has a status: pick only
      { label: "attacker has a status", move: MoveId.TACKLE, foeStatus: StatusEffect.BURN, expectedRanges: [3] },
    ];
    for (const testCase of cases) {
      setStatusOf(foe, testCase.foeStatus);
      const [originalResult, originalRanges] = record(original, testCase.move);
      const [rebuiltResult, rebuiltRanges] = record(rebuilt as PostDefendContactApplyStatusEffectAbAttr, testCase.move);
      draws.push(originalRanges);
      expect(originalRanges, `${testCase.label}: the original's draws`).toEqual(testCase.expectedRanges);
      expect(rebuiltRanges, `${testCase.label}: the rebuild's draws`).toEqual(originalRanges);
      expect(rebuiltResult, `${testCase.label}: the result`).toBe(originalResult);
    }
    expect(draws).toHaveLength(3);
  });

  it("a single status draws no pick at all: only the chance roll, and only after contact", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostDefendContactApplyStatusEffectAbAttr")!;
    const original = new PostDefendContactApplyStatusEffectAbAttr(30, StatusEffect.PARALYSIS);
    const rebuilt = buildAttr(
      module,
      { chance: 30, statuses: "PARALYSIS" },
      {
        gate: {
          all: [
            { block: "move.flag", params: { flag: "MAKES_CONTACT" } },
            { block: "status.has", params: { who: "other", status: "NONE" } },
            { block: "rng.chance", params: { pct: 30 } },
          ],
        },
      },
    );
    let log: number[] = [];
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      log.push(range);
      return min;
    });
    for (const [move, expected] of [
      [MoveId.TACKLE, [100]],
      [MoveId.WATER_GUN, []],
    ] as const) {
      log = [];
      const a = original.canApply(params(holder, foe, move));
      const originalRanges = [...log];
      log = [];
      const b = rebuilt.canApply(params(holder, foe, move));
      expect(originalRanges).toEqual(expected);
      expect(log).toEqual(originalRanges);
      expect(b).toBe(a);
    }
  });
});
