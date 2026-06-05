import type { InfoToggle } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getErMoveDetailPages, type MoveDetailPage } from "#data/elite-redux/er-move-details";
import { getTypeDamageMultiplierColor } from "#data/type";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { PokemonMove } from "#moves/pokemon-move";
import type { CommandPhase } from "#phases/command-phase";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { addTextObject, getTextColor } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { fixedInt, getLocalizedSpriteKey, padInt } from "#utils/common";
import i18next from "i18next";

export class FightUiHandler extends UiHandler implements InfoToggle {
  public static readonly MOVES_CONTAINER_NAME = "moves";

  private movesContainer: Phaser.GameObjects.Container;
  private moveInfoContainer: Phaser.GameObjects.Container;
  private typeIcon: Phaser.GameObjects.Sprite;
  private ppLabel: Phaser.GameObjects.Text;
  private ppText: Phaser.GameObjects.Text;
  private powerLabel: Phaser.GameObjects.Text;
  private powerText: Phaser.GameObjects.Text;
  private accuracyLabel: Phaser.GameObjects.Text;
  private accuracyText: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.Image | null;
  private moveCategoryIcon: Phaser.GameObjects.Sprite;
  private moveInfoOverlay: MoveInfoOverlay;

  // ER move-detail panel (cycled with the info/STATS button). -1 = closed.
  private moveDetailContainer: Phaser.GameObjects.Container;
  private moveDetailTitle: Phaser.GameObjects.Text;
  private moveDetailPageText: Phaser.GameObjects.Text;
  private moveDetailDesc: Phaser.GameObjects.Text;
  private moveDetailRowLabels: Phaser.GameObjects.Text[] = [];
  private moveDetailRowValues: Phaser.GameObjects.Text[] = [];
  private moveDetailPage = -1;
  private moveDetailPages: MoveDetailPage[] = [];
  private static readonly MOVE_DETAIL_ROWS = 4;
  private static readonly MOVE_DETAIL_PAGES = 4;

  protected fieldIndex = 0;
  protected fromCommand: Command = Command.FIGHT;
  protected cursor2 = 0;

  constructor() {
    super(UiMode.FIGHT);
  }

  /**
   * Set the visibility of the objects in the move info container.
   */
  private setInfoVis(visibility: boolean): void {
    this.moveInfoContainer.iterate((o: Phaser.GameObjects.Components.Visible) => o.setVisible(visibility));
  }

  setup() {
    const ui = this.getUi();

    this.movesContainer = globalScene.add.container(18, -38.7).setName(FightUiHandler.MOVES_CONTAINER_NAME);
    ui.add(this.movesContainer);

    this.moveInfoContainer = globalScene.add.container(1, 0).setName("move-info");
    ui.add(this.moveInfoContainer);

    this.typeIcon = globalScene.add
      .sprite(globalScene.scaledCanvas.width - 57, -36, getLocalizedSpriteKey("types"), "unknown")
      .setVisible(false);

    this.moveCategoryIcon = globalScene.add
      .sprite(globalScene.scaledCanvas.width - 25, -36, "categories", "physical")
      .setVisible(false);

    this.ppLabel = addTextObject(globalScene.scaledCanvas.width - 70, -26, "PP", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(0.0, 0.5)
      .setVisible(false)
      .setText(i18next.t("fightUiHandler:pp"));

    this.ppText = addTextObject(globalScene.scaledCanvas.width - 12, -26, "--/--", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(1, 0.5)
      .setVisible(false);

    this.powerLabel = addTextObject(globalScene.scaledCanvas.width - 70, -18, "POWER", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(0.0, 0.5)
      .setVisible(false)
      .setText(i18next.t("fightUiHandler:power"));

    this.powerText = addTextObject(globalScene.scaledCanvas.width - 12, -18, "---", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(1, 0.5)
      .setVisible(false);

    this.accuracyLabel = addTextObject(globalScene.scaledCanvas.width - 70, -10, "ACC", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(0.0, 0.5)
      .setVisible(false)
      .setText(i18next.t("fightUiHandler:accuracy"));

    this.accuracyText = addTextObject(globalScene.scaledCanvas.width - 12, -10, "---", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(1, 0.5)
      .setVisible(false);

    this.moveInfoContainer.add([
      this.typeIcon,
      this.moveCategoryIcon,
      this.ppLabel,
      this.ppText,
      this.powerLabel,
      this.powerText,
      this.accuracyLabel,
      this.accuracyText,
    ]);

    // prepare move overlay
    this.moveInfoOverlay = new MoveInfoOverlay({
      delayVisibility: true,
      onSide: true,
      right: true,
      x: 0,
      y: -MoveInfoOverlay.getHeight(true),
      width: globalScene.scaledCanvas.width + 4,
      hideEffectBox: true,
      hideBg: true,
    });
    ui.add(this.moveInfoOverlay);
    // register the overlay to receive toggle events
    globalScene.addInfoToggle(this.moveInfoOverlay, this);

    this.setupMoveDetailPanel();
  }

  /**
   * ER move-detail panel: an elaborate, cyclable info box for the highlighted
   * move (mirrors the ER ROM's move-select detail pages). Built once here; the
   * info/STATS button cycles its pages (see {@linkcode cycleMoveDetail}). It
   * reuses the move grid's footprint — the grid hides while it is open — so it
   * never overlaps and works regardless of the move count (incl. the 5th slot).
   */
  private setupMoveDetailPanel(): void {
    const ui = this.getUi();
    const W = 158;
    const H = 46;
    const X = 4;
    const Y = -H - 2; // anchor to the bottom of the moves window
    this.moveDetailContainer = globalScene.add.container(0, 0).setName("er-move-detail").setVisible(false);

    const bg = addWindow(X, Y, W, H);
    bg.setOrigin(0, 0);
    this.moveDetailContainer.add(bg);

    this.moveDetailTitle = addTextObject(X + 6, Y + 3, "", TextStyle.WINDOW, { fontSize: "72px" }).setOrigin(0, 0);
    this.moveDetailPageText = addTextObject(X + W - 6, Y + 4, "", TextStyle.MOVE_INFO_CONTENT, {
      fontSize: "48px",
    }).setOrigin(1, 0);
    this.moveDetailContainer.add([this.moveDetailTitle, this.moveDetailPageText]);

    // Page 1 (description) uses a single wrapped text object.
    this.moveDetailDesc = addTextObject(X + 6, Y + 15, "", TextStyle.MOVE_INFO_CONTENT, {
      fontSize: "48px",
      wordWrap: { width: (W - 12) * 6 },
    }).setOrigin(0, 0);
    this.moveDetailContainer.add(this.moveDetailDesc);

    // Pages 2-4 use up to 4 label/value rows.
    for (let i = 0; i < FightUiHandler.MOVE_DETAIL_ROWS; i++) {
      const rowY = Y + 15 + i * 8;
      const label = addTextObject(X + 8, rowY, "", TextStyle.MOVE_INFO_CONTENT, { fontSize: "48px" }).setOrigin(0, 0);
      const value = addTextObject(X + W - 8, rowY, "", TextStyle.WINDOW, { fontSize: "48px" }).setOrigin(1, 0);
      this.moveDetailRowLabels.push(label);
      this.moveDetailRowValues.push(value);
      this.moveDetailContainer.add([label, value]);
    }

    ui.add(this.moveDetailContainer);
  }

  override show(args: [number?, Command?]): boolean {
    super.show(args);

    this.fieldIndex = args[0] ?? 0;
    this.fromCommand = args[1] ?? Command.FIGHT;

    const messageHandler = this.getUi().getMessageHandler();
    messageHandler.bg.setVisible(false);
    messageHandler.commandWindow.setVisible(false);
    messageHandler.movesWindowContainer.setVisible(true);
    const pokemon = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
    if (pokemon.tempSummonData.turnCount <= 1) {
      this.setCursor(0);
    } else {
      this.setCursor(this.fieldIndex ? this.cursor2 : this.cursor);
    }
    this.displayMoves();
    this.moveDetailPage = -1; // start with the detail panel closed
    this.moveDetailContainer?.setVisible(false);
    this.toggleInfo(false); // in case cancel was pressed while info toggle is active
    this.active = true;
    return true;
  }

  /**
   * Process the player inputting the selected {@linkcode Button}.
   * @param button - The {@linkcode Button} being pressed
   * @returns Whether the input was successful (ie did anything).
   */
  processInput(button: Button): boolean {
    const ui = this.getUi();
    let success = false;
    const cursor = this.getCursor();

    switch (button) {
      // ER: the info/STATS button cycles the move-detail panel for the
      // highlighted move (replaces the vanilla stat-arrow overlay in the fight
      // menu — routed here via the buttonGoToFilter whitelist).
      case Button.STATS:
        return this.cycleMoveDetail();
      case Button.ACTION:
        if (
          (globalScene.phaseManager.getCurrentPhase() as CommandPhase).handleCommand(
            this.fromCommand,
            cursor,
            MoveUseMode.NORMAL,
          )
        ) {
          success = true;
        } else {
          ui.playError();
        }
        break;
      case Button.CANCEL: {
        // While the detail panel is open, Cancel just closes it (back to the grid).
        if (this.isMoveDetailOpen()) {
          this.closeMoveDetail();
          success = true;
          break;
        }
        // Cannot back out of fight menu if skipToFightInput is enabled
        const { battleType, mysteryEncounter } = globalScene.currentBattle;
        if (battleType !== BattleType.MYSTERY_ENCOUNTER || !mysteryEncounter?.skipToFightInput) {
          ui.setMode(UiMode.COMMAND, this.fieldIndex);
          success = true;
        }
        break;
      }
      case Button.UP:
        if (cursor >= 2) {
          success = this.setCursor(cursor - 2);
        }
        break;
      case Button.DOWN:
        // Allow descending into a third row only if a cell exists there (e.g.
        // a 5th move slot granted by ER's consumable).
        if (cursor + 2 < this.getMoveCellCount()) {
          success = this.setCursor(cursor + 2);
        }
        break;
      case Button.LEFT:
        if (cursor % 2 === 1) {
          success = this.setCursor(cursor - 1);
        }
        break;
      case Button.RIGHT:
        if (cursor % 2 === 0 && cursor + 1 < this.getMoveCellCount()) {
          success = this.setCursor(cursor + 1);
        }
        break;
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  /**
   * Adjust the visibility of move names and the cursor icon when the info overlay is toggled
   * @param visible - The visibility of the info overlay; the move names and cursor's visibility will be set to the opposite
   */
  toggleInfo(visible: boolean): void {
    // While the ER detail panel is open it owns the move-grid visibility — don't
    // let the STATS-release info toggle restore the grid behind the open panel.
    if (this.isMoveDetailOpen()) {
      return;
    }
    // The info overlay will already fade in, so we should hide the move name text and cursor immediately
    // rather than adjusting alpha via a tween.
    if (visible) {
      this.movesContainer.setVisible(false).setAlpha(0);
      this.cursorObj?.setVisible(false).setAlpha(0);
      return;
    }
    globalScene.tweens.add({
      targets: [this.movesContainer, this.cursorObj],
      duration: fixedInt(125),
      ease: "Sine.easeInOut",
      alpha: 1,
    });
    this.movesContainer.setVisible(true);
    this.cursorObj?.setVisible(true);
  }

  isActive(): boolean {
    return this.active;
  }

  getCursor(): number {
    return this.fieldIndex ? this.cursor2 : this.cursor;
  }

  /**
   * Number of move cells in the fight grid for the acting Pokémon (normally 4,
   * 5 if granted an extra slot by ER's "5th move slot" consumable). Used to
   * bound cursor navigation. Falls back to 4 if the phase/pokemon is unavailable.
   */
  private getMoveCellCount(): number {
    const phase = globalScene.phaseManager.getCurrentPhase();
    if (phase?.is("CommandPhase")) {
      return phase.getPokemon().getMaxMoveCount();
    }
    return 4;
  }

  /**
   * Row spacing and vertical shift for the move grid. With the normal 4 moves
   * (2×2) this returns the exact vanilla values. With a 5th slot (ER consumable)
   * a third row is needed, so the rows are compressed and nudged up to stay
   * within the move window. Keyed off {@linkcode getMoveCellCount}.
   */
  private getMoveGridMetrics(): { rowSpacing: number; yShift: number } {
    return this.getMoveCellCount() > 4 ? { rowSpacing: 12, yShift: -8 } : { rowSpacing: 16, yShift: 0 };
  }

  /** @returns TextStyle according to percentage of PP remaining */
  private static ppRatioToColor(ppRatio: number): TextStyle {
    if (ppRatio > 0.25 && ppRatio <= 0.5) {
      return TextStyle.MOVE_PP_HALF_FULL;
    }
    if (ppRatio > 0 && ppRatio <= 0.25) {
      return TextStyle.MOVE_PP_NEAR_EMPTY;
    }
    if (ppRatio === 0) {
      return TextStyle.MOVE_PP_EMPTY;
    }
    return TextStyle.MOVE_PP_FULL; // default to full if ppRatio is invalid
  }

  /**
   * Populate the move info overlay with the information of the move at the given cursor index
   * @param cursor - The cursor position to set the move info for
   */
  private setMoveInfo(cursor: number): void {
    const pokemon = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
    const moveset = pokemon.getMoveset();

    const hasMove = cursor < moveset.length;
    this.setInfoVis(hasMove);

    if (!hasMove) {
      return;
    }

    const pokemonMove = moveset[cursor];
    const moveType = pokemon.getMoveType(pokemonMove.getMove());
    const textureKey = getLocalizedSpriteKey("types");
    this.typeIcon.setTexture(textureKey, PokemonType[moveType].toLowerCase()).setScale(0.8);

    const moveCategory = pokemonMove.getMove().category;
    this.moveCategoryIcon.setTexture("categories", MoveCategory[moveCategory].toLowerCase()).setScale(1.0);
    const power = pokemonMove.getMove().power;
    const accuracy = pokemonMove.getMove().accuracy;
    const maxPP = pokemonMove.getMovePp();
    const pp = maxPP - pokemonMove.ppUsed;

    const ppLeftStr = padInt(pp, 2, "  ");
    const ppMaxStr = padInt(maxPP, 2, "  ");
    this.ppText.setText(`${ppLeftStr}/${ppMaxStr}`);
    this.powerText.setText(`${power >= 0 ? power : "---"}`);
    this.accuracyText.setText(`${accuracy >= 0 ? accuracy : "---"}`);

    const ppColorStyle = FightUiHandler.ppRatioToColor(pp / maxPP);

    // Changes the text color and shadow according to the determined TextStyle
    this.ppText.setColor(getTextColor(ppColorStyle, false)).setShadowColor(getTextColor(ppColorStyle, true));
    this.moveInfoOverlay.show(pokemonMove.getMove());

    pokemon.getOpponents().forEach(opponent => {
      (opponent as EnemyPokemon).updateEffectiveness(this.getEffectivenessText(pokemon, opponent, pokemonMove));
    });

    // Keep the ER detail panel in sync while navigating moves with it open.
    if (this.moveDetailPage >= 0) {
      this.renderMoveDetail();
    }
  }

  /** True while the ER move-detail panel is open (drives input + grid visibility). */
  isMoveDetailOpen(): boolean {
    return this.moveDetailPage >= 0;
  }

  /**
   * Advance the move-detail panel one page on each info/STATS press:
   * closed → page 1 → 2 → 3 → 4 → closed. Always returns `true` (handled).
   */
  private cycleMoveDetail(): boolean {
    if (this.moveDetailPage < 0) {
      // Opening: hide the move grid behind the panel.
      this.moveDetailPage = 0;
      this.movesContainer.setVisible(false);
      this.cursorObj?.setVisible(false);
      this.moveInfoOverlay.clear();
      this.moveDetailContainer.setVisible(true);
    } else if (this.moveDetailPage >= FightUiHandler.MOVE_DETAIL_PAGES - 1) {
      this.closeMoveDetail();
      return true;
    } else {
      this.moveDetailPage++;
    }
    this.renderMoveDetail();
    return true;
  }

  /** Close the detail panel and restore the move grid. */
  private closeMoveDetail(): void {
    this.moveDetailPage = -1;
    this.moveDetailContainer.setVisible(false);
    this.movesContainer.setVisible(true).setAlpha(1);
    this.cursorObj?.setVisible(true).setAlpha(1);
  }

  /**
   * Render the current detail page for the highlighted move. Page 0 shows the
   * description text; pages 1-3 show label/value rows. Pure read of the move's
   * wired flags/attrs via {@linkcode getErMoveDetailPages}.
   */
  private renderMoveDetail(): void {
    const phase = globalScene.phaseManager.getCurrentPhase();
    if (!phase?.is("CommandPhase")) {
      return;
    }
    const moveset = phase.getPokemon().getMoveset();
    const pokemonMove = moveset[this.getCursor()];
    if (!pokemonMove) {
      this.closeMoveDetail();
      return;
    }
    const move = pokemonMove.getMove();
    this.moveDetailPages = getErMoveDetailPages(move);
    const pageIndex = Math.min(this.moveDetailPage, this.moveDetailPages.length - 1);
    const page = this.moveDetailPages[pageIndex];

    this.moveDetailTitle.setText(move.name);
    this.moveDetailPageText.setText(`${pageIndex + 1}/${this.moveDetailPages.length}`);

    const isDesc = page.description !== undefined;
    this.moveDetailDesc.setText(isDesc ? (page.description ?? "") : "").setVisible(isDesc);
    const rows = page.rows ?? [];
    for (let i = 0; i < FightUiHandler.MOVE_DETAIL_ROWS; i++) {
      const row = rows[i];
      const visible = !isDesc && row !== undefined;
      this.moveDetailRowLabels[i].setText(row?.label ?? "").setVisible(visible);
      this.moveDetailRowValues[i].setText(row?.value ?? "").setVisible(visible);
    }
  }

  setCursor(cursor: number): boolean {
    const ui = this.getUi();

    this.moveInfoOverlay.clear();
    const changed = this.getCursor() !== cursor;
    if (changed) {
      if (this.fieldIndex) {
        this.cursor2 = cursor;
      } else {
        this.cursor = cursor;
      }
    }

    this.setMoveInfo(cursor);

    if (!this.cursorObj) {
      const isTera = this.fromCommand === Command.TERA;
      this.cursorObj = globalScene.add.image(0, 0, isTera ? "cursor_tera" : "cursor");
      this.cursorObj.setScale(isTera ? 0.7 : 1);
      ui.add(this.cursorObj);
    }

    const { rowSpacing, yShift } = this.getMoveGridMetrics();
    this.cursorObj.setPosition(
      13 + (cursor % 2 === 1 ? 114 : 0),
      -31 + yShift + Math.floor(cursor / 2) * (rowSpacing - 1),
    );

    return changed;
  }

  /**
   * Gets multiplier text for a pokemon's move against a specific opponent
   */
  private getEffectivenessText(pokemon: Pokemon, opponent: Pokemon, pokemonMove: PokemonMove): string | undefined {
    const effectiveness = opponent.getMoveEffectiveness(
      pokemon,
      pokemonMove.getMove(),
      !opponent.waveData.abilityRevealed,
      undefined,
      undefined,
      true,
    );
    if (pokemonMove.getMove().category === MoveCategory.STATUS) {
      if (effectiveness === 0) {
        return "0x";
      }
      return "1x";
    }

    return `${effectiveness}x`;
  }

  displayMoves() {
    const pokemon = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
    const moveset = pokemon.getMoveset();

    // Number of move cells to render: 4 normally, more if this Pokémon has been
    // granted extra slots by ER's "5th move slot" consumable. Laid out 2-per-row
    // so a 5th move starts a third row.
    const cellCount = pokemon.getMaxMoveCount();
    const { rowSpacing, yShift } = this.getMoveGridMetrics();
    for (let moveIndex = 0; moveIndex < cellCount; moveIndex++) {
      const moveText = addTextObject(
        moveIndex % 2 === 0 ? 0 : 114,
        yShift + Math.floor(moveIndex / 2) * rowSpacing,
        "-",
        TextStyle.WINDOW,
      ).setName("text-empty-move");

      if (moveIndex < moveset.length) {
        const pokemonMove = moveset[moveIndex]!; // TODO is the bang correct?
        moveText
          .setText(pokemonMove.getName())
          .setName(pokemonMove.getName())
          .setColor(this.getMoveColor(pokemon, pokemonMove) ?? moveText.style.color);
      }

      this.movesContainer.add(moveText);
    }
  }

  /**
   * Returns a specific move's color based on its type effectiveness against opponents
   * If there are multiple opponents, the highest effectiveness' color is returned
   * @returns A color or undefined if the default color should be used
   */
  private getMoveColor(pokemon: Pokemon, pokemonMove: PokemonMove): string | undefined {
    if (!globalScene.typeHints) {
      return;
    }

    const opponents = pokemon.getOpponents();
    if (opponents.length <= 0) {
      return;
    }

    const moveColors = opponents
      .map(opponent =>
        opponent.getMoveEffectiveness(
          pokemon,
          pokemonMove.getMove(),
          !opponent.waveData.abilityRevealed,
          undefined,
          undefined,
          true,
        ),
      )
      .sort((a, b) => b - a)
      .map(effectiveness => {
        if (pokemonMove.getMove().category === MoveCategory.STATUS && effectiveness !== 0) {
          return;
        }
        return getTypeDamageMultiplierColor(effectiveness ?? 0, "offense");
      });

    return moveColors[0];
  }

  clear() {
    super.clear();
    const messageHandler = this.getUi().getMessageHandler();
    this.clearMoves();
    this.setInfoVis(false);
    this.moveInfoOverlay.clear();
    this.moveDetailPage = -1;
    this.moveDetailContainer?.setVisible(false);
    messageHandler.bg.setVisible(true);
    this.eraseCursor();
    this.active = false;
  }

  clearMoves() {
    this.movesContainer.removeAll(true);

    const opponents = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon().getOpponents();
    opponents.forEach(opponent => {
      (opponent as EnemyPokemon).updateEffectiveness();
    });
  }

  eraseCursor() {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
