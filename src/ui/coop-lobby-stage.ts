/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op lobby STAGE (#633, lobby v2): the aesthetic backdrop + two seat cards the
// title-phase lobby flow renders BEHIND its option-select input panel. Pure
// presentation - the CoopLobbyController drives it through small setters; input
// stays on the battle-tested OPTION_SELECT overlay (keyboard / gamepad / touch all
// already work there). Built for TWO seats today; the layout centers a card row,
// so more seats later is adding cards, not a redesign.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";

/** One seat card's live visual state. */
export interface SeatState {
  /** Player display name, or null while the seat is empty. */
  name: string | null;
  /** Small role/status ribbon under the name. */
  detail: string;
  /** Dot color: green = ready/online, amber = waiting, red = attention. */
  dot: "green" | "amber" | "red";
}

const CARD_W = 108;
const CARD_H = 64;
const CARD_GAP = 12;
const CARD_Y = 34;

const DOT_COLORS: Record<SeatState["dot"], number> = {
  green: 0x78c850,
  amber: 0xf0b848,
  red: 0xe05858,
};

/**
 * The lobby's visual stage: dimmed backdrop, title, two seat cards (you + your
 * partner-to-be) with name / role / status dot, and a context strip. The waiting
 * seat's dot pulses so the screen reads alive while polling. Destroy() removes
 * everything (safe to call twice).
 */
export class CoopLobbyStage {
  private readonly root: Phaser.GameObjects.Container;
  private readonly seatTexts: { name: Phaser.GameObjects.Text; detail: Phaser.GameObjects.Text }[] = [];
  private readonly seatDots: Phaser.GameObjects.Arc[] = [];
  private readonly statusText: Phaser.GameObjects.Text;
  private pulse: Phaser.Tweens.Tween | null = null;
  private destroyed = false;

  constructor(localName: string) {
    // The game's LOGICAL resolution is a fixed 320x180 (1920x1080 canvas at the x6 ui
    // scale; FIT scaling never changes the internal canvas). Fixed constants, NOT
    // `game.canvas.width / 6`: headless environments carry a differently-sized mock
    // canvas, which skewed the whole layout in the render harness.
    const width = 320;
    const height = 180;
    // The UI container is BOTTOM-anchored (`super(scene, 0, scaledCanvas.height)` in ui.ts),
    // so a child at (0,0) renders one full screen BELOW the canvas - the live "lobby is
    // invisible" bug (#781, proven by the render harness world-position dump: every node at
    // world y = local + 1080). Anchor the root a full screen up so children keep clean
    // top-left 0..height coords.
    this.root = globalScene.add.container(0, -height);
    globalScene.ui.add(this.root);

    // Dimmed backdrop so the lobby floats over the title screen.
    const dim = globalScene.add.rectangle(0, 0, width, height, 0x000000, 0.65).setOrigin(0);
    this.root.add(dim);

    // Header: title + accent underline.
    const title = addTextObject(width / 2, 8, "CO-OP LOBBY", TextStyle.SETTINGS_LABEL, { fontSize: "112px" });
    title.setOrigin(0.5, 0);
    this.root.add(title);
    const underline = globalScene.add.rectangle(width / 2, 24, 132, 1.5, 0x78c8f0, 0.9).setOrigin(0.5, 0);
    this.root.add(underline);

    // Seat cards, centered as a row.
    const rowW = CARD_W * 2 + CARD_GAP;
    const startX = (width - rowW) / 2;
    for (let seat = 0; seat < 2; seat++) {
      const x = startX + seat * (CARD_W + CARD_GAP);
      const win = addWindow(x, CARD_Y, CARD_W, CARD_H);
      this.root.add(win);

      const seatLabel = addTextObject(
        x + CARD_W / 2,
        CARD_Y + 5,
        seat === 0 ? "PLAYER 1 - HOST" : "PLAYER 2",
        TextStyle.TOOLTIP_CONTENT,
        { fontSize: "48px" },
      );
      seatLabel.setOrigin(0.5, 0);
      seatLabel.setAlpha(0.85);
      this.root.add(seatLabel);

      const name = addTextObject(x + CARD_W / 2, CARD_Y + 21, "", TextStyle.WINDOW, { fontSize: "72px" });
      name.setOrigin(0.5, 0);
      this.root.add(name);

      const dot = globalScene.add.circle(x + CARD_W / 2 - 26, CARD_Y + CARD_H - 14, 2.5, DOT_COLORS.amber);
      this.root.add(dot);
      const detail = addTextObject(x + CARD_W / 2 + 3, CARD_Y + CARD_H - 18, "", TextStyle.TOOLTIP_CONTENT, {
        fontSize: "48px",
      });
      detail.setOrigin(0.5, 0);
      this.root.add(detail);

      this.seatTexts.push({ name, detail });
      this.seatDots.push(dot);
    }

    // Context strip between the cards and the input panel.
    this.statusText = addTextObject(width / 2, CARD_Y + CARD_H + 8, "", TextStyle.TOOLTIP_CONTENT, {
      fontSize: "56px",
    });
    this.statusText.setOrigin(0.5, 0);
    this.root.add(this.statusText);

    // Initial state: you are seat 1 and online; seat 2 searches.
    this.setSeat(0, { name: localName, detail: "Online", dot: "green" });
    this.setSeat(1, { name: null, detail: "Searching...", dot: "amber" });
    this.setStatus("Looking for other players...");
  }

  /** Update one seat card (0 = you, 1 = the partner slot). */
  setSeat(seat: 0 | 1, state: SeatState): void {
    if (this.destroyed) {
      return;
    }
    const texts = this.seatTexts[seat];
    const dot = this.seatDots[seat];
    texts.name.setText(state.name ?? "- - -");
    texts.name.setAlpha(state.name ? 1 : 0.5);
    texts.detail.setText(state.detail);
    dot.fillColor = DOT_COLORS[state.dot];
    // Pulse the dot while a seat is waiting/attention so the screen reads alive.
    this.pulse?.remove();
    this.pulse = null;
    dot.setAlpha(1);
    if (state.dot !== "green") {
      this.pulse = globalScene.tweens.add({
        targets: dot,
        alpha: 0.25,
        duration: 600,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /** Update the context strip under the cards. */
  setStatus(text: string): void {
    if (!this.destroyed) {
      this.statusText.setText(text);
    }
  }

  /** Tear the whole stage down (idempotent). */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.pulse?.remove();
    this.pulse = null;
    this.root.destroy(true);
  }
}
