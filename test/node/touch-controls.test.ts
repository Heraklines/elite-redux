/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { initGlobalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emit = vi.fn();

describe("TouchControl", () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="confirm" class="apad-button" data-key="ACTION"></button>';
    emit.mockClear();
    initGlobalScene({ game: { events: { emit } } } as never);
  });

  it("emits one input when a browser follows a touch with compatibility pointer events", async () => {
    const { TouchControl } = await import("#app/touch-controls");
    new TouchControl();
    const button = document.getElementById("confirm")!;
    const touchStart = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(touchStart, "touches", { value: [{}] });

    button.dispatchEvent(touchStart);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new Event("touchend", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new Event("pointerup", { bubbles: true, cancelable: true }));

    expect(emit.mock.calls.filter(([event]) => event === "input_down")).toEqual([
      ["input_down", { controller_type: "keyboard", button: Button.ACTION, isTouch: true }],
    ]);
    expect(emit.mock.calls.filter(([event]) => event === "input_up")).toHaveLength(1);
  });
});
