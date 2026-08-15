/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { UI } from "#ui/ui";
import { describe, expect, it, vi } from "vitest";

describe("UI mode stack", () => {
  it("unwinds every mode without losing the UI receiver", async () => {
    const stack = [1, 2, 3];
    const ui = {
      modeChain: stack,
      revertMode: vi.fn(async () => {
        stack.pop();
        return true;
      }),
    };

    await UI.prototype.revertModes.call(ui as unknown as UI);

    expect(stack).toEqual([]);
    expect(ui.revertMode).toHaveBeenCalledTimes(3);
  });
});
