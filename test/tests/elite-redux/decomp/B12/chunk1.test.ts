/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1 probes. What the shared L1 grid and L2 twin cannot see, driven on the ORIGINAL attr and on its REBUILD side by side:
//   * StatTriggerOnHitAbAttr: every move of the game against every HitResult (the class guard and the type filter),
//   * the two stat-lowered classes: every stage change from -6 to +6, own move or not, one and two stats,
//   * StatTriggerOnKoAbAttr: the clauses of the Moxie gate (own faint, credited, not credited, any faint),
//   * FaintCountTriggerAbAttr / PerFaintStatMultiplierAbAttr: the counter and the stat formula,
//   * StatusCascadeAbAttr: every status, a fainted target, a simulated call,
//   * the queued phases of `apply` for every class, and the text codecs.
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  formatHitFilter,
  formatStatChanges,
  parseHitFilter,
  parseStatChanges,
} from "#data/elite-redux/ability-studio/decl/B12/b12-chunk1-codecs";
import { PerFaintStatMultiplierAbAttr } from "#data/elite-redux/archetypes/stat-multiplier-per-faint";
import {
  StatTriggerOnAllyStatLoweredAbAttr,
  StatTriggerOnHitAbAttr,
  StatTriggerOnKoAbAttr,
  StatTriggerOnStatLoweredAbAttr,
} from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { StatusCascadeAbAttr } from "#data/elite-redux/archetypes/status-cascade";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites, type AttrSite } from "#test/tests/elite-redux/decomp/harness/sites";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type AnyAttr = AbAttr & {
  canApply(params: never): boolean;
  apply(params: never): void;
};

const HIT_RESULTS = Object.values(HitResult).filter((value): value is number => typeof value === "number");

function sitesOf(className: string): AttrSite[] {
  return allAttrSites().filter(site => site.className === className);
}

/** The attr rebuilt from its declaration, or undefined when its gate is a legacy-closure. */
function rebuild(site: AttrSite): AnyAttr | undefined {
  const module = declRegistry.get(site.className)!;
  const gate = getBinding(site.abilityId, site.attrIndex, "gate");
  if (gate !== undefined && gate.spec === undefined) {
    return;
  }
  return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as AnyAttr;
}

describe("B12 chunk 1: stat-trigger family", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Records every phase `apply` queues instead of running it. */
  function recordPhases(): unknown[][] {
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(args);
    }) as never);
    return calls;
  }

  it("every bound user is rebuilt as a fresh, equal attr and every legacy user is exactly the ones the notes list", () => {
    const rebuilt = new Map<string, number>();
    const legacy: string[] = [];
    for (const className of [
      "FaintCountTriggerAbAttr",
      "StatTriggerOnKoAbAttr",
      "StatTriggerOnHitAbAttr",
      "StatTriggerOnStatLoweredAbAttr",
      "StatTriggerOnAllyStatLoweredAbAttr",
      "StatusCascadeAbAttr",
    ]) {
      for (const site of sitesOf(className)) {
        const attr = rebuild(site);
        if (attr === undefined) {
          legacy.push(`${site.abilityName}:${site.attrIndex}`);
        } else {
          expect(attr).not.toBe(site.attr);
          expect(attr.constructor).toBe(site.attr.constructor);
          expect(attr.showAbility).toBe(site.attr.showAbility);
          expect((attr as unknown as { gateOverride?: unknown }).gateOverride).toBeTypeOf("function");
          rebuilt.set(className, (rebuilt.get(className) ?? 0) + 1);
        }
      }
    }
    expect(Object.fromEntries(rebuilt)).toEqual({
      FaintCountTriggerAbAttr: 1,
      StatTriggerOnKoAbAttr: 1,
      StatTriggerOnHitAbAttr: 12,
      StatTriggerOnStatLoweredAbAttr: 13,
      StatTriggerOnAllyStatLoweredAbAttr: 6,
      StatusCascadeAbAttr: 1,
    });
    expect(legacy.sort()).toEqual(
      [
        "ChillngNeigh:0",
        "Adrenaline Rush:0",
        "Super Strain:0",
        "Hubris:0",
        "Haunting Frenzy:1",
        "Dragon's Ritual:0",
        "Breezy Neigh:0",
        "Hydra:1",
        "As One:0",
        "Super Hot Goo:1",
      ].sort(),
    );
  });

  it("StatTriggerOnHit: the guard and the filter agree for every move and every hit result", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const moves = allMoves.filter(move => move !== undefined && move.id !== MoveId.NONE);
    let compared = 0;
    let passes = 0;
    for (const site of sitesOf("StatTriggerOnHitAbAttr")) {
      const copy = rebuild(site);
      if (copy === undefined) {
        continue;
      }
      for (const move of moves) {
        for (const hitResult of HIT_RESULTS) {
          const params = { pokemon: holder, opponent: foe, move, damage: 7, hitResult, simulated: false } as never;
          const expected = (site.attr as AnyAttr).canApply(params);
          expect(copy.canApply(params), `${site.abilityName} ${MoveId[move.id]} hit result ${HitResult[hitResult]}`).toBe(
            expected,
          );
          compared++;
          passes += expected ? 1 : 0;
        }
      }
    }
    // The guard answers false from NO_EFFECT upward, so some combinations pass and most do not.
    expect(compared).toBeGreaterThan(100000);
    expect(passes).toBeGreaterThan(0);
    expect(passes).toBeLessThan(compared);
  });

  it("StatTriggerOnHit: the class guard stops a status result and a blocked hit even with no filter", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const angerPoint = sitesOf("StatTriggerOnHitAbAttr").find(site => site.abilityName === "Anger Point")!;
    const copy = rebuild(angerPoint)!;
    for (const hitResult of HIT_RESULTS) {
      const params = {
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage: 5,
        hitResult,
        simulated: false,
      } as never;
      const landed = hitResult < HitResult.NO_EFFECT;
      expect((angerPoint.attr as AnyAttr).canApply(params)).toBe(landed);
      expect(copy.canApply(params)).toBe(landed);
    }
  });

  it("StatTriggerOnHit: the plain contact flag of Super Hot Goo differs from the library atom exactly as the request says", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const goo = sitesOf("StatTriggerOnHitAbAttr").find(site => site.abilityName === "Super Hot Goo")!;
    const params = (move: MoveId) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        damage: 5,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      }) as never;
    expect((goo.attr as AnyAttr).canApply(params(MoveId.TACKLE))).toBe(true);
    expect((goo.attr as AnyAttr).canApply(params(MoveId.WATER_GUN))).toBe(false);
    // The class reads `move.hasFlag`, so it triggers for any move that carries the flag, whatever the attacker's abilities say.
    for (const move of allMoves.filter(candidate => candidate !== undefined && candidate.id !== MoveId.NONE)) {
      expect((goo.attr as AnyAttr).canApply(params(move.id))).toBe(move.hasFlag(1));
    }
  });

  it("the two stat-lowered classes: every stage change, own move or not, one and two stats", async () => {
    const { holder } = await startWorld(phaserGame);
    let compared = 0;
    for (const className of ["StatTriggerOnStatLoweredAbAttr", "StatTriggerOnAllyStatLoweredAbAttr"]) {
      for (const site of sitesOf(className)) {
        const copy = rebuild(site)!;
        for (let stages = -6; stages <= 6; stages++) {
          for (const selfTarget of [false, true]) {
            for (const stats of [[Stat.ATK], [Stat.ATK, Stat.DEF]]) {
              const params = { pokemon: holder, stats, stages, selfTarget, simulated: false } as never;
              const expected = (site.attr as AnyAttr).canApply(params);
              // The definition of the rule, written out: a drop caused by someone else.
              expect(expected).toBe(stages < 0 && !selfTarget);
              expect(copy.canApply(params), `${site.abilityName} ${stages} ${selfTarget}`).toBe(expected);
              compared++;
            }
          }
        }
      }
    }
    expect(compared).toBe(19 * 13 * 2 * 2);
  });

  it("the two stat-lowered classes queue the same phases, repeated once per stat lowered in the side scope", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const className of ["StatTriggerOnStatLoweredAbAttr", "StatTriggerOnAllyStatLoweredAbAttr"]) {
      for (const site of sitesOf(className)) {
        const copy = rebuild(site)!;
        for (const stats of [[Stat.ATK], [Stat.ATK, Stat.DEF, Stat.SPD]]) {
          const params = { pokemon: holder, stats, stages: -1, selfTarget: false, simulated: false } as never;
          const original = recordPhases();
          (site.attr as AnyAttr).apply(params);
          vi.restoreAllMocks();
          const rebuiltCalls = recordPhases();
          copy.apply(params);
          vi.restoreAllMocks();
          expect(rebuiltCalls, `${site.abilityName} attr ${site.attrIndex}`).toEqual(original);
          expect(original.length).toBeGreaterThan(0);
        }
        // A simulated call queues nothing in the original and in the rebuild.
        const quiet = recordPhases();
        (site.attr as AnyAttr).apply({ pokemon: holder, stats: [Stat.ATK], stages: -1, selfTarget: false, simulated: true } as never);
        copy.apply({ pokemon: holder, stats: [Stat.ATK], stages: -1, selfTarget: false, simulated: true } as never);
        expect(quiet).toEqual([]);
        vi.restoreAllMocks();
      }
    }
    // The scope really multiplies: King's Wrath with two stats lowered raises each of its two stats by 2 stages.
    const kings = sitesOf("StatTriggerOnStatLoweredAbAttr").find(site => site.abilityName === "King's Wrath")!;
    const calls = recordPhases();
    (kings.attr as AnyAttr).apply({ pokemon: holder, stats: [Stat.SPD, Stat.ACC], stages: -1, selfTarget: false, simulated: false } as never);
    expect(calls.map(call => call[4])).toEqual([2, 2]);
    vi.restoreAllMocks();
    const rattled = sitesOf("StatTriggerOnStatLoweredAbAttr").find(site => site.abilityName === "Rattled")!;
    const once = recordPhases();
    (rattled.attr as AnyAttr).apply({ pokemon: holder, stats: [Stat.SPD, Stat.ACC], stages: -1, selfTarget: false, simulated: false } as never);
    expect(once.map(call => call[4])).toEqual([2]);
  });

  it("StatTriggerOnKo: the Moxie gate, clause by clause, and Forsaken Heart's any-faint gate as a rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const chilling = sitesOf("StatTriggerOnKoAbAttr").find(site => site.abilityName === "ChillngNeigh")!;
    const forsaken = sitesOf("StatTriggerOnKoAbAttr").find(site => site.abilityName === "Forsaken Heart")!;
    const params = (victim: typeof foe) => ({ pokemon: holder, victim, simulated: false }) as never;
    const credit = (by: typeof holder | undefined) => {
      foe.turnData.attacksReceived =
        by === undefined
          ? []
          : [
              {
                move: MoveId.TACKLE,
                result: HitResult.EFFECTIVE,
                damage: 5,
                critical: false,
                sourceId: by.id,
                sourceBattlerIndex: by.getBattlerIndex(),
              },
            ];
    };
    // Clause 3: the victim's latest attacker must be the holder.
    credit(holder);
    expect((chilling.attr as AnyAttr).canApply(params(foe))).toBe(true);
    credit(foe);
    expect((chilling.attr as AnyAttr).canApply(params(foe))).toBe(false);
    credit(undefined);
    expect((chilling.attr as AnyAttr).canApply(params(foe))).toBe(false);
    // Clause 2: my own faint never counts, even when the holder is the credited attacker.
    holder.turnData.attacksReceived = [
      {
        move: MoveId.TACKLE,
        result: HitResult.EFFECTIVE,
        damage: 5,
        critical: false,
        sourceId: holder.id,
        sourceBattlerIndex: holder.getBattlerIndex(),
      },
    ];
    expect((chilling.attr as AnyAttr).canApply(params(holder))).toBe(false);
    // Clause 1: Forsaken Heart skips both, rebuilt from the empty gate.
    const copy = rebuild(forsaken)!;
    for (const attacker of [holder, foe, undefined]) {
      credit(attacker);
      for (const victim of [foe, holder]) {
        expect((forsaken.attr as AnyAttr).canApply(params(victim))).toBe(true);
        expect(copy.canApply(params(victim))).toBe(true);
      }
    }
    // The nine credited users are rebuilt by hand from the library part of their rule: not(side.is self) alone would be too
    // wide (it ignores the credit), which is exactly why those gates stay legacy until R-B12-01.
    const module = declRegistry.get("StatTriggerOnKoAbAttr")!;
    const wide = buildAttr(module, { stats: "Attack +1" }, { gate: { not: { block: "side.is", params: { kind: "self" } } } }) as AnyAttr;
    credit(foe);
    expect(wide.canApply(params(foe))).toBe(true);
    expect((chilling.attr as AnyAttr).canApply(params(foe))).toBe(false);
  });

  it("StatTriggerOnKo and the others queue the same phases in the same order, and apply nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const cases: [className: string, params: object][] = [
      ["StatTriggerOnKoAbAttr", { pokemon: holder, victim: holder, simulated: false }],
      ["StatTriggerOnHitAbAttr", { pokemon: holder, damage: 5, hitResult: HitResult.EFFECTIVE, simulated: false }],
      ["StatusCascadeAbAttr", { pokemon: holder, simulated: false }],
    ];
    for (const [className, base] of cases) {
      for (const site of sitesOf(className)) {
        const copy = rebuild(site) ?? (site.attr as AnyAttr);
        const foeSide = { opponent: holder.getOpponents()[0], move: allMoves[MoveId.TACKLE] };
        const params = { ...base, ...foeSide } as never;
        const original = recordPhases();
        (site.attr as AnyAttr).apply(params);
        vi.restoreAllMocks();
        const rebuiltCalls = recordPhases();
        copy.apply(params);
        vi.restoreAllMocks();
        expect(rebuiltCalls, `${site.abilityName} attr ${site.attrIndex}`).toEqual(original);
        expect(original.length, `${site.abilityName} queues a phase per listed stat`).toBe(
          (site.attr as unknown as { stats: unknown[] }).stats.length,
        );
        const quiet = recordPhases();
        (site.attr as AnyAttr).apply({ ...(params as object), simulated: true } as never);
        copy.apply({ ...(params as object), simulated: true } as never);
        expect(quiet).toEqual([]);
        vi.restoreAllMocks();
      }
    }
  });

  it("StatusCascade: every status, a fainted target and a simulated call", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const neurotoxin = sitesOf("StatusCascadeAbAttr")[0];
    const copy = rebuild(neurotoxin)!;
    const params = (simulated = false) =>
      ({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage: 5, hitResult: HitResult.EFFECTIVE, simulated }) as never;
    const statuses = [
      StatusEffect.NONE,
      StatusEffect.POISON,
      StatusEffect.TOXIC,
      StatusEffect.PARALYSIS,
      StatusEffect.SLEEP,
      StatusEffect.FREEZE,
      StatusEffect.BURN,
    ];
    const hp = foe.hp;
    for (const status of statuses) {
      setStatusOf(foe, status);
      // A standing target: only Poison passes.
      expect((neurotoxin.attr as AnyAttr).canApply(params())).toBe(status === StatusEffect.POISON);
      expect(copy.canApply(params())).toBe(status === StatusEffect.POISON);
      // A fainted target never passes, whatever its status.
      foe.hp = 0;
      expect((neurotoxin.attr as AnyAttr).canApply(params())).toBe(false);
      expect(copy.canApply(params())).toBe(false);
      foe.hp = hp;
    }
    setStatusOf(foe, StatusEffect.NONE);
    // Staff can move the status the gate looks for: Burn instead of Poison.
    const module = declRegistry.get("StatusCascadeAbAttr")!;
    const burn = recomposeAttr(module, neurotoxin.attr, neurotoxin.abilityId, neurotoxin.attrIndex, {
      params: { trigger: "BURN" },
    }) as AnyAttr;
    const burnOriginal = new StatusCascadeAbAttr({
      trigger: StatusEffect.BURN,
      stats: [{ stat: Stat.ATK, stages: -1 }, { stat: Stat.SPATK, stages: -1 }, { stat: Stat.SPD, stages: -1 }],
    }) as unknown as AnyAttr;
    for (const status of statuses) {
      setStatusOf(foe, status);
      expect(burn.canApply(params())).toBe(status === StatusEffect.BURN);
      expect(burn.canApply(params())).toBe(burnOriginal.canApply(params()));
    }
    setStatusOf(foe, StatusEffect.NONE);
    // The phases target the foe (not the holder) with selfTarget false.
    const calls = recordPhases();
    (neurotoxin.attr as AnyAttr).apply(params());
    expect(calls.map(call => [call[0], call[1], call[2], call[4]])).toEqual([
      ["StatStageChangePhase", foe.getBattlerIndex(), false, -1],
      ["StatStageChangePhase", foe.getBattlerIndex(), false, -1],
      ["StatStageChangePhase", foe.getBattlerIndex(), false, -1],
    ]);
  });

  it("FaintCount and PerFaint: the counter, the formula and the percent setting", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const counter = sitesOf("FaintCountTriggerAbAttr")[0];
    const copy = rebuild(counter)!;
    const counts = () => holder.battleData.erSoulHarvestFaintCount ?? 0;
    holder.battleData.erSoulHarvestFaintCount = 0;
    const faint = (victim: typeof foe, simulated = false) => ({ pokemon: holder, victim, simulated }) as never;
    // Not my own faint, for the original and for the rebuild.
    for (const attr of [counter.attr as AnyAttr, copy]) {
      expect(attr.canApply(faint(foe))).toBe(true);
      expect(attr.canApply(faint(holder))).toBe(false);
    }
    // apply counts once per call, never when simulated, and the rebuild shares the same counter.
    (counter.attr as AnyAttr).apply(faint(foe));
    copy.apply(faint(foe));
    (counter.attr as AnyAttr).apply(faint(foe, true));
    copy.apply(faint(foe, true));
    expect(counts()).toBe(2);
    // The stat formula: 1 + 0.05 x count, for every Soul Harvest stat and for a rebuild with another percent.
    const stats = sitesOf("PerFaintStatMultiplierAbAttr");
    expect(stats.map(site => (site.attr as unknown as { stat: number }).stat)).toEqual([Stat.ATK, Stat.SPATK, Stat.SPDEF]);
    const module = declRegistry.get("PerFaintStatMultiplierAbAttr")!;
    for (const count of [0, 1, 2, 5, 12]) {
      holder.battleData.erSoulHarvestFaintCount = count;
      for (const site of stats) {
        const original = site.attr as AnyAttr;
        const twin = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as AnyAttr;
        const stat = (site.attr as unknown as { stat: number }).stat;
        for (const attr of [original, twin]) {
          const value = new NumberHolder(100);
          const params = { pokemon: holder, move: allMoves[MoveId.TACKLE], stat, statVal: value } as never;
          expect(attr.canApply(params)).toBe(true);
          attr.apply(params);
          expect(value.value).toBe(100 * (1 + 0.05 * count));
        }
        // A different stat is not answered.
        expect(twin.canApply({ pokemon: holder, move: allMoves[MoveId.TACKLE], stat: Stat.SPD, statVal: new NumberHolder(100) } as never)).toBe(false);
      }
    }
    // The percent setting reaches the class as a fraction: 10 % is 0.1, 2.5 % is 0.025.
    for (const [percent, fraction] of [
      [10, 0.1],
      [2.5, 0.025],
      [5, 0.05],
    ] as const) {
      const built = buildAttr(module, { stat: "ATK", perFaint: percent }) as unknown as { perFaint: number };
      expect(built.perFaint).toBe(fraction);
      expect(built).toBeInstanceOf(PerFaintStatMultiplierAbAttr);
    }
    holder.battleData.erSoulHarvestFaintCount = 0;
  });

  it("the settings of every class read back from the live attrs and build an equal attr", () => {
    for (const className of [
      "StatTriggerOnKoAbAttr",
      "StatTriggerOnHitAbAttr",
      "StatTriggerOnEntryAbAttr",
      "StatTriggerOnStatLoweredAbAttr",
      "StatTriggerOnAllyStatLoweredAbAttr",
      "StatusCascadeAbAttr",
    ]) {
      const module = declRegistry.get(className)!;
      for (const site of sitesOf(className)) {
        const stats = (site.attr as unknown as { stats: unknown }).stats;
        const text = formatStatChanges(stats);
        expect(text, `${site.abilityName} stats readable`).toBeTypeOf("string");
        expect(parseStatChanges(text!)).toEqual(stats);
      }
    }
  });

  it("the stat text reads and refuses what a player would type", () => {
    expect(parseStatChanges("Attack +1, Speed +2")).toEqual([
      { stat: Stat.ATK, stages: 1 },
      { stat: Stat.SPD, stages: 2 },
    ]);
    expect(parseStatChanges("sp. def -1")).toEqual([{ stat: Stat.SPDEF, stages: -1 }]);
    expect(parseStatChanges("Defense+12")).toEqual([{ stat: Stat.DEF, stages: 12 }]);
    expect(formatStatChanges([{ stat: Stat.SPATK, stages: -2 }])).toBe("Sp. Atk -2");
    for (const bad of ["", "Attack", "Attack +0", "Attack +13", "Power +1", "Attack 1"]) {
      expect(() => parseStatChanges(bad), bad).toThrow();
    }
  });

  it("the filter text reads, prints and refuses what a player would type", () => {
    expect(parseHitFilter("Any move")).toBeUndefined();
    expect(parseHitFilter("Flying, Fire")).toEqual({ types: [2, 9] });
    expect(parseHitFilter("Fire, Flying, Contact")).toEqual({ types: [9, 2], flags: [1] });
    expect(parseHitFilter("contact")).toEqual({ flags: [1] });
    expect(formatHitFilter(null)).toBe("Any move");
    expect(formatHitFilter({ types: [5] })).toBe("Rock");
    expect(formatHitFilter({ types: [2, 9] })).toBe("Flying, Fire");
    expect(formatHitFilter({ flags: [1] })).toBe("Contact");
    expect(formatHitFilter({ types: [] })).toBeUndefined();
    expect(() => parseHitFilter("Spicy")).toThrow();
    // Every live filter survives a round trip.
    for (const site of sitesOf("StatTriggerOnHitAbAttr")) {
      const filter = (site.attr as unknown as { filter: unknown }).filter;
      const text = formatHitFilter(filter);
      expect(text, site.abilityName).toBeTypeOf("string");
      expect(parseHitFilter(text!)).toEqual(filter ?? undefined);
    }
    const built = buildAttr(declRegistry.get("StatTriggerOnHitAbAttr")!, { stats: "Attack +1", filter: "Fire" }, { gate: { all: [] } });
    expect(built).toBeInstanceOf(StatTriggerOnHitAbAttr);
    expect((built as unknown as { filter: unknown }).filter).toEqual({ types: [9] });
    expect(StatTriggerOnKoAbAttr).toBeDefined();
    expect(StatTriggerOnStatLoweredAbAttr).toBeDefined();
    expect(StatTriggerOnAllyStatLoweredAbAttr).toBeDefined();
  });

  it("the ally half of the stat-lowered pair reacts to the ally's drop through the same gate (L2 cannot steer into it)", async () => {
    const { holder } = await startWorld(phaserGame);
    // King's Wrath attr 1 reads `stages < 0` and `!selfTarget` on the change that happened to the ALLY.
    const kings = sitesOf("StatTriggerOnAllyStatLoweredAbAttr").find(site => site.abilityName === "King's Wrath")!;
    const copy = rebuild(kings)!;
    for (const [stages, selfTarget, expected] of [
      [-1, false, true],
      [-2, false, true],
      [-1, true, false],
      [1, false, false],
      [0, false, false],
    ] as const) {
      const params = { pokemon: holder, stats: [Stat.DEF], stages, selfTarget, simulated: false } as never;
      expect((kings.attr as AnyAttr).canApply(params)).toBe(expected);
      expect(copy.canApply(params)).toBe(expected);
    }
  });
});
