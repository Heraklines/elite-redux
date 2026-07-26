/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT match — result-path integration proof (P1). Drives a REAL
// ShowdownResultPhase over a REAL local versus coop session (the same seam
// showdown-result-teardown uses) with a TOURNAMENT match context set, and proves
// the P1 gating:
//   1. NO ESCROW: a tournament match keeps the escrow matchId null, so the escrow
//      result path (reportShowdownResult) is NEVER called — nobody's collection is
//      at risk (prize-only). Spied and asserted zero calls.
//   2. RESULT REPORTED: the decisive outcome is reported to the tournament worker
//      client (reportTournamentResult) with the correct (tournamentId, matchId,
//      winner-username), through the loopback-stubbed client seam.
//   3. BRACKET ADVANCE: feeding that reported winner into the local bracket engine
//      advances the match (server-authoritative advance mirrored on the client view).
// The opponent-constraint rejection is red-proofed as a pure test in
// tournament-client-pure.test.ts (isTournamentPeerAllowed).
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { clearCoopRuntime, getCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import * as escrowClient from "#data/elite-redux/showdown/showdown-escrow-client";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import * as tournamentClient from "#data/elite-redux/showdown/tournament-client";
import {
  clearTournamentMatchContext,
  getTournamentMatchContext,
  setTournamentMatchContext,
} from "#data/elite-redux/showdown/tournament-match-context";
import { Status } from "#data/status-effect";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { VictoryPhase } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyResultReport, generateBracket } from "../../../../workers/er-telemetry/src/tournament-bracket";

const RUN = process.env.ER_SCENARIO === "1";

const mon = (over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest => ({
  speciesId: SpeciesId.SNORLAX,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.HEADBUTT, MoveId.LEER],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.SNORLAX,
  erBlackShiny: false,
  baseCost: 4,
  ...over,
});

describe.skipIf(!RUN)("Showdown tournament match — result path (P1)", () => {
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
    clearCoopRuntime();
    clearTournamentMatchContext();
    vi.restoreAllMocks();
  });

  async function startShowdown(): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      // beginShowdownBattle WITHOUT a matchId — a tournament match is prize-only (escrow matchId null).
      beginShowdownBattle([mon()], [mon()]);
      const starters = generateStarters(game.scene, [SpeciesId.MILTANK]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase");
  }

  it("routes a swept Showdown trainer directly to the result phase", async () => {
    startLocalCoopSession({ kind: "versus", username: "carla" });
    await startShowdown();
    const enemy = game.scene.getEnemyParty()[0];
    enemy.hp = 0;
    enemy.status = new Status(StatusEffect.FAINT);

    const pushNew = vi.spyOn(game.scene.phaseManager, "pushNew");
    const victory = new VictoryPhase(enemy.getBattlerIndex());
    vi.spyOn(victory, "end").mockImplementation(() => {});
    victory.start();

    const queued = pushNew.mock.calls.map(([name]) => name);
    expect(queued).toContain("ShowdownResultPhase");
    expect(queued).not.toContain("BattleEndPhase");
    expect(queued).not.toContain("TrainerVictoryPhase");
  });

  it("reports to the tournament worker (not escrow) and advances the local bracket on a WIN", async () => {
    // Loopback-stub the worker client seams.
    const reportTournament = vi
      .spyOn(tournamentClient, "reportTournamentResult")
      .mockResolvedValue({ ok: true, data: { resolution: "pending" } });
    const reportEscrow = vi
      .spyOn(escrowClient, "reportShowdownResult")
      .mockResolvedValue({ ok: false, error: "should not be called" } as never);

    startLocalCoopSession({ kind: "versus", username: "carla" });
    await startShowdown();

    const localName = getCoopRuntime()?.controller.localName() ?? "";
    const partnerName = getCoopRuntime()?.controller.partnerName ?? "";
    expect(localName, "local player name must resolve").toBeTruthy();

    // Build the authoritative 4-player bracket. Seed order for size 4 is [1,4,2,3], so pairing
    // localName(seed 1) vs partnerName(seed 4) makes r0-m0 exactly this match, feeding the final.
    const rival = partnerName || "rival";
    const bracket = generateBracket(
      "cup",
      [
        { participant: localName, seed: 1 },
        { participant: rival, seed: 4 },
        { participant: "seed2", seed: 2 },
        { participant: "seed3", seed: 3 },
      ],
      24 * 3_600_000,
      0,
    );
    const matchId = bracket.rounds[0][0].id;
    expect(bracket.rounds[0][0].a).toBe(localName);
    expect(bracket.rounds[0][0].b).toBe(rival);
    setTournamentMatchContext({ tournamentId: "cup", matchId, expectedOpponent: rival });

    // Drive the real result phase for a local WIN, all the way back to the title.
    game.scene.phaseManager.clearPhaseQueue();
    game.scene.phaseManager.unshiftNew("ShowdownResultPhase", true, "victory", false, false);
    game.scene.phaseManager.getCurrentPhase()?.end();
    await game.phaseInterceptor.to("TitlePhase");

    // 1. ESCROW NEVER CALLED (prize-only, escrow matchId null).
    expect(reportEscrow, "a tournament match must not touch escrow").not.toHaveBeenCalled();

    // 2. RESULT REPORTED to the tournament worker with the winner (the local player won).
    expect(reportTournament).toHaveBeenCalledTimes(1);
    expect(reportTournament).toHaveBeenCalledWith("cup", matchId, localName);

    // 3. BRACKET ADVANCE: feed the reported winner into the engine (both clients report; here we
    //    apply the local + a matching peer report) — the winner advances into the final slot.
    applyResultReport(bracket, matchId, localName, localName, 1);
    applyResultReport(bracket, matchId, rival, localName, 2);
    expect(bracket.rounds[0][0].winner).toBe(localName);
    expect(bracket.rounds[1][0].a).toBe(localName);
  });

  it("does NOT report a VOIDED tournament match", async () => {
    const reportTournament = vi
      .spyOn(tournamentClient, "reportTournamentResult")
      .mockResolvedValue({ ok: true, data: { resolution: "pending" } });

    startLocalCoopSession({ kind: "versus", username: "carla" });
    await startShowdown();
    setTournamentMatchContext({ tournamentId: "cup", matchId: "cup-r0-m0", expectedOpponent: "rival" });

    // A void (checksum mismatch) has no winner to attest — never advances a bracket.
    game.scene.phaseManager.clearPhaseQueue();
    game.scene.phaseManager.unshiftNew("ShowdownResultPhase", false, "checksum", true, false);
    game.scene.phaseManager.getCurrentPhase()?.end();
    await game.phaseInterceptor.to("TitlePhase");

    expect(reportTournament).not.toHaveBeenCalled();
  });

  it("reports a peer-routed result and keeps the match context until attestation completes", async () => {
    let resolveReport: ((value: tournamentClient.ClientResult<{ resolution: string }>) => void) | null = null;
    const reportTournament = vi.spyOn(tournamentClient, "reportTournamentResult").mockReturnValue(
      new Promise(resolve => {
        resolveReport = resolve;
      }),
    );

    startLocalCoopSession({ kind: "versus", username: "carla" });
    await startShowdown();
    const localName = getCoopRuntime()?.controller.localName() ?? "";
    const rival = getCoopRuntime()?.controller.partnerName ?? "rival";
    setTournamentMatchContext({ tournamentId: "cup", matchId: "cup-r0-m0", expectedOpponent: rival });

    game.scene.phaseManager.clearPhaseQueue();
    // silent=true mirrors a result routed from the peer; it suppresses wire re-emission, not HTTP attestation.
    game.scene.phaseManager.unshiftNew("ShowdownResultPhase", true, "victory", false, true);
    game.scene.phaseManager.getCurrentPhase()?.end();
    const returnToTitle = game.phaseInterceptor.to("TitlePhase");

    await vi.waitFor(() => expect(reportTournament).toHaveBeenCalledWith("cup", "cup-r0-m0", localName));
    expect(getTournamentMatchContext(), "context survives until the result request settles").not.toBeNull();
    expect(game.scene.phaseManager.getCurrentPhase()?.phaseName).toBe("ShowdownResultPhase");

    resolveReport?.({ ok: true, data: { resolution: "settled" } });
    await returnToTitle;
    expect(getTournamentMatchContext()).toBeNull();
  });
});
