/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 1: the four library atoms added for this chunk (move.inherent-flag, move.drains, hit.landed-damage,
// mon.protected-from-effects). Each one must call the SAME engine predicate the original clause called, so every test
// below pits the atom against that predicate (or the frozen set of the class) and against its look-alike.
import { allMoves } from "#data/data-lists";
import { compileConditionBlock } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import type { Frame } from "#data/elite-redux/ability-studio/vocabulary/evaluate/frame";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("B08: library atoms added for chunk 1", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const frameOf = (parts: Partial<Frame> & Pick<Frame, "holder">): Frame => ({ simulated: false, ...parts });

  it("move.inherent-flag reads the move's own flag and ignores what the attacker's abilities do (unlike move.flag)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const inherent = compileConditionBlock({ block: "move.inherent-flag", params: { flag: "MAKES_CONTACT" } });
    const user = compileConditionBlock({ block: "move.flag", params: { flag: "MAKES_CONTACT" } });
    const tackle = allMoves[MoveId.TACKLE];
    const ember = allMoves[MoveId.EMBER];
    expect(tackle.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(true);
    expect(ember.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
    const frame = (move: typeof tackle) => frameOf({ holder, other: foe, move, moveUser: foe });
    expect(inherent(frame(tackle))).toBe(true);
    expect(inherent(frame(ember))).toBe(false);
    // A Long Reach style attacker: the user-aware flag says no contact, the move's own flag still says contact.
    const suppressed = Object.assign(Object.create(tackle), { doesFlagEffectApply: () => false });
    expect(user(frame(suppressed))).toBe(false);
    expect(inherent(frame(suppressed))).toBe(true);
    // A frame without a move never matches.
    expect(inherent(frameOf({ holder }))).toBe(false);
  });

  it("move.drains is true exactly for moves that carry the draining attr", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const drains = compileConditionBlock({ block: "move.drains" });
    for (const id of [MoveId.DRAIN_PUNCH, MoveId.GIGA_DRAIN]) {
      expect(allMoves[id].hasAttr("HitHealAttr"), MoveId[id]).toBe(true);
      expect(drains(frameOf({ holder, other: foe, move: allMoves[id] })), MoveId[id]).toBe(true);
    }
    for (const id of [MoveId.TACKLE, MoveId.EMBER, MoveId.GROWL]) {
      expect(drains(frameOf({ holder, other: foe, move: allMoves[id] })), MoveId[id]).toBe(false);
    }
    expect(drains(frameOf({ holder }))).toBe(false);
  });

  it("hit.landed-damage is true for the four damaging hit results only", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const landed = compileConditionBlock({ block: "hit.landed-damage" });
    const damaging = new Set([
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
    ]);
    const all = Object.values(HitResult).filter((value): value is HitResult => typeof value === "number");
    expect(all.length).toBeGreaterThan(damaging.size);
    for (const result of all) {
      expect(landed(frameOf({ holder, other: foe, hitResult: result })), HitResult[result]).toBe(damaging.has(result));
    }
    expect(landed(frameOf({ holder, other: foe }))).toBe(false);
  });

  it("mon.protected-from-effects asks the chosen Pokemon the same question as the class did", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const asked: string[] = [];
    for (const answer of [true, false]) {
      const original = foe.hasAbilityWithAttr.bind(foe);
      foe.hasAbilityWithAttr = ((name: string) => {
        asked.push(name);
        return answer;
      }) as never;
      try {
        const other = compileConditionBlock({ block: "mon.protected-from-effects", params: { who: "other" } });
        expect(other(frameOf({ holder, other: foe }))).toBe(answer);
        // "who: holder" must not ask the target.
        const mine = compileConditionBlock({ block: "mon.protected-from-effects", params: { who: "holder" } });
        mine(frameOf({ holder, other: foe }));
      } finally {
        foe.hasAbilityWithAttr = original as never;
      }
    }
    expect(new Set(asked)).toEqual(new Set(["IgnoreMoveEffectsAbAttr"]));
    expect(asked).toHaveLength(2);
  });
});
