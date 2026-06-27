/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op authoritative GUEST CAPTURE PRESENTATION (#689). In authoritative co-op the HOST runs
// `AttemptCapturePhase` (ball throw + shake + capture stars + "X was caught!"); the GUEST is a
// pure renderer that never runs it, so its catch was silent. The host now carries a tiny cosmetic
// `CoopCapturePresentation` on `waveResolved("capture")`; the guest plays the ball animation + a
// LOCALLY-localized "caught!" line via the hardened `CoopCaptureReplayPhase`. This verifies:
//   (a) the same-wave merge carries the presentation across a capture->win supersession (a double
//       battle resolves ONE wave with both) + drops a stale earlier-wave signal;
//   (b) the wire variant round-trips with AND without the presentation (an older host -> undefined);
//   (c) `CoopCaptureReplayPhase` reaches end() for a VALID and a MALFORMED payload, never throws
//       (driving the mock clock past the 5s watchdog) - the no-hang guarantee.
// (a)+(b) are pure and run unconditionally; (c) needs a live scene, so it is gated ER_SCENARIO=1.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { clearCoopRuntime, mergeCoopPendingWaveAdvance, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type { CoopCapturePresentation, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { CoopCaptureReplayPhase } from "#phases/coop-replay-phases";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PRES: CoopCapturePresentation = {
  pokeballType: PokeballType.POKEBALL,
  targetBattlerIndex: BattlerIndex.ENEMY,
  speciesId: SpeciesId.PIKACHU,
};
const PARTY = ['{"species":143}', '{"species":25}'];

// (a) the same-wave merge preserves capturePresentation EXACTLY like captureParty (#689) - so a "win"
// arriving after the "capture" in a double battle does not drop the ball animation - and drops a stale
// earlier-wave signal.
describe("co-op capture presentation merge (#689)", () => {
  it("a later same-wave 'win' (no presentation) does NOT clobber an earlier 'capture' presentation", () => {
    const afterCapture = mergeCoopPendingWaveAdvance(null, 2, "capture", PARTY, PRES);
    expect(afterCapture).toEqual({ wave: 2, outcome: "capture", captureParty: PARTY, capturePresentation: PRES });
    const afterWin = mergeCoopPendingWaveAdvance(afterCapture, 2, "win", undefined, undefined);
    // The presentation (and the party) are carried onto the superseding "win".
    expect(afterWin).toEqual({ wave: 2, outcome: "win", captureParty: PARTY, capturePresentation: PRES });
  });

  it("a later same-wave 'capture' supplies the presentation when 'win' arrived first", () => {
    const afterWin = mergeCoopPendingWaveAdvance(null, 2, "win", undefined, undefined);
    expect(afterWin?.capturePresentation).toBeUndefined();
    const afterCapture = mergeCoopPendingWaveAdvance(afterWin, 2, "capture", PARTY, PRES);
    expect(afterCapture).toEqual({ wave: 2, outcome: "capture", captureParty: PARTY, capturePresentation: PRES });
  });

  it("a NEW wave's signal does NOT inherit the previous wave's presentation", () => {
    const wave2 = mergeCoopPendingWaveAdvance(null, 2, "capture", PARTY, PRES);
    const wave3 = mergeCoopPendingWaveAdvance(wave2, 3, "win", undefined, undefined);
    expect(wave3).toEqual({ wave: 3, outcome: "win", captureParty: undefined, capturePresentation: undefined });
  });

  it("a STALE earlier-wave capture signal keeps the existing later-wave pending (returns null)", () => {
    const wave3 = mergeCoopPendingWaveAdvance(null, 3, "win", undefined, undefined);
    expect(mergeCoopPendingWaveAdvance(wave3, 2, "capture", PARTY, PRES)).toBeNull();
  });
});

// (b) the wire variant round-trips with AND without the presentation. An older host omits it -> the
// guest sees `undefined` and no-ops (no ball animation), today's silent behavior.
describe("co-op capture presentation wire round-trip (#689)", () => {
  it("a 'capture' waveResolved with a presentation survives a JSON round-trip byte-identical", () => {
    const msg: CoopMessage = {
      t: "waveResolved",
      wave: 7,
      outcome: "capture",
      captureParty: PARTY,
      capturePresentation: PRES,
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });

  it("an OLDER host omits capturePresentation (undefined survives the round-trip, guest no-ops)", () => {
    const msg: CoopMessage = { t: "waveResolved", wave: 3, outcome: "capture", captureParty: PARTY };
    const round = JSON.parse(JSON.stringify(msg)) as Extract<CoopMessage, { t: "waveResolved" }>;
    expect(round.outcome).toBe("capture");
    expect(round.capturePresentation).toBeUndefined();
  });
});

const RUN = process.env.ER_SCENARIO === "1";

// (c) the hardened phase always reaches end(), for a VALID and a MALFORMED payload, never throwing -
// the no-hang guarantee. Needs a live scene (globalScene.time / add / ui), so ER_SCENARIO=1 only.
describe.skipIf(!RUN)("co-op CoopCaptureReplayPhase is hardened to always end() (#689)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  /**
   * Start the phase and resolve once end() fires; the MockClock ticks the 5s watchdog (overridden to
   * ~1ms in tests) so even a payload that never reaches its message callback still terminates. We poll
   * a real timer so the headless clock advances past the watchdog. Rejects only if start() THREW.
   */
  const driveToEnd = (pres: CoopCapturePresentation): Promise<boolean> =>
    new Promise((resolve, reject) => {
      const phase = new CoopCaptureReplayPhase(pres);
      let ended = false;
      // Spy on end(): the phase's idempotent finish() funnels to this exactly once.
      const realEnd = phase.end.bind(phase);
      phase.end = () => {
        ended = true;
        realEnd();
      };
      try {
        phase.start();
      } catch (e) {
        reject(e as Error);
        return;
      }
      // Poll past the watchdog window. Each tick is a real macrotask so the MockClock fires timers.
      let polls = 0;
      const tick = () => {
        if (ended) {
          resolve(true);
          return;
        }
        if (polls++ > 200) {
          resolve(false); // never ended -> the watchdog regressed (the test fails on this)
          return;
        }
        setTimeout(tick, 10);
      };
      setTimeout(tick, 10);
    });

  it("a VALID presentation plays the ball animation and reaches end()", async () => {
    await expect(driveToEnd(PRES), "a valid capture presentation never throws").resolves.toBe(true);
  });

  it("a MALFORMED presentation (unknown ball + species, off-field anchor) still reaches end()", async () => {
    const bad: CoopCapturePresentation = {
      pokeballType: 9999,
      targetBattlerIndex: 99, // out-of-range -> fieldMon() returns null -> default anchor
      speciesId: -1, // unknown species
    };
    await expect(driveToEnd(bad), "a malformed capture presentation never throws").resolves.toBe(true);
    // The live field is untouched (PRESENTATION ONLY): the player's lead is still on-field.
    expect(globalScene.getPlayerField()[0].isOnField()).toBe(true);
  });
});
