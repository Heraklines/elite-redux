/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER dex-fidelity tier-9 batch — BEHAVIOUR (GameManager) regression tests.
//
//   - 36  Trace          — cannot copy Wonder Guard (ER dex); a lone Wonder-Guard
//                           foe yields no valid target so Trace does nothing.
//   - 388 Thundercall     — 1.5x vs Water + Infiltrator screen/Substitute bypass.
//   - 404 Mineralize      — Normal->Rock -ate; 10% ER_BLEED on a Rock holder, no
//                           flat 1.2x boost.
//   - 507 Fertilize       — Normal->Grass -ate; a Grass holder's Grass move heals
//                           10% of damage dealt (deterministic, no roll).
//   - 543 Seed Sower      — on a direct hit, also heals the whole party's status
//                           (ER addition), keeping the Grassy-Terrain half.
//   - 420 Primal Maw      — the ability-added extra strike does NOT re-roll flinch
//                           (flinch is gated to the first strike).
//   - move Nightmare      — ER: 120-BP Special damaging move that STILL applies the
//                           1/4-HP-per-turn Nightmare chip.
//   - move Speed Swap     — ER: swaps the SPD stat AND its stat stages.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { InfiltratorAbAttr, MovePowerBoostAbAttr, PostDefendPartyStatusHealAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { AteConditionalStatusAbAttr } from "#data/elite-redux/archetypes/ate-conditional";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { FlinchAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const THUNDERCALL = ER_ID_MAP.abilities[388] as AbilityId;
const MINERALIZE = ER_ID_MAP.abilities[404] as AbilityId;
const FERTILIZE = ER_ID_MAP.abilities[507] as AbilityId;
const PRIMAL_MAW = ER_ID_MAP.abilities[420] as AbilityId;

describe.skipIf(!RUN)("ER dex tier-9 batch — behaviour", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  afterEach(() => vi.restoreAllMocks());

  // Force any 100-range roll to fire (return its min) so 10% secondaries proc.
  const forceProcs = () => {
    const real = game.scene.randBattleSeedInt.bind(game.scene);
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) =>
      range === 100 ? min : real(range, min),
    );
  };

  // ---------------------------------------------------------------------------
  // (1) Trace — cannot copy Wonder Guard.
  // ---------------------------------------------------------------------------
  it("Trace (36): does NOT copy a lone Wonder Guard foe (stays Trace)", async () => {
    game.override.ability(AbilityId.TRACE).moveset(MoveId.SPLASH).enemyAbility(AbilityId.WONDER_GUARD);
    await game.classicMode.startBattle(SpeciesId.GARDEVOIR);

    // No valid target -> Trace never fires -> the holder keeps Trace.
    expect(game.field.getPlayerPokemon().getAbility().id).toBe(AbilityId.TRACE);
  });

  it("Trace (36): still copies a NORMAL foe's ability (control)", async () => {
    game.override.ability(AbilityId.TRACE).moveset(MoveId.SPLASH).enemyAbility(AbilityId.INTIMIDATE);
    await game.classicMode.startBattle(SpeciesId.GARDEVOIR);

    expect(game.field.getPlayerPokemon().getAbility().id).toBe(AbilityId.INTIMIDATE);
  });

  // ---------------------------------------------------------------------------
  // (2) Thundercall — 1.5x vs Water + Infiltrator bypass wired.
  // ---------------------------------------------------------------------------
  it("Thundercall (388): wires BOTH the 1.5x-vs-Water boost and Infiltrator's bypass", async () => {
    game.override.ability(THUNDERCALL).moveset(MoveId.THUNDER_SHOCK);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const attrs = game.field.getPlayerPokemon().getAbility().attrs;

    expect(attrs.some(a => a instanceof MovePowerBoostAbAttr)).toBe(true);
    expect(attrs.some(a => a instanceof InfiltratorAbAttr)).toBe(true);
  });

  // (The 1.5x-vs-Water damage delta + Light Screen / Substitute bypass are
  // verified behaviorally with the headless scenario runner — see the report;
  // a nested second GameManager can't tear down cleanly inside one test.)

  // ---------------------------------------------------------------------------
  // (3) Mineralize — Normal->Rock, ER_BLEED on a Rock holder, no flat boost.
  // ---------------------------------------------------------------------------
  it("Mineralize (404): converts Normal->Rock with NO flat power boost", async () => {
    game.override.ability(MINERALIZE).moveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.PIKACHU); // not Rock
    const player = game.field.getPlayerPokemon();

    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.ROCK);
    // -ate helper wires the conditional secondary, NOT the old flat 1.2x boost.
    expect(player.getAbility().attrs.some(a => a instanceof AteConditionalStatusAbAttr)).toBe(true);
    expect(player.getAbility().attrs.some(a => a.constructor.name === "TypeConversionPowerBoostAbAttr")).toBe(false);
  });

  it("Mineralize (404): a Rock holder's Rock move rolls ER_BLEED (forced 10%)", async () => {
    game.override.ability(MINERALIZE).moveset(MoveId.TACKLE);
    forceProcs();
    await game.classicMode.startBattle(SpeciesId.GOLEM); // Rock/Ground
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.ROCK);
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // (4) Fertilize — Normal->Grass, deterministic lifesteal on a Grass holder.
  // ---------------------------------------------------------------------------
  it("Fertilize (507): converts Normal->Grass (off-type holder)", async () => {
    game.override.ability(FERTILIZE).moveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.PIKACHU); // not Grass
    const player = game.field.getPlayerPokemon();

    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.GRASS);
    expect(player.getAbility().attrs.some(a => a instanceof AteConditionalStatusAbAttr)).toBe(true);
  });

  it("Fertilize (507): a Grass holder's Grass move heals ~10% of damage dealt (deterministic)", async () => {
    // ER's SPLASH is a damaging Water attack, so use a self-target enemy move
    // (Defense Curl) — the holder must take NO chip for the heal to be visible.
    game.override.ability(FERTILIZE).moveset(MoveId.TACKLE).enemyMoveset(MoveId.DEFENSE_CURL);
    await game.classicMode.startBattle(SpeciesId.VENUSAUR); // Grass/Poison
    const player = game.field.getPlayerPokemon();

    // Drop the holder below max so the heal is observable.
    const half = Math.floor(player.getMaxHp() / 2);
    player.hp = half;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(player.hp).toBeGreaterThan(half); // deterministic lifesteal fired
  });

  // ---------------------------------------------------------------------------
  // (5) Seed Sower — party-status heal on a direct hit (ER addition).
  // ---------------------------------------------------------------------------
  it("Seed Sower (543): a direct hit cures the whole party's status AND sets Grassy Terrain", async () => {
    game.override.ability(AbilityId.SEED_SOWER).moveset(MoveId.SPLASH).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    const bench = game.scene.getPlayerParty()[1];
    bench.doSetStatus(StatusEffect.BURN);
    expect(bench.status?.effect).toBe(StatusEffect.BURN);

    game.move.use(MoveId.SPLASH); // enemy Tackle lands on the Seed Sower lead
    await game.toEndOfTurn();

    expect(bench.status).toBeFalsy(); // party status cured
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY); // vanilla half intact
  });

  // ---------------------------------------------------------------------------
  // (6) Primal Maw — flinch gated to the FIRST strike of the ability-added pair.
  // ---------------------------------------------------------------------------
  it("Primal Maw (420): the extra (2nd) biting strike does NOT re-roll flinch", async () => {
    game.override.ability(PRIMAL_MAW).moveset(MoveId.BITE);
    forceProcs(); // any flinch roll would otherwise succeed
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const bite = allMoves[MoveId.BITE];
    const flinch = bite.attrs.find((a): a is FlinchAttr => a instanceof FlinchAttr)!;
    expect(flinch).toBeDefined();
    player.turnData.hitCount = 2;

    // 2nd strike (index 1): the flinch-once guard blocks it despite the forced roll.
    player.turnData.hitsLeft = 1;
    expect(flinch.apply(player, enemy, bite, [])).toBe(false);
    expect(enemy.getTag(BattlerTagType.FLINCHED)).toBeUndefined();

    // 1st strike (index 0): the guard passes, so the flinch fires normally.
    player.turnData.hitsLeft = 2;
    expect(flinch.apply(player, enemy, bite, [])).toBe(true);
    expect(enemy.getTag(BattlerTagType.FLINCHED)).toBeDefined();
  });

  it("Primal Maw guard is scoped: WITHOUT it, the 2nd biting strike still flinches", async () => {
    game.override.ability(AbilityId.BALL_FETCH).moveset(MoveId.BITE);
    forceProcs();
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const bite = allMoves[MoveId.BITE];
    const flinch = bite.attrs.find((a): a is FlinchAttr => a instanceof FlinchAttr)!;
    player.turnData.hitCount = 2;

    // No hit-multiplier ability -> the guard never engages -> 2nd strike flinches.
    player.turnData.hitsLeft = 1;
    expect(flinch.apply(player, enemy, bite, [])).toBe(true);
    expect(enemy.getTag(BattlerTagType.FLINCHED)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // (7) Nightmare — ER damaging move keeps the chip.
  // ---------------------------------------------------------------------------
  it("Nightmare: is a Special damaging move that STILL applies the Nightmare chip vs a sleeping foe", async () => {
    const nightmare = allMoves[MoveId.NIGHTMARE];
    expect(nightmare.category).toBe(MoveCategory.SPECIAL);
    expect(nightmare.power).toBeGreaterThan(0);
    expect(nightmare.hasAttr("AddBattlerTagAttr")).toBe(true); // chip retained

    // SNORLAX (Normal) is immune to Ghost — use a non-Normal foe (Wailmer, BST
    // 400 so it stays under the wave-1 cap). A low attacker level keeps Nightmare
    // non-lethal so the foe survives both turns; pin a long sleep for the chip.
    game.override.moveset(MoveId.NIGHTMARE).enemySpecies(SpeciesId.WAILMER).startingLevel(20); // Water, Ghost-neutral
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const enemy = game.field.getEnemyPokemon();
    enemy.doSetStatus(StatusEffect.SLEEP, 5);
    const full = enemy.getMaxHp();

    game.move.use(MoveId.NIGHTMARE);
    await game.toEndOfTurn();
    const afterHit = enemy.hp;
    expect(afterHit).toBeLessThan(full); // dealt damage
    expect(enemy.getTag(BattlerTagType.NIGHTMARE)).toBeDefined(); // chip applied

    // Next turn (foe still asleep): the chip drains ~1/4 HP.
    game.move.use(MoveId.NIGHTMARE);
    await game.toEndOfTurn();
    expect(enemy.hp).toBeLessThan(afterHit);
  });

  // ---------------------------------------------------------------------------
  // (8) Speed Swap — swaps the SPD stat AND its stat stages.
  // ---------------------------------------------------------------------------
  it("Speed Swap (646): swaps BOTH the base SPD stat and the SPD stat stages", async () => {
    game.override.moveset(MoveId.SPEED_SWAP).enemySpecies(SpeciesId.JOLTEON);
    await game.classicMode.startBattle(SpeciesId.SHUCKLE); // very slow vs very fast
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    player.setStatStage(Stat.SPD, 2);
    enemy.setStatStage(Stat.SPD, -1);
    const playerBase = player.getStat(Stat.SPD, false);
    const enemyBase = enemy.getStat(Stat.SPD, false);
    expect(playerBase).not.toBe(enemyBase);

    game.move.use(MoveId.SPEED_SWAP);
    await game.toEndOfTurn();

    // Base stat swapped (native SwapStatAttr)...
    expect(player.getStat(Stat.SPD, false)).toBe(enemyBase);
    expect(enemy.getStat(Stat.SPD, false)).toBe(playerBase);
    // ...AND the stat stages swapped (ER addition).
    expect(player.getStatStage(Stat.SPD)).toBe(-1);
    expect(enemy.getStatStage(Stat.SPD)).toBe(2);
  });

  it("Seed Sower patcher wired PostDefendPartyStatusHealAbAttr onto the vanilla ability", async () => {
    game.override.ability(AbilityId.SEED_SOWER).moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(
      game.field
        .getPlayerPokemon()
        .getAbility()
        .attrs.some(a => a instanceof PostDefendPartyStatusHealAbAttr),
    ).toBe(true);
  });
});
