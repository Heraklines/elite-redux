/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PvP - the full-screen SET EDITOR (Layer 3 of the teambuilder).
//
// Opened when a mon is CONFIRMED from the collection grid. It is the single place a
// player shapes one team slot: which STAGE of the line to field (base -> final ->
// mega), the ACTIVE ability, held item, four moves, nature and shiny tier - every choice
// gated by the live collection, every choice showing its inline description.
//
// Layout (logical 320x180, x6 to screen) - round-4 redesign:
//   - TOP TEAM STRIP: a cohesive dark bar - 6 framed slot icons (active slot gold-framed) +
//     uniform validity chips (size / mega / cost) + an integrated countdown + partner status.
//   - HOTKEY LEGEND BAR: real key-glyph icons (the game's "keyboard" atlas) for the per-mon
//     functions - Stage (F), Shiny (R), Ability (E), Nature (N) - mirroring starter select.
//   - LEFT IDENTITY COLUMN (~1/3): the FULL front battle sprite, the species name + cost, type
//     chips, the evolution STAGE STRIP (every owned fielded form incl. multiple megas), the
//     restyled SHINY tier selector (off / T1 / T2 / T3 / T4=black, locked tiers marked) and the
//     BASE stat bars with nature +/- coloring.
//   - RIGHT COLUMN (~2/3): windowed section panels -
//       ABILITIES - the 1 ACTIVE (CYCLABLE directly, no dropdown) + the 3 always-on INNATES; a
//         locked innate shows its candy unlock cost (the player's own party respects the candy
//         gate, so a locked innate is genuinely inactive - see the enemy-build asymmetry note).
//       ITEM (+ a compact NATURE chip beside it), MOVES (a 2x2 cell grid).
//   - MOVE DESCRIPTION BAR (bottom of the right column): a persistent bar that live-updates with
//     the highlighted move's full description while navigating the move dropdown AND while focus
//     sits on any of the 4 move cells.
//   - SEARCH DROPDOWN: drawn ON TOP, only while an ITEM or MOVE field is actively being searched.
//     TYPE-TO-SEARCH: focusing a field is search-ready; alphanumeric input opens + filters the
//     dropdown directly (prefix-first ranked); A opens it unfiltered (controller); arrows navigate,
//     Enter/A picks, B dismisses. (Ability + nature are CYCLED via hotkeys, not searched.)
//
// The handler consumes a plain {@linkcode ShowdownSetEditorConfig}; the flow wiring lives in
// StarterSelect (grid confirm -> editor -> Done writes the manifest). See showdown-editor-flow.test.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { isMegaStage, listEvolutionStages, listMegaStages } from "#data/elite-redux/showdown/showdown-evolutions";
import { SHOWDOWN_ITEM_POOL, type ShowdownItemKey } from "#data/elite-redux/showdown/showdown-item-pool";
import { collectShowdownLegalMoves, collectUnlockedEggMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import { rankByFilter } from "#data/elite-redux/showdown/showdown-search-normalize";
import {
  type MoveSearchMeta,
  matchesMoveSearch,
  parseMoveSearch,
} from "#data/elite-redux/showdown/showdown-search-operators";
import { exportShowdownSet, importShowdownSet } from "#data/elite-redux/showdown/showdown-set-codec";
import {
  listNamedSpeciesSets,
  type ShowdownNamedSet,
  saveNamedSpeciesSet,
} from "#data/elite-redux/showdown/showdown-species-sets";
import {
  fetchShowdownSpeciesSuggestions,
  isSpeciesSuggestionsConfigured,
  type ShowdownSpeciesSuggestion,
} from "#data/elite-redux/showdown/showdown-species-suggestions-client";
import { MEGA_STONE_ITEM, type ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { listWinningSets } from "#data/elite-redux/showdown/showdown-winning-sets";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { Button } from "#enums/buttons";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { getVariantIcon, getVariantTint, type Variant } from "#sprites/variant";
import { SettingKeyboard } from "#system/settings-keyboard";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getLocalizedSpriteKey } from "#utils/common";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";

// ---- public config (what the handler consumes) -----------------------------------------------

/** The mutable set being edited for one team slot. */
export interface ShowdownEditorSet {
  /** 0..2 - index into the fielded species' active-ability triple. */
  abilityIndex: number;
  /** A {@linkcode ShowdownItemKey} or the {@linkcode MEGA_STONE_ITEM} sentinel (mega auto-forced). */
  item: string;
  /** Four move slots (MoveId or null for an empty slot). */
  moves: (MoveId | null)[];
  /** A {@linkcode Nature}. */
  nature: number;
  /** Whether the fielded look is shiny. */
  shiny: boolean;
  /** Shiny variant tier (0..2); a black shiny (tier 4 in the selector) is unfieldable, stake-only. */
  variant: number;
}

/** The stage currently fielded (drives sprite / abilities / movepool - "everything follows the stage"). */
export interface ShowdownEditorStage {
  speciesId: number;
  formIndex: number;
}

/** Live collection/unlock state the editor gates its chips + panes against. */
export interface ShowdownEditorUnlocks {
  /** Owned shiny tiers, e.g. [0, 1]. A black shiny is tier 3 and always unfieldable. */
  ownedVariants: number[];
  /** Whether the line's black shiny is owned (shown as T4 but marked stake-only / unfieldable). */
  blackShinyOwned: boolean;
  /** Which of the fielded species' 3 active-ability slots are unlocked (0..2). */
  unlockedAbilityIndices: number[];
  /** Per-line egg-move unlock bitmask (`starterData[root].eggMoves`). */
  unlockedEggMoveBits: number;
  /** The team already fields its one allowed mega elsewhere (mega slot greyed). */
  megaBudgetSpent: boolean;
  /** Which team slot spent the mega budget (for the greyed reason line). */
  megaBudgetSpentBy?: string;
  /**
   * Which of the line's 3 INNATE (passive) slots are candy-UNLOCKED. On the player's own showdown
   * party a locked innate is genuinely INACTIVE (the player-side `hasPassive` candy gate), so the
   * editor shows the unlock cost truthfully. (The opponent's enemy-build activates all innates -
   * a pre-existing host/guest asymmetry, not corrected here.)
   */
  innateUnlockedSlots: number[];
  /** The candy cost to unlock each of the 3 innate slots (`getErPassiveSlotCandyCost`). */
  innateSlotCandyCosts: number[];
  /** Candies available on the line (`starterData[root].candyCount`) - shown next to a locked innate. */
  candyCount: number;
}

/** The whole editor config for one team slot. Plain data, so live wiring is trivial. */
export interface ShowdownSetEditorConfig {
  /** The starter LINE root (collection key). */
  rootSpeciesId: number;
  /** The currently fielded stage. */
  stage: ShowdownEditorStage;
  /** The set being edited. */
  set: ShowdownEditorSet;
  /** Whether the fielded mon is female (for the full front sprite). */
  female: boolean;
  /** Collection/unlock state. */
  unlocks: ShowdownEditorUnlocks;
  /** The 6-slot micro team strip; nulls are empty slots. */
  team: (ShowdownMonManifest | null)[];
  /** Which strip slot this editor is shaping (highlighted). */
  activeSlot: number;
  /** Pick-window seconds remaining (countdown placeholder). */
  pickSecondsLeft: number;
  /** Partner ready state (placeholder); null = not applicable. */
  partnerReady: boolean | null;
  /** Deterministic initial focus (for render recipes / restore). */
  initialField?: EditorField;
  /** Deterministic initial pane-open state (for render recipes). */
  initialPaneOpen?: boolean;
  /** Deterministic initial typeahead filter (for render recipes). */
  initialFilter?: string;
  /** Deterministic initial pane cursor (for render recipes). */
  initialPaneCursor?: number;
  /**
   * Committed the set (Done / Start). Receives the edited {@linkcode ShowdownEditorStage} +
   * {@linkcode ShowdownEditorSet} - the flow wiring writes them into the team manifest. Absent in
   * the render recipes (the demo config never commits), so pressing Done there is an inert no-op.
   */
  onDone?: (result: { stage: ShowdownEditorStage; set: ShowdownEditorSet }) => void;
  /**
   * Done-time re-validation. Given the edited stage + set, the flow builds the PROVISIONAL team (this
   * slot's edit applied) and runs the shared `validateShowdownTeam` rule engine, returning the FIRST
   * violation's message (mega budget, cost caps, black-shiny fieldability, item legality, ...) or null
   * when the whole set is legal. The editor REFUSES to commit while this returns a message, surfacing it
   * inline - so an invalid team can never be built SILENTLY (the ready-time validator stays the final net).
   */
  validate?: (result: { stage: ShowdownEditorStage; set: ShowdownEditorSet }) => string | null;
  /** Backed out (B / Cancel) with no commit - the flow returns to the grid, discarding edits. */
  onCancel?: () => void;
  /**
   * L/R team cycling (shoulders): switch the editor to the sibling already-picked team mon
   * (`dir` = -1 previous / +1 next). Absent when there is no sibling to cycle to.
   */
  onCycleTeam?: (dir: number) => void;
  /** EXPORT set: copy the given PS-format set text to the clipboard (production wires navigator.clipboard). */
  copyToClipboard?: (text: string) => void;
  /** Deterministic initial Set Menu view (for the render recipes): the menu / import / load / save sub-state. */
  initialSetMenu?: SetMenuView;
  /** Deterministic initial Set Menu paste buffer (import view render recipe). */
  initialSetMenuBuffer?: string;
  /** Deterministic initial Set Menu notice banner (export-confirmation / import-error render recipe). */
  initialSetMenuNotice?: string;
  /** Deterministic named-set list injected for the load-list render recipe (production reads localStorage). */
  demoNamedSets?: { name: string; text: string }[];
  /** Deterministic LOCAL winning-set texts for the Suggested-sets recipe (production reads localStorage). */
  demoWinningSets?: string[];
  /**
   * Deterministic COMMUNITY suggestions for the Suggested-sets recipe. When DEFINED the live telemetry
   * fetch is skipped and this exact list is used (production fetches from the er-telemetry worker).
   */
  demoCommunitySuggestions?: ShowdownSpeciesSuggestion[];
}

/**
 * The Set Menu sub-state: closed, the option list, the paste-import modal, the load list, the save-name
 * prompt, or the P3 "Suggested sets" list (your winning sets + community popular items).
 */
export type SetMenuView = "closed" | "menu" | "import" | "load" | "save" | "suggested";

/** One row in the Suggested-sets list: your own winning FULL set, or a community popular item+form. */
interface SuggestedEntry {
  /** Main label (species + item). */
  label: string;
  /** Secondary line (moves for a local set, or the win count for a community hint). */
  detail: string;
  /** Provenance tag shown as a small chip. */
  source: "yours" | "popular";
  /** Apply this suggestion to the editor's current set (same effect as Load set / stage cycle). */
  apply: () => void;
}

/** The edited result the flow wiring writes back into the team (stage + set). */
export interface ShowdownEditorResult {
  stage: ShowdownEditorStage;
  set: ShowdownEditorSet;
}

/**
 * The mobile bridge seam. On a touch device, focusing a searchable field raises the NATIVE
 * keyboard through a hidden DOM input (the same infra login/nickname use). P1 stubs this
 * behind the interface; the flow plugs a real implementation in via {@linkcode
 * ShowdownSetEditorUiHandler.setTextInput}. Keyboard/controller need none of this.
 */
export interface ShowdownEditorTextInput {
  /** Focus the hidden input and start feeding characters to {@linkcode onFilterChange}. */
  open(initial: string, onFilterChange: (value: string) => void): void;
  /** Blur + hide the hidden input. */
  close(): void;
}

// ---- focus graph ------------------------------------------------------------------------------

/**
 * The focusable field rows (right column). Their order IS the up/down focus order. Ability is
 * focusable but CYCLED (not searched); item + the four moves keep the type-to-search dropdown.
 * Nature is NOT a focus row in round 4 - it is cycled via the hotkey and shown as a chip.
 */
export enum EditorField {
  ABILITY = 0,
  ITEM = 1,
  MOVE0 = 2,
  MOVE1 = 3,
  MOVE2 = 4,
  MOVE3 = 5,
}
const FIELD_ORDER: EditorField[] = [
  EditorField.ABILITY,
  EditorField.ITEM,
  EditorField.MOVE0,
  EditorField.MOVE1,
  EditorField.MOVE2,
  EditorField.MOVE3,
];
const MOVE_FIELDS: EditorField[] = [EditorField.MOVE0, EditorField.MOVE1, EditorField.MOVE2, EditorField.MOVE3];

// ---- layout constants (logical px) ------------------------------------------------------------

const SCREEN_W = 320;
const SCREEN_H = 180;
const MARGIN = 3;

const STRIP_H = 20; // top team strip
const HOTKEY_Y = STRIP_H + 1; // 21
const HOTKEY_H = 11; // key-glyph legend bar
const BODY_Y = HOTKEY_Y + HOTKEY_H + 2; // 34

const LEFT_X = MARGIN; // 3
const LEFT_W = 104;
const RIGHT_X = LEFT_X + LEFT_W + MARGIN; // 110
const RIGHT_W = SCREEN_W - RIGHT_X - MARGIN; // 207

// The RIGHT column is windowed section panels (game-native nine-slice chrome) so the whole set reads
// at a glance: ABILITIES (1 active + 3 innates), ITEM (+ nature chip), MOVES (2x2 cells). The MOVE
// DESCRIPTION BAR pins the bottom. The search DROPDOWN floats ON TOP, only while an item/move field
// is actively being searched.
const ABIL_Y = BODY_Y; // 34
const ABIL_H = 58; // 34..92 - the 1 active + 3 innates block
const ITEM_Y = ABIL_Y + ABIL_H + 2; // 94
const ITEM_H = 20; // 94..114
const MOVES_Y = ITEM_Y + ITEM_H + 2; // 116
const MOVES_H = 44; // 116..160 - header + a 2x2 cell grid
const DESC_Y = MOVES_Y + MOVES_H + 2; // 162 - the persistent move-description bar
const DESC_H = SCREEN_H - DESC_Y - MARGIN; // 15 -> ends at 177

// The floating search dropdown (over the right column, drawn last). It stops ABOVE the move-desc bar
// so the highlighted move's description stays visible in that bar while navigating the dropdown.
const DROP_X = RIGHT_X;
const DROP_W = RIGHT_W;
const DROP_Y = ABIL_Y + 30;
const DROP_H = DESC_Y - DROP_Y - 1;

const ACCENT = 0x3d5a80; // focused-element fill
const ACCENT_SOFT = 0x24344f; // focused-in-search (a field is open in the dropdown)
const HEADER_BAND = 0x18233b; // dark navy band behind section headers (legible gold-on-dark)
const CELL_DIM = 0x16223d; // solid dark inset for field boxes / move cells (contrast on light windows)
const BAR_BG = 0x0e1626; // the cohesive dark bar behind the strip + hotkey legend
const SLOT_BG = 0x1c2740; // a team-strip slot frame's inset
const GOLD = 0xffd447; // focus / active accent edge

// Font sizes (the addTextObject default is a huge 96; dense screens run ~22-52).
const FONT_HDR = 34; // small section headers
const FONT_NAME = 40; // ability / move names
const FONT_TINY = 22; // dense innate / cell metadata
const FONT_CHIP = 30; // strip chips + shiny labels
const FONT_TITLE = 52; // species name

// ---- pure display helpers ---------------------------------------------------------------------

/** A move-pane row: the move, whether it is locked (egg move not yet unlocked), and the reason. */
interface MovePaneEntry {
  moveId: MoveId;
  name: string;
  locked: boolean;
  reason: string;
}

/** Short single-line label for a move's category. */
function categoryLabel(cat: MoveCategory): string {
  return MoveCategory[cat]?.charAt(0) ?? "?";
}

/** Map a `Move` onto the metadata the search operators read (`type:`/`bp>`/`acc=`/`cat:`/`pp<=`). */
function moveSearchMetaOf(move: {
  type: PokemonType;
  power: number;
  accuracy: number;
  category: MoveCategory;
  pp: number;
}): MoveSearchMeta {
  return { type: move.type, power: move.power, accuracy: move.accuracy, category: move.category, pp: move.pp };
}

// The separator-insensitive name normalization + typeahead ranking now live in the PURE
// `showdown-search-normalize` module so the PS-format text codec resolves names through the SAME
// comparison. Re-exported here (from the local import above) so existing importers - the
// search-matrix unit tests - keep resolving `rankByFilter` from this handler module unchanged.
export { rankByFilter };

export class ShowdownSetEditorUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  /** Transient children rebuilt on every render(). */
  private dynamic: Phaser.GameObjects.GameObject[] = [];

  private config: ShowdownSetEditorConfig | null = null;
  private field: EditorField = EditorField.ABILITY;
  private paneOpen = false;
  private paneCursor = 0;
  private paneScroll = 0;
  private filter = "";
  /** A pending Done-time rule violation (mega budget / cost cap / ...), shown inline until the set is fixed. */
  private validationError: string | null = null;
  private textInput: ShowdownEditorTextInput | null = null;
  /** The MULTILINE paste capture for the Set Menu's Import (separate from the single-line search/save input). */
  private pasteInput: ShowdownEditorTextInput | null = null;
  /** Full-sprite atlas keys already requested this session (avoid re-queuing the same async load). */
  private requestedSpriteKeys = new Set<string>();

  // ---- Set Menu (Save / Load / Export / Import a single set; STATS opens it) --------------------
  /** The Set Menu sub-state: closed / the option list / paste-import / load list / save-name prompt. */
  private setMenu: SetMenuView = "closed";
  /** Cursor within the Set Menu option list. */
  private setMenuCursor = 0;
  /** Cursor within the load list. */
  private setLoadCursor = 0;
  /** The named sets shown in the load list (snapshotted when the load view opens). */
  private setLoadList: ShowdownNamedSet[] = [];
  /** The import paste buffer / the save-name buffer (the active one depends on the view). */
  private setMenuBuffer = "";
  /** A transient Set Menu notice (export confirmation / import error), cleared on the next input. */
  private setMenuNotice: string | null = null;
  /** Cursor within the Suggested-sets list (P3). */
  private suggestedCursor = 0;
  /** The Suggested-sets list (your winning sets + community popular items), rebuilt when the view opens. */
  private suggestedList: SuggestedEntry[] = [];
  /** Community suggestions fetched from telemetry (null = not yet fetched / fetch in flight). */
  private communitySuggestions: ShowdownSpeciesSuggestion[] | null = null;
  /** Whether the community fetch is currently in flight (for the "Loading..." affordance). */
  private suggestedLoading = false;

  constructor() {
    super(UiMode.SHOWDOWN_SET_EDITOR);
  }

  /** The flow injects the mobile hidden-input bridge (keyboard/controller need none). */
  setTextInput(input: ShowdownEditorTextInput | null): void {
    this.textInput = input;
  }

  /** The flow injects the MULTILINE paste bridge for the Set Menu's Import (a `DomShowdownPasteInput`). */
  setPasteInput(input: ShowdownEditorTextInput | null): void {
    this.pasteInput = input;
  }

  setup(): void {
    const ui = this.getUi();
    // Full-screen handlers root at (0, -scaledCanvas.height) so the 0..180 logical band maps to
    // the visible screen (mirrors ShowdownWager / ErBargain / CommunityChallenges).
    this.container = globalScene.add.container(0, -globalScene.scaledCanvas.height).setName("showdown-set-editor");
    this.container.setVisible(false);
    ui.add(this.container);
  }

  override show(args: any[]): boolean {
    super.show(args);
    const config = (args?.[0] ?? null) as ShowdownSetEditorConfig | null;
    if (config == null) {
      return false;
    }
    this.config = config;
    // Shiny defaults to the HIGHEST owned rarity (maintainer: the small selector's default is your best
    // shiny on that mon). Display-scoped like the rest of the P1 shiny picker; R cycles down to off.
    if (!config.set.shiny && config.unlocks.ownedVariants.length > 0) {
      config.set.shiny = true;
      config.set.variant = Math.max(...config.unlocks.ownedVariants);
    }
    this.field = config.initialField ?? EditorField.ABILITY;
    // Ability is not searchable (it cycles), so a pane can only open on item/move fields.
    this.paneOpen = (config.initialPaneOpen ?? false) && this.fieldIsSearchable(this.field);
    this.filter = config.initialFilter ?? "";
    this.paneCursor = config.initialPaneCursor ?? 0;
    this.paneScroll = 0;
    this.validationError = null;
    // Set Menu (deterministic knobs for the render recipes; live opens fresh at STATS).
    this.setMenu = config.initialSetMenu ?? "closed";
    this.setMenuCursor = 0;
    this.setLoadCursor = 0;
    this.setLoadList = this.setMenu === "load" ? this.currentNamedSets() : [];
    this.setMenuBuffer = config.initialSetMenuBuffer ?? "";
    this.setMenuNotice = config.initialSetMenuNotice ?? null;
    // Suggested-sets view: seed from injected demo data (recipes) or the local winning sets.
    this.suggestedCursor = 0;
    this.communitySuggestions = config.demoCommunitySuggestions ?? null;
    this.suggestedLoading = false;
    this.suggestedList = [];
    if (this.setMenu === "suggested") {
      this.rebuildSuggestedList();
    }
    this.container.setVisible(true);
    if (this.paneOpen) {
      this.ensurePaneCursorVisible();
    }
    // The native capture is raised only when a search pane is actually open (see syncCapture).
    this.syncCapture();
    this.render();
    return true;
  }

  // ---- fielded-species accessors --------------------------------------------------------------

  private get fieldedSpecies() {
    return getPokemonSpecies(this.config!.stage.speciesId as SpeciesId);
  }

  private get isMega(): boolean {
    return isMegaStage(this.config!.stage.speciesId, this.config!.stage.formIndex);
  }

  /** The fielded species' three active-ability ids (may repeat / include NONE). */
  private activeAbilityIds(): number[] {
    const sp = this.fieldedSpecies;
    return [sp.ability1, sp.ability2, sp.abilityHidden];
  }

  /** The fielded species' three innate (passive) ability ids. */
  private innateAbilityIds(): number[] {
    return [...this.fieldedSpecies.getPassiveAbilities(this.config!.stage.formIndex)];
  }

  /** Whether a field uses the type-to-search dropdown (item + the four moves; ability cycles). */
  private fieldIsSearchable(field: EditorField): boolean {
    return field === EditorField.ITEM || MOVE_FIELDS.includes(field);
  }

  // ---- input ----------------------------------------------------------------------------------

  processInput(button: Button): boolean {
    if (this.config == null) {
      return false;
    }
    // The Set Menu (Save / Load / Export / Import) captures input while any of its views is open.
    if (this.setMenu !== "closed") {
      return this.processSetMenuInput(button);
    }
    return this.paneOpen ? this.processPaneInput(button) : this.processFieldInput(button);
  }

  private processFieldInput(button: Button): boolean {
    let handled = false;
    switch (button) {
      case Button.UP:
        handled = this.moveField(-1);
        break;
      case Button.DOWN:
        handled = this.moveField(1);
        break;
      case Button.LEFT:
        // LEFT/RIGHT ALWAYS cycle the fielded STAGE / form (sprite / abilities / movepool / stats all
        // follow) - the side buttons are never hijacked by the focused row. Ability cycles via E / A.
        handled = this.cycleStage(-1);
        break;
      case Button.RIGHT:
        handled = this.cycleStage(1);
        break;
      case Button.ACTION:
        // A searchable field opens its dropdown (controller path); the ability row cycles the active.
        handled = this.field === EditorField.ABILITY ? this.cycleActiveAbility(1) : this.openPane();
        break;
      case Button.SUBMIT:
        // Start = Done: re-validate the WHOLE set first (mega budget, cost caps, black-shiny
        // fieldability, item legality) and commit ONLY when it is legal - otherwise refuse with the
        // specific message inline, so the player can never SILENTLY build an invalid team.
        handled = this.tryCommit();
        break;
      case Button.CANCEL:
        // B = Back: discard and return to the grid (flow wiring).
        this.config!.onCancel?.();
        handled = true;
        break;
      case Button.MENU:
        // Escape: leave the editor to the grid. Consumed HERE so it can never bubble to the exposed
        // StarterSelect (where MENU maps to Start -> an empty versus battle - the reported softlock).
        this.config!.onCancel?.();
        handled = true;
        break;
      case Button.CYCLE_FORM:
        // F hotkey: cycle the fielded STAGE / form.
        handled = this.cycleStage(1);
        break;
      case Button.CYCLE_SHINY:
        // R hotkey: cycle the shiny tier (off -> owned tiers).
        handled = this.cycleShiny(1);
        break;
      case Button.CYCLE_ABILITY:
        // E hotkey: cycle the ACTIVE ability (from any field).
        handled = this.cycleActiveAbility(1);
        break;
      case Button.CYCLE_NATURE:
        // N hotkey: cycle the nature (recolors the stat bars live).
        handled = this.cycleNature(1);
        break;
      case Button.STATS:
        // Shoulder / C: open the SET MENU (Save / Load / Export / Import this one set). Team cycling stays
        // fully reachable on G (prev) / V (next), so repurposing the redundant shoulder loses nothing.
        handled = this.openSetMenu();
        break;
      case Button.CYCLE_GENDER:
        // G hotkey: PREVIOUS team mon (a keyboard-reachable partner to V; free key, no collision with the
        // F/R/E/N field hotkeys or the arrows, and printable-suppressed while typing).
        handled = this.cycleTeam(-1);
        break;
      case Button.CYCLE_TERA:
        // V hotkey: NEXT team mon.
        handled = this.cycleTeam(1);
        break;
    }
    if (handled) {
      this.getUi().playSelect();
    }
    return handled;
  }

  /** Switch which already-picked team mon the editor is shaping (G / V). No-op if unwired. */
  private cycleTeam(dir: number): boolean {
    if (this.config?.onCycleTeam == null) {
      return false;
    }
    this.config.onCycleTeam(dir);
    return true;
  }

  // ---- Set Menu: Save / Load / Export / Import this single set ---------------------------------

  private static readonly SET_MENU_OPTIONS = [
    "Export set",
    "Import set",
    "Save set",
    "Load set",
    "Suggested sets",
  ] as const;

  /** The current set as a wire manifest, so it can be exported / remembered / round-tripped through the codec. */
  private currentManifest(): ShowdownMonManifest {
    const cfg = this.config!;
    const moveset = cfg.set.moves.filter((m): m is MoveId => m != null);
    return {
      speciesId: cfg.stage.speciesId,
      formIndex: cfg.stage.formIndex,
      level: 100,
      shiny: cfg.set.shiny,
      variant: cfg.set.variant,
      abilityIndex: cfg.set.abilityIndex,
      nature: cfg.set.nature,
      ivs: [31, 31, 31, 31, 31, 31],
      moveset,
      item: cfg.set.item,
      rootSpeciesId: cfg.rootSpeciesId,
      erBlackShiny: false,
      baseCost: cfg.team[cfg.activeSlot]?.baseCost ?? 0,
    };
  }

  /** This species' named sets (production reads localStorage; the render recipe injects `demoNamedSets`). */
  private currentNamedSets(): ShowdownNamedSet[] {
    return this.config?.demoNamedSets ?? listNamedSpeciesSets(this.config!.rootSpeciesId);
  }

  /** STATS: open the Set Menu option list (closes any open search pane + native capture first). */
  private openSetMenu(): boolean {
    this.paneOpen = false;
    this.filter = "";
    this.syncCapture();
    this.setMenu = "menu";
    this.setMenuCursor = 0;
    this.setMenuNotice = null;
    this.render();
    return true;
  }

  private closeSetMenu(): void {
    this.setMenu = "closed";
    this.setMenuBuffer = "";
    this.setMenuNotice = null;
    this.pasteInput?.close();
    this.textInput?.close();
    this.render();
  }

  private processSetMenuInput(button: Button): boolean {
    switch (this.setMenu) {
      case "import":
        return this.processSetImportInput(button);
      case "save":
        return this.processSetSaveInput(button);
      case "load":
        return this.processSetLoadInput(button);
      case "suggested":
        return this.processSuggestedInput(button);
      default:
        return this.processSetMenuListInput(button);
    }
  }

  private processSetMenuListInput(button: Button): boolean {
    const n = ShowdownSetEditorUiHandler.SET_MENU_OPTIONS.length;
    switch (button) {
      case Button.UP:
        this.setMenuNotice = null;
        this.setMenuCursor = (this.setMenuCursor - 1 + n) % n;
        this.render();
        return true;
      case Button.DOWN:
        this.setMenuNotice = null;
        this.setMenuCursor = (this.setMenuCursor + 1) % n;
        this.render();
        return true;
      case Button.ACTION:
      case Button.SUBMIT:
        this.selectSetMenuOption();
        return true;
      case Button.CANCEL:
      case Button.MENU:
      case Button.STATS:
        this.closeSetMenu();
        this.getUi().playSelect();
        return true;
      default:
        return true; // swallow the field hotkeys while the menu is open
    }
  }

  private selectSetMenuOption(): void {
    switch (ShowdownSetEditorUiHandler.SET_MENU_OPTIONS[this.setMenuCursor]) {
      case "Export set":
        this.doExportSet();
        break;
      case "Import set":
        this.beginSetImport();
        break;
      case "Save set":
        this.beginSetSave();
        break;
      case "Load set":
        this.beginSetLoad();
        break;
      case "Suggested sets":
        this.beginSuggested();
        break;
    }
  }

  /** Export the current set to the clipboard + a confirmation notice (stays in the menu). */
  private doExportSet(): void {
    const text = exportShowdownSet(this.currentManifest());
    this.config!.copyToClipboard?.(text);
    this.setMenuNotice = "Copied this set to the clipboard.";
    this.getUi().playSelect();
    this.render();
  }

  // -- Import a pasted set into the editor ------------------------------------------------------

  private beginSetImport(): void {
    this.setMenu = "import";
    this.setMenuBuffer = "";
    this.setMenuNotice = null;
    this.pasteInput?.open("", value => {
      this.setMenuBuffer = value;
      this.render();
    });
    this.render();
  }

  private processSetImportInput(button: Button): boolean {
    switch (button) {
      case Button.ACTION:
      case Button.SUBMIT:
        this.submitSetImport();
        return true;
      case Button.CANCEL:
        if (this.setMenuBuffer.length > 0 && this.pasteInput != null) {
          return true; // the DOM input edits the buffer (back = delete a char)
        }
        this.pasteInput?.close();
        this.setMenu = "menu";
        this.render();
        return true;
      case Button.MENU:
        this.pasteInput?.close();
        this.setMenu = "menu";
        this.render();
        return true;
      default:
        return true;
    }
  }

  /** Parse the pasted set and apply it if it belongs to THIS line; otherwise explain per-mon. */
  private submitSetImport(): void {
    const parsed = importShowdownSet(this.setMenuBuffer);
    this.pasteInput?.close();
    if (parsed.manifest == null) {
      this.setMenu = "menu";
      this.setMenuNotice = parsed.errors[0]?.message ?? "Could not read that set.";
      this.getUi().playError();
      this.render();
      return;
    }
    const mon = parsed.manifest;
    // The editor edits ONE line: a pasted set for a different species can't be applied here.
    if (mon.rootSpeciesId !== this.config!.rootSpeciesId) {
      const name = getPokemonSpecies(mon.speciesId as SpeciesId)?.name ?? `#${mon.speciesId}`;
      this.setMenu = "menu";
      this.setMenuNotice = `That set is for ${name}, not this line.`;
      this.getUi().playError();
      this.render();
      return;
    }
    this.applyManifest(mon);
    this.setMenu = "closed";
    this.setMenuNotice = null;
    this.getUi().playSelect();
    this.render();
  }

  /** Overwrite the editor's stage + set from an imported/loaded manifest for THIS line. */
  private applyManifest(mon: ShowdownMonManifest): void {
    const cfg = this.config!;
    cfg.stage = { speciesId: mon.speciesId, formIndex: mon.formIndex };
    cfg.set.abilityIndex = Math.max(0, Math.min(mon.abilityIndex, 2));
    cfg.set.item = mon.item;
    cfg.set.nature = mon.nature ?? cfg.set.nature;
    cfg.set.moves = [0, 1, 2, 3].map(i => (mon.moveset[i] ?? null) as MoveId | null);
    // Shiny stays a per-mon identity pick unless the pasted variant is owned.
    if (mon.shiny && cfg.unlocks.ownedVariants.includes(mon.variant)) {
      cfg.set.shiny = true;
      cfg.set.variant = mon.variant;
    }
    this.validationError = null;
  }

  // -- Save the current set under a name --------------------------------------------------------

  private beginSetSave(): void {
    this.setMenu = "save";
    this.setMenuBuffer = "";
    this.setMenuNotice = null;
    this.textInput?.open("", value => {
      this.setMenuBuffer = value;
      this.render();
    });
    this.render();
  }

  private processSetSaveInput(button: Button): boolean {
    switch (button) {
      case Button.ACTION:
      case Button.SUBMIT:
        this.commitSetSave();
        return true;
      case Button.CANCEL:
        if (this.setMenuBuffer.length > 0 && this.textInput != null) {
          return true; // back = delete a char
        }
        this.textInput?.close();
        this.setMenu = "menu";
        this.render();
        return true;
      case Button.MENU:
        this.textInput?.close();
        this.setMenu = "menu";
        this.render();
        return true;
      default:
        return true;
    }
  }

  private commitSetSave(): void {
    const name = this.setMenuBuffer.trim();
    this.textInput?.close();
    if (name.length > 0) {
      saveNamedSpeciesSet(this.config!.rootSpeciesId, name, exportShowdownSet(this.currentManifest()));
      this.setMenuNotice = `Saved as "${name.slice(0, 24)}".`;
      this.getUi().playSelect();
    }
    this.setMenu = "menu";
    this.render();
  }

  // -- Load a named set -------------------------------------------------------------------------

  private beginSetLoad(): void {
    this.setLoadList = this.currentNamedSets();
    this.setLoadCursor = 0;
    this.setMenu = "load";
    this.setMenuNotice = null;
    this.render();
  }

  private processSetLoadInput(button: Button): boolean {
    const n = this.setLoadList.length;
    switch (button) {
      case Button.UP:
        if (n > 0) {
          this.setLoadCursor = (this.setLoadCursor - 1 + n) % n;
          this.render();
        }
        return true;
      case Button.DOWN:
        if (n > 0) {
          this.setLoadCursor = (this.setLoadCursor + 1) % n;
          this.render();
        }
        return true;
      case Button.ACTION:
      case Button.SUBMIT: {
        const entry = this.setLoadList[this.setLoadCursor];
        if (entry == null) {
          this.getUi().playError();
          return true;
        }
        const parsed = importShowdownSet(entry.text);
        if (parsed.manifest != null && parsed.manifest.rootSpeciesId === this.config!.rootSpeciesId) {
          this.applyManifest(parsed.manifest);
          this.closeSetMenu();
          this.getUi().playSelect();
        } else {
          this.setMenu = "menu";
          this.setMenuNotice = "That saved set no longer fits this line.";
          this.getUi().playError();
          this.render();
        }
        return true;
      }
      case Button.CANCEL:
      case Button.MENU:
        this.setMenu = "menu";
        this.render();
        return true;
      default:
        return true;
    }
  }

  // -- Suggested sets (P3): your winning sets (full) + community popular items (item+form overlay) ----

  /** This species' locally-recorded winning set texts (recipe injects `demoWinningSets`). */
  private currentWinningSets(): string[] {
    return this.config?.demoWinningSets ?? listWinningSets(this.config!.rootSpeciesId);
  }

  /** Open the Suggested-sets list: build the LOCAL half now, kick the async community fetch. */
  private beginSuggested(): void {
    this.setMenu = "suggested";
    this.suggestedCursor = 0;
    this.setMenuNotice = null;
    // A pinned demo list (recipe) is used verbatim; otherwise use whatever community data we already have.
    this.communitySuggestions = this.config?.demoCommunitySuggestions ?? this.communitySuggestions;
    this.rebuildSuggestedList();
    // Live fetch only when no demo list is pinned and telemetry is configured (silent degrade otherwise).
    if (this.config?.demoCommunitySuggestions === undefined && isSpeciesSuggestionsConfigured()) {
      this.suggestedLoading = this.communitySuggestions == null;
      const root = this.config!.rootSpeciesId;
      void fetchShowdownSpeciesSuggestions(root).then(list => {
        // Ignore a stale response (the editor moved to another species / closed the menu).
        if (this.config?.rootSpeciesId !== root) {
          return;
        }
        this.communitySuggestions = list;
        this.suggestedLoading = false;
        if (this.setMenu === "suggested") {
          this.rebuildSuggestedList();
          this.render();
        }
      });
    }
    this.render();
  }

  /** (Re)build the Suggested list from the local winning sets + the (maybe-fetched) community data. */
  private rebuildSuggestedList(): void {
    const cfg = this.config!;
    const entries: SuggestedEntry[] = [];

    // YOUR winning sets (full sets - real moves/ability/nature/item), most-recent first, capped.
    for (const text of this.currentWinningSets().slice(0, 5)) {
      const parsed = importShowdownSet(text);
      const mon = parsed.manifest;
      if (mon == null || mon.rootSpeciesId !== cfg.rootSpeciesId) {
        continue;
      }
      const speciesName = getPokemonSpecies(mon.speciesId as SpeciesId)?.name ?? `#${mon.speciesId}`;
      const moveNames = mon.moveset
        .map(id => allMoves[id]?.name)
        .filter(Boolean)
        .join(", ");
      entries.push({
        label: `${speciesName} @ ${this.itemName(mon.item as ShowdownItemKey)}`,
        detail: moveNames.length > 0 ? moveNames : "(no moves)",
        source: "yours",
        apply: () => this.applyManifest(mon),
      });
    }

    // COMMUNITY popular ITEM + FORM among winners (honest partial - overlays item+stage, keeps your moves).
    for (const s of this.communitySuggestions ?? []) {
      const speciesName = getPokemonSpecies(s.speciesId as SpeciesId)?.name ?? `#${s.speciesId}`;
      entries.push({
        label: `${speciesName} @ ${this.itemName(s.item as ShowdownItemKey)}`,
        detail: `${s.wins} recent win${s.wins === 1 ? "" : "s"}`,
        source: "popular",
        apply: () => this.applyCommunitySuggestion(s),
      });
    }

    this.suggestedList = entries;
    this.suggestedCursor = Math.min(this.suggestedCursor, Math.max(0, entries.length - 1));
  }

  /** Overlay a community suggestion: field the winning STAGE + ITEM, KEEPING the current moves/nature/ability. */
  private applyCommunitySuggestion(s: ShowdownSpeciesSuggestion): void {
    const cfg = this.config!;
    cfg.stage = { speciesId: s.speciesId, formIndex: s.formIndex };
    // A mega stage force-locks the stone; otherwise adopt the popular item.
    if (!isMegaStage(s.speciesId, s.formIndex)) {
      cfg.set.item = s.item;
    }
    this.validationError = null;
  }

  private processSuggestedInput(button: Button): boolean {
    const n = this.suggestedList.length;
    switch (button) {
      case Button.UP:
        if (n > 0) {
          this.suggestedCursor = (this.suggestedCursor - 1 + n) % n;
          this.render();
        }
        return true;
      case Button.DOWN:
        if (n > 0) {
          this.suggestedCursor = (this.suggestedCursor + 1) % n;
          this.render();
        }
        return true;
      case Button.ACTION:
      case Button.SUBMIT: {
        const entry = this.suggestedList[this.suggestedCursor];
        if (entry == null) {
          this.getUi().playError();
          return true;
        }
        entry.apply();
        this.closeSetMenu();
        this.getUi().playSelect();
        return true;
      }
      case Button.CANCEL:
      case Button.MENU:
        this.setMenu = "menu";
        this.render();
        return true;
      default:
        return true;
    }
  }

  private processPaneInput(button: Button): boolean {
    let handled = false;
    const rows = this.paneRowCount();
    switch (button) {
      case Button.UP:
        if (rows > 0) {
          this.paneCursor = (this.paneCursor - 1 + rows) % rows;
          this.ensurePaneCursorVisible();
          this.render();
          handled = true;
        }
        break;
      case Button.DOWN:
        if (rows > 0) {
          this.paneCursor = (this.paneCursor + 1) % rows;
          this.ensurePaneCursorVisible();
          this.render();
          handled = true;
        }
        break;
      case Button.ACTION:
        handled = this.selectPaneRow();
        break;
      case Button.CANCEL:
        // Back button INSIDE a search: while there is typed text this is "delete a character", so leave
        // it to the native/DOM input (which edits the filter) and do NOT close - matching the user's
        // "back should remove words, not take me out". With the query already empty (or on a controller
        // that never typed) there is nothing to delete, so it closes the dropdown back to browsing.
        if (this.filter.length > 0 && this.textInput != null) {
          handled = true; // consumed; the DOM input handles the character delete
        } else {
          this.closePane();
          handled = true;
        }
        break;
      case Button.MENU:
        // Escape ONLY exits the dropdown back to browsing the moves/items - it does NOT leave the editor.
        this.closePane();
        handled = true;
        break;
    }
    if (handled) {
      this.getUi().playSelect();
    }
    return handled;
  }

  private moveField(dir: number): boolean {
    const idx = FIELD_ORDER.indexOf(this.field);
    const next = (idx + dir + FIELD_ORDER.length) % FIELD_ORDER.length;
    this.field = FIELD_ORDER[next];
    // Moving to a new field (pane closed) drops any stale filter + native capture; the new field's own
    // search opens on demand (A / tap).
    this.filter = "";
    this.syncCapture();
    this.render();
    return true;
  }

  /**
   * Done: re-validate the WHOLE set and commit only when it is legal. A local mega-budget guard (the
   * editor already knows the team's spent budget) plus the flow's full {@linkcode
   * ShowdownSetEditorConfig.validate} rule-engine callback (cost caps, black-shiny fieldability, item
   * legality, duplicate/level/... across the provisional team) must BOTH pass; otherwise the first
   * violation is shown inline and NOTHING is committed. Consumes the input either way.
   */
  private tryCommit(): boolean {
    const cfg = this.config!;
    const result = { stage: cfg.stage, set: cfg.set };
    // Local, always-available guard first: never commit a second mega (matches the greyed stage strip).
    let error: string | null = this.stageLocked(cfg.stage) ? this.megaBudgetMessage() : null;
    // Full shared rule-engine re-validation over the provisional team, when the flow supplies it.
    error ??= cfg.validate?.(result) ?? null;
    if (error != null) {
      this.validationError = error;
      this.getUi().playError();
      this.render();
      return true;
    }
    this.validationError = null;
    cfg.onDone?.(result);
    return true;
  }

  /** The specific "second mega" refusal message (names the line that already spent the budget when known). */
  private megaBudgetMessage(): string {
    const by = this.config!.unlocks.megaBudgetSpentBy;
    return by
      ? `Team already fields a Mega (${by}) - only one Mega per team.`
      : "A team may include at most one Mega/Primal Pokemon.";
  }

  /** A stage the player cannot field: a mega/primal while the team's one mega budget is already spent. */
  private stageLocked(stage: ShowdownEditorStage): boolean {
    return isMegaStage(stage.speciesId, stage.formIndex) && this.config!.unlocks.megaBudgetSpent;
  }

  /**
   * LEFT/RIGHT cycles the fielded STAGE - sprite, abilities, movepool all follow. LOCKED stages (a second
   * mega when the team already fields one) are SKIPPED, so cycling can never LAND on a stage the set
   * validator would reject - closing the "cycle onto a second mega and confirm" bypass at the source.
   */
  private cycleStage(dir: number): boolean {
    const stages = this.allStages();
    const cur = stages.findIndex(
      s => s.speciesId === this.config!.stage.speciesId && s.formIndex === this.config!.stage.formIndex,
    );
    // Step in `dir`, skipping locked stages; stop after a full loop if every other stage is locked.
    let next = cur < 0 ? 0 : cur;
    let target = stages[next];
    let steps = 0;
    while (steps < stages.length) {
      next = (next + dir + stages.length) % stages.length;
      const candidate = stages[next];
      if (!this.stageLocked(candidate)) {
        target = candidate;
        break;
      }
      steps += 1;
    }
    if (target.speciesId === this.config!.stage.speciesId && target.formIndex === this.config!.stage.formIndex) {
      return false; // no other selectable stage to move to
    }
    // Cycling off the offending stage clears any pending "second mega" refusal banner.
    this.validationError = null;
    this.config!.stage = { speciesId: target.speciesId, formIndex: target.formIndex };
    // Mega auto-forces the item slot to the sentinel; leaving mega restores a real item.
    if (isMegaStage(target.speciesId, target.formIndex)) {
      this.config!.set.item = MEGA_STONE_ITEM;
    } else if (this.config!.set.item === MEGA_STONE_ITEM) {
      this.config!.set.item = SHOWDOWN_ITEM_POOL[0];
    }
    // A new stage can shift which active-ability slots are legal; keep the index in range.
    this.config!.set.abilityIndex = Math.max(0, Math.min(this.config!.set.abilityIndex, 2));
    this.render();
    return true;
  }

  /**
   * Cycle the ACTIVE ability among the fielded species' UNLOCKED actives (round-4 replacement for the
   * old search dropdown). Locked / NONE / duplicate slots are SKIPPED (a locked slot can't be fielded,
   * exactly as the old dropdown refused to pick it). Wraps; a no-op when only one active is selectable.
   */
  private cycleActiveAbility(dir: number): boolean {
    const selectable = this.selectableAbilityIndices();
    if (selectable.length <= 1) {
      return false;
    }
    const cur = selectable.indexOf(this.config!.set.abilityIndex);
    const nextPos = ((cur < 0 ? 0 : cur) + dir + selectable.length) % selectable.length;
    this.config!.set.abilityIndex = selectable[nextPos];
    this.render();
    return true;
  }

  /** The active-ability slot indices that can actually be fielded (unlocked + a real, distinct ability). */
  private selectableAbilityIndices(): number[] {
    const ids = this.activeAbilityIds();
    const unlocked = this.config!.unlocks.unlockedAbilityIndices;
    const seen = new Set<number>();
    const out: number[] = [];
    ids.forEach((id, i) => {
      if (!unlocked.includes(i) || id == null || seen.has(id)) {
        return;
      }
      seen.add(id);
      out.push(i);
    });
    return out.length > 0 ? out : [0];
  }

  /** R hotkey: cycle the shiny tier through OFF + the owned fieldable tiers (black T4 is never fielded). */
  private cycleShiny(dir: number): boolean {
    const states = this.fieldableShinyStates();
    if (states.length <= 1) {
      return false;
    }
    const set = this.config!.set;
    const cur = states.findIndex(s => s.shiny === set.shiny && (!s.shiny || s.variant === set.variant));
    const next = ((cur < 0 ? 0 : cur) + dir + states.length) % states.length;
    set.shiny = states[next].shiny;
    set.variant = states[next].variant;
    this.render();
    return true;
  }

  /** The ordered off/owned-tier states R cycles through (black shiny excluded - unfieldable). */
  private fieldableShinyStates(): { shiny: boolean; variant: number }[] {
    const owned = this.config!.unlocks.ownedVariants;
    const states: { shiny: boolean; variant: number }[] = [{ shiny: false, variant: 0 }];
    for (const tier of [0, 1, 2]) {
      if (owned.includes(tier)) {
        states.push({ shiny: true, variant: tier });
      }
    }
    return states;
  }

  /** N hotkey: cycle the nature (free pick). Recolors the stat bars live. */
  private cycleNature(dir: number): boolean {
    const natures = (Object.values(Nature).filter(n => typeof n === "number") as number[]).sort((a, b) => a - b);
    const cur = natures.indexOf(this.config!.set.nature);
    const next = ((cur < 0 ? 0 : cur) + dir + natures.length) % natures.length;
    this.config!.set.nature = natures[next];
    this.render();
    return true;
  }

  /**
   * Sync the text-input capture surface to the CURRENT state. The DOM/native input is focused ONLY while a
   * search DROPDOWN is actually open (`paneOpen` on a searchable field) - never merely because a searchable
   * field is FOCUSED. This is the fix for the "team-mon cycling (G/V) is dead in the editor" report:
   * while the capture holds focus, the inputs-controller suppresses EVERY printable key as a game button
   * (so typing a move name can't fire CYCLE_* mid-type) - which also kills the printable letter HOTKEYS
   * F / R / E / N (stage/shiny/ability/nature) and G / V (prev/next team mon). Gating the capture to the
   * open dropdown means those hotkeys stay live whenever the player is BROWSING (any field, pane closed),
   * and the capture is raised only once the player opens a search (ACTION / A on a searchable field) - and
   * released (blurred) the instant it closes (pick / Esc / field change), so it can never linger and
   * swallow the next hotkey.
   *
   * Navigation is unaffected: the game's Button inputs (arrows cycle the stage / move field focus, Esc
   * leaves, Enter commits) are delivered by Phaser and route through {@linkcode processInput}; the
   * off-screen capture surface only consumes printable characters into the typeahead WHILE the dropdown
   * is open. On any closed/non-searchable state the capture is dropped so the letter hotkeys stay live.
   * Headless: inert no-op (the rex factory is absent, so open/close do nothing).
   */
  private syncCapture(): void {
    if (this.paneOpen && this.fieldIsSearchable(this.field)) {
      this.textInput?.open(this.filter, value => this.setFilter(value));
    } else {
      this.textInput?.close();
    }
  }

  /**
   * CONTROLLER path (A on a focused searchable field): open the dropdown UNFILTERED with the current
   * value pre-highlighted. Keyboard/touch users never need this - they just type - but it also re-raises
   * the capture so they can immediately narrow.
   */
  private openPane(): boolean {
    if (!this.fieldIsSearchable(this.field)) {
      return false;
    }
    this.paneOpen = true;
    this.filter = "";
    this.paneCursor = this.currentPaneSelectionIndex();
    this.paneScroll = 0;
    this.ensurePaneCursorVisible();
    this.syncCapture();
    this.render();
    return true;
  }

  private closePane(): void {
    this.paneOpen = false;
    this.filter = "";
    // Drop the native keyboard now the search is closed; the game keyboard drives the bare field again.
    this.syncCapture();
    this.render();
  }

  /**
   * The single typeahead entry point - fed by the capture surface (desktop keyboard / mobile native
   * keyboard) AND the interaction tests. Typing on a focused searchable field IS the search: the first
   * character opens the dropdown with NO prior "browse"/A action, and each edit re-ranks (prefix-first)
   * to the top match. This is the round-3 input model, preserved for item + moves.
   */
  setFilter(value: string): void {
    if (!this.fieldIsSearchable(this.field)) {
      return;
    }
    this.filter = value;
    if (value.length > 0 && !this.paneOpen) {
      this.paneOpen = true; // typing opens the dropdown directly
    }
    this.paneCursor = 0; // the closest (prefix-first) match sits at the top, ready to Enter/click
    this.paneScroll = 0;
    this.render();
  }

  // ---- pane model -----------------------------------------------------------------------------

  private allStages(): ShowdownEditorStage[] {
    const root = this.config!.rootSpeciesId;
    const out: ShowdownEditorStage[] = listEvolutionStages(root).map(speciesId => ({ speciesId, formIndex: 0 }));
    for (const mega of listMegaStages(root)) {
      out.push({ speciesId: mega.speciesId, formIndex: mega.formIndex });
    }
    return out;
  }

  private moveEntries(): MovePaneEntry[] {
    const cfg = this.config!;
    // The EXACT canonical legal pool for the CURRENT fielded stage (the same `collectShowdownLegalMoves`
    // the validator accepts): every level-up / TM / tutor move of the fielded species + its pre-evolutions
    // (+ the ER-mega base), PLUS only the UNLOCKED egg moves. LOCKED egg moves are not offered at all
    // (maintainer: "the moves it can learn ... with the exception of egg moves i havent unlocked yet").
    // Derived from `cfg.stage.speciesId` on EVERY call, so cycling the stage re-pools the dropdown live.
    const legal = collectShowdownLegalMoves(
      cfg.rootSpeciesId,
      cfg.stage.speciesId,
      collectUnlockedEggMoves(cfg.rootSpeciesId, cfg.unlocks.unlockedEggMoveBits),
    );
    const list: MovePaneEntry[] = [];
    for (const moveId of legal) {
      const move = allMoves[moveId];
      if (move) {
        list.push({ moveId, name: move.name, locked: false, reason: "" });
      }
    }
    // Search operators (P3): `type:fire`, `cat:phys`, `bp>90`, `acc=100`, `pp<=10`. A filter with NO
    // recognized operator token parses to `operators: []`, so the plain path below stays BYTE-IDENTICAL.
    const parsed = parseMoveSearch(this.filter);
    if (parsed.operators.length > 0) {
      const filtered = list.filter(e => {
        const move = allMoves[e.moveId];
        return move != null && matchesMoveSearch(moveSearchMetaOf(move), parsed);
      });
      // Residual plain text still ranks the survivors by name (empty residual => alphabetical).
      return rankByFilter(filtered, e => e.name, parsed.residual);
    }
    return this.filter
      ? rankByFilter(list, e => e.name, this.filter)
      : list.sort((a, b) => a.name.localeCompare(b.name));
  }

  private itemKeys(): ShowdownItemKey[] {
    const keys = [...SHOWDOWN_ITEM_POOL];
    return this.filter
      ? rankByFilter(keys, k => this.itemName(k), this.filter)
      : keys.sort((a, b) => this.itemName(a).localeCompare(this.itemName(b)));
  }

  private itemName(key: ShowdownItemKey): string {
    const modType = modifierTypes[key];
    return modType == null ? String(key) : (getModifierType(modType).name ?? String(key));
  }

  private paneRowCount(): number {
    switch (this.field) {
      case EditorField.ITEM:
        return this.itemKeys().length;
      default:
        return this.moveEntries().length;
    }
  }

  /** Where the current set value sits in the pane list (so opening highlights it). */
  private currentPaneSelectionIndex(): number {
    const cfg = this.config!;
    switch (this.field) {
      case EditorField.ITEM:
        return Math.max(0, this.itemKeys().indexOf(cfg.set.item as ShowdownItemKey));
      default: {
        const slot = this.moveSlot();
        const cur = cfg.set.moves[slot];
        return cur == null
          ? 0
          : Math.max(
              0,
              this.moveEntries().findIndex(e => e.moveId === cur),
            );
      }
    }
  }

  private moveSlot(): number {
    return MOVE_FIELDS.indexOf(this.field);
  }

  private selectPaneRow(): boolean {
    const cfg = this.config!;
    switch (this.field) {
      case EditorField.ITEM: {
        if (this.isMega) {
          return false; // mega slot is locked to the stone
        }
        const key = this.itemKeys()[this.paneCursor];
        if (key == null) {
          return false;
        }
        cfg.set.item = key;
        break;
      }
      default: {
        const entry = this.moveEntries()[this.paneCursor];
        if (entry == null || entry.locked) {
          return false; // can't pick a locked egg move
        }
        cfg.set.moves[this.moveSlot()] = entry.moveId;
        break;
      }
    }
    this.closePane();
    return true;
  }

  private static readonly PANE_VISIBLE_ROWS = 6;

  private ensurePaneCursorVisible(): void {
    const visible = ShowdownSetEditorUiHandler.PANE_VISIBLE_ROWS;
    if (this.paneCursor < this.paneScroll) {
      this.paneScroll = this.paneCursor;
    } else if (this.paneCursor >= this.paneScroll + visible) {
      this.paneScroll = this.paneCursor - visible + 1;
    }
    this.paneScroll = Math.max(0, Math.min(this.paneScroll, Math.max(0, this.paneRowCount() - visible)));
  }

  // ---- rendering ------------------------------------------------------------------------------

  private clearDynamic(): void {
    for (const o of this.dynamic) {
      o.destroy();
    }
    this.dynamic = [];
  }

  private add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.container.add(obj);
    this.dynamic.push(obj);
    return obj;
  }

  private text(
    x: number,
    y: number,
    content: string,
    style: TextStyle,
    originX = 0,
    fontSize = FONT_TINY,
  ): Phaser.GameObjects.Text {
    const t = addTextObject(x, y, content, style, { fontSize: `${fontSize}px` });
    t.setOrigin(originX, 0);
    return this.add(t);
  }

  private fill(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.add(globalScene.add.rectangle(x, y, w, h, color, alpha).setOrigin(0, 0));
  }

  /** A 1px outline rectangle (four thin fills) - used for slot / chip / cell frames. */
  private outline(x: number, y: number, w: number, h: number, color: number): void {
    this.fill(x, y, w, 1, color, 1);
    this.fill(x, y + h - 1, w, 1, color, 1);
    this.fill(x, y, 1, h, color, 1);
    this.fill(x + w - 1, y, 1, h, color, 1);
  }

  private render(): void {
    if (this.config == null) {
      return;
    }
    this.clearDynamic();

    // Full dim backdrop so the whole thing reads as one composed screen.
    this.fill(0, 0, SCREEN_W, SCREEN_H, 0x05070f, 1);

    this.renderStrip();
    this.renderHotkeyBar();
    this.renderIdentityColumn();
    this.renderAbilitiesPanel();
    this.renderItemPanel();
    this.renderMovesPanel();
    this.renderMoveDescBar();
    // The search dropdown is drawn LAST so it floats ON TOP of the set (only while actively searching).
    if (this.paneOpen) {
      this.renderDropdown();
    }
    // A Done-time rule refusal (second mega, cost cap, ...) floats above everything until the set is fixed.
    if (this.validationError != null) {
      this.renderValidationBanner();
    }
    // The Set Menu (Save / Load / Export / Import) draws over everything while open.
    if (this.setMenu !== "closed") {
      this.renderSetMenu();
    }
  }

  // -- Set Menu overlays ------------------------------------------------------------------------

  private renderSetMenu(): void {
    this.fill(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.6);
    if (this.setMenu === "import") {
      this.renderSetImportModal();
      return;
    }
    if (this.setMenu === "save") {
      this.renderSetSaveModal();
      return;
    }
    if (this.setMenu === "load") {
      this.renderSetLoadList();
      return;
    }
    if (this.setMenu === "suggested") {
      this.renderSuggestedList();
      return;
    }
    this.renderSetMenuList();
  }

  /** The Suggested-sets list: your winning sets + community popular items (P3). */
  private renderSuggestedList(): void {
    const bw = 232;
    const rows = Math.max(1, Math.min(this.suggestedList.length, 6));
    const bh = 26 + rows * 16;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x0d1524, 1);
    this.text(bx + 8, by + 5, "SUGGESTED SETS", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    if (this.suggestedList.length === 0) {
      const empty = this.suggestedLoading ? "Loading suggestions..." : "No suggestions yet - win some matches!";
      this.text(bx + 8, by + 18, empty, TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    } else {
      this.suggestedList.slice(0, 6).forEach((entry, i) => {
        const ly = by + 15 + i * 16;
        const focused = i === this.suggestedCursor;
        this.fill(bx + 6, ly, bw - 12, 14, focused ? ACCENT : CELL_DIM, 1);
        if (focused) {
          this.fill(bx + 6, ly, 2, 14, GOLD, 1);
        }
        // Provenance chip (YOURS gold / POPULAR blue).
        const chip = entry.source === "yours" ? "YOURS" : "POPULAR";
        const chipW = chip.length * 3.0 + 6;
        this.fill(bx + bw - 12 - chipW, ly + 1, chipW, 6, entry.source === "yours" ? 0x3a2f0d : 0x0d2338, 1);
        this.text(
          bx + bw - 9 - chipW,
          ly,
          chip,
          entry.source === "yours" ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_BLUE,
          0,
          FONT_TINY,
        );
        this.text(
          bx + 12,
          ly + 1,
          this.clip(entry.label, 34),
          focused ? TextStyle.SUMMARY_GOLD : TextStyle.WINDOW,
          0,
          FONT_TINY,
        );
        this.text(bx + 12, ly + 8, this.clip(entry.detail, 44), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
      });
    }
    this.text(bx + 8, by + bh - 9, "Enter: apply    Esc: back", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

  private renderSetMenuList(): void {
    const bw = 140;
    const opts = ShowdownSetEditorUiHandler.SET_MENU_OPTIONS;
    const bh = 26 + opts.length * 12;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x0d1524, 1);
    this.text(bx + 8, by + 5, "SET MENU", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    opts.forEach((opt, i) => {
      const oy = by + 16 + i * 12;
      const focused = i === this.setMenuCursor;
      this.fill(bx + 6, oy, bw - 12, 10, focused ? ACCENT : CELL_DIM, 1);
      if (focused) {
        this.fill(bx + 6, oy, 2, 10, GOLD, 1);
      }
      this.text(bx + 12, oy + 2, opt, focused ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    });
    const footer = this.setMenuNotice ?? "Enter: choose    Esc: close";
    this.text(
      bx + 8,
      by + bh - 9,
      this.clip(footer, 44),
      this.setMenuNotice ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY,
      0,
      FONT_TINY,
    );
  }

  private renderSetImportModal(): void {
    const bw = 240;
    const bh = 92;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x0d1524, 1);
    this.text(bx + 8, by + 5, "IMPORT SET", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(bx + 8, by + 14, "Paste one Showdown set for this line.", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    const fieldY = by + 24;
    const fieldH = bh - 24 - 12;
    this.fill(bx + 8, fieldY, bw - 16, fieldH, CELL_DIM, 1);
    this.outline(bx + 8, fieldY, bw - 16, fieldH, GOLD);
    const lines = (this.setMenuBuffer.length > 0 ? this.setMenuBuffer : "(paste here)").split("\n").slice(0, 6);
    lines.forEach((ln, i) => {
      const style = this.setMenuBuffer.length > 0 ? TextStyle.WINDOW : TextStyle.SHADOW_TEXT;
      const caret = this.setMenuBuffer.length > 0 && i === lines.length - 1 ? "_" : "";
      this.text(bx + 11, fieldY + 2 + i * 7, this.clip(`${ln}${caret}`, 74), style, 0, FONT_TINY);
    });
    this.text(bx + 8, by + bh - 9, "Enter: import    Esc: back", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

  private renderSetSaveModal(): void {
    const bw = 200;
    const bh = 40;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x0d1524, 1);
    this.text(bx + 8, by + 5, "SAVE SET AS", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.fill(bx + 8, by + 16, bw - 16, 12, CELL_DIM, 1);
    this.outline(bx + 8, by + 16, bw - 16, 12, GOLD);
    const shown = this.setMenuBuffer.length > 0 ? this.setMenuBuffer : "Set";
    this.text(bx + 12, by + 18, `${this.clip(shown, 30)}_`, TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(bx + 8, by + 30, "Enter: save    Esc: back", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

  private renderSetLoadList(): void {
    const bw = 200;
    const rows = Math.max(1, Math.min(this.setLoadList.length, 6));
    const bh = 24 + rows * 11;
    const bx = (SCREEN_W - bw) / 2;
    const by = (SCREEN_H - bh) / 2;
    this.add(addWindow(bx, by, bw, bh));
    this.fill(bx + 2, by + 2, bw - 4, bh - 4, 0x0d1524, 1);
    this.text(bx + 8, by + 5, "LOAD SET", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    if (this.setLoadList.length === 0) {
      this.text(bx + 8, by + 18, "No saved sets for this line yet.", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    } else {
      this.setLoadList.slice(0, 6).forEach((entry, i) => {
        const ly = by + 15 + i * 11;
        const focused = i === this.setLoadCursor;
        this.fill(bx + 6, ly, bw - 12, 9, focused ? ACCENT : CELL_DIM, 1);
        if (focused) {
          this.fill(bx + 6, ly, 2, 9, GOLD, 1);
        }
        this.text(
          bx + 12,
          ly + 1,
          this.clip(entry.name, 30),
          focused ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_GRAY,
          0,
          FONT_TINY,
        );
      });
    }
    this.text(bx + 8, by + bh - 9, "Enter: load    Esc: back", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

  /** A centered red refusal banner shown when Done is rejected - the specific rule message. */
  private renderValidationBanner(): void {
    const bh = 16;
    const by = (SCREEN_H - bh) / 2;
    this.fill(0, by - 2, SCREEN_W, bh + 4, 0x000000, 0.55);
    this.fill(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, 0x3a0d12, 0.98);
    this.outline(MARGIN, by, SCREEN_W - 2 * MARGIN, bh, 0xe86464);
    this.text(
      SCREEN_W / 2,
      by + 4,
      this.clip(`Cannot save - ${this.validationError ?? ""}`, 100),
      TextStyle.SUMMARY_RED,
      0.5,
      FONT_TINY,
    );
  }

  // -- top team strip (redesigned: one cohesive dark bar) ---------------------------------------

  private renderStrip(): void {
    const cfg = this.config!;
    // A single cohesive dark bar (not a light window) with a thin top edge - ties the whole screen's
    // dark chrome together (the round-3 light band read as "ugly").
    this.fill(0, 0, SCREEN_W, STRIP_H, BAR_BG, 1);
    this.fill(0, 0, SCREEN_W, 1, 0x2a3a5c, 1);

    // 6 FRAMED slot icons - a proper inset frame each, the active slot gold-framed + brighter.
    const slotW = 16;
    const slotH = 16;
    const slotY = 2;
    const startX = 3;
    for (let i = 0; i < 6; i++) {
      const x = startX + i * (slotW + 1);
      const active = i === cfg.activeSlot;
      this.fill(x, slotY, slotW, slotH, active ? ACCENT : SLOT_BG, 1);
      this.outline(x, slotY, slotW, slotH, active ? GOLD : 0x33436a);
      const mon = cfg.team[i];
      if (mon == null) {
        this.text(x + slotW / 2, slotY + 4, "-", TextStyle.SUMMARY_GRAY, 0.5, FONT_CHIP);
        continue;
      }
      this.renderStripIcon(mon, x + slotW / 2, slotY + 1);
    }

    // Validity chips - one uniform pill style (a dark pill + colored dot + colored label), no more
    // flat green/red rectangles.
    const size = cfg.team.filter(m => m != null).length;
    const megaCount = cfg.team.filter(m => m != null && isMegaStage(m.speciesId, m.formIndex)).length;
    const highCost = cfg.team.filter(m => m != null && m.baseCost >= 8 && m.baseCost < 10).length;
    let cx = startX + 6 * (slotW + 1) + 4;
    cx = this.chip(cx, `Team ${size}/6`, size >= 1 && size <= 6);
    cx = this.chip(cx, `Mega ${megaCount}/1`, megaCount <= 1);
    this.chip(cx, `Cost8+ ${highCost}/1`, highCost <= 1);

    // Opponent-ready status (right), in the same pill language. The pick countdown/timer was removed
    // per maintainer request.
    const foe = cfg.partnerReady == null ? "Foe -" : cfg.partnerReady ? "Foe READY" : "Foe waiting";
    const foeW = foe.length * 3.0 + 10;
    const foeX = SCREEN_W - 3 - foeW;
    this.fill(foeX, 4, foeW, 12, HEADER_BAND, 1);
    this.outline(foeX, 4, foeW, 12, cfg.partnerReady ? 0x2f6d4a : 0x33436a);
    this.fill(foeX + 3, 8, 3, 3, cfg.partnerReady ? 0x4bd08a : 0x8a94a6, 1);
    this.text(foeX + 8, 6, foe, cfg.partnerReady ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY, 0, FONT_CHIP);
  }

  private chip(x: number, label: string, ok: boolean): number {
    const w = label.length * 3.0 + 10;
    this.fill(x, 4, w, 12, HEADER_BAND, 1);
    this.outline(x, 4, w, 12, ok ? 0x2f6d4a : 0x8a3030);
    this.fill(x + 3, 8, 3, 3, ok ? 0x4bd08a : 0xe86464, 1); // status dot
    this.text(x + 8, 6, label, ok ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_RED, 0, FONT_CHIP);
    return x + w + 3;
  }

  private renderStripIcon(mon: ShowdownMonManifest, cx: number, y: number): void {
    const species = getPokemonSpecies(mon.speciesId as SpeciesId);
    if (species == null) {
      return;
    }
    const wantId = species.getIconId(false, mon.formIndex, mon.shiny, mon.variant);
    const icon = globalScene.add
      .sprite(cx, y, species.getIconAtlasKey(mon.formIndex, mon.shiny, mon.variant))
      .setOrigin(0.5, 0)
      .setScale(0.44);
    icon.setFrame(wantId);
    if (icon.frame.name !== wantId) {
      const baseId = species.getIconId(false, mon.formIndex, false, 0);
      if (icon.texture.has(baseId)) {
        icon.setFrame(baseId);
      }
    }
    this.add(icon);
  }

  // -- hotkey legend bar (real key-glyph icons) -------------------------------------------------

  private renderHotkeyBar(): void {
    this.fill(0, HOTKEY_Y, SCREEN_W, HOTKEY_H, BAR_BG, 1);
    this.fill(0, HOTKEY_Y, SCREEN_W, 1, 0x1a2740, 1);
    // The per-mon functions that exist in the editor, each with its real key glyph (mirrors the
    // functions starter select exposes: form/stage, shiny, ability, nature). Directional cycling
    // (LEFT/RIGHT) also drives stage + ability, but the hotkeys give a discoverable, bindable path.
    let x = 4;
    x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_FORM, "F.png", "Stage");
    x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_SHINY, "R.png", "Shiny");
    x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_ABILITY, "E.png", "Ability");
    x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_NATURE, "N.png", "Nature");
    // Switch which already-picked team mon is being shaped (G = prev, V = next) - only when the flow
    // wired team cycling (a live build with >1 slot). Discoverable keyboard partners to the shoulders.
    if (this.config?.onCycleTeam != null) {
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_GENDER, "G.png", "Prev");
      x = this.hotkey(x, SettingKeyboard.BUTTON_CYCLE_TERA, "V.png", "Next Mon");
    }
    // The SET MENU (Save / Load / Export / Import this set) on the STATS shoulder / C.
    this.hotkey(x, SettingKeyboard.BUTTON_STATS, "C.png", "Sets");
    // Leave + commit hints on the right (Esc = back out to the grid; Enter = commit). These use WIDE
    // glyphs (ESC / ENTER), so their labels sit further right than the narrow-letter hotkeys.
    const doneW = "Done".length * 3.0 + 22;
    this.hotkeyRight(SCREEN_W - 3, "ENTER.png", "Done", doneW);
    this.hotkeyRight(SCREEN_W - 3 - doneW - 4, "ESC.png", "Leave", "Leave".length * 3.0 + 22);
  }

  /** Draw a key glyph + label, returning the next x. Uses the game's "keyboard" atlas (frame = key). */
  private hotkey(x: number, setting: SettingKeyboard, defaultFrame: string, label: string): number {
    const frame = this.keyFrame(setting, defaultFrame);
    const glyph = globalScene.add
      .sprite(x, HOTKEY_Y + 6, "keyboard", frame)
      .setOrigin(0, 0.5)
      .setScale(0.5);
    this.add(glyph);
    this.text(x + 11, HOTKEY_Y + 3, label, TextStyle.INSTRUCTIONS_TEXT, 0, FONT_TINY);
    return x + 11 + label.length * 3.0 + 7;
  }

  /** Right-anchored key glyph + label (wide ESC / ENTER glyphs, so the label offset is larger). */
  private hotkeyRight(rightX: number, defaultFrame: string, label: string, width: number): void {
    const x = rightX - width;
    const glyph = globalScene.add
      .sprite(x, HOTKEY_Y + 6, "keyboard", defaultFrame)
      .setOrigin(0, 0.5)
      .setScale(0.5);
    this.add(glyph);
    this.text(x + 16, HOTKEY_Y + 3, label, TextStyle.INSTRUCTIONS_TEXT, 0, FONT_TINY);
  }

  /** Resolve the bound key glyph frame for a setting (falls back to the default in headless). */
  private keyFrame(setting: SettingKeyboard, defaultFrame: string): string {
    try {
      const icon = (globalScene as any).inputController?.getIconForLatestInputRecorded?.(setting);
      if (typeof icon === "string" && globalScene.textures.get("keyboard")?.has?.(icon)) {
        return icon;
      }
    } catch {
      // headless / no controller - use the deterministic default frame.
    }
    return defaultFrame;
  }

  // -- left identity column ---------------------------------------------------------------------

  private renderIdentityColumn(): void {
    const cfg = this.config!;
    this.add(addWindow(LEFT_X, BODY_Y, LEFT_W, SCREEN_H - BODY_Y - 2));

    const sp = this.fieldedSpecies;
    // Header band: species NAME (left, clipped so it never runs into the cost) + a distinct COST badge
    // (right) - a bordered pill so the cost reads as its own tag, on a dark band with a thin gold underline.
    const rootCost = cfg.team[cfg.activeSlot]?.baseCost ?? 0;
    this.fill(LEFT_X + 2, BODY_Y + 2, LEFT_W - 4, 15, HEADER_BAND, 1);
    this.fill(LEFT_X + 2, BODY_Y + 16, LEFT_W - 4, 1, 0x4a5a80, 1);
    const costText = `Cost ${rootCost}`;
    const costW = costText.length * 3.0 + 6;
    const costX = LEFT_X + LEFT_W - 4 - costW;
    this.fill(costX, BODY_Y + 4, costW, 10, CELL_DIM, 1);
    this.outline(costX, BODY_Y + 4, costW, 10, 0x4a5a80);
    this.text(costX + 3, BODY_Y + 5, costText, TextStyle.SUMMARY_GOLD, 0, FONT_TINY);
    this.text(LEFT_X + 6, BODY_Y + 3, this.clip(sp.name, 11), TextStyle.SUMMARY_GOLD, 0, FONT_TITLE);

    // Identity column vertical rhythm (clean, non-overlapping at 1080p): sprite -> type chips ->
    // STAGE strip -> BASE STATS, each with its own band and a few px of breathing room.
    // The FULL front battle sprite (item 2) - the game's full-scale art, sized around this column. It is
    // seated a little lower + slightly smaller than before so tall sprites (raised-claw mons, spread
    // wings) clear the NAME band above and the type chips below instead of bleeding into them.
    const spriteCx = LEFT_X + LEFT_W / 2;
    const spriteCy = BODY_Y + 40;
    this.renderFullSprite(spriteCx, spriteCy);
    // Shinyness is shown ONLY by 4 cyclable shiny symbols tucked into the sprite's corner (item 3 /
    // maintainer follow-up) - no separate shiny row.
    this.renderSpriteShinyCorner(spriteCx, spriteCy);

    // Type chips under the sprite.
    this.renderTypeChips(spriteCx, BODY_Y + 62);

    // Stage strip (inline header) - sits clear below the type chips.
    this.renderStageStrip(BODY_Y + 70);

    // Base stat bars with nature +/- coloring (item 4) - starts below the stage strip, not over it.
    this.renderStatBars(BODY_Y + 96);
  }

  /**
   * The FULL front battle sprite (not the small icon). Loads the species' front atlas and pins the
   * first frame - a static portrait that follows stage / shiny / variant. In the render harness the
   * repointed `loadPokemonAtlas` injects synchronously (so the same pass shows it); in the live game
   * the async load re-renders on completion (icon fallback shown meanwhile).
   */
  private renderFullSprite(cx: number, cy: number): void {
    const cfg = this.config!;
    const sp = this.fieldedSpecies;
    const female = cfg.female;
    const formIndex = cfg.stage.formIndex;
    const shiny = cfg.set.shiny;
    const variant = cfg.set.variant as Variant;
    const key = sp.getSpriteKey(female, formIndex, shiny, variant);
    const atlasPath = sp.getSpriteAtlasPath(female, formIndex, shiny, variant);
    if (!globalScene.textures.exists(key) && !this.requestedSpriteKeys.has(key)) {
      this.requestedSpriteKeys.add(key);
      globalScene.loadPokemonAtlas(key, atlasPath);
      void sp
        .loadAssets(female, formIndex, shiny, variant, true, false, true)
        .then(() => {
          this.requestedSpriteKeys.delete(key);
          if (this.config != null) {
            this.render();
          }
        })
        .catch(() => {
          this.requestedSpriteKeys.delete(key);
        });
    }
    if (globalScene.textures.exists(key)) {
      const spr = globalScene.add.sprite(cx, cy, key).setOrigin(0.5, 0.5).setScale(0.4);
      const frames = globalScene.textures.get(key).getFrameNames();
      if (frames.length > 0) {
        spr.setFrame(frames.slice().sort()[0]);
      }
      this.add(spr);
      return;
    }
    // Live fallback while the atlas loads: the always-loaded icon, enlarged, so the panel is never blank.
    const wantId = sp.getIconId(false, formIndex, shiny, variant);
    const icon = globalScene.add
      .sprite(cx, cy, sp.getIconAtlasKey(formIndex, shiny, variant))
      .setOrigin(0.5, 0.5)
      .setScale(1.6);
    icon.setFrame(wantId);
    if (icon.frame.name !== wantId && icon.texture.has(sp.getIconId(false, 0, false, 0))) {
      icon.setFrame(sp.getIconId(false, 0, false, 0));
    }
    this.add(icon);
  }

  private renderTypeChips(cx: number, y: number): void {
    const sp = this.fieldedSpecies;
    const types = [sp.type1, sp.type2].filter(t => t != null) as PokemonType[];
    const startX = cx - (types.length * 15) / 2;
    types.forEach((t, i) => {
      const spr = globalScene.add
        .sprite(startX + i * 15 + 7, y, getLocalizedSpriteKey("types"), PokemonType[t].toLowerCase())
        .setOrigin(0.5, 0.5)
        .setScale(0.5);
      this.add(spr);
    });
  }

  private renderStageStrip(y: number): void {
    const cfg = this.config!;
    this.text(LEFT_X + 4, y, "STAGE", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const stages = this.allStages();
    const startX = LEFT_X + 10;
    const stepX = 16;
    stages.forEach((stage, i) => {
      const x = startX + i * stepX;
      const isCurrent = stage.speciesId === cfg.stage.speciesId && stage.formIndex === cfg.stage.formIndex;
      const mega = isMegaStage(stage.speciesId, stage.formIndex);
      const greyed = mega && cfg.unlocks.megaBudgetSpent && !isCurrent;
      if (isCurrent) {
        this.fill(x - 7, y + 7, 14, 14, ACCENT, 1);
        this.outline(x - 7, y + 7, 14, 14, GOLD);
      }
      const sp = getPokemonSpecies(stage.speciesId as SpeciesId);
      const wantId = sp.getIconId(false, stage.formIndex, false, 0);
      const icon = globalScene.add
        .sprite(x, y + 8, sp.getIconAtlasKey(stage.formIndex, false, 0))
        .setOrigin(0.5, 0)
        .setScale(0.42);
      icon.setFrame(wantId);
      if (icon.frame.name !== wantId) {
        icon.setFrame(sp.getIconId(false, 0, false, 0));
      }
      icon.setAlpha(greyed ? 0.35 : 1);
      this.add(icon);
      if (mega) {
        this.text(x - 7, y + 5, "M", greyed ? TextStyle.SUMMARY_GRAY : TextStyle.SUMMARY_GOLD, 0, 26);
      }
    });
    if (cfg.unlocks.megaBudgetSpent) {
      this.text(
        LEFT_X + 4,
        y + 24,
        `Mega used: ${cfg.unlocks.megaBudgetSpentBy ?? "team"}`,
        TextStyle.SUMMARY_GRAY,
        0,
        FONT_TINY,
      );
    }
  }

  // -- single colour-coded shiny star in the sprite corner (exactly starter select) --------------
  // Like starter select's `pokemonShinyIcon`: ONE shiny star whose COLOUR encodes the tier
  // (getVariantTint - T1 gold / T2 cyan / T3 red). Shown only when shiny; R cycles off -> owned
  // tiers (default = highest owned). No star at all when not shiny.

  private renderSpriteShinyCorner(cx: number, cy: number): void {
    const cfg = this.config!;
    if (!cfg.set.shiny) {
      return;
    }
    const star = globalScene.add
      .sprite(cx + 22, cy - 14, "shiny_icons")
      .setOrigin(0.5, 0.5)
      .setScale(0.55);
    star.setFrame(getVariantIcon(cfg.set.variant as Variant));
    star.setTint(getVariantTint(cfg.set.variant as Variant));
    this.add(star);
  }

  // -- BASE stat bars (item 4) with nature +/- coloring -----------------------------------------

  private renderStatBars(y: number): void {
    const cfg = this.config!;
    const sp = this.fieldedSpecies;
    // ER megas/primals are FORMS on the base species (listMegaStages -> {speciesId, formIndex}), and
    // each form carries its OWN baseStats. Read the fielded FORM's stats, not the species-level (form 0)
    // ones, so Mega Venusaur shows its mega spread rather than base Venusaur's.
    const formIndex = cfg.stage.formIndex;
    const statSource =
      sp.forms.length > 0 && sp.forms[formIndex]?.baseStats ? sp.forms[formIndex].baseStats : sp.baseStats;
    this.text(LEFT_X + 4, y, "BASE STATS", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const labels = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
    const barX = LEFT_X + 24;
    const barMaxW = 46;
    const rowH = 5; // keeps all six rows (through Spe) clear of the panel bottom
    const nature = cfg.set.nature as Nature;
    PERMANENT_STATS.forEach((stat, i) => {
      const ry = y + 9 + i * rowH;
      const base = statSource[i]; // BASE stat of the fielded FORM, not a computed L100 value.
      const mult = stat === Stat.HP ? 1 : getNatureStatMultiplier(nature, stat);
      const color = mult > 1 ? 0xf08aa0 : mult < 1 ? 0x8aa0f0 : 0x8ad08a;
      const labelStyle = mult > 1 ? TextStyle.SUMMARY_PINK : mult < 1 ? TextStyle.SUMMARY_BLUE : TextStyle.SUMMARY_GRAY;
      this.text(LEFT_X + 4, ry - 1, labels[i], labelStyle, 0, 28);
      // Bar track + fill, scaled by the base value against a 200-ceiling.
      this.fill(barX, ry, barMaxW, 4, 0x1b2436, 1);
      const w = Math.max(2, Math.min(1, base / 200) * barMaxW);
      this.fill(barX, ry, w, 4, color, 1);
      this.text(barX + barMaxW + 2, ry - 1, String(base), labelStyle, 0, 28);
    });
  }

  private clip(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 2)}..` : s;
  }

  // -- right column: windowed section panels ----------------------------------------------------

  /** A game-native section header band (dark navy strip + gold title) at the top of a right panel. */
  private sectionHeader(panelY: number, title: string, rightNote?: string): void {
    this.fill(RIGHT_X + 3, panelY + 3, RIGHT_W - 6, 9, HEADER_BAND, 1);
    this.text(RIGHT_X + 6, panelY + 3, title, TextStyle.SUMMARY_GOLD, 0, FONT_HDR);
    if (rightNote != null) {
      this.text(RIGHT_X + RIGHT_W - 7, panelY + 3, rightNote, TextStyle.SUMMARY_GRAY, 1, FONT_TINY);
    }
  }

  /**
   * Focus treatment for a focusable field's interior box: a bright ACCENT fill + gold left edge when
   * this field holds focus (pane closed), a soft fill when it is the field currently open in the
   * dropdown. One rule used identically on every field, so "focused" reads the same everywhere.
   */
  private focusBox(x: number, y: number, w: number, h: number, field: EditorField): void {
    const focused = this.field === field && !this.paneOpen;
    const openHere = this.field === field && this.paneOpen;
    this.fill(x, y, w, h, focused ? ACCENT : openHere ? ACCENT_SOFT : CELL_DIM, 1);
    if (focused) {
      this.fill(x, y, 2, h, GOLD, 1);
    }
  }

  // -- ABILITIES panel: 1 CYCLABLE active + 3 always-on INNATES (candy-gated) --------------------

  private renderAbilitiesPanel(): void {
    const cfg = this.config!;
    this.add(addWindow(RIGHT_X, ABIL_Y, RIGHT_W, ABIL_H));
    const selectable = this.selectableAbilityIndices();
    this.sectionHeader(ABIL_Y, "ABILITIES", selectable.length > 1 ? "E: cycle active" : "1 active + 3 innate");

    // The ACTIVE ability - the ONE selectable slot, CYCLED via the E hotkey (or A on this row). A key
    // glyph on the right advertises E; LEFT/RIGHT are reserved for stage cycling now, so no chevrons.
    const actives = this.activeAbilityIds();
    const activeId = actives[cfg.set.abilityIndex] ?? actives[0];
    const active = allAbilities[activeId];
    const ay = ABIL_Y + 14;
    // Inset the ACTIVE bar a full frame-width (6px) so its bright fill + gold focus edge sit INSIDE the
    // panel's nine-slice frame instead of kissing/overrunning it (the reported "ability bar overlaps the
    // frames"). The E glyph is pulled in to match; the description clips clear of it.
    const abilBarW = RIGHT_W - 12;
    this.focusBox(RIGHT_X + 6, ay, abilBarW, 15, EditorField.ABILITY);
    this.tag(RIGHT_X + 9, ay + 2, "ACTIVE", 0x2f6d4a);
    if (selectable.length > 1) {
      const eGlyph = globalScene.add
        .sprite(
          RIGHT_X + RIGHT_W - 16,
          ay + 7,
          "keyboard",
          this.keyFrame(SettingKeyboard.BUTTON_CYCLE_ABILITY, "E.png"),
        )
        .setOrigin(0.5, 0.5)
        .setScale(0.45);
      this.add(eGlyph);
    }
    this.text(RIGHT_X + 39, ay + 1, active?.name ?? "-", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(RIGHT_X + 39, ay + 8, this.clip(active?.description ?? "", 72), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);

    // The 3 INNATES - always-on for the LINE, but a locked slot is candy-gated (inactive on the
    // player's own party), so a locked one shows its candy unlock cost; an unlocked one reads active.
    const innates = this.innateAbilityIds();
    const iy0 = ay + 17;
    innates.forEach((id, i) => {
      const ability = allAbilities[id];
      if (ability == null) {
        return;
      }
      const iy = iy0 + i * 8;
      const unlocked = cfg.unlocks.innateUnlockedSlots.includes(i);
      // Innate marker dot: lit purple when active, dim when candy-locked.
      this.fill(RIGHT_X + 7, iy + 2, 2, 2, unlocked ? 0xc78ce0 : 0x4a3a55, 1);
      const nameStyle = unlocked ? TextStyle.SUMMARY_PINK : TextStyle.SHADOW_TEXT;
      this.text(RIGHT_X + 12, iy, this.clip(ability.name, 16), nameStyle, 0, FONT_TINY);
      if (unlocked) {
        this.text(RIGHT_X + 78, iy, this.clip(ability.description ?? "", 56), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
      } else {
        // Locked: the candy icon + the slot's unlock cost, next to the innate (item 6).
        this.renderCandyCost(RIGHT_X + 78, iy, cfg.unlocks.innateSlotCandyCosts[i] ?? 0);
      }
    });
  }

  /** A candy icon + "×cost" (locked-innate unlock cost). Greened when the line can afford it. */
  private renderCandyCost(x: number, y: number, cost: number): void {
    const candy = globalScene.add
      .image(x + 3, y + 3, "candy")
      .setOrigin(0.5, 0.5)
      .setScale(0.3);
    this.add(candy);
    const affordable = this.config!.unlocks.candyCount >= cost;
    this.text(
      x + 8,
      y,
      `×${cost} to unlock`,
      affordable ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY,
      0,
      FONT_TINY,
    );
  }

  // -- ITEM panel (+ a compact NATURE chip beside it) -------------------------------------------

  private renderItemPanel(): void {
    const cfg = this.config!;
    this.add(addWindow(RIGHT_X, ITEM_Y, RIGHT_W, ITEM_H));
    // Item box takes the left ~2/3; the nature chip sits on the right (item 8: nature relocated, small).
    const natureW = 50;
    const itemW = RIGHT_W - 6 - natureW - 2;
    this.focusBox(RIGHT_X + 3, ITEM_Y + 3, itemW, ITEM_H - 6, EditorField.ITEM);
    this.text(RIGHT_X + 7, ITEM_Y + 5, "ITEM", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const vx = RIGHT_X + 38;
    if (this.isMega) {
      this.text(vx, ITEM_Y + 4, "Mega Stone", TextStyle.SUMMARY_PINK, 0, FONT_NAME);
      this.text(vx, ITEM_Y + 12, "Auto-forced (locked).", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    } else {
      const key = cfg.set.item as ShowdownItemKey;
      const resolved = this.resolvedItem(key);
      if (resolved?.iconImage) {
        const icon = globalScene.add
          .sprite(vx, ITEM_Y + 9, "items", resolved.iconImage)
          .setOrigin(0.5, 0.5)
          .setScale(0.42);
        this.add(icon);
      }
      this.text(vx + 8, ITEM_Y + 4, resolved?.name ?? String(key), TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
      this.text(
        vx + 8,
        ITEM_Y + 12,
        this.clip(resolved?.getDescription() ?? "", 48),
        TextStyle.SUMMARY_GRAY,
        0,
        FONT_TINY,
      );
    }

    // Compact NATURE chip (cycled via the N hotkey). Shows the name + its +/- summary.
    const nx = RIGHT_X + RIGHT_W - 3 - natureW;
    this.fill(nx, ITEM_Y + 3, natureW, ITEM_H - 6, CELL_DIM, 1);
    this.outline(nx, ITEM_Y + 3, natureW, ITEM_H - 6, 0x33436a);
    this.text(nx + 3, ITEM_Y + 4, "NATURE", TextStyle.SUMMARY_HEADER, 0, FONT_TINY);
    const summary = getNatureName(cfg.set.nature as Nature, true, false, true).replace(/\n/g, " ");
    this.text(nx + 3, ITEM_Y + 11, this.clip(summary, 20), TextStyle.SUMMARY_GOLD, 0, FONT_TINY);
  }

  // -- MOVES panel: a 2x2 grid of cells ---------------------------------------------------------

  private renderMovesPanel(): void {
    this.add(addWindow(RIGHT_X, MOVES_Y, RIGHT_W, MOVES_H));
    this.sectionHeader(MOVES_Y, "MOVES", "A: search");
    const cellW = (RIGHT_W - 9) / 2; // two columns with a small central gutter
    const cellH = 13;
    const gridY = MOVES_Y + 13;
    for (let slot = 0; slot < 4; slot++) {
      const col = slot % 2;
      const row = Math.floor(slot / 2);
      const cx = RIGHT_X + 3 + col * (cellW + 3);
      const cy = gridY + row * (cellH + 2);
      this.renderMoveCell(cx, cy, cellW, cellH, slot);
    }
  }

  private renderMoveCell(cx: number, cy: number, w: number, h: number, slot: number): void {
    this.focusBox(cx, cy, w, h, MOVE_FIELDS[slot]);
    const moveId = this.config!.set.moves[slot];
    if (moveId == null) {
      this.text(cx + 5, cy + 3, `-- empty --  (${slot + 1})`, TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
      return;
    }
    const move = allMoves[moveId];
    this.text(cx + 5, cy + 1, this.clip(move?.name ?? "-", 16), TextStyle.SUMMARY_GOLD, 0, FONT_TINY);
    if (!move) {
      return;
    }
    const tSpr = globalScene.add
      .sprite(cx + 10, cy + 9, getLocalizedSpriteKey("types"), PokemonType[move.type].toLowerCase())
      .setOrigin(0.5, 0.5)
      .setScale(0.32);
    this.add(tSpr);
    const cSpr = globalScene.add
      .sprite(cx + 26, cy + 9, "categories", MoveCategory[move.category].toLowerCase())
      .setOrigin(0.5, 0.5)
      .setScale(0.42);
    this.add(cSpr);
    const bp = move.power > 0 ? String(move.power) : "-";
    const acc = move.accuracy > 0 ? String(move.accuracy) : "-";
    this.text(cx + 36, cy + 7, `BP ${bp}`, TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    this.text(cx + w - 4, cy + 7, `${acc}%`, TextStyle.SUMMARY_GRAY, 1, FONT_TINY);
  }

  // -- persistent MOVE DESCRIPTION bar (item 8) -------------------------------------------------
  // Live-updates with the highlighted move's full description while navigating the move dropdown AND
  // while focus sits on any of the 4 move cells. When the focus is elsewhere it shows the focused
  // ability / item description, so the bar is always useful.

  private renderMoveDescBar(): void {
    this.add(addWindow(RIGHT_X, DESC_Y, RIGHT_W, DESC_H));
    this.fill(RIGHT_X + 2, DESC_Y + 2, RIGHT_W - 4, DESC_H - 4, 0x0d1524, 1);
    const info = this.descBarContent();
    this.text(RIGHT_X + 5, DESC_Y + 2, info.title, TextStyle.SUMMARY_GOLD, 0, FONT_TINY);
    this.text(RIGHT_X + 5, DESC_Y + 8, this.clip(info.desc, 92), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

  /** The move (or field) whose description the bottom bar shows right now. */
  private descBarContent(): { title: string; desc: string } {
    // 1) Navigating the move dropdown -> the highlighted entry.
    if (this.paneOpen && MOVE_FIELDS.includes(this.field)) {
      const hi = this.moveEntries()[this.paneCursor];
      if (hi != null) {
        const move = allMoves[hi.moveId];
        return { title: hi.name, desc: hi.locked ? hi.reason : (move?.effect ?? "") };
      }
    }
    // 2) Focus on a move cell -> that cell's move.
    if (MOVE_FIELDS.includes(this.field)) {
      const moveId = this.config!.set.moves[this.moveSlot()];
      if (moveId != null) {
        const move = allMoves[moveId];
        return { title: move?.name ?? "-", desc: move?.effect ?? "" };
      }
      return { title: `Move ${this.moveSlot() + 1}`, desc: "Empty slot - press A to search the legal move pool." };
    }
    // 3) Otherwise: the focused field's own description.
    if (this.field === EditorField.ITEM) {
      if (this.isMega) {
        return { title: "Mega Stone", desc: "Auto-forced by the mega stage (slot locked)." };
      }
      const resolved = this.resolvedItem(this.config!.set.item as ShowdownItemKey);
      return { title: resolved?.name ?? "Item", desc: resolved?.getDescription() ?? "" };
    }
    const actives = this.activeAbilityIds();
    const active = allAbilities[actives[this.config!.set.abilityIndex] ?? actives[0]];
    return { title: active?.name ?? "Ability", desc: active?.description ?? "" };
  }

  /** A small solid label pill (e.g. the "ACTIVE" tag on the ability row). */
  private tag(x: number, y: number, label: string, color: number): void {
    const w = label.length * 3.1 + 5;
    this.fill(x, y, w, 8, color, 1);
    this.text(x + 2, y + 1, label, TextStyle.WINDOW, 0, FONT_TINY);
  }

  private resolvedItem(key: ShowdownItemKey) {
    const modType = modifierTypes[key];
    return modType == null ? null : getModifierType(modType);
  }

  // -- floating search DROPDOWN (item + moves; drawn on top, only while actively searching) ------

  private renderDropdown(): void {
    this.add(addWindow(DROP_X, DROP_Y, DROP_W, DROP_H));
    // Search bar: the focused field's pool name + the live typed query with a caret.
    const barY = DROP_Y + 3;
    this.fill(DROP_X + 3, barY, DROP_W - 6, 11, HEADER_BAND, 1);
    this.text(DROP_X + 6, barY + 2, this.fieldName(this.field), TextStyle.SUMMARY_GOLD, 0, FONT_HDR);
    if (this.filter) {
      this.text(DROP_X + 70, barY + 2, `${this.filter}_`, TextStyle.WINDOW, 0, FONT_HDR);
    } else {
      this.text(DROP_X + 70, barY + 2, "type to search", TextStyle.SHADOW_TEXT, 0, FONT_HDR);
    }
    const top = DROP_Y + 17;
    if (this.field === EditorField.ITEM) {
      this.renderItemDropdown(top);
    } else {
      this.renderMoveDropdown(top);
    }
  }

  private fieldName(field: EditorField): string {
    if (field === EditorField.ITEM) {
      return "ITEM";
    }
    return `MOVE ${MOVE_FIELDS.indexOf(field) + 1}`;
  }

  private static readonly DROP_ROW_H = 11;

  /** Highlight fill + return the row's baseline y for the i-th visible dropdown row. */
  private dropRow(index: number, top: number): number {
    const rowH = ShowdownSetEditorUiHandler.DROP_ROW_H;
    const ry = top + (index - this.paneScroll) * rowH;
    if (index === this.paneCursor) {
      this.fill(DROP_X + 3, ry - 1, DROP_W - 6, rowH, ACCENT, 1);
    }
    return ry;
  }

  private renderMoveDropdown(top: number): void {
    const entries = this.moveEntries();
    const visible = ShowdownSetEditorUiHandler.PANE_VISIBLE_ROWS;
    const end = Math.min(this.paneScroll + visible, entries.length);
    for (let i = this.paneScroll; i < end; i++) {
      this.renderMoveDropRow(entries[i], i, top);
    }
    // The highlighted move's full description lives in the persistent bottom bar (renderMoveDescBar).
  }

  private renderMoveDropRow(e: MovePaneEntry, i: number, top: number): void {
    const move = allMoves[e.moveId];
    const ry = this.dropRow(i, top);
    const style = e.locked ? TextStyle.SHADOW_TEXT : i === this.paneCursor ? TextStyle.WINDOW : TextStyle.SUMMARY_GRAY;
    this.text(DROP_X + 8, ry + 1, this.clip(`${e.name}${e.locked ? " (egg)" : ""}`, 22), style, 0, FONT_TINY);
    if (!move) {
      return;
    }
    const tSpr = globalScene.add
      .sprite(DROP_X + 118, ry + 4, getLocalizedSpriteKey("types"), PokemonType[move.type].toLowerCase())
      .setOrigin(0.5, 0.5)
      .setScale(0.34);
    tSpr.setAlpha(e.locked ? 0.4 : 1);
    this.add(tSpr);
    this.text(DROP_X + 138, ry + 1, categoryLabel(move.category), style, 0, FONT_TINY);
    this.text(DROP_X + 154, ry + 1, move.power > 0 ? `BP ${move.power}` : "BP -", style, 0, FONT_TINY);
    this.text(DROP_X + 182, ry + 1, move.accuracy > 0 ? `${move.accuracy}%` : "-", style, 0, FONT_TINY);
  }

  private renderItemDropdown(top: number): void {
    const keys = this.itemKeys();
    const visible = ShowdownSetEditorUiHandler.PANE_VISIBLE_ROWS;
    const start = this.paneScroll;
    const end = Math.min(start + visible, keys.length);
    for (let i = start; i < end; i++) {
      const resolved = this.resolvedItem(keys[i]);
      const ry = this.dropRow(i, top);
      const style = i === this.paneCursor ? TextStyle.WINDOW : TextStyle.SUMMARY_GRAY;
      if (resolved?.iconImage) {
        const icon = globalScene.add
          .sprite(DROP_X + 13, ry + 4, "items", resolved.iconImage)
          .setOrigin(0.5, 0.5)
          .setScale(0.42);
        this.add(icon);
      }
      this.text(DROP_X + 24, ry + 1, this.clip(resolved?.name ?? String(keys[i]), 26), style, 0, FONT_TINY);
      this.text(DROP_X + 122, ry + 2, this.clip(resolved?.getDescription() ?? "", 30), style, 0, FONT_TINY);
    }
  }

  clear(): void {
    super.clear();
    this.clearDynamic();
    this.textInput?.close();
    this.pasteInput?.close();
    this.container.setVisible(false);
    this.config = null;
    this.validationError = null;
    this.setMenu = "closed";
    this.setMenuBuffer = "";
    this.setMenuNotice = null;
    this.setLoadList = [];
    this.requestedSpriteKeys.clear();
  }
}

/** A held-item mini-manifest for a strip slot (only the fields the strip reads). */
function stripMon(speciesId: number, formIndex: number, baseCost: number, item: string): ShowdownMonManifest {
  return {
    speciesId,
    formIndex,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    nature: Nature.HARDY,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [],
    item,
    rootSpeciesId: speciesId,
    erBlackShiny: false,
    baseCost,
  };
}

/**
 * A self-contained, honest demo config for the render harness (a real Garchomp line: Gible
 * -> Gabite -> Garchomp + Mega Garchomp, real move/ability/item metadata). Mirrors
 * `buildDemoConfig` for the Shiny Lab. Options override the initial focus/pane for the
 * per-state recipes.
 */
export function buildShowdownEditorDemoConfig(
  overrides: Partial<ShowdownSetEditorConfig> = {},
): ShowdownSetEditorConfig {
  const team: (ShowdownMonManifest | null)[] = [
    stripMon(SpeciesId.BLASTOISE, 0, 7, "SHELL_BELL"),
    stripMon(SpeciesId.ROTOM, 0, 5, "LEFTOVERS"),
    stripMon(SpeciesId.GARCHOMP, 0, 8, "LEFTOVERS"),
    null,
    null,
    null,
  ];
  return {
    rootSpeciesId: SpeciesId.GIBLE,
    stage: { speciesId: SpeciesId.GARCHOMP, formIndex: 0 },
    set: {
      abilityIndex: 0,
      item: "LEFTOVERS",
      moves: [MoveId.EARTHQUAKE, MoveId.OUTRAGE, MoveId.SWORDS_DANCE, MoveId.STONE_EDGE],
      nature: Nature.JOLLY,
      shiny: false,
      variant: 0,
    },
    female: false,
    unlocks: {
      ownedVariants: [0, 1],
      blackShinyOwned: true,
      unlockedAbilityIndices: [0, 2],
      unlockedEggMoveBits: 0b0011,
      megaBudgetSpent: false,
      // Innate slots: slot 0 unlocked (active), slots 1 + 2 candy-locked (show their unlock cost).
      innateUnlockedSlots: [0],
      innateSlotCandyCosts: [0, 35, 50],
      candyCount: 40,
    },
    team,
    activeSlot: 2,
    pickSecondsLeft: 583,
    partnerReady: false,
    // The real editor (opened from the grid) always wires team cycling, so the demo shows the G/V
    // "Prev / Next Mon" hotkeys in the legend bar too (a no-op here; overridden by the switch test).
    onCycleTeam: () => {},
    ...overrides,
  };
}
