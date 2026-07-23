/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Run-scoped custom-trainer history. This stays dependency-free so session
 * persistence can read and restore it without importing the full trainer
 * registry and its game-scene dependencies.
 */
const usedCustomTrainerKeys = new Set<string>();
const usedCustomTrainerWindows = new Set<number>();

/** Reset all custom-trainer history when a genuinely new run starts. */
export function resetErCustomTrainerTracking(): void {
  usedCustomTrainerKeys.clear();
  usedCustomTrainerWindows.clear();
}

/** Clear only window history when a test swaps spawn configuration. */
export function resetErCustomTrainerWindowTracking(): void {
  usedCustomTrainerWindows.clear();
}

/** Mark a custom trainer as fielded in this run. */
export function markErCustomTrainerUsed(key: string): void {
  if (key.length > 0) {
    usedCustomTrainerKeys.add(key);
  }
}

/** Mark a zero-based spawn window as consumed in this run. */
export function markErCustomTrainerWindowUsed(windowIndex: number): void {
  if (Number.isInteger(windowIndex) && windowIndex >= 0) {
    usedCustomTrainerWindows.add(windowIndex);
  }
}

export function hasErCustomTrainerBeenUsed(key: string): boolean {
  return usedCustomTrainerKeys.has(key);
}

export function hasErCustomTrainerWindowBeenUsed(windowIndex: number): boolean {
  return usedCustomTrainerWindows.has(windowIndex);
}

/** Snapshot used trainer keys for session persistence. */
export function getErUsedCustomTrainerKeys(): string[] {
  return [...usedCustomTrainerKeys];
}

/** Snapshot consumed spawn windows for session persistence. */
export function getErUsedCustomTrainerWindows(): number[] {
  return [...usedCustomTrainerWindows];
}

/**
 * Replace in-memory history with a session snapshot. Missing fields are valid
 * for saves created before custom-trainer history was persisted.
 */
export function restoreErCustomTrainerTracking(
  keys: readonly string[] | undefined,
  windows: readonly number[] | undefined,
): void {
  resetErCustomTrainerTracking();
  for (const key of keys ?? []) {
    if (typeof key === "string" && key.length > 0) {
      usedCustomTrainerKeys.add(key);
    }
  }
  for (const windowIndex of windows ?? []) {
    if (Number.isInteger(windowIndex) && windowIndex >= 0) {
      usedCustomTrainerWindows.add(windowIndex);
    }
  }
}
