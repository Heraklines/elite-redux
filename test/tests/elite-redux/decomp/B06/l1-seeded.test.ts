/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 1: the shared L1 differential (harness/l1.test.ts), run for this chunk's classes with the GLOBAL random stream pinned.
//
// Why a copy: the stock differential compares `attr.getCondition()` of the original and of the rebuild, and pins only
// `randBattleSeedInt`. Shed Skin, Pattern Change and Wonder Scale carry an attr-level condition `randSeedInt(100) < 30`
// (init-elite-redux-vanilla-rebalance.ts:1268), which draws from the global Phaser stream, so the two sides roll different numbers
// and the stock test reports a mismatch that is only noise (requests/B06.md, R-B06-H1). Here `Phaser.Math.RND.integerInRange` is
// pinned to a constant, once to a value that passes the 30% roll and once to one that fails it, so both branches are compared.
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { bindingCases, runAttrDifferential, runPredicateDifferential } from "#test/tests/elite-redux/decomp/harness/differential";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { buildStateGrid, extraHpValues } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const CLASSES = new Set([
  "PostTurnStatusHealAbAttr",
  "PostTurnResetStatusAbAttr",
  "PostTurnRestoreBerryAbAttr",
  "CudChewRecordBerryAbAttr",
  "MoodyAbAttr",
  "SpeedBoostAbAttr",
  "PostTurnFormChangeAbAttr",
]);

describe("B06 L1 differential with the global random stream pinned", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it(
    "every binding and every rebuilt attr agrees with its original, with the 30% roll always passing and always failing",
    async () => {
      const sites = allAttrSites().filter(site => CLASSES.has(site.className));
      expect(sites.length).toBeGreaterThan(0);
      const { cases, problems } = bindingCases(sites, declRegistry);
      const probeAxes = declRegistry.all().flatMap(module => (module.decl.probes ?? []).map(probe => probe.axes));
      const states = buildStateGrid(extraHpValues(probeAxes));
      const world = await startWorld(phaserGame);
      const rnd = Phaser.Math.RND;
      const realInteger = rnd.integerInRange.bind(rnd);
      const spy = vi.spyOn(rnd, "integerInRange");
      expect(problems.map(p => p.message)).toEqual([]);
      for (const pinned of [0, 99]) {
        // Only the 0..99 roll (randSeedInt(100)) is pinned; every other draw (the speed-order tie shuffle) stays real.
        spy.mockImplementation((min: number, max: number) => (min === 0 && max === 99 ? pinned : realInteger(min, max)));
        const predicate = runPredicateDifferential(world, cases, states);
        const attr = runAttrDifferential(world, sites, declRegistry, states, 100);
        console.log(
          `B06_L1 pinned=${pinned} bindings=${cases.length} states=${states.length} attrEvals=${attr.evaluations} noParamBuilder=${attr.noBuilder.length}`,
        );
        expect(predicate.mismatches.map(m => m.message)).toEqual([]);
        expect(attr.mismatches.map(m => m.message)).toEqual([]);
        expect(attr.noBuilder.map(site => site.abilityName)).toEqual([]);
      }
    },
    10 * 60 * 1000,
  );
});
