/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENTS — the tournament LIST screen (Showdown Tournament P1).
// PWT-themed (the BW2 Pokemon World Tournament navy/gold chrome + crest reused
// from the Colosseum event): a scrollable board of open-for-registration /
// in-progress / recently-finished tournaments. ACTION on an open tournament you
// are not in REGISTERS you (one click; a saved team preset is required — the
// caller routes through the Team Menu picker when you have none); ACTION
// otherwise opens the bracket. Pure presentation + callbacks; the worker owns
// all state. Follows the hardened offline-flow rules (clear() hides the
// container; no derived state).
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { TournamentView } from "#data/elite-redux/showdown/tournament-types";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

const GOLD = 0xf8d030;
const NEXT = 0x48c8f8;
const TODO = 0x8a93b4;
const BOARD = 0x0b1838;
const OPEN_GREEN = 0x78e08a;

const VISIBLE_ROWS = 5;
const ROW_Y0 = 48;
const ROW_HEIGHT = 20;

/** Config the caller passes to render the list. */
export interface TournamentListConfig {
  tournaments: TournamentView[];
  /** The viewer's account username (to flag "you're registered"). */
  ownParticipant: string;
  /** Epoch ms for deadline / recency rendering. */
  now: number;
  /** Open the bracket screen for a tournament. */
  onOpen: (id: string) => void;
  /** Register for an open tournament (the caller enforces the preset requirement). */
  onRegister: (id: string) => void;
  /** Leave the tournaments screen. */
  onExit: () => void;
}

/** A BW2 PWT navy/gold 9-slice panel; falls back to the engine window. Origin top-left. */
function pwtPanel(x: number, y: number, w: number, h: number, button = false): Phaser.GameObjects.NineSlice {
  const key = button ? "er_pwt_button" : "er_pwt_panel";
  if (globalScene.textures.exists(key)) {
    const n = globalScene.add.nineslice(x, y, key, undefined, w, h, 4, 4, 4, 4);
    n.setOrigin(0, 0);
    return n;
  }
  return addWindow(x, y, w, h);
}

/** Guaranteed-dark navy content panel + gold border (legible in-game AND in the headless harness). */
function darkPanel(x: number, y: number, w: number, h: number, color = 0x0a1230): Phaser.GameObjects.Rectangle {
  const r = globalScene.add.rectangle(x, y, w, h, color, 0.94).setOrigin(0, 0);
  r.setStrokeStyle(1, GOLD, 0.7);
  return r;
}

function stateChip(t: TournamentView): { text: string; color: number } {
  switch (t.state) {
    case "registration":
      return { text: "OPEN", color: OPEN_GREEN };
    case "in_progress":
      return { text: "LIVE", color: NEXT };
    case "complete":
      return { text: "DONE", color: GOLD };
    default:
      return { text: "-", color: TODO };
  }
}

export class TournamentListUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Rectangle;
  private frame: Phaser.GameObjects.NineSlice | null = null;
  private crest: Phaser.GameObjects.Image | null = null;
  private wordmark: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private listPanel: Phaser.GameObjects.Rectangle;
  private hint: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private rows: Phaser.GameObjects.GameObject[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;

  private config: TournamentListConfig | null = null;
  private scrollTop = 0;

  constructor() {
    super(UiMode.TOURNAMENT_LIST);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    this.board = globalScene.add.rectangle(0, 0, w, h, BOARD, 1).setOrigin(0);
    this.board.setStrokeStyle(2, GOLD, 0.8);
    this.container.add(this.board);
    if (globalScene.textures.exists("er_pwt_panel")) {
      this.frame = pwtPanel(0, 0, w, h);
      this.container.add(this.frame);
    }

    if (globalScene.textures.exists("er_pwt_crest")) {
      this.crest = globalScene.add.image(w / 2, 2, "er_pwt_crest");
      this.crest.setOrigin(0.5, 0);
      this.crest.setScale(20 / 123);
      this.container.add(this.crest);
    }

    this.wordmark = addTextObject(w / 2, 24, "TOURNAMENTS", TextStyle.WINDOW, { fontSize: "34px" });
    this.wordmark.setOrigin(0.5, 0);
    this.wordmark.setTint(GOLD);
    this.container.add(this.wordmark);

    this.subtitle = addTextObject(w / 2, 33, "Pokemon World Tournament", TextStyle.PARTY, { fontSize: "24px" });
    this.subtitle.setOrigin(0.5, 0);
    this.subtitle.setTint(0xc0c8e0);
    this.container.add(this.subtitle);

    const panelY = 44;
    const panelH = h - panelY - 20;
    this.listPanel = darkPanel(7, panelY, w - 14, panelH);
    this.container.add(this.listPanel);

    this.emptyText = addTextObject(w / 2, panelY + panelH / 2, "No tournaments yet.", TextStyle.WINDOW, {
      fontSize: "40px",
    });
    this.emptyText.setOrigin(0.5, 0.5);
    this.emptyText.setTint(TODO);
    this.emptyText.setVisible(false);
    this.container.add(this.emptyText);

    this.hint = addTextObject(w / 2, h - 14, "", TextStyle.PARTY, { fontSize: "32px" });
    this.hint.setOrigin(0.5, 0.5);
    this.hint.setTint(0xc0c8e0);
    this.container.add(this.hint);

    this.cursorObj = globalScene.add.rectangle(0, 0, w - 22, ROW_HEIGHT - 1, 0xffffff, 0);
    this.cursorObj.setStrokeStyle(2, GOLD);
    this.cursorObj.setOrigin(0, 0);
    this.cursorObj.setVisible(false);
    this.container.add(this.cursorObj);
  }

  show(args: any[]): boolean {
    if (!(args.length > 0 && args[0] != null)) {
      return false;
    }
    this.config = args[0] as TournamentListConfig;
    this.scrollTop = 0;
    this.cursor = 0;

    this.layout();
    this.moveCursorTo(0);

    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  private layout(): void {
    for (const row of this.rows) {
      row.destroy();
    }
    this.rows = [];
    const cfg = this.config;
    if (cfg == null) {
      return;
    }

    const w = globalScene.scaledCanvas.width;
    const list = cfg.tournaments;
    this.emptyText.setVisible(list.length === 0);

    const end = Math.min(this.scrollTop + VISIBLE_ROWS, list.length);
    for (let i = this.scrollTop; i < end; i++) {
      const t = list[i];
      const y = ROW_Y0 + (i - this.scrollTop) * ROW_HEIGHT;
      const registered = t.entrants.some(e => e.participant === cfg.ownParticipant);
      const chip = stateChip(t);

      // state chip (left)
      const chipText = addTextObject(14, y + 1, chip.text, TextStyle.WINDOW, { fontSize: "30px" });
      chipText.setOrigin(0, 0);
      chipText.setTint(chip.color);
      this.container.add(chipText);
      this.rows.push(chipText);

      // name
      const name = addTextObject(46, y + 1, t.name, TextStyle.WINDOW, { fontSize: "34px" });
      name.setOrigin(0, 0);
      name.setTint(0xffffff);
      this.container.add(name);
      this.rows.push(name);

      // right-side detail: entrants / cap, or champion
      const detail =
        t.state === "complete" && t.champion ? `Champion: ${t.champion}` : `${t.entrantCount}/${t.maxEntrants} entered`;
      const detailText = addTextObject(w - 14, y + 1, detail, TextStyle.PARTY, { fontSize: "30px" });
      detailText.setOrigin(1, 0);
      detailText.setTint(t.state === "complete" ? GOLD : TODO);
      this.container.add(detailText);
      this.rows.push(detailText);

      // second line: window + your-status
      const windowHrs = Math.round(t.roundWindowMs / 3_600_000);
      const sub = registered ? "You are registered" : `${windowHrs}h rounds`;
      const subText = addTextObject(46, y + 10, sub, TextStyle.PARTY, { fontSize: "26px" });
      subText.setOrigin(0, 0);
      subText.setTint(registered ? OPEN_GREEN : TODO);
      this.container.add(subText);
      this.rows.push(subText);
    }
    this.updateHint();
  }

  private updateHint(): void {
    const cfg = this.config;
    if (cfg == null || cfg.tournaments.length === 0) {
      this.hint.setText("B: Back");
      return;
    }
    const t = cfg.tournaments[this.cursor];
    const registered = t.entrants.some(e => e.participant === cfg.ownParticipant);
    if (t.state === "registration" && !registered) {
      this.hint.setText("A: Register    B: Back");
    } else if (t.state === "registration") {
      this.hint.setText("A: View entrants    B: Back");
    } else {
      this.hint.setText("A: View bracket    B: Back");
    }
  }

  private moveCursorTo(index: number): void {
    const cfg = this.config;
    if (cfg == null || cfg.tournaments.length === 0) {
      this.cursorObj.setVisible(false);
      return;
    }
    const visibleIndex = index - this.scrollTop;
    const y = ROW_Y0 - 1 + visibleIndex * ROW_HEIGHT;
    this.cursorObj.setPosition(11, y);
    this.cursorObj.setVisible(true);
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCursorTo(this.cursor);
    this.updateHint();
    return changed;
  }

  processInput(button: Button): boolean {
    const cfg = this.config;
    if (cfg == null) {
      return false;
    }
    const count = cfg.tournaments.length;
    switch (button) {
      case Button.UP:
        if (count > 0 && this.cursor > 0) {
          if (this.cursor - 1 < this.scrollTop) {
            this.scrollTop--;
            this.layout();
          }
          this.setCursor(this.cursor - 1);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (count > 0 && this.cursor < count - 1) {
          if (this.cursor + 1 >= this.scrollTop + VISIBLE_ROWS) {
            this.scrollTop++;
            this.layout();
          }
          this.setCursor(this.cursor + 1);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.ACTION: {
        if (count === 0) {
          return false;
        }
        const t = cfg.tournaments[this.cursor];
        const registered = t.entrants.some(e => e.participant === cfg.ownParticipant);
        globalScene.ui.playSelect();
        if (t.state === "registration" && !registered) {
          cfg.onRegister(t.id);
        } else {
          cfg.onOpen(t.id);
        }
        return true;
      }
      case Button.CANCEL:
        globalScene.ui.playSelect();
        cfg.onExit();
        return true;
    }
    return false;
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const row of this.rows) {
      row.destroy();
    }
    this.rows = [];
    this.config = null;
  }
}

/** Demo config for the render harness (open + in-progress + finished states). */
export function buildTournamentListDemoConfig(): TournamentListConfig {
  const now = 1_700_000_000_000;
  const hour = 3_600_000;
  const mk = (
    id: string,
    name: string,
    state: TournamentView["state"],
    entrants: string[],
    extra: Partial<TournamentView> = {},
  ): TournamentView => ({
    id,
    name,
    organizer: "maintainer",
    state,
    roundWindowMs: 24 * hour,
    maxEntrants: 16,
    createdAt: now - hour,
    startedAt: state === "registration" ? null : now - hour,
    champion: null,
    entrantCount: entrants.length,
    entrants: entrants.map((p, i) => ({ participant: p, name: p, seed: i + 1 })),
    ...extra,
  });
  return {
    ownParticipant: "carla",
    now,
    onOpen: () => {},
    onRegister: () => {},
    onExit: () => {},
    tournaments: [
      mk("t1", "Spring Showdown Cup", "registration", ["carla", "ash", "misty"]),
      mk("t2", "Weekly Blitz", "registration", ["ash", "brock", "gary", "may"], { roundWindowMs: 8 * hour }),
      mk("t3", "Champions League", "in_progress", ["carla", "ash", "misty", "brock", "gary", "may", "dawn", "iris"]),
      mk("t4", "Winter Classic", "complete", ["ash", "gary"], { champion: "gary" }),
    ],
  };
}
