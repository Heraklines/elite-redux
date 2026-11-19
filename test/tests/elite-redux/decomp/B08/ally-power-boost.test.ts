/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 1, AllyAttackPowerBoostAbAttr. The shared L2 twin cannot reach this attr (it is dispatched only for the
// ALLY of the move's user, in a double battle), and the L1 grid has no recoil move, so the two multipliers are proven
// here on the ORIGINAL attr (Mosh Pit) and on its REBUILD side by side, with a plain move, status moves and recoil
// moves, and with staff-changed multipliers.
import { allMoves } from "#data/data-lists";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const MOSH_PIT = 5376;

describe("B08: Mosh Pit power boost (AllyAttackPowerBoostAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const moves: readonly [MoveId, string][] = [
    [MoveId.TACKLE, "plain damaging move"],
    [MoveId.EMBER, "plain special move"],
    [MoveId.SWORDS_DANCE, "status move"],
    [MoveId.GROWL, "status move aimed at the foe"],
    [MoveId.DOUBLE_EDGE, "recoil move"],
    [MoveId.BRAVE_BIRD, "recoil move"],
    [MoveId.TAKE_DOWN, "recoil move"],
  ];

  async function powerAfter(
    attr: ReturnType<typeof recomposeAttr>,
    move: MoveId,
    world: Awaited<ReturnType<typeof startWorld>>,
  ): Promise<number> {
    const power = new NumberHolder(allMoves[move].power);
    const params = { pokemon: world.holder, opponent: world.foe, move: allMoves[move], power, simulated: false };
    if (attr.canApply(params as never)) {
      attr.apply(params as never);
    }
    return power.value;
  }

  it("the original and the rebuild leave the same power for every kind of move, and the numbers are the documented ones", async () => {
    const world = await startWorld(phaserGame);
    const site = allAttrSites().find(s => s.abilityId === MOSH_PIT && s.className === "AllyAttackPowerBoostAbAttr");
    expect(site).toBeDefined();
    expect(liveAbility(MOSH_PIT).attrs[0]).toBe(site!.attr);
    const rebuilt = recomposeAttr(declRegistry.get("AllyAttackPowerBoostAbAttr")!, site!.attr, MOSH_PIT, 0);
    let boosted = 0;
    let recoilBoosted = 0;
    let skipped = 0;
    for (const [move, what] of moves) {
      const base = allMoves[move].power;
      const original = await powerAfter(site!.attr, move, world);
      const library = await powerAfter(rebuilt, move, world);
      expect(library, `${what} (${MoveId[move]})`).toBe(original);
      const recoil = allMoves[move].hasAttr("RecoilAttr");
      if (allMoves[move].category === MoveCategory.STATUS) {
        expect(original, `${MoveId[move]} is a status move`).toBe(base);
        skipped++;
      } else {
        expect(original, MoveId[move]).toBeCloseTo(base * (recoil ? 1.5 : 1.25), 10);
        boosted++;
        recoilBoosted += recoil ? 1 : 0;
      }
    }
    // The list really did contain status moves, recoil moves and plain ones, so every branch of apply was reached.
    expect(skipped).toBeGreaterThan(0);
    expect(recoilBoosted).toBeGreaterThan(0);
    expect(boosted - recoilBoosted).toBeGreaterThan(0);
  });

  it("staff-chosen multipliers move the compiled attr: a fresh build with 2 and 3 doubles plain moves and triples recoil moves", async () => {
    const world = await startWorld(phaserGame);
    const module = declRegistry.get("AllyAttackPowerBoostAbAttr")!;
    const built = buildAttr(module, { baseMultiplier: 2, recoilMultiplier: 3 }) as ReturnType<typeof recomposeAttr>;
    expect(await powerAfter(built, MoveId.TACKLE, world)).toBe(allMoves[MoveId.TACKLE].power * 2);
    expect(await powerAfter(built, MoveId.DOUBLE_EDGE, world)).toBe(allMoves[MoveId.DOUBLE_EDGE].power * 3);
    expect(allMoves[MoveId.SWORDS_DANCE].category).toBe(MoveCategory.STATUS);
    expect(await powerAfter(built, MoveId.SWORDS_DANCE, world)).toBe(allMoves[MoveId.SWORDS_DANCE].power);
  });
});
