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

export type CoopLobbyStageVariant = "coop" | "showdown";

/** Player-facing lobby title. Matchmaking still uses the shared co-op transport underneath. */
export function getCoopLobbyStageTitle(variant: CoopLobbyStageVariant): string {
  return variant === "showdown" ? "SHOWDOWN LOBBY" : "CO-OP LOBBY";
}

// LEFT-COLUMN layout (v2): the input OPTION_SELECT panel is right-edge anchored (it grows
// up-left from the bottom-right), so the stage keeps ALL its content in the left column and
// dresses the right side as an "ACTIONS" dock the panel visually docks into - no overlap.
const DOCK_X = 202;
const LEFT_CENTER = DOCK_X / 2;
const CARD_X = 8;
const CARD_W = DOCK_X - 16;
const CARD_H = 56;
const CARD_YS = [30, 92] as const;

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

  constructor(localName: string, variant: CoopLobbyStageVariant = "coop") {
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

    // RIGHT: the "ACTIONS" dock - a darker band with a cyan divider the option panel
    // (right-edge anchored by design) visually docks into.
    const dock = globalScene.add.rectangle(DOCK_X, 0, width - DOCK_X, height, 0x000000, 0.35).setOrigin(0);
    this.root.add(dock);
    const divider = globalScene.add.rectangle(DOCK_X, 0, 1, height, 0x78c8f0, 0.7).setOrigin(0);
    this.root.add(divider);
    const dockLabel = addTextObject(DOCK_X + (width - DOCK_X) / 2, 5, "ACTIONS", TextStyle.TOOLTIP_CONTENT, {
      fontSize: "48px",
    });
    dockLabel.setOrigin(0.5, 0);
    dockLabel.setAlpha(0.7);
    this.root.add(dockLabel);

    // LEFT: header (title + accent underline) centered over the left column.
    const title = addTextObject(LEFT_CENTER, 6, getCoopLobbyStageTitle(variant), TextStyle.SETTINGS_LABEL, {
      fontSize: "112px",
    });
    title.setOrigin(0.5, 0);
    this.root.add(title);
    const underline = globalScene.add.rectangle(LEFT_CENTER, 22, 132, 1.5, 0x78c8f0, 0.9).setOrigin(0.5, 0);
    this.root.add(underline);

    // Seat cards, stacked in the left column - roomier than the old side-by-side pair.
    for (let seat = 0; seat < 2; seat++) {
      const y = CARD_YS[seat];
      const win = addWindow(CARD_X, y, CARD_W, CARD_H);
      this.root.add(win);

      const seatLabel = addTextObject(
        CARD_X + 7,
        y + 5,
        seat === 0 ? "PLAYER 1 - HOST" : "PLAYER 2",
        TextStyle.TOOLTIP_CONTENT,
        { fontSize: "48px" },
      );
      seatLabel.setOrigin(0, 0);
      seatLabel.setAlpha(0.85);
      this.root.add(seatLabel);

      const name = addTextObject(CARD_X + 7, y + 16, "", TextStyle.WINDOW, { fontSize: "84px" });
      name.setOrigin(0, 0);
      this.root.add(name);

      const dot = globalScene.add.circle(CARD_X + 11, y + CARD_H - 12, 2.5, DOT_COLORS.amber);
      this.root.add(dot);
      const detail = addTextObject(CARD_X + 18, y + CARD_H - 16, "", TextStyle.TOOLTIP_CONTENT, {
        fontSize: "48px",
      });
      detail.setOrigin(0, 0);
      this.root.add(detail);

      this.seatTexts.push({ name, detail });
      this.seatDots.push(dot);
    }

    // Context strip at the bottom of the left column.
    this.statusText = addTextObject(LEFT_CENTER, height - 26, "", TextStyle.TOOLTIP_CONTENT, {
      fontSize: "56px",
      wordWrap: { width: (DOCK_X - 12) * 6, useAdvancedWrap: true },
      align: "center",
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
