/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Deterministic identity normalization for co-op persistence/protocol comparisons.
 *
 * Account signaling currently exposes usernames, not immutable authenticated account IDs. NFKC +
 * Unicode lowercase therefore gives both browsers one locale-independent ordering/equality rule,
 * but a future opaque account id must replace usernames to make seat identity rename-proof.
 */
export function normalizeCoopIdentity(identity: string): string {
  return identity.normalize("NFKC").toLowerCase();
}

export function sameCoopIdentity(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string"
    && typeof right === "string"
    && normalizeCoopIdentity(left) === normalizeCoopIdentity(right)
  );
}

/** Compare normalized UTF-16 code units; never consult the machine/browser locale. */
export function compareCoopIdentities(left: string, right: string): number {
  const a = normalizeCoopIdentity(left);
  const b = normalizeCoopIdentity(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalCoopParticipantPair(self: string, partner: string): [string, string] {
  return compareCoopIdentities(self, partner) <= 0 ? [self, partner] : [partner, self];
}

export function isCoopRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/u.test(value);
}

export function mintCoopRunId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
