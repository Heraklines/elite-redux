/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op pairing codes (#633, P5/P6): the short host->guest code format. Pure
// string logic shared by the client (validation) and the worker (generation).

import {
  COOP_PAIRING_ALPHABET,
  COOP_PAIRING_CODE_LENGTH,
  formatPairingCode,
  isValidPairingCode,
  normalizePairingCode,
  pairingCodeFromBytes,
} from "#data/elite-redux/coop/coop-pairing";
import { describe, expect, it } from "vitest";

describe("co-op pairing codes (#633, P5)", () => {
  it("uses an unambiguous alphabet with no 0/O/1/I/L", () => {
    for (const bad of ["0", "O", "1", "I", "L"]) {
      expect(COOP_PAIRING_ALPHABET.includes(bad)).toBe(false);
    }
    // No duplicate symbols.
    expect(new Set(COOP_PAIRING_ALPHABET).size).toBe(COOP_PAIRING_ALPHABET.length);
  });

  it("normalizes user input: uppercases and strips separators/invalid chars", () => {
    expect(normalizePairingCode("abc-23k")).toBe("ABC23K");
    expect(normalizePairingCode("a b c 2 3 k")).toBe("ABC23K");
    // Ambiguous chars a user might type are dropped (not silently mapped).
    expect(normalizePairingCode("O0Il1")).toBe("");
  });

  it("validates a code by its normalized length", () => {
    expect(isValidPairingCode("ABC23K")).toBe(true);
    expect(isValidPairingCode("abc-23k")).toBe(true); // normalizes to 6
    expect(isValidPairingCode("ABC23")).toBe(false); // too short
    expect(isValidPairingCode("ABC23KK")).toBe(false); // too long
  });

  it("maps bytes deterministically to a valid code (byte % alphabet length)", () => {
    const n = COOP_PAIRING_ALPHABET.length;
    // Bytes 0,1,2,... pick alphabet[0],[1],[2],...
    const code = pairingCodeFromBytes([0, 1, 2, 3, 4, 5]);
    expect(code).toBe(COOP_PAIRING_ALPHABET.slice(0, 6));
    expect(code).toHaveLength(COOP_PAIRING_CODE_LENGTH);
    expect(isValidPairingCode(code)).toBe(true);
    // The modulo wraps: byte n maps to alphabet[0] again.
    expect(pairingCodeFromBytes([n, n + 1, 0, 0, 0, 0])[0]).toBe(COOP_PAIRING_ALPHABET[0]);
    expect(pairingCodeFromBytes([n, n + 1, 0, 0, 0, 0])[1]).toBe(COOP_PAIRING_ALPHABET[1]);
  });

  it("throws when given too few bytes", () => {
    expect(() => pairingCodeFromBytes([1, 2, 3])).toThrow();
  });

  it("formats a code grouped for display", () => {
    expect(formatPairingCode("ABC23K")).toBe("ABC-23K");
  });
});
