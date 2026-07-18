/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle-message pacing self-deadlock - FULL defer -> converge lifecycle (fix branch
// coop/fix-battle-message-pacing). Companion to the focused node duo
// (test/node/coop-turn-resolve-precommit-park.test.ts); this one runs in the coop gate and
// drives the WHOLE inversion over two real CoopDurabilityManagers on a LoopbackTransport
// (the exact framing the two-engine coop-duo harness rides).
//
// THE LIVE BUG (run 29640634363): the co-op HOST self-deadlocks MID-TURN. It commits a
// PRE-COMMIT in-turn op (logicalPhase "TURN_RESOLVE" - the level-up learn-move flow AND the
// MoveEffectPhase faint/replacement flow both share this root) BEFORE the turn commit. The
// guest is parked in CoopReplayTurnPhase rendering that turn, so it DEFERS the operation
// envelope (its live sink/picker is not open) - it sends NO pre-commit materialApplied and
// opens NO public continuation surface. The host then blocks its turn on that (impossible)
// peer proof and never reaches TurnEndPhase, so it never publishes the very turn commit the
// guest is parked waiting for. This control-plane wait uses the durability manager's own
// scheduler (not relay.pendingSince, not a stall-probe machine-wait) - exactly the live
// diagnostic signature coop:health wait=-1ms machineWaits=-.
//
// THE FIX scopes the peer-convergence requirement OUT of the pre-commit in-turn window
// (logicalPhase === "TURN_RESOLVE"): the host advances on its own pacing and the op releases
// at materialApplied (the guest applying it via post-commit replay) instead of the
// unreachable public-surface continuationReady.
//
// This test walks the exact deadlock timeline: (1) guest parked -> DEFERS; the host's turn
// barrier must NOT hang; (2) the turn commits and the guest replays -> the op applies + sends
// materialApplied; the host releases the journal there (no continuationReady, no head-of-line
// block, no 180s terminal). It FAILS on the pre-fix code and PASSES after.
// =============================================================================

import { CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopAuthoritativeEnvelopeV1 } from "#data/elite-redux/coop/coop-operation-envelope";
import { setCoopOperationDurability } from "#data/elite-redux/coop/coop-operation-journal";
import type { CoopAuthoritativeBattleStateV1, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 60,
  wave: 3,
  turn: 2,
  playerParty: [],
  enemyParty: [],
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 0,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
};

/** A pre-commit in-turn LEARN_MOVE_BATCH op (logicalPhase "TURN_RESOLVE"), committed on the KO turn. */
function learnMoveEnvelope(revision = 1): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: 7,
    revision,
    wave: 3,
    turn: 2,
    logicalPhase: "TURN_RESOLVE",
    pendingOperation: {
      id: `7:1:LEARN_MOVE_BATCH:${revision}`,
      kind: "LEARN_MOVE_BATCH",
      owner: 1,
      status: "committed",
      payload: { label: "learn-move-batch", choice: 0, terminal: false },
    },
    authoritativeState: { ...STATE, tick: STATE.tick + revision - 1 },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

async function settledOrPending<T>(promise: Promise<T>): Promise<"resolved" | "pending"> {
  const sentinel = Symbol("pending");
  const raced = await Promise.race([promise.then(() => "resolved" as const), flush().then(() => sentinel)]);
  return raced === sentinel ? "pending" : "resolved";
}

afterEach(() => setCoopOperationDurability(null));

describe("co-op level-up-on-win in-turn op: host reaches its turn commit + both engines converge (no strand)", () => {
  it("parked guest DEFERS the op -> host is NOT deadlocked -> post-commit replay converges at materialApplied", async () => {
    const pair = createLoopbackPair();
    const guestAcks: Extract<CoopMessage, { t: "coopAck" }>[] = [];
    pair.host.onMessage(message => {
      if (message.t === "coopAck") {
        guestAcks.push(message);
      }
    });

    // The guest starts PARKED in CoopReplayTurnPhase: its learn-move sink is not open yet, so its applier
    // DEFERS the op (the live-deadlock condition). Once the turn commit is processed it opens the picker and
    // applies - modelled by flipping the applier and retrying the deferred entry.
    let guestParked = true;
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => (guestParked ? "deferred" : "applied"),
    });
    setCoopOperationDurability(guest);
    try {
      const committed = learnMoveEnvelope();
      const opId = committed.pendingOperation?.id ?? "";
      expect(host.commit("op:global", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      await flush();

      // (1) THE DEADLOCK CONDITION: the parked guest deferred the op, so no peer material proof exists.
      expect(guest.appliedMarks()["op:global"] ?? 0, "the parked guest deferred the in-turn op").toBe(0);
      expect(host.unackedCount(), "the host still retains the in-turn op").toBe(1);

      // The host must NOT block its turn on that impossible pre-commit proof (pre-fix: hangs forever, so the
      // host never reaches TurnEndPhase / CoopTurnCommitPhase and the guest loops requestTurnCommit).
      expect(
        await settledOrPending(host.waitForOperationMaterialApplied(opId)),
        "the host reaches its turn commit on its own pacing (not deadlocked on the parked guest)",
      ).toBe("resolved");

      // (2) The turn commit is now published; the guest processes it, opens the picker, and APPLIES the op
      // via post-commit replay - its real convergence path (materialApplied, no public continuation surface).
      guestParked = false;
      guest.retryDeferred("op:global");
      await flush();

      expect(guest.appliedMarks()).toEqual({ "op:global": 1 });
      expect(
        guestAcks.map(ack => ack.stage),
        "the guest converged with materialApplied alone",
      ).toEqual(["materialApplied"]);
      // Both engines converged and the retained authority RELEASED at materialApplied - no strand, no
      // head-of-line block, no 180s continuation terminal (pre-fix this stays 1).
      expect(host.unackedCount(), "the in-turn op released at materialApplied - clean convergence, no strand").toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });
});
