/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Button } from "#enums/buttons";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { describe, expect, it, vi } from "vitest";

class TestMessageUiHandler extends MessageUiHandler {
  public readonly setMessageText = vi.fn();
  public readonly stopPrompt = vi.fn();
  public readonly setPromptVisible = vi.fn();

  constructor() {
    super();
    this.message = { setText: this.setMessageText } as unknown as Phaser.GameObjects.Text;
    this.prompt = {
      anims: { stop: this.stopPrompt },
      setVisible: this.setPromptVisible,
    } as unknown as Phaser.GameObjects.Sprite;
  }

  setup(): void {}

  processInput(_button: Button): boolean {
    return false;
  }

  armPrompt(): void {
    this.pendingPrompt = true;
    this.awaitingActionInput = true;
    this.onActionInput = vi.fn();
  }

  promptIsArmed(): boolean {
    return this.pendingPrompt || this.awaitingActionInput || this.onActionInput != null;
  }
}

describe("MessageUiHandler prompt teardown", () => {
  it("clearText hides the prompt sprite and disarms its stale action", () => {
    const handler = new TestMessageUiHandler();
    handler.armPrompt();

    handler.clearText();

    expect(handler.setMessageText).toHaveBeenCalledWith("");
    expect(handler.stopPrompt).toHaveBeenCalledOnce();
    expect(handler.setPromptVisible).toHaveBeenCalledWith(false);
    expect(handler.promptIsArmed()).toBe(false);
  });
});
