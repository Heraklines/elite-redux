import { globalScene } from "#app/global-scene";
import { THEME_SEEDS, type ThemeSeed } from "#data/llm-director/theme-seeds";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

/**
 * Theme picker — first stop after starter selection in Director mode.
 *
 * Player rolls a one-line story seed from `THEME_SEEDS`; ACTION on Reroll picks
 * another, ACTION on Accept fires the configured `onAccept` callback with the
 * chosen seed. v1 has no custom-text input.
 */

interface ThemePickerArgs {
  onAccept: (seed: ThemeSeed) => void;
  onCancel?: () => void;
}

enum Row {
  REROLL = 0,
  ACCEPT = 1,
  CANCEL = 2,
}

const ROW_COUNT = 3;
const PANEL_WIDTH = 280;
const PANEL_HEIGHT = 96;
const SEED_TEXT_WIDTH = PANEL_WIDTH - 24;
const ROW_TOP = 60;
const ROW_HEIGHT = 12;
const BUTTON_X = 16;

export class LlmDirectorThemePickerUiHandler extends MessageUiHandler {
  private container!: Phaser.GameObjects.Container;
  private titleText!: Phaser.GameObjects.Text;
  private seedText!: Phaser.GameObjects.Text;
  private rowLabels: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Image | null = null;
  private currentSeed: ThemeSeed = THEME_SEEDS[0];
  private onAcceptCb?: (seed: ThemeSeed) => void;
  private onCancelCb?: () => void;

  public constructor() {
    super(UiMode.LLM_DIRECTOR_THEME_PICKER);
  }

  public override setup(): void {
    this.container = globalScene.add.container(40, 40);
    this.container.setVisible(false);
    const bg = addWindow(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    this.container.add(bg);

    this.titleText = addTextObject(8, 4, i18next.t("llmDirector:themePickerTitle"), TextStyle.WINDOW);
    this.container.add(this.titleText);
    this.container.add(
      addTextObject(8, 18, i18next.t("llmDirector:themePickerSubtitle"), TextStyle.MESSAGE, {
        wordWrap: { width: SEED_TEXT_WIDTH * 6 },
      }),
    );
    this.seedText = addTextObject(8, 36, "", TextStyle.MESSAGE, {
      wordWrap: { width: SEED_TEXT_WIDTH * 6 },
    });
    this.container.add(this.seedText);

    this.rowLabels[Row.REROLL] = addTextObject(
      BUTTON_X,
      ROW_TOP,
      i18next.t("llmDirector:themePickerReroll"),
      TextStyle.WINDOW,
    );
    this.rowLabels[Row.ACCEPT] = addTextObject(
      BUTTON_X,
      ROW_TOP + ROW_HEIGHT,
      i18next.t("llmDirector:themePickerAccept"),
      TextStyle.WINDOW,
    );
    this.rowLabels[Row.CANCEL] = addTextObject(
      BUTTON_X,
      ROW_TOP + 2 * ROW_HEIGHT,
      i18next.t("llmDirector:themePickerCancel"),
      TextStyle.WINDOW,
    );
    for (const label of this.rowLabels) {
      this.container.add(label);
    }

    globalScene.uiContainer.add(this.container);
  }

  public override show(args: unknown[]): boolean {
    super.show(args);
    const opts = args[0] as ThemePickerArgs | undefined;
    if (opts?.onAccept) {
      this.onAcceptCb = opts.onAccept;
    }
    if (opts?.onCancel) {
      this.onCancelCb = opts.onCancel;
    }
    this.cursor = Row.ACCEPT;
    this.rollNew();
    this.container.setVisible(true);
    this.getUi().bringToTop(this.container);
    this.refreshCursor();
    return true;
  }

  public override clear(): void {
    super.clear();
    this.container.setVisible(false);
  }

  public override processInput(button: Button): boolean {
    const ui = this.getUi();
    switch (button) {
      case Button.CANCEL:
        if (this.onCancelCb) {
          this.onCancelCb();
        }
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
      case Button.ACTION:
        return this.handleAction();
      default:
        return false;
    }
  }

  private handleAction(): boolean {
    const ui = this.getUi();
    switch (this.cursor as Row) {
      case Row.REROLL:
        this.rollNew();
        ui.playSelect();
        return true;
      case Row.ACCEPT:
        ui.playSelect();
        if (this.onAcceptCb) {
          this.onAcceptCb(this.currentSeed);
        }
        return true;
      case Row.CANCEL:
        if (this.onCancelCb) {
          this.onCancelCb();
        }
        ui.revertMode();
        return true;
    }
    return false;
  }

  /**
   * Re-roll: pick a different seed than the current one (so a press always
   * produces visible change).
   */
  private rollNew(): void {
    if (THEME_SEEDS.length === 0) {
      return;
    }
    if (THEME_SEEDS.length === 1) {
      this.currentSeed = THEME_SEEDS[0];
    } else {
      let next = this.currentSeed;
      while (next.id === this.currentSeed.id) {
        next = THEME_SEEDS[Math.floor(Math.random() * THEME_SEEDS.length)];
      }
      this.currentSeed = next;
    }
    this.seedText.setText(this.currentSeed.text);
  }

  private refreshCursor(): void {
    const ui = this.getUi();
    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.cursorObj.setOrigin(0, 0);
      this.container.add(this.cursorObj);
    }
    this.cursorObj.setPosition(BUTTON_X - 12, ROW_TOP + this.cursor * ROW_HEIGHT);
    ui.bringToTop(this.cursorObj);
  }
}
