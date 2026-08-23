/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody contextual choice panel (Phaser component + UiHandler).
//
// Serves both independent Moody panel families on one mode:
//  - MoodyChoicePanelModel: centered single-pane choices (Microclimate /
//    Terrain Weaver picks, Final Draft endings, Time Loop rewind, Last Rites,
//    post-battle decision queue). Queued decisions show "Decision 1 / 2".
//  - MoodyOperationModel: left checklist + right paged detail pane for the
//    production operations (Bounty Board, Legacy Slot, Borrowed Future,
//    Blood Market, Pressure Valve, Recycler, item stacks). Committed
//    (locked, irrevocable) enemy actions lead the detail pane; long
//    descriptions/consequence lines page with a ☰ indicator.
//
// Renderers never branch on which boon triggered the choice - the caller
// encodes that in the model.
//
// Input parity: UP/DOWN move the cursor (or page the detail pane while it
// overflows tops/bottoms), LEFT/RIGHT reorder Borrowed Future rows (or page /
// move otherwise), ACTION selects or confirms, CANCEL dismisses only when the
// model allows it; tapping a row focuses, tapping again confirms, and the
// paging chevrons are tappable.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { PartyUiMode } from "#ui/handlers/party-ui-handler";
import {
  isMoodyOperationModel,
  type MoodyOperationModel,
  type MoodyOperationOption,
  type MoodyOperationResult,
  moodyOperationSelectionLabel,
} from "#ui/moody/moody-operation";
import { type MoodyChoicePanelModel, moodyTruncate } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

// ---------------------------------------------------------------------------
// Shared (non-operation) panel geometry: unchanged single-pane layout.
// ---------------------------------------------------------------------------
const OPTION_ROW_STEP = 24;
const MAX_VISIBLE_OPTIONS = 4;
const PANE_WIDTH = 232;
const PANE_HEIGHT = 8 + 12 + MAX_VISIBLE_OPTIONS * OPTION_ROW_STEP + 6;
const COMPACT_PANE_WIDTH = 122;
const COMPACT_PANE_HEIGHT = 62;
const COMPACT_ROW_STEP = 15;

// ---------------------------------------------------------------------------
// Operation panel geometry (320x180 logical viewport).
//
// Two panes share one band: a left option list (148 wide) and a right detail
// pane (161 wide). Option labels sit at 40px and all secondary text at 28px,
// i.e. never below the game's ~6.6px body floor at the x6 scale factor.
// Descriptions and consequence lines are clipped by a geometry mask and paged
// with UP/DOWN on the controller/keyboard parity path, touch paging, or the
// paging chevrons; the indicator ("1/3" plus ▲/▼ chevrons) only appears when
// the focused entry actually overflows, and the current page is echoed in the
// clipboard-line body text so overflowing lines remain inspectable.
// ---------------------------------------------------------------------------
const OP_LEFT_PANE_X = 5;
const OP_PANE_Y = 39;
const OP_PANE_HEIGHT = 122;
const OP_LEFT_PANE_WIDTH = 148;
const OP_RIGHT_PANE_X = 156;
const OP_RIGHT_PANE_WIDTH = 159;
const OP_PROMPT_Y = OP_PANE_Y + 16;
const OP_LIST_TOP = OP_PANE_Y + 26;
const OP_LABEL_X = OP_LEFT_PANE_X + 9;
const OP_LABEL_WRAP_WIDTH = (OP_LEFT_PANE_WIDTH - 16) * 6;
const OP_PROMPT_WRAP_WIDTH = (OP_LEFT_PANE_WIDTH - 14) * 6;
const OP_RIGHT_TEXT_X = OP_RIGHT_PANE_X + 5;
const OP_RIGHT_TEXT_HEIGHT = OP_PANE_HEIGHT - 26;
const OP_RIGHT_WRAP_WIDTH = (OP_RIGHT_PANE_WIDTH - 11) * 6;
const OP_PAGER_Y = OP_PANE_Y + OP_PANE_HEIGHT - 9;

const SCALE = 6;
const BORROWED_FUTURE_Y = 4;
const BORROWED_FUTURE_CELL_WIDTH = 62;
const BORROWED_FUTURE_HEIGHT = 24;

export class MoodyChoiceUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private dimmer: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private promptText: Phaser.GameObjects.Text;
  private optionLabels: Phaser.GameObjects.Text[] = [];
  private optionDescs: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.NineSlice;
  private queueText: Phaser.GameObjects.Text;
  private pane: Phaser.GameObjects.NineSlice;
  private optionHit: Phaser.GameObjects.Zone;
  private operationDetailBg: Phaser.GameObjects.NineSlice;
  private operationDetailText: Phaser.GameObjects.Text;
  private operationPagerText: Phaser.GameObjects.Text;
  private pagerUpHit: Phaser.GameObjects.Zone;
  private pagerDownHit: Phaser.GameObjects.Zone;
  private borrowedFutureContainer: Phaser.GameObjects.Container;

  private model: MoodyChoicePanelModel | MoodyOperationModel | null = null;
  private operationOptions: MoodyOperationOption[] = [];
  private operationSelected = new Set<string>();
  private onComplete: ((result: string | null | MoodyOperationResult) => void) | null = null;
  private scrollTop = 0;
  private detailPages: string[] = [""];
  private detailPageIndex = 0;
  private compactChoice = false;
  private borrowedFuture = false;
  private choicePaneX = 0;
  private choicePaneY = 0;
  private choicePaneWidth = PANE_WIDTH;
  private choiceRowStep = OPTION_ROW_STEP;

  constructor() {
    super(UiMode.MOODY_CHOICE);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setName("moody-choice");
    this.container.setVisible(false);
    ui.add(this.container);

    const paneW = PANE_WIDTH;
    const paneH = PANE_HEIGHT;
    const paneX = (w - paneW) / 2;
    const paneY = (h - paneH) / 2;

    this.dimmer = globalScene.add.rectangle(0, 0, w, h, 0x000000, 0.55).setOrigin(0);
    this.container.add(this.dimmer);
    this.pane = addWindow(paneX, paneY, paneW, paneH);
    this.container.add(this.pane);

    this.titleText = addTextObject(paneX + paneW / 2, paneY + 4, "", TextStyle.SUMMARY_HEADER, { fontSize: "40px" });
    this.titleText.setOrigin(0.5, 0);
    this.container.add(this.titleText);
    this.queueText = addTextObject(paneX + paneW - 8, paneY + 5, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
    this.queueText.setOrigin(1, 0).setAlpha(0.8);
    this.container.add(this.queueText);
    this.promptText = addTextObject(paneX + 10, paneY + 14, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
    this.promptText.setOrigin(0, 0).setAlpha(0.85);
    this.container.add(this.promptText);

    for (let row = 0; row < MAX_VISIBLE_OPTIONS; row++) {
      const label = addTextObject(paneX + 14, paneY + 26 + row * OPTION_ROW_STEP, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "40px",
      });
      label.setOrigin(0, 0);
      const desc = addTextObject(paneX + 22, paneY + 26 + row * OPTION_ROW_STEP + 9, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "28px",
        fixedWidth: (paneW - 40) * 6,
        maxLines: 3,
        wordWrap: { width: (paneW - 40) * 6, useAdvancedWrap: true },
      });
      desc.setOrigin(0, 0).setAlpha(0.8);
      this.container.add([label, desc]);
      this.optionLabels.push(label);
      this.optionDescs.push(desc);
    }

    this.cursorObj = globalScene.add
      .nineslice(0, 0, "summary_moves_cursor", undefined, paneW - 12, OPTION_ROW_STEP - 2, 1, 1, 1, 1)
      .setOrigin(0)
      .setVisible(false);
    this.container.add(this.cursorObj);

    this.optionHit = globalScene.add
      .zone(paneX, paneY + 22, paneW, MAX_VISIBLE_OPTIONS * OPTION_ROW_STEP + 4)
      .setOrigin(0);
    this.optionHit.setInteractive({ useHandCursor: true });
    this.optionHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.active) {
        return;
      }
      const localY = pointer.y / 6 - (this.choicePaneY + (this.compactChoice ? 14 : 22));
      const slot = Math.max(0, Math.min(MAX_VISIBLE_OPTIONS - 1, Math.floor(localY / this.choiceRowStep)));
      const index = this.scrollTop + slot;
      if (this.model == null || index >= this.model.options.length) {
        return;
      }
      if (index === this.cursor) {
        this.activateFocused();
      } else {
        this.setCursor(index);
        this.getUi().playSelect();
      }
      pointer.event?.stopPropagation?.();
    });
    this.container.add(this.optionHit);

    this.operationDetailBg = addWindow(OP_RIGHT_PANE_X, OP_PANE_Y, OP_RIGHT_PANE_WIDTH, OP_PANE_HEIGHT).setVisible(
      false,
    );
    this.operationDetailText = addTextObject(OP_RIGHT_TEXT_X, OP_PANE_Y + 16, "", TextStyle.WINDOW, {
      fontSize: "26px",
      wordWrap: { width: OP_RIGHT_WRAP_WIDTH, useAdvancedWrap: true },
    })
      .setOrigin(0, 0)
      .setVisible(false);
    this.container.add([this.operationDetailBg, this.operationDetailText]);

    // Clip the detail text to the right pane; description / consequence pages
    // move vertically inside this window.
    const detailMask = globalScene.make.graphics();
    detailMask.fillStyle(0xffffff);
    detailMask.fillRect(
      OP_RIGHT_PANE_X * SCALE,
      (OP_PANE_Y + 15) * SCALE,
      (OP_RIGHT_PANE_WIDTH - 3) * SCALE,
      (OP_RIGHT_TEXT_HEIGHT - 2) * SCALE,
    );
    this.operationDetailText.setMask(detailMask.createGeometryMask());

    // Paging indicator: only visible while overflowing content sits behind the
    // mask. The chevron zones give touch parity with UP/DOWN paging.
    this.operationPagerText = addTextObject(
      OP_RIGHT_PANE_X + OP_RIGHT_PANE_WIDTH - 6,
      OP_PAGER_Y,
      "",
      TextStyle.WINDOW,
      { fontSize: "26px" },
    )
      .setOrigin(1, 0)
      .setVisible(false);
    this.container.add(this.operationPagerText);
    this.pagerUpHit = globalScene.add
      .zone(OP_RIGHT_PANE_X + OP_RIGHT_PANE_WIDTH - 40, OP_PAGER_Y - 6, 24, 18)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.pagerUpHit.on("pointerdown", () => {
      if (this.active) {
        this.pageDetail(-1);
      }
    });
    this.pagerDownHit = globalScene.add
      .zone(OP_RIGHT_PANE_X + OP_RIGHT_PANE_WIDTH - 5, OP_PAGER_Y - 6, 24, 18)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.pagerDownHit.on("pointerdown", () => {
      if (this.active) {
        this.pageDetail(1);
      }
    });
    this.container.add([this.pagerUpHit, this.pagerDownHit]);

    this.borrowedFutureContainer = globalScene.add.container(0, 0).setVisible(false);
    this.container.add(this.borrowedFutureContainer);
  }

  /**
   * show() args: [model: MoodyChoicePanelModel, onComplete: (optionId | null) => void]
   * `optionId` is null when the player cancels (only possible if the model allows it).
   */
  show(args: any[]): boolean {
    if (args.length < 2 || typeof args[0] !== "object" || !(args[1] instanceof Function)) {
      return false;
    }
    if (!super.show(args)) {
      return false;
    }
    this.model = args[0] as MoodyChoicePanelModel | MoodyOperationModel;
    this.onComplete = args[1] as (result: string | null | MoodyOperationResult) => void;
    this.operationOptions = isMoodyOperationModel(this.model) ? this.model.options.map(option => ({ ...option })) : [];
    this.operationSelected = new Set(this.operationOptions.filter(option => option.selected).map(option => option.id));
    const operation = isMoodyOperationModel(this.model);
    this.borrowedFuture = operation && isMoodyOperationModel(this.model) && this.model.kind === "borrowed-future";
    this.compactChoice = !operation && this.model.title === "FINAL DRAFT";
    this.dimmer.setVisible(!this.compactChoice && !this.borrowedFuture);
    this.pane.setVisible(!this.borrowedFuture);
    this.titleText.setVisible(!this.borrowedFuture);
    this.queueText.setVisible(!this.borrowedFuture);
    this.promptText.setVisible(!this.borrowedFuture);
    this.optionHit.setVisible(!this.borrowedFuture);
    this.operationDetailBg.setVisible(operation && !this.borrowedFuture);
    this.operationDetailText.setVisible(operation && !this.borrowedFuture);
    this.borrowedFutureContainer.setVisible(this.borrowedFuture);
    const paneX = (globalScene.scaledCanvas.width - PANE_WIDTH) / 2;
    const paneY = (globalScene.scaledCanvas.height - PANE_HEIGHT) / 2;
    if (this.borrowedFuture) {
      this.choicePaneX = 0;
      this.choicePaneY = BORROWED_FUTURE_Y;
      this.choicePaneWidth = 0;
      this.choiceRowStep = 0;
    } else if (operation) {
      this.titleText.setOrigin(0.5, 0).setFontSize("40px");
      this.pane.setPosition(OP_LEFT_PANE_X, OP_PANE_Y).setSize(OP_LEFT_PANE_WIDTH, OP_PANE_HEIGHT);
      this.titleText.setPosition(OP_LEFT_PANE_X + OP_LEFT_PANE_WIDTH / 2, OP_PANE_Y + 5);
      this.queueText.setPosition(OP_LEFT_PANE_X + OP_LEFT_PANE_WIDTH - 5, OP_PANE_Y + 6);
      this.promptText
        .setPosition(OP_LEFT_PANE_X + 7, OP_PROMPT_Y)
        .setWordWrapWidth(OP_PROMPT_WRAP_WIDTH, true)
        .setFixedSize((OP_LEFT_PANE_WIDTH - 14) * SCALE, 9 * SCALE)
        .setMaxLines(1);
      this.optionHit
        .setPosition(OP_LEFT_PANE_X, OP_LIST_TOP - 4)
        .setSize(OP_LEFT_PANE_WIDTH, MAX_VISIBLE_OPTIONS * OPTION_ROW_STEP + 4);
      this.promptText.setVisible(true);
      this.choicePaneX = OP_LEFT_PANE_X;
      this.choicePaneY = OP_PANE_Y;
      this.choicePaneWidth = OP_LEFT_PANE_WIDTH;
      this.choiceRowStep = OPTION_ROW_STEP;
    } else if (this.compactChoice) {
      const compactX = globalScene.scaledCanvas.width - COMPACT_PANE_WIDTH - 4;
      const compactY = globalScene.scaledCanvas.height - COMPACT_PANE_HEIGHT - 4;
      this.choicePaneX = compactX;
      this.choicePaneY = compactY;
      this.choicePaneWidth = COMPACT_PANE_WIDTH;
      this.choiceRowStep = COMPACT_ROW_STEP;
      this.pane.setPosition(compactX, compactY).setSize(COMPACT_PANE_WIDTH, COMPACT_PANE_HEIGHT);
      this.titleText
        .setOrigin(0, 0)
        .setPosition(compactX + 6, compactY + 3)
        .setFontSize("30px");
      this.queueText
        .setVisible(true)
        .setPosition(compactX + COMPACT_PANE_WIDTH - 5, compactY + 3)
        .setFontSize("24px");
      this.promptText.setVisible(false);
      this.optionHit
        .setPosition(compactX, compactY + 14)
        .setSize(COMPACT_PANE_WIDTH, MAX_VISIBLE_OPTIONS * COMPACT_ROW_STEP + 2);
    } else {
      this.titleText.setOrigin(0.5, 0).setFontSize("40px");
      this.queueText.setVisible(true).setFontSize("30px");
      this.pane.setPosition(paneX, paneY).setSize(PANE_WIDTH, PANE_HEIGHT);
      this.titleText.setPosition(paneX + PANE_WIDTH / 2, paneY + 4);
      this.queueText.setPosition(paneX + PANE_WIDTH - 8, paneY + 5);
      this.promptText
        .setVisible(true)
        .setPosition(paneX + 10, paneY + 14)
        .setFixedSize(0, 0)
        .setMaxLines(0);
      this.optionHit.setPosition(paneX, paneY + 22).setSize(PANE_WIDTH, MAX_VISIBLE_OPTIONS * OPTION_ROW_STEP + 4);
      this.choicePaneX = paneX;
      this.choicePaneY = paneY;
      this.choicePaneWidth = PANE_WIDTH;
      this.choiceRowStep = OPTION_ROW_STEP;
    }
    for (let row = 0; row < MAX_VISIBLE_OPTIONS; row++) {
      if (this.borrowedFuture) {
        this.optionLabels[row].setVisible(false).setText("");
        this.optionDescs[row].setVisible(false).setText("");
      } else if (operation) {
        this.optionLabels[row]
          .setVisible(true)
          .setPosition(OP_LABEL_X, OP_LIST_TOP + row * OPTION_ROW_STEP)
          .setWordWrapWidth(OP_LABEL_WRAP_WIDTH, true)
          .setFixedSize((OP_LEFT_PANE_WIDTH - 16) * SCALE, 9 * SCALE)
          .setMaxLines(1);
        this.optionDescs[row].setVisible(false).setText("");
      } else if (this.compactChoice) {
        this.optionLabels[row]
          .setVisible(true)
          .setPosition(this.choicePaneX + 8, this.choicePaneY + 16 + row * COMPACT_ROW_STEP)
          .setFixedSize((COMPACT_PANE_WIDTH - 14) * SCALE, 10 * SCALE)
          .setMaxLines(1)
          .setFontSize("28px");
        this.optionDescs[row].setVisible(false).setText("");
      } else {
        this.optionLabels[row]
          .setVisible(true)
          .setPosition(paneX + 14, paneY + 26 + row * OPTION_ROW_STEP)
          .setFixedSize(0, 0)
          .setMaxLines(0);
        this.optionDescs[row].setVisible(true);
      }
    }
    this.scrollTop = 0;
    this.detailPageIndex = 0;
    this.setCursor(0);
    this.refresh();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  private refresh(): void {
    if (this.model == null) {
      return;
    }
    if (this.borrowedFuture && isMoodyOperationModel(this.model)) {
      this.refreshBorrowedFuture();
      return;
    }
    const options = this.getOptions();
    const count = options.length;
    if (this.cursor < this.scrollTop) {
      this.scrollTop = this.cursor;
    } else if (this.cursor >= this.scrollTop + MAX_VISIBLE_OPTIONS) {
      this.scrollTop = this.cursor - MAX_VISIBLE_OPTIONS + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, count - MAX_VISIBLE_OPTIONS)));

    if (isMoodyOperationModel(this.model)) {
      this.refreshOperation(options);
      return;
    }
    this.titleText.setText(this.model.title);
    this.queueText.setText(this.model.queueLabel ?? "");
    this.promptText.setText(this.model.prompt ?? "");
    this.operationPagerText.setVisible(false);
    this.pagerUpHit.setVisible(false);
    this.pagerDownHit.setVisible(false);
    const paneY = this.choicePaneY;
    const paneX = this.choicePaneX;
    this.cursorObj
      .setVisible(count > 0)
      .setPosition(
        paneX + 4,
        paneY + (this.compactChoice ? 15 : 25) + (this.cursor - this.scrollTop) * this.choiceRowStep,
      )
      .setSize(this.choicePaneWidth - 8, this.choiceRowStep - 1);
    for (let slot = 0; slot < MAX_VISIBLE_OPTIONS; slot++) {
      const option = options[this.scrollTop + slot] as MoodyChoicePanelModel["options"][number] | undefined;
      if (option == null) {
        this.optionLabels[slot].setText("");
        this.optionDescs[slot].setText("");
        continue;
      }
      this.optionLabels[slot]
        .setText(
          this.compactChoice
            ? moodyTruncate(
                `${option.label}: ${option.description}${option.costLine == null ? "" : `; ${option.costLine}`}`,
                41,
              )
            : option.label,
        )
        .setAlpha(1);
      const cost = option.costLine == null ? "" : `\n${option.costLine}`;
      this.optionDescs[slot].setText(this.compactChoice ? "" : `${option.description}${cost}`);
    }
  }

  private refreshBorrowedFuture(): void {
    if (this.model == null || !isMoodyOperationModel(this.model)) {
      return;
    }
    this.borrowedFutureContainer.removeAll(true);
    const actions = this.model.committedActions ?? [];
    const actionCount = Math.max(1, Math.min(3, actions.length));
    const width = Math.min(194, Math.max(148, actionCount * BORROWED_FUTURE_CELL_WIDTH + 8));
    const x = Math.round((globalScene.scaledCanvas.width - width) / 2);
    this.borrowedFutureContainer.add(addWindow(x, BORROWED_FUTURE_Y, width, BORROWED_FUTURE_HEIGHT));

    const title = addTextObject(x + 5, BORROWED_FUTURE_Y + 2, "BORROWED FUTURE", TextStyle.SUMMARY_HEADER, {
      fontSize: "28px",
    }).setOrigin(0);
    const begin = addTextObject(x + width - 55, BORROWED_FUTURE_Y + 2, "A BEGIN", TextStyle.SETTINGS_LABEL, {
      fontSize: "24px",
    }).setOrigin(1, 0);
    const reorder = addTextObject(x + width - 4, BORROWED_FUTURE_Y + 2, "\u2191 REORDER", TextStyle.SETTINGS_LABEL, {
      fontSize: "24px",
    }).setOrigin(1, 0);
    this.borrowedFutureContainer.add([title, begin, reorder]);

    const contentTop = BORROWED_FUTURE_Y + 9;
    const cellWidth = (width - 8) / actionCount;
    const enemyById = new Map(globalScene.getEnemyParty().map(pokemon => [String(pokemon.id), pokemon]));
    for (let index = 0; index < actionCount; index++) {
      const action = actions[index];
      const cellX = x + 4 + index * cellWidth;
      if (index > 0) {
        this.borrowedFutureContainer.add(
          globalScene.add.rectangle(cellX, contentTop + 1, 1, BORROWED_FUTURE_HEIGHT - 12, 0x8d66b5).setOrigin(0),
        );
      }
      if (action == null) {
        this.borrowedFutureContainer.add(
          addTextObject(cellX + cellWidth / 2, contentTop + 8, "NO COMMIT", TextStyle.SETTINGS_LABEL, {
            fontSize: "36px",
          }).setOrigin(0.5, 0),
        );
        continue;
      }
      const pokemon = action.pokemonId == null ? undefined : enemyById.get(action.pokemonId);
      if (pokemon != null) {
        this.borrowedFutureContainer.add(
          globalScene.addPokemonIcon(pokemon, cellX + 10, contentTop + 1, 0.5, 0, true).setScale(0.36),
        );
      }
      const textX = cellX + (pokemon == null ? 4 : 18);
      const actor = addTextObject(textX, contentTop + 1, action.actor, TextStyle.SETTINGS_LABEL, {
        fontSize: "28px",
      }).setOrigin(0);
      const move = addTextObject(textX, contentTop + 7, `MOVE: ${action.action}`, TextStyle.WINDOW, {
        fontSize: "34px",
      }).setOrigin(0);
      const textWidth = Math.max(12, cellX + cellWidth - 4 - textX);
      if (actor.displayWidth > textWidth) {
        actor.setScale(Math.max(0.72, textWidth / actor.displayWidth));
      }
      if (move.displayWidth > textWidth) {
        move.setScale(Math.max(0.68, textWidth / move.displayWidth));
      }
      this.borrowedFutureContainer.add([actor, move]);
    }

    const beginHit = globalScene.add
      .zone(x + width - 82, BORROWED_FUTURE_Y, 32, 13)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    beginHit.on("pointerdown", () => this.confirm());
    const reorderHit = globalScene.add
      .zone(x + width - 50, BORROWED_FUTURE_Y, 50, 13)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    reorderHit.on("pointerdown", () => this.openBorrowedFutureReorder());
    this.borrowedFutureContainer.add([beginHit, reorderHit]);
    this.cursorObj.setVisible(false);
    this.operationPagerText.setVisible(false);
    this.pagerUpHit.setVisible(false);
    this.pagerDownHit.setVisible(false);
  }

  private syncBorrowedFutureOrder(): void {
    const byId = new Map(this.operationOptions.map(option => [option.id, option]));
    this.operationOptions = globalScene.getPlayerParty().flatMap(pokemon => {
      const option = byId.get(String(pokemon.id));
      return option == null ? [] : [option];
    });
  }

  private openBorrowedFutureReorder(): void {
    if (!this.borrowedFuture || this.model == null || !isMoodyOperationModel(this.model)) {
      return;
    }
    const leadCount = Math.max(1, Math.min(this.model.leadCount ?? 1, globalScene.getPlayerParty().length));
    this.getUi().playSelect();
    this.borrowedFutureContainer.setVisible(false);
    this.getUi().setOverlayMode(UiMode.PARTY, PartyUiMode.BORROWED_FUTURE_REORDER, leadCount, () => {
      this.getUi()
        .revertMode()
        .then(() => {
          this.syncBorrowedFutureOrder();
          this.borrowedFutureContainer.setVisible(true);
          this.refreshBorrowedFuture();
        });
    });
  }

  /** Operation layout: left checklist, right paged detail pane with committed actions on page 1. */
  private refreshOperation(
    options: readonly (MoodyChoicePanelModel["options"][number] | MoodyOperationOption)[],
  ): void {
    if (this.model == null || !isMoodyOperationModel(this.model)) {
      return;
    }
    const selectedCount = this.operationSelected.size;
    const maxSelections = Math.max(1, this.model.maxSelections ?? 1);
    const selectionLabel = moodyOperationSelectionLabel(selectedCount, maxSelections);
    this.titleText.setText(
      moodyTruncate(`${this.model.title}${selectionLabel.length === 0 ? "" : `: ${selectionLabel}`}`, 28),
    );
    this.queueText.setText(this.model.trackerLabel ?? "").setVisible((this.model.trackerLabel ?? "").length > 0);
    this.promptText.setText(this.model.prompt ?? "");

    for (let slot = 0; slot < MAX_VISIBLE_OPTIONS; slot++) {
      const option = options[this.scrollTop + slot];
      if (option == null) {
        this.optionLabels[slot].setText("");
        continue;
      }
      const operation = option as MoodyOperationOption;
      if (operation.id === "__confirm") {
        this.optionLabels[slot].setText(`>> ${this.model.confirmLabel}`).setAlpha(1).clearTint();
        continue;
      }
      const selected = this.operationSelected.has(operation.id);
      const checkbox = maxSelections > 1 ? (selected ? "[x] " : "[ ] ") : selected ? "(•) " : "( ) ";
      const orderIndex =
        this.model.reorderable === true
          ? `${this.operationOptions.findIndex(candidate => candidate.id === operation.id) + 1}.`
          : "";
      const labelWidth = operation.badge == null ? 20 : this.model.reorderable === true ? 13 : 15;
      const parts = [
        this.model.reorderable === true ? `⇅${orderIndex}` : checkbox,
        moodyTruncate(operation.label, labelWidth),
        ...(operation.badge == null ? [] : [`‹${operation.badge}›`]),
      ];
      this.optionLabels[slot].setText(parts.join(" "));
      this.optionLabels[slot].setAlpha(operation.eligible === false ? 0.5 : 1);
      if (operation.eligible === false) {
        this.optionLabels[slot].setTint(0xa8a8a8);
      } else {
        this.optionLabels[slot].clearTint();
      }
    }

    this.cursorObj
      .setVisible(options.length > 0)
      .setPosition(OP_LEFT_PANE_X + 4, OP_LIST_TOP - 1 + (this.cursor - this.scrollTop) * OPTION_ROW_STEP)
      .setSize(OP_LEFT_PANE_WIDTH - 8, OPTION_ROW_STEP - 2);

    this.refreshOperationDetail();
  }

  /** Plain-language selection hint shown in the left pane header area. */
  private selectionSummaryText(): string {
    if (this.model == null || !isMoodyOperationModel(this.model)) {
      return "";
    }
    const max = Math.max(1, this.model.maxSelections ?? 1);
    const count = this.operationSelected.size;
    if (max === 1) {
      if (count === 0) {
        return this.model.minSelections === 0 ? "NO SELECTION" : "SELECT ONE OPTION";
      }
      return `SELECTED: ${this.operationOptions.find(option => this.operationSelected.has(option.id))?.label ?? ""}`.slice(
        0,
        32,
      );
    }
    return moodyOperationSelectionLabel(count, max);
  }

  /** Rebuild the right detail pane: committed actions first, then the focused entry, paged when overflowing. */
  private refreshOperationDetail(): void {
    if (this.model == null || !isMoodyOperationModel(this.model)) {
      this.operationDetailText.setText("");
      this.operationPagerText.setVisible(false);
      this.pagerUpHit.setVisible(false);
      this.pagerDownHit.setVisible(false);
      return;
    }
    const focused = this.getOptions()[this.cursor] as MoodyOperationOption | undefined;
    const committed =
      this.model.committedActions?.flatMap(action => [
        "★ COMMITTED (LOCKED)",
        `${action.actor}: ${action.action}`,
        `→ ${action.target}`,
        "",
      ]) ?? [];
    const context = this.model.detailLines == null ? [] : [...this.model.detailLines, ""];
    const isConfirmRow = focused?.id === "__confirm" || focused == null;
    const body: string[] = [];
    if (isConfirmRow) {
      body.push("CONFIRM", this.selectionSummaryText());
    } else {
      const max = Math.max(1, this.model.maxSelections ?? 1);
      const checkbox = max > 1 ? (this.operationSelected.has(focused.id) ? "[x]" : "[ ]") : "";
      const selectedMarker = this.operationSelected.has(focused.id) ? "SELECTED" : "";
      body.push(
        [
          `${focused.label}${focused.badge == null ? "" : `  ‹${focused.badge}›`}`,
          `${checkbox} ${selectedMarker}`.trim(),
          focused.description,
          ...(focused.consequenceLines ?? []).map(line => `· ${line}`),
          focused.eligible === false ? `UNAVAILABLE: ${focused.ineligibleReason ?? "ineligible"}` : "",
        ]
          .filter(entry => entry.length > 0)
          .join("\n"),
      );
    }
    if (this.model.reorderable === true) {
      body.push(
        "",
        "REORDER (LEFT/RIGHT)",
        ...this.operationOptions.map((option, index) => `${index + 1}. ${option.label}`),
      );
    }
    const fullText = [...context, ...committed, ...body].join("\n");
    this.detailPages = this.paginateDetailText(fullText);
    this.detailPageIndex = Math.max(0, Math.min(this.detailPageIndex, this.detailPages.length - 1));
    this.renderDetailPage();
  }

  /**
   * Split wrapped detail text into pages that fit the clipped pane; each page
   * carries the "i/N" counter inline so overflow stays inspectable even when
   * the pager chrome is out of view.
   */
  private paginateDetailText(text: string): string[] {
    this.operationDetailText.setText(text);
    const displayHeight = this.operationDetailText.displayHeight;
    const capacity = OP_RIGHT_TEXT_HEIGHT;
    if (displayHeight <= capacity) {
      return [text];
    }
    // Split by blank-line separators first, then by single newlines so pages
    // break at natural boundaries.
    const blocks = text.split("\n\n");
    const pages: string[] = [];
    let current = "";
    const fits = (candidate: string): boolean => {
      this.operationDetailText.setText(candidate);
      return this.operationDetailText.displayHeight <= capacity;
    };
    for (const block of blocks) {
      const candidate = current.length === 0 ? block : `${current}\n\n${block}`;
      if (fits(candidate)) {
        current = candidate;
        continue;
      }
      if (current.length > 0) {
        pages.push(current);
        current = "";
      }
      if (fits(block)) {
        current = block;
        continue;
      }
      // Oversized single block: split line by line.
      for (const line of block.split("\n")) {
        const candidateLine = current.length === 0 ? line : `${current}\n${line}`;
        if (fits(candidateLine)) {
          current = candidateLine;
        } else {
          if (current.length > 0) {
            pages.push(current);
          }
          current = line;
        }
      }
    }
    if (current.length > 0) {
      pages.push(current);
    }
    return pages.length === 0 ? [""] : pages;
  }

  private pageDetail(delta: -1 | 1): void {
    if (this.detailPages.length < 2) {
      return;
    }
    this.detailPageIndex = (this.detailPageIndex + delta + this.detailPages.length) % this.detailPages.length;
    this.renderDetailPage();
    this.getUi().playSelect();
  }

  private renderDetailPage(): void {
    if (this.model == null || !isMoodyOperationModel(this.model)) {
      return;
    }
    const total = this.detailPages.length;
    const counter = total > 1 ? ` ${this.detailPageIndex + 1}/${total}` : "";
    const page = this.detailPages[this.detailPageIndex] ?? "";
    // Inline counter so overflow is signaled even inside the clipped body.
    this.operationDetailText.setText(`${page}${counter}`);
    this.operationDetailText.setY(OP_PANE_Y + 16);
    this.operationPagerText
      .setText(
        total > 1
          ? `${this.detailPageIndex > 0 ? "▲" : "△"}${counter.trim()}${this.detailPageIndex < total - 1 ? "▼" : "▽"}`
          : "",
      )
      .setVisible(total > 1);
    this.pagerUpHit.setVisible(total > 1 && this.detailPageIndex > 0);
    this.pagerDownHit.setVisible(total > 1 && this.detailPageIndex < total - 1);
  }

  private getOptions(): readonly (MoodyChoicePanelModel["options"][number] | MoodyOperationOption)[] {
    return isMoodyOperationModel(this.model)
      ? [
          ...this.operationOptions,
          { id: "__confirm", label: this.model.confirmLabel, description: "Commit this decision." },
        ]
      : (this.model?.options ?? []);
  }

  private activateFocused(): void {
    if (isMoodyOperationModel(this.model)) {
      if (this.cursor >= this.operationOptions.length) {
        this.confirm();
        return;
      }
      const option = this.operationOptions[this.cursor];
      if (option == null || option.eligible === false) {
        this.getUi().playError();
        return;
      }
      const max = Math.max(1, this.model.maxSelections ?? 1);
      if (this.operationSelected.has(option.id)) {
        this.operationSelected.delete(option.id);
      } else {
        if (max === 1) {
          this.operationSelected.clear();
        } else if (this.operationSelected.size >= max) {
          this.getUi().playError();
          return;
        }
        this.operationSelected.add(option.id);
      }
      this.getUi().playSelect();
      this.detailPageIndex = 0;
      this.refresh();
      return;
    }
    this.confirm();
  }

  private confirm(): void {
    if (this.model == null || this.onComplete == null) {
      return;
    }
    if (isMoodyOperationModel(this.model)) {
      if (this.borrowedFuture) {
        this.syncBorrowedFutureOrder();
      }
      const min = Math.max(0, this.model.minSelections ?? (this.model.reorderable ? 0 : 1));
      if (this.operationSelected.size < min) {
        this.getUi().playError();
        return;
      }
      const done = this.onComplete;
      this.onComplete = null;
      const result: MoodyOperationResult = {
        action: "confirm",
        selectedIds: [...this.operationSelected],
        orderedIds: this.operationOptions.map(option => option.id),
      };
      this.getUi().playSelect();
      void this.getUi()
        .revertMode()
        .then(() => done(result));
      return;
    }
    const option = this.model.options[this.cursor];
    if (option == null) {
      return;
    }
    const done = this.onComplete;
    this.onComplete = null;
    this.getUi().playSelect();
    this.getUi()
      .revertMode()
      .then(() => done(option.id));
  }

  private cancel(): boolean {
    if (this.model == null || !this.model.cancellable || this.onComplete == null) {
      return false;
    }
    const result: null | MoodyOperationResult = isMoodyOperationModel(this.model)
      ? {
          action: "cancel",
          selectedIds: [...this.operationSelected],
          orderedIds: this.operationOptions.map(option => option.id),
        }
      : null;
    const done = this.onComplete;
    this.onComplete = null;
    this.getUi()
      .revertMode()
      .then(() => done(result));
    return true;
  }

  processInput(button: Button): boolean {
    if (!this.active || this.model == null) {
      return false;
    }
    if (this.borrowedFuture) {
      switch (button) {
        case Button.UP:
          this.openBorrowedFutureReorder();
          return true;
        case Button.ACTION:
        case Button.SUBMIT:
        case Button.CANCEL:
          this.confirm();
          return true;
        default:
          return false;
      }
    }
    const count = this.getOptions().length;
    switch (button) {
      case Button.UP:
        if (isMoodyOperationModel(this.model) && this.detailPages.length > 1 && this.detailPageIndex > 0) {
          this.pageDetail(-1);
          return true;
        }
        if (count > 0 && this.setCursor(this.cursor === 0 ? count - 1 : this.cursor - 1)) {
          this.refresh();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (
          isMoodyOperationModel(this.model)
          && this.detailPages.length > 1
          && this.detailPageIndex < this.detailPages.length - 1
        ) {
          this.pageDetail(1);
          return true;
        }
        if (count > 0 && this.setCursor(this.cursor === count - 1 ? 0 : this.cursor + 1)) {
          this.refresh();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.LEFT:
      case Button.RIGHT: {
        // Reorderable rows keep LEFT/RIGHT for repositioning; otherwise those
        // keys page the detail pane, then fall through to cursor movement.
        const canReorderNow =
          isMoodyOperationModel(this.model)
          && this.model.reorderable === true
          && this.cursor < this.operationOptions.length;
        if (!canReorderNow && isMoodyOperationModel(this.model) && this.detailPages.length > 1) {
          this.pageDetail(button === Button.LEFT ? -1 : 1);
          return true;
        }
        if (canReorderNow) {
          const delta = button === Button.LEFT ? -1 : 1;
          const next = this.cursor + delta;
          if (this.cursor >= this.operationOptions.length || next < 0 || next >= this.operationOptions.length) {
            return false;
          }
          [this.operationOptions[this.cursor], this.operationOptions[next]] = [
            this.operationOptions[next],
            this.operationOptions[this.cursor],
          ];
          this.cursor = next;
          this.refresh();
          this.getUi().playSelect();
          return true;
        }
        if (
          count > 0
          && this.setCursor(
            button === Button.LEFT
              ? this.cursor === 0
                ? count - 1
                : this.cursor - 1
              : this.cursor === count - 1
                ? 0
                : this.cursor + 1,
          )
        ) {
          this.refresh();
          this.getUi().playSelect();
          return true;
        }
        return false;
      }
      case Button.ACTION:
        this.activateFocused();
        return true;
      case Button.SUBMIT:
        this.activateFocused();
        return true;
      case Button.CANCEL:
        return this.cancel();
      default:
        return false;
    }
  }

  override setCursor(cursor: number): boolean {
    const previous = this.cursor;
    const changed = super.setCursor(cursor);
    // Focus moved to another row: restart detail paging on its first page so
    // committed actions and the entry's own text lead the pane.
    if (previous !== this.cursor) {
      this.detailPageIndex = 0;
    }
    this.refresh();
    return changed;
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj?.setVisible(false);
    this.model = null;
    this.operationOptions = [];
    this.operationSelected.clear();
    this.operationDetailBg.setVisible(false);
    this.operationDetailText.setVisible(false);
    this.operationPagerText?.setVisible(false);
    this.borrowedFutureContainer.removeAll(true);
    this.borrowedFutureContainer.setVisible(false);
    this.borrowedFuture = false;
    this.detailPages = [""];
    this.detailPageIndex = 0;
    this.onComplete = null;
    this.getUi().hideTooltip();
  }
}
