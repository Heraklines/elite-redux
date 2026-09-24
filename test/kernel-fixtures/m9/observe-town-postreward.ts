import { globalScene } from "#app/global-scene";
import { getGameMode } from "#app/game-mode";
import { BASE_SHINY_CHANCE } from "#balance/rates";
import { getCurrentErRewardRates } from "#data/elite-redux/er-reward-rates";
import { Arena } from "#field/arena";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import type { Starter } from "#types/save-data";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
// The starter is an explicit selection; no test helper rewrites this seed.
const SETUP_SEED = "m9e-town-handoff-5042";
let game: Phaser.Game | undefined;
let manager: GameManager | undefined;

afterAll(() => {
  vi.restoreAllMocks();
  manager?.promptHandler.clearPrompts();
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  game?.destroy(true);
});

test("explicit starter attack and reward skip reach a source-owned second encounter", async () => {
  const output = process.env.M9_TOWN_POSTREWARD_OUTPUT;
  const ordinal = process.env.M9_TOWN_POSTREWARD_ORDINAL;
  expect(output).toBeTruthy();
  expect(["one", "two"]).toContain(ordinal);
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(PIN);
  const allSpeciesCalls: { wave: number; level: number; before: string; species: number }[] = [];
  const sourceRandomSpecies = Arena.prototype.randomSpecies;
  vi.spyOn(Arena.prototype, "randomSpecies").mockImplementation(function(this: Arena, ...args) {
    const before = Phaser.Math.RND.state();
    const species = sourceRandomSpecies.apply(this, args);
    allSpeciesCalls.push({ wave: args[0], level: args[1], before, species: species.speciesId });
    return species;
  });

  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: [SETUP_SEED] });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  manager = new GameManager(game);
  manager.override.disableShinies = false;
  manager.override.normalizeIVs = false;
  manager.override.normalizeNatures = false;
  manager.override
    .shiny(null)
    .enemyShiny(null)
    .playerIVs(null)
    .enemyIVs(null)
    .nature(null)
    .enemyNature(null)
    .battleStyle(BattleStyle.SET)
    .startingBiome(BiomeId.TOWN)
    .startingWave(1)
    .startingLevel(5)
    .seed(SETUP_SEED);
  manager.scene.gameData.trainerId = 12345;
  manager.scene.gameData.secretId = 23456;
  const starterConstructorRng: { before: string; after: string; id: number }[] = [];
  const actualAddPlayerPokemon = manager.scene.addPlayerPokemon.bind(manager.scene);
  vi.spyOn(manager.scene, "addPlayerPokemon").mockImplementation((...args) => {
    const before = Phaser.Math.RND.state();
    const pokemon = actualAddPlayerPokemon(...args);
    starterConstructorRng.push({ before, after: Phaser.Math.RND.state(), id: pokemon.id });
    return pokemon;
  });
  const rngBeforeTitle = Phaser.Math.RND.state();
  await manager.runToTitle();
  const rngAtTitle = Phaser.Math.RND.state();
  let rngBeforeSetSeed: string | undefined;
  let rngAfterSetSeed: string | undefined;
  let rngBeforeStarterPhase: string | undefined;
  manager.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    rngBeforeSetSeed = Phaser.Math.RND.state();
    manager!.scene.gameMode = getGameMode(GameModes.CLASSIC);
    manager!.scene.setSeed(SETUP_SEED);
    rngAfterSetSeed = Phaser.Math.RND.state();
    const starters: Starter[] = [{
      speciesId: SpeciesId.BULBASAUR,
      shiny: false,
      variant: 0,
      formIndex: 0,
      female: false,
      abilityIndex: 0,
      passive: false,
      nature: Nature.RELAXED,
      moveset: [MoveId.VINE_WHIP],
      pokerus: false,
      teraType: PokemonType.GRASS,
      ivs: [11, 4, 14, 7, 17, 0],
    }];
    manager!.scene.phaseManager.pushNew("EncounterPhase", false);
    rngBeforeStarterPhase = Phaser.Math.RND.state();
    new SelectStarterPhase().initBattleFromCurrentPhase(starters);
  });
  await manager.phaseInterceptor.to("EncounterPhase");
  await manager.phaseInterceptor.to("CommandPhase");
  const scene = globalScene;
  expect(scene.seed).toBe(SETUP_SEED);
  expect(scene.gameData.trainerId).toBe(12345);
  expect(scene.gameData.secretId).toBe(23456);
  expect(scene.currentBattle.waveIndex).toBe(1);
  expect(scene.phaseManager.getCurrentPhase().phaseName).toBe("CommandPhase");
  const firstEnemy = scene.currentBattle.enemyParty[0];
  expect(firstEnemy).toBeDefined();
  const firstEnemyId = firstEnemy.id;
  const firstEnemySpecies = firstEnemy.species.speciesId;
  expect(firstEnemySpecies).toBe(915);
  const firstSpeciesCalls = allSpeciesCalls.filter(call => call.wave === 1);
  const player = scene.getPlayerPokemon();
  expect(player).toBeDefined();
  expect(starterConstructorRng).toHaveLength(1);
  expect(rngBeforeSetSeed).toBeDefined();
  expect(rngAfterSetSeed).toBeDefined();
  expect(rngBeforeStarterPhase).toBeDefined();
  expect(starterConstructorRng[0].id).toBe(player.id);
  expect(player.level).toBe(5);
  // Use a retained natural Bulbasaur move without rewriting its moveset.
  expect(player.getMoveset().map(move => move.moveId)).toContain(MoveId.VINE_WHIP);
  const firstShell = {
    form: firstEnemy.formIndex,
    level: firstEnemy.level,
    exp: firstEnemy.exp,
    ability_index: firstEnemy.abilityIndex,
    ability: firstEnemy.getAbility().id,
    friendship: firstEnemy.friendship,
    ivs: [...firstEnemy.ivs],
    nature: firstEnemy.nature,
    types: firstEnemy.getTypes(false, false, true),
    tera_type: firstEnemy.teraType,
    stats: [...firstEnemy.stats],
    hp: firstEnemy.hp,
    gender: firstEnemy.gender,
    shiny: firstEnemy.shiny,
    variant: firstEnemy.variant,
    pokerus: firstEnemy.pokerus,
    moves: firstEnemy.moveset.map(move => [move.moveId, move.ppUsed]),
  };
  const firstPlayer = {
    id: player.id,
    level: player.level,
    exp: player.exp,
    ability_index: player.abilityIndex,
    ability: player.getAbility().id,
    friendship: player.friendship,
    ivs: [...player.ivs],
    nature: player.nature,
    types: player.getTypes(false, false, true),
    tera_type: player.teraType,
    gender: player.gender,
    shiny: player.shiny,
    variant: player.variant,
    pokerus: player.pokerus,
    stats: [...player.stats],
    hp: player.hp,
    moves: player.getMoveset().map(move => [move.moveId, move.ppUsed]),
  };

  const actualNewBattle = scene.newBattle.bind(scene);
  const beforeNewBattle: string[] = [];
  const afterNewBattle: string[] = [];
  const afterResetSeed: { wave: number | null; seed: string; wave_seed: string; state: string }[] = [];
  const actualResetSeed = scene.resetSeed.bind(scene);
  vi.spyOn(scene, "resetSeed").mockImplementation((...args) => {
    const result = actualResetSeed(...args);
    afterResetSeed.push({
      wave: args[0] ?? null,
      seed: scene.seed,
      wave_seed: scene.waveSeed,
      state: Phaser.Math.RND.state(),
    });
    return result;
  });
  const newBattle = vi.spyOn(scene, "newBattle").mockImplementation((...args) => {
    beforeNewBattle.push(Phaser.Math.RND.state());
    const result = actualNewBattle(...args);
    afterNewBattle.push(Phaser.Math.RND.state());
    return result;
  });
  let attackingTurns = 0;
  const firstEnemyHpTrace = [firstEnemy.hp];
  while (!manager.isVictory() && attackingTurns < 12) {
    manager.move.select(MoveId.VINE_WHIP);
    await manager.toEndOfTurn();
    attackingTurns++;
    firstEnemyHpTrace.push(firstEnemy.hp);
    if (!manager.isVictory()) {
      await manager.toNextTurn();
    }
  }
  expect(attackingTurns).toBeGreaterThan(0);
  expect(manager.isVictory(), JSON.stringify({
    attackingTurns,
    phase: scene.phaseManager.getCurrentPhase().phaseName,
    firstEnemySpecies,
    firstEnemyAbility: firstEnemy.getAbility().id,
    firstEnemyMoves: firstEnemy.moveset.map(move => [move.moveId, move.ppUsed]),
    firstEnemyHpTrace,
    firstEnemyHp: firstEnemy.hp,
    firstEnemyFainted: firstEnemy.isFainted(),
    currentEnemySpecies: scene.currentBattle.enemyParty[0]?.species.speciesId,
    currentEnemyHp: scene.currentBattle.enemyParty[0]?.hp,
    playerHp: player.hp,
    playerMoves: player.getMoveset().map(move => [move.moveId, move.ppUsed]),
  })).toBe(true);
  expect(firstEnemy.isFainted()).toBe(true);
  expect(newBattle).not.toHaveBeenCalled();

  // The test helper presses the actual reward CANCEL and confirm controls,
  // then waits for the next CommandPhase. It does not call newBattle itself.
  await manager.toNextWave();
  expect(newBattle).toHaveBeenCalledTimes(1);
  expect(beforeNewBattle).toHaveLength(1);
  expect(scene.currentBattle.waveIndex).toBe(2);
  expect(scene.currentBattle.double).toBe(false);
  expect(scene.currentBattle.enemyParty).toHaveLength(1);
  expect(scene.arena.biomeId).toBe(BiomeId.TOWN);
  expect(scene.phaseManager.getCurrentPhase().phaseName).toBe("CommandPhase");
  const enemy = scene.currentBattle.enemyParty[0];
  expect(enemy).toBeDefined();
  expect(enemy.id).not.toBe(firstEnemyId);
  expect((scene.arena as unknown as { lastTimeOfDay: number }).lastTimeOfDay).toBe(1);
  expect(enemy.species.speciesId).toBe(504);
  expect(enemy.level).toBe(2);
  const waveTwoSelections = allSpeciesCalls.filter(call => call.wave === 2);
  expect(waveTwoSelections).toHaveLength(1);
  expect(waveTwoSelections[0].species).toBe(enemy.species.speciesId);
  const shinyXor = (scene.gameData.trainerId ^ scene.gameData.secretId)
    ^ ((enemy.id >>> 16) ^ (enemy.id & 0xffff));
  const nextRng = Phaser.Math.RND.state();
  const nextObservation = {
    wave: scene.currentBattle.waveIndex,
    battle_double: scene.currentBattle.double,
    enemy_party_count: scene.currentBattle.enemyParty.length,
    enemy_species: scene.currentBattle.enemyParty.map(pokemon => pokemon.species.speciesId),
    enemy_id: enemy.id,
    species: enemy.species.speciesId,
    form: enemy.formIndex,
    level: enemy.level,
    exp: enemy.exp,
    friendship: enemy.friendship,
    ability_index: enemy.abilityIndex,
    ability: enemy.getAbility().id,
    player_switched_in_this_turn: player.turnData.switchedInThisTurn,
    enemy_switched_in_this_turn: enemy.turnData.switchedInThisTurn,
    passive: enemy.passive,
    ivs: [...enemy.ivs],
    nature: enemy.nature,
    types: enemy.getTypes(false, false, true),
    tera_type: enemy.teraType,
    stats: [...enemy.stats],
    hp: enemy.hp,
    gender: enemy.gender,
    shiny: enemy.shiny,
    variant: enemy.variant,
    pokerus: enemy.pokerus,
    moves: enemy.moveset.map(move => [move.moveId, move.ppUsed]),
    boss: enemy.isBoss(),
    selections: waveTwoSelections,
  };
  const secondEnemyHpBefore = enemy.hp;
  const secondPlayerHpBefore = player.hp;
  const secondMove = player.getMoveset().find(move => move.moveId === MoveId.VINE_WHIP);
  expect(secondMove).toBeDefined();
  const secondPpBefore = secondMove!.ppUsed;
  manager.move.select(MoveId.VINE_WHIP);
  await manager.toEndOfTurn();
  expect(secondMove!.ppUsed).toBe(secondPpBefore + 1);
  expect(enemy.hp).toBeLessThanOrEqual(secondEnemyHpBefore);
  const result = {
    schema: 1,
    source: PIN,
    setup_seed: SETUP_SEED,
    scene_seed: scene.seed,
    wave_cycle_offset: scene.waveCycleOffset,
    effective_pool_time: (scene.arena as unknown as { lastTimeOfDay: number }).lastTimeOfDay,
    current_time: scene.arena.getTimeOfDay(),
    scope: "explicit Classic level-five starter selection, attack, reward cancel and queued Town wave-two encounter",
    bootstrap_rng: {
      before_title: rngBeforeTitle,
      at_title: rngAtTitle,
      before_set_seed: rngBeforeSetSeed,
      after_set_seed: rngAfterSetSeed,
      before_starter_phase: rngBeforeStarterPhase,
    },
    account: { trainer_id: scene.gameData.trainerId, secret_id: scene.gameData.secretId },
    shiny_context: {
      base_threshold: BASE_SHINY_CHANCE,
      reward_multiplier: getCurrentErRewardRates().totalShiny,
      xor: shinyXor,
    },
    first: { wave: 1, enemy_id: firstEnemyId, species: firstEnemySpecies, shell: firstShell,
      player: firstPlayer, starter_constructor_rng: starterConstructorRng[0],
      attacking_turns: attackingTurns, selections: firstSpeciesCalls },
    reward: {
      choice: "cancel",
      new_battle_calls: newBattle.mock.calls.length,
      before_new_battle_rng: beforeNewBattle,
      after_reset_seed_rng: afterResetSeed,
      after_new_battle_rng: afterNewBattle,
    },
    next: nextObservation,
    second_battle: {
      action: MoveId.VINE_WHIP,
      enemy_hp_before: secondEnemyHpBefore,
      enemy_hp_after: enemy.hp,
      player_hp_before: secondPlayerHpBefore,
      player_hp_after: player.hp,
      pp_before: secondPpBefore,
      pp_after: secondMove!.ppUsed,
      enemy_fainted: enemy.isFainted(),
      player_switched_in_this_turn_after: player.turnData.switchedInThisTurn,
      enemy_switched_in_this_turn_after: enemy.turnData.switchedInThisTurn,
      phase: scene.phaseManager.getCurrentPhase().phaseName,
      rng_after: Phaser.Math.RND.state(),
    },
    rng: nextRng,
  };
  const raw = Buffer.from(JSON.stringify(result) + "\n");
  expect(raw.length).toBeLessThanOrEqual(4096);
  writeFileSync(join(output!, `observation-${ordinal}.json`), raw, { flag: "wx" });
}, 120000);
