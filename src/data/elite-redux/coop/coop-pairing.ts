/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op pairing codes (#633, P5/P6). A short, human-shareable code the host hands
// to the guest (typed or pasted) to pair their two clients through the signaling
// worker. Pure string logic - no crypto, no engine - so the FORMAT rules are
// shared between the client and the worker and are fully unit-testable. The worker
// generates the random bytes (crypto.getRandomValues) and maps them with
// `pairingCodeFromBytes`; the client validates user input with `isValidPairingCode`.
// =============================================================================

/**
 * Code alphabet: 31 unambiguous chars - no 0/O/1/I/L so a code read aloud or
 * retyped can't be confused (A-Z minus I/L/O, then 2-9). A byte is mapped to a
 * char by `byte % 31`; the tiny modulo bias is irrelevant for a pairing code
 * (uniqueness is enforced server-side by retrying on a primary-key collision).
 */
export const COOP_PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Pairing-code length (6 chars over a 31-symbol alphabet ~= 8.9e8 codes). */
export const COOP_PAIRING_CODE_LENGTH = 6;

/**
 * Normalize a user-typed code: uppercase and drop everything not in the alphabet
 * (so "abcd-23" / "ABCD 23" / "abcd23" all converge). Does NOT enforce length.
 */
export function normalizePairingCode(raw: string): string {
  const upper = raw.toUpperCase();
  let out = "";
  for (const ch of upper) {
    if (COOP_PAIRING_ALPHABET.includes(ch)) {
      out += ch;
    }
  }
  return out;
}

/** Whether `raw` normalizes to a syntactically valid pairing code. */
export function isValidPairingCode(raw: string): boolean {
  return normalizePairingCode(raw).length === COOP_PAIRING_CODE_LENGTH;
}

/**
 * Deterministically map random `bytes` to a pairing code (the worker passes
 * `crypto.getRandomValues(new Uint8Array(COOP_PAIRING_CODE_LENGTH))`). Each byte
 * picks one alphabet char by `byte % 32`. Throws if fewer than
 * {@linkcode COOP_PAIRING_CODE_LENGTH} bytes are supplied.
 */
export function pairingCodeFromBytes(bytes: Uint8Array | readonly number[]): string {
  if (bytes.length < COOP_PAIRING_CODE_LENGTH) {
    throw new Error(`pairingCodeFromBytes needs >= ${COOP_PAIRING_CODE_LENGTH} bytes`);
  }
  const n = COOP_PAIRING_ALPHABET.length; // 31
  let out = "";
  for (let i = 0; i < COOP_PAIRING_CODE_LENGTH; i++) {
    out += COOP_PAIRING_ALPHABET[bytes[i] % n];
  }
  return out;
}

/** Format a code for display, grouped for readability (e.g. "ABC-DEF"). */
export function formatPairingCode(code: string): string {
  const c = normalizePairingCode(code);
  const mid = Math.ceil(c.length / 2);
  return `${c.slice(0, mid)}-${c.slice(mid)}`;
}
