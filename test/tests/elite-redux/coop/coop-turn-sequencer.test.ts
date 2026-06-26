/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Focused UNIT test of the guest presentation SEQUENCER (#633, near-real-time replay).
//
// Pure logic only - NO GameManager / ER_SCENARIO boot. We mock #app/global-scene (so the
// sequencer's globalScene.time.delayedCall / ui.showText calls are intercepted) and
// #phases/coop-replay-cosmetics (so each playCoop*Cosmetic records its call + lets the test
// drive its onDone manually, isolating the SCHEDULING logic from the real anims). This lets us
// assert the four load-bearing sequencer guarantees deterministically:
//   (1) CONTIGUOUS-ASCENDING ONE-AT-A-TIME: events play in seq order, exactly one in flight at a
//       time; the next only starts after the prior's onDone fires.
//   (2) OUT-OF-ORDER BUFFERING: an event offered ahead of the cursor parks in `pending` and is
//       NOT played until the gap is filled, then plays in ascending order.
//   (3) EXACTLY-ONCE via renderedSeqs: a seq played by the sequencer is added to renderedSeqs
//       BEFORE play; re-offering it (or a stale seq behind the cursor) is dropped.
//
// (The "mon.hp byte-identical after a live hp cosmetic" guarantee, I2, is exercised against the
// REAL playCoopHpDrainCosmetic in coop-replay-hp-cosmetic.test.ts - kept separate so its real
// cosmetic import is not clobbered by the mock here.)
//
// NOTE: the LIVE-PLAY animation TIMING (real ~1s text dwell, real bar-drain duration, watchable
// pacing) is only confirmable in live play - these mocks intentionally collapse the scene clock so
// the SCHEDULING/ORDERING is testable. See the comment block at the bottom.
// =============================================================================

import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
// NB: the SUT (coop-turn-sequencer) is imported DYNAMICALLY in beforeEach after vi.resetModules() -
// see the loadSut() note below. A static import binds the SUT to the already-cached (unmocked)
// #app/global-scene under the suite's `isolate: false`, which strands globalScene as undefined inside
// the SUT. resetModules() + a fresh dynamic import rebinds it to the mock in this file.
import type * as SequencerModule from "#data/elite-redux/coop/coop-turn-sequencer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CoopTurnSequencer = SequencerModule.CoopTurnSequencer;

// --- Captured scheduling side effects (asserted by the tests) -----------------------------------
// NB: vi.mock factories are HOISTED above the module top-level, so any state a factory closes over
// MUST be created via vi.hoisted (also hoisted) - a plain top-level `const` is in the TDZ when the
// factory runs and reads as undefined. This was the bug that made globalScene.time undefined.

/** A single recorded cosmetic invocation; `done()` advances the sequencer past it. */
interface CosmeticCall {
  kind: "move" | "hp" | "stat" | "status" | "faint";
  args: unknown[];
  done: () => void;
}

const h = vi.hoisted(() => ({
  /** Every text line the sequencer drove directly via ui.showText, with its onComplete callback. */
  textCalls: [] as { text: string; onComplete: () => void }[],
  /** Pending scene-clock timers the sequencer armed (delayedCall). */
  timers: [] as { fn: () => void; delay: number }[],
  /** Every cosmetic the sequencer invoked, newest last; `done` is its onDone callback. */
  cosmeticCalls: [] as CosmeticCall[],
}));
const { textCalls, cosmeticCalls } = h;

// --- Mock the scene clock + UI so nothing real renders and the test owns all timing -------------
vi.mock("#app/global-scene", () => ({
  globalScene: {
    time: {
      delayedCall: (delay: number, fn: () => void) => {
        h.timers.push({ fn, delay });
        return { fn, delay, remove: () => {} };
      },
    },
    ui: {
      // Mirror the real ui.showText(text, delay, callback, callbackDelay, prompt) shape; the
      // sequencer passes a callback that, in the real path, fires when the type-on completes.
      showText: (text: string, _delay: unknown, callback: () => void) => {
        h.textCalls.push({ text, onComplete: callback });
      },
    },
  },
}));

// --- Mock the cosmetic primitives so each records its call + exposes its onDone to the test ------
vi.mock("#phases/coop-replay-cosmetics", () => {
  const record =
    (kind: CosmeticCall["kind"]) =>
    (...args: unknown[]) => {
      // The LAST arg is always the onDone callback (sequencer contract).
      const onDone = args[args.length - 1] as () => void;
      h.cosmeticCalls.push({ kind, args: args.slice(0, -1), done: onDone });
    };
  return {
    playCoopMoveAnimCosmetic: record("move"),
    playCoopHpDrainCosmetic: record("hp"),
    playCoopStatTweenCosmetic: record("stat"),
    playCoopStatusCosmetic: record("status"),
    playCoopFaintCosmetic: record("faint"),
  };
});

// --- Mock coop-debug so isCoopDebug()/coopLog don't depend on env -------------------------------
vi.mock("#data/elite-redux/coop/coop-debug", () => ({
  isCoopDebug: () => false,
  coopLog: () => {},
  coopWarn: () => {},
}));

// --- Dynamically-loaded SUT (rebound to the mocks above per test) -------------------------------
let registerCoopTurnSequencer: typeof SequencerModule.registerCoopTurnSequencer;
let getCoopTurnSequencer: typeof SequencerModule.getCoopTurnSequencer;
let clearCoopTurnSequencer: typeof SequencerModule.clearCoopTurnSequencer;

beforeEach(async () => {
  // Reset the module graph so the fresh dynamic import below binds the MOCKED #app/global-scene /
  // #phases/coop-replay-cosmetics (the suite runs isolate:false, so a static SUT import would keep
  // the pre-cached unmocked globalScene). This is the documented vi pattern for shared-registry runs.
  vi.resetModules();
  const mod = await import("#data/elite-redux/coop/coop-turn-sequencer");
  registerCoopTurnSequencer = mod.registerCoopTurnSequencer;
  getCoopTurnSequencer = mod.getCoopTurnSequencer;
  clearCoopTurnSequencer = mod.clearCoopTurnSequencer;
});

// --- Helpers ------------------------------------------------------------------------------------

const msg = (text: string): CoopBattleEvent => ({ k: "message", text });
const move = (bi: number, moveId: number, targets: number[] = [bi]): CoopBattleEvent => ({
  k: "moveUsed",
  bi,
  moveId,
  targets,
});
const hp = (bi: number, h: number, maxHp = 100): CoopBattleEvent => ({ k: "hp", bi, hp: h, maxHp });
const faint = (bi: number): CoopBattleEvent => ({ k: "faint", bi });

/** Drive the single in-flight cosmetic to completion (its onDone), which re-pumps the sequencer. */
function completeNextCosmetic(): void {
  const inFlight = cosmeticCalls[cosmeticCalls.length - 1];
  expect(inFlight, "expected a cosmetic in flight to complete").toBeDefined();
  inFlight.done();
}

/** Complete a text line: fire the showText onComplete, then fire the sequencer-owned dwell timer. */
function completeNextText(): void {
  const t = textCalls[textCalls.length - 1];
  expect(t, "expected a text line in flight to complete").toBeDefined();
  t.onComplete(); // -> onTextTyped arms a dwell delayedCall
  // The sequencer owns the post-type dwell via a delayedCall; fire the most-recent timer (the dwell).
  const dwell = h.timers.pop();
  expect(dwell, "expected a sequencer-owned text dwell timer").toBeDefined();
  dwell?.fn();
}

afterEach(() => {
  textCalls.length = 0;
  cosmeticCalls.length = 0;
  h.timers.length = 0;
  clearCoopTurnSequencer(0);
  clearCoopTurnSequencer(1);
});

describe("co-op guest turn SEQUENCER (#633) - contiguous one-at-a-time / buffering / exactly-once", () => {
  it("(1) plays a contiguous ascending burst ONE AT A TIME: the next event waits for the prior's onDone", () => {
    const seq = registerCoopTurnSequencer(1, [{ hp: 100 }, null]);
    // seq0 message, seq1 moveUsed, seq2 hp, seq3 faint, seq4 message - the canonical damaging-move stream.
    seq.offer(0, msg("Pikachu used Thunderbolt!"));
    seq.offer(1, move(0, 85));
    seq.offer(2, hp(1, 0));
    seq.offer(3, faint(1));
    seq.offer(4, msg("Foe fainted!"));
    seq.kick();

    // ONE-AT-A-TIME: only seq0 (the first message) has started; nothing else has been issued yet.
    expect(textCalls.map(t => t.text)).toEqual(["Pikachu used Thunderbolt!"]);
    expect(cosmeticCalls.length).toBe(0);

    // Advancing seq0 (text type-on + dwell) starts seq1 (the move anim) - and ONLY seq1.
    completeNextText();
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move"]);
    expect(textCalls.length).toBe(1); // no new text yet

    // seq1 move done -> seq2 hp (and only hp).
    completeNextCosmetic();
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp"]);

    // seq2 hp done -> seq3 faint.
    completeNextCosmetic();
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp", "faint"]);

    // seq3 faint done -> seq4 message ("Foe fainted!").
    completeNextCosmetic();
    expect(textCalls.map(t => t.text)).toEqual(["Pikachu used Thunderbolt!", "Foe fainted!"]);

    // ASCENDING ORDER verified: cosmetics fired in exactly seq order, never overlapping.
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp", "faint"]);
    // EXACTLY-ONCE: every seq 0..4 is in renderedSeqs, recorded once.
    expect([...seq.renderedSeqs].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("(1b) NEVER runs two cosmetics concurrently: a second offer while one is in flight just buffers", () => {
    const seq = registerCoopTurnSequencer(1, [{ hp: 100 }, { hp: 100 }]);
    seq.offer(0, move(0, 85));
    seq.kick();
    // seq0 in flight.
    expect(cosmeticCalls.length).toBe(1);
    // Offer seq1 WHILE seq0 is still playing: it must NOT start (serializer).
    seq.offer(1, hp(1, 50));
    expect(cosmeticCalls.length).toBe(1); // still only seq0 in flight
    // Complete seq0 -> seq1 now starts.
    completeNextCosmetic();
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp"]);
  });

  it("(2) OUT-OF-ORDER BUFFERING: a seq ahead of the cursor parks until the gap fills, then plays ascending", () => {
    const seq = registerCoopTurnSequencer(1, [{ hp: 100 }, { hp: 100 }]);
    // Offer seq2 and seq1 FIRST (out of order), seq0 missing.
    seq.offer(2, faint(1));
    seq.offer(1, hp(1, 0));
    seq.kick();
    // Cursor is at seq0 which has NOT arrived -> NOTHING plays (the gap parks the cursor).
    expect(cosmeticCalls.length).toBe(0);
    expect(textCalls.length).toBe(0);

    // Now seq0 arrives -> seq0 plays.
    seq.offer(0, move(0, 85));
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move"]);
    // Drain the contiguous chain: seq0 -> seq1 (hp) -> seq2 (faint), ascending, one at a time.
    completeNextCosmetic();
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp"]);
    completeNextCosmetic();
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp", "faint"]);
    // The buffered events played in ASCENDING seq order despite out-of-order arrival.
    expect([...seq.renderedSeqs].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("(3) EXACTLY-ONCE via renderedSeqs: a seq is added BEFORE play; a re-offer or stale seq is dropped", () => {
    const seq = registerCoopTurnSequencer(1, [{ hp: 100 }, { hp: 100 }]);
    seq.offer(0, move(0, 85));
    seq.kick();
    // seq0 marked rendered the instant it begins playing (before onDone).
    expect(seq.renderedSeqs.has(0)).toBe(true);
    expect(cosmeticCalls.length).toBe(1);

    // Re-offer seq0 (a late duplicate of an already-played seq): DROPPED, no new cosmetic.
    seq.offer(0, move(0, 85));
    expect(cosmeticCalls.length).toBe(1);

    completeNextCosmetic(); // seq0 done, cursor now at seq1
    // Offer a STALE seq behind the cursor (seq0 again): still dropped.
    seq.offer(0, hp(0, 10));
    expect(cosmeticCalls.length).toBe(1);

    // A duplicate offer of a seq currently BUFFERED (pending) is also dropped: offer seq2 twice while
    // seq1 is still missing (the cursor is parked at seq1).
    seq.offer(2, faint(1));
    seq.offer(2, faint(1)); // duplicate of a pending seq
    // seq1 has not arrived, so still nothing new plays; only the original seq0 cosmetic exists.
    expect(cosmeticCalls.length).toBe(1);
    // Fill seq1 -> seq1 then seq2 drain, each exactly once.
    seq.offer(1, hp(1, 0));
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp"]);
    completeNextCosmetic();
    expect(cosmeticCalls.map(c => c.kind)).toEqual(["move", "hp", "faint"]);
    // renderedSeqs holds each seq exactly once (Set semantics + add-before-play): 0,1,2.
    expect([...seq.renderedSeqs].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("registry: register/get/clear scope the active sequencer to its turn", () => {
    const s1: CoopTurnSequencer = registerCoopTurnSequencer(1, [{ hp: 100 }]);
    expect(getCoopTurnSequencer(1)).toBe(s1);
    expect(getCoopTurnSequencer(2)).toBeNull(); // a different turn -> no active sequencer
    clearCoopTurnSequencer(1);
    expect(getCoopTurnSequencer(1)).toBeNull();
  });
});

// =============================================================================
// LIVE-PLAY TIMING IS NOT ASSERTED HERE (and cannot be in a headless unit test).
// The mocks collapse globalScene.time.delayedCall and ui.showText so SCHEDULING is deterministic.
// The real watchable pacing - the ~20ms/char text type-on, the ~1000ms post-type dwell
// (COOP_SEQ_TEXT_DWELL_MS), the bar-drain animation duration, the 500ms faint drop, the 6s
// per-cosmetic watchdog, and the 30s overall turn deadline - all run on the real Phaser scene clock
// and are only confirmable in live play.
// =============================================================================
