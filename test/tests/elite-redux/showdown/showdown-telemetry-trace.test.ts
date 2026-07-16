/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 TELEMETRY replay-trace capture (D5, reviewer gap fix), ER_SCENARIO / GameManager.
// Proves a driven showdown match records a REAL, non-null ReplayTrace whose events contain BOTH:
//   - a HOST player-side command (slotFieldIndex 0), and
//   - the RELAYED enemy command (slotFieldIndex >= enemyOffset), LEER at slot 3.
// Plus: the sealed telemetry payload includes the trace and stays under the 64KB body cap.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { getReplayTrace } from "#data/elite-redux/replay-recorder";
import type { ReplayCommandEvent } from "#data/elite-redux/replay-trace";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { buildShowdownTelemetryPayload } from "#data/elite-redux/showdown/showdown-telemetry";
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

describe.skipIf(!RUN)("Showdown telemetry replay-trace capture (D5)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.moveset([MoveId.TACKLE]);
  });

  afterEach(() => {
    endShowdownBattle();
    clearCoopRuntime(); // also clearReplayRecording()
  });

  it("records a non-null trace with BOTH a host command and the relayed enemy command", async () => {
    startLocalCoopSession({ kind: "versus" });
    const { host, guest } = createLoopbackPair();
    const relay = new ShowdownCommandRelay(host);
    const peer = new ShowdownCommandRelay(guest);
    // The remote peer answers every enemy-command request with LEER (slot 3).
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

    // The showdown HOST began recording at EncounterPhase (isShowdown + host).
    const trace = getReplayTrace();
    expect(trace).not.toBeNull();
    const commands = (trace?.events ?? []).filter((e): e is ReplayCommandEvent => e.type === "command");

    // A HOST player-side command (slotFieldIndex 0), the TACKLE it selected.
    const hostCmd = commands.find(e => e.slotFieldIndex === 0 && e.command.kind === "move");
    expect(hostCmd, "expected a host player-side move command in the trace").toBeDefined();

    // The RELAYED enemy command (enemy slot >= 2), LEER at moveset slot 3.
    const enemyCmd = commands.find(e => e.slotFieldIndex >= 2 && e.command.kind === "move");
    expect(enemyCmd, "expected a relayed enemy move command in the trace").toBeDefined();
    if (enemyCmd?.command.kind === "move") {
      expect(enemyCmd.command.moveIndex).toBe(3); // LEER's moveset slot
    }

    // The sealed telemetry payload includes the trace and stays under the 64KB body cap.
    const payload = buildShowdownTelemetryPayload(
      {
        matchId: "m1",
        hostUid: "host",
        guestUid: "guest",
        hostTeam: opponent,
        guestTeam: opponent,
        seed: game.scene.seed,
        clientVersion: "test",
        startedAt: 0,
      },
      { winner: "host", reason: "victory", voided: false, turns: 2 },
      1000,
      trace,
    );
    expect(payload.replayTrace).not.toBeNull();
    // Measured ~2.6KB for this 1-turn / 1-mon trace; a 6v6 ~10-turn match extrapolates to ~15KB
    // (the 6 PokemonData roster dominates; ~20 command events add ~1.2KB) - well under the 64KB cap.
    expect(JSON.stringify(payload).length).toBeLessThan(64 * 1024);

    peer.dispose();
  });
});
