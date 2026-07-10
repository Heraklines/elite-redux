/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Unit tests for the replay recorder's window-start CHECKPOINT (#record-replay checkpoint).
//
// PURE (no engine / GameManager boot): the recorder is engine-free (a caller builds each checkpoint from
// globalScene; the recorder only stores + prunes them to the ring-buffer window). So these tests hand the
// recorder synthetic checkpoints + command events and assert:
//   - a checkpoint captured on every wave boundary rides along with the event ring;
//   - it is PRUNED to the same window as the events (it never grows unbounded);
//   - the emitted trace's `checkpoint` is the one at the WINDOW-START wave (the oldest retained event's
//     wave) - so a loader boots from the run's state that PRECEDES every retained event;
//   - re-capturing a wave already checkpointed is IDEMPOTENT (the true window-start snapshot is kept);
//   - a recording with NO checkpoints emits no `checkpoint` (backward compatible with the header roster).
// =============================================================================

import {
  beginReplayRecording,
  clearReplayRecording,
  getReplayTrace,
  REPLAY_RECORDER_WAVE_WINDOW,
  recordReplayCheckpoint,
  recordReplayCommand,
} from "#data/elite-redux/replay-recorder";
import type { ReplayCheckpoint } from "#data/elite-redux/replay-trace";
import { GameModes } from "#enums/game-modes";
import { afterEach, describe, expect, it } from "vitest";

/** A synthetic checkpoint for `wave` (the recorder never inspects the contents, only the wave key). */
function fakeCheckpoint(wave: number): ReplayCheckpoint {
  return { wave, seed: `seed-${wave}`, party: [], modifiers: [], money: wave * 100, pokeballCounts: {} };
}

/** Begin a recording whose live-wave provider tracks the last checkpointed wave (mode-agnostic header). */
function beginRecording(): void {
  const cur = 0;
  beginReplayRecording({
    seed: "s",
    gameModeId: GameModes.CLASSIC,
    roster: [],
    currentWave: () => cur,
  });
  // The interaction tap reads currentWave(); commands carry their own wave, so a fixed 0 is fine here.
  void cur;
}

/** Record a checkpoint for `wave` then one command on that wave (mirrors an EncounterPhase boundary). */
function advanceWave(wave: number): void {
  recordReplayCheckpoint(fakeCheckpoint(wave));
  recordReplayCommand({ type: "command", wave, turn: 0, slotFieldIndex: 0, command: { kind: "run" } });
}

describe("replay recorder: window-start checkpoint (#record-replay checkpoint)", () => {
  afterEach(() => {
    clearReplayRecording();
  });

  it("keeps the checkpoint at wave 1 while the whole run fits the window", () => {
    beginRecording();
    for (let w = 1; w <= REPLAY_RECORDER_WAVE_WINDOW; w++) {
      advanceWave(w);
    }
    const trace = getReplayTrace();
    expect(trace).not.toBeNull();
    expect(trace?.checkpoint?.wave, "window not yet slid -> checkpoint stays at the first wave").toBe(1);
    expect(trace?.checkpoint?.seed).toBe("seed-1");
    expect(trace?.events.length, "all waves' events are still on the ring").toBe(REPLAY_RECORDER_WAVE_WINDOW);
  });

  it("slides the checkpoint to the window START as the ring buffer slides", () => {
    beginRecording();
    const lastWave = REPLAY_RECORDER_WAVE_WINDOW + 5; // run 5 waves past the window so it must slide
    for (let w = 1; w <= lastWave; w++) {
      advanceWave(w);
    }
    const expectedWindowStart = lastWave - REPLAY_RECORDER_WAVE_WINDOW + 1;
    const trace = getReplayTrace();
    expect(trace?.checkpoint?.wave, "checkpoint tracks the oldest retained wave (the window start)").toBe(
      expectedWindowStart,
    );
    expect(trace?.checkpoint?.seed, "and it is the checkpoint captured AT that window-start wave").toBe(
      `seed-${expectedWindowStart}`,
    );
    // The event ring is bounded to the window, and every retained event is >= the checkpoint's wave.
    expect(trace?.events.length).toBe(REPLAY_RECORDER_WAVE_WINDOW);
    const minEventWave = Math.min(...(trace?.events ?? []).map(e => (e.type === "command" ? e.wave : Number.NaN)));
    expect(
      minEventWave,
      "the checkpoint boots the run at or before the earliest retained event",
    ).toBeGreaterThanOrEqual(trace?.checkpoint?.wave ?? 0);
  });

  it("is idempotent: re-capturing a wave already checkpointed keeps the first snapshot", () => {
    beginRecording();
    recordReplayCheckpoint(fakeCheckpoint(1));
    // A second capture for the SAME wave (e.g. a re-entered EncounterPhase) must NOT overwrite it.
    recordReplayCheckpoint({ ...fakeCheckpoint(1), seed: "OVERWRITTEN" });
    recordReplayCommand({ type: "command", wave: 1, turn: 0, slotFieldIndex: 0, command: { kind: "run" } });
    const trace = getReplayTrace();
    expect(trace?.checkpoint?.seed, "the first (true window-start) snapshot is retained").toBe("seed-1");
  });

  it("emits no checkpoint when a recording captured none (backward compatible with the header roster)", () => {
    beginRecording();
    // Commands only, no checkpoint tap (a recording begun mid-flow, past the wave boundary).
    recordReplayCommand({ type: "command", wave: 1, turn: 0, slotFieldIndex: 0, command: { kind: "run" } });
    const trace = getReplayTrace();
    expect(trace).not.toBeNull();
    expect(
      trace?.checkpoint,
      "no checkpoint captured -> trace has none; a loader falls back to the roster",
    ).toBeUndefined();
  });
});
