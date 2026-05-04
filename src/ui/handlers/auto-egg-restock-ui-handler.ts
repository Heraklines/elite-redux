import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

export class AutoEggRestockUiHandler extends MessageUiHandler {
  private container!: Phaser.GameObjects.Container;

  constructor() {
    super(UiMode.AUTO_EGG_RESTOCK);
  }

  setup(): void {
    this.container = globalScene.add.container(0, 0);
    this.container.setVisible(false);
    const bg = addWindow(0, 0, 220, 180);
    this.container.add(bg);
    this.container.add(addTextObject(8, 4, i18next.t("egg:autoRestockTitle"), TextStyle.WINDOW));
    globalScene.uiContainer.add(this.container);
  }

  override show(args: any[]): boolean {
    super.show(args);
    this.container.setVisible(true);
    this.getUi().bringToTop(this.container);
    return true;
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
  }

  override processInput(button: Button): boolean {
    if (button === Button.CANCEL) {
      this.getUi().revertMode();
      return true;
    }
    return false;
  }
}
