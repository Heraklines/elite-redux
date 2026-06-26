/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER biome field/economy identities (#439 §3, second batch) - the in-battle
// READERS. Each effect must fire IN its biome and NOT in an unrelated biome.
// Driven through the real GameManager so the battle phases / RNG run for real.
// ER_SCENARIO=1. NOTE: ONE GameManager per test (the prompt-handler interval is a
// per-test static), so in-biome and control cases live in separate it() blocks.
//
//   Temple      - stat stages FROZEN (no raise/lower, either side)
//   Dojo        - Fighting moves never resisted (resist/immunity floored to 1x)
//   Lake        - party heals a little each turn end
//   Slum        - lose % money per ally faint in a TRAINER battle
//   Wasteland   - a defeated WILD mon drops its held items to your lead
//   Factory     - every wild mon holds >=1 item
//   Laboratory  - ~50% of wild encounters are fusions
//   Ambush      - Ruins Def-gated ambush + the "You were ambushed!" signal
// =============================================================================

import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import * as Common from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER biome field/economy effects - in-battle readers (#439 §3)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(3) // a plain wild wave (not x0, not a fixed boss)
      .startingLevel(50)
      .enemyLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset([MoveId.SPLASH])
      .criticalHits(false);
  });

  afterEach(() => vi.restoreAllMocks());

  // ---- Misty terrain (Temple + Fairy Cave) -------------------------------
  it("Temple sets Misty terrain on entry", async () => {
    game.override.startingBiome(BiomeId.TEMPLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(game.scene.arena.terrain?.terrainType, "Temple forces Misty terrain").toBe(TerrainType.MISTY);
  }, 120_000);

  it("Fairy Cave sets Misty terrain on entry (alongside its blessing)", async () => {
    game.override.startingBiome(BiomeId.FAIRY_CAVE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(game.scene.arena.terrain?.terrainType, "Fairy Cave forces Misty terrain").toBe(TerrainType.MISTY);
  }, 120_000);

  // ---- Temple: stat stages frozen ----------------------------------------
  it("Temple FREEZES stat stages - Swords Dance does nothing", async () => {
    game.override.startingBiome(BiomeId.TEMPLE).moveset([MoveId.SWORDS_DANCE]);
    await game.classicMode.startBattle(SpeciesId.SCEPTILE);
    const lead = game.scene.getPlayerPokemon()!;
    game.move.use(MoveId.SWORDS_DANCE);
    await game.toEndOfTurn();
    expect(lead.getStatStage(Stat.ATK), "Temple froze the +2 Swords Dance").toBe(0);
  }, 120_000);

  it("control: outside Temple, Swords Dance raises ATK +2", async () => {
    game.override.startingBiome(BiomeId.PLAINS).moveset([MoveId.SWORDS_DANCE]);
    await game.classicMode.startBattle(SpeciesId.SCEPTILE);
    const lead = game.scene.getPlayerPokemon()!;
    game.move.use(MoveId.SWORDS_DANCE);
    await game.toEndOfTurn();
    expect(lead.getStatStage(Stat.ATK), "outside Temple Swords Dance works normally").toBe(2);
  }, 120_000);

  // ---- Dojo: Fighting moves never resisted -------------------------------
  it("Dojo floors a resisted Fighting move to >=1x effectiveness", async () => {
    // Toxicroak (Poison/Fighting) resists Fighting (0.5x). In Dojo that floors to 1x.
    game.override.startingBiome(BiomeId.DOJO).moveset([MoveId.BRICK_BREAK]).enemySpecies(SpeciesId.TOXICROAK);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const mult = enemy.getMoveEffectiveness(player, player.getMoveset()[0].getMove());
    expect(mult, "Dojo floors the Fighting resistance to neutral").toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("control: outside Dojo, the same Fighting move is resisted (<1x)", async () => {
    game.override.startingBiome(BiomeId.PLAINS).moveset([MoveId.BRICK_BREAK]).enemySpecies(SpeciesId.TOXICROAK);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const mult = enemy.getMoveEffectiveness(player, player.getMoveset()[0].getMove());
    expect(mult, "outside Dojo the Fighting move is resisted").toBeLessThan(1);
  }, 120_000);

  // ---- Lake: per-turn party heal -----------------------------------------
  // The Lake heal queues the standard turn-end "HP was restored" message for the
  // damaged player mon. We assert on that log line (robust against any enemy chip:
  // NB this ER fork redefines several vanilla "status" move ids as DAMAGING, so no
  // truly inert enemy move exists to zero out HP for a numeric delta).
  it("Lake heals the active mon and logs the turn-end restore; Plains does not", async () => {
    game.override.startingBiome(BiomeId.LAKE).enemyMoveset([MoveId.SPLASH]).enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const lead = game.field.getPlayerPokemon();
    lead.hp = Math.floor(lead.getMaxHp() / 2); // damaged, so the heal is not a no-op
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    await game.phaseInterceptor.to("TurnInitPhase"); // let the queued heal land
    const log = game.textInterceptor.logs.join("\n");
    expect(log, "Lake queued the turn-end party heal").toMatch(/HP was restored/i);
  }, 120_000);

  it("control: Plains does NOT heal the party each turn", async () => {
    game.override.startingBiome(BiomeId.PLAINS).enemyMoveset([MoveId.SPLASH]).enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const lead = game.field.getPlayerPokemon();
    lead.hp = Math.floor(lead.getMaxHp() / 2);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    await game.phaseInterceptor.to("TurnInitPhase");
    const log = game.textInterceptor.logs.join("\n");
    expect(log, "Plains does not heal the party each turn").not.toMatch(/HP was restored/i);
  }, 120_000);

  // ---- Factory: every wild mon holds an item -----------------------------
  it("Factory guarantees a wild mon holds an item", async () => {
    // Keep the enemy's generated items (the harness otherwise strips them).
    game.override.removeEnemyStartingItems = false;
    game.override.startingBiome(BiomeId.FACTORY).moveset([MoveId.SPLASH]).enemySpecies(SpeciesId.PIDGEY);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.scene.getEnemyPokemon()!;
    const heldCount = game.scene.findModifiers(
      m => m.is("PokemonHeldItemModifier") && m.pokemonId === enemy.id,
      false,
    ).length;
    expect(heldCount, "the Factory wild mon holds at least one item").toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---- Laboratory: ~50% wild fusions (forced roll -> always a fusion) -----
  it("Laboratory turns a wild encounter into a fusion when the biome roll passes", async () => {
    game.override.startingBiome(BiomeId.LABORATORY).moveset([MoveId.SPLASH]).enemySpecies(SpeciesId.PIDGEY);
    // Force the wild-fusion biome roll (randSeedInt(100) < 50) to pass: return 0
    // (min) for the 100-range draw, leave every other RNG call untouched.
    const orig = Common.randSeedInt;
    vi.spyOn(Common, "randSeedInt").mockImplementation((range: number, min = 0) =>
      range === 100 ? min : orig(range, min),
    );
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.scene.getEnemyPokemon()!;
    expect(enemy.isFusion(), "Laboratory made the wild mon a fusion").toBe(true);
  }, 120_000);

  // ---- Wasteland: a defeated wild mon drops its held item to your lead -----
  it("Wasteland drops a defeated wild mon's held item onto your lead", async () => {
    game.override
      .startingBiome(BiomeId.WASTELAND)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyHeldItems([{ name: "WIDE_LENS" }]);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.scene.getPlayerPokemon()!;
    const before = game.scene.findModifiers(
      m => m.is("PokemonHeldItemModifier") && m.pokemonId === player.id,
      true,
    ).length;
    game.move.use(MoveId.TACKLE); // one-shot the L1 wild mon
    await game.toEndOfTurn();
    const after = game.scene.findModifiers(
      m => m.is("PokemonHeldItemModifier") && m.pokemonId === player.id,
      true,
    ).length;
    expect(after, "the Wasteland wild drop gave the lead a new held item").toBeGreaterThan(before);
  }, 120_000);

  it("control: outside Wasteland a defeated wild mon does NOT auto-drop its item", async () => {
    game.override
      .startingBiome(BiomeId.PLAINS)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyHeldItems([{ name: "WIDE_LENS" }]);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.scene.getPlayerPokemon()!;
    const before = game.scene.findModifiers(
      m => m.is("PokemonHeldItemModifier") && m.pokemonId === player.id,
      true,
    ).length;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const after = game.scene.findModifiers(
      m => m.is("PokemonHeldItemModifier") && m.pokemonId === player.id,
      true,
    ).length;
    expect(after, "outside Wasteland there is no guaranteed wild drop").toBe(before);
  }, 120_000);

  // ---- Slum: lose money per ally faint in a TRAINER battle ----------------
  // A SINGLE-mon party in a TRAINER battle: the lead (1 HP) is KO'd, with no bench
  // there is no switch prompt - the run ends, but money is debited at the TOP of
  // FaintPhase.doFaint (before the game-over push), so we read it at GameOverPhase.
  it("Slum drains money when your mon faints to a TRAINER", async () => {
    game.override
      .startingBiome(BiomeId.SLUM)
      .battleType(BattleType.TRAINER)
      .enemyMoveset([MoveId.TACKLE])
      .enemyLevel(100)
      .startingLevel(50);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.money = 100_000;
    game.field.getPlayerPokemon().hp = 1; // the trainer's Tackle KOs the only mon
    game.move.use(MoveId.SPLASH);
    await game.phaseInterceptor.to("GameOverPhase");
    expect(game.scene.money, "the Slum took a cut of money on the trainer-battle faint").toBeLessThan(100_000);
  }, 120_000);

  it("control: a wild-battle faint does NOT drain money in the Slum", async () => {
    game.override.startingBiome(BiomeId.SLUM).enemyMoveset([MoveId.TACKLE]).enemyLevel(100).startingLevel(50);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.money = 100_000;
    game.field.getPlayerPokemon().hp = 1; // the wild foe KOs the only mon
    game.move.use(MoveId.SPLASH);
    await game.phaseInterceptor.to("GameOverPhase");
    expect(game.scene.money, "a WILD faint is free even in the Slum").toBe(100_000);
  }, 120_000);

  // ---- Ambush signal: Ruins Def-gated ambush queues the message ----------
  it("Ruins ambushes a low-Defense lead and announces 'You were ambushed!'", async () => {
    // Chansey: huge HP, very low Def -> Def < the foe's Atk -> the Ruins ambush
    // fires, but the bulky HP survives the hit, so no forced switch is needed.
    game.override
      .startingBiome(BiomeId.RUINS)
      .moveset([MoveId.SPLASH])
      .enemyMoveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.MACHAMP)
      .enemyLevel(60);
    // Force the 15% ambush roll to fire (randBattleSeedInt(100) -> min).
    const realRand = game.scene.randBattleSeedInt.bind(game.scene);
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) =>
      range === 100 ? min : realRand(range, min),
    );
    await game.classicMode.startBattle(SpeciesId.CHANSEY);
    const log = game.textInterceptor.logs.join("\n");
    expect(log, "the Ruins ambush queued the ambush signal").toMatch(/you were ambushed/i);
    expect(game.scene.getPlayerPokemon()?.isFainted(), "the bulky lead survived the ambush").toBe(false);
  }, 120_000);
});
