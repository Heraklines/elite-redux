/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 ENEMY-COMMAND RELAY - live battle proof (C6v2b), ER_SCENARIO / GameManager.
// FAILS-BEFORE / PASSES-AFTER for the C4 interception: in a versus session the host's enemy
// slot executes the RELAYED command (the remote player's pick), NOT an AI move.
//   - PASSES-AFTER: a relay that answers with a specific move (LEER) makes the enemy use LEER.
//   - FALLBACK (the "before" shape): with NO relay the enemy acts by AI (getNextMove) - it does
//     NOT use the relayed move, proving the relay - not the AI - drove the passes-after case.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const mon = (over: Partial<ShowdownMonManifest>): ShowdownMonManifest => ({
  speciesId: SpeciesId.SNORLAX,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  // LEER at slot 3 - a status move the AI would never pick over the attacking moves.
  moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.HEADBUTT, MoveId.LEER],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.SNORLAX,
  erBlackShiny: false,
  baseCost: 4,
  ...over,
});

async function startShowdown(
  game: GameManager,
  opponent: ShowdownMonManifest[],
  relay: ShowdownCommandRelay | null,
  playerSpecies: SpeciesId[],
): Promise<void> {
  await game.runToTitle();
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    beginShowdownBattle(opponent, opponent, relay);
    const starters = generateStarters(game.scene, playerSpecies);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    new SelectStarterPhase().initBattle(starters);
  });
  await game.phaseInterceptor.to("CommandPhase");
}

describe.skipIf(!RUN)("Showdown enemy-command relay - live battle (C6v2b)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // The player just needs a move to advance the turn; give it TACKLE deterministically.
    game.override.moveset([MoveId.TACKLE]);
  });

  afterEach(() => {
    endShowdownBattle();
    clearCoopRuntime();
  });

  it("PASSES-AFTER: the enemy executes the RELAYED command (LEER), not an AI move", async () => {
    // A live versus session so isVersusSession() is true and the host awaits the relay.
    startLocalCoopSession({ kind: "versus" });
    const { host, guest } = createLoopbackPair();
    const relay = new ShowdownCommandRelay(host);
    // The remote peer answers every enemy-command request with LEER (slot 3, a status move).
    const peer = new ShowdownCommandRelay(guest);
    peer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 3,
      moveId: MoveId.LEER,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));

    const opponent = [mon({ speciesId: SpeciesId.SNORLAX })];
    await startShowdown(game, opponent, relay, [SpeciesId.MILTANK]);

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("CoopTurnCommitPhase");

    const enemyLastMove = game.scene.getEnemyPokemon()?.getLastXMoves(1)[0]?.move;
    expect(enemyLastMove).toBe(MoveId.LEER);

    peer.dispose();
  });

  it("VALIDATION: an ILLEGAL relayed move (not in the mon's moveset) falls back to AI", async () => {
    startLocalCoopSession({ kind: "versus" });
    const { host, guest } = createLoopbackPair();
    const relay = new ShowdownCommandRelay(host);
    const peer = new ShowdownCommandRelay(guest);
    // SURF is NOT in the opponent's moveset ([TACKLE, BODY_SLAM, HEADBUTT, LEER]) - an injected move.
    peer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.SURF,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));

    const opponent = [mon({ speciesId: SpeciesId.SNORLAX })];
    await startShowdown(game, opponent, relay, [SpeciesId.MILTANK]);

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("CoopTurnCommitPhase");

    const enemyLastMove = game.scene.getEnemyPokemon()?.getLastXMoves(1)[0]?.move;
    // The host rejected the illegal pick -> AI fallback; the enemy never used the injected SURF.
    expect(enemyLastMove).not.toBe(MoveId.SURF);

    peer.dispose();
  });

  it("FALLBACK: with NO relay the enemy acts by AI - it does NOT use the relayed move", async () => {
    startLocalCoopSession({ kind: "versus" });

    const opponent = [mon({ speciesId: SpeciesId.SNORLAX })];
    // No relay stashed -> the host's versus branch falls back to the AI picker.
    await startShowdown(game, opponent, null, [SpeciesId.MILTANK]);

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("CoopTurnCommitPhase");

    const enemyLastMove = game.scene.getEnemyPokemon()?.getLastXMoves(1)[0]?.move;
    // The AI would pick an attacking move over LEER, so the relayed move is NOT what executed.
    expect(enemyLastMove).not.toBe(MoveId.LEER);
  });
});
