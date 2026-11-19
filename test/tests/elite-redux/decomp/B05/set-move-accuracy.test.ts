/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 chunk 1: SetMoveAccuracyAbAttr (Tier B, calc.accuracy). What the shared suites cannot see:
//   - the shared L1 grid has no Hypnosis or Sing, so the TRUE side of the move gate is never evaluated there;
//   - the shared L2 calc.accuracy scenario never uses the listed move, so `apply` is never reached there.
// Here the original attr of each user and its rebuild are compared on every listed and unlisted move, and over the
// boundary base accuracies of the residual (never-miss -1, 0, just below, at and just above the set value).
import { SetMoveAccuracyAbAttr } from "#abilities/ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { MoveId } from "#enums/move-id";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const USERS = [
  { name: "Hypnotist", id: 5065, index: 0, move: MoveId.HYPNOSIS },
  { name: "Lunar Eclipse", id: 5103, index: 2, move: MoveId.HYPNOSIS },
  { name: "Lullaby", id: 5487, index: 0, move: MoveId.SING },
] as const;

const ACCURACIES = [-1, 0, 1, 55, 59, 60, 89, 90, 91, 100, 101];

describe("SetMoveAccuracyAbAttr: gate, residual and effect", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const attrOf = (id: number, index: number): SetMoveAccuracyAbAttr => {
    const attr = allAbilities[id]?.attrs[index];
    expect(attr, `ability ${id} attr ${index}`).toBeInstanceOf(SetMoveAccuracyAbAttr);
    return attr as SetMoveAccuracyAbAttr;
  };

  it("the rebuilt attr answers canApply and leaves the same accuracy as the original, for every move and accuracy", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("SetMoveAccuracyAbAttr");
    expect(module).toBeDefined();
    const moves = [MoveId.HYPNOSIS, MoveId.SING, MoveId.TACKLE, MoveId.SPLASH, MoveId.SLEEP_POWDER, MoveId.SWIFT];
    let compared = 0;
    let applied = 0;
    for (const user of USERS) {
      const original = attrOf(user.id, user.index);
      const rebuilt = recomposeAttr(module!, original, user.id, user.index) as SetMoveAccuracyAbAttr;
      for (const move of moves) {
        for (const accuracy of ACCURACIES) {
          const a = { pokemon: holder, move: allMoves[move], accuracy: new NumberHolder(accuracy), simulated: false };
          const b = { pokemon: holder, move: allMoves[move], accuracy: new NumberHolder(accuracy), simulated: false };
          const can = original.canApply(a as never);
          expect(rebuilt.canApply(b as never), `${user.name} ${MoveId[move]} at ${accuracy}`).toBe(can);
          if (can) {
            original.apply(a as never);
            rebuilt.apply(b as never);
            applied++;
          }
          expect(b.accuracy.value, `${user.name} ${MoveId[move]} at ${accuracy}`).toBe(a.accuracy.value);
          compared++;
        }
      }
    }
    // The grid really reached the true side of the gate (Hypnotist, Lunar Eclipse and Lullaby each apply at 0, 1, 55, 59, 60, 89).
    expect(applied).toBeGreaterThanOrEqual(3 * 6);
    expect(compared).toBe(USERS.length * moves.length * ACCURACIES.length);
  });

  it("the residual keeps its meaning: never-miss moves and moves already at or above the value are left alone", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = attrOf(5065, 0);
    const probe = (value: number): { can: boolean; value: number } => {
      const params = {
        pokemon: holder,
        move: allMoves[MoveId.HYPNOSIS],
        accuracy: new NumberHolder(value),
        simulated: false,
      };
      const can = attr.canApply(params as never);
      if (can) {
        attr.apply(params as never);
      }
      return { can, value: params.accuracy.value };
    };
    expect(probe(-1)).toEqual({ can: false, value: -1 });
    expect(probe(89)).toEqual({ can: true, value: 90 });
    expect(probe(90)).toEqual({ can: false, value: 90 });
    expect(probe(100)).toEqual({ can: false, value: 100 });
    // The real move: Hypnosis has base accuracy 60, so the ability lifts it to 90 before stages are applied.
    expect(allMoves[MoveId.HYPNOSIS].accuracy).toBe(60);
  });

  it("the real accuracy calculation: Hypnotist lifts Hypnosis to 90 and leaves other moves alone, original and rebuilt alike", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("SetMoveAccuracyAbAttr")!;
    const original = attrOf(5065, 0);
    const rebuilt = recomposeAttr(module, original, 5065, 0) as SetMoveAccuracyAbAttr;
    const ability = holder.getAbility();
    const keep = [...ability.attrs];
    const calc = (move: MoveId): number => allMoves[move].calculateBattleAccuracy(holder, foe, true);
    try {
      ability.attrs.length = 0;
      expect(calc(MoveId.HYPNOSIS)).toBe(60);
      ability.attrs.push(original);
      const withOriginal = [calc(MoveId.HYPNOSIS), calc(MoveId.SING), calc(MoveId.TACKLE)];
      ability.attrs.length = 0;
      ability.attrs.push(rebuilt);
      const withRebuilt = [calc(MoveId.HYPNOSIS), calc(MoveId.SING), calc(MoveId.TACKLE)];
      expect(withOriginal[0]).toBe(90);
      expect(withRebuilt).toEqual(withOriginal);
      expect(withOriginal[1]).toBe(allMoves[MoveId.SING].accuracy);
    } finally {
      ability.attrs.length = 0;
      ability.attrs.push(...keep);
    }
    expect(game).toBeDefined();
  });

  it("staff can change the number and the move: the rebuilt attr follows the slider and a replaced gate", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("SetMoveAccuracyAbAttr")!;
    const original = attrOf(5065, 0);
    const probe = (attr: SetMoveAccuracyAbAttr, move: MoveId, value: number): { can: boolean; value: number } => {
      const params = { pokemon: holder, move: allMoves[move], accuracy: new NumberHolder(value), simulated: false };
      const can = attr.canApply(params as never);
      if (can) {
        attr.apply(params as never);
      }
      return { can, value: params.accuracy.value };
    };
    // The slider: 75 instead of 90.
    const lower = recomposeAttr(module, original, 5065, 0, { params: { accuracy: 75 } }) as SetMoveAccuracyAbAttr;
    expect(probe(lower, MoveId.HYPNOSIS, 60)).toEqual({ can: true, value: 75 });
    expect(probe(lower, MoveId.HYPNOSIS, 80)).toEqual({ can: false, value: 80 });
    // A replaced gate: "the move is Sing" now lifts Sing and no longer Hypnosis; the residual still applies.
    const swapped = recomposeAttr(module, original, 5065, 0, {
      conds: { gate: { block: "move.is-move", params: { moveId: "SING" } } },
    }) as SetMoveAccuracyAbAttr;
    expect(probe(swapped, MoveId.SING, 55)).toEqual({ can: true, value: 90 });
    expect(probe(swapped, MoveId.HYPNOSIS, 60)).toEqual({ can: false, value: 60 });
    expect(probe(swapped, MoveId.SING, -1)).toEqual({ can: false, value: -1 });
  });
});
