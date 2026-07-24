/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT BOARD (P1.5) — REAL-PATH acceptance. Drives the ACTUAL
// TournamentBracketUiHandler through the REAL globalScene.ui stack (setMode ->
// construct -> show -> processInput), NOT a stubbed seam. The load-bearing edge:
// pressing A while the browse cursor sits on YOUR playable match must route into
// the tournament lobby entry with the right matchId + bracket opponent (what the
// flow controller wires to openCoopLobby). Also asserts: A on a NON-your match is
// inert; B backs out; the board container is actually shown (visibility-asserted).
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { buildTournamentBracketDemoConfig } from "#ui/tournament-bracket-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.runIf(RUN)("showdown tournament board - real-path acceptance", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
    await game.importData("./test/utils/saves/everything.prsv");
  });
  afterAll(() => phaserGame?.destroy(true));
  beforeEach(() => {
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
  });

  const mode = () => game.scene.ui.getMode();
  const handler = () => game.scene.ui.getHandler() as any;

  /** Open the board FRESH: hop through MESSAGE first so setMode actually re-show()s (same-mode is a no-op). */
  const openBoard = async (cfg: any) => {
    await game.scene.ui.setMode(UiMode.MESSAGE);
    game.scene.ui.resetModeChain();
    await game.scene.ui.setMode(UiMode.TOURNAMENT_BRACKET, cfg);
    await wait(50);
  };

  it("A on YOUR match routes into the tournament lobby entry (matchId + opponent)", async () => {
    // Fresh 4-bracket (Sample Cup shape): the viewer's semifinal is live + playable, cursor defaults onto it.
    const cfg = buildTournamentBracketDemoConfig({ size: 4, advancedRounds: 0, card: "playable" });
    let played: { matchId: string; opponent: string } | null = null;
    cfg.onPlayMatch = (matchId: string, opponent: string) => {
      played = { matchId, opponent };
    };

    await openBoard(cfg);
    expect(mode()).toBe(UiMode.TOURNAMENT_BRACKET);
    // visibility-asserted realpath: the board is actually up (not a blank strand).
    expect(handler().container.visible, "the board container is shown").toBe(true);

    // The viewer's live match + its bracket opponent (worker-authoritative), the exact fight A must open.
    const bracket = cfg.tournament.bracket!;
    const mine = bracket.rounds.flat().find(m => m.winner === null && (m.a === "Carla" || m.b === "Carla"))!;
    const opponent = mine.a === "Carla" ? mine.b : mine.a;

    handler().processInput(Button.ACTION);
    await wait(20);
    expect(played, "A on your playable match fired onPlayMatch").not.toBeNull();
    expect(played!.matchId).toBe(mine.id);
    expect(played!.opponent).toBe(opponent);
  });

  it("A on a NON-your browsed match is inert (only YOUR fight enters the lobby)", async () => {
    // resolvedSemi + browseOther: the cursor starts on the OTHER (already-resolved) semifinal, not yours.
    const cfg = buildTournamentBracketDemoConfig({
      size: 4,
      resolvedSemi: true,
      browseOther: true,
      card: "playable",
    });
    let fired = false;
    cfg.onPlayMatch = () => {
      fired = true;
    };
    await openBoard(cfg);

    handler().processInput(Button.ACTION);
    await wait(20);
    expect(fired, "A on another player's match does nothing").toBe(false);
  });

  it("B backs out of the board", async () => {
    const cfg = buildTournamentBracketDemoConfig({ size: 4, advancedRounds: 0, card: "playable" });
    let backed = false;
    cfg.onBack = () => {
      backed = true;
    };
    await openBoard(cfg);

    handler().processInput(Button.CANCEL);
    await wait(20);
    expect(backed, "B fired onBack").toBe(true);
  });

  it.each([1, 2])("shows the registration roster before a %i-entrant bracket exists", async entrantCount => {
    const cfg = buildTournamentBracketDemoConfig({ size: 4, advancedRounds: 0, card: "playable" });
    cfg.tournament.state = "registration";
    cfg.tournament.startedAt = null;
    cfg.tournament.bracket = null;
    cfg.tournament.entrants = cfg.tournament.entrants.slice(0, entrantCount).map(entrant => ({
      ...entrant,
      seed: null,
    }));
    cfg.tournament.entrantCount = entrantCount;

    await openBoard(cfg);
    const h = handler();

    expect(h.container.visible, "the registration board is shown").toBe(true);
    expect(h.cardTitle.text).toBe("REGISTRATION OPEN");
    expect(h.cardBody.text).toContain(`${entrantCount}/4 entered`);
    expect(h.nodes.length, "registration panel and entrant rows were rendered").toBeGreaterThanOrEqual(
      6 + entrantCount * 6,
    );
  });

  it("deep-link: initialBrowse opens the board ON the target match (challenge-notification realpath)", async () => {
    // A challenge notification deep-links to a specific match via initialBrowse (the title flow
    // passes it into the board config). The board must land its browse cursor there on show().
    const cfg = buildTournamentBracketDemoConfig({ size: 16, advancedRounds: 2, card: "playable" });
    cfg.initialBrowse = { round: 0, slot: 3 };
    await openBoard(cfg);
    const h = handler();
    expect(h.container.visible, "the deep-linked board is shown").toBe(true);
    expect(h.browse, "the browse cursor lands on the deep-link target").toEqual({ round: 0, slot: 3 });
    expect(h.browsedMatch.id).toBe(cfg.tournament.bracket!.rounds[0][3].id);
  });

  it("d-pad browse moves the cursor to another match (its pairing card follows)", async () => {
    const cfg = buildTournamentBracketDemoConfig({ size: 4, advancedRounds: 0, card: "playable" });
    await openBoard(cfg);
    const h = handler();
    const first = { ...h.browse };
    // DOWN within round 0 (2 semifinals) moves onto the other semifinal.
    h.processInput(Button.DOWN);
    await wait(20);
    expect(h.browse, "the browse cursor moved to a different match").not.toEqual(first);
    expect(h.browsedMatch, "the browsed match is tracked for its pairing card").not.toBeNull();
  });
});
