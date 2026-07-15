/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Persistent co-op control state required to continue ownership and operation ordering after a cold resume. */
export interface CoopControlPlaneSaveData {
  interactionCounter: number;
  journalHighWater: Record<string, number>;
}

/** Strict validator for untrusted save bytes. Invalid control state must never normalize to a fresh runtime. */
export function isCoopControlPlaneSaveData(value: unknown): value is CoopControlPlaneSaveData {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.interactionCounter) || (candidate.interactionCounter as number) < 0) {
    return false;
  }
  const marks = candidate.journalHighWater;
  if (marks == null || typeof marks !== "object" || Array.isArray(marks)) {
    return false;
  }
  return Object.entries(marks).every(
    ([key, revision]) => key.length > 0 && Number.isSafeInteger(revision) && (revision as number) >= 0,
  );
}
