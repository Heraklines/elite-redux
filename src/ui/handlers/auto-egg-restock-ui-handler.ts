import { globalScene } from "#app/global-scene";
import { MAX_EGG_COUNT } from "#data/egg";
import { Button } from "#enums/buttons";
import { GachaType } from "#enums/gacha-types";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { type AutoEggRestockSettings, defaultAutoEggRestockSettings } from "#system/auto-egg-restock-settings";
import { VoucherType } from "#system/voucher";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

/** Cursor position in the auto-restock panel. Maps to a row that handles input. */
enum Row {
  STATUS = 0,
  TARGET = 1,
  MACHINE = 2,
  VOUCHER_REGULAR = 3,
  VOUCHER_PLUS = 4,
  VOUCHER_PREMIUM = 5,
  VOUCHER_GOLDEN = 6,
  SAVE = 7,
  CANCEL = 8,
}

const ROW_COUNT = 9;

/** Target-count step values cycled through with LEFT/RIGHT on the target row. */
const TARGET_STEPS: number[] = [10, 25, 50, 100, 250, 500, 1000, MAX_EGG_COUNT];

/** Order of gacha machines on the machine row. */
const MACHINE_STEPS: GachaType[] = [GachaType.MOVE, GachaType.LEGENDARY, GachaType.SHINY];

/** Voucher rows in display order. */
const VOUCHER_ROWS: { row: Row; voucher: VoucherType; labelKey: string }[] = [
  { row: Row.VOUCHER_REGULAR, voucher: VoucherType.REGULAR, labelKey: "egg:voucherRegular" },
  { row: Row.VOUCHER_PLUS, voucher: VoucherType.PLUS, labelKey: "egg:voucherPlus" },
  { row: Row.VOUCHER_PREMIUM, voucher: VoucherType.PREMIUM, labelKey: "egg:voucherPremium" },
  { row: Row.VOUCHER_GOLDEN, voucher: VoucherType.GOLDEN, labelKey: "egg:voucherGolden" },
];

const ROW_HEIGHT = 14;
const ROW_TOP = 22;
const PANEL_WIDTH = 220;
const PANEL_HEIGHT = 16 + ROW_TOP + ROW_COUNT * ROW_HEIGHT;
const VALUE_X = 130;
const SAVE_BUTTON_X = 16;
const CANCEL_BUTTON_X = 96;

export class AutoEggRestockUiHandler extends MessageUiHandler {
  private container!: Phaser.GameObjects.Container;
  private cursorObj: Phaser.GameObjects.Image | null = null;

  /** Working copy of settings. Mutated on every input; written back on Save, discarded on Cancel. */
  private working: AutoEggRestockSettings = defaultAutoEggRestockSettings();

  /** Value-text labels for each row, keyed by Row enum index. */
  private valueLabels: Phaser.GameObjects.Text[] = [];

  constructor() {
    super(UiMode.AUTO_EGG_RESTOCK);
  }

  setup(): void {
    this.container = globalScene.add.container(50, 30);
    this.container.setVisible(false);
    const bg = addWindow(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    this.container.add(bg);
    this.container.add(addTextObject(8, 4, i18next.t("egg:autoRestockTitle"), TextStyle.WINDOW));

    this.valueLabels = new Array(ROW_COUNT);

    this.addRow(Row.STATUS, i18next.t("egg:autoRestockStatus"));
    this.addRow(Row.TARGET, i18next.t("egg:autoRestockTarget"));
    this.addRow(Row.MACHINE, i18next.t("egg:autoRestockMachine"));
    for (const v of VOUCHER_ROWS) {
      this.addRow(v.row, i18next.t(v.labelKey));
    }
    // Save / Cancel buttons share a row but each gets its own label.
    this.container.add(
      addTextObject(SAVE_BUTTON_X, ROW_TOP + Row.SAVE * ROW_HEIGHT, i18next.t("egg:autoRestockSave"), TextStyle.WINDOW),
    );
    this.container.add(
      addTextObject(
        CANCEL_BUTTON_X,
        ROW_TOP + Row.SAVE * ROW_HEIGHT,
        i18next.t("egg:autoRestockCancel"),
        TextStyle.WINDOW,
      ),
    );

    globalScene.uiContainer.add(this.container);
  }

  private addRow(row: Row, label: string): void {
    this.container.add(addTextObject(8, ROW_TOP + row * ROW_HEIGHT, label, TextStyle.WINDOW));
    const value = addTextObject(VALUE_X, ROW_TOP + row * ROW_HEIGHT, "", TextStyle.WINDOW);
    this.container.add(value);
    this.valueLabels[row] = value;
  }

  override show(args: any[]): boolean {
    super.show(args);
    // Snapshot a deep-ish copy of the live settings so Cancel can discard.
    const live = globalScene.gameData.autoEggRestock;
    this.working = {
      enabled: live.enabled,
      targetCount: live.targetCount,
      gachaType: live.gachaType,
      perVoucher: { ...live.perVoucher },
    };
    this.cursor = 0;
    this.container.setVisible(true);
    this.getUi().bringToTop(this.container);
    this.refreshAll();
    this.refreshCursor();
    return true;
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
  }

  override processInput(button: Button): boolean {
    const ui = this.getUi();
    switch (button) {
      case Button.CANCEL:
        ui.revertMode();
        return true;
      case Button.UP:
        if (this.cursor > 0) {
          this.cursor -= 1;
          this.refreshCursor();
          ui.playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.cursor < ROW_COUNT - 1) {
          this.cursor += 1;
          this.refreshCursor();
          ui.playSelect();
          return true;
        }
        return false;
      case Button.LEFT:
        return this.handleHorizontal(-1);
      case Button.RIGHT:
        return this.handleHorizontal(1);
      case Button.ACTION:
        return this.handleAction();
    }
    return false;
  }

  private handleHorizontal(direction: 1 | -1): boolean {
    const ui = this.getUi();
    switch (this.cursor as Row) {
      case Row.STATUS:
        this.working.enabled = !this.working.enabled;
        this.refreshRow(Row.STATUS);
        ui.playSelect();
        return true;
      case Row.TARGET: {
        const idx = TARGET_STEPS.indexOf(this.working.targetCount);
        const safeIdx = idx === -1 ? 2 /* default 50 */ : idx;
        const next = Math.max(0, Math.min(TARGET_STEPS.length - 1, safeIdx + direction));
        this.working.targetCount = TARGET_STEPS[next];
        this.refreshRow(Row.TARGET);
        ui.playSelect();
        return true;
      }
      case Row.MACHINE: {
        const idx = MACHINE_STEPS.indexOf(this.working.gachaType);
        const safeIdx = idx === -1 ? 1 /* LEGENDARY */ : idx;
        const next = Math.max(0, Math.min(MACHINE_STEPS.length - 1, safeIdx + direction));
        this.working.gachaType = MACHINE_STEPS[next];
        this.refreshRow(Row.MACHINE);
        ui.playSelect();
        return true;
      }
      default:
        return false;
    }
  }

  private handleAction(): boolean {
    const ui = this.getUi();
    const voucherRow = VOUCHER_ROWS.find(v => v.row === (this.cursor as Row));
    if (voucherRow) {
      this.working.perVoucher[voucherRow.voucher] = !this.working.perVoucher[voucherRow.voucher];
      this.refreshRow(voucherRow.row);
      ui.playSelect();
      return true;
    }
    if (this.cursor === Row.SAVE) {
      // Commit working copy back to live settings and persist.
      globalScene.gameData.autoEggRestock = {
        enabled: this.working.enabled,
        targetCount: this.working.targetCount,
        gachaType: this.working.gachaType,
        perVoucher: { ...this.working.perVoucher },
      };
      void globalScene.gameData.saveSystem();
      ui.revertMode();
      return true;
    }
    if (this.cursor === Row.CANCEL) {
      ui.revertMode();
      return true;
    }
    return false;
  }

  private refreshAll(): void {
    this.refreshRow(Row.STATUS);
    this.refreshRow(Row.TARGET);
    this.refreshRow(Row.MACHINE);
    for (const v of VOUCHER_ROWS) {
      this.refreshRow(v.row);
    }
  }

  private refreshRow(row: Row): void {
    const label = this.valueLabels[row];
    if (!label) {
      return;
    }
    switch (row) {
      case Row.STATUS:
        label.setText(this.working.enabled ? i18next.t("egg:autoRestockOn") : i18next.t("egg:autoRestockOff"));
        return;
      case Row.TARGET:
        label.setText(String(this.working.targetCount));
        return;
      case Row.MACHINE: {
        const key =
          this.working.gachaType === GachaType.MOVE
            ? "egg:gachaTypeMove"
            : this.working.gachaType === GachaType.SHINY
              ? "egg:gachaTypeShiny"
              : "egg:gachaTypeLegendary";
        label.setText(i18next.t(key));
        return;
      }
      default: {
        const v = VOUCHER_ROWS.find(x => x.row === row);
        if (v) {
          label.setText(this.working.perVoucher[v.voucher] ? "[✓]" : "[ ]");
        }
      }
    }
  }

  private refreshCursor(): void {
    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.cursorObj.setOrigin(0, 0.5);
      this.container.add(this.cursorObj);
    }
    if (this.cursor === Row.SAVE) {
      this.cursorObj.setPosition(SAVE_BUTTON_X - 8, ROW_TOP + Row.SAVE * ROW_HEIGHT + 4);
    } else if (this.cursor === Row.CANCEL) {
      this.cursorObj.setPosition(CANCEL_BUTTON_X - 8, ROW_TOP + Row.SAVE * ROW_HEIGHT + 4);
    } else {
      this.cursorObj.setPosition(0, ROW_TOP + this.cursor * ROW_HEIGHT + 4);
    }
  }
}
