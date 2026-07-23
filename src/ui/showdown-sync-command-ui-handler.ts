/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import type { SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { SHOWDOWN_TURN_TIMER_MS } from "#data/elite-redux/showdown/showdown-command-relay";
import {
  buildShowdownFightCommand,
  buildShowdownSwitchCommand,
} from "#data/elite-redux/showdown/showdown-guest-command";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

type ShowdownSyncMenuLevel = "root" | "fight" | "switch";

export interface ShowdownSyncCommandArgs {
  turn: number;
  fieldIndex?: number;
  initialLevel?: ShowdownSyncMenuLevel;
  onCommand: (turn: number, command: SerializedCommand) => void;
}

interface MenuRow {
  label: string;
  enabled: boolean;
  index: number;
}

/**
 * Command surface for the Sync guest's own team. Both Sync engines retain the host-oriented world,
 * so the guest's team is intentionally the canonical enemy side instead of a locally swapped player
 * side. This handler only selects and serializes intent; battle phases validate and simulate it.
 */
export class ShowdownSyncCommandUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private titleText: Phaser.GameObjects.Text;
  private clockText: Phaser.GameObjects.Text;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Image | null = null;
  private level: ShowdownSyncMenuLevel = "root";
  private initialLevel: ShowdownSyncMenuLevel = "root";
  private rows: MenuRow[] = [];
  private turn = 0;
  private fieldIndex = 0;
  private onCommand: ShowdownSyncCommandArgs["onCommand"] = () => {};
  private shipped = false;
  private secondsLeft = 0;
  private clockEvent: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(UiMode.SHOWDOWN_SYNC_COMMAND);
  }

  setup(): void {
    const ui = this.getUi();
    this.container = globalScene.add.container(0, 0).setName("showdown-sync-command");
    this.container.setVisible(false);
    ui.add(this.container);

    const window = addWindow(0, 0, 132, 116);
    window.setOrigin(0, 0);
    this.container.add(window);

    this.titleText = addTextObject(8, 4, "", TextStyle.WINDOW);
    this.container.add(this.titleText);
    this.clockText = addTextObject(124, 4, "", TextStyle.WINDOW);
    this.clockText.setOrigin(1, 0);
    this.container.add(this.clockText);
  }

  override show(args: any[]): boolean {
    super.show(args);
    const params = (args?.[0] ?? {}) as Partial<ShowdownSyncCommandArgs>;
    this.turn = params.turn ?? globalScene.currentBattle?.turn ?? 0;
    this.fieldIndex = params.fieldIndex ?? 0;
    this.initialLevel = params.initialLevel ?? "root";
    this.level = this.initialLevel;
    this.onCommand = params.onCommand ?? (() => {});
    this.shipped = false;
    this.container.setVisible(true);
    this.startTurnClock();
    this.render();
    return true;
  }

  private getActive(): EnemyPokemon | undefined {
    return globalScene.getEnemyField()[this.fieldIndex];
  }

  private startTurnClock(): void {
    this.stopTurnClock();
    this.secondsLeft = Math.round(SHOWDOWN_TURN_TIMER_MS / 1000);
    this.updateClockText();
    this.clockEvent =
      globalScene.time?.addEvent?.({
        delay: 1000,
        loop: true,
        callback: () => this.tickTurnClock(),
      }) ?? null;
  }

  private tickTurnClock(): void {
    this.secondsLeft = Math.max(0, this.secondsLeft - 1);
    this.updateClockText();
    if (this.secondsLeft !== 0 || this.shipped) {
      return;
    }
    this.stopTurnClock();
    if (this.level === "switch" || this.initialLevel === "switch") {
      const replacement = this.rows.find(row => row.enabled);
      if (replacement != null) {
        this.ship(buildShowdownSwitchCommand(replacement.index));
      }
      return;
    }
    const moves = this.getActive()?.getMoveset() ?? [];
    const slot = moves.findIndex(candidate => !candidate.isOutOfPp());
    const move = moves[slot];
    if (move != null && slot >= 0) {
      this.ship(buildShowdownFightCommand(slot, move.moveId));
    }
  }

  private updateClockText(): void {
    this.clockText.setText(`${this.secondsLeft}s`);
    this.clockText.setColor(this.secondsLeft <= 10 ? "#f84040" : "#f8f8f8");
  }

  private stopTurnClock(): void {
    this.clockEvent?.remove();
    this.clockEvent = null;
  }

  private render(): void {
    this.rows = this.buildRows();
    for (const text of this.rowTexts) {
      text.destroy();
    }
    this.rowTexts = [];

    const name = this.getActive()?.getNameToRender({ prependFormName: false }) ?? "";
    this.titleText.setText(
      this.level === "fight"
        ? i18next.t("commandUiHandler:fight")
        : this.level === "switch"
          ? i18next.t("commandUiHandler:pokemon")
          : i18next.t("commandUiHandler:actionMessage", { pokemonName: name, defaultValue: name }),
    );

    this.rows.forEach((row, index) => {
      const text = addTextObject(16, 20 + index * 14, row.label, row.enabled ? TextStyle.WINDOW : TextStyle.PARTY);
      if (!row.enabled) {
        text.setAlpha(0.5);
      }
      this.container.add(text);
      this.rowTexts.push(text);
    });
    const firstEnabled = this.rows.findIndex(row => row.enabled);
    this.setCursor(firstEnabled >= 0 ? firstEnabled : 0);
  }

  private buildRows(): MenuRow[] {
    if (this.level === "fight") {
      return (this.getActive()?.getMoveset() ?? []).map((move, index) => {
        const maxPp = move.getMovePp();
        return {
          label: `${move.getName()}  ${maxPp - move.ppUsed}/${maxPp}`,
          enabled: !move.isOutOfPp(),
          index,
        };
      });
    }
    if (this.level === "switch") {
      return globalScene.getEnemyParty().map((pokemon, index) => ({
        label: pokemon.getNameToRender({ prependFormName: false }),
        enabled: !pokemon.isFainted() && !pokemon.isOnField(),
        index,
      }));
    }
    return [
      { label: i18next.t("commandUiHandler:fight"), enabled: true, index: 0 },
      { label: i18next.t("commandUiHandler:pokemon"), enabled: true, index: 1 },
    ];
  }

  processInput(button: Button): boolean {
    let success = false;
    switch (button) {
      case Button.UP:
        success = this.moveCursor(-1);
        break;
      case Button.DOWN:
        success = this.moveCursor(1);
        break;
      case Button.ACTION:
        success = this.confirm(this.getCursor());
        break;
      case Button.CANCEL:
        if (this.level !== this.initialLevel) {
          this.level = this.initialLevel;
          this.render();
          success = true;
        }
        break;
    }
    if (success) {
      this.getUi().playSelect();
    }
    return success;
  }

  private moveCursor(direction: number): boolean {
    if (this.rows.length === 0) {
      return false;
    }
    let next = this.getCursor();
    let remaining = this.rows.length;
    while (remaining-- > 0) {
      next = (next + direction + this.rows.length) % this.rows.length;
      if (this.rows[next]?.enabled) {
        return this.setCursor(next);
      }
    }
    return false;
  }

  private confirm(cursor: number): boolean {
    if (this.shipped) {
      return false;
    }
    const row = this.rows[cursor];
    if (row == null || !row.enabled) {
      this.getUi().playError();
      return false;
    }
    if (this.level === "root") {
      this.level = row.index === 0 ? "fight" : "switch";
      this.render();
      return true;
    }
    if (this.level === "fight") {
      const move = this.getActive()?.getMoveset()[row.index];
      if (move == null) {
        return false;
      }
      this.ship(buildShowdownFightCommand(row.index, move.moveId));
      return true;
    }
    this.ship(buildShowdownSwitchCommand(row.index));
    return true;
  }

  private ship(command: SerializedCommand): void {
    if (this.shipped) {
      return;
    }
    this.shipped = true;
    this.stopTurnClock();
    const turn = this.turn;
    const onCommand = this.onCommand;
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      i18next.t("battle:showdownOpponentChoosing", { defaultValue: "Move locked in! Opponent is choosing..." }),
      null,
      () => {},
      null,
      true,
    );
    onCommand(turn, command);
  }

  setCursor(cursor: number): boolean {
    const changed = this.cursor !== cursor;
    this.cursor = cursor;
    if (this.cursorObj == null) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.container.add(this.cursorObj);
    }
    this.cursorObj.setPosition(8, 26 + cursor * 14);
    this.cursorObj.setVisible(this.rows.length > 0);
    return changed;
  }

  clear(): void {
    super.clear();
    this.stopTurnClock();
    this.container.setVisible(false);
    for (const text of this.rowTexts) {
      text.destroy();
    }
    this.rowTexts = [];
    this.cursorObj?.destroy();
    this.cursorObj = null;
    this.level = "root";
    this.initialLevel = "root";
    this.onCommand = () => {};
  }
}
