import { globalScene } from "#app/global-scene";
import { erPendingNodesReady, getErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { TitlePhase } from "#phases/title-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import type { SaveSlotSelectUiHandler } from "#ui/save-slot-select-ui-handler";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const SEED = "m9e-town-handoff-5042";
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

test("Title and actual starter controls construct a source-owned Classic starter", async () => {
  const output = process.env.M9_TOWN_STARTER_UI_OUTPUT;
  const ordinal = process.env.M9_TOWN_STARTER_UI_ORDINAL;
  expect(output).toBeTruthy();
  expect(["one", "two"]).toContain(ordinal);
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(PIN);
  const mark = (stage: string) =>
    writeFileSync(join(output!, `starter-ui-stage-${ordinal}.json`), `${JSON.stringify({ stage })}\n`);
  mark("start");

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
    .startingLevel(5)
    .seed(SEED);
  manager.scene.gameData.trainerId = 12345;
  manager.scene.gameData.secretId = 23456;
  mark("manager-ready");

  const constructor: { before: string; after: string; id: number; input: object }[] = [];
  const constructorDraws: string[] = [];
  const uiDraws: { after: string; stage: string; callers: string }[] = [];
  let uiDrawCount = 0;
  let inConstructor = false;
  let rngStage = "before-title";
  const actualFrac = Phaser.Math.RND.frac.bind(Phaser.Math.RND);
  vi.spyOn(Phaser.Math.RND, "frac").mockImplementation(() => {
    const value = actualFrac();
    if (inConstructor) {
      constructorDraws.push(Phaser.Math.RND.state());
    } else if (constructor.length === 0) {
      uiDrawCount++;
      if (uiDraws.length < 16) {
        const callers = new Error().stack?.split("\n").slice(2, 10)
          .map(line => line.trim().split(" (")[0]).join("|") ?? "";
        uiDraws.push({
          after: Phaser.Math.RND.state(),
          stage: rngStage,
          callers: callers.slice(0, uiDrawCount <= 3 ? 400 : 120),
        });
      }
    }
    return value;
  });
  const actualAddPlayerPokemon = manager.scene.addPlayerPokemon.bind(manager.scene);
  vi.spyOn(manager.scene, "addPlayerPokemon").mockImplementation((...args) => {
    const before = Phaser.Math.RND.state();
    const input = {
      species: args[0].speciesId,
      level: args[1],
      ability_index: args[2] ?? null,
      form_index: args[3] ?? null,
      gender: args[4] ?? null,
      shiny: args[5] ?? null,
      variant: args[6] ?? null,
      ivs: args[7] ? [...args[7]] : null,
      nature: args[8] ?? null,
      has_data_source: args[9] != null,
      has_post_process: args[10] != null,
    };
    inConstructor = true;
    try {
      const pokemon = actualAddPlayerPokemon(...args);
      constructor.push({ before, after: Phaser.Math.RND.state(), id: pokemon.id, input });
      return pokemon;
    } finally {
      inConstructor = false;
    }
  });

  const rngBeforeTitle = Phaser.Math.RND.state();
  await manager.runToTitle();
  mark("title-ready");
  const rngAtTitle = Phaser.Math.RND.state();
  let rngBeforeTitleEnd: string | undefined;
  let rngAtStarterSelect: string | undefined;
  manager.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    mark("title-prompt");
    rngStage = "title-prompt";
    rngBeforeTitleEnd = Phaser.Math.RND.state();
    const phase = manager!.scene.phaseManager.getCurrentPhase() as TitlePhase;
    phase.gameMode = GameModes.CLASSIC;
    phase.end();
  });
  manager.onNextPrompt("SelectStarterPhase", UiMode.STARTER_SELECT, () => {
    mark("starter-prompt");
    rngStage = "starter-grid";
    rngAtStarterSelect = Phaser.Math.RND.state();
    const handler = manager!.scene.ui.getHandler() as StarterSelectUiHandler;
    handler.processInput(Button.RIGHT);
    handler.processInput(Button.LEFT);
    handler.processInput(Button.ACTION);
  });
  await manager.phaseInterceptor.to("SelectStarterPhase");
  mark("starter-phase-seen");

  let optionCount = 0;
  let optionHandler: OptionSelectUiHandler | undefined;
  await new Promise<void>(resolve => {
    manager!.onNextPrompt("SelectStarterPhase", UiMode.OPTION_SELECT, () => {
      mark("starter-options");
      rngStage = "starter-options";
      optionHandler = manager!.scene.ui.getHandler() as OptionSelectUiHandler;
      optionCount = optionHandler.getOptionsWithScroll().length;
      resolve();
    });
  });
  expect(optionCount).toBeGreaterThan(0);
  optionHandler?.processInput(Button.ACTION);
  mark("added-to-party");

  await new Promise<void>(resolve => {
    manager!.onNextPrompt("SelectStarterPhase", UiMode.STARTER_SELECT, () => {
      mark("starter-submit");
      rngStage = "starter-submit";
      const handler = manager!.scene.ui.getHandler() as StarterSelectUiHandler;
      handler.processInput(Button.SUBMIT);
    });
    manager!.onNextPrompt("SelectStarterPhase", UiMode.CONFIRM, () => {
      mark("starter-confirm");
      rngStage = "starter-confirm";
      const handler = manager!.scene.ui.getHandler() as StarterSelectUiHandler;
      handler.processInput(Button.ACTION);
    });
    manager!.onNextPrompt("SelectStarterPhase", UiMode.OPTION_SELECT, () => {
      mark("difficulty-options");
      rngStage = "difficulty-options";
      const handler = manager!.scene.ui.getHandler() as OptionSelectUiHandler;
      handler.processInput(Button.DOWN);
      handler.processInput(Button.ACTION);
    });
    manager!.onNextPrompt("SelectStarterPhase", UiMode.MENU_OPTION_SELECT, () => {
      mark("pacing-options");
      rngStage = "pacing-options";
      const handler = manager!.scene.ui.getHandler() as OptionSelectUiHandler;
      handler.processInput(Button.ACTION);
    });
    manager!.onNextPrompt("SelectStarterPhase", UiMode.SAVE_SLOT, () => {
      mark("save-slot");
      rngStage = "save-slot";
      const handler = manager!.scene.ui.getHandler() as SaveSlotSelectUiHandler;
      const accepted = handler.processInput(Button.ACTION);
      mark(`save-slot-action-returned:${accepted}`);
      resolve();
    });
    manager!.onNextPrompt("SelectStarterPhase", UiMode.CONFIRM, () => {
      mark("save-overwrite-confirm");
      rngStage = "save-overwrite-confirm";
      const handler = manager!.scene.ui.getHandler() as StarterSelectUiHandler;
      handler.processInput(Button.ACTION);
    });
  });
  const phase = () => manager!.scene.phaseManager.getCurrentPhase().phaseName;
  const mode = () => manager!.scene.ui.getMode();
  mark(`awaiting-command-phase:${phase()}:${mode()}`);
  const diagnostic = setTimeout(() => mark(`command-wait:${phase()}:${mode()}`), 2000);
  await manager.phaseInterceptor.to("CommandPhase");
  clearTimeout(diagnostic);
  mark("command-phase-seen");

  const scene = globalScene;
  const player = scene.getPlayerPokemon();
  const enemy = scene.currentBattle.enemyParty[0];
  expect(scene.seed).toBe(SEED);
  expect(scene.currentBattle.waveIndex).toBe(1);
  expect(player.species.speciesId).toBe(SpeciesId.BULBASAUR);
  expect(player.level).toBe(5);
  expect(constructor).toHaveLength(1);
  expect(constructor[0].id).toBe(player.id);
  expect(constructorDraws.length).toBeLessThanOrEqual(8);
  expect(rngBeforeTitleEnd).toBeDefined();
  expect(rngAtStarterSelect).toBeDefined();

  const observation = {
    source: PIN,
    path: "title-starter-select-confirm-save-slot-encounter",
    seed: SEED,
    rng_before_title: rngBeforeTitle,
    rng_at_title: rngAtTitle,
    rng_before_title_end: rngBeforeTitleEnd,
    rng_at_starter_select: rngAtStarterSelect,
    ui_draw_count: uiDrawCount,
    ui_draws: uiDraws,
    constructor,
    constructor_draws: constructorDraws,
    player: {
      id: player.id,
      species: player.species.speciesId,
      form: player.formIndex,
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
    },
    enemy: { id: enemy.id, species: enemy.species.speciesId, level: enemy.level },
    pending_routes_ready: erPendingNodesReady(),
    pending_routes: getErPendingNodes().map(node => ({
      biome: node.biome,
      revealed: node.revealed,
      source: node.source ?? null,
    })),
  };
  const firstEnemy = enemy;
  let attackingTurns = 0;
  while (!manager.isVictory() && attackingTurns < 12) {
    manager.move.select(MoveId.VINE_WHIP);
    await manager.toEndOfTurn();
    attackingTurns++;
    if (!manager.isVictory()) {
      await manager.toNextTurn();
    }
  }
  expect(manager.isVictory()).toBe(true);
  expect(firstEnemy.isFainted()).toBe(true);
  await manager.toNextWave();
  expect(scene.currentBattle.waveIndex).toBe(2);
  expect(scene.phaseManager.getCurrentPhase().phaseName).toBe("CommandPhase");
  const nextEnemy = scene.currentBattle.enemyParty[0];
  expect(nextEnemy).toBeDefined();
  const secondMove = player.getMoveset().find(move => move.moveId === MoveId.VINE_WHIP);
  expect(secondMove).toBeDefined();
  const beforePp = secondMove!.ppUsed;
  const beforeHp = nextEnemy.hp;
  manager.move.select(MoveId.VINE_WHIP);
  await manager.toEndOfTurn();
  expect(secondMove!.ppUsed).toBe(beforePp + 1);
  Object.assign(observation, {
    successor: {
      attacking_turns: attackingTurns,
      player_id: player.id,
      wave: scene.currentBattle.waveIndex,
      enemy_species: nextEnemy.species.speciesId,
      enemy_id: nextEnemy.id,
      enemy_level: nextEnemy.level,
      enemy_hp_before: beforeHp,
      enemy_hp_after: nextEnemy.hp,
      player_hp: player.hp,
      vine_whip_pp_before: beforePp,
      vine_whip_pp_after: secondMove!.ppUsed,
      pending_routes_ready: erPendingNodesReady(),
      pending_routes: getErPendingNodes().length,
    },
  });
  writeFileSync(join(output!, `starter-ui-${ordinal}.json`), `${JSON.stringify(observation)}\n`);
});
