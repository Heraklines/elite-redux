/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — title-screen notification bell + inbox panel.
//
// A self-contained, TYPE-AGNOSTIC widget: it renders whatever the
// `notificationManager` holds, dispatching summary/detail rendering to each
// notification's registered `NotificationTypeDef`. Knows nothing about ghosts or
// any specific type. Pointer-driven (click the bell to toggle the inbox).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import { notificationManager, type SettingEnabled } from "#system/notifications/notification-manager";
import { addTextObject } from "#ui/text";

const PANEL_W = 132;
const PANEL_H = 116;
const MAX_ROWS = 7;

export class NotificationBell extends Phaser.GameObjects.Container {
  private readonly bellText: Phaser.GameObjects.Text;
  private readonly panel: Phaser.GameObjects.Container;
  private readonly listText: Phaser.GameObjects.Text;
  private readonly detailText: Phaser.GameObjects.Text;
  private readonly isEnabled: SettingEnabled;
  private isOpen = false;
  private detailFor: string | null = null;

  /** @param isEnabled predicate so the bell respects per-type settings toggles. */
  constructor(x: number, y: number, isEnabled: SettingEnabled) {
    super(globalScene, x, y);
    this.isEnabled = isEnabled;

    // The bell button (text glyph keeps it asset-free; the bitmap font has it).
    this.bellText = addTextObject(0, 0, "", TextStyle.MONEY, { fontSize: "64px" }).setOrigin(1, 0);
    this.bellText.setInteractive(new Phaser.Geom.Rectangle(-44, -2, 48, 16), Phaser.Geom.Rectangle.Contains);
    this.bellText.on("pointerdown", () => this.toggle());
    this.add(this.bellText);

    // The inbox panel (hidden until the bell is clicked).
    this.panel = globalScene.add.container(2, 13);
    const bg = globalScene.add.rectangle(0, 0, PANEL_W, PANEL_H, 0x101018, 0.92).setOrigin(1, 0);
    bg.setStrokeStyle(1, 0x6688cc, 0.9);
    bg.setInteractive(); // swallow clicks so they don't fall through to the title
    this.listText = addTextObject(-PANEL_W + 4, 4, "", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0, 0);
    this.listText.setWordWrapWidth((PANEL_W - 8) * 6);
    this.listText.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, PANEL_W - 8, PANEL_H - 8),
      Phaser.Geom.Rectangle.Contains,
    );
    this.listText.on("pointerdown", (_p: Phaser.Input.Pointer, _lx: number, ly: number) => this.onListClick(ly));
    this.detailText = addTextObject(-PANEL_W + 4, 4, "", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0, 0);
    this.detailText.setWordWrapWidth((PANEL_W - 8) * 6);
    this.detailText.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, PANEL_W - 8, PANEL_H - 8),
      Phaser.Geom.Rectangle.Contains,
    );
    this.detailText.on("pointerdown", () => this.renderList()); // click detail → back to list
    this.detailText.setVisible(false);
    this.panel.add([bg, this.listText, this.detailText]);
    this.panel.setVisible(false);
    this.add(this.panel);

    this.refresh();
  }

  /** Re-pull sources + redraw the badge. Call when the title (re)appears. */
  refresh(): void {
    notificationManager
      .refresh(this.isEnabled)
      .then(() => this.redraw())
      .catch(() => {
        /* refresh swallows its own errors; the redraw below covers the rest */
      });
    this.redraw();
  }

  private redraw(): void {
    const unread = notificationManager.unreadCount(this.isEnabled);
    this.bellText.setText(unread > 0 ? `[ Inbox ${unread} ]` : "[ Inbox ]");
    this.bellText.setColor(unread > 0 ? "#ffe066" : "#a0a0b0");
    if (this.isOpen) {
      this.detailFor ? this.renderDetail() : this.renderList();
    }
  }

  private toggle(): void {
    this.isOpen = !this.isOpen;
    this.detailFor = null;
    this.panel.setVisible(this.isOpen);
    if (this.isOpen) {
      this.renderList();
    }
  }

  private renderList(): void {
    this.detailFor = null;
    this.detailText.setVisible(false);
    this.listText.setVisible(true);
    const items = notificationManager.list(this.isEnabled).slice(0, MAX_ROWS);
    if (items.length === 0) {
      this.listText.setText("No notifications.\n\n(click Inbox to close)");
      return;
    }
    const lines = items.map(n => {
      const def = notificationManager.getType(n.type);
      const text = def ? def.summary(n) : n.type;
      return `${n.read ? "  " : "> "}${this.clip(text, 22)}`;
    });
    this.listText.setText(lines.join("\n"));
  }

  /** Map a click y-offset inside the list to a row index → open its detail. */
  private onListClick(localY: number): void {
    const items = notificationManager.list(this.isEnabled).slice(0, MAX_ROWS);
    if (items.length === 0) {
      this.toggle();
      return;
    }
    const lineH = 14;
    const idx = Math.floor((localY - 4) / lineH);
    const n = items[idx];
    if (!n) {
      return;
    }
    notificationManager.markRead(n.id);
    this.detailFor = n.id;
    this.renderDetail();
    this.redraw();
  }

  private renderDetail(): void {
    const n = notificationManager.list(this.isEnabled).find(x => x.id === this.detailFor);
    if (!n) {
      this.renderList();
      return;
    }
    const def = notificationManager.getType(n.type);
    const d = def?.detail?.(n);
    const title = d?.title ?? def?.summary(n) ?? n.type;
    const body = d?.body ?? "";
    this.listText.setVisible(false);
    this.detailText.setVisible(true);
    this.detailText.setText(`${this.clip(title, 22)}\n\n${body}\n\n(click to go back)`);
  }

  private clip(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }
}
