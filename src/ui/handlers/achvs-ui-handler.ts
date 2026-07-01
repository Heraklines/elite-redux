import { globalScene } from "#app/global-scene";
import { getAchvRewardSummary } from "#data/elite-redux/er-achievement-rewards";
import { Button } from "#enums/buttons";
import { PlayerGender } from "#enums/player-gender";
import { TextStyle } from "#enums/text-style";
import type { UiMode } from "#enums/ui-mode";
import type { Achv } from "#system/achv";
import { achvs, getAchievementDescription } from "#system/achv";
import {
  ACHV_CATEGORY_KEY,
  ACHV_CATEGORY_ORDER,
  ACHV_TIER_KEY,
  type AchvCategory,
  type AchvProgressSummary,
  computeAchvProgress,
  getAchvCategory,
  getAchvDisplayName,
  getAchvTierTextTint,
} from "#system/achv-category";
import type { Voucher } from "#system/voucher";
import { getVoucherTypeIcon, getVoucherTypeName, vouchers } from "#system/voucher";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ScrollBar } from "#ui/scroll-bar";
import { addTextObject } from "#ui/text";
import i18next from "i18next";

/**
 * The left-nav entries. "All" lists every achievement (by category); "Recent" lists the
 * UNLOCKED ones newest-first (so players can triage what they just earned + its rewards);
 * each {@linkcode AchvCategory} filters the grid; "Vouchers" swaps the grid to the voucher
 * list (the old ACTION-toggled page, folded into the same rail like the mockup).
 */
type NavEntry =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "category"; category: AchvCategory }
  | { kind: "vouchers" };

interface LanguageSetting {
  TextSize: string;
}

const languageSettings: { [key: string]: LanguageSetting } = {
  de: { TextSize: "80px" },
};

// Dark, mockup-matching palette (the same family the ER community-challenges screen uses):
// an opaque void backdrop + slightly-raised bands, so light/coloured text stays legible and
// the look is theme-independent (not the themed `addWindow`, which renders pale + washes out
// the default-theme white window text).
const VOID = 0x0b0b16;
const BAND = 0x17141f;
const PANEL = 0x0e0c16;
const SEPARATOR = 0x322b42;
const HIGHLIGHT = 0x4a5ba8;
const TEXT_LIGHT = "#e6e6f0";
const TEXT_DIM = "#8a86a0";
const TEXT_SELECTED = "#ffffff";

export class AchvsUiHandler extends MessageUiHandler {
  // Grid dimensions are computed from the canvas in setup() (the nav column steals width).
  private cols = 13;
  private rows = 4;

  private readonly navWidth = 78;
  private readonly headerHeight = 24;
  private readonly detailHeight = 66;

  private mainContainer: Phaser.GameObjects.Container;
  private iconsContainer: Phaser.GameObjects.Container;

  private headerText: Phaser.GameObjects.Text;
  private headerStatsText: Phaser.GameObjects.Text;

  private navContainer: Phaser.GameObjects.Container;
  private navRowHeight = 10;
  private navLabels: Phaser.GameObjects.Text[] = [];
  private navCounts: Phaser.GameObjects.Text[] = [];
  private navCursorObj: Phaser.GameObjects.Rectangle | null = null;

  private icons: Phaser.GameObjects.Sprite[];

  private detailTitle: Phaser.GameObjects.Text;
  private detailMeta: Phaser.GameObjects.Text;
  private detailReward: Phaser.GameObjects.Text;

  private scrollBar: ScrollBar;
  private scrollCursor: number;
  private cursorObj: Phaser.GameObjects.NineSlice | null;

  /** The nav rail (All + categories + Vouchers), built once in setup(). */
  private navEntries: NavEntry[] = [];
  private navCursor = 0;
  /** True while focus is on the category nav; false while on the achievement grid. */
  private navFocus = true;

  /** All achievements grouped by category then registry order, rebuilt per show(). */
  private achvsByCategory: Map<AchvCategory, Achv[]> = new Map();
  private orderedAchvs: Achv[] = [];
  /** The items currently shown in the grid (achievements for a category, or vouchers). */
  private items: (Achv | Voucher)[] = [];
  private currentTotal = 0;
  private progress: AchvProgressSummary | null = null;

  constructor(mode: UiMode | null = null) {
    super(mode);
    this.scrollCursor = 0;
  }

  /** A filled rectangle helper (origin top-left), the building block of every panel/band. */
  private rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): Phaser.GameObjects.Rectangle {
    return globalScene.add.rectangle(x, y, w, h, color, alpha).setOrigin(0);
  }

  // #region Setup
  setup() {
    const ui = this.getUi();

    /** Width of the global canvas / 6 */
    const WIDTH = globalScene.scaledCanvas.width;
    /** Height of the global canvas / 6 */
    const HEIGHT = globalScene.scaledCanvas.height;

    this.mainContainer = globalScene.add.container(0, -HEIGHT);
    this.mainContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, WIDTH, HEIGHT), Phaser.Geom.Rectangle.Contains);

    const bodyTop = this.headerHeight;
    const bodyHeight = HEIGHT - this.headerHeight - this.detailHeight;
    const gridLeft = this.navWidth + 1;
    const detailTop = HEIGHT - this.detailHeight;

    // --- Backdrop + panel bands --------------------------------------------------------
    const backdrop = this.rect(0, 0, WIDTH, HEIGHT, VOID, 1);
    const headerBand = this.rect(0, 0, WIDTH, this.headerHeight, BAND, 1);
    const navBand = this.rect(0, bodyTop, this.navWidth, bodyHeight, BAND, 1);
    const gridPanel = this.rect(gridLeft, bodyTop, WIDTH - gridLeft, bodyHeight, PANEL, 1);
    const detailBand = this.rect(0, detailTop, WIDTH, this.detailHeight, BAND, 1);
    // Thin separators framing the regions.
    const sepHeader = this.rect(0, this.headerHeight - 1, WIDTH, 1, SEPARATOR, 1);
    const sepNav = this.rect(this.navWidth, bodyTop, 1, bodyHeight, SEPARATOR, 1);
    const sepDetail = this.rect(0, detailTop, WIDTH, 1, SEPARATOR, 1);

    // --- Header: title + aggregate completion / achievement points ---------------------
    this.headerText = addTextObject(8, 4, "", TextStyle.HEADER_LABEL).setOrigin(0);
    this.headerStatsText = addTextObject(WIDTH - 8, 8, "", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(1, 0);
    this.headerStatsText.setColor(TEXT_LIGHT);

    // --- Left category nav -------------------------------------------------------------
    this.navContainer = globalScene.add.container(0, bodyTop);
    this.buildNavEntries();
    this.navRowHeight = Math.max(9, Math.floor((bodyHeight - 8) / this.navEntries.length));
    this.navLabels = [];
    this.navCounts = [];
    this.navCursorObj = this.rect(2, 0, this.navWidth - 4, this.navRowHeight, HIGHLIGHT, 0.32);
    this.navContainer.add(this.navCursorObj);
    this.navEntries.forEach((_entry, i) => {
      const y = 5 + i * this.navRowHeight;
      const label = addTextObject(5, y, "", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0);
      const count = addTextObject(this.navWidth - 5, y, "", TextStyle.WINDOW, { fontSize: "46px" }).setOrigin(1, 0);
      this.navLabels.push(label);
      this.navCounts.push(count);
      this.navContainer.add([label, count]);
    });

    // --- Achievement / voucher icon grid ----------------------------------------------
    this.cols = Math.max(1, Math.floor((WIDTH - gridLeft - 12) / 17));
    this.rows = Math.max(1, Math.floor((bodyHeight - 10) / 19));

    const yOffset = 6;
    this.scrollBar = new ScrollBar(WIDTH - 9, bodyTop + yOffset, 4, bodyHeight - yOffset * 2, this.rows);

    this.iconsContainer = globalScene.add.container(gridLeft + 5, bodyTop + 8);
    this.icons = [];
    for (let a = 0; a < this.rows * this.cols; a++) {
      const x = (a % this.cols) * 17;
      const y = Math.floor(a / this.cols) * 19;
      const icon = globalScene.add.sprite(x, y, "items", "unknown").setOrigin(0).setScale(0.5);
      this.icons.push(icon);
      this.iconsContainer.add(icon);
    }

    // --- Detail panel: name + tier/points/date + reward + description ------------------
    this.detailTitle = addTextObject(8, detailTop + 4, "", TextStyle.WINDOW).setOrigin(0);
    const textSize = languageSettings[i18next.language]?.TextSize ?? this.detailTitle.style.fontSize;
    this.detailTitle.setFontSize(textSize);
    this.detailMeta = addTextObject(WIDTH - 8, detailTop + 6, "", TextStyle.WINDOW, { fontSize: "60px" }).setOrigin(
      1,
      0,
    );
    this.detailReward = addTextObject(8, detailTop + 18, "", TextStyle.WINDOW, { fontSize: "60px" })
      .setOrigin(0)
      .setWordWrapWidth((WIDTH - 16) * 6);
    this.detailReward.setColor(TEXT_LIGHT);

    const descriptionText = addTextObject(8, detailTop + 32, "", TextStyle.WINDOW, { maxLines: 2, fontSize: "60px" })
      .setOrigin(0)
      .setWordWrapWidth((WIDTH - 16) * 6);
    descriptionText.setColor(TEXT_LIGHT);
    this.message = descriptionText;

    this.mainContainer.add([
      backdrop,
      headerBand,
      navBand,
      gridPanel,
      detailBand,
      sepHeader,
      sepNav,
      sepDetail,
      this.headerText,
      this.headerStatsText,
      this.navContainer,
      this.scrollBar,
      this.iconsContainer,
      this.detailTitle,
      this.detailMeta,
      this.detailReward,
      descriptionText,
    ]);

    ui.add(this.mainContainer);
    this.mainContainer.setVisible(false);
  }

  /** Build the nav rail: All, Recent, every category in display order, then Vouchers. */
  private buildNavEntries(): void {
    this.navEntries = [
      { kind: "all" },
      { kind: "recent" },
      ...ACHV_CATEGORY_ORDER.map((category): NavEntry => ({ kind: "category", category })),
      { kind: "vouchers" },
    ];
  }
  // #endregion Setup

  show(args: any[]): boolean {
    super.show(args);

    // Group the registry by category (registry order preserved within each category).
    this.achvsByCategory = new Map();
    for (const category of ACHV_CATEGORY_ORDER) {
      this.achvsByCategory.set(category, []);
    }
    for (const achv of Object.values(achvs)) {
      this.achvsByCategory.get(getAchvCategory(achv))?.push(achv);
    }
    this.orderedAchvs = ACHV_CATEGORY_ORDER.flatMap(category => this.achvsByCategory.get(category) ?? []);
    this.progress = computeAchvProgress(globalScene.gameData.achvUnlocks);

    this.navCursor = 0;
    this.navFocus = true;
    this.scrollCursor = 0;
    this.cursor = 0;

    this.selectNavEntry(0);

    this.mainContainer.setVisible(true);
    const ui = this.getUi();
    // Raise the overlay to the top of the UI stack (no-op under the headless render mock,
    // which has no Container `moveTo`/`length`).
    ui.moveTo?.(this.mainContainer, (typeof ui.length === "number" ? ui.length : 1) - 1);
    ui.hideTooltip();
    return true;
  }

  // #region Data
  private get navEntry(): NavEntry {
    return this.navEntries[this.navCursor];
  }

  private get isVouchersView(): boolean {
    return this.navEntry.kind === "vouchers";
  }

  /** Resolve the grid item list for the active nav entry. */
  private computeItems(): (Achv | Voucher)[] {
    const entry = this.navEntry;
    if (entry.kind === "vouchers") {
      return Object.values(vouchers);
    }
    if (entry.kind === "category") {
      return this.achvsByCategory.get(entry.category) ?? [];
    }
    if (entry.kind === "recent") {
      // Unlocked achievements only, most-recently-earned first (by unlock timestamp).
      const unlocks = globalScene.gameData.achvUnlocks;
      return this.orderedAchvs
        .filter(achv => Object.hasOwn(unlocks, achv.id))
        .sort((a, b) => unlocks[b.id] - unlocks[a.id]);
    }
    return this.orderedAchvs;
  }

  /** The unlocked/total count for a nav entry, for the nav rail + header. */
  private navEntryCount(entry: NavEntry): { unlocked: number; total: number } {
    if (entry.kind === "vouchers") {
      const total = Object.keys(vouchers).length;
      const unlocked = Object.keys(globalScene.gameData.voucherUnlocks).filter(id => id in vouchers).length;
      return { unlocked, total };
    }
    if (!this.progress) {
      return { unlocked: 0, total: 0 };
    }
    const p = entry.kind === "category" ? this.progress.byCategory[entry.category] : this.progress.overall;
    return { unlocked: p.unlocked, total: p.total };
  }

  private navEntryLabel(entry: NavEntry): string {
    switch (entry.kind) {
      case "vouchers":
        return i18next.t("voucher:vouchers");
      case "all":
        return i18next.t("achv:category.all");
      case "recent":
        return i18next.t("achv:category.recent");
      case "category":
        return i18next.t(`achv:category.${ACHV_CATEGORY_KEY[entry.category]}`);
    }
  }
  // #endregion Data

  // #region Rendering
  /** Refresh the header title + the aggregate completion / achievement-point readout. */
  private refreshHeader(): void {
    const genderIndex = globalScene.gameData.gender ?? PlayerGender.MALE;
    const genderStr = PlayerGender[genderIndex].toLowerCase();
    this.headerText.setText(i18next.t("achv:achievements.name", { context: genderStr }));

    if (this.isVouchersView) {
      const { unlocked, total } = this.navEntryCount(this.navEntry);
      this.headerStatsText.setText(`${unlocked}/${total}`);
      return;
    }
    const overall = this.progress?.overall;
    if (!overall) {
      this.headerStatsText.setText("");
      return;
    }
    const pct = overall.total ? Math.floor((overall.unlocked / overall.total) * 100) : 0;
    const points = i18next.t("achv:ui.points");
    this.headerStatsText.setText(
      `${overall.unlocked}/${overall.total}  ${pct}%   ${overall.earnedScore}/${overall.totalScore} ${points}`,
    );
  }

  /** Refresh the nav rail labels, counts, and the selected-row highlight. */
  private refreshNav(): void {
    this.navEntries.forEach((entry, i) => {
      const selected = i === this.navCursor;
      const { unlocked, total } = this.navEntryCount(entry);
      this.navLabels[i].setText(this.navEntryLabel(entry));
      this.navCounts[i].setText(`${unlocked}/${total}`);
      const color = selected ? TEXT_SELECTED : TEXT_DIM;
      this.navLabels[i].setColor(color);
      this.navCounts[i].setColor(color);
    });
    this.placeNavCursor();
  }

  private placeNavCursor(): void {
    if (!this.navCursorObj) {
      return;
    }
    this.navCursorObj.setY(2 + this.navCursor * this.navRowHeight);
    // The highlight is solid while the nav has focus, faint while the grid is driven.
    this.navCursorObj.setAlpha(this.navFocus ? 0.42 : 0.16);
  }

  /** Repopulate the icon grid for the current items + scroll position. */
  private updateGridIcons(): void {
    const itemOffset = this.scrollCursor * this.cols;
    const itemLimit = this.rows * this.cols;
    const itemRange = this.items.slice(itemOffset, itemOffset + itemLimit);
    const achvUnlocks = globalScene.gameData.achvUnlocks;
    const voucherUnlocks = globalScene.gameData.voucherUnlocks;
    const forVouchers = this.isVouchersView;

    itemRange.forEach((item, i) => {
      const icon = this.icons[i];
      icon.setVisible(true);
      if (forVouchers) {
        const voucher = item as Voucher;
        const unlocked = Object.hasOwn(voucherUnlocks, voucher.id);
        icon.setFrame(getVoucherTypeIcon(voucher.voucherType));
        if (unlocked) {
          icon.clearTint();
        } else {
          icon.setTintFill(0);
        }
        return;
      }
      const achv = item as Achv;
      const unlocked = Object.hasOwn(achvUnlocks, achv.id);
      const hidden = !unlocked && achv.secret && (!achv.parentId || !Object.hasOwn(achvUnlocks, achv.parentId));
      icon.setFrame(hidden ? "unknown" : achv.iconImage);
      if (unlocked) {
        icon.clearTint();
      } else {
        icon.setTintFill(0);
      }
    });

    if (itemRange.length < this.icons.length) {
      this.icons.slice(itemRange.length).forEach(icon => icon.setVisible(false));
    }
  }

  /** Render the detail panel for the item under the grid cursor. */
  private refreshDetail(): void {
    const index = this.cursor + this.scrollCursor * this.cols;
    const item = this.items[index];
    if (!item) {
      this.detailTitle.setText("");
      this.detailMeta.setText("");
      this.detailReward.setText("");
      this.message.setText("");
      return;
    }
    if (this.isVouchersView) {
      this.showVoucher(item as Voucher);
    } else {
      this.showAchv(item as Achv);
    }
  }

  private showAchv(achv: Achv): void {
    const genderIndex = globalScene.gameData.gender ?? PlayerGender.MALE;
    achv.name = getAchvDisplayName(achv, genderIndex);
    achv.description = getAchievementDescription(achv.localizationKey);

    const achvUnlocks = globalScene.gameData.achvUnlocks;
    const unlocked = Object.hasOwn(achvUnlocks, achv.id);
    const hidden = !unlocked && achv.secret && (!achv.parentId || !Object.hasOwn(achvUnlocks, achv.parentId));

    const tier = achv.getTier();
    const tierColor = `#${getAchvTierTextTint(tier).toString(16).padStart(6, "0")}`;
    this.detailTitle.setText(hidden ? "???" : achv.name);
    this.detailTitle.setColor(hidden ? TEXT_DIM : tierColor);

    const tierName = i18next.t(`achv:tier.${ACHV_TIER_KEY[tier]}`);
    const points = i18next.t("achv:ui.points");
    const status = unlocked ? new Date(achvUnlocks[achv.id]).toLocaleDateString() : i18next.t("achv:locked.name");
    this.detailMeta.setText(`${tierName}  ${achv.score} ${points}  ${status}`);
    this.detailMeta.setColor(hidden ? TEXT_DIM : tierColor);

    if (hidden) {
      this.detailReward.setText("");
      this.message.setText("");
      return;
    }
    const rewards = getAchvRewardSummary(achv.id);
    const rewardLabel = i18next.t("achv:ui.rewards");
    this.detailReward.setText(
      rewards.length > 0
        ? `${rewardLabel}: ${rewards.join(", ")}`
        : `${rewardLabel}: ${i18next.t("achv:ui.pointsOnly")}`,
    );
    this.message.setText(achv.description);
    this.positionRequirementBelowReward();
  }

  private showVoucher(voucher: Voucher): void {
    const voucherUnlocks = globalScene.gameData.voucherUnlocks;
    const unlocked = Object.hasOwn(voucherUnlocks, voucher.id);
    this.detailTitle.setText(getVoucherTypeName(voucher.voucherType));
    this.detailTitle.setColor(TEXT_LIGHT);
    this.detailMeta.setText(
      unlocked ? new Date(voucherUnlocks[voucher.id]).toLocaleDateString() : i18next.t("voucher:locked"),
    );
    this.detailMeta.setColor(TEXT_LIGHT);
    this.detailReward.setText("");
    this.message.setText(voucher.description);
    this.positionRequirementBelowReward();
  }

  /**
   * Keep the requirement/description text just below the reward line(s). A long ER
   * reward can wrap to two lines; pinning the description to a fixed Y let the
   * second reward line overlap it. `detailReward.y` is the reward's top; 14 is the
   * original one-line step (detailTop+18 reward -> detailTop+32 description).
   */
  private positionRequirementBelowReward(): void {
    const rewardLines = Math.max(1, this.detailReward.getWrappedText(this.detailReward.text).length);
    this.message.setY(this.detailReward.y + 14 * rewardLines);
  }
  // #endregion Rendering

  // #region Navigation
  /** Switch the active nav entry: refilter the grid, reset scroll, refresh everything. */
  private selectNavEntry(index: number): void {
    this.navCursor = Phaser.Math.Wrap(index, 0, this.navEntries.length);
    this.items = this.computeItems();
    this.currentTotal = this.items.length;
    this.scrollCursor = 0;
    this.cursor = 0;
    this.scrollBar.setTotalRows(Math.max(1, Math.ceil(this.currentTotal / this.cols)));
    this.scrollBar.setScrollCursor(0);
    this.refreshHeader();
    this.refreshNav();
    this.updateGridIcons();
    this.placeGridCursor();
    this.refreshDetail();
    this.updateGridCursorVisible();
  }

  private enterGrid(): boolean {
    if (this.currentTotal === 0) {
      return false;
    }
    this.navFocus = false;
    this.placeNavCursor();
    this.placeGridCursor();
    this.updateGridCursorVisible();
    this.refreshDetail();
    return true;
  }

  private enterNav(): boolean {
    this.navFocus = true;
    this.placeNavCursor();
    this.updateGridCursorVisible();
    return true;
  }

  private updateGridCursorVisible(): void {
    this.cursorObj?.setVisible(!this.navFocus);
  }

  private placeGridCursor(): void {
    if (!this.cursorObj) {
      this.cursorObj = globalScene.add
        .nineslice(0, 0, "select_cursor_highlight", undefined, 16, 16, 1, 1, 1, 1)
        .setOrigin(0);
      this.iconsContainer.add(this.cursorObj);
    }
    this.cursorObj.setVisible(!this.navFocus);
    this.cursorObj.setPositionRelative(this.icons[this.cursor], 0, 0);
  }

  setCursor(cursor: number): boolean {
    const ret = super.setCursor(cursor);
    this.placeGridCursor();
    this.refreshDetail();
    return ret;
  }

  setScrollCursor(scrollCursor: number): boolean {
    if (scrollCursor === this.scrollCursor) {
      return false;
    }
    this.scrollCursor = scrollCursor;
    this.scrollBar.setScrollCursor(this.scrollCursor);
    const maxCursor = Math.min(this.cursor, this.currentTotal - this.scrollCursor * this.cols - 1);
    if (maxCursor !== this.cursor) {
      super.setCursor(Math.max(0, maxCursor));
    }
    this.updateGridIcons();
    this.placeGridCursor();
    this.refreshDetail();
    return true;
  }

  private processUpInput(): boolean {
    if (this.cursor >= this.cols) {
      return this.setCursor(this.cursor - this.cols);
    }
    if (this.scrollCursor) {
      return this.setScrollCursor(this.scrollCursor - 1);
    }
    const success = this.setScrollCursor(Math.max(0, Math.ceil(this.currentTotal / this.cols) - this.rows));
    let newCursorIndex = this.cursor + (this.rows - 1) * this.cols;
    if (newCursorIndex > this.currentTotal - this.scrollCursor * this.cols - 1) {
      newCursorIndex -= this.cols;
    }
    return success && this.setCursor(Math.max(0, newCursorIndex));
  }

  private processDownInput(): boolean {
    const rowIndex = Math.floor(this.cursor / this.cols);
    const itemOffset = this.scrollCursor * this.cols;
    const canMoveDown = itemOffset + 1 < this.currentTotal;
    if (rowIndex >= this.rows - 1) {
      if (this.scrollCursor < Math.ceil(this.currentTotal / this.cols) - this.rows && canMoveDown) {
        return this.setScrollCursor(this.scrollCursor + 1);
      }
      return this.setScrollCursor(0) && this.setCursor(this.cursor % this.cols);
    }
    if (canMoveDown) {
      return this.setCursor(Math.min(this.cursor + this.cols, this.currentTotal - itemOffset - 1));
    }
    return false;
  }

  private processLeftInput(): boolean {
    // At the left edge of the grid, hand focus back to the category nav.
    if (this.cursor % this.cols === 0) {
      return this.enterNav();
    }
    return this.setCursor(this.cursor - 1);
  }

  private processRightInput(): boolean {
    const itemOffset = this.scrollCursor * this.cols;
    if ((this.cursor + 1) % this.cols === 0 || this.cursor + itemOffset === this.currentTotal - 1) {
      return this.setCursor(this.cursor - (this.cursor % this.cols));
    }
    return this.setCursor(this.cursor + 1);
  }

  processInput(button: Button): boolean {
    let success = false;
    if (this.navFocus) {
      switch (button) {
        case Button.UP:
          this.selectNavEntry(this.navCursor - 1);
          success = true;
          break;
        case Button.DOWN:
          this.selectNavEntry(this.navCursor + 1);
          success = true;
          break;
        case Button.RIGHT:
        case Button.ACTION:
          success = this.enterGrid();
          break;
        case Button.CANCEL:
          success = true;
          globalScene.ui.revertMode();
          break;
      }
    } else {
      switch (button) {
        case Button.UP:
          success = this.processUpInput();
          break;
        case Button.DOWN:
          success = this.processDownInput();
          break;
        case Button.LEFT:
          success = this.processLeftInput();
          break;
        case Button.RIGHT:
          success = this.processRightInput();
          break;
        case Button.ACTION:
          success = this.enterNav();
          break;
        case Button.CANCEL:
          success = true;
          globalScene.ui.revertMode();
          break;
      }
    }

    if (success) {
      this.getUi().playSelect();
    }
    return success;
  }
  // #endregion Navigation

  clear() {
    super.clear();
    this.mainContainer.setVisible(false);
    this.navFocus = true;
    this.navCursor = 0;
    this.scrollCursor = 0;
    this.cursor = 0;
    this.eraseCursor();
  }

  eraseCursor() {
    if (this.cursorObj) {
      this.cursorObj.destroy();
      this.cursorObj = null;
    }
  }
}
