/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER tier-1 ability AUDIT FIXES (batch) — runtime BEHAVIOR proofs (GameManager).
//
// The wiring is pinned in `er-tier1-ability-fixes.test.ts`; this file drives the
// real battle engine to prove the runtime effect for the DETERMINISTIC (100%)
// fixes. Sub-100% procs (World Serpent 50% trap, Blight Scale 30% poison,
// Haunting Frenzy 20% flinch) can't fire under the test RNG max-clamp — those are
// verified via the CLI `run-scenario.mjs --real-rng` (see the batch report).
// Gated ER_SCENARIO=1.
// =============================================================================

import { TerrainType } from "#app/data/terrain";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { OffensiveTypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { TypeRecoilAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const DOOM_BLAST = ER_ID_MAP.abilities[757] as AbilityId;
const ACIDIC_SLIME = ER_ID_MAP.abilities[760] as AbilityId;
const PYROCLASTIC_FLOW = ER_ID_MAP.abilities[635] as AbilityId;
const STORM_CLOUD = ER_ID_MAP.abilities[989] as AbilityId;
const FARADAY_CAGE = ER_ID_MAP.abilities[759] as AbilityId;

describe.skipIf(!RUN)("ER tier-1 ability fixes — behavior", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100);
  });

  it("Doom Blast (757): the TypeRecoil clamp leaves the user at >=1 HP (never a self-KO)", async () => {
    // Drives the ACTUAL recoil primitive on a real Pokemon. Calling apply()
    // directly (rather than a full turn) isolates the recoil clamp from the
    // holder's other end-of-turn/innate self-damage sources — the recoil is the
    // ONLY thing that touches HP here, so a KO would mean the clamp failed.
    game.override.ability(DOOM_BLAST).moveset(MoveId.DARK_PULSE).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.HYDREIGON);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const darkMove = player.getMoveset()[0].getMove();

    // 5 HP holder, a huge Dark hit: an unclamped 10% recoil (100) would faint it.
    player.hp = 5;
    const recoil = new TypeRecoilAbAttr({ type: PokemonType.DARK, recoilPct: 0.1 });
    recoil.apply({
      pokemon: player,
      opponent: enemy,
      move: darkMove,
      hitResult: HitResult.EFFECTIVE,
      damage: 1000,
      simulated: false,
    });

    expect(player.isFainted(), "clamped recoil must not KO the user").toBe(false);
    expect(player.hp, "recoil clamped to leave exactly 1 HP (min(100, hp-1)=4)").toBe(1);
  });

  /** True if the live ability carries the Poison→Steel super-effective override rule. */
  function hasPoisonSteelOverride(player: ReturnType<GameManager["field"]["getPlayerPokemon"]>): boolean {
    return player
      .getAbility()
      .attrs.some(
        a =>
          a instanceof OffensiveTypeChartOverrideAbAttr
          && a
            .getRules()
            .some(
              r => r.attackType === PokemonType.POISON && r.defenderType === PokemonType.STEEL && r.newMultiplier === 2,
            ),
      );
  }

  it("Acidic Slime (760): the holder's Poison moves are SUPER-EFFECTIVE vs Steel (0x → 2x)", async () => {
    game.override.ability(ACIDIC_SLIME).enemySpecies(SpeciesId.REGISTEEL).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // The fix's override rule is on the live ability (attribution) …
    expect(hasPoisonSteelOverride(player), "Acidic Slime must carry the Poison→Steel override").toBe(true);
    // … and the type-chart base 0x (Steel immune to Poison) is rewritten to 2x.
    expect(enemy.getAttackTypeEffectiveness(PokemonType.POISON, { source: player })).toBe(2);
  });

  it("Pyroclastic Flow (635): the holder's Poison moves are SUPER-EFFECTIVE vs Steel", async () => {
    game.override.ability(PYROCLASTIC_FLOW).enemySpecies(SpeciesId.REGISTEEL).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(hasPoisonSteelOverride(player), "Pyroclastic Flow must carry the Poison→Steel override").toBe(true);
    expect(enemy.getAttackTypeEffectiveness(PokemonType.POISON, { source: player })).toBe(2);
  });

  it("Storm Cloud (989): grants Electric STAB WITHOUT adding a defensive Electric typing (no Ground weakness)", async () => {
    game.override.ability(STORM_CLOUD).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX); // Normal-type holder
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // The old add-self-type wiring would graft Electric onto the holder's typing
    // (→ 2x Ground weakness). StabAdd must NOT touch defensive typing.
    expect(player.getTypes()).not.toContain(PokemonType.ELECTRIC);
    // A Normal-type holder takes NEUTRAL (1x) Ground — not 2x — proving no Electric
    // defensive typing was added.
    expect(player.getAttackTypeEffectiveness(PokemonType.GROUND, { source: enemy })).toBe(1);
    // The on-entry RAIN(8) half is intact.
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.RAIN);
    expect(game.scene.arena.weather?.turnsLeft).toBe(8);
  });

  it("Orichalcum Pulse (584): sets sun on entry for 8 turns (not vanilla 5)", async () => {
    game.override
      .ability(AbilityId.ORICHALCUM_PULSE)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.KORAIDON);
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.SUNNY);
    expect(game.scene.arena.weather?.turnsLeft).toBe(8);
  });

  it("Hadron Engine (587): sets electric terrain on entry for 8 turns (not vanilla 5)", async () => {
    game.override.ability(AbilityId.HADRON_ENGINE).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MIRAIDON);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.ELECTRIC);
    expect(game.scene.arena.terrain?.turnsLeft).toBe(8);
  });

  // Faraday Cage's 0.8x incoming reduction is not type-based, so it needs a
  // damage comparison across two otherwise-identical battles. Enemy Alakazam's
  // Psychic (high SpAtk, neutral vs a Normal holder) deals a large-enough hit
  // that the 20% is well clear of integer rounding.
  let controlDamage = 0;

  it("Faraday Cage control: baseline damage from a fixed Psychic hit (no reduction)", async () => {
    game.override
      .enemySpecies(SpeciesId.ALAKAZAM)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyPassiveAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.PSYCHIC)
      .ability(AbilityId.BALL_FETCH)
      .passiveAbility(AbilityId.BALL_FETCH) // pin passive inert so the mon's own reducer can't leak in
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const before = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    controlDamage = before - player.hp;
    expect(controlDamage).toBeGreaterThan(0);
  });

  it("Faraday Cage (759): incoming damage is reduced ~20% (0.8x, multiplicative)", async () => {
    game.override
      .enemySpecies(SpeciesId.ALAKAZAM)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyPassiveAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.PSYCHIC)
      .ability(FARADAY_CAGE)
      .passiveAbility(AbilityId.BALL_FETCH) // pin passive inert so ONLY Faraday's DR applies
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    // MY fix wires EXACTLY ONE DamageReduction rider on the live ability (0.8x).
    const drs = player.getAbility().attrs.filter(a => a instanceof DamageReductionAbAttr);
    expect(drs, "Faraday Cage must carry exactly one DamageReduction rider").toHaveLength(1);
    expect((drs[0] as DamageReductionAbAttr).getReduction(), "the rider reduces incoming damage by 20%").toBeCloseTo(
      0.2,
    );

    const before = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    const reducedDamage = before - player.hp;

    // Behaviorally, incoming damage is reduced by AT LEAST the wired 20% (0.8x).
    // (The exact factor can be compounded further by the holder species' own
    // innate reducers in the harness; the wiring assertion above pins the 0.2.)
    expect(reducedDamage, `reduced=${reducedDamage} control=${controlDamage}`).toBeLessThanOrEqual(
      Math.round(controlDamage * 0.8),
    );
    expect(reducedDamage, "damage was still dealt (not fully blocked)").toBeGreaterThan(0);
  });
});
