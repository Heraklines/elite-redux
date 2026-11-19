/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B10 chunk 1, OnCritStatBoostLowestAbAttr (Home Run; a package with a once-per-turn memory on the Pokemon).
// The shared L1 grid and L2 twin cannot see the turn memory (a Symbol property on the Pokemon, written by apply), so the rule is
// driven here on the ORIGINAL and on its REBUILD: no crit means no trigger, a crit raises the n lowest stats (stable order, ties
// keep Attack, Defense, Sp. Atk, Sp. Def, Speed), the second crit of the same turn is blocked, a preview does not use the turn up.
import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { OnCritStatBoostLowestAbAttr } from "#data/elite-redux/archetypes/on-crit-stat-boost-lowest";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const module = declRegistry.get("OnCritStatBoostLowestAbAttr") as DeclModule;

function paramsOf(holder: Pokemon, foe: Pokemon, simulated = false): never {
  return {
    pokemon: holder,
    opponent: foe,
    move: allMoves[MoveId.TACKLE],
    damage: 10,
    hitResult: HitResult.EFFECTIVE,
    simulated,
  } as never;
}

/** The turn memory the class writes on the Pokemon object. */
function forgetTurn(holder: Pokemon): void {
  for (const symbol of Object.getOwnPropertySymbols(holder)) {
    if (symbol.description === "OnCritStatBoostLowest.lastTurn") {
      delete (holder as unknown as Record<symbol, unknown>)[symbol];
    }
  }
}

function setStages(holder: Pokemon, stages: Record<number, number>): void {
  for (const [stat, value] of Object.entries(stages)) {
    holder.setStatStage(Number(stat) as never, value);
  }
}

describe("B10: crit boosts the lowest stats (OnCritStatBoostLowestAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const site = () => allAttrSites().find(candidate => candidate.className === "OnCritStatBoostLowestAbAttr")!;

  it("Home Run is the only user and its rebuild is identical", async () => {
    await startWorld(phaserGame);
    const sites = allAttrSites().filter(candidate => candidate.className === "OnCritStatBoostLowestAbAttr");
    expect(sites.map(candidate => candidate.abilityName)).toEqual(["Home Run"]);
    const rebuilt = recomposeAttr(module, sites[0].attr, sites[0].abilityId, sites[0].attrIndex);
    expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(sites[0].attr as never));
  });

  it("original and rebuild trigger only on a crit, raise the three lowest stats in the same order, and only once per turn", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site().attr as unknown as OnCritStatBoostLowestAbAttr;
    const rebuilt = recomposeAttr(
      module,
      site().attr,
      site().abilityId,
      site().attrIndex,
    ) as unknown as OnCritStatBoostLowestAbAttr;
    const queued: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    // stages: Attack +2, Defense 0, Sp. Atk -1, Sp. Def 0, Speed +1  ->  lowest three are Sp. Atk, Defense, Sp. Def
    setStages(holder, { [Stat.ATK]: 2, [Stat.DEF]: 0, [Stat.SPATK]: -1, [Stat.SPDEF]: 0, [Stat.SPD]: 1 });
    const expected = [Stat.SPATK, Stat.DEF, Stat.SPDEF];

    for (const [name, attr] of [
      ["original", original],
      ["rebuild", rebuilt],
    ] as const) {
      forgetTurn(holder);
      queued.length = 0;
      // no crit: the target's first received hit is a normal hit
      foe.turnData.attacksReceived = [{ critical: false } as never];
      expect(attr.canApply(paramsOf(holder, foe)), `${name}: normal hit`).toBe(false);
      // no target at all
      expect(
        attr.canApply({ ...(paramsOf(holder, foe) as object), opponent: undefined } as never),
        `${name}: no target`,
      ).toBe(false);
      // a crit
      foe.turnData.attacksReceived = [{ critical: true } as never];
      expect(attr.canApply(paramsOf(holder, foe)), `${name}: crit`).toBe(true);
      // a preview does nothing and does not use the turn up
      attr.apply(paramsOf(holder, foe, true));
      expect(queued, `${name}: preview`).toEqual([]);
      expect(attr.canApply(paramsOf(holder, foe)), `${name}: after a preview`).toBe(true);
      // the real thing
      attr.apply(paramsOf(holder, foe));
      expect(
        queued.map(call => [call[0], call[2], (call[3] as number[])[0], call[4]]),
        `${name}: queued phases`,
      ).toEqual(expected.map(stat => ["StatStageChangePhase", true, stat, 1]));
      // the second crit of the same turn is blocked, in both
      expect(attr.canApply(paramsOf(holder, foe)), `${name}: second crit this turn`).toBe(false);
    }
  });

  it("the turn memory is shared by the original and the rebuild (one Symbol on the Pokemon), and a new turn frees it", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site().attr as unknown as OnCritStatBoostLowestAbAttr;
    const rebuilt = recomposeAttr(
      module,
      site().attr,
      site().abilityId,
      site().attrIndex,
    ) as unknown as OnCritStatBoostLowestAbAttr;
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    forgetTurn(holder);
    foe.turnData.attacksReceived = [{ critical: true } as never];
    original.apply(paramsOf(holder, foe));
    expect(rebuilt.canApply(paramsOf(holder, foe))).toBe(false);
    const turn = globalScene.currentBattle.turn;
    globalScene.currentBattle.turn = turn + 1;
    try {
      expect(rebuilt.canApply(paramsOf(holder, foe))).toBe(true);
    } finally {
      globalScene.currentBattle.turn = turn;
    }
  });
});
