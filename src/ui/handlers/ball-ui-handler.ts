import { globalScene } from "#app/global-scene";
import { getFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { getMoodyCaptureMultiplier } from "#data/elite-redux/moody/moody-scene-adapter";
import { getMoodyModeState, MOODY_BOON_BY_ID } from "#data/elite-redux/moody/moody-state";
import { getPokeballName } from "#data/pokeball";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { getMoodyLivePresentationSnapshot } from "#ui/moody/moody-live-presentation";
import { addTextObject, getTextStyleOptions } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

export class BallUiHandler extends UiHandler {
  private pokeballSelectContainer: Phaser.GameObjects.Container;
  private pokeballSelectBg: Phaser.GameObjects.NineSlice;
  private countsText: Phaser.GameObjects.Text;
  private moodyCaptureText: Phaser.GameObjects.Text;
  private moodyCaptureBg: Phaser.GameObjects.NineSlice;

  private cursorObj: Phaser.GameObjects.Image | null;

  private scale = 0.1666666667;

  constructor() {
    super(UiMode.BALL);
  }

  setup() {
    const ui = this.getUi();

    this.scale = getTextStyleOptions(TextStyle.WINDOW).scale;

    let optionsTextContent = "";

    for (let pb = 0; pb < Object.keys(globalScene.pokeballCounts).length; pb++) {
      optionsTextContent += `${getPokeballName(pb)}\n`;
    }
    optionsTextContent += i18next.t("commandUiHandler:ballCancel");
    const optionsText = addTextObject(0, 0, optionsTextContent, TextStyle.WINDOW, { align: "right", maxLines: 6 });
    const optionsTextWidth = optionsText.displayWidth;
    this.pokeballSelectContainer = globalScene.add.container(
      globalScene.scaledCanvas.width - 51 - Math.max(64, optionsTextWidth),
      -49,
    );
    this.pokeballSelectContainer.setVisible(false);
    ui.add(this.pokeballSelectContainer);

    this.pokeballSelectBg = addWindow(0, 0, 50 + Math.max(64, optionsTextWidth), 32 + 480 * this.scale);
    this.pokeballSelectBg.setOrigin(0, 1);
    this.pokeballSelectContainer.add(this.pokeballSelectBg);
    this.pokeballSelectContainer.add(optionsText);
    optionsText.setOrigin(0, 0);
    optionsText.setPositionRelative(this.pokeballSelectBg, 42, 9);
    optionsText.setLineSpacing(this.scale * 72);

    this.countsText = addTextObject(0, 0, "", TextStyle.WINDOW, {
      maxLines: 5,
    });
    this.countsText.setPositionRelative(this.pokeballSelectBg, 18, 9);
    this.countsText.setLineSpacing(this.scale * 72);
    this.pokeballSelectContainer.add(this.countsText);

    this.moodyCaptureBg = addWindow(3, -111, 218, 58).setOrigin(0, 0).setVisible(false);
    ui.add(this.moodyCaptureBg);
    this.moodyCaptureText = addTextObject(8, -107, "", TextStyle.PARTY, {
      fontSize: "28px",
      fixedWidth: 210 * 6,
      maxLines: 7,
    })
      .setOrigin(0, 0)
      .setVisible(false);
    ui.add(this.moodyCaptureText);

    this.setCursor(0);
  }

  show(args: any[]): boolean {
    super.show(args);

    this.updateCounts();
    this.refreshMoodyCaptureContext();
    this.pokeballSelectContainer.setVisible(true);
    this.setCursor(this.cursor);

    return true;
  }

  private refreshMoodyCaptureContext(): void {
    const enabled = globalScene.gameMode?.isFun === true && getFunModeConfig().moodyMode;
    const state = enabled ? getMoodyModeState() : null;
    const target = globalScene.getEnemyField().find(pokemon => pokemon?.isActive(true));
    if (state == null || target == null) {
      this.moodyCaptureBg.setVisible(false);
      this.moodyCaptureText.setVisible(false);
      return;
    }
    const captureBoons = state.boons.filter(boon => {
      const definition = MOODY_BOON_BY_ID.get(boon.boonId);
      return !boon.dormant && (definition?.targetKind === "reward" || boon.boonId === "recruiter-s-eye");
    });
    const multiplier = getMoodyCaptureMultiplier(target);
    const recruiter = getMoodyLivePresentationSnapshot()?.recruiterEye;
    const names = captureBoons
      .slice(0, 2)
      .map(boon => MOODY_BOON_BY_ID.get(boon.boonId)?.name ?? boon.boonId)
      .join(" / ");
    const recruiterLines =
      recruiter?.pokemonId === target.id
        ? [
            `RECRUITER'S EYE - ${recruiter.guaranteedTrait}`,
            `Active Ability: ${recruiter.activeAbilityCollected}/${recruiter.activeAbilityTotal} collected`,
            `Egg moves: ${recruiter.missingEggMoves} missing / Natures: ${recruiter.missingNatures} missing`,
            `IVs: ${recruiter.ivSummary}`,
          ]
        : [];
    const text = [names, multiplier === 1 ? "" : `catch x${multiplier.toFixed(2)}`, ...recruiterLines]
      .filter(part => part.length > 0)
      .join("\n");
    this.moodyCaptureBg.setVisible(text.length > 0);
    this.moodyCaptureText.setText(text.length > 0 ? `MOOD: ${text}` : "").setVisible(text.length > 0);
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    const pokeballTypeCount = Object.keys(globalScene.pokeballCounts).length;

    if (button === Button.ACTION || button === Button.CANCEL) {
      const commandPhase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
      success = true;
      if (button === Button.ACTION && this.cursor < pokeballTypeCount) {
        if (globalScene.pokeballCounts[this.cursor]) {
          if (commandPhase.handleCommand(Command.BALL, this.cursor)) {
            globalScene.ui.setMode(UiMode.COMMAND, commandPhase.getFieldIndex());
            globalScene.ui.setMode(UiMode.MESSAGE);
            success = true;
          }
        } else {
          ui.playError();
        }
      } else {
        ui.setMode(UiMode.COMMAND, commandPhase.getFieldIndex());
        success = true;
      }
    } else {
      switch (button) {
        case Button.UP:
          success = this.setCursor(this.cursor ? this.cursor - 1 : pokeballTypeCount);
          break;
        case Button.DOWN:
          success = this.setCursor(this.cursor < pokeballTypeCount ? this.cursor + 1 : 0);
          break;
      }
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  updateCounts() {
    this.countsText.setText(
      Object.values(globalScene.pokeballCounts)
        .map(c => `×${c}`)
        .join("\n"),
    );
  }

  setCursor(cursor: number): boolean {
    const ret = super.setCursor(cursor);

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.pokeballSelectContainer.add(this.cursorObj);
    }

    this.cursorObj.setScale(this.scale * 6);
    this.cursorObj.setPositionRelative(this.pokeballSelectBg, 12, 15 + (6 + this.cursor * 96) * this.scale);

    return ret;
  }

  clear() {
    super.clear();
    this.pokeballSelectContainer.setVisible(false);
    this.moodyCaptureText.setVisible(false);
    this.moodyCaptureBg.setVisible(false);
    this.eraseCursor();
  }

  eraseCursor() {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
