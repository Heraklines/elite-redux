// =============================================================================
// Elite Redux — `Library` (ability 5928) in-battle CAST panel.
//
// A small overlay opened from the FIGHT menu (mirroring `BattleInfoOverlay`'s
// lifecycle: the panel owns input while open, `container != null` == open) that
// lists the holder's recorded moves + the remaining SHARED cast PP and lets the
// holder cast a recorded move. Navigable by keyboard/gamepad/touch because all
// input arrives normalized as `Button`s.
//
// On ACTION the selected move is cast: one shared cast PP is spent
// (`commitLibraryCast`, which also arms the SPECIAL-damage marker the damage
// calc reads) and the move is committed through the normal command path
// (`CommandPhase.handleCommand(Command.FIGHT, -1, IGNORE_PP, turnMove)`), so a
// move outside the 4-slot moveset casts cleanly as the holder's turn action.
//
// The panel is created lazily and destroyed on close, so the default fight menu
// render is unchanged when the panel is not open (no render-baseline impact).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import {
  canCastLibrary,
  commitLibraryCast,
  getLibraryCastPp,
  getRecordedMoves,
} from "#data/elite-redux/abilities/library";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";
import { TextStyle } from "#enums/text-style";
import type { Pokemon } from "#field/pokemon";
import type { CommandPhase } from "#phases/command-phase";
import { addTextObject } from "#ui/text";

export class LibraryPanel {
  private container: Phaser.GameObjects.Container | null = null;
  private holder: Pokemon | null = null;
  private cursor = 0;

  /** Whether the panel is currently open (and thus owns input). */
  get isOpen(): boolean {
    return this.container != null;
  }

  /** The recorded moves the panel currently lists (empty when closed / none). */
  getEntries(): number[] {
    return this.holder ? getRecordedMoves(this.holder) : [];
  }

  /** The cursor position (index into {@linkcode getEntries}). */
  getCursor(): number {
    return this.cursor;
  }

  /**
   * Open the panel for `holder`. Returns `false` (and does not open) when the
   * holder cannot currently cast (no recorded moves or no shared PP left).
   */
  open(holder: Pokemon): boolean {
    if (this.container || !canCastLibrary(holder)) {
      return false;
    }
    this.holder = holder;
    this.cursor = 0;
    this.render();
    return true;
  }

  close(): void {
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
    this.holder = null;
    this.cursor = 0;
  }

  /**
   * Handle one navigation input while open. UP/DOWN move the cursor, ACTION
   * casts the selected move, any other button closes. Returns `true` while the
   * panel consumed the input.
   */
  handleInput(button: Button): boolean {
    if (!this.container || !this.holder) {
      return false;
    }
    const entries = this.getEntries();
    switch (button) {
      case Button.UP:
        if (entries.length > 0) {
          this.cursor = (this.cursor - 1 + entries.length) % entries.length;
          this.render();
        }
        return true;
      case Button.DOWN:
        if (entries.length > 0) {
          this.cursor = (this.cursor + 1) % entries.length;
          this.render();
        }
        return true;
      case Button.ACTION:
        this.castSelected();
        return true;
      default:
        this.close();
        return true;
    }
  }

  /** Cast the currently-selected recorded move as the holder's turn action. */
  private castSelected(): void {
    const holder = this.holder;
    const entries = this.getEntries();
    if (!holder || entries.length === 0) {
      this.close();
      return;
    }
    const moveId = entries[Math.min(this.cursor, entries.length - 1)];
    if (!commitLibraryCast(holder, moveId)) {
      globalScene.ui.playError();
      return;
    }
    this.close();
    const phase = globalScene.phaseManager.getCurrentPhase();
    if (phase?.is("CommandPhase")) {
      (phase as CommandPhase).handleCommand(Command.FIGHT, -1, MoveUseMode.IGNORE_PP, {
        move: moveId,
        targets: [],
        useMode: MoveUseMode.IGNORE_PP,
      });
    }
  }

  /** (Re)draw the panel: a title, one row per recorded move, and the shared PP. */
  private render(): void {
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
    if (!this.holder) {
      return;
    }
    const H = globalScene.scaledCanvas.height;
    const W = globalScene.scaledCanvas.width;

    // Layout constants (logical px). The panel sizes itself to its CONTENT — one
    // line per (title, each recorded move, shared PP) — so it never leaves the big
    // dead gap the old fixed 120x68 box showed for a partial/empty list.
    const PAD_X = 4;
    const PAD_TOP = 3;
    const PAD_BOT = 4;
    const ROW_H = 12;
    const MIN_W = 56;
    const MAX_W = 150;

    const entries = this.getEntries();
    // One label per row: title, one per recorded move (cursor row marked "> "), PP.
    const labels = [
      "Library",
      ...entries.map((moveId, index) => `${index === this.cursor ? "> " : "  "}${allMoves[moveId].name}`),
      `Cast PP: ${getLibraryCastPp(this.holder)}`,
    ];
    const texts = labels.map((label, row) => addTextObject(PAD_X, PAD_TOP + row * ROW_H, label, TextStyle.WINDOW));

    // Size the box to the widest rendered line (displayWidth is the logical width —
    // the text is authored large then scaled down). Fall back to a char estimate in
    // the headless mock scene where display metrics are unavailable.
    const measure = (t: Phaser.GameObjects.Text, s: string): number => {
      const w = t.displayWidth;
      return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : s.length * 5.5;
    };
    const contentW = Math.max(...texts.map((t, i) => measure(t, labels[i])));
    const panelW = Math.min(MAX_W, Math.max(MIN_W, Math.ceil(contentW) + PAD_X * 2 + 2));
    const panelH = PAD_TOP + labels.length * ROW_H + PAD_BOT;

    const offX = W - panelW - 4;
    const offY = 4;
    const c = globalScene.add.container(offX, -H + offY).setDepth(1000);

    const bg = globalScene.add.rectangle(0, 0, panelW, panelH, 0x1a1a2e, 0.9).setOrigin(0, 0);
    bg.setStrokeStyle(1, 0x8888cc, 1);
    c.add(bg);
    for (const t of texts) {
      c.add(t);
    }

    globalScene.ui.add(c);
    this.container = c;
  }
}
