/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2 probes. What the shared L1 grid and L2 twin cannot see, driven on the ORIGINAL attr and on its REBUILD side by side:
//   * StatusChanceMultiplierAbAttr: every move of the game against the old formula, every chance value, the cap at 100,
//   * SuperEffectiveMultiplierBoostAbAttr: the gate for every move and for every matchup value (and an engine error),
//   * TimeLimitedEffectivenessFloorAbAttr: the new guards/gate/residual canApply against the old five-clause formula,
//   * ActivateOncePerBattleEntryWindowAbAttr: two entries, a simulated entry, and why the library once-per atom cannot replace the gate,
//   * StatusEffectImmunityAbAttrEr / IntimidateImmunityAbAttrEr: every status, the refused constructor arguments,
//   * TargetHighestStatDropAbAttr: the stat picked, ties, simulated, a fainted foe,
//   * the text codecs.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import {
  formatHighestStatRules,
  formatStatusList,
  optionalTextCodec,
  parseHighestStatRules,
  parseStatusList,
} from "#data/elite-redux/ability-studio/decl/B12/b12-chunk2-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { StatusChanceMultiplierAbAttr } from "#data/elite-redux/archetypes/status-chance-multiplier";
import { StatusEffectImmunityAbAttrEr } from "#data/elite-redux/archetypes/status-immunity";
import { TargetHighestStatDropAbAttr } from "#data/elite-redux/archetypes/target-highest-stat-drop";
import { ActivateOncePerBattleEntryWindowAbAttr } from "#data/elite-redux/archetypes/time-limited-effectiveness-floor";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type AnyAttr = AbAttr & {
  canApply(params: never): boolean;
  apply(params: never): void;
};

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

describe("B12 chunk 2: status, effectiveness and entry-window classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every bound user rebuilds as a fresh equal attr and the legacy users are exactly the ones the notes list", () => {
    const legacy: string[] = [];
    const rebuilt: Record<string, number> = {};
    for (const className of [
      "StatusChanceMultiplierAbAttr",
      "StatusEffectImmunityAbAttrEr",
      "IntimidateImmunityAbAttrEr",
      "SuperEffectiveMultiplierBoostAbAttr",
      "TargetHighestStatDropAbAttr",
      "ActivateOncePerBattleEntryWindowAbAttr",
      "TimeLimitedEffectivenessFloorAbAttr",
    ]) {
      for (const site of sitesOf(className)) {
        const attr = rebuild(site);
        if (attr === undefined) {
          legacy.push(`${site.abilityName}:${site.attrIndex}`);
        } else {
          expect(attr).not.toBe(site.attr);
          expect(attr.constructor).toBe(site.attr.constructor);
          expect(attr.showAbility).toBe(site.attr.showAbility);
          rebuilt[className] = (rebuilt[className] ?? 0) + 1;
        }
      }
    }
    expect(rebuilt).toEqual({
      StatusEffectImmunityAbAttrEr: 6,
      IntimidateImmunityAbAttrEr: 2,
      SuperEffectiveMultiplierBoostAbAttr: 5,
      TargetHighestStatDropAbAttr: 1,
      TimeLimitedEffectivenessFloorAbAttr: 1,
    });
    expect(legacy.sort()).toEqual(
      [
        "Pyromancy:0",
        "Cryomancy:0",
        "Thermomancy:0",
        "Thermomancy:1",
        "Chandelier:2",
        "Cryostasis:0",
        "Forewarn:1",
        "Forewarn:2",
      ].sort(),
    );
  });

  it("StatusChanceMultiplier: canApply equals the old formula for every move, every chance and every status of the users", async () => {
    const { holder } = await startWorld(phaserGame);
    const moves = allMoves.filter(move => move !== undefined && move.id !== MoveId.NONE);
    let compared = 0;
    let passes = 0;
    for (const site of sitesOf("StatusChanceMultiplierAbAttr")) {
      const attr = site.attr as unknown as StatusChanceMultiplierAbAttr & { status: StatusEffect };
      for (const move of moves) {
        for (const chance of [-1, 0, 10, 30, 100]) {
          const holderValue = new NumberHolder(chance);
          const params = { pokemon: holder, move, chance: holderValue, simulated: false } as never;
          const hasStatus = move.getAttrs("StatusEffectAttr").some(a => a.effect === attr.status);
          const hasFrostbite =
            attr.status === StatusEffect.FREEZE
            && move.getAttrs("AddBattlerTagAttr").some(a => String(a.tagType).includes("FROSTBITE"));
          const expected =
            !(chance <= 0 || move.id === MoveId.ORDER_UP || move.id === MoveId.ELECTRO_SHOT)
            && (hasStatus || hasFrostbite);
          expect(
            (attr as unknown as AnyAttr).canApply(params),
            `${site.abilityName} ${MoveId[move.id]} ${chance}`,
          ).toBe(expected);
          compared++;
          passes += expected ? 1 : 0;
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(passes).toBeGreaterThan(0);
  });

  it("StatusChanceMultiplier: apply multiplies by 5 and never goes above 100", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = sitesOf("StatusChanceMultiplierAbAttr")[0].attr as unknown as AnyAttr;
    for (const [start, end] of [
      [10, 50],
      [20, 100],
      [30, 100],
    ]) {
      const chance = new NumberHolder(start);
      attr.apply({ pokemon: holder, move: allMoves[MoveId.EMBER], chance, simulated: false } as never);
      expect(chance.value).toBe(end);
    }
  });

  it("SuperEffectiveMultiplierBoost: the rebuilt gate equals the class for every move and every matchup value", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const moves = allMoves.filter(move => move !== undefined && move.id !== MoveId.NONE);
    for (const site of sitesOf("SuperEffectiveMultiplierBoostAbAttr")) {
      const copy = rebuild(site)!;
      for (const value of [0, 0.25, 0.5, 1, 1.99, 2, 4]) {
        vi.spyOn(foe, "getMoveEffectiveness").mockReturnValue(value);
        for (const move of moves) {
          const params = {
            pokemon: holder,
            opponent: foe,
            move,
            power: new NumberHolder(move.power),
            simulated: false,
          };
          expect(copy.canApply(params as never), `${site.abilityName} ${MoveId[move.id]} ${value}`).toBe(
            (site.attr as AnyAttr).canApply(params as never),
          );
          expect((site.attr as AnyAttr).canApply(params as never)).toBe(value >= 2);
        }
      }
      vi.restoreAllMocks();
      // apply multiplies the power by the setting.
      const power = new NumberHolder(100);
      copy.apply({ pokemon: holder, opponent: foe, move: moves[0], power, simulated: false } as never);
      expect(power.value).toBeCloseTo(100 * (site.attr as unknown as { powerMultiplier: number }).powerMultiplier);
    }
  });

  it("SuperEffectiveMultiplierBoost: an engine error counts as 'no' in the class (the atom does not catch, noted)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    vi.spyOn(foe, "getMoveEffectiveness").mockImplementation(() => {
      throw new Error("boom");
    });
    const site = sitesOf("SuperEffectiveMultiplierBoostAbAttr")[0];
    const move = allMoves[MoveId.TACKLE];
    expect(
      (site.attr as AnyAttr).canApply({
        pokemon: holder,
        opponent: foe,
        move,
        power: new NumberHolder(40),
        simulated: false,
      } as never),
    ).toBe(false);
  });

  it("TimeLimitedEffectivenessFloor: guards, gate and residual equal the old five-clause formula", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("TimeLimitedEffectivenessFloorAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Forewarn", "Soothsayer"]);
    const oldFormula = (
      attr: { turns: number; activeWindowKey: string | undefined },
      p: { typeMultiplier: unknown; move: { hasAttr(n: string): boolean } | undefined; pokemon: typeof holder },
    ): boolean => {
      const turnNumber = p.pokemon.tempSummonData?.turnCount ?? 1;
      return (
        (attr.activeWindowKey === undefined || p.pokemon.tempSummonData.abilityEntryWindows.has(attr.activeWindowKey))
        && turnNumber <= attr.turns
        && p.typeMultiplier instanceof NumberHolder
        && !p.move?.hasAttr("FixedDamageAttr")
        && p.typeMultiplier.value > 0.5
      );
    };
    let truths = 0;
    let total = 0;
    for (const site of sites) {
      const attr = site.attr as unknown as { turns: number; activeWindowKey: string | undefined };
      const copy = rebuild(site);
      for (const turnCount of [1, 2, 3, 4, 9]) {
        for (const windowOpen of [false, true]) {
          holder.tempSummonData.turnCount = turnCount;
          holder.tempSummonData.abilityEntryWindows.clear();
          if (windowOpen && attr.activeWindowKey !== undefined) {
            holder.tempSummonData.abilityEntryWindows.add(attr.activeWindowKey);
          }
          for (const value of [0, 0.25, 0.5, 1, 2, 4]) {
            for (const moveId of [MoveId.TACKLE, MoveId.SEISMIC_TOSS, MoveId.DRAGON_RAGE]) {
              for (const holderKind of ["number", "plain"]) {
                const typeMultiplier =
                  holderKind === "number" ? new NumberHolder(value) : ({ value } as unknown as NumberHolder);
                const params = {
                  pokemon: holder,
                  opponent: foe,
                  move: allMoves[moveId],
                  typeMultiplier,
                  cancelled: new BooleanHolder(false),
                  simulated: false,
                };
                const expected = oldFormula(attr, params);
                expect(
                  (site.attr as AnyAttr).canApply(params as never),
                  `${site.abilityName} turn ${turnCount} window ${windowOpen} value ${value} ${MoveId[moveId]} ${holderKind}`,
                ).toBe(expected);
                if (copy !== undefined) {
                  expect(copy.canApply(params as never)).toBe(expected);
                }
                total++;
                truths += expected ? 1 : 0;
              }
            }
          }
        }
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(truths).toBeGreaterThan(0);
    holder.tempSummonData.turnCount = 1;
    holder.tempSummonData.abilityEntryWindows.clear();
  });

  it("TimeLimitedEffectivenessFloor: apply floors the matchup to 0.5 and caches it", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TimeLimitedEffectivenessFloorAbAttr").find(s => s.abilityName === "Soothsayer")!;
    const typeMultiplier = new NumberHolder(4);
    (site.attr as AnyAttr).apply({
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      typeMultiplier,
      cancelled: new BooleanHolder(false),
      simulated: false,
    } as never);
    expect(typeMultiplier.value).toBe(0.5);
    expect(holder.turnData.moveEffectiveness).toBe(0.5);
    expect((site.attr as AnyAttr).getTriggerMessage({} as never, "x")).toBe("");
  });

  it("ActivateOncePerBattleEntryWindow: opens the window once per wave, never when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = new ActivateOncePerBattleEntryWindowAbAttr("b12-test-window") as unknown as AnyAttr;
    const params = { pokemon: holder, simulated: false } as never;
    holder.waveData.entryEffectsFired.delete("b12-test-window");
    holder.tempSummonData.abilityEntryWindows.delete("b12-test-window");
    expect(attr.canApply({ pokemon: holder, simulated: true } as never)).toBe(true);
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect(holder.tempSummonData.abilityEntryWindows.has("b12-test-window")).toBe(false);
    expect(holder.waveData.entryEffectsFired.has("b12-test-window")).toBe(false);
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(holder.tempSummonData.abilityEntryWindows.has("b12-test-window")).toBe(true);
    expect(holder.waveData.entryEffectsFired.has("b12-test-window")).toBe(true);
    expect(attr.canApply(params)).toBe(false);
    holder.waveData.entryEffectsFired.delete("b12-test-window");
    holder.tempSummonData.abilityEntryWindows.delete("b12-test-window");
  });

  it("ActivateOncePerBattleEntryWindow: a gate replaced by the library once-per atom never opens the window (why the user stays legacy)", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("ActivateOncePerBattleEntryWindowAbAttr")!;
    const key = "b12-test-window-2";
    const attr = buildAttr(
      module,
      { key },
      { gate: { block: "time.once-per", params: { scope: "wave", key } } as never },
    ) as AnyAttr;
    holder.waveData.entryEffectsFired.delete(key);
    holder.tempSummonData.abilityEntryWindows.delete(key);
    const params = { pokemon: holder, simulated: false } as never;
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    // The carrier wrote the key before the class's own apply, which then returned early.
    expect(holder.waveData.entryEffectsFired.has(key)).toBe(true);
    expect(holder.tempSummonData.abilityEntryWindows.has(key)).toBe(false);
    holder.waveData.entryEffectsFired.delete(key);
  });

  it("StatusEffectImmunity: every status against every user, original and rebuild, plus the empty list", async () => {
    const { holder } = await startWorld(phaserGame);
    const statuses = Object.values(StatusEffect).filter((v): v is number => typeof v === "number");
    for (const site of sitesOf("StatusEffectImmunityAbAttrEr")) {
      const copy = rebuild(site)!;
      const listed = (site.attr as unknown as { configuredStatuses: number[] }).configuredStatuses;
      for (const effect of statuses) {
        for (const already of [false, true]) {
          const make = () => ({ pokemon: holder, effect, cancelled: new BooleanHolder(already), simulated: false });
          const expected =
            !already && ((listed.length === 0 && effect !== StatusEffect.FAINT) || listed.includes(effect));
          expect((site.attr as AnyAttr).canApply(make() as never), `${site.abilityName} ${StatusEffect[effect]}`).toBe(
            expected,
          );
          expect(copy.canApply(make() as never)).toBe(expected);
        }
      }
      const cancelled = new BooleanHolder(false);
      copy.apply({ pokemon: holder, effect: StatusEffect.SLEEP, cancelled, simulated: false } as never);
      expect(cancelled.value).toBe(true);
    }
    expect(() => new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.FAINT] })).toThrow();
    expect(() => new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.NONE] })).toThrow();
  });

  it("Rude Awakening keeps its attr-level condition when rebuilt", async () => {
    const { holder } = await startWorld(phaserGame);
    const site = sitesOf("StatusEffectImmunityAbAttrEr").find(s => s.abilityName === "Rude Awakening")!;
    const copy = rebuild(site)!;
    expect(copy.getCondition()).toBe(site.attr.getCondition());
    holder.battleData.rudeAwakeningTriggered = false;
    expect(copy.getCondition()!(holder as never)).toBe(false);
    holder.battleData.rudeAwakeningTriggered = true;
    expect(copy.getCondition()!(holder as never)).toBe(true);
    holder.battleData.rudeAwakeningTriggered = false;
  });

  it("IntimidateImmunity: blocks once, never twice", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const site of sitesOf("IntimidateImmunityAbAttrEr")) {
      const copy = rebuild(site)!;
      const fresh = new BooleanHolder(false);
      expect(copy.canApply({ pokemon: holder, cancelled: fresh, simulated: false } as never)).toBe(true);
      copy.apply({ pokemon: holder, cancelled: fresh, simulated: false } as never);
      expect(fresh.value).toBe(true);
      expect(copy.canApply({ pokemon: holder, cancelled: fresh, simulated: false } as never)).toBe(false);
    }
  });

  it("TargetHighestStatDrop: drops the higher stat of each group, a tie keeps the first, simulated does nothing", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TargetHighestStatDropAbAttr")[0];
    const copy = rebuild(site)!;
    const calls: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      calls.push(args);
    }) as never);
    vi.spyOn(holder, "getAdjacentOpponents").mockReturnValue([foe]);
    const stats = new Map<number, number>([
      [Stat.ATK, 100],
      [Stat.SPATK, 100],
      [Stat.DEF, 50],
      [Stat.SPDEF, 80],
    ]);
    vi.spyOn(foe, "getStat").mockImplementation(((stat: number) => stats.get(stat) ?? 0) as never);
    for (const attr of [site.attr as AnyAttr, copy]) {
      calls.length = 0;
      expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(holder.getOpponents().length > 0);
      attr.apply({ pokemon: holder, simulated: true } as never);
      expect(calls).toEqual([]);
      attr.apply({ pokemon: holder, simulated: false } as never);
      // Tie between Attack and Sp. Atk keeps Attack; Sp. Def beats Defense.
      expect(calls.map(c => [c[0], c[1], c[2], c[3]])).toEqual([
        ["StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.ATK]],
        ["StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPDEF]],
      ]);
      expect(calls.map(c => c[4])).toEqual([-1, -1]);
    }
    // A fainted foe is skipped.
    vi.spyOn(foe, "isFainted").mockReturnValue(true);
    calls.length = 0;
    (site.attr as AnyAttr).apply({ pokemon: holder, simulated: false } as never);
    expect(calls).toEqual([]);
    expect(() => new TargetHighestStatDropAbAttr({ rules: [] })).toThrow();
  });

  it("the text codecs read and write plain words", () => {
    expect(parseStatusList("Paralysis, Bad poison")).toEqual([StatusEffect.PARALYSIS, StatusEffect.TOXIC]);
    expect(parseStatusList("")).toEqual([]);
    expect(formatStatusList([])).toBe("");
    expect(formatStatusList([StatusEffect.BURN, StatusEffect.FREEZE])).toBe("Burn, Freeze");
    expect(formatStatusList([StatusEffect.FAINT])).toBeUndefined();
    expect(() => parseStatusList("Sneezing")).toThrow(/not a status condition/);
    const rules = parseHighestStatRules("Attack or Defense -1; Sp. Atk or Sp. Def -2");
    expect(rules).toEqual([
      { candidates: [Stat.ATK, Stat.DEF], stages: -1 },
      { candidates: [Stat.SPATK, Stat.SPDEF], stages: -2 },
    ]);
    expect(formatHighestStatRules(rules)).toBe("Attack or Defense -1; Sp. Atk or Sp. Def -2");
    expect(() => parseHighestStatRules("")).toThrow();
    expect(() => parseHighestStatRules("Accuracy -1")).toThrow(/not a stat to compare/);
    expect(() => parseHighestStatRules("Attack -0")).toThrow();
    expect(() => parseHighestStatRules("Attack -9")).toThrow();
    expect(optionalTextCodec.toCtor("")).toBeUndefined();
    expect(optionalTextCodec.toCtor("abc")).toBe("abc");
    expect(optionalTextCodec.fromInstance(undefined)).toBe("");
    expect(optionalTextCodec.fromInstance("abc")).toBe("abc");
  });
  it("TimeLimitedEffectivenessFloor: the ceiling option (default 0.5) is read by residual and apply", async () => {
    const { holder } = await startWorld(phaserGame);
    const { TimeLimitedEffectivenessFloorAbAttr } = await import(
      "#data/elite-redux/archetypes/time-limited-effectiveness-floor"
    );
    const dflt = new TimeLimitedEffectivenessFloorAbAttr({ turns: 3 });
    const quarter = new TimeLimitedEffectivenessFloorAbAttr({ turns: 3, ceiling: 0.25 });
    const mk = (v: number) =>
      ({ pokemon: holder, typeMultiplier: new NumberHolder(v), move: undefined, simulated: false }) as never;
    expect(dflt.residual(mk(2))).toBe(true);
    expect(dflt.residual(mk(0.5))).toBe(false);
    expect(quarter.residual(mk(0.5))).toBe(true);
    expect(quarter.residual(mk(0.25))).toBe(false);
    const p = mk(4) as { typeMultiplier: NumberHolder };
    dflt.apply(p as never);
    expect(p.typeMultiplier.value).toBe(0.5);
    const q = mk(4) as { typeMultiplier: NumberHolder };
    quarter.apply(q as never);
    expect(q.typeMultiplier.value).toBe(0.25);
    expect(() => new TimeLimitedEffectivenessFloorAbAttr({ turns: 3, ceiling: -1 })).toThrow();
  });
});
