/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B11 chunk 4: SelfHighestStatMultiplierAbAttr, SelfPersistentBleedAbAttr, SelfSwitchOnMoveTypeAbAttr, SelfSwitchOnStatLowerAbAttr,
// SetFogOnHitAbAttr, SetTargetAbilityOnMoveAbAttr, SkipChargeTurnAbAttr, SpeedBonusToStatAbAttr.
// The shared L1 grid and the L2 twin cannot reach everything these classes read (which stat is the highest, the real stat values, a
// holder that already bleeds, a hit that was blocked, the final hit of a multi-hit move, a target that already has the ability, a
// holder in the charge-up half of a move, the once-per-battle memory), so each rule is driven here on the ORIGINAL attr and on its
// REBUILD with stand-ins, and both must answer the same. A rebuild can get three things wrong: the codecs (the settings it reads
// back and feeds the constructor), the bound condition (a library atom that is not the same predicate as the closure) and the
// pieces that stay in the class. Where a condition is bound as a legacy closure (no library atom yet), the rebuild gets the SHIPPED
// closure handed in, which is exactly what a staff rule that keeps the built-in condition does.
import { allAbilities, allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { type CondInput, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { abilityNameCodec } from "#data/elite-redux/ability-studio/decl/B11/b11-chunk4-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const CLASSES = [
  "SelfHighestStatMultiplierAbAttr",
  "SelfPersistentBleedAbAttr",
  "SelfSwitchOnMoveTypeAbAttr",
  "SelfSwitchOnStatLowerAbAttr",
  "SetFogOnHitAbAttr",
  "SetTargetAbilityOnMoveAbAttr",
  "SkipChargeTurnAbAttr",
  "SpeedBonusToStatAbAttr",
] as const;

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);

/**
 * The rebuild of one shipped attr. A condition slot with a legacy-closure binding cannot come from the library, so the shipped
 * closure itself is handed in (the field of the attr, or the class own `gate` method for a Tier B gate).
 */
function rebuildSite(site: AttrSite): any {
  const module = declRegistry.get(site.className) as DeclModule;
  const conds: Record<string, CondInput> = {};
  for (const slot of module.decl.conditions) {
    if (getBinding(site.abilityId, site.attrIndex, slot.slot)?.legacyClosure !== undefined) {
      const attr = site.attr as any;
      conds[slot.slot] = slot.slot === "gate" ? (params: never) => attr.gate(params) : attr[slot.path ?? "condition"];
    }
  }
  return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, { conds });
}

function siteOf(className: string, abilityName: string, attrIndex?: number): AttrSite {
  const site = sitesOf(className).find(
    candidate =>
      candidate.abilityName === abilityName && (attrIndex === undefined || candidate.attrIndex === attrIndex),
  );
  if (site === undefined) {
    throw new Error(`${abilityName} has no ${className}`);
  }
  return site;
}

/** The shipped attr of one user and its rebuild, run through the same check. */
function both<T>(
  className: string,
  abilityName: string,
  check: (attr: any, which: string) => T,
  attrIndex?: number,
): [T, T] {
  const site = siteOf(className, abilityName, attrIndex);
  return [check(site.attr, "original"), check(rebuildSite(site), "rebuild")];
}

describe("B11 chunk 4: the eight classes", () => {
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
        // A rebuild hands the move test in as the condition, so its default filter field stays empty; the
        // behaviour is the condition, which the other tests compare. Drop only that one field here.
        const strip = (attr: unknown) => {
          const fingerprint = JSON.parse(JSON.stringify(attrFingerprint(attr as never)));
          if (fingerprint?.configuration) {
            fingerprint.configuration.bonusFilter = undefined;
          }
          return fingerprint;
        };
        expect(strip(rebuilt), `${site.abilityName} ${className}`).toEqual(strip(site.attr));
      }
    }
    const read = (className: string, abilityName: string, attrIndex?: number) => {
      const site = siteOf(className, abilityName, attrIndex);
      return readDeclParams(declRegistry.get(className) as DeclModule, site.attr);
    };
    for (const name of ["Solar Power", "Sand Force", "Whiteout", "Ectoplasm", "Raging Storm", "Photovoltaic"]) {
      expect(read("SelfHighestStatMultiplierAbAttr", name), name).toEqual({
        candidates: "Attack, Sp. Atk",
        multiplier: 1.5,
      });
    }
    expect(read("SelfPersistentBleedAbAttr", "Blood Stain")).toEqual({});
    expect(read("SelfSwitchOnMoveTypeAbAttr", "Hollow Ice Zone")).toEqual({ type: "ICE" });
    expect(read("SelfSwitchOnStatLowerAbAttr", "Tactical Retreat")).toEqual({});
    expect(read("SetFogOnHitAbAttr", "Fog Machine")).toEqual({ weather: "EERIE_FOG", turns: 8 });
    expect(read("SetTargetAbilityOnMoveAbAttr", "Temporal Rupture")).toEqual({
      move: "Roar of time",
      ability: "Slow Start",
    });
    expect(read("SkipChargeTurnAbAttr", "Accelerate")).toEqual({});
    expect(read("SpeedBonusToStatAbAttr", "Slipstream", 0)).toEqual({
      stat: "Attack",
      source: "Speed",
      fraction: 0.2,
      mode: "Add on top of the stat",
    });
    expect(read("SpeedBonusToStatAbAttr", "Slipstream", 1).stat).toBe("Sp. Atk");
    expect(read("SpeedBonusToStatAbAttr", "Impulse", 0)).toEqual({
      stat: "Attack",
      source: "Speed",
      fraction: 1,
      mode: "Replace the stat",
    });
    expect(read("SpeedBonusToStatAbAttr", "Power Core", 1)).toEqual({
      stat: "Sp. Atk",
      source: "Sp. Def",
      fraction: 0.2,
      mode: "Add on top of the stat",
    });
    expect(read("SpeedBonusToStatAbAttr", "Sleek Scales", 0)).toEqual({
      stat: "Defense",
      source: "Speed",
      fraction: 0.15,
      mode: "Add on top of the stat",
    });
    expect(read("SpeedBonusToStatAbAttr", "Blur", 1).stat).toBe("Sp. Def");
    expect(sitesOf("SpeedBonusToStatAbAttr")).toHaveLength(28);
    expect(sitesOf("SelfHighestStatMultiplierAbAttr")).toHaveLength(11);
  });

  it("the ability name codec finds vanilla and Elite Redux abilities and refuses a typo", async () => {
    await startWorld(phaserGame);
    expect(abilityNameCodec.toCtor("Slow Start")).toBe(AbilityId.SLOW_START);
    expect(abilityNameCodec.toCtor("  slow  START ")).toBe(AbilityId.SLOW_START);
    expect(abilityNameCodec.fromInstance(AbilityId.SLOW_START)).toBe("Slow Start");
    const erId = sitesOf("SelfPersistentBleedAbAttr")[0].abilityId; // Blood Stain, an Elite Redux ability
    expect(abilityNameCodec.toCtor("Blood Stain")).toBe(erId);
    expect(abilityNameCodec.fromInstance(erId)).toBe("Blood Stain");
    expect(() => abilityNameCodec.toCtor("Slow Strat")).toThrow(/not the name of an ability/);
  });

  it("Highest stat multiplier: only the highest candidate in the right weather, a tie goes to the first listed", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const stats = { [Stat.ATK]: 200, [Stat.SPATK]: 100, [Stat.DEF]: 500 } as Record<number, number>;
    vi.spyOn(holder, "getStat").mockImplementation(((stat: number) => stats[stat] ?? 50) as never);
    const run = (attr: any, stat: number): number | undefined => {
      const statVal = new NumberHolder(100);
      const params = { pokemon: holder, stat, statVal, simulated: false, move: allMoves[MoveId.TACKLE] } as never;
      if (!attr.canApply(params)) {
        return;
      }
      attr.apply(params);
      return statVal.value;
    };
    const table = (attr: any) => {
      const answers: Record<string, number | undefined> = {};
      for (const [name, weather] of [
        ["sun", WeatherType.SUNNY],
        ["harshSun", WeatherType.HARSH_SUN],
        ["rain", WeatherType.RAIN],
        ["clear", WeatherType.NONE],
      ] as const) {
        setWeatherOf(game, weather);
        stats[Stat.ATK] = 200;
        stats[Stat.SPATK] = 100;
        answers[`${name} attack highest, Attack`] = run(attr, Stat.ATK);
        answers[`${name} attack highest, Sp. Atk`] = run(attr, Stat.SPATK);
        answers[`${name} Defense is not a candidate`] = run(attr, Stat.DEF);
        stats[Stat.ATK] = 100;
        stats[Stat.SPATK] = 300;
        answers[`${name} sp. atk highest, Attack`] = run(attr, Stat.ATK);
        answers[`${name} sp. atk highest, Sp. Atk`] = run(attr, Stat.SPATK);
        stats[Stat.ATK] = 300;
        answers[`${name} tie, Attack`] = run(attr, Stat.ATK);
        answers[`${name} tie, Sp. Atk`] = run(attr, Stat.SPATK);
      }
      setWeatherOf(game, WeatherType.NONE);
      return answers;
    };
    const [original, rebuilt] = both("SelfHighestStatMultiplierAbAttr", "Solar Power", table);
    expect(original["sun attack highest, Attack"]).toBe(150);
    expect(original["sun attack highest, Sp. Atk"]).toBeUndefined();
    expect(original["sun sp. atk highest, Sp. Atk"]).toBe(150);
    expect(original["sun tie, Attack"]).toBe(150);
    expect(original["sun tie, Sp. Atk"]).toBeUndefined();
    expect(original["harshSun sp. atk highest, Sp. Atk"]).toBe(150);
    expect(original["rain attack highest, Attack"]).toBeUndefined();
    expect(original["clear attack highest, Attack"]).toBeUndefined();
    expect(original["sun Defense is not a candidate"]).toBeUndefined();
    expect(rebuilt).toEqual(original);
    // Whiteout (Hail or Snow) uses another weather list.
    const [snow, snowRebuilt] = both("SelfHighestStatMultiplierAbAttr", "Whiteout", attr => {
      const answers: (number | undefined)[] = [];
      stats[Stat.ATK] = 200;
      stats[Stat.SPATK] = 100;
      for (const weather of [WeatherType.HAIL, WeatherType.SNOW, WeatherType.SUNNY, WeatherType.SANDSTORM]) {
        setWeatherOf(game, weather);
        answers.push(run(attr, Stat.ATK));
      }
      setWeatherOf(game, WeatherType.NONE);
      return answers;
    });
    expect(snow).toEqual([150, 150, undefined, undefined]);
    expect(snowRebuilt).toEqual(snow);
  });

  it("Speed bonus: adds or replaces the stat, floors the share, and tests the move only when there is one", async () => {
    const { holder } = await startWorld(phaserGame);
    const real: Record<number, number> = { [Stat.SPD]: 201, [Stat.DEF]: 80, [Stat.SPDEF]: 90 };
    vi.spyOn(holder, "getStat").mockImplementation(((stat: number) => real[stat] ?? 50) as never);
    const run = (attr: any, stat: number, move: unknown, start = 100): number | undefined => {
      const statVal = new NumberHolder(start);
      const params = { pokemon: holder, stat, statVal, simulated: false, move } as never;
      if (!attr.canApply(params)) {
        return;
      }
      attr.apply(params);
      return statVal.value;
    };
    const tackle = allMoves[MoveId.TACKLE]; // makes contact
    const earthquake = allMoves[MoveId.EARTHQUAKE]; // does not
    // Slipstream attr 0: +20% of Speed to Attack, every move (floor(201 * 0.2) = 40); Sp. Atk has an attr of its own
    const slip = both("SpeedBonusToStatAbAttr", "Slipstream", attr => [
      run(attr, Stat.ATK, tackle),
      run(attr, Stat.ATK, earthquake),
      run(attr, Stat.ATK, undefined),
      run(attr, Stat.SPATK, tackle),
      run(attr, Stat.DEF, tackle),
    ]);
    expect(slip[0]).toEqual([140, 140, 140, undefined, undefined]);
    expect(slip[1]).toEqual(slip[0]);
    // Impulse: Speed REPLACES Attack, non-contact moves only
    const impulse = both("SpeedBonusToStatAbAttr", "Impulse", attr => [
      run(attr, Stat.ATK, tackle),
      run(attr, Stat.ATK, earthquake),
      run(attr, Stat.ATK, undefined),
    ]);
    expect(impulse[0]).toEqual([undefined, 201, 201]);
    expect(impulse[1]).toEqual(impulse[0]);
    // Speed Force: +20% of Speed to Attack, contact moves only
    const force = both("SpeedBonusToStatAbAttr", "Speed Force", attr => [
      run(attr, Stat.ATK, tackle),
      run(attr, Stat.ATK, earthquake),
    ]);
    expect(force[0]).toEqual([140, undefined]);
    expect(force[1]).toEqual(force[0]);
    // Power Core: +20% of Sp. Def to Sp. Atk (floor(90 * 0.2) = 18); Sleek Scales: +15% of Speed to Defense (floor(30.15) = 30)
    const core = both("SpeedBonusToStatAbAttr", "Power Core", attr => run(attr, Stat.SPATK, tackle), 1);
    expect(core).toEqual([118, 118]);
    const scales = both("SpeedBonusToStatAbAttr", "Sleek Scales", attr => run(attr, Stat.DEF, tackle), 0);
    expect(scales).toEqual([130, 130]);
    // Blur: Speed replaces Defense when hit by contact moves
    const blur = both(
      "SpeedBonusToStatAbAttr",
      "Blur",
      attr => [run(attr, Stat.DEF, tackle), run(attr, Stat.DEF, earthquake)],
      0,
    );
    expect(blur[0]).toEqual([201, undefined]);
    expect(blur[1]).toEqual(blur[0]);
  });

  it("Persistent bleed: only when not bleeding and bleeding can be added; nothing in a preview", async () => {
    const { holder } = await startWorld(phaserGame);
    const params = (extra: object = {}) => ({ pokemon: holder, simulated: false, ...extra }) as never;
    const results = both("SelfPersistentBleedAbAttr", "Blood Stain", (attr, which) => {
      const answers: Record<string, boolean> = {};
      answers.normal = attr.canApply(params());
      const bleeding = vi
        .spyOn(holder, "getTag")
        .mockImplementation(((tag: unknown) => (tag === BattlerTagType.ER_BLEED ? ({} as never) : undefined)) as never);
      answers.alreadyBleeding = attr.canApply(params());
      bleeding.mockRestore();
      const immune = vi.spyOn(holder, "canAddTag").mockReturnValue(false);
      answers.cannotBleed = attr.canApply(params());
      immune.mockRestore();
      const add = vi.spyOn(holder, "addTag").mockReturnValue(true as never);
      attr.apply(params({ simulated: true }));
      expect(add, `${which} simulated`).not.toHaveBeenCalled();
      attr.apply(params());
      expect(add, which).toHaveBeenCalledWith(BattlerTagType.ER_BLEED);
      add.mockRestore();
      return answers;
    });
    expect(results[0]).toEqual({ normal: true, alreadyBleeding: false, cannotBleed: false });
    expect(results[1]).toEqual(results[0]);
  });

  it("Switch out on a stat drop: the memory, the sign of the stages, and what apply writes", async () => {
    const { holder } = await startWorld(phaserGame);
    const key = "erTacticalRetreat.used";
    const fired = holder.waveData.entryEffectsFired;
    fired.delete(key);
    const params = (stages: number, extra: object = {}) =>
      ({ pokemon: holder, stats: [Stat.ATK], stages, selfTarget: false, simulated: false, ...extra }) as never;
    try {
      const results = both("SelfSwitchOnStatLowerAbAttr", "Tactical Retreat", (attr, which) => {
        fired.delete(key);
        const answers: Record<string, boolean> = {};
        answers.dropOne = attr.canApply(params(-1));
        answers.dropTwo = attr.canApply(params(-2));
        answers.raise = attr.canApply(params(1));
        answers.noChange = attr.canApply(params(0));
        expect(fired.has(key), `${which} canApply must not use the memory up`).toBe(false);
        const switchOut = vi.spyOn(attr.helper, "switchOutLogic").mockReturnValue(true as never);
        attr.apply(params(-1, { simulated: true }));
        expect(switchOut, `${which} simulated`).not.toHaveBeenCalled();
        expect(fired.has(key), `${which} simulated writes nothing`).toBe(false);
        attr.apply(params(-1));
        expect(switchOut, which).toHaveBeenCalledWith(holder);
        expect(fired.has(key), `${which} apply writes the memory`).toBe(true);
        answers.afterUse = attr.canApply(params(-1));
        switchOut.mockRestore();
        fired.delete(key);
        fired.add(key);
        answers.keyPreset = attr.canApply(params(-1));
        fired.delete(key);
        return answers;
      });
      expect(results[0]).toEqual({
        dropOne: true,
        dropTwo: true,
        raise: false,
        noChange: false,
        afterUse: false,
        keyPreset: false,
      });
      expect(results[1]).toEqual(results[0]);
    } finally {
      fired.delete(key);
    }
  });

  it("Switch out after an Ice move: damaging, Ice, the hit connected, the final hit, never in a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const hitsLeft = holder.turnData.hitsLeft;
    const params = (move: MoveId, extra: object = {}) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        damage: 30,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
        ...extra,
      }) as never;
    try {
      holder.turnData.hitsLeft = 0;
      const results = both("SelfSwitchOnMoveTypeAbAttr", "Hollow Ice Zone", (attr, which) => {
        const answers: Record<string, boolean> = {};
        answers.iceMove = attr.canApply(params(MoveId.ICE_BEAM));
        answers.waterMove = attr.canApply(params(MoveId.WATER_GUN));
        answers.iceStatusMove = attr.canApply(params(MoveId.HAZE));
        answers.superEffective = attr.canApply(params(MoveId.ICE_BEAM, { hitResult: HitResult.SUPER_EFFECTIVE }));
        answers.noEffect = attr.canApply(params(MoveId.ICE_BEAM, { hitResult: HitResult.NO_EFFECT }));
        answers.preview = attr.canApply(params(MoveId.ICE_BEAM, { simulated: true }));
        holder.turnData.hitsLeft = 3;
        answers.middleHit = attr.canApply(params(MoveId.ICE_BEAM));
        holder.turnData.hitsLeft = 1;
        answers.lastHit = attr.canApply(params(MoveId.ICE_BEAM));
        const switchOut = vi.spyOn(attr.helper, "switchOutLogic").mockReturnValue(true as never);
        attr.apply(params(MoveId.ICE_BEAM));
        expect(switchOut, which).toHaveBeenCalledWith(holder);
        switchOut.mockRestore();
        holder.turnData.hitsLeft = 0;
        return answers;
      });
      expect(results[0]).toEqual({
        iceMove: true,
        waterMove: false,
        iceStatusMove: false,
        superEffective: true,
        noEffect: false,
        preview: false,
        middleHit: false,
        lastHit: true,
      });
      expect(results[1]).toEqual(results[0]);
    } finally {
      holder.turnData.hitsLeft = hitsLeft;
    }
  });

  it("Fog on hit: only an attack class move, only when that weather is not up; the arena gets the weather and the turns", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const params = (move: MoveId, extra: object = {}) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        damage: 20,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
        ...extra,
      }) as never;
    // The moves where the engine class test (AttackMove) and the atom move.damaging (category !== STATUS) disagree.
    const disagree = allMoves
      .filter(move => move !== undefined && move.is("AttackMove") !== (move.category !== 2))
      .map(move => move.name);
    expect(disagree).toEqual(
      expect.arrayContaining(["Splash", "Whirlwind", "Growl", "Poison Gas", "Flash", "Nightmare", "Captivate"]),
    );
    const results = both("SetFogOnHitAbAttr", "Fog Machine", (attr, which) => {
      const answers: Record<string, boolean> = {};
      setWeatherOf(game, WeatherType.NONE);
      answers.tackle = attr.canApply(params(MoveId.TACKLE));
      answers.growl = attr.canApply(params(MoveId.GROWL));
      answers.splash = attr.canApply(params(MoveId.SPLASH));
      answers.whirlwind = attr.canApply(params(MoveId.WHIRLWIND));
      setWeatherOf(game, WeatherType.RAIN);
      answers.inRain = attr.canApply(params(MoveId.TACKLE));
      setWeatherOf(game, WeatherType.EERIE_FOG);
      answers.alreadyFog = attr.canApply(params(MoveId.TACKLE));
      setWeatherOf(game, WeatherType.NONE);
      const set = vi.spyOn(globalScene.arena, "trySetWeather").mockReturnValue(true);
      attr.apply(params(MoveId.TACKLE, { simulated: true }));
      expect(set, `${which} simulated`).not.toHaveBeenCalled();
      attr.apply(params(MoveId.TACKLE));
      expect(set, which).toHaveBeenCalledWith(WeatherType.EERIE_FOG, holder, 8);
      set.mockRestore();
      return answers;
    });
    expect(results[0]).toEqual({
      tackle: true,
      growl: false,
      splash: false,
      whirlwind: false,
      inRain: true,
      alreadyFog: false,
    });
    expect(results[1]).toEqual(results[0]);
    // The two new constructor arguments: another weather and another length
    const Fog = (siteOf("SetFogOnHitAbAttr", "Fog Machine").attr as any).constructor;
    const rain = new Fog(WeatherType.RAIN, 5);
    setWeatherOf(game, WeatherType.RAIN);
    expect(rain.canApply(params(MoveId.TACKLE))).toBe(false);
    setWeatherOf(game, WeatherType.NONE);
    expect(rain.canApply(params(MoveId.TACKLE))).toBe(true);
    const set = vi.spyOn(globalScene.arena, "trySetWeather").mockReturnValue(true);
    rain.apply(params(MoveId.TACKLE));
    expect(set).toHaveBeenCalledWith(WeatherType.RAIN, holder, 5);
    const plain = new Fog();
    plain.apply(params(MoveId.TACKLE));
    expect(set).toHaveBeenLastCalledWith(WeatherType.EERIE_FOG, holder, 8);
    expect(plain.showAbility).toBe(true);
  });

  it("Give the target an ability: the chosen move, the hit, a living target that does not have it yet", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const params = (move: MoveId, extra: object = {}) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        damage: 50,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
        ...extra,
      }) as never;
    const results = both("SetTargetAbilityOnMoveAbAttr", "Temporal Rupture", (attr, which) => {
      const answers: Record<string, boolean> = {};
      answers.roarOfTime = attr.canApply(params(MoveId.ROAR_OF_TIME));
      answers.otherMove = attr.canApply(params(MoveId.TACKLE));
      answers.preview = attr.canApply(params(MoveId.ROAR_OF_TIME, { simulated: true }));
      answers.noEffect = attr.canApply(params(MoveId.ROAR_OF_TIME, { hitResult: HitResult.NO_EFFECT }));
      answers.noTarget = attr.canApply(params(MoveId.ROAR_OF_TIME, { opponent: undefined }));
      const fainted = vi.spyOn(foe, "isFainted").mockReturnValue(true);
      answers.targetFainted = attr.canApply(params(MoveId.ROAR_OF_TIME));
      fainted.mockRestore();
      const has = vi.spyOn(foe, "getAbility").mockReturnValue({ id: AbilityId.SLOW_START } as never);
      answers.alreadyHasIt = attr.canApply(params(MoveId.ROAR_OF_TIME));
      has.mockRestore();
      const set = vi.spyOn(foe, "setTempAbility").mockReturnValue(undefined as never);
      attr.apply(params(MoveId.ROAR_OF_TIME));
      expect(set, which).toHaveBeenCalledWith(allAbilities[AbilityId.SLOW_START]);
      set.mockRestore();
      return answers;
    });
    expect(results[0]).toEqual({
      roarOfTime: true,
      otherMove: false,
      preview: false,
      noEffect: false,
      noTarget: false,
      targetFainted: false,
      alreadyHasIt: false,
    });
    expect(results[1]).toEqual(results[0]);
  });

  it("Skip the charge turn: any of the four charging tags, removed in order, nothing in a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const params = (extra: object = {}) =>
      ({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], simulated: false, ...extra }) as never;
    const tags = [
      BattlerTagType.CHARGING,
      BattlerTagType.UNDERGROUND,
      BattlerTagType.UNDERWATER,
      BattlerTagType.FLYING,
    ];
    const results = both("SkipChargeTurnAbAttr", "Accelerate", (attr, which) => {
      const answers: Record<string, boolean> = { none: attr.canApply(params()) };
      for (const tag of tags) {
        const has = vi
          .spyOn(holder, "getTag")
          .mockImplementation(((t: unknown) => (t === tag ? ({} as never) : undefined)) as never);
        answers[String(tag)] = attr.canApply(params());
        has.mockRestore();
      }
      const other = vi
        .spyOn(holder, "getTag")
        .mockImplementation(((t: unknown) => (t === BattlerTagType.TAUNT ? ({} as never) : undefined)) as never);
      answers.unrelatedTag = attr.canApply(params());
      other.mockRestore();
      const remove = vi.spyOn(holder, "removeTag").mockReturnValue(true as never);
      attr.apply(params({ simulated: true }));
      expect(remove, `${which} simulated`).not.toHaveBeenCalled();
      attr.apply(params());
      expect(
        remove.mock.calls.map(call => call[0]),
        which,
      ).toEqual(tags);
      remove.mockRestore();
      return answers;
    });
    expect(results[0]).toEqual({
      none: false,
      [String(BattlerTagType.CHARGING)]: true,
      [String(BattlerTagType.UNDERGROUND)]: true,
      [String(BattlerTagType.UNDERWATER)]: true,
      [String(BattlerTagType.FLYING)]: true,
      unrelatedTag: false,
    });
    expect(results[1]).toEqual(results[0]);
  });
});
