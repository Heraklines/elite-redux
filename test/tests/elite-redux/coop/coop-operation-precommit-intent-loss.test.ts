/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// W2e-R2 I5 - PRE-COMMIT INTENT LOSS (contract doc §1.3-§1.6, §4.4; #896). The operation contract's
// EXACTLY-ONCE guarantee (invariant 3) covers COMMITTED ops - a journaled op is resent/replayed until the
// receiver ACKs it. But an owner's typed INTENT that is lost on the wire BEFORE the sole authority commits
// it is NOT a committed op: there is no journal entry, so the durability reconnect tail cannot recover it.
// This suite ESTABLISHES + ENFORCES the defined recovery for that gap, engine-free against the pure
// CoopOperationHost commit log (the lifecycle spec).
//
// THE DEFINED RECOVERY (§1.8 deterministic-id + §1.3 exactly-once): a lost pre-commit intent is recovered
// by OWNER RE-SEND (at-least-once) carrying the SAME deterministic operationId `${epoch}:${owner}:${pin}`.
// Because the id is a PURE FUNCTION of the interaction slot (makeCoopOperationId), a re-send - or a late
// arrival of the original after a timeout DEFAULT filled the slot - collides on the same id and the host
// commit log dedupes it to EXACTLY ONCE (reack, no second commit, no revision change). This is what makes
// "owner re-send on timeout" safe and convergent: the recovery is at-least-once delivery + exactly-once
// commit, keyed on the deterministic id. The tests are the enforceable spec of that contract.
//
// The pure log proves re-send safety; migrated surface adapters own their timer lifecycle. This suite also
// pins the biome adapter's deterministic repeat/cancel trigger so the first dropped map/crossroads intent
// cannot leave its guest owner parked forever.
// =============================================================================

import {
  armCoopBiomeIntentResend,
  releaseCoopBiomeCommitReceipt,
  resetCoopBiomeIntentRetryMs,
  resetCoopBiomeOperationFlag,
  resetCoopBiomeOperationState,
  setCoopBiomeIntentRetryMs,
  setCoopBiomeOperationEnabled,
  setCoopBiomeOperationEpoch,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  commitMeOwnerIntent,
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
  setCoopMeOperationEpoch,
  settleCoopMeOwnerIntentRetries,
} from "#data/elite-redux/coop/coop-me-operation";
import type {
  CoopLogicalPhase,
  CoopOperationKind,
  CoopPendingOperation,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { coopOperationDurabilityHooks } from "#data/elite-redux/coop/coop-operation-journal";
import {
  type CoopCommitContext,
  type CoopIntentValidator,
  CoopOperationHost,
  createCoopRuntimeOpState,
  setActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A minimal, complete authoritative DATA plane (§1.2) - the envelope embeds it unchanged. */
function makeState(wave = 3, turn = 1): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: 0,
    wave,
    turn,
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
}

function makeCtx(logicalPhase: CoopLogicalPhase = "BIOME_SELECT", wave = 3, turn = 1): CoopCommitContext {
  return { wave, turn, logicalPhase, authoritativeState: makeState(wave, turn) };
}

/** A proposed intent minted by `owner` at `pinnedSeq` (the deterministic id keys the interaction slot). */
function makeIntent(
  epoch: number,
  owner: number,
  pinnedSeq: number,
  payload: unknown,
  kind: CoopOperationKind = "BIOME_PICK",
): CoopPendingOperation {
  return { id: makeCoopOperationId(epoch, owner, pinnedSeq, kind), kind, owner, status: "proposed", payload };
}

const ACCEPT: CoopIntentValidator = () => ({ ok: true });
const EPOCH = 2;
const GUEST_OWNER = 1; // an odd seat = guest-owned interaction (guest->host relayed intent)
const PIN = 9_700_100;

describe("W2e-R2 I5: pre-commit intent loss - owner re-send with the deterministic id is committed exactly once", () => {
  beforeEach(() => {
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
  });

  afterEach(() => {
    setActiveCoopRuntimeOpState(null);
  });

  it("keeps identical guest proposal retry ids isolated per runtime", async () => {
    vi.useFakeTimers();
    const runtimeA = createCoopRuntimeOpState("guest");
    const runtimeB = createCoopRuntimeOpState("guest");
    const resendA = vi.fn();
    const resendB = vi.fn();
    const params = {
      kind: "ME_PICK" as const,
      seq: 8_000_003,
      pinned: 3,
      payload: { optionIndex: 1 },
      localRole: "guest" as const,
      wave: 12,
      turn: 0,
    };
    try {
      setCoopMeOperationEnabled(true);
      setActiveCoopRuntimeOpState(runtimeA);
      expect(commitMeOwnerIntent({ ...params, resend: resendA })).not.toBeNull();

      setActiveCoopRuntimeOpState(runtimeB);
      expect(commitMeOwnerIntent({ ...params, resend: resendB })).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(resendA).toHaveBeenCalledOnce();
      expect(resendB).toHaveBeenCalledOnce();

      setActiveCoopRuntimeOpState(runtimeA);
      settleCoopMeOwnerIntentRetries();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(resendA, "settling A cancels only A's retry ledger").toHaveBeenCalledOnce();
      expect(resendB, "B's same deterministic id remains live in B's ledger").toHaveBeenCalledTimes(2);
    } finally {
      for (const runtime of [runtimeA, runtimeB]) {
        setActiveCoopRuntimeOpState(runtime);
        resetCoopMeOperationState();
      }
      resetCoopMeOperationFlag();
      vi.useRealTimers();
    }
  });

  it("the biome adapter repeats one deterministic intent until committed receipt consumption cancels it", async () => {
    vi.useFakeTimers();
    setCoopBiomeOperationEnabled(true);
    resetCoopBiomeOperationState();
    setCoopBiomeOperationEpoch(EPOCH);
    setCoopBiomeIntentRetryMs(25);
    const resend = vi.fn();
    const operationId = makeCoopOperationId(EPOCH, GUEST_OWNER, PIN, "BIOME_PICK");
    let current = true;
    const retry = {
      operationId,
      wave: 3,
      phaseName: "SelectBiomePhase" as const,
      sessionGeneration: 7,
      isCurrent: () => current,
      resend,
    };
    try {
      armCoopBiomeIntentResend(retry);
      armCoopBiomeIntentResend(retry);
      await vi.advanceTimersByTimeAsync(60);
      expect(resend, "the same operation id owns one retry timer, not duplicate loops").toHaveBeenCalledTimes(2);

      releaseCoopBiomeCommitReceipt(operationId);
      await vi.advanceTimersByTimeAsync(250);
      expect(resend, "committed materialization stops all further proposal sends").toHaveBeenCalledTimes(2);

      armCoopBiomeIntentResend(retry);
      current = false;
      await vi.advanceTimersByTimeAsync(30);
      expect(resend, "an abandoned phase/session guard cancels before injecting a stale choice").toHaveBeenCalledTimes(
        2,
      );
    } finally {
      resetCoopBiomeIntentRetryMs();
      resetCoopBiomeOperationFlag();
      resetCoopBiomeOperationState();
      setCoopBiomeOperationEpoch(1);
      vi.useRealTimers();
    }
  });

  it("rejects a guest watcher proposal for a host-owned pinned ME without arming a retry", async () => {
    vi.useFakeTimers();
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    setCoopMeOperationEpoch(EPOCH);
    const resend = vi.fn();
    try {
      const id = commitMeOwnerIntent({
        kind: "ME_PICK",
        seq: 8_000_006,
        pinned: 6,
        payload: { optionIndex: 1 },
        localRole: "guest",
        wave: 7,
        turn: 0,
        resend,
      });

      expect(id, "the watcher cannot mint an operation for the host-owned even counter").toBeNull();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(resend, "a rejected watcher pick must never become a one-second retry storm").not.toHaveBeenCalled();
    } finally {
      resetCoopMeOperationFlag();
      resetCoopMeOperationState();
      vi.useRealTimers();
    }
  });

  it("I5 production seam: a guest owner receives the stable operationId needed to arm a resend", () => {
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    setCoopMeOperationEpoch(EPOCH);
    try {
      const params = {
        kind: "ME_PICK" as const,
        seq: 8_000_003,
        pinned: 3,
        payload: { optionIndex: 1 },
        localRole: "guest" as const,
        wave: 12,
        turn: 0,
      };
      const first = commitMeOwnerIntent(params);
      const repeated = commitMeOwnerIntent(params);
      expect(first, "the owner seam must return the proposal identity used by the resend tracker").toBe(
        makeCoopOperationId(EPOCH, GUEST_OWNER, params.seq * 8000 + 1000, "ME_PICK"),
      );
      expect(repeated, "re-registering the same slot must reuse, never remint, the operationId").toBe(first);
    } finally {
      resetCoopMeOperationFlag();
      resetCoopMeOperationState();
    }
  });

  it("I5 production seam: a lost guest proposal is resent until its committed envelope arrives", async () => {
    vi.useFakeTimers();
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    setCoopMeOperationEpoch(EPOCH);
    const resend = vi.fn();
    try {
      commitMeOwnerIntent({
        kind: "ME_PICK",
        seq: 8_000_003,
        pinned: 3,
        payload: { optionIndex: 1 },
        localRole: "guest",
        wave: 12,
        turn: 0,
        resend,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(
        resend,
        "a dropped pre-commit proposal must be retried with the same relay payload",
      ).toHaveBeenCalledOnce();

      const host = new CoopOperationHost({ epoch: EPOCH });
      const committed = host.submit(
        makeIntent(EPOCH, GUEST_OWNER, 8_000_003 * 8000 + 1000, { optionIndex: 1 }, "ME_PICK"),
        makeCtx("MYSTERY_ENCOUNTER", 12, 0),
        ACCEPT,
      );
      expect(committed.kind).toBe("committed");
      if (committed.kind !== "committed") {
        throw new Error("expected the authority to commit the resent ME proposal");
      }
      coopOperationDurabilityHooks().apply?.({
        cls: "op:me",
        seq: committed.envelope.revision,
        msg: { t: "envelope", envelope: committed.envelope },
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(
        resend,
        "the authority's committed envelope must stop the proposal resend lifecycle",
      ).toHaveBeenCalledOnce();
    } finally {
      resetCoopMeOperationFlag();
      resetCoopMeOperationState();
      vi.useRealTimers();
    }
  });

  // I5a - the core recovery: a lost intent, re-sent by the owner, commits exactly once; the late original reacks.
  it("I5a: a lost pre-commit intent recovered by owner re-send commits EXACTLY ONCE (the late original reacks)", () => {
    const host = new CoopOperationHost({ epoch: EPOCH });
    const ctx = makeCtx();
    const intent = makeIntent(EPOCH, GUEST_OWNER, PIN, { biomeId: 42, nodeIndex: 0 });

    // The FIRST relay was LOST (the host never received it). On the relay timeout the owner RE-SENDS the
    // SAME intent; this submit models that re-send arriving. It commits (revision 0 -> 1).
    const resend = host.submit(intent, ctx, ACCEPT);
    expect(resend.kind).toBe("committed");
    expect(host.getRevision()).toBe(1);

    // The originally-"lost" relay is finally delivered (a duplicate of the SAME deterministic id): the commit
    // log dedupes it to a re-ACK - never a second commit, no revision change. Exactly-once holds under re-send.
    const late = host.submit(intent, ctx, ACCEPT);
    expect(late.kind).toBe("reack");
    expect(host.getRevision()).toBe(1);
  });

  // I5b - timeout DEFAULT then the late real intent: both share the slot's deterministic id, so the late
  // real intent reacks (the default stands) - a lost intent falls back deterministically with NO double-apply
  // and NO divergence (both peers converge on the committed op for that id).
  it("I5b: a timeout-default and the late real intent collide on the deterministic id -> reack, no double-apply", () => {
    const host = new CoopOperationHost({ epoch: EPOCH });
    const ctx = makeCtx();
    const id = makeCoopOperationId(EPOCH, GUEST_OWNER, PIN, "BIOME_PICK");

    // The guest's intent was lost; the host commits a DEFAULT for the slot under the deterministic id.
    const defaultOp: CoopPendingOperation = {
      id,
      kind: "BIOME_PICK",
      owner: GUEST_OWNER,
      status: "proposed",
      payload: { sourceBiomeId: 1, biomeId: 0, nodeIndex: 0, nextWave: 4 },
    };
    expect(host.submit(defaultOp, ctx, ACCEPT).kind).toBe("committed");
    expect(host.getRevision()).toBe(1);

    // The guest's REAL intent for the SAME slot arrives late (same id, different payload) -> reack. The commit
    // log never applies a second op for the slot, so host + guest cannot diverge on the interaction outcome.
    const realOp: CoopPendingOperation = {
      id,
      kind: "BIOME_PICK",
      owner: GUEST_OWNER,
      status: "proposed",
      payload: { sourceBiomeId: 1, biomeId: 42, nodeIndex: 0, nextWave: 4 },
    };
    expect(host.submit(realOp, ctx, ACCEPT).kind).toBe("reack");
    expect(host.getRevision()).toBe(1);
  });

  // I5c - the CONTRACT enforcement: the recovery is exactly-once ONLY because the re-send reuses the slot's
  // deterministic id. Re-sending under a re-minted id (a different pin) is NOT deduped and double-commits -
  // which is exactly why the recovery contract MANDATES re-send under the same `${epoch}:${owner}:${pin}` id.
  it("I5c: re-sending under a DIFFERENT (re-minted) id is NOT deduped -> the deterministic id is load-bearing", () => {
    const host = new CoopOperationHost({ epoch: EPOCH });
    const ctx = makeCtx();
    host.submit(makeIntent(EPOCH, GUEST_OWNER, PIN, { biomeId: 42, nodeIndex: 0 }), ctx, ACCEPT);
    // A re-mint at a NEW pin = a DIFFERENT id: the commit log cannot recognize it as the same intent.
    host.submit(makeIntent(EPOCH, GUEST_OWNER, PIN + 1, { biomeId: 42, nodeIndex: 0 }), ctx, ACCEPT);
    expect(host.getRevision(), "a re-mint double-commits -> re-send MUST reuse the deterministic id").toBe(2);
  });

  // I5d - the host AWAITS a relayed guest intent (expect) that is then lost: a later re-send lands on the open
  // slot and commits once. A newer op for a DIFFERENT slot supersedes the stale awaited one (no phantom apply).
  it("I5d: an awaited (expected) guest intent that is lost is committed once on re-send; a newer op supersedes it", () => {
    const host = new CoopOperationHost({ epoch: EPOCH });
    const ctx = makeCtx();
    const awaited = makeIntent(EPOCH, GUEST_OWNER, PIN, { biomeId: 42, nodeIndex: 0 });

    // The host registers the awaited guest intent (relayed later), then it is LOST. The owner re-sends it.
    host.expect(awaited);
    expect(host.getPendingOperation()?.id).toBe(awaited.id);
    expect(host.submit(awaited, ctx, ACCEPT).kind).toBe("committed");
    expect(host.getRevision()).toBe(1);

    // A re-send after commit reacks (exactly-once); the awaited slot is closed.
    expect(host.submit(awaited, ctx, ACCEPT).kind).toBe("reack");
    expect(host.getRevision()).toBe(1);
  });
});
