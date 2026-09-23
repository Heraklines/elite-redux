import { globalScene } from "#app/global-scene";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const SEED = "m9e-reward-selection-source-v1";
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

test("actual attack and reward skip reach a source-owned second encounter", async () => {
  const output = process.env.M9_TOWN_POSTREWARD_OUTPUT;
  const ordinal = process.env.M9_TOWN_POSTREWARD_ORDINAL;
  expect(output).toBeTruthy();
  expect(["one", "two"]).toContain(ordinal);
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(PIN);

  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: [SEED] });
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
    .seed(SEED);
  manager.scene.gameData.trainerId = 12345;
  manager.scene.gameData.secretId = 23456;
  await manager.classicMode.startBattle(SpeciesId.BULBASAUR);
  const scene = globalScene;
  expect(scene.gameData.trainerId).toBe(12345);
  expect(scene.gameData.secretId).toBe(23456);
  expect(scene.currentBattle.waveIndex).toBe(1);
  expect(scene.phaseManager.getCurrentPhase().phaseName).toBe("CommandPhase");
  const firstEnemy = scene.currentBattle.enemyParty[0];
  expect(firstEnemy).toBeDefined();
  const firstEnemyId = firstEnemy.id;
  const firstEnemySpecies = firstEnemy.species.speciesId;
  const player = scene.getPlayerPokemon();
  expect(player).toBeDefined();
  expect(player.getMoveset().map(move => move.moveId)).toContain(MoveId.VINE_WHIP);

  const newBattle = vi.spyOn(scene, "newBattle");
  let attackingTurns = 0;
  while (!manager.isVictory() && attackingTurns < 12) {
    manager.move.select(MoveId.VINE_WHIP);
    await manager.toEndOfTurn();
    attackingTurns++;
    if (!manager.isVictory()) {
      await manager.toNextTurn();
    }
  }
  expect(attackingTurns).toBeGreaterThan(0);
  expect(manager.isVictory(), JSON.stringify({
    attackingTurns,
    phase: scene.phaseManager.getCurrentPhase().phaseName,
    firstEnemySpecies,
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
  expect(scene.currentBattle.waveIndex).toBe(2);
  expect(scene.arena.biomeId).toBe(BiomeId.TOWN);
  expect(scene.phaseManager.getCurrentPhase().phaseName).toBe("CommandPhase");
  const enemy = scene.currentBattle.enemyParty[0];
  expect(enemy).toBeDefined();
  expect(enemy.id).not.toBe(firstEnemyId);
  expect(enemy.level).toBe(2);
  const result = {
    schema: 1,
    source: PIN,
    seed: SEED,
    scope: "actual wave-one attack, victory reward cancel and queued Town wave-two encounter",
    account: { trainer_id: scene.gameData.trainerId, secret_id: scene.gameData.secretId },
    first: { wave: 1, enemy_id: firstEnemyId, species: firstEnemySpecies, attacking_turns: attackingTurns },
    reward: { choice: "cancel", new_battle_calls: newBattle.mock.calls.length },
    next: {
      wave: scene.currentBattle.waveIndex,
      enemy_id: enemy.id,
      species: enemy.species.speciesId,
      form: enemy.formIndex,
      level: enemy.level,
      ability_index: enemy.abilityIndex,
      ability: enemy.getAbility().id,
      ivs: [...enemy.ivs],
      nature: enemy.nature,
      stats: [...enemy.stats],
      hp: enemy.hp,
      gender: enemy.gender,
      shiny: enemy.shiny,
      variant: enemy.variant,
      moves: enemy.moveset.map(move => [move.moveId, move.ppUsed]),
      boss: enemy.isBoss(),
    },
    rng: Phaser.Math.RND.state(),
  };
  const raw = Buffer.from(JSON.stringify(result) + "\n");
  expect(raw.length).toBeLessThanOrEqual(4096);
  writeFileSync(join(output!, `observation-${ordinal}.json`), raw, { flag: "wx" });
}, 120000);
