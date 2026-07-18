import type { Ability } from "#abilities/ability";
import { loggedInUser } from "#app/account";
import { globalScene } from "#app/global-scene";
import { starterColors } from "#app/global-vars/starter-colors";
import { isSlotEnabled, isSlotUnlocked, type PassiveSlot } from "#app/ui/handlers/starter-select-ui-handler";
import { getStarterValueFriendshipCap, speciesStarterCosts } from "#balance/starters";
import { allAbilities, allMoves } from "#data/data-lists";
import {
  getErAbilityDescription,
  getErAbilityRomDescription,
  getErCompositeDetailedDescription,
} from "#data/elite-redux/er-ability-descriptions";
import {
  cycleErGiftAbility,
  getErActiveGiftAbilityId,
  isErBlackShiny,
  isErGiftCycleAllowed,
} from "#data/elite-redux/er-black-shinies";
import { ensureErSpriteAnim, playErPokemonSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import { erStreakBonusPercent } from "#data/elite-redux/er-money-streak";
import { getErMoveDetailPages, type MoveDetailRow } from "#data/elite-redux/er-move-details";
import { erYoungsterFreeInnateSlots } from "#data/elite-redux/er-run-difficulty";
import { getLevelRelExp, getLevelTotalExp } from "#data/exp";
import { getGenderColor, getGenderSymbol } from "#data/gender";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { getPokeballAtlasKey } from "#data/pokeball";
import { getTypeRgb } from "#data/type";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveCategory } from "#enums/move-category";
import { Nature } from "#enums/nature";
import { PlayerGender } from "#enums/player-gender";
import { PokemonType } from "#enums/pokemon-type";
import { getStatKey, PERMANENT_STATS, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { modifierSortFunc, PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";
import { ErShinyLabNameFx } from "#sprites/er-shiny-lab-name-fx";
import {
  ErShinyLabSpriteFxOverlay,
  type ErShinyLabSpriteSourceRef,
  getErShinyLabNameStyleForPokemon,
  getErShinyLabPokemonSpriteSource,
  getErShinyLabSpriteFxLookForPokemon,
  getErShinyLabSpriteFxTime,
  hasErShinyLabAnySpriteFx,
  hasErShinyLabExactSpriteFx,
} from "#sprites/er-shiny-lab-sprite-fx";
import type { Variant } from "#sprites/variant";
import { getVariantTint } from "#sprites/variant";
import { achvs } from "#system/achv";
import { OmniformEvolutionStrip, omniformStripWidth } from "#ui/omniform-evolution-strip";
import {
  currentEvolutionIndex,
  getEvolutionAbilities,
  getEvolutionMoveset,
  getOmniformEvolutions,
  type OmniformEvolutionEntry,
} from "#ui/omniform-evolution-view";
import { addBBCodeTextObject, addTextObject, getBBCodeFrag, getTextColor, updateCandyCountTextStyle } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { argbFromRgba, rgbHexToRgba } from "#utils/color-utils";
import { fixedInt, formatStat, getBiomeName, getLocalizedSpriteKey, getShinyDescriptor, padInt } from "#utils/common";
import { getEnumValues } from "#utils/enums";
import { getDexNumber } from "#utils/pokemon-utils";
import { toCamelCase, toTitleCase } from "#utils/strings";
import i18next from "i18next";

enum Page {
  PROFILE,
  /** Elite Redux: dedicated 4-row stack page showing Ability + 3 Innates. */
  ABILITIES,
  STATS,
  MOVES,
}

export enum SummaryUiMode {
  DEFAULT,
  LEARN_MOVE,
}

/** Holds all objects related to an ability for each iteration */
interface AbilityContainer {
  /** An image displaying the summary label */
  labelImage: Phaser.GameObjects.Image;
  /** The ability object */
  ability: Ability | null;
  /** The text object displaying the name of the ability */
  nameText: Phaser.GameObjects.Text | null;
  /** The text object displaying the description of the ability */
  descriptionText: Phaser.GameObjects.Text | null;
}

export class SummaryUiHandler extends UiHandler {
  private summaryUiMode: SummaryUiMode;

  private summaryContainer: Phaser.GameObjects.Container;
  private summaryContainerDexNoLabel: Phaser.GameObjects.Image;
  private tabSprite: Phaser.GameObjects.Sprite;
  /**
   * Elite Redux: text label shown in the tab area for the ABILITIES page,
   * which has no baked tab sprite. Shown (and tabSprite hidden) only on that
   * page; hidden (tabSprite shown) on all vanilla pages.
   */
  private abilitiesTabText: Phaser.GameObjects.Text;
  /** ER ABILITIES page: which row (0=main ability, 1-3=innates) is selected. */
  private abilitiesCursor = 0;
  /**
   * ER ABILITIES page: whether ability-row selection is active. While `false`
   * (the default on entering the page), Up/Down switch party members like every
   * other summary page. Pressing {@link Button.ACTION} enters selection mode so
   * Up/Down move the row cursor; {@link Button.CANCEL} exits back to browsing.
   */
  private abilitiesSelectMode = false;
  /** ER ABILITIES page: number of rendered rows (main + present innates). */
  private abilitiesRowCount = 0;
  /** Per-row metadata for the ABILITIES page, indexed by row. */
  private abilitiesRows: { ability: Ability; y: number; locked: boolean }[] = [];
  /** Selection-highlight box drawn over the selected ability row. */
  private abilitiesCursorObj: Phaser.GameObjects.NineSlice | null = null;
  /** "Ⓐ Detail" prompt shown on the selected ability row's header. */
  private abilitiesDetailPrompt: Phaser.GameObjects.Text | null = null;
  /**
   * ER Black Shinies (#349): the "R" key-badge sprite drawn on the player's GIFT
   * row header (keyboard atlas, same idiom as the Omniform F badge) so keyboard
   * players SEE that R cycles the gift. Only present for a player-owned black
   * shiny's gift row; null otherwise.
   */
  private giftCycleBadge: Phaser.GameObjects.Sprite | null = null;
  /** Full-screen ability-detail overlay (long description); null when closed. */
  private abilitiesDetailContainer: Phaser.GameObjects.Container | null = null;
  private shinyOverlay: Phaser.GameObjects.Image;
  private numberText: Phaser.GameObjects.Text;
  private pokemonSprite: Phaser.GameObjects.Sprite;
  private shinyLabFxOverlay: ErShinyLabSpriteFxOverlay | null = null;
  private shinyLabFxTimer: Phaser.Time.TimerEvent | null = null;
  private nameFx?: ErShinyLabNameFx | undefined;
  private shinyLabSummarySpriteLoadKey: string | null = null;
  private nameText: Phaser.GameObjects.Text;
  private splicedIcon: Phaser.GameObjects.Sprite;
  private pokeball: Phaser.GameObjects.Sprite;
  private levelText: Phaser.GameObjects.Text;
  private genderText: Phaser.GameObjects.Text;
  /** ER (#348): mini money-streak ribbon — this mon's current money bonus. */
  private erStreakText: Phaser.GameObjects.Text;
  private shinyIcon: Phaser.GameObjects.Image;
  private fusionShinyIcon: Phaser.GameObjects.Image;
  private candyShadow: Phaser.GameObjects.Sprite;
  private candyIcon: Phaser.GameObjects.Sprite;
  private candyOverlay: Phaser.GameObjects.Sprite;
  private candyCountText: Phaser.GameObjects.Text;
  private championRibbon: Phaser.GameObjects.Image;
  private statusContainer: Phaser.GameObjects.Container;
  private status: Phaser.GameObjects.Image;
  /** The pixel button prompt indicating a passive is unlocked */
  private abilityPrompt: Phaser.GameObjects.Image;
  /** Object holding everything needed to display an ability */
  private abilityContainer: AbilityContainer;
  /**
   * Object holding everything needed to display the legacy single passive.
   * In ER 3-passive mode this is the first non-empty slot in {@link passiveContainers}
   * — kept as a separate field for back-compat with any direct reads.
   */
  private passiveContainer: AbilityContainer;
  /**
   * ER 3-passive: per-slot ability containers. `null` entries correspond to
   * empty slots (`AbilityId.NONE`) that aren't rendered. Slots index by ER's
   * 0..2 passive slot order — slot 0 mirrors {@link passiveContainer}.
   */
  private passiveContainers: (AbilityContainer | null)[] = [];
  /**
   * Index into the [ability, ...passiveContainers] visible cycle. 0 = ability,
   * 1..3 = passive slot 0..2. The {@link Button.ACTION} handler on the PROFILE
   * page advances this cursor, hiding the previous container and revealing
   * the next non-null one.
   */
  private abilityCycleIndex = 0;
  private summaryPageContainer: Phaser.GameObjects.Container;
  private movesContainer: Phaser.GameObjects.Container;
  private movesContainerMovesTitle: Phaser.GameObjects.Image;
  private movesContainerDescriptionsTitle: Phaser.GameObjects.Image;
  private moveDescriptionText: Phaser.GameObjects.Text;
  private moveCursorObj: Phaser.GameObjects.Sprite | null;
  private selectedMoveCursorObj: Phaser.GameObjects.Sprite | null;
  private moveRowsContainer: Phaser.GameObjects.Container;
  private extraMoveRowContainer: Phaser.GameObjects.Container;
  private moveEffectContainer: Phaser.GameObjects.Container;
  private moveEffectContainerTitle: Phaser.GameObjects.Image;
  private movePowerText: Phaser.GameObjects.Text;
  private moveAccuracyText: Phaser.GameObjects.Text;
  private moveCategoryIcon: Phaser.GameObjects.Sprite;
  private summaryPageTransitionContainer: Phaser.GameObjects.Container;
  private friendshipShadow: Phaser.GameObjects.Sprite;
  private friendshipText: Phaser.GameObjects.Text;
  private friendshipIcon: Phaser.GameObjects.Sprite;
  private friendshipOverlay: Phaser.GameObjects.Sprite;
  private permStatsContainer: Phaser.GameObjects.Container;
  private ivContainer: Phaser.GameObjects.Container;
  private statsContainer: Phaser.GameObjects.Container;
  private statsContainerItemTitle: Phaser.GameObjects.Image;
  private statsContainerStatsTitle: Phaser.GameObjects.Image;
  private statsContainerExpTitle: Phaser.GameObjects.Image;
  private statsContainerExpBarTitle: Phaser.GameObjects.Image;

  private descriptionScrollTween: Phaser.Tweens.Tween | null;
  private moveCursorBlinkTimer: Phaser.Time.TimerEvent | null;

  private pokemon: PlayerPokemon | null;
  private playerParty: boolean;
  /**This is set to false when checking the summary of a freshly caught Pokemon as it is not part of a player's party yet but still needs to display its items*/
  private newMove: Move | null;
  private moveSelectFunction: ((cursor: number) => void) | null;
  private transitioning: boolean;
  private statusVisible: boolean;
  private moveEffectsVisible: boolean;

  private moveSelect: boolean;
  private moveCursor: number;
  private selectedMoveIndex: number;
  private selectCallback: ((cursor: number) => void) | null;
  /** ER: cyclable move-detail page on the Moves page (0 = description, 1-3 = property pages). */
  private moveDetailPage = 0;
  private moveDetailPageLabel: Phaser.GameObjects.Text | null = null;
  /** ER: right-hand column for the property pages (fixed x → clean alignment under the variable-width font). */
  private moveDetailCol2Text: Phaser.GameObjects.Text | null = null;

  /**
   * ER Omniform mons (#partner-eevee): the evolution browser strip. Present only
   * while the shown mon is an Omniform mon (a normal mon leaves this null so the
   * strip never renders). The dedicated cycle button ({@link Button.CYCLE_FORM})
   * advances {@link omniformViewIndex}; the ABILITIES + MOVES pages then render
   * the SELECTED evolution's kit view-only (no gameplay effect).
   */
  private omniformStrip: OmniformEvolutionStrip | null = null;
  private omniformEvolutions: OmniformEvolutionEntry[] = [];
  private omniformViewIndex = 0;

  constructor() {
    super(UiMode.SUMMARY);
  }

  setup() {
    const ui = this.getUi();

    this.summaryContainer = globalScene.add.container(0, 0);
    this.summaryContainer.setVisible(false);
    ui.add(this.summaryContainer);

    const summaryBg = globalScene.add.image(0, 0, "summary_bg");
    summaryBg.setOrigin(0, 1);
    this.summaryContainer.add(summaryBg);

    this.tabSprite = globalScene.add.sprite(81, -summaryBg.displayHeight + 16, getLocalizedSpriteKey("summary_tabs_1")); // Pixel text 'STATUS' tab
    this.tabSprite.setOrigin(0, 1);
    this.summaryContainer.add(this.tabSprite);

    // ER: text label rendered in the tab area for the ABILITIES page (no
    // baked tab sprite exists). Positioned to align with the tab title text.
    this.abilitiesTabText = addTextObject(
      111,
      -summaryBg.displayHeight + 3,
      i18next.t("pokemonSummary:abilities"),
      TextStyle.SUMMARY_HEADER,
    );
    this.abilitiesTabText.setOrigin(0.5, 0).setVisible(false);
    this.summaryContainer.add(this.abilitiesTabText);

    const summaryLabel = addTextObject(4, -165, i18next.t("pokemonSummary:pokemonInfo"), TextStyle.SUMMARY_HEADER);
    summaryLabel.setOrigin(0, 1);
    this.summaryContainer.add(summaryLabel);

    this.summaryContainerDexNoLabel = globalScene.add.image(6, -151, getLocalizedSpriteKey("summary_dexnb_label")); // Pixel text 'No'
    this.summaryContainerDexNoLabel.setOrigin(0, 1);
    this.summaryContainer.add(this.summaryContainerDexNoLabel);

    this.shinyOverlay = globalScene.add.image(6, -54, getLocalizedSpriteKey("summary_dexnb_label_overlay_shiny")); // Pixel text 'No' shiny
    this.shinyOverlay.setOrigin(0, 1);
    this.shinyOverlay.setVisible(false);
    this.summaryContainer.add(this.shinyOverlay);

    this.numberText = addTextObject(17, -149, "0000", TextStyle.SUMMARY);
    this.numberText.setOrigin(0, 1);
    this.summaryContainer.add(this.numberText);

    this.pokemonSprite = globalScene.initPokemonSprite(
      globalScene.add.sprite(56, -106, "pkmn__sub"),
      undefined,
      false,
      true,
    );
    this.summaryContainer.add(this.pokemonSprite);
    this.shinyLabFxOverlay = new ErShinyLabSpriteFxOverlay(this.pokemonSprite, "summary-shiny-lab-fx");
    this.summaryContainer.add(this.shinyLabFxOverlay.getSprite());

    this.nameText = addTextObject(6, -54, "", TextStyle.SUMMARY);
    this.nameText.setOrigin(0, 0);
    this.summaryContainer.add(this.nameText);

    this.splicedIcon = globalScene.add.sprite(0, -54, "icon_spliced");
    this.splicedIcon.setVisible(false);
    this.splicedIcon.setOrigin(0, 0);
    this.splicedIcon.setScale(0.75);
    this.splicedIcon.setInteractive(new Phaser.Geom.Rectangle(0, 0, 12, 15), Phaser.Geom.Rectangle.Contains);
    this.summaryContainer.add(this.splicedIcon);

    this.shinyIcon = globalScene.add.image(0, -54, "shiny_star");
    this.shinyIcon.setVisible(false);
    this.shinyIcon.setOrigin(0, 0);
    this.shinyIcon.setScale(0.75);
    this.shinyIcon.setInteractive(new Phaser.Geom.Rectangle(0, 0, 12, 15), Phaser.Geom.Rectangle.Contains);
    this.summaryContainer.add(this.shinyIcon);

    this.fusionShinyIcon = globalScene.add.image(0, 0, "shiny_star_2");
    this.fusionShinyIcon.setVisible(false);
    this.fusionShinyIcon.setOrigin(0, 0);
    this.fusionShinyIcon.setScale(0.75);
    this.summaryContainer.add(this.fusionShinyIcon);

    this.pokeball = globalScene.add.sprite(6, -19, "pb");
    this.pokeball.setOrigin(0, 1);
    this.summaryContainer.add(this.pokeball);

    this.candyIcon = globalScene.add.sprite(13, -140, "candy");
    this.candyIcon.setScale(0.8);
    this.summaryContainer.add(this.candyIcon);

    this.candyOverlay = globalScene.add.sprite(13, -140, "candy_overlay");
    this.candyOverlay.setScale(0.8);
    this.summaryContainer.add(this.candyOverlay);

    this.candyShadow = globalScene.add.sprite(13, -140, "candy");
    this.candyShadow.setTint(0x000000);
    this.candyShadow.setAlpha(0.5);
    this.candyShadow.setScale(0.8);
    this.candyShadow.setInteractive(new Phaser.Geom.Rectangle(0, 0, 30, 16), Phaser.Geom.Rectangle.Contains);
    this.summaryContainer.add(this.candyShadow);

    this.candyCountText = addTextObject(20, -146, "x0", TextStyle.WINDOW_ALT, {
      fontSize: "76px",
    });
    this.candyCountText.setOrigin(0, 0);
    this.summaryContainer.add(this.candyCountText);

    this.friendshipIcon = globalScene.add.sprite(13, -60, "friendship");
    this.friendshipIcon.setScale(0.8);
    this.summaryContainer.add(this.friendshipIcon);

    this.friendshipOverlay = globalScene.add.sprite(13, -60, "friendship_overlay");
    this.friendshipOverlay.setScale(0.8);
    this.summaryContainer.add(this.friendshipOverlay);

    this.friendshipShadow = globalScene.add.sprite(13, -60, "friendship");
    this.friendshipShadow.setTint(0x000000);
    this.friendshipShadow.setAlpha(0.5);
    this.friendshipShadow.setScale(0.8);
    this.friendshipShadow.setInteractive(new Phaser.Geom.Rectangle(0, 0, 50, 16), Phaser.Geom.Rectangle.Contains);
    this.summaryContainer.add(this.friendshipShadow);

    this.friendshipText = addTextObject(20, -66, "x0", TextStyle.WINDOW_ALT, {
      fontSize: "76px",
    });
    this.friendshipText.setOrigin(0, 0);
    this.summaryContainer.add(this.friendshipText);

    this.championRibbon = globalScene.add.image(88, -146, "champion_ribbon");
    this.championRibbon.setOrigin(0, 0);
    //this.championRibbon.setScale(0.8);
    this.championRibbon.setScale(1.25);
    this.summaryContainer.add(this.championRibbon);
    this.championRibbon.setVisible(false);

    this.levelText = addTextObject(24, -17, "", TextStyle.SUMMARY_ALT);
    this.levelText.setOrigin(0, 1);
    this.summaryContainer.add(this.levelText);

    this.genderText = addTextObject(96, -17, "", TextStyle.SUMMARY);
    this.genderText.setOrigin(0, 1);
    this.summaryContainer.add(this.genderText);

    // ER money streak (#348): small gold ribbon on the name bar — sits in the
    // free gap between "Lv." and the gender symbol (the ER summary's left panel
    // is narrow; anything past the gender symbol at x=96 gets clipped, which is
    // why the first placement at x=108 was invisible). Base placement is x=60 for
    // 1-2 digit levels; updateInfo() shrinks + nudges it right for 3-digit levels
    // ("Lv.100"+), which are 34px wide and would otherwise collide with it (#757).
    this.erStreakText = addTextObject(60, -17, "", TextStyle.SUMMARY_GOLD);
    this.erStreakText.setOrigin(0, 1);
    this.summaryContainer.add(this.erStreakText);

    this.statusContainer = globalScene.add.container(-106, -16);

    const statusBg = globalScene.add.image(0, 0, "summary_status");
    statusBg.setOrigin(0, 0);

    this.statusContainer.add(statusBg);

    const statusLabel = addTextObject(3, 0, i18next.t("pokemonSummary:status"), TextStyle.SUMMARY);
    statusLabel.setOrigin(0, 0);

    this.statusContainer.add(statusLabel);

    this.status = globalScene.add.sprite(91, 4, getLocalizedSpriteKey("statuses"));
    this.status.setOrigin(0.5, 0);

    this.statusContainer.add(this.status);

    this.summaryContainer.add(this.statusContainer);

    this.moveEffectContainer = globalScene.add.container(106, -62);

    this.summaryContainer.add(this.moveEffectContainer);

    const moveEffectBg = globalScene.add.image(0, 0, "summary_moves_effect");
    moveEffectBg.setOrigin(0, 0);
    this.moveEffectContainer.add(moveEffectBg);

    this.moveEffectContainerTitle = globalScene.add.image(7, 7, getLocalizedSpriteKey("summary_moves_effect_title")); // Pixel text 'EFFECT'
    this.moveEffectContainerTitle.setOrigin(0, 0.5);
    this.moveEffectContainer.add(this.moveEffectContainerTitle);

    const moveEffectLabels = addTextObject(8, 12, i18next.t("pokemonSummary:powerAccuracyCategory"), TextStyle.SUMMARY);
    moveEffectLabels.setLineSpacing(9);
    moveEffectLabels.setOrigin(0, 0);

    this.moveEffectContainer.add(moveEffectLabels);

    this.movePowerText = addTextObject(99, 27, "0", TextStyle.WINDOW_ALT);
    this.movePowerText.setOrigin(1, 1);
    this.moveEffectContainer.add(this.movePowerText);

    this.moveAccuracyText = addTextObject(99, 43, "0", TextStyle.WINDOW_ALT);
    this.moveAccuracyText.setOrigin(1, 1);
    this.moveEffectContainer.add(this.moveAccuracyText);

    this.moveCategoryIcon = globalScene.add.sprite(99, 57, "categories");
    this.moveCategoryIcon.setOrigin(1, 1);
    this.moveEffectContainer.add(this.moveCategoryIcon);

    const getSummaryPageBg = () => {
      const ret = globalScene.add.sprite(0, 0, this.getPageKey(0));
      ret.setOrigin(0, 1);
      return ret;
    };

    this.summaryContainer.add((this.summaryPageContainer = globalScene.add.container(106, 0)));
    this.summaryPageContainer.add(getSummaryPageBg());
    this.summaryPageContainer.setVisible(false);
    this.summaryContainer.add((this.summaryPageTransitionContainer = globalScene.add.container(106, 0)));
    this.summaryPageTransitionContainer.add(getSummaryPageBg());
    this.summaryPageTransitionContainer.setVisible(false);
  }

  getPageKey(page?: number) {
    if (page === undefined) {
      page = this.cursor;
    }
    // Elite Redux ABILITIES page has no dedicated background asset — reuse the
    // profile frame (it's just borders/dividers; the section titles are
    // separate overlays we control in populate()).
    if (page === Page.ABILITIES) {
      return "summary_profile";
    }
    return `summary_${Page[page].toLowerCase()}`;
  }

  /**
   * ER Omniform mons: (re)build the evolution browser strip for the current mon.
   * Only DEFAULT-mode summaries get it; a normal (non-Omniform) mon clears it so
   * the strip never renders. Selection defaults to the current battle-active form.
   */
  private buildOmniformStrip(): void {
    this.destroyOmniformStrip();
    const mon = this.pokemon;
    this.omniformEvolutions = this.summaryUiMode === SummaryUiMode.DEFAULT ? getOmniformEvolutions(mon) : [];
    if (!mon || this.omniformEvolutions.length <= 1) {
      this.omniformEvolutions = [];
      this.omniformViewIndex = 0;
      return;
    }
    this.omniformViewIndex = currentEvolutionIndex(this.omniformEvolutions);
    // Place the strip in the empty TOP HEADER bar (the row that holds "Pokemon
    // Info" and the page-tab title), right-aligned, so it takes ZERO vertical
    // space from the content panel below - which also means a 5-ability screen
    // (a black shiny with the switchable 5th slot) can never overlap it.
    const stripWindow = 5;
    const stripCell = 16;
    const rightEdgeX = 315;
    this.omniformStrip = new OmniformEvolutionStrip(
      this.summaryContainer,
      this.omniformEvolutions,
      this.omniformViewIndex,
      {
        x: rightEdgeX - omniformStripWidth(stripWindow, stripCell),
        y: this.abilitiesTabText.y + 3, // nudged a few px up within the header row
        windowSize: stripWindow,
        cellWidth: stripCell,
        iconScale: 0.5,
        onChange: index => this.onOmniformSelectionChange(index),
      },
    );
    this.updateOmniformStripVisibility();
  }

  private destroyOmniformStrip(): void {
    this.omniformStrip?.destroy();
    this.omniformStrip = null;
  }

  /** Selection changed on the strip: re-render the live page for the new form. */
  private onOmniformSelectionChange(index: number): void {
    this.omniformViewIndex = index;
    this.populatePageContainer(this.summaryPageContainer);
  }

  /** The strip shows only on the ABILITIES + MOVES pages (the ones it drives). */
  private updateOmniformStripVisibility(): void {
    const show = this.omniformStrip != null && (this.cursor === Page.ABILITIES || this.cursor === Page.MOVES);
    this.omniformStrip?.setVisible(show);
  }

  /**
   * The evolution being VIEWED when it differs from the current battle-active
   * form; `null` when the current form is selected (render the live mon as usual).
   */
  private getOmniformViewEntry(): OmniformEvolutionEntry | null {
    const entry = this.omniformEvolutions[this.omniformViewIndex];
    return entry && !entry.isCurrent ? entry : null;
  }

  show(
    args: [
      pokemon: PlayerPokemon,
      uiMode?: SummaryUiMode.DEFAULT,
      startPage?: Page,
      selectCallback?: (cursor: number) => void,
      player?: boolean,
    ],
  ): boolean;
  show(
    args: [
      pokemon: PlayerPokemon,
      uiMode: SummaryUiMode.LEARN_MOVE,
      move?: Move,
      moveSelectCallback?: (cursor: number) => void,
      player?: boolean,
    ],
  ): boolean;
  show(
    args: [
      pokemon: PlayerPokemon,
      uiMode?: SummaryUiMode,
      startPage?: Page | Move,
      callback?: (cursor: number) => void,
      player?: boolean,
    ],
  ): boolean {
    super.show(args);

    /* args[] information
     * args[0] : the Pokemon displayed in the Summary-UI
     * args[1] : the summaryUiMode (defaults to 0)
     * args[2] : the start page (defaults to Page.PROFILE), or the move being selected
     * args[3] : contains the function executed when the user exits out of Summary UI
     * args[4] : optional boolean used to determine if the Pokemon is part of the player's party or not (defaults to true, necessary for PR #2921 to display all relevant information)
     */
    this.pokemon = args[0] as PlayerPokemon;
    this.summaryUiMode = (args[1] as SummaryUiMode) ?? SummaryUiMode.DEFAULT;
    this.playerParty = args[4] ?? true;
    globalScene.ui.bringToTop(this.summaryContainer);

    this.summaryContainer.setVisible(true);
    this.cursor = -1;

    // ER Omniform mons: build the evolution browser strip before the first page
    // populates, so the ABILITIES/MOVES pages honour its offset + selection.
    this.buildOmniformStrip();

    this.shinyOverlay.setVisible(this.pokemon.isShiny());

    // Defense-in-depth: starterColors can lack an entry (ER custom species,
    // or the async starter-colors.json load racing summary open). Default to
    // white so the candy-icon tint never crashes the whole summary screen.
    const rootSpeciesId = this.pokemon.species.getRootSpeciesId();
    if (!starterColors[rootSpeciesId]) {
      starterColors[rootSpeciesId] = ["ffffff", "ffffff"];
    }
    const colorScheme = starterColors[rootSpeciesId];
    this.candyIcon.setTint(argbFromRgba(rgbHexToRgba(colorScheme[0])));
    this.candyOverlay.setTint(argbFromRgba(rgbHexToRgba(colorScheme[1])));

    this.numberText.setText(padInt(getDexNumber(this.pokemon.species.speciesId), 4));
    this.numberText.setColor(getTextColor(this.pokemon.isShiny() ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY));
    this.numberText.setShadowColor(
      getTextColor(this.pokemon.isShiny() ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY, true),
    );
    const shinyLabLook = getErShinyLabSpriteFxLookForPokemon(this.pokemon);
    const shinyLabSource = hasErShinyLabAnySpriteFx(shinyLabLook)
      ? getErShinyLabPokemonSpriteSource(this.pokemon, true, shinyLabLook)
      : null;
    const spriteKey = shinyLabSource?.key ?? this.pokemon.getSpriteKey(true);
    if (shinyLabSource) {
      this.ensureShinyLabSummarySpriteLoaded(shinyLabSource);
    }
    // Pin the atlas + frame 0001 and gap-fill the animation before playing, so a
    // multi-frame packed ER atlas never renders as its raw whole-sheet __BASE
    // frame and a failed play never leaves the PREVIOUS mon's texture (e.g. an
    // ally's black-shiny art on Snorlax's page). Shared with the evolution / egg
    // hatch / dex / starter-select surfaces.
    playErPokemonSpriteAnim(this.pokemonSprite, spriteKey);
    this.pokemonSprite
      .setPipelineData("teraColor", getTypeRgb(this.pokemon.getTeraType()))
      .setPipelineData("isTerastallized", this.pokemon.isTerastallized)
      .setPipelineData("ignoreTimeTint", true)
      .setPipelineData("spriteKey", spriteKey)
      .setPipelineData("shiny", this.pokemon.shiny)
      .setPipelineData("variant", this.pokemon.variant);
    ["spriteColors", "fusionSpriteColors"].forEach(k => {
      delete this.pokemonSprite.pipelineData[`${k}Base`];
      if (this.pokemon?.summonData.speciesForm) {
        k += "Base";
      }
      this.pokemonSprite.pipelineData[k] = this.pokemon?.getSprite().pipelineData[k];
    });
    this.refreshShinyLabSummaryFx();
    this.pokemon.cry();

    this.nameText.setText(this.pokemon.getNameToRender({ useIllusion: false }));
    // Shiny Lab Name FX: the name adopts the equipped palette's color (T3+ shiny, unlocked + on).
    const nameFxStyle = getErShinyLabNameStyleForPokemon(this.pokemon);
    this.nameText.setColor(nameFxStyle ? nameFxStyle.color : getTextColor(TextStyle.SUMMARY));
    // Layer the animated SURFACE FX onto the name glyphs (frame-swap overlay) when a surface is
    // equipped + Name FX on. Reuses the look already resolved for the sprite FX above; no-ops back
    // to the flat colour for palette-only / no-FX mons.
    this.getNameFx().update(this.nameText, shinyLabLook);

    const isFusion = this.pokemon.isFusion();

    this.splicedIcon.setPositionRelative(this.nameText, this.nameText.displayWidth + 2, 3);
    this.splicedIcon.setVisible(isFusion);
    if (this.splicedIcon.visible) {
      this.splicedIcon.on("pointerover", () =>
        globalScene.ui.showTooltip(
          "",
          `${this.pokemon?.species.getName(this.pokemon.formIndex)}/${this.pokemon?.fusionSpecies?.getName(this.pokemon?.fusionFormIndex)}`,
          true,
        ),
      );
      this.splicedIcon.on("pointerout", () => globalScene.ui.hideTooltip());
    }

    if (
      globalScene.gameData.starterData[this.pokemon.species.getRootSpeciesId()].classicWinCount > 0
      && globalScene.gameData.starterData[this.pokemon.species.getRootSpeciesId(true)].classicWinCount > 0
    ) {
      this.championRibbon.setVisible(true);
    } else {
      this.championRibbon.setVisible(false);
    }

    let currentFriendship = globalScene.gameData.starterData[this.pokemon.species.getRootSpeciesId()].friendship;
    if (!currentFriendship || currentFriendship === undefined) {
      currentFriendship = 0;
    }

    const friendshipCap = getStarterValueFriendshipCap(speciesStarterCosts[this.pokemon.species.getRootSpeciesId()]);
    const candyCropY = 16 - 16 * (currentFriendship / friendshipCap);

    if (this.candyShadow.visible) {
      this.candyShadow.on("pointerover", () =>
        globalScene.ui.showTooltip("", `${currentFriendship}/${friendshipCap}`, true),
      );
      this.candyShadow.on("pointerout", () => globalScene.ui.hideTooltip());
    }

    const candyCount = globalScene.gameData.starterData[this.pokemon.species.getRootSpeciesId()].candyCount;
    this.candyCountText.setText(`×${candyCount}`);
    updateCandyCountTextStyle(this.candyCountText, candyCount);

    this.candyShadow.setCrop(0, 0, 16, candyCropY);

    if (this.friendshipShadow.visible) {
      this.friendshipShadow.on("pointerover", () =>
        globalScene.ui.showTooltip("", `${i18next.t("pokemonSummary:friendship")}`, true),
      );
      this.friendshipShadow.on("pointerout", () => globalScene.ui.hideTooltip());
    }

    this.friendshipText.setText(` ${this.pokemon?.friendship || "0"}/255`);

    this.friendshipShadow.setCrop(0, 0, 16, 16 - 16 * ((this.pokemon?.friendship || 0) / 255));

    const doubleShiny = this.pokemon.isDoubleShiny(false);
    const bigIconVariant = doubleShiny ? this.pokemon.getBaseVariant(doubleShiny) : this.pokemon.getVariant();

    this.shinyIcon.setPositionRelative(
      this.nameText,
      this.nameText.displayWidth + (this.splicedIcon.visible ? this.splicedIcon.displayWidth + 1 : 0) + 1,
      3,
    );
    this.shinyIcon
      .setTexture(`shiny_star${doubleShiny ? "_1" : ""}`)
      .setVisible(this.pokemon.isShiny(false))
      // ER Black Shinies (#349): the t4 sparkle is BLACK, not blue/red/gold.
      .setTint(isErBlackShiny(this.pokemon) ? 0x0a0a0a : getVariantTint(bigIconVariant));
    if (this.shinyIcon.visible) {
      let shinyDescriptor = "";
      if (doubleShiny || bigIconVariant) {
        // ER Black Shinies (#349): the t4 tier reads "Black", not "Epic".
        shinyDescriptor = " (" + (isErBlackShiny(this.pokemon) ? "Black" : getShinyDescriptor(bigIconVariant));
        if (doubleShiny) {
          shinyDescriptor += "/" + getShinyDescriptor(this.pokemon.fusionVariant);
        }
        shinyDescriptor += ")";
      }
      this.shinyIcon
        .on("pointerover", () =>
          globalScene.ui.showTooltip("", i18next.t("common:shinyOnHover") + shinyDescriptor, true),
        )
        .on("pointerout", () => globalScene.ui.hideTooltip());
    }

    this.fusionShinyIcon.setPosition(this.shinyIcon.x, this.shinyIcon.y);
    this.fusionShinyIcon.setVisible(doubleShiny);
    if (isFusion) {
      this.fusionShinyIcon.setTint(getVariantTint(this.pokemon.fusionVariant));
    }

    this.pokeball.setFrame(getPokeballAtlasKey(this.pokemon.pokeball));
    this.levelText.setText(`${i18next.t("pokemonSummary:lv")}${this.pokemon.level.toString()}`);
    this.genderText.setText(getGenderSymbol(this.pokemon.getGender(true)));
    this.genderText.setColor(getGenderColor(this.pokemon.getGender(true)));
    this.genderText.setShadowColor(getGenderColor(this.pokemon.getGender(true), true));

    // ER money streak ribbon (#348): show this mon's current money bonus.
    const erStreakBonus = erStreakBonusPercent(this.pokemon.id);
    this.erStreakText.setText(erStreakBonus > 0 ? `₽+${erStreakBonus}%` : "");
    // #757: a THREE-digit level ("Lv.100"+) is 34px wide and reaches x=58, leaving only a
    // 2px gap before the badge's default x=60 - so the level number and the badge collide.
    // The row is packed tight (the gender symbol sits at x=96), so simply shifting the badge
    // right would push it into the gender symbol. For 3-digit levels only, render the badge a
    // touch smaller and nudge it right so it clears the level number AND still ends before the
    // gender symbol. One- and two-digit levels keep the original size/position untouched.
    const threeDigitLevel = this.pokemon.level >= 100;
    this.erStreakText.setFontSize(threeDigitLevel ? "76px" : "96px");
    this.erStreakText.setX(threeDigitLevel ? 62 : 60);

    switch (this.summaryUiMode) {
      case SummaryUiMode.DEFAULT: {
        const page = (args[2] as Page) ?? Page.PROFILE;
        this.hideMoveEffect(true);
        this.setCursor(page);
        this.selectCallback = args[3] ?? null;
        break;
      }
      case SummaryUiMode.LEARN_MOVE:
        this.newMove = args[2] as Move;
        this.moveSelectFunction = args[3] ?? null;

        this.showMoveEffect(true);
        this.setCursor(Page.MOVES);
        this.showMoveSelect();
        break;
    }

    const fromSummary = args.length >= 2;

    if (this.pokemon.status || this.pokemon.pokerus) {
      this.showStatus(!fromSummary);
      this.status.setFrame(this.pokemon.status ? StatusEffect[this.pokemon.status.effect].toLowerCase() : "pokerus");
    } else {
      this.hideStatus(!fromSummary);
    }

    return true;
  }

  processInput(button: Button): boolean {
    if (this.transitioning) {
      return false;
    }

    const ui = this.getUi();
    const fromPartyMode = ui.handlers[UiMode.PARTY].active;
    let success = false;
    let error = false;

    if (this.moveSelect) {
      // ER: the info button cycles the highlighted move's detail pages
      // (description → mechanics → combat → properties). Routed here via the
      // buttonGoToFilter whitelist.
      if (button === Button.STATS) {
        this.cycleMoveDetail();
        return true;
      }
      if (button === Button.ACTION) {
        if (this.pokemon && this.moveCursor < this.pokemon.moveset.length) {
          if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE) {
            this.moveSelectFunction?.(this.moveCursor);
          } else if (this.selectedMoveIndex === -1) {
            this.selectedMoveIndex = this.moveCursor;
            this.setCursor(this.moveCursor);
          } else {
            if (this.selectedMoveIndex !== this.moveCursor) {
              const tempMove = this.pokemon?.moveset[this.selectedMoveIndex];
              this.pokemon.moveset[this.selectedMoveIndex] = this.pokemon.moveset[this.moveCursor];
              this.pokemon.moveset[this.moveCursor] = tempMove;

              const selectedMoveRow = this.moveRowsContainer.getAt(
                this.selectedMoveIndex,
              ) as Phaser.GameObjects.Container;
              const switchMoveRow = this.moveRowsContainer.getAt(this.moveCursor) as Phaser.GameObjects.Container;

              this.moveRowsContainer.moveTo(selectedMoveRow, this.moveCursor);
              this.moveRowsContainer.moveTo(switchMoveRow, this.selectedMoveIndex);

              selectedMoveRow.setY(this.moveCursor * 16);
              switchMoveRow.setY(this.selectedMoveIndex * 16);
            }

            this.selectedMoveIndex = -1;
            if (this.selectedMoveCursorObj) {
              this.selectedMoveCursorObj.destroy();
              this.selectedMoveCursorObj = null;
            }
          }
          success = true;
        } else if (this.moveCursor === this.getNewMoveRowIndex()) {
          return this.processInput(Button.CANCEL);
        } else {
          error = true;
        }
      } else if (button === Button.CANCEL) {
        this.hideMoveSelect();
        success = true;
      } else {
        switch (button) {
          case Button.UP:
            success = this.setCursor(this.moveCursor ? this.moveCursor - 1 : this.getNewMoveRowIndex());
            break;
          case Button.DOWN:
            success = this.setCursor(this.moveCursor < this.getNewMoveRowIndex() ? this.moveCursor + 1 : 0);
            break;
          case Button.LEFT:
            this.moveSelect = false;
            this.setCursor(Page.STATS);
            if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE) {
              this.hideMoveEffect();
              this.destroyBlinkCursor();
              success = true;
              break;
            }
            this.hideMoveSelect();
            success = true;
            break;
        }
      }
    } else if (
      button === Button.CYCLE_FORM
      && this.omniformStrip != null
      && (this.cursor === Page.ABILITIES || this.cursor === Page.MOVES)
    ) {
      // ER Omniform mons: the dedicated cycle button (F / controller LB / the
      // on-screen apad button) advances which evolution's abilities + moveset are
      // shown. View-only - it re-renders the panel, never touches the live mon.
      // Routed here via buttonCycleOption (SummaryUiHandler is whitelisted).
      this.omniformStrip.cycle();
      success = true;
    } else if (button === Button.CYCLE_SHINY && this.cursor === Page.ABILITIES) {
      // ER Black Shinies (#349): R cycles the GIFT between its 3 choices for the
      // player's own black shiny, re-rendering the page in place - but ONLY out of
      // combat (the reward-shop check menus). The gift is LOCKED mid-battle so it
      // can't be swapped to game the current fight (isErGiftCycleAllowed).
      if (this.pokemon?.isPlayer() && isErBlackShiny(this.pokemon) && isErGiftCycleAllowed()) {
        cycleErGiftAbility(this.pokemon);
        // Redraw the abilities page content in place so the gift row's name +
        // `idx/choices` counter refresh. We deliberately do NOT route through
        // setCursor(samePage): its page branch drops the overrideChanged flag
        // (changed is recomputed as `this.cursor !== cursor`, i.e. false), so
        // the re-render is skipped — and even when forced it runs the full tab
        // re-animation / abilitiesSelectMode reset / detail teardown. Rebuilding
        // just this page's container keeps the cursor + select-mode intact.
        this.populatePageContainer(this.summaryPageContainer);
        success = true;
      } else {
        error = true;
      }
    } else if (button === Button.ACTION) {
      if (this.cursor === Page.ABILITIES) {
        if (this.abilitiesDetailContainer) {
          // Detail overlay open → close it.
          this.closeAbilityDetail();
        } else if (this.abilitiesSelectMode) {
          // Already selecting → open the full-screen detail for the chosen row.
          this.openAbilityDetail();
        } else {
          // First press: enter ability-selection mode (cursor appears). Up/Down
          // now move between abilities instead of switching party members.
          this.abilitiesSelectMode = true;
          this.abilitiesCursor = 0;
          this.refreshAbilitiesCursor();
        }
        success = true;
      } else if (this.cursor === Page.MOVES) {
        // ER Omniform: while PREVIEWING another evolution's moveset (view-only),
        // move-select/reorder is disabled - it would edit the live mon's moves.
        if (this.getOmniformViewEntry()) {
          error = true;
        } else {
          this.showMoveSelect();
          success = true;
        }
      } else if (this.cursor === Page.PROFILE && this.pokemon?.hasPassive()) {
        // ER 3-passive: cycle through ability → passive[0] → passive[1] → passive[2] → ability.
        // For vanilla species (1 passive) this collapses to the legacy 2-step toggle.
        this.advanceAbilityCycle();
      } else if (this.cursor === Page.STATS) {
        //Show IVs
        this.permStatsContainer.setVisible(!this.permStatsContainer.visible);
        this.ivContainer.setVisible(!this.ivContainer.visible);
      }
    } else if (button === Button.CANCEL) {
      if (this.cursor === Page.ABILITIES && this.abilitiesDetailContainer) {
        // Close the detail overlay rather than leaving the summary.
        this.closeAbilityDetail();
        success = true;
      } else if (this.cursor === Page.ABILITIES && this.abilitiesSelectMode) {
        // Exit ability-selection mode back to party browsing (Up/Down switch mon).
        this.abilitiesSelectMode = false;
        this.refreshAbilitiesCursor();
        success = true;
      } else if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE) {
        this.hideMoveSelect();
      } else {
        if (this.selectCallback instanceof Function) {
          const selectCallback = this.selectCallback;
          this.selectCallback = null;
          selectCallback(-1);
        }

        if (fromPartyMode) {
          ui.setMode(UiMode.PARTY);
        } else {
          ui.setMode(UiMode.MESSAGE);
        }
      }
      success = true;
    } else {
      const pages = getEnumValues(Page);
      switch (button) {
        case Button.UP:
        case Button.DOWN: {
          if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE) {
            break;
          }
          // ER ABILITIES page: in selection mode, Up/Down move the ability-row
          // cursor. Otherwise (the default), fall through to party-member
          // switching like every other page. (Detail overlay open → ignore.)
          if (this.cursor === Page.ABILITIES && this.abilitiesSelectMode) {
            if (this.abilitiesDetailContainer || this.abilitiesRowCount === 0) {
              break;
            }
            const delta = button === Button.DOWN ? 1 : -1;
            this.abilitiesCursor = (this.abilitiesCursor + delta + this.abilitiesRowCount) % this.abilitiesRowCount;
            this.refreshAbilitiesCursor();
            success = true;
            break;
          }
          if (this.cursor === Page.ABILITIES && this.abilitiesDetailContainer) {
            break; // detail overlay open — don't switch party members
          }
          if (!fromPartyMode) {
            break;
          }
          const isDown = button === Button.DOWN;
          const party = globalScene.getPlayerParty();
          const partyMemberIndex = this.pokemon ? party.indexOf(this.pokemon) : -1;
          if ((isDown && partyMemberIndex < party.length - 1) || (!isDown && partyMemberIndex)) {
            const page = this.cursor;
            this.clear();
            this.show([party[partyMemberIndex + (isDown ? 1 : -1)], this.summaryUiMode, page]);
          }
          break;
        }
        case Button.LEFT:
          if (this.cursor) {
            success = this.setCursor(this.cursor - 1);
          }
          break;
        case Button.RIGHT:
          if (this.cursor < pages.length - 1) {
            success = this.setCursor(this.cursor + 1);
            if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE && this.cursor === Page.MOVES) {
              this.moveSelect = true;
            }
          }
          break;
      }
    }

    if (success) {
      ui.playSelect();
    } else if (error) {
      ui.playError();
    }

    return success || error;
  }

  setCursor(cursor: number, overrideChanged = false): boolean {
    let changed: boolean = overrideChanged || this.moveCursor !== cursor;

    if (this.moveSelect) {
      this.moveCursor = cursor;

      const selectedMove = this.getSelectedMove();

      if (selectedMove) {
        this.moveDescriptionText.setY(84);
        this.movePowerText.setText(selectedMove.power >= 0 ? selectedMove.power.toString() : "---");
        this.moveAccuracyText.setText(selectedMove.accuracy >= 0 ? selectedMove.accuracy.toString() : "---");
        this.moveCategoryIcon.setFrame(MoveCategory[selectedMove.category].toLowerCase());
        this.showMoveEffect();
      } else {
        this.hideMoveEffect();
      }

      this.renderMoveDetail(selectedMove);
      const moveDescriptionLineCount = Math.floor(this.moveDescriptionText.displayHeight / 14.83);

      if (this.descriptionScrollTween) {
        this.descriptionScrollTween.remove();
        this.descriptionScrollTween = null;
      }

      if (moveDescriptionLineCount > 3) {
        this.descriptionScrollTween = globalScene.tweens.add({
          targets: this.moveDescriptionText,
          delay: fixedInt(2000),
          loop: -1,
          hold: fixedInt(2000),
          duration: fixedInt((moveDescriptionLineCount - 3) * 2000),
          y: `-=${14.83 * (moveDescriptionLineCount - 3)}`,
        });
      }

      if (!this.moveCursorObj) {
        this.moveCursorObj = globalScene.add.sprite(-2, 0, "summary_moves_cursor", "highlight");
        this.moveCursorObj.setOrigin(0, 1);
        this.movesContainer.add(this.moveCursorObj);
      }

      this.moveCursorObj.setY(16 * this.moveCursor + 1);

      if (this.moveCursorBlinkTimer) {
        this.moveCursorBlinkTimer.destroy();
      }
      this.moveCursorObj.setVisible(true);
      this.moveCursorBlinkTimer = globalScene.time.addEvent({
        loop: true,
        delay: fixedInt(600),
        callback: () => {
          this.moveCursorObj?.setVisible(false);
          globalScene.time.delayedCall(fixedInt(100), () => {
            if (!this.moveCursorObj) {
              return;
            }
            this.moveCursorObj.setVisible(true);
          });
        },
      });
      if (this.selectedMoveIndex > -1) {
        if (!this.selectedMoveCursorObj) {
          this.selectedMoveCursorObj = globalScene.add.sprite(-2, 0, "summary_moves_cursor", "select");
          this.selectedMoveCursorObj.setOrigin(0, 1);
          this.movesContainer.add(this.selectedMoveCursorObj);
          this.movesContainer.moveBelow(this.selectedMoveCursorObj, this.moveCursorObj);
        }

        this.selectedMoveCursorObj.setY(16 * this.selectedMoveIndex + 1);
      }
    } else {
      changed = this.cursor !== cursor;
      if (changed) {
        // Leaving the ABILITIES page → tear down its detail overlay.
        if (this.cursor === Page.ABILITIES && cursor !== Page.ABILITIES) {
          this.closeAbilityDetail();
        }
        // Any page change resets ability-selection mode so the page is always
        // entered in the default party-browsing state.
        this.abilitiesSelectMode = false;
        const forward = this.cursor < cursor;
        this.cursor = cursor;

        // ER Omniform: the strip only shows on the pages it drives (ABILITIES/MOVES).
        this.updateOmniformStripVisibility();

        // Tab visual mapping. The 3 vanilla pages use baked tab sprites
        // (1=STATUS, 2=STATS, 3=MOVES). ER's ABILITIES page has no baked
        // asset, so we hide the tab sprite and show a text label instead.
        if ((this.cursor as Page) === Page.ABILITIES) {
          this.tabSprite.setVisible(false);
          this.abilitiesTabText.setVisible(true);
        } else {
          this.abilitiesTabText.setVisible(false);
          this.tabSprite.setVisible(true);
          let tabSpriteIndex: number;
          switch (this.cursor as Page) {
            case Page.PROFILE:
              tabSpriteIndex = 1;
              break;
            case Page.STATS:
              tabSpriteIndex = 2;
              break;
            case Page.MOVES:
              tabSpriteIndex = 3;
              break;
            default:
              tabSpriteIndex = 1;
          }
          this.tabSprite.setTexture(getLocalizedSpriteKey(`summary_tabs_${tabSpriteIndex}`));
        }

        this.getUi().hideTooltip();

        if (this.summaryPageContainer.visible) {
          this.transitioning = true;
          this.populatePageContainer(this.summaryPageTransitionContainer, forward ? cursor : cursor + 1);
          if (forward) {
            this.summaryPageTransitionContainer.x += 214;
          } else {
            this.populatePageContainer(this.summaryPageContainer);
          }
          globalScene.tweens.add({
            targets: this.summaryPageTransitionContainer,
            x: forward ? "-=214" : "+=214",
            duration: 250,
            onComplete: () => {
              if (forward) {
                this.populatePageContainer(this.summaryPageContainer);
                if (this.cursor === Page.MOVES) {
                  this.moveCursorObj = null;
                  this.showMoveSelect();
                  this.showMoveEffect();
                }
              } else {
                this.summaryPageTransitionContainer.x -= 214;
              }
              this.summaryPageTransitionContainer.setVisible(false);
              this.transitioning = false;
            },
          });
          this.summaryPageTransitionContainer.setVisible(true);
        } else {
          this.populatePageContainer(this.summaryPageContainer);
          this.summaryPageContainer.setVisible(true);
        }
      }
    }

    return changed;
  }

  populatePageContainer(pageContainer: Phaser.GameObjects.Container, page?: Page) {
    if (page === undefined) {
      page = this.cursor;
    }

    if (pageContainer.getAll().length > 1) {
      pageContainer.each((o: Phaser.GameObjects.GameObject) => {
        if (o instanceof Phaser.GameObjects.Container) {
          o.removeAll(true);
        }
      });
      pageContainer.removeBetween(1, undefined, true);
    }
    const pageBg = pageContainer.getAt(0) as Phaser.GameObjects.Sprite;
    pageBg.setTexture(this.getPageKey(page));

    if (this.descriptionScrollTween) {
      this.descriptionScrollTween.remove();
      this.descriptionScrollTween = null;
    }

    switch (page) {
      case Page.PROFILE: {
        const profileContainer = globalScene.add.container(0, -pageBg.height);
        pageContainer.add(profileContainer);
        const otColor =
          globalScene.gameData.gender === PlayerGender.FEMALE ? TextStyle.SUMMARY_PINK : TextStyle.SUMMARY_BLUE;
        const usernameReplacement =
          globalScene.gameData.gender === PlayerGender.FEMALE
            ? i18next.t("trainerNames:playerF")
            : i18next.t("trainerNames:playerM");

        const profileContainerProfileTitle = globalScene.add //
          .image(7, 4, getLocalizedSpriteKey("summary_profile_profile_title")) // Pixel text 'PROFILE'
          .setOrigin(0, 0.5);
        profileContainer.add(profileContainerProfileTitle);

        // TODO: should add field for original trainer name to Pokemon object, to support gift/traded Pokemon from MEs
        const trainerText = addBBCodeTextObject(
          7,
          12,
          `${getBBCodeFrag(`${i18next.t("pokemonSummary:ot")}/`, TextStyle.SUMMARY_ALT)}${getBBCodeFrag(
            globalScene.hideUsername
              ? usernameReplacement
              : loggedInUser?.username || i18next.t("pokemonSummary:unknown"),
            otColor,
          )}`,
          TextStyle.SUMMARY_ALT,
        ).setOrigin(0);
        profileContainer.add(trainerText);

        const idToDisplay = globalScene.hideUsername ? "*****" : globalScene.gameData.trainerId.toString();
        const trainerIdText = addTextObject(
          141,
          12,
          `${i18next.t("pokemonSummary:idNo")}${idToDisplay}`,
          TextStyle.SUMMARY_ALT,
        ).setOrigin(0);
        profileContainer.add(trainerIdText);

        const typeLabel = addTextObject(7, 28, `${i18next.t("pokemonSummary:type")}/`, TextStyle.WINDOW_ALT);
        typeLabel.setOrigin(0, 0);
        profileContainer.add(typeLabel);

        const getTypeIcon = (index: number, type: PokemonType, tera = false) => {
          const xCoord = typeLabel.width * typeLabel.scale + 9 + 34 * index;
          const typeIcon = tera
            ? globalScene.add.sprite(xCoord, 42, "type_tera")
            : globalScene.add.sprite(xCoord, 42, getLocalizedSpriteKey("types"), PokemonType[type].toLowerCase());
          if (tera) {
            typeIcon.setScale(0.5);
            const typeRgb = getTypeRgb(type);
            typeIcon.setTint(Phaser.Display.Color.GetColor(typeRgb[0], typeRgb[1], typeRgb[2]));
          }
          typeIcon.setOrigin(0, 1);
          return typeIcon;
        };

        const types = this.pokemon?.getTypes(false, false, true, false)!; // TODO: is this bang correct?
        // ER N-type substrate: lay out ALL types (a Primal Regigigas is sextuple-
        // typed) on the existing 34px stride, not just the first two.
        types.forEach((type, index) => profileContainer.add(getTypeIcon(index, type)));

        if (this.pokemon?.getLuck()) {
          const luckLabelText = addTextObject(
            141,
            28,
            i18next.t("common:luckIndicator"),
            TextStyle.WINDOW_ALT,
          ).setOrigin(0, 0);
          profileContainer.add(luckLabelText);

          const luckText = addTextObject(
            141 + luckLabelText.displayWidth + 2,
            28,
            this.pokemon.getLuck().toString(),
            TextStyle.LUCK_VALUE,
          );
          luckText.setOrigin(0, 0);
          luckText.setTint(getVariantTint(Math.min(this.pokemon.getLuck() - 1, 2) as Variant));
          profileContainer.add(luckText);
        }

        if (Object.hasOwn(globalScene.gameData.achvUnlocks, achvs.TERASTALLIZE.id) && this.pokemon != null) {
          const teraIcon = globalScene.add.sprite(128, 26, "button_tera");
          teraIcon.setName("terastallize-icon");
          teraIcon.setFrame(PokemonType[this.pokemon.getTeraType()].toLowerCase());
          profileContainer.add(teraIcon);
        }

        this.abilityContainer = {
          labelImage: globalScene.add.image(0, 0, getLocalizedSpriteKey("summary_profile_ability")), // Pixel text 'ABILITY'
          ability: this.pokemon?.getAbility(true)!, // TODO: is this bang correct?
          nameText: null,
          descriptionText: null,
        };

        const allAbilityInfo = [this.abilityContainer]; // Creates an array to iterate through
        // ER 3-passive: reset per-slot containers each populate(). Empty slots
        // (AbilityId.NONE) keep `null` entries so the cycle skips over them.
        this.passiveContainers = [null, null, null];
        // Only add to the array and set up displaying a passive if it's unlocked
        if (this.pokemon?.hasPassive()) {
          // Elite Redux: append every non-null passive slot. Vanilla pokerogue
          // species fill slots 1/2 with NONE so this is a 1-entry append; ER
          // species (post-B1a) get up to 3 passive entries.
          const passiveAbilities = this.pokemon.getPassiveAbilities();
          for (let slot = 0; slot < passiveAbilities.length; slot++) {
            const passiveAbility = passiveAbilities[slot];
            // Skip empty slots: a null slot OR an explicit `AbilityId.NONE`
            // (a design-PARKED innate, e.g. Primal Mew's not-yet-defined Shattered
            // Psyche). Rendering NONE would draw a broken/blank PASSIVE row. This
            // mirrors the profile-tab innate guard below.
            if (!passiveAbility || passiveAbility.id === AbilityId.NONE) {
              continue;
            }
            const container: AbilityContainer = {
              labelImage: globalScene.add.image(0, 0, getLocalizedSpriteKey("summary_profile_passive")), // Pixel text 'PASSIVE'
              ability: passiveAbility,
              nameText: null,
              descriptionText: null,
            };
            allAbilityInfo.push(container);
            this.passiveContainers[slot] = container;
          }
          // Keep the legacy passiveContainer reference pointing at the first
          // non-empty slot for back-compat with any other code path that reads
          // it directly.
          const firstPassive = this.passiveContainers.find((c): c is AbilityContainer => c !== null);
          if (firstPassive) {
            this.passiveContainer = firstPassive;
          }

          // Sets up the pixel button prompt image
          this.abilityPrompt = globalScene.add.image(
            0,
            0,
            globalScene.inputController?.gamepadSupport ? "summary_profile_prompt_a" : "summary_profile_prompt_z",
          );
          this.abilityPrompt.setPosition(8, 43);
          this.abilityPrompt.setVisible(true);
          this.abilityPrompt.setOrigin(0, 0);
          profileContainer.add(this.abilityPrompt);
        }

        allAbilityInfo.forEach(abilityInfo => {
          abilityInfo.labelImage.setPosition(17, 47);
          abilityInfo.labelImage.setVisible(true);
          abilityInfo.labelImage.setOrigin(0, 0.5);
          profileContainer.add(abilityInfo.labelImage);

          abilityInfo.nameText = addTextObject(7, 68, abilityInfo.ability?.name!, TextStyle.SUMMARY_ALT); // TODO: is this bang correct?
          abilityInfo.nameText.setOrigin(0, 1);
          profileContainer.add(abilityInfo.nameText);

          abilityInfo.descriptionText = addTextObject(7, 71, abilityInfo.ability?.description!, TextStyle.WINDOW_ALT, {
            wordWrap: { width: 1224 },
          }); // TODO: is this bang correct?
          abilityInfo.descriptionText.setOrigin(0, 0);
          profileContainer.add(abilityInfo.descriptionText);

          // Sets up the mask that hides the description text to give an illusion of scrolling
          const descriptionTextMaskRect = globalScene.make.graphics({});
          descriptionTextMaskRect.setScale(6);
          descriptionTextMaskRect.fillStyle(0xffffff);
          descriptionTextMaskRect.beginPath();
          descriptionTextMaskRect.fillRect(110, 90.5, 206, 31);

          const abilityDescriptionTextMask = descriptionTextMaskRect.createGeometryMask();

          abilityInfo.descriptionText.setMask(abilityDescriptionTextMask);

          const abilityDescriptionLineCount = Math.floor(abilityInfo.descriptionText.displayHeight / 14.83);

          // Animates the description text moving upwards
          if (abilityDescriptionLineCount > 2) {
            abilityInfo.descriptionText.setY(69);
            this.descriptionScrollTween = globalScene.tweens.add({
              targets: abilityInfo.descriptionText,
              delay: fixedInt(2000),
              loop: -1,
              hold: fixedInt(2000),
              duration: fixedInt((abilityDescriptionLineCount - 2) * 2000),
              y: `-=${14.83 * (abilityDescriptionLineCount - 2)}`,
            });
          }
        });
        // Turn off visibility of passive info by default — ALL slots, not just
        // the legacy slot 0. The {@link Button.ACTION} handler cycles through
        // ability → passive[0] → passive[1] → passive[2] → ability.
        for (const passive of this.passiveContainers) {
          passive?.labelImage.setVisible(false);
          passive?.nameText?.setVisible(false);
          passive?.descriptionText?.setVisible(false);
        }
        // Start the cycle at index 0 (ability shown) on each populate().
        this.abilityCycleIndex = 0;

        const closeFragment = getBBCodeFrag("", TextStyle.WINDOW_ALT);
        const rawNature = toCamelCase(Nature[this.pokemon?.getNature()!]); // TODO: is this bang correct?
        const nature = `${getBBCodeFrag(toTitleCase(getNatureName(this.pokemon?.getNature()!)), TextStyle.SUMMARY_RED)}${closeFragment}`; // TODO: is this bang correct?

        const profileContainerMemoTitle = globalScene.add.image(
          7,
          107,
          getLocalizedSpriteKey("summary_profile_memo_title"), // Pixel text 'TRAINER MEMO'
        );
        profileContainerMemoTitle.setOrigin(0, 0.5);
        profileContainer.add(profileContainerMemoTitle);

        const memoString = i18next.t("pokemonSummary:memoString", {
          metFragment: i18next.t(
            `pokemonSummary:metFragment.${this.pokemon?.metBiome === -1 ? "apparently" : "normal"}`,
            {
              biome: `${getBBCodeFrag(getBiomeName(this.pokemon?.metBiome!), TextStyle.SUMMARY_RED)}${closeFragment}`, // TODO: is this bang correct?
              level: `${getBBCodeFrag(this.pokemon?.metLevel.toString()!, TextStyle.SUMMARY_RED)}${closeFragment}`, // TODO: is this bang correct?
              wave: `${getBBCodeFrag(this.pokemon?.metWave ? this.pokemon.metWave.toString()! : i18next.t("pokemonSummary:unknownTrainer"), TextStyle.SUMMARY_RED)}${closeFragment}`,
            },
          ),
          natureFragment: i18next.t(`pokemonSummary:natureFragment.${rawNature}`, { nature }),
        });

        const memoText = addBBCodeTextObject(7, 113, String(memoString), TextStyle.WINDOW_ALT);
        memoText.setOrigin(0, 0);
        profileContainer.add(memoText);
        break;
      }
      case Page.ABILITIES: {
        this.populateAbilitiesPage(pageContainer, pageBg);
        break;
      }
      case Page.STATS: {
        this.statsContainer = globalScene.add.container(0, -pageBg.height);
        pageContainer.add(this.statsContainer);
        this.permStatsContainer = globalScene.add.container(27, 56);
        this.statsContainer.add(this.permStatsContainer);
        this.ivContainer = globalScene.add.container(27, 56);
        this.statsContainer.add(this.ivContainer);
        this.statsContainer.setVisible(true);

        this.statsContainerItemTitle = globalScene.add.image(7, 4, getLocalizedSpriteKey("summary_stats_item_title")); // Pixel text 'ITEM'
        this.statsContainerItemTitle.setOrigin(0, 0.5);
        this.statsContainer.add(this.statsContainerItemTitle);

        this.statsContainerStatsTitle = globalScene.add.image(
          16,
          51,
          getLocalizedSpriteKey("summary_stats_stats_title"), // Pixel text 'STATS'
        );
        this.statsContainerStatsTitle.setOrigin(0, 0.5);
        this.statsContainer.add(this.statsContainerStatsTitle);

        this.statsContainerExpTitle = globalScene.add.image(7, 107, getLocalizedSpriteKey("summary_stats_exp_title")); // Pixel text 'EXP.'
        this.statsContainerExpTitle.setOrigin(0, 0.5);
        this.statsContainer.add(this.statsContainerExpTitle);

        this.statsContainerExpBarTitle = globalScene.add.image(
          126,
          144,
          getLocalizedSpriteKey("summary_stats_expbar_title"), // Pixel mini text 'EXP'
        );
        this.statsContainerExpBarTitle.setOrigin(0, 0);
        this.statsContainer.add(this.statsContainerExpBarTitle);

        PERMANENT_STATS.forEach((stat, s) => {
          const statName = i18next.t(getStatKey(stat));
          const rowIndex = s % 3;
          const colIndex = Math.floor(s / 3);

          const natureStatMultiplier = getNatureStatMultiplier(this.pokemon?.getNature()!, s); // TODO: is this bang correct?

          const statLabel = addTextObject(
            116 * colIndex + (colIndex === 1 ? 5 : 0),
            16 * rowIndex,
            statName,
            natureStatMultiplier === 1
              ? TextStyle.SUMMARY_STATS
              : natureStatMultiplier > 1
                ? TextStyle.SUMMARY_STATS_PINK
                : TextStyle.SUMMARY_STATS_BLUE,
          );
          const ivLabel = addTextObject(
            116 * colIndex + (colIndex === 1 ? 5 : 0),
            16 * rowIndex,
            statName,
            this.pokemon?.ivs[stat] === 31 ? TextStyle.SUMMARY_STATS_GOLD : TextStyle.SUMMARY_STATS,
          );

          statLabel.setOrigin(0.5, 0);
          ivLabel.setOrigin(0.5, 0);
          this.permStatsContainer.add(statLabel);
          this.ivContainer.add(ivLabel);

          // TODO: are those bangs correct?
          const statValueText =
            stat === Stat.HP
              ? `${formatStat(this.pokemon?.hp!, true)}/${formatStat(this.pokemon?.getMaxHp()!, true)}`
              : formatStat(this.pokemon?.getStat(stat)!);
          const ivText = `${this.pokemon?.ivs[stat]}/31`;

          const statValue = addTextObject(93 + 93 * colIndex, 16 * rowIndex, statValueText, TextStyle.WINDOW_ALT);
          statValue.setOrigin(1, 0);
          this.permStatsContainer.add(statValue);
          const ivValue = addTextObject(93 + 93 * colIndex, 16 * rowIndex, ivText, TextStyle.WINDOW_ALT);
          ivValue.setOrigin(1, 0);
          this.ivContainer.add(ivValue);
        });
        this.ivContainer.setVisible(false);

        const itemModifiers = (
          globalScene.findModifiers(
            m => m instanceof PokemonHeldItemModifier && m.pokemonId === this.pokemon?.id,
            this.playerParty,
          ) as PokemonHeldItemModifier[]
        ).sort(modifierSortFunc);

        itemModifiers.forEach((item, i) => {
          const icon = item.getIcon(true);

          icon.setPosition((i % 17) * 12 + 3, 14 * Math.floor(i / 17) + 15);
          this.statsContainer.add(icon);

          icon.setInteractive(new Phaser.Geom.Rectangle(0, 0, 32, 32), Phaser.Geom.Rectangle.Contains);
          icon.on("pointerover", () => globalScene.ui.showTooltip(item.type.name, item.type.getDescription(), true));
          icon.on("pointerout", () => globalScene.ui.hideTooltip());
        });

        const pkmLvl = this.pokemon?.level!; // TODO: is this bang correct?
        const pkmLvlExp = this.pokemon?.levelExp!; // TODO: is this bang correct?
        const pkmExp = this.pokemon?.exp!; // TODO: is this bang correct?
        const pkmSpeciesGrowthRate = this.pokemon?.species.growthRate!; // TODO: is this bang correct?
        const relLvExp = getLevelRelExp(pkmLvl + 1, pkmSpeciesGrowthRate);
        const expRatio = pkmLvl < globalScene.getMaxExpLevel() ? pkmLvlExp / relLvExp : 0;

        const expLabel = addTextObject(6, 112, i18next.t("pokemonSummary:expPoints"), TextStyle.SUMMARY);
        expLabel.setOrigin(0, 0);
        this.statsContainer.add(expLabel);

        const nextLvExpLabel = addTextObject(6, 128, i18next.t("pokemonSummary:nextLv"), TextStyle.SUMMARY);
        nextLvExpLabel.setOrigin(0, 0);
        this.statsContainer.add(nextLvExpLabel);

        const expText = addTextObject(213, 112, pkmExp.toString(), TextStyle.WINDOW_ALT);
        expText.setOrigin(1, 0);
        this.statsContainer.add(expText);

        const nextLvExp =
          pkmLvl < globalScene.getMaxExpLevel() ? getLevelTotalExp(pkmLvl + 1, pkmSpeciesGrowthRate) - pkmExp : 0;
        const nextLvExpText = addTextObject(213, 128, nextLvExp.toString(), TextStyle.WINDOW_ALT);
        nextLvExpText.setOrigin(1, 0);
        this.statsContainer.add(nextLvExpText);

        const expOverlay = globalScene.add.image(140, 145, "summary_stats_overlay_exp");
        expOverlay.setOrigin(0, 0);
        this.statsContainer.add(expOverlay);

        const expMaskRect = globalScene.make.graphics({});
        expMaskRect.setScale(6);
        expMaskRect.fillStyle(0xffffff);
        expMaskRect.beginPath();
        expMaskRect.fillRect(140 + pageContainer.x, 145 + pageContainer.y + 21, Math.floor(expRatio * 64), 3);

        const expMask = expMaskRect.createGeometryMask();

        expOverlay.setMask(expMask);
        this.abilityPrompt = globalScene.add.image(
          0,
          0,
          globalScene.inputController?.gamepadSupport ? "summary_profile_prompt_a" : "summary_profile_prompt_z",
        );
        this.abilityPrompt.setPosition(8, 47);
        this.abilityPrompt.setVisible(true);
        this.abilityPrompt.setOrigin(0, 0);
        this.statsContainer.add(this.abilityPrompt);
        break;
      }
      case Page.MOVES: {
        // ER Omniform: when an evolution is being previewed (header strip), its
        // (view-only) moveset replaces the live moveset. The strip lives in the
        // header, so the moves panel keeps its full layout.
        const movesViewEntry = this.getOmniformViewEntry();
        const movesViewSet = movesViewEntry ? getEvolutionMoveset(this.pokemon!, movesViewEntry, 5) : null;
        this.movesContainer = globalScene.add.container(5, -pageBg.height + 26);
        pageContainer.add(this.movesContainer);

        this.movesContainerMovesTitle = globalScene.add.image(
          2,
          -22,
          getLocalizedSpriteKey("summary_moves_moves_title"),
        ); // Pixel text 'MOVES'
        this.movesContainerMovesTitle.setOrigin(0, 0.5);
        this.movesContainer.add(this.movesContainerMovesTitle);

        this.movesContainerDescriptionsTitle = globalScene.add.image(
          2,
          78,
          getLocalizedSpriteKey("summary_moves_descriptions_title"),
        ); // Pixel text 'DESCRIPTIONS'
        this.movesContainerDescriptionsTitle.setOrigin(0, 0.5);
        this.movesContainer.add(this.movesContainerDescriptionsTitle);

        // The "new move" row sits just below the existing move rows (16px each),
        // so its Y depends on the move cap: 64 for 4 moves, 80 with ER's 5th slot.
        const maxMoveRows = this.pokemon?.getMaxMoveCount() ?? 4;
        this.extraMoveRowContainer = globalScene.add.container(0, 16 * maxMoveRows);
        this.extraMoveRowContainer.setVisible(false);
        this.movesContainer.add(this.extraMoveRowContainer);

        const extraRowOverlay = globalScene.add.image(-2, 1, "summary_moves_overlay_row");
        extraRowOverlay.setOrigin(0, 1);
        this.extraMoveRowContainer.add(extraRowOverlay);

        const extraRowText = addTextObject(
          35,
          0,
          this.summaryUiMode === SummaryUiMode.LEARN_MOVE && this.newMove
            ? this.newMove.name
            : i18next.t("pokemonSummary:cancel"),
          this.summaryUiMode === SummaryUiMode.LEARN_MOVE ? TextStyle.SUMMARY_PINK : TextStyle.SUMMARY,
        );
        extraRowText.setOrigin(0, 1);
        this.extraMoveRowContainer.add(extraRowText);

        if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE) {
          this.extraMoveRowContainer.setVisible(true);

          if (this.newMove && this.pokemon) {
            const spriteKey = getLocalizedSpriteKey("types");
            const moveType = this.pokemon.getMoveType(this.newMove);
            const newMoveTypeIcon = globalScene.add.sprite(0, 0, spriteKey, PokemonType[moveType].toLowerCase());
            newMoveTypeIcon.setOrigin(0, 1);
            this.extraMoveRowContainer.add(newMoveTypeIcon);
          }
          const ppOverlay = globalScene.add.image(177, -5, getLocalizedSpriteKey("summary_moves_overlay_pp")); // Pixel text 'PP'
          ppOverlay.setOrigin(1, 0.5);
          this.extraMoveRowContainer.add(ppOverlay);

          const pp = padInt(this.newMove?.pp!, 2, "  "); // TODO: is this bang correct?
          const ppText = addTextObject(178, 1, `${pp}/${pp}`, TextStyle.WINDOW);
          ppText.setOrigin(0, 1);
          this.extraMoveRowContainer.add(ppText);
        }

        this.moveRowsContainer = globalScene.add.container(0, 0);
        this.movesContainer.add(this.moveRowsContainer);

        for (let m = 0; m < maxMoveRows; m++) {
          const moveRowContainer = globalScene.add.container(0, 16 * m);
          this.moveRowsContainer.add(moveRowContainer);

          // Resolve this row's move + type + PP text. In preview mode the move is
          // an evolution's Move (full PP, own type); otherwise the live PokemonMove.
          let moveName = "-";
          let moveType: PokemonType | null = null;
          let ppLabel = "--/--";
          if (movesViewSet) {
            const previewId = movesViewSet.moveIds[m];
            const previewMove = previewId == null ? null : allMoves[previewId];
            if (previewMove) {
              moveName = previewMove.name;
              moveType = previewMove.type;
              ppLabel = `${padInt(previewMove.pp, 2, "  ")}/${padInt(previewMove.pp, 2, "  ")}`;
            }
          } else {
            const move = this.pokemon && this.pokemon.moveset.length > m ? this.pokemon.moveset[m] : null;
            if (move && this.pokemon) {
              moveName = move.getName();
              moveType = this.pokemon.getMoveType(move.getMove());
              const maxPP = move.getMovePp();
              ppLabel = `${padInt(maxPP - move.ppUsed, 2, "  ")}/${padInt(maxPP, 2, "  ")}`;
            }
          }

          if (moveType != null) {
            const spriteKey = getLocalizedSpriteKey("types");
            const typeIcon = globalScene.add.sprite(0, 0, spriteKey, PokemonType[moveType].toLowerCase());
            typeIcon.setOrigin(0, 1);
            moveRowContainer.add(typeIcon);
          }

          const moveText = addTextObject(35, 0, moveName, TextStyle.SUMMARY);
          moveText.setOrigin(0, 1);
          moveRowContainer.add(moveText);

          const ppOverlay = globalScene.add.image(177, -5, getLocalizedSpriteKey("summary_moves_overlay_pp")); // Pixel text 'PP'
          ppOverlay.setOrigin(1, 0.5);
          moveRowContainer.add(ppOverlay);

          const ppText = addTextObject(178, 1, ppLabel, TextStyle.WINDOW);
          ppText.setOrigin(0, 1);
          moveRowContainer.add(ppText);
        }

        this.moveDescriptionText = addTextObject(2, 84, "", TextStyle.WINDOW_ALT, { wordWrap: { width: 1212 } });
        this.movesContainer.add(this.moveDescriptionText);

        // ER Omniform preview: label the previewed moveset. The fallback set (no
        // per-evolution moveset model yet) is flagged "(base)" so it reads as a
        // level-up approximation rather than a curated kit.
        if (movesViewEntry && movesViewSet) {
          this.moveDescriptionText.setText(
            movesViewSet.isBaseFallback
              ? i18next.t("pokemonSummary:omniformMovesetBasePreview", {
                  name: movesViewEntry.name,
                  defaultValue: `Previewing ${movesViewEntry.name} (base level-up moves).`,
                })
              : i18next.t("pokemonSummary:omniformMovesetPreview", {
                  name: movesViewEntry.name,
                  defaultValue: `Previewing ${movesViewEntry.name} moveset.`,
                }),
          );
        }

        // ER: second column for the property pages. Fixed x so the right column
        // lines up cleanly (the pixel font is variable-width, so space-padding the
        // left column can't align it). Hidden for the description page.
        this.moveDetailCol2Text = addTextObject(116, 84, "", TextStyle.WINDOW_ALT).setVisible(false);
        this.movesContainer.add(this.moveDetailCol2Text);

        // ER: prominent dynamic header for the cyclable move-detail, placed where
        // the static "DESCRIPTIONS" banner is (which we hide while this shows), so
        // the player clearly sees the current page + that the info (C) button
        // cycles, e.g. "[C] ▶ Mechanics  2/4".
        this.moveDetailPageLabel = addTextObject(2, 79, "", TextStyle.MOVE_INFO_CONTENT)
          .setOrigin(0, 0.5)
          .setVisible(false);
        this.movesContainer.add(this.moveDetailPageLabel);

        const moveDescriptionTextMaskRect = globalScene.make.graphics({});
        moveDescriptionTextMaskRect.setScale(6);
        moveDescriptionTextMaskRect.fillStyle(0xffffff);
        moveDescriptionTextMaskRect.beginPath();
        moveDescriptionTextMaskRect.fillRect(112, 130, 202, 46);

        const moveDescriptionTextMask = moveDescriptionTextMaskRect.createGeometryMask();

        this.moveDescriptionText.setMask(moveDescriptionTextMask);
        this.moveDetailCol2Text?.setMask(moveDescriptionTextMask);
        break;
      }
    }
  }

  showStatus(instant?: boolean) {
    if (this.statusVisible) {
      return;
    }
    this.statusVisible = true;
    globalScene.tweens.add({
      targets: this.statusContainer,
      x: 0,
      duration: instant ? 0 : 250,
      ease: "Sine.easeOut",
    });
  }

  hideStatus(instant?: boolean) {
    if (!this.statusVisible) {
      return;
    }
    this.statusVisible = false;
    globalScene.tweens.add({
      targets: this.statusContainer,
      x: -106,
      duration: instant ? 0 : 250,
      ease: "Sine.easeIn",
    });
  }

  /**
   * Row index of the LEARN_MOVE "new move" (a.k.a. cancel) entry on the moves
   * page. This sits just below the existing move rows, so it equals the
   * Pokémon's move cap — 4 normally, 5 if it has ER's extra move slot.
   */
  private getNewMoveRowIndex(): number {
    return this.pokemon?.getMaxMoveCount() ?? 4;
  }

  getSelectedMove(): Move | null {
    if (this.cursor !== Page.MOVES) {
      return null;
    }

    if (this.moveCursor < this.getNewMoveRowIndex() && this.pokemon && this.moveCursor < this.pokemon.moveset.length) {
      return this.pokemon.moveset[this.moveCursor].getMove();
    }
    if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE && this.moveCursor === this.getNewMoveRowIndex()) {
      return this.newMove;
    }
    return null;
  }

  showMoveSelect() {
    this.moveSelect = true;
    this.extraMoveRowContainer.setVisible(true);
    this.selectedMoveIndex = -1;
    this.moveDetailPage = 0; // each move starts on the description page
    this.setCursor(this.summaryUiMode === SummaryUiMode.LEARN_MOVE ? this.getNewMoveRowIndex() : 0);
    this.showMoveEffect();
  }

  /**
   * ER: render the current move-detail page into the description strip + the
   * page indicator. Page 0 is the description text; pages 1-3 are label/value
   * property rows derived from the move's real wiring ({@linkcode getErMoveDetailPages}).
   */
  private renderMoveDetail(move: Move | null): void {
    if (!move) {
      this.moveDescriptionText.setText("");
      this.moveDetailCol2Text?.setVisible(false);
      this.moveDetailPageLabel?.setVisible(false);
      this.movesContainerDescriptionsTitle?.setVisible(true);
      return;
    }
    const pages = getErMoveDetailPages(move);
    const pageIndex = Math.min(this.moveDetailPage, pages.length - 1);
    const page = pages[pageIndex];

    // Replace the static "DESCRIPTIONS" banner with a dynamic page + cycle hint so
    // the player sees the current page name and that the info (C) button cycles.
    this.movesContainerDescriptionsTitle?.setVisible(false);
    this.moveDetailPageLabel?.setText(`[C] ▶ ${page.title}  ${pageIndex + 1}/${pages.length}`).setVisible(true);

    if (page.description === undefined) {
      // Two columns so all four property rows are visible at a glance (no scroll).
      // Left column = rows 0/2, right column = rows 1/3, each in its own fixed-x
      // text object so they align despite the variable-width pixel font.
      const rows = page.rows ?? [];
      const cell = (r?: MoveDetailRow): string => (r ? `${r.label}: ${r.value}` : "");
      this.moveDescriptionText.setText(`${cell(rows[0])}\n${cell(rows[2])}`.trimEnd());
      this.moveDetailCol2Text?.setText(`${cell(rows[1])}\n${cell(rows[3])}`.trimEnd()).setVisible(true);
    } else {
      this.moveDescriptionText.setText(page.description || "");
      this.moveDetailCol2Text?.setVisible(false);
    }
  }

  /** ER: cycle the move-detail page (info button) and re-render the current move. */
  private cycleMoveDetail(): void {
    this.moveDetailPage = (this.moveDetailPage + 1) % 4;
    // Re-run the cursor refresh so the description scroll recomputes for the new
    // page's text; renderMoveDetail (called within) uses the new moveDetailPage.
    this.setCursor(this.moveCursor, true);
  }

  hideMoveSelect() {
    if (this.summaryUiMode === SummaryUiMode.LEARN_MOVE) {
      this.moveSelectFunction?.(this.getNewMoveRowIndex());
      return;
    }

    this.moveSelect = false;
    this.extraMoveRowContainer.setVisible(false);
    this.moveDescriptionText.setText("");
    this.moveDetailCol2Text?.setVisible(false);
    this.moveDetailPageLabel?.setVisible(false);
    this.movesContainerDescriptionsTitle?.setVisible(true);
    this.moveDetailPage = 0;

    this.destroyBlinkCursor();
    this.hideMoveEffect();
  }

  destroyBlinkCursor() {
    if (this.moveCursorBlinkTimer) {
      this.moveCursorBlinkTimer.destroy();
      this.moveCursorBlinkTimer = null;
    }
    if (this.moveCursorObj) {
      this.moveCursorObj.destroy();
      this.moveCursorObj = null;
    }
    if (this.selectedMoveCursorObj) {
      this.selectedMoveCursorObj.destroy();
      this.selectedMoveCursorObj = null;
    }
  }

  showMoveEffect(instant?: boolean) {
    if (this.moveEffectsVisible) {
      return;
    }
    this.moveEffectsVisible = true;
    globalScene.tweens.add({
      targets: this.moveEffectContainer,
      x: 6,
      duration: instant ? 0 : 250,
      ease: "Sine.easeOut",
    });
  }

  hideMoveEffect(instant?: boolean) {
    if (!this.moveEffectsVisible) {
      return;
    }
    this.moveEffectsVisible = false;
    globalScene.tweens.add({
      targets: this.moveEffectContainer,
      x: 106,
      duration: instant ? 0 : 250,
      ease: "Sine.easeIn",
    });
  }

  /**
   * Elite Redux ABILITIES page. Renders the main Ability plus all 3 innate
   * slots, stacked vertically. Every innate is ALWAYS shown — even when
   * locked — with a lock/disabled icon and a one-line reason, so the player
   * can read descriptions and plan before unlocking. Mirrors the ER ROM
   * ability page (Ability + Innate rows with abbreviated descriptions).
   *
   * Lock states (player pokemon, from candy-unlock `passiveAttr`):
   *   - not candy-unlocked  → lock icon  + "Locked — unlock with candy"
   *   - unlocked but toggled off → stop icon + "Disabled"
   *   - unlocked + enabled  → no icon (active)
   * Enemy pokemon additionally gate innate slots by level (slot 2 @ Lv15,
   * slot 3 @ Lv24) — shown as a level lock when inspecting an enemy.
   */
  private populateAbilitiesPage(pageContainer: Phaser.GameObjects.Container, pageBg: Phaser.GameObjects.Sprite): void {
    // #443: harden against any throw while resolving/laying out a mon's
    // ability + innate rows (reported as a hard crash on a freshly-evolved
    // Gholdengo and a garbled screen on Bloodmoon Ursaluna). Keep the partial
    // page rather than crashing the summary UI; log the culprit for a real fix.
    this.abilitiesRows = [];
    this.abilitiesRowCount = 0;
    try {
      this.populateAbilitiesPageInner(pageContainer, pageBg);
    } catch (err) {
      console.error("[summary] populateAbilitiesPage failed for", this.pokemon?.species?.name, err);
    }
  }

  private populateAbilitiesPageInner(
    pageContainer: Phaser.GameObjects.Container,
    pageBg: Phaser.GameObjects.Sprite,
  ): void {
    // ER Omniform: when a NON-current evolution is selected in the header strip,
    // source the panel's abilities from THAT evolution's registration (view-only).
    // `viewOnly` suppresses candy/level lock chrome (it is the browsed mon's,
    // meaningless for a previewed evolution). The strip lives in the top header
    // bar, so it reserves NO space here (a 5-ability screen never overlaps it).
    const viewEntry = this.getOmniformViewEntry();
    const viewOnly = viewEntry != null;
    const viewAbilities = viewEntry ? getEvolutionAbilities(viewEntry) : null;

    const container = globalScene.add.container(0, -pageBg.height);
    pageContainer.add(container);

    const mon = this.pokemon;
    if (!mon) {
      return;
    }

    // Resolve the candy-unlock bitmask for this mon's starter (root species).
    const rootSpeciesId = mon.species.getRootSpeciesId();
    const passiveAttr = globalScene.gameData.starterData[rootSpeciesId]?.passiveAttr ?? 0;

    // Enemy innate level gate (slot 2 @ Lv15, slot 3 @ Lv24) — only enemies
    // are level-gated in this port; players get all slots.
    const isEnemy = mon.isEnemy?.() === true;
    const enemyLevelForSlot = [0, 15, 24];
    // ER Giratina's Bargain - Curiosity (#544): slots the player sealed for this run
    // (ER slot index 0 = active ability, innateSlot + 1 = innate). Player-only,
    // matching the battle gate in Pokemon.canApplyAbility.
    const isPlayerMon = mon.isPlayer?.() === true;
    const runLocked = (abilitySlot: number): boolean =>
      isPlayerMon && mon.customPokemonData?.erLockedAbilitySlots?.includes(abilitySlot) === true;

    interface Row {
      label: string;
      ability: Ability;
      /** undefined for the main ability (always active). */
      slot?: PassiveSlot;
      /** ER Black Shiny gift row — distinct styling, never locked. */
      gift?: boolean;
    }
    const rows: Row[] = [];

    const mainAbility = viewAbilities ? viewAbilities.active : mon.getAbility(true);
    if (mainAbility) {
      rows.push({ label: i18next.t("pokemonSummary:abilityLabel"), ability: mainAbility });
    }

    // All 3 innate slots from the POKEMON-level resolver (not the species-level
    // one): it honors per-Pokémon overrides written by the Ability Randomizer
    // (`customPokemonData.passive/passive2/passive3`) and transform overrides,
    // so the page reflects runtime ability changes rather than static species data.
    // When previewing an evolution, source its registered innate triple instead.
    const innateAbilities = viewAbilities ? viewAbilities.innates : mon.getPassiveAbilities();
    for (let slot = 0; slot < 3; slot++) {
      const ability = innateAbilities[slot];
      if (ability == null || ability.id === AbilityId.NONE) {
        continue;
      }
      rows.push({
        label: i18next.t("pokemonSummary:innateLabel"),
        ability,
        slot: slot as PassiveSlot,
      });
    }

    // ER Black Shinies (#349): the GIFT row — the 5th, switchable ability.
    // Shown ONLY for black shinies (conditional UI per the maintainer spec),
    // rendered in a distinct bold-italic style and never candy-locked. Skipped
    // while previewing an evolution (the gift belongs to the live mon).
    if (!viewOnly && isErBlackShiny(mon)) {
      const giftId = getErActiveGiftAbilityId(mon);
      const gift = giftId === null ? null : allAbilities[giftId];
      if (gift) {
        const choices = mon.customPokemonData.erGiftAbilities.length;
        const idx = (mon.customPokemonData.erGiftIndex ?? 0) + 1;
        rows.push({
          // ER (#349): R (keyboard) / RB (controller) / the on-screen apad button
          // cycle the player's own gift between its 3 choices. The prompt is drawn
          // as a real "R" key-badge sprite on the row header (see below), not baked
          // into the label text, so it reads as an actual button.
          label: `Gift ${idx}/${choices}`,
          ability: gift,
          gift: true,
        });
      }
    }

    // Fixed even grid (matches the ER ROM's clean N-row separation). Panel is
    // 214x159 (summary_profile frame). Each row: an accent header bar with the
    // aligned label + name, then the abbreviated description below.
    const panelW = pageBg.width; // 214
    const panelH = pageBg.height; // 159
    const rowH = Math.floor((panelH - 4) / Math.max(rows.length, 1));
    const headerH = 13;
    const labelX = 5;
    const nameX = 72;

    this.abilitiesRows = [];
    this.abilitiesRowCount = rows.length;
    this.giftCycleBadge = null;
    if (this.abilitiesCursor >= rows.length) {
      this.abilitiesCursor = 0;
    }

    rows.forEach((row, i) => {
      const top = 2 + i * rowH;

      // Lock state.
      let locked = false;
      let lockIconKey: string | null = null;
      let reason = "";
      // ER Omniform preview: a browsed evolution's kit is view-only, so no
      // candy/level/seal lock chrome applies (it is the live mon's state).
      if (viewOnly) {
        // no lock — fall through to the neutral render below
      } else if (runLocked(row.slot === undefined ? 0 : row.slot + 1)) {
        locked = true;
        lockIconKey = "icon_lock";
        reason = i18next.t("pokemonSummary:abilitySealedRun");
      } else if (row.slot !== undefined) {
        const unlocked = isSlotUnlocked(passiveAttr, row.slot);
        const enabled = isSlotEnabled(passiveAttr, row.slot);
        const levelReq = isEnemy ? enemyLevelForSlot[row.slot] : 0;
        const levelLocked = isEnemy && mon.level < levelReq;
        // Player FREE-innate slots, mirroring the in-battle innate panel
        // (battle-info-overlay): the Youngster level ramp, Daily runs, an Innate
        // Shrine attunement, and a TRUANT innate (a nerf) are live for free this
        // run - NOT candy-gated. Without this the summary screen wrongly showed
        // "unlock with candy" for innates that are actually active (the Youngster
        // "shows all 4 but not unlocked" report).
        const freeInnate =
          !isEnemy
          && (row.slot < erYoungsterFreeInnateSlots(mon.level)
            || globalScene.gameMode?.isDaily === true
            || mon.customPokemonData?.erInnateShrineUnlocked === true
            || row.ability?.id === AbilityId.TRUANT);
        if (levelLocked) {
          locked = true;
          lockIconKey = "icon_lock";
          reason = i18next.t("pokemonSummary:innateLockedLevel", { level: levelReq });
        } else if (freeInnate) {
          // live for free this run - not locked
        } else if (!unlocked && !isEnemy) {
          locked = true;
          lockIconKey = "icon_lock";
          reason = i18next.t("pokemonSummary:innateLockedCandy");
        } else if (!enabled && !isEnemy) {
          locked = true;
          lockIconKey = "icon_stop";
          reason = i18next.t("pokemonSummary:innateDisabled");
        }
      }

      // Accent header bar spanning the panel width.
      const bar = globalScene.add.rectangle(1, top, panelW - 2, headerH, 0x4a4a63, 1).setOrigin(0, 0);
      container.add(bar);

      const labelText = addTextObject(labelX, top + 1, row.label, TextStyle.SUMMARY_GOLD, { fontSize: "64px" });
      labelText.setOrigin(0, 0);
      container.add(labelText);

      const nameText = addTextObject(nameX, top + 1, row.ability?.name ?? "", TextStyle.SUMMARY, { fontSize: "64px" });
      nameText.setOrigin(0, 0);
      nameText.setColor(getTextColor(locked ? TextStyle.SUMMARY_GRAY : TextStyle.SUMMARY));
      if (row.gift) {
        // ER Black Shinies (#349): the gift renders in a distinct cursive/bold
        // face so it reads as the special 5th slot.
        nameText.setFontStyle("bold italic");
        nameText.setColor("#e8d8ff");
        // Only the OWNER can cycle the gift, so the "R" key-badge prompt is drawn
        // for player-owned mons only (an enemy black shiny shows the gift row but
        // no cycle prompt). Same keyboard-atlas key-badge idiom as the Omniform F
        // badge; RB (controller) and the #apadGiftAbility on-screen button map to
        // the same Button.CYCLE_SHINY.
        if (isPlayerMon) {
          const badge = globalScene.add
            .sprite(panelW - 4, top + Math.floor(headerH / 2), "keyboard", "R.png")
            .setOrigin(1, 0.5);
          container.add(badge);
          this.giftCycleBadge = badge;
        }
      }
      container.add(nameText);

      if (lockIconKey) {
        const icon = globalScene.add.sprite(panelW - 10, top + headerH / 2, lockIconKey);
        icon.setOrigin(1, 0.5).setScale(0.4);
        container.add(icon);
      }

      // Description (abbreviated ER text). On the light page area below the bar.
      const erShortDesc = getErAbilityDescription(row.ability.id) ?? row.ability?.description ?? "";
      const descText = addTextObject(labelX, top + headerH + 1, erShortDesc, TextStyle.WINDOW_ALT, {
        fontSize: "48px",
        wordWrap: { width: 1230 },
      });
      descText.setOrigin(0, 0);
      descText.setColor(getTextColor(locked ? TextStyle.SUMMARY_GRAY : TextStyle.WINDOW_ALT));
      container.add(descText);

      if (reason) {
        const reasonText = addTextObject(
          labelX,
          top + headerH + descText.displayHeight + 1,
          reason,
          TextStyle.SUMMARY_RED,
          {
            fontSize: "42px",
          },
        );
        reasonText.setOrigin(0, 0);
        container.add(reasonText);
      }

      this.abilitiesRows.push({ ability: row.ability, y: top, locked });
    });

    // Selection cursor + "Ⓐ Detail" prompt over the selected row.
    this.abilitiesCursorObj = globalScene.add
      .nineslice(0, 0, "select_cursor", undefined, panelW - 2, headerH + 2, 1, 1, 1, 1)
      .setOrigin(0, 0)
      .setVisible(false);
    container.add(this.abilitiesCursorObj);

    this.abilitiesDetailPrompt = addTextObject(
      panelW - 4,
      -11,
      i18next.t("pokemonSummary:abilityDetailPrompt"),
      TextStyle.SUMMARY,
      { fontSize: "48px" },
    );
    this.abilitiesDetailPrompt.setOrigin(1, 1);
    container.add(this.abilitiesDetailPrompt);

    this.refreshAbilitiesCursor();
  }

  /** Reposition the ABILITIES-page selection cursor on the active row. */
  private refreshAbilitiesCursor(): void {
    if (!this.abilitiesCursorObj || this.abilitiesRows.length === 0) {
      return;
    }
    const row = this.abilitiesRows[Math.min(this.abilitiesCursor, this.abilitiesRows.length - 1)];
    // The cursor + "Ⓐ Detail" prompt only show while in ability-selection mode;
    // in the default browsing mode Up/Down switch party members.
    this.abilitiesCursorObj.setPosition(0, row.y - 1).setVisible(this.abilitiesSelectMode);
    this.abilitiesDetailPrompt?.setVisible(this.abilitiesSelectMode);
  }

  /**
   * Open the full-screen detail overlay for the currently-selected ability
   * (ER ROM "Detail" view): ability name header + expanded description.
   */
  private openAbilityDetail(): void {
    if (this.abilitiesDetailContainer || this.abilitiesRows.length === 0) {
      return;
    }
    const row = this.abilitiesRows[Math.min(this.abilitiesCursor, this.abilitiesRows.length - 1)];
    const ability = row.ability;

    // Cover only the right page panel (214x159 at summaryPageContainer's
    // x=106), keeping the mon box visible — matches the ER ROM detail view.
    const panelW = 214;
    const panelH = 159;
    const c = globalScene.add.container(106, -panelH);

    // Fully opaque scrim, slightly oversized, covering the whole page panel
    // so the ability list underneath is hidden completely.
    const scrim = globalScene.add.rectangle(-2, -2, panelW + 4, panelH + 4, 0x1a1a2e, 1).setOrigin(0, 0);
    c.add(scrim);

    // Name header bar.
    const headerBar = globalScene.add.rectangle(3, 5, panelW - 6, 16, 0x4a4a63, 1).setOrigin(0, 0);
    c.add(headerBar);
    const nameHeader = addTextObject(7, 6, ability.name, TextStyle.SUMMARY_GOLD, { fontSize: "70px" });
    nameHeader.setOrigin(0, 0);
    c.add(nameHeader);

    // Expanded description: prefer the full in-game ROM text (extracted from
    // v2.65.3b), then the short ER desc, then pokerogue's own description.
    const baseDesc =
      getErAbilityRomDescription(ability.name) ?? getErAbilityDescription(ability.id) ?? ability.description ?? "";
    // For composite abilities (which carry only the short composite line in ROM),
    // append the constituent abilities' detailed descriptions back-to-back so the
    // detail view explains what each half actually does.
    const compositeDetail = getErCompositeDetailedDescription(ability.id);
    const longDesc = compositeDetail ? `${baseDesc}\n\n${compositeDetail}`.trim() : baseDesc;
    const descText = addTextObject(7, 28, longDesc, TextStyle.WINDOW_ALT, {
      fontSize: "64px",
      wordWrap: { width: 1230 },
    });
    descText.setOrigin(0, 0);
    c.add(descText);

    const backHint = addTextObject(
      panelW - 6,
      panelH - 6,
      i18next.t("pokemonSummary:abilityDetailBack"),
      TextStyle.SUMMARY,
      {
        fontSize: "44px",
      },
    );
    backHint.setOrigin(1, 1);
    c.add(backHint);

    this.summaryContainer.add(c);
    this.abilitiesDetailContainer = c;
  }

  /** Close the ability detail overlay. */
  private closeAbilityDetail(): void {
    if (this.abilitiesDetailContainer) {
      this.abilitiesDetailContainer.destroy();
      this.abilitiesDetailContainer = null;
    }
  }

  private startShinyLabSummaryFxTimer(): void {
    if (this.shinyLabFxTimer) {
      return;
    }
    this.shinyLabFxTimer = globalScene.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (!this.summaryContainer.visible || !this.pokemon) {
          return;
        }
        this.refreshShinyLabSummaryFx();
      },
    });
  }

  private stopShinyLabSummaryFxTimer(): void {
    this.shinyLabFxTimer?.remove();
    this.shinyLabFxTimer = null;
  }

  /** Lazily build the owned animated Name-FX overlay for the summary name. */
  private getNameFx(): ErShinyLabNameFx {
    if (!this.nameFx) {
      this.nameFx = new ErShinyLabNameFx();
    }
    return this.nameFx;
  }

  private ensureShinyLabSummarySpriteLoaded(source: ErShinyLabSpriteSourceRef): void {
    if (globalScene.textures.exists(source.key)) {
      ensureErSpriteAnim(source.key);
      return;
    }
    if (!source.atlasPath || this.shinyLabSummarySpriteLoadKey === source.key) {
      return;
    }

    this.shinyLabSummarySpriteLoadKey = source.key;
    const completeEvent = `filecomplete-atlasjson-${source.key}`;
    const cleanup = (): void => {
      globalScene.load.off(completeEvent, onComplete);
      globalScene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      if (this.shinyLabSummarySpriteLoadKey === source.key) {
        this.shinyLabSummarySpriteLoadKey = null;
      }
    };
    const refresh = (): void => {
      if (!this.pokemon || !this.summaryContainer.visible) {
        return;
      }
      ensureErSpriteAnim(source.key);
      if (globalScene.anims.exists(source.key)) {
        this.pokemonSprite.play(source.key);
      } else if (globalScene.textures.exists(source.key)) {
        this.pokemonSprite.setTexture(source.key);
      }
      this.refreshShinyLabSummaryFx();
    };
    const onComplete = (): void => {
      cleanup();
      refresh();
    };
    const onError = (file: Phaser.Loader.File): void => {
      if (file.key !== source.key) {
        return;
      }
      cleanup();
    };

    globalScene.load.on(completeEvent, onComplete);
    globalScene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    globalScene.loadPokemonAtlas(source.key, source.atlasPath);
    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }

    // The atlas may already have landed via another request between the initial
    // texture check and listener registration.
    if (globalScene.textures.exists(source.key)) {
      cleanup();
      refresh();
    }
  }

  private refreshShinyLabSummaryFx(): void {
    if (!this.pokemon || !this.shinyLabFxOverlay) {
      return;
    }
    const look = getErShinyLabSpriteFxLookForPokemon(this.pokemon);
    if (!hasErShinyLabAnySpriteFx(look)) {
      this.shinyLabFxOverlay.hide();
      this.stopShinyLabSummaryFxTimer();
      return;
    }

    const baseSource = getErShinyLabPokemonSpriteSource(this.pokemon, true, look);
    const frame = this.pokemonSprite.texture.key === baseSource.key ? this.pokemonSprite.frame?.name : null;
    const source = frame == null ? baseSource : { ...baseSource, frame };
    if (this.shinyLabFxOverlay.refresh(look, source, getErShinyLabSpriteFxTime())) {
      this.pokemonSprite.setVisible(false);
      if (hasErShinyLabExactSpriteFx(look)) {
        this.startShinyLabSummaryFxTimer();
      } else {
        this.stopShinyLabSummaryFxTimer();
      }
    } else {
      this.shinyLabFxOverlay.hide();
      this.stopShinyLabSummaryFxTimer();
    }
  }

  /**
   * Advance the ability-cycle on the PROFILE page by one step. Order:
   *   index 0 = ability
   *   index 1 = passive slot 0
   *   index 2 = passive slot 1
   *   index 3 = passive slot 2
   * Empty passive slots (`AbilityId.NONE`) are skipped — for a vanilla species
   * with one passive this collapses to the legacy 2-step ability↔passive toggle.
   *
   * Visibility invariant: exactly one container is visible at a time. We hide
   * the current container, advance the cursor to the next non-null container,
   * then show that one.
   */
  private advanceAbilityCycle(): void {
    // Build the visible cycle: [ability, passive[0], passive[1], passive[2]]
    // with null entries pruned. `passiveContainers` already has nulls for empty
    // slots; we just prepend abilityContainer.
    const cycle: AbilityContainer[] = [
      this.abilityContainer,
      ...this.passiveContainers.filter((c): c is AbilityContainer => c !== null),
    ];
    // No passives → toggle is a no-op (vanilla pokerogue UX preserved when
    // hasPassive() is false but we got here defensively).
    if (cycle.length < 2) {
      return;
    }
    const current = cycle[this.abilityCycleIndex % cycle.length];
    this.abilityCycleIndex = (this.abilityCycleIndex + 1) % cycle.length;
    const next = cycle[this.abilityCycleIndex];

    // Hide current, show next. All ability containers share the same (x, y)
    // anchor in the profile panel — only one visible at a time prevents the
    // overlap that would otherwise occur with multi-passive species.
    current.labelImage.setVisible(false);
    current.nameText?.setVisible(false);
    current.descriptionText?.setVisible(false);

    next.labelImage.setVisible(true);
    next.nameText?.setVisible(true);
    next.descriptionText?.setVisible(true);
  }

  clear() {
    super.clear();
    this.pokemon = null;
    this.cursor = -1;
    this.newMove = null;
    if (this.moveSelect) {
      this.moveSelect = false;
      this.moveSelectFunction = null;
      this.extraMoveRowContainer.setVisible(false);
      if (this.moveCursorBlinkTimer) {
        this.moveCursorBlinkTimer.destroy();
        this.moveCursorBlinkTimer = null;
      }
      if (this.moveCursorObj) {
        this.moveCursorObj.destroy();
        this.moveCursorObj = null;
      }
      if (this.selectedMoveCursorObj) {
        this.selectedMoveCursorObj.destroy();
        this.selectedMoveCursorObj = null;
      }
      this.hideMoveEffect(true);
    }
    // Tear down ER ABILITIES-page detail overlay + reset its state.
    this.closeAbilityDetail();
    this.abilitiesRows = [];
    this.abilitiesRowCount = 0;
    this.abilitiesSelectMode = false;
    this.abilitiesCursorObj = null;
    this.abilitiesDetailPrompt = null;
    this.giftCycleBadge = null;
    this.stopShinyLabSummaryFxTimer();
    this.shinyLabFxOverlay?.hide(false);
    this.nameFx?.destroy();
    this.nameFx = undefined;
    // ER Omniform: tear down the evolution strip + reset its view state.
    this.destroyOmniformStrip();
    this.omniformEvolutions = [];
    this.omniformViewIndex = 0;
    this.summaryContainer.setVisible(false);
    this.summaryPageContainer.setVisible(false);
  }
}
