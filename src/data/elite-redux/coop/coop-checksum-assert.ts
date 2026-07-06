/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Co-op per-turn checksum ASSERTION gate (#838, Phase 5 - the finale of the full-state refactor).
 *
 * Once full-state turn replication carries the COMPLETE authoritative battle state every finalize
 * (both parties as `PokemonData` incl. `summonData`, seating, modifiers, arena, money, PP by
 * construction through the serialized `PokemonMove.ppUsed`), a per-turn checksum mismatch is NO
 * LONGER an EXPECTED recovery event - it is a protocol / apply BUG. This module flips that mismatch
 * from a silent auto-heal into a LOUD, COUNTED assertion:
 *
 *  - every mismatch emits a screaming `[coop:ASSERT]` line with the full field-by-field diff (reusing
 *    the SAME {@linkcode collectCanonicalDiff} sub-diff machinery the `[coop-cs]` diagnostic uses),
 *  - every mismatch is COUNTED - the count is surfaced in the #808 health line and read by the soak /
 *    duo harness as its `assertions` metric (a converged run is `assertions=0`),
 *  - the run STILL heals ONCE as a safety net (the caller's `requestStateSync` path stays), so a live
 *    player is NEVER stranded. `stateSync` is now a RARE-FAULT path, not the normal-turn healer.
 *
 * SEVERITY is gated by a flag: `"assert"` (loud - `console.error`, the test-reddening default under
 * vitest / soak) vs `"log"` (production - `console.warn`, until the maintainer flips it). BOTH modes
 * count AND heal; only the emitted log LEVEL differs. The count is the actual gate the harness reads,
 * so the flag purely controls how noisy a live mismatch is in the console.
 */

import { collectCanonicalDiff } from "#data/elite-redux/coop/coop-data-fingerprint";

/** How loud a checksum mismatch is: `"assert"` = `console.error` (loud), `"log"` = `console.warn`. */
export type CoopAssertSeverity = "assert" | "log";

/**
 * Detect the DEFAULT severity from the environment. Under vitest / the ER soak harness we want the
 * loud `console.error` (so a live mismatch stands out and the counted-assertion gate reds a soak);
 * in a production browser build there is no `process.env`, so we fall back to `"log"` - the maintainer
 * flips production to `"assert"` later once the payload has proven itself live.
 */
function detectDefaultSeverity(): CoopAssertSeverity {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    if (proc?.env != null && (proc.env.VITEST != null || proc.env.ER_SCENARIO != null)) {
      return "assert";
    }
  } catch {
    /* no process (browser / prod): fall through to the log-only default */
  }
  return "log";
}

let severity: CoopAssertSeverity = detectDefaultSeverity();
let assertionCount = 0;

/** The current checksum-assertion severity. */
export function getCoopChecksumAssertSeverity(): CoopAssertSeverity {
  return severity;
}

/**
 * Set the checksum-assertion severity. The soak / duo harness pins `"assert"` explicitly so a run is
 * loud regardless of how it was launched; production stays `"log"` until the maintainer flips it.
 */
export function setCoopChecksumAssertSeverity(mode: CoopAssertSeverity): void {
  severity = mode;
}

/** How many per-turn checksum assertions have fired since the last reset (surfaced in the health line). */
export function getCoopChecksumAssertionCount(): number {
  return assertionCount;
}

/**
 * Reset the assertion counter to zero. A harness (soak / PP-proof duo) resets before a run so it can
 * read the count back as its `assertions` metric with no cross-test bleed (the ER suite shares module
 * state across files with `isolate: false`).
 */
export function resetCoopChecksumAssertionCount(): void {
  assertionCount = 0;
}

/**
 * Record ONE per-turn checksum assertion: increment the counter and emit the loud `[coop:ASSERT]` line
 * plus the field-by-field diff at the current severity. `host` / `guest` are the two JSON-parsed
 * canonical checksum-state objects (the host's streamed pre-image and the guest's own recompute); when
 * either is absent (an older host that streamed no pre-image, or a read failure) the header still prints
 * and counts, only the leaf diff is skipped. Returns the NEW assertion count so the caller can log it.
 * Never throws - an assertion-logging failure must never crash the guest's battle.
 */
export function recordCoopChecksumAssertion(tag: string, host: unknown, guest: unknown): number {
  assertionCount++;
  // "assert" is loud (console.error); "log" is the production-safe console.warn. Both still count + heal.
  const emit = severity === "assert" ? console.error : console.warn;
  try {
    emit(
      `[coop:ASSERT] ${tag} CHECKSUM MISMATCH #${assertionCount} (severity=${severity}): the full-state`
        + " authoritative payload FAILED to converge - this is a protocol/apply BUG, not an expected heal."
        + " Healing ONCE as a safety net so no live player is stranded.",
    );
    if (host === undefined || guest === undefined) {
      emit("  (no host pre-image to diff - older host / read failure; the mismatch is counted regardless)");
      return assertionCount;
    }
    const { lines, truncated } = collectCanonicalDiff(host, guest);
    if (lines.length === 0) {
      emit("  (no leaf differences found - structural / already converged, or a hash-only transient)");
      return assertionCount;
    }
    emit(`  ${lines.length}${truncated ? "+" : ""} differing field(s):`);
    for (const line of lines) {
      emit(line);
    }
  } catch {
    /* an assertion-logging failure must never crash the guest's battle */
  }
  return assertionCount;
}
