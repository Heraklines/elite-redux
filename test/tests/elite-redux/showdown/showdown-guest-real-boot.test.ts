/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 VERSUS - GUEST REAL LAUNCH PIPELINE end-to-end (regression proof).
//
// WHY THIS EXISTS (the coverage hole). The two-engine duo harness boots the guest via
// `mirrorHostBattleToGuest` - it reconstructs the guest's field DIRECTLY and never runs the
// REAL production boot. Four consecutive live-only crashes shipped through a green suite because
// no test drove: `applyCoopLaunchSession(snapshotJson)` -> `pushNew("EncounterPhase", true)` ->
// the loaded encounter's summon / post-summon chain. All four bugs lived in that chain:
//   (1) getPokemonNameWithAffix null currentBattle during enemy reconstruction,
//   (2) sortBySpeed comparator on an un-fielded entry,
//   (3) ShinySparklePhase naked getPokemon().sparkle(),
//   (4) THE ROOT HOLE: the loaded EncounterPhase never summoned the guest's own lead (the versus
//       launch snapshot is PRE-summon), so PostSummonPhasePriorityQueue.queueAbilityPhase's
//       getField()[bi] round-trip hit undefined - an empty player side.
// The fix for (4) landed in encounter-phase.ts end() loaded branch (versus-guest-gated
// SummonPhase(0) + ToggleDoublePositionPhase(false); commit 0f525b9e8). This test drives the
// REAL boot pipeline headlessly so a regression of ANY of the above fails LOUDLY (a throw or a
// no-progress stall), instead of only surfacing in a live match.
//
// WHAT IT DOES (production-faithful):
//   1. Stand up the versus duo (host in a real showdown battle; guest scene + runtimes over one
//      loopback pair) via `buildShowdownDuo`, exactly as showdown-duo.test.ts.
//   2. On the HOST ctx: produce the launch snapshot EXACTLY as production does - the SAME
//      `getSessionSaveData()` -> bigint-safe JSON serialization that
//      `EncounterPhase.broadcastCoopLaunchSnapshot` (encounter-phase.ts:315-319) pushes.
//   3. On the GUEST ctx: run the REAL path - `applyCoopLaunchSession(json)` (the F1 swapSessionData
//      fires under the guest's live flip gate), then `pushNew("EncounterPhase", true)` and PUMP the
//      guest phase manager through the whole launch chain (EncounterPhase -> enemy SummonPhase ->
//      sparkles -> player SummonPhase -> ToggleDoublePosition -> InitEncounterPhase -> PostSummon ->
//      TurnInitPhase -> CommandPhase). Trainer-intro dialogue auto-advances (the guest's real
//      MessageUiHandler awaits ACTION on a prompt - we feed it, the same technique the ME-mirror
//      quiz driver uses).
//   4. Assert: no uncaught throw anywhere in the chain (a throw or a no-progress stall FAILS
//      loudly), the guest's own lead is ON FIELD (its local player lead = its own team), the enemy
//      lead is ON FIELD (= the host's team lead), getField(true).length === 2, every fielded mon's
//      getField()[bi] round-trip holds, and the guest reached CommandPhase.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/showdown/showdown-guest-real-boot.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { PokemonMove } from "#data/moves/pokemon-move";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownDuo,
  drainLoopback,
  installDuoLogCapture,
  type ShowdownDuoRig,
  withClient,
} from "#test/tools/coop-duo-harness";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest's OWN team (the opponent manifest from the host's perspective). Frail, so it is legal + tiny. */
const magikarp = (): ShowdownMonManifest => ({
  speciesId: SpeciesId.MAGIKARP,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.MAGIKARP,
  erBlackShiny: false,
  baseCost: 4,
});

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

/**
 * Serialize the host's coherent launch session EXACTLY as production's
 * {@linkcode EncounterPhase.broadcastCoopLaunchSnapshot} does (encounter-phase.ts:315-319):
 * `getSessionSaveData()` under a bigint-safe replacer. This is the identical byte stream the host
 * pushes over `streamer.sendLaunchSnapshot`, so the guest boots from the production wire payload.
 */
function serializeHostLaunchSnapshot(hostScene: BattleScene): string {
  return JSON.stringify(hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

/**
 * If the guest UI is parked on a message PROMPT awaiting ACTION (the trainer-intro dialogue that
 * the loaded EncounterPhase renders through the guest's REAL MessageUiHandler), advance it - the
 * same message-handler auto-continue the ME-mirror quiz driver (`advanceGuestVerdict`) uses.
 * @returns whether a prompt was advanced (i.e. progress was made).
 */
function advanceGuestDialogue(scene: BattleScene): boolean {
  if (scene.ui.getMode() !== UiMode.MESSAGE) {
    return false;
  }
  const handler = scene.ui.getHandler() as unknown as {
    awaitingActionInput?: boolean;
    processInput?: (b: number) => boolean;
  };
  if (handler.awaitingActionInput && typeof handler.processInput === "function") {
    handler.processInput(Button.ACTION);
    return true;
  }
  return false;
}

/**
 * Model the three Phaser effects the HEADLESS scene's no-op atlas loader cannot produce: cache admission,
 * the live sprite texture, and the live animation key. The real Pokemon.loadAssets call still runs first;
 * this adapter only completes its visual side effects after that promise settles. Recompute the final key
 * after loading because the versus guest's side swap replaces the temporary substitute with a dynamic back
 * key (`pkmn__back__<species>`).
 */
function modelHeadlessPlayerAtlasCompletion(scene: BattleScene): void {
  const releasedKeys = new Set<string>();
  const originalTextureExists = scene.textures.exists.bind(scene.textures);
  const originalAnimationExists = scene.anims.exists.bind(scene.anims);
  vi.spyOn(scene.textures, "exists").mockImplementation(
    key => releasedKeys.has(String(key)) || originalTextureExists(key),
  );
  vi.spyOn(scene.anims, "exists").mockImplementation(
    key => releasedKeys.has(String(key)) || originalAnimationExists(key),
  );

  const capacity = scene.currentBattle.arrangement.playerCapacity;
  for (const pokemon of scene.getPlayerParty().slice(0, capacity)) {
    const original = pokemon.loadAssets.bind(pokemon);
    vi.spyOn(pokemon, "loadAssets").mockImplementation(async (ignoreOverride = true, useIllusion = false) => {
      await original(ignoreOverride, useIllusion);
      const key = pokemon.getBattleSpriteKey();
      releasedKeys.add(key);
      for (const sprite of [pokemon.getSprite(), pokemon.getTintSprite()]) {
        if (sprite == null) {
          continue;
        }
        const live = sprite as unknown as {
          texture: { key: string };
          anims: { currentAnim?: { key: string } };
        };
        live.texture.key = key;
        live.anims.currentAnim = { key };
      }
    });
  }
}

/** The observations the pump collects while draining the guest's REAL launch chain (asserted outside). */
interface GuestBootResult {
  reached: string;
  playerLeadSpecies: number;
  playerLeadOnField: boolean;
  playerLeadFainted: boolean;
  enemyLeadSpecies: number;
  enemyLeadOnField: boolean;
  activeFieldCount: number;
  roundTripHolds: boolean;
}

/**
 * PUMP the guest scene's REAL phase manager through the whole loaded-launch chain until it reaches
 * CommandPhase (or throws). MUST be called inside `withClient(guestCtx, ...)` so globalScene is the
 * guest. The guest scene's `startCurrentPhase` is stubbed inert by `buildGuestScene` (the cooperative
 * scheduler drives phases explicitly), so we start each freshly-current phase ourselves, drain the
 * loopback / mock clock between starts, and feed ACTION to any pending dialogue prompt. A no-progress
 * stall THROWS (the hang detection the duo harness exists to surface).
 */
async function pumpGuestLaunchChain(guestScene: BattleScene): Promise<string> {
  const STOP = new Set(["CommandPhase"]);
  const phasesSeen: string[] = [];
  let lastStarted: Phase | null = null;
  let stall = 0;
  const MAX_STALL = 120;
  for (let i = 0; i < 800; i++) {
    const cur = guestScene.phaseManager.getCurrentPhase();
    if (cur == null) {
      throw new Error(`guest launch chain: null current phase (seen=[${phasesSeen.join(",")}])`);
    }
    if (STOP.has(cur.phaseName)) {
      return cur.phaseName;
    }
    if (cur === lastStarted) {
      // The same phase persists across drains: either it is parked on a dialogue prompt (advance it)
      // or it is doing async work (asset load / setMode) that resolves on further drains.
      const advanced = advanceGuestDialogue(guestScene);
      await drainLoopback();
      if (advanced) {
        stall = 0;
      } else if (++stall > MAX_STALL) {
        throw new Error(
          `guest launch chain HANG: stuck on ${cur.phaseName} after ${MAX_STALL} idle drains `
            + `(seen=[${phasesSeen.join(",")}]) - see dev-logs/coop-duo/`,
        );
      }
    } else {
      // A freshly-current phase: start it (its end() -> shiftPhase advances the queue; the inert
      // startCurrentPhase means the next phase is current-but-unstarted for the next iteration).
      phasesSeen.push(cur.phaseName);
      lastStarted = cur;
      stall = 0;
      cur.start();
      await drainLoopback();
    }
  }
  throw new Error(`guest launch chain never reached CommandPhase (seen=[${phasesSeen.join(",")}])`);
}

describe.skipIf(!RUN)("Showdown versus - guest REAL launch pipeline (regression proof)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-guest-real-boot-${Date.now()}`);
    // globalScene citizenship: capture BEFORE any guest-scene swap (buildShowdownDuo builds a 2nd scene).
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    // Restore the host scene so the NEXT ER_SCENARIO file's GameManager reuses a valid scene.
    initGlobalScene(prevScene);
  });

  /** Boot the HOST into a live showdown battle (C3 bootstrap) and reach the first CommandPhase. */
  async function startHostShowdown(opponent: ShowdownMonManifest[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      // own = a throwaway single mon (the host's actual team is the fielded PIKACHU below); opponent = guest team.
      beginShowdownBattle([magikarp()], opponent);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase", false);
    // Bake THUNDERBOLT into the host's own Pikachu DIRECTLY (rides the mirror into the guest's ENEMY
    // Pikachu; does not corrupt the guest's own manifest moveset). Not load-bearing for THIS test (no
    // turn is played) - kept parallel to showdown-duo so the fielded host team is a coherent battler.
    game.scene.getPlayerParty()[0].moveset = [
      new PokemonMove(MoveId.THUNDERBOLT),
      new PokemonMove(MoveId.TACKLE),
      new PokemonMove(MoveId.THUNDER_WAVE),
      new PokemonMove(MoveId.QUICK_ATTACK),
    ];
  }

  it("guest boots from the host launch snapshot and drives the REAL loaded encounter to CommandPhase", async () => {
    const opponent = [magikarp()];
    await startHostShowdown(opponent);

    const pair = createLoopbackPair();
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    // (2) HOST ctx: produce the launch snapshot EXACTLY as broadcastCoopLaunchSnapshot pushes it.
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    expect(hostJson.length, "the host produced a non-empty launch snapshot").toBeGreaterThan(0);

    // The authoritative leads: the host's own team lead (fielded PLAYER) is PIKACHU; the guest's own
    // team lead (the opponent manifest, fielded as the host's ENEMY) is MAGIKARP. After the F1
    // swapSessionData at the guest's launch boundary, the guest's LOCAL player lead is its own team
    // (MAGIKARP) and its LOCAL enemy lead is the host's team (PIKACHU).
    const hostOwnLead = rig.hostScene.getPlayerParty()[0].species.speciesId;
    expect(hostOwnLead, "host's own fielded lead is PIKACHU").toBe(SpeciesId.PIKACHU);

    // (3)+(4) GUEST ctx: the REAL boot path + the full launch-chain pump + the assertions (isOnField()
    // reads globalScene.field, so everything that inspects field membership runs under the guest ctx).
    const result = await withClient<GuestBootResult>(rig.guestCtx, async () => {
      const booted = await rig.guestScene.gameData.applyCoopLaunchSession(hostJson);
      expect(booted, "applyCoopLaunchSession returned true (the F1 swap fired under the live flip gate)").toBe(true);

      // The loaded session creates fresh battlers after buildShowdownDuo installed its ordinary headless
      // stubs. Preserve the production atlas wait while teaching this fixture what a completed Phaser atlas
      // load looks like; otherwise strict launch readiness correctly rejects the permanent substitute key.
      modelHeadlessPlayerAtlasCompletion(rig.guestScene);

      // Queue the LOADED EncounterPhase exactly as production's tryCoopGuestSnapshotBoot does
      // (select-starter-phase.ts: pushNew("EncounterPhase", true)). Clear the guest's stale queue
      // and make the loaded EncounterPhase the current phase (the ME-mirror driver uses the same
      // clear -> push -> shift dance to seat a fresh current phase on the manual guest pump).
      rig.guestScene.phaseManager.clearPhaseQueue();
      rig.guestScene.phaseManager.pushNew("EncounterPhase", true);
      rig.guestScene.phaseManager.shiftPhase();

      const reached = await pumpGuestLaunchChain(rig.guestScene);

      const playerLead = rig.guestScene.getPlayerField()[0];
      const enemyLead = rig.guestScene.getEnemyField()[0];
      const activeField = rig.guestScene.getField(true);
      // Every fielded mon must round-trip through its own battler index: getField()[bi] === mon.
      const fullField = rig.guestScene.getField();
      const roundTripHolds = activeField.every(mon => fullField[mon.getBattlerIndex()] === mon);

      return {
        reached,
        playerLeadSpecies: playerLead?.species?.speciesId ?? -1,
        playerLeadOnField: playerLead?.isOnField() ?? false,
        playerLeadFainted: playerLead?.isFainted() ?? false,
        enemyLeadSpecies: enemyLead?.species?.speciesId ?? -1,
        enemyLeadOnField: enemyLead?.isOnField() ?? false,
        activeFieldCount: activeField.length,
        roundTripHolds,
      } satisfies GuestBootResult;
    });

    // (4) ASSERTIONS.
    // The chain ran end-to-end and reached the interactive boundary.
    expect(result.reached, "the guest drove the full loaded-launch chain to CommandPhase").toBe("CommandPhase");
    // The guest's OWN lead (its local player side) is summoned + alive - THIS is the root-hole (bug 4)
    // assertion: without the encounter-phase versus-guest summon block, the player side stays empty.
    expect(result.playerLeadSpecies, "guest's local player lead is its own team lead (MAGIKARP)").toBe(
      SpeciesId.MAGIKARP,
    );
    expect(result.playerLeadFainted, "guest's local player lead is alive").toBe(false);
    expect(result.playerLeadOnField, "guest's local player lead is ON FIELD (bug 4 root: empty player side)").toBe(
      true,
    );
    // The enemy lead (the host's own team) is summoned + on field.
    expect(result.enemyLeadSpecies, "guest's local enemy lead is the host's team lead (PIKACHU)").toBe(
      SpeciesId.PIKACHU,
    );
    expect(result.enemyLeadOnField, "guest's local enemy lead is ON FIELD").toBe(true);
    // Exactly two active mons on the 1v1 field, and every fielded mon's getField()[bi] round-trip holds
    // (the invariant PostSummonPhasePriorityQueue.queueAbilityPhase's getField()[bi] relied on - bug 4).
    expect(result.activeFieldCount, "exactly two mons active on the 1v1 field").toBe(2);
    expect(result.roundTripHolds, "every fielded mon round-trips through getField()[getBattlerIndex()]").toBe(true);

    logs.flush();
  }, 300_000);
});
