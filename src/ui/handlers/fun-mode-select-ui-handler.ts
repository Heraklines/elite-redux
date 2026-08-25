import { globalScene } from "#app/global-scene";
import {
  DEFAULT_FUN_MODE_CONFIG,
  type FunModeConfig,
  getFunModeConfig,
  setFunModeConfig,
} from "#data/elite-redux/er-fun-mode";
import { Button } from "#enums/buttons";
import { Color, ShadowColor } from "#enums/color";
import { TextStyle } from "#enums/text-style";
import type { UiMode } from "#enums/ui-mode";
import { handoffFunModeToTitle } from "#ui/handlers/fun-mode-title-handoff";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { loadLastFunModeConfig, saveLastFunModeConfig } from "#utils/data";
import BBCodeText from "phaser3-rex-plugins/plugins/bbcodetext";

type FunModeKey = Exclude<keyof FunModeConfig, "abilityRerollSeed" | "megaMixMode" | "difficulty">;
type FunModeOptionKey = FunModeKey | "difficulty";

const OPTIONS: readonly { key: FunModeOptionKey; label: string; description: string }[] = [
  {
    key: "difficulty",
    label: "Difficulty",
    description: "Choose Youngster rules or the full Hell difficulty rules for this Fun Mode run.",
  },
  {
    key: "debugMode",
    label: "Debug",
    description:
      "Temporarily unlock every starter, form, ability, innate, nature, egg move, and shiny tier for this run. Team budget becomes 999. Debug runs grant no catches, candy, vouchers, achievements, ribbons, unlocks, or account progress.",
  },
  {
    key: "randomizePokemon",
    label: "Pokemon",
    description:
      "Every newly generated enemy Pokemon is replaced from the full species pool. Biome pools and BST limits do not apply. Catches can join this run and award candy, but do not unlock starter-select data.",
  },
  {
    key: "randomizeTypes",
    label: "Types",
    description:
      "Each Pokemon gets its own random native typing. Temporary type changes and Transform still work normally.",
  },
  {
    key: "randomizeAbilities",
    label: "Abilities",
    description:
      "Each individual Pokemon gets random active abilities and innates, even when another Pokemon is the same species.",
  },
  {
    key: "randomizeLevelUpMoves",
    label: "Level-up Moves",
    description:
      "Level-up moves are random, but every Pokemon learns them at the same levels and cadence as its normal learnset.",
  },
  {
    key: "megaMode",
    label: "Mega Mode",
    description: "Start with a Mega Bracelet. Any Mega Stone can create a temporary pseudo-Mega.",
  },
  {
    key: "shuffleStats",
    label: "Stat Shuffle",
    description:
      "Shuffle every Pokemon's stats while preserving its total BST. Mega'd Pokemon shuffle their full effective Mega statline.",
  },
  {
    key: "shuffleEvolutions",
    label: "Evolution Shuffle",
    description:
      "Evolution requirements and timing stay intact, but every successful evolution becomes a random obtainable species or form.",
  },
  {
    key: "itemChaos",
    label: "Item Chaos",
    description:
      "Every eligible reward tier and every eligible item inside it have equal odds. Normal rarity weights and luck upgrades are ignored. Caught shinies can join this run and award candy, but do not unlock starter-select data.",
  },
  {
    key: "weatherRoulette",
    label: "Weather Chaos",
    description: "Every encounter begins with random weather/terrain, including clear weather.",
  },
  {
    key: "scrambleMoves",
    label: "Move Scrambler",
    description:
      "After a Pokemon finishes using a move, that moveset slot becomes a different random move for both sides.",
  },
  {
    key: "abilityAvalanche",
    label: "Ability Avalanche",
    description: "Starting at wave 60, every Pokemon gains one additional randomized active ability every 20 waves.",
  },
  {
    key: "moodyMode",
    label: "Moody Mode",
    description: "Every 10 waves, choose a boon or upgrade and receive a curse. Enemy trainers also receive boons.",
  },
];

export const FUN_MODE_OPTION_COUNT = OPTIONS.length;

const VISIBLE_OPTION_ROWS = 9;

function hasEnabledMode(config: FunModeConfig): boolean {
  return OPTIONS.some(option => option.key !== "difficulty" && config[option.key]);
}

export class FunModeSelectUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private cursorObject: Phaser.GameObjects.NineSlice;
  private descriptionText: BBCodeText;
  private startText: Phaser.GameObjects.Text;
  private lastSetupButton: Phaser.GameObjects.NineSlice;
  private lastSetupText: Phaser.GameObjects.Text;
  private rulesText: Phaser.GameObjects.Text;
  private readonly valueTexts: Phaser.GameObjects.Text[] = [];
  private readonly optionLabels: Phaser.GameObjects.Text[] = [];
  private readonly leftArrows: Phaser.GameObjects.Image[] = [];
  private readonly rightArrows: Phaser.GameObjects.Image[] = [];
  private startCursor: Phaser.GameObjects.NineSlice;
  private scrollUpArrow: Phaser.GameObjects.Image;
  private scrollDownArrow: Phaser.GameObjects.Image;
  private onHeaderButton = false;
  private startRegionOption: 0 | 1 = 0;
  private visibleStart = 0;
  private config: FunModeConfig = { ...DEFAULT_FUN_MODE_CONFIG };

  constructor(mode: UiMode | null = null) {
    super(mode);
  }

  public override setup(): void {
    const ui = this.getUi();
    const { width, height } = globalScene.scaledCanvas;
    this.container = globalScene.add.container(1, -height + 1).setName("fun-mode-select");
    this.container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);

    const overlay = globalScene.add.rectangle(-1, -1, width, height, 0x424242, 0.8).setOrigin(0);
    const header = addWindow(0, 0, width, 24).setOrigin(0);
    const headerText = addTextObject(8, 4, "FUN MODE", TextStyle.HEADER_LABEL).setOrigin(0);
    this.lastSetupText = addTextObject(0, 0, "Last Setup", TextStyle.SETTINGS_LABEL)
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.lastSetupText.setScale(this.lastSetupText.scaleX * 0.85, this.lastSetupText.scaleY * 0.85);
    this.lastSetupButton = addWindow(0, 0, this.lastSetupText.displayWidth + 12, 18)
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.lastSetupButton.setPositionRelative(header, headerText.x + headerText.displayWidth + 10, header.height / 2);
    this.lastSetupText.setPosition(this.lastSetupButton.x + 6, this.lastSetupButton.y);
    this.rulesText = addTextObject(width - 6, 7, "Youngster rules  |  No Favor or Vouchers", TextStyle.SETTINGS_LABEL)
      .setOrigin(1, 0)
      .setAlpha(0.8);
    this.rulesText.setScale(this.rulesText.scaleX * 0.7, this.rulesText.scaleY * 0.7);

    const optionsWidth = Math.floor(width * 0.6);
    const optionsWindow = addWindow(0, 24, optionsWidth, height - 26).setOrigin(0);
    const descriptionWindow = addWindow(optionsWidth, 24, width - optionsWidth, height - 50).setOrigin(0);
    const startWindow = addWindow(optionsWidth, height - 26, width - optionsWidth, 24).setOrigin(0);

    const rowObjects: Phaser.GameObjects.GameObject[] = [];
    OPTIONS.forEach((option, index) => {
      const y = 28 + index * 16;
      const label = addTextObject(8, y, option.label, TextStyle.SETTINGS_LABEL).setOrigin(0);
      const leftArrow = globalScene.add.image(0, 0, "cursor_reverse").setOrigin(0).setScale(0.75);
      const rightArrow = globalScene.add.image(0, 0, "cursor").setOrigin(0).setScale(0.75);
      const value = addTextObject(0, y, "ON", TextStyle.SETTINGS_LABEL).setOrigin(0.5, 0);
      this.valueTexts.push(value);
      this.optionLabels.push(label);
      this.leftArrows.push(leftArrow);
      this.rightArrows.push(rightArrow);
      rowObjects.push(label, leftArrow, rightArrow, value);
    });

    this.cursorObject = globalScene.add
      .nineslice(4, 28, "summary_moves_cursor", undefined, optionsWidth - 8, 16, 1, 1, 1, 1)
      .setOrigin(0);
    this.descriptionText = new BBCodeText(globalScene, optionsWidth + 6, 28, "", {
      fontFamily: "emerald",
      fontSize: 84,
      color: Color.ORANGE,
      padding: { bottom: 6 },
      wrap: { mode: "word", width: (width - optionsWidth - 12) * 6 },
    })
      .setScale(1 / 6)
      .setShadow(4, 5, ShadowColor.ORANGE)
      .setOrigin(0);
    globalScene.add.existing(this.descriptionText);
    this.startText = addTextObject(0, 0, "START", TextStyle.SETTINGS_LABEL).setOrigin(0.5, 0.5);
    this.startText.setPosition(startWindow.x + startWindow.width / 2, startWindow.y + startWindow.height / 2);
    this.startCursor = globalScene.add
      .nineslice(
        startWindow.x + 4,
        startWindow.y + 3,
        "summary_moves_cursor",
        undefined,
        startWindow.width - 8,
        16,
        1,
        1,
        1,
        1,
      )
      .setOrigin(0)
      .setVisible(false);
    this.scrollUpArrow = globalScene.add
      .image(optionsWidth - 6, 30, "cursor")
      .setScale(0.45)
      .setAngle(-90)
      .setAlpha(0.8)
      .setVisible(false);
    this.scrollDownArrow = globalScene.add
      .image(optionsWidth - 6, height - 8, "cursor")
      .setScale(0.45)
      .setAngle(90)
      .setAlpha(0.8)
      .setVisible(false);

    this.container.add([
      overlay,
      header,
      headerText,
      this.lastSetupButton,
      this.lastSetupText,
      this.rulesText,
      optionsWindow,
      descriptionWindow,
      startWindow,
      ...rowObjects,
      this.cursorObject,
      this.descriptionText,
      this.startText,
      this.startCursor,
      this.scrollUpArrow,
      this.scrollDownArrow,
    ]);
    this.container.setVisible(false);
    ui.add(this.container);
  }

  public override show(args: any[]): boolean {
    super.show(args);
    this.config = { ...getFunModeConfig() };
    this.onHeaderButton = false;
    this.startRegionOption = 0;
    this.visibleStart = 0;
    this.container.setVisible(true);
    this.setCursor(0);
    this.refresh();
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  public override processInput(button: Button): boolean {
    let success: boolean;
    if (button === Button.CANCEL) {
      if (this.onHeaderButton) {
        this.setHeaderFocus(false);
        success = true;
      } else if (this.cursor === OPTIONS.length) {
        this.startRegionOption = 0;
        success = this.setCursor(OPTIONS.length - 1);
      } else {
        // This handler is retired synchronously by TitlePhase. Do not fall through to refresh(),
        // which can mutate the old full-screen surface after the title menu has claimed input.
        handoffFunModeToTitle({
          toTitleScreen: () => globalScene.phaseManager.toTitleScreen(),
          endCurrentPhase: () => globalScene.phaseManager.getCurrentPhase().end(),
          playSelect: () => this.getUi().playSelect(),
        });
        return true;
      }
    } else if (this.onHeaderButton) {
      success = this.processHeaderInput(button);
    } else {
      success = this.processMenuInput(button);
    }

    if (success) {
      this.getUi().playSelect();
      this.refresh();
    }
    return success;
  }

  private processHeaderInput(button: Button): boolean {
    if (button === Button.ACTION || button === Button.SUBMIT) {
      return this.applyLastSetup();
    }
    if (button !== Button.UP && button !== Button.DOWN) {
      return false;
    }
    this.setHeaderFocus(false);
    return button === Button.UP ? this.setCursor(OPTIONS.length) : true;
  }

  private processMenuInput(button: Button): boolean {
    if (button === Button.UP) {
      return this.moveCursorUp();
    }
    if (button === Button.DOWN) {
      return this.setCursor(this.cursor === OPTIONS.length ? 0 : this.cursor + 1);
    }
    if (button === Button.LEFT || button === Button.RIGHT) {
      if (this.cursor === OPTIONS.length && loadLastFunModeConfig()) {
        this.startRegionOption = this.startRegionOption === 0 ? 1 : 0;
        return true;
      }
      return this.setCurrentOption(button === Button.RIGHT);
    }
    if (button === Button.SUBMIT) {
      if (this.cursor < OPTIONS.length) {
        this.startRegionOption = 0;
        return this.setCursor(OPTIONS.length);
      }
      return this.confirmCurrentSelection();
    }
    if (button === Button.ACTION) {
      return this.confirmCurrentSelection();
    }
    return button === Button.CYCLE_SHINY && this.applyLastSetup();
  }

  private moveCursorUp(): boolean {
    if (this.cursor === 0 && loadLastFunModeConfig()) {
      this.setHeaderFocus(true);
      return true;
    }
    return this.setCursor(this.cursor === 0 ? OPTIONS.length : this.cursor - 1);
  }

  private setCurrentOption(value: boolean): boolean {
    if (this.cursor >= OPTIONS.length) {
      return false;
    }
    const key = OPTIONS[this.cursor].key;
    if (key === "difficulty") {
      const next = value ? "hell" : "youngster";
      const changed = this.config.difficulty !== next;
      this.config.difficulty = next;
      return changed;
    }
    if (key === "megaMode") {
      const current = this.config.megaMode ? (this.config.megaMixMode ? 2 : 1) : 0;
      const next = value ? Math.min(2, current + 1) : Math.max(0, current - 1);
      if (next === current) {
        return false;
      }
      this.config.megaMode = next > 0;
      this.config.megaMixMode = next === 2;
      return true;
    }
    const changed = this.config[key] !== value;
    this.config[key] = value;
    return changed;
  }

  private confirmCurrentSelection(): boolean {
    if (this.cursor < OPTIONS.length) {
      const key = OPTIONS[this.cursor].key;
      if (key === "difficulty") {
        this.config.difficulty = this.config.difficulty === "youngster" ? "hell" : "youngster";
      } else if (key === "megaMode") {
        const current = this.config.megaMode ? (this.config.megaMixMode ? 2 : 1) : 0;
        const next = (current + 1) % 3;
        this.config.megaMode = next > 0;
        this.config.megaMixMode = next === 2;
      } else {
        this.config[key] = !this.config[key];
      }
      return true;
    }
    if (!hasEnabledMode(this.config)) {
      return this.startRegionOption === 1 && this.applyLastSetup();
    }
    if (this.startRegionOption === 1) {
      return this.applyLastSetup();
    }
    saveLastFunModeConfig(this.config);
    setFunModeConfig(this.config);
    globalScene.phaseManager.unshiftNew("SelectStarterPhase");
    globalScene.phaseManager.getCurrentPhase().end();
    return true;
  }

  public override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.refresh();
    return changed;
  }

  public override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.getUi().hideTooltip();
  }

  private refresh(): void {
    this.rulesText.setText(
      this.config.debugMode
        ? `${this.config.difficulty === "hell" ? "Hell" : "Youngster"} rules  |  Debug: no account progress`
        : `${this.config.difficulty === "hell" ? "Hell" : "Youngster"} rules  |  No Favor or Vouchers`,
    );
    if (!this.cursorObject || !this.descriptionText) {
      return;
    }
    const startIndex = OPTIONS.length;
    const optionsWidth = Math.floor(globalScene.scaledCanvas.width * 0.6);
    if (this.cursor < startIndex) {
      if (this.cursor < this.visibleStart) {
        this.visibleStart = this.cursor;
      } else if (this.cursor >= this.visibleStart + VISIBLE_OPTION_ROWS) {
        this.visibleStart = this.cursor - VISIBLE_OPTION_ROWS + 1;
      }
    }
    this.valueTexts.forEach((text, index) => {
      const visible = index >= this.visibleStart && index < this.visibleStart + VISIBLE_OPTION_ROWS;
      const rowY = 28 + (index - this.visibleStart) * 16;
      const key = OPTIONS[index].key;
      const enabled = key === "difficulty" || this.config[key] === true;
      const valueLabel =
        key === "difficulty"
          ? this.config.difficulty.toUpperCase()
          : key === "megaMode"
            ? enabled
              ? this.config.megaMixMode
                ? "FULL"
                : "STATS"
              : "OFF"
            : enabled
              ? "ON"
              : "OFF";
      const leftArrow = this.leftArrows[index];
      const rightArrow = this.rightArrows[index];
      this.optionLabels[index].setY(rowY).setVisible(visible);
      text
        .setText(valueLabel)
        .setY(rowY)
        .setVisible(visible)
        .setAlpha(enabled ? 1 : 0.55);
      rightArrow
        .setPosition(optionsWidth - 20, rowY + 4)
        .setVisible(
          visible
            && (key === "difficulty"
              ? this.config.difficulty !== "hell"
              : key === "megaMode"
                ? !this.config.megaMixMode
                : !enabled),
        );
      leftArrow
        .setPosition(rightArrow.x - Math.round(text.displayWidth) - 10, rightArrow.y)
        .setVisible(visible && (key === "difficulty" ? this.config.difficulty !== "youngster" : enabled));
      text.setX(Math.round((leftArrow.x + rightArrow.x + leftArrow.displayWidth) / 2));
      if (this.cursor === startIndex) {
        leftArrow.setTint(0x808080);
        rightArrow.setTint(0x808080);
      } else {
        leftArrow.clearTint();
        rightArrow.clearTint();
      }
    });
    if (this.cursor < startIndex) {
      this.startRegionOption = 0;
      this.cursorObject
        .setVisible(true)
        .setPosition(4, 28 + (this.cursor - this.visibleStart) * 16)
        .setSize(optionsWidth - 8, 16);
      this.startCursor.setVisible(false);
      const option = OPTIONS[this.cursor];
      if (option.key === "megaMode") {
        this.setDescription(
          this.config.megaMode
            ? this.config.megaMixMode
              ? "Full Mix: pseudo-Megas gain the stone's stat delta, one non-duplicate Mega type, and replace innate slots 1 and 3 with the Mega template's innates."
              : "Stats: pseudo-Megas gain only the stone's stat delta. Their typing and innates stay unchanged."
            : `${option.description} Choose STATS for stat deltas only or FULL to also inherit a Mega type and its first and third innates.`,
        );
      } else {
        this.setDescription(option.description);
      }
    } else {
      const anyEnabled = hasEnabledMode(this.config);
      const canReuse = loadLastFunModeConfig() != null;
      if (!canReuse) {
        this.startRegionOption = 0;
      }
      this.cursorObject.setVisible(false);
      this.startCursor.setVisible(true);
      if (this.startRegionOption === 1) {
        this.startText.setText("LAST SETUP").setAlpha(1);
        this.setDescription(
          "Restore the modifier choices used for your previous Fun Mode run. Press Left or Right to switch back to Start.",
        );
      } else {
        this.startText.setText("START").setAlpha(anyEnabled ? 1 : 0.45);
        this.setDescription(
          anyEnabled ? "Begin a 200-wave Fun Mode run." : "Enable at least one modifier before starting.",
        );
      }
    }
    this.scrollUpArrow.setVisible(this.visibleStart > 0);
    this.scrollDownArrow.setVisible(this.visibleStart + VISIBLE_OPTION_ROWS < startIndex);
    if (this.cursor < startIndex) {
      this.startText.setText("START");
      this.startText.setAlpha(hasEnabledMode(this.config) ? 1 : 0.45);
    }
    this.updateLastSetupButton();
  }

  private setDescription(description: string): void {
    this.descriptionText.setText(`[color=${Color.ORANGE}][shadow=${ShadowColor.ORANGE}]${description}`);
  }

  private setHeaderFocus(focused: boolean): void {
    this.onHeaderButton = focused;
    this.cursorObject.setVisible(!focused && this.cursor < OPTIONS.length);
    this.startCursor.setVisible(!focused && this.cursor === OPTIONS.length);
    this.updateLastSetupButton();
  }

  private updateLastSetupButton(): void {
    const available = loadLastFunModeConfig() != null;
    if (!available) {
      this.onHeaderButton = false;
    }
    this.lastSetupButton.setVisible(available).setAlpha(this.onHeaderButton ? 1 : 0.6);
    this.lastSetupText.setVisible(available).setAlpha(this.onHeaderButton ? 1 : 0.6);
  }

  private applyLastSetup(): boolean {
    const saved = loadLastFunModeConfig();
    if (!saved) {
      return false;
    }
    this.config = { ...saved, abilityRerollSeed: 0 };
    this.startRegionOption = 0;
    this.setHeaderFocus(false);
    this.setCursor(0);
    return true;
  }
}
