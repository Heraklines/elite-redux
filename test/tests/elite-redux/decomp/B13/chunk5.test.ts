/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 5: Eclipse Wing (5971, attrs 0 and 2), Skyhook (5978), Living Chrome (5980, attr 1), Boot Hill (5985), Encore Set
// (5988, attr 1), Reduction (5991) and the Cracked Vessel entry restore (5992, attr 1). The shared L1 and L2 suites cannot make a
// remembered move, a shape memory, a consumed field, a knocked-out target or a cracked vessel, so the probes here drive those states
// through the real helpers and compare each original attr with its rebuild. They also prove the old literals are the defaults of the
// new constructor arguments, that a different argument changes the effect, and that a swapped gate does not drop the clauses that
// stay in the class.
import type { AbAttr } from "#abilities/ab-attrs";
import { ForceSwitchOutHelper } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import {
  applyGraveMarkerOnEntry,
  applyPendingSkyhookEntryBoost,
  type BootHillAbAttr,
  type CrackedVesselRestoreTypesAbAttr,
  type EclipseWingMarkerAbAttr,
  type EclipseWingPowerAbAttr,
  type EncoreSetAbAttr,
  finishReductionMove,
  isSignatureFollowup,
  type LivingChromeReductionAbAttr,
  prepareReductionMove,
  type ReductionPowerAbAttr,
  recordLivingChromeTransformation,
  type SkyhookAbAttr,
  tryCrackedVessel,
  tryEclipseWing,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ECLIPSE_WING = 5971;
const SKYHOOK = 5978;
const LIVING_CHROME = 5980;
const BOOT_HILL = 5985;
const ENCORE_SET = 5988;
const REDUCTION = 5991;
const CRACKED_VESSEL = 5992;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

const damaging = { block: "move.damaging", params: {} } as never;
const sameGate = (attr: { gate(p: never): boolean }): never => ((p: never) => attr.gate(p)) as never;

describe("B13 chunk 5", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  function holderUses(holder: Pokemon, move = MoveId.TACKLE): void {
    holder.pushMoveHistory({
      move,
      targets: [BattlerIndex.ENEMY],
      useMode: MoveUseMode.NORMAL,
      result: MoveResult.SUCCESS,
    });
  }
  const hit = (
    holder: Pokemon,
    foe: Pokemon,
    move: MoveId | ReturnType<typeof allMoves.at> = MoveId.TACKLE,
    damage = 10,
    simulated = false,
  ): never =>
    ({
      pokemon: holder,
      opponent: foe,
      move: typeof move === "number" ? allMoves[move] : move,
      damage,
      hitResult: HitResult.EFFECTIVE,
      simulated,
    }) as never;

  /** A real follow-up move: the replay of Tackle that the ability itself queues (signatureFollowup is not exported). */
  function makeEcho(holder: Pokemon, foe: Pokemon): Move {
    const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
    const [reset, replay] = liveAbility(ENCORE_SET).attrs as [AbAttr, EncoreSetAbAttr];
    reset.apply({ pokemon: holder, simulated: false } as never);
    holderUses(holder, MoveId.TACKLE);
    replay.apply(hit(holder, foe, MoveId.TACKLE));
    holderUses(holder, MoveId.EMBER);
    replay.apply(hit(holder, foe, MoveId.EMBER));
    const move = (queued.mock.calls.at(-1)?.[3] as { getMove(): Move }).getMove();
    reset.apply({ pokemon: holder, simulated: false } as never); // leave the memory empty
    queued.mockRestore();
    return move;
  }

  it("the shipped instances carry the old literals, which are the defaults of the new constructor arguments", () => {
    expect((liveAbility(ECLIPSE_WING).attrs[0] as EclipseWingPowerAbAttr).getPowerMultiplier()).toBe(1.5);
    expect((liveAbility(REDUCTION).attrs[0] as ReductionPowerAbAttr).getPowerMultiplier()).toBe(1.5);
    expect((liveAbility(SKYHOOK).attrs[0] as SkyhookAbAttr).speedBoostChancePercent).toBe(20);
    expect((liveAbility(ENCORE_SET).attrs[1] as EncoreSetAbAttr).replayPercent).toBe(40);
    expect(40 / 100).toBe(0.4); // the very same double as the old literal
    const chrome = liveAbility(LIVING_CHROME).attrs[1] as LivingChromeReductionAbAttr;
    expect([chrome.typeMultiplier, chrome.flatMultiplier]).toEqual([0.5, 0.75]);
  });

  describe("Eclipse Wing power", () => {
    const power = (holder: Pokemon, foe: Pokemon, move: MoveId, value = 100): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        power: new NumberHolder(value),
        simulated: false,
      }) as never;
    const out = (attr: AbAttr, holder: Pokemon, foe: Pokemon, move: MoveId): number | undefined => {
      const p = power(holder, foe, move);
      if (!attr.canApply(p)) {
        return;
      }
      attr.apply(p);
      return (p as { power: NumberHolder }).power.value;
    };

    it("boosts Dark and Flying moves only while my rounded HP ratio is below a third; original equals rebuild; the multiplier is a param", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(ECLIPSE_WING).attrs[0] as EclipseWingPowerAbAttr;
      const rebuilt = buildAttr(module("EclipseWingPowerAbAttr"), {}, { gate: sameGate(original) }) as AbAttr;
      const ratio = vi.spyOn(holder, "getHpRatio");
      for (const value of [0.01, 0.32, 0.33, 0.34, 0.5, 1]) {
        ratio.mockReturnValue(value);
        for (const move of [MoveId.BITE, MoveId.WING_ATTACK, MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.EMBER]) {
          expect(out(rebuilt, holder, foe, move), `${allMoves[move].name} at ${value}`).toBe(
            out(original, holder, foe, move),
          );
        }
      }
      ratio.mockReturnValue(0.33);
      expect(out(original, holder, foe, MoveId.BITE)).toBe(150);
      expect(out(original, holder, foe, MoveId.TACKLE)).toBeUndefined();
      ratio.mockReturnValue(0.34);
      expect(out(original, holder, foe, MoveId.BITE)).toBeUndefined(); // 0.34 is not below 1 / 3
      ratio.mockReturnValue(0.33);
      const double = buildAttr(
        module("EclipseWingPowerAbAttr"),
        { multiplier: 2 },
        { gate: sameGate(original) },
      ) as AbAttr;
      expect(out(double, holder, foe, MoveId.WING_ATTACK)).toBe(200);
      const swapped = buildAttr(module("EclipseWingPowerAbAttr"), {}, { gate: () => true }) as AbAttr;
      expect(out(swapped, holder, foe, MoveId.TACKLE)).toBe(150); // the type rule is swappable
      ratio.mockReturnValue(1);
      expect(out(swapped, holder, foe, MoveId.TACKLE)).toBeUndefined(); // the HP rule stays in the class
      vi.restoreAllMocks();
    });
  });

  describe("Eclipse Wing marker", () => {
    it("holds me at 1 HP once per wave from full HP, and only while the marker is present", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const marker = liveAbility(ECLIPSE_WING).attrs[2];
      const attrs = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      holder.hp = holder.getMaxHp();
      expect(tryEclipseWing(holder, foe)).toBe(false); // no marker
      attrs.mockReturnValue([marker] as never);
      holder.hp = holder.getMaxHp() - 1;
      expect(tryEclipseWing(holder, foe)).toBe(false); // not at full HP
      holder.hp = holder.getMaxHp();
      expect(tryEclipseWing(holder, undefined)).toBe(false); // no attacker
      expect(tryEclipseWing(holder, foe)).toBe(true);
      expect(tryEclipseWing(holder, foe)).toBe(false); // once per wave
      vi.restoreAllMocks();
    });
  });

  describe("Skyhook", () => {
    it("pivots out once per turn after the final damaging hit; original equals rebuild; a swapped gate keeps the guards and the residual", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const allowed = vi.spyOn(ForceSwitchOutHelper.prototype, "getSwitchOutCondition").mockReturnValue(true);
      const switched = vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
      const original = liveAbility(SKYHOOK).attrs[0] as SkyhookAbAttr;
      const rebuilt = buildAttr(
        module("SkyhookAbAttr"),
        {},
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as AbAttr;
      const both = (...args: Parameters<typeof hit>): [boolean, boolean] => [
        original.canApply(hit(...args)),
        rebuilt.canApply(hit(...args)),
      ];
      holder.turnData.hitsLeft = 1;
      expect(both(holder, foe)).toEqual([true, true]);
      expect(both(holder, foe, MoveId.SWORDS_DANCE)).toEqual([false, false]); // clause 1, the base attack condition
      expect(both(holder, foe, MoveId.TACKLE, 0)).toEqual([false, false]); // clause 2, no damage
      holder.turnData.hitsLeft = 2;
      expect(both(holder, foe)).toEqual([false, false]); // clause 3, not the final hit
      holder.turnData.hitsLeft = 1;
      allowed.mockReturnValue(false);
      expect(both(holder, foe)).toEqual([false, false]); // the residual: a foe blocks the switch
      allowed.mockReturnValue(true);
      const custom = buildAttr(module("SkyhookAbAttr"), {}, { "ctor:0": damaging, gate: () => true }) as AbAttr;
      // The one random draw: 1 in 100 against the chance, once per apply, never when simulated.
      const draw = vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(19);
      original.apply(hit(holder, foe));
      expect(draw).toHaveBeenCalledTimes(1);
      expect(draw).toHaveBeenCalledWith(100);
      expect(switched).toHaveBeenCalledTimes(1);
      expect(both(holder, foe)).toEqual([false, false]); // the gate: already switched out this turn
      expect(custom.canApply(hit(holder, foe))).toBe(true); // the once-per-turn rule is swappable
      expect(custom.canApply(hit(holder, foe, MoveId.TACKLE, 0))).toBe(false); // the guards stay
      allowed.mockReturnValue(false);
      expect(custom.canApply(hit(holder, foe))).toBe(false); // so does the residual
      allowed.mockReturnValue(true);
      vi.restoreAllMocks();
    });

    it("the Speed boost goes to the next Pokemon that enters my side with the chance in the param, spent once", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
      const draw = vi.spyOn(holder, "randBattleSeedInt");
      const original = liveAbility(SKYHOOK).attrs[0] as SkyhookAbAttr;
      draw.mockReturnValue(19);
      original.apply(hit(holder, foe));
      queued.mockClear();
      applyPendingSkyhookEntryBoost(holder);
      expect(queued).toHaveBeenCalledTimes(1); // 19 < 20: boosted
      queued.mockClear();
      applyPendingSkyhookEntryBoost(holder);
      expect(queued).not.toHaveBeenCalled(); // spent
      draw.mockReturnValue(20);
      original.apply(hit(holder, foe));
      queued.mockClear();
      applyPendingSkyhookEntryBoost(holder);
      expect(queued).not.toHaveBeenCalled(); // 20 is not below 20
      const lucky = buildAttr(
        module("SkyhookAbAttr"),
        { speedBoostChancePercent: 50 },
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as SkyhookAbAttr;
      expect(lucky.speedBoostChancePercent).toBe(50);
      draw.mockReturnValue(49);
      lucky.apply(hit(holder, foe));
      queued.mockClear();
      applyPendingSkyhookEntryBoost(holder);
      expect(queued).toHaveBeenCalledTimes(1);
      draw.mockClear();
      const before = draw.mock.calls.length;
      lucky.apply(hit(holder, foe, MoveId.TACKLE, 10, true));
      expect(draw.mock.calls.length).toBe(before); // simulated: no draw (the turn memory is still spent, see the notes)
      vi.restoreAllMocks();
    });
  });

  describe("Boot Hill", () => {
    it("plants the marker only when a damaging move knocked the target out; original equals rebuild; a swapped gate keeps the rest", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const echo = makeEcho(holder, foe);
      const planted = vi.spyOn(globalScene.arena, "addTag").mockReturnValue(true);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const original = liveAbility(BOOT_HILL).attrs[0] as BootHillAbAttr;
      const rebuilt = buildAttr(
        module("BootHillAbAttr"),
        {},
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as AbAttr;
      const fainted = vi.spyOn(foe, "isFainted").mockReturnValue(false);
      const both = (...args: Parameters<typeof hit>): [boolean, boolean] => [
        original.canApply(hit(...args)),
        rebuilt.canApply(hit(...args)),
      ];
      expect(both(holder, foe)).toEqual([false, false]); // the target is standing
      fainted.mockReturnValue(true);
      expect(both(holder, foe)).toEqual([true, true]);
      expect(both(holder, foe, MoveId.SWORDS_DANCE)).toEqual([false, false]); // clause 1, the base attack condition
      expect(both(holder, foe, MoveId.TACKLE, 0)).toEqual([false, false]); // clause 2, no damage
      expect(isSignatureFollowup(echo)).toBe(true);
      expect(both(holder, foe, echo)).toEqual([false, false]); // the residual: one of the ability's own follow-up moves
      const custom = buildAttr(module("BootHillAbAttr"), {}, { "ctor:0": damaging, gate: () => true }) as AbAttr;
      fainted.mockReturnValue(false);
      expect(custom.canApply(hit(holder, foe))).toBe(true); // the knock-out rule is swappable
      expect(custom.canApply(hit(holder, foe, MoveId.TACKLE, 0))).toBe(false); // the guards stay
      expect(custom.canApply(hit(holder, foe, echo))).toBe(false); // so does the residual
      original.apply(hit(holder, foe));
      expect(planted).toHaveBeenCalledWith(
        ArenaTagType.GRAVE_MARKER,
        0,
        undefined,
        holder.id,
        ArenaTagSide.ENEMY,
        true,
      );
      vi.restoreAllMocks();
    });
  });

  describe("Numbers inside the packages are editable and default to the shipped values", () => {
    it("Skyhook gives the number of Speed stages in the param (default 1) and none when the roll fails", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
      const draw = vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(0);
      const original = liveAbility(SKYHOOK).attrs[0] as SkyhookAbAttr;
      expect(original.speedBoostStages).toBe(1);
      original.apply(hit(holder, foe));
      queued.mockClear();
      applyPendingSkyhookEntryBoost(holder);
      expect(queued.mock.calls[0]?.[0]).toBe("StatStageChangePhase");
      expect(queued.mock.calls[0]?.[3]).toEqual([Stat.SPD]);
      expect(queued.mock.calls[0]?.[4]).toBe(1);
      const strong = buildAttr(
        module("SkyhookAbAttr"),
        { speedBoostStages: 3 },
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as SkyhookAbAttr;
      strong.apply(hit(holder, foe));
      queued.mockClear();
      applyPendingSkyhookEntryBoost(holder);
      expect(queued.mock.calls[0]?.[4]).toBe(3);
      draw.mockReturnValue(99);
      strong.apply(hit(holder, foe));
      queued.mockClear();
      applyPendingSkyhookEntryBoost(holder);
      expect(queued).not.toHaveBeenCalled(); // the roll failed: stored 0 means no boost
      vi.restoreAllMocks();
    });

    it("Boot Hill's marker takes the planter's damage share and Speed stages (defaults 1/8 and 1), and the defaults when the planter is gone", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const original = liveAbility(BOOT_HILL).attrs[0] as BootHillAbAttr;
      expect([original.damageDivisor, original.speedStages]).toEqual([8, 1]);
      const custom = buildAttr(
        module("BootHillAbAttr"),
        { damageDivisor: 4, speedStages: 2 },
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as BootHillAbAttr;
      vi.spyOn(globalScene.arena, "getTagOnSide").mockReturnValue({ sourceId: holder.id } as never);
      vi.spyOn(globalScene.arena, "removeTagOnSide").mockReturnValue(true);
      const planter = vi.spyOn(globalScene, "getPokemonById").mockReturnValue(holder);
      const attrs = vi.spyOn(holder, "getAllActiveAbilityAttrs");
      vi.spyOn(foe, "getMaxHp").mockReturnValue(100);
      vi.spyOn(foe, "isFainted").mockReturnValue(false);
      vi.spyOn(foe, "getStatStage").mockReturnValue(0);
      const damage = vi.spyOn(foe, "damageAndUpdate").mockReturnValue(0 as never);
      const stage = vi.spyOn(foe, "setStatStage").mockImplementation(() => undefined);
      const run = (): [unknown, unknown] => {
        damage.mockClear();
        stage.mockClear();
        applyGraveMarkerOnEntry(foe);
        return [damage.mock.calls[0]?.[0], stage.mock.calls[0]?.[1]];
      };
      attrs.mockReturnValue([original] as never);
      expect(run()).toEqual([12, -1]); // floor(100 / 8), one stage down: the shipped behaviour
      attrs.mockReturnValue([custom] as never);
      expect(run()).toEqual([25, -2]);
      planter.mockReturnValue(undefined);
      expect(run()).toEqual([12, -1]); // planter gone: the shipped values
      planter.mockReturnValue(holder);
      attrs.mockReturnValue([] as never);
      expect(run()).toEqual([12, -1]); // planter without the block: the shipped values
      vi.restoreAllMocks();
    });

    it("Eclipse Wing's counter-strike reads its power and type from the marker (defaults 120 and Dark)", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const marker = liveAbility(ECLIPSE_WING).attrs[2] as EclipseWingMarkerAbAttr;
      expect([marker.counterPower, marker.counterType]).toEqual([120, PokemonType.DARK]);
      const custom = buildAttr(
        module("EclipseWingMarkerAbAttr"),
        { counterPower: 80, counterType: "Fairy" },
        {},
      ) as EclipseWingMarkerAbAttr;
      expect([custom.counterPower, custom.counterType]).toEqual([80, PokemonType.FAIRY]);
      const counterOf = (): { power: number; type: PokemonType } => {
        const move = (queued.mock.calls.at(-1)?.[3] as { getMove(): Move }).getMove();
        return { power: move.power, type: move.type };
      };
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([marker] as never);
      vi.spyOn(foe, "getAllActiveAbilityAttrs").mockReturnValue([custom] as never);
      holder.hp = holder.getMaxHp();
      foe.hp = foe.getMaxHp();
      expect(tryEclipseWing(holder, foe)).toBe(true);
      expect(counterOf()).toEqual({ power: 120, type: PokemonType.DARK });
      expect(tryEclipseWing(foe, holder)).toBe(true);
      expect(counterOf()).toEqual({ power: 80, type: PokemonType.FAIRY });
      vi.restoreAllMocks();
    });
  });

  describe("Encore Set", () => {
    it("replays the previous different move at the share in the param, once per move used; original equals rebuild", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const followup = makeEcho(holder, foe);
      const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const [reset, original] = liveAbility(ENCORE_SET).attrs as [AbAttr, EncoreSetAbAttr];
      const rebuilt = buildAttr(module("EncoreSetAbAttr"), {}, { "ctor:0": damaging }) as AbAttr;
      const both = (...args: Parameters<typeof hit>): [boolean, boolean] => [
        original.canApply(hit(...args)),
        rebuilt.canApply(hit(...args)),
      ];
      const echoPower = (): number =>
        (queued.mock.calls.at(-1)?.[3] as { getMove(): { power: number } }).getMove().power;
      reset.apply({ pokemon: holder, simulated: false } as never);
      holderUses(holder, MoveId.TACKLE);
      expect(both(holder, foe)).toEqual([true, true]);
      expect(both(holder, foe, MoveId.SWORDS_DANCE)).toEqual([false, false]); // clause 1, the base attack condition
      expect(both(holder, foe, MoveId.TACKLE, 0)).toEqual([false, false]); // clause 2, no damage

      expect(both(holder, foe, followup)).toEqual([false, false]); // clause 3, an echo never starts an echo
      original.apply(hit(holder, foe, MoveId.TACKLE)); // remembers Tackle, nothing to replay yet
      expect(queued).not.toHaveBeenCalled();
      expect(both(holder, foe)).toEqual([false, false]); // clause 5, this move use is counted
      holderUses(holder, MoveId.EMBER);
      expect(both(holder, foe, MoveId.EMBER)).toEqual([true, true]);
      original.apply(hit(holder, foe, MoveId.EMBER)); // replays Tackle
      expect(queued).toHaveBeenCalledTimes(1);
      expect(echoPower()).toBe(Math.floor(allMoves[MoveId.TACKLE].power * 0.4));
      // The same move twice in a row is not replayed.
      holderUses(holder, MoveId.EMBER);
      original.apply(hit(holder, foe, MoveId.EMBER));
      expect(queued).toHaveBeenCalledTimes(1);
      // A different share changes the echo; the rest is the same code.
      const full = buildAttr(
        module("EncoreSetAbAttr"),
        { replayPercent: 100 },
        { "ctor:0": damaging },
      ) as EncoreSetAbAttr;
      expect(full.replayPercent).toBe(100);
      holderUses(holder, MoveId.WATER_GUN);
      full.apply(hit(holder, foe, MoveId.WATER_GUN)); // replays Ember
      expect(queued).toHaveBeenCalledTimes(2);
      expect(echoPower()).toBe(Math.floor(allMoves[MoveId.EMBER].power * 1));
      // Simulated: nothing is queued, but the memory is spent (an oddity recorded in the notes).
      holderUses(holder, MoveId.TACKLE);
      original.apply(hit(holder, foe, MoveId.TACKLE, 10, true));
      expect(queued).toHaveBeenCalledTimes(2);
      expect(original.canApply(hit(holder, foe))).toBe(false);
      vi.restoreAllMocks();
    });
  });

  describe("Reduction", () => {
    it("boosts only the move that consumed the field this turn; original equals rebuild; the multiplier is a param", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const original = liveAbility(REDUCTION).attrs[0] as ReductionPowerAbAttr;
      const rebuilt = buildAttr(module("ReductionPowerAbAttr"), {}, { gate: sameGate(original) }) as AbAttr;
      const power = (move: MoveId): never =>
        ({
          pokemon: holder,
          opponent: foe,
          move: allMoves[move],
          power: new NumberHolder(100),
          simulated: false,
        }) as never;
      const both = (move: MoveId): [boolean, boolean] => [
        original.canApply(power(move)),
        rebuilt.canApply(power(move)),
      ];
      expect(both(MoveId.TACKLE)).toEqual([false, false]); // nothing consumed
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([original] as never);
      vi.spyOn(globalScene.arena, "weatherType", "get").mockReturnValue(WeatherType.RAIN);
      vi.spyOn(globalScene.arena, "trySetWeather").mockReturnValue(true);
      prepareReductionMove(holder, allMoves[MoveId.TACKLE]);
      expect(both(MoveId.TACKLE)).toEqual([true, true]);
      expect(both(MoveId.EMBER)).toEqual([false, false]); // another move
      const p = power(MoveId.TACKLE);
      original.apply(p);
      expect((p as { power: NumberHolder }).power.value).toBe(150);
      const double = buildAttr(
        module("ReductionPowerAbAttr"),
        { multiplier: 2 },
        { gate: sameGate(original) },
      ) as AbAttr;
      const q = power(MoveId.TACKLE);
      double.apply(q);
      expect((q as { power: NumberHolder }).power.value).toBe(200);
      const swapped = buildAttr(module("ReductionPowerAbAttr"), {}, { gate: () => true }) as AbAttr;
      expect(swapped.canApply(power(MoveId.EMBER))).toBe(true); // the memory rule is swappable
      finishReductionMove(holder, allMoves[MoveId.TACKLE]);
      expect(both(MoveId.TACKLE)).toEqual([false, false]); // spent
      vi.restoreAllMocks();
    });
  });

  describe("Living Chrome", () => {
    it("takes the multiplier from a type I left, for the turn I changed shape only; original equals rebuild; the flat Eevee case", async () => {
      const { holder, foe } = await startWorld(phaserGame, { holder: SpeciesId.EEVEE });
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const [marker, original] = liveAbility(LIVING_CHROME).attrs as [AbAttr, LivingChromeReductionAbAttr];
      const rebuilt = buildAttr(module("LivingChromeReductionAbAttr"), {}, { gate: sameGate(original) }) as AbAttr;
      const damage = (move: MoveId, value = 100): never =>
        ({
          pokemon: holder,
          opponent: foe,
          move: allMoves[move],
          damage: new NumberHolder(value),
          simulated: false,
        }) as never;
      const out = (attr: AbAttr, move: MoveId, value = 100): number | undefined => {
        const p = damage(move, value);
        if (!attr.canApply(p)) {
          return;
        }
        attr.apply(p);
        return (p as { damage: NumberHolder }).damage.value;
      };
      const same = (move: MoveId, value = 100): void =>
        expect(out(rebuilt, move, value), `${allMoves[move].name} for ${value}`).toBe(out(original, move, value));
      same(MoveId.WATER_GUN); // no memory yet
      expect(out(original, MoveId.WATER_GUN)).toBeUndefined();
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([marker] as never);
      // Left the Fire and Water form (index 1): the types are remembered, not flat.
      recordLivingChromeTransformation(holder, [PokemonType.FIRE, PokemonType.WATER], 1);
      for (const move of [MoveId.WATER_GUN, MoveId.EMBER, MoveId.BITE, MoveId.TACKLE]) {
        same(move);
        same(move, 1);
      }
      expect(out(original, MoveId.WATER_GUN)).toBe(50);
      expect(out(original, MoveId.WATER_GUN, 1)).toBe(0); // rounded DOWN, unlike the library damage multiplier
      expect(out(original, MoveId.BITE)).toBeUndefined();
      // Leaving the base Eevee form: flat, every type.
      recordLivingChromeTransformation(holder, [PokemonType.NORMAL], 0);
      for (const move of [MoveId.WATER_GUN, MoveId.BITE, MoveId.TACKLE]) {
        same(move);
      }
      expect(out(original, MoveId.BITE)).toBe(75);
      const weaker = buildAttr(
        module("LivingChromeReductionAbAttr"),
        { typeMultiplier: 0.25, flatMultiplier: 0.9 },
        { gate: sameGate(original) },
      ) as AbAttr;
      expect(out(weaker, MoveId.BITE)).toBe(90);
      const swapped = buildAttr(module("LivingChromeReductionAbAttr"), {}, { gate: () => true }) as AbAttr;
      expect(out(swapped, MoveId.BITE)).toBe(75); // the memory rule is swappable; apply still reads the memory
      // The memory only lasts for the turn it was made.
      globalScene.currentBattle.turn += 1;
      same(MoveId.BITE);
      expect(out(original, MoveId.BITE)).toBeUndefined();
      globalScene.currentBattle.turn -= 1;
      vi.restoreAllMocks();
    });
  });

  describe("Cracked Vessel entry restore", () => {
    it("restores the remembered shorter type list only after the vessel cracked", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      vi.spyOn(globalScene.arena, "trySetWeather").mockReturnValue(true);
      vi.spyOn(holder, "updateInfo").mockImplementation(() => undefined as never);
      const [marker, original] = liveAbility(CRACKED_VESSEL).attrs as [AbAttr, CrackedVesselRestoreTypesAbAttr];
      const rebuilt = buildAttr(module("CrackedVesselRestoreTypesAbAttr"), {}, {}) as AbAttr;
      const base = { pokemon: holder, simulated: false } as never;
      expect([original.canApply(base), rebuilt.canApply(base)]).toEqual([false, false]); // nothing remembered
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([marker] as never);
      vi.spyOn(holder, "getTypes").mockReturnValue([PokemonType.NORMAL, PokemonType.FAIRY]);
      vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([]);
      vi.spyOn(holder, "getAdjacentOpponents").mockReturnValue([]);
      expect(tryCrackedVessel(holder, foe)).toBe(true);
      expect(holder.summonData.types).toEqual([PokemonType.NORMAL]);
      expect([original.canApply(base), rebuilt.canApply(base)]).toEqual([true, true]);
      holder.summonData.types = [PokemonType.NORMAL, PokemonType.FAIRY]; // the full list comes back, as after a switch
      rebuilt.apply(base);
      expect(holder.summonData.types).toEqual([PokemonType.NORMAL]);
      vi.restoreAllMocks();
    });
  });

  describe("the library bindings equal the old rules", () => {
    it("every rebuilt attr of the chunk agrees with the original over moves, HP and memory states", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(ForceSwitchOutHelper.prototype, "getSwitchOutCondition").mockReturnValue(true);
      holder.turnData.hitsLeft = 1;
      holderUses(holder, MoveId.TACKLE);
      const moves = [
        MoveId.TACKLE,
        MoveId.SWORDS_DANCE,
        MoveId.BITE,
        MoveId.WING_ATTACK,
        MoveId.EMBER,
        MoveId.EARTHQUAKE,
      ];
      const ratio = vi.spyOn(holder, "getHpRatio");
      for (const [name, ability, index] of [
        ["EclipseWingPowerAbAttr", ECLIPSE_WING, 0],
        ["SkyhookAbAttr", SKYHOOK, 0],
        ["BootHillAbAttr", BOOT_HILL, 0],
        ["EncoreSetAbAttr", ENCORE_SET, 1],
      ] as const) {
        const original = liveAbility(ability).attrs[index];
        // Skyhook and Boot Hill have a legacy-closure gate (no library binding), so only they take the original gate as an override;
        // the other two are rebuilt purely from their bindings.
        const legacyGate = name === "SkyhookAbAttr" || name === "BootHillAbAttr";
        const rebuilt = recomposeAttr(
          module(name),
          original,
          ability,
          index,
          legacyGate ? { conds: { gate: sameGate(original as never) } } : {},
        );
        for (const value of [0.2, 0.33, 0.34, 1]) {
          ratio.mockReturnValue(value);
          for (const move of moves) {
            const params =
              name === "EclipseWingPowerAbAttr"
                ? ({
                    pokemon: holder,
                    opponent: foe,
                    move: allMoves[move],
                    power: new NumberHolder(100),
                    simulated: false,
                  } as never)
                : hit(holder, foe, move);
            expect(rebuilt.canApply(params), `${name} with ${allMoves[move].name} at ${value}`).toBe(
              original.canApply(params),
            );
          }
        }
      }
      vi.restoreAllMocks();
    });
  });
});
