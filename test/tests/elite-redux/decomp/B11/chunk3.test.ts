/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B11 chunk 3: ReflectDamageOnDefendAbAttr, RemoveScreensOnTypedAttackAbAttr, RepeatMovePowerBoostAbAttr, SandStatusImmunityAbAttr,
// SandSecondaryEffectImmunityAbAttr, SePriorityBonusAbAttr, SelfDamageOnAttackAbAttr, SelfHighestStatBoostOnSummonAbAttr.
// The shared L1 grid and the L2 twin cannot reach everything these classes read (the move history, the Fun and Games minigame,
// a multi-hit turn, a weather the world does not set, a hit that KO'd the target), so each rule is driven here on the ORIGINAL
// attr and on its REBUILD with stand-ins, and both must answer the same. Every class is Tier C with nothing to bind, so what a
// rebuild can get wrong is the codecs (the settings it reads back and feeds the constructor); the first test pins those.
import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { BooleanHolder, NumberHolder, toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const CLASSES = [
  "ReflectDamageOnDefendAbAttr",
  "RemoveScreensOnTypedAttackAbAttr",
  "RepeatMovePowerBoostAbAttr",
  "SandStatusImmunityAbAttr",
  "SandSecondaryEffectImmunityAbAttr",
  "SePriorityBonusAbAttr",
  "SelfDamageOnAttackAbAttr",
  "SelfHighestStatBoostOnSummonAbAttr",
] as const;

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);

/** The shipped attr of one user and its rebuild from the declaration. */
function pairFor(className: string, abilityName: string): { original: any; rebuilt: any } {
  const site = sitesOf(className).find(candidate => candidate.abilityName === abilityName);
  if (site === undefined) {
    throw new Error(`${abilityName} has no ${className}`);
  }
  const module = declRegistry.get(className) as DeclModule;
  return { original: site.attr, rebuilt: recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) };
}

function both<T>(className: string, abilityName: string, check: (attr: any, which: string) => T): [T, T] {
  const { original, rebuilt } = pairFor(className, abilityName);
  return [check(original, "original"), check(rebuilt, "rebuild")];
}

describe("B11 chunk 3: the eight classes", () => {
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
      const module = declRegistry.get(className) as DeclModule;
      expect(sitesOf(className).length, className).toBeGreaterThan(0);
      for (const site of sitesOf(className)) {
        const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
        expect(attrFingerprint(rebuilt as never), `${site.abilityName} ${className}`).toEqual(
          attrFingerprint(site.attr as never),
        );
      }
    }
    const read = (className: string, abilityName: string) => {
      const site = sitesOf(className).find(candidate => candidate.abilityName === abilityName)!;
      return readDeclParams(declRegistry.get(className) as DeclModule, site.attr);
    };
    expect(read("RepeatMovePowerBoostAbAttr", "Rhythmic")).toEqual({ bonus: 0.2, cap: 0, flag: "SOUND_BASED" });
    expect(read("SePriorityBonusAbAttr", "Overzealous")).toEqual({ priority: 1 });
    expect(read("RemoveScreensOnTypedAttackAbAttr", "Warrior's Spear")).toEqual({ type: "FIGHTING" });
    expect(read("SelfDamageOnAttackAbAttr", "Blood Price")).toMatchObject({
      basis: "My max HP",
      fraction: 0.1,
      soulLink: false,
      exceptAbility: 0,
    });
    expect(read("SelfDamageOnAttackAbAttr", "Super Strain")).toMatchObject({
      basis: "Damage I just dealt",
      fraction: 0.25,
      soulLink: false,
      exceptAbility: 0,
    });
    const soulLinker = read("SelfDamageOnAttackAbAttr", "Soul Linker");
    expect(soulLinker).toMatchObject({ basis: "Damage I just dealt", fraction: 1, soulLink: true });
    expect(soulLinker.exceptAbility).toBeGreaterThan(0);
    expect(read("ReflectDamageOnDefendAbAttr", "Soul Linker").exceptAbility).toBe(soulLinker.exceptAbility);
    const highest = (name: string) => read("SelfHighestStatBoostOnSummonAbAttr", name);
    const all5 = "Attack, Defense, Sp. Atk, Sp. Def, Speed";
    expect(highest("Sun Worship")).toEqual({
      candidates: all5,
      stages: 1,
      weathers: "Sun, Extremely harsh sunlight",
      terrains: "",
    });
    expect(highest("Sea Guardian")).toEqual({
      candidates: all5,
      stages: 1,
      weathers: "Rain, Heavy rain",
      terrains: "",
    });
    expect(highest("Greater Spirit")).toEqual({
      candidates: all5,
      stages: 1,
      weathers: "Fog, Eerie fog",
      terrains: "",
    });
    expect(highest("Majestic Moth")).toEqual({ candidates: all5, stages: 1, weathers: "", terrains: "" });
    expect(highest("Turf War")).toEqual({ candidates: all5, stages: 1, weathers: "", terrains: "" });
    expect(highest("Berserk DNA")).toEqual({ candidates: "Attack, Sp. Atk", stages: 2, weathers: "", terrains: "" });
    expect(
      sitesOf("SandStatusImmunityAbAttr")
        .map(site => site.abilityName)
        .sort(),
    ).toEqual(["Desert Cloak", "Dune Veil"]);
    expect(
      sitesOf("SandSecondaryEffectImmunityAbAttr")
        .map(site => site.abilityName)
        .sort(),
    ).toEqual(["Desert Cloak", "Dune Veil"]);
  });

  it("Reflect damage: the same clauses in the same order, on the original and the rebuild", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const params = (extra: object = {}) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage: 40,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
        ...extra,
      }) as never;
    const exception = readDeclParams(
      declRegistry.get("ReflectDamageOnDefendAbAttr") as DeclModule,
      pairFor("ReflectDamageOnDefendAbAttr", "Soul Linker").original,
    ).exceptAbility as number;
    const battle = globalScene.currentBattle;
    const encounter = battle.mysteryEncounter;
    const results = both("ReflectDamageOnDefendAbAttr", "Soul Linker", (attr, which) => {
      const answers: Record<string, boolean> = {};
      answers.normal = attr.canApply(params());
      answers.simulated = attr.canApply(params({ simulated: true }));
      answers.noDamage = attr.canApply(params({ damage: 0 }));
      answers.noAttacker = attr.canApply(params({ opponent: undefined }));
      answers.selfHit = attr.canApply(params({ opponent: holder }));
      const hasAbility = vi.spyOn(foe, "hasAbility").mockImplementation(((id: number) => id === exception) as never);
      answers.attackerHasSoulLinker = attr.canApply(params());
      hasAbility.mockRestore();
      const holderFainted = vi.spyOn(holder, "isFainted").mockReturnValue(true);
      answers.holderFainted = attr.canApply(params());
      holderFainted.mockRestore();
      const foeFainted = vi.spyOn(foe, "isFainted").mockReturnValue(true);
      answers.attackerFainted = attr.canApply(params());
      foeFainted.mockRestore();
      battle.mysteryEncounter = { encounterType: MysteryEncounterType.FUN_AND_GAMES } as never;
      try {
        answers.funAndGames = attr.canApply(params());
      } finally {
        battle.mysteryEncounter = encounter;
      }
      const damage = vi.spyOn(foe, "damageAndUpdate").mockReturnValue(0 as never);
      attr.apply(params());
      expect(damage, which).toHaveBeenCalledWith(40, { result: HitResult.INDIRECT, ignoreSegments: true });
      damage.mockRestore();
      return answers;
    });
    expect(results[0]).toEqual({
      normal: true,
      simulated: false,
      noDamage: false,
      noAttacker: false,
      selfHit: false,
      attackerHasSoulLinker: false,
      holderFainted: false,
      attackerFainted: false,
      funAndGames: false,
    });
    expect(results[1]).toEqual(results[0]);
  });

  it("Self damage: the soul-link clauses, the multi-hit rule for the max HP share, and the amounts", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const params = (extra: object = {}) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage: 80,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
        ...extra,
      }) as never;
    const exception = readDeclParams(
      declRegistry.get("SelfDamageOnAttackAbAttr") as DeclModule,
      pairFor("SelfDamageOnAttackAbAttr", "Soul Linker").original,
    ).exceptAbility as number;
    const battle = globalScene.currentBattle;
    const encounter = battle.mysteryEncounter;
    const hitsLeft = holder.turnData.hitsLeft;
    holder.turnData.hitsLeft = 1;
    try {
      // Soul Linker (damage dealt, soul-link rules)
      const soul = both("SelfDamageOnAttackAbAttr", "Soul Linker", (attr, which) => {
        const answers: Record<string, boolean> = {};
        answers.normal = attr.canApply(params());
        answers.simulated = attr.canApply(params({ simulated: true }));
        answers.noDamage = attr.canApply(params({ damage: 0 }));
        const targetFainted = vi.spyOn(foe, "isFainted").mockReturnValue(true);
        answers.targetKnockedOut = attr.canApply(params());
        targetFainted.mockRestore();
        const hasAbility = vi.spyOn(foe, "hasAbility").mockImplementation(((id: number) => id === exception) as never);
        answers.targetHasSoulLinker = attr.canApply(params());
        hasAbility.mockRestore();
        battle.mysteryEncounter = { encounterType: MysteryEncounterType.FUN_AND_GAMES } as never;
        try {
          answers.funAndGames = attr.canApply(params());
        } finally {
          battle.mysteryEncounter = encounter;
        }
        // the damage-dealt share pays on EVERY hit of a multi-hit move
        holder.turnData.hitsLeft = 3;
        answers.middleHit = attr.canApply(params());
        holder.turnData.hitsLeft = 1;
        const hurt = vi.spyOn(holder, "damageAndUpdate").mockReturnValue(0 as never);
        attr.apply(params());
        expect(hurt, which).toHaveBeenCalledWith(80, { result: HitResult.INDIRECT, ignoreSegments: true });
        hurt.mockRestore();
        return answers;
      });
      expect(soul[0]).toEqual({
        normal: true,
        simulated: false,
        noDamage: false,
        targetKnockedOut: false,
        targetHasSoulLinker: false,
        funAndGames: false,
        middleHit: true,
      });
      expect(soul[1]).toEqual(soul[0]);

      // Blood Price (max HP share, no soul-link rules): only the last hit of a multi-hit move pays, and the minigame does not stop it
      const blood = both("SelfDamageOnAttackAbAttr", "Blood Price", (attr, which) => {
        const answers: Record<string, boolean> = {};
        answers.normal = attr.canApply(params());
        holder.turnData.hitsLeft = 3;
        answers.middleHit = attr.canApply(params());
        holder.turnData.hitsLeft = 1;
        answers.lastHit = attr.canApply(params());
        holder.turnData.hitsLeft = 1;
        battle.mysteryEncounter = { encounterType: MysteryEncounterType.FUN_AND_GAMES } as never;
        try {
          answers.funAndGames = attr.canApply(params());
        } finally {
          battle.mysteryEncounter = encounter;
        }
        const targetFainted = vi.spyOn(foe, "isFainted").mockReturnValue(true);
        answers.targetKnockedOut = attr.canApply(params());
        targetFainted.mockRestore();
        const hurt = vi.spyOn(holder, "damageAndUpdate").mockReturnValue(0 as never);
        attr.apply(params());
        expect(hurt, which).toHaveBeenCalledWith(toDmgValue(holder.getMaxHp() * 0.1, 1), {
          result: HitResult.INDIRECT,
          ignoreSegments: true,
        });
        hurt.mockRestore();
        return answers;
      });
      expect(blood[0]).toEqual({
        normal: true,
        middleHit: false,
        lastHit: true,
        funAndGames: true,
        targetKnockedOut: true,
      });
      expect(blood[1]).toEqual(blood[0]);

      // Super Strain (damage dealt share 0.25): at least 1 HP
      for (const [damage, expected] of [
        [80, 20],
        [2, 1],
      ] as const) {
        const [a, b] = both("SelfDamageOnAttackAbAttr", "Super Strain", attr => {
          const hurt = vi.spyOn(holder, "damageAndUpdate").mockReturnValue(0 as never);
          attr.apply(params({ damage }));
          const amount = hurt.mock.calls[0]?.[0];
          hurt.mockRestore();
          return amount;
        });
        expect([a, b]).toEqual([expected, expected]);
      }
    } finally {
      holder.turnData.hitsLeft = hitsLeft;
      battle.mysteryEncounter = encounter;
    }
  });

  it("Repeat power boost: counts the run of successful uses of the current move, honours the cap and the move trait", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sound = allMoves[MoveId.HYPER_VOICE];
    const plain = allMoves[MoveId.TACKLE];
    expect(sound.hasFlag(MoveFlags.SOUND_BASED)).toBe(true);
    expect(plain.hasFlag(MoveFlags.SOUND_BASED)).toBe(false);
    const history = (...entries: [MoveId, MoveResult][]) =>
      vi.spyOn(holder, "getLastXMoves").mockReturnValue(entries.map(([move, result]) => ({ move, result })) as never);
    const power = (attr: any, move: typeof sound): number | undefined => {
      const value = new NumberHolder(100);
      const params = { pokemon: holder, opponent: foe, move, power: value, simulated: false } as never;
      if (!attr.canApply(params)) {
        return;
      }
      attr.apply(params);
      return value.value;
    };
    // Rhythmic after the upgrade: +20% per repeat, sound moves only, no cap
    const runs: [string, (attr: any) => (number | undefined)[]][] = [
      [
        "Rhythmic",
        attr => {
          const out: (number | undefined)[] = [];
          history([MoveId.HYPER_VOICE, MoveResult.SUCCESS], [MoveId.HYPER_VOICE, MoveResult.SUCCESS]);
          out.push(power(attr, sound));
          history(
            [MoveId.HYPER_VOICE, MoveResult.SUCCESS],
            [MoveId.TACKLE, MoveResult.SUCCESS],
            [MoveId.HYPER_VOICE, MoveResult.SUCCESS],
          );
          out.push(power(attr, sound));
          history([MoveId.HYPER_VOICE, MoveResult.FAIL], [MoveId.HYPER_VOICE, MoveResult.SUCCESS]);
          out.push(power(attr, sound));
          history([MoveId.TACKLE, MoveResult.SUCCESS], [MoveId.TACKLE, MoveResult.SUCCESS]);
          out.push(power(attr, plain));
          return out;
        },
      ],
    ];
    for (const [name, run] of runs) {
      const [original, rebuilt] = both("RepeatMovePowerBoostAbAttr", name, run);
      // two repeats -> x1.4; one repeat then another move -> x1.2; a failed use first -> x1.0; a move without the trait -> no bonus at all
      expect(original).toEqual([140, 120, 100, undefined]);
      expect(rebuilt).toEqual(original);
    }
    // the cap and the no-trait form, driven through the declaration with settings Rhythmic does not use
    const module = declRegistry.get("RepeatMovePowerBoostAbAttr") as DeclModule;
    const site = sitesOf("RepeatMovePowerBoostAbAttr")[0];
    const capped = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      params: { bonus: 0.5, cap: 1.5, flag: "ANY" },
    }) as any;
    history(
      [MoveId.TACKLE, MoveResult.SUCCESS],
      [MoveId.TACKLE, MoveResult.SUCCESS],
      [MoveId.TACKLE, MoveResult.SUCCESS],
    );
    expect(power(capped, plain)).toBe(150);
    expect(power(capped, sound)).toBe(100);
    expect(capped.getFlag()).toBeUndefined();
  });

  it("Sand immunities: only in an unsuppressed sandstorm, every status but fainting, and only a real chance", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const arena = globalScene.arena;
    const weather = arena.weather;
    const setWeather = (type: WeatherType | undefined, suppressed = false) => {
      arena.weather = (
        type === undefined ? undefined : { weatherType: type, isEffectSuppressed: () => suppressed }
      ) as never;
    };
    const statusParams = (effect: StatusEffect) =>
      ({
        pokemon: holder,
        target: holder,
        source: foe,
        effect,
        cancelled: new BooleanHolder(false),
        simulated: false,
      }) as never;
    const chanceParams = (chance: number) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.FLAMETHROWER],
        chance: new NumberHolder(chance),
        simulated: false,
      }) as never;
    try {
      for (const name of ["Desert Cloak", "Dune Veil"]) {
        const status = both("SandStatusImmunityAbAttr", name, attr => {
          const answers: Record<string, boolean> = {};
          setWeather(WeatherType.SANDSTORM);
          answers.burnInSand = attr.canApply(statusParams(StatusEffect.BURN));
          answers.faintInSand = attr.canApply(statusParams(StatusEffect.FAINT));
          setWeather(WeatherType.SANDSTORM, true);
          answers.burnInSuppressedSand = attr.canApply(statusParams(StatusEffect.BURN));
          setWeather(WeatherType.RAIN);
          answers.burnInRain = attr.canApply(statusParams(StatusEffect.BURN));
          setWeather(undefined);
          answers.burnWithoutWeather = attr.canApply(statusParams(StatusEffect.BURN));
          return answers;
        });
        expect(status[0], name).toEqual({
          burnInSand: true,
          faintInSand: false,
          burnInSuppressedSand: false,
          burnInRain: false,
          burnWithoutWeather: false,
        });
        expect(status[1], name).toEqual(status[0]);
        const chance = both("SandSecondaryEffectImmunityAbAttr", name, (attr, which) => {
          const answers: Record<string, boolean | number> = {};
          setWeather(WeatherType.SANDSTORM);
          answers.inSand = attr.canApply(chanceParams(30));
          answers.inSandNoChance = attr.canApply(chanceParams(0));
          const held = chanceParams(30);
          attr.apply(held);
          answers.chanceAfter = (held as unknown as { chance: NumberHolder }).chance.value;
          setWeather(WeatherType.SANDSTORM, true);
          answers.suppressed = attr.canApply(chanceParams(30));
          setWeather(WeatherType.HAIL);
          answers.inHail = attr.canApply(chanceParams(30));
          expect(which).toBeTruthy();
          return answers;
        });
        expect(chance[0], name).toEqual({
          inSand: true,
          inSandNoChance: false,
          chanceAfter: 0,
          suppressed: false,
          inHail: false,
        });
        expect(chance[1], name).toEqual(chance[0]);
      }
    } finally {
      arena.weather = weather;
    }
  });

  it("Overzealous: the bonus goes to a super effective move against the first foe only, never without a foe or when the check throws", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const params = () => ({ pokemon: holder, move: allMoves[MoveId.TACKLE], priority: new NumberHolder(0) }) as never;
    const [a, b] = both("SePriorityBonusAbAttr", "Overzealous", attr => {
      const answers: Record<string, boolean> = {};
      vi.spyOn(holder, "getOpponents").mockReturnValue([foe] as never);
      const effectiveness = vi.spyOn(foe, "getMoveEffectiveness");
      for (const [label, value] of [
        ["super", 2],
        ["fourTimes", 4],
        ["neutral", 1],
        ["resisted", 0.5],
      ] as const) {
        effectiveness.mockReturnValue(value as never);
        answers[label] = attr.canApply(params());
      }
      effectiveness.mockImplementation((() => {
        throw new Error("no matchup");
      }) as never);
      answers.throws = attr.canApply(params());
      vi.spyOn(holder, "getOpponents").mockReturnValue([] as never);
      answers.noFoe = attr.canApply(params());
      const held = params();
      attr.apply(held);
      answers.priorityAfter = (held as unknown as { priority: NumberHolder }).priority.value === 1;
      vi.restoreAllMocks();
      return answers;
    });
    expect(a).toEqual({
      super: true,
      fourTimes: true,
      neutral: false,
      resisted: false,
      throws: false,
      noFoe: false,
      priorityAfter: true,
    });
    expect(b).toEqual(a);
  });

  it("Break screens: damaging moves of the type only, never without a target or in a preview, from the TARGET's side", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const arena = globalScene.arena;
    const params = (extra: object = {}) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
        ...extra,
      }) as never;
    const results = both("RemoveScreensOnTypedAttackAbAttr", "Warrior's Spear", (attr, which) => {
      const answers: Record<string, boolean> = {};
      const moveType = vi.spyOn(holder, "getMoveType");
      moveType.mockReturnValue(PokemonType.FIGHTING);
      answers.fighting = attr.canApply(params());
      answers.noTarget = attr.canApply(params({ opponent: undefined }));
      answers.statusMove = attr.canApply(params({ move: allMoves[MoveId.SWORDS_DANCE] }));
      moveType.mockReturnValue(PokemonType.WATER);
      answers.water = attr.canApply(params());
      const removed = vi.spyOn(arena, "removeTagsOnSide").mockReturnValue(undefined as never);
      moveType.mockReturnValue(PokemonType.FIGHTING);
      attr.apply(params({ simulated: true }));
      answers.simulatedRemoved = removed.mock.calls.length > 0;
      attr.apply(params({ opponent: undefined }));
      answers.noTargetRemoved = removed.mock.calls.length > 0;
      attr.apply(params());
      expect(removed, which).toHaveBeenCalledWith(
        [ArenaTagType.REFLECT, ArenaTagType.LIGHT_SCREEN, ArenaTagType.AURORA_VEIL],
        foe.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY,
      );
      vi.restoreAllMocks();
      return answers;
    });
    expect(results[0]).toEqual({
      fighting: true,
      noTarget: false,
      statusMove: false,
      water: false,
      simulatedRemoved: false,
      noTargetRemoved: false,
    });
    expect(results[1]).toEqual(results[0]);
  });

  it("Raise my best stat: the highest listed stat wins (first listed on a tie), the weather gate is the raw weather type, a preview does nothing", async () => {
    const { holder } = await startWorld(phaserGame);
    const arena = globalScene.arena;
    const weather = arena.weather;
    const queued: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    const stats = (values: Partial<Record<number, number>>) =>
      vi.spyOn(holder, "getStat").mockImplementation(((stat: number) => values[stat] ?? 1) as never);
    const entry = (attr: any, simulated = false) => {
      queued.length = 0;
      const params = { pokemon: holder, simulated } as never;
      if (!attr.canApply(params)) {
        return "blocked";
      }
      attr.apply(params);
      return queued.map(call => [call[2], (call[3] as number[])[0], call[4]]);
    };
    try {
      // Majestic Moth: no gate, all five stats, +1. SpD highest -> SpD. A tie between Atk and Spe goes to Atk.
      const moth = both("SelfHighestStatBoostOnSummonAbAttr", "Majestic Moth", attr => {
        stats({ [Stat.SPDEF]: 300, [Stat.ATK]: 100 });
        const spDef = entry(attr);
        stats({ [Stat.ATK]: 200, [Stat.SPD]: 200 });
        const tie = entry(attr);
        const preview = entry(attr, true);
        return [spDef, tie, preview];
      });
      expect(moth[0]).toEqual([[[true, Stat.SPDEF, 1]], [[true, Stat.ATK, 1]], []]);
      expect(moth[1]).toEqual(moth[0]);
      // Berserk DNA: only Attack and Sp. Atk count, +2
      const dna = both("SelfHighestStatBoostOnSummonAbAttr", "Berserk DNA", attr => {
        stats({ [Stat.SPD]: 999, [Stat.ATK]: 100, [Stat.SPATK]: 150 });
        return entry(attr);
      });
      expect(dna[0]).toEqual([[true, Stat.SPATK, 2]]);
      expect(dna[1]).toEqual(dna[0]);
      // Sun Worship: Sun or Extremely harsh sunlight only; a missing weather blocks
      const sun = both("SelfHighestStatBoostOnSummonAbAttr", "Sun Worship", attr => {
        const answers: Record<string, boolean> = {};
        for (const [label, type] of [
          ["sun", WeatherType.SUNNY],
          ["harshSun", WeatherType.HARSH_SUN],
          ["rain", WeatherType.RAIN],
          ["none", undefined],
        ] as const) {
          arena.weather = (
            type === undefined ? undefined : { weatherType: type, isEffectSuppressed: () => true }
          ) as never;
          answers[label] = attr.canApply({ pokemon: holder, simulated: false } as never);
        }
        return answers;
      });
      expect(sun[0]).toEqual({ sun: true, harshSun: true, rain: false, none: false });
      expect(sun[1]).toEqual(sun[0]);
    } finally {
      arena.weather = weather;
    }
  });
});
