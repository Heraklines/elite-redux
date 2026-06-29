/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Community Challenge designer (UiMode.COMMUNITY_CHALLENGE_CREATE).
//
// P1 stub: registered so the positional handler array + UiMode ordinal stay in
// sync (UI.getHandler indexes handlers[mode]). The full 4-tab create flow
// (difficulty, modifier toggles, allowed-species picker, name/description) lands
// in P1-G. For now it renders a placeholder and backs out cleanly.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";

const SCREEN_W = 320;
const SCREEN_H = 180;

export class CommunityChallengeCreateUiHandler extends UiHandler {
  private container!: Phaser.GameObjects.Container;

  constructor() {
    super(UiMode.COMMUNITY_CHALLENGE_CREATE);
  }

  setup(): void {
    const ui = this.getUi();
    const h = globalScene.scaledCanvas.height;
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x080912, 1).setOrigin(0));
    const t = addTextObject(SCREEN_W / 2, SCREEN_H / 2, "FORGE A CHALLENGE\n(coming soon)", TextStyle.WINDOW, {
      fontSize: "48px",
      align: "center",
    });
    t.setOrigin(0.5, 0.5).setColor("#ffd27a");
    this.container.add(t);
  }

  show(args: any[]): boolean {
    super.show(args);
    this.container.setVisible(true);
    return true;
  }

  processInput(button: Button): boolean {
    if (button === Button.CANCEL) {
      globalScene.ui.playSelect();
      globalScene.ui.revertMode();
      return true;
    }
    return false;
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
  }
}
