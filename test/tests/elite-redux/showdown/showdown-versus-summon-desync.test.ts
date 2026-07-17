/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 VERSUS - TURN-1 INITIAL-SUMMON ability desync (the live "on my side i got
// [an effect] and took a bit of dmg and the other didnt have that on turn 1" report).
//
// THE BUG (staging 2026-07-08, build mrbo8q1a). The versus GUEST is a pure renderer, but the
// launch snapshot the host broadcasts is taken PRE-SUMMON, so the guest boots it and runs its
// OWN EncounterPhase -> SummonPhase -> PostSummonPhase -> PostSummonActivateAbilityPhase chain,
// DERIVING every lead's on-entry ability effect locally (the guest log shows `Ran PSP for: <mon>`).
// That derivation is NOT identical to the host's, because ER gates innates by SIDE: an ENEMY
// always has its innates active, a PLAYER's are candy-gated (pokemon.ts hasPassive()). In versus
// the host's OWN team is the guest's LOCAL ENEMY (the F1 flip), so a team mon's entry INNATE is
// gated OFF on the host (its own player) yet fires on the guest (its local enemy) - the guest
// DERIVES an effect the host never had, and the two engines' turn-1 state DIVERGES (a per-turn
// checksum mismatch forces a resync, the desync signal).
//
// THE REPRO (deterministic, no RNG). The host's OWN lead carries DROUGHT in an INNATE slot (an
// on-entry weather setter - the faithful stand-in for the reporters' Mega-Gengar-X / Mega-Stahlos
// entry innates, injected via the per-mon slot override so it rides the snapshot into the guest).
// On the HOST that mon is the local PLAYER, so its innate is candy-gated OFF and NO weather is set.
// The guest boots the pre-summon snapshot and runs its OWN summon: the SAME mon is its local ENEMY,
// enemies always have their innates active, so the guest DERIVES sun the host never had. Result:
// host weather NONE, guest weather SUN - the exact "on my side i got an effect the other didnt".
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/showdown/showdown-versus-summon-desync.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { Weather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownDuo,
  type CoopResyncProbe,
  drainLoopback,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  type ShowdownDuoRig,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair, type ScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The host's own team lead. Carries a DROUGHT INNATE (injected below) - an on-entry weather setter. */
const HOST_LEAD = SpeciesId.MAGIKARP;
/** The guest's own team lead: a plain MAGIKARP (no on-entry effect - keeps the divergence isolated). */
const GUEST_LEAD = SpeciesId.MAGIKARP;
/** The innate slot (1..3 = ER innate slots; 0 = active ability) we plant the entry effect in. */
const INNATE_SLOT = 1;

const manifest = (speciesId: SpeciesId, moveset: MoveId[]): ShowdownMonManifest => ({
  speciesId,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset,
  item: "LEFTOVERS",
  rootSpeciesId: speciesId,
  erBlackShiny: false,
  baseCost: 4,
});

/** The guest's team as an opponent manifest (the host fields it as the ENEMY party). */
const guestTeam = (): ShowdownMonManifest[] => [
  manifest(GUEST_LEAD, [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE]),
];

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

/**
 * Run host phase machinery while delivering each scheduled inbox under its owning client context. This is
 * the one-process equivalent of two browser event loops: an EnemyCommandPhase may await the guest without
 * either client's transport handlers ever observing the other client's process-global scene/runtime.
 */
async function driveScheduledHost<T>(rig: ShowdownDuoRig, pair: ScheduledCoopPair, work: () => Promise<T>): Promise<T> {
  const pending = withClient(rig.hostCtx, work);
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const deadline = Date.now() + 30_000;
  while (!settled) {
    withClientSync(rig.guestCtx, () => pair.flush("guest"));
    withClientSync(rig.hostCtx, () => pair.flush("host"));
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (Date.now() >= deadline) {
      throw new Error("scheduled Showdown host drive timed out while pumping both client inboxes");
    }
  }
  return await pending;
}

/** Serialize the host's launch session EXACTLY as EncounterPhase.broadcastCoopLaunchSnapshot does. */
function serializeHostLaunchSnapshot(hostScene: BattleScene): string {
  return JSON.stringify(hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

/** Advance the guest UI if it is parked on a message PROMPT (the loaded encounter's trainer dialogue). */
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
 * Complete only the visual cache effects missing from Phaser HEADLESS after the real atlas load runs.
 * Strict launch readiness must still await each production `Pokemon.loadAssets` promise and verify the
 * final dynamic sprite key; this fixture models the cache/texture/animation effects that Chromium creates.
 */
function modelHeadlessPlayerAtlasCompletion(scene: BattleScene): { expected: number; completed: () => number } {
  const releasedKeys = new Set<string>();
  let completed = 0;
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
      completed++;
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
  return { expected: capacity, completed: () => completed };
}

/** PUMP the guest's REAL loaded-launch chain to CommandPhase (the same pump the real-boot proof uses). */
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
      const advanced = advanceGuestDialogue(guestScene);
      await drainLoopback();
      if (advanced) {
        stall = 0;
      } else if (++stall > MAX_STALL) {
        throw new Error(
          `guest launch chain HANG: stuck on ${cur.phaseName} after ${MAX_STALL} idle drains (seen=[${phasesSeen.join(",")}])`,
        );
      }
    } else {
      phasesSeen.push(cur.phaseName);
      lastStarted = cur;
      stall = 0;
      cur.start();
      await drainLoopback();
    }
  }
  throw new Error(`guest launch chain never reached CommandPhase (seen=[${phasesSeen.join(",")}])`);
}

describe.skipIf(!RUN)("Showdown versus - turn-1 initial-summon ability desync (the guest-derives-locally bug)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let resyncProbe: CoopResyncProbe | undefined;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-versus-summon-desync-${Date.now()}`);
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    resyncProbe?.restore();
    resyncProbe = undefined;
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    initGlobalScene(prevScene);
  });

  /** Boot the HOST into a live showdown battle (C3 bootstrap) and reach the first CommandPhase. */
  async function startHostShowdown(opponent: ShowdownMonManifest[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      const own = [manifest(HOST_LEAD, [MoveId.TACKLE, MoveId.SPLASH, MoveId.FLAIL, MoveId.BOUNCE])];
      beginShowdownBattle(own, opponent);
      const starters = generateStarters(game.scene, [HOST_LEAD]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      // Production Showdown builds the player's party from its manifest. Thread that manifest through
      // here too: the legacy starter-only fixture can now reach CommandPhase with no player party after
      // the strict Showdown manifest path was introduced, making this test crash before exercising the
      // authoritative summon/weather behavior it exists to prove.
      new SelectStarterPhase().initBattle(starters, true, undefined, own);
    });
    // Stop before CommandPhase starts. Production Showdown already has its authoritative runtime
    // installed at this boundary; starting the command phase first now correctly terminates an
    // orphaned shared session. The caller assembles both runtimes, then opens this exact command UI.
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  it("guest renders the host's turn-1 entry ability, does not DERIVE it locally (weather parity)", async () => {
    await startHostShowdown(guestTeam());

    const pair = createScheduledCoopPair({ automatic: true });
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase"));
    pair.setAutomaticDelivery(false);

    // Plant a DROUGHT INNATE on the host's OWN lead (its local PLAYER). The slot override rides the
    // snapshot into the guest, where the SAME mon is the local ENEMY. On the host (player) the innate is
    // candy-gated OFF -> NO weather; on the guest (enemy) it is always active. A faithful stand-in for a
    // real mon's entry innate (Mega-Gengar-X / Mega-Stahlos in the field report).
    const hostLead = rig.hostScene.getPlayerField()[0];
    hostLead.setAbilityOverrideForSlot(INNATE_SLOT, AbilityId.DROUGHT);

    // The HOST's own lead is its local PLAYER, so its innate DROUGHT is candy-gated OFF: NO weather.
    const hostWeather = rig.hostScene.arena.weather?.weatherType ?? WeatherType.NONE;
    expect(hostWeather, "host: its own PLAYER lead's innate Drought is candy-gated OFF (no weather)").toBe(
      WeatherType.NONE,
    );

    // Produce the launch snapshot EXACTLY as broadcastCoopLaunchSnapshot pushes it (PRE-summon).
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));

    // GUEST: the REAL boot path - applyCoopLaunchSession (F1 swap), then drive the loaded EncounterPhase
    // through its OWN summon + post-summon chain to CommandPhase (the guest DERIVES its leads' abilities).
    const guestResult = await withClient(rig.guestCtx, async () => {
      const booted = await rig.guestScene.gameData.applyCoopLaunchSession(hostJson);
      expect(booted, "applyCoopLaunchSession returned true").toBe(true);
      const atlas = modelHeadlessPlayerAtlasCompletion(rig.guestScene);
      rig.guestScene.phaseManager.clearPhaseQueue();
      rig.guestScene.phaseManager.pushNew("EncounterPhase", true);
      rig.guestScene.phaseManager.shiftPhase();
      const reached = await pumpGuestLaunchChain(rig.guestScene);
      expect(
        atlas.completed(),
        "strict readiness awaited every real production player-atlas load",
      ).toBeGreaterThanOrEqual(atlas.expected);
      return { reached, weather: rig.guestScene.arena.weather?.weatherType ?? WeatherType.NONE };
    });

    expect(guestResult.reached, "the guest drove the loaded launch chain to CommandPhase").toBe("CommandPhase");

    // THE DIVERGENCE ASSERTION (red pre-fix). The host (authoritative) has NO weather. The guest must
    // render the SAME authoritative world, NOT derive its own: pre-fix its REAL EncounterPhase runs the
    // host's lead (its local ENEMY) post-summon and the innate Drought (enemy = always active) DERIVES sun
    // the host never had. The guest's weather MUST equal the host's.
    expect(
      guestResult.weather,
      "guest arena weather MATCHES the host's authoritative NONE (renders, does NOT derive turn-1 abilities)",
    ).toBe(hostWeather);

    logs.flush();
  }, 300_000);

  it("host-authoritative weather the guest lacked at boot CONVERGES via the turn checkpoint, ZERO forced resyncs", async () => {
    // The reverse direction + no-resync proof. A host-authoritative effect the guest does NOT hold locally
    // (here: SUN, standing in for any host-side on-entry weather/effect the gated guest never derived) must
    // converge onto the guest through the NORMAL per-turn authoritative checkpoint - NOT a forced resync.
    // CoopFinalizeTurnPhase applies applyCoopAuthoritativeBattleState (which carries weather/terrain/stat-
    // stages) BEFORE it verifies the checksum, so the guest adopts the host's world and the checksums MATCH.
    // A forced resync (requestStateSync) here would be the laggy "paper over it" behavior we must avoid.
    await startHostShowdown(guestTeam());

    const pair = createScheduledCoopPair({ automatic: true });
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase"));
    pair.setAutomaticDelivery(false);

    // The guest commands its own team with a harmless SPLASH each turn (the host's EnemyCommandPhase await).
    rig.guestPeer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));
    resyncProbe = installCoopResyncProbe(rig.guestRuntime);

    // Inject a host-authoritative SUN the guest scene does NOT have (the mirror cloned a NO-weather field).
    // This models the production reverse case: the pre-summon launch snapshot never carried the host's
    // on-entry weather, so the gated guest boots without it and must ADOPT it from the streamed checkpoint.
    rig.hostScene.arena.weather = new Weather(WeatherType.SUNNY, 5);
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.arena.weather = null;
    });

    const turn = rig.hostScene.currentBattle.turn;

    // HOST plays a turn (TACKLE into the guest's lead, no KO); its EnemyCommandPhase consumes the relayed SPLASH.
    await driveScheduledHost(rig, pair, async () => {
      game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // GUEST replays the host's turn: the authoritative checkpoint conveys the host's SUN.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    const guestWeather = withClientSync(
      rig.guestCtx,
      () => rig.guestScene.arena.weather?.weatherType ?? WeatherType.NONE,
    );
    expect(guestWeather, "guest ADOPTED the host's authoritative SUN via the per-turn checkpoint").toBe(
      WeatherType.SUNNY,
    );
    expect(resyncProbe.count(), "the guest converged with ZERO forced resyncs (checkpoint adopt, not a resync)").toBe(
      0,
    );

    logs.flush();
  }, 300_000);
});
