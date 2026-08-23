/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { saveKey } from "#app/constants";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import fs from "node:fs";
import { AES, enc } from "crypto-js";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const sessionPath = process.env.ER_EXTERNAL_SESSION_PATH;

describe.skipIf(!sessionPath)("external player session transition diagnostic", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("loads the supplied encrypted session through the real title-screen path", async () => {
    const game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyMoveset(MoveId.SPLASH).ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const encrypted = fs.readFileSync(sessionPath!, "utf8");
    const plaintext = AES.decrypt(encrypted, saveKey).toString(enc.Utf8);
    const session = game.scene.gameData.parseSessionData(plaintext);
    game.reload.setSessionData(session);
    game.onNextPrompt("ScanIvsPhase", UiMode.CONFIRM, () => game.scene.ui.processInput(Button.CANCEL));

    await game.reload.reloadSession();

    expect(game.scene.currentBattle.waveIndex).toBe(session.waveIndex);
    expect(game.scene.modifiers).toHaveLength(session.modifiers.length);
    expect(game.scene.getPlayerParty()).toHaveLength(session.party.length);

    game.scene.updateModifiers(true, true);
    const iconsBefore = [...game.scene.getModifierBar().getAll()];
    game.scene.updateModifiers(true, true);
    expect(game.scene.getModifierBar().getAll()).toEqual(iconsBefore);
  }, 60_000);
});
