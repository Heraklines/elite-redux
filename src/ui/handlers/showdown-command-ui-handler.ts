/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 GUEST command menu (C5) - PRESENTATION ONLY.
//
// The versus GUEST is a pure renderer of the host's authoritative world; its OWN team is the
// authoritative ENEMY side (host-ordered), so this menu reads the ENEMY field/party verbatim -
// NO perspective flip is needed here (the flip is a RENDER-only side swap; the DATA the guest
// commands is authoritatively the enemy side, which IS the guest's own team). It shows FIGHT
// (the active mon's moves + PP) and SWITCH (the benched party), and on confirm SHIPS the pick via
// the caller's `onCommand` (typically `ShowdownCommandRelay.sendCommand`). It NEVER executes a
// turn locally and computes NO legality - the HOST validates authoritatively (illegal -> AI
// fallback, already proven). A dedicated handler (not the player-field-bound CommandUiHandler /
// FightUiHandler) so it can read the ENEMY side without dragging the player-side engine coupling
// (getOpponents / effectiveness previews / tera) those handlers carry.
// =============================================================================

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

/** The two menu levels: pick the action, then the concrete move / bench slot. */
type ShowdownMenuLevel = "root" | "fight" | "switch";

/** Args passed to {@linkcode ShowdownCommandUiHandler.show}. */
export interface ShowdownCommandArgs {
  /** The turn this command is for (relay keying). */
  turn: number;
  /**
   * Ship the chosen command. Wired to `ShowdownCommandRelay.sendCommand` by the caller (the
   * versus-guest CommandPhase branch). Called exactly once per confirmed pick.
   */
  onCommand: (turn: number, command: SerializedCommand) => void;
}

/** A rendered row (an option the cursor can land on). */
interface MenuRow {
  label: string;
  /** Whether the row is selectable (a fainted / empty bench slot is shown greyed and skipped). */
  enabled: boolean;
  /** Move slot (fight level) or party index (switch level); unused at root. */
  index: number;
}

export class ShowdownCommandUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private window: Phaser.GameObjects.NineSlice;
  private titleText: Phaser.GameObjects.Text;
  /** D4: the LOCAL turn-clock countdown (top-right of the window). */
  private clockText: Phaser.GameObjects.Text;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Image | null = null;

  private level: ShowdownMenuLevel = "root";
  private rows: MenuRow[] = [];
  private turn = 0;
  private onCommand: ShowdownCommandArgs["onCommand"] = () => {};
  /** Set once a command is shipped for THIS open; blocks a re-entrant confirm from double-shipping/ending. */
  private shipped = false;
  /** D4 turn clock: seconds left + the repeating timer, or null when not running. */
  private secondsLeft = 0;
  private clockEvent: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(UiMode.SHOWDOWN_COMMAND);
  }

  setup(): void {
    const ui = this.getUi();
    this.container = globalScene.add.container(0, 0).setName("showdown-command");
    this.container.setVisible(false);
    ui.add(this.container);

    this.window = addWindow(0, 0, 120, 80);
    this.window.setOrigin(0, 0);
    this.container.add(this.window);

    this.titleText = addTextObject(8, 4, "", TextStyle.WINDOW);
    this.container.add(this.titleText);

    // D4 turn clock: a compact top-right countdown.
    this.clockText = addTextObject(112, 4, "", TextStyle.WINDOW);
    this.clockText.setOrigin(1, 0);
    this.container.add(this.clockText);
  }

  override show(args: any[]): boolean {
    super.show(args);
    const params = (args?.[0] ?? {}) as Partial<ShowdownCommandArgs>;
    this.turn = params.turn ?? globalScene.currentBattle?.turn ?? 0;
    this.onCommand = params.onCommand ?? (() => {});
    this.level = "root";
    this.shipped = false;
    this.container.setVisible(true);
    this.startTurnClock();
    this.render();
    return true;
  }

  /**
   * D4 turn clock: a LOCAL 60s countdown started when the menu opens. CAVEAT (documented): this is the
   * GUEST'S OWN clock, NOT synced to the host's authoritative relay timer (SHOWDOWN_TURN_TIMER_MS) - so
   * transport latency + the moment the two menus opened can skew it by up to a round-trip. It is a UX
   * hint, not the source of truth: if it runs out, the guest auto-ships its lead move to unblock its
   * CommandPhase, and the host's own timer (which IS authoritative) AI-falls-back independently.
   */
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
    if (this.secondsLeft <= 0) {
      this.stopTurnClock();
      this.autoShipOnTimeout();
    }
  }

  private updateClockText(): void {
    this.clockText.setText(`${this.secondsLeft}s`);
    // Warn red under 10s.
    this.clockText.setColor(this.secondsLeft <= 10 ? "#f84040" : "#f8f8f8");
  }

  private stopTurnClock(): void {
    this.clockEvent?.remove();
    this.clockEvent = null;
  }

  /** Local clock expired: ship the active mon's lead move so this CommandPhase unblocks (host is authoritative). */
  private autoShipOnTimeout(): void {
    if (this.shipped) {
      return;
    }
    const move = this.getActive()?.getMoveset()[0];
    if (move != null) {
      this.ship(buildShowdownFightCommand(0, move.moveId));
    }
  }

  /** The guest's active mon: authoritatively the ENEMY lead (its own team's fielded mon). */
  private getActive(): EnemyPokemon | undefined {
    return globalScene.getEnemyField()[0];
  }

  /** Rebuild {@linkcode rows} for the current level and (re)draw them + the title + cursor. */
  private render(): void {
    this.rows = this.buildRows();
    for (const t of this.rowTexts) {
      t.destroy();
    }
    this.rowTexts = [];

    const active = this.getActive();
    const name = active?.getNameToRender({ prependFormName: false }) ?? "";
    this.titleText.setText(this.titleFor(name));

    this.rows.forEach((row, i) => {
      const text = addTextObject(16, 20 + i * 14, row.label, row.enabled ? TextStyle.WINDOW : TextStyle.PARTY);
      if (!row.enabled) {
        text.setAlpha(0.5);
      }
      this.container.add(text);
      this.rowTexts.push(text);
    });

    // Land the cursor on the first ENABLED row.
    const firstEnabled = this.rows.findIndex(r => r.enabled);
    this.setCursor(firstEnabled >= 0 ? firstEnabled : 0);
  }

  private titleFor(name: string): string {
    switch (this.level) {
      case "fight":
        return i18next.t("commandUiHandler:fight");
      case "switch":
        return i18next.t("commandUiHandler:pokemon");
      default:
        return i18next.t("commandUiHandler:actionMessage", { pokemonName: name, defaultValue: name });
    }
  }

  /** The selectable rows for the current level, read from the authoritative ENEMY side. */
  private buildRows(): MenuRow[] {
    if (this.level === "fight") {
      const moveset = this.getActive()?.getMoveset() ?? [];
      return moveset.map((m, i) => {
        const maxPp = m.getMovePp();
        const pp = maxPp - m.ppUsed;
        return {
          label: `${m.getName()}  ${pp}/${maxPp}`,
          // Out-of-PP moves are shown greyed but not selectable: the host authoritatively rejects a
          // relayed FIGHT on a no-PP move (isRelayedCommandLegal) and AI-falls-back, so offering it here
          // would just waste the pick - the display matches the host's validation.
          enabled: pp > 0,
          index: i,
        };
      });
    }
    if (this.level === "switch") {
      const party = globalScene.getEnemyParty();
      return party.map((p, i) => ({
        label: p.getNameToRender({ prependFormName: false }),
        // Only a benched, non-fainted mon is a legal switch target (host re-validates).
        enabled: i > 0 && !p.isFainted() && !p.isOnField(),
        index: i,
      }));
    }
    return [
      { label: i18next.t("commandUiHandler:fight"), enabled: true, index: 0 },
      { label: i18next.t("commandUiHandler:pokemon"), enabled: true, index: 1 },
    ];
  }

  processInput(button: Button): boolean {
    let success = false;
    const cursor = this.getCursor();

    switch (button) {
      case Button.UP:
        success = this.moveCursor(-1);
        break;
      case Button.DOWN:
        success = this.moveCursor(1);
        break;
      case Button.ACTION:
        success = this.confirm(cursor);
        break;
      case Button.CANCEL:
        if (this.level !== "root") {
          this.level = "root";
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

  /** Step the cursor by `dir`, skipping disabled rows; returns whether it moved. */
  private moveCursor(dir: number): boolean {
    const n = this.rows.length;
    if (n === 0) {
      return false;
    }
    let next = this.getCursor();
    for (let step = 0; step < n; step++) {
      next = (next + dir + n) % n;
      if (this.rows[next]?.enabled) {
        return this.setCursor(next);
      }
    }
    return false;
  }

  /** Confirm the highlighted row: descend a level, or ship the built command. */
  private confirm(cursor: number): boolean {
    if (this.shipped) {
      return false; // already shipped this turn - ignore a re-entrant confirm
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
        this.getUi().playError();
        return false;
      }
      this.ship(buildShowdownFightCommand(row.index, move.moveId));
      return true;
    }
    // switch
    this.ship(buildShowdownSwitchCommand(row.index));
    return true;
  }

  private ship(command: SerializedCommand): void {
    if (this.shipped) {
      return; // defensive: never double-ship / double-end
    }
    this.shipped = true;
    this.stopTurnClock();
    // Capture before setMode(MESSAGE) - closing this menu runs clear(), which resets onCommand.
    const turn = this.turn;
    const onCommand = this.onCommand;
    // Guest UX floor (#8): show a waiting notice while the host resolves the turn (mirrors co-op's
    // "partner is choosing" MESSAGE) instead of leaving the screen blank; setMode(MESSAGE) also closes
    // this menu. Raw-key fallback text is acceptable for now.
    // TODO(i18n): add a dedicated `battle:showdownWaitingForOpponent` locale key.
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      i18next.t("battle:showdownWaitingForOpponent", { defaultValue: "Waiting for opponent..." }),
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
    if (!this.cursorObj) {
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
    for (const t of this.rowTexts) {
      t.destroy();
    }
    this.rowTexts = [];
    if (this.cursorObj) {
      this.cursorObj.destroy();
      this.cursorObj = null;
    }
    this.level = "root";
    this.onCommand = () => {};
  }
}
