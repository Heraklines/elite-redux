/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Unit test for the console ring buffer's SIZE (#diagnostics). The buffer is sized so a co-op hang's
// INITIATING event survives to triage even under verbose (on-by-default) co-op logging; at the old
// 250-line cap it scrolled out within seconds. This asserts the raised cap keeps the last 2000 lines
// (dropping older ones), so a report taken after the freeze still contains the trigger.
// =============================================================================

import { getConsoleSnapshot, installConsoleRingBuffer } from "#utils/console-ring-buffer";
import { describe, expect, it } from "vitest";

describe("console ring buffer: retains enough lines for co-op triage (#diagnostics)", () => {
  it("keeps the last 2000 lines and drops older ones", () => {
    installConsoleRingBuffer(); // idempotent; ensures the console tee is installed for this test
    const total = 2100; // log MORE than the cap so the oldest are provably dropped
    for (let i = 0; i < total; i++) {
      console.log(`ring-line-${i}`);
    }
    const snapshot = getConsoleSnapshot();
    // The buffer is capped at 2000: after 2100 of our lines the buffer is exactly our last 2000.
    expect(snapshot.length, "buffer is capped at 2000 lines").toBe(2000);
    const messages = snapshot.map(e => e.message);
    expect(messages.at(-1), "the newest line is retained").toBe(`ring-line-${total - 1}`);
    expect(messages.includes("ring-line-0"), "the oldest line scrolled out").toBe(false);
    // The retained window is the LAST 2000: line (total-2000) is the earliest still present.
    expect(messages.includes(`ring-line-${total - 2000}`), "the window start is retained").toBe(true);
    expect(messages.includes(`ring-line-${total - 2000 - 1}`), "one before the window start is dropped").toBe(false);
  });
});
