/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Proof that the harness detects drift. Each case takes a faithful rebuild (which must pass: the
// control) and then deliberately alters it, and the harness must say so:
//
//   changed param          caught by L1 identity, L1 attr differential and the L2 twin
//   dropped condition      caught by L1 predicate differential (altered binding), L1 attr differential, L2 twin
//   boundary-blind binding caught by the L1 grid only because it lands on 99% HP
//   reordered RNG draw     caught by L2 (random draw count / order), invisible to a pure result comparison
//
// The abilities are real: Multiscale (spec 3.2) and two composition abilities that differ only in
// the order of an HP test and a dice roll.
import { allAbilities } from "#data/data-lists";
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
import {
  registerCompositionAbility,
  rule,
  unregisterCompositionAbilities,
} from "#test/tests/elite-redux/decomp/harness/blueprints";
import {
  bindingCases,
  checkIdentity,
  runAttrDifferential,
  runPredicateDifferential,
} from "#test/tests/elite-redux/decomp/harness/differential";
import {
  bindMultiscale,
  MULTISCALE_ID,
  multiscaleRegistry,
  restoreBindings,
} from "#test/tests/elite-redux/decomp/harness/fixtures";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import {
  allocateShadowId,
  describeTwinFailure,
  liveAbility,
  type TwinScenario,
  twinById,
} from "#test/tests/elite-redux/decomp/harness/twin";
import { buildStateGrid } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const scenario = (axes: Record<string, string | number>): TwinScenario => ({
  template: TEMPLATES["foe-hits-holder"],
  axes,
  label: `foe hits holder: ${JSON.stringify(axes)}`,
});

describe("harness self-test: a deliberately altered rebuild is caught", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    restoreBindings();
    unregisterShadows();
    unregisterCompositionAbilities();
  });

  const multiscaleSite = () => allAttrSites().find(s => s.abilityId === MULTISCALE_ID && s.attrIndex === 0)!;

  describe("L1", () => {
    it("control: the faithful rebuild passes identity", () => {
      bindMultiscale();
      expect(
        checkIdentity(multiscaleSite(), multiscaleRegistry().get("ReceivedMoveDamageMultiplierAbAttr")!).outcome,
      ).toBe("identical");
    });

    it("a changed param (x0.5 became x0.6) is caught by identity", () => {
      bindMultiscale();
      const result = checkIdentity(multiscaleSite(), multiscaleRegistry().get("ReceivedMoveDamageMultiplierAbAttr")!, {
        params: { multiplier: 0.6 },
      });
      expect(result.outcome).toBe("different");
      expect(result.why.join(" ")).toContain("0.6");
    });

    it("a changed param is caught by the attr differential (the damage left behind differs)", async () => {
      bindMultiscale();
      const world = await startWorld(phaserGame);
      const site = multiscaleSite();
      const registry = multiscaleRegistry();
      const altered = runAttrDifferential(world, [site], registry, buildStateGrid(), 5, (_site, module) =>
        buildAttr(module, { multiplier: 0.6 }, { "ctor:0": { block: "hp.full", params: { who: "holder" } } }),
      );
      expect(altered.mismatches.length).toBeGreaterThan(0);
      expect(altered.mismatches[0].message).toContain("the value apply leaves behind");
    });

    it("a dropped condition (always-true closure) is caught by the attr differential at 1 HP below full", async () => {
      bindMultiscale();
      const world = await startWorld(phaserGame);
      const registry = multiscaleRegistry();
      const altered = runAttrDifferential(
        world,
        [multiscaleSite()],
        registry,
        buildStateGrid(["max-1"]),
        5,
        (_site, module) => buildAttr(module, {}, { "ctor:0": (() => true) as never }),
      );
      expect(altered.mismatches.length).toBeGreaterThan(0);
      expect(altered.mismatches[0].message).toContain("canApply is false for the original but true for the rebuild");
    });

    it("control: the faithful binding passes the predicate differential", async () => {
      bindMultiscale();
      const world = await startWorld(phaserGame);
      const { cases } = bindingCases([multiscaleSite()], multiscaleRegistry());
      expect(runPredicateDifferential(world, cases, buildStateGrid(["max", "max-1", 1])).mismatches).toEqual([]);
    });

    it("a binding with the wrong condition is caught by the predicate differential", async () => {
      bindMultiscale({ id: "move.damaging" });
      const world = await startWorld(phaserGame);
      const { cases } = bindingCases([multiscaleSite()], multiscaleRegistry());
      const result = runPredicateDifferential(world, cases, buildStateGrid(["max-1"]));
      expect(result.mismatches.length).toBeGreaterThan(0);
      expect(result.mismatches[0].message).toContain("Multiscale");
    });

    it("a boundary-blind binding (HP >= 99% instead of full HP) is caught only because the grid lands on 99% HP", async () => {
      bindMultiscale({ id: "hp.at-least", who: "holder", pct: 99, rounding: "exact" });
      const world = await startWorld(phaserGame);
      const { cases } = bindingCases([multiscaleSite()], multiscaleRegistry());
      const result = runPredicateDifferential(world, cases, buildStateGrid());
      expect(result.mismatches.length).toBeGreaterThan(0);
      expect(new Set(result.mismatches.map(m => m.state))).toContain("holder hp 99%");
      // The same binding evaluated only at full HP looks perfect, which is exactly why the grid matters.
      const fullOnly = runPredicateDifferential(
        world,
        cases,
        buildStateGrid().filter(s => s.name === "holder hp max"),
      );
      expect(fullOnly.mismatches).toEqual([]);
    });
  });

  describe("L2", () => {
    it("control: Multiscale rebuilt from its own blocks behaves identically at full HP and one HP below", async () => {
      bindMultiscale();
      const registry = multiscaleRegistry();
      const original = liveAbility(MULTISCALE_ID);
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(original, shadowId, { registry });
      expect(rebuilt.rebuilt).toEqual([0]);
      registerShadow(shadowId, rebuilt.ability);
      for (const axes of [{ hp: "max" }, { hp: "max-1" }, { hp: 10 }]) {
        const outcome = await twinById(phaserGame, MULTISCALE_ID, shadowId, scenario(axes));
        expect(outcome.differences, describeTwinFailure("Multiscale", outcome)).toEqual([]);
        expect(outcome.original.snapshots.length).toBeGreaterThan(2);
      }
    });

    it("a changed param is caught by the twin (the damage taken differs)", async () => {
      bindMultiscale();
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(liveAbility(MULTISCALE_ID), shadowId, {
        registry: multiscaleRegistry(),
        overrides: { 0: { params: { multiplier: 0.9 } } },
      });
      registerShadow(shadowId, rebuilt.ability);
      const outcome = await twinById(phaserGame, MULTISCALE_ID, shadowId, scenario({ hp: "max" }));
      expect(outcome.differences.length).toBeGreaterThan(0);
      expect(outcome.differences.map(d => d.part).join()).toContain("snapshot:turn 1");
      expect(outcome.differences.map(d => d.message).join(" ")).toContain("player.0.hp");
    });

    it("a dropped condition is caught by the twin exactly when the condition starts to matter", async () => {
      bindMultiscale();
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(liveAbility(MULTISCALE_ID), shadowId, {
        registry: multiscaleRegistry(),
        overrides: { 0: { conds: { "ctor:0": (() => true) as never } } },
      });
      registerShadow(shadowId, rebuilt.ability);
      // Starting at full HP the first hit is identical (both halve it); the second hit lands on a
      // wounded holder, where the original no longer halves and the altered rebuild still does.
      const atFull = await twinById(phaserGame, MULTISCALE_ID, shadowId, scenario({ hp: "max" }));
      const parts = atFull.differences.map(d => d.part);
      expect(parts).not.toContain("snapshot:turn 1");
      expect(parts).toContain("snapshot:turn 2");
      // Starting one HP below full the very first hit already differs.
      const belowFull = await twinById(phaserGame, MULTISCALE_ID, shadowId, scenario({ hp: "max-1" }));
      expect(belowFull.differences.map(d => d.part)).toContain("snapshot:turn 1");
    });

    it("an attr dropped from the rebuild is caught by the twin and by the ability identity", async () => {
      bindMultiscale();
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(liveAbility(MULTISCALE_ID), shadowId, {
        registry: multiscaleRegistry(),
        drop: [0],
      });
      expect(rebuilt.ability.attrs).toHaveLength(0);
      registerShadow(shadowId, rebuilt.ability);
      const outcome = await twinById(phaserGame, MULTISCALE_ID, shadowId, scenario({ hp: "max" }));
      expect(outcome.differences.length).toBeGreaterThan(0);
    });

    it("a reordered RNG draw is caught by the twin through the draw count, and an identical order is not", async () => {
      const halfThenDice = rule(
        "hp-then-dice",
        "event.after-hit",
        [
          { block: "hp.full", params: { who: "holder" } },
          { block: "rng.chance", params: { pct: 50 } },
        ],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
      );
      const diceThenHalf = rule(
        "dice-then-hp",
        "event.after-hit",
        [
          { block: "rng.chance", params: { pct: 50 } },
          { block: "hp.full", params: { who: "holder" } },
        ],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
      );
      const a = registerCompositionAbility("Order A", [halfThenDice]);
      const sameAsA = registerCompositionAbility("Order A", [halfThenDice]);
      const b = registerCompositionAbility("Order A", [diceThenHalf]);
      expect(allAbilities[a]).toBeDefined();

      // Control: same order, same everything.
      const control = await twinById(phaserGame, a, sameAsA, scenario({ hp: "max-1" }));
      expect(control.differences, describeTwinFailure("Order A", control)).toEqual([]);

      // Sanity (the harness must not cry wolf): swapping two tests that never roll dice is invisible.
      const pureA = registerCompositionAbility("Pure order", [
        rule(
          "pure-a",
          "event.after-hit",
          [{ block: "hp.full", params: { who: "holder" } }, { block: "move.damaging" }],
          [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
        ),
      ]);
      const pureB = registerCompositionAbility("Pure order", [
        rule(
          "pure-b",
          "event.after-hit",
          [{ block: "move.damaging" }, { block: "hp.full", params: { who: "holder" } }],
          [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
        ),
      ]);
      const pure = await twinById(phaserGame, pureA, pureB, scenario({ hp: "max-1" }));
      expect(pure.differences, describeTwinFailure("Pure order", pure)).toEqual([]);

      // The hit leaves the holder wounded, so the first order's HP test fails first and never rolls,
      // while the second order rolls first. Same result on paper, different dice.
      const drift = await twinById(phaserGame, a, b, scenario({ hp: "max-1" }));
      expect(drift.differences.length).toBeGreaterThan(0);
      expect(drift.differences[0].part).toBe("rng-count");
      expect(drift.differences[0].message).toMatch(/drew \d+ times, the rebuild \d+ times/);
      expect(drift.rebuild.rngCalls).toBeGreaterThan(drift.original.rngCalls);
    });

    it("the twin is deterministic: the same ability twice with the same seed has an empty diff, a different seed does not hide it", async () => {
      const dice = rule(
        "dice",
        "event.after-hit",
        [{ block: "rng.chance", params: { pct: 50 } }],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
      );
      const a = registerCompositionAbility("Dice", [dice]);
      const same = await twinById(phaserGame, a, a, scenario({ hp: "max" }), { seed: "seed-one" });
      expect(same.differences).toEqual([]);
      const seedOne = await twinById(phaserGame, a, a, scenario({ hp: "max" }), { seed: "seed-one" });
      const seedTwo = await twinById(phaserGame, a, a, scenario({ hp: "max" }), { seed: "seed-two" });
      expect(seedOne.original.rngLog).toEqual(same.original.rngLog);
      expect(seedTwo.original.snapshots.length).toBe(seedOne.original.snapshots.length);
    });
  });
});
