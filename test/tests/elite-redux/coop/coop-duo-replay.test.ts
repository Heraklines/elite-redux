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

import { initGlobalScene } from "#app/global-scene";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import {
  makeReplayTrace,
  REPLAY_TRACE_VERSION,
  type ReplayEvent,
  type ReplayTrace,
  validateReplayTrace,
} from "#data/elite-redux/replay-trace";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { type ReplayGameManager, replayCoopTrace } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

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
  return data;
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
  },
);
