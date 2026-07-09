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
// Layout (logical 320x180, x6 to screen):
//   - TOP micro TEAM STRIP: 6 slot icons + validity chips (size / mega / cost) + a
//     pick-window countdown placeholder + a partner-ready placeholder. (No wager
//     preview - cut from v1.)
//   - LEFT IDENTITY COLUMN (~1/3): the (harness-static) sprite, the evolution STAGE
//     STRIP with the mega slot + its team-budget state, shiny/variant chips
//     (owned / locked / black-unfieldable), live STAT BARS with nature +/- coloring,
//     and a cost badge.
//   - RIGHT FIELD ROWS (~2/3): Ability, Item, Moves x4, Nature - each row shows its
//     current value AND a one-line description, with distinct focused/unfocused states.
//   - BOTTOM SHARED SEARCH PANE: one pane whose contents follow the focused field -
//     collapsed hint, the move table (typeahead), the ability pane (actives + innates),
//     the item pane, or the nature pane. A footer shows the highlighted entry's description.
//
// P1 SCOPE: this is the standalone LAYOUT + basic focus/input plumbing. Flow wiring
// (opening it from the grid, committing back into the negotiate/wager flow) and the
// mobile hidden-input bridge (see {@linkcode ShowdownEditorTextInput}) land in the NEXT
// task. The handler consumes a plain {@linkcode ShowdownSetEditorConfig} so wiring is trivial.
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

const STRIP_H = 22;
const BODY_Y = STRIP_H + 2;

const LEFT_X = 3;
const LEFT_W = 100;
const RIGHT_X = LEFT_X + LEFT_W + 3; // 106
const RIGHT_W = SCREEN_W - RIGHT_X - 3; // 211

// The shared search pane occupies the RIGHT column BELOW the field rows, so the left identity
// column stays full-height and always visible (a deliberate improvement over the Showdown layout,
// where opening the search hides the set). The description footer spans the pane width.
const FIELD_TOP = BODY_Y + 2;
const FIELD_ROW_H = 13;
const PANE_X = RIGHT_X;
const PANE_W = SCREEN_W - RIGHT_X - 3; // 211
const PANE_Y = FIELD_TOP + 7 * FIELD_ROW_H + 1; // just under the 7 field rows
const PANE_H = SCREEN_H - PANE_Y - 3;

const ACCENT = 0x3d5a80; // focused-row fill
const ACCENT_PANE = 0x2a3f5c; // pane focused-row fill
const PANEL_DIM = 0x0b1220;

// Font sizes (the addTextObject default is a huge 96; dense screens run ~34-52).
const FONT_HDR = 40; // small section/row labels
const FONT_VAL = 48; // the chosen value on a field row
const FONT_DESC = 32; // inline descriptions / dense table cells
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

  private openPane(): boolean {
    this.paneOpen = true;
    this.paneCursor = this.currentPaneSelectionIndex();
    this.paneScroll = 0;
    this.ensurePaneCursorVisible();
    // Mobile: raise the native keyboard for typeahead fields (stubbed until the NEXT task).
    if (this.field === EditorField.ITEM || MOVE_FIELDS.includes(this.field)) {
      this.textInput?.open(this.filter, value => this.setFilter(value));
    }
    this.render();
    return true;
  }

  private closePane(): void {
    this.paneOpen = false;
    this.filter = "";
    this.textInput?.close();
    this.render();
  }

  /** Keyboard / mobile typeahead entry point (the NEXT task drives this from real input). */
  setFilter(value: string): void {
    this.filter = value;
    this.paneCursor = 0;
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
    let list = [...entries.values()];
    if (this.filter) {
      const f = this.filter.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(f));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  private itemKeys(): ShowdownItemKey[] {
    let keys = [...SHOWDOWN_ITEM_POOL];
    if (this.filter) {
      const f = this.filter.toLowerCase();
      keys = keys.filter(k => this.itemName(k).toLowerCase().includes(f));
    }
    return keys.sort((a, b) => this.itemName(a).localeCompare(this.itemName(b)));
  }

  private itemName(key: ShowdownItemKey): string {
    const modType = modifierTypes[key];
    return modType == null ? String(key) : (getModifierType(modType).name ?? String(key));
  }

  private natureList(): number[] {
    return (Object.values(Nature).filter(n => typeof n === "number") as number[]).sort((a, b) => a - b);
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
    this.renderFieldRows();
    this.renderPane();
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

    // Countdown placeholder (right).
    const mm = Math.floor(cfg.pickSecondsLeft / 60);
    const ss = cfg.pickSecondsLeft % 60;
    const clock = `${mm}:${String(ss).padStart(2, "0")}`;
    this.text(280, 2, "PICK", TextStyle.SUMMARY_GRAY, 0, 26);
    this.text(300, 2, clock, cfg.pickSecondsLeft <= 60 ? TextStyle.SUMMARY_RED : TextStyle.SUMMARY_GOLD, 1, FONT_CHIP);

    // Partner-ready placeholder (right, below clock).
    const partner = cfg.partnerReady == null ? "Partner -" : cfg.partnerReady ? "Partner READY" : "Partner waiting";
    this.text(300, 13, partner, cfg.partnerReady ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY, 1, 26);
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
    // Name (left) + cost badge (right) on the header line.
    this.text(LEFT_X + 5, BODY_Y + 3, sp.name, TextStyle.SUMMARY_GOLD, 0, FONT_TITLE);
    const rootCost = cfg.team[cfg.activeSlot]?.baseCost ?? 0;
    this.text(LEFT_X + LEFT_W - 4, BODY_Y + 4, `Cost ${rootCost}`, TextStyle.SUMMARY_HEADER, 1, FONT_HDR);

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

  // -- right field rows -------------------------------------------------------------------------

  private renderFieldRows(): void {
    let y = FIELD_TOP;
    y = this.renderAbilityRow(y);
    y = this.renderItemRow(y);
    for (let i = 0; i < 4; i++) {
      y = this.renderMoveRow(y, i);
    }
    this.renderNatureRow(y);
  }

  private rowFrame(y: number, field: EditorField): void {
    const focused = this.field === field && !this.paneOpen;
    const focusedInPane = this.field === field && this.paneOpen;
    // Focus accent bar on the left edge + a row fill that brightens on focus.
    this.fill(
      RIGHT_X,
      y,
      RIGHT_W,
      FIELD_ROW_H - 1,
      focused ? ACCENT : focusedInPane ? ACCENT_PANE : PANEL_DIM,
      focused ? 1 : 0.5,
    );
    if (focused) {
      this.fill(RIGHT_X, y, 2, FIELD_ROW_H - 1, 0xffd447, 1);
    }
  }

  private readonly LABEL_X = RIGHT_X + 5;
  private readonly VAL_X = RIGHT_X + 44;

  private renderAbilityRow(y: number): number {
    this.rowFrame(y, EditorField.ABILITY);
    const id = this.activeAbilityIds()[this.config!.set.abilityIndex] ?? this.activeAbilityIds()[0];
    const ability = allAbilities[id];
    this.text(this.LABEL_X, y + 2, "Ability", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    this.text(this.VAL_X, y + 1, ability?.name ?? "-", TextStyle.SUMMARY_GOLD, 0, FONT_VAL);
    this.text(this.VAL_X, y + 8, this.clip(ability?.description ?? "", 66), TextStyle.SUMMARY_GRAY, 0, 26);
    return y + FIELD_ROW_H;
  }

  private renderItemRow(y: number): number {
    this.rowFrame(y, EditorField.ITEM);
    this.text(this.LABEL_X, y + 2, "Item", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    if (this.isMega) {
      this.text(this.VAL_X, y + 1, "Mega Stone", TextStyle.SUMMARY_PINK, 0, FONT_VAL);
      this.text(this.VAL_X, y + 8, "Auto-forced by the mega stage (slot locked).", TextStyle.SUMMARY_GRAY, 0, 26);
      return y + FIELD_ROW_H;
    }
    const key = this.config!.set.item as ShowdownItemKey;
    const modType = modifierTypes[key];
    const resolved = modType == null ? null : getModifierType(modType);
    if (resolved?.iconImage) {
      const icon = globalScene.add
        .sprite(this.VAL_X + 4, y + 4, "items", resolved.iconImage)
        .setOrigin(0.5, 0.5)
        .setScale(0.45);
      this.add(icon);
    }
    this.text(this.VAL_X + 11, y + 1, resolved?.name ?? String(key), TextStyle.SUMMARY_GOLD, 0, FONT_VAL);
    this.text(this.VAL_X, y + 8, this.clip(resolved?.getDescription() ?? "", 66), TextStyle.SUMMARY_GRAY, 0, 26);
    return y + FIELD_ROW_H;
  }

  private renderMoveRow(y: number, slot: number): number {
    const field = MOVE_FIELDS[slot];
    this.rowFrame(y, field);
    const moveId = this.config!.set.moves[slot];
    this.text(this.LABEL_X, y + 2, `Move ${slot + 1}`, TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    if (moveId == null) {
      this.text(this.VAL_X, y + 3, "-- empty --", TextStyle.SUMMARY_GRAY, 0, FONT_DESC);
      return y + FIELD_ROW_H;
    }
    const move = allMoves[moveId];
    this.text(this.VAL_X, y + 3, move?.name ?? "-", TextStyle.SUMMARY_GOLD, 0, FONT_VAL);
    if (move) {
      // Type + category icons + BP/Acc/PP, right-aligned block.
      const catX = RIGHT_X + RIGHT_W - 88;
      const typeX = RIGHT_X + RIGHT_W - 104;
      const tSpr = globalScene.add
        .sprite(typeX, y + 6, getLocalizedSpriteKey("types"), PokemonType[move.type].toLowerCase())
        .setOrigin(0.5, 0.5)
        .setScale(0.42);
      this.add(tSpr);
      const cSpr = globalScene.add
        .sprite(catX, y + 6, "categories", MoveCategory[move.category].toLowerCase())
        .setOrigin(0.5, 0.5)
        .setScale(0.6);
      this.add(cSpr);
      const bp = move.power > 0 ? `${move.power}` : "-";
      const acc = move.accuracy > 0 ? `${move.accuracy}` : "-";
      this.text(RIGHT_X + RIGHT_W - 70, y + 2, `BP ${bp}`, TextStyle.SUMMARY_GRAY, 0, 28);
      this.text(RIGHT_X + RIGHT_W - 70, y + 8, `Acc ${acc}`, TextStyle.SUMMARY_GRAY, 0, 28);
      this.text(RIGHT_X + RIGHT_W - 30, y + 2, `PP ${move.pp}`, TextStyle.SUMMARY_GRAY, 0, 28);
    }
    return y + FIELD_ROW_H;
  }

  private renderNatureRow(y: number): number {
    this.rowFrame(y, EditorField.NATURE);
    this.text(this.LABEL_X, y + 2, "Nature", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    const name = getNatureName(this.config!.set.nature as Nature, false, false, true);
    const summary = getNatureName(this.config!.set.nature as Nature, true, false, true).replace(/\n/g, " ");
    this.text(this.VAL_X, y + 1, summary || name, TextStyle.SUMMARY_GOLD, 0, FONT_VAL);
    this.text(this.VAL_X, y + 8, "Free pick - recolors the stat bars live.", TextStyle.SUMMARY_GRAY, 0, 26);
    return y + FIELD_ROW_H;
  }

  private clip(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 2)}..` : s;
  }

  // -- bottom shared search pane ----------------------------------------------------------------

  private renderPane(): void {
    this.add(addWindow(PANE_X, PANE_Y, PANE_W, PANE_H));
    if (!this.paneOpen) {
      this.text(PANE_X + 6, PANE_Y + 4, "SEARCH", TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
      const label = FIELD_ORDER.indexOf(this.field) >= 0 ? this.fieldName(this.field) : "";
      this.text(PANE_X + 6, PANE_Y + 16, `Press A to browse ${label}.`, TextStyle.SUMMARY_GOLD, 0, FONT_DESC);
      this.text(PANE_X + 6, PANE_Y + 28, "Type to filter, arrows to move, B to close.", TextStyle.SUMMARY_GRAY, 0, 26);
      return;
    }
    switch (this.field) {
      case EditorField.ABILITY:
        this.renderAbilityPane();
        break;
      case EditorField.ITEM:
        this.renderItemPane();
        break;
      case EditorField.NATURE:
        this.renderNaturePane();
        break;
      default:
        this.renderMovePane();
        break;
    }
  }

  private fieldName(field: EditorField): string {
    switch (field) {
      case EditorField.ABILITY:
        return "abilities";
      case EditorField.ITEM:
        return "items";
      case EditorField.NATURE:
        return "natures";
      default:
        return `Move ${MOVE_FIELDS.indexOf(field) + 1}`;
    }
  }

  private static readonly FOOTER_Y = SCREEN_H - 11;

  private paneHeader(title: string): void {
    this.text(PANE_X + 6, PANE_Y + 3, title, TextStyle.SUMMARY_HEADER, 0, FONT_HDR);
    if (this.filter) {
      this.text(PANE_X + 54, PANE_Y + 3, `filter: ${this.filter}_`, TextStyle.SUMMARY_GOLD, 0, FONT_HDR);
    }
  }

  private paneFooter(desc: string): void {
    const y = ShowdownSetEditorUiHandler.FOOTER_Y;
    this.fill(PANE_X + 3, y, PANE_W - 6, 9, 0x101827, 1);
    this.text(PANE_X + 6, y + 1, this.clip(desc, 62), TextStyle.SUMMARY_GRAY, 0, 26);
  }

  private renderMovePane(): void {
    this.paneHeader("MOVES");
    const entries = this.moveEntries();
    // Column headers. Effect snippet lives in the footer (the highlighted move's full text).
    const hy = PANE_Y + 11;
    const cName = PANE_X + 7;
    const cType = PANE_X + 96;
    const cCat = PANE_X + 122;
    const cBp = PANE_X + 142;
    const cAcc = PANE_X + 168;
    const cPp = PANE_X + 192;
    const HF = 22;
    this.text(cName, hy, "Name", TextStyle.SUMMARY_BLUE, 0, HF);
    this.text(cType, hy, "Type", TextStyle.SUMMARY_BLUE, 0, HF);
    this.text(cCat, hy, "Cat", TextStyle.SUMMARY_BLUE, 0, HF);
    this.text(cBp, hy, "BP", TextStyle.SUMMARY_BLUE, 0, HF);
    this.text(cAcc, hy, "Acc", TextStyle.SUMMARY_BLUE, 0, HF);
    this.text(cPp, hy, "PP", TextStyle.SUMMARY_BLUE, 0, HF);

    const visible = ShowdownSetEditorUiHandler.PANE_VISIBLE_ROWS;
    const rowH = 6;
    const start = this.paneScroll;
    const end = Math.min(start + visible, entries.length);
    for (let i = start; i < end; i++) {
      const e = entries[i];
      const move = allMoves[e.moveId];
      const ry = PANE_Y + 17 + (i - start) * rowH;
      if (i === this.paneCursor) {
        this.fill(PANE_X + 3, ry - 1, PANE_W - 6, rowH, ACCENT, 1);
      }
      const nameStyle = e.locked
        ? TextStyle.SHADOW_TEXT
        : i === this.paneCursor
          ? TextStyle.WINDOW
          : TextStyle.SUMMARY_GRAY;
      const lockTag = e.locked ? " (egg)" : "";
      this.text(cName, ry, this.clip(`${e.name}${lockTag}`, 20), nameStyle, 0, 24);
      if (move) {
        const tSpr = globalScene.add
          .sprite(cType + 9, ry + 2, getLocalizedSpriteKey("types"), PokemonType[move.type].toLowerCase())
          .setOrigin(0.5, 0.5)
          .setScale(0.34);
        tSpr.setAlpha(e.locked ? 0.4 : 1);
        this.add(tSpr);
        this.text(cCat, ry, categoryLabel(move.category), nameStyle, 0, 24);
        this.text(cBp, ry, move.power > 0 ? String(move.power) : "-", nameStyle, 0, 24);
        this.text(cAcc, ry, move.accuracy > 0 ? String(move.accuracy) : "-", nameStyle, 0, 24);
        this.text(cPp, ry, String(move.pp), nameStyle, 0, 24);
      }
    }
    const highlighted = entries[this.paneCursor];
    const footerMove = highlighted ? allMoves[highlighted.moveId] : null;
    this.paneFooter(highlighted?.locked ? highlighted.reason : (footerMove?.effect ?? ""));
  }

  private renderAbilityPane(): void {
    this.paneHeader("ABILITY");
    const actives = this.activeAbilityIds();
    const cfg = this.config!;
    // Actives (selectable; locked slots grayed with reason). Left half of the pane.
    const actX = PANE_X + 6;
    this.text(actX, PANE_Y + 11, "ACTIVES (pick one)", TextStyle.SUMMARY_BLUE, 0, 24);
    actives.forEach((id, i) => {
      const ry = PANE_Y + 17 + i * 11;
      const unlocked = cfg.unlocks.unlockedAbilityIndices.includes(i);
      if (i === this.paneCursor) {
        this.fill(actX - 2, ry - 1, 100, 10, ACCENT, 1);
      }
      const ability = allAbilities[id];
      const style = unlocked
        ? i === this.paneCursor
          ? TextStyle.WINDOW
          : TextStyle.SUMMARY_GOLD
        : TextStyle.SHADOW_TEXT;
      const mark = cfg.set.abilityIndex === i ? "[*] " : "[ ] ";
      this.text(actX, ry, `${mark}${ability?.name ?? "-"}${unlocked ? "" : " LOCK"}`, style, 0, 26);
      this.text(
        actX + 4,
        ry + 5,
        this.clip(unlocked ? (ability?.description ?? "") : "Unlock this ability slot in the collection.", 28),
        TextStyle.SUMMARY_GRAY,
        0,
        22,
      );
    });
    // Innates (informational - always active, never picked). Right half of the pane.
    const innates = this.innateAbilityIds();
    const innX = PANE_X + 108;
    this.text(innX, PANE_Y + 11, "INNATES (always on)", TextStyle.SUMMARY_PINK, 0, 24);
    innates.forEach((id, i) => {
      const ry = PANE_Y + 17 + i * 11;
      const ability = allAbilities[id];
      this.text(innX, ry, ability?.name ?? "-", TextStyle.SUMMARY_GOLD, 0, 26);
      this.text(innX + 4, ry + 5, this.clip(ability?.description ?? "", 30), TextStyle.SUMMARY_GRAY, 0, 22);
    });
    const highlighted = allAbilities[actives[this.paneCursor]];
    const unlocked = cfg.unlocks.unlockedAbilityIndices.includes(this.paneCursor);
    this.paneFooter(unlocked ? (highlighted?.description ?? "") : "Locked ability slot - unlock it in the collection.");
  }

  private renderItemPane(): void {
    this.paneHeader("ITEM");
    const keys = this.itemKeys();
    const visible = ShowdownSetEditorUiHandler.PANE_VISIBLE_ROWS;
    const rowH = 6;
    const start = this.paneScroll;
    const end = Math.min(start + visible, keys.length);
    for (let i = start; i < end; i++) {
      const key = keys[i];
      const modType = modifierTypes[key];
      const resolved = modType == null ? null : getModifierType(modType);
      const ry = PANE_Y + 12 + (i - start) * rowH;
      if (i === this.paneCursor) {
        this.fill(PANE_X + 3, ry - 1, PANE_W - 6, rowH, ACCENT, 1);
      }
      if (resolved?.iconImage) {
        const icon = globalScene.add
          .sprite(PANE_X + 11, ry + 2, "items", resolved.iconImage)
          .setOrigin(0.5, 0.5)
          .setScale(0.4);
        this.add(icon);
      }
      const style = i === this.paneCursor ? TextStyle.WINDOW : TextStyle.SUMMARY_GRAY;
      this.text(PANE_X + 20, ry, this.clip(resolved?.name ?? String(key), 24), style, 0, 24);
      this.text(PANE_X + 112, ry, this.clip(resolved?.getDescription() ?? "", 30), style, 0, 22);
    }
    const hi = keys[this.paneCursor];
    const hiType = hi == null ? null : modifierTypes[hi];
    this.paneFooter(hiType == null ? "" : (getModifierType(hiType).getDescription() ?? ""));
  }

  private renderNaturePane(): void {
    this.paneHeader("NATURE");
    const natures = this.natureList();
    // A compact 5x5 name grid (the +/- summary + live stat-bar recolor is in the footer/bars).
    const cols = 5;
    const colW = 40;
    const rowH = 8;
    natures.forEach((nat, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = PANE_X + 8 + col * colW;
      const ry = PANE_Y + 12 + row * rowH;
      if (i === this.paneCursor) {
        this.fill(x - 3, ry - 1, colW - 2, rowH, ACCENT, 1);
      }
      const style =
        i === this.paneCursor
          ? TextStyle.WINDOW
          : nat === this.config!.set.nature
            ? TextStyle.SUMMARY_GOLD
            : TextStyle.SUMMARY_GRAY;
      this.text(x, ry, getNatureName(nat as Nature, false, false, true), style, 0, 24);
    });
    const picked = natures[this.paneCursor];
    this.paneFooter(
      picked == null
        ? ""
        : `${getNatureName(picked as Nature, true, false, true).replace(/\n/g, " ")} - preview updates the stat bars.`,
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
