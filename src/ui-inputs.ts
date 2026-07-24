import { globalScene } from "#app/global-scene";
import type { InputsController } from "#app/inputs-controller";
import { isDev } from "#constants/app-constants";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { Setting, SettingKeys, settingIndex } from "#system/settings";
import { CommandUiHandler } from "#ui/command-ui-handler";
import { FightUiHandler } from "#ui/fight-ui-handler";
import { LearnMoveBatchUiHandler } from "#ui/learn-move-batch-ui-handler";
import type { MessageUiHandler } from "#ui/message-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { PokedexUiHandler } from "#ui/pokedex-ui-handler";
import { RunInfoUiHandler } from "#ui/run-info-ui-handler";
import { SettingsAudioUiHandler } from "#ui/settings-audio-ui-handler";
import { SettingsDisplayUiHandler } from "#ui/settings-display-ui-handler";
import { SettingsGamepadUiHandler } from "#ui/settings-gamepad-ui-handler";
import { SettingsKeyboardUiHandler } from "#ui/settings-keyboard-ui-handler";
import { SettingsUiHandler } from "#ui/settings-ui-handler";
import { ShowdownSetEditorUiHandler } from "#ui/showdown-set-editor-ui-handler";
import { ShowdownTeamMenuUiHandler } from "#ui/showdown-team-menu-ui-handler";
import { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { SummaryUiHandler } from "#ui/summary-ui-handler";
import Phaser from "phaser";

type ActionKeys = Record<Button, () => void>;

export class UiInputs {
  private events: Phaser.Events.EventEmitter;
  private inputsController: InputsController;

  constructor(inputsController: InputsController) {
    this.inputsController = inputsController;
    this.init();
  }

  init(): void {
    this.events = this.inputsController.events;
    this.listenInputs();
  }

  detectInputMethod(evt): void {
    if (evt.controller_type === "keyboard") {
      //if the touch property is present and defined, then this is a simulated keyboard event from the touch screen
      if (Object.hasOwn(evt, "isTouch") && evt.isTouch) {
        globalScene.inputMethod = "touch";
      } else {
        globalScene.inputMethod = "keyboard";
      }
    } else if (evt.controller_type === "gamepad") {
      globalScene.inputMethod = "gamepad";
    }
  }

  listenInputs(): void {
    this.events.on(
      "input_down",
      event => {
        this.detectInputMethod(event);

        const actions = this.getActionsKeyDown();
        if (!Object.hasOwn(actions, event.button)) {
          return;
        }
        actions[event.button]();
      },
      this,
    );

    this.events.on(
      "input_up",
      event => {
        const actions = this.getActionsKeyUp();
        if (!Object.hasOwn(actions, event.button)) {
          return;
        }
        actions[event.button]();
      },
      this,
    );
  }

  doVibration(inputSuccess: boolean, vibrationLength: number): void {
    if (inputSuccess && globalScene.enableVibration && typeof navigator.vibrate !== "undefined") {
      navigator.vibrate(vibrationLength);
    }
  }

  getActionsKeyDown(): ActionKeys {
    const actions: ActionKeys = {
      [Button.UP]: () => this.buttonDirection(Button.UP),
      [Button.DOWN]: () => this.buttonDirection(Button.DOWN),
      [Button.LEFT]: () => this.buttonDirection(Button.LEFT),
      [Button.RIGHT]: () => this.buttonDirection(Button.RIGHT),
      [Button.SUBMIT]: () => this.buttonTouch(),
      [Button.ACTION]: () => this.buttonAb(Button.ACTION),
      [Button.CANCEL]: () => this.buttonAb(Button.CANCEL),
      [Button.MENU]: () => this.buttonMenu(),
      [Button.STATS]: () => this.buttonGoToFilter(Button.STATS),
      [Button.CYCLE_SHINY]: () => this.buttonCycleOption(Button.CYCLE_SHINY),
      [Button.CYCLE_FORM]: () => this.buttonCycleOption(Button.CYCLE_FORM),
      [Button.CYCLE_GENDER]: () => this.buttonCycleOption(Button.CYCLE_GENDER),
      [Button.CYCLE_ABILITY]: () => this.buttonCycleOption(Button.CYCLE_ABILITY),
      [Button.CYCLE_NATURE]: () => this.buttonCycleOption(Button.CYCLE_NATURE),
      [Button.CYCLE_TERA]: () => this.buttonCycleOption(Button.CYCLE_TERA),
      [Button.SPEED_UP]: () => this.buttonSpeedChange(),
      [Button.SLOW_DOWN]: () => this.buttonSpeedChange(false),
      [Button.DEV_CUSTOM]: () => {
        if (isDev) {
          import("./dev-function").then(m => m.customDevFunction());
        }
      },
    };
    return actions;
  }

  getActionsKeyUp(): ActionKeys {
    const actions: ActionKeys = {
      [Button.UP]: () => {},
      [Button.DOWN]: () => {},
      [Button.LEFT]: () => {},
      [Button.RIGHT]: () => {},
      [Button.SUBMIT]: () => {},
      [Button.ACTION]: () => {},
      [Button.CANCEL]: () => {},
      [Button.MENU]: () => {},
      [Button.STATS]: () => this.buttonStats(false),
      [Button.CYCLE_SHINY]: () => {},
      [Button.CYCLE_FORM]: () => {},
      [Button.CYCLE_GENDER]: () => {},
      [Button.CYCLE_ABILITY]: () => {},
      [Button.CYCLE_NATURE]: () => {},
      [Button.CYCLE_TERA]: () => this.buttonInfo(false),
      [Button.SPEED_UP]: () => {},
      [Button.SLOW_DOWN]: () => {},
      [Button.DEV_CUSTOM]: () => {},
    };
    return actions;
  }

  buttonDirection(direction: Button): void {
    const inputSuccess = globalScene.ui.processInput(direction);
    const vibrationLength = 5;
    this.doVibration(inputSuccess, vibrationLength);
  }

  buttonAb(button: Button): void {
    globalScene.ui.processInput(button);
  }

  buttonTouch(): void {
    globalScene.ui.processInput(Button.SUBMIT) || globalScene.ui.processInput(Button.ACTION);
  }

  buttonStats(pressed = true): void {
    // allow access to Button.STATS as a toggle for other elements
    for (const t of globalScene.getInfoToggles(true)) {
      t.toggleInfo(pressed);
    }
    // handle normal pokemon battle ui
    for (const p of globalScene.getField().filter(p => p?.isActive(true))) {
      p.toggleStats(pressed);
    }
  }

  buttonGoToFilter(button: Button): void {
    // ER: CommandUiHandler is whitelisted so the Stats key (C) opens the in-battle
    // Battle Info screen via its processInput instead of toggling the vanilla
    // stat-stage overlay. FightUiHandler is whitelisted so the same button cycles
    // the ER move-detail panel for the highlighted move (instead of the vanilla
    // stat-arrow overlay in the fight menu).
    const whitelist = [
      StarterSelectUiHandler,
      PokedexUiHandler,
      PokedexPageUiHandler,
      CommandUiHandler,
      FightUiHandler,
      // SummaryUiHandler: the info key cycles move-detail pages on the Moves page.
      SummaryUiHandler,
    ];
    const uiHandler = globalScene.ui?.getHandler();
    if (whitelist.some(handler => uiHandler instanceof handler)) {
      globalScene.ui.processInput(button);
    } else {
      this.buttonStats(true);
    }
  }

  buttonInfo(pressed = true): void {
    if (globalScene.showMovesetFlyout) {
      for (const p of globalScene.getEnemyField().filter(p => p?.isActive(true))) {
        p.toggleFlyout(pressed);
      }
    }

    if (globalScene.showArenaFlyout) {
      globalScene.ui.processInfoButton(pressed);
    }
  }

  buttonMenu(): void {
    if (globalScene.disableMenu) {
      return;
    }
    switch (globalScene.ui?.getMode()) {
      // biome-ignore lint/suspicious/noFallthroughSwitchClause: falls through to show menu overlay
      case UiMode.MESSAGE: {
        const messageHandler = globalScene.ui.getHandler<MessageUiHandler>();
        if (!messageHandler.pendingPrompt || messageHandler.isTextAnimationInProgress()) {
          return;
        }
      }
      case UiMode.TITLE:
      case UiMode.COMMAND:
      case UiMode.MODIFIER_SELECT:
      case UiMode.MYSTERY_ENCOUNTER:
        globalScene.ui.setOverlayMode(UiMode.MENU);
        break;
      case UiMode.STARTER_SELECT:
      case UiMode.POKEDEX_PAGE:
        this.buttonTouch();
        break;
      case UiMode.SHOWDOWN_SET_EDITOR:
        // Showdown Set Editor: MENU (Escape) LEAVES the editor back to the grid. Without this the key
        // was dead here, and the user's next "get me out" press landed on the exposed StarterSelect -
        // where MENU maps to buttonTouch -> tryStart -> an empty versus battle (the softlock). Route it
        // into the editor's own MENU handler instead.
        globalScene.ui.processInput(Button.MENU);
        break;
      case UiMode.SHOWDOWN_TEAM_MENU:
        // Showdown Team Menu: MENU (Escape) routes into the handler - it closes the rename overlay when
        // one is up, otherwise backs out to the title. Without this the key hit the `default` return and
        // was dead here, so the advertised "Esc Back" did nothing AND Esc could never close the rename
        // overlay (only Backspace/X did, and that path is the "back yanks me to title" bug being fixed).
        globalScene.ui.processInput(Button.MENU);
        break;
      case UiMode.TOURNAMENT_BRACKET:
        // Tournament dropout is owned by the board so the same Menu control works on keyboard,
        // controller, and the mobile virtual pad instead of opening or swallowing the pause menu.
        globalScene.ui.processInput(Button.MENU);
        break;
      case UiMode.MENU:
        globalScene.ui.revertMode();
        globalScene.playSound("ui/select");
        break;
      default:
        return;
    }
  }

  buttonCycleOption(button: Button): void {
    const whitelist = [
      // ER (#356): the fight menu's right panel cycles STATS → DESCRIPTION →
      // DMG CALC on CYCLE_SHINY (R / RB). Without this entry the button was
      // swallowed here and never reached FightUiHandler.processInput — the
      // earlier damage-calc toggle was unreachable for the same reason.
      FightUiHandler,
      // ER (#562): the fusion-preview's R (CYCLE_SHINY) flips which mon is the base.
      // Same swallow problem - PartyUiHandler must be whitelisted to receive it.
      PartyUiHandler,
      // ER (#349): the Black Shiny GIFT row on the Pokemon summary's Abilities page
      // cycles its 3 gift choices on R (CYCLE_SHINY). Same swallow - without this the
      // gift-cycle handler in SummaryUiHandler.processInput was unreachable dead code.
      SummaryUiHandler,
      // ER Omniform (#partner-eevee): the level-up batch Move Learn panel cycles which
      // evolution's moveset it teaches on CYCLE_FORM (F / controller LB / mobile apad),
      // mirroring the summary strip. Without this whitelist the button is swallowed
      // here and never reaches LearnMoveBatchUiHandler.processInput.
      LearnMoveBatchUiHandler,
      StarterSelectUiHandler,
      // Showdown (Team Menu): the hotkey bar's R (rename) / N (delete) / E (edit) are CYCLE_SHINY /
      // CYCLE_NATURE / CYCLE_ABILITY. Without this entry buttonCycleOption swallowed them here and the
      // keys did nothing live (the handler's processInput already routes them) - the maintainer's
      // "shortcuts don't work" report. This fixes keyboard AND controller at once (pad RB/RC_W/RT map
      // to the same Button.CYCLE_*), and the mobile apad cycle buttons (CSS-shown for this mode) reach
      // it through the same dispatch.
      ShowdownTeamMenuUiHandler,
      // Showdown (Set Editor): its F / R / E / N glyph bar (CYCLE_FORM/SHINY/ABILITY/NATURE) cycles
      // stage / shiny / ability / nature - the same latent swallow. Whitelist it so the advertised
      // shortcuts work on every input method too.
      ShowdownSetEditorUiHandler,
      PokedexUiHandler,
      PokedexPageUiHandler,
      SettingsUiHandler,
      RunInfoUiHandler,
      SettingsDisplayUiHandler,
      SettingsAudioUiHandler,
      SettingsGamepadUiHandler,
      SettingsKeyboardUiHandler,
    ];
    const uiHandler = globalScene.ui?.getHandler();
    if (whitelist.some(handler => uiHandler instanceof handler)) {
      globalScene.ui.processInput(button);
    } else if (button === Button.CYCLE_TERA) {
      this.buttonInfo(true);
    }
  }

  buttonSpeedChange(up = true): void {
    const settingGameSpeed = settingIndex(SettingKeys.Game_Speed);
    const settingOptions = Setting[settingGameSpeed].options;
    let currentSetting = settingOptions.findIndex(item => item.value === globalScene.gameSpeed.toString());
    // if current setting is -1, then the current game speed is not a valid option, so default to index 1 (3x)
    if (currentSetting === -1) {
      currentSetting = 1;
    }
    // ER (#416): derive the caps from the option list instead of hardcoding
    // 2..5 so the new Hyper (7x) / Ludicrous (10x) tiers are hotkey-reachable.
    const minSpeed = Number(settingOptions[0].value);
    const maxSpeed = Number(settingOptions.at(-1)?.value);
    let direction: number;
    if (up && globalScene.gameSpeed < maxSpeed) {
      direction = 1;
    } else if (!up && globalScene.gameSpeed > minSpeed) {
      direction = -1;
    } else {
      return;
    }
    globalScene.gameData.saveSetting(
      SettingKeys.Game_Speed,
      Phaser.Math.Clamp(currentSetting + direction, 0, settingOptions.length - 1),
    );
    if (globalScene.ui?.getMode() === UiMode.SETTINGS) {
      (globalScene.ui.getHandler() as SettingsUiHandler).show([]);
    }
  }
}
