/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op AUTHORITATIVE OPERATION runtime (Wave-2 authoritative run-state migration, §1.3-§1.7).
// Pure-logic test (no game engine): this is the LIFECYCLE SPEC. It exhaustively drives an operation
// through proposed -> committed -> applied/rejected/superseded and asserts every idempotency +
// late-rejection + fail-closed rule from the contract doc
// (docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §1). The two biome-travel surfaces
// and every later surface build on exactly this model, so these invariants are load-bearing.

import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopLogicalPhase,
  type CoopOperationKind,
  type CoopPendingOperation,
  isKnownCoopLogicalPhase,
  isKnownCoopOperationKind,
  isTerminalCoopOperationStatus,
  makeCoopOperationId,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  registerCoopOperationLiveSink,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  type CoopCommitContext,
  type CoopIntentValidator,
  CoopOperationGuest,
  CoopOperationHost,
  createCoopRuntimeOpState,
  resetCoopGlobalOperationOrder,
  setActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it, vi } from "vitest";

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

/** A proposed intent minted by `owner` at `pinnedSeq` in `epoch`. */
function makeIntent(
  epoch: number,
  owner: number,
  pinnedSeq: number,
  kind: CoopOperationKind = "BIOME_PICK",
  payload: unknown = { biomeId: 12, nodeIndex: 0 },
): CoopPendingOperation {
  return { id: makeCoopOperationId(epoch, owner, pinnedSeq, kind), kind, owner, status: "proposed", payload };
}

const ACCEPT: CoopIntentValidator = () => ({ ok: true });
const REFUSE =
  (reason: string): CoopIntentValidator =>
  () => ({ ok: false, reason });

// =============================================================================
describe("coop-operation-envelope: id mint/parse + closed-union guards (§1.1, §1.7, §1.8)", () => {
  it("mints and parses the epoch-owner-kind-sequence tuple round-trip", () => {
    const id = makeCoopOperationId(2, 1, 9_700_042, "REWARD");
    expect(id).toBe("2:1:REWARD:9700042");
    expect(parseCoopOperationId(id)).toEqual({ epoch: 2, owner: 1, kind: "REWARD", pinnedSeq: 9_700_042 });
  });

  it("never aliases two operation classes at the same epoch, owner, and local sequence", () => {
    const wave = makeCoopOperationId(2, 0, 1, "WAVE_ADVANCE");
    const reward = makeCoopOperationId(2, 0, 1, "REWARD");
    expect(wave).not.toBe(reward);
  });

  it("parse rejects a malformed id", () => {
    expect(parseCoopOperationId("nope")).toBeNull();
    expect(parseCoopOperationId("1:2")).toBeNull();
    expect(parseCoopOperationId("a:b:c")).toBeNull();
    expect(parseCoopOperationId("1:2:NOPE:4")).toBeNull();
  });

  it("recognizes the closed phase + kind unions and rejects unknowns (fail-closed source, §1.7)", () => {
    expect(isKnownCoopLogicalPhase("BIOME_SELECT")).toBe(true);
    expect(isKnownCoopLogicalPhase("IDLE")).toBe(true);
    expect(isKnownCoopLogicalPhase("SOME_FUTURE_PHASE")).toBe(false);
    expect(isKnownCoopOperationKind("BIOME_PICK")).toBe(true);
    expect(isKnownCoopOperationKind("CROSSROADS_PICK")).toBe(true);
    expect(isKnownCoopOperationKind("SOME_FUTURE_KIND")).toBe(false);
  });

  it("classifies terminal vs non-terminal statuses (§1.3)", () => {
    expect(isTerminalCoopOperationStatus("applied")).toBe(true);
    expect(isTerminalCoopOperationStatus("rejected")).toBe(true);
    expect(isTerminalCoopOperationStatus("superseded")).toBe(true);
    expect(isTerminalCoopOperationStatus("proposed")).toBe(false);
    expect(isTerminalCoopOperationStatus("committed")).toBe(false);
  });
});

// =============================================================================
describe("CoopOperationHost: commit log (§1.3-§1.5)", () => {
  it("commits a valid intent: revision++, applied op, envelope embeds state (invariants 3,4)", () => {
    const onApplied = vi.fn();
    const host = new CoopOperationHost({ epoch: 1, onApplied });
    const intent = makeIntent(1, 0, 9_700_010);

    const res = host.submit(intent, makeCtx("BIOME_SELECT", 3, 1), ACCEPT);

    expect(res.kind).toBe("committed");
    if (res.kind !== "committed") {
      throw new Error("expected committed");
    }
    expect(res.envelope.version).toBe(1);
    expect(res.envelope.sessionEpoch).toBe(1);
    expect(res.envelope.revision).toBe(1);
    expect(res.envelope.logicalPhase).toBe("BIOME_SELECT");
    expect(res.envelope.pendingOperation).toMatchObject({ id: intent.id, kind: "BIOME_PICK", status: "applied" });
    expect(res.envelope.authoritativeState.wave).toBe(3);
    expect(host.getRevision()).toBe(1);
    expect(host.statusOf(intent.id)).toBe("applied");
    // §1.8 dual-run: the legacy counter advance fires in lockstep with revision, exactly once.
    expect(onApplied).toHaveBeenCalledOnce();
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ id: intent.id }), 1);
  });

  it("increments revision by exactly 1 per committed op (§1.5)", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const a = host.submit(makeIntent(1, 0, 9_700_010), makeCtx(), ACCEPT);
    const b = host.submit(makeIntent(1, 1, 9_700_011), makeCtx(), ACCEPT);
    expect(a.kind === "committed" && a.envelope.revision).toBe(1);
    expect(b.kind === "committed" && b.envelope.revision).toBe(2);
    expect(host.getRevision()).toBe(2);
  });

  it("respects a non-zero initialRevision (reconnect / mid-run start)", () => {
    const host = new CoopOperationHost({ epoch: 1, initialRevision: 40 });
    const res = host.submit(makeIntent(1, 0, 9_700_010), makeCtx(), ACCEPT);
    expect(res.kind === "committed" && res.envelope.revision).toBe(41);
  });

  it("rejects an invalid intent: broadcasts a rejected envelope, NO revision change (§1.3)", () => {
    const onApplied = vi.fn();
    const host = new CoopOperationHost({ epoch: 1, onApplied });
    const intent = makeIntent(1, 1, 9_700_010);

    const res = host.submit(intent, makeCtx(), REFUSE("wrong-owner"));

    expect(res.kind).toBe("rejected");
    if (res.kind !== "rejected") {
      throw new Error("expected rejected");
    }
    expect(res.reason).toBe("wrong-owner");
    expect(res.envelope.revision).toBe(0); // unchanged - no state mutated (§1.3)
    expect(res.envelope.pendingOperation).toMatchObject({ status: "rejected", rejectReason: "wrong-owner" });
    expect(host.getRevision()).toBe(0);
    expect(host.statusOf(intent.id)).toBe("rejected");
    expect(onApplied).not.toHaveBeenCalled(); // no counter advance on a rejection (§1.8)
  });

  it("EXACTLY ONCE: a duplicate of an already-applied id is a no-op re-ACK, never a 2nd commit (invariant 3)", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const intent = makeIntent(1, 0, 9_700_010);
    const first = host.submit(intent, makeCtx(), ACCEPT);
    expect(first.kind).toBe("committed");

    const again = host.submit(intent, makeCtx(), ACCEPT);
    expect(again.kind).toBe("reack");
    if (again.kind !== "reack") {
      throw new Error("expected reack");
    }
    expect(again.op.status).toBe("applied");
    expect(host.getRevision()).toBe(1); // NOT bumped to 2
  });

  it("rejects a cross-epoch intent as late (§1.4): a leftover op cannot satisfy a new epoch", () => {
    const host = new CoopOperationHost({ epoch: 2 });
    const staleFromEpoch1 = makeIntent(1, 0, 9_700_010); // id embeds epoch 1
    const res = host.submit(staleFromEpoch1, makeCtx(), ACCEPT);
    expect(res.kind).toBe("rejected-late");
    if (res.kind !== "rejected-late") {
      throw new Error("expected rejected-late");
    }
    expect(res.reason).toBe("epoch-mismatch");
    expect(host.getRevision()).toBe(0);
  });

  it("rejects a malformed operation id as late", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const bad: CoopPendingOperation = { id: "garbage", kind: "BIOME_PICK", owner: 0, status: "proposed", payload: {} };
    expect(host.submit(bad, makeCtx(), ACCEPT).kind).toBe("rejected-late");
  });

  it("SUPERSEDES an in-flight op when a newer op takes the slot; the late original is then late-rejected (§1.3, §1.6)", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    // The host is awaiting the owner's pick A (e.g. relayed later).
    const a = makeIntent(1, 1, 9_700_010, "BIOME_PICK", { biomeId: 5, nodeIndex: 0 });
    host.expect(a);
    expect(host.getPendingOperation()).toMatchObject({ id: a.id, status: "committed" });

    // An owner-timeout DEFAULT B commits for the same slot before A lands -> A is superseded.
    const b = makeIntent(1, 0, 9_700_011, "BIOME_PICK", { biomeId: 9, nodeIndex: -1 });
    const applyB = host.submit(b, makeCtx(), ACCEPT);
    expect(applyB.kind).toBe("committed");
    expect(host.statusOf(a.id)).toBe("superseded");

    // A's now-stale intent finally arrives -> it is late-rejected, never applied (the #861 shape).
    const lateA = host.submit(a, makeCtx(), ACCEPT);
    expect(lateA.kind).toBe("rejected-late");
    if (lateA.kind !== "rejected-late") {
      throw new Error("expected rejected-late");
    }
    expect(lateA.reason).toBe("already-superseded");
    expect(host.getRevision()).toBe(1); // only B applied
  });

  it("late-rejects any message for an already-rejected op (invariant 6)", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const intent = makeIntent(1, 1, 9_700_010);
    host.submit(intent, makeCtx(), REFUSE("illegal"));
    const late = host.submit(intent, makeCtx(), ACCEPT);
    expect(late.kind).toBe("rejected-late");
    if (late.kind !== "rejected-late") {
      throw new Error("expected rejected-late");
    }
    expect(late.reason).toBe("already-rejected");
  });

  it("expect() is idempotent and never re-opens a slot for a terminal op", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const intent = makeIntent(1, 0, 9_700_010);
    host.submit(intent, makeCtx(), ACCEPT); // applied
    host.expect(intent); // must NOT re-open the applied op as pending
    expect(host.getPendingOperation()).toBeNull();
  });
});

// =============================================================================
describe("CoopOperationGuest: idempotent applier (§1.6, §1.7)", () => {
  /** Build the committed envelope a host would broadcast for `intent` at `revision`. */
  function committedEnvelope(
    intent: CoopPendingOperation,
    revision: number,
    phase: CoopLogicalPhase = "BIOME_SELECT",
  ): CoopAuthoritativeEnvelopeV1 {
    const host = new CoopOperationHost({ epoch: 1, initialRevision: revision - 1 });
    const res = host.submit(intent, makeCtx(phase), ACCEPT);
    if (res.kind !== "committed") {
      throw new Error("fixture: expected committed");
    }
    return res.envelope;
  }

  it("applies revision last+1, records the id, adopts as last-good (invariant 5)", () => {
    const guest = new CoopOperationGuest({ epoch: 1 });
    const env = committedEnvelope(makeIntent(1, 0, 9_700_010), 1);
    const res = guest.applyEnvelope(env);
    expect(res.kind).toBe("applied");
    expect(guest.getLastAppliedRevision()).toBe(1);
    expect(guest.hasApplied(env.pendingOperation?.id ?? "")).toBe(true);
    expect(guest.getLastGoodEnvelope()).toBe(env);
  });

  it("IDEMPOTENT re-delivery (host resend, §4.2) is a no-op: a 2nd apply of the same envelope is a duplicate", () => {
    const guest = new CoopOperationGuest({ epoch: 1 });
    const env = committedEnvelope(makeIntent(1, 0, 9_700_010), 1);
    expect(guest.applyEnvelope(env).kind).toBe("applied");
    expect(guest.applyEnvelope(env).kind).toBe("duplicate");
    expect(guest.getLastAppliedRevision()).toBe(1); // unchanged
  });

  it("drops a stale/duplicate envelope whose revision <= last applied (§1.6 rule 2)", () => {
    const guest = new CoopOperationGuest({ epoch: 1, initialRevision: 5 });
    const env = committedEnvelope(makeIntent(1, 0, 9_700_010), 3); // revision 3 < 5
    expect(guest.applyEnvelope(env).kind).toBe("duplicate");
  });

  it("detects a revision GAP and asks for the tail rather than applying out of order (§1.6 rule 2, §4.4)", () => {
    const guest = new CoopOperationGuest({ epoch: 1 }); // applied through 0
    const env = committedEnvelope(makeIntent(1, 0, 9_700_010), 3); // missing 1,2
    const res = guest.applyEnvelope(env);
    expect(res.kind).toBe("gap");
    if (res.kind !== "gap") {
      throw new Error("expected gap");
    }
    expect(res.missingFrom).toBe(1);
    expect(guest.getLastAppliedRevision()).toBe(0); // did NOT apply
  });

  it("DROPS a cross-epoch envelope (§1.6 rule 1): a leftover from a prior epoch cannot apply", () => {
    const guest = new CoopOperationGuest({ epoch: 2 });
    const envFromEpoch1: CoopAuthoritativeEnvelopeV1 = {
      ...committedEnvelope(makeIntent(1, 0, 9_700_010), 1),
      sessionEpoch: 1,
    };
    expect(guest.applyEnvelope(envFromEpoch1).kind).toBe("dropped-epoch");
    expect(guest.getLastAppliedRevision()).toBe(0);
  });

  it("FAILS CLOSED on an unknown logical phase: holds at last good, does not advance (invariant 8, §1.7)", () => {
    const guest = new CoopOperationGuest({ epoch: 1 });
    const good = committedEnvelope(makeIntent(1, 0, 9_700_010), 1);
    guest.applyEnvelope(good);

    const unknown: CoopAuthoritativeEnvelopeV1 = {
      ...good,
      revision: 2,
      logicalPhase: "FUTURE_PHASE" as CoopLogicalPhase,
    };
    const res = guest.applyEnvelope(unknown);
    expect(res.kind).toBe("fail-closed");
    if (res.kind !== "fail-closed") {
      throw new Error("expected fail-closed");
    }
    expect(res.reason).toBe("unknown-phase");
    expect(guest.getLastAppliedRevision()).toBe(1); // held
    expect(guest.getLastGoodEnvelope()).toBe(good); // still the last recognized envelope
  });

  it("FAILS CLOSED on an unknown operation kind (invariant 8, §1.7)", () => {
    const guest = new CoopOperationGuest({ epoch: 1 });
    const good = committedEnvelope(makeIntent(1, 0, 9_700_010), 1);
    const op = good.pendingOperation;
    if (op == null) {
      throw new Error("fixture");
    }
    const unknownKind: CoopAuthoritativeEnvelopeV1 = {
      ...good,
      revision: 2,
      pendingOperation: { ...op, kind: "FUTURE_KIND" as CoopOperationKind },
    };
    const res = guest.applyEnvelope(unknownKind);
    expect(res.kind).toBe("fail-closed");
    if (res.kind !== "fail-closed") {
      throw new Error("expected fail-closed");
    }
    expect(res.reason).toBe("unknown-kind");
  });

  it("surfaces a host REJECTION without advancing revision (§1.3)", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const rej = host.submit(makeIntent(1, 1, 9_700_010), makeCtx(), REFUSE("wrong-owner"));
    if (rej.kind !== "rejected") {
      throw new Error("fixture");
    }
    const guest = new CoopOperationGuest({ epoch: 1 });
    const res = guest.applyEnvelope(rej.envelope);
    expect(res.kind).toBe("rejected");
    if (res.kind !== "rejected") {
      throw new Error("expected rejected");
    }
    expect(res.op.rejectReason).toBe("wrong-owner");
    expect(guest.getLastAppliedRevision()).toBe(0);
  });

  it("surfaces a SUPERSEDED op without advancing revision (§1.3)", () => {
    const guest = new CoopOperationGuest({ epoch: 1 });
    const superseded: CoopAuthoritativeEnvelopeV1 = {
      version: 1,
      sessionEpoch: 1,
      revision: 0,
      wave: 3,
      turn: 1,
      logicalPhase: "BIOME_SELECT",
      pendingOperation: {
        id: makeCoopOperationId(1, 1, 9_700_010, "BIOME_PICK"),
        kind: "BIOME_PICK",
        owner: 1,
        status: "superseded",
        payload: {},
      },
      authoritativeState: makeState(),
    };
    expect(guest.applyEnvelope(superseded).kind).toBe("superseded");
    expect(guest.getLastAppliedRevision()).toBe(0);
  });

  it("re-enters an in-flight (proposed/committed) op on reconnect without advancing revision (invariant 7, §4.4)", () => {
    const guest = new CoopOperationGuest({ epoch: 1 });
    const inFlight: CoopAuthoritativeEnvelopeV1 = {
      version: 1,
      sessionEpoch: 1,
      revision: 0,
      wave: 3,
      turn: 1,
      logicalPhase: "BIOME_SELECT",
      pendingOperation: {
        id: makeCoopOperationId(1, 1, 9_700_010, "BIOME_PICK"),
        kind: "BIOME_PICK",
        owner: 1,
        status: "committed",
        payload: { sourceBiomeId: 1, biomeId: 4, nodeIndex: 0, nextWave: 4 },
      },
      authoritativeState: makeState(),
    };
    const res = guest.applyEnvelope(inFlight);
    expect(res.kind).toBe("pending");
    if (res.kind !== "pending") {
      throw new Error("expected pending");
    }
    expect(res.op.id).toBe(makeCoopOperationId(1, 1, 9_700_010, "BIOME_PICK"));
    expect(guest.getLastAppliedRevision()).toBe(0);
  });
});

// =============================================================================
describe("host + guest end-to-end: revision totally orders the run (§1.5, §1.6)", () => {
  it("keeps legacy and per-runtime surfaces on one dense role-owned revision clock", () => {
    const hostState = createCoopRuntimeOpState("host");
    const guestState = createCoopRuntimeOpState("guest");
    resetCoopGlobalOperationOrder();
    try {
      setActiveCoopRuntimeOpState(hostState);
      const legacyHost = CoopOperationHost.global({ epoch: 1 });
      const runtimeHost = CoopOperationHost.forRuntime(hostState, { epoch: 1 });
      const wave = legacyHost.submit(
        makeIntent(1, 0, 1, "WAVE_ADVANCE", { wave: 1 }),
        makeCtx("WAVE_VICTORY", 1, 1),
        ACCEPT,
      );
      const reward = runtimeHost.submit(
        makeIntent(1, 0, 2, "REWARD", { slot: 0 }),
        makeCtx("REWARD_SELECT", 1, 1),
        ACCEPT,
      );
      if (wave.kind !== "committed" || reward.kind !== "committed") {
        throw new Error("fixture");
      }
      expect([wave.envelope.revision, reward.envelope.revision]).toEqual([1, 2]);

      setActiveCoopRuntimeOpState(guestState);
      const legacyGuest = CoopOperationGuest.global({ epoch: 1 });
      const runtimeGuest = CoopOperationGuest.forRuntime(guestState, { epoch: 1 });
      expect(legacyGuest.applyEnvelope(wave.envelope).kind).toBe("applied");
      expect(runtimeGuest.applyEnvelope(reward.envelope).kind).toBe("applied");
      expect(legacyGuest.getLastAppliedRevision()).toBe(2);
      expect(runtimeGuest.getLastAppliedRevision()).toBe(2);
    } finally {
      setActiveCoopRuntimeOpState(null);
      resetCoopGlobalOperationOrder();
    }
  });

  it("never invokes a live sink before untouched epoch and global revision validation", () => {
    const host = new CoopOperationHost({ epoch: 2 });
    const guest = new CoopOperationGuest({ epoch: 2 });
    const committed = host.submit(makeIntent(2, 0, 10), makeCtx(), ACCEPT);
    if (committed.kind !== "committed") {
      throw new Error("fixture");
    }
    let mutations = 0;
    registerCoopOperationLiveSink("op:test-order", () => {
      mutations++;
      return true;
    });
    try {
      expect(applyCoopOperationEnvelope(guest, "op:test-order", { ...committed.envelope, sessionEpoch: 1 })).toBe(
        "rejected",
      );
      expect(applyCoopOperationEnvelope(guest, "op:test-order", { ...committed.envelope, revision: 2 })).toBe(
        "rejected",
      );
      expect(mutations).toBe(0);
      expect(guest.getLastAppliedRevision()).toBe(0);

      expect(applyCoopOperationEnvelope(guest, "op:test-order", committed.envelope)).toBe("applied");
      expect(mutations).toBe(1);
      expect(guest.getLastAppliedRevision()).toBe(1);
    } finally {
      registerCoopOperationLiveSink("op:test-order", null);
    }
  });

  it("shares one dense revision across different operation surfaces and parks cross-class reordering", () => {
    const hostClock = { epoch: 1, revision: 0 };
    const guestClock = { epoch: 1, revision: 0 };
    const biomeHost = new CoopOperationHost({ epoch: 1, revisionClock: hostClock });
    const mysteryHost = new CoopOperationHost({ epoch: 1, revisionClock: hostClock });
    const biomeGuest = new CoopOperationGuest({ epoch: 1, revisionClock: guestClock });
    const mysteryGuest = new CoopOperationGuest({ epoch: 1, revisionClock: guestClock });

    const biome = biomeHost.submit(makeIntent(1, 0, 10, "BIOME_PICK"), makeCtx("BIOME_SELECT"), ACCEPT);
    const mystery = mysteryHost.submit(
      makeIntent(1, 1, 11, "ME_PICK", { optionIndex: 0 }),
      makeCtx("MYSTERY_ENCOUNTER"),
      ACCEPT,
    );
    if (biome.kind !== "committed" || mystery.kind !== "committed") {
      throw new Error("fixture");
    }

    expect(biome.envelope.revision).toBe(1);
    expect(mystery.envelope.revision).toBe(2);
    expect(mysteryGuest.applyEnvelope(mystery.envelope)).toEqual({ kind: "gap", missingFrom: 1 });
    expect(biomeGuest.applyEnvelope(biome.envelope).kind).toBe("applied");
    expect(mysteryGuest.applyEnvelope(mystery.envelope).kind).toBe("applied");
    expect(guestClock.revision).toBe(2);
  });

  it("host commits, guest applies in order; a re-broadcast is a no-op; a gap is requested", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const guest = new CoopOperationGuest({ epoch: 1 });

    const e1 = host.submit(makeIntent(1, 0, 9_700_010), makeCtx("BIOME_SELECT"), ACCEPT);
    const e2 = host.submit(
      makeIntent(1, 1, 9_600_011, "CROSSROADS_PICK", { optionIndex: 1 }),
      makeCtx("BIOME_SELECT"),
      ACCEPT,
    );
    if (e1.kind !== "committed" || e2.kind !== "committed") {
      throw new Error("fixture");
    }

    expect(guest.applyEnvelope(e1.envelope).kind).toBe("applied");
    // Host resends e1 (no ACK yet, §4.2) -> idempotent no-op.
    expect(guest.applyEnvelope(e1.envelope).kind).toBe("duplicate");
    expect(guest.applyEnvelope(e2.envelope).kind).toBe("applied");
    expect(guest.getLastAppliedRevision()).toBe(2);
  });

  it("ADVERSARIAL (#861 shape): a stale buffered pick from a SUPERSEDED prior op can never apply on the guest", () => {
    const host = new CoopOperationHost({ epoch: 1 });
    const guest = new CoopOperationGuest({ epoch: 1 });

    // The owner's pick A is awaited, then a default B supersedes it and commits.
    const a = makeIntent(1, 1, 9_700_010, "BIOME_PICK", { biomeId: 5, nodeIndex: 0 });
    host.expect(a);
    const b = host.submit(makeIntent(1, 0, 9_700_011, "BIOME_PICK", { biomeId: 9, nodeIndex: -1 }), makeCtx(), ACCEPT);
    if (b.kind !== "committed") {
      throw new Error("fixture");
    }
    expect(guest.applyEnvelope(b.envelope).kind).toBe("applied"); // guest travels to the DEFAULT biome 9

    // A's stale intent finally reaches the host: late-rejected, and the guest never sees an applied A.
    const lateA = host.submit(a, makeCtx(), ACCEPT);
    expect(lateA.kind).toBe("rejected-late");
    // The guest's authoritative state is still B (biome 9), never overwritten by the stale A (biome 5).
    expect(guest.getLastGoodEnvelope()?.pendingOperation?.payload).toMatchObject({ biomeId: 9 });
    expect(guest.getLastAppliedRevision()).toBe(1);
  });
});
