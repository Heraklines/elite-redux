/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  MoodyAbAttr,
  PostTurnFormChangeAbAttr,
  PostTurnResetStatusAbAttr,
  PostTurnStatusHealAbAttr,
  SpeedBoostAbAttr,
} from "#abilities/ab-attrs";
// B06 chunk 1: what the shared L1 and L2 suites cannot see. Every test drives the ORIGINAL attr of a real ability and, where the
// class is rebuildable, its REBUILD side by side, or characterises the original clause by clause (random draw order, memory,
// ER ailment tags, an ally pick, the parked declaration). Classes: PostTurnStatusHealAbAttr, PostTurnResetStatusAbAttr,
// PostTurnRestoreBerryAbAttr, CudChewConsumeBerryAbAttr, CudChewRecordBerryAbAttr, MoodyAbAttr, SpeedBoostAbAttr and
// PostTurnFormChangeAbAttr.
import { CudChewConsumeBerryAbAttr, CudChewRecordBerryAbAttr, PostTurnRestoreBerryAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { lintDecl } from "#data/elite-redux/ability-studio/decl-lint";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { Status } from "#data/status-effect";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const POISON_HEAL = 90;
const SHED_SKIN = 61;
const HEALER = 131;
const SPEED_BOOST = 3;
const MOODY = 141;
const ZEN_MODE = 161;
const CUD_CHEW = 291;

let phaserGame: Phaser.Game;
beforeAll(() => {
  phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
});

const base = (pokemon: Pokemon, simulated = false) => ({ pokemon, simulated }) as never;

function moduleOf(name: string) {
  const module = declRegistry.get(name);
  expect(module, `${name} must be declared`).toBeDefined();
  return module!;
}

describe("PostTurnStatusHealAbAttr (Poison Heal)", () => {
  it("heals only with a listed status and below full HP, in that order, and a rebuilt gate can be swapped", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(POISON_HEAL).attrs[0] as PostTurnStatusHealAbAttr;
    const rebuilt = recomposeAttr(
      moduleOf("PostTurnStatusHealAbAttr"),
      original,
      POISON_HEAL,
      0,
    ) as PostTurnStatusHealAbAttr;
    expect(rebuilt).not.toBe(original);
    for (const status of [StatusEffect.NONE, StatusEffect.POISON, StatusEffect.TOXIC, StatusEffect.BURN]) {
      for (const hp of [holder.getMaxHp(), holder.getMaxHp() - 1, 1]) {
        setStatusOf(holder, status);
        holder.hp = hp;
        const expected = (status === StatusEffect.POISON || status === StatusEffect.TOXIC) && hp < holder.getMaxHp();
        expect(original.canApply(base(holder))).toBe(expected);
        expect(rebuilt.canApply(base(holder))).toBe(expected);
      }
    }
    // A staff rule that drops the "not at full HP" IF: the status guard is NOT a toggle, so a burned holder still fails.
    const always = recomposeAttr(moduleOf("PostTurnStatusHealAbAttr"), original, POISON_HEAL, 0, {
      conds: { gate: { all: [] } },
    }) as PostTurnStatusHealAbAttr;
    holder.hp = holder.getMaxHp();
    setStatusOf(holder, StatusEffect.POISON);
    expect(original.canApply(base(holder))).toBe(false);
    expect(always.canApply(base(holder))).toBe(true);
    setStatusOf(holder, StatusEffect.BURN);
    expect(always.canApply(base(holder))).toBe(false);
  });

  it("heals toDmgValue(maxHp / 8) with the Poison Heal message, and does nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(POISON_HEAL).attrs[0] as PostTurnStatusHealAbAttr;
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    original.apply(base(holder, true));
    expect(spy).not.toHaveBeenCalled();
    original.apply(base(holder));
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0] as unknown[];
    expect(args[0]).toBe("PokemonHealPhase");
    expect(args[2]).toBe(Math.max(Math.floor(holder.getMaxHp() / 8), 1));
  });
});

describe("PostTurnResetStatusAbAttr (Shed Skin, Hydration, Healer ...)", () => {
  it("cures a status or an ER ailment tag on me; the rebuild agrees, and the FAINT status is the one documented difference", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(SHED_SKIN).attrs[0] as PostTurnResetStatusAbAttr;
    const rebuilt = recomposeAttr(
      moduleOf("PostTurnResetStatusAbAttr"),
      original,
      SHED_SKIN,
      0,
    ) as PostTurnResetStatusAbAttr;
    const tags = new Set<BattlerTagType>();
    vi.spyOn(holder, "getTag").mockImplementation(((type: BattlerTagType) =>
      tags.has(type) ? ({} as never) : undefined) as never);
    const cases: [string, StatusEffect, BattlerTagType[], boolean][] = [
      ["nothing", StatusEffect.NONE, [], false],
      ["burn", StatusEffect.BURN, [], true],
      ["bleed", StatusEffect.NONE, [BattlerTagType.ER_BLEED], true],
      ["frostbite", StatusEffect.NONE, [BattlerTagType.ER_FROSTBITE], true],
      ["fear", StatusEffect.NONE, [BattlerTagType.ER_FEAR], true],
      ["a tag that is not an ailment", StatusEffect.NONE, [BattlerTagType.CONFUSED], false],
      ["burn and bleed", StatusEffect.BURN, [BattlerTagType.ER_BLEED], true],
    ];
    for (const [name, status, tagList, expected] of cases) {
      setStatusOf(holder, status);
      tags.clear();
      for (const tag of tagList) {
        tags.add(tag);
      }
      expect(original.canApply(base(holder)), `original, ${name}`).toBe(expected);
      expect(rebuilt.canApply(base(holder)), `rebuild, ${name}`).toBe(expected);
    }
    // FAINT with no tag: the class says no, the library atom (status ANY) says yes. Unreachable in a battle (the holder comes from
    // getField(true), living Pokemon only); recorded here so the difference is on paper.
    tags.clear();
    holder.status = new Status(StatusEffect.FAINT);
    expect(original.canApply(base(holder))).toBe(false);
    expect(rebuilt.canApply(base(holder))).toBe(true);
  });

  it("ally mode picks the first adjacent ally with a status, skips a fainted one, and the gate reads the CURED Pokemon", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(HEALER).attrs[0] as PostTurnResetStatusAbAttr;
    const self = liveAbility(HEALER).attrs[1] as PostTurnResetStatusAbAttr;
    const module = moduleOf("PostTurnResetStatusAbAttr");
    const rebuilt = recomposeAttr(module, original, HEALER, 0) as PostTurnResetStatusAbAttr;
    // The foe is a stand-in for a Pokemon standing next to the holder.
    vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([foe] as never);
    setStatusOf(holder, StatusEffect.NONE);
    setStatusOf(foe, StatusEffect.NONE);
    expect(original.canApply(base(holder))).toBe(false);
    expect(rebuilt.canApply(base(holder))).toBe(false);
    setStatusOf(foe, StatusEffect.BURN);
    expect(original.canApply(base(holder))).toBe(true);
    expect(rebuilt.canApply(base(holder))).toBe(true);
    // A status on ME does not count in ally mode, and the self attr of the same ability still sees it.
    setStatusOf(foe, StatusEffect.NONE);
    setStatusOf(holder, StatusEffect.PARALYSIS);
    expect(original.canApply(base(holder))).toBe(false);
    expect(rebuilt.canApply(base(holder))).toBe(false);
    expect(self.canApply(base(holder))).toBe(true);
    // A fainted ally (status FAINT) is never picked.
    holder.status = null;
    foe.status = new Status(StatusEffect.FAINT);
    expect(original.canApply(base(holder))).toBe(false);
    expect(rebuilt.canApply(base(holder))).toBe(false);
    // The staff gate "the Pokemon to cure is at 50% HP or less" reads the ally, not me.
    const lowOnly = recomposeAttr(module, original, HEALER, 0, {
      conds: { gate: { block: "hp.at-most", params: { who: "holder", pct: 50, rounding: "exact" } } },
    }) as PostTurnResetStatusAbAttr;
    setStatusOf(foe, StatusEffect.BURN);
    foe.hp = foe.getMaxHp();
    holder.hp = 1;
    expect(lowOnly.canApply(base(holder))).toBe(false);
    foe.hp = Math.floor(foe.getMaxHp() / 2);
    holder.hp = holder.getMaxHp();
    expect(lowOnly.canApply(base(holder))).toBe(true);
  });

  it("apply cures the picked ally (not me): it queues the reset for the ally only, clears ER tags at once, and does nothing when simulated", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(HEALER).attrs[0] as PostTurnResetStatusAbAttr;
    const module = moduleOf("PostTurnResetStatusAbAttr");
    const rebuilt = recomposeAttr(module, original, HEALER, 0) as PostTurnResetStatusAbAttr;
    vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([foe] as never);
    const message = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined as never);
    const phases = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    for (const attr of [original, rebuilt]) {
      message.mockClear();
      phases.mockClear();
      setStatusOf(holder, StatusEffect.PARALYSIS);
      setStatusOf(foe, StatusEffect.BURN);
      expect(attr.canApply(base(holder))).toBe(true);
      attr.apply(base(holder, true));
      expect(phases).not.toHaveBeenCalled();
      expect(message).not.toHaveBeenCalled();
      attr.apply(base(holder));
      expect(message).toHaveBeenCalledTimes(1);
      expect(phases).toHaveBeenCalledTimes(1);
      const call = phases.mock.calls[0] as unknown[];
      expect(call[0]).toBe("ResetStatusPhase");
      expect(call[1]).toBe(foe);
      expect(holder.status?.effect).toBe(StatusEffect.PARALYSIS);
    }
  });

  it("the attr-level condition (the 30% roll of Shed Skin) is carried over by the rebuild, not lost", async () => {
    await startWorld(phaserGame);
    const original = liveAbility(SHED_SKIN).attrs[0] as PostTurnResetStatusAbAttr;
    const rebuilt = recomposeAttr(moduleOf("PostTurnResetStatusAbAttr"), original, SHED_SKIN, 0);
    expect(original.getCondition()).not.toBeNull();
    expect(rebuilt.getCondition()).not.toBeNull();
    const rnd = Phaser.Math.RND;
    const spy = vi.spyOn(rnd, "integerInRange").mockReturnValue(29);
    expect(rebuilt.getCondition()!(undefined as never)).toBe(true);
    spy.mockReturnValue(30);
    expect(rebuilt.getCondition()!(undefined as never)).toBe(false);
  });
});

describe("SpeedBoostAbAttr (Speed Boost, Max Acceleration)", () => {
  it("the original gate: not on the turn I switched in, not after a failed escape, always for a simulated call", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const id of [SPEED_BOOST, 5379]) {
      const attr = liveAbility(id).attrs[0] as SpeedBoostAbAttr;
      expect(attr.constructor.name).toBe("SpeedBoostAbAttr");
      for (const [switched, failed] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        holder.turnData.switchedInThisTurn = switched;
        holder.turnData.failedRunAway = failed;
        expect(attr.canApply(base(holder))).toBe(!switched && !failed);
        expect(attr.canApply(base(holder, true))).toBe(true);
      }
    }
  });

  it("a staff gate replaces the class gate: with no condition it boosts on the switch-in turn too", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(SPEED_BOOST).attrs[0] as SpeedBoostAbAttr;
    const free = recomposeAttr(moduleOf("SpeedBoostAbAttr"), original, SPEED_BOOST, 0, {
      conds: { gate: { all: [] } },
    }) as SpeedBoostAbAttr;
    holder.turnData.switchedInThisTurn = true;
    expect(original.canApply(base(holder))).toBe(false);
    expect(free.canApply(base(holder))).toBe(true);
    // The unchanged rule keeps the legacy binding, so it is not rebuilt without an override (counted as undecomposed).
    expect(() => recomposeAttr(moduleOf("SpeedBoostAbAttr"), original, SPEED_BOOST, 0)).toThrow(/no library binding/);
  });

  it("apply queues Speed +1", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = liveAbility(SPEED_BOOST).attrs[0] as SpeedBoostAbAttr;
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    attr.apply(base(holder));
    expect(spy.mock.calls[0]).toEqual(["StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPD], 1]);
  });
});

describe("MoodyAbAttr (Moody)", () => {
  async function run(stages: Record<number, number>) {
    const { game, holder } = await startWorld(phaserGame);
    const attr = liveAbility(MOODY).attrs[0] as MoodyAbAttr;
    const stats = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;
    for (const stat of stats) {
      holder.setStatStage(stat, stages[stat] ?? 0);
    }
    const draws: number[] = [];
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation(((range: number) => {
      draws.push(range);
      return 0;
    }) as never);
    const phases: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      phases.push(args);
    }) as never);
    expect(attr.canApply(base(holder))).toBe(true);
    attr.apply(base(holder));
    return { draws, phases, holder };
  }

  it("raises one of five stats by 2 first, then lowers one of the other four by 1, in that draw order", async () => {
    const { draws, phases, holder } = await run({});
    expect(draws).toEqual([5, 4]);
    expect(phases).toEqual([
      ["StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.ATK], 2],
      ["StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.DEF], -1],
    ]);
  });

  it("skips capped stats: all at +6 only lowers (one draw over five), all at -6 only raises", async () => {
    const maxed = { [Stat.ATK]: 6, [Stat.DEF]: 6, [Stat.SPATK]: 6, [Stat.SPDEF]: 6, [Stat.SPD]: 6 };
    const down = await run(maxed);
    expect(down.draws).toEqual([5]);
    expect(down.phases).toHaveLength(1);
    expect(down.phases[0][4]).toBe(-1);
    const floored = { [Stat.ATK]: -6, [Stat.DEF]: -6, [Stat.SPATK]: -6, [Stat.SPDEF]: -6, [Stat.SPD]: -6 };
    const up = await run(floored);
    // Raised first (draw over 5), then nothing can be lowered (the raised stat leaves canLower and the rest are at -6).
    expect(up.draws).toEqual([5]);
    expect(up.phases).toHaveLength(1);
    expect(up.phases[0][4]).toBe(2);
  });

  it("a stat at +6 is never the raised one and a stat at -6 never the lowered one", async () => {
    const { draws, phases } = await run({ [Stat.ATK]: 6, [Stat.DEF]: -6 });
    // canRaise has 4 (no Attack), canLower has 4 (no Defense); the raised stat (index 0 of canRaise = Defense) leaves canLower
    // (which was already without Defense), so the lower pick is over 4 stats.
    expect(draws).toEqual([4, 4]);
    expect(phases[0][3]).toEqual([Stat.DEF]);
    expect(phases[1][3]).toEqual([Stat.ATK]);
  });

  it("does nothing when simulated", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const attr = liveAbility(MOODY).attrs[0] as MoodyAbAttr;
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    const rng = vi.spyOn(game.scene, "randBattleSeedInt");
    attr.apply(base(holder, true));
    expect(spy).not.toHaveBeenCalled();
    expect(rng).not.toHaveBeenCalled();
  });
});

describe("PostTurnRestoreBerryAbAttr (Harvest)", () => {
  it("draws nothing without a restorable berry, one float with one (even at 100%), then one int to pick", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = new PostTurnRestoreBerryAbAttr(() => 1);
    const frac = vi.spyOn(Phaser.Math.RND, "frac").mockReturnValue(0.5);
    const int = vi.spyOn(Phaser.Math.RND, "integerInRange").mockReturnValue(0);
    holder.battleData.berriesEaten = [];
    expect(attr.canApply(base(holder))).toBe(false);
    expect(frac).not.toHaveBeenCalled();
    holder.battleData.berriesEaten = [BerryType.SITRUS, BerryType.LUM];
    expect(attr.canApply(base(holder))).toBe(true);
    expect(frac).toHaveBeenCalledTimes(1);
    expect(int).not.toHaveBeenCalled();
    const never = new PostTurnRestoreBerryAbAttr(() => 0);
    expect(never.canApply(base(holder))).toBe(false);
    expect(frac).toHaveBeenCalledTimes(2);
  });

  it("the chance closure is compared with >= the drawn float", async () => {
    const { holder } = await startWorld(phaserGame);
    holder.battleData.berriesEaten = [BerryType.SITRUS];
    const half = new PostTurnRestoreBerryAbAttr(() => 0.5);
    const frac = vi.spyOn(Phaser.Math.RND, "frac");
    frac.mockReturnValue(0.5);
    expect(half.canApply(base(holder))).toBe(true);
    frac.mockReturnValue(0.5000001);
    expect(half.canApply(base(holder))).toBe(false);
  });

  it("every live user keeps a legacy binding for its chance closure (so none is silently rebuilt wrong)", async () => {
    await startWorld(phaserGame);
    for (const [id, index] of [
      [139, 0],
      [5111, 3],
      [5502, 1],
      [5970, 0],
      [6055, 0],
    ] as const) {
      const attr = liveAbility(id).attrs[index];
      expect(attr.constructor.name).toBe("PostTurnRestoreBerryAbAttr");
      expect(() => recomposeAttr(moduleOf("PostTurnRestoreBerryAbAttr"), attr, id, index)).toThrow(
        /no library binding/,
      );
    }
  });
});

describe("Cud Chew: CudChewRecordBerryAbAttr and CudChewConsumeBerryAbAttr", () => {
  it("Cud Chew lists Consume first and Record second", async () => {
    await startWorld(phaserGame);
    const attrs = liveAbility(CUD_CHEW).attrs;
    expect(attrs[0]).toBeInstanceOf(CudChewConsumeBerryAbAttr);
    expect(attrs[1]).toBeInstanceOf(CudChewRecordBerryAbAttr);
  });

  it("Record copies this turn's berries into the memory, even when simulated (a class oddity), as the same array object", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = liveAbility(CUD_CHEW).attrs[1] as CudChewRecordBerryAbAttr;
    expect(attr.canApply(base(holder))).toBe(true);
    holder.turnData.berriesEaten = [BerryType.SITRUS, BerryType.LUM];
    attr.apply(base(holder, true));
    expect(holder.summonData.berriesEatenLast).toBe(holder.turnData.berriesEaten);
    expect(holder.summonData.berriesEatenLast).toEqual([BerryType.SITRUS, BerryType.LUM]);
    const rebuilt = recomposeAttr(moduleOf("CudChewRecordBerryAbAttr"), attr, CUD_CHEW, 1);
    expect(rebuilt).not.toBe(attr);
    expect(rebuilt.constructor.name).toBe("CudChewRecordBerryAbAttr");
    expect(rebuilt.showAbility).toBe(false);
  });

  it("Consume's gate is 'I ate a berry last turn'; a staff gate replaces it; apply replays every remembered berry for free", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = liveAbility(CUD_CHEW).attrs[0] as CudChewConsumeBerryAbAttr;
    holder.summonData.berriesEatenLast = [];
    expect(attr.canApply(base(holder))).toBe(false);
    holder.summonData.berriesEatenLast = [BerryType.SITRUS];
    expect(attr.canApply(base(holder))).toBe(true);
    // The parked declaration builds the same class with a swapped gate.
    const pending = (
      await import("#data/elite-redux/ability-studio/decl/B06/pending/CudChewConsumeBerryAbAttr.decl.pending")
    ).default;
    const free = buildAttr(pending, {}, { gate: { all: [] } }) as CudChewConsumeBerryAbAttr;
    holder.summonData.berriesEatenLast = [];
    expect(free.canApply(base(holder))).toBe(true);
    expect(free.constructor.name).toBe("CudChewConsumeBerryAbAttr");
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    holder.summonData.berriesEatenLast = [];
    attr.apply(base(holder));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("CommonAnimPhase");
  });

  it("the parked declaration is complete: its only lint problem is the trigger that does not exist yet", async () => {
    const pending = (
      await import("#data/elite-redux/ability-studio/decl/B06/pending/CudChewConsumeBerryAbAttr.decl.pending")
    ).default;
    const problems = lintDecl(pending);
    expect(problems).toEqual(['CudChewConsumeBerryAbAttr: when "event.berry-phase-end" is not in WHEN_REGISTRY']);
  });
});

describe("PostTurnFormChangeAbAttr (Zen Mode and friends)", () => {
  it("only an existing form that differs from the current one counts; the function is called before the checks", async () => {
    const { holder } = await startWorld(phaserGame, { holder: SpeciesId.DARMANITAN });
    expect(holder.species.forms.length).toBeGreaterThan(1);
    const module = moduleOf("PostTurnFormChangeAbAttr");
    const target = { value: 0 };
    const attr = buildAttr(
      module,
      {},
      { "ctor:0": ((_p: Pokemon) => target.value) as never },
    ) as PostTurnFormChangeAbAttr;
    expect(attr.constructor.name).toBe("PostTurnFormChangeAbAttr");
    holder.formIndex = 0;
    for (const [value, expected] of [
      [0, false], // already the right form
      [1, true], // an existing, different form
      [-1, false], // below the range
      [holder.species.forms.length, false], // one past the last form
      [999, false],
    ] as const) {
      target.value = value;
      expect(attr.canApply(base(holder)), `target form ${value}`).toBe(expected);
    }
  });

  it("Zen Mode's own function: form 1 at half HP or less, form 0 above, so it fires only when the form is wrong", async () => {
    const { game, holder } = await startWorld(phaserGame, { holder: SpeciesId.DARMANITAN });
    const attr = liveAbility(ZEN_MODE).attrs[2] as PostTurnFormChangeAbAttr;
    expect(attr.constructor.name).toBe("PostTurnFormChangeAbAttr");
    holder.formIndex = 0;
    holder.hp = holder.getMaxHp();
    expect(attr.canApply(base(holder))).toBe(false);
    holder.hp = Math.floor(holder.getMaxHp() / 2);
    expect(attr.canApply(base(holder))).toBe(true);
    holder.formIndex = 1;
    expect(attr.canApply(base(holder))).toBe(false);
    holder.hp = holder.getMaxHp();
    expect(attr.canApply(base(holder))).toBe(true);
    expect(game.scene).toBeDefined();
  });

  it("apply asks the scene for the ability form change (never a named form) and does nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame, { holder: SpeciesId.DARMANITAN });
    const attr = liveAbility(ZEN_MODE).attrs[2] as PostTurnFormChangeAbAttr;
    const spy = vi.spyOn(globalScene, "triggerPokemonFormChange").mockImplementation(() => false as never);
    attr.apply(base(holder, true));
    expect(spy).not.toHaveBeenCalled();
    attr.apply(base(holder));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(holder);
  });

  it("Hunger Switch's two attrs are the two directions of the toggle for Morpeko (each fires in exactly one form)", async () => {
    const { holder } = await startWorld(phaserGame, { holder: SpeciesId.MORPEKO });
    const [first, second] = [liveAbility(258).attrs[0], liveAbility(258).attrs[1]] as PostTurnFormChangeAbAttr[];
    expect(holder.species.forms.length).toBe(2);
    // Both form keys are non-empty (full-belly, hangry): attr 0 asks for form 0 and attr 1 for form 1.
    holder.formIndex = 0;
    expect(first.canApply(base(holder)), "attr 0 in the full-belly form").toBe(false);
    expect(second.canApply(base(holder)), "attr 1 in the full-belly form").toBe(true);
    holder.formIndex = 1;
    expect(first.canApply(base(holder)), "attr 0 in the hangry form").toBe(true);
    expect(second.canApply(base(holder)), "attr 1 in the hangry form").toBe(false);
  });
});

describe("the wiring of the declarations", () => {
  it("all eight classes of the chunk exist in the live game and seven are declared (Consume is parked)", async () => {
    await startWorld(phaserGame);
    const declared = [
      "PostTurnStatusHealAbAttr",
      "PostTurnResetStatusAbAttr",
      "PostTurnRestoreBerryAbAttr",
      "CudChewRecordBerryAbAttr",
      "MoodyAbAttr",
      "SpeedBoostAbAttr",
      "PostTurnFormChangeAbAttr",
    ];
    for (const name of declared) {
      expect(declRegistry.has(name), name).toBe(true);
    }
    expect(declRegistry.has("CudChewConsumeBerryAbAttr")).toBe(false);
  });
});
