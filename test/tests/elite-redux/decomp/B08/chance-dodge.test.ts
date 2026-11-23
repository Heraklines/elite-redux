/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { normalizeBindingSpec } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
// B08 chunk 1, ChanceDodgeAbAttr (Ole!). Two things the shared L1 grid and L2 twin cannot show:
//   1. the rebuild equals the original, draw for draw, for single-target, spread and status moves and for both rolls;
//   2. NOTHING dispatches the class: a real battle with the ability on the holder never calls canApply (suspected game
//      bug, recorded in the declaration's notes and NOT fixed here).
import { ChanceDodgeAbAttr } from "#data/elite-redux/archetypes/chance-dodge";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const OLE = 5304;

describe("B08: Ole! (ChanceDodgeAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the rebuild and the original agree on canApply, the random draws and the effect of apply", async () => {
    const world = await startWorld(phaserGame);
    const { game, holder, foe } = world;
    const site = allAttrSites().find(s => s.abilityId === OLE && s.className === "ChanceDodgeAbAttr");
    expect(site).toBeDefined();
    const rebuilt = recomposeAttr(declRegistry.get("ChanceDodgeAbAttr")!, site!.attr, OLE, 0);
    const moves = [MoveId.TACKLE, MoveId.SURF, MoveId.EARTHQUAKE, MoveId.GROWL, MoveId.SPLASH, MoveId.SWORDS_DANCE];
    let trueCount = 0;
    for (const attacker of ["foe", "holder"] as const) {
      for (const roll of ["low", "high"] as const) {
        for (const move of moves) {
          const observe = (attr: ChanceDodgeAbAttr) => {
            const draws: number[] = [];
            const spy = vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
              draws.push(range);
              return roll === "low" ? min : min + range - 1;
            });
            const typeMultiplier = new NumberHolder(1);
            const cancelled = new BooleanHolder(false);
            const params = {
              pokemon: holder,
              opponent: attacker === "foe" ? foe : holder,
              move: allMoves[move],
              typeMultiplier,
              cancelled,
              simulated: false,
            };
            const can = attr.canApply(params as never);
            if (can) {
              attr.apply(params as never);
            }
            spy.mockRestore();
            return { can, draws, typeMultiplier: typeMultiplier.value, cancelled: cancelled.value };
          };
          const original = observe(site!.attr as ChanceDodgeAbAttr);
          const library = observe(rebuilt as ChanceDodgeAbAttr);
          expect(library, `${MoveId[move]} from the ${attacker}, ${roll} roll`).toEqual(original);
          trueCount += original.can ? 1 : 0;
          if (original.can) {
            expect(original.typeMultiplier).toBe(0);
            expect(original.cancelled).toBe(true);
          }
        }
      }
    }
    // A low roll at 20% dodges a single-target attack from the foe: the true branch really was reached.
    expect(trueCount).toBeGreaterThan(0);
  });

  it("the settings reach the compiled attr: 100% dodges a spread attack only when 'single target only' is off", async () => {
    const world = await startWorld(phaserGame);
    const module = declRegistry.get("ChanceDodgeAbAttr")!;
    const run = (attr: ChanceDodgeAbAttr, move: MoveId): boolean =>
      attr.canApply({
        pokemon: world.holder,
        opponent: world.foe,
        move: allMoves[move],
        typeMultiplier: new NumberHolder(1),
        cancelled: new BooleanHolder(false),
        simulated: false,
      } as never);
    // The single-target test is the first atom of the gate, the roll the last: Ole!'s own binding with the chance at 100, and
    // the same without the target test.
    const singleAims = ["one adjacent Pokemon", "one other Pokemon, any distance", "one adjacent foe", "the foe's side of the field"];
    const target = { any: singleAims.map(aim => ({ id: "move.aimed-at", target: aim })) };
    const onlySingle = buildAttr(
      module,
      { chance: 100, singleTargetOnly: true },
      { gate: normalizeBindingSpec({ all: [target, { id: "rng.chance", pct: 100 }] }) },
    ) as ChanceDodgeAbAttr;
    const any = buildAttr(
      module,
      { chance: 100, singleTargetOnly: false },
      { gate: normalizeBindingSpec({ id: "rng.chance", pct: 100 }) },
    ) as ChanceDodgeAbAttr;
    expect(run(onlySingle, MoveId.SURF)).toBe(false);
    expect(run(any, MoveId.SURF)).toBe(true);
    expect(run(onlySingle, MoveId.TACKLE)).toBe(true);
    // A status move is never dodged, whatever the setting.
    expect(run(any, MoveId.GROWL)).toBe(false);
  });

  it("SUSPECTED GAME BUG: a real battle never asks the attr (Ole! has no effect today)", async () => {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(OLE as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    expect(holder.getAbility().id).toBe(OLE);
    expect(holder.getAbility().attrs.some(attr => attr instanceof ChanceDodgeAbAttr)).toBe(true);
    const canApply = vi.spyOn(ChanceDodgeAbAttr.prototype, "canApply");
    const startHp = holder.hp;
    for (let turn = 0; turn < 3; turn++) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
    }
    expect(holder.hp).toBeLessThan(startHp);
    expect(canApply).not.toHaveBeenCalled();
    canApply.mockRestore();
  });
});
