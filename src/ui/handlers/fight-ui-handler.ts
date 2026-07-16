import type { InfoToggle } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { hasLibrary } from "#data/elite-redux/abilities/library";
import { getErDamagePreview } from "#data/elite-redux/er-damage-preview";
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
import { DamageCalculatorModifier } from "#modifiers/modifier";
import type { PokemonMove } from "#moves/pokemon-move";
import type { CommandPhase } from "#phases/command-phase";
import { BattleInfoOverlay } from "#ui/battle-info-overlay";
import { LibraryPanel } from "#ui/library-panel";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { addTextObject, getTextColor } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { fixedInt, getLocalizedSpriteKey, padInt } from "#utils/common";
import i18next from "i18next";

/**
 * TEMP (testing): when true, the Damage Calc panel is force-unlocked so it can
 * be tried without finding a Damage Calculator. Set back to `false` to restore
 * the normal item lock (the panel is locked by default).
 */
const ER_DAMAGE_CALC_FORCE_UNLOCK = true;

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

  // ER: the right panel can be cycled (R / RB) between the normal move stats and
  // a "Damage Calc" view, which is locked until a Damage Calculator is held.
  /**
   * ER right-panel page (#356): 0 = move stats, 1 = move DESCRIPTION,
   * 2 = Damage Calc. Cycled with R / RB (and the on-screen R on mobile).
   */
  private panelMode: 0 | 1 | 2 = 0;
  private dmgCalcHeader: Phaser.GameObjects.Text;
  private dmgCalcBody: Phaser.GameObjects.Text;
  private panelCycleHint: Phaser.GameObjects.Text;
  private moveInfoOverlay: MoveInfoOverlay;

  /** ER: the in-battle "Pokémon Stats" info overlay, also openable from move select (info/STATS key). */
  private battleInfo = new BattleInfoOverlay();

  /** ER Library (5928): the recorded-move CAST panel, opened from the fight menu. */
  public readonly library = new LibraryPanel();

  protected fieldIndex = 0;
  protected fromCommand: Command = Command.FIGHT;
  /** Remembered cursor per NON-lead field slot (index 1..2; a triple has two - a single shared `cursor2` made slots 2 and 3 clobber each other's memory). Slot 0 keeps the base-class `cursor`. */
  protected cursorsBySlot: number[] = [];

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

    // ER Damage Calc view — occupies the same panel area as the move stats,
    // shown instead of them when cycled to (R / RB). Top-aligned in the panel
    // (header where the type icon row sits) so the 3-4 short lines fit without
    // spilling past the panel's bottom edge.
    this.dmgCalcHeader = addTextObject(
      globalScene.scaledCanvas.width - 70,
      -36,
      "DMG CALC",
      TextStyle.MOVE_INFO_CONTENT,
    )
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.dmgCalcBody = addTextObject(globalScene.scaledCanvas.width - 70, -30, "", TextStyle.MOVE_INFO_CONTENT, {
      wordWrap: { width: 340 },
      lineSpacing: -8,
    })
      .setOrigin(0, 0)
      .setVisible(false);

    // ER (#377): tiny hint at the panel's top-right edge so players discover
    // that R cycles Stats / Description / Damage Calc. Created HIDDEN like
    // every other panel element - this container lives on the UI root, so a
    // visible-at-boot child leaks onto every screen until the first fight
    // menu close hides it (user report). setMoveInfo/updatePanelMode show it
    // only while a move is highlighted on the stats page.
    this.panelCycleHint = addTextObject(globalScene.scaledCanvas.width - 12, -36, "R ⇄", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(1, 0.5)
      .setAlpha(0.75)
      .setVisible(false);

    this.moveInfoContainer.add([
      this.panelCycleHint,
      this.typeIcon,
      this.moveCategoryIcon,
      this.ppLabel,
      this.ppText,
      this.powerLabel,
      this.powerText,
      this.accuracyLabel,
      this.accuracyText,
      this.dmgCalcHeader,
      this.dmgCalcBody,
    ]);

    // prepare move overlay — sits ABOVE the fight bar with a visible window
    // (#362: at -getHeight it landed ON the move list, overlapping the move
    // names with borderless text; the bar is ~48 scaled px tall).
    this.moveInfoOverlay = new MoveInfoOverlay({
      delayVisibility: true,
      onSide: true,
      right: true,
      x: 0,
      y: -48 - MoveInfoOverlay.getHeight(true),
      width: globalScene.scaledCanvas.width + 4,
      hideEffectBox: true,
    });
    ui.add(this.moveInfoOverlay);
    // register the overlay to receive toggle events
    globalScene.addInfoToggle(this.moveInfoOverlay, this);
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
      this.setCursor(this.fieldIndex ? (this.cursorsBySlot[this.fieldIndex] ?? 0) : this.cursor);
    }
    this.displayMoves();
    // ER double-battle fix: clearMoves() (run when the fight menu closes for the
    // previous acting Pokémon) hides the type-effectiveness indicator on EVERY
    // active foe. When this menu re-opens with the cursor already on the same
    // slot, setCursor() short-circuits the cursor-change bookkeeping, so without
    // an explicit recompute the second foe's indicator would stay hidden until
    // the first foe faints. Force a recompute for the current cursor so BOTH
    // active foes' indicators are restored whenever the menu is shown. Idempotent
    // with the setCursor() call above; getOpponents() defaults to on-field so
    // both active foes are covered.
    this.setMoveInfo(this.getCursor());
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

    // ER: the in-battle info overlay ("Pokémon Stats"). While open it owns input
    // (Left/Right page panels, Up/Down switch the inspected Pokémon, any other
    // button closes) — same as the command menu. Opened with the info/STATS key
    // (routed here via the buttonGoToFilter whitelist) so the detailed info
    // screen is reachable during move selection, not just from the command menu.
    // ER Library (5928): while the cast panel is open it owns input. It opens
    // with CYCLE_FORM (only for a Library holder that can currently cast).
    if (this.library.isOpen) {
      this.library.handleInput(button);
      return true;
    }
    if (button === Button.CYCLE_FORM) {
      const holder = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
      if (holder && hasLibrary(holder) && this.library.open(holder)) {
        this.getUi().playSelect();
        return true;
      }
    }
    if (this.battleInfo.isOpen) {
      this.battleInfo.handleInput(button);
      return true;
    }
    if (button === Button.STATS) {
      this.battleInfo.open();
      return true;
    }
    // ER (#356): cycle the right panel through move STATS → DESCRIPTION →
    // DAMAGE CALC with R / RB (the same on-screen R works on mobile).
    if (button === Button.CYCLE_SHINY) {
      this.panelMode = ((this.panelMode + 1) % 3) as 0 | 1 | 2;
      this.setMoveInfo(this.getCursor());
      this.getUi().playSelect();
      return true;
    }

    switch (button) {
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
    return this.fieldIndex ? (this.cursorsBySlot[this.fieldIndex] ?? 0) : this.cursor;
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

    this.applyPanelMode(pokemon, pokemonMove);
  }

  /**
   * ER (#356): render the current panel page, cycled with R / RB:
   *   0 — the normal move stats in the right panel.
   *   1 — the highlighted move's DESCRIPTION via the full-width
   *       {@linkcode MoveInfoOverlay} above the move list (auto-scrolls long
   *       text); the right panel keeps the stats. The tiny right panel can't
   *       legibly fit free-form description text, so the overlay does the work.
   *   2 — the Damage Calc view in the right panel (short, fits top-aligned).
   */
  private applyPanelMode(pokemon: Pokemon, pokemonMove: PokemonMove): void {
    const mode = this.panelMode;
    // Description page: fade the overlay in; any other page fades it back out
    // (without fighting the vanilla hold-to-peek info button). If the player
    // disabled Move Info in settings the overlay never populates — fall back to
    // a compact in-panel description so the page isn't blank.
    const overlayUsable = globalScene.enableMoveInfo;
    const showOverlay = mode === 1 && overlayUsable;
    if (this.moveInfoOverlay.visible !== showOverlay) {
      this.moveInfoOverlay.toggleInfo(showOverlay);
    }
    const inPanelText = mode === 2 || (mode === 1 && !overlayUsable);
    for (const el of [
      this.typeIcon,
      this.moveCategoryIcon,
      this.ppLabel,
      this.ppText,
      this.powerLabel,
      this.powerText,
      this.accuracyLabel,
      this.accuracyText,
    ]) {
      el.setVisible(!inPanelText);
    }
    this.dmgCalcHeader.setVisible(inPanelText);
    this.dmgCalcBody.setVisible(inPanelText);
    // The in-panel headers already read "... (R)", so the corner hint only
    // shows on the default stats page (#377) where nothing else mentions R.
    this.panelCycleHint.setVisible(!inPanelText);
    if (mode === 2) {
      this.dmgCalcHeader.setText("DMG CALC (R)");
      this.dmgCalcBody.setText(this.getDamageCalcText(pokemon, pokemonMove));
    } else if (mode === 1 && !overlayUsable) {
      this.dmgCalcHeader.setText("DESCRIPTION (R)");
      this.dmgCalcBody.setText(pokemonMove.getMove().effect || "—");
    }
  }

  /**
   * ER: compute the Damage Calc panel body. Locked until a Damage Calculator is
   * held; otherwise shows the highlighted move's damage range as a percentage of
   * the primary opponent's current HP. `simulated` uses the max (100%) damage
   * roll, so the min is 85% of it — the standard damage spread.
   */
  private getDamageCalcText(pokemon: Pokemon, pokemonMove: PokemonMove): string {
    const unlocked =
      ER_DAMAGE_CALC_FORCE_UNLOCK || !!globalScene.findModifier(m => m instanceof DamageCalculatorModifier);
    if (!unlocked) {
      return "Locked\nFind a Damage\nCalculator";
    }
    const move = pokemonMove.getMove();
    if (move.category === MoveCategory.STATUS || move.power <= 0) {
      return "—\n(status move)";
    }
    const target = pokemon.getOpponents()[0];
    if (!target) {
      return "No target\non the field";
    }
    // Shared preview: real per-hit damage (full ability suite) scaled for multi-hit
    // (MultiHitAttr moves + ER Multi-Headed). See er-damage-preview.
    const { min, max, crit, hits } = getErDamagePreview(pokemon, target, move);
    const hp = Math.max(1, target.hp);
    const minPct = Math.max(0, Math.round((min / hp) * 100));
    const maxPct = Math.max(0, Math.round((max / hp) * 100));
    const critPct = Math.max(0, Math.round((crit / hp) * 100));
    const ko = min >= target.hp ? "\nGuaranteed KO" : max >= target.hp ? "\nPossible KO" : "";
    return `${minPct}% – ${maxPct}% of foe HP\ncrit ~${critPct}%${hits ? ` · ${hits}` : ""}${ko}`;
  }

  setCursor(cursor: number): boolean {
    const ui = this.getUi();

    this.moveInfoOverlay.clear();
    const changed = this.getCursor() !== cursor;
    if (changed) {
      if (this.fieldIndex) {
        this.cursorsBySlot[this.fieldIndex] = cursor;
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
   * Rebuild the move list AND the detail panel (names / types / PP / power /
   * accuracy) from the acting Pokémon's CURRENT moveset.
   *
   * Needed because a mid-turn effect can swap the moveset while the fight menu is
   * still showing the stale names — specifically ER's `Omniform`, which replaces
   * the holder's moves when it transforms. `displayMoves` only runs from `show()`,
   * so without this the open menu keeps the pre-transform list. Safe no-op unless
   * the menu is currently active (the only state where the cached list is on
   * screen and a `CommandPhase` is guaranteed current for the accessors below).
   */
  refreshMoves(): void {
    if (!this.active) {
      return;
    }
    this.clearMoves();
    this.displayMoves();
    this.setMoveInfo(this.getCursor());
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
    this.battleInfo.close();
    this.library.close();
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
