/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #859 - phantom ME turn dissolve (maintainer live desync, seed Z9KNAjYeD6OTSNTWRfSgV3mg).
//
// On a NON-battle ME (Delibird gift class) the watcher's embedded-shop LEAVE falls
// through into the ME wave's leftover battle chain (TurnInit -> Command -> TurnStart ->
// CoopReplayTurnPhase) BEFORE the ME terminal fires. That replay phase parks awaiting a
// battle the host never fights; the detached terminal's leaveEncounterWithoutBattle
// clears only the QUEUE, never the RUNNING phase - so pre-fix the guest slept the full
// 20-min turn timeout at wave 13 while the host played wave 14 alone (wait=170s+ in the
// logs, host cmd:14:1 rendezvous timing out).
//
// FAILS-BEFORE: without the abort seam there is NO wake path - the parked pump's only
// exits are a host resolution (never comes) or the 1_200_000ms stall timeout; the phase
// never ends, so `shiftPhase` is never called (the exact live park). PASSES-AFTER: the
// detached terminal calls abortActiveCoopReplayTurnPhase(), which flags the phase and
// resolves its parked turn wait null; the pump checks the flag BEFORE the stall branch
// and ends WITHOUT finalize / turn-advance / CommandPhase re-queue, letting the rebuilt
// queue (the real next wave) run.
//
// Engine-free (no GameManager): a real CoopBattleStreamer over the real loopback
// transport + a minimal scene stub. globalScene CITIZENSHIP: the stub is restored in
// afterEach per the suite rule.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import * as coopRuntime from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { abortActiveCoopReplayTurnPhase, CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("coop #859 - phantom ME turn dissolve", () => {
  let prevGlobalScene: BattleScene | undefined;
  let shiftPhase: ReturnType<typeof vi.fn>;
  let unshiftNew: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    shiftPhase = vi.fn();
    unshiftNew = vi.fn();
    initGlobalScene({
      currentBattle: { waveIndex: 13 },
      phaseManager: { shiftPhase, unshiftNew },
    } as unknown as BattleScene);
  });

  afterEach(() => {
    if (prevGlobalScene != null) {
      initGlobalScene(prevGlobalScene);
    }
    vi.restoreAllMocks();
  });

  it("abortTurnWait wakes a PARKED turn wait with a null resolution (the pump wake path)", async () => {
    const { guest } = createLoopbackPair();
    const streamer = new CoopBattleStreamer(guest);
    const race = streamer.awaitTurnOrLiveEvent(1, 0); // nothing buffered -> parks
    expect(streamer.abortTurnWait(1)).toBe(true);
    const raced = await race;
    expect(raced).toEqual({ kind: "turn", res: null });
  });

  it("abortTurnWait is a safe no-op when nothing is parked", () => {
    const { guest } = createLoopbackPair();
    const streamer = new CoopBattleStreamer(guest);
    expect(streamer.abortTurnWait(1)).toBe(false);
  });

  it("abortActiveCoopReplayTurnPhase is false with no running replay phase", () => {
    expect(abortActiveCoopReplayTurnPhase("no active phase (test)")).toBe(false);
  });

  it("a PARKED CoopReplayTurnPhase dissolves on abort: ends with NO finalize/turn-advance (#859)", async () => {
    const { guest } = createLoopbackPair();
    const streamer = new CoopBattleStreamer(guest);
    vi.spyOn(coopRuntime, "getCoopBattleStreamer").mockReturnValue(streamer);

    const phase = new CoopReplayTurnPhase(1, 0);
    phase.start(); // async pump parks on awaitTurnOrLiveEvent (no host battle exists)
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(shiftPhase).not.toHaveBeenCalled(); // parked - the pre-fix live state

    // The detached non-battle ME terminal fires (coop-replay-me-phase leaveDefensive):
    expect(abortActiveCoopReplayTurnPhase("detached non-battle ME terminal (test #859)")).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(shiftPhase).toHaveBeenCalledTimes(1); // the phase ENDED (queue proceeds to the next wave)
    expect(unshiftNew).not.toHaveBeenCalled(); // no CoopFinalizeTurnPhase, no CommandPhase re-queue
    // The registry cleared - a later abort is a no-op (no stale instance leaks to the next wave).
    expect(abortActiveCoopReplayTurnPhase("post-end (test)")).toBe(false);
  });
});
