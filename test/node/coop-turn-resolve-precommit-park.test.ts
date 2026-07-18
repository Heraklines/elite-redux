/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle-message pacing self-deadlock (fix branch coop/fix-battle-message-pacing).
//
// THE LIVE BUG (run 29640634363): the co-op HOST self-deadlocks MID-TURN on a
// coop-synchronized in-turn operation. The host commits a PRE-COMMIT in-turn op
// (`logicalPhase === "TURN_RESOLVE"` - FAINT_SWITCH / REVIVAL / CATCH_FULL /
// LEARN_MOVE(_BATCH)) BEFORE the turn commit (CoopTurnCommitPhase, queued last in
// TurnEndPhase). The guest is parked in CoopReplayTurnPhase rendering that same turn,
// so it DEFERS the operation envelope (its live sink/picker is not open ->
// applyCoopOperationEnvelope returns "deferred") and can never send a pre-commit
// `materialApplied`, and it opens NO public continuation surface for the op, so
// `continuationReady` is unreachable. The host then:
//   (a) BLOCKS its turn on the peer's material proof (switch-phase.ts
//       waitForOperationMaterialApplied) - so it never reaches TurnEndPhase and never
//       publishes the very turn commit the guest is parked waiting for (the deadlock:
//       guest loops requestTurnCommit -> host replies turnCommitPending forever); and
//   (b) would EXHAUST the operation continuation deadline into a shared terminal at 180s.
// This wait uses the durability manager's OWN scheduler (not relay.pendingSince, not a
// stall-probe machine-wait), which is exactly why the live diagnostic showed
// coop:health wait=-1ms machineWaits=-.
//
// THE FIX (coop-durability.ts, scoped strictly to logicalPhase === "TURN_RESOLVE"):
//   - waitForOperationMaterialApplied resolves immediately (the host advances on its
//     own pacing; the guest converges on the turn-commit checkpoint); and
//   - the op RELEASES at `materialApplied` (the guest applying it via post-commit
//     replay) instead of the unreachable public-surface `continuationReady`, so it
//     never head-of-line-blocks the journal or exhausts into a terminal.
// Every between-wave surface (REWARD_SELECT / WAVE_VICTORY / etc.) is unchanged - it
// still requires the full continuationReady public-surface proof.
//
// This is a NODE-ONLY (engine-free) duo of two real CoopDurabilityManagers over a
// LoopbackTransport - the SAME framing the two-engine coop-duo harness rides. It
// FAILS on the pre-fix code (waitForOperationMaterialApplied never resolves for the
// parked guest; the op stays retained past materialApplied) and PASSES after.
// =============================================================================

import { CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopAuthoritativeEnvelopeV1, CoopLogicalPhase } from "#data/elite-redux/coop/coop-operation-envelope";
import { setCoopOperationDurability } from "#data/elite-redux/coop/coop-operation-journal";
import type { CoopAuthoritativeBattleStateV1, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 41,
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

function envelope(
  logicalPhase: CoopLogicalPhase,
  kind: "FAINT_SWITCH" | "REWARD",
  revision = 1,
): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: 7,
    revision,
    wave: 3,
    turn: 2,
    logicalPhase,
    pendingOperation: {
      id: `7:1:${kind}:${revision}`,
      kind,
      owner: 1,
      status: "committed",
      payload: { label: kind, choice: 0, terminal: false },
    },
    authoritativeState: { ...STATE, tick: STATE.tick + revision - 1 },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

/** Resolve to "resolved" if the promise settles within a microtask flush, else "pending". */
async function settledOrPending<T>(promise: Promise<T>): Promise<"resolved" | "pending"> {
  const sentinel = Symbol("pending");
  const raced = await Promise.race([promise.then(() => "resolved" as const), flush().then(() => sentinel)]);
  return raced === sentinel ? "pending" : "resolved";
}

afterEach(() => setCoopOperationDurability(null));

describe("co-op pre-commit in-turn operation does not deadlock the host turn (coop/fix-battle-message-pacing)", () => {
  it("a parked guest that DEFERS a TURN_RESOLVE op cannot block the host's material barrier", async () => {
    const pair = createLoopbackPair();
    // The guest is parked in CoopReplayTurnPhase: its live sink is not open, so it DEFERS the
    // in-turn operation envelope (never sends materialApplied) - the exact live-deadlock condition.
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => "deferred",
    });
    setCoopOperationDurability(guest);
    try {
      const turnResolve = envelope("TURN_RESOLVE", "FAINT_SWITCH");
      expect(host.commit("op:global", turnResolve.revision, { t: "envelope", envelope: turnResolve })).toBe(true);
      await flush();
      // The parked guest deferred it: NO material proof exists, and the host still retains the op.
      expect(guest.appliedMarks()["op:global"] ?? 0, "the parked guest deferred the in-turn op").toBe(0);
      expect(host.unackedCount(), "the host still retains the in-turn op").toBe(1);

      // THE FIX: the host must NOT block its turn on the (structurally impossible) pre-commit material
      // proof. Pre-fix this promise never resolves (the host never reaches TurnEndPhase -> never publishes
      // the turn commit the guest is parked waiting for -> hard self-deadlock).
      const opId = turnResolve.pendingOperation?.id ?? "";
      expect(
        await settledOrPending(host.waitForOperationMaterialApplied(opId)),
        "the host advances on its own pacing pre-commit (does NOT deadlock on the parked guest)",
      ).toBe("resolved");
      expect(await host.waitForOperationMaterialApplied(opId), "the barrier resolves affirmatively").toBe(true);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("a TURN_RESOLVE op RELEASES at materialApplied (no unreachable continuationReady, no terminal)", async () => {
    const pair = createLoopbackPair();
    const guestAcks: Extract<CoopMessage, { t: "coopAck" }>[] = [];
    pair.host.onMessage(message => {
      if (message.t === "coopAck") {
        guestAcks.push(message);
      }
    });
    // Now the guest processes the turn commit and applies the op via post-commit replay (its real
    // convergence path), sending exactly `materialApplied` - it opens NO public continuation surface.
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    setCoopOperationDurability(guest);
    try {
      const turnResolve = envelope("TURN_RESOLVE", "FAINT_SWITCH");
      expect(host.commit("op:global", turnResolve.revision, { t: "envelope", envelope: turnResolve })).toBe(true);
      await flush();

      expect(guest.appliedMarks()).toEqual({ "op:global": 1 });
      // THE FIX: an in-turn op's convergence proof is `materialApplied` (the guest applied it via replay);
      // it must release the host journal there instead of waiting for the unreachable `continuationReady`
      // (which would head-of-line-block the journal and exhaust into a shared terminal). Pre-fix this is 1.
      expect(host.unackedCount(), "the in-turn op released at materialApplied - retention is clean").toBe(0);
      expect(
        guestAcks.map(ack => ack.stage),
        "the guest converged with materialApplied alone (it opens no public continuation surface)",
      ).toEqual(["materialApplied"]);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("REGRESSION GUARD: a between-wave (REWARD_SELECT) op is UNCHANGED - it still blocks + needs continuationReady", async () => {
    const pair = createLoopbackPair();
    const guestAcks: Extract<CoopMessage, { t: "coopAck" }>[] = [];
    pair.host.onMessage(message => {
      if (message.t === "coopAck") {
        guestAcks.push(message);
      }
    });
    const host = new CoopDurabilityManager(pair.host);
    // A between-wave op whose owner is still constructing/opening its surface DEFERS, exactly like the
    // TURN_RESOLVE case - but a reward/shop/ME op DOES reach a real public continuation surface, so the
    // exemption must NOT leak to it: its material barrier stays parked and it still needs continuationReady.
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => "deferred",
    });
    setCoopOperationDurability(guest);
    try {
      const reward = envelope("REWARD_SELECT", "REWARD");
      expect(host.commit("op:global", reward.revision, { t: "envelope", envelope: reward })).toBe(true);
      await flush();
      expect(host.unackedCount(), "the between-wave op is retained").toBe(1);

      const opId = reward.pendingOperation?.id ?? "";
      // A between-wave op's material barrier is NOT auto-satisfied: it genuinely awaits the peer's proof
      // (the exemption is strictly scoped to the pre-commit in-turn TURN_RESOLVE window).
      expect(
        await settledOrPending(host.waitForOperationMaterialApplied(opId)),
        "a between-wave op still waits for the real peer material proof",
      ).toBe("pending");
    } finally {
      host.dispose();
      guest.dispose();
    }
  });
});
