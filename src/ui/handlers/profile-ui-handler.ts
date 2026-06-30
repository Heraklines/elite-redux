/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Profile hub (UiMode.PROFILE).
//
// A small profile dashboard reached from the title's "Profile" entry (which
// replaced the old top-level Run History entry). A LEFT SIDE-NAV of tabs; each
// tab opens its screen as an overlay (back returns here, back from the hub
// returns to the title):
//   - "Ghost Trainer Editor" -> UiMode.GHOST_TRAINER_EDITOR (author your ghost).
//   - "Run History"          -> the EXISTING UiMode.RUN_HISTORY screen (reused).
//
// The tab list is data-driven (PROFILE_TABS) so more profile sections can be
// added by appending one entry. Opened over the title via the deferred-open
// pattern (TitlePhase.openProfileHub) with an onExit callback that returns
// cleanly to a fresh title. Drive it headlessly via the render-harness recipe
// `profile`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";

const SCREEN_W = 320;
const SCREEN_H = 180;

// --- Theme palette (shared with the Ghost Trainer Editor / community screens) ---
const VOID = 0x080912;
const BAND = 0x10131f;
const PANEL = 0x0d1020;
const GOLD = "#ffd27a";
const GOLD_DIM = "#b9924a";
const INK = "#d8c9a8";
const DIM = "#8a8470";
const ACTIVE_RED = 0xd8542a;
const ACCENT = 0x5ad1ff;

// --- Left nav rail ---
const NAV_X = 6;
const NAV_LABEL_X = NAV_X + 6;
const NAV_W = 144;
const NAV_Y = 34;
const NAV_ROW_H = 14;
const HINT_Y = SCREEN_H - 9;

// --- Right content panel ---
const PANEL_X = 158;
const PANEL_Y = 30;
const PANEL_W = SCREEN_W - PANEL_X - 6;
const PANEL_H = 120;

interface ProfileTab {
  readonly label: string;
  readonly mode: UiMode;
  readonly description: string;
}

/** The tabs, top to bottom. Append an entry to add a new profile section. */
const PROFILE_TABS: ProfileTab[] = [
  {
    label: "Ghost Trainer Editor",
    mode: UiMode.GHOST_TRAINER_EDITOR,
    description:
      "Customize how your published ghost looks to other trainers: the cosmetic sprite, a display name and title, and your battle dialogue.",
  },
  {
    label: "Run History",
    mode: UiMode.RUN_HISTORY,
    description: "Review your past runs and how each one ended.",
  },
];

export class ProfileUiHandler extends UiHandler {
  private container!: Phaser.GameObjects.Container;
  private dynamic!: Phaser.GameObjects.Container;

  /** Caller's clean-return-to-title callback (TitlePhase.openProfileHub). */
  private onExit: (() => void) | null = null;

  constructor() {
    super(UiMode.PROFILE);
  }

  setup(): void {
    const ui = this.getUi();
    const h = globalScene.scaledCanvas.height;
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Opaque void backdrop + header band.
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, VOID, 1).setOrigin(0));
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, 21, BAND, 1).setOrigin(0));

    const eyebrow = addTextObject(NAV_X, 3, "TRAINER", TextStyle.WINDOW, { fontSize: "30px" });
    eyebrow.setOrigin(0, 0).setColor(GOLD_DIM);
    this.container.add(eyebrow);
    const title = addTextObject(NAV_X, 9, "PROFILE", TextStyle.WINDOW, { fontSize: "48px" });
    title.setOrigin(0, 0).setColor(GOLD);
    this.container.add(title);

    // Hint bar.
    this.container.add(globalScene.add.rectangle(0, SCREEN_H - 12, SCREEN_W, 12, BAND, 1).setOrigin(0));
    const hint = addTextObject(SCREEN_W / 2, HINT_Y, "A  Open     Up Down  Select     B  Back", TextStyle.WINDOW, {
      fontSize: "28px",
      align: "center",
    });
    hint.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(hint);

    this.dynamic = globalScene.add.container(0, 0);
    this.container.add(this.dynamic);
  }

  // ---- Lifecycle ----------------------------------------------------------

  show(args: any[]): boolean {
    super.show(args);
    this.onExit = typeof args[0] === "function" ? (args[0] as () => void) : null;
    this.cursor = 0;
    this.rebuild();
    this.container.setVisible(true);
    this.getUi().bringToTop(this.container);
    return true;
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.dynamic.removeAll(true);
  }

  // ---- Rendering ----------------------------------------------------------

  private rebuild(): void {
    this.dynamic.removeAll(true);

    // Left nav rail.
    for (let i = 0; i < PROFILE_TABS.length; i++) {
      const y = NAV_Y + i * NAV_ROW_H;
      const focused = i === this.cursor;
      if (focused) {
        const hl = globalScene.add.rectangle(NAV_X, y - 2, NAV_W, NAV_ROW_H, ACTIVE_RED, 0.18).setOrigin(0);
        hl.setStrokeStyle(1, ACTIVE_RED, 0.85);
        this.dynamic.add(hl);
      }
      const label = addTextObject(NAV_LABEL_X, y, PROFILE_TABS[i].label, TextStyle.WINDOW, { fontSize: "30px" });
      label.setOrigin(0, 0).setColor(focused ? GOLD : GOLD_DIM);
      this.dynamic.add(label);
    }

    // Right content panel: the focused tab's name + description.
    const panel = globalScene.add.rectangle(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, PANEL, 1).setOrigin(0);
    panel.setStrokeStyle(1, ACCENT, 0.5);
    this.dynamic.add(panel);

    const tab = PROFILE_TABS[this.cursor];
    const heading = addTextObject(PANEL_X + 6, PANEL_Y + 6, tab.label.toUpperCase(), TextStyle.WINDOW, {
      fontSize: "32px",
    });
    heading.setOrigin(0, 0).setColor(GOLD);
    this.dynamic.add(heading);

    const desc = addTextObject(PANEL_X + 6, PANEL_Y + 20, tab.description, TextStyle.WINDOW, {
      fontSize: "28px",
      wordWrap: { width: (PANEL_W - 12) * 6 },
    });
    desc.setOrigin(0, 0).setColor(INK);
    this.dynamic.add(desc);

    const prompt = addTextObject(PANEL_X + 6, PANEL_Y + PANEL_H - 12, "Press A to open.", TextStyle.WINDOW, {
      fontSize: "26px",
    });
    prompt.setOrigin(0, 0).setColor(DIM);
    this.dynamic.add(prompt);
  }

  // ---- Input --------------------------------------------------------------

  processInput(button: Button): boolean {
    switch (button) {
      case Button.CANCEL:
        globalScene.ui.playSelect();
        this.exitToTitle();
        return true;
      case Button.UP:
        this.cursor = (this.cursor + PROFILE_TABS.length - 1) % PROFILE_TABS.length;
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.DOWN:
        this.cursor = (this.cursor + 1) % PROFILE_TABS.length;
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.ACTION:
      case Button.SUBMIT:
        globalScene.ui.playSelect();
        this.openTab(PROFILE_TABS[this.cursor]);
        return true;
      default:
        return false;
    }
  }

  /** Open the focused tab's screen as an overlay (back returns here via revertMode). */
  private openTab(tab: ProfileTab): void {
    if (tab.mode === UiMode.GHOST_TRAINER_EDITOR) {
      // Thread the return-to-title callback through so the editor's PUBLISH lands on a
      // fresh title (its BACK button reverts to this hub).
      globalScene.ui.setOverlayMode(tab.mode, this.onExit ?? undefined);
      return;
    }
    // Run History (and future read-only tabs) self-raise + revert to this hub on back.
    globalScene.ui.setOverlayMode(tab.mode);
  }

  private exitToTitle(): void {
    if (this.onExit) {
      this.onExit();
    } else {
      void globalScene.ui.revertMode();
    }
  }
}
