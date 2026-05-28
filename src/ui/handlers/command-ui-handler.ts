import { MAX_TERAS_PER_ARENA } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { getErAbilityDescription } from "#data/elite-redux/er-ability-descriptions";
import { getTypeRgb } from "#data/type";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import { addTextObject, getTextColor } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { canTerastallize } from "#utils/pokemon-utils";
import i18next from "i18next";

export class CommandUiHandler extends UiHandler {
  private commandsContainer: Phaser.GameObjects.Container;
  private cursorObj: Phaser.GameObjects.Image | null;

  private teraButton: Phaser.GameObjects.Sprite;

  /** ER: enemy ability/innate inspect overlay (toggled with the Stats key). */
  private enemyInspectContainer: Phaser.GameObjects.Container | null = null;

  protected fieldIndex = 0;
  protected cursor2 = 0;

  constructor() {
    super(UiMode.COMMAND);
  }

  setup() {
    const ui = this.getUi();
    const commands = [
      i18next.t("commandUiHandler:fight"),
      i18next.t("commandUiHandler:ball"),
      i18next.t("commandUiHandler:pokemon"),
      i18next.t("commandUiHandler:run"),
    ];

    this.commandsContainer = globalScene.add.container(217, -38.7);
    this.commandsContainer.setName("commands");
    this.commandsContainer.setVisible(false);
    ui.add(this.commandsContainer);

    this.teraButton = globalScene.add.sprite(-32, 15, "button_tera");
    this.teraButton.setName("terastallize-button");
    this.teraButton.setScale(1.3);
    this.teraButton.setFrame("fire");
    this.teraButton.setPipeline(globalScene.spritePipeline, {
      tone: [0.0, 0.0, 0.0, 0.0],
      ignoreTimeTint: true,
      teraColor: getTypeRgb(PokemonType.FIRE),
      isTerastallized: false,
    });
    this.commandsContainer.add(this.teraButton);

    for (let c = 0; c < commands.length; c++) {
      const commandText = addTextObject(
        c % 2 === 0 ? 0 : 55.8,
        c < 2 ? 0 : 16,
        commands[c],
        TextStyle.WINDOW_BATTLE_COMMAND,
      );
      commandText.setName(commands[c]);
      this.commandsContainer.add(commandText);
    }
  }

  show(args: any[]): boolean {
    super.show(args);

    this.fieldIndex = args.length > 0 ? (args[0] as number) : 0;

    this.commandsContainer.setVisible(true);

    let commandPhase: CommandPhase;
    const currentPhase = globalScene.phaseManager.getCurrentPhase();
    if (currentPhase.is("CommandPhase")) {
      commandPhase = currentPhase;
    } else {
      commandPhase = globalScene.phaseManager.getStandbyPhase() as CommandPhase;
    }

    if (this.canTera()) {
      this.teraButton.setVisible(true);
      this.teraButton.setFrame(PokemonType[globalScene.getField()[this.fieldIndex].getTeraType()].toLowerCase());
    } else {
      this.teraButton.setVisible(false);
      if (this.getCursor() === Command.TERA) {
        this.setCursor(Command.FIGHT);
      }
    }
    this.toggleTeraButton();

    const pokemonName = commandPhase.getPokemon().getNameToRender({ prependFormName: false });
    const messageHandler = this.getUi().getMessageHandler();
    messageHandler.bg.setVisible(true);
    messageHandler.commandWindow.setVisible(true);
    messageHandler.movesWindowContainer.setVisible(false);
    messageHandler.message.setWordWrapWidth(this.canTera() ? 910 : 1110);
    messageHandler.showText(i18next.t("commandUiHandler:actionMessage", { pokemonName }), 0);

    if (this.getCursor() === Command.POKEMON) {
      this.setCursor(Command.FIGHT);
    } else {
      this.setCursor(this.getCursor());
    }

    return true;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    const cursor = this.getCursor();

    // ER: enemy ability/innate inspect overlay. While open, any button
    // dismisses it (and is consumed so it doesn't also act on the menu).
    if (this.enemyInspectContainer) {
      this.closeEnemyInspect();
      return true;
    }
    // Stats button toggles the inspect overlay open.
    if (button === Button.STATS) {
      this.openEnemyInspect();
      return true;
    }

    if (button === Button.CANCEL || button === Button.ACTION) {
      if (button === Button.ACTION) {
        switch (cursor) {
          // Fight
          case Command.FIGHT:
            ui.setMode(UiMode.FIGHT, (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getFieldIndex());
            success = true;
            break;
          // Ball
          case Command.BALL:
            ui.setModeWithoutClear(UiMode.BALL);
            success = true;
            break;
          // Pokemon
          case Command.POKEMON:
            ui.setMode(
              UiMode.PARTY,
              PartyUiMode.SWITCH,
              (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon().getFieldIndex(),
              null,
              PartyUiHandler.FilterNonFainted,
            );
            success = true;
            break;
          // Run
          case Command.RUN:
            (globalScene.phaseManager.getCurrentPhase() as CommandPhase).handleCommand(Command.RUN, 0);
            success = true;
            break;
          case Command.TERA:
            ui.setMode(
              UiMode.FIGHT,
              (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getFieldIndex(),
              Command.TERA,
            );
            success = true;
            break;
        }
      } else {
        (globalScene.phaseManager.getCurrentPhase() as CommandPhase).cancel();
      }
    } else {
      switch (button) {
        case Button.UP:
          if (cursor === Command.POKEMON || cursor === Command.RUN) {
            success = this.setCursor(cursor - 2);
          }
          break;
        case Button.DOWN:
          if (cursor === Command.FIGHT || cursor === Command.BALL) {
            success = this.setCursor(cursor + 2);
          }
          break;
        case Button.LEFT:
          if (cursor === Command.BALL || cursor === Command.RUN) {
            success = this.setCursor(cursor - 1);
          } else if ((cursor === Command.FIGHT || cursor === Command.POKEMON) && this.canTera()) {
            success = this.setCursor(Command.TERA);
            this.toggleTeraButton();
          }
          break;
        case Button.RIGHT:
          if (cursor === Command.FIGHT || cursor === Command.POKEMON) {
            success = this.setCursor(cursor + 1);
          } else if (cursor === Command.TERA) {
            success = this.setCursor(Command.FIGHT);
            this.toggleTeraButton();
          }
          break;
      }
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  canTera(): boolean {
    const activePokemon = globalScene.getField()[this.fieldIndex];
    const currentTeras = globalScene.arena.playerTerasUsed;
    const canTera = activePokemon.isPlayer() && canTerastallize(activePokemon);
    const plannedTera = +(
      globalScene.currentBattle.preTurnCommands[0]?.command === Command.TERA && this.fieldIndex > 0
    );
    return canTera && currentTeras + plannedTera < MAX_TERAS_PER_ARENA;
  }

  toggleTeraButton() {
    this.teraButton.setPipeline(globalScene.spritePipeline, {
      tone: [0.0, 0.0, 0.0, 0.0],
      ignoreTimeTint: true,
      teraColor: getTypeRgb(globalScene.getField()[this.fieldIndex].getTeraType()),
      isTerastallized: this.getCursor() === Command.TERA,
    });
  }

  getCursor(): number {
    return this.fieldIndex ? this.cursor2 : this.cursor;
  }

  setCursor(cursor: number): boolean {
    const changed = this.getCursor() !== cursor;
    if (changed) {
      if (this.fieldIndex) {
        this.cursor2 = cursor;
      } else {
        this.cursor = cursor;
      }
    }

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.commandsContainer.add(this.cursorObj);
    }

    if (cursor === Command.TERA) {
      this.cursorObj.setVisible(false);
    } else {
      this.cursorObj.setPosition(-5 + (cursor % 2 === 1 ? 56 : 0), 8 + (cursor >= 2 ? 16 : 0));
      this.cursorObj.setVisible(true);
    }

    return changed;
  }

  /**
   * ER: open a self-contained overlay showing the active enemy's ability and
   * innates (name + abbreviated description). Toggled by the Stats button;
   * any subsequent input closes it. Implemented as a plain container (no UI
   * mode switch) so it never disturbs the battle command flow.
   */
  private openEnemyInspect(): void {
    if (this.enemyInspectContainer) {
      return;
    }
    const enemy = globalScene.getEnemyField?.()[0];
    if (!enemy) {
      return;
    }

    // The `ui` container's coordinate space has its origin at the bottom-left
    // with content drawn at NEGATIVE y (top of screen ≈ -scaledCanvas.height).
    // Anchor the panel near the top and draw children downward in positive y.
    const W = 230;
    const H = globalScene.scaledCanvas.height;
    const c = globalScene.add.container(45, -H + 6).setDepth(1000);

    const scrim = globalScene.add.rectangle(0, 0, W, H - 12, 0x1a1a2e, 0.96).setOrigin(0, 0);
    c.add(scrim);

    const title = addTextObject(6, 3, `${enemy.getNameToRender()}`, TextStyle.SUMMARY_GOLD, { fontSize: "64px" });
    title.setOrigin(0, 0);
    c.add(title);

    // Build the row list: main ability + present innates.
    const entries: { label: string; abilityId: number }[] = [];
    const mainAbility = enemy.getAbility(true);
    if (mainAbility) {
      entries.push({ label: i18next.t("pokemonSummary:abilityLabel"), abilityId: mainAbility.id });
    }
    const innateIds = enemy.species.getPassiveAbilities(enemy.formIndex);
    for (let slot = 0; slot < 3; slot++) {
      const id = innateIds[slot];
      if (id !== undefined && id !== AbilityId.NONE) {
        entries.push({ label: i18next.t("pokemonSummary:innateLabel"), abilityId: id });
      }
    }

    let y = 16;
    for (const e of entries) {
      const bar = globalScene.add.rectangle(2, y, W - 4, 12, 0x4a4a63, 1).setOrigin(0, 0);
      c.add(bar);
      const label = addTextObject(5, y + 1, e.label, TextStyle.SUMMARY_GOLD, { fontSize: "56px" });
      label.setOrigin(0, 0);
      c.add(label);
      const name = addTextObject(58, y + 1, allAbilities[e.abilityId]?.name ?? "", TextStyle.SUMMARY, {
        fontSize: "56px",
      });
      name.setOrigin(0, 0);
      c.add(name);
      const desc = getErAbilityDescription(e.abilityId) ?? allAbilities[e.abilityId]?.description ?? "";
      const descText = addTextObject(5, y + 12, desc, TextStyle.WINDOW_ALT, {
        fontSize: "44px",
        wordWrap: { width: 1280 },
      });
      descText.setOrigin(0, 0);
      descText.setColor(getTextColor(TextStyle.WINDOW_ALT));
      c.add(descText);
      y += 14 + Math.max(11, descText.displayHeight) + 2;
    }

    const hint = addTextObject(W - 4, H - 16, i18next.t("pokemonSummary:abilityDetailBack"), TextStyle.SUMMARY, {
      fontSize: "42px",
    });
    hint.setOrigin(1, 1);
    c.add(hint);

    this.getUi().add(c);
    this.enemyInspectContainer = c;
  }

  private closeEnemyInspect(): void {
    if (this.enemyInspectContainer) {
      this.enemyInspectContainer.destroy();
      this.enemyInspectContainer = null;
    }
  }

  clear(): void {
    super.clear();
    this.closeEnemyInspect();
    this.getUi().getMessageHandler().commandWindow.setVisible(false);
    this.commandsContainer.setVisible(false);
    this.getUi().getMessageHandler().clearText();
    this.eraseCursor();
  }

  eraseCursor(): void {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
