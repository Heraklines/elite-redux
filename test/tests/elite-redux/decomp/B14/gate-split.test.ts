/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 1: the Tier B split of four classes is a pure move of code. The gates of these classes are legacy bindings
// (no library atom yet), so L1 and L2 have nothing to rebuild; this file proves the split instead. For every
// combination of the clauses it compares the refactored `canApply` with a literal copy of the ORIGINAL expression
// (copied from the commit before the split), and it proves that `gateOverride` replaces only the gate and that the
// clause order and short-circuiting did not change.
import {
  type BitterDrillAbAttr,
  type PerpetualMotionPowerAbAttr,
  type PerpetualMotionProgressAbAttr,
  SouthernCrossPunchAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { ScriptedMoveMarkerAttr } from "#data/elite-redux/archetypes/scripted-move-util";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { describe, expect, it } from "vitest";

const SOUTHERN_CROSS_PUNCH = 6016;
const PERPETUAL_MOTION = 6022;
const BITTER_DRILL = 6044;

const HIT_RESULTS = [
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
  HitResult.NO_EFFECT,
  HitResult.STATUS,
  HitResult.FAIL,
  HitResult.MISS,
  HitResult.IMMUNE,
  HitResult.INDIRECT,
];

interface StandInMove {
  readonly category: MoveCategory;
  readonly attrs: object[];
  hasFlag(flag: MoveFlags): boolean;
}

function standInMove(options: {
  flags?: readonly MoveFlags[];
  category?: MoveCategory;
  markerKey?: string | undefined;
  otherMarkerKey?: string | undefined;
}): StandInMove {
  const attrs: object[] = [];
  if (options.otherMarkerKey !== undefined) {
    attrs.push(new ScriptedMoveMarkerAttr(options.otherMarkerKey));
  }
  if (options.markerKey !== undefined) {
    attrs.push(new ScriptedMoveMarkerAttr(options.markerKey));
  }
  const flags = options.flags ?? [];
  return {
    category: options.category ?? MoveCategory.PHYSICAL,
    attrs,
    hasFlag: flag => flags.includes(flag),
  };
}

/** A Pokemon with only what these classes read: its active ability attrs and its summon data. */
function standInMon(activeAttrs: readonly object[], pending: boolean, streak = 0) {
  return {
    summonData: { erPerpetualMotionPending: pending, erPerpetualMotionStreak: streak },
    getAllActiveAbilityAttrs: () => activeAttrs,
  };
}

const DAMAGES = [0, 1, 57];
const CATEGORIES = [MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS];

describe("B14 Tier B split: canApply equals the original expression", () => {
  for (const [id, label, flag] of [
    [SOUTHERN_CROSS_PUNCH, "Southern Cross Punch", MoveFlags.PUNCHING_MOVE],
    [BITTER_DRILL, "Bitter Drill", MoveFlags.DRILL_BASED],
  ] as const) {
    it(`${label}: every combination of simulated, damage, hit result, flag and active attr`, () => {
      const attr = liveAbility(id).attrs[0] as SouthernCrossPunchAbAttr | BitterDrillAbAttr;
      const isSouthern = id === SOUTHERN_CROSS_PUNCH;
      let compared = 0;
      let accepted = 0;
      for (const simulated of [false, true]) {
        for (const damage of DAMAGES) {
          for (const hitResult of HIT_RESULTS) {
            for (const flagged of [false, true]) {
              // Another flag on the move must not count.
              for (const otherFlag of [false, true]) {
                for (const present of [false, true]) {
                  const flags = [...(flagged ? [flag] : []), ...(otherFlag ? [MoveFlags.MAKES_CONTACT] : [])];
                  const move = standInMove({ flags });
                  // The original clause order, copied from the code before the split.
                  const mon = standInMon(present ? [attr] : [], false);
                  const original = isSouthern
                    ? !simulated
                      && damage > 0
                      && hitResult < HitResult.NO_EFFECT
                      && move.hasFlag(MoveFlags.PUNCHING_MOVE)
                      && mon.getAllActiveAbilityAttrs().some(a => a instanceof SouthernCrossPunchAbAttr)
                    : !simulated
                      && damage > 0
                      && hitResult < HitResult.NO_EFFECT
                      && move.hasFlag(MoveFlags.DRILL_BASED);
                  const params = { pokemon: mon, move, damage, hitResult, simulated } as never;
                  expect(
                    attr.canApply(params),
                    `${label}: simulated ${simulated} damage ${damage} result ${hitResult} flagged ${flagged} other ${otherFlag} present ${present}`,
                  ).toBe(original);
                  compared++;
                  accepted += original ? 1 : 0;
                }
              }
            }
          }
        }
      }
      // Both outcomes happened, so an always-true or always-false split could not pass.
      expect(accepted).toBeGreaterThan(5);
      expect(compared - accepted).toBeGreaterThan(5);
    });
  }

  it("Perpetual Motion progress: damage test and marker test, in every combination", () => {
    const attr = liveAbility(PERPETUAL_MOTION).attrs[3] as PerpetualMotionProgressAbAttr;
    expect(attr.constructor.name).toBe("PerpetualMotionProgressAbAttr");
    let accepted = 0;
    let compared = 0;
    for (const category of CATEGORIES) {
      for (const markerKey of [undefined, "perpetual-motion", "another-ability"]) {
        for (const otherMarkerKey of [undefined, "another-ability"]) {
          const move = standInMove({ category, markerKey, otherMarkerKey });
          const original =
            move.category !== MoveCategory.STATUS
            && move.attrs.some(a => a instanceof ScriptedMoveMarkerAttr && a.key === "perpetual-motion");
          const params = { pokemon: standInMon([], true), move, damage: 10, hitResult: HitResult.EFFECTIVE } as never;
          expect(attr.canApply(params), `category ${category} marker ${markerKey} other ${otherMarkerKey}`).toBe(
            original,
          );
          compared++;
          accepted += original ? 1 : 0;
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(compared - accepted).toBeGreaterThan(0);
  });

  it("Perpetual Motion power: armed state and marker test, in every combination", () => {
    const attr = liveAbility(PERPETUAL_MOTION).attrs[4] as PerpetualMotionPowerAbAttr;
    expect(attr.constructor.name).toBe("PerpetualMotionPowerAbAttr");
    let accepted = 0;
    let compared = 0;
    for (const pending of [false, true]) {
      for (const markerKey of [undefined, "perpetual-motion", "another-ability"]) {
        const move = standInMove({ markerKey });
        const mon = standInMon([], pending, 3);
        const original =
          !!mon.summonData.erPerpetualMotionPending
          && move.attrs.some(a => a instanceof ScriptedMoveMarkerAttr && a.key === "perpetual-motion");
        expect(attr.canApply({ pokemon: mon, move } as never), `pending ${pending} marker ${markerKey}`).toBe(original);
        compared++;
        accepted += original ? 1 : 0;
      }
    }
    expect(accepted).toBe(1);
    expect(compared - accepted).toBe(5);
  });
});

describe("B14 Tier B split: order, short-circuit and gateOverride", () => {
  it("the guards run before the gate and the gate before the residual (Southern Cross Punch)", () => {
    const attr = liveAbility(SOUTHERN_CROSS_PUNCH).attrs[0] as SouthernCrossPunchAbAttr;
    const trail: string[] = [];
    const probe = Object.create(attr) as SouthernCrossPunchAbAttr;
    probe.guards = params => {
      trail.push("guards");
      return attr.guards(params);
    };
    probe.gate = params => {
      trail.push("gate");
      return attr.gate(params);
    };
    probe.residual = params => {
      trail.push("residual");
      return attr.residual(params);
    };
    const punch = standInMove({ flags: [MoveFlags.PUNCHING_MOVE] });
    const plain = standInMove({});
    const mon = standInMon([attr], false);
    // A preview stops at the guards: neither the gate nor the residual is evaluated.
    expect(
      probe.canApply({
        pokemon: mon,
        move: punch,
        damage: 5,
        hitResult: HitResult.EFFECTIVE,
        simulated: true,
      } as never),
    ).toBe(false);
    expect(trail).toEqual(["guards"]);
    trail.length = 0;
    // A move without the flag stops at the gate: the residual is not evaluated.
    expect(
      probe.canApply({
        pokemon: mon,
        move: plain,
        damage: 5,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as never),
    ).toBe(false);
    expect(trail).toEqual(["guards", "gate"]);
    trail.length = 0;
    expect(
      probe.canApply({
        pokemon: mon,
        move: punch,
        damage: 5,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as never),
    ).toBe(true);
    expect(trail).toEqual(["guards", "gate", "residual"]);
  });

  it("gateOverride replaces only the gate; the guards and the residual still decide (Southern Cross Punch)", () => {
    const attr = liveAbility(SOUTHERN_CROSS_PUNCH).attrs[0] as SouthernCrossPunchAbAttr;
    const copy = Object.create(attr) as SouthernCrossPunchAbAttr;
    copy.gateOverride = () => true;
    const plain = standInMove({});
    const hit = { move: plain, damage: 5, hitResult: HitResult.EFFECTIVE, simulated: false };
    // The override says yes for a move without the punch flag.
    expect(copy.canApply({ ...hit, pokemon: standInMon([attr], false) } as never)).toBe(true);
    // The guards still stop a preview, a miss and a zero-damage hit.
    expect(copy.canApply({ ...hit, simulated: true, pokemon: standInMon([attr], false) } as never)).toBe(false);
    expect(copy.canApply({ ...hit, damage: 0, pokemon: standInMon([attr], false) } as never)).toBe(false);
    expect(copy.canApply({ ...hit, hitResult: HitResult.NO_EFFECT, pokemon: standInMon([attr], false) } as never)).toBe(
      false,
    );
    // The residual still stops a holder without an active attr.
    expect(copy.canApply({ ...hit, pokemon: standInMon([], false) } as never)).toBe(false);
  });

  it("gateOverride replaces only the gate (Bitter Drill, Perpetual Motion power and progress)", () => {
    const drill = Object.create(liveAbility(BITTER_DRILL).attrs[0]) as BitterDrillAbAttr;
    drill.gateOverride = () => true;
    const plain = standInMove({});
    const hit = {
      pokemon: standInMon([], false),
      move: plain,
      damage: 5,
      hitResult: HitResult.EFFECTIVE,
      simulated: false,
    };
    expect(drill.canApply(hit as never)).toBe(true);
    expect(drill.canApply({ ...hit, damage: 0 } as never)).toBe(false);
    expect(drill.canApply({ ...hit, simulated: true } as never)).toBe(false);

    const power = Object.create(liveAbility(PERPETUAL_MOTION).attrs[4]) as PerpetualMotionPowerAbAttr;
    power.gateOverride = () => true;
    // The armed-state guard still runs first.
    expect(power.canApply({ pokemon: standInMon([], false), move: plain } as never)).toBe(false);
    expect(power.canApply({ pokemon: standInMon([], true), move: plain } as never)).toBe(true);

    const progress = Object.create(liveAbility(PERPETUAL_MOTION).attrs[3]) as PerpetualMotionProgressAbAttr;
    progress.gateOverride = () => false;
    expect(
      progress.canApply({
        pokemon: standInMon([], true),
        move: standInMove({ markerKey: "perpetual-motion" }),
      } as never),
    ).toBe(false);
    progress.gateOverride = () => true;
    expect(progress.canApply({ pokemon: standInMon([], true), move: plain } as never)).toBe(true);
  });
});
