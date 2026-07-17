/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown fairness engine — TWO-ENGINE parity proof (2026-07-10).
// The locked fairness rule: a showdown mon fields the manifest's FREE nature and has its IVs
// FORCED to a perfect [31 x6] on BOTH clients. This asserts, over one loopback pair with two real
// engines, that:
//   - the HOST's OWN party (built in SelectStarterPhase.initBattle from its own manifest) carries
//     the manifest nature and forced [31 x6] IVs;
//   - the HOST's ENEMY party (built via buildShowdownEnemy from the opponent manifest) carries the
//     opponent's manifest nature and the SAME forced [31 x6] IVs;
//   - the GUEST (a pure renderer booted from the host's post-build snapshot) sees the identical
//     values on both its own (flipped from the host's enemy) and enemy (flipped from the host's
//     own) parties;
//   - the turn-start CHECKSUM matches between the two engines (equal recalculated stats).
//
// Both manifests deliberately carry a NON-31 IV vector and a non-default nature, so the forcing is
// OBSERVABLE. RED-PROOF: revert the IV forcing in buildShowdownEnemy / initBattle -> the enemy would
// keep the manifest's [1..6] IVs and the `.toEqual([31,...])` assertions fail (and the checksum
// diverges from the host's forced own party).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { buildShowdownDuo, installDuoLogCapture, type ShowdownDuoRig, withClient } from "#test/tools/coop-duo-harness";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Non-default natures + a deliberately NON-31 IV vector, so the fairness forcing is OBSERVABLE. */
const OWN_NATURE = Nature.MODEST;
const OPP_NATURE = Nature.BOLD;
const NON31: number[] = [1, 2, 3, 4, 5, 6];
const PERFECT: number[] = [31, 31, 31, 31, 31, 31];

const pikachuOwn = (): ShowdownMonManifest => ({
  speciesId: SpeciesId.PIKACHU,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: OWN_NATURE,
  ivs: [...NON31],
  moveset: [MoveId.THUNDERBOLT, MoveId.TACKLE, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.PIKACHU,
  erBlackShiny: false,
  baseCost: 4,
});

const magikarpOpp = (): ShowdownMonManifest => ({
  speciesId: SpeciesId.MAGIKARP,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: OPP_NATURE,
  ivs: [...NON31],
  moveset: [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.MAGIKARP,
  erBlackShiny: false,
  baseCost: 4,
});

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

describe.skipIf(!RUN)("Showdown fairness — nature + forced-IV parity across two engines", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-fairness-${Date.now()}`);
    // globalScene citizenship (isolate:false): capture BEFORE any guest-scene swap.
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    initGlobalScene(prevScene);
  });

  /** Boot the HOST into a live showdown battle, building its OWN party FROM ITS OWN MANIFEST. */
  async function startHostShowdown(own: ShowdownMonManifest[], opponent: ShowdownMonManifest[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle(own, opponent);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      // Thread the OWN manifest so the host's own party is manifest-built (forced IVs + free nature),
      // exactly as launchShowdownBattle does for the real host launch.
      new SelectStarterPhase().initBattle(starters, true, undefined, own);
    });
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  it("forces [31 x6] IVs + fields the manifest nature on both the host's own and enemy parties, and the guest matches", async () => {
    await startHostShowdown([pikachuOwn()], [magikarpOpp()]);

    // HOST own party: built in initBattle from the own manifest -> manifest nature + forced perfect IVs.
    const hostOwn = game.scene.getPlayerParty()[0];
    expect(hostOwn.species.speciesId, "host fields its own Pikachu").toBe(SpeciesId.PIKACHU);
    expect(hostOwn.nature, "host own mon carries the manifest's free nature").toBe(OWN_NATURE);
    expect(hostOwn.ivs, "host own mon IVs forced to a perfect 31 spread").toEqual(PERFECT);

    // HOST enemy party: built via buildShowdownEnemy from the opponent manifest -> same forcing.
    const hostEnemy = game.scene.getEnemyParty()[0];
    expect(hostEnemy.species.speciesId, "host fields the opponent Magikarp").toBe(SpeciesId.MAGIKARP);
    expect(hostEnemy.nature, "host enemy mon carries the opponent manifest's free nature").toBe(OPP_NATURE);
    expect(hostEnemy.ivs, "host enemy mon IVs forced to a perfect 31 spread").toEqual(PERFECT);

    // Boot the GUEST from the host's post-build snapshot (mirror flips sides: guest's own = host's enemy).
    const pair = createLoopbackPair();
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    const guestOwn = rig.guestScene.getPlayerParty()[0]; // guest's own team = the opponent Magikarp
    expect(guestOwn.species.speciesId, "guest's own team is its Magikarp").toBe(SpeciesId.MAGIKARP);
    expect(guestOwn.nature, "guest's own mon carries its manifest nature (from the host snapshot)").toBe(OPP_NATURE);
    expect(guestOwn.ivs, "guest's own mon IVs are the forced perfect spread").toEqual(PERFECT);

    const guestEnemy = rig.guestScene.getEnemyParty()[0]; // guest's enemy = the host's Pikachu
    expect(guestEnemy.species.speciesId, "guest's enemy is the host's Pikachu").toBe(SpeciesId.PIKACHU);
    expect(guestEnemy.nature, "guest's enemy mon carries the host manifest nature").toBe(OWN_NATURE);
    expect(guestEnemy.ivs, "guest's enemy mon IVs are the forced perfect spread").toEqual(PERFECT);

    // TURN-START CHECKSUM PARITY: equal forced IVs + natures on both engines -> identical recalculated
    // stats -> byte-equal checksum. (Reverting the IV forcing desyncs the host's forced own party from
    // the guest's mirror-derived state, breaking this.)
    const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestStart, "guest boots checksum-identical to the host").toBe(hostStart);

    logs.flush();
  }, 300_000);
});
