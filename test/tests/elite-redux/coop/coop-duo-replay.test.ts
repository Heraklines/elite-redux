/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP SESSION RECORD -> REPLAY pipeline (#record-replay, Phase 1). Proves the trace SCHEMA +
// the harness loader end-to-end by building a SYNTHETIC ReplayTrace BY HAND (a small 2-wave run:
// a roster + a couple FIGHT commands per wave + a reward pick) and replaying it across BOTH real
// engines via replayCoopTrace. This is the deterministic record->replay loop a reported co-op bug
// will run through (Phase 2 wires production CAPTURE; this phase proves replay works first).
//
// The trace TYPE is GENERAL (single-player reuse is a thin add): a mode-agnostic header (seed +
// gameModeId + difficulty + challenges + roster as PokemonData[]) + an ordered event list (command |
// interaction) + an optional `coop` layer (the CoopRunConfig). The interaction OWNER is DERIVED from
// counter parity, so it is not stored.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-replay.test.ts --reporter=dot
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
//
// ASSERTS: the trace validates; the loader reproduces the run deterministically across both engines
// (every wave's guest enemies converge to the host-KO'd state, interaction counters stay lockstep, the
// reward was applied, resyncs bounded, NO divergences); and a no-progress stall would THROW (hang guard).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, maybeBeginReplayRecording, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { clearReplayRecording, getReplayTrace, isReplayRecording } from "#data/elite-redux/replay-recorder";
import {
  isReplayCommandEvent,
  isReplayInteractionEvent,
  makeReplayTrace,
  REPLAY_TRACE_VERSION,
  type ReplayEvent,
  type ReplayTrace,
  validateReplayTrace,
} from "#data/elite-redux/replay-trace";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  pumpDuoDestinations,
  type ReplayGameManager,
  reachInterceptedRewardShop,
  reachQueuedRewardShop,
  remirrorWave,
  replayCoopTrace,
  withClient,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/**
 * The trace CAPTURED by the production taps in the "records" test, replayed by the "reproduces" test
 * (the two halves of the KILLER round-trip; split across two tests so each uses its OWN clean
 * GameManager - one test can't safely construct two). Module-scoped so the second test reads the first's
 * capture; the tests run in declaration order within the describe.
 */
let capturedTrace: ReplayTrace | null = null;

/**
 * Build a minimal roster entry as serialized {@linkcode PokemonData} for the synthetic trace. The
 * loader reads `species` (to reach the run) + `coopOwner` (the merge tag); a full PokemonData rebuild +
 * launch handshake is a Phase-2 concern, so for the synthetic trace a species + level + owner suffice.
 */
function rosterMon(species: SpeciesId, level: number, coopOwner: "host" | "guest"): PokemonData {
  const data = new PokemonData({
    id: species,
    species,
    formIndex: 0,
    abilityIndex: 0,
    level,
    shiny: false,
    variant: 0,
  });
  data.coopOwner = coopOwner;
  data.moveset = [new PokemonMove(MoveId.TACKLE), new PokemonMove(MoveId.SPLASH)];
  return data;
}

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** A fully scheduled replay transport that is automatic only outside retained reward boundaries. */
function scheduledReplayTransport(): {
  pairFactory: () => ReturnType<typeof createScheduledCoopPair>;
  beforeRewardBoundary: () => void;
  afterRewardBoundary: () => void;
} {
  const pair = createScheduledCoopPair({ automatic: true });
  return {
    pairFactory: () => pair,
    beforeRewardBoundary: () => pair.setAutomaticDelivery(false),
    afterRewardBoundary: () => pair.setAutomaticDelivery(true),
  };
}

describe.skipIf(!RUN)(
  "co-op DUO replay: record->replay pipeline reproduces a run from a captured trace (#record-replay)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // #788 v2 partner-sync gate: tiny wait so the harness's manually-driven shop flows
      // (spoof / out-of-order duo drives never broadcast in time) proceed fast via the
      // gate's own timeout fallback instead of sitting through the 60s live default.
      setCoopWaveBarrierMs(50);
      game = new GameManager(phaserGame);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(1)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .moveset([MoveId.TACKLE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopWaveBarrierMs(60_000);
      clearCoopRuntime();
      // #710 harness-citizenship: replayCoopTrace -> buildDuo -> buildGuestScene constructs a 2nd
      // BattleScene whose ctor steals globalScene. Restore the host scene so the NEXT ER_SCENARIO file's
      // GameManager reuses a valid host scene, not the stripped-down guest one.
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    it("validates a synthetic trace + REJECTS a malformed one (the schema's validate/normalize helper)", () => {
      const trace = makeReplayTrace({
        seed: "replay-seed",
        gameModeId: GameModes.COOP,
        roster: [rosterMon(SpeciesId.SNORLAX, 50, "host"), rosterMon(SpeciesId.GENGAR, 50, "guest")],
        events: [
          { type: "command", wave: 1, turn: 0, slotFieldIndex: 0, command: { kind: "move", moveIndex: 0, target: 2 } },
          { type: "interaction", seq: 0, kind: "skip", choice: -1 },
        ],
        coopRunConfig: { difficulty: "youngster", challenges: [], seed: "replay-seed", netcodeMode: "authoritative" },
      });
      expect(trace.version).toBe(REPLAY_TRACE_VERSION);
      expect(trace.coop?.runConfig.netcodeMode).toBe("authoritative");
      // The general header was derived from the runConfig (so they can't disagree).
      expect(trace.difficulty).toBe("youngster");
      expect(validateReplayTrace(trace).ok, "a well-formed trace validates").toBe(true);

      // A malformed trace is rejected with precise reasons (no roster + bad event + unknown version).
      const bad: ReplayTrace = {
        version: 999,
        seed: "",
        gameModeId: GameModes.COOP,
        difficulty: "youngster",
        challenges: [],
        roster: [],
        events: [
          { type: "command", wave: 1, turn: 0, slotFieldIndex: 0, command: { kind: "move", moveIndex: Number.NaN } },
        ],
      };
      const result = validateReplayTrace(bad);
      expect(result.ok, "a malformed trace is rejected").toBe(false);
      expect(result.errors.length, "with precise per-problem reasons").toBeGreaterThanOrEqual(3);
    });

    it("replays a synthetic 2-wave trace across BOTH engines: converges, lockstep counters, reward applied, no hang", async () => {
      // ===== Build a SYNTHETIC trace BY HAND: a 2-wave run. Each wave both slots TACKLE the frail
      // Magikarps (a guaranteed host win), and wave 1's reward shop takes the forced LURE (a non-party
      // reward the owner driver can grant). DEPARTMENT_STORE_SALE-style ME is covered by the ME test; this
      // proves the wave-loop + reward-shop replay class. =====
      const events: ReplayEvent[] = [
        // Wave 1: host slot TACKLE enemy, guest slot TACKLE enemy_2.
        { type: "command", wave: 1, turn: 0, slotFieldIndex: 0, command: { kind: "move", moveIndex: 0, target: 2 } },
        { type: "command", wave: 1, turn: 0, slotFieldIndex: 1, command: { kind: "move", moveIndex: 0, target: 3 } },
        // Wave 1's reward shop (interaction counter 0 = host owns): take the forced LURE reward.
        { type: "interaction", seq: 0, kind: "reward", choice: 0 },
        // Wave 2: both slots TACKLE again.
        { type: "command", wave: 2, turn: 0, slotFieldIndex: 0, command: { kind: "move", moveIndex: 0, target: 2 } },
        { type: "command", wave: 2, turn: 0, slotFieldIndex: 1, command: { kind: "move", moveIndex: 0, target: 3 } },
        // Wave 2's reward shop (counter 1 = guest owns): leave (skip).
        { type: "interaction", seq: 1, kind: "skip", choice: -1 },
      ];
      const trace = makeReplayTrace({
        seed: "replay-seed",
        gameModeId: GameModes.COOP,
        roster: [rosterMon(SpeciesId.SNORLAX, 50, "host"), rosterMon(SpeciesId.GENGAR, 50, "guest")],
        events,
        coopRunConfig: { difficulty: "youngster", challenges: [], seed: "replay-seed", netcodeMode: "authoritative" },
      });

      // FORCE the deterministic non-party LURE reward into the shop so wave 1's reward pick can be granted
      // (the loader's reward driver takes a non-party item; a party-target reward needs the owner PARTY UI).
      game.override.itemRewards([{ name: "LURE" }]);

      // Count the guest's full-state resyncs (a converged run is bounded, never a per-iter storm).
      const resyncSpy = vi.spyOn(CoopBattleStreamer.prototype, "requestStateSync");

      const result = await replayCoopTrace(game as unknown as ReplayGameManager, trace, {
        ...scheduledReplayTransport(),
        resyncCount: () => resyncSpy.mock.calls.length,
      });

      // ===== The run REPRODUCED deterministically across both engines. =====
      expect(result.wavesReplayed, "both waves replayed to completion").toBe(2);
      expect(result.commandsFed, "all 4 wave commands were fed").toBe(4);
      expect(result.interactionsApplied, "both wave interactions (reward + skip) were applied").toBe(2);
      expect(result.divergences, `no divergences (clean reproduction): ${JSON.stringify(result.divergences)}`).toEqual(
        [],
      );
      // Interaction counters stayed LOCKSTEP and advanced once per wave (2 interactions => counter 2).
      expect(result.finalHostCounter, "host counter reached 2 (one advance per wave)").toBe(2);
      expect(result.finalGuestCounter, "guest counter lockstep with host (2)").toBe(2);
      // The forced LURE reward was granted on wave 1 (the owner took it + the watcher mirrored it).
      expect(
        game.scene.modifiers.some(m => m.type.id === "LURE"),
        "wave 1's reward (LURE) was applied on the host",
      ).toBe(true);
      // NO resync storm: a converged run requests at most a handful of resyncs (<= 1 per wave).
      expect(result.resyncCount, `resyncs bounded (got ${result.resyncCount} over 2 waves)`).toBeLessThanOrEqual(2);
    }, 300_000);

    it("boots a replay from the window checkpoint party instead of the original launch roster", async () => {
      const checkpointParty = [rosterMon(SpeciesId.SNORLAX, 61, "host"), rosterMon(SpeciesId.GENGAR, 62, "guest")];
      checkpointParty[0].moveset = [new PokemonMove(MoveId.THUNDER_PUNCH)];
      checkpointParty[1].moveset = [new PokemonMove(MoveId.SHADOW_BALL)];
      const trace = makeReplayTrace({
        seed: "original-launch-seed",
        gameModeId: GameModes.COOP,
        roster: [rosterMon(SpeciesId.PIKACHU, 5, "host"), rosterMon(SpeciesId.ABRA, 5, "guest")],
        events: [],
        coopRunConfig: {
          difficulty: "youngster",
          challenges: [],
          seed: "original-launch-seed",
          netcodeMode: "authoritative",
        },
      });
      trace.checkpoint = {
        wave: 7,
        seed: "checkpoint-window-seed",
        party: checkpointParty,
        modifiers: [],
        money: 4_321,
        pokeballCounts: { "0": 7 },
      };

      const result = await replayCoopTrace(game as unknown as ReplayGameManager, trace);

      expect(result.divergences).toEqual([]);
      expect(
        game.scene
          .getPlayerParty()
          .slice(0, 2)
          .map(p => [p.species.speciesId, p.level]),
        "the replay must begin from the caught/leveled checkpoint party, not the stale header roster",
      ).toEqual([
        [SpeciesId.SNORLAX, 61],
        [SpeciesId.GENGAR, 62],
      ]);
      expect(
        game.scene
          .getPlayerParty()
          .slice(0, 2)
          .map(p => p.getMoveset()[0]?.moveId),
      ).toEqual([MoveId.THUNDER_PUNCH, MoveId.SHADOW_BALL]);
      expect(game.scene.currentBattle.waveIndex).toBe(7);
      expect(game.scene.seed).toBe("checkpoint-window-seed");
      expect(game.scene.money).toBe(4_321);
      expect(game.scene.pokeballCounts[0]).toBe(7);
    }, 300_000);

    // =========================================================================================
    // THE KILLER TEST (closes the record->replay loop), split across TWO tests sharing `capturedTrace`
    // so each uses its OWN clean GameManager (one test can't safely construct two - the prompt-handler
    // run interval + shared module state):
    //   #1 RECORDS a REAL short co-op run through the harness with the PRODUCTION recorder ENABLED (the
    //      real command + interaction taps fire), then getReplayTrace() reads the CAPTURED trace.
    //   #2 feeds THAT captured trace back through replayCoopTrace + asserts it REPRODUCES the run (both
    //      engines converge, counters lockstep, same reward, no hang).
    // Together they prove CAPTURE -> REPLAY round-trips end-to-end - the load-bearing proof of the feature.
    // =========================================================================================
    const RECORD_WAVES = 2;

    it("KILLER #1: a real co-op run is RECORDED by the production command + interaction taps", async () => {
      // FORCE a deterministic non-party LURE reward so the host owner can take wave 1's reward.
      game.override.itemRewards([{ name: "LURE" }]);

      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createScheduledCoopPair({ automatic: true });
      const rig: DuoRig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      // The guest answers its own slot's command over the real CoopBattleSync relay (TACKLE enemy_2).
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.TACKLE,
        targets: [BattlerIndex.ENEMY_2],
      }));

      // Establish the host's CoopRunConfig (production does this at run-start via broadcastRunConfig; the
      // harness's assembleCoopRuntime doesn't, so set it here so the recorder captures the coop layer).
      await withClient(rig.hostCtx, () => {
        rig.hostRuntime.controller.broadcastRunConfig({
          difficulty: "youngster",
          challenges: [],
          seed: rig.hostScene.seed,
          netcodeMode: "authoritative",
        });
      });

      // BEGIN recording on the host - exactly what maybeBeginReplayRecording does at the first co-op
      // EncounterPhase in production (the harness flips to co-op AFTER startBattle, so we call the SAME
      // production function here to begin from wave 1; the EncounterPhase wiring is verified separately).
      // #record-replay single-player: the classic `startBattle` above ran a solo EncounterPhase, so the
      // SINGLE-PLAYER enable already began a (solo) recording. That is a TEST artifact of the harness's
      // classic-launch shortcut (production co-op is co-op at its first EncounterPhase, so the solo enable
      // never fires there). Clear it so the co-op begin below records a fresh CO-OP trace, not the solo one.
      clearReplayRecording();
      await withClient(rig.hostCtx, () => {
        maybeBeginReplayRecording();
      });
      expect(isReplayRecording(), "the recorder began on the co-op host").toBe(true);

      for (let w = 1; w <= RECORD_WAVES; w++) {
        if (w > 1) {
          await remirrorWave(rig);
        }
        const turn = rig.hostScene.currentBattle.turn;
        // Host plays this wave: BOTH slots TACKLE the frail Magikarps (a guaranteed win). The production
        // command taps (own-slot broadcast + partner-slot resolve) fire here, recording both commands.
        await withClient(rig.hostCtx, async () => {
          game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
          game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
          await game.phaseInterceptor.to("CoopTurnCommitPhase");
        });
        await withClient(rig.guestCtx, async () => {
          await driveGuestReplayTurn(rig.guestScene, turn);
        });
        // Battle/boot traffic stays automatic. From this exact retained boundary onward, every envelope
        // is delivered only while its destination ClientCtx is installed.
        pair.setAutomaticDelivery(false);
        // The reward shop: at counter 0 the host owns (take the LURE); the production interaction taps
        // (sendInteractionChoice / inbound handle) fire here, recording the reward + leave picks.
        const counterBefore = rig.hostRuntime.controller.interactionCounter();
        const hostOwns = counterBefore % 2 === 0;
        const hostShop = await withClient(rig.hostCtx, () => reachInterceptedRewardShop(game, rig.hostScene));
        const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
        const takeReward = w === 1 && hostOwns;
        if (hostOwns) {
          await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward }));
          await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
        } else {
          await withClient(rig.guestCtx, () => driveHostRewardShopOwner(guestShop, { takeReward: false }));
          await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop));
        }
        await pumpDuoDestinations(rig);
        if (w < RECORD_WAVES) {
          pair.setAutomaticDelivery(true);
          await arriveGuestCommandBoundary(rig, w + 1);
          await withClient(rig.hostCtx, async () => {
            await game.phaseInterceptor.to("CommandPhase");
          });
        }
      }

      // ===== CAPTURE the recorded trace (stash for KILLER #2). =====
      const captured = getReplayTrace();
      expect(captured, "a trace was captured during the real run").not.toBeNull();
      capturedTrace = captured;
      const trace = captured!;
      expect(validateReplayTrace(trace).ok, "the captured trace validates").toBe(true);
      expect(trace.seed.length, "the captured trace pinned the run seed").toBeGreaterThan(0);
      expect(trace.coop?.runConfig, "the captured trace has the co-op runConfig layer").toBeDefined();
      expect(trace.roster.length, "the captured trace serialized the merged roster").toBeGreaterThanOrEqual(2);
      // The production COMMAND taps captured both slots' moves for both waves (4 commands).
      const commands = trace.events.filter(isReplayCommandEvent);
      expect(commands.length, "the production command taps recorded both slots x both waves").toBe(RECORD_WAVES * 2);
      expect(
        commands.every(c => c.command.kind === "move"),
        "every recorded command is a FIGHT move",
      ).toBe(true);
      // The production INTERACTION taps captured the reward + leave picks (>= one interaction per wave).
      const interactions = trace.events.filter(isReplayInteractionEvent);
      expect(interactions.length, "the production interaction taps recorded a pick per wave").toBeGreaterThanOrEqual(
        RECORD_WAVES,
      );

      clearCoopRuntime();
      initGlobalScene(game.scene);
      expect(isReplayRecording(), "the recorder cleared at run teardown").toBe(false);
    }, 300_000);

    it("KILLER #2: the CAPTURED trace REPLAYS and reproduces the recorded run (capture->replay round-trip)", async () => {
      expect(capturedTrace, "KILLER #1 captured a trace to replay").not.toBeNull();
      const trace = capturedTrace!;

      // FORCE the same deterministic LURE reward so the recorded reward pick reproduces.
      game.override.itemRewards([{ name: "LURE" }]);

      const result = await replayCoopTrace(game as unknown as ReplayGameManager, trace, scheduledReplayTransport());
      // The CAPTURED run reproduced: both waves replayed, both slots' commands fed, lockstep counters.
      expect(result.wavesReplayed, "the captured run's waves replayed").toBe(RECORD_WAVES);
      expect(result.commandsFed, "the captured commands were fed").toBe(RECORD_WAVES * 2);
      expect(
        result.divergences,
        `the captured trace reproduced with NO divergence: ${JSON.stringify(result.divergences)}`,
      ).toEqual([]);
      expect(result.finalHostCounter, "host counter lockstep after replay").toBe(result.finalGuestCounter);
      // The recorded reward reproduced: the LURE was granted on the replayed host too.
      expect(
        game.scene.modifiers.some(m => m.type.id === "LURE"),
        "the recorded LURE reward reproduced on replay",
      ).toBe(true);
    }, 300_000);
  },
);
