import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { Button } from "#enums/buttons";
import type { MoveId } from "#enums/move-id";
import { getShortenedStatKey, PERMANENT_STATS } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { LearnMoveBatchDeps } from "#phases/learn-move-batch-phase";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

/** Panel sub-state. Kept INTERNAL (no UiMode switches) so the panel can never
 * desync the mode stack - the softlock class this avoids. */
type PanelState = "pickNew" | "pickSlot" | "confirmCancel";

const PANEL_X = 6;
const PANEL_Y = 22;
const PANEL_W = 180;
const PANEL_H = 106;
const COL_GAP = 92;
const ROW_H = 14;
const ROW_TOP = 44;
/** How many list rows show at once per column before the column scrolls. */
const VISIBLE_ROWS = 5;
/** Left side panel (learning mon's icon + base stats), drawn just left of the main window. */
const LEFT_W = 56;
const LEFT_GAP = 0; // flush against the main panel (touching, not overlapping)
const LEFT_X = PANEL_X - LEFT_W - LEFT_GAP;
const LEFT_H = PANEL_H;
const STAT_LABEL_DX = 5; // left inset for a stat label
const STAT_VALUE_DX = LEFT_W - 5; // right edge for a (right-aligned) stat value
const STAT_Y0 = PANEL_Y + 30; // first stat row, below the icon
const STAT_ROW_H = 11; // keep all 6 rows inside the panel (last row was spilling out)

/**
 * ER QoL Move Learn panel (see {@linkcode LearnMoveBatchPhase}). One screen on
 * level-up listing the NEW moves this level teaches (LEARNABLE, left) beside the
 * current moveset (CURRENT, right). Pick a learnable move; if there's a free
 * slot it's learned silently, otherwise you pick which current move it overwrites.
 * The learned move drops off the LEARNABLE list (it thins down) so the same move
 * can never be learned twice. Cancel (X / controller / mobile) asks to confirm
 * only when nothing was learned. The highlighted move's info shows via the shared
 * {@linkcode MoveInfoOverlay}.
 *
 * Both columns SCROLL within a fixed {@linkcode VISIBLE_ROWS} window, so a long
 * learnable list (mass level-up) and a large moveset (up to 8 slots) never
 * overflow the panel. A small left panel shows the learning mon's icon + its base stats.
 */
export class LearnMoveBatchUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private learnableHeader: Phaser.GameObjects.Text;
  private currentHeader: Phaser.GameObjects.Text;
  private learnableTexts: Phaser.GameObjects.Text[] = [];
  private currentTexts: Phaser.GameObjects.Text[] = [];
  private promptText: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.Image | null = null;
  private moveInfoOverlay: MoveInfoOverlay;
  // Scroll indicators (one pair per column), shown only when there's more to see.
  private learnUp: Phaser.GameObjects.Text;
  private learnDown: Phaser.GameObjects.Text;
  private currentUp: Phaser.GameObjects.Text;
  private currentDown: Phaser.GameObjects.Text;
  // Left panel: the learning mon's icon (built per-show) + its 6 base-stat values.
  private statValues: Phaser.GameObjects.Text[] = [];
  private sideIcon: Phaser.GameObjects.Container | null = null;

  private deps: LearnMoveBatchDeps | null = null;
  private state: PanelState = "pickNew";
  /** Cursor in the LEARNABLE column; the extra final rows are Undo / Cancel. */
  private newCursor = 0;
  /** Cursor in the CURRENT column when choosing which move to overwrite. */
  private slotCursor = 0;
  /** Top visible row of each column (scroll offset). */
  private newScroll = 0;
  private slotScroll = 0;
  /** Cursor over the confirm-cancel choice: 0 = No (go back), 1 = Yes (leave). */
  private confirmCursor = 0;
  private pendingMoveId: MoveId | null = null;
  private learnedAny = false;
  /** The full learnable list when the panel opened, so Undo can restore it. */
  private originalLearnable: MoveId[] = [];

  constructor() {
    super(UiMode.LEARN_MOVE_BATCH);
  }

  setup(): void {
    const ui = this.getUi();
    const sc = globalScene.scaledCanvas;
    const overlayH = MoveInfoOverlay.getHeight(true);
    // Centre the LEFT panel + main panel as a group in the space above the
    // bottom move-info strip. Children keep their PANEL_X / LEFT_X offsets.
    const totalW = LEFT_W + LEFT_GAP + PANEL_W;
    const mainX = Math.floor((sc.width - totalW) / 2) + LEFT_W + LEFT_GAP;
    const winY = Math.floor((sc.height - overlayH - PANEL_H) / 2) - sc.height;
    this.container = globalScene.add.container(mainX - PANEL_X, winY - PANEL_Y);
    this.container.setVisible(false);
    ui.add(this.container);

    this.container.add(addWindow(PANEL_X, PANEL_Y, PANEL_W, PANEL_H));

    // Left panel: window + the 6 base-stat rows (labels are static; the icon +
    // the per-stat values are filled in per-show by buildSidePanel).
    this.container.add(addWindow(LEFT_X, PANEL_Y, LEFT_W, LEFT_H));
    PERMANENT_STATS.forEach((stat, i) => {
      const y = STAT_Y0 + i * STAT_ROW_H;
      const label = addTextObject(
        LEFT_X + STAT_LABEL_DX,
        y,
        i18next.t(getShortenedStatKey(stat)),
        TextStyle.SUMMARY_GOLD,
      );
      const value = addTextObject(LEFT_X + STAT_VALUE_DX, y, "", TextStyle.WINDOW).setOrigin(1, 0);
      this.statValues.push(value);
      this.container.add([label, value]);
    });

    this.learnableHeader = addTextObject(PANEL_X + 6, ROW_TOP - 18, "Learnable", TextStyle.WINDOW_ALT);
    this.currentHeader = addTextObject(PANEL_X + 6 + COL_GAP, ROW_TOP - 18, "Current", TextStyle.WINDOW_ALT);
    this.promptText = addTextObject(PANEL_X + 8, PANEL_Y + 8, "", TextStyle.WINDOW).setVisible(false);
    this.container.add([this.learnableHeader, this.currentHeader, this.promptText]);

    // Scroll arrows: ^ just under each header, v just under the last visible row.
    const arrowTopY = ROW_TOP - 9;
    const arrowBotY = ROW_TOP + VISIBLE_ROWS * ROW_H; // below the last row, inside the taller panel
    this.learnUp = addTextObject(PANEL_X + 78, arrowTopY, "↑", TextStyle.WINDOW)
      .setOrigin(1, 0)
      .setVisible(false);
    this.learnDown = addTextObject(PANEL_X + 78, arrowBotY, "↓", TextStyle.WINDOW)
      .setOrigin(1, 0)
      .setVisible(false);
    this.currentUp = addTextObject(PANEL_X + 78 + COL_GAP, arrowTopY, "↑", TextStyle.WINDOW)
      .setOrigin(1, 0)
      .setVisible(false);
    this.currentDown = addTextObject(PANEL_X + 78 + COL_GAP, arrowBotY, "↓", TextStyle.WINDOW)
      .setOrigin(1, 0)
      .setVisible(false);
    this.container.add([this.learnUp, this.learnDown, this.currentUp, this.currentDown]);

    this.cursorObj = globalScene.add.image(0, 0, "cursor").setOrigin(0, 0.5);
    this.container.add(this.cursorObj);

    // Reuse the shared move-info overlay (the combat move-select panel) for the
    // highlighted move; sits along the bottom like the fight UI's.
    this.moveInfoOverlay = new MoveInfoOverlay({
      delayVisibility: false,
      onSide: true,
      right: true,
      x: 0,
      y: -MoveInfoOverlay.getHeight(true),
      width: globalScene.scaledCanvas.width - 8,
      hideEffectBox: false,
    });
    ui.add(this.moveInfoOverlay);
  }

  override show(args: any[]): boolean {
    super.show(args);
    this.deps = args[0] as LearnMoveBatchDeps;
    try {
      this.state = "pickNew";
      this.newCursor = 0;
      this.slotCursor = 0;
      this.newScroll = 0;
      this.slotScroll = 0;
      this.confirmCursor = 0;
      this.pendingMoveId = null;
      this.learnedAny = false;
      this.originalLearnable = [...this.deps.learnableIds];
      this.buildSidePanel();
      this.container.setVisible(true);
      this.active = true;
      this.render();
    } catch (e) {
      // NEVER softlock the level-up: log the real cause + fall back to the
      // per-move learn flow on the next tick (deferred so we are not re-entrant
      // inside setMode/show).
      console.error("[learn-move-batch] show() failed; per-move fallback", e);
      const deps = this.deps;
      globalScene.time.delayedCall(0, () => deps?.fallback());
    }
    return true;
  }

  /** Build the left panel's icon + per-stat base values for the current mon. */
  private buildSidePanel(): void {
    this.destroySideIcon();
    const pokemon = this.deps!.pokemon;
    this.sideIcon = globalScene.addPokemonIcon(pokemon, LEFT_X + LEFT_W / 2, PANEL_Y + 14, 0.5, 0.5, true);
    this.container.add(this.sideIcon);
    const baseStats = pokemon.getSpeciesForm().baseStats;
    PERMANENT_STATS.forEach((stat, i) => this.statValues[i].setText(`${baseStats[stat]}`));
  }

  /** Free slots available on the mon right now. */
  private freeSlotIndex(): number {
    const moveset = this.deps!.pokemon.getMoveset(true);
    return moveset.length < this.deps!.pokemon.getMaxMoveCount() ? moveset.length : -1;
  }

  /** LEARNABLE rows: the learnable moves, then Undo (if anything's been learned) then Cancel. */
  private learnableRows(): string[] {
    const rows = this.deps!.learnableIds.map(id => allMoves[id].name);
    if (this.learnedAny) {
      rows.push("Undo");
    }
    rows.push("Cancel");
    return rows;
  }

  /** CURRENT rows: the live moveset, padded with "(empty)" up to the max slots. */
  private currentRows(): string[] {
    const moveset = this.deps!.pokemon.getMoveset(true);
    const max = this.deps!.pokemon.getMaxMoveCount();
    const rows: string[] = [];
    for (let i = 0; i < max; i++) {
      rows.push(i < moveset.length ? moveset[i].getName() : "(empty)");
    }
    return rows;
  }

  private render(): void {
    const deps = this.deps;
    if (!deps) {
      return;
    }
    const confirming = this.state === "confirmCancel";
    this.promptText.setVisible(confirming);
    for (const t of [this.learnableHeader, this.currentHeader]) {
      t.setVisible(!confirming);
    }

    if (confirming) {
      // Hide the move lists + arrows + cursor so only the confirm prompt shows.
      for (const t of [...this.learnableTexts, ...this.currentTexts]) {
        t.setVisible(false);
      }
      for (const a of [this.learnUp, this.learnDown, this.currentUp, this.currentDown]) {
        a.setVisible(false);
      }
      this.promptText.setText(
        `Skip learning\nany new moves?\n  ${this.confirmCursor === 0 ? "> " : "   "}No    ${this.confirmCursor === 1 ? "> " : "   "}Yes`,
      );
      this.cursorObj?.setVisible(false);
      this.moveInfoOverlay.clear();
      return;
    }

    this.learnableTexts = this.renderColumn(
      this.learnableTexts,
      this.learnableRows(),
      this.newScroll,
      PANEL_X + 12,
      this.learnUp,
      this.learnDown,
    );
    this.currentTexts = this.renderColumn(
      this.currentTexts,
      this.currentRows(),
      this.slotScroll,
      PANEL_X + 12 + COL_GAP,
      this.currentUp,
      this.currentDown,
    );

    this.positionCursor();
    this.updateInfo();
  }

  /**
   * Render one column's VISIBLE_ROWS-tall window of `rows` starting at `scroll`,
   * reusing/destroying the old text objects, and toggle its up/down arrows.
   */
  private renderColumn(
    old: Phaser.GameObjects.Text[],
    rows: string[],
    scroll: number,
    x: number,
    upArrow: Phaser.GameObjects.Text,
    downArrow: Phaser.GameObjects.Text,
  ): Phaser.GameObjects.Text[] {
    for (const t of old) {
      t.destroy();
    }
    const out: Phaser.GameObjects.Text[] = [];
    const end = Math.min(scroll + VISIBLE_ROWS, rows.length);
    for (let i = scroll; i < end; i++) {
      const t = addTextObject(x, ROW_TOP + (i - scroll) * ROW_H, rows[i], TextStyle.WINDOW);
      this.container.add(t);
      out.push(t);
    }
    upArrow.setVisible(scroll > 0);
    downArrow.setVisible(scroll + VISIBLE_ROWS < rows.length);
    return out;
  }

  private positionCursor(): void {
    if (!this.cursorObj || !this.deps) {
      return;
    }
    this.cursorObj.setVisible(true);
    const isSlot = this.state === "pickSlot";
    const cursor = isSlot ? this.slotCursor : this.newCursor;
    const scroll = isSlot ? this.slotScroll : this.newScroll;
    // Origin (0, 0.5): x = arrow's left edge (just left of the column text at
    // PANEL_X + 12), y = vertical centre of the cursor's VISIBLE row.
    const cy = ROW_TOP + (cursor - scroll) * ROW_H + Math.floor(ROW_H / 2);
    this.cursorObj.setPosition(PANEL_X + 4 + (isSlot ? COL_GAP : 0), cy);
  }

  /** Keep the active column's cursor inside its visible window (scroll if needed). */
  private clampScroll(): void {
    if (this.state === "pickSlot") {
      if (this.slotCursor < this.slotScroll) {
        this.slotScroll = this.slotCursor;
      } else if (this.slotCursor >= this.slotScroll + VISIBLE_ROWS) {
        this.slotScroll = this.slotCursor - VISIBLE_ROWS + 1;
      }
    } else if (this.newCursor < this.newScroll) {
      this.newScroll = this.newCursor;
    } else if (this.newCursor >= this.newScroll + VISIBLE_ROWS) {
      this.newScroll = this.newCursor - VISIBLE_ROWS + 1;
    }
  }

  /** Show the highlighted move's info (learnable move, or the slot's current move). */
  private updateInfo(): void {
    const deps = this.deps;
    if (!deps) {
      return;
    }
    if (this.state === "pickSlot") {
      const moveset = deps.pokemon.getMoveset(true);
      const m = moveset[this.slotCursor];
      this.moveInfoOverlay.show(m ? m.getMove() : allMoves[this.pendingMoveId!]);
      return;
    }
    const onCancel = this.newCursor >= deps.learnableIds.length;
    if (onCancel) {
      this.moveInfoOverlay.clear();
    } else {
      this.moveInfoOverlay.show(allMoves[deps.learnableIds[this.newCursor]]);
    }
  }

  processInput(button: Button): boolean {
    try {
      return this.handleInput(button);
    } catch (e) {
      console.error("[learn-move-batch] input failed; per-move fallback", e);
      const deps = this.deps;
      globalScene.time.delayedCall(0, () => deps?.fallback());
      return true;
    }
  }

  private handleInput(button: Button): boolean {
    const deps = this.deps;
    if (!deps) {
      return false;
    }
    let success = false;

    if (this.state === "confirmCancel") {
      switch (button) {
        case Button.LEFT:
        case Button.RIGHT:
          this.confirmCursor = this.confirmCursor === 0 ? 1 : 0;
          success = true;
          break;
        case Button.ACTION:
          if (this.confirmCursor === 1) {
            return this.finish(); // Yes - leave without learning more
          }
          this.state = "pickNew"; // No - back to the list
          success = true;
          break;
        case Button.CANCEL:
          this.state = "pickNew";
          success = true;
          break;
      }
      if (success) {
        globalScene.ui.playSelect();
        this.render();
      }
      return success;
    }

    if (this.state === "pickSlot") {
      const max = deps.pokemon.getMaxMoveCount();
      switch (button) {
        case Button.UP:
          success = this.slotCursor > 0 && this.moveSlotCursor(-1);
          break;
        case Button.DOWN:
          success = this.slotCursor < max - 1 && this.moveSlotCursor(1);
          break;
        case Button.ACTION:
          return this.assignToSlot(this.slotCursor);
        case Button.CANCEL:
          this.state = "pickNew"; // abort the overwrite choice
          this.pendingMoveId = null;
          success = true;
          break;
      }
      if (success) {
        globalScene.ui.playSelect();
        this.render();
      }
      return success;
    }

    // pickNew - rows: [learnable moves...] [Undo (only if learnedAny)] [Cancel].
    const rowCount = deps.learnableIds.length + (this.learnedAny ? 1 : 0) + 1;
    switch (button) {
      case Button.UP:
        success = this.newCursor > 0 && this.moveNewCursor(-1);
        break;
      case Button.DOWN:
        success = this.newCursor < rowCount - 1 && this.moveNewCursor(1);
        break;
      case Button.ACTION:
        return this.confirmNew();
      case Button.CANCEL:
        return this.requestCancel();
    }
    if (success) {
      globalScene.ui.playSelect();
      this.render();
    }
    return success;
  }

  private moveNewCursor(delta: number): boolean {
    this.newCursor += delta;
    this.clampScroll();
    return true;
  }

  private moveSlotCursor(delta: number): boolean {
    this.slotCursor += delta;
    this.clampScroll();
    return true;
  }

  /** ACTION in the LEARNABLE column: learn into a free slot, or pick a slot to overwrite. */
  private confirmNew(): boolean {
    const deps = this.deps!;
    const learnCount = deps.learnableIds.length;
    if (this.newCursor >= learnCount) {
      // Trailing rows: Undo (only when something's been learned) then Cancel.
      if (this.learnedAny && this.newCursor === learnCount) {
        this.undoAll();
        return true;
      }
      return this.requestCancel(); // the Cancel row
    }
    const moveId = deps.learnableIds[this.newCursor];
    const free = this.freeSlotIndex();
    if (free >= 0) {
      this.commitLearn(moveId, free);
      return true;
    }
    // Full - choose which current move to overwrite.
    this.pendingMoveId = moveId;
    this.state = "pickSlot";
    this.slotCursor = 0;
    this.slotScroll = 0;
    globalScene.ui.playSelect();
    this.render();
    return true;
  }

  private assignToSlot(slotIndex: number): boolean {
    const moveId = this.pendingMoveId;
    if (moveId == null) {
      return false;
    }
    this.pendingMoveId = null;
    this.state = "pickNew";
    this.commitLearn(moveId, slotIndex);
    return true;
  }

  /** Silently assign the move (via the phase's assign callback), drop it from the
   * LEARNABLE list, and thin the panel down. Closes when nothing's left to learn. */
  private commitLearn(moveId: MoveId, slotIndex: number): void {
    this.deps!.assign(moveId, slotIndex);
    this.learnedAny = true;
    this.deps!.learnableIds = this.deps!.learnableIds.filter(id => id !== moveId);
    globalScene.ui.playSelect();
    if (this.deps!.learnableIds.length === 0) {
      this.finish();
      return;
    }
    if (this.newCursor > this.deps!.learnableIds.length) {
      this.newCursor = this.deps!.learnableIds.length; // keep cursor in range (Cancel row)
    }
    this.clampScroll();
    this.render();
  }

  /** CANCEL in the list: confirm only when nothing was learned this session. */
  private requestCancel(): boolean {
    if (this.learnedAny) {
      return this.finish();
    }
    this.state = "confirmCancel";
    this.confirmCursor = 0;
    globalScene.ui.playSelect();
    this.render();
    return true;
  }

  /**
   * UNDO row: immediately (no confirm) restore the EXACT pre-panel moveset + the
   * full learnable list and STAY in the panel, so an accidental overwrite is taken
   * back without leaving the level-up. Separate from B (which is the normal exit).
   */
  private undoAll(): void {
    this.deps!.revert();
    this.deps!.learnableIds = [...this.originalLearnable];
    this.learnedAny = false;
    // The Undo row just disappeared; the Cancel row is now last - keep cursor in range.
    const lastRow = this.deps!.learnableIds.length;
    if (this.newCursor > lastRow) {
      this.newCursor = lastRow;
    }
    this.clampScroll();
    globalScene.ui.playSelect();
    this.render();
  }

  private finish(): boolean {
    const done = this.deps?.done;
    this.moveInfoOverlay.clear();
    if (done) {
      done();
    }
    return true;
  }

  private destroySideIcon(): void {
    if (this.sideIcon) {
      this.sideIcon.destroy();
      this.sideIcon = null;
    }
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.moveInfoOverlay.clear();
    for (const t of [...this.learnableTexts, ...this.currentTexts]) {
      t.destroy();
    }
    this.learnableTexts = [];
    this.currentTexts = [];
    this.destroySideIcon();
    this.deps = null;
  }
}
