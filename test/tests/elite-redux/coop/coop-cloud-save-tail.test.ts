/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  classifySessionProtection,
  enqueueSessionCloudMutation,
  isDeterministicCoopCloudCasFailure,
  resetSessionCloudMutationTailForTests,
} from "#data/elite-redux/coop/coop-cloud-save-tail";
import {
  captureCoopResumeEvidence,
  clearCoopResumeEvidenceIfRun,
  findCoopResumeCandidate,
  readCoopResumeMarker,
  recordCoopDeletedRun,
  recordCoopResumeMarker,
  restoreCoopResumeEvidenceIfUnchanged,
} from "#data/elite-redux/coop/coop-resume-marker";
import { afterEach, describe, expect, it } from "vitest";
import {
  coopEmptySessionCasSatisfied,
  coopTombstoneBlocksRun,
  exactCoopDeleteReplaySatisfied,
  exactSessionDeleteSatisfied,
  exactSessionWriteSatisfied,
  parseValidCoopRun,
} from "../../../../workers/er-save-api/src/index";

describe("co-op account-wide session cloud ordering", () => {
  afterEach(() => {
    resetSessionCloudMutationTailForTests();
    localStorage.removeItem("er-coop-resume");
    localStorage.removeItem("er-coop-resume-unavailable");
    localStorage.removeItem("er-coop-deleted-runs");
  });

  it.each(["delete", "clear"] as const)("cannot let a delayed mirror resurrect a later %s", async terminal => {
    const events: string[] = [];
    let releaseMirror!: () => void;
    const mirrorGate = new Promise<void>(resolve => {
      releaseMirror = resolve;
    });
    const mirror = enqueueSessionCloudMutation("Alice", async () => {
      events.push("mirror:start");
      await mirrorGate;
      events.push("mirror:finish");
      return "mirror";
    });
    const mutation = enqueueSessionCloudMutation("Alice", async () => {
      events.push(`${terminal}:start`);
      events.push(`${terminal}:finish`);
      return terminal;
    });

    await Promise.resolve();
    expect(events).toEqual(["mirror:start"]);
    releaseMirror();
    await expect(Promise.all([mirror, mutation])).resolves.toEqual(["mirror", terminal]);
    expect(events).toEqual(["mirror:start", "mirror:finish", `${terminal}:start`, `${terminal}:finish`]);
  });

  it("does not let one account's stalled mutation block another account", async () => {
    let releaseAlice!: () => void;
    const aliceGate = new Promise<void>(resolve => {
      releaseAlice = resolve;
    });
    const alice = enqueueSessionCloudMutation("Alice", async () => {
      await aliceGate;
      return "alice";
    });
    const bob = enqueueSessionCloudMutation("Bob", async () => "bob");

    await expect(bob, "account-scoped queues remain independent").resolves.toBe("bob");
    releaseAlice();
    await expect(alice).resolves.toBe("alice");
  });

  it("rolls marker evidence back only while the exact transaction-written bytes are current", () => {
    localStorage.setItem("er-coop-resume", "prior-marker");
    localStorage.setItem("er-coop-resume-unavailable", "prior-unavailable");
    const before = captureCoopResumeEvidence();

    localStorage.setItem("er-coop-resume", "transaction-marker");
    localStorage.removeItem("er-coop-resume-unavailable");
    const transaction = captureCoopResumeEvidence();
    expect(restoreCoopResumeEvidenceIfUnchanged(transaction, before)).toBe(true);
    expect(captureCoopResumeEvidence()).toEqual(before);

    localStorage.setItem("er-coop-resume", "transaction-marker");
    localStorage.removeItem("er-coop-resume-unavailable");
    const staleTransaction = captureCoopResumeEvidence();
    localStorage.setItem("er-coop-resume", "newer-tab-marker");
    expect(restoreCoopResumeEvidenceIfUnchanged(staleTransaction, before)).toBe(false);
    expect(localStorage.getItem("er-coop-resume")).toBe("newer-tab-marker");
  });

  it("authorizes empty-slot CAS retry only for an insert or byte-identical committed row", () => {
    const completeSession = JSON.stringify({ gameMode: 5, coopRun: { runId: "run-exact-123456789" } });
    expect(coopEmptySessionCasSatisfied(1, null, completeSession), "new atomic insert").toBe(true);
    expect(
      coopEmptySessionCasSatisfied(0, completeSession, completeSession),
      "lost response retries exact valid session bytes",
    ).toBe(true);
    expect(
      coopEmptySessionCasSatisfied(0, `${completeSession} `, completeSession),
      "semantic similarity cannot authorize a different row",
    ).toBe(false);
    expect(coopEmptySessionCasSatisfied(0, null, completeSession), "missing row after conflict").toBe(false);
  });

  it("protects valid, pre-T5, and malformed co-op-like identities at every legacy mutation boundary", () => {
    expect(
      parseValidCoopRun(JSON.stringify({ coopRun: { runId: "run-protected-123456789", checkpointRevision: 7 } })),
    ).toEqual({ runId: "run-protected-123456789", checkpointRevision: 7 });
    expect(parseValidCoopRun(JSON.stringify({ coopRun: { runId: "short", checkpointRevision: 7 } }))).toBeNull();
    expect(
      parseValidCoopRun(JSON.stringify({ coopRun: { runId: "run-protected-123456789", checkpointRevision: -1 } })),
    ).toBeNull();
    expect(parseValidCoopRun("not-json")).toBeNull();
    expect(classifySessionProtection("not-json")).toBe("unknown");
    expect(
      classifySessionProtection(JSON.stringify({ gameMode: 6, coopParticipants: { players: ["Alice", "Bob"] } })),
      "pre-T5 co-op saves stay protected even without coopRun",
    ).toBe("coop-invalid");
    expect(classifySessionProtection(JSON.stringify({ coopRun: { runId: "short", checkpointRevision: -1 } }))).toBe(
      "coop-invalid",
    );
    expect(classifySessionProtection(JSON.stringify({ gameMode: 0, waveIndex: 10 }))).toBe("solo");
  });

  it.each([
    "update",
    "updateAll",
  ] as const)("fails a legacy %s exact-row mutation when a concurrent co-op row wins", endpoint => {
    const legacyIncoming = JSON.stringify({ gameMode: 0, waveIndex: 2, endpoint });
    const concurrentCoop = JSON.stringify({
      gameMode: 5,
      coopRun: { runId: "run-concurrent-123456789", checkpointRevision: 9 },
    });
    expect(exactSessionWriteSatisfied(0, concurrentCoop, legacyIncoming)).toBe(false);
    expect(exactSessionWriteSatisfied(0, legacyIncoming, legacyIncoming), "lost response exact replay").toBe(true);
  });

  it.each(["delete", "clear"] as const)("fails a legacy %s exact-row deletion when a concurrent co-op row wins", () => {
    const concurrentCoop = JSON.stringify({
      gameMode: 5,
      coopRun: { runId: "run-concurrent-123456789", checkpointRevision: 9 },
    });
    expect(exactSessionDeleteSatisfied(0, concurrentCoop)).toBe(false);
    expect(exactSessionDeleteSatisfied(0, null), "lost response observes the row already absent").toBe(true);
  });

  it("accepts only an exact tombstone replay and fences a deleted run account-wide across slot reuse", () => {
    const oldRunId = "run-deleted-123456789";
    const newRunId = "run-distinct-123456789";
    const tombstone = { slot: 2, checkpointRevision: 14, digest: "a".repeat(64) };
    expect(exactCoopDeleteReplaySatisfied(tombstone, { ...tombstone }), "lost delete response exact retry").toBe(true);
    expect(
      exactCoopDeleteReplaySatisfied(tombstone, { ...tombstone, slot: 4 }),
      "same run cannot claim another slot as an exact delete replay",
    ).toBe(false);
    expect(coopTombstoneBlocksRun(oldRunId, oldRunId), "old delayed run stays fenced in every slot").toBe(true);
    expect(coopTombstoneBlocksRun(oldRunId, newRunId), "a distinct new run may reuse the deleted slot").toBe(false);
  });

  it("separates transient cloud debt from deterministic co-op ownership loss", () => {
    expect(isDeterministicCoopCloudCasFailure("Unknown Error!"), "POST transport outage is retryable debt").toBe(false);
    expect(
      isDeterministicCoopCloudCasFailure("Co-op cloud CAS could not read the current checkpoint."),
      "GET/read outage is retryable debt",
    ).toBe(false);
    expect(isDeterministicCoopCloudCasFailure("Session CAS conflict: checkpoint changed.")).toBe(true);
    expect(isDeterministicCoopCloudCasFailure("Session CAS conflict: run was deleted.")).toBe(true);
    expect(isDeterministicCoopCloudCasFailure("Co-op cloud CAS slot contains another or invalid run.")).toBe(true);
  });

  it("compare-clears only the deleted run's resume evidence and preserves a newer run", () => {
    const oldRun = "run-deleted-123456789";
    const newRun = "run-distinct-123456789";
    recordCoopResumeMarker(2, "Alice", "Bob", 20, oldRun, 4);
    expect(clearCoopResumeEvidenceIfRun("Alice", oldRun)).toBe(true);
    expect(readCoopResumeMarker("Alice", "Bob"), "deleted run is no longer offered").toBeNull();

    recordCoopResumeMarker(1, "Alice", "Bob", 1, newRun, 0);
    expect(clearCoopResumeEvidenceIfRun("Alice", oldRun), "late old cleanup proves new evidence is untouched").toBe(
      true,
    );
    expect(readCoopResumeMarker("Alice", "Bob")?.runId, "fresh/new run remains resumable").toBe(newRun);
  });

  it("never offers a tombstoned local replica without Web Locks and still permits a distinct new run", async () => {
    const oldRun = "run-deleted-123456789";
    const newRun = "run-distinct-123456789";
    const session = (runId: string) => ({
      gameMode: 6,
      waveIndex: 1,
      timestamp: 1,
      coopParticipants: {
        version: 1 as const,
        players: ["Alice", "Bob"] as [string, string],
        seats: { host: "Alice", guest: "Bob" },
      },
      coopControlPlane: { interactionCounter: 0, journalHighWater: {} },
      coopRun: { version: 1 as const, runId, checkpointRevision: 0 },
    });
    recordCoopResumeMarker(0, "Alice", "Bob", 1, oldRun, 0);
    expect(recordCoopDeletedRun("Alice", oldRun), "backend-success evidence is durable locally").toBe(true);
    await expect(
      findCoopResumeCandidate("Alice", "Bob", "host", async () => ({
        session: session(oldRun),
        sessionJson: JSON.stringify(session(oldRun)),
      })),
      "a stale local row cannot resurrect the deleted run even when physical removal was unavailable",
    ).resolves.toEqual({ kind: "no-save" });
    await expect(
      findCoopResumeCandidate("Alice", "Bob", "host", async () => ({
        session: session(newRun),
        sessionJson: JSON.stringify(session(newRun)),
      })),
    ).resolves.toMatchObject({ kind: "candidate", candidate: { runId: newRun } });
  });
});
