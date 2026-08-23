import {
  isErEndlessRaidWave,
  resetErEndlessContinuation,
  restoreErEndlessContinuation,
} from "#data/elite-redux/er-endless-continuation";
import { resetErRunPacing } from "#data/elite-redux/er-run-pacing";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { Command } from "#enums/command";
import { SpeciesId } from "#enums/species-id";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ENDLESS_ENTRY_WAVE = 200;
const FIRST_RAID_WAVE = 250;

function activateEndlessContinuation(): void {
  restoreErEndlessContinuation({
    version: 1,
    enteredAtWave: ENDLESS_ENTRY_WAVE,
    seed: "endless-boss-flee-test",
    pulse: 0,
    ghostEncounters: 0,
    activeRifts: [],
    ghostHistory: [],
  });
}

describe("Endless boss flee restrictions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    resetErRunPacing();
    resetErEndlessContinuation();
    game = new GameManager(phaserGame);
    game.override
      .startingBiome(BiomeId.PLAINS)
      .battleStyle("single")
      .enemySpecies(SpeciesId.BULBASAUR)
      .enemyAbility(AbilityId.INSOMNIA)
      .ability(AbilityId.INSOMNIA);
  });

  afterEach(() => {
    resetErEndlessContinuation();
    resetErRunPacing();
  });

  it("rejects fleeing an Endless raid boss battle", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    activateEndlessContinuation();
    game.scene.currentBattle.waveIndex = FIRST_RAID_WAVE;

    expect(isErEndlessRaidWave(game.scene.currentBattle.waveIndex)).toBe(true);

    const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    expect(commandPhase.handleCommand(Command.RUN, 0)).toBe(false);
    expect(game.scene.currentBattle.turnCommands[0]).toBeNull();
  });

  it("still allows a flee attempt on an ordinary Endless wave", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    activateEndlessContinuation();
    game.scene.currentBattle.waveIndex = FIRST_RAID_WAVE - 1;

    expect(isErEndlessRaidWave(game.scene.currentBattle.waveIndex)).toBe(false);

    const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    expect(commandPhase.handleCommand(Command.RUN, 0)).toBe(true);
    expect(game.scene.currentBattle.turnCommands[0]).toMatchObject({ command: Command.RUN });
  });
});
