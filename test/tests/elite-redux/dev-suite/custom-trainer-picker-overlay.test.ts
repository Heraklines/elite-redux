/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression lock for the #937 Custom Trainers PICKER bug: selecting the "Custom
// Trainers" entry rendered its "select a custom trainer" header text but NEVER
// showed the trainer rows.
//
// ROOT CAUSE: the main Dev Scenarios list IS a UiMode.OPTION_SELECT, and
// `Ui.setModeInternal` early-returns when the requested mode already equals the
// active mode (`this.mode === mode && !forceTransition`). So opening the custom
// list with `setOverlayMode(OPTION_SELECT, …)` from INSIDE that OPTION_SELECT was
// a silent no-op. The working main list only opens because it comes from the
// TITLE mode (a different mode).
//
// FIX: openDevMenuOverlay collapses the active OPTION_SELECT to MESSAGE FIRST,
// then runs the opener (mirrors the proven main-list `openPickerClean`). This
// test locks the invocation ORDER (setMode(MESSAGE) BEFORE the opener runs). The
// interactive click path (Phaser OPTION_SELECT input) remains MANUAL-verify.
//
// Pure logic (the helper is free of globalScene/Phaser) - NOT gated behind
// ER_SCENARIO.
// =============================================================================

import { openDevMenuOverlay } from "#app/dev-tools/test-suite/custom-trainer-picker";
import { describe, expect, it, vi } from "vitest";

/** A stand-in for the MESSAGE UiMode number (the helper is mode-agnostic). */
const MESSAGE_MODE = 5;

describe("Custom Trainers picker — openDevMenuOverlay (regression lock)", () => {
  it("collapses to the message mode BEFORE running the opener (async)", async () => {
    const order: string[] = [];
    const ui = {
      setMode: vi.fn((mode: number) => {
        order.push(`setMode:${mode}`);
        return Promise.resolve();
      }),
    };
    const open = vi.fn(() => {
      order.push("open");
    });

    const p = openDevMenuOverlay(ui, MESSAGE_MODE, open);
    // setMode fires immediately; the opener is DEFERRED to after the mode settles
    // (the same async-open-after-`return true` shape the working flow relies on).
    expect(ui.setMode).toHaveBeenCalledWith(MESSAGE_MODE);
    expect(open).not.toHaveBeenCalled();

    await p;
    // The opener ran, and STRICTLY AFTER the collapse to MESSAGE.
    expect(open).toHaveBeenCalledTimes(1);
    expect(order).toEqual([`setMode:${MESSAGE_MODE}`, "open"]);
  });

  it("works when setMode returns void (synchronous UI) and still defers the opener", async () => {
    const order: string[] = [];
    const ui = {
      setMode: vi.fn((mode: number) => {
        order.push(`setMode:${mode}`);
        // no return value (void) — some UI paths resolve synchronously
      }),
    };
    const open = vi.fn(() => order.push("open"));

    await openDevMenuOverlay(ui, MESSAGE_MODE, open);
    expect(order).toEqual([`setMode:${MESSAGE_MODE}`, "open"]);
  });

  it("swallows an opener error so a failed re-open never rejects into the caller", async () => {
    const ui = { setMode: vi.fn(() => Promise.resolve()) };
    const open = vi.fn(() => {
      throw new Error("boom");
    });
    // Must resolve (not reject): the dev-menu handlers are fire-and-forget.
    await expect(openDevMenuOverlay(ui, MESSAGE_MODE, open)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
