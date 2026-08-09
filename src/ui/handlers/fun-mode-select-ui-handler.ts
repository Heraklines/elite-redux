import { globalScene } from "#app/global-scene";
import {
  DEFAULT_FUN_MODE_CONFIG,
  type FunModeConfig,
  getFunModeConfig,
  setFunModeConfig,
} from "#data/elite-redux/er-fun-mode";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import type { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

type FunModeKey = Exclude<keyof FunModeConfig, "abilityRerollSeed">;

const OPTIONS: readonly { key: FunModeKey; label: string; description: string }[] = [
  {
    key: "randomizePokemon",
    label: "Pokemon",
    description:
      "Every newly generated enemy Pokemon is replaced from the full species pool. Biome pools and BST limits do not apply.",
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
    description:
      "Start with a Mega Bracelet. Pokemon without a real Mega can use any Mega Stone as a temporary stat-only Mega.",
  },
  {
    key: "shuffleMegaStats",
    label: "Shuffle Mega Stats",
    description:
      "While a Pokemon is Mega'd, redistribute its effective Mega stats while preserving the Mega form's total BST.",
  },
];

function hasEnabledMode(config: FunModeConfig): boolean {
  return OPTIONS.some(option => config[option.key]);
}

export class FunModeSelectUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private cursorObject: Phaser.GameObjects.NineSlice;
  private descriptionText: Phaser.GameObjects.Text;
  private startText: Phaser.GameObjects.Text;
  private readonly valueTexts: Phaser.GameObjects.Text[] = [];
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
    const rulesText = addTextObject(width - 6, 7, "Youngster rules  |  No Favor or Vouchers", TextStyle.SETTINGS_LABEL)
      .setOrigin(1, 0)
      .setAlpha(0.8);
    rulesText.setScale(rulesText.scaleX * 0.7, rulesText.scaleY * 0.7);

    const optionsWidth = Math.floor(width * 0.56);
    const optionsWindow = addWindow(0, 24, optionsWidth, height - 26).setOrigin(0);
    const descriptionWindow = addWindow(optionsWidth, 24, width - optionsWidth, height - 50).setOrigin(0);
    const startWindow = addWindow(optionsWidth, height - 26, width - optionsWidth, 24).setOrigin(0);

    const rowObjects: Phaser.GameObjects.GameObject[] = [];
    OPTIONS.forEach((option, index) => {
      const y = 32 + index * 21;
      const label = addTextObject(10, y, option.label, TextStyle.SETTINGS_LABEL).setOrigin(0, 0.5);
      const value = addTextObject(optionsWidth - 12, y, "ON", TextStyle.SETTINGS_LABEL).setOrigin(1, 0.5);
      this.valueTexts.push(value);
      rowObjects.push(label, value);
    });

    this.cursorObject = globalScene.add
      .nineslice(5, 27, "summary_moves_cursor", undefined, optionsWidth - 10, 20, 1, 1, 1, 1)
      .setOrigin(0);
    this.descriptionText = addTextObject(optionsWidth + 7, 31, "", TextStyle.SETTINGS_LABEL).setOrigin(0);
    this.descriptionText.setWordWrapWidth((width - optionsWidth - 14) * 6);
    this.startText = addTextObject(0, 0, "START", TextStyle.SETTINGS_LABEL).setOrigin(0.5, 0.5);
    this.startText.setPosition(startWindow.x + startWindow.width / 2, startWindow.y + startWindow.height / 2);

    this.container.add([
      overlay,
      header,
      headerText,
      rulesText,
      optionsWindow,
      descriptionWindow,
      startWindow,
      ...rowObjects,
      this.cursorObject,
      this.descriptionText,
      this.startText,
    ]);
    this.container.setVisible(false);
    ui.add(this.container);
  }

  public override show(args: any[]): boolean {
    super.show(args);
    this.config = { ...getFunModeConfig() };
    this.container.setVisible(true);
    this.setCursor(0);
    this.refresh();
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  public override processInput(button: Button): boolean {
    let success = false;
    const startIndex = OPTIONS.length;
    if (button === Button.CANCEL) {
      globalScene.phaseManager.toTitleScreen();
      globalScene.phaseManager.getCurrentPhase().end();
      success = true;
    } else if (button === Button.UP) {
      success = this.setCursor(this.cursor === 0 ? startIndex : this.cursor - 1);
    } else if (button === Button.DOWN) {
      success = this.setCursor(this.cursor === startIndex ? 0 : this.cursor + 1);
    } else if (this.cursor < startIndex && (button === Button.LEFT || button === Button.RIGHT)) {
      const key = OPTIONS[this.cursor].key;
      const value = button === Button.RIGHT;
      success = this.config[key] !== value;
      this.config[key] = value;
    } else if (button === Button.ACTION || button === Button.SUBMIT) {
      if (this.cursor < startIndex) {
        const key = OPTIONS[this.cursor].key;
        this.config[key] = !this.config[key];
        success = true;
      } else if (hasEnabledMode(this.config)) {
        setFunModeConfig(this.config);
        globalScene.phaseManager.unshiftNew("SelectStarterPhase");
        globalScene.phaseManager.getCurrentPhase().end();
        success = true;
      }
    }

    if (success) {
      this.getUi().playSelect();
      this.refresh();
    }
    return success;
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
    if (!this.cursorObject || !this.descriptionText) {
      return;
    }
    const startIndex = OPTIONS.length;
    this.valueTexts.forEach((text, index) => {
      text.setText(this.config[OPTIONS[index].key] ? "ON" : "OFF");
      text.setAlpha(this.config[OPTIONS[index].key] ? 1 : 0.55);
    });
    if (this.cursor < startIndex) {
      const optionsWidth = Math.floor(globalScene.scaledCanvas.width * 0.56);
      this.cursorObject.setPosition(5, 26 + this.cursor * 21).setSize(optionsWidth - 10, 18);
      this.descriptionText.setText(OPTIONS[this.cursor].description);
    } else {
      const anyEnabled = hasEnabledMode(this.config);
      const { width, height } = globalScene.scaledCanvas;
      const optionsWidth = Math.floor(width * 0.56);
      this.cursorObject.setPosition(optionsWidth + 4, height - 23).setSize(width - optionsWidth - 8, 18);
      this.descriptionText.setText(
        anyEnabled ? "Begin a 200-wave Fun Mode run." : "Enable at least one randomizer before starting.",
      );
      this.startText.setAlpha(anyEnabled ? 1 : 0.45);
    }
    if (this.cursor < startIndex) {
      this.startText.setAlpha(hasEnabledMode(this.config) ? 1 : 0.45);
    }
  }
}
