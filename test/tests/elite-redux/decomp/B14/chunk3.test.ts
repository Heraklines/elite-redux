/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3: what the shared L1 and L2 suites cannot see.
//  - The Tier B split of Low Tide and Celestial Jelly is a pure move of code. Each test compares the refactored `canApply`
//    with a literal copy of the ORIGINAL expression (copied from the commit before the split) over every combination of its
//    clauses, including which calls happen at all (short-circuit order).
//  - `gateOverride` replaces only the gate; the guards keep running.
//  - The constructor arguments added for the editable params default to the old fixed values, and the move-name codec works.
//  - The marker classes have no dispatch moment, so their readers are driven here: the real engine code that reads each
//    marker is run with and without it and the difference is asserted.
import { allAbilities, allMoves } from "#data/data-lists";
import { RagingFistAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import {
  CelestialJellyAbAttr,
  LowTideWaterSurfAbAttr,
  SeaSpecterAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { Status } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { RageFistPowerAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const LOW_TIDE = 6071;
const SEA_SPECTER = 6072;
const CELESTIAL_JELLY = 6078;
const REDUCTION_RUNE = 6082;
const MONK = 6083;
const FREE_AIM = 6090;
const AMATERASU = 6106;
const RAGING_FIST = 6116;

const CATEGORIES = [MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS];

function newGame(phaserGame: Phaser.Game, options: { ability: number; enemyAbility?: AbilityId; double?: boolean }) {
  const game = new GameManager(phaserGame);
  game.override
    .battleStyle(options.double === true ? "double" : "single")
    .moveset([MoveId.CELEBRATE, MoveId.TACKLE])
    .ability(options.ability as AbilityId)
    .startingLevel(100)
    .enemySpecies(SpeciesId.MAGIKARP)
    .enemyLevel(30)
    .enemyAbility(options.enemyAbility ?? AbilityId.BALL_FETCH)
    .enemyMoveset([MoveId.SPLASH])
    .criticalHits(false)
    .hasPassiveAbility(false)
    .enemyHasPassiveAbility(false);
  return game;
}

describe("B14 chunk 3: Low Tide", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("canApply equals the original expression for every clause combination, in the same call order", () => {
    const attr = liveAbility(LOW_TIDE).attrs[2] as LowTideWaterSurfAbAttr;
    expect(attr.constructor.name).toBe("LowTideWaterSurfAbAttr");
    expect([attr.moveId, attr.power]).toEqual([MoveId.SURF, 50]);
    let accepted = 0;
    let compared = 0;
    for (const simulated of [false, true]) {
      for (const category of CATEGORIES) {
        for (const type of [PokemonType.WATER, PokemonType.FIRE, PokemonType.GHOST]) {
          let calls = 0;
          const opponent = {
            getMoveType: () => {
              calls++;
              return type;
            },
          };
          const move = { category };
          // The original expression, copied from the code before the split.
          let originalCalls = 0;
          const originalOpponent = {
            getMoveType: () => {
              originalCalls++;
              return type;
            },
          };
          const original =
            !simulated && move.category !== MoveCategory.STATUS && originalOpponent.getMoveType() === PokemonType.WATER;
          expect(attr.canApply({ opponent, move, simulated } as never)).toBe(original);
          expect(calls, "the type is asked exactly when the original asked").toBe(originalCalls);
          compared++;
          accepted += original ? 1 : 0;
        }
      }
    }
    expect(accepted).toBe(2);
    expect(compared).toBe(18);
  });

  it("a replaced gate replaces only the gate: the preview guard keeps running", () => {
    const attr = new LowTideWaterSurfAbAttr();
    attr.gateOverride = () => true;
    const opponent = { getMoveType: () => PokemonType.FIRE };
    const move = { category: MoveCategory.STATUS };
    expect(attr.canApply({ opponent, move, simulated: false } as never)).toBe(true);
    expect(attr.canApply({ opponent, move, simulated: true } as never)).toBe(false);
  });

  it("the move and power params read back and the move-name codec accepts player words", () => {
    const decl = declRegistry.get("LowTideWaterSurfAbAttr")!.decl;
    const codec = decl.params[0].codec!;
    expect(codec.toCtor("Surf")).toBe(MoveId.SURF);
    expect(codec.toCtor("surf")).toBe(MoveId.SURF);
    expect(codec.toCtor("Steam Eruption")).toBe(MoveId.STEAM_ERUPTION);
    expect(codec.toCtor("STEAM_ERUPTION")).toBe(MoveId.STEAM_ERUPTION);
    expect(() => codec.toCtor("not a move")).toThrow(/not a known move/);
    expect(codec.fromInstance(MoveId.SURF)).toBe("Surf");
    expect(codec.fromInstance(MoveId.STEAM_ERUPTION)).toBe("Steam eruption");
    const custom = new LowTideWaterSurfAbAttr(MoveId.EMBER, 80);
    expect([custom.moveId, custom.power]).toEqual([MoveId.EMBER, 80]);
  });

  // One battle per test (the test framework allows one GameManager at a time).
  for (const [name, foeMove, enemyAbility, answered] of [
    [
      "a Water move that gets through (the foe ignores abilities) is answered with the free move",
      MoveId.WATER_GUN,
      AbilityId.MOLD_BREAKER,
      true,
    ],
    ["a non-Water damaging move gets no answer", MoveId.TACKLE, AbilityId.MOLD_BREAKER, false],
    ["a status move gets no answer", MoveId.GROWL, AbilityId.MOLD_BREAKER, false],
    [
      "a Water move the holder absorbs gets no answer (oddity, see notes)",
      MoveId.WATER_GUN,
      AbilityId.BALL_FETCH,
      false,
    ],
  ] as const) {
    it(`through the engine: ${name}`, async () => {
      const game = newGame(phaserGame, { ability: LOW_TIDE, enemyAbility });
      game.override.enemyMoveset([foeMove]).enemySpecies(SpeciesId.BLISSEY).enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const foe = game.field.getEnemyPokemon();
      const before = foe.hp;
      game.move.select(MoveId.CELEBRATE);
      await game.toNextTurn();
      if (answered) {
        expect(foe.hp).toBeLessThan(before);
      } else {
        expect(foe.hp).toBe(before);
      }
    });
  }
});

describe("B14 chunk 3: Sea Specter", () => {
  it("the shipped pair is Ghost and Water, the types read back, and a custom pair works the same way", () => {
    const attr = liveAbility(SEA_SPECTER).attrs[0] as SeaSpecterAbAttr;
    expect(attr.constructor.name).toBe("SeaSpecterAbAttr");
    expect([attr.firstType, attr.secondType]).toEqual([PokemonType.GHOST, PokemonType.WATER]);
    const move = (type: PokemonType) => ({ type }) as never;
    expect(attr.getTriggeredMoveTypes(move(PokemonType.GHOST))).toEqual([PokemonType.GHOST, PokemonType.WATER]);
    expect(attr.getTriggeredMoveTypes(move(PokemonType.WATER))).toEqual([PokemonType.WATER, PokemonType.GHOST]);
    expect(attr.getTriggeredMoveTypes(move(PokemonType.FIRE))).toEqual([PokemonType.FIRE]);
    const custom = new SeaSpecterAbAttr(PokemonType.FIRE, PokemonType.GRASS);
    expect(custom.getTriggeredMoveTypes(move(PokemonType.FIRE))).toEqual([PokemonType.FIRE, PokemonType.GRASS]);
    expect(custom.getTriggeredMoveTypes(move(PokemonType.GRASS))).toEqual([PokemonType.GRASS, PokemonType.FIRE]);
    expect(custom.getTriggeredMoveTypes(move(PokemonType.GHOST))).toEqual([PokemonType.GHOST]);
    expect(attr.showAbility).toBe(false);
  });
});

describe("B14 chunk 3: Celestial Jelly", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("canApply equals the original expression for every spent, damage, weather and terrain combination", async () => {
    const game = newGame(phaserGame, { ability: CELESTIAL_JELLY });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(CELESTIAL_JELLY).attrs[0] as CelestialJellyAbAttr;
    expect(attr.constructor.name).toBe("CelestialJellyAbAttr");
    expect(attr.hpFraction).toBe(0.25);
    const arena = game.scene.arena;
    // The original expression, copied from the code before the split.
    const original = (damage: { value: number }): boolean => {
      if (
        holder.battleData.erAbilityProvenance.includes("celestial-jelly:spent")
        || holder.getMaxHp() <= 1
        || damage.value < holder.hp
      ) {
        return false;
      }
      const misty = arena.terrain?.terrainType === TerrainType.MISTY;
      const weather = arena.weather;
      const rain =
        weather !== null
        && !weather.isEffectSuppressed()
        && (weather.weatherType === WeatherType.RAIN || weather.weatherType === WeatherType.HEAVY_RAIN);
      return misty || rain;
    };
    let accepted = 0;
    let compared = 0;
    // A fresh arena has `weather === undefined`; setting a weather and clearing it makes it `null`, the value the game uses.
    arena.trySetWeather(WeatherType.RAIN);
    for (const weather of [WeatherType.NONE, WeatherType.RAIN, WeatherType.HEAVY_RAIN, WeatherType.SUNNY]) {
      for (const terrain of [TerrainType.NONE, TerrainType.MISTY, TerrainType.GRASSY]) {
        arena.trySetWeather(weather);
        arena.trySetTerrain(terrain, true);
        for (const spent of [false, true]) {
          holder.battleData.erAbilityProvenance = spent ? ["celestial-jelly:spent"] : [];
          for (const damageValue of [holder.hp - 1, holder.hp, holder.hp + 1]) {
            const damage = new NumberHolder(damageValue);
            expect(attr.canApply({ pokemon: holder, damage } as never)).toBe(original(damage));
            compared++;
            accepted += original(damage) ? 1 : 0;
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(5);
    expect(compared - accepted).toBeGreaterThan(30);
    // Oddity pinned, not fixed: with a fresh arena (weather undefined, nothing ever set) the gate throws, as the original did.
    arena.weather = undefined as never;
    arena.trySetTerrain(TerrainType.NONE, true);
    holder.battleData.erAbilityProvenance = [];
    expect(() => attr.canApply({ pokemon: holder, damage: new NumberHolder(holder.hp + 5) } as never)).toThrow(
      TypeError,
    );
    // A 1 max HP Pokemon is never saved (clause 2).
    arena.trySetWeather(WeatherType.RAIN);
    holder.battleData.erAbilityProvenance = [];
    const realMax = holder.getMaxHp();
    holder.getMaxHp = () => 1;
    expect(attr.canApply({ pokemon: holder, damage: new NumberHolder(holder.hp + 5) } as never)).toBe(false);
    holder.getMaxHp = () => realMax;
  });

  it("a replaced gate replaces only the gate: the guards keep running", async () => {
    const game = newGame(phaserGame, { ability: CELESTIAL_JELLY });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const attr = new CelestialJellyAbAttr();
    attr.gateOverride = () => true;
    const lethal = new NumberHolder(holder.hp + 1);
    const small = new NumberHolder(1);
    expect(attr.canApply({ pokemon: holder, damage: lethal } as never)).toBe(true);
    expect(attr.canApply({ pokemon: holder, damage: small } as never)).toBe(false);
    holder.battleData.erAbilityProvenance = ["celestial-jelly:spent"];
    expect(attr.canApply({ pokemon: holder, damage: lethal } as never)).toBe(false);
  });

  it("the share of HP left is a constructor argument and the codec shows it as a percent", () => {
    const decl = declRegistry.get("CelestialJellyAbAttr")!.decl;
    const codec = decl.params[0].codec!;
    expect(codec.toCtor(25)).toBe(0.25);
    expect(codec.fromInstance(0.25)).toBe(25);
    expect(codec.fromInstance(0.07)).toBe(7);
    const half = new CelestialJellyAbAttr(0.5);
    const pokemon = {
      battleData: { erAbilityProvenance: [] as string[] },
      getMaxHp: () => 100,
      hp: 100,
      resetStatus: () => undefined,
      updateInfo: () => undefined,
    };
    const damage = { value: 100 };
    half.apply({ pokemon: pokemon as never, damage, simulated: false } as never);
    expect(damage.value).toBe(50);
    // simulated: the damage is rewritten, nothing is remembered
    const preview = { value: 100 };
    const fresh = { ...pokemon, battleData: { erAbilityProvenance: [] as string[] } };
    new CelestialJellyAbAttr().apply({ pokemon: fresh as never, damage: preview, simulated: true } as never);
    expect(preview.value).toBe(75);
    expect(fresh.battleData.erAbilityProvenance).toEqual([]);
  });

  async function lethalGame(weather: WeatherType) {
    const game = newGame(phaserGame, { ability: CELESTIAL_JELLY });
    game.override.enemySpecies(SpeciesId.MACHAMP).enemyLevel(100).enemyMoveset([MoveId.TACKLE]).startingLevel(20);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    // set a weather and clear it, so the arena holds `null` (the value the game uses) and not `undefined`
    game.scene.arena.trySetWeather(WeatherType.RAIN);
    game.scene.arena.trySetWeather(weather);
    return game;
  }

  it("through the engine: in rain a lethal hit leaves 25% HP and cures status, once", async () => {
    const game = await lethalGame(WeatherType.RAIN);
    const holder = game.field.getPlayerPokemon();
    holder.status = new Status(StatusEffect.PARALYSIS);
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    expect(holder.isFainted()).toBe(false);
    expect(holder.hp).toBe(Math.max(1, Math.floor(holder.getMaxHp() * 0.25)));
    expect(holder.status).toBeNull();
    expect(holder.battleData.erAbilityProvenance).toContain("celestial-jelly:spent");
    // spent: the second lethal hit knocks it out
    game.move.select(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("FaintPhase");
    expect(holder.isFainted()).toBe(true);
  });

  it("through the engine: without rain or Misty Terrain the lethal hit knocks me out", async () => {
    const game = await lethalGame(WeatherType.NONE);
    const holder = game.field.getPlayerPokemon();
    game.move.select(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("FaintPhase");
    expect(holder.isFainted()).toBe(true);
    expect(holder.battleData.erAbilityProvenance).not.toContain("celestial-jelly:spent");
  });
});

describe("B14 chunk 3: the marker classes, read by the real engine code", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  // Each battle is its own test (one GameManager at a time); the numbers are collected here and compared in the last test.
  const seen: Record<string, number> = {};

  it("every marker is the shipped empty class, found by its own name", () => {
    for (const [id, index, name] of [
      [REDUCTION_RUNE, 0, "ReductionRuneAbAttr"],
      [MONK, 3, "MonkFocusPunchAbAttr"],
      [FREE_AIM, 0, "FreeAimAbAttr"],
      [AMATERASU, 0, "AmaterasuMarkerAbAttr"],
      [RAGING_FIST, 0, "RagingFistAbAttr"],
    ] as const) {
      expect(allAbilities[id].attrs[index].constructor.name).toBe(name);
    }
    // Blaze Release carries the Amaterasu marker as its fourth attr.
    expect(allAbilities[6108].attrs[3].constructor.name).toBe("AmaterasuMarkerAbAttr");
  });

  it("Raging Fist: each hit taken counts twice, before the cap of six", () => {
    const attr = new RageFistPowerAttr();
    const power = (hits: number, marker: boolean): number => {
      const user = {
        battleData: { hitCount: hits },
        getAllActiveAbilityAttrs: () => (marker ? [new RagingFistAbAttr()] : []),
      };
      const holder = new NumberHolder(50);
      attr.apply(user as never, undefined as never, undefined as never, [holder]);
      return holder.value;
    };
    expect([0, 1, 3, 6, 9].map(hits => power(hits, false))).toEqual([50, 100, 200, 350, 350]);
    expect([0, 1, 3, 6, 9].map(hits => power(hits, true))).toEqual([50, 150, 350, 350, 350]);
  });

  for (const [label, ability] of [
    ["with", MONK],
    ["without", AbilityId.BALL_FETCH],
  ] as const) {
    it(`Monk (${label} the marker): Focus Punch power after the holder was hit`, async () => {
      const game = newGame(phaserGame, { ability });
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      holder.turnData.attacksReceived = [{ damage: 10 } as never];
      seen[`focus-${label}`] = allMoves[MoveId.FOCUS_PUNCH].calculateBattlePower(holder, foe, true);
      holder.turnData.attacksReceived = [];
      seen[`focus-${label}-unhit`] = allMoves[MoveId.FOCUS_PUNCH].calculateBattlePower(holder, foe, true);
    });
  }

  it("Monk: Focus Punch keeps full power after the holder was hit; without the marker it drops to 40", () => {
    expect(seen["focus-without-unhit"]).toBe(seen["focus-with-unhit"]);
    expect(seen["focus-with"]).toBe(seen["focus-with-unhit"]);
    // the move is cut to 40 power from its own: the unhit number times 40 / 150 (the move has 150 power)
    expect(seen["focus-without"]).toBe(Math.round((seen["focus-without-unhit"] * 40) / 150));
    expect(seen["focus-without"]).toBeLessThan(seen["focus-with"]);
  });

  for (const [label, ability] of [
    ["marked", AMATERASU],
    ["plain", AbilityId.BALL_FETCH],
  ] as const) {
    it(`Amaterasu (${label}): the burn it inflicts and whether it can be cured`, async () => {
      const game = newGame(phaserGame, { ability });
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      const queued = foe.trySetStatus(StatusEffect.BURN, holder);
      seen[`queued-${label}`] = queued ? 1 : 0;
      seen[`remembered-${label}`] =
        (foe.waveData as unknown as { amaterasuBurnSourceId?: number }).amaterasuBurnSourceId === holder.id ? 1 : 0;
      // the status itself is set by a queued phase; set it here so the cure can be tried
      foe.status = new Status(StatusEffect.BURN);
      foe.resetStatus(true, true, false, false);
      seen[`still-burned-${label}`] = foe.status?.effect === StatusEffect.BURN ? 1 : 0;
    });
  }

  it("Amaterasu: a burn the marker holder inflicts refuses to be cured; another burn is cured", () => {
    expect([seen["queued-marked"], seen["remembered-marked"], seen["still-burned-marked"]]).toEqual([1, 1, 1]);
    expect([seen["queued-plain"], seen["remembered-plain"], seen["still-burned-plain"]]).toEqual([1, 0, 0]);
  });
});

describe("B14 chunk 3: Reduction Rune and Free Aim through the engine", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  const seen: Record<string, number> = {};

  // One battle per holder species. The same holder is measured with the marker and, for the baseline, with the marker
  // hidden from the engine (its attrs list is emptied for the call), so nothing else about the battle differs.
  for (const [species, moves] of [
    [SpeciesId.BLISSEY, { weak: MoveId.KARATE_CHOP, neutral: MoveId.TACKLE }],
    [SpeciesId.CHARIZARD, { quad: MoveId.ROCK_THROW }],
  ] as const) {
    it(`Reduction Rune: damage taken by ${SpeciesId[species]} with and without the marker`, async () => {
      const game = newGame(phaserGame, { ability: REDUCTION_RUNE });
      game.override.enemySpecies(SpeciesId.MACHAMP).enemyLevel(100);
      await game.classicMode.startBattle(species);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      const measure = () => {
        const out: Record<string, number> = {};
        for (const [name, move] of Object.entries(moves)) {
          out[name] = holder.getAttackDamage({
            source: foe,
            move: allMoves[move],
            simulated: true,
            isCritical: false,
          }).damage;
        }
        // the holder attacks the foe: the holder itself is never capped
        out.own = foe.getAttackDamage({
          source: holder,
          move: allMoves[MoveId.SUBMISSION],
          simulated: true,
          isCritical: false,
        }).damage;
        return out;
      };
      const withMarker = measure();
      const hidden = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([]);
      const without = measure();
      hidden.mockRestore();
      for (const [name, value] of Object.entries(withMarker)) {
        seen[`with-${name}`] = value;
        seen[`without-${name}`] = without[name];
      }
    });
  }

  it("Reduction Rune: another attacker's 2x weakness counts as 1.5x and a 4x weakness as 2x; neutral hits and the holder's own attack are untouched", () => {
    expect(seen["with-weak"]).toBeGreaterThan(0);
    expect(Math.abs(seen["with-weak"] - seen["without-weak"] * 0.75)).toBeLessThanOrEqual(2);
    expect(Math.abs(seen["with-quad"] - seen["without-quad"] * 0.5)).toBeLessThanOrEqual(2);
    expect(seen["with-quad"]).toBeGreaterThan(0);
    expect(seen["with-neutral"]).toBe(seen["without-neutral"]);
    expect(seen["with-own"]).toBe(seen["without-own"]);
  });

  for (const [label, ability] of [
    ["with", FREE_AIM],
    ["without", AbilityId.BALL_FETCH],
  ] as const) {
    it(`Free Aim (${label} the marker): a single-target move aimed at one foe`, async () => {
      const game = newGame(phaserGame, { ability, double: true });
      // wave 1 is always a single battle in this game, so the double battle starts at wave 2
      game.override.startingWave(2);
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.MAGIKARP);
      const [firstFoe, weakFoe] = game.scene.getEnemyField();
      weakFoe.hp = 1;
      game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
      game.move.select(MoveId.CELEBRATE, 1);
      await game.toNextTurn();
      seen[`aim-${label}`] = weakFoe.hp === 0 ? 1 : firstFoe.hp < firstFoe.getMaxHp() ? 0 : -1;
    });
  }

  it("Free Aim: the move goes to the foe it can knock out; without the marker it goes where it was aimed", () => {
    expect(seen["aim-with"]).toBe(1);
    expect(seen["aim-without"]).toBe(0);
  });
});
