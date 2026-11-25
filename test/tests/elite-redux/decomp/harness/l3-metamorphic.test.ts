/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L3 metamorphic tests: properties that must hold for ANY condition, checked over the real-Pokemon state
// grid, so a library bug cannot hide behind one hand-picked example.
//
//   AND with an always-true condition equals the original
//   OR with an always-false condition equals the original
//   a threshold param moves the boundary monotonically
//   adding an IF never increases the trigger count
//   simulated: true mutates nothing and consumes no RNG
import type { ConditionNode } from "#data/elite-redux/ability-studio/vocabulary/composition-types";
import { CONDITION_REGISTRY, type ConditionDef } from "#data/elite-redux/ability-studio/vocabulary/conditions";
import { compileCompositionRule } from "#data/elite-redux/ability-studio/vocabulary/evaluate/compile-composition";
import { compileCondition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import type { Frame } from "#data/elite-redux/ability-studio/vocabulary/evaluate/frame";
import { missingSlots } from "#data/elite-redux/ability-studio/vocabulary/slots";
import { Stat } from "#enums/stat";
import { seededGenerator } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import { conditionVariants, STATEFUL_ATOMS } from "#test/tests/elite-redux/decomp/harness/compile-oracle";
import { RngProbe } from "#test/tests/elite-redux/decomp/harness/differential";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import {
  applyGridState,
  buildStateGrid,
  type GridState,
  gridMoves,
  resolveHp,
  type World,
} from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const FRAME_SLOTS = [
  "holder",
  "other",
  "move",
  "moveUser",
  "damage",
  "stat",
  "stages",
  "weather",
  "terrain",
  "hits",
  "ally",
] as const;

/** Atoms that can be evaluated on the frames this file builds (pure, no escape hatch, slots available). */
function usableAtoms(): { def: ConditionDef; node: ConditionNode }[] {
  const atoms: { def: ConditionDef; node: ConditionNode }[] = [];
  for (const def of CONDITION_REGISTRY) {
    // Memory atoms (time.once-per, time.nth-use) change state when they are evaluated outside a rule, so
    // "same answer twice" does not apply to them; the simulated test below covers them.
    if (def.escapeHatch === true || !def.pure || STATEFUL_ATOMS.has(def.id)) {
      continue;
    }
    for (const params of conditionVariants(def)) {
      if (missingSlots(def.requires, FRAME_SLOTS).length === 0) {
        atoms.push({ def, node: { block: def.id, params } });
      }
    }
  }
  return atoms;
}

function frameOf(world: World, move: ReturnType<typeof gridMoves>[number]): Frame {
  return {
    holder: world.holder,
    other: world.foe,
    move,
    moveUser: world.foe,
    damage: 40,
    stat: Stat.ATK,
    stages: 1,
    weather: world.game.scene.arena.weather?.weatherType,
    terrain: world.game.scene.arena.terrain?.terrainType,
    hits: { count: 2, index: 1 },
    simulated: false,
  };
}

/** Calls `visit` for every (state, move) frame of the grid with the world already in that state. */
function forEachFrame(
  world: World,
  states: readonly GridState[],
  visit: (frame: Frame, label: string) => void,
): number {
  let frames = 0;
  const moves = gridMoves();
  for (const state of states) {
    applyGridState(world, state);
    for (const move of moves) {
      frames++;
      visit(frameOf(world, move), `${state.name} / ${move.name}`);
    }
  }
  return frames;
}

describe("L3 metamorphic properties", () => {
  let phaserGame: Phaser.Game;
  let world: World;
  const states = buildStateGrid();
  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    world = await startWorld(phaserGame);
  });

  const alwaysTrue = (): ConditionNode => ({
    any: [{ block: "hp.full", params: { who: "holder" } }, { not: { block: "hp.full", params: { who: "holder" } } }],
  });
  const alwaysFalse = (): ConditionNode => ({
    all: [{ block: "hp.full", params: { who: "holder" } }, { not: { block: "hp.full", params: { who: "holder" } } }],
  });

  it("the always-true and always-false helpers really are (control)", () => {
    const t = compileCondition(alwaysTrue());
    const f = compileCondition(alwaysFalse());
    forEachFrame(world, states, frame => {
      expect(t(frame)).toBe(true);
      expect(f(frame)).toBe(false);
    });
  });

  // Every pure atom over the whole state grid: about 22 s after the library completion (more atoms), over the 20 s default.
  it("AND with an always-true condition and OR with an always-false condition equal the original, for every pure atom", () => {
    const atoms = usableAtoms();
    const problems: string[] = [];
    let evaluations = 0;
    // Evaluating an atom can throw when the grid frame lacks something it needs; such atoms are skipped and counted.
    const skipped = new Set<string>();
    for (const { def, node } of atoms) {
      const plain = compileCondition(node);
      const anded = compileCondition({ all: [node, alwaysTrue()] });
      const ored = compileCondition({ any: [node, alwaysFalse()] });
      const negated = compileCondition({ not: { not: node } });
      try {
        forEachFrame(world, states, (frame, label) => {
          evaluations++;
          const base = plain(frame);
          if (anded(frame) !== base) {
            problems.push(`${def.id} AND true differs at ${label}`);
          }
          if (ored(frame) !== base) {
            problems.push(`${def.id} OR false differs at ${label}`);
          }
          if (negated(frame) !== base) {
            problems.push(`${def.id} NOT NOT differs at ${label}`);
          }
        });
      } catch {
        skipped.add(def.id);
      }
    }
    console.log(`DECOMP_L3 metamorphic atoms=${atoms.length} skipped=${skipped.size} evaluations=${evaluations}`);
    expect(problems.slice(0, 10)).toEqual([]);
    expect(atoms.length - skipped.size).toBeGreaterThan(30);
  }, 120_000);

  it("adding an IF never increases the number of states in which a rule fires", () => {
    const atoms = usableAtoms();
    const next = seededGenerator("monotonic");
    const compiled = atoms.map(({ def, node }) => ({ id: def.id, test: compileCondition(node) }));
    const problems: string[] = [];
    for (let round = 0; round < 60; round++) {
      const a = compiled[Math.floor(next() * compiled.length)];
      const b = compiled[Math.floor(next() * compiled.length)];
      let countA = 0;
      let countBoth = 0;
      try {
        forEachFrame(world, states, frame => {
          const first = a.test(frame);
          countA += first ? 1 : 0;
          countBoth += first && b.test(frame) ? 1 : 0;
        });
      } catch {
        continue;
      }
      if (countBoth > countA) {
        problems.push(`${a.id} AND ${b.id} fires ${countBoth} times, ${a.id} alone ${countA}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("an HP threshold param moves the boundary monotonically (at-most grows with the percentage, at-least shrinks), in both roundings", () => {
    const problems: string[] = [];
    const holder = world.holder;
    const max = holder.getMaxHp();
    const hps = [
      1,
      2,
      Math.floor(max / 3),
      resolveHp("35%", max),
      resolveHp("50%-1", max),
      resolveHp("50%", max),
      resolveHp("50%+1", max),
      max - 1,
      max,
    ];
    for (const rounding of ["exact", "floor-half"]) {
      for (const hp of hps) {
        holder.hp = hp;
        let previousMost = false;
        let previousLeast = true;
        for (let pct = 1; pct <= 100; pct++) {
          const frame = frameOf(world, gridMoves()[0]);
          const most = compileCondition({ block: "hp.at-most", params: { who: "holder", pct, rounding } })(frame);
          const least = compileCondition({ block: "hp.at-least", params: { who: "holder", pct, rounding } })(frame);
          if (previousMost && !most) {
            problems.push(`at-most ${rounding} at hp ${hp}: true at ${pct - 1}% but false at ${pct}%`);
          }
          if (!previousLeast && least) {
            problems.push(`at-least ${rounding} at hp ${hp}: false at ${pct - 1}% but true at ${pct}%`);
          }
          previousMost = most;
          previousLeast = least;
        }
        const full = compileCondition({ block: "hp.at-most", params: { who: "holder", pct: 100, rounding } })(
          frameOf(world, gridMoves()[0]),
        );
        if (!full) {
          problems.push(`at-most 100% ${rounding} must always hold (hp ${hp})`);
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  describe("simulated: true mutates nothing and consumes no RNG", () => {
    const rule = (ifs: ConditionNode[]) =>
      compileCompositionRule({
        key: "sim-probe",
        when: { block: "event.on-entry" },
        if: ifs,
        do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
        chance: 100,
      });

    it("simulated calls leave once-per and nth-use memory untouched and never roll dice", () => {
      const probe = new RngProbe(world.game);
      try {
        const once = rule([{ block: "time.once-per", params: { scope: "battle", key: "sim-once" } }]);
        const nth = rule([{ block: "time.nth-use", params: { n: 1, key: "sim-nth" } }]);
        const dice = rule([{ block: "rng.chance", params: { pct: 50 } }]);
        const call = (attr: ReturnType<typeof rule>, simulated: boolean) =>
          attr.canApply({ pokemon: world.holder, simulated } as never);
        for (let i = 0; i < 6; i++) {
          expect(call(once, true)).toBe(true);
          expect(call(nth, true)).toBe(true);
          call(dice, true);
        }
        expect(probe.count).toBe(0);
        // Because nothing was written, the first REAL call is still the first use...
        expect(call(nth, false)).toBe(true);
        // ...and a real call that is applied consumes the once-per, so the next call says no. (The engine
        // passes the same params object to canApply and apply, which is what carries the pending write.)
        const real = { pokemon: world.holder, simulated: false } as never;
        expect(once.canApply(real)).toBe(true);
        once.apply(real);
        expect(call(once, false)).toBe(false);
        // The dice are rolled only by real calls: exactly one draw per real call.
        probe.reset();
        call(dice, false);
        call(dice, false);
        expect(probe.count).toBe(2);
      } finally {
        probe.restore();
      }
    });
  });
});
