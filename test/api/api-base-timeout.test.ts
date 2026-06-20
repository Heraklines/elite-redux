/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ApiBase.doFetch had no request timeout, so a hung/slow endpoint made the
// awaiting caller hang forever. Save & Quit awaits the cloud push, so a stalled
// save froze the player on the menu until a manual refresh (regression from the
// login feature). doFetch now aborts after API_REQUEST_TIMEOUT_MS. This pins
// that: a fetch that never resolves must reject (not hang) once the timeout
// elapses.
// =============================================================================

import { ApiBase } from "#api/api-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Concrete subclass exposing the protected doFetch for testing. */
class TestApi extends ApiBase {
  constructor() {
    super("https://example.invalid");
  }
  public call(path: string): Promise<Response> {
    return this.doFetch(path, { method: "GET" });
  }
}

describe("ApiBase request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts a request that never resolves once the timeout elapses", async () => {
    // fetch that never resolves on its own, but rejects when its signal aborts
    // (mirrors the browser's real abort behavior).
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    const pending = new TestApi().call("/never");
    // Surface the eventual rejection without an unhandled-rejection warning.
    const settled = pending.then(
      () => "resolved",
      () => "rejected",
    );

    await vi.advanceTimersByTimeAsync(20_000);
    await expect(settled).resolves.toBe("rejected");
  });
});
