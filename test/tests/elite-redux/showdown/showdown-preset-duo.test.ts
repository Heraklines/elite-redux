/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Team Menu (Phase D) - the PRE-BUILT PRESET entry, proven end-to-end on TWO engines.
//
// The inverted flow: BOTH clients arrive with a team already built (a saved preset), reconstructed
// into engine starters via `manifestToStarter` and fed straight into the existing versus pipeline -
// no in-lobby teambuild. This proves:
//   (a) HASH PARITY (the red-proof): each client reconstructs the SAME wire manifests from the preset
//       (`starterToManifest(manifestToStarter(m))` byte-identical to the stored manifest), so both hash
//       the same team - the property the ready gate depends on.
//   (b) The reconstructed teams boot a real two-engine battle: the guest boots CHECKSUM-IDENTICAL to
//       the host (hash green) and BOTH reach CommandPhase with zero stalls.
// Mirrors showdown-duo.test.ts's harness lifecycle (globalScene citizenship afterEach).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  beginShowdownBattle,
  endShowdownBattle,
  setPendingShowdownPresetStarters,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { manifestToStarter, starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { buildShowdownDuo, installDuoLogCapture, type ShowdownDuoRig, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A stored preset manifest (production shape: always nature-bearing). */
function mon(over: Partial<ShowdownMonManifest>): ShowdownMonManifest {
  return {
    speciesId: SpeciesId.MAGIKARP,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    nature: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [MoveId.SPLASH, MoveId.TACKLE],
    item: "LEFTOVERS",
    rootSpeciesId: SpeciesId.MAGIKARP,
    erBlackShiny: false,
    baseCost: 4,
    ...over,
  };
}

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

describe.skipIf(!RUN)("Showdown Team Menu - pre-built preset -> two-engine battle (Phase D)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-preset-duo-${Date.now()}`);
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    initGlobalScene(prevScene);
  });

  it("both clients enter with a preset; hash parity holds and the guest boots checksum-identical", async () => {
    // Two saved presets (host + guest). RECONSTRUCT each client's team from its stored manifests, exactly
    // as the Team Menu's enter-lobby path does, then RE-DERIVE the wire manifests.
    const hostPreset: ShowdownMonManifest[] = [mon({ speciesId: SpeciesId.PIKACHU, rootSpeciesId: SpeciesId.PIKACHU })];
    const guestPreset: ShowdownMonManifest[] = [mon({})];

    const hostStarters = hostPreset.map(manifestToStarter);
    const guestStarters = guestPreset.map(manifestToStarter);
    const gd = game.scene.gameData;
    const hostManifests = hostStarters.map(s => starterToManifest(s, gd));
    const guestManifests = guestStarters.map(s => starterToManifest(s, gd));

    // (a) HASH PARITY red-proof: the reconstructed manifests are byte-identical to the stored preset
    // (baseCost is recomputed from the raw table, so normalize it out). A reconstruct that dropped a
    // field / conjured an optional would fail here and desync both clients at the ready gate.
    const norm = (m: ShowdownMonManifest) => ({ ...m, baseCost: 0 });
    expect(hostManifests.map(norm)).toEqual(hostPreset.map(norm));
    expect(guestManifests.map(norm)).toEqual(guestPreset.map(norm));

    // Boot the HOST into the live versus battle from its reconstructed team (opponent = guest's team).
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle(hostManifests, guestManifests);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(hostStarters, true, undefined, hostManifests);
    });
    await game.phaseInterceptor.to("CommandPhase", false);

    // Stand up the GUEST engine over one loopback pair and reach its battle.
    const pair = createLoopbackPair();
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    // (b) HASH GREEN + zero stalls: the guest booted from the host's battle is checksum-identical, and
    // BOTH engines sit at a live CommandPhase (the pre-built teams drove pairing straight to battle).
    const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestStart, "guest boots checksum-identical to the host (hash green)").toBe(hostStart);
    expect(rig.hostScene.getPlayerParty()[0].species.speciesId).toBe(SpeciesId.PIKACHU);
    expect(rig.guestScene.getPlayerParty().length).toBeGreaterThan(0);

    logs.flush();
  }, 300_000);

  it("RED-PROOF: reaching the versus flow with NO pending preset hard-fails to a message, never the grid", async () => {
    // Stale-wiring guard (maintainer #3): teams are built BEFORE pairing now, so a client should ALWAYS
    // carry a pending preset into startShowdownSelect. If it doesn't (a reconnect after the single-use
    // stash was consumed, or any legacy direct-lobby path), the OLD code fell through to the interactive
    // STARTER_SELECT grid - "sent to pick another team mid-pairing". It must hard-fail to a clear message
    // instead. RED-PROOF: restore the grid fallthrough and this asserts STARTER_SELECT opened.
    await game.runToTitle();
    // Stand up a versus session so SelectStarterPhase takes the showdown branch (needs a coop controller
    // + runtime; both come from the local versus session).
    startLocalCoopSession({ username: "solo", kind: "versus" });
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    setPendingShowdownPresetStarters(null); // the fault condition: no team carried in

    new SelectStarterPhase().start();
    await new Promise(r => setTimeout(r, 300));

    expect(globalScene.ui.getMode(), "must NOT drop into the starter-select grid").not.toBe(UiMode.STARTER_SELECT);
    expect(globalScene.ui.getMode(), "aborts to a clear message + back-out").toBe(UiMode.MESSAGE);
    clearCoopRuntime();
  }, 120_000);
});
