/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B11 chunk 1: PostTurnFoeStatDropAbAttr, PostTurnRandomPureTypeAbAttr, PostTurnScriptedMoveAbAttr, PostVictoryClearRechargeAbAttr,
// PostWeatherMoveFollowUpAbAttr and the three AllyFaintPowerBoost attrs (trigger, power, expire).
// The shared L1 grid and the L2 twin cannot reach what these classes read (a trapped foe, a stage that is -2, the turn counter, a
// recharge turn, a weather move, a fainted teammate, the Avenger timer), so each rule is driven here on the ORIGINAL attr and on its
// REBUILD with real or stand-in state, and both must answer the same. A rebuild can get three things wrong: the codecs (the settings
// it reads back and feeds the constructor), the bound condition (a library atom that is not the same predicate as the class's own
// test) and the pieces that stay in the class. The first test pins the codecs and the identity; the others drive the rest. Where a
// condition is bound as a legacy closure (no library atom yet), the rebuild gets the SHIPPED closure handed in, which is exactly what
// a staff rule that keeps the built-in condition does.
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { type CondInput, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { isAvengerBoostActive } from "#data/elite-redux/archetypes/power-boost-on-ally-faint";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const CLASSES = [
  "PostTurnFoeStatDropAbAttr",
  "PostTurnRandomPureTypeAbAttr",
  "PostTurnScriptedMoveAbAttr",
  "PostVictoryClearRechargeAbAttr",
  "PostWeatherMoveFollowUpAbAttr",
  "AllyFaintPowerBoostTriggerAbAttr",
  "AllyFaintPowerBoostAbAttr",
  "AllyFaintPowerBoostExpireAbAttr",
] as const;

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);

/**
 * The rebuild of one shipped attr. A condition slot with a legacy-closure binding cannot come from the library, so the shipped
 * closure itself is handed in (the parent's `condition` field, or the class's own `gate` method for a Tier B gate).
 */
function rebuildSite(
  site: AttrSite,
  overrides: { params?: Record<string, string | number | boolean>; conds?: Record<string, CondInput> } = {},
): any {
  const module = declRegistry.get(site.className) as DeclModule;
  const conds: Record<string, CondInput> = {};
  for (const slot of module.decl.conditions) {
    if (getBinding(site.abilityId, site.attrIndex, slot.slot)?.legacyClosure !== undefined) {
      const attr = site.attr as any;
      conds[slot.slot] = slot.slot === "gate" ? (params: never) => attr.gate(params) : attr[slot.path ?? "condition"];
    }
  }
  return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
    ...(overrides.params === undefined ? {} : { params: overrides.params }),
    conds: { ...conds, ...overrides.conds },
  });
}

/** The shipped attr of one user and its rebuild from the declaration. */
function pairFor(className: string, abilityName: string, attrIndex?: number): { original: any; rebuilt: any } {
  const site = sitesOf(className).find(
    candidate =>
      candidate.abilityName === abilityName && (attrIndex === undefined || candidate.attrIndex === attrIndex),
  );
  if (site === undefined) {
    throw new Error(`${abilityName} has no ${className}`);
  }
  return { original: site.attr, rebuilt: rebuildSite(site) };
}

function both<T>(className: string, abilityName: string, check: (attr: any, which: string) => T): [T, T] {
  const { original, rebuilt } = pairFor(className, abilityName);
  return [check(original, "original"), check(rebuilt, "rebuild")];
}

describe("B11 chunk 1: the eight classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every user rebuilds to an identical attr and reads back the shipped settings", async () => {
    await startWorld(phaserGame);
    for (const className of CLASSES) {
      expect(sitesOf(className).length, className).toBeGreaterThan(0);
      for (const site of sitesOf(className)) {
        const rebuilt = rebuildSite(site);
        expect(attrFingerprint(rebuilt as never), `${site.abilityName} ${className}`).toEqual(
          attrFingerprint(site.attr as never),
        );
      }
    }
    const read = (className: string, abilityName: string) => {
      const site = sitesOf(className).find(candidate => candidate.abilityName === abilityName)!;
      return readDeclParams(declRegistry.get(className) as DeclModule, site.attr);
    };
    expect(read("PostTurnFoeStatDropAbAttr", "Sap Trap")).toEqual({
      stat: "Speed",
      stages: -1,
      trapAtStage: "When it reaches -3 or lower",
      onlyIfTrapped: false,
      inflictStatus: "None",
    });
    for (const name of ["Serpent Bind", "Tentalock"]) {
      expect(read("PostTurnFoeStatDropAbAttr", name), name).toEqual({
        stat: "Speed",
        stages: -1,
        trapAtStage: "Never trap",
        onlyIfTrapped: true,
        inflictStatus: "None",
      });
    }
    expect(read("PostTurnScriptedMoveAbAttr", "Sumo Wrestler")).toEqual({
      moveId: "Circle throw",
      power: 20,
      everyNTurns: 2,
    });
    expect(read("PostTurnScriptedMoveAbAttr", "Cool Exit")).toEqual({
      moveId: "Chilly reception",
      power: 0,
      everyNTurns: 2,
    });
    expect(read("PostWeatherMoveFollowUpAbAttr", "Forecast")).toEqual({ followUpMoveId: "Weather ball" });
    expect(read("AllyFaintPowerBoostTriggerAbAttr", "Avenger")).toEqual({ turns: 2 });
    expect(read("AllyFaintPowerBoostTriggerAbAttr", "Cursed Spirit")).toEqual({ turns: 2 });
    expect(read("AllyFaintPowerBoostAbAttr", "Avenger")).toEqual({ multiplier: 1.5 });
    expect(read("AllyFaintPowerBoostAbAttr", "Cursed Spirit")).toEqual({ multiplier: 1.5 });
    expect(read("PostTurnRandomPureTypeAbAttr", "Color Spectrum")).toEqual({});
    expect(read("PostVictoryClearRechargeAbAttr", "Rampage")).toEqual({});
    expect(read("AllyFaintPowerBoostExpireAbAttr", "Avenger")).toEqual({});
    expect(
      sitesOf("PostVictoryClearRechargeAbAttr")
        .map(site => site.abilityName)
        .sort(),
    ).toEqual(
      ["Berserker Rage", "Drake Of Rage", "Going Berserk", "Master Hand", "Qigong", "Raging Goddess", "Rampage"].sort(),
    );
    expect(
      sitesOf("PostTurnFoeStatDropAbAttr")
        .map(site => site.abilityName)
        .sort(),
    ).toEqual(["Sap Trap", "Serpent Bind", "Tentalock"]);
  });

  it("Foe stat drop: the trapped filter, the trap threshold, the status rider and the typed settings", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const phases: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      phases.push(args);
    }) as never);
    const params = (extra: object = {}) => ({ pokemon: holder, simulated: false, ...extra }) as never;
    const reset = () => {
      phases.length = 0;
      foe.removeTag(BattlerTagType.TRAPPED);
      foe.setStatStage(Stat.SPD, 0);
      foe.status = null as never;
    };

    // Serpent Bind: only trapped foes
    const bind = both("PostTurnFoeStatDropAbAttr", "Serpent Bind", (attr, which) => {
      reset();
      const answers: Record<string, unknown> = {};
      answers.notTrapped = attr.canApply(params());
      foe.addTag(BattlerTagType.TRAPPED, 4, undefined, holder.id);
      answers.trapped = attr.canApply(params());
      answers.simulatedStillAsks = attr.canApply(params({ simulated: true }));
      attr.apply(params({ simulated: true }));
      answers.simulatedQueued = phases.length;
      attr.apply(params());
      answers.queued = phases.map(call => [call[0], call[1], call[2], call[3], call[4]]);
      const fainted = vi.spyOn(foe, "isFainted").mockReturnValue(true);
      answers.faintedFoe = attr.canApply(params());
      fainted.mockRestore();
      expect(foe.getTag(BattlerTagType.TRAPPED), which).toBeDefined();
      return answers;
    });
    expect(bind[0]).toEqual({
      notTrapped: false,
      trapped: true,
      simulatedStillAsks: true,
      simulatedQueued: 0,
      queued: [["StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPD], -1]],
      faintedFoe: false,
    });
    expect(bind[1]).toEqual(bind[0]);

    // Sap Trap: every foe, and the trap check uses the stage BEFORE the queued drop (stage + change <= limit)
    const trapResults = both("PostTurnFoeStatDropAbAttr", "Sap Trap", (attr, which) => {
      const out: Record<string, boolean> = {};
      for (const stage of [0, -1, -2, -3, -6]) {
        reset();
        foe.setStatStage(Stat.SPD, stage);
        expect(attr.canApply(params()), which).toBe(true);
        attr.apply(params());
        out[`stage ${stage}`] = foe.getTag(BattlerTagType.TRAPPED) !== undefined;
      }
      return out;
    });
    expect(trapResults[0]).toEqual({
      "stage 0": false,
      "stage -1": false,
      "stage -2": true,
      "stage -3": true,
      "stage -6": true,
    });
    expect(trapResults[1]).toEqual(trapResults[0]);

    // Typed settings: a rule built with other values behaves as those values say
    const sap = sitesOf("PostTurnFoeStatDropAbAttr").find(site => site.abilityName === "Sap Trap")!;
    reset();
    const lower = rebuildSite(sap, {
      params: { stat: "Attack", stages: -2, trapAtStage: "When it reaches -1 or lower", inflictStatus: "Burn" },
    }) as any;
    const trySet = vi.spyOn(foe, "trySetStatus").mockReturnValue(true as never);
    lower.apply(params());
    expect(phases.map(call => [call[3], call[4]])).toEqual([[[Stat.ATK], -2]]);
    expect(foe.getTag(BattlerTagType.TRAPPED)).toBeDefined();
    expect(trySet).toHaveBeenCalledWith(StatusEffect.BURN, holder);
    expect(attrFingerprint(lower)).toMatchObject({ type: "PostTurnFoeStatDropAbAttr" });
    expect(lower.opts).toEqual({
      stat: Stat.ATK,
      stages: -2,
      trapAtStage: -1,
      inflictStatus: StatusEffect.BURN,
    });
    // a rule that leaves the optional settings off has none of those keys (so it equals a shipped one that never named them)
    const plain = rebuildSite(sap, { params: { trapAtStage: "Never trap" } }) as any;
    expect(Object.keys(plain.opts).sort()).toEqual(["stages", "stat"]);
  });

  it("Random pure type: the faint guard, one draw of 18, one single type, nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const params = (extra: object = {}) => ({ pokemon: holder, simulated: false, ...extra }) as never;
    const results = both("PostTurnRandomPureTypeAbAttr", "Color Spectrum", (attr, which) => {
      const draw = vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(PokemonType.WATER as never);
      const before = holder.summonData.types;
      const answers: Record<string, unknown> = {};
      answers.canApply = attr.canApply(params());
      attr.apply(params({ simulated: true }));
      answers.drawsWhenSimulated = draw.mock.calls.length;
      expect(holder.summonData.types, which).toBe(before);
      attr.apply(params());
      answers.draws = draw.mock.calls.map(call => call[0]);
      answers.types = [...holder.summonData.types];
      const fainted = vi.spyOn(holder, "isFainted").mockReturnValue(true);
      answers.faintedCanApply = attr.canApply(params());
      fainted.mockRestore();
      draw.mockRestore();
      holder.summonData.types = before;
      return answers;
    });
    expect(results[0]).toEqual({
      canApply: true,
      drawsWhenSimulated: 0,
      draws: [18],
      types: [PokemonType.WATER],
      faintedCanApply: false,
    });
    expect(results[1]).toEqual(results[0]);
  });

  it("Scripted move: the cadence gate, the faint guard, the target, the use mode and the typed settings", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const phases: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      phases.push(args);
    }) as never);
    const params = (extra: object = {}) => ({ pokemon: holder, simulated: false, ...extra }) as never;
    const turnCount = holder.tempSummonData.turnCount;
    try {
      for (const name of ["Sumo Wrestler", "Cool Exit"]) {
        const cadence = both("PostTurnScriptedMoveAbAttr", name, (attr, which) => {
          const out: boolean[] = [];
          for (const turn of [0, 1, 2, 3, 4, 5, 6]) {
            holder.tempSummonData.turnCount = turn;
            out.push(attr.canApply(params()));
          }
          holder.tempSummonData.turnCount = 2;
          const fainted = vi.spyOn(holder, "isFainted").mockReturnValue(true);
          out.push(attr.canApply(params()));
          fainted.mockRestore();
          expect(out.length, which).toBe(8);
          return out;
        });
        expect(cadence[0], name).toEqual([false, false, true, false, true, false, true, false]);
        expect(cadence[1], name).toEqual(cadence[0]);
      }
      // the cast: first living foe, indirect use mode, the scripted move with its power; nothing when simulated or no foe lives
      const { original, rebuilt } = pairFor("PostTurnScriptedMoveAbAttr", "Sumo Wrestler");
      const casts = [original, rebuilt].map(attr => {
        phases.length = 0;
        attr.apply(params({ simulated: true }));
        const simulated = phases.length;
        attr.apply(params());
        const [phase] = phases;
        const cast = {
          simulated,
          kind: phase?.[0],
          mover: phase?.[1] === holder,
          targets: phase?.[2],
          move: (phase?.[3] as { moveId: MoveId } | undefined)?.moveId,
          mode: phase?.[4],
        };
        phases.length = 0;
        const none = vi.spyOn(holder, "getOpponents").mockReturnValue([]);
        attr.apply(params());
        none.mockRestore();
        return { ...cast, castWithoutFoe: phases.length };
      });
      expect(casts[0]).toEqual({
        simulated: 0,
        kind: "MovePhase",
        mover: true,
        targets: [foe.getBattlerIndex()],
        move: MoveId.CIRCLE_THROW,
        mode: MoveUseMode.INDIRECT,
        castWithoutFoe: 0,
      });
      expect(casts[1]).toEqual(casts[0]);
      // typed settings
      const sumo = sitesOf("PostTurnScriptedMoveAbAttr").find(site => site.abilityName === "Sumo Wrestler")!;
      const other = rebuildSite(sumo, { params: { moveId: "chilly reception", power: 0 } }) as any;
      expect(other.moveId).toBe(MoveId.CHILLY_RECEPTION);
      expect(other.power).toBeUndefined();
      expect(other.everyNTurns).toBe(2);
      expect(() => rebuildSite(sumo, { params: { moveId: "Not a real move" } })).toThrow(/not the name of a move/);
    } finally {
      holder.tempSummonData.turnCount = turnCount;
    }
  });

  it("Clear recharge: the gate is the recharge tag, a swapped gate is honoured, the queued placeholder move goes too", async () => {
    const { holder } = await startWorld(phaserGame);
    const params = (extra: object = {}) => ({ pokemon: holder, simulated: false, ...extra }) as never;
    const queue = holder.getMoveQueue();
    queue.length = 0;
    try {
      for (const name of [
        "Rampage",
        "Berserker Rage",
        "Master Hand",
        "Raging Goddess",
        "Qigong",
        "Drake Of Rage",
        "Going Berserk",
      ]) {
        const results = both("PostVictoryClearRechargeAbAttr", name, (attr, which) => {
          const answers: Record<string, unknown> = {};
          holder.removeTag(BattlerTagType.RECHARGING);
          queue.length = 0;
          answers.notRecharging = attr.canApply(params());
          holder.addTag(BattlerTagType.RECHARGING);
          answers.recharging = attr.canApply(params());
          answers.placeholderQueued = queue.map(entry => entry.move);
          attr.apply(params({ simulated: true }));
          answers.simulatedKeepsTag = holder.getTag(BattlerTagType.RECHARGING) !== undefined;
          attr.apply(params());
          answers.tagGone = holder.getTag(BattlerTagType.RECHARGING) === undefined;
          answers.queueAfter = queue.map(entry => entry.move);
          // a real move at the front of the queue is NOT the placeholder and stays
          holder.addTag(BattlerTagType.RECHARGING);
          queue.length = 0;
          queue.push({ move: MoveId.TACKLE } as never);
          attr.apply(params());
          answers.realMoveKept = queue.map(entry => entry.move);
          queue.length = 0;
          expect(which).toBeTruthy();
          return answers;
        });
        expect(results[0], name).toEqual({
          notRecharging: false,
          recharging: true,
          placeholderQueued: [MoveId.NONE],
          simulatedKeepsTag: true,
          tagGone: true,
          queueAfter: [],
          realMoveKept: [MoveId.TACKLE],
        });
        expect(results[1], name).toEqual(results[0]);
      }
      // a staff rule that swaps the gate for "always" fires without a recharge turn (the gate is a real, swappable block)
      const rampage = sitesOf("PostVictoryClearRechargeAbAttr").find(site => site.abilityName === "Rampage")!;
      const always = rebuildSite(rampage, { conds: { gate: { all: [] } } }) as any;
      holder.removeTag(BattlerTagType.RECHARGING);
      expect(always.canApply(params())).toBe(true);
    } finally {
      holder.removeTag(BattlerTagType.RECHARGING);
      queue.length = 0;
    }
  });

  it("Weather follow-up: only my own weather move, a living foe, the cast, and the typed move setting", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const phases: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      phases.push(args);
    }) as never);
    const params = (move: MoveId, source = holder, extra: object = {}) =>
      ({ pokemon: holder, move: new PokemonMove(move), source, targets: [], simulated: false, ...extra }) as never;
    expect(allMoves[MoveId.RAIN_DANCE].hasAttr("WeatherChangeAttr")).toBe(true);
    expect(allMoves[MoveId.TACKLE].hasAttr("WeatherChangeAttr")).toBe(false);
    const results = both("PostWeatherMoveFollowUpAbAttr", "Forecast", (attr, which) => {
      const answers: Record<string, unknown> = {};
      answers.ownRainDance = attr.canApply(params(MoveId.RAIN_DANCE));
      answers.ownSunnyDay = attr.canApply(params(MoveId.SUNNY_DAY));
      answers.ownTackle = attr.canApply(params(MoveId.TACKLE));
      answers.foeRainDance = attr.canApply(params(MoveId.RAIN_DANCE, foe));
      const fainted = vi.spyOn(foe, "isFainted").mockReturnValue(true);
      answers.foeFainted = attr.canApply(params(MoveId.RAIN_DANCE));
      fainted.mockRestore();
      phases.length = 0;
      attr.apply(params(MoveId.RAIN_DANCE, holder, { simulated: true }));
      answers.simulatedQueued = phases.length;
      attr.apply(params(MoveId.RAIN_DANCE));
      const [phase] = phases;
      answers.cast = [
        phase?.[0],
        phase?.[1] === holder,
        phase?.[2],
        (phase?.[3] as PokemonMove | undefined)?.moveId,
        phase?.[4],
        phase?.[5],
      ];
      expect(which).toBeTruthy();
      return answers;
    });
    expect(results[0]).toEqual({
      ownRainDance: true,
      ownSunnyDay: true,
      ownTackle: false,
      foeRainDance: false,
      foeFainted: false,
      simulatedQueued: 0,
      cast: [
        "MovePhase",
        true,
        [foe.getBattlerIndex()],
        MoveId.WEATHER_BALL,
        MoveUseMode.INDIRECT,
        MovePhaseTimingModifier.FIRST,
      ],
    });
    expect(results[1]).toEqual(results[0]);
    const forecast = sitesOf("PostWeatherMoveFollowUpAbAttr")[0];
    const other = rebuildSite(forecast, { params: { followUpMoveId: "Hyper beam" } }) as any;
    expect(other.getFollowUpMoveId()).toBe(MoveId.HYPER_BEAM);
  });

  it("The Avenger trio: a teammate's faint arms the timer, the power attr reads it, the expire attr counts it down", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    // a teammate stand-in: a different id on the holder's side (a single battle has no ally to faint)
    const teammate = { id: holder.id + 1000, isPlayer: () => holder.isPlayer() } as never;
    const faintParams = (victim: unknown, simulated = false) => ({ pokemon: holder, victim, simulated }) as never;
    const turnParams = (extra: object = {}) => ({ pokemon: holder, simulated: false, ...extra }) as never;
    const powerParams = (power: NumberHolder) =>
      ({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], power, simulated: false }) as never;
    const expire = pairFor("AllyFaintPowerBoostExpireAbAttr", "Avenger");
    const drain = () => {
      while (isAvengerBoostActive(holder)) {
        expire.original.apply(turnParams());
      }
    };
    drain();

    for (const which of ["original", "rebuild"] as const) {
      drain();
      const trigger = pairFor("AllyFaintPowerBoostTriggerAbAttr", "Avenger")[
        which === "original" ? "original" : "rebuilt"
      ];
      const power = pairFor("AllyFaintPowerBoostAbAttr", "Avenger")[which === "original" ? "original" : "rebuilt"];
      const tick = pairFor("AllyFaintPowerBoostExpireAbAttr", "Avenger")[which === "original" ? "original" : "rebuilt"];
      // the gate: a teammate yes, the foe no, myself no
      expect(trigger.canApply(faintParams(teammate)), which).toBe(true);
      expect(trigger.canApply(faintParams(foe)), which).toBe(false);
      expect(trigger.canApply(faintParams(holder)), which).toBe(false);
      // nothing is boosted before the timer is armed
      expect(isAvengerBoostActive(holder), which).toBe(false);
      expect(power.canApply(powerParams(new NumberHolder(40))), which).toBe(false);
      expect(tick.canApply(turnParams()), which).toBe(false);
      // arming: a preview does nothing, the real call sets 2 ticks
      trigger.apply(faintParams(teammate, true));
      expect(isAvengerBoostActive(holder), which).toBe(false);
      trigger.apply(faintParams(teammate));
      expect(expire.original.turnsRemaining(holder), which).toBe(2);
      const value = new NumberHolder(40);
      expect(power.canApply(powerParams(value)), which).toBe(true);
      power.apply(powerParams(value));
      expect(value.value, which).toBe(60);
      // counting down: a preview does nothing; two real ticks end it, a third finds the gate closed
      tick.apply(turnParams({ simulated: true }));
      expect(expire.original.turnsRemaining(holder), which).toBe(2);
      expect(tick.canApply(turnParams()), which).toBe(true);
      tick.apply(turnParams());
      expect(expire.original.turnsRemaining(holder), which).toBe(1);
      expect(power.canApply(powerParams(new NumberHolder(40))), which).toBe(true);
      tick.apply(turnParams());
      expect(isAvengerBoostActive(holder), which).toBe(false);
      expect(power.canApply(powerParams(new NumberHolder(40))), which).toBe(false);
      expect(tick.canApply(turnParams()), which).toBe(false);
    }

    // typed settings: a longer boost and a stronger multiplier
    const triggerSite = sitesOf("AllyFaintPowerBoostTriggerAbAttr").find(site => site.abilityName === "Avenger")!;
    const powerSite = sitesOf("AllyFaintPowerBoostAbAttr").find(site => site.abilityName === "Avenger")!;
    const longer = rebuildSite(triggerSite, { params: { turns: 4 } }) as any;
    longer.apply(faintParams(teammate));
    expect(expire.original.turnsRemaining(holder)).toBe(4);
    const strong = rebuildSite(powerSite, { params: { multiplier: 2 } }) as any;
    const doubled = new NumberHolder(40);
    expect(strong.canApply(powerParams(doubled))).toBe(true);
    strong.apply(powerParams(doubled));
    expect(doubled.value).toBe(80);
    drain();
    // a swapped condition is honoured: "always" boosts without a timer
    const always = rebuildSite(powerSite, { conds: { "ctor:1": { all: [] } } }) as any;
    expect(always.canApply(powerParams(new NumberHolder(40)))).toBe(true);
  });
});
