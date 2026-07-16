/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 GUEST command flow (Task F1), ER_SCENARIO / GameManager.
//
// The data-level side swap makes the versus GUEST's own team its LOCAL PLAYER party, so the guest
// drives the NORMAL player-side CommandPhase and its resolved own-slot command is INTERCEPTED at the
// handleCommand commit point, SHIPPED via the relay (not executed locally), and replaced with an
// inert skip. This proves that interception for both a FIGHT and a SWITCH, plus the HOST-side
// round-trip: a relayed SWITCH cursor (a party index) resolves to the RIGHT benched enemy mon,
// because the swap preserves party ORDER (guest local player order == host enemy order).
// =============================================================================

import { getGameMode } from "#app/game-mode";
import type { CommandPhase } from "#app/phases/command-phase";
import { clearCoopRuntime, getCoopController, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair, type SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
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

/** Wrap a relay so every shipped command is captured for assertions (still forwarded). */
function captureRelay(relay: ShowdownCommandRelay): { turn: number; command: SerializedCommand }[] {
  const captured: { turn: number; command: SerializedCommand }[] = [];
  const orig = relay.sendCommand.bind(relay);
  relay.sendCommand = (turn: number, command: SerializedCommand) => {
    captured.push({ turn, command });
    orig(turn, command);
  };
  return captured;
}

describe.skipIf(!RUN)("Showdown guest command flow - interception + switch round-trip (Task F1)", () => {
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

  it("versus GUEST ships its own-slot FIGHT via the relay and writes an inert skip", async () => {
    startLocalCoopSession({ kind: "versus" });
    const { host } = createLoopbackPair();
    const relay = new ShowdownCommandRelay(host);
    const captured = captureRelay(relay);
    beginShowdownBattle([mon({})], [mon({})], relay);

    await startShowdown(game, [mon({ speciesId: SpeciesId.SNORLAX })], relay, [SpeciesId.PIKACHU, SpeciesId.MILTANK]);
    // This client is the versus GUEST: its own team is its LOCAL player party and it SHIPS, not executes.
    getCoopController()!.role = "guest";

    const cp = game.scene.phaseManager.getCurrentPhase() as unknown as CommandPhase;
    const move0 = game.scene.getPlayerParty()[0].getMoveset()[0]!.moveId;
    cp.handleCommand(Command.FIGHT, 0);

    expect(captured, "the guest shipped exactly one command").toHaveLength(1);
    expect(captured[0].command, "FIGHT ships the move slot + move id").toMatchObject({
      command: Command.FIGHT,
      cursor: 0,
      moveId: move0,
    });
    expect(game.scene.currentBattle.turnCommands[0]?.skip, "the guest wrote an inert skip locally").toBe(true);
  });

  it("versus GUEST ships a SWITCH (party index) via the relay", async () => {
    startLocalCoopSession({ kind: "versus" });
    const { host } = createLoopbackPair();
    const relay = new ShowdownCommandRelay(host);
    const captured = captureRelay(relay);
    beginShowdownBattle([mon({})], [mon({})], relay);

    await startShowdown(game, [mon({ speciesId: SpeciesId.SNORLAX })], relay, [SpeciesId.PIKACHU, SpeciesId.MILTANK]);
    getCoopController()!.role = "guest";

    const cp = game.scene.phaseManager.getCurrentPhase() as unknown as CommandPhase;
    cp.handleCommand(Command.POKEMON, 1, false);

    expect(captured, "the guest shipped exactly one command").toHaveLength(1);
    expect(captured[0].command, "SWITCH ships the raw party slot as the cursor").toMatchObject({
      command: Command.POKEMON,
      cursor: 1,
      baton: false,
    });
    expect(game.scene.currentBattle.turnCommands[0]?.skip).toBe(true);
  });

  it("HOST validates + executes a relayed SWITCH to the RIGHT benched mon (party-order alignment)", async () => {
    startLocalCoopSession({ kind: "versus" });
    const { host, guest } = createLoopbackPair();
    const relay = new ShowdownCommandRelay(host);
    const peer = new ShowdownCommandRelay(guest);
    // The remote guest switches to its party slot 1 - the host must resolve that raw index against ITS
    // enemy party (built from the guest manifest in the SAME order) and send out the slot-1 mon.
    peer.onCommandRequest(() => ({ command: Command.POKEMON, cursor: 1, baton: false }));

    const opponent = [mon({ speciesId: SpeciesId.SNORLAX }), mon({ speciesId: SpeciesId.MILTANK })];
    await startShowdown(game, opponent, relay, [SpeciesId.PIKACHU]);
    expect(game.scene.getEnemyField()[0]?.species.speciesId, "the enemy lead starts as manifest slot 0").toBe(
      SpeciesId.SNORLAX,
    );

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("CoopTurnCommitPhase");

    expect(
      game.scene.getEnemyField()[0]?.species.speciesId,
      "the relayed cursor=1 switched in the manifest slot-1 mon (order preserved)",
    ).toBe(SpeciesId.MILTANK);
    peer.dispose();
  });
});
