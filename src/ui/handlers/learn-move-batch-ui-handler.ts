import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { Button } from "#enums/buttons";
import type { MoveId } from "#enums/move-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { LearnMoveBatchDeps } from "#phases/learn-move-batch-phase";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

/** Panel sub-state. Kept INTERNAL (no UiMode switches) so the panel can never
 * desync the mode stack - the softlock class this avoids. */
type PanelState = "pickNew" | "pickSlot" | "confirmCancel";

const PANEL_X = 6;
const PANEL_Y = 22;
const PANEL_W = 180;
const PANEL_H = 96;
const COL_GAP = 92;
const ROW_H = 14;
const ROW_TOP = 44;

/**
 * ER QoL Move Learn panel (see {@linkcode LearnMoveBatchPhase}). One screen on
 * level-up listing the NEW moves this level teaches (LEARNABLE, left) beside the
 * current moveset (CURRENT, right). Pick a learnable move; if there's a free
 * slot it's learned silently, otherwise you pick which current move it overwrites.
 * The learned move drops off the LEARNABLE list (it thins down) so the same move
 * can never be learned twice. Cancel (X / controller / mobile) asks to confirm
 * only when nothing was learned. The highlighted move's info shows via the shared
 * {@linkcode MoveInfoOverlay} (the same panel the combat move-select uses).
 */
export class LearnMoveBatchUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private learnableHeader: Phaser.GameObjects.Text;
  private currentHeader: Phaser.GameObjects.Text;
  private learnableTexts: Phaser.GameObjects.Text[] = [];
  private currentTexts: Phaser.GameObjects.Text[] = [];
  private cancelText: Phaser.GameObjects.Text;
  private promptText: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.Image | null = null;
  private moveInfoOverlay: MoveInfoOverlay;

  private deps: LearnMoveBatchDeps | null = null;
  private state: PanelState = "pickNew";
  /** Cursor in the LEARNABLE column; the extra final row is the Cancel button. */
  private newCursor = 0;
  /** Cursor in the CURRENT column when choosing which move to overwrite. */
  private slotCursor = 0;
  /** Cursor over the confirm-cancel choice: 0 = No (go back), 1 = Yes (leave). */
  private confirmCursor = 0;
  private pendingMoveId: MoveId | null = null;
  private learnedAny = false;

  constructor() {
    super(UiMode.LEARN_MOVE_BATCH);
  }

  setup(): void {
    const ui = this.getUi();
    // The UI container's origin is BOTTOM-left (positive y = DOWN / off-screen),
    // so a visible panel must shift UP by ~canvas height (see ErQuizUiHandler at
    // (0, -height)). Position the container so the window lands CENTERED on screen;
    // children keep their positive PANEL_X/PANEL_Y offsets.
    const sc = globalScene.scaledCanvas;
    const overlayH = MoveInfoOverlay.getHeight(true);
    const winX = Math.floor((sc.width - PANEL_W) / 2);
    // Centre the panel in the space ABOVE the bottom move-info strip so it never
    // overlaps the description/stats box.
    const winY = Math.floor((sc.height - overlayH - PANEL_H) / 2) - sc.height;
    this.container = globalScene.add.container(winX - PANEL_X, winY - PANEL_Y);
    this.container.setVisible(false);
    ui.add(this.container);

    this.container.add(addWindow(PANEL_X, PANEL_Y, PANEL_W, PANEL_H));
    this.learnableHeader = addTextObject(PANEL_X + 6, ROW_TOP - 18, "Learnable", TextStyle.WINDOW_ALT);
    this.currentHeader = addTextObject(PANEL_X + 6 + COL_GAP, ROW_TOP - 18, "Current", TextStyle.WINDOW_ALT);
    this.cancelText = addTextObject(PANEL_X + 6, ROW_TOP + ROW_H * 5, "Cancel", TextStyle.WINDOW);
    this.promptText = addTextObject(PANEL_X + 8, PANEL_Y + 8, "", TextStyle.WINDOW).setVisible(false);
    this.container.add([this.learnableHeader, this.currentHeader, this.cancelText, this.promptText]);

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
      this.confirmCursor = 0;
      this.pendingMoveId = null;
      this.learnedAny = false;
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

  /** Free slots available on the mon right now. */
  private freeSlotIndex(): number {
    const moveset = this.deps!.pokemon.getMoveset(true);
    return moveset.length < this.deps!.pokemon.getMaxMoveCount() ? moveset.length : -1;
  }

  private render(): void {
    const deps = this.deps;
    if (!deps) {
      return;
    }
    const confirming = this.state === "confirmCancel";
    this.promptText.setVisible(confirming);
    for (const t of [this.learnableHeader, this.currentHeader, this.cancelText]) {
      t.setVisible(!confirming);
    }

    if (confirming) {
      // Hide the move lists + cursor so only the confirm prompt shows (otherwise
      // the Learnable/Current rows bleed through behind the question).
      for (const t of [...this.learnableTexts, ...this.currentTexts]) {
        t.setVisible(false);
      }
      // Fixed 3-line layout (NO word-wrap - the wrap units differ from pixels and
      // overflowed). Short lines so they fit the window at the panel font size.
      this.promptText.setText(
        `Skip learning\nany new moves?\n  ${this.confirmCursor === 0 ? "> " : "   "}No    ${this.confirmCursor === 1 ? "> " : "   "}Yes`,
      );
      this.cursorObj?.setVisible(false);
      this.moveInfoOverlay.clear();
      return;
    }

    // LEARNABLE column (left).
    for (const t of this.learnableTexts) {
      t.destroy();
    }
    this.learnableTexts = deps.learnableIds.map((id, i) => {
      const t = addTextObject(PANEL_X + 12, ROW_TOP + i * ROW_H, allMoves[id].name, TextStyle.WINDOW);
      this.container.add(t);
      return t;
    });
    this.cancelText.setY(ROW_TOP + deps.learnableIds.length * ROW_H);

    // CURRENT column (right): the live moveset + any empty slots.
    for (const t of this.currentTexts) {
      t.destroy();
    }
    const moveset = deps.pokemon.getMoveset(true);
    const max = deps.pokemon.getMaxMoveCount();
    this.currentTexts = [];
    for (let i = 0; i < max; i++) {
      const label = i < moveset.length ? moveset[i].getName() : "(empty)";
      const t = addTextObject(PANEL_X + 12 + COL_GAP, ROW_TOP + i * ROW_H, label, TextStyle.WINDOW);
      this.container.add(t);
      this.currentTexts.push(t);
    }

    this.positionCursor();
    this.updateInfo();
  }

  private positionCursor(): void {
    if (!this.cursorObj || !this.deps) {
      return;
    }
    this.cursorObj.setVisible(true);
    // Origin is (0, 0.5): x = arrow's left edge (just left of the column text at
    // PANEL_X + 12), y = vertical centre of the row.
    const cy = ROW_TOP + (this.state === "pickSlot" ? this.slotCursor : this.newCursor) * ROW_H + Math.floor(ROW_H / 2);
    this.cursorObj.setPosition(PANEL_X + 4 + (this.state === "pickSlot" ? COL_GAP : 0), cy);
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
        this.positionCursor();
        this.updateInfo();
      }
      return success;
    }

    // pickNew
    const rowCount = deps.learnableIds.length + 1; // + Cancel row
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
      this.positionCursor();
      this.updateInfo();
    }
    return success;
  }

  private moveNewCursor(delta: number): boolean {
    this.newCursor += delta;
    return true;
  }

  private moveSlotCursor(delta: number): boolean {
    this.slotCursor += delta;
    return true;
  }

  /** ACTION in the LEARNABLE column: learn into a free slot, or pick a slot to overwrite. */
  private confirmNew(): boolean {
    const deps = this.deps!;
    if (this.newCursor >= deps.learnableIds.length) {
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
    globalScene.ui.playSelect();
    this.positionCursor();
    this.updateInfo();
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

  private finish(): boolean {
    const done = this.deps?.done;
    this.moveInfoOverlay.clear();
    if (done) {
      done();
    }
    return true;
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
    this.deps = null;
  }
}
