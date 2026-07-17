/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P33 CLOSURE (B) - ADVERSARIAL VERIFICATION of the cold-resume SAVE FENCING
// (coop-resume-marker.ts): the SHA-256 digest binding on the accepted resume
// commitment and the fail-closed tombstone lineage adoption.
//
// Independent (ci/coop/p33-closure-verification) attack suite. Engine-free: it
// drives the pure marker functions directly against a mocked localStorage (no
// globalScene, no save slots). Each `describe` names the attack; blocks tagged
// "FINDING" pin a real behavior worth the owning stream's attention (fail-closed
// side effects) as green characterization with the DESIRED behavior in the header.
// =============================================================================

import {
  type CoopResumeSessionSummary,
  coopResumeCommitmentMatches,
  deriveCoopResumeCommitment,
  digestCoopResumeSession,
  findCoopResumeCandidate,
  isCoopRunLocallyDeleted,
  recordCoopDeletedRun,
  recordCoopResumeMarker,
} from "#data/elite-redux/coop/coop-resume-marker";
import { GameModes } from "#enums/game-modes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN_A = `test-run-${"a".repeat(24)}`;

/** A structurally valid, seat-mapped co-op session summary for the pair (host,guest). */
function coopSession(
  overrides: Partial<CoopResumeSessionSummary> = {},
  host = "Alice",
  guest = "Bob",
  runId = RUN_A,
): CoopResumeSessionSummary {
  return {
    gameMode: GameModes.COOP,
    waveIndex: 20,
    timestamp: 200,
    coopParticipants: {
      version: 1,
      players: [host, guest] as [string, string],
      seats: { host, guest },
    },
    coopControlPlane: { interactionCounter: 40, journalHighWater: { envelope: 40 } },
    coopRun: { version: 1, runId, checkpointRevision: 8 },
    ...overrides,
  };
}

function loaded(session: CoopResumeSessionSummary, sessionJson = JSON.stringify(session)) {
  return { session, sessionJson };
}

beforeEach(() => clearLocalStorage());
afterEach(() => clearLocalStorage());

function clearLocalStorage(): void {
  try {
    localStorage.clear();
  } catch {
    /* jsdom-less env: the marker functions no-op on their own try/catch */
  }
}

describe("control-plane admission fails closed", () => {
  it.each([
    ["missing", undefined],
    ["fractional counter", { interactionCounter: 1.5, journalHighWater: {} }],
    ["negative counter", { interactionCounter: -1, journalHighWater: {} }],
    ["unsafe counter", { interactionCounter: Number.MAX_SAFE_INTEGER + 1, journalHighWater: {} }],
    ["null journal", { interactionCounter: 1, journalHighWater: null }],
    ["array journal", { interactionCounter: 1, journalHighWater: [] }],
    ["fractional revision", { interactionCounter: 1, journalHighWater: { "op:wave": 2.5 } }],
    ["negative revision", { interactionCounter: 1, journalHighWater: { "op:wave": -1 } }],
  ])("rejects a %s instead of normalizing it to a fresh runtime", async (_label, coopControlPlane) => {
    const session = coopSession({
      coopControlPlane: coopControlPlane as CoopResumeSessionSummary["coopControlPlane"],
    });
    await expect(deriveCoopResumeCommitment(JSON.stringify(session), session)).resolves.toBeNull();

    recordCoopResumeMarker(0, "Alice", "Bob", session.waveIndex, RUN_A, session.coopRun!.checkpointRevision);
    const discovery = await findCoopResumeCandidate("Alice", "Bob", "host", async slot =>
      slot === 0 ? loaded(session) : undefined,
    );
    expect(discovery.kind).not.toBe("candidate");
  });

  it("preserves an odd interaction counter and the greatest journal revision in the commitment", async () => {
    const session = coopSession({
      coopControlPlane: { interactionCounter: 5, journalHighWater: { "op:global": 9, "op:wave": 4 } },
    });
    const commitment = await deriveCoopResumeCommitment(JSON.stringify(session), session);
    expect(commitment).not.toBeNull();
    expect(commitment!.revision).toBe(9);
  });
});

// -----------------------------------------------------------------------------
// ATTACK 6: digest mismatch. Host offers wave-20 digest D1; the transmitted /
// local bytes digest to D2. The accepted-offer revalidation (coopResumeCommitmentMatches,
// the primitive game-data.ts applyCoopLaunchSession gates on) MUST return false so
// divergent generations can NEVER silently resume.
// -----------------------------------------------------------------------------
describe("6: digest mismatch fences the accepted resume (never silently resumes divergent bytes)", () => {
  it("returns FALSE when the bytes presented at accept-time digest differently from the offered commitment", async () => {
    const session = coopSession();
    const offeredJson = JSON.stringify(session);
    const expected = await deriveCoopResumeCommitment(offeredJson, session);
    expect(expected, "the offered commitment is well-formed").not.toBeNull();

    // Same logical session summary, but a DIFFERENT byte string (a divergent generation's save) reaches the
    // accept-time revalidation. The digest binding rejects it - no mutation is authorized.
    const divergentJson = JSON.stringify({ ...session, timestamp: 999_999 });
    await expect(
      coopResumeCommitmentMatches(divergentJson, session, expected!),
      "divergent bytes must fail the digest fence",
    ).resolves.toBe(false);

    // The exact offered bytes round-trip true (a legitimate resume is not blocked).
    await expect(coopResumeCommitmentMatches(offeredJson, session, expected!)).resolves.toBe(true);
  });

  it("distinct session generations produce distinct digests (the fence has discriminating power)", async () => {
    const d20 = await digestCoopResumeSession(JSON.stringify(coopSession({ waveIndex: 20 })));
    const d21 = await digestCoopResumeSession(JSON.stringify(coopSession({ waveIndex: 21 })));
    expect(d20).toMatch(/^[0-9a-f]{64}$/u);
    expect(d20, "a one-wave divergence changes the digest").not.toBe(d21);
  });

  it("a mismatched digest with EVERYTHING else identical still fails closed (digest is load-bearing)", async () => {
    const session = coopSession();
    const json = JSON.stringify(session);
    const expected = await deriveCoopResumeCommitment(json, session);
    // Forge a commitment identical to the real one except a foreign digest: revalidation must still refuse.
    const tampered = { ...expected!, digest: "f".repeat(64) };
    await expect(
      coopResumeCommitmentMatches(json, session, tampered),
      "an attacker/stale commitment cannot pass by matching only the metadata",
    ).resolves.toBe(false);
  });
});

// -----------------------------------------------------------------------------
// ATTACK 7: both clients hold STALE-but-EQUAL saves (both failed the final write).
// Byte-identical saves digest identically, so the fence PASSES on equality and the
// pair resumes the same stale wave - self-consistent between the two clients. The
// cross-check against the WORKER lineage/tombstone CAS (coop-durability CAS lives
// in workers/er-save-api, not in this engine-free module) is a separate layer.
// -----------------------------------------------------------------------------
describe("7: stale-but-EQUAL saves resume symmetrically (both clients agree)", () => {
  it("two byte-identical stale sessions derive the identical commitment + digest (symmetric accept)", async () => {
    const stale = coopSession({
      waveIndex: 15,
      timestamp: 150,
      coopRun: { version: 1, runId: RUN_A, checkpointRevision: 5 },
    });
    const jsonHost = JSON.stringify(stale);
    const jsonGuest = JSON.stringify(stale); // both clients frozen at the same pre-final-write bytes

    const cHost = await deriveCoopResumeCommitment(jsonHost, stale);
    const cGuest = await deriveCoopResumeCommitment(jsonGuest, stale);
    expect(cHost).not.toBeNull();
    expect(cHost!.digest, "equal stale bytes agree on the digest -> the fence passes on equality").toBe(cGuest!.digest);
    expect(cHost!.checkpointRevision).toBe(5);

    // Each side accepts the other's commitment against its own identical bytes.
    await expect(coopResumeCommitmentMatches(jsonGuest, stale, cHost!)).resolves.toBe(true);
    // NOTE (UNTESTABLE-STATICALLY here): whether wave-15 is consistent with the worker CAS high-water is
    // enforced by the cloud-save compare-and-swap in workers/er-save-api (an expectedRevision reject of a
    // stale push), not by this engine-free digest layer. The digest only guarantees the two clients agree.
  });

  it("a stale checkpointRevision below the saved run's is not offered by discovery (local marker fence)", async () => {
    // The marker records checkpointRevision 9 but the on-disk save only reached 8: discovery requires
    // marker.checkpointRevision <= saved.coopRun.checkpointRevision, so a marker CLAIMING newer-than-disk is
    // not honored (it rescans instead of resuming a phantom generation).
    recordCoopResumeMarker(1, "Alice", "Bob", 20, RUN_A, 9);
    const save = coopSession({ coopRun: { version: 1, runId: RUN_A, checkpointRevision: 8 } });
    const discovery = await findCoopResumeCandidate("Alice", "Bob", "host", async slot =>
      slot === 1 ? loaded(save) : undefined,
    );
    // The pointer over-claims, so the marker path is rejected; the scan re-recovers the REAL revision-8 save.
    expect(discovery.kind).toBe("candidate");
    if (discovery.kind === "candidate") {
      expect(discovery.candidate.checkpointRevision, "the recovered candidate reflects the on-disk revision").toBe(8);
    }
  });
});

// -----------------------------------------------------------------------------
// ATTACK 8: malformed derived resume evidence cannot roll back an exact tombstone fence.
// The corrupt hint is preserved for diagnosis, but the deleted run stays fenced and
// can no longer wedge Delete/Overwrite after the Worker has committed its tombstone.
// -----------------------------------------------------------------------------
describe("8: fail-closed tombstone lineage adoption", () => {
  it("a successful tombstone deletes the run and fences it out of future discovery", async () => {
    recordCoopResumeMarker(2, "Alice", "Bob", 30, RUN_A, 4);
    expect(recordCoopDeletedRun("Alice", RUN_A), "a clean tombstone commits").toBe(true);
    expect(isCoopRunLocallyDeleted("Alice", RUN_A)).toBe(true);

    // Discovery now skips the deleted run even though a save still exists on disk.
    const save = coopSession({ coopRun: { version: 1, runId: RUN_A, checkpointRevision: 4 } });
    const discovery = await findCoopResumeCandidate("Alice", "Bob", "host", async slot =>
      slot === 2 ? loaded(save) : undefined,
    );
    expect(discovery.kind, "a tombstoned run is never re-offered").not.toBe("candidate");
  });

  it("a malformed unrelated evidence blob cannot wedge an already-tombstoned run", async () => {
    recordCoopResumeMarker(3, "Alice", "Bob", 40, RUN_A, 6);
    // Poison the resume-marker key with a blob whose self/runId are the WRONG types (not strings).
    const malformed = JSON.stringify({ self: 123, runId: 456, slot: 3 });
    localStorage.setItem("er-coop-resume", malformed);

    const committed = recordCoopDeletedRun("Alice", RUN_A);
    expect(committed, "the exact run fence commits independently of a derived resume hint").toBe(true);
    expect(isCoopRunLocallyDeleted("Alice", RUN_A), "the run is durably fenced").toBe(true);
    expect(localStorage.getItem("er-coop-resume"), "unknown evidence is preserved rather than guessed away").toBe(
      malformed,
    );
    expect(recordCoopDeletedRun("Alice", RUN_A), "a repeated tombstone adoption stays idempotent").toBe(true);

    const save = coopSession({ coopRun: { version: 1, runId: RUN_A, checkpointRevision: 4 } });
    const discovery = await findCoopResumeCandidate("Alice", "Bob", "host", async slot =>
      slot === 3 ? loaded(save) : undefined,
    );
    expect(discovery.kind, "the stale local replica cannot be re-offered").not.toBe("candidate");
  });

  it("a wholly-unparseable evidence blob is preserved without blocking the exact run fence", () => {
    const malformed = "{ this is : not json";
    localStorage.setItem("er-coop-resume", malformed);
    expect(() => recordCoopDeletedRun("Alice", RUN_A), "a garbage blob is handled, not thrown").not.toThrow();
    expect(isCoopRunLocallyDeleted("Alice", RUN_A)).toBe(true);
    expect(localStorage.getItem("er-coop-resume")).toBe(malformed);
  });
});

// -----------------------------------------------------------------------------
// ATTACK 9: is the digest computed over a CANONICAL serialization? A false-negative
// (semantically-equal saves that serialize to different bytes) would block every
// legitimate resume. It does NOT, because the digest binds the SAME transmitted
// byte string on both ends (a transit-integrity / freeze binding), not two
// independently-serialized saves - so canonicalization is not required.
// -----------------------------------------------------------------------------
describe("9: digest is a byte-exact transit-integrity binding (not a cross-serialization equality)", () => {
  it("the digest is whitespace/byte sensitive - proving both ends MUST hash the identical transmitted bytes", async () => {
    const session = coopSession();
    const compact = JSON.stringify(session);
    const padded = `  ${compact}\n`; // same logical session, different bytes
    const dCompact = await digestCoopResumeSession(compact);
    const dPadded = await digestCoopResumeSession(padded);
    expect(dCompact, "a byte difference changes the digest").not.toBe(dPadded);
    // The commitment derived from the padded bytes matches ONLY when revalidated against those exact bytes -
    // i.e. the guest must hash the host's transmitted raw string, never a local re-serialization.
    const expectedPadded = await deriveCoopResumeCommitment(padded, session);
    await expect(coopResumeCommitmentMatches(padded, session, expectedPadded!)).resolves.toBe(true);
    await expect(
      coopResumeCommitmentMatches(compact, session, expectedPadded!),
      "re-serialized (canonical-order-differing) bytes would false-negative - hence identical bytes are transmitted+hashed",
    ).resolves.toBe(false);
  });

  it("a key-reordered re-serialization of the same session digests differently (canonicalization is NOT relied upon)", async () => {
    // Two objects with identical fields but different key insertion order serialize to different bytes and thus
    // different digests. This is WHY the protocol transmits the host's exact bytes for the guest to hash rather
    // than comparing two independently-serialized saves - the design sidesteps the canonicalization hazard.
    const a = JSON.stringify({ gameMode: GameModes.COOP, waveIndex: 20, timestamp: 200 });
    const b = JSON.stringify({ timestamp: 200, waveIndex: 20, gameMode: GameModes.COOP });
    expect(a).not.toBe(b);
    await expect(digestCoopResumeSession(a)).resolves.not.toBe(await digestCoopResumeSession(b));
  });
});
