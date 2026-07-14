/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Unit tests for the multi-staff-safe custom-trainers merge core (the pure,
// Cloudflare-free helpers the er-editor-api Worker's /save path delegates to).
// No Worker runtime / GitHub calls: read + write are injected as fakes.
//
// Covers: merge preserves unmentioned trainers, explicit-null deletion is
// honored (never inferred by absence), NEW trainers get monotonic server ids,
// a stale-baseline MODIFICATION is rejected per-trainer while the rest apply,
// and the sha-conditional retry loop retries on 409 and is bounded.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  type CustomTrainersRead,
  type CustomTrainersWrite,
  commitCustomTrainersWithRetry,
  ER_CUSTOM_TRAINER_ID_MAX,
  hashTrainerEntry,
  mergeCustomTrainersDelta,
} from "../../../../workers/er-editor-api/src/custom-trainers-merge";

/** A minimal trainer entry (only the fields the merge core touches). */
function trainer(id: number, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name, trainerClass: "ACE_TRAINER", team: [{ species: 25 }], ...extra };
}

describe("custom-trainers merge core (worker)", () => {
  it("preserves trainers absent from the delta (per-trainer merge, no clobber)", () => {
    const existing = { A: trainer(70001, "Alpha"), B: trainer(70002, "Bravo") };
    // The delta only mentions B (modification). A must survive verbatim.
    const baselines = { B: hashTrainerEntry(existing.B) };
    const delta = { B: trainer(70002, "Bravo v2") };
    const { merged, conflicts } = mergeCustomTrainersDelta(existing, delta, baselines);
    expect(conflicts).toEqual([]);
    expect(merged.A).toEqual(existing.A); // untouched, verbatim
    expect((merged.B as { name: string }).name).toBe("Bravo v2");
  });

  it("honors an EXPLICIT null deletion (never infers deletion from absence)", () => {
    const existing = { A: trainer(70001, "Alpha"), B: trainer(70002, "Bravo") };
    // Delete A explicitly; B is not mentioned at all -> B must be PRESERVED
    // (absence must NOT delete — that was the clobber bug).
    const { merged } = mergeCustomTrainersDelta(existing, { A: null }, {});
    expect(merged.A).toBeUndefined();
    expect(merged.B).toEqual(existing.B);
  });

  it("server-assigns monotonic ids to NEW trainers (ignoring the client provisional id)", () => {
    const existing = { A: trainer(70005, "Alpha") };
    // Two new trainers, both with a colliding client provisional id (70001) and
    // NO baseline. The worker allocates max(70005)+1, +2.
    const delta = {
      NEW1: trainer(70001, "New One"),
      NEW2: trainer(70001, "New Two"),
    };
    const { merged, idRemap, conflicts } = mergeCustomTrainersDelta(existing, delta, {});
    expect(conflicts).toEqual([]);
    expect(idRemap.NEW1).toBe(70006);
    expect(idRemap.NEW2).toBe(70007);
    expect((merged.NEW1 as { id: number }).id).toBe(70006);
    expect((merged.NEW2 as { id: number }).id).toBe(70007);
    // Distinct ids -> the collision is resolved.
    expect(idRemap.NEW1).not.toBe(idRemap.NEW2);
  });

  it("starts new-trainer ids at 70001 when the file is empty", () => {
    const { idRemap } = mergeCustomTrainersDelta({}, { NEW: trainer(1, "New") }, {});
    expect(idRemap.NEW).toBe(70001);
  });

  it("rejects a NEW trainer when the id window is full (per-trainer conflict)", () => {
    const existing = { FULL: trainer(ER_CUSTOM_TRAINER_ID_MAX, "Full") };
    const { merged, idRemap, conflicts } = mergeCustomTrainersDelta(existing, { NEW: trainer(1, "New") }, {});
    expect(idRemap.NEW).toBeUndefined();
    expect(merged.NEW).toBeUndefined();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe("NEW");
    expect(conflicts[0].error).toMatch(/window/);
  });

  it("rejects a stale-baseline MODIFICATION per-trainer, applying the non-conflicting rest", () => {
    // Repo has A and B. A was changed by a teammate SINCE this client loaded (the
    // client's baseline hash is of the OLD A), so the client's edit to A must be
    // rejected — while its edit to B (baseline matches the current repo) applies.
    const existing = { A: trainer(70001, "Alpha CURRENT"), B: trainer(70002, "Bravo") };
    const staleBaselineA = hashTrainerEntry(trainer(70001, "Alpha OLD"));
    const baselines = { A: staleBaselineA, B: hashTrainerEntry(existing.B) };
    const delta = { A: trainer(70001, "Alpha MINE"), B: trainer(70002, "Bravo v2") };
    const { merged, conflicts } = mergeCustomTrainersDelta(existing, delta, baselines);
    // A rejected, its repo version untouched.
    expect(conflicts.map(c => c.key)).toEqual(["A"]);
    expect(conflicts[0].error).toMatch(/modified by someone else/);
    expect((merged.A as { name: string }).name).toBe("Alpha CURRENT");
    // B applied.
    expect((merged.B as { name: string }).name).toBe("Bravo v2");
  });

  it("keeps the REPO id on a modification (ignores client id drift)", () => {
    const existing = { A: trainer(70001, "Alpha") };
    const baselines = { A: hashTrainerEntry(existing.A) };
    // Client sends a drifted id; the merge must keep the repo id 70001.
    const { merged } = mergeCustomTrainersDelta(existing, { A: trainer(79999, "Alpha v2") }, baselines);
    expect((merged.A as { id: number }).id).toBe(70001);
    expect((merged.A as { name: string }).name).toBe("Alpha v2");
  });

  it("rejects a NEW trainer whose key was created by someone else (collision)", () => {
    // Client thinks NEW is new (no baseline) but the repo already has that key
    // (a teammate created it). Reject rather than clobber their trainer.
    const existing = { NEW: trainer(70003, "Theirs") };
    const { merged, conflicts } = mergeCustomTrainersDelta(existing, { NEW: trainer(70001, "Mine") }, {});
    expect(conflicts.map(c => c.key)).toEqual(["NEW"]);
    expect((merged.NEW as { name: string }).name).toBe("Theirs");
  });

  // ---- sha-conditional retry loop -----------------------------------------
  it("retries the read-merge-write loop on a 409 and succeeds", async () => {
    let reads = 0;
    let writes = 0;
    const read = async (): Promise<CustomTrainersRead> => {
      reads++;
      return { sha: `sha-${reads}`, existing: {} };
    };
    const write = async (_content: string, _sha: string | undefined): Promise<CustomTrainersWrite> => {
      writes++;
      // First PUT loses the race (409); the second succeeds.
      return writes < 2 ? { ok: false, conflict: true, error: "409 conflict" } : { ok: true };
    };
    const result = await commitCustomTrainersWithRetry({
      read,
      write,
      merge: existing => mergeCustomTrainersDelta(existing, { NEW: trainer(1, "N") }, {}),
      serialize: merged => JSON.stringify(merged),
      maxAttempts: 3,
    });
    expect(result.ok).toBe(true);
    expect(reads).toBe(2); // re-read before the retry
    expect(writes).toBe(2);
    if (result.ok) {
      expect(result.committed).toBe(true);
      expect(result.idRemap.NEW).toBe(70001);
    }
  });

  it("is bounded: exhausts after maxAttempts of persistent 409s", async () => {
    let writes = 0;
    const result = await commitCustomTrainersWithRetry({
      read: async () => ({ sha: "sha", existing: {} }),
      write: async () => {
        writes++;
        return { ok: false, conflict: true, error: "409 conflict" };
      },
      merge: existing => mergeCustomTrainersDelta(existing, { NEW: trainer(1, "N") }, {}),
      serialize: merged => JSON.stringify(merged),
      maxAttempts: 3,
    });
    expect(result.ok).toBe(false);
    expect(writes).toBe(3); // exactly maxAttempts, then gives up
    if (!result.ok) {
      expect(result.error).toMatch(/409|exhausted/);
    }
  });

  it("skips the write (no pointless commit) when every touched trainer conflicts", async () => {
    let writes = 0;
    const existing = { A: trainer(70001, "Alpha CURRENT") };
    const result = await commitCustomTrainersWithRetry({
      read: async () => ({ sha: "sha", existing }),
      write: async () => {
        writes++;
        return { ok: true };
      },
      merge: e =>
        // Stale baseline -> A rejected -> merged === existing.
        mergeCustomTrainersDelta(e, { A: trainer(70001, "Mine") }, { A: hashTrainerEntry(trainer(70001, "OLD")) }),
      serialize: merged => JSON.stringify(merged),
      isUnchanged: (merged, e) => JSON.stringify(merged) === JSON.stringify(e),
      maxAttempts: 3,
    });
    expect(result.ok).toBe(true);
    expect(writes).toBe(0); // nothing committed
    if (result.ok) {
      expect(result.committed).toBe(false);
      expect(result.conflicts).toHaveLength(1);
    }
  });

  it("does NOT retry on a non-conflict (fatal) write error", async () => {
    let writes = 0;
    const result = await commitCustomTrainersWithRetry({
      read: async () => ({ sha: "sha", existing: {} }),
      write: async () => {
        writes++;
        return { ok: false, conflict: false, error: "500 server error" };
      },
      merge: e => mergeCustomTrainersDelta(e, { NEW: trainer(1, "N") }, {}),
      serialize: merged => JSON.stringify(merged),
      maxAttempts: 3,
    });
    expect(result.ok).toBe(false);
    expect(writes).toBe(1); // no retry on a fatal error
  });
});
