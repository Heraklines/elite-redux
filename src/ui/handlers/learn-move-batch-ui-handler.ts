import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import {
  getOrRollFormMoveset,
  isErOmniformMon,
  learnMoveForEvolution,
  listOmniformEvolutionsForMove,
  type OmniformTarget,
  omniformFamilyForms,
  type SerializedOmniformMove,
} from "#data/elite-redux/omniform-movesets";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { getShortenedStatKey, PERMANENT_STATS } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { LearnMoveBatchDeps } from "#phases/learn-move-batch-phase";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { OmniformEvolutionStrip, omniformStripWidth } from "#ui/omniform-evolution-strip";
import { type OmniformEvolutionEntry, omniformEntriesForTargets } from "#ui/omniform-evolution-view";
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
/** ER Omniform: extra height reserved at the top of the panel for the evolution strip band. */
const OMNIFORM_BAND_H = 16;
/** ER Omniform: visible rows per column when the strip band is present (keeps the list inside the panel). */
const OMNIFORM_VISIBLE_ROWS = 4;
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

  // ER Omniform (#partner-eevee): the per-evolution teach dimension. When active the
  // panel shows an evolution strip (F / controller LB / mobile apad cycles it); each
  // offered move can be learned onto EVERY evolution independently (base first), and
  // the CURRENT column + slot-replace flow operate on the SELECTED evolution's own
  // stored moveset. Inactive (all fields empty) for a normal single-form mon.
  private omniformActive = false;
  private omniformStrip: OmniformEvolutionStrip | null = null;
  private omniformEntries: OmniformEvolutionEntry[] = [];
  /** Teach targets, parallel to {@link omniformEntries}; base first (index 0). */
  private omniformTargets: OmniformTarget[] = [];
  private omniformSel = 0;
  private omniformNameText: Phaser.GameObjects.Text | null = null;
  /** Deep copies of each NON-base evolution's stored moveset at show(), so Undo restores them. */
  private omniformSnapshots: SerializedOmniformMove[][] = [];

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
      this.setupOmniform();
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

  // ---------------------------------------------------------------------------
  // ER Omniform (#partner-eevee): per-evolution teach dimension.
  // ---------------------------------------------------------------------------

  /**
   * Build (or clear) the evolution strip + per-evolution state for the current mon.
   * Active only when the phase flagged `deps.omniform` AND the mon really is an
   * Omniform holder with > 1 family form; otherwise the panel behaves exactly like
   * the vanilla single-moveset panel (the strip never renders).
   */
  private setupOmniform(): void {
    this.destroyOmniform();
    const deps = this.deps;
    if (!deps?.omniform || !isErOmniformMon(deps.pokemon)) {
      this.repositionRows();
      return;
    }
    const targets = omniformFamilyForms(deps.pokemon);
    if (targets.length <= 1) {
      this.repositionRows();
      return;
    }
    this.omniformActive = true;
    this.omniformTargets = targets;
    this.omniformEntries = omniformEntriesForTargets(deps.pokemon, targets);
    // A level-up happens on the base form, so default the selection to base (index 0).
    this.omniformSel = 0;
    // Deep-snapshot each NON-base evolution's stored moveset so Undo can restore it
    // (the base form's moveset is restored by deps.revert). getOrRollFormMoveset
    // returns the live stored array, so copy each [moveId, ppUsed] pair.
    this.omniformSnapshots = targets.map((form, i) =>
      i === 0 ? [] : getOrRollFormMoveset(deps.pokemon, form).map(([m, pp]) => [m, pp] as SerializedOmniformMove),
    );
    // Selected-evolution name label in the top band (left), strip right-aligned.
    this.omniformNameText = addTextObject(PANEL_X + 6, PANEL_Y + 9, "", TextStyle.WINDOW_ALT).setOrigin(0, 0.5);
    this.container.add(this.omniformNameText);
    const stripWindow = 5;
    const stripCell = 15;
    const rightEdgeX = PANEL_X + PANEL_W - 6;
    this.omniformStrip = new OmniformEvolutionStrip(this.container, this.omniformEntries, this.omniformSel, {
      x: rightEdgeX - omniformStripWidth(stripWindow, stripCell),
      y: PANEL_Y + 9,
      windowSize: stripWindow,
      cellWidth: stripCell,
      iconScale: 0.45,
      onChange: index => this.onOmniformSelect(index),
    });
    this.repositionRows();
    this.updateOmniformName();
  }

  private destroyOmniform(): void {
    this.omniformStrip?.destroy();
    this.omniformStrip = null;
    this.omniformNameText?.destroy();
    this.omniformNameText = null;
    this.omniformEntries = [];
    this.omniformTargets = [];
    this.omniformSnapshots = [];
    this.omniformActive = false;
    this.omniformSel = 0;
  }

  /** Reposition the column headers + scroll arrows for the (optional) top strip band. */
  private repositionRows(): void {
    const band = this.omniformActive ? OMNIFORM_BAND_H : 0;
    this.learnableHeader.y = ROW_TOP - 18 + band;
    this.currentHeader.y = ROW_TOP - 18 + band;
    this.learnUp.y = ROW_TOP - 9 + band;
    this.currentUp.y = ROW_TOP - 9 + band;
    const botY = ROW_TOP + this.visibleRows() * ROW_H + band;
    this.learnDown.y = botY;
    this.currentDown.y = botY;
  }

  /** Top Y of the first list row (shifted down by the strip band when Omniform). */
  private listTop(): number {
    return ROW_TOP + (this.omniformActive ? OMNIFORM_BAND_H : 0);
  }

  /** Visible rows per column (fewer when the strip band eats vertical space). */
  private visibleRows(): number {
    return this.omniformActive ? OMNIFORM_VISIBLE_ROWS : VISIBLE_ROWS;
  }

  /** The selected evolution's teach target, or null when not Omniform. */
  private selectedTarget(): OmniformTarget | null {
    return this.omniformActive ? (this.omniformTargets[this.omniformSel] ?? null) : null;
  }

  /** Whether the selected evolution is the base form (index 0 of the base-first family). */
  private selectedIsBase(): boolean {
    return this.omniformSel === 0;
  }

  /** Strip selection changed (F / apad): re-target the CURRENT column + offers. */
  private onOmniformSelect(index: number): void {
    this.omniformSel = index;
    if (this.state === "pickSlot") {
      // Switching evolutions aborts an in-progress overwrite pick.
      this.state = "pickNew";
      this.pendingMoveId = null;
    }
    this.clampScroll();
    this.updateOmniformName();
    globalScene.ui.playSelect();
    this.render();
  }

  private updateOmniformName(): void {
    const entry = this.omniformEntries[this.omniformSel];
    // A COMPACT label: the bare species name minus the "Partner " family prefix
    // ("Eevee", "Vaporeon", ...). The full "Eevee (Partner)" / "Partner Vaporeon"
    // collides with the strip in the narrow top band.
    this.omniformNameText?.setText(entry ? entry.species.getName().replace(/^Partner\s+/i, "") : "");
  }

  /**
   * The offered moves annotated for the SELECTED evolution: `disabled` when this
   * evolution cannot legally take the move OR already knows it (illegal targets are
   * shown dimmed + non-selectable per the maintainer spec). Order matches
   * {@link LearnMoveBatchDeps.learnableIds}.
   */
  private omniformOffers(): { name: string; moveId: MoveId; disabled: boolean }[] {
    const deps = this.deps!;
    const form = this.selectedTarget();
    return deps.learnableIds.map(id => {
      const offer = form
        ? listOmniformEvolutionsForMove(deps.pokemon, id).find(
            o => o.form.speciesId === form.speciesId && o.form.formIndex === form.formIndex,
          )
        : undefined;
      return { name: allMoves[id].name, moveId: id, disabled: !offer || !offer.canLearn };
    });
  }

  /** Free slots available on the SELECTED evolution (base = live moveset, else its stored set). */
  private freeSlotIndex(): number {
    const pokemon = this.deps!.pokemon;
    const max = pokemon.getMaxMoveCount();
    if (this.omniformActive && !this.selectedIsBase()) {
      const stored = getOrRollFormMoveset(pokemon, this.selectedTarget()!);
      const filled = stored.filter(([m]) => m !== MoveId.NONE).length;
      return filled < max ? filled : -1;
    }
    const moveset = pokemon.getMoveset(true);
    return moveset.length < max ? moveset.length : -1;
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

  /** CURRENT rows: the selected form's moveset, padded with "(empty)" up to the max slots. */
  private currentRows(): string[] {
    const pokemon = this.deps!.pokemon;
    const max = pokemon.getMaxMoveCount();
    const rows: string[] = [];
    // ER Omniform: a non-base evolution shows ITS OWN stored moveset (the set the
    // replace flow edits), not the live Eevee moveset.
    if (this.omniformActive && !this.selectedIsBase()) {
      const stored = getOrRollFormMoveset(pokemon, this.selectedTarget()!);
      for (let i = 0; i < max; i++) {
        const pair = stored[i];
        rows.push(pair && pair[0] !== MoveId.NONE ? allMoves[pair[0]].name : "(empty)");
      }
      return rows;
    }
    const moveset = pokemon.getMoveset(true);
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
    this.omniformStrip?.setVisible(this.omniformActive && !confirming);
    this.omniformNameText?.setVisible(this.omniformActive && !confirming);

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

    // ER Omniform: the LEARNABLE column shows the offered moves annotated for the
    // SELECTED evolution (illegal / already-known ones dimmed + non-selectable),
    // then the Undo / Cancel rows. The vanilla panel thins the list as moves are
    // learned; the Omniform panel keeps every offered move (expanded per evolution).
    let learnRows: string[];
    let learnDisabled: boolean[] | null = null;
    if (this.omniformActive) {
      const offers = this.omniformOffers();
      learnRows = offers.map(o => o.name);
      learnDisabled = offers.map(o => o.disabled);
      if (this.learnedAny) {
        learnRows.push("Undo");
        learnDisabled.push(false);
      }
      learnRows.push("Cancel");
      learnDisabled.push(false);
    } else {
      learnRows = this.learnableRows();
    }

    const top = this.listTop();
    const vis = this.visibleRows();
    this.learnableTexts = this.renderColumn(
      this.learnableTexts,
      learnRows,
      this.newScroll,
      PANEL_X + 12,
      this.learnUp,
      this.learnDown,
      top,
      vis,
      learnDisabled,
    );
    this.currentTexts = this.renderColumn(
      this.currentTexts,
      this.currentRows(),
      this.slotScroll,
      PANEL_X + 12 + COL_GAP,
      this.currentUp,
      this.currentDown,
      top,
      vis,
      null,
    );

    this.positionCursor();
    this.updateInfo();
  }

  /**
   * Render one column's `visRows`-tall window of `rows` starting at `scroll`,
   * reusing/destroying the old text objects, and toggle its up/down arrows. Rows
   * flagged in `disabled` are dimmed (illegal / already-known Omniform offers).
   */
  private renderColumn(
    old: Phaser.GameObjects.Text[],
    rows: string[],
    scroll: number,
    x: number,
    upArrow: Phaser.GameObjects.Text,
    downArrow: Phaser.GameObjects.Text,
    top: number,
    visRows: number,
    disabled: boolean[] | null,
  ): Phaser.GameObjects.Text[] {
    for (const t of old) {
      t.destroy();
    }
    const out: Phaser.GameObjects.Text[] = [];
    const end = Math.min(scroll + visRows, rows.length);
    for (let i = scroll; i < end; i++) {
      const t = addTextObject(x, top + (i - scroll) * ROW_H, rows[i], TextStyle.WINDOW);
      if (disabled?.[i]) {
        t.setAlpha(0.5);
      }
      this.container.add(t);
      out.push(t);
    }
    upArrow.setVisible(scroll > 0);
    downArrow.setVisible(scroll + visRows < rows.length);
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
    const cy = this.listTop() + (cursor - scroll) * ROW_H + Math.floor(ROW_H / 2);
    this.cursorObj.setPosition(PANEL_X + 4 + (isSlot ? COL_GAP : 0), cy);
  }

  /** Keep the active column's cursor inside its visible window (scroll if needed). */
  private clampScroll(): void {
    const vis = this.visibleRows();
    if (this.state === "pickSlot") {
      if (this.slotCursor < this.slotScroll) {
        this.slotScroll = this.slotCursor;
      } else if (this.slotCursor >= this.slotScroll + vis) {
        this.slotScroll = this.slotCursor - vis + 1;
      }
    } else if (this.newCursor < this.newScroll) {
      this.newScroll = this.newCursor;
    } else if (this.newCursor >= this.newScroll + vis) {
      this.newScroll = this.newCursor - vis + 1;
    }
  }

  /** Show the highlighted move's info (learnable move, or the slot's current move). */
  private updateInfo(): void {
    const deps = this.deps;
    if (!deps) {
      return;
    }
    if (this.state === "pickSlot") {
      // ER Omniform: a non-base evolution's slots come from ITS stored moveset.
      if (this.omniformActive && !this.selectedIsBase()) {
        const stored = getOrRollFormMoveset(deps.pokemon, this.selectedTarget()!);
        const pair = stored[this.slotCursor];
        this.moveInfoOverlay.show(pair && pair[0] !== MoveId.NONE ? allMoves[pair[0]] : allMoves[this.pendingMoveId!]);
        return;
      }
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

    // ER Omniform: the dedicated cycle button (F / controller LB / mobile apad)
    // switches which evolution's moveset the panel is teaching. Routed here via
    // buttonCycleOption (LearnMoveBatchUiHandler is whitelisted, mirroring the
    // summary strip). Blocked only on the confirm-cancel sub-prompt.
    if (this.omniformActive && button === Button.CYCLE_FORM && this.state !== "confirmCancel") {
      this.omniformStrip?.cycle();
      return true;
    }

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
    // ER Omniform: block a move the SELECTED evolution can't legally take or already
    // knows (rendered dimmed) - it is offered but not selectable for this evolution.
    if (this.omniformActive) {
      const form = this.selectedTarget();
      const offer = form
        ? listOmniformEvolutionsForMove(deps.pokemon, moveId).find(
            o => o.form.speciesId === form.speciesId && o.form.formIndex === form.formIndex,
          )
        : undefined;
      if (!offer || !offer.canLearn) {
        globalScene.ui.playError();
        return true;
      }
    }
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

  /**
   * Silently assign the move. Vanilla: via the phase's assign callback (the live
   * moveset), then drop it from the LEARNABLE list + thin the panel; closes when
   * nothing's left. ER Omniform: the BASE form learns through the same assign
   * callback (the `mon.moveset` path - not double-routed); every non-base evolution
   * learns into its OWN stored moveset via `learnMoveForEvolution`. The offered move
   * is NOT removed (it stays teachable to other evolutions), so the panel closes
   * only via Cancel.
   */
  private commitLearn(moveId: MoveId, slotIndex: number): void {
    if (this.omniformActive && !this.selectedIsBase()) {
      const res = learnMoveForEvolution(this.deps!.pokemon, this.selectedTarget()!, moveId, slotIndex);
      if (!res.ok) {
        globalScene.ui.playError();
        return;
      }
    } else {
      this.deps!.assign(moveId, slotIndex);
    }
    this.learnedAny = true;
    globalScene.ui.playSelect();
    if (this.omniformActive) {
      // Keep the offered move (expanded per evolution, not in total); it now reads
      // as already-known (dimmed) for THIS evolution but stays open to others.
      this.clampScroll();
      this.render();
      return;
    }
    this.deps!.learnableIds = this.deps!.learnableIds.filter(id => id !== moveId);
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
    // ER Omniform: also restore every non-base evolution's stored moveset from the
    // pre-panel snapshot (revert() only restores the base form's live moveset). Each
    // stored array is mutated in place by learnMoveForEvolution, so splice it back.
    if (this.omniformActive) {
      for (let i = 1; i < this.omniformTargets.length; i++) {
        const live = getOrRollFormMoveset(this.deps!.pokemon, this.omniformTargets[i]);
        live.splice(0, live.length, ...this.omniformSnapshots[i].map(([m, pp]) => [m, pp] as SerializedOmniformMove));
      }
      this.learnedAny = false;
      this.clampScroll();
      globalScene.ui.playSelect();
      this.render();
      return;
    }
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
    this.destroyOmniform();
    this.deps = null;
  }
}
