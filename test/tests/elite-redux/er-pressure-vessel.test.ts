import {
  ER_PRESSURE_VESSEL_ABILITY_ID,
  PRESSURE_VESSEL_MAX_MULTIPLIER,
  PRESSURE_VESSEL_MIN_MULTIPLIER,
  PressureVesselAbAttr,
  pressureVesselPpFraction,
} from "#data/elite-redux/abilities/pressure-vessel";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const PRESSURE_VESSEL = ER_PRESSURE_VESSEL_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Pressure Vessel (5914)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(PRESSURE_VESSEL)
      .moveset([MoveId.TACKLE, MoveId.GROWL, MoveId.HARDEN, MoveId.LEER]);
  });

  it("scales the multiplier LINEARLY: 1.5x at full PP, 1.25x at half, 1.0x empty, and an odd fraction", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const attr = new PressureVesselAbAttr();

    // Full PP → 1.5x.
    for (const m of player.getMoveset()) {
      m.ppUsed = 0;
    }
    expect(pressureVesselPpFraction(player)).toBeCloseTo(1, 5);
    expect(attr.multiplierFor(player)).toBeCloseTo(PRESSURE_VESSEL_MAX_MULTIPLIER, 5);

    // Empty every move → 0% → 1.0x.
    for (const m of player.getMoveset()) {
      m.ppUsed = m.getMovePp();
    }
    expect(pressureVesselPpFraction(player)).toBeCloseTo(0, 5);
    expect(attr.multiplierFor(player)).toBeCloseTo(PRESSURE_VESSEL_MIN_MULTIPLIER, 5);

    // Exactly half of the total PP spent → 1.25x.
    const totalMax = player.getMoveset().reduce((s, m) => s + m.getMovePp(), 0);
    let toSpend = Math.floor(totalMax / 2);
    for (const m of player.getMoveset()) {
      const take = Math.min(m.getMovePp(), toSpend);
      m.ppUsed = take;
      toSpend -= take;
    }
    expect(pressureVesselPpFraction(player)).toBeCloseTo(0.5, 2);
    expect(attr.multiplierFor(player)).toBeCloseTo(1.25, 2);

    // Odd fraction: spend 3 of the total remaining across the moveset.
    for (const m of player.getMoveset()) {
      m.ppUsed = 0;
    }
    player.getMoveset()[0].ppUsed = 3;
    const frac = pressureVesselPpFraction(player);
    expect(attr.multiplierFor(player)).toBeCloseTo(
      PRESSURE_VESSEL_MIN_MULTIPLIER + (PRESSURE_VESSEL_MAX_MULTIPLIER - PRESSURE_VESSEL_MIN_MULTIPLIER) * frac,
      5,
    );
  });

  it("applies live to the holder's effective Defense and Sp. Def", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    // Full PP → 1.5x on both defensive stats.
    for (const m of player.getMoveset()) {
      m.ppUsed = 0;
    }
    const rawDef = player.getStat(Stat.DEF, false);
    const rawSpDef = player.getStat(Stat.SPDEF, false);
    expect(player.getEffectiveStat(Stat.DEF)).toBe(Math.floor(rawDef * PRESSURE_VESSEL_MAX_MULTIPLIER));
    expect(player.getEffectiveStat(Stat.SPDEF)).toBe(Math.floor(rawSpDef * PRESSURE_VESSEL_MAX_MULTIPLIER));

    // Empty PP → 1.0x (unchanged).
    for (const m of player.getMoveset()) {
      m.ppUsed = m.getMovePp();
    }
    expect(player.getEffectiveStat(Stat.DEF)).toBe(rawDef);
    expect(player.getEffectiveStat(Stat.SPDEF)).toBe(rawSpDef);
  });
});
