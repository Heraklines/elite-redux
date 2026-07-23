import { MAX_TERAS_PER_ARENA } from "#app/constants";
import { isDevToolsEnabled } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { getTypeRgb } from "#data/type";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { Device } from "#enums/devices";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { SettingKeyboard } from "#system/settings-keyboard";
import { BattleInfoOverlay } from "#ui/battle-info-overlay";
import { PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { canTerastallize } from "#utils/pokemon-utils";
import i18next from "i18next";

export class CommandUiHandler extends UiHandler {
  private commandsContainer: Phaser.GameObjects.Container;
  private cursorObj: Phaser.GameObjects.Image | null;

  private teraButton: Phaser.GameObjects.Sprite;

  /** ER: multi-panel in-battle info overlay (opened with the Stats key / Info hint). */
  private battleInfo = new BattleInfoOverlay();
  /** ER: "Info" hotkey hint shown in the command window (glyph + label). */
  private infoHintIcon: Phaser.GameObjects.Sprite;
  private infoHintLabel: Phaser.GameObjects.Text;

  /** Showdown 1v1: a subtle turn-clock countdown shown while the host's 60s command clock ticks. */
  private showdownClockLabel: Phaser.GameObjects.Text;
  /** The per-second tick driving {@linkcode showdownClockLabel}; null when the clock is not shown. */
  private showdownClockTick: Phaser.Time.TimerEvent | null = null;
  /** Epoch ms the current turn clock expires (for the countdown text); 0 when not armed. */
  private showdownClockDeadline = 0;

  protected fieldIndex = 0;
  /** Remembered cursor per NON-lead field slot (index 1..2; a triple has two - a single shared `cursor2` made slots 2 and 3 clobber each other's memory). Slot 0 keeps the base-class `cursor`. */
  protected cursorsBySlot: number[] = [];

  /**
   * ER dev-tools: show a 3rd-row "Reset" command that reloads the current wave (the
   * lose-retry path). Gated to dev/staging - never appears in production.
   */
  private readonly resetEnabled = isDevToolsEnabled();

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

    // Dev-tools: shift the grid LEFT (not up) so the wider command window (resized in
    // show()) has room for a 3rd "Reset" column to the right of Ball/Run. The box grows
    // sideways toward the message panel; its height (and the enemy nameplate above) is
    // untouched. Production keeps the original x.
    this.commandsContainer = globalScene.add.container(this.resetEnabled ? 153 : 217, -38.7);
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

    // ER dev-tools: a 3rd-column "Reset" command (reload the current wave), to the right
    // of Ball/Run and vertically centered between the two rows. Dev/staging only.
    if (this.resetEnabled) {
      const resetText = addTextObject(111.6, 8, i18next.t("commandUiHandler:reset"), TextStyle.WINDOW_BATTLE_COMMAND);
      resetText.setName("reset-command");
      this.commandsContainer.add(resetText);
    }

    // ER: "Info" hotkey hint — a key glyph + label above the command grid that
    // advertises the Battle Info screen (opened with the Stats key). The glyph
    // frame is refreshed per input method in show()/updateInfoHint().
    this.infoHintIcon = globalScene.add
      .sprite(-1, -14, "keyboard", "C.png")
      .setName("info-hint-icon")
      .setScale(0.6)
      .setOrigin(0, 0);
    this.infoHintLabel = addTextObject(9, -15, i18next.t("commandUiHandler:info"), TextStyle.INSTRUCTIONS_TEXT, {
      fontSize: "42px",
    }).setName("info-hint-label");
    this.commandsContainer.add([this.infoHintIcon, this.infoHintLabel]);

    // Showdown 1v1 turn clock (right-aligned above the command grid). Hidden until the versus
    // CommandPhase arms it via startShowdownClock; matches the Info-hint chrome (small, subtle).
    this.showdownClockLabel = addTextObject(120, -15, "", TextStyle.INSTRUCTIONS_TEXT, { fontSize: "42px" })
      .setName("showdown-clock")
      .setOrigin(1, 0)
      .setVisible(false);
    this.commandsContainer.add(this.showdownClockLabel);
  }

  /**
   * Showdown 1v1: show the turn-clock countdown for `totalMs` (the versus CommandPhase drives it). Ticks
   * once a second, recoloring red under 10s. Idempotent restart; hidden + stopped by
   * {@linkcode stopShowdownClock} on pick / phase end. Cosmetic only - the authoritative expiry timer
   * lives in CommandPhase.
   */
  startShowdownClock(totalMs: number): void {
    this.stopShowdownClock();
    this.showdownClockDeadline = Date.now() + totalMs;
    this.showdownClockLabel.setVisible(true);
    this.refreshShowdownClock();
    // Tick every second; the harness no-ops timers, so the initial render still shows the full clock.
    this.showdownClockTick = globalScene.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this.refreshShowdownClock(),
    });
  }

  /** Update the countdown text + color from the remaining time (clamped at 0). */
  private refreshShowdownClock(): void {
    const remainingMs = Math.max(0, this.showdownClockDeadline - Date.now());
    const secs = Math.ceil(remainingMs / 1000);
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    this.showdownClockLabel.setText(`${mm}:${ss.toString().padStart(2, "0")}`);
    // Under 10s: red; otherwise the standard instruction tint.
    this.showdownClockLabel.setColor(secs <= 10 ? "#e8646a" : "#f8f8f8");
  }

  /** Hide + stop the turn-clock countdown (no-op when not shown). */
  stopShowdownClock(): void {
    this.showdownClockTick?.remove();
    this.showdownClockTick = null;
    this.showdownClockDeadline = 0;
    this.showdownClockLabel?.setVisible(false);
  }

  /** Refresh the Info-hint key glyph to match the player's current input method/binding. */
  private updateInfoHint(): void {
    let gamepadType: string;
    if (globalScene.inputMethod === "gamepad") {
      const device = globalScene.inputController.selectedDevice[Device.GAMEPAD];
      gamepadType = device == null ? "keyboard" : globalScene.inputController.getConfig(device).padType;
    } else {
      gamepadType = globalScene.inputMethod;
    }
    let iconPath: string | undefined;
    if (gamepadType === "touch") {
      gamepadType = "keyboard";
      iconPath = "C.png";
    } else {
      iconPath = globalScene.inputController?.getIconForLatestInputRecorded(SettingKeyboard.BUTTON_STATS);
    }
    if (gamepadType && iconPath) {
      this.infoHintIcon.setTexture(gamepadType, iconPath).setVisible(true);
      this.infoHintLabel.setVisible(true);
    }
  }

  show(args: any[]): boolean {
    super.show(args);

    this.fieldIndex = args.length > 0 ? (args[0] as number) : 0;

    this.commandsContainer.setVisible(true);
    this.updateInfoHint();

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
    // Dev-tools: widen the command window to fit the 3rd Reset column. Origin is
    // bottom-left and the right edge is at the screen edge, so we move it LEFT and grow
    // the width - the box expands sideways, same height. Idempotent; untouched in production.
    if (this.resetEnabled) {
      messageHandler.commandWindow.setSize(175, 48);
      messageHandler.commandWindow.setPosition(145, 0);
    }
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

    // ER: in-battle info overlay. While open it owns input (Left/Right page
    // panels, Up/Down page the inspected Pokémon, any other button closes).
    if (this.battleInfo.isOpen) {
      this.battleInfo.handleInput(button);
      return true;
    }
    // Stats button opens the info overlay.
    if (button === Button.STATS) {
      this.battleInfo.open();
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
          // ER dev-tools: reload the current wave (lose-retry path). Only reachable when
          // the dev-gated Reset command is shown.
          case Command.RESET: {
            const phase = globalScene.phaseManager.getCurrentPhase();
            const commandPhase = phase.is("CommandPhase")
              ? phase
              : (globalScene.phaseManager.getStandbyPhase() as CommandPhase);
            commandPhase.resetWave();
            success = true;
            break;
          }
        }
      } else {
        (globalScene.phaseManager.getCurrentPhase() as CommandPhase).cancel();
      }
    } else {
      switch (button) {
        case Button.UP:
          if (cursor === Command.POKEMON || cursor === Command.RUN) {
            success = this.setCursor(cursor - 2);
          } else if (cursor === Command.RESET) {
            // Reset sits in the 3rd column between the rows; Up biases to the top.
            success = this.setCursor(Command.BALL);
          }
          break;
        case Button.DOWN:
          if (cursor === Command.FIGHT || cursor === Command.BALL) {
            success = this.setCursor(cursor + 2);
          } else if (cursor === Command.RESET) {
            success = this.setCursor(Command.RUN);
          }
          break;
        case Button.LEFT:
          if (cursor === Command.BALL || cursor === Command.RUN) {
            success = this.setCursor(cursor - 1);
          } else if (cursor === Command.RESET) {
            // Leave the dev-only 3rd column back into the 2x2 grid.
            success = this.setCursor(Command.BALL);
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
          } else if (this.resetEnabled && (cursor === Command.BALL || cursor === Command.RUN)) {
            // Step right from Ball/Run into the dev-only 3rd "Reset" column.
            success = this.setCursor(Command.RESET);
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
    return this.fieldIndex ? (this.cursorsBySlot[this.fieldIndex] ?? 0) : this.cursor;
  }

  setCursor(cursor: number): boolean {
    const changed = this.getCursor() !== cursor;
    if (changed) {
      if (this.fieldIndex) {
        this.cursorsBySlot[this.fieldIndex] = cursor;
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
    } else if (cursor === Command.RESET) {
      // 3rd-column Reset (dev-only): right of Ball/Run, vertically centered between rows.
      this.cursorObj.setPosition(106.6, 16);
      this.cursorObj.setVisible(true);
    } else {
      this.cursorObj.setPosition(-5 + (cursor % 2 === 1 ? 56 : 0), 8 + (cursor >= 2 ? 16 : 0));
      this.cursorObj.setVisible(true);
    }

    return changed;
  }

  clear(): void {
    super.clear();
    this.battleInfo.close();
    this.stopShowdownClock();
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
