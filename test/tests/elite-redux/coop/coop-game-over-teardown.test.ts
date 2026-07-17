/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op game-over teardown (#842). A game-over that lands MID-mystery-encounter used to leave the
// co-op runtime alive with its ME pins still SET (coopMeInteractionStart / coopMeBattleInteractionCounter
// / the adopted host presentation) - those clear only at an ME TERMINAL, which a mid-ME game-over never
// reaches. GameOverPhase broadcast `gameOver` to the peer but never tore the runtime down, so the stale
// pins leaked into the NEXT co-op run's first encounter (ME ownership / presentation desync).
//
// The fix: GameOverPhase now calls clearCoopRuntime() at its TERMINAL clear() step (well after the
// gameOver broadcast has flushed), on BOTH clients - which (#834) also zeroes the full ME pin family.
// This drives a REAL co-op game-over (MEMENTO faints the lone mon) with the pins pre-set, then asserts
// the runtime is torn down + the pins are zeroed + a fresh session alternates from a clean counter.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-game-over-teardown.test.ts

import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import {
  COOP_CAP_OP_ME,
  getNegotiatedCoopCapabilities,
  setNegotiatedCoopCapabilities,
} from "#data/elite-redux/coop/coop-capabilities";
import { coopMeInteractionStartValue, setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  clearCoopRuntime,
  getCoopMeBattleInteractionCounter,
  getCoopRuntime,
  setCoopMeBattleInteractionCounter,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op game-over teardown (#842)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let prevGlobalScene: typeof globalScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    prevGlobalScene = globalScene;
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.MEMENTO])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(5);
  });

  afterEach(() => {
    clearCoopRuntime();
    // globalScene citizenship (isolate:false): restore the prior scene for the next ER file.
    if (prevGlobalScene != null) {
      initGlobalScene(prevGlobalScene);
    }
  });

  it("a mid-ME game-over tears the runtime down + zeroes the ME pins; a fresh session alternates from clean", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    expect(getCoopRuntime()).not.toBeNull();

    // Simulate the game-over landing MID-mystery-encounter: pin the ME interaction state exactly as
    // MysteryEncounterPhase would. These module-level pins reset ONLY at an ME terminal - a mid-ME
    // game-over never reaches one, so without the teardown they survive into the next run.
    setCoopMeInteractionStart(4);
    setCoopMeBattleInteractionCounter(4);
    expect(coopMeInteractionStartValue()).toBe(4);
    expect(getCoopMeBattleInteractionCounter()).toBe(4);

    // Drive a REAL co-op game-over: MEMENTO faints the lone mon -> no bench -> GameOverPhase. In co-op
    // GameOverPhase goes straight to handleGameOver, then its terminal clear() tears the runtime down.
    game.move.select(MoveId.MEMENTO);
    await game.phaseInterceptor.to("PostGameOverPhase", false);
    expect(game.phaseInterceptor.log.includes("GameOverPhase")).toBe(true);

    // The run-over tail tore the co-op runtime down on THIS client + zeroed the full ME pin family.
    expect(getCoopRuntime(), "the co-op runtime is torn down at game-over").toBeNull();
    expect(coopMeInteractionStartValue(), "coopMeInteractionStart pin zeroed").toBe(-1);
    expect(getCoopMeBattleInteractionCounter(), "coopMeBattleInteractionCounter pin zeroed").toBe(-1);
    expect(getNegotiatedCoopCapabilities(), "the departed peer's capability mask is torn down too").toBeNull();

    // A fresh session on the same client starts a CLEAN alternation: interaction 0 is the host's, so
    // the first interaction of the new run alternates correctly (host owns 0 / guest owns 1).
    const fresh = startLocalCoopSession({ username: "Host" });
    expect(fresh.controller.interactionCounter()).toBe(0);
    expect(fresh.controller.interactionOwner()).toBe("host");
    expect(fresh.controller.isLocalOwnerAtCounter(0)).toBe(true);
    expect(fresh.controller.isLocalOwnerAtCounter(1)).toBe(false);
  });

  it("an idempotent teardown clears a frozen capability mask even after the runtime is already absent", () => {
    clearCoopRuntime();
    setNegotiatedCoopCapabilities([COOP_CAP_OP_ME], []);
    expect(getNegotiatedCoopCapabilities()).not.toBeNull();

    clearCoopRuntime();

    expect(getNegotiatedCoopCapabilities()).toBeNull();
  });
});
