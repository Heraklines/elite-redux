/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-staff-safe merge for er-custom-trainers.json (Cloudflare Worker /save).
//
// The editor mints new-trainer ids CLIENT-side and posts a DELTA of only the
// trainers it touched. With two staff editing at once that path clobbers:
//   - two clients mint the SAME provisional id (both saw max=70000) -> colliding
//     ids in the committed file, and
//   - a client that loaded BEFORE a teammate's save has a stale view; a naive
//     whole-file write drops the teammate's trainers.
//
// This module holds the PURE (Cloudflare-free) merge core so it is unit-testable
// without a Worker runtime:
//   - `mergeCustomTrainersDelta` applies ONLY the trainers in the delta onto the
//     CURRENT repo map (unmentioned trainers preserved verbatim); DELETION is an
//     explicit `null` marker, NEVER inferred by absence (absence-means-delete is
//     the clobber bug); NEW trainers (no client baseline) get a SERVER-assigned
//     id = max existing id + 1 within the 70000-79999 window, returned as a
//     remap; and a MODIFIED trainer whose repo version drifted from the client's
//     load-time baseline hash is REJECTED per-trainer (conflict) while the rest
//     still apply.
//   - `commitCustomTrainersWithRetry` wraps read -> merge -> sha-conditional
//     write in a bounded retry loop so a lost read/write race (GitHub 409) is
//     retried, never silently dropping a merge.
// =============================================================================

/** Reserved id band for editor-created custom trainers (mirrors the game). */
export const ER_CUSTOM_TRAINER_ID_MIN = 70000;
export const ER_CUSTOM_TRAINER_ID_MAX = 79999;

/**
 * Deterministic, key-sorted JSON string of a value (order-independent), so two
 * logically-equal trainer entries hash identically regardless of key order or
 * source whitespace. Mirrored byte-for-byte in editor/app.js (`ctrStableStringify`).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Stable FNV-1a (32-bit) hex hash of a trainer entry's canonical JSON. The editor
 * sends `hashTrainerEntry(loadedEntry)` per trainer as the conflict baseline; the
 * worker compares it to `hashTrainerEntry(currentRepoEntry)`. Mirrored in the editor.
 */
export function hashTrainerEntry(entry: unknown): string {
  const s = stableStringify(entry);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** A per-trainer save rejection (applied to the non-conflicting rest regardless). */
export interface CustomTrainerConflict {
  key: string;
  error: string;
}

export interface CustomTrainersMergeResult {
  /** The merged map to commit (unmentioned trainers preserved verbatim). */
  merged: Record<string, unknown>;
  /** ORIGINAL client trainerKey -> SERVER-assigned real id, for the NEW trainers the worker minted. */
  idRemap: Record<string, number>;
  /**
   * ORIGINAL client trainerKey -> the NEW key the worker committed it under, for a
   * NEW trainer whose key COLLIDED with a teammate's existing trainer. The worker
   * re-keys such a trainer to `TRAINER_<realId>` (never rejects a NEW trainer on a
   * same-key collision); the editor adopts the new key into local state.
   */
  keyRemap: Record<string, string>;
  /** Per-trainer rejections (stale-baseline conflict on a MODIFICATION, or full window). */
  conflicts: CustomTrainerConflict[];
}

/** The highest in-window id currently used across an existing trainer map. */
function highestInWindowId(existing: Record<string, unknown>): number {
  let maxId = ER_CUSTOM_TRAINER_ID_MIN;
  for (const value of Object.values(existing)) {
    const id = (value as { id?: unknown } | null)?.id;
    if (
      typeof id === "number"
      && Number.isInteger(id)
      && id >= ER_CUSTOM_TRAINER_ID_MIN
      && id <= ER_CUSTOM_TRAINER_ID_MAX
    ) {
      maxId = Math.max(maxId, id);
    }
  }
  return maxId;
}

/**
 * Apply a client `delta` (trainerKey -> entry | null) onto the CURRENT repo map.
 *   - `null` value => explicit DELETE (never inferred from absence),
 *   - a key with a client `baselines[key]` => MODIFICATION: rejected as a conflict
 *     if the repo version's hash != the baseline (someone else changed it since
 *     the client loaded), else applied verbatim keeping the REPO id,
 *   - a key with NO baseline => NEW trainer: gets a server-assigned id = max
 *     existing id + 1 within the window (rejected only if the window is full). If
 *     its key already exists in the repo (a teammate created a trainer under the
 *     same provisional `TRAINER_<id>` key meanwhile), it is RE-KEYED to
 *     `TRAINER_<realId>` and BOTH survive — a NEW trainer is never rejected on a
 *     same-key collision.
 * Trainers absent from the delta are preserved. Pure; deterministic.
 */
export function mergeCustomTrainersDelta(
  existing: Record<string, unknown>,
  delta: Record<string, unknown>,
  baselines: Record<string, string> | undefined,
): CustomTrainersMergeResult {
  const merged: Record<string, unknown> = { ...existing };
  const idRemap: Record<string, number> = {};
  const keyRemap: Record<string, string> = {};
  const conflicts: CustomTrainerConflict[] = [];
  const base = baselines ?? {};
  let maxId = highestInWindowId(existing);

  for (const [key, value] of Object.entries(delta)) {
    if (value === null) {
      // Explicit deletion (last-write-wins on delete; the file-level sha retry
      // guarantees no OTHER trainer is dropped alongside it).
      delete merged[key];
      continue;
    }
    const hasBaseline = Object.hasOwn(base, key);
    const inRepo = Object.hasOwn(existing, key);

    if (hasBaseline) {
      // MODIFICATION of a trainer that existed when the client loaded.
      if (!inRepo) {
        conflicts.push({
          key,
          error: `${key}: deleted by someone else since you loaded - reload to get the current state`,
        });
        continue;
      }
      if (hashTrainerEntry(existing[key]) !== base[key]) {
        conflicts.push({
          key,
          error: `${key}: modified by someone else since you loaded - reload to get their version`,
        });
        continue;
      }
      // Apply verbatim, but keep the REPO id (ignore any client id drift).
      const repoId = (existing[key] as { id?: unknown }).id;
      merged[key] = typeof repoId === "number" ? { ...(value as Record<string, unknown>), id: repoId } : value;
      continue;
    }

    // NEW trainer (client had no baseline for it): mint a server id. A same-key
    // collision with a teammate's trainer NEVER rejects - the trainer is re-keyed
    // to TRAINER_<realId> so both survive.
    if (maxId + 1 > ER_CUSTOM_TRAINER_ID_MAX) {
      conflicts.push({
        key,
        error: `${key}: custom-trainer id window ${ER_CUSTOM_TRAINER_ID_MIN}-${ER_CUSTOM_TRAINER_ID_MAX} is full`,
      });
      continue;
    }
    maxId += 1;
    const newId = maxId;
    let targetKey = key;
    if (inRepo) {
      // Derive a fresh key from the allocated id. Guard against the (astronomically
      // unlikely) case the derived key is itself already taken by advancing the id.
      targetKey = `TRAINER_${newId}`;
      let windowFull = false;
      while (Object.hasOwn(merged, targetKey)) {
        if (maxId + 1 > ER_CUSTOM_TRAINER_ID_MAX) {
          windowFull = true;
          break;
        }
        maxId += 1;
        targetKey = `TRAINER_${maxId}`;
      }
      if (windowFull) {
        conflicts.push({
          key,
          error: `${key}: custom-trainer id window ${ER_CUSTOM_TRAINER_ID_MIN}-${ER_CUSTOM_TRAINER_ID_MAX} is full`,
        });
        continue;
      }
      keyRemap[key] = targetKey;
    }
    const committedId = maxId;
    idRemap[key] = committedId;
    merged[targetKey] = { ...(value as Record<string, unknown>), id: committedId };
  }

  return { merged, idRemap, keyRemap, conflicts };
}

// --- sha-conditional read -> merge -> write with bounded retry ---------------

/** One repo read: the current file sha + parsed trainer map, or a fatal error. */
export type CustomTrainersRead = { sha?: string; existing: Record<string, unknown> } | { error: string };

/** One conditional write outcome: ok, a retryable sha conflict (409), or fatal. */
export type CustomTrainersWrite = { ok: true } | { ok: false; conflict: boolean; error: string };

export interface CommitWithRetryOptions {
  /** Read the current file (sha + parsed map). Re-run each attempt. */
  read: () => Promise<CustomTrainersRead>;
  /** Merge the delta onto a freshly-read map (pure; usually mergeCustomTrainersDelta). */
  merge: (existing: Record<string, unknown>) => CustomTrainersMergeResult;
  /** Serialize the merged map to the exact file text to commit. */
  serialize: (merged: Record<string, unknown>) => string;
  /** sha-conditional PUT; `conflict: true` on a 409 (someone else committed first). */
  write: (content: string, sha: string | undefined) => Promise<CustomTrainersWrite>;
  /** Skip the write entirely when the merge is a no-op (nothing to commit). */
  isUnchanged?: (merged: Record<string, unknown>, existing: Record<string, unknown>) => boolean;
  /** Max read-merge-write attempts before giving up (default 3). */
  maxAttempts?: number;
}

export type CommitWithRetryResult =
  | {
      ok: true;
      idRemap: Record<string, number>;
      keyRemap: Record<string, string>;
      conflicts: CustomTrainerConflict[];
      committed: boolean;
    }
  | { ok: false; error: string };

/**
 * Read -> merge -> sha-conditional write, retrying the WHOLE loop on a 409 (a
 * teammate committed between our read and write). Bounded to `maxAttempts` so a
 * pathological conflict storm can't spin forever. The merge is recomputed against
 * the freshly-read map each attempt, so id allocation stays monotonic against the
 * latest repo and no merge is ever silently dropped.
 */
export async function commitCustomTrainersWithRetry(opts: CommitWithRetryOptions): Promise<CommitWithRetryResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastError = "sha conflict: retries exhausted";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const read = await opts.read();
    if ("error" in read) {
      return { ok: false, error: read.error };
    }
    const { merged, idRemap, keyRemap, conflicts } = opts.merge(read.existing);
    if (opts.isUnchanged?.(merged, read.existing)) {
      // Nothing to commit (e.g. every touched trainer conflicted). Surface the
      // conflicts without a pointless empty commit.
      return { ok: true, idRemap, keyRemap, conflicts, committed: false };
    }
    const write = await opts.write(opts.serialize(merged), read.sha);
    if (write.ok) {
      return { ok: true, idRemap, keyRemap, conflicts, committed: true };
    }
    if (!write.conflict) {
      return { ok: false, error: write.error };
    }
    lastError = write.error; // 409 -> re-read and retry
  }
  return { ok: false, error: lastError };
}
