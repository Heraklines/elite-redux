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
// mega), the ability, held item, four moves, nature and shiny tier - every choice
// gated by the live collection, every choice showing its inline description.
//
// Layout (logical 320x180, x6 to screen) - round-3 redesign, game-native nine-slice chrome:
//   - TOP micro TEAM STRIP: 6 slot icons + validity chips (size / mega / cost) + a
//     pick-window countdown + a partner-ready line. (No wager preview - cut from v1.)
//   - LEFT IDENTITY COLUMN (~1/3): the (harness-static) sprite, the evolution STAGE
//     STRIP - enumerating EVERY owned fielded form incl. multiple megas per line
//     (e.g. Garchomp's two megas) - shiny/variant chips, live STAT BARS, a cost badge.
//   - RIGHT COLUMN (~2/3): four stacked WINDOWED section panels so the whole set reads at
//     a glance without expanding anything:
//       ABILITIES - the flagship ER feature: all FOUR abilities on the main screen (1 ACTIVE,
//         focusable/changeable + marked, and the 3 always-on INNATES with compact descriptions),
//       ITEM, MOVES (a compact 2x2 cell grid), NATURE.
//   - SEARCH DROPDOWN: drawn ON TOP, only while a field is actively being searched. TYPE-TO-SEARCH:
//     focusing a field is search-ready; alphanumeric input opens + filters the dropdown directly
//     (no "press A to browse" ceremony), prefix-first ranked; A opens it unfiltered (controller);
//     arrows navigate, Enter/A picks, B dismisses. Mobile/desktop keystrokes ride the
//     {@linkcode ShowdownEditorTextInput} bridge into {@linkcode ShowdownSetEditorUiHandler.setFilter}.
//
// The handler consumes a plain {@linkcode ShowdownSetEditorConfig}; the flow wiring lives in
// StarterSelect (grid confirm -> editor -> Done writes the manifest). See showdown-editor-flow.test.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { isMegaStage, listEvolutionStages, listMegaStages } from "#data/elite-redux/showdown/showdown-evolutions";
import { SHOWDOWN_ITEM_POOL, type ShowdownItemKey } from "#data/elite-redux/showdown/showdown-item-pool";
import { collectShowdownFreeMoves, collectUnlockedEggMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import { MEGA_STONE_ITEM, type ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
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
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getLocalizedSpriteKey } from "#utils/common";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

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
  /** Shiny variant tier (0..2); 3 marks a black shiny (unfieldable, stake-only). */
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
  /** Whether the line's black shiny is owned (shown but marked stake-only). */
  blackShinyOwned: boolean;
  /** Which of the fielded species' 3 active-ability slots are unlocked (0..2). */
  unlockedAbilityIndices: number[];
  /** Per-line egg-move unlock bitmask (`starterData[root].eggMoves`). */
  unlockedEggMoveBits: number;
  /** The team already fields its one allowed mega elsewhere (mega slot greyed). */
  megaBudgetSpent: boolean;
  /** Which team slot spent the mega budget (for the greyed reason line). */
  megaBudgetSpentBy?: string;
}

/** The whole editor config for one team slot. Plain data, so live wiring is trivial. */
export interface ShowdownSetEditorConfig {
  /** The starter LINE root (collection key). */
  rootSpeciesId: number;
  /** The currently fielded stage. */
  stage: ShowdownEditorStage;
  /** The set being edited. */
  set: ShowdownEditorSet;
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
  /** Backed out (B / Cancel) with no commit - the flow returns to the grid, discarding edits. */
  onCancel?: () => void;
  /**
   * L/R team cycling (shoulders): switch the editor to the sibling already-picked team mon
   * (`dir` = -1 previous / +1 next). Absent when there is no sibling to cycle to.
   */
  onCycleTeam?: (dir: number) => void;
}

/** The edited result the flow wiring writes back into the team (stage + set). */
export interface ShowdownEditorResult {
  stage: ShowdownEditorStage;
  set: ShowdownEditorSet;
}

/**
 * The mobile bridge seam. On a touch device, focusing a searchable field raises the NATIVE
 * keyboard through a hidden DOM input (the same infra login/nickname use). P1 stubs this
 * behind the interface; the NEXT task plugs a real implementation in via {@linkcode
 * ShowdownSetEditorUiHandler.setTextInput}. Keyboard/controller need none of this.
 */
export interface ShowdownEditorTextInput {
  /** Focus the hidden input and start feeding characters to {@linkcode onFilterChange}. */
  open(initial: string, onFilterChange: (value: string) => void): void;
  /** Blur + hide the hidden input. */
  close(): void;
}

// ---- focus graph ------------------------------------------------------------------------------

/** The focusable field rows (right column). Their order IS the up/down focus order. */
export enum EditorField {
  ABILITY = 0,
  ITEM = 1,
  MOVE0 = 2,
  MOVE1 = 3,
  MOVE2 = 4,
  MOVE3 = 5,
  NATURE = 6,
}
const FIELD_ORDER: EditorField[] = [
  EditorField.ABILITY,
  EditorField.ITEM,
  EditorField.MOVE0,
  EditorField.MOVE1,
  EditorField.MOVE2,
  EditorField.MOVE3,
  EditorField.NATURE,
];
const MOVE_FIELDS: EditorField[] = [EditorField.MOVE0, EditorField.MOVE1, EditorField.MOVE2, EditorField.MOVE3];

// ---- layout constants (logical px) ------------------------------------------------------------

const SCREEN_W = 320;
const SCREEN_H = 180;
const MARGIN = 3;

const STRIP_H = 22;
const BODY_Y = STRIP_H + 2; // 24

const LEFT_X = MARGIN; // 3
const LEFT_W = 100;
const RIGHT_X = LEFT_X + LEFT_W + MARGIN; // 106
const RIGHT_W = SCREEN_W - RIGHT_X - MARGIN; // 211

// The RIGHT column is four stacked, windowed section panels (game-native nine-slice chrome, not flat
// fills) so the whole set reads at a glance without expanding anything:
//   ABILITIES (the 1 active + 3 always-on innates - half of an ER mon's identity),
//   ITEM, MOVES (a 2x2 grid of cells), NATURE.
// The search DROPDOWN is drawn LAST, ON TOP, only while a field is actively being searched - there is
// no idle "press A to browse" region. The left identity column stays full-height + always visible.
const ABIL_Y = BODY_Y; // 24
const ABIL_H = 60; // 24..84 - the 1 active + 3 innates block
const ITEM_Y = ABIL_Y + ABIL_H + 2; // 86
const ITEM_H = 20; // 86..106
const MOVES_Y = ITEM_Y + ITEM_H + 2; // 108
const MOVES_H = 46; // 108..154 - header + a 2x2 cell grid
const NAT_Y = MOVES_Y + MOVES_H + 2; // 156
const NAT_H = SCREEN_H - NAT_Y - MARGIN; // 21 -> ends at 177

// The floating search dropdown (over the right column, drawn last). Anchored in a consistent band so
// it always reads as the same control regardless of which field is focused.
const DROP_X = RIGHT_X;
const DROP_W = RIGHT_W;
const DROP_Y = ABIL_Y + 40; // drops from just under the ABILITIES header band, over the set
const DROP_H = SCREEN_H - DROP_Y - MARGIN;

const ACCENT = 0x3d5a80; // focused-element fill
const ACCENT_SOFT = 0x24344f; // focused-in-search (a field is open in the dropdown)
const HEADER_BAND = 0x18233b; // dark navy band behind section headers (legible gold-on-dark)
const CELL_DIM = 0x16223d; // solid dark inset for field boxes / move cells (contrast on light windows)

// Font sizes (the addTextObject default is a huge 96; dense screens run ~22-52).
const FONT_HDR = 34; // small section headers
const FONT_NAME = 40; // ability / move names
const FONT_DESC = 26; // inline descriptions
const FONT_TINY = 22; // dense innate / cell metadata
const FONT_CHIP = 34; // strip chips + shiny chips
const FONT_TITLE = 52; // species name

// ---- pure display helpers ---------------------------------------------------------------------

/** Level-100, IV-31 stat value with nature multiplier applied (display-only). */
function calcStat(base: number, statIndex: Stat, nature: Nature): number {
  const iv = 31;
  const level = 100;
  if (statIndex === Stat.HP) {
    return Math.floor(((2 * base + iv) * level) / 100) + level + 10;
  }
  const raw = Math.floor(((2 * base + iv) * level) / 100) + 5;
  return Math.floor(raw * getNatureStatMultiplier(nature, statIndex));
}

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

/**
 * Typeahead ranking (fuzzy PREFIX-first, substring fallback). A non-matching row is dropped; a match
 * ranks by tier - (0) the whole name starts with the filter, (1) any word starts with it, (2) it is a
 * plain substring - then alphabetically within a tier. So filtering "o" surfaces Outrage/Overheat before
 * a mere substring hit like "Diamond Blade", instead of the old pure-substring-then-alphabetical order
 * that buried the intuitive matches (the maintainer's render-review nit).
 */
function rankByFilter<T>(items: T[], nameOf: (item: T) => string, filter: string): T[] {
  const f = filter.toLowerCase();
  const tierOf = (name: string): number => {
    const lower = name.toLowerCase();
    if (lower.startsWith(f)) {
      return 0;
    }
    if (lower.split(/[\s-]+/).some(word => word.startsWith(f))) {
      return 1;
    }
    return lower.includes(f) ? 2 : 3;
  };
  return items
    .map(item => ({ item, name: nameOf(item), tier: tierOf(nameOf(item)) }))
    .filter(entry => entry.tier < 3)
    .sort((a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier - b.tier))
    .map(entry => entry.item);
}

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
  private textInput: ShowdownEditorTextInput | null = null;

  constructor() {
    super(UiMode.SHOWDOWN_SET_EDITOR);
  }

  /** NEXT task: inject the mobile hidden-input bridge (keyboard/controller need none). */
  setTextInput(input: ShowdownEditorTextInput | null): void {
    this.textInput = input;
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
    this.field = config.initialField ?? EditorField.ABILITY;
    this.paneOpen = config.initialPaneOpen ?? false;
    this.filter = config.initialFilter ?? "";
    this.paneCursor = config.initialPaneCursor ?? 0;
    this.paneScroll = 0;
    this.container.setVisible(true);
    // Raise the type-to-search capture immediately: a focused field is search-ready with no ceremony
    // (desktop keystrokes / mobile native keyboard both feed the typeahead). Headless: inert no-op.
    if (this.paneOpen) {
      this.ensurePaneCursorVisible();
    }
    this.openCapture();
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

  // ---- input ----------------------------------------------------------------------------------

  processInput(button: Button): boolean {
    if (this.config == null) {
      return false;
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
        handled = this.cycleStage(-1);
        break;
      case Button.RIGHT:
        handled = this.cycleStage(1);
        break;
      case Button.ACTION:
        handled = this.openPane();
        break;
      case Button.SUBMIT:
        // Start = Done: commit the edited stage + set back into the team (flow wiring).
        this.config!.onDone?.({ stage: this.config!.stage, set: this.config!.set });
        handled = true;
        break;
      case Button.CANCEL:
        // B = Back: discard and return to the grid (flow wiring).
        this.config!.onCancel?.();
        handled = true;
        break;
      case Button.CYCLE_FORM:
        // Left shoulder: cycle to the previous already-picked team mon.
        if (this.config!.onCycleTeam != null) {
          this.config!.onCycleTeam(-1);
          handled = true;
        }
        break;
      case Button.CYCLE_SHINY:
        // Right shoulder: cycle to the next already-picked team mon.
        if (this.config!.onCycleTeam != null) {
          this.config!.onCycleTeam(1);
          handled = true;
        }
        break;
    }
    if (handled) {
      this.getUi().playSelect();
    }
    return handled;
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
    // Every field is search-ready: reset the capture buffer for the newly focused field so the first
    // keystroke here filters THIS field's pool (no stale filter, no "browse" action).
    this.filter = "";
    this.openCapture();
    this.render();
    return true;
  }

  /** LEFT/RIGHT cycles the fielded STAGE - sprite, abilities, movepool all follow. */
  private cycleStage(dir: number): boolean {
    const stages = this.allStages();
    const cur = stages.findIndex(
      s => s.speciesId === this.config!.stage.speciesId && s.formIndex === this.config!.stage.formIndex,
    );
    const next = ((cur < 0 ? 0 : cur) + dir + stages.length) % stages.length;
    const target = stages[next];
    this.config!.stage = { speciesId: target.speciesId, formIndex: target.formIndex };
    // Mega auto-forces the item slot to the sentinel; leaving mega restores a real item.
    if (isMegaStage(target.speciesId, target.formIndex)) {
      this.config!.set.item = MEGA_STONE_ITEM;
    } else if (this.config!.set.item === MEGA_STONE_ITEM) {
      this.config!.set.item = SHOWDOWN_ITEM_POOL[0];
    }
    this.render();
    return true;
  }

  /**
   * Raise the type-to-search capture surface for the CURRENT field (desktop physical-keyboard capture /
   * mobile native keyboard). Every keystroke routes to {@linkcode setFilter}, which auto-opens the
   * dropdown on the first character - so on keyboard/touch you simply START TYPING, no button first.
   * Headless (tests / render harness): the factory is absent, so this is an inert no-op.
   */
  private openCapture(): void {
    this.textInput?.open(this.filter, value => this.setFilter(value));
  }

  /**
   * CONTROLLER path (A on a focused field): open the dropdown UNFILTERED with the current value
   * pre-highlighted. Keyboard/touch users never need this - they just type - but it also re-raises the
   * capture so they can immediately narrow.
   */
  private openPane(): boolean {
    this.paneOpen = true;
    this.filter = "";
    this.paneCursor = this.currentPaneSelectionIndex();
    this.paneScroll = 0;
    this.ensurePaneCursorVisible();
    this.openCapture();
    this.render();
    return true;
  }

  private closePane(): void {
    this.paneOpen = false;
    this.filter = "";
    // Reopen the capture at field level so the NEXT keystroke starts a fresh search with no ceremony.
    this.openCapture();
    this.render();
  }

  /**
   * The single typeahead entry point - fed by the capture surface (desktop keyboard / mobile native
   * keyboard) AND the interaction tests. Typing on a focused field IS the search: the first character
   * opens the dropdown with NO prior "browse"/A action, and each edit re-ranks (prefix-first) to the
   * top match. This is the round-3 input model: no separate search button, no mode-switch.
   */
  setFilter(value: string): void {
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
    const free = collectShowdownFreeMoves(cfg.rootSpeciesId, cfg.stage.speciesId);
    const unlockedEgg = new Set(collectUnlockedEggMoves(cfg.rootSpeciesId, cfg.unlocks.unlockedEggMoveBits));
    const eggAll = speciesEggMoves[cfg.rootSpeciesId] ?? [];
    const entries = new Map<number, MovePaneEntry>();
    for (const moveId of free) {
      const move = allMoves[moveId];
      if (move) {
        entries.set(moveId, { moveId, name: move.name, locked: false, reason: "" });
      }
    }
    for (const moveId of eggAll) {
      const move = allMoves[moveId];
      if (!move || entries.has(moveId)) {
        continue;
      }
      const locked = !unlockedEgg.has(moveId);
      entries.set(moveId, {
        moveId,
        name: move.name,
        locked,
        reason: locked ? i18next.t("battle:showdownEditorEggLocked", { defaultValue: "Egg move - not unlocked" }) : "",
      });
    }
    const list = [...entries.values()];
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

  private natureList(): number[] {
    const all = Object.values(Nature).filter(n => typeof n === "number") as number[];
    return this.filter
      ? rankByFilter(all, n => getNatureName(n as Nature, false, false, true), this.filter)
      : all.sort((a, b) => a - b);
  }

  private paneRowCount(): number {
    switch (this.field) {
      case EditorField.ABILITY:
        return this.activeAbilityIds().length; // only the actives are selectable (innates are informational)
      case EditorField.ITEM:
        return this.itemKeys().length;
      case EditorField.NATURE:
        return this.natureList().length;
      default:
        return this.moveEntries().length;
    }
  }

  /** Where the current set value sits in the pane list (so opening highlights it). */
  private currentPaneSelectionIndex(): number {
    const cfg = this.config!;
    switch (this.field) {
      case EditorField.ABILITY:
        return Math.max(0, Math.min(cfg.set.abilityIndex, this.activeAbilityIds().length - 1));
      case EditorField.ITEM:
        return Math.max(0, this.itemKeys().indexOf(cfg.set.item as ShowdownItemKey));
      case EditorField.NATURE:
        return Math.max(0, this.natureList().indexOf(cfg.set.nature));
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
      case EditorField.ABILITY:
        cfg.set.abilityIndex = this.paneCursor;
        break;
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
      case EditorField.NATURE:
        cfg.set.nature = this.natureList()[this.paneCursor] ?? cfg.set.nature;
        break;
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
    fontSize = FONT_DESC,
  ): Phaser.GameObjects.Text {
    const t = addTextObject(x, y, content, style, { fontSize: `${fontSize}px` });
    t.setOrigin(originX, 0);
    return this.add(t);
  }

  private fill(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.add(globalScene.add.rectangle(x, y, w, h, color, alpha).setOrigin(0, 0));
  }

  private render(): void {
    if (this.config == null) {
      return;
    }
    this.clearDynamic();

    // Full dim backdrop so the whole thing reads as one composed screen.
    this.fill(0, 0, SCREEN_W, SCREEN_H, 0x05070f, 1);

    this.renderStrip();
    this.renderIdentityColumn();
    this.renderAbilitiesPanel();
    this.renderItemPanel();
    this.renderMovesPanel();
    this.renderNaturePanel();
    // The search dropdown is drawn LAST so it floats ON TOP of the set (only while actively searching).
    if (this.paneOpen) {
      this.renderDropdown();
    }
  }

  // -- top micro team strip ---------------------------------------------------------------------

  private renderStrip(): void {
    const cfg = this.config!;
    this.add(addWindow(0, 0, SCREEN_W, STRIP_H));

    // 6 slot icons.
    const iconStartX = 12;
    const iconStepX = 15;
    for (let i = 0; i < 6; i++) {
      const x = iconStartX + i * iconStepX;
      if (i === cfg.activeSlot) {
        this.fill(x - 7, 2, 14, 17, ACCENT, 1);
      }
      const mon = cfg.team[i];
      if (mon == null) {
        this.text(x, 6, "·", TextStyle.SUMMARY_GRAY, 0.5);
        continue;
      }
      this.renderStripIcon(mon, x, 3);
    }

    // Validity chips.
    const size = cfg.team.filter(m => m != null).length;
    const megaCount = cfg.team.filter(m => m != null && isMegaStage(m.speciesId, m.formIndex)).length;
    const highCost = cfg.team.filter(m => m != null && m.baseCost >= 8 && m.baseCost < 10).length;
    let cx = 100;
    cx = this.chip(cx, `Team ${size}/6`, size >= 1 && size <= 6);
    cx = this.chip(cx, `Mega ${megaCount}/1`, megaCount <= 1);
    cx = this.chip(cx, `Cost8+ ${highCost}/1`, highCost <= 1);

    // Pick-window countdown (right) - LOAD-BEARING UX (the 10-minute clock). It sits on the light strip
    // window, where faint gold read as unreadable (maintainer's render-review nit), so it gets a dark
    // pill behind it and a bold high-contrast clock (gold, red under a minute).
    const mm = Math.floor(cfg.pickSecondsLeft / 60);
    const ss = cfg.pickSecondsLeft % 60;
    const clock = `${mm}:${String(ss).padStart(2, "0")}`;
    const urgent = cfg.pickSecondsLeft <= 60;
    this.fill(261, 1, 58, 20, 0x14213d, 1);
    this.text(265, 3, "PICK", TextStyle.SUMMARY_GRAY, 0, 30);
    this.text(315, 1, clock, urgent ? TextStyle.SUMMARY_RED : TextStyle.SUMMARY_GOLD, 1, 46);

    // Partner-ready state (right, below the clock) - on the same dark pill so it is legible too.
    const partner = cfg.partnerReady == null ? "Partner -" : cfg.partnerReady ? "Partner READY" : "Partner waiting";
    this.text(315, 13, partner, cfg.partnerReady ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY, 1, 28);
  }

  private chip(x: number, label: string, ok: boolean): number {
    const w = label.length * 3.3 + 6;
    this.fill(x, 5, w, 12, ok ? 0x1c3b1c : 0x4a1c1c, 1);
    this.text(x + 3, 7, label, ok ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_RED, 0, FONT_CHIP);
    return x + w + 3;
  }

  private renderStripIcon(mon: ShowdownMonManifest, x: number, y: number): void {
    const species = getPokemonSpecies(mon.speciesId as SpeciesId);
    if (species == null) {
      return;
    }
    const wantId = species.getIconId(false, mon.formIndex, mon.shiny, mon.variant);
    const icon = globalScene.add
      .sprite(x, y, species.getIconAtlasKey(mon.formIndex, mon.shiny, mon.variant))
      .setOrigin(0.5, 0)
      .setScale(0.42);
    icon.setFrame(wantId);
    if (icon.frame.name !== wantId) {
      const baseId = species.getIconId(false, mon.formIndex, false, 0);
      if (icon.texture.has(baseId)) {
        icon.setFrame(baseId);
      }
    }
    this.add(icon);
  }

  // -- left identity column ---------------------------------------------------------------------

  private renderIdentityColumn(): void {
    const cfg = this.config!;
    this.add(addWindow(LEFT_X, BODY_Y, LEFT_W, SCREEN_H - BODY_Y - 2));

    const sp = this.fieldedSpecies;
    const spriteCX = LEFT_X + LEFT_W / 2;
    // Name (left) + cost badge (right) on the header line. A dark header BAND sits behind them: the
    // identity window is a light panel, so pale-gold name text on it read low-contrast (maintainer's
    // render-review nit). Gold-on-dark-navy matches the right-column field-row headers and is legible.
    this.fill(LEFT_X + 2, BODY_Y + 2, LEFT_W - 4, 12, 0x14213d, 1);
    this.text(LEFT_X + 5, BODY_Y + 3, sp.name, TextStyle.SUMMARY_GOLD, 0, FONT_TITLE);
    const rootCost = cfg.team[cfg.activeSlot]?.baseCost ?? 0;
    this.text(LEFT_X + LEFT_W - 4, BODY_Y + 4, `Cost ${rootCost}`, TextStyle.SUMMARY_GOLD, 1, FONT_HDR);

    // Big (harness-static) sprite: the species icon enlarged as the identity portrait.
    this.renderIdentitySprite(spriteCX, BODY_Y + 34);

    // Type chips (under the sprite).
    this.renderTypeChips(spriteCX, BODY_Y + 55);

    // Stage strip.
    this.renderStageStrip(BODY_Y + 62);

    // Shiny / variant chips.
    this.renderShinyChips(BODY_Y + 86);

    // Live stat bars.
    this.renderStatBars(BODY_Y + 104);
  }

  private renderIdentitySprite(cx: number, cy: number): void {
    const cfg = this.config!;
    const sp = this.fieldedSpecies;
    const wantId = sp.getIconId(false, cfg.stage.formIndex, cfg.set.shiny, cfg.set.variant);
    const icon = globalScene.add
      .sprite(cx, cy, sp.getIconAtlasKey(cfg.stage.formIndex, cfg.set.shiny, cfg.set.variant))
      .setOrigin(0.5, 0.5)
      .setScale(1.5);
    icon.setFrame(wantId);
    if (icon.frame.name !== wantId) {
      const baseId = sp.getIconId(false, cfg.stage.formIndex, false, 0);
      if (icon.texture.has(baseId)) {
        icon.setFrame(baseId);
      }
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
        this.text(x - 7, y + 5, "M", greyed ? TextStyle.SUMMARY_GRAY : TextStyle.SUMMARY_GOLD, 0, 30);
      }
    });
    if (cfg.unlocks.megaBudgetSpent) {
      this.text(
        LEFT_X + 4,
        y + 24,
        `Mega used: ${cfg.unlocks.megaBudgetSpentBy ?? "team"}`,
        TextStyle.SUMMARY_GRAY,
        0,
        26,
      );
    }
  }

  private renderShinyChips(y: number): void {
    const cfg = this.config!;
    this.text(LEFT_X + 4, y, "SHINY", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    let x = LEFT_X + 6;
    // Non-shiny is always available.
    x = this.shinyChip(x, y + 8, "off", !cfg.set.shiny, true, "normal");
    for (const tier of [0, 1, 2]) {
      const owned = cfg.unlocks.ownedVariants.includes(tier);
      const selected = cfg.set.shiny && cfg.set.variant === tier;
      x = this.shinyChip(x, y + 8, `T${tier + 1}`, selected, owned, owned ? "owned" : "locked");
    }
    // Black shiny: visible but unfieldable.
    if (cfg.unlocks.blackShinyOwned) {
      this.shinyChip(x, y + 8, "Blk", false, false, "black");
    }
  }

  private shinyChip(x: number, y: number, label: string, selected: boolean, owned: boolean, kind: string): number {
    const w = label.length * 3.4 + 6;
    const bg = selected ? ACCENT : kind === "black" ? 0x2a1230 : owned ? 0x1c2b3b : 0x241820;
    this.fill(x, y, w, 9, bg, 1);
    const style =
      kind === "black" ? TextStyle.SUMMARY_PINK : owned || selected ? TextStyle.WINDOW : TextStyle.SUMMARY_GRAY;
    this.text(x + 3, y + 1, label, style, 0, FONT_CHIP);
    return x + w + 2;
  }

  private renderStatBars(y: number): void {
    const cfg = this.config!;
    const sp = this.fieldedSpecies;
    this.text(LEFT_X + 4, y, "STATS", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const labels = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
    const barX = LEFT_X + 22;
    const barMaxW = 40;
    const rowH = 6;
    const nature = cfg.set.nature as Nature;
    PERMANENT_STATS.forEach((stat, i) => {
      const ry = y + 9 + i * rowH;
      const base = sp.baseStats[i];
      const value = calcStat(base, stat, nature);
      const mult = stat === Stat.HP ? 1 : getNatureStatMultiplier(nature, stat);
      const color = mult > 1 ? 0xf08aa0 : mult < 1 ? 0x8aa0f0 : 0x8ad08a;
      const labelStyle = mult > 1 ? TextStyle.SUMMARY_PINK : mult < 1 ? TextStyle.SUMMARY_BLUE : TextStyle.SUMMARY_GRAY;
      this.text(LEFT_X + 4, ry - 1, labels[i], labelStyle, 0, 30);
      // Bar track + fill.
      this.fill(barX, ry, barMaxW, 4, 0x1b2436, 1);
      const w = Math.max(2, Math.min(1, base / 180) * barMaxW);
      this.fill(barX, ry, w, 4, color, 1);
      this.text(barX + barMaxW + 2, ry - 1, String(value), labelStyle, 0, 30);
    });
  }

  private clip(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 2)}..` : s;
  }

  // -- right column: four windowed section panels -----------------------------------------------

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
      this.fill(x, y, 2, h, 0xffd447, 1);
    }
  }

  // -- ABILITIES panel: the flagship ER feature - all FOUR abilities on the main screen ----------
  // 1 ACTIVE (focusable / changeable, marked) + 3 always-on INNATES (names + one-line descriptions,
  // informational). This is half of an ER mon's identity and must read without expanding anything.

  private renderAbilitiesPanel(): void {
    const cfg = this.config!;
    this.add(addWindow(RIGHT_X, ABIL_Y, RIGHT_W, ABIL_H));
    this.sectionHeader(ABIL_Y, "ABILITIES", "1 active + 3 innate");

    // The ACTIVE ability - the ONE selectable slot. Focus box + "ACTIVE" tag so it reads as editable.
    const actives = this.activeAbilityIds();
    const activeId = actives[cfg.set.abilityIndex] ?? actives[0];
    const active = allAbilities[activeId];
    const ay = ABIL_Y + 14;
    this.focusBox(RIGHT_X + 3, ay, RIGHT_W - 6, 15, EditorField.ABILITY);
    this.tag(RIGHT_X + 6, ay + 2, "ACTIVE", 0x2f6d4a);
    this.text(RIGHT_X + 34, ay + 1, active?.name ?? "-", TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(RIGHT_X + 34, ay + 8, this.clip(active?.description ?? "", 62), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);

    // The 3 INNATES - always on, not editable. Name (bold) + compact description on one line each.
    const innates = this.innateAbilityIds();
    const iy0 = ay + 17;
    innates.forEach((id, i) => {
      const ability = allAbilities[id];
      const iy = iy0 + i * 8;
      this.fill(RIGHT_X + 7, iy + 2, 2, 2, 0xc78ce0, 1); // innate marker dot
      this.text(RIGHT_X + 12, iy, this.clip(ability?.name ?? "-", 18), TextStyle.SUMMARY_PINK, 0, FONT_TINY);
      this.text(RIGHT_X + 78, iy, this.clip(ability?.description ?? "", 44), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    });
  }

  // -- ITEM panel -------------------------------------------------------------------------------

  private renderItemPanel(): void {
    this.add(addWindow(RIGHT_X, ITEM_Y, RIGHT_W, ITEM_H));
    this.focusBox(RIGHT_X + 3, ITEM_Y + 3, RIGHT_W - 6, ITEM_H - 6, EditorField.ITEM);
    this.text(RIGHT_X + 7, ITEM_Y + 5, "ITEM", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const vx = RIGHT_X + 40;
    if (this.isMega) {
      this.text(vx + 12, ITEM_Y + 4, "Mega Stone", TextStyle.SUMMARY_PINK, 0, FONT_NAME);
      this.text(vx + 12, ITEM_Y + 12, "Auto-forced by the mega stage (locked).", TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
      return;
    }
    const key = this.config!.set.item as ShowdownItemKey;
    const resolved = this.resolvedItem(key);
    if (resolved?.iconImage) {
      const icon = globalScene.add
        .sprite(vx + 4, ITEM_Y + 8, "items", resolved.iconImage)
        .setOrigin(0.5, 0.5)
        .setScale(0.42);
      this.add(icon);
    }
    this.text(vx + 12, ITEM_Y + 4, resolved?.name ?? String(key), TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(
      vx + 12,
      ITEM_Y + 12,
      this.clip(resolved?.getDescription() ?? "", 58),
      TextStyle.SUMMARY_GRAY,
      0,
      FONT_TINY,
    );
  }

  // -- MOVES panel: a 2x2 grid of cells (compact, fits with the abilities block) -----------------

  private renderMovesPanel(): void {
    this.add(addWindow(RIGHT_X, MOVES_Y, RIGHT_W, MOVES_H));
    this.sectionHeader(MOVES_Y, "MOVES");
    const cellW = (RIGHT_W - 9) / 2; // two columns with a small central gutter
    const cellH = 16;
    const gridY = MOVES_Y + 13;
    for (let slot = 0; slot < 4; slot++) {
      const col = slot % 2;
      const row = Math.floor(slot / 2);
      const cx = RIGHT_X + 3 + col * (cellW + 3);
      const cy = gridY + row * (cellH + 1);
      this.renderMoveCell(cx, cy, cellW, cellH, slot);
    }
  }

  private renderMoveCell(cx: number, cy: number, w: number, h: number, slot: number): void {
    this.focusBox(cx, cy, w, h, MOVE_FIELDS[slot]);
    const moveId = this.config!.set.moves[slot];
    if (moveId == null) {
      this.text(cx + 5, cy + 5, `-- empty --  (${slot + 1})`, TextStyle.SUMMARY_GRAY, 0, FONT_DESC);
      return;
    }
    const move = allMoves[moveId];
    this.text(cx + 5, cy + 1, this.clip(move?.name ?? "-", 16), TextStyle.SUMMARY_GOLD, 0, FONT_DESC);
    if (!move) {
      return;
    }
    const tSpr = globalScene.add
      .sprite(cx + 11, cy + 11, getLocalizedSpriteKey("types"), PokemonType[move.type].toLowerCase())
      .setOrigin(0.5, 0.5)
      .setScale(0.34);
    this.add(tSpr);
    const cSpr = globalScene.add
      .sprite(cx + 27, cy + 11, "categories", MoveCategory[move.category].toLowerCase())
      .setOrigin(0.5, 0.5)
      .setScale(0.5);
    this.add(cSpr);
    const bp = move.power > 0 ? String(move.power) : "-";
    const acc = move.accuracy > 0 ? String(move.accuracy) : "-";
    this.text(cx + 38, cy + 9, `BP ${bp}`, TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
    this.text(cx + w - 4, cy + 9, `${acc}%`, TextStyle.SUMMARY_GRAY, 1, FONT_TINY);
  }

  // -- NATURE panel -----------------------------------------------------------------------------

  private renderNaturePanel(): void {
    this.add(addWindow(RIGHT_X, NAT_Y, RIGHT_W, NAT_H));
    this.focusBox(RIGHT_X + 3, NAT_Y + 3, RIGHT_W - 6, NAT_H - 6, EditorField.NATURE);
    this.text(RIGHT_X + 7, NAT_Y + 4, "NATURE", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const name = getNatureName(this.config!.set.nature as Nature, false, false, true);
    const summary = getNatureName(this.config!.set.nature as Nature, true, false, true).replace(/\n/g, " ");
    this.text(RIGHT_X + 44, NAT_Y + 3, summary || name, TextStyle.SUMMARY_GOLD, 0, FONT_NAME);
    this.text(
      RIGHT_X + 44,
      NAT_Y + 11,
      "Free pick - recolors the stat bars live.",
      TextStyle.SUMMARY_GRAY,
      0,
      FONT_TINY,
    );
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

  // -- floating search DROPDOWN (drawn on top, only while actively searching) --------------------

  private renderDropdown(): void {
    this.add(addWindow(DROP_X, DROP_Y, DROP_W, DROP_H));
    // Search bar: the focused field's pool name + the live typed query with a caret. Typing filled it
    // directly (no "browse" button) - an empty query means the controller opened it unfiltered.
    const barY = DROP_Y + 3;
    this.fill(DROP_X + 3, barY, DROP_W - 6, 11, HEADER_BAND, 1);
    this.text(DROP_X + 6, barY + 2, this.fieldName(this.field), TextStyle.SUMMARY_GOLD, 0, FONT_HDR);
    if (this.filter) {
      this.text(DROP_X + 70, barY + 2, `${this.filter}_`, TextStyle.WINDOW, 0, FONT_HDR);
    } else {
      this.text(DROP_X + 70, barY + 2, "type to search", TextStyle.SHADOW_TEXT, 0, FONT_HDR);
    }
    const top = DROP_Y + 17;
    switch (this.field) {
      case EditorField.ABILITY:
        this.renderAbilityDropdown(top);
        break;
      case EditorField.ITEM:
        this.renderItemDropdown(top);
        break;
      case EditorField.NATURE:
        this.renderNatureDropdown(top);
        break;
      default:
        this.renderMoveDropdown(top);
        break;
    }
  }

  private fieldName(field: EditorField): string {
    switch (field) {
      case EditorField.ABILITY:
        return "ABILITY";
      case EditorField.ITEM:
        return "ITEM";
      case EditorField.NATURE:
        return "NATURE";
      default:
        return `MOVE ${MOVE_FIELDS.indexOf(field) + 1}`;
    }
  }

  private static readonly DROP_FOOTER_Y = SCREEN_H - 12;
  private static readonly DROP_ROW_H = 11;

  private dropFooter(desc: string): void {
    const y = ShowdownSetEditorUiHandler.DROP_FOOTER_Y;
    this.fill(DROP_X + 3, y, DROP_W - 6, 10, 0x0d1524, 1);
    this.text(DROP_X + 6, y + 1, this.clip(desc, 68), TextStyle.SUMMARY_GRAY, 0, FONT_TINY);
  }

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
    const hi = entries[this.paneCursor];
    const hiMove = hi ? allMoves[hi.moveId] : null;
    this.dropFooter(hi?.locked ? hi.reason : (hiMove?.effect ?? ""));
  }

  private renderMoveDropRow(e: MovePaneEntry, i: number, top: number): void {
    const move = allMoves[e.moveId];
    const ry = this.dropRow(i, top);
    const style = e.locked ? TextStyle.SHADOW_TEXT : i === this.paneCursor ? TextStyle.WINDOW : TextStyle.SUMMARY_GRAY;
    this.text(DROP_X + 8, ry + 1, this.clip(`${e.name}${e.locked ? " (egg)" : ""}`, 22), style, 0, FONT_DESC);
    if (!move) {
      return;
    }
    const tSpr = globalScene.add
      .sprite(DROP_X + 120, ry + 4, getLocalizedSpriteKey("types"), PokemonType[move.type].toLowerCase())
      .setOrigin(0.5, 0.5)
      .setScale(0.34);
    tSpr.setAlpha(e.locked ? 0.4 : 1);
    this.add(tSpr);
    this.text(DROP_X + 140, ry + 1, categoryLabel(move.category), style, 0, FONT_TINY);
    this.text(DROP_X + 156, ry + 1, move.power > 0 ? `BP ${move.power}` : "BP -", style, 0, FONT_TINY);
    this.text(DROP_X + 184, ry + 1, move.accuracy > 0 ? `${move.accuracy}%` : "-", style, 0, FONT_TINY);
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
      this.text(DROP_X + 24, ry + 1, this.clip(resolved?.name ?? String(keys[i]), 26), style, 0, FONT_DESC);
      this.text(DROP_X + 122, ry + 2, this.clip(resolved?.getDescription() ?? "", 30), style, 0, FONT_TINY);
    }
    const hi = this.resolvedItem(keys[this.paneCursor]);
    this.dropFooter(hi?.getDescription() ?? "");
  }

  private renderAbilityDropdown(top: number): void {
    // Only the 3 ACTIVES are selectable (the innates live on the main screen, always-on). Locked slots
    // are grayed WITH the unlock reason, never hidden.
    const cfg = this.config!;
    const actives = this.activeAbilityIds();
    actives.forEach((id, i) => {
      const ry = this.dropRow(i, top + i * 2); // extra breathing room - only 3 rows
      const unlocked = cfg.unlocks.unlockedAbilityIndices.includes(i);
      const ability = allAbilities[id];
      const style = unlocked
        ? i === this.paneCursor
          ? TextStyle.WINDOW
          : TextStyle.SUMMARY_GOLD
        : TextStyle.SHADOW_TEXT;
      const mark = cfg.set.abilityIndex === i ? "(*) " : "( ) ";
      this.text(
        DROP_X + 8,
        ry + 1,
        `${mark}${ability?.name ?? "-"}${unlocked ? "" : "  [LOCKED]"}`,
        style,
        0,
        FONT_NAME,
      );
      this.text(
        DROP_X + 12,
        ry + 8,
        this.clip(unlocked ? (ability?.description ?? "") : "Unlock this ability slot in the collection.", 60),
        TextStyle.SUMMARY_GRAY,
        0,
        FONT_TINY,
      );
    });
    const hi = allAbilities[actives[this.paneCursor]];
    const unlocked = cfg.unlocks.unlockedAbilityIndices.includes(this.paneCursor);
    this.dropFooter(unlocked ? (hi?.description ?? "") : "Locked ability slot - unlock it in the collection.");
  }

  private renderNatureDropdown(top: number): void {
    const natures = this.natureList();
    const visible = ShowdownSetEditorUiHandler.PANE_VISIBLE_ROWS;
    const start = this.paneScroll;
    const end = Math.min(start + visible, natures.length);
    for (let i = start; i < end; i++) {
      const nat = natures[i];
      const ry = this.dropRow(i, top);
      const style =
        i === this.paneCursor
          ? TextStyle.WINDOW
          : nat === this.config!.set.nature
            ? TextStyle.SUMMARY_GOLD
            : TextStyle.SUMMARY_GRAY;
      this.text(DROP_X + 8, ry + 1, getNatureName(nat as Nature, false, false, true), style, 0, FONT_DESC);
      this.text(
        DROP_X + 70,
        ry + 2,
        getNatureName(nat as Nature, true, false, true)
          .replace(/\n/g, " ")
          .replace(/[()]/g, ""),
        style,
        0,
        FONT_TINY,
      );
    }
    const picked = natures[this.paneCursor];
    this.dropFooter(
      picked == null
        ? ""
        : `${getNatureName(picked as Nature, true, false, true).replace(/\n/g, " ")} - live stat-bar preview.`,
    );
  }

  clear(): void {
    super.clear();
    this.clearDynamic();
    this.textInput?.close();
    this.container.setVisible(false);
    this.config = null;
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
    unlocks: {
      ownedVariants: [0, 1],
      blackShinyOwned: true,
      unlockedAbilityIndices: [0, 2],
      unlockedEggMoveBits: 0b0011,
      megaBudgetSpent: false,
    },
    team,
    activeSlot: 2,
    pickSecondsLeft: 583,
    partnerReady: false,
    ...overrides,
  };
}
