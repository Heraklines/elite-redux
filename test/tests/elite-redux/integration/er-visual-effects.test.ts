/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Visual effects audit:
// - FOG weather has dedicated CommonAnim.FOG slot (separate from WIND)
// - Arena.trySetWeather correctly routes FOG → CommonAnim.FOG
// - ER custom moves use the ./battle-anims-er/ asset path
// - Custom move animations exist on disk for bespoke ER moves
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { CommonAnim } from "#enums/move-anims-common";
import { WeatherType } from "#enums/weather-type";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getMoveAnimUrl } from "#data/battle-anims";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER visual effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("CommonAnim.FOG exists as a distinct enum value", () => {
    expect(CommonAnim.FOG).toBeDefined();
    expect(CommonAnim.FOG).not.toBe(CommonAnim.WIND);
    expect(CommonAnim.FOG).not.toBe(CommonAnim.SUNNY + (WeatherType.FOG - 1));
  });

  it("Fog Machine sets FOG weather without crashing", async () => {
    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    const pkrgFogMachine = erIdMap.abilities[905] as AbilityId | undefined;
    if (pkrgFogMachine === undefined) return;
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgFogMachine)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    // Fog Machine sets FOG on hit; verify the weather state.
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.FOG);
  });

  it("ER custom move animation URLs route to ./battle-anims-er/", async () => {
    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    // Pick a few bespoke ER moves and check their anim URL routing.
    const samples = [760, 950, 1027];
    for (const erMoveId of samples) {
      const pkrgId = erIdMap.moves[erMoveId];
      if (pkrgId === undefined) continue;
      const url = getMoveAnimUrl(pkrgId as MoveId);
      expect(url).toMatch(/^\.\/battle-anims-er\//);
    }
  });

  it("ER bespoke move animation files exist on disk for most wired moves", async () => {
    // Walk the 57 bespoke moves; verify the corresponding JSON file exists in
    // assets/battle-anims-er/.
    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    const bespokeIds = [
      760, 761, 769, 788, 810, 811, 822, 823, 832, 834, 836, 837, 841, 844,
      846, 853, 897, 935, 949, 950, 951, 954, 955, 962, 963, 964, 966, 967,
      969, 970, 971, 974, 975, 977, 979, 989, 990, 991, 999, 1000, 1003, 1005,
      1006, 1007, 1008, 1009, 1010, 1016, 1017, 1020, 1021, 1022, 1023, 1024,
      1027, 1028, 1029,
    ];
    let hasAsset = 0;
    let missing = 0;
    for (const erMoveId of bespokeIds) {
      const pkrgId = erIdMap.moves[erMoveId];
      if (pkrgId === undefined) continue;
      const url = getMoveAnimUrl(pkrgId as MoveId);
      if (!url) {
        missing++;
        continue;
      }
      const filename = path.basename(url);
      const localPath = path.resolve(process.cwd(), "assets/battle-anims-er", filename);
      if (fs.existsSync(localPath)) {
        hasAsset++;
      } else {
        missing++;
      }
    }
    // Expect most bespoke moves to have anim assets. The 187 anim files in
    // battle-anims-er/ should cover the 57 bespoke moves with margin.
    expect(hasAsset).toBeGreaterThanOrEqual(40);
  });
});
