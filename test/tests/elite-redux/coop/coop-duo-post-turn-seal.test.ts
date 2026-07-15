/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression for the live wave-20 market failure: TurnEnd captured enemy HP [0,4], then two queued
// PokemonHealPhases mutated only the host to [0,5]. Both clients opened the next command surface with
// different immutable state. The authoritative seal must remain at the root until TurnEnd's complete
// child/deferred subtree drains, then publish the healed HP in the retained turn carrier.

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { TerrainType } from "#data/terrain";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  installDuoLogCapture,
  withClient,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO: immutable turn carrier seals after post-turn children", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`post-turn-seal-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.SPLASH, MoveId.TACKLE])
      .disableTrainerWaves();
  });

  afterEach(() => {
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  it("publishes automatic Grassy Terrain healing and guest converges before the next command", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    let emittedHp: number | undefined;
    let emittedChecksum: string | undefined;
    pair.guest.onMessage(message => {
      if (message.t !== "turnResolution") {
        return;
      }
      emittedChecksum = message.checksum;
      emittedHp = message.authoritativeState?.playerParty[COOP_GUEST_FIELD_INDEX]?.hp;
    });

    let hpBefore = 0;
    let expectedHp = 0;
    for (const ctx of [rig.hostCtx, rig.guestCtx]) {
      await withClient(ctx, () => {
        const pokemon = ctx.scene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
        const heal = Math.max(pokemon.getMaxHp() >> 4, 1);
        pokemon.hp = pokemon.getMaxHp() - heal * 2;
        ctx.scene.arena.trySetTerrain(TerrainType.GRASSY, true);
        if (ctx === rig.hostCtx) {
          hpBefore = pokemon.hp;
          expectedHp = pokemon.hp + heal;
        }
      });
    }

    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopSealTurnPhase");
    });

    const hostHp = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp;
    expect(hostHp, "the real TurnEnd PokemonHealPhase changed host HP").toBe(expectedHp);
    expect(hostHp, "test precondition: automatic healing was not a no-op").toBeGreaterThan(hpBefore);
    expect(emittedHp, "the immutable turn carrier includes the settled post-turn heal").toBe(hostHp);

    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    const guestHp = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp;
    expect(guestHp, "the guest materialized the same healed HP before continuing").toBe(hostHp);
    expect(
      await withClient(rig.guestCtx, () => captureCoopChecksum()),
      "the guest's next-command state digest equals the sealed carrier",
    ).toBe(emittedChecksum);
    expect(
      await withClient(rig.hostCtx, () => captureCoopChecksum()),
      "host and guest next-command state digests converge",
    ).toBe(await withClient(rig.guestCtx, () => captureCoopChecksum()));

    logs.flush();
  }, 180_000);
});
