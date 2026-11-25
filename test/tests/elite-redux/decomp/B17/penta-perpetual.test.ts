/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2, part 1 (Penta-Punch and Perpetual Motion): what the shared L1 grid and the L2 twins cannot see. The grid has no
// Elite Redux move axis, no hit-result axis, no queued-follow-up marker and no chain state, and the my-move-starts trigger has no
// L1 builder. Every test compares the class (after its gate/residual split) with a copy of its OLD canApply / apply written from
// the pre-split source, and the rebuilt attr (library gate from bindings.ts) where a binding exists, and shows a deliberately
// wrong gate being caught.
import { allMoves } from "#data/data-lists";
import {
  PentaPunchFuryPowerAbAttr,
  type PerpetualMotionPostTurnAbAttr,
  type PerpetualMotionResolutionAbAttr,
  type PerpetualMotionTriggerAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { compileCondition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { ErMoveId } from "#enums/er-move-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const PENTA_PUNCH = 6015;
const PERPETUAL_MOTION = 6022;
const TRIGGER_MARKER = "perpetual-motion:trigger";

function site(abilityId: number, className: string) {
  const found = allAttrSites().find(s => s.abilityId === abilityId && s.className === className);
  if (found === undefined) {
    throw new Error(`${className} is not an attr of ability ${abilityId}`);
  }
  return found;
}

function rebuildOf(abilityId: number, className: string) {
  const s = site(abilityId, className);
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  return { original: s.attr, rebuilt: recomposeAttr(module!, s.attr, abilityId, s.attrIndex), module: module! };
}

describe("B17 chunk 2: Penta-Punch and Perpetual Motion", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Penta-Punch: the power is a SET for Five-Star Fury only, the number is a typed setting, and the library cannot name the move yet (request R10)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site(PENTA_PUNCH, "PentaPunchFuryPowerAbAttr").attr as PentaPunchFuryPowerAbAttr;
    expect(original.power).toBe(80);
    const fury = allMoves[ErMoveId.FIVE_STAR_FURY as unknown as MoveId];
    expect(fury, "Five-Star Fury is a registered move").toBeDefined();
    const frame = (move: unknown, power: number) => ({
      pokemon: holder,
      opponent: foe,
      move,
      power: new NumberHolder(power),
      simulated: false,
    });
    // The OLD canApply: `move.id === ErMoveId.FIVE_STAR_FURY`.
    let fires = 0;
    for (const move of [fury, allMoves[MoveId.TACKLE], allMoves[MoveId.EMBER], allMoves[MoveId.SPLASH]]) {
      const expected = move.id === (ErMoveId.FIVE_STAR_FURY as unknown as MoveId);
      fires += expected ? 1 : 0;
      expect(original.canApply(frame(move, 50) as never), `canApply for ${move.name}`).toBe(expected);
    }
    expect(fires).toBe(1);
    // apply SETS the power (it does not multiply), and the setting is the constructor argument.
    const shipped = frame(fury, 130);
    original.apply(shipped as never);
    expect(shipped.power.value).toBe(80);
    const custom = new PentaPunchFuryPowerAbAttr(100);
    const changed = frame(fury, 130);
    custom.apply(changed as never);
    expect(changed.power.value).toBe(100);
    // The typed setting rebuilds the class with another power.
    const module = declRegistry.get("PentaPunchFuryPowerAbAttr")!;
    const built = buildAttr(module, { power: 120 }, { gate: { block: "move.damaging" } }) as PentaPunchFuryPowerAbAttr;
    expect(built.power).toBe(120);
    // The library atom now resolves a name in MoveId first and ErMoveId second (librarian pass B19, request R10), so
    // Five-Star Fury can be named; the gate binding itself stays legacy until the completion pass rebinds it.
    const furyGate = compileCondition({ block: "move.is-move", params: { moveId: "FIVE_STAR_FURY" } });
    expect(furyGate({ holder: {} as never, move: { id: 5156 } as never, simulated: true })).toBe(true);
    expect(furyGate({ holder: {} as never, move: { id: MoveId.TACKLE } as never, simulated: true })).toBe(false);
  });

  it("Perpetual Motion Trigger: old canApply (damaging, hit landed, not the queued follow-up) over every hit result, move and marker", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site(PERPETUAL_MOTION, "PerpetualMotionTriggerAbAttr").attr as PerpetualMotionTriggerAbAttr;
    const queued = scriptedPokemonMove(MoveId.ROLLOUT, 20, { marker: "perpetual-motion" }).getMove();
    const otherMarker = scriptedPokemonMove(MoveId.ROLLOUT, 20, { marker: "something-else" }).getMove();
    const moves = [
      allMoves[MoveId.TACKLE],
      allMoves[MoveId.EMBER],
      allMoves[MoveId.SPLASH],
      allMoves[MoveId.SWORDS_DANCE],
      allMoves[MoveId.ROLLOUT],
      queued,
      otherMarker,
    ];
    const hits = [
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
      HitResult.NO_EFFECT,
      HitResult.MISS,
      HitResult.FAIL,
      HitResult.STATUS,
      HitResult.INDIRECT,
    ];
    const landed = new Set([
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
    ]);
    let fires = 0;
    let blockedByMarker = 0;
    for (const move of moves) {
      for (const hitResult of hits) {
        const params = { pokemon: holder, opponent: foe, move, damage: 5, hitResult, simulated: false };
        const hasMarker = move.attrs.some(
          a =>
            a.constructor.name === "ScriptedMoveMarkerAttr"
            && (a as never as { key: string }).key === "perpetual-motion",
        );
        const expected = move.category !== 2 && landed.has(hitResult) && !hasMarker;
        fires += expected ? 1 : 0;
        blockedByMarker += move.category !== 2 && landed.has(hitResult) && hasMarker ? 1 : 0;
        expect(original.canApply(params as never), `${move.name} ${HitResult[hitResult]}`).toBe(expected);
      }
    }
    expect(fires, "the grid reaches the firing case").toBeGreaterThan(0);
    expect(blockedByMarker, "the grid reaches the queued follow-up case").toBeGreaterThan(0);
  });

  it("Perpetual Motion Trigger: apply marks the turn once and never for a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site(PERPETUAL_MOTION, "PerpetualMotionTriggerAbAttr").attr as PerpetualMotionTriggerAbAttr;
    const params = (simulated: boolean) => ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      damage: 5,
      hitResult: HitResult.EFFECTIVE,
      simulated,
    });
    holder.turnData.erAbilityProvenance = [];
    original.apply(params(true) as never);
    expect(holder.turnData.erAbilityProvenance).toEqual([]);
    original.apply(params(false) as never);
    original.apply(params(false) as never);
    expect(holder.turnData.erAbilityProvenance).toEqual([TRIGGER_MARKER]);
  });

  it("Perpetual Motion End of turn: old canApply (alive, out a turn, marker) for the class, the rebuilt gate and a wrong gate", async () => {
    const { holder } = await startWorld(phaserGame);
    const { original, rebuilt, module } = rebuildOf(PERPETUAL_MOTION, "PerpetualMotionPostTurnAbAttr");
    const wrong = buildAttr(
      module,
      { power: 20 },
      { gate: { block: "time.turn-count", params: { cmp: "gte", n: 2 } } },
    );
    let fires = 0;
    let wrongDiffers = false;
    for (const fainted of [false, true]) {
      for (const turnCount of [0, 1, 2, 5]) {
        for (const marked of [false, true]) {
          // A stand-in models exactly what the class and the library gate read.
          const mon = {
            isFainted: () => fainted,
            tempSummonData: { turnCount },
            turnData: { erAbilityProvenance: marked ? [TRIGGER_MARKER] : [] },
          } as unknown as Pokemon;
          const params = { pokemon: mon, simulated: false };
          // The OLD canApply: !isFainted && (turnCount ?? 0) > 0 && marker present.
          const expected = !fainted && turnCount > 0 && marked;
          fires += expected ? 1 : 0;
          const label = `fainted ${fainted}, turn ${turnCount}, marked ${marked}`;
          expect(original.canApply(params as never), `class, ${label}`).toBe(expected);
          expect(rebuilt.canApply(params as never), `rebuilt from the library gate, ${label}`).toBe(expected);
          wrongDiffers ||= wrong.canApply(params as never) !== expected;
        }
      }
    }
    expect(fires).toBeGreaterThan(0);
    expect(wrongDiffers, "a gate for two turns is caught by this test").toBe(true);
    // A real holder that was just sent out has turnCount 0, so the gate blocks even with a marker.
    holder.turnData.erAbilityProvenance = [TRIGGER_MARKER];
    expect(original.canApply({ pokemon: holder, simulated: false } as never)).toBe(
      (holder.tempSummonData?.turnCount ?? 0) > 0,
    );
  });

  it("Perpetual Motion End of turn: apply uses the marker up, queues the Rollout, resets a pending streak, and does nothing for a preview", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const original = site(PERPETUAL_MOTION, "PerpetualMotionPostTurnAbAttr").attr as PerpetualMotionPostTurnAbAttr;
    const queued: unknown[][] = [];
    vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    const run = (simulated: boolean) => original.apply({ pokemon: holder, simulated } as never);

    // Preview: nothing changes, the marker stays.
    holder.turnData.erAbilityProvenance = [TRIGGER_MARKER];
    run(true);
    expect(holder.turnData.erAbilityProvenance).toEqual([TRIGGER_MARKER]);
    expect(queued).toEqual([]);

    // Real: the marker is used up, the Rollout is queued at the first living foe with power 20, indirect, with the chain marker.
    holder.summonData.erPerpetualMotionPending = false;
    holder.summonData.erPerpetualMotionStreak = 4;
    run(false);
    expect(holder.turnData.erAbilityProvenance).toEqual([]);
    expect(queued).toHaveLength(1);
    const [name, user, targets, move, useMode] = queued[0] as [
      string,
      Pokemon,
      number[],
      { getMove: () => never; moveId: MoveId },
      MoveUseMode,
    ];
    expect(name).toBe("MovePhase");
    expect(user).toBe(holder);
    expect(targets).toEqual([foe.getBattlerIndex()]);
    expect(move.moveId).toBe(MoveId.ROLLOUT);
    expect(useMode).toBe(MoveUseMode.INDIRECT);
    const rolloutAttrs = (move.getMove() as { attrs: { constructor: { name: string }; key?: string }[] }).attrs;
    expect(
      rolloutAttrs.some(a => a.constructor.name === "ScriptedMoveMarkerAttr" && a.key === "perpetual-motion"),
    ).toBe(true);
    expect((move.getMove() as { power: number }).power).toBe(20);
    expect(holder.summonData.erPerpetualMotionPending).toBe(true);
    // The streak is kept when the chain was not already pending.
    expect(holder.summonData.erPerpetualMotionStreak).toBe(4);

    // A second round with the chain still pending resets the streak first.
    holder.turnData.erAbilityProvenance = [TRIGGER_MARKER];
    run(false);
    expect(holder.summonData.erPerpetualMotionStreak).toBe(0);
    expect(queued).toHaveLength(2);

    // No marker: nothing at all.
    run(false);
    expect(queued).toHaveLength(2);

    // No living foe: the marker is still used up (recorded oddity), nothing is queued.
    holder.turnData.erAbilityProvenance = [TRIGGER_MARKER];
    vi.spyOn(holder, "getOpponents").mockReturnValue([]);
    run(false);
    expect(holder.turnData.erAbilityProvenance).toEqual([]);
    expect(queued).toHaveLength(2);

    // The typed power is the constructor argument.
    const module = declRegistry.get("PerpetualMotionPostTurnAbAttr")!;
    const custom = buildAttr(
      module,
      { power: 55 },
      { gate: { block: "time.turn-count", params: { cmp: "gte", n: 1 } } },
    );
    expect((custom as PerpetualMotionPostTurnAbAttr).power).toBe(55);
  });

  it("Perpetual Motion Resolution: old rule (Rollout, chain pending, indirect, not a success) for the class and the library gate; a wrong gate is caught", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = site(PERPETUAL_MOTION, "PerpetualMotionResolutionAbAttr").attr as PerpetualMotionResolutionAbAttr;
    const module = declRegistry.get("PerpetualMotionResolutionAbAttr")!;
    const library = buildAttr(
      module,
      {},
      { gate: { block: "time.last-move", params: { who: "holder", moveId: "ROLLOUT" } } },
    ) as PerpetualMotionResolutionAbAttr;
    const wrong = buildAttr(
      module,
      {},
      { gate: { block: "time.last-move", params: { who: "holder", moveId: "TACKLE" } } },
    ) as PerpetualMotionResolutionAbAttr;
    const history = (move: MoveId | undefined, useMode: MoveUseMode, result: MoveResult) =>
      move === undefined ? [] : [{ move, targets: [], useMode, result }];
    const lasts: { label: string; moves: ReturnType<typeof history> }[] = [
      { label: "no move yet", moves: history(undefined, MoveUseMode.NORMAL, MoveResult.SUCCESS) },
      { label: "Tackle", moves: history(MoveId.TACKLE, MoveUseMode.NORMAL, MoveResult.FAIL) },
      { label: "own Rollout that failed", moves: history(MoveId.ROLLOUT, MoveUseMode.NORMAL, MoveResult.FAIL) },
      { label: "queued Rollout that failed", moves: history(MoveId.ROLLOUT, MoveUseMode.INDIRECT, MoveResult.FAIL) },
      { label: "queued Rollout that missed", moves: history(MoveId.ROLLOUT, MoveUseMode.INDIRECT, MoveResult.MISS) },
      { label: "queued Rollout that worked", moves: history(MoveId.ROLLOUT, MoveUseMode.INDIRECT, MoveResult.SUCCESS) },
    ];
    let resets = 0;
    let wrongDiffers = false;
    for (const { label, moves } of lasts) {
      for (const pending of [false, true]) {
        const resultOf = (attr: PerpetualMotionResolutionAbAttr, simulated: boolean): [boolean, number] => {
          holder.summonData.moveHistory = [...moves] as never;
          holder.summonData.erPerpetualMotionPending = pending;
          holder.summonData.erPerpetualMotionStreak = 3;
          attr.apply({ pokemon: holder, simulated } as never);
          return [holder.summonData.erPerpetualMotionPending, holder.summonData.erPerpetualMotionStreak];
        };
        // The OLD rule, in apply: !simulated && last move is Rollout && pending && indirect && result !== SUCCESS.
        const last = moves[0];
        const shouldReset =
          last?.move === MoveId.ROLLOUT
          && pending
          && last.useMode === MoveUseMode.INDIRECT
          && last.result !== MoveResult.SUCCESS;
        resets += shouldReset ? 1 : 0;
        const expected: [boolean, number] = shouldReset ? [false, 0] : [pending, 3];
        expect(resultOf(original, false), `class, ${label}, pending ${pending}`).toEqual(expected);
        expect(resultOf(library, false), `library gate, ${label}, pending ${pending}`).toEqual(expected);
        expect(resultOf(original, true), `preview changes nothing, ${label}, pending ${pending}`).toEqual([pending, 3]);
        wrongDiffers ||= JSON.stringify(resultOf(wrong, false)) !== JSON.stringify(expected);
        // canApply is the inherited true, whatever the state (the gate lives in apply).
        expect(original.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
      }
    }
    expect(resets).toBeGreaterThan(0);
    expect(wrongDiffers, "a gate for the wrong move is caught by this test").toBe(true);
  });
});
