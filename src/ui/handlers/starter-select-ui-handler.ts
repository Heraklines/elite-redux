import type { Ability } from "#abilities/ability";
import { PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import { getCoopBrowserCommanderFixtureStarters, getCoopBrowserFaintFixtureStarters } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { starterColors } from "#app/global-vars/starter-colors";
import Overrides from "#app/overrides";
import { handleTutorial, Tutorial } from "#app/tutorial";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import {
  getErPassiveSlotCandyCost,
  getPassiveCandyCount,
  getSameSpeciesEggCandyCounts,
  getStarterValueFriendshipCap,
  getValueReductionCandyCounts,
  POKERUS_STARTER_COUNT,
  speciesStarterCosts,
} from "#balance/starters";
import { allAbilities, allMoves, allSpecies, modifierTypes } from "#data/data-lists";
import { Egg, getEggTierForSpecies, MAX_EGG_COUNT } from "#data/egg";
import { COOP_STARTER_COST_BUDGET } from "#data/elite-redux/coop/coop-roster";
import { getCoopController } from "#data/elite-redux/coop/coop-runtime";
import { COOP_SLOTS_PER_PLAYER } from "#data/elite-redux/coop/coop-session";
import { matchesAbilityText } from "#data/elite-redux/er-ability-search";
import { resetErAchievementRunState } from "#data/elite-redux/er-achievement-run-state";
import { ER_BLACK_SHINY_TINT } from "#data/elite-redux/er-black-shinies";
import { clearForcedCommunityDifficulty, getForcedCommunityDifficulty } from "#data/elite-redux/er-community-run-state";
import { resetErCustomTrainerTracking } from "#data/elite-redux/er-custom-trainers";
import { ensureErSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import { resetErGhostRunState } from "#data/elite-redux/er-ghost-teams";
import { addTreasureFragments, resetErMapNodes } from "#data/elite-redux/er-map-nodes";
import { resetErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { type ErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { buildErShinyLabConfig } from "#data/elite-redux/er-shiny-lab-config";
import {
  decodeErShinyLabLoadout,
  decodeErShinyLabParams,
  type ErShinyLabLoadout,
  type ErShinyLabParams,
  getErShinyLabOwnedSet,
  sanitizeErShinyLabLoadout,
} from "#data/elite-redux/er-shiny-lab-effects";
import {
  type ErShinyLabRenderedPixels,
  type ErShinyLabSourcePixels,
  renderErShinyLabLook,
} from "#data/elite-redux/er-shiny-lab-renderer";
import { resetErRunTrainerTracking } from "#data/elite-redux/er-trainer-runtime-hook";
import { copyTextToClipboard } from "#data/elite-redux/showdown/showdown-clipboard";
import { isMegaStage, listEvolutionStages, listMegaStages } from "#data/elite-redux/showdown/showdown-evolutions";
import { SHOWDOWN_ITEM_POOL, type ShowdownItemKey } from "#data/elite-redux/showdown/showdown-item-pool";
import { collectShowdownLegalMoves, collectUnlockedEggMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import { buildUnlockSnapshot, starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
import { getShowdownPickWaitMs } from "#data/elite-redux/showdown/showdown-session";
import { exportShowdownSet, importShowdownSet } from "#data/elite-redux/showdown/showdown-set-codec";
import { getLastUsedSet, rememberLastUsedSet } from "#data/elite-redux/showdown/showdown-species-sets";
import {
  COST_CAP,
  HIGH_COST_MIN,
  MEGA_STONE_ITEM,
  type ShowdownMonManifest,
  showdownFieldLegalityReason,
  validateShowdownTeam,
} from "#data/elite-redux/showdown/showdown-team";
import { GrowthRate, getGrowthRateColor } from "#data/exp";
import { Gender, getGenderColor, getGenderSymbol } from "#data/gender";
import { getNatureName } from "#data/nature";
import { pokemonFormChanges } from "#data/pokemon-forms";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityAttr } from "#enums/ability-attr";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { Device } from "#enums/devices";
import { DexAttr } from "#enums/dex-attr";
import { DropDownColumn } from "#enums/drop-down-column";
import { EggSourceType } from "#enums/egg-source-types";
import { GameModes } from "#enums/game-modes";
import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";
import { Passive as PassiveAttr } from "#enums/passive";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { UiTheme } from "#enums/ui-theme";
import type { CandyUpgradeNotificationChangedEvent } from "#events/battle-scene";
import { BattleSceneEventType } from "#events/battle-scene";
import { ErShinyLabNameFx } from "#sprites/er-shiny-lab-name-fx";
import {
  applyErShinyLabSpriteFxTexture,
  clearErShinyLabSpriteFxTexture,
  ER_SHINY_LAB_MINI_ICON_RENDER_PAD,
  erShinyLabSpriteFxStateKey,
  getErShinyLabNameStyleForSpecies,
  getErShinyLabSavedLookForSpecies,
  getErShinyLabSpeciesIconSource,
  getErShinyLabSpriteFxLookForSpecies,
  hasErShinyLabAnySpriteFx,
  hasErShinyLabExactSpriteFx,
  readErShinyLabSpriteSourcePixels,
} from "#sprites/er-shiny-lab-sprite-fx";
import type { Variant } from "#sprites/variant";
import {
  ensureErShinyLabPaletteVariantCache,
  getErShinyLabPaletteIdForSpecies,
  getVariantIcon,
  getVariantTint,
} from "#sprites/variant";
import { achvs } from "#system/achv";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { SettingKeyboard } from "#system/settings-keyboard";
import type { DexEntry } from "#types/dex-data";
import type { LevelMoves } from "#types/pokemon-level-moves";
import type { Starter, StarterAttributes, StarterDataEntry, StarterMoveset } from "#types/save-data";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { DropDown, DropDownLabel, DropDownOption, DropDownState, DropDownType, SortCriteria } from "#ui/dropdown";
import { FilterBar } from "#ui/filter-bar";
import { FilterText, FilterTextRow } from "#ui/filter-text";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { PokemonIconAnimHelper, PokemonIconAnimMode } from "#ui/pokemon-icon-anim-helper";
import { ScrollBar } from "#ui/scroll-bar";
import { DomShowdownEditorTextInput, DomShowdownPasteInput } from "#ui/showdown-editor-text-input";
import type {
  ShowdownEditorSet,
  ShowdownEditorStage,
  ShowdownSetEditorConfig,
  ShowdownSetEditorUiHandler,
} from "#ui/showdown-set-editor-ui-handler";
import { StarterContainer } from "#ui/starter-container";
import { StatsContainer } from "#ui/stats-container";
import { addBBCodeTextObject, addTextObject, getTextColor, updateCandyCountTextStyle } from "#ui/text";
import { layoutTypeIconStrip, speciesFormTypes } from "#ui/type-icon-strip";
import { addWindow } from "#ui/ui-theme";
import { applyChallenges, checkStarterValidForChallenge } from "#utils/challenge-utils";
import { argbFromRgba, rgbHexToRgba } from "#utils/color-utils";
import {
  type BooleanHolder,
  fixedInt,
  getLocalizedSpriteKey,
  NumberHolder,
  padInt,
  randIntRange,
  truncateString,
} from "#utils/common";
import type { StarterPreferences } from "#utils/data";
import { deepCopy, loadLastTeam, loadStarterPreferences, saveLastTeam, saveStarterPreferences } from "#utils/data";
import { getModifierType } from "#utils/modifier-utils";
import {
  isSlotEnabled,
  isSlotUnlocked,
  PASSIVE_SLOTS,
  type PassiveSlot,
  planMassUnlock,
  toggleSlotEnabled,
  unlockSlot,
} from "#utils/passive-utils";
import { getDexNumber, getPokemonSpecies, getPokemonSpeciesForm, getPokerusStarters } from "#utils/pokemon-utils";
import { toCamelCase, toTitleCase } from "#utils/strings";
import i18next from "i18next";
import type { GameObjects } from "phaser";
import type BBCodeText from "phaser3-rex-plugins/plugins/bbcodetext";

export type StarterSelectCallback = (starters: Starter[]) => void;

/**
 * ER Community Challenge "roster pick" options, passed as `show()`'s SECOND arg. When
 * `rosterPickMode` is set, the screen toggles a SET of eligible root species (using all
 * its filters/search) instead of building a 6-slot party, and returns the chosen ids
 * through `onRosterConfirm`. No normal team-select caller passes a second arg.
 */
export interface StarterRosterPickOptions {
  rosterPickMode: true;
  /** Root species ids to pre-check. */
  initialSelected?: number[];
  /** Called on confirm/done with the chosen root ids ([] = no whitelist / all allowed). */
  onRosterConfirm: (rootIds: number[]) => void;
}

/**
 * Showdown Team Menu offline-build entry options, passed to `show()`'s THIRD arg by the flow wiring
 * (title-phase). EDIT pre-seeds the grid with the preset's reconstructed mons; the cancel hook routes
 * the grid top-level back-out to the Team Menu (restoring the borrowed gameMode) instead of the title.
 * Showdown-only; every other caller omits it.
 */
export interface ShowdownPresetBuildEntry {
  /** Reconstructed starters to pre-seed the grid party (EDIT in place); empty/omitted for CREATE. */
  seedStarters?: Starter[];
  /** Grid top-level back-out handler: returns to the Team Menu, restores the borrowed gameMode. */
  onCancel?: () => void;
}

interface SeedTeamOptions {
  /** Only the exact browser-fixture caller may render a locked starter in the visible team strip. */
  allowUncaught?: boolean;
}

interface LanguageSetting {
  starterInfoTextSize: string;
  instructionTextSize: string;
  starterInfoXPos?: number;
  starterInfoYOffset?: number;
}

const languageSettings: { [key: string]: LanguageSetting } = {
  en: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  de: {
    starterInfoTextSize: "54px",
    instructionTextSize: "25px",
    starterInfoXPos: 35,
  },
  "es-ES": {
    starterInfoTextSize: "50px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 38,
  },
  "es-419": {
    starterInfoTextSize: "50px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 38,
  },
  fr: {
    starterInfoTextSize: "54px",
    instructionTextSize: "28px",
  },
  it: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  "pt-BR": {
    starterInfoTextSize: "48px",
    instructionTextSize: "32px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 33,
  },
  zh: {
    starterInfoTextSize: "56px",
    instructionTextSize: "26px",
    starterInfoXPos: 26,
  },
  ko: {
    starterInfoTextSize: "60px",
    instructionTextSize: "28px",
    starterInfoYOffset: -0.5,
    starterInfoXPos: 30,
  },
  ja: {
    starterInfoTextSize: "48px",
    instructionTextSize: "32px",
    starterInfoYOffset: 1,
    starterInfoXPos: 32,
  },
  ca: {
    starterInfoTextSize: "48px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 29,
  },
  eu: {
    starterInfoTextSize: "48px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 29,
  },
  da: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  th: {
    starterInfoTextSize: "50px",
    instructionTextSize: "30px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 40,
  },
  tr: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
    starterInfoXPos: 34,
  },
  ro: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  ru: {
    starterInfoTextSize: "46px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 26,
  },
  uk: {
    starterInfoTextSize: "46px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 26,
  },
  id: {
    starterInfoTextSize: "48px",
    instructionTextSize: "32px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 37,
  },
  hi: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  tl: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  "nb-NO": {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  sv: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
};

const valueReductionMax = 2;

// Showdown: the starter-cost budget is deferred by design (teams are built at
// level 100 from the player's OWN unlocked collection, so a point ceiling would
// only get in the way). This effectively-unlimited limit keeps the cost panel
// from ever rejecting an owned pick.
const SHOWDOWN_VALUE_LIMIT = 999;

// Position of UI elements
const filterBarHeight = 17;
const speciesContainerX = 109; // if team on the RIGHT: 109 / if on the LEFT: 143
const teamWindowX = 285; // if team on the RIGHT: 285 / if on the LEFT: 109
// ER: pushed down 20px and the team box compressed by 20px to make room for a
// second action row above "Random" — the "Use Last Team" button. The bottom
// window (teamWindowY + teamWindowHeight) stays at its original y so nothing
// below the team box shifts.
const teamWindowY = 58;
const teamWindowWidth = 34;
const teamWindowHeight = 87;
const randomSelectionWindowHeight = 20;

/**
 * Gen-filter sentinel for the "Redux" tab. Real generations are 1–9; this
 * pseudo-value groups Elite Redux's new-evolution "<Pokemon> Redux" custom
 * species into their own generation tab instead of lumping them under Gen 9.
 *
 * We deliberately do NOT change these species' real `generation` field (it
 * stays 9) — that field is load-bearing for mono-generation challenges, Pokédex
 * completion counts and egg logic. The Redux tab is purely a starter-grid
 * filter: {@linkcode isReduxFormSpecies} routes a species to one column or the
 * other in the gen predicate.
 */
const REDUX_GEN_FILTER_VALUE = 10;

/**
 * True for ANY Elite Redux custom species (speciesId ≥ 10000) — the entries the
 * "RDX" generation tab collects. This used to match only "Redux"-NAMED customs,
 * which dumped the convergent/wholly-new customs (Wispywaspy, the Iron paradox
 * series, Heracreus, ...) into the Gen 9 column (#407 maintainer report). After
 * the egg-pool declutter the imported vanilla-form duplicates are gone from the
 * grid entirely, so everything left with a custom id is genuine ER content and
 * belongs under RDX.
 */
function isReduxFormSpecies(species: PokemonSpecies): boolean {
  return species.speciesId >= 10000;
}

/**
 * Calculates the starter position for a Pokemon of a given UI index
 * @param index UI index to calculate the starter position of
 * @returns An interface with an x and y property
 */
function calcStarterPosition(index: number, scrollCursor = 0): { x: number; y: number } {
  const yOffset = 13;
  const height = 17;
  const x = (index % 9) * 18;
  const y = yOffset + (Math.floor(index / 9) - scrollCursor) * height;

  return { x, y };
}

/**
 * Calculates the y position for the icon of stater pokemon selected for the team
 * @param index index of the Pokemon in the team (0-5)
 * @returns the y position to use for the icon
 */
function calcStarterIconY(index: number) {
  const starterSpacing = teamWindowHeight / 7;
  const firstStarterY = teamWindowY + starterSpacing / 2;
  return Math.round(firstStarterY + starterSpacing * index);
}

/**
 * Finds the index of the team Pokemon closest vertically to the given y position
 * @param y the y position to find closest starter Pokemon
 * @param teamSize how many Pokemon are in the team (0-6)
 * @returns index of the closest Pokemon in the team container
 */
function findClosestStarterIndex(y: number, teamSize = 6): number {
  let smallestDistance = teamWindowHeight;
  let closestStarterIndex = 0;
  for (let i = 0; i < teamSize; i++) {
    const distance = Math.abs(y - (calcStarterIconY(i) - 13));
    if (distance < smallestDistance) {
      closestStarterIndex = i;
      smallestDistance = distance;
    }
  }
  return closestStarterIndex;
}

/**
 * Finds the row of the filtered Pokemon closest vertically to the given Pokemon in the team
 * @param index index of the Pokemon in the team (0-5)
 * @param numberOfRows the number of rows to check against
 * @returns index of the row closest vertically to the given Pokemon
 */
function findClosestStarterRow(index: number, numberOfRows: number) {
  const currentY = calcStarterIconY(index) - 13;
  let smallestDistance = teamWindowHeight;
  let closestRowIndex = 0;
  for (let i = 0; i < numberOfRows; i++) {
    const distance = Math.abs(currentY - calcStarterPosition(i * 9).y);
    if (distance < smallestDistance) {
      closestRowIndex = i;
      smallestDistance = distance;
    }
  }
  return closestRowIndex;
}

interface SpeciesDetails {
  shiny?: boolean | undefined;
  formIndex?: number | undefined;
  female?: boolean | undefined;
  variant?: Variant | undefined;
  abilityIndex?: number | undefined;
  natureIndex?: number | undefined;
  forSeen?: boolean | undefined; // default = false
  teraType?: PokemonType | undefined;
}

// =============================================================================
// Elite Redux — 3-slot passive helpers
//
// Phase A widens `passiveAttr` from a 2-bit single-slot bitmask to a 6-bit
// 3-slot bitmask. Most call sites in this file remain slot-1-only via the
// `PassiveAttr.UNLOCKED`/`PassiveAttr.ENABLED` aliases — those literally equal
// `UNLOCKED_1`/`ENABLED_1`, so back-compat is preserved by construction.
//
// The helpers below are only used when `species.getPassiveCount() > 1`, i.e.
// for ER multi-passive species. Phase A leaves the unreachable-in-practice
// rendering path here for Phase B to drive (Phase B installs `setPassives()`
// for each species; until then `getPassiveCount()` is always 1).
//
// Cost multiplier per slot: slot 1 = 1x (base), slot 2 = 2x, slot 3 = 4x.
// =============================================================================

export type { PassiveSlot };
// The 3-slot passive helpers now live in #utils/passive-utils (so the field
// layer can use them without importing this UI handler). Re-exported here for
// back-compat with existing importers (pokedex, summary).
export { isSlotEnabled, isSlotUnlocked, PASSIVE_SLOTS, toggleSlotEnabled, unlockSlot };

export class StarterSelectUiHandler extends MessageUiHandler {
  private starterSelectContainer: Phaser.GameObjects.Container;
  private starterSelectScrollBar: ScrollBar;
  private filterBarContainer: Phaser.GameObjects.Container;
  private filterBar: FilterBar;
  // ER: free-text search (Name substring + Ability-text regex over detailed
  // ability descriptions). Entered by pressing the filter key again from the
  // filter bar; a self-contained mode (CANCEL returns to the grid).
  private filterTextContainer: Phaser.GameObjects.Container;
  private filterText: FilterText;
  private filterTextMode = false;
  private filterTextCursor = 0;
  private shinyOverlay: Phaser.GameObjects.Image;
  private starterContainers: StarterContainer[] = [];
  private filteredStarterContainers: StarterContainer[] = [];
  private validStarterContainers: StarterContainer[] = [];
  private pokemonNumberText: Phaser.GameObjects.Text;
  private pokemonSprite: Phaser.GameObjects.Sprite;
  private pokemonNameText: Phaser.GameObjects.Text;
  private shinyLabNameFx?: ErShinyLabNameFx | undefined;
  private pokemonGrowthRateLabelText: Phaser.GameObjects.Text;
  private pokemonGrowthRateText: Phaser.GameObjects.Text;
  private type1Icon: Phaser.GameObjects.Sprite;
  private type2Icon: Phaser.GameObjects.Sprite;
  /** Pooled badges for types 3..N (ER N-type substrate). */
  private extraTypeIcons: Phaser.GameObjects.Sprite[] = [];
  private pokemonLuckLabelText: Phaser.GameObjects.Text;
  private pokemonLuckText: Phaser.GameObjects.Text;
  private pokemonGenderText: Phaser.GameObjects.Text;
  private pokemonUncaughtText: Phaser.GameObjects.Text;
  private pokemonAbilityLabelText: Phaser.GameObjects.Text;
  private pokemonAbilityText: Phaser.GameObjects.Text;
  private pokemonPassiveLabelText: Phaser.GameObjects.Text;
  private pokemonPassiveText: Phaser.GameObjects.Text;
  /**
   * ER 3-passive layout — slot 1 reuses {@link pokemonPassiveText}; slots 2 and 3
   * are rendered immediately below it. Indices 1 and 2 correspond to ER slots 2 and 3.
   */
  private pokemonPassiveSlotTexts: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private pokemonNatureLabelText: Phaser.GameObjects.Text;
  private pokemonNatureText: BBCodeText;
  private pokemonMovesContainer: Phaser.GameObjects.Container;
  private pokemonMoveContainers: Phaser.GameObjects.Container[];
  private pokemonMoveBgs: Phaser.GameObjects.NineSlice[];
  private pokemonMoveLabels: Phaser.GameObjects.Text[];
  private pokemonAdditionalMoveCountLabel: Phaser.GameObjects.Text;
  private eggMovesLabel: Phaser.GameObjects.Text;
  private pokemonEggMovesContainer: Phaser.GameObjects.Container;
  private pokemonEggMoveContainers: Phaser.GameObjects.Container[];
  private pokemonEggMoveBgs: Phaser.GameObjects.NineSlice[];
  private pokemonEggMoveLabels: Phaser.GameObjects.Text[];
  private pokemonCandyContainer: Phaser.GameObjects.Container;
  private pokemonCandyIcon: Phaser.GameObjects.Sprite;
  private pokemonCandyDarknessOverlay: Phaser.GameObjects.Sprite;
  private pokemonCandyOverlayIcon: Phaser.GameObjects.Sprite;
  private pokemonCandyCountText: Phaser.GameObjects.Text;
  private pokemonCaughtHatchedContainer: Phaser.GameObjects.Container;
  private pokemonCaughtCountText: Phaser.GameObjects.Text;
  private pokemonFormText: Phaser.GameObjects.Text;
  private pokemonHatchedIcon: Phaser.GameObjects.Sprite;
  private pokemonHatchedCountText: Phaser.GameObjects.Text;
  private pokemonShinyIcon: Phaser.GameObjects.Sprite;
  private pokemonPassiveDisabledIcon: Phaser.GameObjects.Sprite;
  private pokemonPassiveLockedIcon: Phaser.GameObjects.Sprite;
  /** ER 3-passive layout — disabled (stop) icons for slots 2 and 3. */
  private pokemonPassiveSlotDisabledIcons: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite];
  /** ER 3-passive layout — locked icons for slots 2 and 3. */
  private pokemonPassiveSlotLockedIcons: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite];
  private teraIcon: Phaser.GameObjects.Sprite;
  private shinyLabFxSprite: Phaser.GameObjects.Sprite;
  private shinyLabFxKey: string | null = null;
  private shinyLabFxVersion = 0;
  private shinyLabFxTick = 0;
  private shinyLabFxTimer: Phaser.Time.TimerEvent | null = null;

  private activeTooltip: "ABILITY" | "PASSIVE" | "CANDY" | undefined;
  private instructionsContainer: Phaser.GameObjects.Container;
  private filterInstructionsContainer: Phaser.GameObjects.Container;
  private shinyIconElement: Phaser.GameObjects.Sprite;
  private formIconElement: Phaser.GameObjects.Sprite;
  private abilityIconElement: Phaser.GameObjects.Sprite;
  private genderIconElement: Phaser.GameObjects.Sprite;
  private natureIconElement: Phaser.GameObjects.Sprite;
  private teraIconElement: Phaser.GameObjects.Sprite;
  private goFilterIconElement: Phaser.GameObjects.Sprite;
  private shinyLabel: Phaser.GameObjects.Text;
  private formLabel: Phaser.GameObjects.Text;
  private genderLabel: Phaser.GameObjects.Text;
  private abilityLabel: Phaser.GameObjects.Text;
  private natureLabel: Phaser.GameObjects.Text;
  private teraLabel: Phaser.GameObjects.Text;
  private goFilterLabel: Phaser.GameObjects.Text;
  /** Group holding the UI elements appearing in the instructionsContainer */
  /* TODO: Uncomment this once our testing infra supports mocks of `Phaser.GameObject.Group`
  private instructionElemGroup: Phaser.GameObjects.Group;
  */

  private starterSelectMessageBox: Phaser.GameObjects.NineSlice;
  private starterSelectMessageBoxContainer: Phaser.GameObjects.Container;
  private statsContainer: StatsContainer;
  private moveInfoOverlay: MoveInfoOverlay;

  private statsMode: boolean;
  private starterIconsCursorXOffset = -3;
  private starterIconsCursorYOffset = 1;
  private starterIconsCursorIndex: number;
  private filterMode: boolean;
  private dexAttrCursor = 0n;
  private abilityCursor = -1;
  private natureCursor = -1;
  private teraCursor: PokemonType = PokemonType.UNKNOWN;
  private filterBarCursor = 0;
  private starterMoveset: StarterMoveset | null;
  private scrollCursor: number;

  private allSpecies: PokemonSpecies[] = [];
  private lastSpecies: PokemonSpecies;
  private speciesLoaded: Map<SpeciesId, boolean> = new Map<SpeciesId, boolean>();

  private starters: Starter[] = [];
  public starterSpecies: PokemonSpecies[] = [];
  private pokerusSpecies: PokemonSpecies[] = [];
  private speciesStarterDexEntry: DexEntry | null;
  private speciesStarterMoves: MoveId[];

  private canCycleShiny: boolean;
  private canCycleForm: boolean;
  private canCycleGender: boolean;
  private canCycleAbility: boolean;
  private canCycleNature: boolean;
  private canCycleTera: boolean;

  private assetLoadCancelled: BooleanHolder | null;
  public cursorObj: Phaser.GameObjects.Image;
  private starterCursorObjs: Phaser.GameObjects.Image[];
  private pokerusCursorObjs: Phaser.GameObjects.Image[];
  private starterIcons: Phaser.GameObjects.Sprite[];
  private starterIconsCursorObj: Phaser.GameObjects.Image;
  private valueLimitLabel: Phaser.GameObjects.Text;
  /** Co-op (#633): partner-status banner ("<name>: ready", "P2: 2/3", ...). Hidden off co-op. */
  private coopStatusText: Phaser.GameObjects.Text;
  private coopStatusUnsub: (() => void) | null = null;
  /**
   * Showdown: per-line teambuilder choices, keyed by the ROOT (grid) species id. Holds
   * the chosen evolution/mega STAGE to field and the held ITEM. Applied onto the
   * {@linkcode Starter} in {@linkcode addToParty}, and re-applied to an in-party mon when
   * the player re-picks. `prevItem` stashes the explicit pre-mega item so switching a mega
   * stage back to a non-mega stage restores the player's earlier choice (see
   * {@linkcode setShowdownStage}). Empty (and unused) in every non-showdown mode.
   */
  private showdownSelections: Map<
    number,
    { speciesId: number; formIndex: number; item?: string | undefined; prevItem?: string | undefined }
  > = new Map();
  /**
   * Showdown: the wall-clock end of the 10-minute team-build pick window (`getShowdownPickWaitMs`),
   * anchored on first opening the Set Editor. The editor's top-strip countdown reads the remaining
   * seconds off this. Null (unset) until the first editor open; reset on handler teardown.
   */
  private showdownPickDeadline: number | null = null;
  /**
   * Showdown Team Menu offline build (addendum): when the grid is opened to EDIT/CREATE a preset, this
   * routes the grid top-level back-out to the Team Menu (restoring the borrowed gameMode + reopening the
   * menu) INSTEAD of the title. Set from the show args; null in the live versus flow and every other mode.
   */
  private showdownBuildOnCancel: (() => void) | null = null;
  /**
   * Showdown EDIT: the in-flight seed asset load. `seedTeamFromStarters` adds the party mini-icons once
   * the sprites resolve; exposed so the render harness can await a fully-seeded grid before snapshotting.
   */
  private showdownSeedInFlight: Promise<void> | null = null;
  /** Invalidates an async Showdown team seed when the grid is hidden or reopened before assets finish. */
  private showdownSeedGeneration = 0;
  private startCursorObj: Phaser.GameObjects.NineSlice;
  private randomCursorObj: Phaser.GameObjects.NineSlice;
  /** ER: cursor for the "Use Last Team" action (sits above the Random button). */
  private lastTeamCursorObj: Phaser.GameObjects.NineSlice;

  /** ER: single-flight guard for the preview sprite load. Only ONE preview
   * loadAssets runs at a time; when it finishes we re-drive to wherever the
   * cursor is NOW (latest-wins). The dev server degrades sharply under concurrent
   * sprite loads (measured: ~20ms solo vs ~2000ms with a dozen in flight), so
   * uncapped per-selection loads pile up and freeze the preview — this caps it. */
  private spriteLoadInFlight = false;
  /** ER: failed-load attempt count per sprite key. Some sprites never land their
   * texture (e.g. a dev-server request that stalls/errors); without a cap the
   * single-flight re-drive retries the SAME key forever, freezing the preview on
   * the previous Pokémon. After {@link MAX_SPRITE_LOAD_ATTEMPTS} failures we give
   * up on that key for this visit. Reset in show() so a fresh visit retries. */
  private spriteLoadAttempts = new Map<string, number>();
  private static readonly MAX_SPRITE_LOAD_ATTEMPTS = 2;
  /** ER: timestamp (scene clock) of the last cursor-driven sprite selection. The
   * background grid pre-warmer only runs once the cursor has been idle past
   * {@link SPRITE_PREWARM_IDLE_MS}, so warming never competes with active
   * scrolling (the cursor's own load always gets the single-flight slot first). */
  private lastSpriteSelectionTime = 0;
  private spritePrewarmTimer: Phaser.Time.TimerEvent | null = null;
  private static readonly SPRITE_PREWARM_IDLE_MS = 250;
  /** ER: separate single-flight slot for the background pre-warmer, so it can warm
   * the grid CONCURRENTLY with (never behind) the cursor's own load — the cursor's
   * transition is never delayed waiting on a warm-up. Caps at 2 total in-flight
   * (cursor + prewarm), which the single dev server handles fine (~2ms/file). */
  private spritePrewarmInFlight = false;

  private iconAnimHandler: PokemonIconAnimHelper;

  //variables to keep track of the dynamically rendered list of instruction prompts for starter select
  private instructionRowX = 0;
  private instructionRowY = 0;
  private instructionRowTextOffset = 9;
  private filterInstructionRowX = 0;
  private filterInstructionRowY = 0;

  private starterSelectCallback: StarterSelectCallback | null;

  // ER Community Challenge "pick the allowed roster" mode: reuse this whole screen
  // (grid + all filters + search) to TOGGLE a set of eligible root species instead
  // of building a 6-slot party. Enabled via show()'s args[1]; never set on the
  // normal team-select path (no other caller passes args[1]).
  private rosterPickMode = false;
  private rosterSelected = new Set<number>();
  private rosterConfirm: ((rootIds: number[]) => void) | null = null;

  private starterPreferences: StarterPreferences;
  private originalStarterPreferences: StarterPreferences;

  /**
   * Used to check whether any moves were swapped using the reorder menu, to decide
   * whether a save should be performed or not.
   */
  private hasSwappedMoves = false;

  protected blockInput = false;
  /** Guards the staggered mass-unlock-innates run from re-entry (#305). */
  private isMassUnlocking = false;
  private allowTera: boolean;

  constructor() {
    super(UiMode.STARTER_SELECT);
  }

  setup() {
    const ui = this.getUi();
    const currentLanguage = i18next.resolvedLanguage ?? "en";
    const langSettingKey = Object.keys(languageSettings).find(lang => currentLanguage.includes(lang)) ?? "en";
    const textSettings = languageSettings[langSettingKey];
    /** Scaled canvas height */
    const sHeight = globalScene.scaledCanvas.height;
    /** Scaled canvas width */
    const sWidth = globalScene.scaledCanvas.width;

    this.starterSelectContainer = globalScene.add.container(0, -sHeight).setVisible(false);
    ui.add(this.starterSelectContainer);

    const bgColor = globalScene.add.rectangle(0, 0, sWidth, sHeight, 0x006860).setOrigin(0);

    const starterDexNoLabel = globalScene.add
      .image(6, 14, getLocalizedSpriteKey("summary_dexnb_label"))
      .setOrigin(0, 1); // Pixel text 'No'

    const starterSelectBg = globalScene.add.image(0, 0, "starter_select_bg").setOrigin(0);
    this.shinyOverlay = globalScene.add
      .image(6, 111, getLocalizedSpriteKey("summary_dexnb_label_overlay_shiny"))
      .setOrigin(0, 1)
      .setVisible(false); // Pixel text 'No' shiny

    const starterContainerWindow = addWindow(speciesContainerX, filterBarHeight + 1, 175, 161);
    const starterContainerBg = globalScene.add
      .image(speciesContainerX + 1, filterBarHeight + 2, "starter_container_bg")
      .setOrigin(0);

    // Create and initialise filter bar
    this.filterBarContainer = globalScene.add.container(0, 0);
    this.filterBar = new FilterBar(Math.min(speciesContainerX, teamWindowX), 1, 210, filterBarHeight);

    // gen filter
    const genOptions: DropDownOption[] = Array.from(
      { length: 9 },
      (_, i) => new DropDownOption(i + 1, new DropDownLabel(i18next.t(`starterSelectUiHandler:gen${i + 1}`))),
    );
    // Elite Redux: a dedicated "Redux" tab for the new-evolution Redux customs.
    genOptions.push(
      new DropDownOption(
        REDUX_GEN_FILTER_VALUE,
        new DropDownLabel(i18next.t("starterSelectUiHandler:genRedux", { defaultValue: "RDX" })),
      ),
    );
    const genDropDown: DropDown = new DropDown(0, 0, genOptions, this.updateStarters, DropDownType.HYBRID);
    this.filterBar.addFilter(DropDownColumn.GEN, i18next.t("filterBar:genFilter"), genDropDown);

    // type filter
    const typeKeys = Object.keys(PokemonType).filter(v => Number.isNaN(Number(v)));
    const typeOptions: DropDownOption[] = [];
    typeKeys.forEach((type, index) => {
      if (index === 0 || index === 19) {
        return;
      }
      const typeSprite = globalScene.add.sprite(0, 0, getLocalizedSpriteKey("types"));
      typeSprite.setScale(0.5);
      typeSprite.setFrame(type.toLowerCase());
      typeOptions.push(new DropDownOption(index, new DropDownLabel("", typeSprite)));
    });
    this.filterBar.addFilter(
      DropDownColumn.TYPES,
      i18next.t("filterBar:typeFilter"),
      new DropDown(0, 0, typeOptions, this.updateStarters, DropDownType.HYBRID, 0.5),
    );

    // caught filter
    const shiny1Sprite = globalScene.add
      .sprite(0, 0, "shiny_icons")
      .setOrigin(0.15, 0.2)
      .setScale(0.6)
      .setFrame(getVariantIcon(0))
      .setTint(getVariantTint(0));
    const shiny2Sprite = globalScene.add
      .sprite(0, 0, "shiny_icons")
      .setOrigin(0.15, 0.2)
      .setScale(0.6)
      .setFrame(getVariantIcon(1))
      .setTint(getVariantTint(1));
    const shiny3Sprite = globalScene.add
      .sprite(0, 0, "shiny_icons")
      .setOrigin(0.15, 0.2)
      .setScale(0.6)
      .setFrame(getVariantIcon(2))
      .setTint(getVariantTint(2));
    // ER Black Shinies (#349): t4 filter sparkle — pure black (same as the dex).
    const shinyBlackSprite = globalScene.add
      .sprite(0, 0, "shiny_icons")
      .setOrigin(0.15, 0.2)
      .setScale(0.6)
      .setFrame(getVariantIcon(2))
      .setTint(0x0a0a0a);

    const caughtOptions = [
      new DropDownOption("SHINYBLACK", new DropDownLabel("", shinyBlackSprite)),
      new DropDownOption("SHINY3", new DropDownLabel("", shiny3Sprite)),
      new DropDownOption("SHINY2", new DropDownLabel("", shiny2Sprite)),
      new DropDownOption("SHINY", new DropDownLabel("", shiny1Sprite)),
      new DropDownOption("NORMAL", new DropDownLabel(i18next.t("filterBar:normal"))),
      new DropDownOption("UNCAUGHT", new DropDownLabel(i18next.t("filterBar:uncaught"))),
    ];

    this.filterBar.addFilter(
      DropDownColumn.CAUGHT,
      i18next.t("filterBar:caughtFilter"),
      new DropDown(0, 0, caughtOptions, this.updateStarters, DropDownType.HYBRID),
    );

    // unlocks filter
    // ER 3-passive (innate) filter: count-based states instead of the legacy
    // single-passive binary. (Literal labels — the filterBar locale source is
    // external, so new count keys can't be added there.)
    const passiveLabels = [
      new DropDownLabel(i18next.t("filterBar:passive"), undefined, DropDownState.OFF),
      new DropDownLabel("All Passives", undefined, DropDownState.THREE),
      new DropDownLabel("2 Passives", undefined, DropDownState.TWO),
      new DropDownLabel("1 Passive", undefined, DropDownState.ONE),
      new DropDownLabel(i18next.t("filterBar:passiveUnlockable"), undefined, DropDownState.UNLOCKABLE),
      new DropDownLabel(i18next.t("filterBar:passiveLocked"), undefined, DropDownState.EXCLUDE),
    ];

    const costReductionLabels = [
      new DropDownLabel(i18next.t("filterBar:costReduction"), undefined, DropDownState.OFF),
      new DropDownLabel(i18next.t("filterBar:costReductionUnlocked"), undefined, DropDownState.ON),
      new DropDownLabel(i18next.t("filterBar:costReductionUnlockedOne"), undefined, DropDownState.ONE),
      new DropDownLabel(i18next.t("filterBar:costReductionUnlockedTwo"), undefined, DropDownState.TWO),
      new DropDownLabel(i18next.t("filterBar:costReductionUnlockable"), undefined, DropDownState.UNLOCKABLE),
      new DropDownLabel(i18next.t("filterBar:costReductionLocked"), undefined, DropDownState.EXCLUDE),
    ];

    // Action entry (not a filter): toggling it ON runs the staggered mass-unlock
    // of every affordable innate, then resets itself. Detected in updateStarters.
    // Both states share the same descriptive label so the dropdown row always
    // reads as the action (it resets to OFF after firing), never "Passive".
    const massUnlockLabels = [
      new DropDownLabel("✦ Unlock All Innates", undefined, DropDownState.OFF),
      new DropDownLabel("✦ Unlock All Innates", undefined, DropDownState.ON),
    ];
    const unlocksOptions = [
      new DropDownOption("PASSIVE", passiveLabels),
      new DropDownOption("COST_REDUCTION", costReductionLabels),
      new DropDownOption("MASS_UNLOCK", massUnlockLabels),
    ];

    this.filterBar.addFilter(
      DropDownColumn.UNLOCKS,
      i18next.t("filterBar:unlocksFilter"),
      new DropDown(0, 0, unlocksOptions, this.updateStarters, DropDownType.RADIAL),
    );

    // misc filter
    const favoriteLabels = [
      new DropDownLabel(i18next.t("filterBar:favorite"), undefined, DropDownState.OFF),
      new DropDownLabel(i18next.t("filterBar:isFavorite"), undefined, DropDownState.ON),
      new DropDownLabel(i18next.t("filterBar:notFavorite"), undefined, DropDownState.EXCLUDE),
    ];
    const winLabels = [
      new DropDownLabel(i18next.t("filterBar:ribbon"), undefined, DropDownState.OFF),
      new DropDownLabel(i18next.t("filterBar:hasWon"), undefined, DropDownState.ON),
      new DropDownLabel(i18next.t("filterBar:hasNotWon"), undefined, DropDownState.EXCLUDE),
    ];
    const hiddenAbilityLabels = [
      new DropDownLabel(i18next.t("filterBar:hiddenAbility"), undefined, DropDownState.OFF),
      new DropDownLabel(i18next.t("filterBar:hasHiddenAbility"), undefined, DropDownState.ON),
      new DropDownLabel(i18next.t("filterBar:noHiddenAbility"), undefined, DropDownState.EXCLUDE),
    ];
    const eggLabels = [
      new DropDownLabel(i18next.t("filterBar:egg"), undefined, DropDownState.OFF),
      new DropDownLabel(i18next.t("filterBar:eggPurchasable"), undefined, DropDownState.ON),
    ];
    const pokerusLabels = [
      new DropDownLabel(i18next.t("filterBar:pokerus"), undefined, DropDownState.OFF),
      new DropDownLabel(i18next.t("filterBar:hasPokerus"), undefined, DropDownState.ON),
    ];
    const miscOptions = [
      new DropDownOption("FAVORITE", favoriteLabels),
      new DropDownOption("WIN", winLabels),
      new DropDownOption("HIDDEN_ABILITY", hiddenAbilityLabels),
      new DropDownOption("EGG", eggLabels),
      new DropDownOption("POKERUS", pokerusLabels),
    ];
    this.filterBar.addFilter(
      DropDownColumn.MISC,
      i18next.t("filterBar:miscFilter"),
      new DropDown(0, 0, miscOptions, this.updateStarters, DropDownType.RADIAL),
    );

    // sort filter
    const sortOptions = [
      new DropDownOption(
        SortCriteria.NUMBER,
        new DropDownLabel(i18next.t("filterBar:sortByNumber"), undefined, DropDownState.ON),
      ),
      new DropDownOption(SortCriteria.COST, new DropDownLabel(i18next.t("filterBar:sortByCost"))),
      new DropDownOption(SortCriteria.CANDY, new DropDownLabel(i18next.t("filterBar:sortByCandies"))),
      new DropDownOption(SortCriteria.IV, new DropDownLabel(i18next.t("filterBar:sortByIVs"))),
      new DropDownOption(SortCriteria.NAME, new DropDownLabel(i18next.t("filterBar:sortByName"))),
      new DropDownOption(SortCriteria.CAUGHT, new DropDownLabel(i18next.t("filterBar:sortByNumCaught"))),
      new DropDownOption(SortCriteria.HATCHED, new DropDownLabel(i18next.t("filterBar:sortByNumHatched"))),
    ];
    this.filterBar.addFilter(
      DropDownColumn.SORT,
      i18next.t("filterBar:sortFilter"),
      new DropDown(0, 0, sortOptions, this.updateStarters, DropDownType.SINGLE),
    );
    // ER: "Search" tab. Its dropdown holds a single placeholder option (an empty
    // dropdown crashes when rendered during tab navigation); pressing Action on
    // the tab opens the free-text Name/Ability-text panel instead of toggling the
    // dropdown (handled in processInput). updateStarters never reads this column,
    // so it doesn't affect filtering.
    this.filterBar.addFilter(
      DropDownColumn.SEARCH,
      i18next.t("filterBar:searchFilter"),
      new DropDown(
        0,
        0,
        [new DropDownOption("SEARCH", new DropDownLabel(i18next.t("filterBar:searchFilter")))],
        this.updateStarters,
        DropDownType.SINGLE,
      ),
    );
    this.filterBarContainer.add(this.filterBar);

    // Offset the generation filter dropdown to avoid covering the filtered pokemon
    this.filterBar.offsetHybridFilters();

    // ER: free-text search panel (Name substring + Ability-text regex over the
    // FULL detailed ability descriptions). Hidden until entered from the filter
    // bar (press the filter key again).
    this.filterTextContainer = globalScene.add.container(0, 0);
    this.filterText = new FilterText(speciesContainerX + 7, filterBarHeight + 8, 160, 40, this.updateStarters);
    this.filterText.addFilter(FilterTextRow.NAME, i18next.t("filterText:nameField"));
    this.filterText.addFilter(FilterTextRow.ABILITY_TEXT, i18next.t("filterText:abilityTextField"));
    // Dedicated row to wipe the active search in place (Action on this row).
    this.filterText.addActionRow(FilterTextRow.CLEAR, i18next.t("filterText:clearSearch"));
    this.filterTextContainer.add(this.filterText);
    this.filterTextContainer.setVisible(false);

    if (globalScene.uiTheme === UiTheme.DEFAULT) {
      starterContainerWindow.setVisible(false);
    }

    this.iconAnimHandler = new PokemonIconAnimHelper();
    this.iconAnimHandler.setup();

    this.pokemonSprite = globalScene.add.sprite(53, 63, "pkmn__sub");
    this.pokemonSprite.setPipeline(globalScene.spritePipeline, {
      tone: [0.0, 0.0, 0.0, 0.0],
      ignoreTimeTint: true,
    });
    this.shinyLabFxSprite = globalScene.add.sprite(53, 63, "unknown").setOrigin(0.5, 0.5).setVisible(false);

    this.pokemonNumberText = addTextObject(17, 1, "0000", TextStyle.SUMMARY_DEX_NUM).setOrigin(0);

    this.pokemonNameText = addTextObject(6, 112, "", TextStyle.SUMMARY).setOrigin(0);

    this.pokemonGrowthRateLabelText = addTextObject(
      8,
      106,
      i18next.t("starterSelectUiHandler:growthRate"),
      TextStyle.WINDOW_ALT,
      { fontSize: "36px" },
    )
      .setOrigin(0)
      .setVisible(false);

    this.pokemonGrowthRateText = addTextObject(34, 106, "", TextStyle.GROWTH_RATE_TYPE, { fontSize: "36px" }).setOrigin(
      0,
    );

    this.pokemonGenderText = addTextObject(96, 112, "", TextStyle.SUMMARY_ALT).setOrigin(0);

    this.pokemonUncaughtText = addTextObject(
      6,
      127,
      i18next.t("starterSelectUiHandler:uncaught"),
      TextStyle.SUMMARY_ALT,
      { fontSize: "56px" },
    ).setOrigin(0);

    // The position should be set per language
    const starterInfoXPos = textSettings?.starterInfoXPos || 31;
    const starterInfoYOffset = textSettings?.starterInfoYOffset || 0;

    // The font size should be set per language
    const starterInfoTextSize = textSettings?.starterInfoTextSize || 56;

    this.pokemonAbilityLabelText = addTextObject(
      6,
      127 + starterInfoYOffset,
      i18next.t("starterSelectUiHandler:ability"),
      TextStyle.SUMMARY_ALT,
      { fontSize: starterInfoTextSize },
    )
      .setOrigin(0)
      .setVisible(false);

    this.pokemonAbilityText = addTextObject(starterInfoXPos, 127 + starterInfoYOffset, "", TextStyle.SUMMARY_ALT, {
      fontSize: starterInfoTextSize,
    })
      .setOrigin(0)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 250, 55), Phaser.Geom.Rectangle.Contains);

    this.pokemonPassiveLabelText = addTextObject(
      6,
      136 + starterInfoYOffset,
      i18next.t("starterSelectUiHandler:passive"),
      TextStyle.SUMMARY_ALT,
      { fontSize: starterInfoTextSize },
    )
      .setOrigin(0)
      .setVisible(false);

    this.pokemonPassiveText = addTextObject(starterInfoXPos, 136 + starterInfoYOffset, "", TextStyle.SUMMARY_ALT, {
      fontSize: starterInfoTextSize,
    })
      .setOrigin(0)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 250, 55), Phaser.Geom.Rectangle.Contains);

    this.pokemonPassiveDisabledIcon = globalScene.add
      .sprite(starterInfoXPos, 137 + starterInfoYOffset, "icon_stop")
      .setOrigin(0, 0.5)
      .setScale(0.35)
      .setVisible(false);

    this.pokemonPassiveLockedIcon = globalScene.add
      .sprite(starterInfoXPos, 137 + starterInfoYOffset, "icon_lock")
      .setOrigin(0, 0.5)
      .setScale(0.42, 0.38)
      .setVisible(false);

    // ER 3-passive layout — slot 2 + slot 3 text rows immediately below slot 1.
    // Spacing matches the existing 7-8px row pitch (ability=127, passive=136).
    // We piggy-back on the legacy `pokemonPassiveLabelText` at y=136 — it labels
    // the whole passive group; individual slots are unlabeled (their slot index
    // is implicit in the visual stacking, mirroring the option-list "1. Foo,
    // 2. Bar, 3. Baz" rows in the candy submenu).
    const passiveSlot2Y = 143 + starterInfoYOffset;
    const passiveSlot3Y = 150 + starterInfoYOffset;
    this.pokemonPassiveSlotTexts = [
      addTextObject(starterInfoXPos, passiveSlot2Y, "", TextStyle.SUMMARY_ALT, { fontSize: starterInfoTextSize })
        .setOrigin(0)
        .setInteractive(new Phaser.Geom.Rectangle(0, 0, 250, 55), Phaser.Geom.Rectangle.Contains),
      addTextObject(starterInfoXPos, passiveSlot3Y, "", TextStyle.SUMMARY_ALT, { fontSize: starterInfoTextSize })
        .setOrigin(0)
        .setInteractive(new Phaser.Geom.Rectangle(0, 0, 250, 55), Phaser.Geom.Rectangle.Contains),
    ];
    this.pokemonPassiveSlotDisabledIcons = [
      globalScene.add
        .sprite(starterInfoXPos, passiveSlot2Y + 1, "icon_stop")
        .setOrigin(0, 0.5)
        .setScale(0.35)
        .setVisible(false),
      globalScene.add
        .sprite(starterInfoXPos, passiveSlot3Y + 1, "icon_stop")
        .setOrigin(0, 0.5)
        .setScale(0.35)
        .setVisible(false),
    ];
    this.pokemonPassiveSlotLockedIcons = [
      globalScene.add
        .sprite(starterInfoXPos, passiveSlot2Y + 1, "icon_lock")
        .setOrigin(0, 0.5)
        .setScale(0.42, 0.38)
        .setVisible(false),
      globalScene.add
        .sprite(starterInfoXPos, passiveSlot3Y + 1, "icon_lock")
        .setOrigin(0, 0.5)
        .setScale(0.42, 0.38)
        .setVisible(false),
    ];

    this.pokemonNatureLabelText = addTextObject(
      6,
      157 + starterInfoYOffset,
      i18next.t("starterSelectUiHandler:nature"),
      TextStyle.SUMMARY_ALT,
      { fontSize: starterInfoTextSize },
    )
      .setOrigin(0)
      .setVisible(false);

    this.pokemonNatureText = addBBCodeTextObject(starterInfoXPos, 157 + starterInfoYOffset, "", TextStyle.SUMMARY_ALT, {
      fontSize: starterInfoTextSize,
    }).setOrigin(0);

    this.pokemonMoveContainers = [];
    this.pokemonMoveBgs = [];
    this.pokemonMoveLabels = [];

    this.pokemonEggMoveContainers = [];
    this.pokemonEggMoveBgs = [];
    this.pokemonEggMoveLabels = [];

    this.valueLimitLabel = addTextObject(teamWindowX + 17, 150, "0/10", TextStyle.STARTER_VALUE_LIMIT).setOrigin(
      0.5,
      0,
    );

    // Co-op (#633): partner-status banner as a bottom-left status strip (wide enough
    // for the partner's name). Driven by the live CoopSessionController; hidden +
    // empty in every non-co-op mode.
    this.coopStatusText = addTextObject(2, 178, "", TextStyle.STARTER_VALUE_LIMIT).setOrigin(0, 1).setVisible(false);

    const startLabel = addTextObject(
      teamWindowX + 17,
      162,
      i18next.t("common:start"),
      TextStyle.TOOLTIP_CONTENT,
    ).setOrigin(0.5, 0);

    this.startCursorObj = globalScene.add
      .nineslice(teamWindowX + 4, 160, "select_cursor", undefined, 26, 15, 6, 6, 6, 6)
      .setVisible(false)
      .setOrigin(0);

    // ER: "Use Last Team" row sits in the top action slot (18-38); "Random" is
    // pushed down one row (38-58). Both labels/cursors are positioned to match.
    const lastTeamSelectLabel = addTextObject(
      teamWindowX + 17,
      23,
      i18next.t("starterSelectUiHandler:useLastTeam"),
      TextStyle.TOOLTIP_CONTENT,
    ).setOrigin(0.5, 0);
    // "Use Last Team" runs wider than this compact action button - shrink to fit.
    if (lastTeamSelectLabel.displayWidth > 24) {
      lastTeamSelectLabel.setScale(lastTeamSelectLabel.scaleX * (24 / lastTeamSelectLabel.displayWidth));
    }

    this.lastTeamCursorObj = globalScene.add
      .nineslice(teamWindowX + 4, 21, "select_cursor", undefined, 26, 15, 6, 6, 6, 6)
      .setVisible(false)
      .setOrigin(0);

    const randomSelectLabel = addTextObject(
      teamWindowX + 17,
      43,
      i18next.t("starterSelectUiHandler:randomize"),
      TextStyle.TOOLTIP_CONTENT,
    ).setOrigin(0.5, 0);

    this.randomCursorObj = globalScene.add
      .nineslice(teamWindowX + 4, 41, "select_cursor", undefined, 26, 15, 6, 6, 6, 6)
      .setVisible(false)
      .setOrigin(0);

    const starterSpecies: SpeciesId[] = [];

    const starterBoxContainer = globalScene.add.container(speciesContainerX + 6, 9); //115

    this.starterSelectScrollBar = new ScrollBar(161, 12, 5, starterContainerWindow.height - 6, 9);

    starterBoxContainer.add(this.starterSelectScrollBar);

    this.pokerusCursorObjs = [];
    for (let i = 0; i < POKERUS_STARTER_COUNT; i++) {
      const cursorObj = globalScene.add.image(0, 0, "select_cursor_pokerus");
      cursorObj.setVisible(false);
      cursorObj.setOrigin(0);
      starterBoxContainer.add(cursorObj);
      this.pokerusCursorObjs.push(cursorObj);
    }

    this.starterCursorObjs = [];
    for (let i = 0; i < 6; i++) {
      const cursorObj = globalScene.add.image(0, 0, "select_cursor_highlight");
      cursorObj.setVisible(false);
      cursorObj.setOrigin(0);
      starterBoxContainer.add(cursorObj);
      this.starterCursorObjs.push(cursorObj);
    }

    this.cursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0);
    this.starterIconsCursorObj = globalScene.add
      .image(289, 64, "select_gen_cursor")
      .setName("starter-icons-cursor")
      .setVisible(false)
      .setOrigin(0);

    starterBoxContainer.add(this.cursorObj);

    // TODO: Apply the same logic done in the pokedex to only have 81 containers whose sprites are cycled
    for (const species of allSpecies) {
      if (!Object.hasOwn(speciesStarterCosts, species.speciesId)) {
        continue;
      }

      starterSpecies.push(species.speciesId);
      this.speciesLoaded.set(species.speciesId, false);
      this.allSpecies.push(species);

      const starterContainer = new StarterContainer(species).setVisible(false);
      this.iconAnimHandler.addOrUpdate(starterContainer.icon, PokemonIconAnimMode.NONE);
      this.starterContainers.push(starterContainer);
      starterBoxContainer.add(starterContainer);
    }

    this.starterIcons = [];
    for (let i = 0; i < 6; i++) {
      const icon = globalScene.add
        .sprite(teamWindowX + 7, calcStarterIconY(i), "pokemon_icons_0")
        .setScale(0.5)
        .setOrigin(0)
        .setFrame("unknown");
      this.iconAnimHandler.addOrUpdate(icon, PokemonIconAnimMode.PASSIVE);
      this.starterIcons.push(icon);
    }

    this.type1Icon = globalScene.add.sprite(8, 98, getLocalizedSpriteKey("types")).setScale(0.5).setOrigin(0);

    this.type2Icon = globalScene.add.sprite(26, 98, getLocalizedSpriteKey("types")).setScale(0.5).setOrigin(0);

    this.pokemonLuckLabelText = addTextObject(8, 89, i18next.t("common:luckIndicator"), TextStyle.WINDOW_ALT, {
      fontSize: "56px",
    }).setOrigin(0);

    this.pokemonLuckText = addTextObject(
      8 + this.pokemonLuckLabelText.displayWidth + 2,
      89,
      "0",
      TextStyle.LUCK_VALUE,
      { fontSize: "56px" },
    ).setOrigin(0);

    // Candy icon and count
    const isLegacyUi = globalScene.uiTheme === UiTheme.LEGACY;
    this.pokemonCandyContainer = globalScene.add
      .container(isLegacyUi ? 7 : 4.5, 18)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 30, 20), Phaser.Geom.Rectangle.Contains);
    this.pokemonCandyIcon = globalScene.add //
      .sprite(0, 0, "candy")
      .setScale(0.5)
      .setOrigin(0);
    this.pokemonCandyOverlayIcon = globalScene.add //
      .sprite(0, 0, "candy_overlay")
      .setScale(0.5)
      .setOrigin(0);
    this.pokemonCandyDarknessOverlay = globalScene.add //
      .sprite(0, 0, "candy")
      .setScale(0.5)
      .setOrigin(0)
      .setTint(0x000000)
      .setAlpha(0.5);

    this.pokemonCandyCountText = addTextObject(9.5, 0, "x0", TextStyle.WINDOW_ALT, { fontSize: "56px" }).setOrigin(0);
    this.pokemonCandyContainer.add([
      this.pokemonCandyIcon,
      this.pokemonCandyOverlayIcon,
      this.pokemonCandyDarknessOverlay,
      this.pokemonCandyCountText,
    ]);

    this.pokemonFormText = addTextObject(6, 42, "Form", TextStyle.WINDOW_ALT, {
      fontSize: "42px",
    }).setOrigin(0);

    this.pokemonCaughtHatchedContainer = globalScene.add //
      .container(isLegacyUi ? 4.5 : 2, 25)
      .setScale(0.5);

    const pokemonCaughtIcon = globalScene.add //
      .sprite(1, 0, "items", "pb")
      .setOrigin(0)
      .setScale(0.75);

    this.pokemonCaughtCountText = addTextObject(24, 4, "0", TextStyle.WINDOW_ALT) //
      .setOrigin(0);
    this.pokemonHatchedIcon = globalScene.add //
      .sprite(1, 14, "egg_icons")
      .setOrigin(0.15, 0.2)
      .setScale(0.8);
    this.pokemonShinyIcon = globalScene.add //
      .sprite(isLegacyUi ? 8 : 14, 76, "shiny_icons")
      .setOrigin(0.15, 0.2)
      .setScale(1);
    this.pokemonHatchedCountText = addTextObject(24, 19, "0", TextStyle.WINDOW_ALT) //
      .setOrigin(0);
    this.pokemonMovesContainer = globalScene.add //
      .container(102, 16)
      .setScale(0.375);
    this.pokemonCaughtHatchedContainer.add([
      pokemonCaughtIcon,
      this.pokemonCaughtCountText,
      this.pokemonHatchedIcon,
      this.pokemonShinyIcon,
      this.pokemonHatchedCountText,
    ]);

    for (let m = 0; m < 4; m++) {
      const moveContainer = globalScene.add.container(0, 14 * m);

      const moveBg = globalScene.add.nineslice(0, 0, "type_bgs", "unknown", 92, 14, 2, 2, 2, 2);
      moveBg.setOrigin(1, 0);

      const moveLabel = addTextObject(-moveBg.width / 2, 0, "-", TextStyle.MOVE_LABEL);
      moveLabel.setOrigin(0.5, 0);

      this.pokemonMoveBgs.push(moveBg);
      this.pokemonMoveLabels.push(moveLabel);

      moveContainer.add([moveBg, moveLabel]);

      this.pokemonMoveContainers.push(moveContainer);
      this.pokemonMovesContainer.add(moveContainer);
    }

    this.pokemonAdditionalMoveCountLabel = addTextObject(
      -this.pokemonMoveBgs[0].width / 2,
      56,
      "(+0)",
      TextStyle.MOVE_LABEL,
    )
      .setOrigin(0.5, 0)
      .setColor(getTextColor(TextStyle.WINDOW_ALT))
      .setShadowColor(getTextColor(TextStyle.WINDOW_ALT, true));

    this.pokemonMovesContainer.add(this.pokemonAdditionalMoveCountLabel);

    this.pokemonEggMovesContainer = globalScene.add //
      .container(102, 85)
      .setScale(0.375);

    this.eggMovesLabel = addTextObject(
      -46,
      0,
      i18next.t("starterSelectUiHandler:eggMoves"),
      TextStyle.WINDOW_ALT,
    ).setOrigin(0.5, 0);

    this.pokemonEggMovesContainer.add(this.eggMovesLabel);

    for (let m = 0; m < 4; m++) {
      const eggMoveContainer = globalScene.add.container(0, 16 + 14 * m);

      const eggMoveBg = globalScene.add.nineslice(0, 0, "type_bgs", "unknown", 92, 14, 2, 2, 2, 2);
      eggMoveBg.setOrigin(1, 0);

      const eggMoveLabel = addTextObject(-eggMoveBg.width / 2, 0, "???", TextStyle.MOVE_LABEL);
      eggMoveLabel.setOrigin(0.5, 0);

      this.pokemonEggMoveBgs.push(eggMoveBg);
      this.pokemonEggMoveLabels.push(eggMoveLabel);

      eggMoveContainer.add([eggMoveBg, eggMoveLabel]);

      this.pokemonEggMoveContainers.push(eggMoveContainer);

      this.pokemonEggMovesContainer.add(eggMoveContainer);
    }

    this.teraIcon = globalScene.add.sprite(85, 63, "button_tera").setName("terastallize-icon").setFrame("fire");

    // The font size should be set per language
    const instructionTextSize = textSettings.instructionTextSize;

    // ER layout: the 3-passive expansion (slots y=136/143/150) + nature (157)
    // push the cycle-hotkey strip down. At y=172 with a 3-row wrap the bottom
    // hotkeys fell past the 180px UI height and were clipped. y=166 with a
    // 2-row/3-column wrap (see updateButtonIcon) keeps all 6 visible and clear
    // of the nature row.
    this.instructionsContainer = globalScene.add.container(4, 166).setVisible(true);

    const iRowX = this.instructionRowX;
    const iRowY = this.instructionRowY;
    const iRowTextX = iRowX + this.instructionRowTextOffset;

    // instruction rows that will be pushed into the container dynamically based on need
    // creating new sprites since they will be added to the scene later
    this.shinyIconElement = new Phaser.GameObjects.Sprite(globalScene, iRowX, iRowY, "keyboard", "R.png")
      .setName("sprite-shiny-icon-element")
      .setScale(0.675)
      .setOrigin(0);
    this.shinyLabel = addTextObject(
      iRowTextX,
      iRowY,
      i18next.t("starterSelectUiHandler:cycleShiny"),
      TextStyle.INSTRUCTIONS_TEXT,
      {
        fontSize: instructionTextSize,
      },
    ).setName("text-shiny-label");

    this.formIconElement = new Phaser.GameObjects.Sprite(globalScene, iRowX, iRowY, "keyboard", "F.png")
      .setName("sprite-form-icon-element")
      .setScale(0.675)
      .setOrigin(0);
    this.formLabel = addTextObject(
      iRowTextX,
      iRowY,
      i18next.t("starterSelectUiHandler:cycleForm"),
      TextStyle.INSTRUCTIONS_TEXT,
      {
        fontSize: instructionTextSize,
      },
    ).setName("text-form-label");

    this.genderIconElement = new Phaser.GameObjects.Sprite(globalScene, iRowX, iRowY, "keyboard", "G.png")
      .setName("sprite-gender-icon-element")
      .setScale(0.675)
      .setOrigin(0);
    this.genderLabel = addTextObject(
      iRowTextX,
      iRowY,
      i18next.t("starterSelectUiHandler:cycleGender"),
      TextStyle.INSTRUCTIONS_TEXT,
      { fontSize: instructionTextSize },
    ).setName("text-gender-label");

    this.abilityIconElement = new Phaser.GameObjects.Sprite(globalScene, iRowX, iRowY, "keyboard", "E.png")
      .setName("sprite-ability-icon-element")
      .setScale(0.675)
      .setOrigin(0);
    this.abilityLabel = addTextObject(
      iRowTextX,
      iRowY,
      i18next.t("starterSelectUiHandler:cycleAbility"),
      TextStyle.INSTRUCTIONS_TEXT,
      { fontSize: instructionTextSize },
    ).setName("text-ability-label");

    this.natureIconElement = new Phaser.GameObjects.Sprite(globalScene, iRowX, iRowY, "keyboard", "N.png")
      .setName("sprite-nature-icon-element")
      .setScale(0.675)
      .setOrigin(0);
    this.natureLabel = addTextObject(
      iRowTextX,
      iRowY,
      i18next.t("starterSelectUiHandler:cycleNature"),
      TextStyle.INSTRUCTIONS_TEXT,
      { fontSize: instructionTextSize },
    ).setName("text-nature-label");

    this.teraIconElement = new Phaser.GameObjects.Sprite(globalScene, iRowX, iRowY, "keyboard", "V.png")
      .setName("sprite-tera-icon-element")
      .setScale(0.675)
      .setOrigin(0);
    this.teraLabel = addTextObject(
      iRowTextX,
      iRowY,
      i18next.t("starterSelectUiHandler:cycleTera"),
      TextStyle.INSTRUCTIONS_TEXT,
      {
        fontSize: instructionTextSize,
      },
    ).setName("text-tera-label");

    this.goFilterIconElement = new Phaser.GameObjects.Sprite(
      globalScene,
      this.filterInstructionRowX,
      this.filterInstructionRowY,
      "keyboard",
      "C.png",
    )
      .setName("sprite-goFilter-icon-element")
      .setScale(0.675)
      .setOrigin(0);
    this.goFilterLabel = addTextObject(
      this.filterInstructionRowX + this.instructionRowTextOffset,
      this.filterInstructionRowY,
      i18next.t("starterSelectUiHandler:goFilter"),
      TextStyle.INSTRUCTIONS_TEXT,
      { fontSize: instructionTextSize },
    ).setName("text-goFilter-label");

    /** TODO: Uncomment this and update `this.hideInstructions` once our testing infra supports mocks of `Phaser.GameObject.Group` */
    /*
    this.instructionElemGroup = globalScene.add.group([
      this.shinyIconElement,
      this.shinyLabel,
      this.formIconElement,
      this.formLabel,
      this.genderIconElement,
      this.genderLabel,
      this.abilityIconElement,
      this.abilityLabel,
      this.natureIconElement,
      this.natureLabel,
      this.teraIconElement,
      this.teraLabel,
      this.goFilterIconElement,
      this.goFilterLabel,
    ]);
    */

    this.hideInstructions();

    this.filterInstructionsContainer = globalScene.add.container(50, 5).setVisible(true);

    this.starterSelectMessageBoxContainer = globalScene.add.container(0, sHeight).setVisible(false);

    this.starterSelectMessageBox = addWindow(1, -1, 318, 28).setOrigin(0, 1);
    this.starterSelectMessageBoxContainer.add(this.starterSelectMessageBox);

    // wordWrap: long texts (e.g. the difficulty mode descriptions) flowed off
    // the right edge in one unreadable line; the box fits two wrapped lines.
    this.message = addTextObject(8, 8, "", TextStyle.WINDOW, {
      maxLines: 2,
      wordWrap: { width: 1810 },
    }).setOrigin(0);
    this.starterSelectMessageBoxContainer.add(this.message);

    // arrow icon for the message box
    this.initPromptSprite(this.starterSelectMessageBoxContainer);

    this.statsContainer = new StatsContainer(6, 16).setVisible(false);

    globalScene.add.existing(this.statsContainer);

    // add the info overlay last to be the top most ui element and prevent the IVs from overlaying this
    this.moveInfoOverlay = new MoveInfoOverlay({
      top: true,
      x: 1,
      y: globalScene.scaledCanvas.height - MoveInfoOverlay.getHeight() - 29,
    });

    // ER: the lower-left info panel (Ability / Passive / Nature) is baked into
    // `starter_select_bg` and was sized for a single passive. ER shows 3 passive
    // rows (main innate + 2 slots), so the last slot + Nature spill below the
    // baked white. Overlay a white strip that overlaps the baked panel's bottom
    // (white-on-white, seamless) and extends down to cover all rows. Sits just
    // above the bg and below every text object, so the text stays on white.
    const starterInfoPanelExtension = globalScene.add
      .rectangle(1, 145 + starterInfoYOffset, 157, 24, 0xffffff)
      .setOrigin(0, 0);

    this.starterSelectContainer.add([
      bgColor,
      starterSelectBg,
      starterInfoPanelExtension,
      starterDexNoLabel,
      this.shinyOverlay,
      starterContainerBg,
      // ER: "Use Last Team" window (top action row).
      addWindow(
        teamWindowX,
        teamWindowY - 2 * randomSelectionWindowHeight,
        teamWindowWidth,
        randomSelectionWindowHeight,
        true,
      ),
      addWindow(
        teamWindowX,
        teamWindowY - randomSelectionWindowHeight,
        teamWindowWidth,
        randomSelectionWindowHeight,
        true,
      ),
      addWindow(teamWindowX, teamWindowY, teamWindowWidth, teamWindowHeight),
      addWindow(teamWindowX, teamWindowY + teamWindowHeight, teamWindowWidth, teamWindowWidth, true),
      starterContainerWindow,
      this.pokemonSprite,
      this.shinyLabFxSprite,
      this.pokemonNumberText,
      this.pokemonNameText,
      this.pokemonGrowthRateLabelText,
      this.pokemonGrowthRateText,
      this.pokemonGenderText,
      this.pokemonUncaughtText,
      this.pokemonAbilityLabelText,
      this.pokemonAbilityText,
      this.pokemonPassiveLabelText,
      this.pokemonPassiveText,
      this.pokemonPassiveDisabledIcon,
      this.pokemonPassiveLockedIcon,
      ...this.pokemonPassiveSlotTexts,
      ...this.pokemonPassiveSlotDisabledIcons,
      ...this.pokemonPassiveSlotLockedIcons,
      this.pokemonNatureLabelText,
      this.pokemonNatureText,
      this.valueLimitLabel,
      this.coopStatusText,
      startLabel,
      this.startCursorObj,
      lastTeamSelectLabel,
      this.lastTeamCursorObj,
      randomSelectLabel,
      this.randomCursorObj,
      this.starterIconsCursorObj,
      starterBoxContainer,
      ...this.starterIcons,
      this.type1Icon,
      this.type2Icon,
      this.pokemonLuckLabelText,
      this.pokemonLuckText,
      this.pokemonCandyContainer,
      this.pokemonFormText,
      this.pokemonCaughtHatchedContainer,
      this.pokemonMovesContainer,
      this.pokemonEggMovesContainer,
      this.teraIcon,
      this.instructionsContainer,
      this.filterInstructionsContainer,
      this.starterSelectMessageBoxContainer,
      this.statsContainer,
      this.moveInfoOverlay,
      // Filter bar sits above everything, except the tutorial overlay and message box.
      // Do not put anything below this unless it must appear below the filter bar.
      this.filterBarContainer,
      this.filterTextContainer,
    ]);

    this.initTutorialOverlay(this.starterSelectContainer);
    this.starterSelectContainer.bringToTop(this.starterSelectMessageBoxContainer);

    globalScene.eventTarget.addEventListener(BattleSceneEventType.CANDY_UPGRADE_NOTIFICATION_CHANGED, e =>
      this.onCandyUpgradeDisplayChanged(e),
    );

    this.updateInstructions();
  }

  /**
   * Toggle the corner Discord/GitHub links (a DOM overlay defined in index.html).
   * They should ONLY show on the starter-select screen, so we flip the element's
   * display on enter/leave. Guarded for the headless test environment (no DOM).
   */
  private setErLinksVisible(visible: boolean): void {
    if (typeof document === "undefined") {
      return;
    }
    const el = document.getElementById("er-links");
    if (el) {
      el.style.display = visible ? "flex" : "none";
    }
  }

  show(args: any[]): boolean {
    this.setErLinksVisible(true);
    this.moveInfoOverlay.clear(); // clear this when removing a menu; the cancel button doesn't seem to trigger this automatically on controllers
    this.pokerusSpecies = getPokerusStarters();

    this.allowTera = Object.hasOwn(globalScene.gameData.achvUnlocks, achvs.TERASTALLIZE.id);

    if (args.length > 0 && args[0] instanceof Function) {
      super.show(args);
      this.starterSelectCallback = args[0] as StarterSelectCallback;

      // ER Community Challenge roster-pick mode (args[1]); unset for normal team-select.
      const rosterOpts = args[1] as StarterRosterPickOptions | undefined;
      this.rosterPickMode = !!rosterOpts?.rosterPickMode;
      this.rosterSelected = new Set(rosterOpts?.initialSelected ?? []);
      this.rosterConfirm = rosterOpts?.onRosterConfirm ?? null;

      this.starterSelectContainer.setVisible(true);
      // Co-op (#633): subscribe the partner-status banner to the live session.
      this.coopStatusUnsub?.();
      this.coopStatusUnsub = null;
      const coopController = getCoopController();
      if (globalScene.gameMode.isCoop && coopController) {
        this.coopStatusUnsub = coopController.onChange(() => this.updateCoopStatus());
      }
      this.updateCoopStatus();
      this.spriteLoadAttempts.clear(); // fresh visit: allow previously-failed sprites to retry
      this.pokemonSprite.setPipelineData("previewStateKey", "");
      // Background grid pre-warmer (idle-gated, single-flight — see prewarmVisibleSprites).
      this.spritePrewarmTimer?.remove();
      this.spritePrewarmTimer = globalScene.time.addEvent({
        delay: 150,
        loop: true,
        callback: () => this.prewarmVisibleSprites(),
      });
      this.shinyLabFxTick = 0;
      this.shinyLabFxTimer?.remove();
      this.shinyLabFxTimer = globalScene.time.addEvent({
        delay: 100,
        loop: true,
        callback: () => {
          if (this.statsMode || !this.starterSelectContainer.visible) {
            return;
          }
          this.shinyLabFxTick = (this.shinyLabFxTick + 1) % 60000;
          if (this.shinyLabFxSprite.visible) {
            this.refreshAnimatedShinyLabFxPreview();
          }
          this.refreshVisibleShinyLabIconFx();
        },
      });

      this.starterPreferences = loadStarterPreferences();
      // Deep copy the JSON (avoid re-loading from disk)
      this.originalStarterPreferences = deepCopy(this.starterPreferences);

      this.allSpecies.forEach((species, s) => {
        const icon = this.starterContainers[s].icon;
        const { dexEntry } = this.getSpeciesData(species.speciesId);

        // Initialize the StarterAttributes for this species
        this.starterPreferences[species.speciesId] = this.initStarterPrefs(species, this.starterPreferences);
        this.originalStarterPreferences[species.speciesId] = this.initStarterPrefs(
          species,
          this.originalStarterPreferences,
          true,
        );

        if (dexEntry.caughtAttr) {
          icon.clearTint();
        } else if (dexEntry.seenAttr) {
          icon.setTint(0x808080);
        }

        this.setUpgradeAnimation(icon, species);
      });

      const notFreshStart = !globalScene.gameMode.hasChallenge(Challenges.FRESH_START);

      for (const container of this.pokemonEggMoveContainers) {
        container.setVisible(notFreshStart);
      }
      this.eggMovesLabel.setVisible(notFreshStart);
      // This is not enough, we need individual checks in setStarterSpecies too! :)
      this.pokemonPassiveDisabledIcon.setVisible(notFreshStart);
      this.pokemonPassiveLabelText.setVisible(notFreshStart);
      this.pokemonPassiveLockedIcon.setVisible(notFreshStart);
      this.pokemonPassiveText.setVisible(notFreshStart);
      for (const slotText of this.pokemonPassiveSlotTexts) {
        slotText.setVisible(notFreshStart);
      }
      for (const slotIcon of this.pokemonPassiveSlotDisabledIcons) {
        slotIcon.setVisible(false);
      }
      for (const slotIcon of this.pokemonPassiveSlotLockedIcons) {
        slotIcon.setVisible(false);
      }

      this.resetFilters();
      this.updateStarters();

      this.setFilterMode(false);
      this.filterBarCursor = 0;
      this.setCursor(0);
      this.tryUpdateValue(0);

      // Showdown Team Menu offline build (addendum): the flow may pass a build-options bag as args[2].
      //   - `onCancel`: route the grid top-level back-out to the Team Menu (not the title) - see tryExit.
      //   - `seedStarters`: pre-seed the grid party when EDITING a preset, so the team strip shows the
      //     preset's mons and each opens in the editor with its saved set (rules re-checked at Done).
      // Reset every show so a stale build callback / seed never leaks into a later normal open.
      this.showdownBuildOnCancel = null;
      this.showdownSeedInFlight = null;
      this.showdownSeedGeneration++;
      const showdownBuild = (args.length > 2 ? args[2] : null) as ShowdownPresetBuildEntry | null;
      if (globalScene.gameMode.isShowdown && showdownBuild != null) {
        this.showdownBuildOnCancel = showdownBuild.onCancel ?? null;
        if (showdownBuild.seedStarters != null && showdownBuild.seedStarters.length > 0) {
          this.seedTeamFromStarters(showdownBuild.seedStarters);
        }
      }
      const coopBrowserStarters = getCoopBrowserCommanderFixtureStarters() ?? getCoopBrowserFaintFixtureStarters();
      if (globalScene.gameMode.isCoop && coopBrowserStarters != null) {
        // CI checkpoint only: materialize the otherwise account-locked species in the NORMAL visible
        // starter UI. The browser still submits and confirms this team through public keys, and the
        // registry requires both the exact dedicated build flag and this client's exact URL fixture.
        this.seedTeamFromStarters(coopBrowserStarters, { allowUncaught: true });
      }

      // Roster-pick mode: hide the party point-budget label and paint the initial marks.
      this.valueLimitLabel.setVisible(!this.rosterPickMode);
      if (this.rosterPickMode) {
        // Opened as an OVERLAY over the create designer (a high-z handler); this screen
        // is registered early (low z), so raise it to the top or it renders BEHIND the
        // designer/browser and the player just sees the screen they came from.
        globalScene.ui.bringToTop(this.starterSelectContainer);
        this.refreshRosterMarks();
      }

      handleTutorial(Tutorial.STARTER_SELECT);

      return true;
    }

    return false;
  }

  /**
   * Get the starter attributes for the given PokemonSpecies, after sanitizing them.
   * If somehow a preference is set for a form, variant, gender, ability or nature
   * that wasn't actually unlocked or is invalid it will be cleared here
   *
   * @param species The species to get Starter Preferences for
   * @returns StarterAttributes for the species
   */
  initStarterPrefs(
    species: PokemonSpecies,
    preferences: StarterPreferences,
    ignoreChallenge = false,
  ): StarterAttributes {
    // if preferences for the species is undefined, set it to an empty object
    preferences[species.speciesId] ??= {};
    const starterAttributes = preferences[species.speciesId];
    const { dexEntry, starterDataEntry: starterData } = this.getSpeciesData(species.speciesId, !ignoreChallenge);

    // no preferences or Pokemon wasn't caught, return empty attribute
    if (!starterAttributes || !dexEntry.caughtAttr) {
      return {};
    }

    const caughtAttr = dexEntry.caughtAttr;

    const hasShiny = caughtAttr & DexAttr.SHINY;
    const hasNonShiny = caughtAttr & DexAttr.NON_SHINY;
    if (starterAttributes.shiny && !hasShiny) {
      // shiny form wasn't unlocked, purging shiny and variant setting
      starterAttributes.shiny = undefined;
      starterAttributes.variant = undefined;
    } else if (starterAttributes.shiny === false && !hasNonShiny) {
      // non shiny form wasn't unlocked, purging shiny setting
      starterAttributes.shiny = undefined;
    }

    if (starterAttributes.variant !== undefined) {
      const unlockedVariants = [
        hasShiny && caughtAttr & DexAttr.DEFAULT_VARIANT,
        hasShiny && caughtAttr & DexAttr.VARIANT_2,
        hasShiny && caughtAttr & DexAttr.VARIANT_3,
      ];
      if (
        Number.isNaN(starterAttributes.variant)
        || starterAttributes.variant < 0
        || !unlockedVariants[starterAttributes.variant]
      ) {
        // variant value is invalid or requested variant wasn't unlocked, purging setting
        starterAttributes.variant = undefined;
      }
    }

    if (
      starterAttributes.female !== undefined
      && !(starterAttributes.female ? caughtAttr & DexAttr.FEMALE : caughtAttr & DexAttr.MALE)
    ) {
      // requested gender wasn't unlocked, purging setting
      starterAttributes.female = undefined;
    }

    if (starterAttributes.ability !== undefined) {
      const speciesHasSingleAbility = species.ability2 === species.ability1;
      const abilityAttr = starterData.abilityAttr;
      const hasAbility1 = abilityAttr & AbilityAttr.ABILITY_1;
      const hasAbility2 = abilityAttr & AbilityAttr.ABILITY_2;
      const hasHiddenAbility = abilityAttr & AbilityAttr.ABILITY_HIDDEN;
      // Due to a past bug it is possible that some Pokemon with a single ability have the ability2 flag
      // In this case, we only count ability2 as valid if ability1 was not unlocked, otherwise we ignore it
      const unlockedAbilities = [
        hasAbility1,
        speciesHasSingleAbility ? hasAbility2 && !hasAbility1 : hasAbility2,
        hasHiddenAbility,
      ];
      if (!unlockedAbilities[starterAttributes.ability]) {
        // requested ability wasn't unlocked, purging setting
        starterAttributes.ability = undefined;
      }
    }

    const selectedForm = starterAttributes.form;
    if (
      selectedForm !== undefined
      && (!species.forms[selectedForm]?.isStarterSelectable
        || !(caughtAttr & globalScene.gameData.getFormAttr(selectedForm)))
    ) {
      // requested form wasn't unlocked/isn't a starter form, purging setting
      starterAttributes.form = undefined;
    }

    if (starterAttributes.nature !== undefined) {
      const unlockedNatures = globalScene.gameData.getNaturesForAttr(dexEntry.natureAttr);
      if (unlockedNatures.indexOf(starterAttributes.nature as unknown as Nature) < 0) {
        // requested nature wasn't unlocked, purging setting
        starterAttributes.nature = undefined;
      }
    }

    if (starterAttributes.tera !== undefined) {
      // If somehow we have an illegal tera type, it is reset here
      if (!(starterAttributes.tera === species.type1 || starterAttributes.tera === species?.type2)) {
        starterAttributes.tera = species.type1;
      }
      // In fresh start challenge, the tera type is always reset to the first one
      if (globalScene.gameMode.hasChallenge(Challenges.FRESH_START) && !ignoreChallenge) {
        starterAttributes.tera = species.type1;
      }
    }

    return starterAttributes;
  }

  /**
   * Set the selections for all filters to their default starting value
   */
  public resetFilters(): void {
    this.filterBar.setValsToDefault();
    this.filterText?.setValsToDefault();
    this.resetCaughtDropdown();
  }

  /**
   * Set default value for the caught dropdown, which only shows caught mons
   */
  public resetCaughtDropdown(): void {
    const caughtDropDown: DropDown = this.filterBar.getFilter(DropDownColumn.CAUGHT);

    caughtDropDown.resetToDefault();

    // initial setting, in caught filter, select the options excluding the uncaught option
    for (let i = 0; i < caughtDropDown.options.length; i++) {
      // if the option is not "ALL" or "UNCAUGHT", toggle it
      if (caughtDropDown.options[i].val !== "ALL" && caughtDropDown.options[i].val !== "UNCAUGHT") {
        caughtDropDown.toggleOptionState(i);
      }
    }
  }

  showText(
    text: string,
    delay?: number,
    callback?: () => void,
    callbackDelay?: number,
    prompt?: boolean,
    promptDelay?: number,
    moveToTop?: boolean,
  ) {
    super.showText(text, delay, callback, callbackDelay, prompt, promptDelay);

    // Multi-line includes WRAPPED text, not just literal newlines - the
    // difficulty mode descriptions wrap onto a second line that clipped
    // below the single-line box. Measure with the text object's own wrap.
    const wrappedLines = text ? this.message.getWrappedText(text).length : 1;
    const singleLine = text?.indexOf("\n") === -1 && wrappedLines <= 1;

    this.starterSelectMessageBox.setSize(318, singleLine ? 28 : 42);

    if (moveToTop) {
      this.starterSelectMessageBox.setOrigin(0);
      this.starterSelectMessageBoxContainer.setY(0);
      this.message.setY(4);
    } else {
      this.starterSelectMessageBoxContainer.setY(globalScene.scaledCanvas.height);
      this.starterSelectMessageBox.setOrigin(0, 1);
      this.message.setY(singleLine ? -22 : -37);
    }

    this.starterSelectMessageBoxContainer.setVisible(text?.length > 0);
  }

  /**
   * Determines if 'Icon' based upgrade notifications should be shown
   * @returns true if upgrade notifications are enabled and set to display an 'Icon'
   */
  isUpgradeIconEnabled(): boolean {
    return globalScene.candyUpgradeNotification !== 0 && globalScene.candyUpgradeDisplay === 0;
  }
  /**
   * Determines if 'Animation' based upgrade notifications should be shown
   * @returns true if upgrade notifications are enabled and set to display an 'Animation'
   */
  isUpgradeAnimationEnabled(): boolean {
    return globalScene.candyUpgradeNotification !== 0 && globalScene.candyUpgradeDisplay === 1;
  }

  /**
   * Determines if a passive upgrade is available for the given species ID
   * @param speciesId The ID of the species to check the passive of
   * @returns true if the user has enough candies and a passive has not been unlocked already
   */
  isPassiveAvailable(speciesId: SpeciesId): boolean {
    const starterData = globalScene.gameData.getStarterDataEntry(speciesId);
    const starterCost = speciesStarterCosts[speciesId];
    if (starterCost == null) {
      return false;
    }
    // ER 3-slot passives: available if ANY innate slot is still LOCKED, holds a
    // real ability, and the player can afford that slot's candy cost. The legacy
    // check only looked at slot 0 (`PassiveAttr.UNLOCKED`), so a mon with one slot
    // unlocked wrongly read as "nothing to unlock" — hiding both the candy-upgrade
    // icon and the "Can Unlock" filter (user report: Finneon). Cost mirrors the
    // unlock menu via getErPassiveSlotCandyCost so the two screens never diverge.
    const passiveAbilityIds = getPokemonSpecies(speciesId).getPassiveAbilities(0);
    for (let slot = 0; slot < PASSIVE_SLOTS.length; slot++) {
      if (passiveAbilityIds[slot] === AbilityId.NONE || isSlotUnlocked(starterData.passiveAttr, slot as PassiveSlot)) {
        continue;
      }
      if (
        Overrides.FREE_CANDY_UPGRADE_OVERRIDE
        || starterData.candyCount >= getErPassiveSlotCandyCost(getPassiveCandyCount(starterCost), slot)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determines if a value reduction upgrade is available for the given species ID
   * @param speciesId The ID of the species to check the value reduction of
   * @returns true if the user has enough candies and all value reductions have not been unlocked already
   */
  isValueReductionAvailable(speciesId: SpeciesId): boolean {
    // Get this species ID's starter data
    const starterData = globalScene.gameData.getStarterDataEntry(speciesId);
    const starterCost = speciesStarterCosts[speciesId];

    return (
      starterCost != null
      && starterData.candyCount >= getValueReductionCandyCounts(starterCost)[starterData.valueReduction]
      && starterData.valueReduction < valueReductionMax
    );
  }

  /**
   * Determines if an same species egg can be bought for the given species ID
   * @param speciesId The ID of the species to check the value reduction of
   * @returns true if the user has enough candies
   */
  isSameSpeciesEggAvailable(speciesId: SpeciesId): boolean {
    const starterData = globalScene.gameData.getStarterDataEntry(speciesId);
    const starterCost = speciesStarterCosts[speciesId];
    const dexData = globalScene.gameData.dexData[speciesId];

    // ER: guard for ER-custom species missing from dexData.
    if (!dexData) {
      return false;
    }
    const hatchedCount = dexData.hatchedCount;

    return starterCost != null && starterData.candyCount >= getSameSpeciesEggCandyCounts(starterCost, hatchedCount);
  }

  /**
   * Sets a bounce animation if enabled and the Pokemon has an upgrade
   * @param icon {@linkcode Phaser.GameObjects.GameObject} to animate
   * @param species {@linkcode PokemonSpecies} of the icon used to check for upgrades
   * @param startPaused Should this animation be paused after it is added?
   */
  setUpgradeAnimation(icon: Phaser.GameObjects.Sprite, species: PokemonSpecies, startPaused = false): void {
    globalScene.tweens.killTweensOf(icon);
    // Skip animations if they are disabled
    if (globalScene.candyUpgradeDisplay === 0 || species.speciesId !== species.getRootSpeciesId(false)) {
      return;
    }

    icon.y = 2;

    const tweenChain: Phaser.Types.Tweens.TweenChainBuilderConfig = {
      targets: icon,
      paused: startPaused,
      loop: -1,
      // Make the initial bounce a little randomly delayed
      delay: randIntRange(0, 50) * 5,
      loopDelay: fixedInt(1000),
      tweens: [
        {
          targets: icon,
          y: "-=5",
          duration: fixedInt(125),
          ease: "Cubic.easeOut",
          yoyo: true,
        },
        {
          targets: icon,
          y: "-=3",
          duration: fixedInt(150),
          ease: "Cubic.easeOut",
          yoyo: true,
        },
      ],
    };

    if (
      this.isPassiveAvailable(species.speciesId)
      || (globalScene.candyUpgradeNotification === 2
        && (this.isValueReductionAvailable(species.speciesId) || this.isSameSpeciesEggAvailable(species.speciesId)))
    ) {
      const chain = globalScene.tweens.chain(tweenChain);
      if (!startPaused) {
        chain.play();
      }
    }
  }

  /**
   * Sets the visibility of a Candy Upgrade Icon
   */
  setUpgradeIcon(starter: StarterContainer): void {
    const species = starter.species;
    const slotVisible = !!species?.speciesId;

    if (
      !species
      || globalScene.candyUpgradeNotification === 0
      || species.speciesId !== species.getRootSpeciesId(false)
    ) {
      starter.candyUpgradeIcon.setVisible(false);
      starter.candyUpgradeOverlayIcon.setVisible(false);
      return;
    }

    const isPassiveAvailable = this.isPassiveAvailable(species.speciesId);
    const isValueReductionAvailable = this.isValueReductionAvailable(species.speciesId);
    const isSameSpeciesEggAvailable = this.isSameSpeciesEggAvailable(species.speciesId);

    // 'Passive Only' mode
    if (globalScene.candyUpgradeNotification === 1) {
      starter.candyUpgradeIcon.setVisible(slotVisible && isPassiveAvailable);
      starter.candyUpgradeOverlayIcon.setVisible(slotVisible && starter.candyUpgradeIcon.visible);

      // 'On' mode
    } else if (globalScene.candyUpgradeNotification === 2) {
      starter.candyUpgradeIcon.setVisible(
        slotVisible && (isPassiveAvailable || isValueReductionAvailable || isSameSpeciesEggAvailable),
      );
      starter.candyUpgradeOverlayIcon.setVisible(slotVisible && starter.candyUpgradeIcon.visible);
    }
  }

  /**
   * Update the display of candy upgrade icons or animations for the given StarterContainer
   * @param starterContainer the container for the Pokemon to update
   */
  updateCandyUpgradeDisplay(starterContainer: StarterContainer) {
    if (this.isUpgradeIconEnabled()) {
      this.setUpgradeIcon(starterContainer);
    }
    if (this.isUpgradeAnimationEnabled()) {
      this.setUpgradeAnimation(starterContainer.icon, this.lastSpecies, true);
    }
  }

  /**
   * Processes an {@linkcode CandyUpgradeNotificationChangedEvent} sent when the corresponding setting changes
   * @param event {@linkcode Event} sent by the callback
   */
  onCandyUpgradeDisplayChanged(event: Event): void {
    const candyUpgradeDisplayEvent = event as CandyUpgradeNotificationChangedEvent;
    if (!candyUpgradeDisplayEvent) {
      return;
    }

    // Loop through all visible candy icons when set to 'Icon' mode
    if (globalScene.candyUpgradeDisplay === 0) {
      this.filteredStarterContainers.forEach(starter => {
        this.setUpgradeIcon(starter);
      });

      return;
    }

    // Loop through all animations when set to 'Animation' mode
    this.filteredStarterContainers.forEach((starter, s) => {
      const icon = this.filteredStarterContainers[s].icon;

      this.setUpgradeAnimation(icon, starter.species);
    });
  }

  processInput(button: Button): boolean {
    if (this.blockInput) {
      return false;
    }

    const maxColumns = 9;
    const maxRows = 9;
    const numberOfStarters = this.filteredStarterContainers.length;
    const numOfRows = Math.ceil(numberOfStarters / maxColumns);
    const currentRow = Math.floor(this.cursor / maxColumns);
    const onScreenFirstIndex = this.scrollCursor * maxColumns; // this is first starter index on the screen
    const onScreenLastIndex = Math.min(
      this.filteredStarterContainers.length - 1,
      onScreenFirstIndex + maxRows * maxColumns - 1,
    ); // this is the last starter index on the screen
    const onScreenNumberOfStarters = onScreenLastIndex - onScreenFirstIndex + 1;
    const onScreenNumberOfRows = Math.ceil(onScreenNumberOfStarters / maxColumns);
    const onScreenCurrentRow = Math.floor((this.cursor - onScreenFirstIndex) / maxColumns);

    const ui = this.getUi();

    let success = false;
    let error = false;

    if (button === Button.SUBMIT) {
      if (this.tryStart(true)) {
        success = true;
      } else {
        error = true;
      }
    } else if (button === Button.CANCEL) {
      if (this.filterTextMode) {
        // ER text search: Cancel leaves the search panel and returns to the
        // grid, KEEPING any active text filter applied so the player can browse
        // the filtered results. (Use the dedicated "Clear search" row in the
        // panel to wipe the query in place.)
        this.setFilterTextMode(false);
        this.setCursor(this.cursor);
        success = true;
      } else if (this.filterMode && this.filterBar.openDropDown) {
        // CANCEL with a filter menu open > close it
        this.filterBar.toggleDropDown(this.filterBarCursor);
        success = true;
      } else if (
        this.filterMode
        && !this.filterBar.getFilter(this.filterBar.getColumn(this.filterBarCursor)).hasDefaultValues()
      ) {
        if (this.filterBar.getColumn(this.filterBarCursor) === DropDownColumn.CAUGHT) {
          this.resetCaughtDropdown();
        } else {
          this.filterBar.resetSelection(this.filterBarCursor);
        }
        this.updateStarters();
        success = true;
      } else if (this.statsMode) {
        this.toggleStatsMode(false);
        success = true;
      } else if (this.rosterPickMode) {
        // Roster-pick: B = "Done" (commit the allowed set), mirroring the custom grid
        // it replaces. The caller reverts this overlay back to the create designer.
        this.rosterConfirm?.([...this.rosterSelected]);
        success = true;
      } else if (this.starterSpecies.length > 0) {
        this.popStarter(this.starterSpecies.length - 1);
        success = true;
        this.updateInstructions();
      } else {
        this.tryExit();
        success = true;
      }
    } else if (button === Button.STATS) {
      // Stats key → jump to the filter bar (the "Search" tab there opens the
      // free-text Name/Ability-text panel). Pressing it from the panel closes it.
      if (this.filterTextMode) {
        this.setFilterTextMode(false);
        this.setCursor(this.cursor);
      } else if (!this.filterMode) {
        this.startCursorObj.setVisible(false);
        this.starterIconsCursorObj.setVisible(false);
        this.randomCursorObj.setVisible(false);
        this.setSpecies(null);
        this.filterBarCursor = 0;
        this.setFilterMode(true);
        this.filterBar.toggleDropDown(this.filterBarCursor);
      }
      success = true;
    } else if (this.startCursorObj.visible) {
      // this checks to see if the start button is selected
      switch (button) {
        case Button.ACTION:
          if (this.tryStart(true)) {
            success = true;
          } else {
            error = true;
          }
          break;
        case Button.UP:
          // UP from start button: go to pokemon in team if any, otherwise filter
          this.startCursorObj.setVisible(false);
          if (this.starterSpecies.length > 0) {
            this.starterIconsCursorIndex = this.starterSpecies.length - 1;
            this.moveStarterIconsCursor(this.starterIconsCursorIndex);
          } else {
            // TODO: how can we get here if start button can't be selected? this appears to be redundant
            this.startCursorObj.setVisible(false);
            this.randomCursorObj.setVisible(true);
          }
          success = true;
          break;
        case Button.DOWN:
          // DOWN from start button: Go to filters
          this.startCursorObj.setVisible(false);
          this.filterBarCursor = Math.max(1, this.filterBar.numFilters - 1);
          this.setFilterMode(true);
          success = true;
          break;
        case Button.LEFT:
          if (numberOfStarters > 0) {
            this.startCursorObj.setVisible(false);
            this.cursorObj.setVisible(true);
            this.setCursor(onScreenFirstIndex + (onScreenNumberOfRows - 1) * 9 + 8); // set last column
            success = true;
          }
          break;
        case Button.RIGHT:
          if (numberOfStarters > 0) {
            this.startCursorObj.setVisible(false);
            this.cursorObj.setVisible(true);
            this.setCursor(onScreenFirstIndex + (onScreenNumberOfRows - 1) * 9); // set first column
            success = true;
          }
          break;
      }
    } else if (this.filterTextMode) {
      // ER free-text search panel — self-contained: Up/Down picks a field,
      // Action opens text entry, Cancel returns to the grid.
      switch (button) {
        case Button.UP:
          this.filterTextCursor = (this.filterTextCursor - 1 + this.filterText.numFilters) % this.filterText.numFilters;
          this.filterText.setCursor(this.filterTextCursor);
          success = true;
          break;
        case Button.DOWN:
          this.filterTextCursor = (this.filterTextCursor + 1) % this.filterText.numFilters;
          this.filterText.setCursor(this.filterTextCursor);
          success = true;
          break;
        case Button.ACTION:
          if (this.filterText.getRow(this.filterTextCursor) === FilterTextRow.CLEAR) {
            // "Clear search" row — reset every field + re-filter, staying in the panel.
            this.filterText.setValsToDefault();
          } else {
            this.filterText.startSearch(this.filterTextCursor, this.getUi());
          }
          success = true;
          break;
        case Button.LEFT:
        case Button.RIGHT:
          // Step out to the grid.
          this.setFilterTextMode(false);
          this.setCursor(this.cursor);
          success = true;
          break;
      }
    } else if (this.filterMode) {
      switch (button) {
        case Button.LEFT:
          if (this.filterBarCursor > 0) {
            success = this.setCursor(this.filterBarCursor - 1);
          } else {
            success = this.setCursor(this.filterBar.numFilters - 1);
          }
          break;
        case Button.RIGHT:
          if (this.filterBarCursor < this.filterBar.numFilters - 1) {
            success = this.setCursor(this.filterBarCursor + 1);
          } else {
            success = this.setCursor(0);
          }
          break;
        case Button.UP:
          if (this.filterBar.openDropDown) {
            success = this.filterBar.decDropDownCursor();
          } else if (this.filterBarCursor === this.filterBar.numFilters - 1) {
            // UP from the last filter, move to start button
            this.setFilterMode(false);
            this.cursorObj.setVisible(false);
            if (this.starterSpecies.length > 0) {
              this.startCursorObj.setVisible(true);
            } else {
              this.randomCursorObj.setVisible(true);
            }
            success = true;
          } else if (numberOfStarters > 0) {
            // UP from filter bar to bottom of Pokemon list
            this.setFilterMode(false);
            this.scrollCursor = Math.max(0, numOfRows - 9);
            this.updateScroll();
            const proportion = (this.filterBarCursor + 0.5) / this.filterBar.numFilters;
            const targetCol = Math.min(8, Math.floor(proportion * 11));
            if (numberOfStarters % 9 > targetCol) {
              this.setCursor(numberOfStarters - (numberOfStarters % 9) + targetCol);
            } else {
              this.setCursor(Math.max(numberOfStarters - (numberOfStarters % 9) + targetCol - 9, 0));
            }
            success = true;
          }
          break;
        case Button.DOWN:
          if (this.filterBar.openDropDown) {
            success = this.filterBar.incDropDownCursor();
          } else if (this.filterBarCursor === this.filterBar.numFilters - 1) {
            // DOWN from the last filter, move to the top action row (Use Last Team).
            this.setFilterMode(false);
            this.cursorObj.setVisible(false);
            this.lastTeamCursorObj.setVisible(true);
            success = true;
          } else if (numberOfStarters > 0) {
            // DOWN from filter bar to top of Pokemon list
            this.setFilterMode(false);
            this.scrollCursor = 0;
            this.updateScroll();
            const proportion = this.filterBarCursor / Math.max(1, this.filterBar.numFilters - 1);
            const targetCol = Math.min(8, Math.floor(proportion * 11));
            this.setCursor(Math.min(targetCol, numberOfStarters));
            success = true;
          }
          break;
        case Button.ACTION:
          if (this.filterBar.getColumn(this.filterBarCursor) === DropDownColumn.SEARCH) {
            // ER: the Search tab opens the free-text Name/Ability-text panel.
            // Checked first since the (empty) Search dropdown may be "open" from
            // navigating across tabs.
            this.filterBar.hideDropDowns();
            this.filterBar.cursorObj.setVisible(false);
            this.filterMode = false;
            this.filterTextCursor = 0;
            this.setFilterTextMode(true);
          } else if (this.filterBar.openDropDown) {
            this.filterBar.toggleOptionState();
          } else {
            this.filterBar.toggleDropDown(this.filterBarCursor);
          }
          success = true;
          break;
      }
    } else if (this.randomCursorObj.visible) {
      switch (button) {
        case Button.ACTION: {
          if (this.starterSpecies.length >= this.getPartySizeLimit()) {
            error = true;
            break;
          }
          const currentPartyValue = this.starterSpecies
            .map(s => s.generation)
            .reduce(
              (total: number, _gen: number, i: number) =>
                total + globalScene.gameData.getSpeciesStarterValue(this.starterSpecies[i].speciesId),
              0,
            );
          // Filter valid starters
          const validStarters = this.filteredStarterContainers.filter(starter => {
            const species = starter.species;
            const [isDupe] = this.isInParty(species);
            const starterCost = globalScene.gameData.getSpeciesStarterValue(species.speciesId);
            const isValidForChallenge = checkStarterValidForChallenge(
              species,
              globalScene.gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(species.speciesId)),
              this.isPartyValid(),
            );
            const isCaught = this.getSpeciesData(species.speciesId).dexEntry.caughtAttr;
            return (
              !isDupe && isValidForChallenge && currentPartyValue + starterCost <= this.getValueLimit() && isCaught
            );
          });
          if (validStarters.length === 0) {
            error = true; // No valid starters available
            break;
          }
          // Select random starter
          const randomStarter = validStarters[Math.floor(Math.random() * validStarters.length)];
          const randomSpecies = randomStarter.species;
          // Set species and prepare attributes
          this.setSpecies(randomSpecies);
          const dexAttr = this.getCurrentDexProps(randomSpecies.speciesId);
          const props = globalScene.gameData.getSpeciesDexAttrProps(randomSpecies, dexAttr);
          const abilityIndex = this.abilityCursor;
          const nature = this.natureCursor as unknown as Nature;
          const teraType = this.teraCursor;
          const moveset = this.starterMoveset?.slice(0) as StarterMoveset;
          const starterCost = globalScene.gameData.getSpeciesStarterValue(randomSpecies.speciesId);
          const speciesForm = getPokemonSpeciesForm(randomSpecies.speciesId, props.formIndex);
          // Load assets and add to party
          speciesForm.loadAssets(props.female, props.formIndex, props.shiny, props.variant, true).then(() => {
            if (this.tryUpdateValue(starterCost, true)) {
              this.addToParty(randomSpecies, dexAttr, abilityIndex, nature, moveset, teraType, true);
              ui.playSelect();
            }
          });
          break;
        }
        case Button.UP:
          // ER: move up to the "Use Last Team" row instead of the filter bar.
          this.randomCursorObj.setVisible(false);
          this.lastTeamCursorObj.setVisible(true);
          success = true;
          break;
        case Button.DOWN:
          this.randomCursorObj.setVisible(false);
          if (this.starterSpecies.length > 0) {
            this.starterIconsCursorIndex = 0;
            this.moveStarterIconsCursor(this.starterIconsCursorIndex);
          } else {
            this.filterBarCursor = this.filterBar.numFilters - 1;
            this.setFilterMode(true);
          }
          success = true;
          break;
        case Button.LEFT:
          if (numberOfStarters > 0) {
            this.randomCursorObj.setVisible(false);
            this.cursorObj.setVisible(true);
            this.setCursor(onScreenFirstIndex + 8); // set last column
            success = true;
          }
          break;
        case Button.RIGHT:
          if (numberOfStarters > 0) {
            this.randomCursorObj.setVisible(false);
            this.cursorObj.setVisible(true);
            this.setCursor(onScreenFirstIndex); // set first column
            success = true;
          }
          break;
      }
    } else if (this.lastTeamCursorObj.visible) {
      // ER: "Use Last Team" action row (sits directly above "Random").
      switch (button) {
        case Button.ACTION:
          if (!this.restoreLastTeam()) {
            error = true;
          }
          break;
        case Button.UP:
          // Above this row is the filter bar.
          this.lastTeamCursorObj.setVisible(false);
          this.filterBarCursor = this.filterBar.numFilters - 1;
          this.setFilterMode(true);
          success = true;
          break;
        case Button.DOWN:
          // Below is the "Random" row.
          this.lastTeamCursorObj.setVisible(false);
          this.randomCursorObj.setVisible(true);
          success = true;
          break;
        case Button.LEFT:
          if (numberOfStarters > 0) {
            this.lastTeamCursorObj.setVisible(false);
            this.cursorObj.setVisible(true);
            this.setCursor(onScreenFirstIndex + 8); // last column
            success = true;
          }
          break;
        case Button.RIGHT:
          if (numberOfStarters > 0) {
            this.lastTeamCursorObj.setVisible(false);
            this.cursorObj.setVisible(true);
            this.setCursor(onScreenFirstIndex); // first column
            success = true;
          }
          break;
      }
    } else {
      // ER hardening: an empty filter result (e.g. a misspelled ability-text
      // search that matches NO mon) leaves nothing selected - setSpecies(null)
      // makes `lastSpecies` null and the grid empty. Every grid interaction below
      // dereferences `lastSpecies.speciesId` / `filteredStarterContainers[cursor]`,
      // which crashed the game to a black screen on the next keypress. With nothing
      // to act on, no-op safely instead.
      if (this.lastSpecies == null || this.filteredStarterContainers.length === 0) {
        return false;
      }
      let starterContainer: StarterContainer;
      // The temporary, duplicated starter data to show info
      const starterData = this.getSpeciesData(this.lastSpecies.speciesId).starterDataEntry;
      // The persistent starter data to apply e.g. candy upgrades
      const persistentStarterData = globalScene.gameData.getStarterDataEntry(this.lastSpecies.speciesId);
      // The sanitized starter preferences
      if (this.starterPreferences[this.lastSpecies.speciesId] === undefined) {
        this.starterPreferences[this.lastSpecies.speciesId] = {};
      }
      if (this.originalStarterPreferences[this.lastSpecies.speciesId] === undefined) {
        this.originalStarterPreferences[this.lastSpecies.speciesId] = {};
      }
      // Bangs are safe here due to the above check
      // ER hotfix (#438): these were non-null-asserted, but a species the
      // player never configured has NO preferences entry - the first quick
      // cycle press (shiny/form/gender/ability/nature) then wrote a property
      // on undefined and crashed to a black screen. Create the entries.
      const starterAttributes = (this.starterPreferences[this.lastSpecies.speciesId] ??= {});
      const originalStarterAttributes = (this.originalStarterPreferences[this.lastSpecies.speciesId] ??= {});

      // this gets the correct pokemon cursor depending on whether you're in the starter screen or the party icons
      if (this.starterIconsCursorObj.visible) {
        // if species is in filtered starters, get the starter container from the filtered starters, it can be undefined if the species is not in the filtered starters
        starterContainer =
          this.filteredStarterContainers[
            this.filteredStarterContainers.findIndex(container => container.species === this.lastSpecies)
          ];
      } else {
        starterContainer = this.filteredStarterContainers[this.cursor];
      }

      if (button === Button.ACTION) {
        if (this.rosterPickMode) {
          // Roster-pick: TOGGLE this species in/out of the allowed set. Bypasses the
          // whole party/cost/cap path (we never build a 6-slot team here).
          const root = this.lastSpecies.getRootSpeciesId();
          if (this.rosterSelected.has(root)) {
            this.rosterSelected.delete(root);
          } else {
            this.rosterSelected.add(root);
          }
          this.refreshRosterMarks();
          this.getUi().playSelect();
          return true;
        }
        if (!this.speciesStarterDexEntry?.caughtAttr) {
          error = true;
        } else if (this.starterSpecies.length <= 6) {
          // checks to see if the party has 6 or fewer pokemon
          const ui = this.getUi();
          let options: any[] = []; // TODO: add proper type

          const [isDupe, removeIndex]: [boolean, number] = this.isInParty(this.lastSpecies);

          const isPartyValid = this.isPartyValid();
          const isValidForChallenge = checkStarterValidForChallenge(
            this.lastSpecies,
            globalScene.gameData.getSpeciesDexAttrProps(
              this.lastSpecies,
              this.getCurrentDexProps(this.lastSpecies.speciesId),
            ),
            isPartyValid,
          );

          // Showdown: the per-mon set is shaped in the full-screen SET EDITOR now, not the legacy
          // form/item/move OPTION_SELECT. Grid-confirm opens it directly for a new eligible pick
          // (create) or a small Edit/Remove menu for an in-party line. This REPLACES the vanilla
          // options block below for showdown ONLY; every other mode falls through unchanged.
          if (globalScene.gameMode.isShowdown) {
            this.handleShowdownGridConfirm(isDupe, removeIndex, isValidForChallenge);
            return true;
          }

          const currentPartyValue = this.starterSpecies
            .map(s => s.generation)
            .reduce(
              (total: number, _gen: number, i: number) =>
                (total += globalScene.gameData.getSpeciesStarterValue(this.starterSpecies[i].speciesId)),
              0,
            );
          const newCost = globalScene.gameData.getSpeciesStarterValue(this.lastSpecies.speciesId);
          if (
            !isDupe
            && isValidForChallenge
            && currentPartyValue + newCost <= this.getValueLimit()
            && this.starterSpecies.length < this.getPartySizeLimit()
          ) {
            options = [
              {
                semanticId: "add-to-party",
                label: i18next.t("starterSelectUiHandler:addToParty"),
                handler: () => {
                  ui.setMode(UiMode.STARTER_SELECT);
                  const isOverValueLimit = this.tryUpdateValue(
                    globalScene.gameData.getSpeciesStarterValue(this.lastSpecies.speciesId),
                    true,
                  );
                  if (!isDupe && isValidForChallenge && isOverValueLimit) {
                    // addToParty may REJECT a showdown-illegal pick (Task B6): it returns false
                    // and (interactive path) already showed the message + error tone. Only apply
                    // the success side-effects — cursor highlight on the new slot + select tone —
                    // when the mon was actually added, so a rejection leaves no stray highlight
                    // and plays the error tone once (not a select-then-error double).
                    const added = this.addToParty(
                      this.lastSpecies,
                      this.dexAttrCursor,
                      this.abilityCursor,
                      this.natureCursor as unknown as Nature,
                      this.starterMoveset?.slice(0) as StarterMoveset,
                      this.teraCursor,
                    );
                    if (added) {
                      this.starterCursorObjs[this.starterSpecies.length - 1]
                        .setVisible(true)
                        .setPosition(this.cursorObj.x, this.cursorObj.y);
                      ui.playSelect();
                    }
                  } else {
                    ui.playError(); // this should be redundant as there is now a trigger for when a pokemon can't be added to party
                  }
                  return true;
                },
                overrideSound: true,
              },
            ];
          } else if (isDupe) {
            // if it already exists in your party, it will give you the option to remove from your party
            options = [
              {
                semanticId: "remove-from-party",
                label: i18next.t("starterSelectUiHandler:removeFromParty"),
                handler: () => {
                  this.popStarter(removeIndex);
                  ui.setMode(UiMode.STARTER_SELECT);
                  return true;
                },
              },
            ];
          }

          options.push(
            // this shows the IVs for the pokemon
            {
              label: i18next.t("starterSelectUiHandler:toggleIVs"),
              handler: () => {
                this.toggleStatsMode();
                ui.setMode(UiMode.STARTER_SELECT);
                return true;
              },
            },
          );
          if (globalScene.gameMode.isShowdown) {
            // Showdown: pick which evolution/mega stage of this line to field at lv100.
            options.push({
              label: "Field Stage",
              handler: () => {
                this.showShowdownStageOptions();
                return true;
              },
            });
            // Showdown: pick the held item (one per mon). A mega stage locks the slot to
            // its Mega Stone, so the row shows locked and the error sound rejects a change.
            const selection = this.showdownSelections.get(this.lastSpecies.speciesId);
            const megaLocked = selection?.item === MEGA_STONE_ITEM;
            let heldItemLabel: string;
            if (megaLocked) {
              heldItemLabel = "Held Item: Mega Stone (locked)";
            } else if (selection?.item) {
              heldItemLabel = `Held Item: ${getModifierType(modifierTypes[selection.item as ShowdownItemKey]).name}`;
            } else {
              // Unset: surface the effective default (SHOWDOWN_ITEM_POOL[0], applied at manifest time).
              const defaultName = getModifierType(modifierTypes[SHOWDOWN_ITEM_POOL[0]]).name;
              heldItemLabel = `Held Item: ${defaultName} (default)`;
            }
            options.push({
              label: heldItemLabel,
              handler: () => {
                if (megaLocked) {
                  ui.playError();
                  return false;
                }
                this.showShowdownItemOptions();
                return true;
              },
            });
          }
          // Showdown (B7 item 3): the move-swap picker offers the FIELDED stage's FULL legal
          // learnset (every level-up move at any level + TM/tutor moves + pre-evo inheritance)
          // plus the line's unlocked egg moves - the exact set `isMoveLegal` accepts, so a
          // picked move can never be rejected at start. Every other mode keeps the vanilla
          // early-level `speciesStarterMoves` pool byte-for-byte.
          const movePool: MoveId[] = globalScene.gameMode.isShowdown
            ? this.showdownLegalMovePool()
            : this.speciesStarterMoves;
          if (movePool.length > 1) {
            // this lets you change the pokemon moves
            const showSwapOptions = (moveset: StarterMoveset) => {
              this.blockInput = true;

              ui.setMode(UiMode.STARTER_SELECT).then(() => {
                ui.showText(i18next.t("starterSelectUiHandler:selectMoveSwapOut"), null, () => {
                  this.moveInfoOverlay.show(allMoves[moveset[0]]);

                  ui.setModeWithoutClear(UiMode.OPTION_SELECT, {
                    options: moveset
                      .map((m: MoveId, i: number) => {
                        const option: OptionSelectItem = {
                          label: allMoves[m].name,
                          handler: () => {
                            this.blockInput = true;
                            ui.setMode(UiMode.STARTER_SELECT).then(() => {
                              ui.showText(
                                `${i18next.t("starterSelectUiHandler:selectMoveSwapWith")} ${allMoves[m].name}.`,
                                null,
                                () => {
                                  const possibleMoves = movePool.filter((sm: MoveId) => sm !== m);
                                  this.moveInfoOverlay.show(allMoves[possibleMoves[0]]);

                                  ui.setModeWithoutClear(UiMode.OPTION_SELECT, {
                                    options: possibleMoves
                                      .map(sm => {
                                        // make an option for each available starter move
                                        const option = {
                                          label: allMoves[sm].name,
                                          handler: () => {
                                            this.switchMoveHandler(i, sm, m);
                                            showSwapOptions(this.starterMoveset!); // TODO: is this bang correct?
                                            return true;
                                          },
                                          onHover: () => {
                                            this.moveInfoOverlay.show(allMoves[sm]);
                                          },
                                        };
                                        return option;
                                      })
                                      .concat({
                                        label: i18next.t("menu:cancel"),
                                        handler: () => {
                                          showSwapOptions(this.starterMoveset!); // TODO: is this bang correct?
                                          return true;
                                        },
                                        onHover: () => {
                                          this.moveInfoOverlay.clear();
                                        },
                                      }),
                                    supportHover: true,
                                    maxOptions: 8,
                                    yOffset: 19,
                                  });
                                  this.blockInput = false;
                                },
                              );
                            });
                            return true;
                          },
                          onHover: () => {
                            this.moveInfoOverlay.show(allMoves[m]);
                          },
                        };
                        return option;
                      })
                      .concat({
                        label: i18next.t("menu:cancel"),
                        handler: () => {
                          this.moveInfoOverlay.clear();
                          this.clearText();
                          // Only saved if moves were actually swapped
                          if (this.hasSwappedMoves) {
                            globalScene.gameData.saveSystem().then(success => {
                              if (!success) {
                                return globalScene.reset(true);
                              }
                            });
                          }
                          ui.setMode(UiMode.STARTER_SELECT);
                          return true;
                        },
                        onHover: () => {
                          this.moveInfoOverlay.clear();
                        },
                      }),
                    supportHover: true,
                    maxOptions: 8,
                    yOffset: 19,
                  });
                  this.blockInput = false;
                });
              });
            };
            options.push({
              label: i18next.t("starterSelectUiHandler:manageMoves"),
              handler: () => {
                this.hasSwappedMoves = false;
                showSwapOptions(this.starterMoveset!); // TODO: is this bang correct?
                return true;
              },
            });
          }
          if (this.canCycleNature) {
            // if we could cycle natures, enable the improved nature menu
            const showNatureOptions = () => {
              this.blockInput = true;

              ui.setMode(UiMode.STARTER_SELECT).then(() => {
                ui.showText(i18next.t("starterSelectUiHandler:selectNature"), null, () => {
                  const natures = globalScene.gameData.getNaturesForAttr(this.speciesStarterDexEntry?.natureAttr);
                  ui.setModeWithoutClear(UiMode.OPTION_SELECT, {
                    options: natures
                      .map((n: Nature, _i: number) => {
                        const option: OptionSelectItem = {
                          label: getNatureName(n, true, true, true),
                          handler: () => {
                            starterAttributes.nature = n;
                            originalStarterAttributes.nature = starterAttributes.nature;
                            this.clearText();
                            ui.setMode(UiMode.STARTER_SELECT);
                            // set nature for starter
                            this.setSpeciesDetails(this.lastSpecies, {
                              natureIndex: n,
                            });
                            this.blockInput = false;
                            return true;
                          },
                        };
                        return option;
                      })
                      .concat({
                        label: i18next.t("menu:cancel"),
                        handler: () => {
                          this.clearText();
                          ui.setMode(UiMode.STARTER_SELECT);
                          this.blockInput = false;
                          return true;
                        },
                      }),
                    maxOptions: 8,
                    yOffset: 19,
                  });
                });
              });
            };
            options.push({
              label: i18next.t("starterSelectUiHandler:manageNature"),
              handler: () => {
                showNatureOptions();
                return true;
              },
            });
          }

          const passiveAttr = starterData.passiveAttr;
          const passiveCount = this.lastSpecies.getPassiveCount();
          const refreshCandyCount = () => {
            this.pokemonCandyCountText.setText(`×${starterData.candyCount}`);
            updateCandyCountTextStyle(this.pokemonCandyCountText, starterData.candyCount);
          };
          const refreshPassiveDisplay = () => {
            this.setSpeciesDetails(this.lastSpecies);
            if (starterContainer) {
              this.updateCandyUpgradeDisplay(starterContainer);
              starterContainer.starterPassiveBgs.setVisible(
                !!starterData.passiveAttr && !globalScene.gameMode.hasChallenge(Challenges.FRESH_START),
              );
            }
          };
          const showInnateOptions = () => {
            const innateOptions: any[] = [];
            const baseCost = getPassiveCandyCount(speciesStarterCosts[this.lastSpecies.speciesId]);
            const passiveAbilityIds = this.lastSpecies.getPassiveAbilities(
              starterAttributes.form ?? this.lastSpecies.formIndex,
            );
            const addUnlockOption = (slotIndex: PassiveSlot, labelPrefix: string, cost: number) => {
              innateOptions.push({
                label: `×${cost} ${labelPrefix}${i18next.t("starterSelectUiHandler:unlockPassive")}`,
                handler: () => {
                  if (!(Overrides.FREE_CANDY_UPGRADE_OVERRIDE || starterData.candyCount >= cost)) {
                    return false;
                  }
                  persistentStarterData.passiveAttr = unlockSlot(persistentStarterData.passiveAttr, slotIndex);
                  starterData.passiveAttr = persistentStarterData.passiveAttr;
                  if (!Overrides.FREE_CANDY_UPGRADE_OVERRIDE) {
                    persistentStarterData.candyCount -= cost;
                    starterData.candyCount = persistentStarterData.candyCount;
                  }
                  refreshCandyCount();
                  globalScene.gameData.saveSystem().then(success => {
                    if (!success) {
                      return globalScene.reset(true);
                    }
                  });
                  ui.setMode(UiMode.STARTER_SELECT);
                  refreshPassiveDisplay();
                  globalScene.playSound("se/buy");
                  return true;
                },
                item: "candy",
                itemArgs: starterColors[this.lastSpecies.speciesId],
              });
            };

            if (passiveCount > 1) {
              for (let slot = 0; slot < PASSIVE_SLOTS.length; slot++) {
                const slotIndex = slot as PassiveSlot;
                const abilityId = passiveAbilityIds[slot];
                if (abilityId === AbilityId.NONE) {
                  continue;
                }
                const abilityName = allAbilities[abilityId].name;
                if (isSlotUnlocked(starterData.passiveAttr, slotIndex)) {
                  innateOptions.push({
                    label: `${slot + 1}. ${abilityName}: ${i18next.t(
                      isSlotEnabled(starterData.passiveAttr, slotIndex)
                        ? "starterSelectUiHandler:disablePassive"
                        : "starterSelectUiHandler:enablePassive",
                    )}`,
                    handler: () => {
                      persistentStarterData.passiveAttr = toggleSlotEnabled(
                        persistentStarterData.passiveAttr,
                        slotIndex,
                      );
                      starterData.passiveAttr = persistentStarterData.passiveAttr;
                      ui.setMode(UiMode.STARTER_SELECT);
                      refreshPassiveDisplay();
                      return true;
                    },
                  });
                } else {
                  addUnlockOption(
                    slotIndex,
                    `${slot + 1}. ${abilityName}: `,
                    getErPassiveSlotCandyCost(baseCost, slot),
                  );
                }
              }
            } else if (starterData.passiveAttr & PassiveAttr.UNLOCKED) {
              innateOptions.push({
                label: i18next.t(
                  starterData.passiveAttr & PassiveAttr.ENABLED
                    ? "starterSelectUiHandler:disablePassive"
                    : "starterSelectUiHandler:enablePassive",
                ),
                handler: () => {
                  starterData.passiveAttr ^= PassiveAttr.ENABLED;
                  persistentStarterData.passiveAttr ^= PassiveAttr.ENABLED;
                  ui.setMode(UiMode.STARTER_SELECT);
                  refreshPassiveDisplay();
                  return true;
                },
              });
            } else {
              addUnlockOption(0, "", baseCost);
            }

            innateOptions.push({
              label: i18next.t("menu:cancel"),
              handler: () => {
                ui.setMode(UiMode.STARTER_SELECT);
                return true;
              },
            });
            // Return to STARTER_SELECT FIRST, then open the submenu - the same handoff
            // manageMoves/manageNature use. Opening a new OPTION_SELECT directly from
            // inside the action menu's own OPTION_SELECT (without clearing it) leaves the
            // submenu unable to take input -> softlock (the reported Innates-menu freeze).
            ui.setMode(UiMode.STARTER_SELECT).then(() =>
              ui.setModeWithoutClear(UiMode.OPTION_SELECT, {
                options: innateOptions,
                yOffset: 47,
              }),
            );
          };
          const hasInnateOptions =
            !globalScene.gameMode.hasChallenge(Challenges.FRESH_START)
            && (passiveCount <= 1
              || this.lastSpecies
                .getPassiveAbilities(starterAttributes.form ?? this.lastSpecies.formIndex)
                .some(abilityId => abilityId !== AbilityId.NONE));
          if (hasInnateOptions) {
            options.push({
              label: "Unlock Innates",
              handler: () => {
                showInnateOptions();
                return true;
              },
            });
          }
          const showInlinePassiveRows = false;
          if (showInlinePassiveRows && passiveCount > 1) {
            // ER 3-slot mode: render one enable/disable row per unlocked slot.
            // Unreachable in Phase A (no species has `setPassives()` called yet);
            // Phase B installs the per-species passives and this path lights up.
            const passiveAbilityIds = this.lastSpecies.getPassiveAbilities(
              starterAttributes.form ?? this.lastSpecies.formIndex,
            );
            for (let slot = 0; slot < PASSIVE_SLOTS.length; slot++) {
              const slotIndex = slot as PassiveSlot;
              if (passiveAbilityIds[slot] === AbilityId.NONE) {
                continue; // skip empty slots — species with fewer than 3 passives
              }
              if (!isSlotUnlocked(passiveAttr, slotIndex)) {
                continue; // locked slot — exposed via the candy submenu instead
              }
              const abilityName = allAbilities[passiveAbilityIds[slot]].name;
              const label = `${slot + 1}. ${abilityName}: ${i18next.t(
                isSlotEnabled(passiveAttr, slotIndex)
                  ? "starterSelectUiHandler:disablePassive"
                  : "starterSelectUiHandler:enablePassive",
              )}`;
              options.push({
                label,
                handler: () => {
                  starterData.passiveAttr = toggleSlotEnabled(starterData.passiveAttr, slotIndex);
                  persistentStarterData.passiveAttr = toggleSlotEnabled(persistentStarterData.passiveAttr, slotIndex);
                  ui.setMode(UiMode.STARTER_SELECT);
                  this.setSpeciesDetails(this.lastSpecies);
                  return true;
                },
              });
            }
          } else if (showInlinePassiveRows && passiveAttr & PassiveAttr.UNLOCKED) {
            // Legacy single-passive mode (vanilla pokerogue path — unchanged).
            // NOTE: Phase A — slot 1 only. Phase B widens to all 3 slots via the
            // multi-slot branch above.
            const label = i18next.t(
              passiveAttr & PassiveAttr.ENABLED
                ? "starterSelectUiHandler:disablePassive"
                : "starterSelectUiHandler:enablePassive",
            );
            options.push({
              label,
              handler: () => {
                starterData.passiveAttr ^= PassiveAttr.ENABLED;
                persistentStarterData.passiveAttr ^= PassiveAttr.ENABLED;
                ui.setMode(UiMode.STARTER_SELECT);
                this.setSpeciesDetails(this.lastSpecies);
                return true;
              },
            });
          }
          // if container.favorite is false, show the favorite option
          const isFavorite = starterAttributes?.favorite ?? false;
          if (isFavorite) {
            options.push({
              label: i18next.t("starterSelectUiHandler:removeFromFavorites"),
              handler: () => {
                starterAttributes.favorite = false;
                originalStarterAttributes.favorite = false;
                // if the starter container not exists, it means the species is not in the filtered starters
                if (starterContainer) {
                  starterContainer.favoriteIcon.setVisible(starterAttributes.favorite);
                }
                ui.setMode(UiMode.STARTER_SELECT);
                return true;
              },
            });
          } else {
            options.push({
              label: i18next.t("starterSelectUiHandler:addToFavorites"),
              handler: () => {
                starterAttributes.favorite = true;
                originalStarterAttributes.favorite = true;
                // if the starter container not exists, it means the species is not in the filtered starters
                if (starterContainer) {
                  starterContainer.favoriteIcon.setVisible(starterAttributes.favorite);
                }
                ui.setMode(UiMode.STARTER_SELECT);
                return true;
              },
            });
          }
          options.push({
            label: i18next.t("menu:rename"),
            handler: () => {
              ui.playSelect();
              let nickname = starterAttributes.nickname ? String(starterAttributes.nickname) : "";
              nickname = decodeURIComponent(escape(atob(nickname)));
              ui.setModeWithoutClear(
                UiMode.RENAME_POKEMON,
                {
                  buttonActions: [
                    (sanitizedName: string) => {
                      ui.playSelect();
                      starterAttributes.nickname = sanitizedName;
                      originalStarterAttributes.nickname = sanitizedName;
                      const name = decodeURIComponent(escape(atob(starterAttributes.nickname)));
                      if (name.length > 0) {
                        this.pokemonNameText.setText(name);
                      } else {
                        this.pokemonNameText.setText(this.lastSpecies.name);
                      }
                      this.truncateName();
                      // The name changed: rebuild the animated Name FX so the overlay isn't stale.
                      const renameDisplayShiny = globalScene.gameData.getSpeciesDexAttrProps(
                        this.lastSpecies,
                        this.getCurrentDexProps(this.lastSpecies.speciesId),
                      ).shiny;
                      this.getShinyLabNameFx().update(
                        this.pokemonNameText,
                        getErShinyLabSpriteFxLookForSpecies(this.lastSpecies.speciesId, renameDisplayShiny),
                      );
                      ui.setMode(UiMode.STARTER_SELECT);
                    },
                    () => {
                      ui.setMode(UiMode.STARTER_SELECT);
                    },
                  ],
                },
                nickname,
              );
              return true;
            },
          });

          // Purchases with Candy
          const candyCount = starterData.candyCount;
          const showUseCandies = () => {
            const options: any[] = []; // TODO: add proper type

            // Unlock passive option
            if (showInlinePassiveRows && !globalScene.gameMode.hasChallenge(Challenges.FRESH_START)) {
              const baseCost = getPassiveCandyCount(speciesStarterCosts[this.lastSpecies.speciesId]);
              if (passiveCount > 1) {
                // ER 3-slot mode: emit one unlock row per still-locked slot.
                // Unreachable in Phase A; Phase B installs `setPassives()` for
                // each species and lights this branch up.
                const passiveAbilityIds = this.lastSpecies.getPassiveAbilities(
                  starterAttributes.form ?? this.lastSpecies.formIndex,
                );
                for (let slot = 0; slot < PASSIVE_SLOTS.length; slot++) {
                  const slotIndex = slot as PassiveSlot;
                  if (passiveAbilityIds[slot] === AbilityId.NONE) {
                    continue;
                  }
                  if (isSlotUnlocked(passiveAttr, slotIndex)) {
                    continue;
                  }
                  // ER cost rework (#226): halved baseline + flat +10/slot. Shared
                  // with the pokédex via getErPassiveSlotCandyCost so the two
                  // screens never diverge (the pokédex previously kept the old
                  // `baseCost × [1,2,4]` scheme and showed stale, higher costs).
                  const slotCost = getErPassiveSlotCandyCost(baseCost, slot);
                  const abilityName = allAbilities[passiveAbilityIds[slot]].name;
                  options.push({
                    label: `×${slotCost} ${slot + 1}. ${abilityName}: ${i18next.t(
                      "starterSelectUiHandler:unlockPassive",
                    )}`,
                    handler: () => {
                      if (Overrides.FREE_CANDY_UPGRADE_OVERRIDE || candyCount >= slotCost) {
                        persistentStarterData.passiveAttr = unlockSlot(persistentStarterData.passiveAttr, slotIndex);
                        starterData.passiveAttr = persistentStarterData.passiveAttr;
                        if (!Overrides.FREE_CANDY_UPGRADE_OVERRIDE) {
                          persistentStarterData.candyCount -= slotCost;
                          starterData.candyCount = persistentStarterData.candyCount;
                        }
                        this.pokemonCandyCountText.setText(`×${starterData.candyCount}`);
                        updateCandyCountTextStyle(this.pokemonCandyCountText, starterData.candyCount);
                        globalScene.gameData.saveSystem().then(success => {
                          if (!success) {
                            return globalScene.reset(true);
                          }
                        });
                        ui.setMode(UiMode.STARTER_SELECT);
                        this.setSpeciesDetails(this.lastSpecies);
                        globalScene.playSound("se/buy");

                        if (starterContainer) {
                          this.updateCandyUpgradeDisplay(starterContainer);
                          starterContainer.starterPassiveBgs.setVisible(!!starterData.passiveAttr);
                        }
                        return true;
                      }
                      return false;
                    },
                    item: "candy",
                    itemArgs: starterColors[this.lastSpecies.speciesId],
                  });
                }
              } else if (!(passiveAttr & PassiveAttr.UNLOCKED)) {
                // Legacy single-passive unlock path (vanilla pokerogue — unchanged).
                // NOTE: Phase A — slot 1 only. Phase B widens to all 3 slots via
                // the multi-slot branch above.
                const passiveCost = baseCost;
                options.push({
                  label: `×${passiveCost} ${i18next.t("starterSelectUiHandler:unlockPassive")}`,
                  handler: () => {
                    if (Overrides.FREE_CANDY_UPGRADE_OVERRIDE || candyCount >= passiveCost) {
                      persistentStarterData.passiveAttr |= PassiveAttr.UNLOCKED | PassiveAttr.ENABLED;
                      starterData.passiveAttr = persistentStarterData.passiveAttr;
                      if (!Overrides.FREE_CANDY_UPGRADE_OVERRIDE) {
                        persistentStarterData.candyCount -= passiveCost;
                        starterData.candyCount = persistentStarterData.candyCount;
                      }
                      this.pokemonCandyCountText.setText(`×${starterData.candyCount}`);
                      updateCandyCountTextStyle(this.pokemonCandyCountText, starterData.candyCount);
                      globalScene.gameData.saveSystem().then(success => {
                        if (!success) {
                          return globalScene.reset(true);
                        }
                      });
                      ui.setMode(UiMode.STARTER_SELECT);
                      this.setSpeciesDetails(this.lastSpecies);
                      globalScene.playSound("se/buy");

                      // update the passive background and icon/animation for available upgrade
                      if (starterContainer) {
                        this.updateCandyUpgradeDisplay(starterContainer);
                        starterContainer.starterPassiveBgs.setVisible(!!starterData.passiveAttr);
                      }
                      return true;
                    }
                    return false;
                  },
                  item: "candy",
                  itemArgs: starterColors[this.lastSpecies.speciesId],
                });
              }
            }

            // Reduce cost option
            const valueReduction = starterData.valueReduction;
            if (valueReduction < valueReductionMax && !globalScene.gameMode.hasChallenge(Challenges.FRESH_START)) {
              const reductionCost = getValueReductionCandyCounts(speciesStarterCosts[this.lastSpecies.speciesId])[
                valueReduction
              ];
              options.push({
                label: `×${reductionCost} ${i18next.t("starterSelectUiHandler:reduceCost", { newCost: globalScene.gameData.getSpeciesStarterValue(this.lastSpecies.speciesId, starterData.valueReduction + 1) })}`,
                handler: () => {
                  if (Overrides.FREE_CANDY_UPGRADE_OVERRIDE || candyCount >= reductionCost) {
                    persistentStarterData.valueReduction++;
                    starterData.valueReduction = persistentStarterData.valueReduction;
                    if (!Overrides.FREE_CANDY_UPGRADE_OVERRIDE) {
                      persistentStarterData.candyCount -= reductionCost;
                      starterData.candyCount = persistentStarterData.candyCount;
                    }
                    this.pokemonCandyCountText.setText(`×${starterData.candyCount}`);
                    updateCandyCountTextStyle(this.pokemonCandyCountText, starterData.candyCount);
                    globalScene.gameData.saveSystem().then(success => {
                      if (!success) {
                        return globalScene.reset(true);
                      }
                    });
                    this.tryUpdateValue(0);
                    ui.setMode(UiMode.STARTER_SELECT);
                    globalScene.playSound("se/buy");

                    // update the value label and icon/animation for available upgrade
                    if (starterContainer) {
                      this.updateStarterValueLabel(starterContainer);
                      this.updateCandyUpgradeDisplay(starterContainer);
                    }
                    return true;
                  }
                  return false;
                },
                item: "candy",
                itemArgs: starterColors[this.lastSpecies.speciesId],
              });
            }

            // Same species egg menu option.
            const lastSpeciesId = this.lastSpecies.speciesId;
            const hatchedCount = globalScene.gameData.dexData[lastSpeciesId].hatchedCount;
            const sameSpeciesEggCost = getSameSpeciesEggCandyCounts(speciesStarterCosts[lastSpeciesId], hatchedCount);
            options.push({
              label: `×${sameSpeciesEggCost} ${i18next.t("starterSelectUiHandler:sameSpeciesEgg")}`,
              handler: () => {
                if (Overrides.FREE_CANDY_UPGRADE_OVERRIDE || candyCount >= sameSpeciesEggCost) {
                  if (globalScene.gameData.eggs.length >= MAX_EGG_COUNT && !Overrides.UNLIMITED_EGG_COUNT_OVERRIDE) {
                    // Egg list full, show error message at the top of the screen and abort
                    this.showText(
                      i18next.t("egg:tooManyEggs", { max: MAX_EGG_COUNT }),
                      undefined,
                      () => this.showText("", 0, () => (this.tutorialActive = false)),
                      2000,
                      false,
                      undefined,
                      true,
                    );
                    return false;
                  }
                  if (!Overrides.FREE_CANDY_UPGRADE_OVERRIDE) {
                    persistentStarterData.candyCount -= sameSpeciesEggCost;
                    starterData.candyCount = persistentStarterData.candyCount;
                  }
                  this.pokemonCandyCountText.setText(`×${starterData.candyCount}`);
                  updateCandyCountTextStyle(this.pokemonCandyCountText, starterData.candyCount);

                  const egg = new Egg({
                    species: this.lastSpecies.speciesId,
                    sourceType: EggSourceType.SAME_SPECIES_EGG,
                  });
                  egg.addEggToGameData();

                  globalScene.gameData.saveSystem().then(success => {
                    if (!success) {
                      return globalScene.reset(true);
                    }
                  });
                  ui.setMode(UiMode.STARTER_SELECT);
                  globalScene.playSound("se/buy");

                  // update the icon/animation for available upgrade
                  if (starterContainer) {
                    this.updateCandyUpgradeDisplay(starterContainer);
                  }

                  return true;
                }
                return false;
              },
              item: "candy",
              itemArgs: starterColors[this.lastSpecies.speciesId],
            });

            // Bulk "buy max eggs" — purchase as many same-species eggs as candies
            // (and egg-list space) allow in one action. Per-egg cost is constant
            // here (it scales with hatchCount, which buying doesn't change), so
            // total = count × sameSpeciesEggCost. The count is highlighted.
            const eggSpace = Overrides.UNLIMITED_EGG_COUNT_OVERRIDE
              ? Number.POSITIVE_INFINITY
              : Math.max(0, MAX_EGG_COUNT - globalScene.gameData.eggs.length);
            const maxAffordableEggs = Overrides.FREE_CANDY_UPGRADE_OVERRIDE
              ? eggSpace
              : Math.floor(candyCount / sameSpeciesEggCost);
            const maxEggs = Math.min(maxAffordableEggs, eggSpace);
            if (maxEggs >= 2) {
              const bulkCost = maxEggs * sameSpeciesEggCost;
              options.push({
                label: `×${bulkCost} ${i18next.t("starterSelectUiHandler:sameSpeciesEgg")} [color=#f8d030]×${maxEggs}[/color]`,
                handler: () => {
                  if (!(Overrides.FREE_CANDY_UPGRADE_OVERRIDE || candyCount >= bulkCost)) {
                    return false;
                  }
                  for (let i = 0; i < maxEggs; i++) {
                    new Egg({
                      species: this.lastSpecies.speciesId,
                      sourceType: EggSourceType.SAME_SPECIES_EGG,
                    }).addEggToGameData();
                  }
                  if (!Overrides.FREE_CANDY_UPGRADE_OVERRIDE) {
                    persistentStarterData.candyCount -= bulkCost;
                    starterData.candyCount = persistentStarterData.candyCount;
                  }
                  this.pokemonCandyCountText.setText(`×${starterData.candyCount}`);
                  updateCandyCountTextStyle(this.pokemonCandyCountText, starterData.candyCount);
                  globalScene.gameData.saveSystem().then(success => {
                    if (!success) {
                      return globalScene.reset(true);
                    }
                  });
                  ui.setMode(UiMode.STARTER_SELECT);
                  globalScene.playSound("se/buy");
                  if (starterContainer) {
                    this.updateCandyUpgradeDisplay(starterContainer);
                  }
                  return true;
                },
                item: "candy",
                itemArgs: starterColors[this.lastSpecies.speciesId],
              });
            }
            options.push({
              label: i18next.t("menu:cancel"),
              handler: () => {
                ui.setMode(UiMode.STARTER_SELECT);
                return true;
              },
            });
            ui.setModeWithoutClear(UiMode.OPTION_SELECT, {
              options,
              yOffset: 47,
              maxOptions: 8,
            });
          };
          options.push({
            label: i18next.t("menuUiHandler:pokedex"),
            handler: () => {
              ui.setMode(UiMode.STARTER_SELECT).then(() => {
                const attributes = {
                  shiny: starterAttributes.shiny,
                  variant: starterAttributes.variant,
                  form: starterAttributes.form,
                  female: starterAttributes.female,
                };
                ui.setOverlayMode(UiMode.POKEDEX_PAGE, this.lastSpecies, attributes, null, null, () => {
                  if (this.lastSpecies) {
                    starterContainer = this.filteredStarterContainers[this.cursor];
                    const persistentStarterData = globalScene.gameData.getStarterDataEntry(this.lastSpecies.speciesId);
                    this.updateCandyUpgradeDisplay(starterContainer);
                    this.updateStarterValueLabel(starterContainer);
                    starterContainer.starterPassiveBgs.setVisible(
                      !!persistentStarterData.passiveAttr && !globalScene.gameMode.hasChallenge(Challenges.FRESH_START),
                    );
                    this.setSpecies(this.lastSpecies);
                  }
                });
              });
              return true;
            },
          });
          if (!Object.hasOwn(pokemonPrevolutions, this.lastSpecies.speciesId)) {
            options.push({
              label: i18next.t("starterSelectUiHandler:useCandies"),
              handler: () => {
                ui.setMode(UiMode.STARTER_SELECT).then(() => showUseCandies());
                return true;
              },
            });
          }
          // ER Shiny Lab: open the in-game special-form shiny designer for this species.
          // Live in production now that the rendering phases are rolled out; mirrors the
          // pokedex option's open-then-return flow. (Co-op + Community Challenges stay
          // dev/staging-gated in title-phase; the Shiny Lab is a finished player feature.)
          options.push({
            label: "Shiny Lab",
            handler: () => {
              const speciesId = this.lastSpecies.speciesId;
              ui.setMode(UiMode.STARTER_SELECT).then(() => {
                const config = buildErShinyLabConfig(speciesId);
                config.onExit = () => {
                  ui.setMode(UiMode.STARTER_SELECT).then(() => {
                    if (this.lastSpecies?.speciesId === speciesId) {
                      this.setSpecies(this.lastSpecies);
                    }
                  });
                };
                ui.setModeWithoutClear(UiMode.ER_SHINY_LAB, config);
              });
              return true;
            },
          });
          options.push({
            label: i18next.t("menu:cancel"),
            handler: () => {
              ui.setMode(UiMode.STARTER_SELECT);
              return true;
            },
          });
          ui.setModeWithoutClear(UiMode.OPTION_SELECT, {
            options,
            yOffset: 47,
            maxOptions: 8,
          });
          success = true;
        }
      } else {
        const props = globalScene.gameData.getSpeciesDexAttrProps(
          this.lastSpecies,
          this.getCurrentDexProps(this.lastSpecies.speciesId),
        );
        switch (button) {
          case Button.CYCLE_SHINY:
            if (this.canCycleShiny) {
              if (starterAttributes.shiny === false) {
                // If not shiny, we change to shiny and get the proper default variant
                const newProps = globalScene.gameData.getSpeciesDexAttrProps(
                  this.lastSpecies,
                  this.getCurrentDexProps(this.lastSpecies.speciesId),
                );
                const newVariant = starterAttributes.variant
                  ? (starterAttributes.variant as Variant)
                  : newProps.variant;
                starterAttributes.shiny = true;
                originalStarterAttributes.shiny = true;
                starterAttributes.variant = newVariant;
                originalStarterAttributes.variant = newVariant;
                this.setSpeciesDetails(this.lastSpecies, {
                  shiny: true,
                  variant: newVariant,
                });

                globalScene.playSound("se/sparkle");
                // Cycle tint based on current sprite tint
                const tint = getVariantTint(newVariant);
                this.pokemonShinyIcon.setFrame(getVariantIcon(newVariant)).setTint(tint).setVisible(true);
              } else if (
                // ER Black Shinies (#349): after epic (variant 2), the cycle
                // reaches the BLACK tier when this line has it unlocked.
                props.variant === 2
                && !starterAttributes.erBlackShiny
                && this.getSpeciesData(this.lastSpecies.speciesId).starterDataEntry?.erBlackShiny
              ) {
                starterAttributes.erBlackShiny = true;
                originalStarterAttributes.erBlackShiny = true;
                globalScene.playSound("se/sparkle");
                this.pokemonShinyIcon.setFrame(getVariantIcon(2)).setTint(0x0a0a0a).setVisible(true);
                // ER (#349): preview the black look on the big sprite too.
                this.pokemonSprite.setTint(ER_BLACK_SHINY_TINT);
                success = true;
              } else {
                // If shiny, we update the variant
                // ER (#349): leaving the BLACK tier resumes the normal cycle.
                if (starterAttributes.erBlackShiny) {
                  starterAttributes.erBlackShiny = false;
                  originalStarterAttributes.erBlackShiny = false;
                  this.pokemonSprite.clearTint();
                }
                let newVariant = props.variant;
                do {
                  newVariant = (newVariant + 1) % 3;
                  if (newVariant === 0) {
                    if (this.speciesStarterDexEntry!.caughtAttr & DexAttr.DEFAULT_VARIANT) {
                      // TODO: is this bang correct?
                      break;
                    }
                  } else if (newVariant === 1) {
                    if (this.speciesStarterDexEntry!.caughtAttr & DexAttr.VARIANT_2) {
                      // TODO: is this bang correct?
                      break;
                    }
                  } else if (this.speciesStarterDexEntry!.caughtAttr & DexAttr.VARIANT_3) {
                    // TODO: is this bang correct?
                    break;
                  }
                } while (newVariant !== props.variant);
                starterAttributes.variant = newVariant; // store the selected variant
                originalStarterAttributes.variant = newVariant;
                if (this.speciesStarterDexEntry!.caughtAttr & DexAttr.NON_SHINY && newVariant <= props.variant) {
                  // If we have run out of variants, go back to non shiny
                  starterAttributes.shiny = false;
                  originalStarterAttributes.shiny = false;
                  this.setSpeciesDetails(this.lastSpecies, {
                    shiny: false,
                    variant: 0,
                  });
                  this.pokemonShinyIcon.setVisible(false);
                  success = true;
                } else {
                  // If going to a higher variant, or only shiny forms are caught, go to next variant
                  this.setSpeciesDetails(this.lastSpecies, {
                    variant: newVariant as Variant,
                  });
                  // Cycle tint based on current sprite tint
                  const tint = getVariantTint(newVariant as Variant);
                  this.pokemonShinyIcon.setFrame(getVariantIcon(newVariant as Variant)).setTint(tint);
                  success = true;
                }
              }
            }
            break;
          case Button.CYCLE_FORM:
            if (this.canCycleForm) {
              const formCount = this.lastSpecies.forms.length;
              let newFormIndex = props.formIndex;
              do {
                newFormIndex = (newFormIndex + 1) % formCount;
                if (
                  this.lastSpecies.forms[newFormIndex].isStarterSelectable
                  && this.speciesStarterDexEntry!.caughtAttr! & globalScene.gameData.getFormAttr(newFormIndex)
                ) {
                  // TODO: are those bangs correct?
                  break;
                }
              } while (newFormIndex !== props.formIndex);
              starterAttributes.form = newFormIndex; // store the selected form
              originalStarterAttributes.form = newFormIndex;
              starterAttributes.tera = this.lastSpecies.forms[newFormIndex].type1;
              originalStarterAttributes.tera = starterAttributes.tera;
              this.setSpeciesDetails(this.lastSpecies, {
                formIndex: newFormIndex,
                teraType: starterAttributes.tera,
              });
              success = true;
            }
            break;
          case Button.CYCLE_GENDER:
            if (this.canCycleGender) {
              starterAttributes.female = !props.female;
              originalStarterAttributes.female = starterAttributes.female;
              this.setSpeciesDetails(this.lastSpecies, {
                female: !props.female,
              });
              success = true;
            }
            break;
          case Button.CYCLE_ABILITY:
            if (this.canCycleAbility) {
              const abilityCount = this.lastSpecies.getAbilityCount();
              const abilityAttr = starterData.abilityAttr;
              const hasAbility1 = abilityAttr & AbilityAttr.ABILITY_1;
              let newAbilityIndex = this.abilityCursor;
              do {
                newAbilityIndex = (newAbilityIndex + 1) % abilityCount;
                if (newAbilityIndex === 0) {
                  if (hasAbility1) {
                    break;
                  }
                } else if (newAbilityIndex === 1) {
                  // If ability 1 and 2 are the same and ability 1 is unlocked, skip over ability 2
                  if (this.lastSpecies.ability1 === this.lastSpecies.ability2 && hasAbility1) {
                    newAbilityIndex = (newAbilityIndex + 1) % abilityCount;
                  }
                  break;
                } else if (abilityAttr & AbilityAttr.ABILITY_HIDDEN) {
                  break;
                }
              } while (newAbilityIndex !== this.abilityCursor);
              starterAttributes.ability = newAbilityIndex; // store the selected ability
              originalStarterAttributes.ability = newAbilityIndex;

              const { visible: tooltipVisible } = globalScene.ui.getTooltip();

              if (tooltipVisible && this.activeTooltip === "ABILITY") {
                const newAbility = allAbilities[this.lastSpecies.getAbility(newAbilityIndex)];
                globalScene.ui.editTooltip(`${newAbility.name}`, `${newAbility.description}`);
              }

              this.setSpeciesDetails(this.lastSpecies, {
                abilityIndex: newAbilityIndex,
              });
              success = true;
            }
            break;
          case Button.CYCLE_NATURE:
            if (this.canCycleNature) {
              const natures = globalScene.gameData.getNaturesForAttr(this.speciesStarterDexEntry?.natureAttr);
              const natureIndex = natures.indexOf(this.natureCursor);
              const newNature = natures[natureIndex < natures.length - 1 ? natureIndex + 1 : 0];
              // store cycled nature as default
              starterAttributes.nature = newNature as unknown as number;
              originalStarterAttributes.nature = starterAttributes.nature;
              this.setSpeciesDetails(this.lastSpecies, {
                natureIndex: newNature,
              });
              success = true;
            }
            break;
          case Button.CYCLE_TERA:
            if (this.canCycleTera) {
              const speciesForm = getPokemonSpeciesForm(this.lastSpecies.speciesId, starterAttributes.form ?? 0);
              if (speciesForm.type1 === this.teraCursor && speciesForm.type2 != null) {
                starterAttributes.tera = speciesForm.type2;
                originalStarterAttributes.tera = starterAttributes.tera;
                this.setSpeciesDetails(this.lastSpecies, {
                  teraType: speciesForm.type2,
                });
              } else {
                starterAttributes.tera = speciesForm.type1;
                originalStarterAttributes.tera = starterAttributes.tera;
                this.setSpeciesDetails(this.lastSpecies, {
                  teraType: speciesForm.type1,
                });
              }
              success = true;
            }
            break;
          case Button.UP:
            if (this.starterIconsCursorObj.visible) {
              if (this.starterIconsCursorIndex === 0) {
                // Up from first Pokemon in the team > go to Random selection
                this.starterIconsCursorObj.setVisible(false);
                this.setSpecies(null);
                this.randomCursorObj.setVisible(true);
              } else {
                this.starterIconsCursorIndex--;
                this.moveStarterIconsCursor(this.starterIconsCursorIndex);
              }
              success = true;
            } else if (currentRow > 0) {
              if (this.scrollCursor > 0 && currentRow - this.scrollCursor === 0) {
                this.scrollCursor--;
                this.updateScroll();
              }
              success = this.setCursor(this.cursor - 9);
            } else {
              this.filterBarCursor = this.filterBar.getNearestFilter(this.filteredStarterContainers[this.cursor]);
              this.setFilterMode(true);
              success = true;
            }
            break;
          case Button.DOWN:
            if (this.starterIconsCursorObj.visible) {
              if (this.starterIconsCursorIndex <= this.starterSpecies.length - 2) {
                this.starterIconsCursorIndex++;
                this.moveStarterIconsCursor(this.starterIconsCursorIndex);
              } else {
                this.starterIconsCursorObj.setVisible(false);
                this.setSpecies(null);
                this.startCursorObj.setVisible(true);
              }
              success = true;
            } else if (currentRow < numOfRows - 1) {
              // not last row
              if (currentRow - this.scrollCursor === 8) {
                // last row of visible starters
                this.scrollCursor++;
              }
              success = this.setCursor(this.cursor + 9);
              this.updateScroll();
            } else if (numOfRows > 1) {
              // DOWN from last row of Pokemon > Wrap around to first row
              this.scrollCursor = 0;
              this.updateScroll();
              success = this.setCursor(this.cursor % 9);
            } else {
              // DOWN from single row of Pokemon > Go to filters
              this.filterBarCursor = this.filterBar.getNearestFilter(this.filteredStarterContainers[this.cursor]);
              this.setFilterMode(true);
              success = true;
            }
            break;
          case Button.LEFT:
            if (!this.starterIconsCursorObj.visible) {
              if (this.cursor % 9 === 0) {
                // LEFT from filtered Pokemon, on the left edge
                if (onScreenCurrentRow === 0) {
                  // from the first row of starters we go to the random selection
                  this.cursorObj.setVisible(false);
                  this.randomCursorObj.setVisible(true);
                } else if (this.starterSpecies.length === 0) {
                  // no starter in team and not on first row > wrap around to the last column
                  success = this.setCursor(this.cursor + Math.min(8, numberOfStarters - this.cursor));
                } else if (onScreenCurrentRow < 7) {
                  // at least one pokemon in team > for the first 7 rows, go to closest starter
                  this.cursorObj.setVisible(false);
                  this.starterIconsCursorIndex = findClosestStarterIndex(
                    this.cursorObj.y - 1,
                    this.starterSpecies.length,
                  );
                  this.moveStarterIconsCursor(this.starterIconsCursorIndex);
                } else {
                  // at least one pokemon in team > from the bottom 2 rows, go to start run button
                  this.cursorObj.setVisible(false);
                  this.setSpecies(null);
                  this.startCursorObj.setVisible(true);
                }
                success = true;
              } else {
                success = this.setCursor(this.cursor - 1);
              }
            } else if (numberOfStarters > 0) {
              // LEFT from team > Go to closest filtered Pokemon
              const closestRowIndex = findClosestStarterRow(this.starterIconsCursorIndex, onScreenNumberOfRows);
              this.starterIconsCursorObj.setVisible(false);
              this.cursorObj.setVisible(true);
              this.setCursor(Math.min(onScreenFirstIndex + closestRowIndex * 9 + 8, onScreenLastIndex));
              success = true;
            } else {
              // LEFT from team and no Pokemon in filter > do nothing
              success = false;
            }
            break;
          case Button.RIGHT:
            if (!this.starterIconsCursorObj.visible) {
              // is not right edge
              if (this.cursor % 9 < (currentRow < numOfRows - 1 ? 8 : (numberOfStarters - 1) % 9)) {
                success = this.setCursor(this.cursor + 1);
              } else {
                // RIGHT from filtered Pokemon, on the right edge
                if (onScreenCurrentRow === 0) {
                  // from the first row of starters we go to the random selection
                  this.cursorObj.setVisible(false);
                  this.randomCursorObj.setVisible(true);
                } else if (this.starterSpecies.length === 0) {
                  // no selected starter in team > wrap around to the first column
                  success = this.setCursor(this.cursor - Math.min(8, this.cursor % 9));
                } else if (onScreenCurrentRow < 7) {
                  // at least one pokemon in team > for the first 7 rows, go to closest starter
                  this.cursorObj.setVisible(false);
                  this.starterIconsCursorIndex = findClosestStarterIndex(
                    this.cursorObj.y - 1,
                    this.starterSpecies.length,
                  );
                  this.moveStarterIconsCursor(this.starterIconsCursorIndex);
                } else {
                  // at least one pokemon in team > from the bottom 2 rows, go to start run button
                  this.cursorObj.setVisible(false);
                  this.setSpecies(null);
                  this.startCursorObj.setVisible(true);
                }
                success = true;
              }
            } else if (numberOfStarters > 0) {
              // RIGHT from team > Go to closest filtered Pokemon
              const closestRowIndex = findClosestStarterRow(this.starterIconsCursorIndex, onScreenNumberOfRows);
              this.starterIconsCursorObj.setVisible(false);
              this.cursorObj.setVisible(true);
              this.setCursor(
                Math.min(onScreenFirstIndex + closestRowIndex * 9, onScreenLastIndex - (onScreenLastIndex % 9)),
              );
              success = true;
            } else {
              // RIGHT from team and no Pokemon in filter > do nothing
              success = false;
            }
            break;
        }
      }
    }

    if (success) {
      ui.playSelect();
    } else if (error) {
      ui.playError();
    }

    return success || error;
  }

  isInParty(species: PokemonSpecies): [boolean, number] {
    let removeIndex = 0;
    let isDupe = false;
    for (let s = 0; s < this.starterSpecies.length; s++) {
      if (this.starterSpecies[s] === species) {
        isDupe = true;
        removeIndex = s;
        break;
      }
    }
    return [isDupe, removeIndex];
  }

  addToParty(
    species: PokemonSpecies,
    dexAttr: bigint,
    abilityIndex: number,
    nature: Nature,
    moveset: StarterMoveset,
    teraType: PokemonType,
    randomSelection = false,
  ): boolean {
    // Showdown pick-time UX (Task B6): refuse a field-illegal pick BEFORE it is committed
    // to the party. The authoritative gate is the validator run at tryStart / over the wire;
    // this is the friendly early rejection so the player never assembles a team the start
    // would silently bounce. Returns false (not added) so the interactive caller skips its
    // success side-effects (cursor highlight / select tone). `randomSelection` marks a
    // batch/programmatic add (random-fill, restore-last-team): a rejected pick is skipped
    // SILENTLY (no per-iteration toast/tone) since the validator surfaces any issue at start.
    const showdownRejection = this.showdownAddRejection(species, dexAttr);
    if (showdownRejection !== null) {
      if (!randomSelection) {
        this.rejectShowdownPick(showdownRejection);
      }
      return false;
    }
    const props = globalScene.gameData.getSpeciesDexAttrProps(species, dexAttr);
    // Showdown (B7 item 15): the party mini-icon follows the picked Field Stage. The stage is read
    // from `showdownSelections` (keyed by root), which restore-last-team seeds before this add and
    // the interactive stage pick sets, so the icon shows the fielded form the moment it is chosen.
    this.renderShowdownAwarePartyIcon(this.starterIcons[this.starterSpecies.length], species, props);
    this.refreshShinyLabIconFx(
      this.starterIcons[this.starterSpecies.length],
      species,
      props.female,
      props.formIndex,
      props.shiny,
      props.variant,
      `starter-party-shiny-lab-icon-${this.starterSpecies.length}-${species.speciesId}`,
      false,
    );

    const { dexEntry, starterDataEntry } = this.getSpeciesData(species.speciesId);

    // TODO(er-phase-b): `passive: boolean` on the run-start `Starter` is slot-1 only.
    // Phase B will widen `Starter` to carry per-slot enabled state across all 3 slots.
    const starter = {
      speciesId: species.speciesId,
      shiny: props.shiny,
      variant: props.variant,
      formIndex: props.formIndex,
      female: props.female,
      abilityIndex,
      passive: !(starterDataEntry.passiveAttr ^ (PassiveAttr.ENABLED | PassiveAttr.UNLOCKED)),
      nature,
      moveset,
      pokerus: this.pokerusSpecies.includes(species),
      nickname: this.starterPreferences[species.speciesId]?.nickname,
      teraType,
      ivs: dexEntry.ivs,
      // ER Black Shinies (#349): t4 selected in the shiny cycle (requires the
      // line's black unlock).
      erBlackShiny: this.isBlackShinyPick(species.speciesId, starterDataEntry, props.shiny),
    };

    // Showdown: stamp the chosen evolution/mega STAGE + held ITEM onto the starter (the
    // grid pick is the root; the fielded mon is the chosen stage). Left undefined when the
    // player never opened the picker, in which case the base form is fielded.
    if (globalScene.gameMode.isShowdown) {
      this.applyShowdownSelection(starter, species.speciesId);
      // Task C7: carry the OWNER's equipped Shiny Lab look so the opponent's client renders this
      // mon's custom shiny effects (mirrors the co-op #785 carry + the ghost capture). Shiny-gated
      // by the helper (returns undefined for a non-shiny / lookless pick), so a plain shiny is unaffected.
      (starter as Starter).erShinyLab = getErShinyLabSavedLookForSpecies(species.speciesId, props.shiny);
    }

    this.starters.push(starter);
    this.starterSpecies.push(species);
    if (this.speciesLoaded.get(species.speciesId) || randomSelection) {
      getPokemonSpeciesForm(species.speciesId, props.formIndex).cry();
    }
    this.updateInstructions();
    return true;
  }

  /**
   * True iff this pick is a Black Shiny (ER #349): the line's black tier must be unlocked
   * (`starterDataEntry.erBlackShiny`), the player must have selected it for this species
   * (`starterPreferences[...].erBlackShiny`), and the current pick must be shiny. A normal/shiny
   * pick of the same species is NOT a black shiny. Single source for the derivation `addToParty`
   * and the showdown field-legality gate both need.
   */
  private isBlackShinyPick(speciesId: number, starterDataEntry: StarterDataEntry, shiny: boolean): boolean {
    return !!this.starterPreferences[speciesId]?.erBlackShiny && !!starterDataEntry?.erBlackShiny && shiny;
  }

  /**
   * Showdown field-legality gate for a PICK (Task B6). Returns the rejection message when the
   * mon may not be fielded, else null. Delegates the thresholds + strings to the shared
   * `showdownFieldLegalityReason` (the SAME verdict the validator enforces) so the UI and the
   * validator can never drift. This method only DERIVES the candidate's inputs:
   *  - `erBlackShiny`: the picked-black-shiny flag (stakes unaffected — it stays stakeable),
   *  - `baseCost`: the RAW `speciesStarterCosts` of the LINE ROOT (the grid pick IS the root),
   *    NOT `getSpeciesStarterValue` — candy reductions must not dodge the bracket,
   *  - whether the rest of the party already fields a cost-8/9 mon.
   * Non-showdown modes always return null.
   */
  private showdownAddRejection(species: PokemonSpecies, dexAttr: bigint): string | null {
    if (!globalScene.gameMode.isShowdown) {
      return null;
    }
    const props = globalScene.gameData.getSpeciesDexAttrProps(species, dexAttr);
    const { starterDataEntry } = this.getSpeciesData(species.speciesId);
    const erBlackShiny = this.isBlackShinyPick(species.speciesId, starterDataEntry, props.shiny);
    const baseCost = speciesStarterCosts[species.speciesId] ?? 4;
    const partyAlreadyHasHighCost = this.starters.some(s => {
      const c = speciesStarterCosts[s.speciesId] ?? 4;
      return c >= HIGH_COST_MIN && c < COST_CAP;
    });
    return showdownFieldLegalityReason(baseCost, erBlackShiny, partyAlreadyHasHighCost);
  }

  /**
   * Surface a showdown pick rejection (Task B6) with the same tutorial-text pattern `tryStart`
   * uses for a rejected start, then resync the point-value label (a caller may have optimistically
   * bumped it via `tryUpdateValue` before `addToParty`) and play the error tone.
   */
  private rejectShowdownPick(message: string): void {
    this.getUi().playError();
    this.tryUpdateValue();
    this.tutorialActive = true;
    this.showText(message, undefined, () => this.showText("", 0, () => (this.tutorialActive = false)), undefined, true);
  }

  /**
   * Showdown grid-confirm dispatch (flow wiring). A NEW eligible pick opens the full-screen SET EDITOR
   * to CREATE the slot; an already-in-party line opens a small Edit/Remove party menu (editing re-opens
   * the editor, remove pops the slot). The pick-time field-legality REJECTIONS (black shiny / cost cap /
   * second cost-8+) fire HERE, before the editor opens, with the SAME messages the validator uses - so a
   * field-illegal mon never reaches the editor. Non-showdown modes never reach this method.
   */
  private handleShowdownGridConfirm(isDupe: boolean, removeIndex: number, isValidForChallenge: boolean): void {
    const ui = this.getUi();
    if (isDupe) {
      // In-party line: a 2-item party menu (edit the set, or remove the slot). NOT the legacy
      // form/item/move menu - the set is shaped only in the editor now.
      const options: OptionSelectItem[] = [
        {
          label: "Edit Set",
          handler: () => {
            this.openShowdownEditor(removeIndex);
            return true;
          },
        },
        {
          label: i18next.t("starterSelectUiHandler:removeFromParty"),
          handler: () => {
            this.popStarter(removeIndex);
            ui.setMode(UiMode.STARTER_SELECT);
            return true;
          },
        },
      ];
      ui.setMode(UiMode.STARTER_SELECT).then(() =>
        ui.setModeWithoutClear(UiMode.OPTION_SELECT, { options, maxOptions: 8, yOffset: 47 }),
      );
      return;
    }
    // New pick: the field-legality gate fires BEFORE the editor opens (same messages as the validator).
    const rejection = this.showdownAddRejection(this.lastSpecies, this.getCurrentDexProps(this.lastSpecies.speciesId));
    if (rejection !== null) {
      this.rejectShowdownPick(rejection);
      return;
    }
    if (!isValidForChallenge || this.starterSpecies.length >= this.getPartySizeLimit()) {
      ui.playError();
      return;
    }
    this.openShowdownEditor(-1);
  }

  /**
   * Showdown (flow wiring): open the SET EDITOR for one team slot. `editIndex >= 0` EDITS an in-party
   * mon (Done updates it in place); `editIndex < 0` CREATES a slot for the highlighted grid line (Done
   * adds it). The config is a pure snapshot of the line's collection state; the Done/Cancel/team-cycle
   * callbacks write back into the grid here.
   */
  private openShowdownEditor(editIndex: number): void {
    const ui = this.getUi();
    const species = editIndex >= 0 ? this.starterSpecies[editIndex] : this.lastSpecies;
    const config = this.buildShowdownEditorConfig(species, species.speciesId, editIndex);
    // Mobile/desktop native-keyboard bridge for the typeahead panes (the login/nickname DOM-input infra).
    // The registered handler instance is reused across opens, so re-injecting each open is harmless.
    const editor = ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler | undefined;
    editor?.setTextInput(new DomShowdownEditorTextInput());
    editor?.setPasteInput(new DomShowdownPasteInput()); // multiline capture for the Set Menu's Import
    // TEAM CYCLE (G / V / shoulder): when the editor is ALREADY the active mode, this is a slot switch,
    // not a fresh open. `setOverlayMode(SHOWDOWN_SET_EDITOR)` would then be a NO-OP - `setModeInternal`
    // early-returns on `this.mode === mode`, so the editor would keep rendering the OLD slot and G/V/
    // shoulder would look dead ("the button to change the mon doesnt work"). Re-render the live editor
    // handler in place with the new slot's config instead: mode is already correct, render() clears its
    // dynamic children first (no leak), and there is no mode-chain churn or fade. This is the ONLY
    // same-mode reopen path; the first open (from the grid) still chains as an overlay below.
    if (ui.getMode() === UiMode.SHOWDOWN_SET_EDITOR) {
      editor?.show([config]);
      return;
    }
    // First open: as an OVERLAY (chains onto the mode stack) rather than setMode: setMode would CLEAR
    // this StarterSelect (hide its grid, reset its cursor), and returning via setMode(STARTER_SELECT)
    // with no callback arg re-runs show() into an EMPTY screen (its init is gated on `args[0] instanceof
    // Function`). As an overlay the grid stays alive underneath the editor's opaque backdrop, and the
    // editor's Done/Cancel revertMode() back to it intact - no empty-screen softlock.
    ui.setOverlayMode(UiMode.SHOWDOWN_SET_EDITOR, config);
  }

  /** Showdown (flow wiring): assemble the {@linkcode ShowdownSetEditorConfig} snapshot for one slot. */
  private buildShowdownEditorConfig(species: PokemonSpecies, root: number, editIndex: number): ShowdownSetEditorConfig {
    const { gameData } = globalScene;
    const isEdit = editIndex >= 0;
    const props = gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(root));
    const existing = isEdit ? this.starters[editIndex] : null;
    const selection = this.showdownSelections.get(root);

    // AUTO-REMEMBER prefill (P2): on a FRESH create (no existing slot, no in-session selection yet), seed
    // from this species' last-used set (stored as codec text in localStorage on the previous confirm). The
    // stage / ability / item / moves / nature are pre-filled; shiny stays a per-mon identity pick (the grid
    // props + the editor's highest-owned default). Only a clean parse for THIS root is used; the editor's
    // Done still re-validates, so a since-changed unlock can never let a stale prefill through.
    const prefill = !isEdit && selection == null ? this.loadShowdownPrefill(root) : null;
    const prefillMoves = prefill?.moveset ?? [];

    // Fielded STAGE: edit -> the stored starter's stage; create -> a stored selection, then the remembered
    // last-used set, then the base grid form.
    const stage: ShowdownEditorStage = {
      speciesId: existing?.showdownSpeciesId ?? selection?.speciesId ?? prefill?.speciesId ?? root,
      formIndex: existing?.showdownFormIndex ?? selection?.formIndex ?? prefill?.formIndex ?? props.formIndex,
    };

    // The editable SET - a FRESH copy (the editor mutates it in place, so edits only land on Done/commit).
    const moves = (existing?.moveset ?? (prefillMoves.length > 0 ? prefillMoves : this.starterMoveset) ?? []).slice(
      0,
      4,
    );
    const set: ShowdownEditorSet = {
      abilityIndex: existing?.abilityIndex ?? prefill?.abilityIndex ?? this.abilityCursor,
      item: existing?.showdownItem ?? selection?.item ?? prefill?.item ?? SHOWDOWN_ITEM_POOL[0],
      moves: [0, 1, 2, 3].map(i => (moves[i] ?? null) as MoveId | null),
      nature: existing?.nature ?? (prefill?.nature as Nature | undefined) ?? (this.natureCursor as unknown as Nature),
      shiny: existing?.shiny ?? props.shiny,
      variant: existing?.variant ?? props.variant,
    };

    // Collection/unlock snapshot for the shiny/ability chips + the egg-move gating in the move pane.
    const snapshot = buildUnlockSnapshot(gameData);
    const megaBudgetSpentBy = this.showdownMegaBudgetSpentByName(root);
    // Innate (passive) candy-unlock state for the ABILITIES panel (B7 round-4 item 6): each of the 3
    // innate slots is candy-gated on the PLAYER's own party (`hasPassive` player branch), so a locked
    // slot shows its unlock cost. `getStarterDataEntry` pools `passiveAttr`/`candyCount` under the same
    // line root the candy menu uses; the per-slot cost mirrors `isPassiveAvailable` exactly.
    const passiveEntry = gameData.getStarterDataEntry(root);
    const passiveBaseCost = getPassiveCandyCount(speciesStarterCosts[root] ?? 0);
    const unlocks = {
      ownedVariants: [0, 1, 2].filter(v => snapshot.isShinyUnlocked(root, v)),
      blackShinyOwned: gameData.starterData[root]?.erBlackShiny ?? false,
      unlockedAbilityIndices: [0, 1, 2].filter(i => snapshot.isAbilityUnlocked(root, i)),
      unlockedEggMoveBits: gameData.starterData[root]?.eggMoves ?? 0,
      megaBudgetSpent: this.showdownTeamHasOtherMega(root),
      innateUnlockedSlots: [0, 1, 2].filter(s => isSlotUnlocked(passiveEntry?.passiveAttr ?? 0, s as PassiveSlot)),
      innateSlotCandyCosts: [0, 1, 2].map(s => getErPassiveSlotCandyCost(passiveBaseCost, s)),
      candyCount: passiveEntry?.candyCount ?? 0,
      // Omit-when-absent (exactOptionalPropertyTypes): only carry the name when a mega is actually spent.
      ...(megaBudgetSpentBy === undefined ? {} : { megaBudgetSpentBy }),
    };

    // LIVE 6-slot team strip: current picks as manifests + (create) a provisional slot for the mon being
    // built, so the strip icons / validity chips / cost reflect the whole team including this edit.
    const team: (ShowdownMonManifest | null)[] = [null, null, null, null, null, null];
    this.starters.forEach((s, i) => {
      if (i < 6) {
        team[i] = starterToManifest(s, gameData);
      }
    });
    const activeSlot = isEdit ? editIndex : this.starterSpecies.length;
    if (!isEdit && activeSlot < 6) {
      team[activeSlot] = this.buildProvisionalShowdownManifest(root, stage, set, props, gameData);
    }

    this.showdownPickDeadline ??= Date.now() + getShowdownPickWaitMs();
    const pickSecondsLeft = Math.max(0, Math.ceil((this.showdownPickDeadline - Date.now()) / 1000));

    return {
      rootSpeciesId: root,
      stage,
      set,
      female: props.female,
      unlocks,
      team,
      activeSlot,
      pickSecondsLeft,
      // Versus "partner" = the opponent; the coop controller's readied flag is the best pre-Ready signal.
      partnerReady: getCoopController()?.partnerReady ?? null,
      onDone: result => this.commitShowdownEditor(species, root, editIndex, result),
      // Done-time re-validation: build the PROVISIONAL team with this slot's edit applied and run the
      // shared rule engine, returning the first violation (mega budget, cost caps, black-shiny, item
      // legality, ...) so the editor refuses to commit an invalid set instead of silently building one.
      validate: result => this.validateShowdownEditorSet(root, editIndex, props, result),
      // Revert the overlay back to the (still-alive) grid - never setMode(STARTER_SELECT), which re-shows
      // it empty (init gated on the callback arg).
      onCancel: () => void this.getUi().revertMode(),
      onCycleTeam: dir => this.cycleShowdownEditorTeam(editIndex, dir),
      // Set Menu Export: copy the PS-format set text to the clipboard (guarded util; headless = no-op).
      copyToClipboard: text => copyTextToClipboard(text),
    };
  }

  /**
   * Showdown editor Done-time re-validation. Rebuilds the whole team as manifests with THIS slot's edited
   * stage + set applied (create => appended, edit => replaced in place) and runs the shared
   * {@linkcode validateShowdownTeam} rule engine. Returns the FIRST violation's message (the same wording
   * the ready-time net uses) or null when the set is fully legal - so the editor refuses to commit an
   * invalid team rather than letting the player build one silently.
   */
  private validateShowdownEditorSet(
    root: number,
    editIndex: number,
    props: { female: boolean; formIndex: number; shiny: boolean; variant: number },
    result: { stage: ShowdownEditorStage; set: ShowdownEditorSet },
  ): string | null {
    const { gameData } = globalScene;
    const edited = this.buildProvisionalShowdownManifest(root, result.stage, result.set, props, gameData);
    const manifests = this.starters.map((s, i) => (i === editIndex ? edited : starterToManifest(s, gameData)));
    if (editIndex < 0) {
      manifests.push(edited);
    }
    const violations = validateShowdownTeam(manifests, buildUnlockSnapshot(gameData), isMegaStage);
    return violations.length > 0 ? violations[0].message : null;
  }

  /** Showdown: a provisional manifest for the not-yet-added mon (drives the strip's live slot). */
  private buildProvisionalShowdownManifest(
    root: number,
    stage: ShowdownEditorStage,
    set: ShowdownEditorSet,
    props: { female: boolean; formIndex: number; shiny: boolean; variant: number },
    gameData: typeof globalScene.gameData,
  ): ShowdownMonManifest {
    const temp: Starter = {
      speciesId: root,
      shiny: set.shiny,
      variant: set.variant as Starter["variant"],
      formIndex: props.formIndex,
      female: props.female,
      abilityIndex: set.abilityIndex,
      passive: false,
      nature: set.nature as Nature,
      moveset: set.moves.filter((m): m is MoveId => m != null) as StarterMoveset,
      pokerus: false,
      ivs: [31, 31, 31, 31, 31, 31],
      showdownSpeciesId: stage.speciesId,
      showdownFormIndex: stage.formIndex,
      showdownItem: set.item,
    };
    return starterToManifest(temp, gameData);
  }

  /**
   * Showdown auto-remember (P2): load this species' last-used set (codec text in localStorage) and parse it
   * back to a manifest for pre-filling a fresh CREATE. Returns null when there is no remembered set, the
   * text no longer parses, or it is for a DIFFERENT root (a stale key) - the caller then falls back to the
   * grid defaults. The editor's Done-time re-validation is the final gate, so a stale prefill is harmless.
   */
  private loadShowdownPrefill(root: number): ShowdownMonManifest | null {
    const text = getLastUsedSet(root);
    if (text == null) {
      return null;
    }
    const parsed = importShowdownSet(text);
    return parsed.manifest != null && parsed.manifest.rootSpeciesId === root ? parsed.manifest : null;
  }

  /**
   * Showdown auto-remember (P2): export the just-confirmed set to codec text and store it as this species'
   * last-used. Reuses {@linkcode buildProvisionalShowdownManifest} so the remembered text is byte-identical
   * to what Export would produce for the same set.
   */
  private rememberShowdownSet(
    species: PokemonSpecies,
    root: number,
    result: { stage: ShowdownEditorStage; set: ShowdownEditorSet },
  ): void {
    const { gameData } = globalScene;
    const props = gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(root));
    const manifest = this.buildProvisionalShowdownManifest(root, result.stage, result.set, props, gameData);
    rememberLastUsedSet(root, exportShowdownSet(manifest));
  }

  /** Showdown: the OTHER line's mega species name (for the editor's greyed "mega used" reason line). */
  private showdownMegaBudgetSpentByName(rootSpeciesId: number): string | undefined {
    const other = this.starters.find(
      s => s.speciesId !== rootSpeciesId && isMegaStage(s.showdownSpeciesId ?? s.speciesId, s.showdownFormIndex ?? 0),
    );
    return other ? getPokemonSpecies(other.speciesId).name : undefined;
  }

  /**
   * Showdown editor "Done": write the edited stage + set back into the team. EDIT stamps the existing
   * starter in place (Cancel would have discarded); CREATE reuses {@linkcode addToParty} (icon/asset/
   * starter-build) with the editor's ability/nature/moveset, the stage+item coming from the recorded
   * selection. The nature lands on the starter, so {@linkcode starterToManifest} carries it into the
   * wire manifest + team hash. Always returns to the grid.
   */
  private commitShowdownEditor(
    species: PokemonSpecies,
    root: number,
    editIndex: number,
    result: { stage: ShowdownEditorStage; set: ShowdownEditorSet },
  ): void {
    const ui = this.getUi();
    const { stage, set } = result;
    const moveset = set.moves.filter((m): m is MoveId => m != null) as StarterMoveset;
    // Record the fielded stage + item so applyShowdownSelection / the party icon field the chosen stage.
    this.showdownSelections.set(root, { speciesId: stage.speciesId, formIndex: stage.formIndex, item: set.item });
    // AUTO-REMEMBER (P2): stamp the just-confirmed set as this species' last-used, so the NEXT time the
    // player picks this line the editor pre-fills it. Stored as codec text (the storage format) in
    // localStorage; a headless / storage-full write is a safe no-op inside `rememberLastUsedSet`.
    this.rememberShowdownSet(species, root, result);

    if (editIndex >= 0) {
      // EDIT in place (shiny/variant stay grid-chosen; the editor does not change them in P1).
      const starter = this.starters[editIndex];
      starter.showdownSpeciesId = stage.speciesId;
      starter.showdownFormIndex = stage.formIndex;
      starter.showdownItem = set.item;
      starter.abilityIndex = set.abilityIndex;
      starter.nature = set.nature as Nature;
      starter.moveset = moveset;
      this.updatePartyIcon(this.starterSpecies[editIndex], editIndex);
      if (this.lastSpecies?.speciesId === root) {
        this.setSpeciesDetails(this.lastSpecies);
      }
      // Revert the overlay to the (still-alive) grid; setMode would re-show it empty (see openShowdownEditor).
      void ui.revertMode();
      return;
    }
    // CREATE: addToParty stamps the stage+item from showdownSelections (set above) and builds the icon.
    // Revert the overlay back to the live grid first, then add to the party against its restored state.
    void ui.revertMode();
    const added = this.addToParty(
      species,
      this.getCurrentDexProps(root),
      set.abilityIndex,
      set.nature as Nature,
      moveset,
      this.teraCursor,
    );
    if (added) {
      this.starterCursorObjs[this.starterSpecies.length - 1]
        .setVisible(true)
        .setPosition(this.cursorObj.x, this.cursorObj.y);
      ui.playSelect();
    } else {
      ui.playError();
    }
  }

  /**
   * Showdown editor L/R team cycling: reopen the editor on the previous/next already-picked team mon.
   * From a CREATE slot it enters the picked list at either end. Uncommitted create edits are discarded
   * (cycling is navigation between committed slots).
   */
  private cycleShowdownEditorTeam(currentEditIndex: number, dir: number): void {
    const count = this.starterSpecies.length;
    if (count === 0) {
      return;
    }
    const base = currentEditIndex >= 0 ? currentEditIndex : dir > 0 ? -1 : count;
    const next = (((base + dir) % count) + count) % count;
    this.openShowdownEditor(next);
  }

  /**
   * Showdown: stamp the recorded stage choice from {@linkcode showdownSelections} onto a
   * starter. No-op when the player never opened the picker (base form is fielded then).
   */
  private applyShowdownSelection(starter: Starter, rootSpeciesId: number): void {
    const selection = this.showdownSelections.get(rootSpeciesId);
    if (!selection) {
      return;
    }
    starter.showdownSpeciesId = selection.speciesId;
    starter.showdownFormIndex = selection.formIndex;
    starter.showdownItem = selection.item;
  }

  /**
   * Showdown (B7 item 3): the FULL legal move pool for the current grid line's FIELDED
   * stage - every level-up move (any level) + TM / tutor move of the fielded species (with
   * pre-evolution inheritance) plus the line's UNLOCKED egg moves. Uses the SAME shared
   * {@linkcode collectShowdownLegalMoves} helper as the validator's `isMoveLegal`, so the
   * move-swap picker can never offer a move the start-time validator would reject. Only
   * meaningful in showdown mode (the fielded stage falls back to the grid species otherwise).
   */
  private showdownLegalMovePool(rootId: number = this.lastSpecies.speciesId): MoveId[] {
    const selection = this.showdownSelections.get(rootId);
    const fieldedSpeciesId = selection?.speciesId ?? rootId;
    const eggBits = this.getSpeciesData(rootId).starterDataEntry.eggMoves;
    return [...collectShowdownLegalMoves(rootId, fieldedSpeciesId, collectUnlockedEggMoves(rootId, eggBits))];
  }

  /**
   * Showdown (B7 item 1): the PICKED Field Stage to RENDER for a line, or null when no stage
   * was picked (or not in showdown mode) - the caller then renders the base grid species as
   * before. Returns the concrete stage species + its form index so the preview sprite, the
   * party mini-icon, and the grid icon all show the chosen evolution / mega instead of the
   * base form. Purely a render override: the underlying dex cosmetics (shiny/variant/female)
   * and the per-line Shiny Lab look are unaffected.
   */
  private showdownRenderStage(rootSpeciesId: number): { species: PokemonSpecies; formIndex: number } | null {
    if (!globalScene.gameMode.isShowdown) {
      return null;
    }
    const selection = this.showdownSelections.get(rootSpeciesId);
    if (!selection) {
      return null;
    }
    return { species: getPokemonSpecies(selection.speciesId as SpeciesId), formIndex: selection.formIndex };
  }

  /** Showdown: true if a DIFFERENT in-party line is already fielding a mega/primal. */
  private showdownTeamHasOtherMega(rootSpeciesId: number): boolean {
    return this.starters.some(
      s => s.speciesId !== rootSpeciesId && isMegaStage(s.showdownSpeciesId ?? s.speciesId, s.showdownFormIndex ?? 0),
    );
  }

  /**
   * Showdown: record the chosen stage for a line and re-stamp any in-party copy so
   * {@linkcode tryStart} fields the chosen stage. A mega stage force-locks the held-item
   * slot to the mega-stone sentinel, stashing the player's explicit pre-mega item in
   * `prevItem`; switching back to a non-mega stage restores that stashed choice (or the
   * default when there was none). Returns `false` (rejected, no change) when picking a mega
   * would break the one-mega-per-team cap.
   */
  private setShowdownStage(rootSpeciesId: number, speciesId: number, formIndex: number): boolean {
    const mega = isMegaStage(speciesId, formIndex);
    if (mega && this.showdownTeamHasOtherMega(rootSpeciesId)) {
      return false;
    }
    const selection = this.showdownSelections.get(rootSpeciesId) ?? { speciesId, formIndex };
    selection.speciesId = speciesId;
    selection.formIndex = formIndex;
    if (mega) {
      // Stash the explicit pre-mega choice (if any) before the stone overwrites it.
      if (selection.item !== MEGA_STONE_ITEM) {
        selection.prevItem = selection.item;
      }
      selection.item = MEGA_STONE_ITEM;
    } else if (selection.item === MEGA_STONE_ITEM) {
      // Leaving a mega: restore the player's explicit pre-mega item (undefined = default).
      selection.item = selection.prevItem;
      selection.prevItem = undefined;
    }
    this.showdownSelections.set(rootSpeciesId, selection);
    const index = this.starterSpecies.findIndex(s => s.speciesId === rootSpeciesId);
    if (index >= 0) {
      this.starters[index].showdownSpeciesId = speciesId;
      this.starters[index].showdownFormIndex = formIndex;
      this.starters[index].showdownItem = selection.item;
    }
    // B7 item 15: re-render the WHOLE detail panel so the picked stage shows at once - the big
    // preview sprite, the party mini-icon (updatePartyIcon, called inside for an in-party mon), the
    // ability + type + form fields (fielded-form display), AND the move pool (starterMoveset is
    // re-derived against the new fielded stage's legal set). The stage picker acts on the currently
    // highlighted line, so lastSpecies is this root. Supersedes the item-1/item-12 preview-only refresh.
    if (this.lastSpecies?.speciesId === rootSpeciesId) {
      this.setSpeciesDetails(this.lastSpecies);
    }
    return true;
  }

  /** Showdown: record the chosen held item for a line and re-stamp any in-party copy. */
  private setShowdownItem(rootSpeciesId: number, item: string): void {
    const selection = this.showdownSelections.get(rootSpeciesId) ?? { speciesId: rootSpeciesId, formIndex: 0 };
    selection.item = item;
    this.showdownSelections.set(rootSpeciesId, selection);
    const index = this.starterSpecies.findIndex(s => s.speciesId === rootSpeciesId);
    if (index >= 0) {
      this.starters[index].showdownItem = item;
    }
  }

  /**
   * Showdown: open the evolution/mega STAGE picker for the current grid species (the line
   * root). Evolution stages field the reachable base form; mega/primal stages field the
   * mega form (and will lock the held-item slot - handled by the item picker).
   */
  private showShowdownStageOptions(): void {
    const ui = this.getUi();
    const rootId = this.lastSpecies.speciesId;
    const options: OptionSelectItem[] = [];
    for (const stageId of listEvolutionStages(rootId)) {
      const species = getPokemonSpecies(stageId as SpeciesId);
      options.push({
        label: species.name,
        handler: () => {
          this.setShowdownStage(rootId, stageId, 0);
          ui.setMode(UiMode.STARTER_SELECT);
          return true;
        },
      });
    }
    for (const mega of listMegaStages(rootId)) {
      const species = getPokemonSpecies(mega.speciesId as SpeciesId);
      options.push({
        label: `${species.name} ${mega.formName}`,
        handler: () => {
          // One-mega-per-team: reject a second mega with the error sound and keep the
          // picker open (returning false leaves the menu up), mirroring the cost-cap
          // rejection's playError feedback.
          if (!this.setShowdownStage(rootId, mega.speciesId, mega.formIndex)) {
            ui.playError();
            return false;
          }
          ui.setMode(UiMode.STARTER_SELECT);
          return true;
        },
      });
    }
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        ui.setMode(UiMode.STARTER_SELECT);
        return true;
      },
    });
    // Return to STARTER_SELECT FIRST, then open the submenu - the same handoff the
    // Innates / Manage Moves / Manage Nature menus use (opening a new OPTION_SELECT
    // directly from inside the action menu's own OPTION_SELECT softlocks it).
    ui.setMode(UiMode.STARTER_SELECT).then(() =>
      ui.setModeWithoutClear(UiMode.OPTION_SELECT, { options, maxOptions: 8, yOffset: 47 }),
    );
  }

  /**
   * Showdown: open the held-ITEM picker for the current grid line. Lists the curated
   * {@linkcode SHOWDOWN_ITEM_POOL} (localized modifier names) - exactly one item per mon,
   * no "None" option (an unset slot fields the pool default). Not reachable for a mega
   * stage - that slot is locked to the mega stone.
   */
  private showShowdownItemOptions(): void {
    const ui = this.getUi();
    const rootId = this.lastSpecies.speciesId;
    const options: OptionSelectItem[] = SHOWDOWN_ITEM_POOL.map(key => ({
      label: getModifierType(modifierTypes[key]).name,
      handler: () => {
        this.setShowdownItem(rootId, key);
        ui.setMode(UiMode.STARTER_SELECT);
        return true;
      },
    }));
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        ui.setMode(UiMode.STARTER_SELECT);
        return true;
      },
    });
    ui.setMode(UiMode.STARTER_SELECT).then(() =>
      ui.setModeWithoutClear(UiMode.OPTION_SELECT, { options, maxOptions: 8, yOffset: 47 }),
    );
  }

  updatePartyIcon(species: PokemonSpecies, index: number) {
    const props = globalScene.gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(species.speciesId));
    this.renderShowdownAwarePartyIcon(this.starterIcons[index], species, props);
    // The Shiny Lab look stays keyed on the ROOT line (its custom-shiny palette is per-line), so the
    // FX overlay uses the ROOT form index even when the icon follows an evolved/mega Field Stage.
    this.refreshShinyLabIconFx(
      this.starterIcons[index],
      species,
      props.female,
      props.formIndex,
      props.shiny,
      props.variant,
      `starter-party-shiny-lab-icon-${index}-${species.speciesId}`,
      false,
    );
  }

  /**
   * Showdown-aware party mini-icon render (B7 item 15). Draws the icon for `species` at the given
   * cosmetic `props`, but when a Field Stage is picked for this line the icon FOLLOWS the fielded
   * form (evolved OR mega) - matching the big preview sprite. This SUPERSEDES the earlier item-12
   * base-only rule (maintainer-decided: "everything follows the stage").
   *
   * Uses the wager screen's robust icon pattern (item 14c): set the atlas key + frame
   * UNCONDITIONALLY, then a fallback chain fielded -> fielded-non-shiny-base -> ROOT line base ->
   * neutral placeholder, so a missing form frame / un-loaded custom atlas is never a broken box.
   * In every non-showdown mode the stage override is a no-op (renderStage is null there), so the
   * ROOT/base icon renders exactly as before.
   */
  private renderShowdownAwarePartyIcon(
    icon: Phaser.GameObjects.Sprite,
    species: PokemonSpecies,
    props: { female: boolean; formIndex: number; shiny: boolean; variant: number },
  ): void {
    const renderStage = this.showdownRenderStage(species.speciesId);
    const iconSpecies = renderStage?.species ?? species;
    const iconFormIndex = renderStage?.formIndex ?? props.formIndex;
    const wantId = iconSpecies.getIconId(props.female, iconFormIndex, props.shiny, props.variant);
    icon.setTexture(iconSpecies.getIconAtlasKey(iconFormIndex, props.shiny, props.variant)).setFrame(wantId);
    if (icon.frame.name === wantId) {
      return; // fielded frame resolved cleanly
    }
    // Missing frame (e.g. a variant/shiny form icon, or an un-loaded ER-custom form sheet): fall
    // back to the fielded species' NON-SHINY base frame first (mirrors BattleScene.addPokemonIcon).
    const baseId = iconSpecies.getIconId(false, iconFormIndex, false, 0);
    if (icon.texture.has(baseId)) {
      icon.setFrame(baseId);
      return;
    }
    // Whole fielded sheet absent: fall back to the ROOT line's boot-loaded base icon, then - as a
    // last resort - the neutral placeholder, so a slot is never left showing a broken box.
    const rootFrame = species.getIconId(false, 0, false, 0);
    icon.setTexture(species.getIconAtlasKey(0, false, 0));
    if (icon.texture.has(rootFrame)) {
      icon.setFrame(rootFrame);
    } else {
      icon.setTexture("pokemon_icons_0").setFrame("unknown");
    }
  }

  /**
   * Puts a move at the requested index in the current highlighted Pokemon's moveset.
   * If the move was already present in the moveset, swap its position with the one at the requested index.
   *
   * @remarks
   * ⚠️ {@linkcode starterMoveset | this.starterMoveset} **must not be null when this method is called**
   * @param targetIndex - The index to place the move
   * @param newMove - The move to place in the moveset
   * @param previousMove - The move that was previously in the spot
   */
  switchMoveHandler(targetIndex: number, newMove: MoveId, previousMove: MoveId) {
    const starterMoveset = this.starterMoveset;
    if (starterMoveset == null) {
      console.warn("Trying to update a non-existing moveset");
      return;
    }

    const speciesId = this.lastSpecies.speciesId;
    const existingMoveIndex = starterMoveset.indexOf(newMove);
    starterMoveset[targetIndex] = newMove;
    if (existingMoveIndex !== -1) {
      starterMoveset[existingMoveIndex] = previousMove;
    }
    const updatedMoveset = starterMoveset.slice() as StarterMoveset;
    const formIndex = globalScene.gameData.getSpeciesDexAttrProps(this.lastSpecies, this.dexAttrCursor).formIndex;
    const starterDataEntry = globalScene.gameData.getStarterDataEntry(speciesId);
    // species has different forms
    if (Object.hasOwn(pokemonFormLevelMoves, speciesId)) {
      // Species has forms with different movesets
      if (!starterDataEntry.moveset || Array.isArray(starterDataEntry.moveset)) {
        starterDataEntry.moveset = {};
      }
      starterDataEntry.moveset[formIndex] = updatedMoveset;
    } else {
      starterDataEntry.moveset = updatedMoveset;
    }
    this.hasSwappedMoves = true;
    this.setSpeciesDetails(this.lastSpecies, { forSeen: false });
    this.updateSelectedStarterMoveset(speciesId);
  }

  /**
   * Update the starter moveset for the given species if it is part of the selected starters.
   *
   * @remarks
   * It is safe to call with a species that is not part of the selected starters.
   *
   * @param id - The species ID to update the moveset for
   */
  private updateSelectedStarterMoveset(id: SpeciesId): void {
    if (this.starterMoveset === null) {
      return;
    }

    for (const [index, species] of this.starterSpecies.entries()) {
      if (species.speciesId === id) {
        this.starters[index].moveset = this.starterMoveset;
      }
    }
  }

  updateButtonIcon(
    iconSetting: SettingKeyboard,
    gamepadType: string,
    iconElement: GameObjects.Sprite,
    controlLabel: GameObjects.Text,
  ): void {
    let iconPath: string | undefined;
    // touch controls cannot be rebound as is, and are just emulating a keyboard event.
    // Additionally, since keyboard controls can be rebound (and will be displayed when they are), we need to have special handling for the touch controls
    if (gamepadType === "touch") {
      gamepadType = "keyboard";
      switch (iconSetting) {
        case SettingKeyboard.BUTTON_CYCLE_SHINY:
          iconPath = "R.png";
          break;
        case SettingKeyboard.BUTTON_CYCLE_FORM:
          iconPath = "F.png";
          break;
        case SettingKeyboard.BUTTON_CYCLE_GENDER:
          iconPath = "G.png";
          break;
        case SettingKeyboard.BUTTON_CYCLE_ABILITY:
          iconPath = "E.png";
          break;
        case SettingKeyboard.BUTTON_CYCLE_NATURE:
          iconPath = "N.png";
          break;
        case SettingKeyboard.BUTTON_CYCLE_TERA:
          iconPath = "V.png";
          break;
        case SettingKeyboard.BUTTON_STATS:
          iconPath = "C.png";
          break;
        default:
          break;
      }
    } else {
      iconPath = globalScene.inputController?.getIconForLatestInputRecorded(iconSetting);
    }
    // The bang for iconPath is correct as long the cases in the above switch statement handle all `SettingKeyboard` values enabled in touch mode
    iconElement
      .setTexture(gamepadType, iconPath!)
      .setPosition(this.instructionRowX, this.instructionRowY)
      .setVisible(true);
    controlLabel
      .setPosition(this.instructionRowX + this.instructionRowTextOffset, this.instructionRowY)
      .setVisible(true);
    this.instructionsContainer.add([iconElement, controlLabel]);
    this.instructionRowY += 8;
    // ER: wrap after 2 rows (not 3) → a 3-column × 2-row grid. Combined with
    // the higher container y (see constructor), all 6 cycle-hotkeys stay
    // within the 180px-tall UI space instead of being clipped off the bottom.
    if (this.instructionRowY >= 16) {
      this.instructionRowY = 0;
      this.instructionRowX += 50;
    }
  }

  updateFilterButtonIcon(
    iconSetting: SettingKeyboard,
    gamepadType: string,
    iconElement: GameObjects.Sprite,
    controlLabel: GameObjects.Text,
  ): void {
    let iconPath: string | undefined;
    // touch controls cannot be rebound as is, and are just emulating a keyboard event.
    // Additionally, since keyboard controls can be rebound (and will be displayed when they are), we need to have special handling for the touch controls
    if (gamepadType === "touch") {
      gamepadType = "keyboard";
      iconPath = "C.png";
    } else {
      iconPath = globalScene.inputController?.getIconForLatestInputRecorded(iconSetting);
    }
    iconElement
      .setTexture(gamepadType, iconPath)
      .setPosition(this.filterInstructionRowX, this.filterInstructionRowY)
      .setVisible(true);
    controlLabel
      .setPosition(this.filterInstructionRowX + this.instructionRowTextOffset, this.filterInstructionRowY)
      .setVisible(true);
    this.filterInstructionsContainer.add([iconElement, controlLabel]);
    this.filterInstructionRowY += 8;
    if (this.filterInstructionRowY >= 24) {
      this.filterInstructionRowY = 0;
      this.filterInstructionRowX += 50;
    }
  }

  updateInstructions(): void {
    this.instructionRowX = 0;
    this.instructionRowY = 0;
    this.filterInstructionRowX = 0;
    this.filterInstructionRowY = 0;
    this.hideInstructions();
    this.instructionsContainer.removeAll();
    this.filterInstructionsContainer.removeAll();
    let gamepadType: string;
    if (globalScene.inputMethod === "gamepad") {
      gamepadType = globalScene.inputController.getConfig(
        globalScene.inputController.selectedDevice[Device.GAMEPAD]!, // TODO: re-evaluate bang
      ).padType;
    } else {
      gamepadType = globalScene.inputMethod;
    }

    if (!gamepadType) {
      return;
    }

    if (this.speciesStarterDexEntry?.caughtAttr) {
      if (this.canCycleShiny) {
        this.updateButtonIcon(SettingKeyboard.BUTTON_CYCLE_SHINY, gamepadType, this.shinyIconElement, this.shinyLabel);
      }
      if (this.canCycleForm) {
        this.updateButtonIcon(SettingKeyboard.BUTTON_CYCLE_FORM, gamepadType, this.formIconElement, this.formLabel);
      }
      if (this.canCycleGender) {
        this.updateButtonIcon(
          SettingKeyboard.BUTTON_CYCLE_GENDER,
          gamepadType,
          this.genderIconElement,
          this.genderLabel,
        );
      }
      if (this.canCycleAbility) {
        this.updateButtonIcon(
          SettingKeyboard.BUTTON_CYCLE_ABILITY,
          gamepadType,
          this.abilityIconElement,
          this.abilityLabel,
        );
      }
      if (this.canCycleNature) {
        this.updateButtonIcon(
          SettingKeyboard.BUTTON_CYCLE_NATURE,
          gamepadType,
          this.natureIconElement,
          this.natureLabel,
        );
      }
      if (this.canCycleTera) {
        this.updateButtonIcon(SettingKeyboard.BUTTON_CYCLE_TERA, gamepadType, this.teraIconElement, this.teraLabel);
      }
    }

    // if filter mode is inactivated and gamepadType is not undefined, update the button icons
    if (!this.filterMode) {
      this.updateFilterButtonIcon(
        SettingKeyboard.BUTTON_STATS,
        gamepadType,
        this.goFilterIconElement,
        this.goFilterLabel,
      );
    }
  }

  getValueLimit(): number {
    // Roster-pick mode has no point budget (you whitelist any number of species), so
    // the affordability grey-out leaves cells gated ONLY by challenge legality.
    if (this.rosterPickMode) {
      return Number.POSITIVE_INFINITY;
    }
    // Showdown: teams are built at level 100 from the player's own unlocked
    // collection, and the point budget is deferred by design - so no cost ceiling
    // gates selection. A flat, effectively-unlimited limit keeps the cost panel
    // from ever rejecting an owned pick.
    if (globalScene.gameMode.isShowdown) {
      return SHOWDOWN_VALUE_LIMIT;
    }
    // Co-op (#633): each player picks their OWN team on their OWN screen with an
    // independent 5-point budget (two players ~= the solo 10-point pool), not the
    // shared solo limit. Flat for now; co-op challenge interplay lands in P6.
    if (globalScene.gameMode.isCoop) {
      return COOP_STARTER_COST_BUDGET;
    }

    const valueLimit = new NumberHolder(0);
    switch (globalScene.gameMode.modeId) {
      case GameModes.ENDLESS:
      case GameModes.SPLICED_ENDLESS:
        valueLimit.value = 15;
        break;
      default:
        valueLimit.value = 10;
    }

    applyChallenges(ChallengeType.STARTER_POINTS, valueLimit);

    return valueLimit.value;
  }

  /**
   * Max Pokemon a single player may add during selection. Co-op (#633) caps each
   * player at {@linkcode COOP_SLOTS_PER_PLAYER} (3) - the two players' halves fill
   * the shared 6-slot party; solo modes use the full {@linkcode PLAYER_PARTY_MAX_SIZE}.
   */
  getPartySizeLimit(): number {
    return globalScene.gameMode.isCoop ? COOP_SLOTS_PER_PLAYER : PLAYER_PARTY_MAX_SIZE;
  }

  /**
   * Co-op (#633): refresh the partner-status banner from the live session so the
   * player sees their partner's progress without sharing a screen ("Waiting for
   * partner..." -> "<name>: 2/3" -> "<name>: ready" -> "Both ready!"). Hidden in
   * every non-co-op mode and when no session is active.
   */
  private updateCoopStatus(): void {
    const controller = getCoopController();
    if (!globalScene.gameMode.isCoop || !controller) {
      this.coopStatusText.setVisible(false);
      return;
    }
    const s = controller.snapshot();
    const name = s.partnerName ?? "Partner";
    let msg: string;
    if (!s.partnerConnected) {
      msg = "Waiting for partner...";
    } else if (s.bothReady) {
      msg = "Both ready!";
    } else if (s.partnerReady) {
      msg = `${name}: ready`;
    } else {
      msg = `${name}: ${s.partnerCount}/${COOP_SLOTS_PER_PLAYER}`;
    }
    this.coopStatusText.setText(msg).setVisible(true);
  }

  /**
   * Confirm, then begin a staggered "unlock every affordable innate" run across
   * every owned species (#305). Spends each species' own candy, cheapest slot
   * first. Processing is chunked across frames so it can't freeze the game even
   * with thousands of species; progress shows in the (red-bordered) message box.
   */
  private startMassUnlockInnates(): void {
    const ui = globalScene.ui;
    const ids = Object.keys(globalScene.gameData.starterData)
      .map(Number)
      .filter(id => speciesStarterCosts[id] != null);
    ui.showText("Unlock all affordable innates? Spends candy.", null, () => {
      // setModeWithoutClear (not setMode) so the question text stays visible
      // under the Yes/No prompt — plain setMode wipes the message instantly.
      ui.setModeWithoutClear(
        UiMode.CONFIRM,
        () => {
          // isMassUnlocking is already armed (set in handleMassUnlockTrigger) and
          // stays armed through processing so no refresh can re-fire the prompt.
          this.blockInput = true;
          ui.setMode(UiMode.STARTER_SELECT);
          this.runMassUnlockChunk(ids, 0, { species: 0, slots: 0, candy: 0 });
        },
        () => {
          // Declined: disarm and return.
          this.isMassUnlocking = false;
          ui.setMode(UiMode.STARTER_SELECT);
        },
      );
    });
  }

  /** Process one chunk of the mass-unlock work list, then reschedule the next. */
  private runMassUnlockChunk(
    ids: number[],
    start: number,
    totals: { species: number; slots: number; candy: number },
  ): void {
    const CHUNK = 150;
    const end = Math.min(start + CHUNK, ids.length);
    for (let i = start; i < end; i++) {
      const id = ids[i];
      const starterData = globalScene.gameData.starterData[id];
      const starterCost = speciesStarterCosts[id];
      if (!starterData || starterData.candyCount <= 0 || starterCost == null) {
        continue;
      }
      // Use the real passive candy base (getPassiveCandyCount), NOT the raw
      // starter point cost, so the per-slot cost matches the actual unlock menu.
      const baseCost = getPassiveCandyCount(starterCost);
      const passiveAbilityIds = getPokemonSpecies(id).getPassiveAbilities(0);
      const plan = planMassUnlock(
        starterData.passiveAttr,
        starterData.candyCount,
        slot => getErPassiveSlotCandyCost(baseCost, slot),
        slot => passiveAbilityIds[slot] !== AbilityId.NONE,
      );
      if (plan.unlocked > 0) {
        starterData.passiveAttr = plan.passiveAttr;
        starterData.candyCount -= plan.candySpent;
        totals.species++;
        totals.slots += plan.unlocked;
        totals.candy += plan.candySpent;
      }
    }
    if (end < ids.length) {
      globalScene.ui.showText(`Unlocking innates… ${end}/${ids.length}`);
      globalScene.time.delayedCall(1, () => this.runMassUnlockChunk(ids, end, totals));
      return;
    }
    // Finished: persist once, refresh the grid, report the summary.
    this.isMassUnlocking = false;
    this.blockInput = false;
    globalScene.gameData.saveSystem().then(success => {
      if (!success) {
        globalScene.reset(true);
      }
    });
    this.updateStarters();
    // Auto-dismissing toast (no ▼ / keypress): show the summary briefly, then
    // clear the message box on its own so the pop-up doesn't linger.
    globalScene.ui.showText(
      `Unlocked ${totals.slots} innate${totals.slots === 1 ? "" : "s"} across ${totals.species} Pokémon (−${totals.candy} candy).`,
      null,
      () => globalScene.ui.showText("", 0),
      2500,
      false,
    );
  }

  /**
   * If the Unlocks-dropdown "MASS_UNLOCK" action entry is toggled on, treat it as
   * a one-shot button: reset it to OFF and kick off the staggered mass-unlock.
   * Returns true if it fired (caller should bail out of the normal filter pass).
   */
  private handleMassUnlockTrigger(): boolean {
    if (this.isMassUnlocking) {
      return false;
    }
    const triggered = this.filterBar
      .getVals(DropDownColumn.UNLOCKS)
      .some(o => o.val === "MASS_UNLOCK" && o.state !== DropDownState.OFF);
    if (!triggered) {
      return false;
    }
    // Arm the guard NOW (before the confirm) so no refresh during the confirm /
    // staggered run can re-fire the prompt. Cleared on decline or on finish.
    this.isMassUnlocking = true;
    // Reset the action entry so it behaves like a button, not a sticky filter.
    const dropDown = this.filterBar.getFilter(DropDownColumn.UNLOCKS);
    dropDown.options.find(o => o.val === "MASS_UNLOCK")?.setOptionState(DropDownState.OFF);
    this.startMassUnlockInnates();
    return true;
  }

  updateStarters = () => {
    if (this.handleMassUnlockTrigger()) {
      return;
    }
    this.scrollCursor = 0;
    this.filteredStarterContainers = [];
    this.validStarterContainers = [];

    this.pokerusCursorObjs.forEach(cursor => cursor.setVisible(false));
    this.starterCursorObjs.forEach(cursor => cursor.setVisible(false));

    this.filterBar.updateFilterLabels();

    // pre filter for challenges
    if (globalScene.gameMode.modeId === GameModes.CHALLENGE) {
      this.starterContainers.forEach(container => {
        const species = container.species;
        let allFormsValid = false;
        if (species.forms?.length > 0) {
          for (let i = 0; i < species.forms.length; i++) {
            /* Here we are making a fake form index dex props for challenges
             * Since some pokemon rely on forms to be valid (i.e. blaze tauros for fire challenges), we make a fake form and dex props to use in the challenge
             */
            if (!species.forms[i].isStarterSelectable) {
              continue;
            }
            const tempFormProps = BigInt(Math.pow(2, i)) * DexAttr.DEFAULT_FORM;
            const isValidForChallenge = checkStarterValidForChallenge(
              container.species,
              globalScene.gameData.getSpeciesDexAttrProps(species, tempFormProps),
              true,
            );
            allFormsValid ||= isValidForChallenge;
          }
        } else {
          const isValidForChallenge = checkStarterValidForChallenge(
            container.species,
            globalScene.gameData.getSpeciesDexAttrProps(
              species,
              globalScene.gameData.getSpeciesDefaultDexAttr(container.species, false, true),
            ),
            true,
          );
          allFormsValid = isValidForChallenge;
        }
        if (allFormsValid) {
          this.validStarterContainers.push(container);
        } else {
          container.setVisible(false);
        }
      });
    } else {
      this.validStarterContainers = this.starterContainers;
    }

    // this updates icons for previously saved pokemon
    for (const currentFilteredContainer of this.validStarterContainers) {
      const starterSprite = currentFilteredContainer.icon as Phaser.GameObjects.Sprite;

      const currentDexAttr = this.getCurrentDexProps(currentFilteredContainer.species.speciesId);
      const props = globalScene.gameData.getSpeciesDexAttrProps(currentFilteredContainer.species, currentDexAttr);

      starterSprite.setTexture(
        currentFilteredContainer.species.getIconAtlasKey(props.formIndex, props.shiny, props.variant),
        currentFilteredContainer.species.getIconId(props.female!, props.formIndex, props.shiny, props.variant),
      );
      currentFilteredContainer.checkIconId(props.female, props.formIndex, props.shiny, props.variant);
      this.refreshShinyLabIconFx(
        starterSprite,
        currentFilteredContainer.species,
        props.female,
        props.formIndex,
        props.shiny,
        props.variant,
        `starter-grid-shiny-lab-icon-${currentFilteredContainer.species.speciesId}`,
        false,
      );
    }

    // filter
    this.validStarterContainers.forEach(container => {
      container.setVisible(false);

      // ER: only BASE forms are selectable starters. Hide any evolved species
      // that slipped a starterCost or was caught directly (e.g. a hatched
      // "Infernape Redux"), which would otherwise show with blank abilities.
      if (Object.hasOwn(pokemonPrevolutions, container.species.speciesId)) {
        return;
      }

      container.cost = globalScene.gameData.getSpeciesStarterValue(container.species.speciesId);

      // First, ensure you have the caught attributes for the species else default to bigint 0
      const { dexEntry, starterDataEntry: starterData } = this.getSpeciesData(container.species.speciesId);
      const caughtAttr = dexEntry?.caughtAttr ?? BigInt(0);
      const isStarterProgressable = Object.hasOwn(speciesEggMoves, container.species.speciesId);

      // ER free-text search: Name (substring) + Ability Text (regex over the
      // FULL detailed ability descriptions of the main ability + all innates).
      const nameQuery = this.filterText.getValue(FilterTextRow.NAME);
      const fitsName =
        nameQuery === this.filterText.defaultText
        || container.species.name.toLowerCase().includes(nameQuery.toLowerCase());
      const abilityQuery = this.filterText.getValue(FilterTextRow.ABILITY_TEXT);
      const fitsAbilityText =
        abilityQuery === this.filterText.defaultText || matchesAbilityText(container.species, abilityQuery);

      // Gen filter. Redux customs live under the dedicated "Redux" tab
      // (REDUX_GEN_FILTER_VALUE) instead of Gen 9, so route them there and keep
      // them out of their real (gen-9) column.
      const genVals = this.filterBar.getVals(DropDownColumn.GEN);
      const fitsGen = isReduxFormSpecies(container.species)
        ? genVals.includes(REDUX_GEN_FILTER_VALUE)
        : genVals.includes(container.species.generation);

      // Type filter
      const fitsType = this.filterBar
        .getVals(DropDownColumn.TYPES)
        .some(type => container.species.isOfType((type as number) - 1));

      // Caught / Shiny filter
      const isNonShinyCaught = !!(caughtAttr & DexAttr.NON_SHINY);
      const isShinyCaught = !!(caughtAttr & DexAttr.SHINY);
      const isVariant1Caught = isShinyCaught && !!(caughtAttr & DexAttr.DEFAULT_VARIANT);
      const isVariant2Caught = isShinyCaught && !!(caughtAttr & DexAttr.VARIANT_2);
      const isVariant3Caught = isShinyCaught && !!(caughtAttr & DexAttr.VARIANT_3);
      const isUncaught = !isNonShinyCaught && !isVariant1Caught && !isVariant2Caught && !isVariant3Caught;
      // ER (#349): t4 black unlock is starter-data state, not a dex attr.
      const isBlackCaught = !!starterData?.erBlackShiny;
      const fitsCaught = this.filterBar.getVals(DropDownColumn.CAUGHT).some(caught => {
        if (caught === "SHINYBLACK") {
          return isBlackCaught;
        }
        if (caught === "SHINY3") {
          return isVariant3Caught && !isBlackCaught;
        }
        if (caught === "SHINY2") {
          return isVariant2Caught && !isVariant3Caught;
        }
        if (caught === "SHINY") {
          return isVariant1Caught && !isVariant2Caught && !isVariant3Caught;
        }
        if (caught === "NORMAL") {
          return isNonShinyCaught && !isVariant1Caught && !isVariant2Caught && !isVariant3Caught;
        }
        if (caught === "UNCAUGHT") {
          return isUncaught;
        }
      });

      // Passive Filter — ER 3-slot aware. The legacy logic treated passives as a
      // single binary (`passiveAttr > 0`), so a mon with only ONE of its three
      // innate slots unlocked counted as "fully unlocked" and never appeared under
      // "Can Unlock" (user report: Finneon with slot 0 unlocked). Count slots:
      //  - Unlocked (ON):   at least one slot unlocked
      //  - Unlockable:      at least one slot still LOCKED and a passive is available
      //  - Locked (EXCLUDE): no slot unlocked yet
      const unlockedPassiveCount = PASSIVE_SLOTS.reduce(
        (n, _slot, i) => n + (isSlotUnlocked(starterData.passiveAttr, i as 0 | 1 | 2) ? 1 : 0),
        0,
      );
      const isPassiveUnlocked = unlockedPassiveCount > 0;
      const isPassiveUnlockable =
        this.isPassiveAvailable(container.species.speciesId) && unlockedPassiveCount < PASSIVE_SLOTS.length;
      const fitsPassive = this.filterBar.getVals(DropDownColumn.UNLOCKS).some(unlocks => {
        if (unlocks.val !== "PASSIVE") {
          return false;
        }
        switch (unlocks.state) {
          case DropDownState.OFF:
            return true;
          case DropDownState.THREE: // all 3 innate slots unlocked
            return unlockedPassiveCount === 3;
          case DropDownState.TWO: // exactly 2 unlocked
            return unlockedPassiveCount === 2;
          case DropDownState.ONE: // exactly 1 unlocked
            return unlockedPassiveCount === 1;
          case DropDownState.UNLOCKABLE: // at least one more slot can be unlocked
            return isPassiveUnlockable;
          case DropDownState.EXCLUDE: // none unlocked yet
            return isStarterProgressable && !isPassiveUnlocked;
          default:
            return false;
        }
      });

      // Cost Reduction Filter
      const isCostReducedByOne = starterData.valueReduction === 1;
      const isCostReducedByTwo = starterData.valueReduction === 2;
      const isCostReductionUnlockable = this.isValueReductionAvailable(container.species.speciesId);
      const fitsCostReduction = this.filterBar.getVals(DropDownColumn.UNLOCKS).some(unlocks => {
        if (unlocks.val === "COST_REDUCTION" && unlocks.state === DropDownState.ON) {
          return isCostReducedByOne || isCostReducedByTwo;
        }
        if (unlocks.val === "COST_REDUCTION" && unlocks.state === DropDownState.ONE) {
          return isCostReducedByOne;
        }
        if (unlocks.val === "COST_REDUCTION" && unlocks.state === DropDownState.TWO) {
          return isCostReducedByTwo;
        }
        if (unlocks.val === "COST_REDUCTION" && unlocks.state === DropDownState.EXCLUDE) {
          return isStarterProgressable && !(isCostReducedByOne || isCostReducedByTwo);
        }
        if (unlocks.val === "COST_REDUCTION" && unlocks.state === DropDownState.UNLOCKABLE) {
          return isCostReductionUnlockable;
        }
        if (unlocks.val === "COST_REDUCTION" && unlocks.state === DropDownState.OFF) {
          return true;
        }
      });

      // Favorite Filter
      const isFavorite = this.starterPreferences[container.species.speciesId]?.favorite ?? false;
      const fitsFavorite = this.filterBar.getVals(DropDownColumn.MISC).some(misc => {
        if (misc.val === "FAVORITE" && misc.state === DropDownState.ON) {
          return isFavorite;
        }
        if (misc.val === "FAVORITE" && misc.state === DropDownState.EXCLUDE) {
          return !isFavorite;
        }
        if (misc.val === "FAVORITE" && misc.state === DropDownState.OFF) {
          return true;
        }
      });

      // Ribbon / Classic Win Filter
      const hasWon = starterData.classicWinCount > 0;
      const hasNotWon = starterData.classicWinCount === 0;
      const isUndefined = starterData.classicWinCount === undefined;
      const fitsWin = this.filterBar.getVals(DropDownColumn.MISC).some(misc => {
        if (misc.val === "WIN" && misc.state === DropDownState.ON) {
          return hasWon;
        }
        if (misc.val === "WIN" && misc.state === DropDownState.EXCLUDE) {
          return hasNotWon || isUndefined;
        }
        if (misc.val === "WIN" && misc.state === DropDownState.OFF) {
          return true;
        }
        return false;
      });

      // HA Filter
      const speciesHasHiddenAbility =
        container.species.abilityHidden !== container.species.ability1
        && container.species.abilityHidden !== AbilityId.NONE;
      const hasHA = starterData.abilityAttr & AbilityAttr.ABILITY_HIDDEN;
      const fitsHA = this.filterBar.getVals(DropDownColumn.MISC).some(misc => {
        if (misc.val === "HIDDEN_ABILITY" && misc.state === DropDownState.ON) {
          return hasHA;
        }
        if (misc.val === "HIDDEN_ABILITY" && misc.state === DropDownState.EXCLUDE) {
          return speciesHasHiddenAbility && !hasHA;
        }
        if (misc.val === "HIDDEN_ABILITY" && misc.state === DropDownState.OFF) {
          return true;
        }
        return false;
      });

      // Egg Purchasable Filter
      const isEggPurchasable = this.isSameSpeciesEggAvailable(container.species.speciesId);
      const fitsEgg = this.filterBar.getVals(DropDownColumn.MISC).some(misc => {
        if (misc.val === "EGG" && misc.state === DropDownState.ON) {
          return isEggPurchasable;
        }
        if (misc.val === "EGG" && misc.state === DropDownState.EXCLUDE) {
          return isStarterProgressable && !isEggPurchasable;
        }
        if (misc.val === "EGG" && misc.state === DropDownState.OFF) {
          return true;
        }
        return false;
      });

      // Pokerus Filter
      const fitsPokerus = this.filterBar.getVals(DropDownColumn.MISC).some(misc => {
        if (misc.val === "POKERUS" && misc.state === DropDownState.ON) {
          return this.pokerusSpecies.includes(container.species);
        }
        if (misc.val === "POKERUS" && misc.state === DropDownState.EXCLUDE) {
          return !this.pokerusSpecies.includes(container.species);
        }
        if (misc.val === "POKERUS" && misc.state === DropDownState.OFF) {
          return true;
        }
        return false;
      });

      if (
        fitsGen
        && fitsType
        && fitsCaught
        && fitsPassive
        && fitsCostReduction
        && fitsFavorite
        && fitsWin
        && fitsHA
        && fitsEgg
        && fitsPokerus
        && fitsName
        && fitsAbilityText
      ) {
        this.filteredStarterContainers.push(container);
      }
    });

    this.starterSelectScrollBar.setTotalRows(Math.max(Math.ceil(this.filteredStarterContainers.length / 9), 1));
    this.starterSelectScrollBar.setScrollCursor(0);

    // sort
    const sort = this.filterBar.getVals(DropDownColumn.SORT)[0];
    this.filteredStarterContainers.sort((a, b) => {
      switch (sort.val) {
        case SortCriteria.NUMBER:
          return (a.species.speciesId - b.species.speciesId) * -sort.dir;
        case SortCriteria.COST:
          return (a.cost - b.cost) * -sort.dir;
        case SortCriteria.CANDY: {
          const candyCountA = globalScene.gameData.getStarterDataEntry(a.species.speciesId).candyCount;
          const candyCountB = globalScene.gameData.getStarterDataEntry(b.species.speciesId).candyCount;
          return (candyCountA - candyCountB) * -sort.dir;
        }
        case SortCriteria.IV: {
          const avgIVsA =
            globalScene.gameData.dexData[a.species.speciesId].ivs.reduce((a, b) => a + b, 0)
            / globalScene.gameData.dexData[a.species.speciesId].ivs.length;
          const avgIVsB =
            globalScene.gameData.dexData[b.species.speciesId].ivs.reduce((a, b) => a + b, 0)
            / globalScene.gameData.dexData[b.species.speciesId].ivs.length;
          return (avgIVsA - avgIVsB) * -sort.dir;
        }
        case SortCriteria.NAME:
          return a.species.name.localeCompare(b.species.name) * -sort.dir;
        case SortCriteria.CAUGHT:
          return (
            (globalScene.gameData.dexData[a.species.speciesId].caughtCount
              - globalScene.gameData.dexData[b.species.speciesId].caughtCount)
            * -sort.dir
          );
        case SortCriteria.HATCHED:
          return (
            (globalScene.gameData.dexData[a.species.speciesId].hatchedCount
              - globalScene.gameData.dexData[b.species.speciesId].hatchedCount)
            * -sort.dir
          );
      }
      return 0;
    });

    this.updateScroll();
  };

  override destroy(): void {
    // Without this the reference gets hung up and no startercontainers get GCd
    this.starterContainers = [];
    /* TODO: Uncomment this once our testing infra supports mocks of `Phaser.GameObject.Group`
    this.instructionElemGroup.destroy(true);
    */
  }

  updateScroll = () => {
    const maxColumns = 9;
    const maxRows = 9;
    const onScreenFirstIndex = this.scrollCursor * maxColumns;
    const onScreenLastIndex = Math.min(
      this.filteredStarterContainers.length - 1,
      onScreenFirstIndex + maxRows * maxColumns - 1,
    );

    this.starterSelectScrollBar.setScrollCursor(this.scrollCursor);

    let pokerusCursorIndex = 0;
    this.filteredStarterContainers.forEach((container, i) => {
      const { dexEntry, starterDataEntry } = this.getSpeciesData(container.species.speciesId);

      const pos = calcStarterPosition(i, this.scrollCursor);
      container.setPosition(pos.x, pos.y);
      if (i < onScreenFirstIndex || i > onScreenLastIndex) {
        container.setVisible(false);

        if (this.pokerusSpecies.includes(container.species)) {
          this.pokerusCursorObjs[pokerusCursorIndex].setPosition(pos.x - 1, pos.y + 1).setVisible(false);
          pokerusCursorIndex++;
        }

        if (this.starterSpecies.includes(container.species)) {
          this.starterCursorObjs[this.starterSpecies.indexOf(container.species)]
            .setPosition(pos.x - 1, pos.y + 1)
            .setVisible(false);
        }
        return;
      }
      container.setVisible(true);

      if (this.pokerusSpecies.includes(container.species)) {
        this.pokerusCursorObjs[pokerusCursorIndex].setPosition(pos.x - 1, pos.y + 1).setVisible(true);
        pokerusCursorIndex++;
      }

      if (this.starterSpecies.includes(container.species)) {
        this.starterCursorObjs[this.starterSpecies.indexOf(container.species)]
          .setPosition(pos.x - 1, pos.y + 1)
          .setVisible(true);
      }

      const speciesId = container.species.speciesId;
      this.updateStarterValueLabel(container);

      container.label.setVisible(true);
      const speciesVariants =
        speciesId && dexEntry.caughtAttr & DexAttr.SHINY
          ? [DexAttr.DEFAULT_VARIANT, DexAttr.VARIANT_2, DexAttr.VARIANT_3].filter(v => !!(dexEntry.caughtAttr & v))
          : [];
      for (let v = 0; v < 3; v++) {
        const hasVariant = speciesVariants.length > v;
        container.shinyIcons[v].setVisible(hasVariant);
        if (hasVariant) {
          container.shinyIcons[v].setTint(
            getVariantTint(
              speciesVariants[v] === DexAttr.DEFAULT_VARIANT ? 0 : speciesVariants[v] === DexAttr.VARIANT_2 ? 1 : 2,
            ),
          );
        }
      }
      // ER Black Shinies (#349): 4th sparkle — pure black — once the line's
      // t4 has been caught/hatched.
      if (container.shinyIcons[3]) {
        const hasBlack = !!starterDataEntry?.erBlackShiny;
        container.shinyIcons[3].setVisible(hasBlack);
        if (hasBlack) {
          container.shinyIcons[3].setTint(0x0a0a0a);
        }
      }

      container.starterPassiveBgs.setVisible(!!starterDataEntry.passiveAttr);
      container.hiddenAbilityIcon.setVisible(!!dexEntry.caughtAttr && !!(starterDataEntry.abilityAttr & 4));
      container.classicWinIcon
        .setVisible(starterDataEntry.classicWinCount > 0)
        .setTexture(dexEntry.ribbons.has(RibbonData.NUZLOCKE) ? "champion_ribbon_emerald" : "champion_ribbon");
      container.favoriteIcon.setVisible(this.starterPreferences[speciesId]?.favorite ?? false);

      // 'Candy Icon' mode
      if (globalScene.candyUpgradeDisplay === 0) {
        if (!starterColors[speciesId]) {
          // Default to white if no colors are found
          starterColors[speciesId] = ["ffffff", "ffffff"];
        }

        // Set the candy colors
        container.candyUpgradeIcon.setTint(argbFromRgba(rgbHexToRgba(starterColors[speciesId][0])));
        container.candyUpgradeOverlayIcon.setTint(argbFromRgba(rgbHexToRgba(starterColors[speciesId][1])));

        this.setUpgradeIcon(container);
      } else if (globalScene.candyUpgradeDisplay === 1) {
        container.candyUpgradeIcon.setVisible(false);
        container.candyUpgradeOverlayIcon.setVisible(false);
      }
    });

    // Roster-pick: re-apply the selection marks after a re-filter/scroll re-renders.
    this.refreshRosterMarks();
  };

  /**
   * ER Community Challenge roster-pick: dim the icons NOT in the chosen allowed set so
   * the selected species stand out (no-op outside roster mode; an empty set = "all
   * allowed", shown undimmed). Survives re-filtering via the updateStarters() tail call.
   */
  private refreshRosterMarks(): void {
    if (!this.rosterPickMode) {
      return;
    }
    const anySelected = this.rosterSelected.size > 0;
    for (const container of this.starterContainers) {
      const selected = this.rosterSelected.has(container.species.speciesId);
      container.icon.setAlpha(!anySelected || selected ? 1 : 0.4);
    }
  }

  setCursor(cursor: number): boolean {
    let changed = false;

    if (this.filterMode) {
      changed = this.filterBarCursor !== cursor;
      this.filterBarCursor = cursor;

      this.filterBar.setCursor(cursor);
    } else {
      cursor = Math.max(Math.min(this.filteredStarterContainers.length - 1, cursor), 0);
      changed = super.setCursor(cursor);

      const pos = calcStarterPosition(cursor, this.scrollCursor);
      this.cursorObj.setPosition(pos.x - 1, pos.y + 1);

      const species = this.filteredStarterContainers[cursor]?.species;

      if (species) {
        const defaultDexAttr = this.getCurrentDexProps(species.speciesId);
        const defaultProps = globalScene.gameData.getSpeciesDexAttrProps(species, defaultDexAttr);
        // Bang is correct due to the `?` before variant
        const variant = this.starterPreferences[species.speciesId]?.variant
          ? (this.starterPreferences[species.speciesId]!.variant as Variant)
          : defaultProps.variant;
        const tint = getVariantTint(variant);
        this.pokemonShinyIcon.setFrame(getVariantIcon(variant)).setTint(tint);
        this.setSpecies(species);
        this.updateInstructions();
      }
    }

    return changed;
  }

  setFilterMode(filterMode: boolean): boolean {
    this.cursorObj.setVisible(!filterMode);
    this.filterBar.cursorObj.setVisible(filterMode);

    if (filterMode !== this.filterMode) {
      this.filterMode = filterMode;
      this.setCursor(filterMode ? this.filterBarCursor : this.cursor);
      if (filterMode) {
        this.setSpecies(null);
        this.updateInstructions();
      }

      return true;
    }

    return false;
  }

  /** ER: toggle the free-text search panel (Name + Ability-text). */
  setFilterTextMode(on: boolean): void {
    this.filterTextMode = on;
    this.filterTextContainer.setVisible(on);
    this.filterText.cursorObj.setVisible(on);
    this.cursorObj.setVisible(!on && !this.filterMode);
    if (on) {
      this.setSpecies(null);
      this.filterText.setCursor(this.filterTextCursor);
    }
  }

  moveStarterIconsCursor(index: number): void {
    this.starterIconsCursorObj.setPositionRelative(
      this.starterIcons[index],
      this.starterIconsCursorXOffset,
      this.starterIconsCursorYOffset,
    );
    if (this.starterSpecies.length > 0) {
      this.starterIconsCursorObj.setVisible(true);
      this.setSpecies(this.starterSpecies[index]);
    } else {
      this.starterIconsCursorObj.setVisible(false);
      this.setSpecies(null);
    }
  }

  getFriendship(speciesId: number) {
    let currentFriendship = globalScene.gameData.getStarterDataEntry(speciesId).friendship;
    if (!currentFriendship || currentFriendship === undefined) {
      currentFriendship = 0;
    }

    const friendshipCap = getStarterValueFriendshipCap(speciesStarterCosts[speciesId]);

    return { currentFriendship, friendshipCap };
  }

  setSpecies(species: PokemonSpecies | null) {
    this.speciesStarterDexEntry = null;
    this.dexAttrCursor = 0n;
    this.abilityCursor = 0;
    this.natureCursor = 0;
    this.teraCursor = PokemonType.UNKNOWN;

    if (species) {
      const { dexEntry } = this.getSpeciesData(species.speciesId);
      this.speciesStarterDexEntry = dexEntry;
      this.dexAttrCursor = this.getCurrentDexProps(species.speciesId);
      this.abilityCursor = globalScene.gameData.getStarterSpeciesDefaultAbilityIndex(species);
      this.natureCursor = globalScene.gameData.getSpeciesDefaultNature(species, dexEntry);
      this.teraCursor = species.type1;
    }

    if (!species && globalScene.ui.getTooltip().visible) {
      globalScene.ui.hideTooltip();
    }

    this.pokemonAbilityText.off("pointerover");
    this.pokemonPassiveText.off("pointerover");

    const starterAttributes: StarterAttributes | null = species
      ? { ...this.starterPreferences[species.speciesId] }
      : null;

    if (starterAttributes?.nature) {
      // load default nature from stater save data, if set
      this.natureCursor = starterAttributes.nature;
    }
    if (starterAttributes?.ability && !Number.isNaN(starterAttributes.ability)) {
      // load default ability from stater save data, if set
      this.abilityCursor = starterAttributes.ability;
    }
    if (starterAttributes?.tera) {
      // load default tera from starter save data, if set
      this.teraCursor = starterAttributes.tera;
    }

    if (this.statsMode) {
      if (this.speciesStarterDexEntry?.caughtAttr) {
        this.statsContainer.setVisible(true);
        this.showStats();
      } else {
        this.statsContainer.setVisible(false);
        this.statsContainer.updateIvs(null);
      }
    }

    if (this.lastSpecies) {
      const dexAttr = this.getCurrentDexProps(this.lastSpecies.speciesId);
      const props = globalScene.gameData.getSpeciesDexAttrProps(this.lastSpecies, dexAttr);
      const speciesIndex = this.allSpecies.indexOf(this.lastSpecies);
      const lastSpeciesIcon = this.starterContainers[speciesIndex].icon;
      this.checkIconId(lastSpeciesIcon, this.lastSpecies, props.female, props.formIndex, props.shiny, props.variant);
      this.refreshShinyLabIconFx(
        lastSpeciesIcon,
        this.lastSpecies,
        props.female,
        props.formIndex,
        props.shiny,
        props.variant,
        `starter-grid-shiny-lab-icon-${this.lastSpecies.speciesId}`,
      );
      this.iconAnimHandler.addOrUpdate(lastSpeciesIcon, PokemonIconAnimMode.NONE);

      // Resume the animation for the previously selected species
      const icon = this.starterContainers[speciesIndex].icon;
      globalScene.tweens.getTweensOf(icon).forEach(tween => tween.play());
    }

    this.lastSpecies = species!; // TODO: is this bang correct?

    if (species && (this.speciesStarterDexEntry?.seenAttr || this.speciesStarterDexEntry?.caughtAttr)) {
      this.pokemonNumberText.setText(padInt(getDexNumber(species.speciesId), 4));
      if (starterAttributes?.nickname) {
        const name = decodeURIComponent(escape(atob(starterAttributes.nickname)));
        this.pokemonNameText.setText(name);
      } else {
        this.pokemonNameText.setText(species.name);
      }
      // Shiny Lab Name FX: the name adopts the equipped palette's color when Name FX is
      // unlocked + on, while viewing the shiny form (any shiny - no tier gate). Use the
      // SAME resolved display props as the detail sprite/icon - `starterAttributes.shiny`
      // is the raw pref toggle and is `undefined` for a shiny-only-caught mon that still
      // RENDERS shiny, which is why the name stayed white while the sprite was shiny.
      const displayShiny = globalScene.gameData.getSpeciesDexAttrProps(
        species,
        this.getCurrentDexProps(species.speciesId),
      ).shiny;
      const nameFxStyle = getErShinyLabNameStyleForSpecies(species.speciesId, displayShiny);
      this.pokemonNameText.setColor(nameFxStyle ? nameFxStyle.color : getTextColor(TextStyle.SUMMARY));
      this.truncateName();
      // Layer the animated SURFACE FX on the (now-truncated) name glyphs when a surface is
      // equipped + Name FX is on; the flat setColor above stays as the hidden fallback.
      this.getShinyLabNameFx().update(
        this.pokemonNameText,
        getErShinyLabSpriteFxLookForSpecies(species.speciesId, displayShiny),
      );

      if (this.speciesStarterDexEntry?.caughtAttr) {
        // ER custom species (id >= 10000) aren't pre-populated in starterColors;
        // default to white so this panel doesn't crash on undefined.
        if (!starterColors[species.speciesId]) {
          starterColors[species.speciesId] = ["ffffff", "ffffff"];
        }
        const colorScheme = starterColors[species.speciesId];

        // ER (#432): a selected Black Shiny reads its flat Luck 5 (the dex-attr
        // path only knows the regular 1-3 variant tiers). Display-only here;
        // the in-run value comes from Pokemon.getLuck()'s matching override.
        const luck = starterAttributes?.erBlackShiny
          ? 5
          : globalScene.gameData.getDexAttrLuck(this.speciesStarterDexEntry.caughtAttr);
        this.pokemonLuckText
          .setVisible(!!luck)
          .setText(luck.toString())
          .setTint(getVariantTint(Math.min(luck - 1, 2) as Variant));
        this.pokemonLuckLabelText.setVisible(this.pokemonLuckText.visible);

        //Growth translate
        let growthReadable = toTitleCase(GrowthRate[species.growthRate]);
        const growthAux = toCamelCase(growthReadable);
        if (i18next.exists("growth:" + growthAux)) {
          growthReadable = i18next.t(("growth:" + growthAux) as any);
        }
        this.pokemonGrowthRateText
          .setText(growthReadable)
          .setColor(getGrowthRateColor(species.growthRate))
          .setShadowColor(getGrowthRateColor(species.growthRate, true));
        this.pokemonGrowthRateLabelText.setVisible(true);
        this.pokemonUncaughtText.setVisible(false);
        this.pokemonAbilityLabelText.setVisible(true);
        this.pokemonPassiveLabelText.setVisible(true);
        this.pokemonNatureLabelText.setVisible(true);
        this.pokemonCaughtCountText.setText(`${this.speciesStarterDexEntry.caughtCount}`);
        if (species.speciesId === SpeciesId.MANAPHY || species.speciesId === SpeciesId.PHIONE) {
          this.pokemonHatchedIcon.setFrame("manaphy");
        } else {
          this.pokemonHatchedIcon.setFrame(getEggTierForSpecies(species));
        }
        this.pokemonHatchedCountText.setText(`${this.speciesStarterDexEntry.hatchedCount}`);

        const defaultDexAttr = this.getCurrentDexProps(species.speciesId);
        const defaultProps = globalScene.gameData.getSpeciesDexAttrProps(species, defaultDexAttr);
        const variant = defaultProps.variant;
        const tint = getVariantTint(variant);
        this.pokemonShinyIcon.setFrame(getVariantIcon(variant)).setTint(tint).setVisible(defaultProps.shiny);
        this.pokemonCaughtHatchedContainer.setVisible(true);
        this.pokemonFormText.setVisible(true);

        if (Object.hasOwn(pokemonPrevolutions, species.speciesId)) {
          this.pokemonCaughtHatchedContainer.setY(16);
          this.pokemonShinyIcon.setY(135).setFrame(getVariantIcon(variant));
          [this.pokemonCandyContainer, this.pokemonHatchedIcon, this.pokemonHatchedCountText].map(c =>
            c.setVisible(false),
          );
          this.pokemonFormText.setY(25);
        } else {
          this.pokemonCaughtHatchedContainer.setY(25);
          this.pokemonShinyIcon.setY(117);
          this.pokemonCandyIcon.setTint(argbFromRgba(rgbHexToRgba(colorScheme[0])));
          this.pokemonCandyOverlayIcon.setTint(argbFromRgba(rgbHexToRgba(colorScheme[1])));
          const starterDataEntry = globalScene.gameData.getStarterDataEntry(species.speciesId);
          this.pokemonCandyCountText.setText(`×${starterDataEntry.candyCount}`);
          updateCandyCountTextStyle(this.pokemonCandyCountText, starterDataEntry.candyCount);
          this.pokemonFormText.setY(42);
          this.pokemonHatchedIcon.setVisible(true);
          this.pokemonHatchedCountText.setVisible(true);

          const { currentFriendship, friendshipCap } = this.getFriendship(this.lastSpecies.speciesId);
          const candyCropY = 16 - 16 * (currentFriendship / friendshipCap);
          this.pokemonCandyDarknessOverlay.setCrop(0, 0, 16, candyCropY);

          this.pokemonCandyContainer
            .setVisible(true)
            .on("pointerover", () => {
              globalScene.ui.showTooltip("", `${currentFriendship}/${friendshipCap}`, true);
              this.activeTooltip = "CANDY";
            })
            .on("pointerout", () => {
              globalScene.ui.hideTooltip();
              this.activeTooltip = undefined;
            });
        }

        // Pause the animation when the species is selected
        const speciesIndex = this.allSpecies.indexOf(species);
        const icon = this.starterContainers[speciesIndex].icon;

        if (this.isUpgradeAnimationEnabled()) {
          globalScene.tweens.getTweensOf(icon).forEach(tween => tween.pause());
          // Reset the position of the icon
          icon.x = -2;
          icon.y = 2;
        }

        // Initiates the small up and down idle animation
        this.iconAnimHandler.addOrUpdate(icon, PokemonIconAnimMode.PASSIVE);

        const starterIndex = this.starterSpecies.indexOf(species);

        const props = globalScene.gameData.getSpeciesDexAttrProps(species, defaultDexAttr);

        if (starterIndex > -1) {
          const starter = this.starters[starterIndex];
          this.setSpeciesDetails(
            species,
            {
              shiny: starter.shiny,
              formIndex: starter.formIndex,
              female: starter.female,
              variant: starter.variant,
              abilityIndex: starter.abilityIndex,
              natureIndex: starter.nature,
              teraType: starter.teraType,
            },
            false,
          );
        } else {
          const defaultAbilityIndex =
            starterAttributes?.ability ?? globalScene.gameData.getStarterSpeciesDefaultAbilityIndex(species);
          // load default nature from stater save data, if set
          const { dexEntry } = this.getSpeciesData(species.speciesId);
          const defaultNature =
            starterAttributes?.nature || globalScene.gameData.getSpeciesDefaultNature(species, dexEntry);
          if (starterAttributes?.variant && !Number.isNaN(starterAttributes.variant) && props.shiny) {
            props.variant = starterAttributes.variant as Variant;
          }
          props.formIndex = starterAttributes?.form ?? props.formIndex;
          props.female = starterAttributes?.female ?? props.female;

          this.setSpeciesDetails(
            species,
            {
              shiny: props.shiny,
              formIndex: props.formIndex,
              female: props.female,
              variant: props.variant,
              abilityIndex: defaultAbilityIndex,
              natureIndex: defaultNature,
              teraType: starterAttributes?.tera,
            },
            false,
          );
        }

        if (props.formIndex != null) {
          // If switching forms while the pokemon is in the team, update its moveset
          this.updateSelectedStarterMoveset(species.speciesId);
        }

        const speciesForm = getPokemonSpeciesForm(species.speciesId, props.formIndex);
        this.setTypeIcons(speciesFormTypes(speciesForm));

        this.pokemonSprite.clearTint();
        // ER Black Shinies (#349): PREVIEW the black tier - obsidian-tint the
        // preview sprite while the black look is selected for this species
        // (the real black atlas is a battle asset; the tint is the cue here).
        if (this.starterPreferences[species.speciesId]?.erBlackShiny && props.shiny && props.variant === 2) {
          this.pokemonSprite.setTint(ER_BLACK_SHINY_TINT);
        }
        if (this.pokerusSpecies.includes(species)) {
          handleTutorial(Tutorial.POKERUS);
        }
      } else {
        this.pokemonGrowthRateText.setText("");
        this.pokemonGrowthRateLabelText.setVisible(false);
        this.setTypeIcons([]);
        this.pokemonLuckLabelText.setVisible(false);
        this.pokemonLuckText.setVisible(false);
        this.pokemonShinyIcon.setVisible(false);
        this.pokemonUncaughtText.setVisible(true);
        this.pokemonAbilityLabelText.setVisible(false);
        this.pokemonPassiveLabelText.setVisible(false);
        this.pokemonNatureLabelText.setVisible(false);
        this.pokemonCaughtHatchedContainer.setVisible(false);
        this.pokemonCandyContainer.setVisible(false);
        this.pokemonFormText.setVisible(false);
        this.teraIcon.setVisible(false);

        const defaultDexAttr = globalScene.gameData.getSpeciesDefaultDexAttr(species, true, true);
        const defaultAbilityIndex = globalScene.gameData.getStarterSpeciesDefaultAbilityIndex(species);
        const defaultNature = globalScene.gameData.getSpeciesDefaultNature(species);
        const props = globalScene.gameData.getSpeciesDexAttrProps(species, defaultDexAttr);

        this.setSpeciesDetails(
          species,
          {
            shiny: props.shiny,
            formIndex: props.formIndex,
            female: props.female,
            variant: props.variant,
            abilityIndex: defaultAbilityIndex,
            natureIndex: defaultNature,
            forSeen: true,
          },
          false,
        );
        this.pokemonSprite.setTint(0x808080);
      }
    } else {
      this.pokemonNumberText.setText(padInt(0, 4));
      this.pokemonNameText.setText(species ? "???" : "");
      this.shinyLabNameFx?.clear();
      this.pokemonGrowthRateText.setText("");
      this.pokemonGrowthRateLabelText.setVisible(false);
      this.setTypeIcons([]);
      this.pokemonLuckLabelText.setVisible(false);
      this.pokemonLuckText.setVisible(false);
      this.pokemonShinyIcon.setVisible(false);
      this.pokemonUncaughtText.setVisible(!!species);
      this.pokemonAbilityLabelText.setVisible(false);
      this.pokemonPassiveLabelText.setVisible(false);
      this.pokemonNatureLabelText.setVisible(false);
      this.pokemonCaughtHatchedContainer.setVisible(false);
      this.pokemonCandyContainer.setVisible(false);
      this.pokemonFormText.setVisible(false);
      this.teraIcon.setVisible(false);

      this.setSpeciesDetails(
        species!,
        {
          // TODO: is this bang correct?
          shiny: false,
          formIndex: 0,
          female: false,
          variant: 0,
          abilityIndex: 0,
          natureIndex: 0,
        },
        false,
      );
      this.pokemonSprite.clearTint();
    }
  }

  /**
   * Drive the previewed Pokémon sprite to match the current cursor selection.
   *
   * - Plays an already-cached sprite IMMEDIATELY (instant feedback while
   *   scrolling through owned mons).
   * - Loads an uncached sprite with a strict SINGLE-FLIGHT guard: only one
   *   `loadAssets` runs at a time. When it resolves we call ourselves again,
   *   which recomputes the CURRENT cursor selection (latest-wins) and either
   *   plays it (now cached) or kicks the next load. Species merely scrolled past
   *   while a load was in flight are never fetched — the chain jumps straight to
   *   wherever the cursor ended up.
   *
   * This caps concurrent preview loads at 1. The dev server degrades sharply
   * under concurrency (≈20ms solo vs ≈2000ms with a dozen in flight), so the old
   * uncapped per-selection loads piled up and froze the preview on a previous
   * Pokémon; serialising them keeps every load fast and the preview converging.
   */
  private refreshShinyLabIconFx(
    icon: Phaser.GameObjects.Sprite,
    species: PokemonSpecies,
    female: boolean,
    formIndex: number,
    shiny: boolean,
    variant: number,
    keyPrefix: string,
    restoreSourceOnClear = true,
  ): void {
    const look = getErShinyLabSpriteFxLookForSpecies(species.speciesId, shiny);
    if (!hasErShinyLabAnySpriteFx(look)) {
      clearErShinyLabSpriteFxTexture(icon, restoreSourceOnClear);
      return;
    }
    const source = getErShinyLabSpeciesIconSource(species, female, formIndex, shiny, variant as Variant, look);
    const baseState = erShinyLabSpriteFxStateKey(source, look);
    const exactFx = hasErShinyLabExactSpriteFx(look);
    applyErShinyLabSpriteFxTexture(icon, look, {
      source,
      keyPrefix,
      time: this.shinyLabFxTick / 10,
      state: exactFx ? `${baseState}|${this.shinyLabFxTick}` : baseState,
      renderPad: ER_SHINY_LAB_MINI_ICON_RENDER_PAD,
    });
  }

  private resetStarterIconSlot(index: number): void {
    const icon = this.starterIcons[index];
    clearErShinyLabSpriteFxTexture(icon, false);
    icon.setTexture("pokemon_icons_0").setFrame("unknown");
  }

  private refreshVisibleShinyLabIconFx(): void {
    for (const container of this.filteredStarterContainers) {
      if (!container.visible) {
        continue;
      }
      const currentDexAttr = this.getCurrentDexProps(container.species.speciesId);
      const props = globalScene.gameData.getSpeciesDexAttrProps(container.species, currentDexAttr);
      this.refreshShinyLabIconFx(
        container.icon,
        container.species,
        props.female,
        props.formIndex,
        props.shiny,
        props.variant,
        `starter-grid-shiny-lab-icon-${container.species.speciesId}`,
      );
    }
    for (let i = 0; i < this.starterSpecies.length; i++) {
      const species = this.starterSpecies[i];
      const currentDexAttr = this.getCurrentDexProps(species.speciesId);
      const props = globalScene.gameData.getSpeciesDexAttrProps(species, currentDexAttr);
      this.refreshShinyLabIconFx(
        this.starterIcons[i],
        species,
        props.female,
        props.formIndex,
        props.shiny,
        props.variant,
        `starter-party-shiny-lab-icon-${i}-${species.speciesId}`,
      );
    }
    for (let i = this.starterSpecies.length; i < this.starterIcons.length; i++) {
      this.resetStarterIconSlot(i);
    }
  }

  private getStarterShinyLabPreview(
    speciesId: number,
  ): { loadout: ErShinyLabLoadout; params: ErShinyLabParams } | null {
    const save = globalScene.gameData.getStarterDataEntry(speciesId).erShinyLab;
    if (!save) {
      return null;
    }
    const owned = {
      palette: getErShinyLabOwnedSet(save, "palette"),
      surface: getErShinyLabOwnedSet(save, "surface"),
      around: getErShinyLabOwnedSet(save, "around"),
    };
    const loadout = sanitizeErShinyLabLoadout(decodeErShinyLabLoadout(save.l), owned);
    if (!loadout.palette && !loadout.surface && !loadout.around) {
      return null;
    }
    return { loadout, params: decodeErShinyLabParams(save.q) };
  }

  private hasExactShinyLabFx(loadout: ErShinyLabLoadout | null | undefined): boolean {
    return !!(loadout?.surface || loadout?.around);
  }

  private shinyLabPreviewStateKey(
    spriteKey: string,
    loadout: ErShinyLabLoadout | null | undefined,
    params: ErShinyLabParams | null | undefined,
  ): string {
    if (!loadout || !params) {
      return spriteKey;
    }
    return [
      spriteKey,
      loadout.palette ?? "",
      loadout.surface ?? "",
      loadout.around ?? "",
      params.palAmt,
      params.surfAmt,
      params.aroAmt,
      params.scale,
      params.seed,
      params.tintMode,
    ].join("|");
  }

  private readShinyLabSourcePixels(
    key: string,
    sourceFrame?: Phaser.Textures.Frame | null,
  ): ErShinyLabSourcePixels | null {
    return readErShinyLabSpriteSourcePixels(sourceFrame?.name == null ? { key } : { key, frame: sourceFrame.name });
  }

  private applyShinyLabFxTexture(rendered: ErShinyLabRenderedPixels): boolean {
    try {
      if (typeof document === "undefined") {
        return false;
      }
      const textures = globalScene.textures as Phaser.Textures.TextureManager & {
        addCanvas?: (key: string, canvas: HTMLCanvasElement) => Phaser.Textures.CanvasTexture | null;
        remove?: (key: string) => unknown;
      };
      if (!textures.addCanvas) {
        return false;
      }

      const canvas = document.createElement("canvas");
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return false;
      }
      const image = ctx.createImageData(rendered.width, rendered.height);
      image.data.set(rendered.data);
      ctx.putImageData(image, 0, 0);

      const oldKey = this.shinyLabFxKey;
      let key: string;
      do {
        key = `starter-shiny-lab-fx-${++this.shinyLabFxVersion}`;
      } while (textures.exists(key));
      const texture = textures.addCanvas(key, canvas);
      texture?.refresh();
      this.shinyLabFxKey = key;
      this.shinyLabFxSprite
        .setTexture(key)
        .setPosition(this.pokemonSprite.x, this.pokemonSprite.y)
        .setScale(this.pokemonSprite.scaleX || 1)
        .setVisible(!this.statsMode);
      if (oldKey && oldKey !== key && textures.exists(oldKey)) {
        textures.remove?.(oldKey);
      }
      return true;
    } catch {
      return false;
    }
  }

  private hideShinyLabFxPreview(showBase = true): void {
    this.shinyLabFxSprite?.setVisible(false);
    if (this.shinyLabFxKey) {
      try {
        const textures = globalScene.textures as Phaser.Textures.TextureManager & { remove?: (key: string) => unknown };
        if (textures.exists(this.shinyLabFxKey)) {
          textures.remove?.(this.shinyLabFxKey);
        }
      } catch {}
      this.shinyLabFxKey = null;
    }
    if (showBase && !this.statsMode) {
      this.pokemonSprite?.setVisible(true);
    }
  }

  private refreshShinyLabFxPreview(spriteKey: string, loadout: ErShinyLabLoadout, params: ErShinyLabParams): boolean {
    const source = this.readShinyLabSourcePixels(spriteKey, this.pokemonSprite.frame);
    if (!source) {
      return false;
    }
    const rendered = renderErShinyLabLook(source, loadout, params, this.shinyLabFxTick / 10);
    if (!rendered) {
      return false;
    }
    return this.applyShinyLabFxTexture(rendered);
  }

  private refreshAnimatedShinyLabFxPreview(): void {
    const species = this.lastSpecies;
    const spriteKey = this.pokemonSprite.pipelineData["textureKey"] as string | undefined;
    if (!species || !spriteKey || !globalScene.textures.exists(spriteKey)) {
      this.hideShinyLabFxPreview();
      return;
    }
    const props = globalScene.gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(species.speciesId));
    const labPreview = props.shiny ? this.getStarterShinyLabPreview(species.speciesId) : null;
    if (!labPreview || !this.hasExactShinyLabFx(labPreview.loadout)) {
      this.hideShinyLabFxPreview();
      return;
    }
    if (this.refreshShinyLabFxPreview(spriteKey, labPreview.loadout, labPreview.params)) {
      this.pokemonSprite.setVisible(false);
    } else {
      this.hideShinyLabFxPreview();
    }
  }

  private refreshPreviewSprite(): void {
    const species = this.lastSpecies;
    if (!species || this.statsMode || !this.starterSelectContainer.visible) {
      return;
    }
    const dexEntry = this.getSpeciesData(species.speciesId).dexEntry;
    if (!dexEntry?.caughtAttr && !dexEntry?.seenAttr) {
      return; // nothing shown for a fully-unseen species
    }
    const props = globalScene.gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(species.speciesId));
    const female = props.female ?? false;
    // Showdown (B7 item 1): when the line has a picked Field Stage (evolution / mega), the
    // big preview shows THAT stage's species + form, not the base. The shiny/variant/female
    // cosmetics still come from the root pick, and the Shiny Lab look stays keyed on the ROOT
    // (its custom-shiny palette is per-line), so the picked stage still renders shiny-tinted.
    // No-op in every non-showdown mode (renderSpecies === species, renderFormIndex === props).
    const renderStage = this.showdownRenderStage(species.speciesId);
    const renderSpecies = renderStage?.species ?? species;
    const renderFormIndex = renderStage?.formIndex ?? props.formIndex;
    const labPreview = props.shiny ? this.getStarterShinyLabPreview(species.speciesId) : null;
    const labPaletteId = props.shiny
      ? (labPreview?.loadout.palette ?? getErShinyLabPaletteIdForSpecies(species.speciesId))
      : null;
    const hasExactLabFx = this.hasExactShinyLabFx(labPreview?.loadout);
    const labPaletteVariant: Variant = 0;
    const textureShiny = labPaletteId ? false : props.shiny;
    const textureVariant = labPaletteId ? labPaletteVariant : props.variant;
    const spriteKey = renderSpecies.getSpriteKey(female, renderFormIndex, textureShiny, textureVariant);
    const initialLabCacheKey = labPaletteId
      ? ensureErShinyLabPaletteVariantCache(spriteKey, labPaletteId, labPaletteVariant)
      : null;
    const initialShaderSpriteKey = initialLabCacheKey ?? spriteKey;
    const initialStateKey = hasExactLabFx
      ? this.shinyLabPreviewStateKey(spriteKey, labPreview?.loadout, labPreview?.params)
      : `${spriteKey}|${initialShaderSpriteKey}|${labPaletteId ?? ""}`;
    if (
      this.pokemonSprite.pipelineData["previewStateKey"] === initialStateKey
      && (!hasExactLabFx || this.shinyLabFxSprite.visible)
    ) {
      return; // already showing the right sprite
    }
    if (globalScene.textures.exists(spriteKey)) {
      // ER: loadAssets' finalize can settle (via its safety backstop) BEFORE it
      // builds the single-frame anim for a redirected ER form sprite (mega/primal/
      // costume), leaving "Missing animation: pkmn__er__<slug>" and the BASE sprite
      // shown in the preview. The atlas texture IS present, so gap-fill the anim
      // here (same pattern as the battle-side rebuild in pokemon.ts) then play it.
      ensureErSpriteAnim(spriteKey);
      const labCacheKey = labPaletteId
        ? ensureErShinyLabPaletteVariantCache(spriteKey, labPaletteId, labPaletteVariant)
        : null;
      if (globalScene.anims.exists(spriteKey) && (!labPaletteId || labCacheKey)) {
        const shaderSpriteKey = labCacheKey ?? spriteKey;
        this.speciesLoaded.set(renderSpecies.speciesId, true);
        this.pokemonSprite
          .play(spriteKey)
          .setPipelineData("shiny", labPaletteId ? true : props.shiny)
          .setPipelineData("variant", labPaletteId ? labPaletteVariant : props.variant)
          .setPipelineData("spriteKey", shaderSpriteKey)
          .setPipelineData("textureKey", spriteKey)
          .setPipelineData("previewStateKey", initialStateKey)
          .setVisible(!this.statsMode);
        if (
          hasExactLabFx
          && labPreview
          && this.refreshShinyLabFxPreview(spriteKey, labPreview.loadout, labPreview.params)
        ) {
          this.pokemonSprite.setVisible(false);
        } else {
          this.hideShinyLabFxPreview(false);
        }
        return;
      }
    }
    if ((this.spriteLoadAttempts.get(spriteKey) ?? 0) >= StarterSelectUiHandler.MAX_SPRITE_LOAD_ATTEMPTS) {
      return; // this sprite won't load — stop retrying so the preview doesn't freeze
    }
    if (this.spriteLoadInFlight) {
      return; // a load is running; its completion re-drives to the current cursor
    }
    this.spriteLoadInFlight = true;
    this.spriteLoadAttempts.set(spriteKey, (this.spriteLoadAttempts.get(spriteKey) ?? 0) + 1);
    renderSpecies
      // spriteOnly: ER customs have no cry, and vanilla cries aren't needed in
      // the preview — skipping audio is what keeps the loader from piling up.
      // ER-custom species route through ErCustomSpecies.loadAssets here (its
      // `_shiny`/`_shiny2`/`_shiny3` paths), so all custom sprites still load.
      .loadAssets(female, renderFormIndex, textureShiny, textureVariant, true, false, true)
      .catch(() => {})
      .then(() => {
        this.spriteLoadInFlight = false;
        const labCacheKey = labPaletteId
          ? ensureErShinyLabPaletteVariantCache(spriteKey, labPaletteId, labPaletteVariant)
          : null;
        if (
          globalScene.textures.exists(spriteKey)
          && globalScene.anims.exists(spriteKey)
          && (!labPaletteId || labCacheKey)
        ) {
          this.spriteLoadAttempts.delete(spriteKey); // landed — clear the counter
        }
        // Re-drive: play this sprite if the cursor is still on it, otherwise kick
        // the load for wherever the cursor has since moved (single-flight chain).
        this.refreshPreviewSprite();
      });
  }

  /**
   * Background pre-warmer: while the cursor is idle, load ONE uncached visible-grid
   * preview sprite into the texture cache so that scrolling onto it later is an
   * instant cache hit (the big vanilla animation atlases otherwise cost 1–3s on
   * first encounter on the dev server). Shares {@link spriteLoadInFlight} with the
   * cursor load, so it never runs concurrently with — or delays — the cursor's own
   * sprite, and the idle gate means it never fires mid-scroll. Runs one sprite per
   * tick; its completion re-drives {@link refreshPreviewSprite} so the cursor keeps
   * priority.
   */
  private prewarmVisibleSprites(): void {
    if (
      this.spritePrewarmInFlight
      || this.statsMode
      || !this.starterSelectContainer.visible
      || globalScene.time.now - this.lastSpriteSelectionTime < StarterSelectUiHandler.SPRITE_PREWARM_IDLE_MS
    ) {
      return; // a warm-up is running, not idle long enough, or screen not active
    }
    const maxColumns = 9;
    const maxRows = 9;
    const first = this.scrollCursor * maxColumns;
    const last = Math.min(this.filteredStarterContainers.length - 1, first + maxRows * maxColumns - 1);
    for (let i = first; i <= last; i++) {
      const species = this.filteredStarterContainers[i]?.species;
      if (!species) {
        continue;
      }
      const dexEntry = this.getSpeciesData(species.speciesId).dexEntry;
      if (!dexEntry?.caughtAttr && !dexEntry?.seenAttr) {
        continue;
      }
      const props = globalScene.gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(species.speciesId));
      const female = props.female ?? false;
      const spriteKey = species.getSpriteKey(female, props.formIndex, props.shiny, props.variant);
      if (globalScene.textures.exists(spriteKey) && globalScene.anims.exists(spriteKey)) {
        continue; // already warm
      }
      if ((this.spriteLoadAttempts.get(spriteKey) ?? 0) >= StarterSelectUiHandler.MAX_SPRITE_LOAD_ATTEMPTS) {
        continue; // gave up on this one
      }
      // Warm exactly the key the cursor would request (same dex props), in the
      // prewarm slot — concurrent with, never blocking, the cursor's own load.
      this.spritePrewarmInFlight = true;
      this.spriteLoadAttempts.set(spriteKey, (this.spriteLoadAttempts.get(spriteKey) ?? 0) + 1);
      species
        .loadAssets(female, props.formIndex, props.shiny, props.variant, true, false, true)
        .catch(() => {})
        .then(() => {
          this.spritePrewarmInFlight = false;
          if (globalScene.textures.exists(spriteKey) && globalScene.anims.exists(spriteKey)) {
            this.spriteLoadAttempts.delete(spriteKey);
          }
          // If the player landed on an uncached sprite while this was warming,
          // service it now (the cursor's own slot handles it).
          this.refreshPreviewSprite();
        });
      return; // one sprite per tick
    }
  }

  getSpeciesData(
    speciesId: SpeciesId,
    applyChallenge = true,
  ): { dexEntry: DexEntry; starterDataEntry: StarterDataEntry } {
    const dexEntry = globalScene.gameData.dexData[speciesId];
    const starterDataEntry = globalScene.gameData.getStarterDataEntry(speciesId);

    // Unpacking to make a copy by values, not references
    const copiedDexEntry = { ...dexEntry };
    copiedDexEntry.ivs = [...dexEntry.ivs];
    const copiedStarterDataEntry = { ...starterDataEntry };
    if (applyChallenge) {
      applyChallenges(ChallengeType.STARTER_SELECT_MODIFY, speciesId, copiedDexEntry, copiedStarterDataEntry);
    }
    return { dexEntry: { ...copiedDexEntry }, starterDataEntry: { ...copiedStarterDataEntry } };
  }

  /**
   * Render the 3 ER passive slots in the species info panel.
   *
   * - Slot 1 reuses the legacy `pokemonPassiveText` / `pokemonPassiveDisabledIcon`
   *   / `pokemonPassiveLockedIcon` so the vanilla single-passive layout is bit-
   *   for-bit preserved.
   * - Slots 2/3 reuse `pokemonPassiveSlotTexts[0..1]` and their matching icons.
   * - Vanilla species (`getPassiveAbility()` populated only) collapse slots 2/3
   *   to a gray "—" placeholder rather than hiding them entirely — the layout
   *   stays stable across species.
   *
   * Visual states per slot:
   *   - LOCKED     → gray text, `icon_lock` to the right of the ability name
   *   - UNLOCKED + DISABLED → gray text @ 0.5 alpha, `icon_stop` to the right
   *   - UNLOCKED + ENABLED  → SUMMARY_ALT text (full color)
   *   - Empty (NONE)        → "—" placeholder, no icons
   */
  private renderPassiveSlots(passiveAttr: number, formIndex: number | undefined, isFreshStartChallenge: boolean): void {
    if (!this.lastSpecies) {
      return;
    }
    // Showdown (staging fix 2026-07-07): the passive SLOTS follow the picked field stage too
    // (item 15) - the fielded species' passive set is what battles. Identity off-showdown.
    const stage = globalScene.gameMode.isShowdown ? this.showdownRenderStage(this.lastSpecies.speciesId) : null;
    const passiveSpecies = stage?.species ?? this.lastSpecies;
    const passiveFormIndex = stage ? stage.formIndex : formIndex;
    const passiveAbilityIds = passiveSpecies.getPassiveAbilities(passiveFormIndex);
    // All 3 slot text objects: slot 0 = legacy `pokemonPassiveText`, slots 1-2 = new.
    const slotTexts: [Phaser.GameObjects.Text, Phaser.GameObjects.Text, Phaser.GameObjects.Text] = [
      this.pokemonPassiveText,
      this.pokemonPassiveSlotTexts[0],
      this.pokemonPassiveSlotTexts[1],
    ];
    const slotDisabledIcons: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite] = [
      this.pokemonPassiveDisabledIcon,
      this.pokemonPassiveSlotDisabledIcons[0],
      this.pokemonPassiveSlotDisabledIcons[1],
    ];
    const slotLockedIcons: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite] = [
      this.pokemonPassiveLockedIcon,
      this.pokemonPassiveSlotLockedIcons[0],
      this.pokemonPassiveSlotLockedIcons[1],
    ];

    // Always clear old pointer handlers on slot 0 (vanilla path). Slots 1/2 also
    // get fresh handlers each render — `off("pointerover")` is invoked in
    // setCursor so we don't need to clear them here.
    this.pokemonPassiveText.off("pointerover");
    this.pokemonPassiveText.off("pointerout");
    for (const slotText of this.pokemonPassiveSlotTexts) {
      slotText.off("pointerover");
      slotText.off("pointerout");
    }

    for (let slot = 0; slot < 3; slot++) {
      const slotIndex = slot as PassiveSlot;
      const text = slotTexts[slot];
      const disabledIcon = slotDisabledIcons[slot];
      const lockedIcon = slotLockedIcons[slot];
      const abilityId = passiveAbilityIds[slot];

      // Treat a missing `allAbilities` entry the same as NONE: an ER-custom
      // passive id can map (via ER_ID_MAP) to the custom range without a
      // registered ability, which would otherwise crash on `ability.name`
      // below. Render the faint "—" placeholder instead of black-screening.
      if (abilityId === AbilityId.NONE || !allAbilities[abilityId]) {
        // Empty slot — render a faint "—" placeholder so the layout stays
        // visually consistent across vanilla (1 passive) and ER (3 passives).
        text
          .setVisible(!isFreshStartChallenge)
          .setText("—")
          .setColor(getTextColor(TextStyle.SUMMARY_GRAY))
          .setAlpha(0.35)
          .setShadowColor(getTextColor(TextStyle.SUMMARY_GRAY, true));
        disabledIcon.setVisible(false);
        lockedIcon.setVisible(false);
        continue;
      }

      const ability = allAbilities[abilityId];
      // ER (#381): a TRUANT innate is a NERF - always unlocked and enabled
      // for free, never behind a candy purchase.
      const isFreeNerf = abilityId === AbilityId.TRUANT;
      const isUnlocked = isFreeNerf || isSlotUnlocked(passiveAttr, slotIndex);
      const isEnabled = isFreeNerf || isSlotEnabled(passiveAttr, slotIndex);

      const textStyle = isUnlocked && isEnabled ? TextStyle.SUMMARY_ALT : TextStyle.SUMMARY_GRAY;
      const textAlpha = isUnlocked && isEnabled ? 1 : 0.5;

      text
        .setVisible(!isFreshStartChallenge)
        .setText(ability.name)
        .setColor(getTextColor(textStyle))
        .setAlpha(textAlpha)
        .setShadowColor(getTextColor(textStyle, true));

      // Tooltip handlers — slot 0 keeps the legacy `"PASSIVE"` activeTooltip
      // sentinel so editTooltip wiring elsewhere continues to work; slots 1/2
      // use the same sentinel because only one tooltip is ever visible at a time.
      if (text.visible) {
        text.on("pointerover", () => {
          globalScene.ui.showTooltip(`${ability.name}`, `${ability.description}`, true);
          this.activeTooltip = "PASSIVE";
        });
        text.on("pointerout", () => {
          globalScene.ui.hideTooltip();
          this.activeTooltip = undefined;
        });
      }

      const iconPosition = {
        x: text.x + text.displayWidth + 1,
        y: text.y + text.displayHeight / 2,
      };
      disabledIcon
        .setVisible(isUnlocked && !isEnabled && !isFreshStartChallenge)
        .setPosition(iconPosition.x, iconPosition.y);
      lockedIcon.setVisible(!isUnlocked && !isFreshStartChallenge).setPosition(iconPosition.x, iconPosition.y);
    }

    // If a PASSIVE tooltip is currently active, refresh its content to point at
    // slot 1 (legacy behavior — slots 2/3 don't drive editTooltip). Guard a
    // missing `allAbilities` entry (ER-custom id without a registered ability)
    // so a stale-tooltip refresh never crashes on `.name`.
    if (this.activeTooltip === "PASSIVE" && passiveAbilityIds[0] !== AbilityId.NONE) {
      const slot0Ability = allAbilities[passiveAbilityIds[0]];
      if (slot0Ability) {
        globalScene.ui.editTooltip(`${slot0Ability.name}`, `${slot0Ability.description}`);
      }
    }
  }

  setSpeciesDetails(species: PokemonSpecies, options: SpeciesDetails = {}, save = true): void {
    let { shiny, formIndex, female, variant, abilityIndex, natureIndex, teraType } = options;
    const forSeen: boolean = options.forSeen ?? false;
    const oldProps = species ? globalScene.gameData.getSpeciesDexAttrProps(species, this.dexAttrCursor) : null;
    const oldAbilityIndex =
      this.abilityCursor > -1 ? this.abilityCursor : globalScene.gameData.getStarterSpeciesDefaultAbilityIndex(species);
    let oldNatureIndex = -1;
    if (species) {
      const { dexEntry } = this.getSpeciesData(species.speciesId);
      oldNatureIndex =
        this.natureCursor > -1 ? this.natureCursor : globalScene.gameData.getSpeciesDefaultNature(species, dexEntry);
    }
    const oldTeraType = this.teraCursor > -1 ? this.teraCursor : species ? species.type1 : PokemonType.UNKNOWN;
    this.dexAttrCursor = 0n;
    this.abilityCursor = -1;
    this.natureCursor = -1;
    this.teraCursor = PokemonType.UNKNOWN;

    const isFreshStartChallenge = globalScene.gameMode.hasChallenge(Challenges.FRESH_START);

    if (this.activeTooltip === "CANDY") {
      if (this.lastSpecies && this.pokemonCandyContainer.visible) {
        const { currentFriendship, friendshipCap } = this.getFriendship(this.lastSpecies.speciesId);
        globalScene.ui.editTooltip("", `${currentFriendship}/${friendshipCap}`);
      } else {
        globalScene.ui.hideTooltip();
      }
    }

    if (species?.forms?.find(f => f.formKey === "female")) {
      if (female !== undefined) {
        formIndex = female ? 1 : 0;
      } else if (formIndex !== undefined) {
        female = formIndex === 1;
      }
    }

    if (species) {
      this.dexAttrCursor |= (shiny === undefined ? !(shiny = oldProps?.shiny) : !shiny)
        ? DexAttr.NON_SHINY
        : DexAttr.SHINY;
      this.dexAttrCursor |= (female === undefined ? !(female = oldProps?.female) : !female)
        ? DexAttr.MALE
        : DexAttr.FEMALE;
      this.dexAttrCursor |= (variant === undefined ? !(variant = oldProps?.variant) : !variant)
        ? DexAttr.DEFAULT_VARIANT
        : variant === 1
          ? DexAttr.VARIANT_2
          : DexAttr.VARIANT_3;
      this.dexAttrCursor |= globalScene.gameData.getFormAttr(
        formIndex === undefined ? (formIndex = oldProps!.formIndex) : formIndex,
      ); // TODO: is this bang correct?
      this.abilityCursor = abilityIndex === undefined ? (abilityIndex = oldAbilityIndex) : abilityIndex;
      this.natureCursor = natureIndex === undefined ? (natureIndex = oldNatureIndex) : natureIndex;
      this.teraCursor = teraType == null ? (teraType = oldTeraType) : teraType;
      const [isInParty, partyIndex]: [boolean, number] = this.isInParty(species); // we use this to firstly check if the pokemon is in the party, and if so, to get the party index in order to update the icon image
      if (isInParty) {
        this.updatePartyIcon(species, partyIndex);
      }
    }

    if (!(species && (forSeen ? this.speciesStarterDexEntry?.seenAttr : this.speciesStarterDexEntry?.caughtAttr))) {
      this.pokemonSprite.setVisible(false);
    }
    this.pokemonPassiveLabelText.setVisible(false);
    this.pokemonPassiveText.setVisible(false);
    this.pokemonPassiveDisabledIcon.setVisible(false);
    this.pokemonPassiveLockedIcon.setVisible(false);
    for (const slotText of this.pokemonPassiveSlotTexts) {
      slotText.setVisible(false).setText("");
    }
    for (const slotIcon of this.pokemonPassiveSlotDisabledIcons) {
      slotIcon.setVisible(false);
    }
    for (const slotIcon of this.pokemonPassiveSlotLockedIcons) {
      slotIcon.setVisible(false);
    }
    this.teraIcon.setVisible(false);

    if (this.assetLoadCancelled) {
      this.assetLoadCancelled.value = true;
      this.assetLoadCancelled = null;
    }

    this.starterMoveset = null;
    this.speciesStarterMoves = [];

    if (species) {
      const { dexEntry, starterDataEntry } = this.getSpeciesData(species.speciesId);
      const caughtAttr = dexEntry.caughtAttr || BigInt(0);
      const abilityAttr = starterDataEntry.abilityAttr;

      if (!caughtAttr) {
        const props = globalScene.gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(species.speciesId));
        const defaultAbilityIndex = globalScene.gameData.getStarterSpeciesDefaultAbilityIndex(species);
        const defaultNature = globalScene.gameData.getSpeciesDefaultNature(species, dexEntry);

        if (shiny === undefined || shiny !== props.shiny) {
          shiny = props.shiny;
        }
        if (formIndex === undefined || formIndex !== props.formIndex) {
          formIndex = props.formIndex;
        }
        if (female === undefined || female !== props.female) {
          female = props.female;
        }
        if (variant === undefined || variant !== props.variant) {
          variant = props.variant;
        }
        if (abilityIndex === undefined || abilityIndex !== defaultAbilityIndex) {
          abilityIndex = defaultAbilityIndex;
        }
        if (natureIndex === undefined || natureIndex !== defaultNature) {
          natureIndex = defaultNature;
        }
      }

      this.shinyOverlay.setVisible(shiny ?? false); // TODO: is false the correct default?
      this.pokemonNumberText.setColor(
        getTextColor(shiny ? TextStyle.SUMMARY_DEX_NUM_GOLD : TextStyle.SUMMARY_DEX_NUM, false),
      );
      this.pokemonNumberText.setShadowColor(
        getTextColor(shiny ? TextStyle.SUMMARY_DEX_NUM_GOLD : TextStyle.SUMMARY_DEX_NUM, true),
      );

      if (forSeen ? this.speciesStarterDexEntry?.seenAttr : this.speciesStarterDexEntry?.caughtAttr) {
        const starterIndex = this.starterSpecies.indexOf(species);

        if (starterIndex > -1) {
          const starter = this.starters[starterIndex];
          const props = globalScene.gameData.getSpeciesDexAttrProps(species, this.dexAttrCursor);
          starter.shiny = props.shiny;
          starter.variant = props.variant;
          starter.female = props.female;
          starter.formIndex = props.formIndex;
          starter.abilityIndex = this.abilityCursor;
          starter.nature = this.natureCursor;
          starter.teraType = this.teraCursor;
        }

        female ??= false;
        // Drive the preview sprite through the single-flight refresher: it plays
        // cached sprites instantly and serialises uncached loads (latest-wins) so
        // scrolling can never pile up concurrent loads and freeze the preview.
        this.lastSpriteSelectionTime = globalScene.time.now; // gate the idle pre-warmer
        this.refreshPreviewSprite();

        const currentFilteredContainer = this.filteredStarterContainers.find(
          p => p.species.speciesId === species.speciesId,
        );
        if (currentFilteredContainer) {
          const starterSprite = currentFilteredContainer.icon as Phaser.GameObjects.Sprite;
          starterSprite.setTexture(
            species.getIconAtlasKey(formIndex, shiny, variant),
            species.getIconId(female, formIndex, shiny, variant),
          );
          currentFilteredContainer.checkIconId(female, formIndex, shiny, variant);
          this.refreshShinyLabIconFx(
            starterSprite,
            currentFilteredContainer.species,
            female,
            formIndex ?? 0,
            shiny ?? false,
            variant ?? 0,
            `starter-grid-shiny-lab-icon-${currentFilteredContainer.species.speciesId}`,
            false,
          );
        }

        const isNonShinyCaught = !!(caughtAttr & DexAttr.NON_SHINY);
        const isShinyCaught = !!(caughtAttr & DexAttr.SHINY);

        const caughtVariants = [DexAttr.DEFAULT_VARIANT, DexAttr.VARIANT_2, DexAttr.VARIANT_3].filter(
          v => caughtAttr & v,
        );
        this.canCycleShiny = (isNonShinyCaught && isShinyCaught) || (isShinyCaught && caughtVariants.length > 1);

        const isMaleCaught = !!(caughtAttr & DexAttr.MALE);
        const isFemaleCaught = !!(caughtAttr & DexAttr.FEMALE);
        this.canCycleGender = isMaleCaught && isFemaleCaught;

        const hasAbility1 = abilityAttr & AbilityAttr.ABILITY_1;
        let hasAbility2 = abilityAttr & AbilityAttr.ABILITY_2;
        const hasHiddenAbility = abilityAttr & AbilityAttr.ABILITY_HIDDEN;

        /*
         * Check for Pokemon with a single ability (at some point it was possible to catch them with their ability 2 attribute)
         * This prevents cycling between ability 1 and 2 if they are both unlocked and the same
         * but we still need to account for the possibility ability 1 was never unlocked and fallback on ability 2 in this case
         */
        if (hasAbility1 && hasAbility2 && species.ability1 === species.ability2) {
          hasAbility2 = 0;
        }

        this.canCycleAbility = [hasAbility1, hasAbility2, hasHiddenAbility].filter(a => a).length > 1;

        this.canCycleForm =
          species.forms
            .filter(f => f.isStarterSelectable || !pokemonFormChanges[species.speciesId]?.find(fc => fc.formKey))
            .map((_, f) => dexEntry.caughtAttr & globalScene.gameData.getFormAttr(f))
            .filter(f => f).length > 1;
        this.canCycleNature = globalScene.gameData.getNaturesForAttr(dexEntry.natureAttr).length > 1;
        this.canCycleTera =
          !this.statsMode
          && this.allowTera
          && getPokemonSpeciesForm(species.speciesId, formIndex ?? 0).type2 != null
          && !globalScene.gameMode.hasChallenge(Challenges.FRESH_START);
      }

      if (dexEntry.caughtAttr && species.malePercent !== null) {
        const gender = female ? Gender.FEMALE : Gender.MALE;
        this.pokemonGenderText
          .setText(getGenderSymbol(gender))
          .setColor(getGenderColor(gender))
          .setShadowColor(getGenderColor(gender, true));
      } else {
        this.pokemonGenderText.setText("");
      }

      if (dexEntry.caughtAttr) {
        // Resolve the ability via the active form, guarding two ER-custom edge
        // cases that black-screened the scene (same class as #113/#114/#139):
        //   1. `formIndex` out of range for `forms` — e.g. Floette Eternal
        //      Flower (an ER custom whose injected mega makes forms.length 2)
        //      or vanilla Mimikyu's Busted form, when an imported/stale dexAttr
        //      yields a formIndex >= forms.length. `forms[formIndex]` was then
        //      undefined and `.getAbility` threw. Fall back to the base species
        //      (mirrors getPokemonSpeciesForm's out-of-range behavior).
        //   2. The resolved AbilityId having no `allAbilities` entry. Fall back
        //      to AbilityId.NONE (the "—" entry) so `.name` never crashes.
        // Showdown (B7 item 15): when a Field Stage is picked, the ability + form-dependent detail
        // fields (types, form name) DISPLAY the FIELDED form's data - the picked abilityIndex is
        // mapped onto the FIELDED species' ability list, exactly what battle-time fielding does.
        // Unlock/cycle semantics stay ROOT-based (the abilityIndex is validated against the root's
        // unlocks upstream; this only reconciles the DISPLAY layout of a differently-shaped
        // evolved/mega ability list). No-op in every other mode / when no stage is picked.
        const displayStage = globalScene.gameMode.isShowdown ? this.showdownRenderStage(species.speciesId) : null;
        const displaySpecies = displayStage?.species ?? this.lastSpecies;
        const displayFormIndex = displayStage ? displayStage.formIndex : (formIndex ?? 0);
        const formForAbility =
          displaySpecies.forms?.length > 1
            ? (displaySpecies.forms[displayFormIndex] ?? displaySpecies)
            : displaySpecies;
        const ability: Ability = allAbilities[formForAbility.getAbility(abilityIndex!)] ?? allAbilities[AbilityId.NONE];

        const isHidden = abilityIndex === (this.lastSpecies.ability2 ? 2 : 1);
        this.pokemonAbilityText
          .setText(ability.name)
          .setColor(getTextColor(isHidden ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_ALT))
          .setShadowColor(getTextColor(isHidden ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_ALT, true));

        const passiveAttr = starterDataEntry.passiveAttr;
        // Showdown (staging fix 2026-07-07): passives follow the picked FIELD STAGE like the
        // ability above (item 15 "everything follows the stage") - the fielded species/form's
        // passive set is what battles, so it is what the panel must show. Unlock gating
        // (passiveAttr) stays keyed to the root starter entry. Identity off-showdown.
        const passiveAbility = allAbilities[displaySpecies.getPassiveAbility(displayFormIndex)];

        if (this.pokemonAbilityText.visible) {
          if (this.activeTooltip === "ABILITY") {
            globalScene.ui.editTooltip(`${ability.name}`, `${ability.description}`);
          }

          this.pokemonAbilityText.on("pointerover", () => {
            globalScene.ui.showTooltip(`${ability.name}`, `${ability.description}`, true);
            this.activeTooltip = "ABILITY";
          });
          this.pokemonAbilityText.on("pointerout", () => {
            globalScene.ui.hideTooltip();
            this.activeTooltip = undefined;
          });
        }

        if (passiveAbility) {
          // ER 3-passive rendering: render slot 1 in the legacy `pokemonPassiveText`
          // and slots 2/3 in `pokemonPassiveSlotTexts[0..1]`. For vanilla species
          // (getPassiveCount() === 1) slots 2/3 collapse to a gray "—" placeholder.
          this.renderPassiveSlots(passiveAttr, formIndex, isFreshStartChallenge);

          this.pokemonPassiveLabelText
            .setVisible(!isFreshStartChallenge)
            .setColor(getTextColor(TextStyle.SUMMARY_ALT))
            .setShadowColor(getTextColor(TextStyle.SUMMARY_ALT, true));
        } else if (this.activeTooltip === "PASSIVE") {
          // No passive and passive tooltip is active > hide it
          globalScene.ui.hideTooltip();
        }

        this.pokemonNatureText.setText(getNatureName(natureIndex as unknown as Nature, true, true, false));

        let levelMoves: LevelMoves;
        if (
          Object.hasOwn(pokemonFormLevelMoves, species.speciesId)
          && formIndex
          && Object.hasOwn(pokemonFormLevelMoves[species.speciesId], formIndex)
        ) {
          levelMoves = pokemonFormLevelMoves[species.speciesId][formIndex];
        } else {
          levelMoves = pokemonSpeciesLevelMoves[species.speciesId];
        }
        // ER custom species can be missing from pokemonSpeciesLevelMoves
        // if all their ER moves were dropped during init (no allMoves
        // entry). Without this guard, .filter() crashes the scene to
        // black on navigation. Empty levelMoves means the starter just
        // has no early-level moves auto-selected; user can still pick
        // them manually.
        if (!levelMoves) {
          levelMoves = [];
        }
        this.speciesStarterMoves.push(...levelMoves.filter(lm => lm[0] > 0 && lm[0] <= 5).map(lm => lm[1]));
        if (Object.hasOwn(speciesEggMoves, species.speciesId)) {
          for (let em = 0; em < 4; em++) {
            if (starterDataEntry.eggMoves & (1 << em)) {
              this.speciesStarterMoves.push(speciesEggMoves[species.speciesId][em]);
            }
          }
        }
        // A move can be BOTH an early level-up move AND an egg move (e.g.
        // Drifloon's Psycho Shift is a level-1 ER move and an egg move), which
        // would list it twice in the starter move picker. Dedupe by moveId.
        this.speciesStarterMoves = [...new Set(this.speciesStarterMoves)];

        const speciesMoveData = starterDataEntry.moveset;
        const moveData: StarterMoveset | null = speciesMoveData
          ? Array.isArray(speciesMoveData)
            ? speciesMoveData
            : speciesMoveData[formIndex!] // TODO: is this bang correct?
          : null;
        const availableStarterMoves = this.speciesStarterMoves.concat(
          Object.hasOwn(speciesEggMoves, species.speciesId)
            ? speciesEggMoves[species.speciesId].filter((_: any, em: number) => starterDataEntry.eggMoves & (1 << em))
            : [],
        );
        // Showdown (B7 item 16): the move-swap picker offers the FIELDED stage's FULL legal
        // learnset (item 3), so the re-derived moveset must ACCEPT that whole pool - otherwise a
        // swapped-in TM / high-level move (legal, but NOT in the vanilla early-move pool) is
        // filtered right back out here on the very next setSpeciesDetails and the swap silently
        // reverts. Only the FILTER widens; the fill-to-4 below still seeds from the vanilla pool so
        // a fresh mon defaults to its early moves. No-op in every other mode (uses availableStarterMoves).
        const moveFilterPool = globalScene.gameMode.isShowdown
          ? this.showdownLegalMovePool(species.speciesId)
          : availableStarterMoves;
        this.starterMoveset = (moveData || (this.speciesStarterMoves.slice(0, 4) as StarterMoveset)).filter(m =>
          moveFilterPool.find(sm => sm === m),
        ) as StarterMoveset;
        // Consolidate move data if it contains an incompatible move
        if (this.starterMoveset.length < 4 && this.starterMoveset.length < availableStarterMoves.length) {
          this.starterMoveset.push(
            ...availableStarterMoves
              .filter(sm => this.starterMoveset?.indexOf(sm) === -1)
              .slice(0, 4 - this.starterMoveset.length),
          );
        }

        // Remove duplicate moves
        this.starterMoveset = this.starterMoveset.filter((move, i) => {
          return this.starterMoveset?.indexOf(move) === i;
        }) as StarterMoveset;

        // Showdown (B7 item 15): the type icons + form name follow the FIELDED stage too (they are
        // form-dependent detail fields). `displaySpecies`/`displayFormIndex` resolve to the picked
        // stage in showdown, else to the root species/form (identical to the pre-item-15 behavior).
        const speciesForm = getPokemonSpeciesForm(displaySpecies.speciesId, displayFormIndex);
        const formText = displaySpecies.getFormNameToDisplay(displayFormIndex);
        this.pokemonFormText.setText(formText);

        this.setTypeIcons(speciesFormTypes(speciesForm));

        this.teraIcon.setFrame(PokemonType[this.teraCursor].toLowerCase());
        this.teraIcon.setVisible(!this.statsMode && this.allowTera);
      } else {
        this.pokemonAbilityText.setText("");
        this.pokemonPassiveText.setText("");
        for (const slotText of this.pokemonPassiveSlotTexts) {
          slotText.setText("");
        }
        this.pokemonNatureText.setText("");
        this.teraIcon.setVisible(false);
        this.setTypeIcons([]);
      }
    } else {
      this.shinyOverlay.setVisible(false);
      this.pokemonNumberText
        .setColor(getTextColor(TextStyle.SUMMARY))
        .setShadowColor(getTextColor(TextStyle.SUMMARY, true));
      this.pokemonGenderText.setText("");
      this.pokemonAbilityText.setText("");
      this.pokemonPassiveText.setText("");
      for (const slotText of this.pokemonPassiveSlotTexts) {
        slotText.setText("");
      }
      this.pokemonNatureText.setText("");
      this.teraIcon.setVisible(false);
      this.setTypeIcons([]);
    }

    if (!this.starterMoveset) {
      this.starterMoveset = this.speciesStarterMoves.slice(0, 4) as StarterMoveset;
    }

    for (let m = 0; m < 4; m++) {
      const move = m < this.starterMoveset.length ? allMoves[this.starterMoveset[m]] : null;
      this.pokemonMoveBgs[m].setFrame(PokemonType[move ? move.type : PokemonType.UNKNOWN].toString().toLowerCase());
      this.pokemonMoveLabels[m].setText(move ? move.name : "-");
      this.pokemonMoveContainers[m].setVisible(!!move);
    }

    const hasEggMoves = species && Object.hasOwn(speciesEggMoves, species.speciesId);
    let eggMoves = 0;
    if (species) {
      const { starterDataEntry } = this.getSpeciesData(this.lastSpecies.speciesId);
      eggMoves = starterDataEntry.eggMoves;
    }

    for (let em = 0; em < 4; em++) {
      const eggMove = hasEggMoves
        ? allMoves[speciesEggMoves[species.speciesId as keyof typeof speciesEggMoves][em]]
        : null;
      const eggMoveUnlocked = eggMove && eggMoves & (1 << em);
      this.pokemonEggMoveBgs[em].setFrame(
        PokemonType[eggMove ? eggMove.type : PokemonType.UNKNOWN].toString().toLowerCase(),
      );
      this.pokemonEggMoveLabels[em].setText(eggMove && eggMoveUnlocked ? eggMove.name : "???");
    }

    this.pokemonEggMovesContainer.setVisible(!!this.speciesStarterDexEntry?.caughtAttr && hasEggMoves);

    this.pokemonAdditionalMoveCountLabel
      .setText(`(+${Math.max(this.speciesStarterMoves.length - 4, 0)})`)
      .setVisible(this.speciesStarterMoves.length > 4);

    // Preview/cursor-move: party cost is unchanged, so skip the whole-dex
    // affordability re-shade (the per-keypress hot path). The sweep still runs on
    // party add/remove (addToParty/popStarter), restoreLastTeam, and first open.
    this.tryUpdateValue(undefined, undefined, true);

    this.updateInstructions();

    if (save) {
      saveStarterPreferences(this.originalStarterPreferences);
    }
  }

  setTypeIcons(types: readonly PokemonType[]): void {
    layoutTypeIconStrip(this.starterSelectContainer, this.type1Icon, this.type2Icon, this.extraTypeIcons, types, {
      x0: 8,
      y0: 98,
      baseScale: 0.5,
      baseStride: 18,
      maxWidth: 104,
    });
  }

  popStarter(index: number): void {
    // Showdown: drop this line's stored stage/item so re-adding the mon later doesn't
    // silently re-stamp a stale (e.g. mega) selection past the picker guards. Keyed by the
    // root (grid) species id. No-op in non-showdown modes (the map is always empty there).
    this.showdownSelections.delete(this.starterSpecies[index]?.speciesId);
    this.starterSpecies.splice(index, 1);
    this.starters.splice(index, 1);

    for (let s = 0; s < this.starterSpecies.length; s++) {
      const species = this.starterSpecies[s];
      // B7 item 9: re-render each remaining party icon through updatePartyIcon so it re-applies the
      // showdown Field-Stage override. The old inline render always drew the BASE form, so removing
      // a mon reverted every other slot's evolved/mega icon back to its base (the maintainer report).
      this.updatePartyIcon(species, s);
      if (s >= index) {
        this.starterCursorObjs[s]
          .setPosition(this.starterCursorObjs[s + 1].x, this.starterCursorObjs[s + 1].y)
          .setVisible(this.starterCursorObjs[s + 1].visible);
      }
    }
    this.starterCursorObjs[this.starterSpecies.length].setVisible(false);
    this.resetStarterIconSlot(this.starterSpecies.length);

    if (this.starterIconsCursorObj.visible) {
      if (this.starterIconsCursorIndex === this.starterSpecies.length) {
        if (this.starterSpecies.length > 0) {
          this.starterIconsCursorIndex--;
        } else {
          // No more Pokemon selected, go back to filters
          this.starterIconsCursorObj.setVisible(false);
          this.setSpecies(null);
          this.filterBarCursor = Math.max(1, this.filterBar.numFilters - 1);
          this.setFilterMode(true);
        }
      }
      this.moveStarterIconsCursor(this.starterIconsCursorIndex);
    } else if (this.startCursorObj.visible && this.starterSpecies.length === 0) {
      // On the start button and no more Pokemon in party
      this.startCursorObj.setVisible(false);
      if (this.filteredStarterContainers.length > 0) {
        // Back to the first Pokemon if there is one
        this.cursorObj.setVisible(true);
        this.setCursor(this.scrollCursor * 9);
      } else {
        // Back to filters
        this.filterBarCursor = Math.max(1, this.filterBar.numFilters - 1);
        this.setFilterMode(true);
      }
    }

    this.tryUpdateValue();
  }

  updateStarterValueLabel(starter: StarterContainer): void {
    const speciesId = starter.species.speciesId;
    const baseStarterValue = speciesStarterCosts[speciesId];
    if (baseStarterValue == null) {
      return;
    }
    const starterValue = globalScene.gameData.getSpeciesStarterValue(speciesId);
    starter.cost = starterValue;
    let valueStr = starterValue.toString();
    if (valueStr.startsWith("0.")) {
      valueStr = valueStr.slice(1);
    }
    starter.label.setText(valueStr);
    let textStyle: TextStyle;
    switch (baseStarterValue - starterValue) {
      case 0:
        textStyle = TextStyle.WINDOW;
        break;
      case 1:
      case 0.5:
        textStyle = TextStyle.SUMMARY_BLUE;
        break;
      default:
        textStyle = TextStyle.SUMMARY_GOLD;
        break;
    }
    starter.label.setColor(getTextColor(textStyle)).setShadowColor(getTextColor(textStyle, true));
  }

  /**
   * @param skipAffordabilitySweep - When true, skip the O(all-species) loop that
   *   re-shades every grid icon by affordability. That sweep only changes when the
   *   PARTY changes (cost) — never on a mere cursor/preview move — yet it ran on
   *   every `setSpeciesDetails`, doing ~1900× `checkStarterValidForChallenge` +
   *   `getCurrentDexProps` per keypress and saturating the main thread (which also
   *   stalled the sprite loader's completion events). Preview calls now pass true;
   *   party add/remove + first open still run the full sweep.
   */
  tryUpdateValue(add?: number, addingToParty?: boolean, skipAffordabilitySweep = false): boolean {
    const value = this.starterSpecies
      .map(s => s.generation)
      .reduce(
        (total: number, _gen: number, i: number) =>
          (total += globalScene.gameData.getSpeciesStarterValue(this.starterSpecies[i].speciesId)),
        0,
      );
    const newValue = value + (add || 0);
    const valueLimit = this.getValueLimit();
    const overLimit = newValue > valueLimit;
    let newValueStr = newValue.toString();
    if (newValueStr.startsWith("0.")) {
      newValueStr = newValueStr.slice(1);
    }
    this.valueLimitLabel
      .setText(`${newValueStr}/${valueLimit}`)
      .setColor(getTextColor(overLimit ? TextStyle.SUMMARY_PINK : TextStyle.TOOLTIP_CONTENT))
      .setShadowColor(getTextColor(overLimit ? TextStyle.SUMMARY_PINK : TextStyle.TOOLTIP_CONTENT, true));
    if (overLimit) {
      globalScene.time.delayedCall(fixedInt(500), () => this.tryUpdateValue());
      return false;
    }
    // Pure preview (cursor move) → affordability hasn't changed, so skip the
    // whole-dex re-shade. This is the single biggest per-keypress cost.
    if (skipAffordabilitySweep) {
      return true;
    }

    let isPartyValid = this.isPartyValid();
    if (addingToParty) {
      const species = this.filteredStarterContainers[this.cursor].species;
      const isNewPokemonValid = checkStarterValidForChallenge(
        species,
        globalScene.gameData.getSpeciesDexAttrProps(species, this.getCurrentDexProps(species.speciesId)),
        false,
      );
      isPartyValid ||= isNewPokemonValid;
    }

    /**
     * this loop is used to set the Sprite's alpha value and check if the user can select other pokemon more.
     */
    const remainValue = valueLimit - newValue;
    for (let s = 0; s < this.allSpecies.length; s++) {
      /** Cost of pokemon species */
      const speciesStarterValue = globalScene.gameData.getSpeciesStarterValue(this.allSpecies[s].speciesId);
      /** {@linkcode Phaser.GameObjects.Sprite} object of Pokémon for setting the alpha value */
      const speciesSprite = this.starterContainers[s].icon;

      /**
       * If remainValue greater than or equal pokemon species and the pokemon is legal for this challenge, the user can select.
       * so that the alpha value of pokemon sprite set 1.
       *
       * However, if isPartyValid is false, that means none of the party members are valid for the run. In this case, we should
       * check the challenge to make sure evolutions and forms aren't being checked for mono type runs.
       * This will let us set the sprite's alpha to show it can't be selected
       *
       * If speciesStarterDexEntry?.caughtAttr is true, this species registered in stater.
       * we change to can AddParty value to true since the user has enough cost to choose this pokemon and this pokemon registered too.
       */
      const isValidForChallenge = checkStarterValidForChallenge(
        this.allSpecies[s],
        globalScene.gameData.getSpeciesDexAttrProps(
          this.allSpecies[s],
          this.getCurrentDexProps(this.allSpecies[s].speciesId),
        ),
        isPartyValid,
      );

      const canBeChosen = remainValue >= speciesStarterValue && isValidForChallenge;

      const isPokemonInParty = this.isInParty(this.allSpecies[s])[0]; // this will get the valud of isDupe from isInParty. This will let us see if the pokemon in question is in our party already so we don't grey out the sprites if they're invalid

      /* This code does a check to tell whether or not a sprite should be lit up or greyed out. There are 3 ways a pokemon's sprite should be lit up:
       * 1) If it's in your party, it's a valid pokemon (i.e. for challenge) and you have enough points to have it
       * 2) If it's in your party, it's not valid (i.e. for challenges), and you have enough points to have it
       * 3) If it's not in your party, but it's a valid pokemon and you have enough points for it
       * Any other time, the sprite should be greyed out.
       * For example, if it's in your party, valid, but costs too much, or if it's not in your party and not valid, regardless of cost
       */
      if (canBeChosen || (isPokemonInParty && remainValue >= speciesStarterValue)) {
        speciesSprite.setAlpha(1);
      } else {
        /**
         * If it can't be chosen, the user can't select.
         * so that the alpha value of pokemon sprite set 0.375.
         */
        speciesSprite.setAlpha(0.375);
      }
    }

    return true;
  }

  /**
   * Attempt to back out of the starter selection screen into the appropriate parent modal
   */
  tryExit(): void {
    this.blockInput = true;
    const ui = this.getUi();

    const cancel = () => {
      ui.setMode(UiMode.STARTER_SELECT);
      this.clearText();
      this.blockInput = false;
    };
    ui.showText(i18next.t("starterSelectUiHandler:confirmExit"), null, () => {
      ui.setModeWithoutClear(
        UiMode.CONFIRM,
        () => {
          // Showdown Team Menu offline build (addendum): the grid was opened to EDIT/CREATE a preset, so
          // backing out returns to the Team Menu (restoring the borrowed gameMode + reopening the menu via
          // onCancel -> onSettled), NOT the title. Pop the CONFIRM overlay, then hand back to the flow. This
          // path never ends the TitlePhase (which is still the current phase driving the menu).
          if (this.showdownBuildOnCancel != null) {
            const onCancel = this.showdownBuildOnCancel;
            this.showdownBuildOnCancel = null;
            this.clearText();
            // The confirmExit box is an UNCHAINED overlay (`setModeWithoutClear` above) painted over the
            // still-visible grid, so `revertMode()` here is a no-op (nothing was pushed onto the mode
            // chain) and the flow's follow-up `setMode(SHOWDOWN_TEAM_MENU)` clears the CONFIRM handler,
            // NOT this grid - stranding `starterSelectContainer` VISIBLE under the menu (the "stuck
            // getting out of the custom starter select menu" report). Tear THIS grid down explicitly
            // (clear() hides its container + resets its state) before handing back to the flow, which
            // opens the Team Menu instantly (SHOWDOWN_TEAM_MENU is a noTransitionMode - no fade race).
            this.clear();
            this.blockInput = false;
            onCancel();
            return;
          }
          ui.setMode(UiMode.STARTER_SELECT);
          // Non-challenge modes go directly back to title, while challenge modes go to the selection screen.
          if (globalScene.gameMode.isChallenge) {
            globalScene.phaseManager.clearPhaseQueue();
            globalScene.phaseManager.pushNew("SelectChallengePhase");
            globalScene.phaseManager.pushNew("EncounterPhase");
          } else {
            globalScene.phaseManager.toTitleScreen();
          }
          this.clearText();
          globalScene.phaseManager.getCurrentPhase().end();
        },
        cancel,
        null,
        null,
        19,
      );
    });
  }

  /**
   * ER: re-select the player's previous run team (persisted via saveLastTeam) into
   * the current selection. Skips species not caught in this save, and stops adding
   * once the point-value limit would be exceeded. Returns false if there is no
   * stored team or none of it can be added (so the caller can play an error tone).
   */
  restoreLastTeam(): boolean {
    const lastTeam = loadLastTeam();
    if (!lastTeam || lastTeam.length === 0) {
      return false;
    }
    return this.seedTeamFromStarters(lastTeam);
  }

  /**
   * Seed the party grid from a provided list of saved {@linkcode Starter}s. Callers:
   *   - "Use Last Team" ({@linkcode restoreLastTeam}) with the persisted last run team.
   *   - Showdown Team Menu EDIT (addendum): the preset's mons reconstructed via `manifestToStarter`,
   *     each carrying its saved stage/shiny/item/moves/nature/ability, so editing starts pre-populated.
   *   - Build-gated co-op browser checkpoints, which alone may render their uncaught fixture starters.
   * Skips species not caught in this save + any the active challenge forbids, and stops adding once the
   * point-value limit would be exceeded (effectively unlimited in showdown). Returns false when nothing
   * could be added. Rules are NOT enforced here - Ready/Done re-validates as usual, so a now-illegal
   * preset still loads with its mons.
   */
  seedTeamFromStarters(savedTeam: Starter[], options: SeedTeamOptions = {}): boolean {
    // Resolve which saved starters are usable (caught) and precompute their dex
    // attributes before mutating any selection state.
    const entries: { saved: Starter; species: PokemonSpecies; dexAttr: bigint }[] = [];
    for (const saved of savedTeam.slice(0, 6)) {
      const species = getPokemonSpecies(saved.speciesId);
      if (!species || (!options.allowUncaught && !this.getSpeciesData(saved.speciesId).dexEntry.caughtAttr)) {
        continue;
      }
      let dexAttr = saved.shiny ? DexAttr.SHINY : DexAttr.NON_SHINY;
      dexAttr |= saved.female ? DexAttr.FEMALE : DexAttr.MALE;
      dexAttr |=
        saved.variant === 2 ? DexAttr.VARIANT_3 : saved.variant === 1 ? DexAttr.VARIANT_2 : DexAttr.DEFAULT_VARIANT;
      dexAttr |= globalScene.gameData.getFormAttr(saved.formIndex);
      // ER (#133): drop any saved mon the active challenge forbids, so "Use Last Team"
      // cannot smuggle an off-type / off-tier / off-color / off-gen mon into a challenge
      // run - the same gate the starter grid greys illegal mons out with.
      if (
        !checkStarterValidForChallenge(species, globalScene.gameData.getSpeciesDexAttrProps(species, dexAttr), true)
      ) {
        continue;
      }
      entries.push({ saved, species, dexAttr });
    }
    if (entries.length === 0) {
      return false;
    }

    // Clear the current selection, then load all sprites before adding so the
    // party icons appear together (mirrors the random-select flow).
    while (this.starterSpecies.length > 0) {
      this.popStarter(this.starterSpecies.length - 1);
    }
    this.tryUpdateValue(0);

    const loads = entries.map(e => {
      const props = globalScene.gameData.getSpeciesDexAttrProps(e.species, e.dexAttr);
      return getPokemonSpeciesForm(e.species.speciesId, props.formIndex).loadAssets(
        props.female,
        props.formIndex,
        props.shiny,
        props.variant,
        true,
      );
    });
    const seedGeneration = ++this.showdownSeedGeneration;
    this.showdownSeedInFlight = Promise.all(loads)
      .then(() => {
        // Cancel/back/reopen can happen before sprite assets resolve. An obsolete seed belongs to the
        // screen visit that started it and must never mutate the newly active grid or its cursor state.
        if (seedGeneration !== this.showdownSeedGeneration || !this.starterSelectContainer.visible) {
          return;
        }
        for (const e of entries) {
          const cost = globalScene.gameData.getSpeciesStarterValue(e.species.speciesId);
          if (!this.tryUpdateValue(cost, true)) {
            break; // remaining starters would exceed the value limit
          }
          // Showdown (B7 item 15): re-seed this line's saved Field Stage / held item into
          // `showdownSelections` BEFORE the add so `applyShowdownSelection` re-stamps the fielded
          // stage AND the party mini-icon (rendered inside addToParty) follows it. The saved Starter
          // persists these fields (saveLastTeam), so a restored evolved/mega team comes back as saved.
          if (globalScene.gameMode.isShowdown && e.saved.showdownSpeciesId !== undefined) {
            this.showdownSelections.set(e.species.speciesId, {
              speciesId: e.saved.showdownSpeciesId,
              formIndex: e.saved.showdownFormIndex ?? 0,
              item: e.saved.showdownItem,
            });
          }
          this.addToParty(
            e.species,
            e.dexAttr,
            e.saved.abilityIndex,
            e.saved.nature,
            e.saved.moveset?.slice(0) as StarterMoveset,
            e.saved.teraType ?? e.species.type1,
            true,
          );
        }
        this.getUi().playSelect();
      })
      .catch(error => {
        if (seedGeneration === this.showdownSeedGeneration) {
          console.warn("Showdown team seed assets failed to load", error);
        }
      });
    return true;
  }

  tryStart(manualTrigger = false): boolean {
    // Roster-pick: SUBMIT/Start = "Done", return the chosen allowed set (empty = all).
    // Sidesteps the empty-party guard + difficulty/start flow entirely.
    if (this.rosterPickMode) {
      this.rosterConfirm?.([...this.rosterSelected]);
      return true;
    }
    if (this.starterSpecies.length === 0) {
      return false;
    }

    const ui = this.getUi();

    const cancel = () => {
      ui.setMode(UiMode.STARTER_SELECT);
      if (!manualTrigger) {
        this.popStarter(this.starterSpecies.length - 1);
      }
      this.clearText();
    };

    // Showdown: the party must be a fully legal 6v6 showdown team (size, level-100,
    // items, one-mega cap, collection legality, IVs, moves). Run the shared rule engine on
    // the manifests and refuse the start on the FIRST violation, surfaced like invalidParty.
    if (globalScene.gameMode.isShowdown) {
      const { gameData } = globalScene;
      const manifests = this.starters.map(starter => starterToManifest(starter, gameData));
      const violations = validateShowdownTeam(manifests, buildUnlockSnapshot(gameData), isMegaStage);
      if (violations.length > 0) {
        this.tutorialActive = true;
        this.showText(
          violations[0].message,
          undefined,
          () => this.showText("", 0, () => (this.tutorialActive = false)),
          undefined,
          true,
        );
        return true;
      }
    }

    const canStart = this.isPartyValid();

    if (canStart) {
      ui.showText(i18next.t("starterSelectUiHandler:confirmStartTeam"), null, () => {
        ui.setModeWithoutClear(
          UiMode.CONFIRM,
          () => {
            const startRun = (difficulty: ErDifficulty) => {
              // ER: lock in the chosen run difficulty (drives the ER trainer
              // roster tier for the whole run) and reset the per-run "already
              // encountered" ER trainer set so the new run starts fresh.
              setErDifficulty(difficulty);
              // Co-op (#633): the HOST publishes the authoritative run config
              // (difficulty + challenges) so the guest mirrors it - the run stays
              // coherent (both players get the same difficulty + challenge set).
              const coopHost = getCoopController();
              if (coopHost != null) {
                console.log(
                  `[coop-runconfig] startRun role=${coopHost.role} willBroadcast=${coopHost.role === "host"} difficulty=${difficulty}`,
                );
              }
              if (coopHost?.role === "host") {
                coopHost.broadcastRunConfig({
                  difficulty,
                  challenges: globalScene.gameMode.challenges.map(c => ({
                    id: c.id,
                    value: c.value,
                    severity: c.severity,
                  })),
                  // Co-op (#633, LIVE-A): pin the guest to the HOST's run seed so
                  // both engines roll identical enemies / RNG and stay in lockstep.
                  // The seed is already fixed by globalScene.reset() at title entry,
                  // so it is stable here and shared verbatim.
                  seed: globalScene.seed,
                });
              }
              resetErRunTrainerTracking();
              resetErCustomTrainerTracking();
              resetErGhostRunState();
              resetErMapNodes();
              // ER (#486): dev/testing seed - pre-stock Treasure-Map fragments
              // AFTER the reset so a scenario can test the X-Marks-the-Spot payout.
              if (Overrides.ER_TREASURE_FRAGMENTS_OVERRIDE > 0) {
                addTreasureFragments(Overrides.ER_TREASURE_FRAGMENTS_OVERRIDE);
              }
              resetErMoneyStreaks();
              resetErAchievementRunState();
              globalScene.money = globalScene.gameMode.getStartingMoney();
              const starters = this.starters.slice(0);
              // ER: remember this team so it can be re-selected next run.
              saveLastTeam(starters);
              ui.setMode(UiMode.STARTER_SELECT);
              const originalStarterSelectCallback = this.starterSelectCallback;
              this.starterSelectCallback = null;
              originalStarterSelectCallback?.(starters);
            };
            // ER: pick a run difficulty (Youngster / Ace / Elite / Hell)
            // before launching. Hovering a mode shows what it does (#368) in
            // the message box under the option list.
            const difficultyOption = (difficulty: ErDifficulty, key: string) => ({
              semanticId: key.toLowerCase(),
              label: i18next.t(`starterSelectUiHandler:difficulty${key}`),
              onHover: () => {
                // Show in THIS screen's message box. `ui.showText` would route
                // through the option-select overlay handler (not a message
                // handler) into the battle message box, which is not on this
                // screen - the descriptions were invisible (#368 report).
                this.showText(i18next.t(`starterSelectUiHandler:difficulty${key}Desc`));
              },
              handler: () => {
                startRun(difficulty);
                return true;
              },
            });
            // Showdown 1v1 (B7 item 4 + item 11): a versus match SKIPS the ER difficulty chooser
            // ("why am I picking Hell for one fight"), but it MUST NOT call `startRun` here.
            // `startRun` is the CO-OP RUN LAUNCHER (it broadcasts runConfig + resets ER run state +
            // drives the run-launch scene/UI pipeline); firing it at team-confirm races the versus
            // negotiate->wager flow and ~3s later setModes OVER the live SHOWDOWN_WAGER screen,
            // tearing it down (log-confirmed: the guest's wager silently dies, the host's later
            // wager-commit finds no listener). Instead hand off to `runShowdownFlow` ONLY (via the
            // starter-select callback); the run is actually launched at the WAGER COMMIT
            // (SelectStarterPhase.launchShowdownBattle), where the "ace" difficulty + ER-run prep
            // now live. Nothing run-launch-related runs on either client until BOTH lock in.
            if (globalScene.gameMode.isShowdown) {
              const showdownStarters = this.starters.slice(0);
              saveLastTeam(showdownStarters); // remember the team even if the match aborts at the wager
              ui.setMode(UiMode.STARTER_SELECT);
              const showdownCallback = this.starterSelectCallback;
              this.starterSelectCallback = null;
              showdownCallback?.(showdownStarters);
              return;
            }
            // ER Community Challenge: a launched community card forces its run
            // difficulty (already applied to the gameMode in TitlePhase.end), so
            // skip the difficulty chooser and launch directly. Consume the gate so
            // it can't leak into a later normal run.
            const forced = getForcedCommunityDifficulty();
            if (forced) {
              clearForcedCommunityDifficulty();
              startRun(forced);
              return;
            }
            // Co-op (#633): the GUEST does not choose - it follows the HOST's
            // broadcast difficulty + challenges so the run is coherent. Apply the
            // host's config and launch; if it hasn't arrived yet, wait for it.
            const coopGuest = getCoopController();
            if (coopGuest?.role === "guest") {
              const applyHostConfig = (): boolean => {
                const cfg = coopGuest.runConfig();
                if (!cfg) {
                  return false;
                }
                for (const ch of cfg.challenges) {
                  const match = globalScene.gameMode.challenges.find(c => c.id === ch.id);
                  if (match) {
                    match.value = ch.value;
                    match.severity = ch.severity;
                  }
                }
                // Co-op (#633, LIVE-A): pin our engine to the HOST's run seed BEFORE
                // the first wave generates, so both clients roll identical enemies /
                // RNG. setSeed + resetSeed mirrors how a daily / loaded run pins its
                // seed (see TitlePhase.initDailyRun). The first wave is generated in
                // SelectStarterPhase.initBattle -> newBattle (downstream of startRun),
                // which re-seeds from globalScene.seed, so setting it here is in time.
                if (cfg.seed !== undefined) {
                  globalScene.setSeed(cfg.seed);
                  globalScene.resetSeed();
                }
                startRun(cfg.difficulty as ErDifficulty);
                return true;
              };
              if (!applyHostConfig()) {
                this.showText("Waiting for the host to choose difficulty...");
                // Co-op (#633): the host broadcasts the runConfig exactly ONCE when it
                // picks difficulty. If that single message is dropped or arrives in a
                // bad window the guest used to wait here FOREVER (the live "stuck on
                // difficulty" hang). Make it self-healing: actively (re)request the
                // config until it lands. The host re-broadcasts on every request (a
                // harmless no-op before it has picked); onChange applies it the instant
                // it arrives, and we stop requesting then.
                console.log("[coop-runconfig] guest waiting - requesting runConfig from host");
                coopGuest.requestRunConfig();
                const retry = setInterval(() => {
                  if (applyHostConfig()) {
                    clearInterval(retry);
                    return;
                  }
                  coopGuest.requestRunConfig();
                }, 2000);
                const off = coopGuest.onChange(() => {
                  if (applyHostConfig()) {
                    clearInterval(retry);
                    off();
                  }
                });
              }
              return;
            }
            ui.setOverlayMode(UiMode.OPTION_SELECT, {
              // Without supportHover the option-select handler NEVER invokes
              // onHover - the mode descriptions were silently dead (#368).
              supportHover: true,
              options: [
                difficultyOption("youngster", "Youngster"),
                difficultyOption("ace", "Ace"),
                difficultyOption("elite", "Elite"),
                difficultyOption("hell", "Hell"),
                // MYSTERY GAUNTLET (#814): the dev/staging-only ME testing schedule.
                ...(import.meta.env.DEV
                || (import.meta.env as unknown as Record<string, string | undefined>).VITE_DEV_TOOLS === "1"
                  ? [difficultyOption("mystery", "Mystery")]
                  : []),
              ],
            });
          },
          cancel,
          null,
          null,
          19,
        );
      });
    } else {
      this.tutorialActive = true;
      this.showText(
        i18next.t("starterSelectUiHandler:invalidParty"),
        undefined,
        () => this.showText("", 0, () => (this.tutorialActive = false)),
        undefined,
        true,
      );
    }
    return true;
  }

  /**
   *  This block checks to see if your party is valid
   * It checks each pokemon against the challenge - noting that due to monotype challenges it needs to check the pokemon while ignoring their evolutions/form change items
   */
  isPartyValid(): boolean {
    let canStart = false;
    for (let s = 0; s < this.starterSpecies.length; s++) {
      const species = this.starterSpecies[s];
      const starter = this.starters[s];
      const isValidForChallenge = checkStarterValidForChallenge(
        species,
        {
          formIndex: starter.formIndex,
          shiny: starter.shiny,
          variant: starter.variant,
          female: starter.female ?? false,
        },
        false,
      );
      canStart ||= isValidForChallenge;
    }
    return canStart;
  }

  /**
   * Creates a temporary dex attr props that will be used to check whether a pokemon is valid for a challenge
   * and to display the correct shiny, variant, and form based on the StarterPreferences
   *
   * @param speciesId the id of the species to get props for
   * @returns the dex props
   */
  getCurrentDexProps(speciesId: number): bigint {
    let props = 0n;
    const { dexEntry } = this.getSpeciesData(speciesId);
    const caughtAttr = dexEntry.caughtAttr;

    /*  this checks the gender of the pokemon; this works by checking a) that the starter preferences for the species exist, and if so, is it female. If so, it'll add DexAttr.FEMALE to our temp props
     *  It then checks b) if the caughtAttr for the pokemon is female and NOT male - this means that the ONLY gender we've gotten is female, and we need to add DexAttr.FEMALE to our temp props
     *  If neither of these pass, we add DexAttr.MALE to our temp props
     */
    if (
      this.starterPreferences[speciesId]?.female
      || ((caughtAttr & DexAttr.FEMALE) > 0n && (caughtAttr & DexAttr.MALE) === 0n)
    ) {
      props += DexAttr.FEMALE;
    } else {
      props += DexAttr.MALE;
    }
    /* This part is very similar to above, but instead of for gender, it checks for shiny within starter preferences.
     * If they're not there, it enables shiny state by default if any shiny was caught
     */
    if (
      this.starterPreferences[speciesId]?.shiny
      || ((caughtAttr & DexAttr.SHINY) > 0n && this.starterPreferences[speciesId]?.shiny !== false)
    ) {
      props += DexAttr.SHINY;
      if (this.starterPreferences[speciesId]?.variant !== undefined) {
        props += BigInt(Math.pow(2, this.starterPreferences[speciesId]?.variant)) * DexAttr.DEFAULT_VARIANT;
      } else if ((caughtAttr & DexAttr.VARIANT_3) > 0) {
        /*  This calculates the correct variant if there's no starter preferences for it.
         *  This gets the highest tier variant that you've caught and adds it to the temp props
         */
        props += DexAttr.VARIANT_3;
      } else if ((caughtAttr & DexAttr.VARIANT_2) > 0) {
        props += DexAttr.VARIANT_2;
      } else {
        props += DexAttr.DEFAULT_VARIANT;
      }
    } else {
      props += DexAttr.NON_SHINY;
      props += DexAttr.DEFAULT_VARIANT; // we add the default variant here because non shiny versions are listed as default variant
    }
    if (this.starterPreferences[speciesId]?.form) {
      // this checks for the form of the pokemon
      props += BigInt(Math.pow(2, this.starterPreferences[speciesId]?.form)) * DexAttr.DEFAULT_FORM;
    } else {
      // Get the first unlocked form
      props += globalScene.gameData.getFormAttr(globalScene.gameData.getFormIndex(caughtAttr));
    }

    return props;
  }

  toggleStatsMode(on?: boolean): void {
    if (on === undefined) {
      on = !this.statsMode;
    }
    if (on) {
      this.showStats();
      this.statsMode = true;
      this.pokemonSprite.setVisible(false);
      this.shinyLabFxSprite.setVisible(false);
      this.teraIcon.setVisible(false);
      this.canCycleTera = false;
      this.updateInstructions();
    } else {
      this.statsMode = false;
      this.statsContainer.setVisible(false);
      this.pokemonSprite.setVisible(!!this.speciesStarterDexEntry?.caughtAttr);
      this.statsContainer.updateIvs(null);
      this.teraIcon.setVisible(this.allowTera);
      const props = globalScene.gameData.getSpeciesDexAttrProps(
        this.lastSpecies,
        this.getCurrentDexProps(this.lastSpecies.speciesId),
      );
      const formIndex = props.formIndex;
      this.canCycleTera =
        !this.statsMode
        && this.allowTera
        && getPokemonSpeciesForm(this.lastSpecies.speciesId, formIndex ?? 0).type2 != null
        && !globalScene.gameMode.hasChallenge(Challenges.FRESH_START);
      this.updateInstructions();
      this.pokemonSprite.setPipelineData("previewStateKey", "");
      this.refreshPreviewSprite();
    }
  }

  showStats(): void {
    if (!this.speciesStarterDexEntry) {
      return;
    }

    this.statsContainer.setVisible(true);

    this.statsContainer.updateIvs(this.speciesStarterDexEntry.ivs);
  }

  clearText() {
    this.starterSelectMessageBoxContainer.setVisible(false);
    super.clearText();
  }

  hideInstructions(): void {
    // TODO: uncomment this and delete the rest of the method once our testing infra supports mocks of `Phaser.GameObject.Group`
    // this.instructionElemGroup.setVisible(false);
    this.shinyIconElement.setVisible(false);
    this.shinyLabel.setVisible(false);
    this.formIconElement.setVisible(false);
    this.formLabel.setVisible(false);
    this.genderIconElement.setVisible(false);
    this.genderLabel.setVisible(false);
    this.abilityIconElement.setVisible(false);
    this.abilityLabel.setVisible(false);
    this.natureIconElement.setVisible(false);
    this.natureLabel.setVisible(false);
    this.teraIconElement.setVisible(false);
    this.teraLabel.setVisible(false);
    this.goFilterIconElement.setVisible(false);
    this.goFilterLabel.setVisible(false);
  }

  clear(): void {
    super.clear();
    this.showdownSeedGeneration++;
    this.showdownSeedInFlight = null;
    this.setErLinksVisible(false); // hide the Discord/GitHub corner links off the starter screen

    saveStarterPreferences(this.originalStarterPreferences);

    this.clearStarterPreferences();
    this.cursor = -1;
    this.hideInstructions();
    this.activeTooltip = undefined;
    globalScene.ui.hideTooltip();

    // Reset roster-pick state so a later normal team-select is not poisoned.
    if (this.rosterPickMode) {
      this.rosterPickMode = false;
      this.rosterSelected.clear();
      this.rosterConfirm = null;
    }

    this.starterSelectContainer.setVisible(false);
    this.coopStatusUnsub?.();
    this.coopStatusUnsub = null;
    this.coopStatusText?.setVisible(false);
    this.blockInput = false;
    this.spritePrewarmTimer?.remove();
    this.spritePrewarmTimer = null;
    this.shinyLabFxTimer?.remove();
    this.shinyLabFxTimer = null;
    this.shinyLabNameFx?.destroy();
    this.shinyLabNameFx = undefined;
    this.hideShinyLabFxPreview(false);

    while (this.starterSpecies.length > 0) {
      this.popStarter(this.starterSpecies.length - 1);
    }
    // Showdown: drop all stored stage/item choices on screen exit so a later re-entry
    // (same or a fresh run) starts clean instead of restoring stale selections.
    this.showdownSelections.clear();

    if (this.statsMode) {
      this.toggleStatsMode(false);
    }
  }

  checkIconId(
    icon: Phaser.GameObjects.Sprite,
    species: PokemonSpecies,
    female: boolean,
    formIndex: number,
    shiny: boolean,
    variant: number,
  ) {
    if (icon.frame.name !== species.getIconId(female, formIndex, shiny, variant)) {
      console.log(
        `${species.name}'s icon ${icon.frame.name} does not match getIconId with female: ${female}, formIndex: ${formIndex}, shiny: ${shiny}, variant: ${variant}`,
      );
      icon
        .setTexture(species.getIconAtlasKey(formIndex, false, variant))
        .setFrame(species.getIconId(female, formIndex, false, variant));
    }
  }

  /**
   * Clears this UI's starter preferences.
   *
   * Designed to be used for unit tests that utilize this UI.
   */
  clearStarterPreferences() {
    this.starterPreferences = {};
    this.originalStarterPreferences = {};
  }

  /**
   * Truncate the Pokémon name so it won't overlap into the starters.
   */
  private truncateName() {
    const name = this.pokemonNameText.text;
    this.pokemonNameText.setText(truncateString(name, 15));
  }

  /** Lazily build the owned animated Name-FX overlay for the detail-panel name. */
  private getShinyLabNameFx(): ErShinyLabNameFx {
    if (!this.shinyLabNameFx) {
      this.shinyLabNameFx = new ErShinyLabNameFx();
    }
    return this.shinyLabNameFx;
  }
}
