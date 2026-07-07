/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PRE-BATTLE / early disconnect (D4), ER_SCENARIO / GameManager. A peer that drops before
// (or barely into) a duel takes the ShowdownLifecycle VOID branch (turn < SHOWDOWN_ABANDON_TURN_THRESHOLD
// -> earlyDisconnect). routeShowdownAbandon must resolve that cleanly - queue the ephemeral
// ShowdownResultPhase, dispose the still-pending enemy-command relay, and never throw - even when the
// UI is NOT on the message handler (a drop during the wager window enters with the WAGER screen up).
//
// FIDELITY NOTE: the true pre-battle window has the SelectStarterPhase running runShowdownFlow with the
// WAGER screen open and NO currentBattle (turn 0). That phase/UI state cannot be phase-driven reliably
// headlessly (TitlePhase / SelectStarterPhase don't advance under the interceptor when ended out-of-band),
// so this test drives routeShowdownAbandon from a live showdown CommandPhase at turn < threshold - the
// IDENTICAL void branch the turn-0 case takes - with the wager screen forced open so the result phase's
// non-message-mode entry (the reachable-strand the wave-1 review flagged) is exercised for real.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import {
  clearCoopRuntime,
  getCoopRuntime,
  routeShowdownAbandon,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import {
  beginShowdownBattle,
  endShowdownBattle,
  setPendingShowdownRelay,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { ShowdownWagerArgs } from "#ui/showdown-wager-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

describe.skipIf(!RUN)("Showdown pre-battle / early disconnect (D4)", () => {
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
  });

  async function startShowdown(): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle([mon()], [mon()]);
      const starters = generateStarters(game.scene, [SpeciesId.MILTANK]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase");
  }

  it("early-disconnect voids cleanly, disposes the pending relay, and no throw with the wager screen open", async () => {
    startLocalCoopSession({ kind: "versus" });
    await startShowdown();

    // A relay is pending (created in the pre-battle flow, not yet adopted into a match); the WAGER screen
    // is up (a drop during the wager window). A turn below the threshold is the void (earlyDisconnect) branch.
    const relay = new ShowdownCommandRelay(getCoopRuntime()!.localTransport);
    setPendingShowdownRelay(relay);
    const disposeSpy = vi.spyOn(relay, "dispose");
    const runtime = getCoopRuntime()!;
    const wagerArgs: ShowdownWagerArgs = {
      ownTeam: [mon()],
      opponentTeam: [mon({ speciesId: SpeciesId.SNORLAX })],
      opponentProfile: null,
      role: runtime.controller.role,
      transport: runtime.localTransport,
      rendezvous: runtime.rendezvous,
      onCommit: () => {},
    };
    await game.scene.ui.setMode(UiMode.SHOWDOWN_WAGER, wagerArgs);
    // Force the pre-battle turn so the abandon is unambiguously the turn-0/early void branch.
    if (game.scene.currentBattle != null) {
      game.scene.currentBattle.turn = 0;
    }

    // The partner drops and never reconnects -> the rejoin-failure path routes the abandon.
    let threw = false;
    try {
      routeShowdownAbandon(getCoopRuntime()!);
    } catch {
      threw = true;
    }

    // The void routes to ShowdownResultPhase, which - now that it ensures the MESSAGE handler on entry -
    // renders its result line even though we entered from the WAGER screen, and returns to the title.
    await game.phaseInterceptor.to("ShowdownResultPhase");
    await game.phaseInterceptor.to("TitlePhase");

    expect(threw, "routeShowdownAbandon must not throw in the early-disconnect window").toBe(false);
    expect(disposeSpy, "the pending pre-battle relay is disposed on abandon").toHaveBeenCalled();
    expect(game.scene.phaseManager.getCurrentPhase()?.phaseName).toBe("TitlePhase");
  });
});
