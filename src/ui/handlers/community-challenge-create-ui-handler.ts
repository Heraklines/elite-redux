/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Community Challenge designer (UiMode.COMMUNITY_CHALLENGE_CREATE).
//
// The authoring flow for a player-made challenge run. A vertical field list
// (NAME / SUBTITLE / DESCRIPTION / DIFFICULTY / the inline RULES rows / ALLOWED
// POKEMON / PUBLISH) plus an embedded species multi-select sub-view:
//   - NAME / SUBTITLE / DESCRIPTION  -> reuse UiMode.BUG_REPORT_FORM raw-string
//     text entry (PATTERN 1 direct overlay, revert on callback - the
//     menu-ui-handler.ts:519 idiom). No new form UiMode / positional registration.
//   - DIFFICULTY                     -> LEFT/RIGHT cycles youngster|ace|elite|hell.
//   - RULES                          -> inline `copyChallenge` rows (NOT the real
//     gameMode.challenges); LEFT/RIGHT adjusts each row's value. Serialized to
//     baseChallenges on publish.
//   - ALLOWED POKEMON                -> ACTION drops into an embedded root-starter
//     grid; toggle membership, B commits the whitelist (null = all species).
//   - PUBLISH                        -> CONFIRM -> validateChallengeConfig ->
//     createCommunityChallenge (a server DRAFT) -> success/failure text.
//
// Opened over the browser via PATTERN 1 (setOverlayMode keeps the browser alive
// underneath); CANCEL reverts straight back to it. Drive it headlessly via the
// render-harness recipes `community-challenge-create[-rules|-species]`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { speciesStarterCosts } from "#balance/starters";
import { allChallenges, type Challenge, copyChallenge } from "#data/challenge";
import {
  COMMUNITY_CHALLENGE_SCHEMA_VERSION,
  type CommunityChallengeConfig,
  createCommunityChallenge,
  validateChallengeConfig,
} from "#data/elite-redux/er-community-challenges";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { Button } from "#enums/buttons";
import type { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addPokemonIcon } from "#ui/community-challenge-card";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const SCREEN_W = 320;
const SCREEN_H = 180;

// --- Theme palette (shared with the browser screen) ---
const VOID = 0x080912;
const BAND = 0x10131f;
const GOLD = "#ffd27a";
const GOLD_DIM = "#b9924a";
const INK = "#d8c9a8";
const DIM = "#8a8470";
const ERR = "#e06a6a";
const ACTIVE_RED = 0xd8542a;

// --- List geometry ---
const LIST_X = 8;
const LABEL_X = LIST_X + 4;
const VALUE_X = SCREEN_W - 8;
const LIST_Y = 24;
const ROW_H = 8;
const VISIBLE_ROWS = 15;
const FOOT_Y = SCREEN_H - 16;
const HINT_Y = SCREEN_H - 9;

// --- Difficulty cycling ---
const DIFFICULTIES: ErDifficulty[] = ["youngster", "ace", "elite", "hell"];
const DIFFICULTY_TIERS: Record<ErDifficulty, 1 | 2 | 3 | 4 | 5> = {
  youngster: 1,
  ace: 2,
  elite: 4,
  hell: 5,
};

/** Hard cap mirrored from the validator (CC_MAX_ALLOWED_SPECIES). */
const MAX_ALLOWED_SPECIES = 300;

// --- Species grid geometry ---
const GRID_X = 8;
const GRID_Y = 30;
const GRID_COLS = 14;
const GRID_ROWS = 7;
const GRID_CELL = 16;
const GRID_PAGE = GRID_COLS * GRID_ROWS;

type RowKind = "name" | "subtitle" | "description" | "difficulty" | "rule" | "species" | "publish";

interface FieldRow {
  readonly kind: RowKind;
  /** Index into `this.rules` when kind === "rule". */
  readonly ruleIndex?: number;
}

/** The mutable working draft (CommunityChallengeConfig is readonly; this is the editor's scratch state). */
interface CreateDraft {
  name: string;
  subtitle: string;
  description: string;
  gameModeId: GameModes;
  difficulty: ErDifficulty;
  difficultyTier: 1 | 2 | 3 | 4 | 5;
  allowedSpecies: number[] | null;
  targetWave: number;
  tags: string[];
}

function defaultDraft(): CreateDraft {
  return {
    name: "",
    subtitle: "",
    description: "",
    gameModeId: GameModes.CHALLENGE,
    difficulty: "ace",
    difficultyTier: 2,
    allowedSpecies: null,
    targetWave: 200,
    tags: [],
  };
}

function safeSpeciesName(id: number): string {
  try {
    return getPokemonSpecies(id)?.name ?? `#${id}`;
  } catch {
    return `#${id}`;
  }
}

export class CommunityChallengeCreateUiHandler extends UiHandler {
  private container!: Phaser.GameObjects.Container;
  private dynamic!: Phaser.GameObjects.Container;

  private draft: CreateDraft = defaultDraft();
  /** Standalone copies of every offered challenge (NOT gameMode.challenges). */
  private rules: Challenge[] = [];
  /** The working allowed-species whitelist while the grid sub-view is open. */
  private selected = new Set<number>();
  /** Root starter pool the grid tiles (computed on show). */
  private roots: number[] = [];

  private view: "form" | "species" = "form";
  private rowCursor = 0;
  private scrollTop = 0;
  private speciesCursor = 0;
  private errorMsg: string | null = null;

  constructor() {
    super(UiMode.COMMUNITY_CHALLENGE_CREATE);
  }

  setup(): void {
    const ui = this.getUi();
    const h = globalScene.scaledCanvas.height;
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Opaque void backdrop + header band.
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, VOID, 1).setOrigin(0));
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, 21, BAND, 1).setOrigin(0));

    const eyebrow = addTextObject(LIST_X, 3, "COMMUNITY", TextStyle.WINDOW, { fontSize: "30px" });
    eyebrow.setOrigin(0, 0).setColor(GOLD_DIM);
    this.container.add(eyebrow);
    const title = addTextObject(LIST_X, 9, "FORGE A CHALLENGE", TextStyle.WINDOW, { fontSize: "48px" });
    title.setOrigin(0, 0).setColor(GOLD);
    this.container.add(title);

    // Hint bar.
    this.container.add(globalScene.add.rectangle(0, SCREEN_H - 12, SCREEN_W, 12, BAND, 1).setOrigin(0));
    const hint = addTextObject(
      SCREEN_W / 2,
      HINT_Y,
      "A  Edit / Select     Left Right  Adjust     B  Back",
      TextStyle.WINDOW,
      { fontSize: "28px", align: "center" },
    );
    hint.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(hint);

    this.dynamic = globalScene.add.container(0, 0);
    this.container.add(this.dynamic);
  }

  // ---- Lifecycle ----------------------------------------------------------

  show(args: any[]): boolean {
    super.show(args);
    this.draft = defaultDraft();
    this.rules = allChallenges.map(c => copyChallenge(c));
    this.selected = new Set<number>();
    this.roots = Object.keys(speciesStarterCosts).map(Number);
    this.view = "form";
    this.rowCursor = 0;
    this.scrollTop = 0;
    this.speciesCursor = 0;
    this.errorMsg = null;
    if (args.length > 0 && this.isConfig(args[0])) {
      this.seedFromConfig(args[0] as CommunityChallengeConfig);
    }
    this.rebuild();
    this.container.setVisible(true);
    return true;
  }

  private isConfig(arg: unknown): arg is CommunityChallengeConfig {
    return typeof arg === "object" && arg !== null && typeof (arg as CommunityChallengeConfig).difficulty === "string";
  }

  /** Load an existing config into the editor (the edit path). */
  private seedFromConfig(config: CommunityChallengeConfig): void {
    this.draft = {
      name: config.name,
      subtitle: config.subtitle,
      description: config.description,
      gameModeId: config.gameModeId,
      difficulty: config.difficulty,
      difficultyTier: config.difficultyTier,
      allowedSpecies: config.allowedSpecies ? [...config.allowedSpecies] : null,
      targetWave: config.targetWave,
      tags: [...config.tags],
    };
    for (const rule of this.rules) {
      const tuple = config.baseChallenges.find(([id]) => id === rule.id);
      rule.value = tuple?.[1] ?? 0;
      rule.severity = tuple?.[2] ?? 0;
    }
    if (this.draft.allowedSpecies) {
      this.selected = new Set(this.draft.allowedSpecies);
    }
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.dynamic.removeAll(true);
    this.rules = [];
    this.selected.clear();
  }

  // ---- Field list model ---------------------------------------------------

  private buildRows(): FieldRow[] {
    const rows: FieldRow[] = [{ kind: "name" }, { kind: "subtitle" }, { kind: "description" }, { kind: "difficulty" }];
    this.rules.forEach((_, i) => rows.push({ kind: "rule", ruleIndex: i }));
    rows.push({ kind: "species" });
    rows.push({ kind: "publish" });
    return rows;
  }

  // ---- Rendering ----------------------------------------------------------

  private rebuild(): void {
    this.dynamic.removeAll(true);
    if (this.view === "species") {
      this.buildSpeciesView();
    } else {
      this.buildForm();
    }
  }

  private buildForm(): void {
    const rows = this.buildRows();
    const total = rows.length;
    let top = this.scrollTop;
    if (this.rowCursor < top) {
      top = this.rowCursor;
    }
    if (this.rowCursor >= top + VISIBLE_ROWS) {
      top = this.rowCursor - VISIBLE_ROWS + 1;
    }
    top = Math.max(0, Math.min(top, Math.max(0, total - VISIBLE_ROWS)));
    this.scrollTop = top;

    for (let i = 0; i < VISIBLE_ROWS && top + i < total; i++) {
      const idx = top + i;
      this.buildRow(rows[idx], LIST_Y + i * ROW_H, idx === this.rowCursor);
    }

    // Footer: an error (if any), else the focused row's help / description.
    const focused = rows[this.rowCursor];
    const footer = this.errorMsg ?? this.rowHelp(focused);
    const ft = addTextObject(LABEL_X, FOOT_Y, footer, TextStyle.WINDOW, {
      fontSize: "26px",
      wordWrap: { width: (SCREEN_W - 16) * 6 },
    });
    ft.setOrigin(0, 0).setColor(this.errorMsg ? ERR : DIM);
    this.dynamic.add(ft);
  }

  private buildRow(row: FieldRow, y: number, focused: boolean): void {
    if (focused) {
      const hl = globalScene.add.rectangle(LIST_X, y - 1, SCREEN_W - LIST_X * 2, ROW_H, ACTIVE_RED, 0.18).setOrigin(0);
      hl.setStrokeStyle(1, ACTIVE_RED, 0.85);
      this.dynamic.add(hl);
    }

    if (row.kind === "publish") {
      const t = addTextObject(SCREEN_W / 2, y, "PUBLISH CHALLENGE", TextStyle.WINDOW, {
        fontSize: "32px",
        align: "center",
      });
      t.setOrigin(0.5, 0).setColor(focused ? GOLD : GOLD_DIM);
      this.dynamic.add(t);
      return;
    }

    const label = addTextObject(LABEL_X, y, this.rowLabel(row), TextStyle.WINDOW, { fontSize: "28px" });
    label.setOrigin(0, 0).setColor(focused ? GOLD : GOLD_DIM);
    this.dynamic.add(label);

    const adjustable = row.kind === "difficulty" || row.kind === "rule";
    const value = this.rowValue(row);
    const text = focused && adjustable ? `< ${value} >` : value;
    const v = addTextObject(VALUE_X, y, text, TextStyle.WINDOW, { fontSize: "28px", align: "right" });
    v.setOrigin(1, 0).setColor(this.rowValueColor(row));
    this.dynamic.add(v);
  }

  private rowLabel(row: FieldRow): string {
    switch (row.kind) {
      case "name":
        return "NAME";
      case "subtitle":
        return "SUBTITLE";
      case "description":
        return "DESCRIPTION";
      case "difficulty":
        return "DIFFICULTY";
      case "species":
        return "ALLOWED POKEMON";
      case "rule":
        return this.rules[row.ruleIndex ?? 0]?.getName() ?? "RULE";
      default:
        return "";
    }
  }

  private rowValue(row: FieldRow): string {
    switch (row.kind) {
      case "name":
        return this.draft.name || "(empty)";
      case "subtitle":
        return this.draft.subtitle || "(none)";
      case "description":
        return this.draft.description ? this.truncate(this.draft.description, 28) : "(none)";
      case "difficulty":
        return this.draft.difficulty.toUpperCase();
      case "species":
        return this.draft.allowedSpecies ? `${this.draft.allowedSpecies.length} SELECTED` : "ALL";
      case "rule":
        return this.ruleValueText(this.rules[row.ruleIndex ?? 0]);
      default:
        return "";
    }
  }

  private rowValueColor(row: FieldRow): string {
    if (row.kind === "name" && this.draft.name.length === 0) {
      return ERR;
    }
    if (row.kind === "rule") {
      return (this.rules[row.ruleIndex ?? 0]?.value ?? 0) > 0 ? INK : DIM;
    }
    if (
      (row.kind === "subtitle" && this.draft.subtitle.length === 0)
      || (row.kind === "description" && this.draft.description.length === 0)
    ) {
      return DIM;
    }
    return INK;
  }

  private ruleValueText(rule: Challenge | undefined): string {
    if (!rule) {
      return "OFF";
    }
    if (rule.value === 0) {
      return "OFF";
    }
    if (rule.maxValue === 1) {
      return "ON";
    }
    return rule.getValue();
  }

  private rowHelp(row: FieldRow): string {
    switch (row.kind) {
      case "name":
        return "Press A to name the challenge (required).";
      case "subtitle":
        return "Press A to set an optional subtitle.";
      case "description":
        return "Press A to set an optional description.";
      case "difficulty":
        return "Left / Right cycles the run difficulty.";
      case "species":
        return "Press A to restrict the run to chosen Pokemon (default: all).";
      case "publish":
        return "Press A to publish this challenge as a draft.";
      case "rule":
        return this.rules[row.ruleIndex ?? 0]?.getDescription() ?? "";
      default:
        return "";
    }
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  // ---- Species sub-view ---------------------------------------------------

  private buildSpeciesView(): void {
    const head = addTextObject(GRID_X, 23, "SELECT ALLOWED POKEMON", TextStyle.WINDOW, { fontSize: "30px" });
    head.setOrigin(0, 0).setColor(GOLD);
    this.dynamic.add(head);

    const page = Math.floor(this.speciesCursor / GRID_PAGE);
    const pageStart = page * GRID_PAGE;
    for (let i = 0; i < GRID_PAGE && pageStart + i < this.roots.length; i++) {
      const id = this.roots[pageStart + i];
      const col = i % GRID_COLS;
      const rowI = Math.floor(i / GRID_COLS);
      const gx = GRID_X + col * GRID_CELL;
      const gy = GRID_Y + rowI * GRID_CELL;
      addPokemonIcon(this.dynamic, id, gx, gy, GRID_CELL - 2);
      if (this.selected.has(id)) {
        const sel = globalScene.add.rectangle(gx, gy, GRID_CELL - 1, GRID_CELL - 1, 0, 0).setOrigin(0);
        sel.setStrokeStyle(1, 0xffd27a, 0.95);
        this.dynamic.add(sel);
      }
    }

    // Cursor highlight.
    const ci = this.speciesCursor - pageStart;
    const ccol = ci % GRID_COLS;
    const crow = Math.floor(ci / GRID_COLS);
    const cur = globalScene.add
      .rectangle(GRID_X + ccol * GRID_CELL, GRID_Y + crow * GRID_CELL, GRID_CELL - 1, GRID_CELL - 1, ACTIVE_RED, 0.2)
      .setOrigin(0);
    cur.setStrokeStyle(1, ACTIVE_RED, 0.95);
    this.dynamic.add(cur);

    const focusedId = this.roots[this.speciesCursor];
    const name = addTextObject(GRID_X, FOOT_Y - 8, focusedId ? safeSpeciesName(focusedId) : "", TextStyle.WINDOW, {
      fontSize: "28px",
    });
    name.setOrigin(0, 0).setColor(INK);
    this.dynamic.add(name);

    const count = addTextObject(
      GRID_X,
      FOOT_Y,
      `${this.selected.size} selected (max ${MAX_ALLOWED_SPECIES}).  A Toggle    B Done`,
      TextStyle.WINDOW,
      { fontSize: "26px" },
    );
    count.setOrigin(0, 0).setColor(DIM);
    this.dynamic.add(count);
  }

  // ---- Input --------------------------------------------------------------

  processInput(button: Button): boolean {
    if (this.view === "species") {
      return this.processSpeciesInput(button);
    }
    return this.processFormInput(button);
  }

  private processFormInput(button: Button): boolean {
    const rows = this.buildRows();
    switch (button) {
      case Button.CANCEL:
        globalScene.ui.playSelect();
        this.requestExit();
        return true;
      case Button.UP:
        this.errorMsg = null;
        this.rowCursor = (this.rowCursor + rows.length - 1) % rows.length;
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.DOWN:
        this.errorMsg = null;
        this.rowCursor = (this.rowCursor + 1) % rows.length;
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.LEFT:
        this.adjustRow(rows[this.rowCursor], -1);
        return true;
      case Button.RIGHT:
        this.adjustRow(rows[this.rowCursor], 1);
        return true;
      case Button.ACTION:
      case Button.SUBMIT:
        globalScene.ui.playSelect();
        this.activateRow(rows[this.rowCursor]);
        return true;
      default:
        return false;
    }
  }

  private adjustRow(row: FieldRow, dir: number): void {
    if (row.kind === "difficulty") {
      const i = DIFFICULTIES.indexOf(this.draft.difficulty);
      const next = DIFFICULTIES[(i + dir + DIFFICULTIES.length) % DIFFICULTIES.length];
      this.draft.difficulty = next;
      this.draft.difficultyTier = DIFFICULTY_TIERS[next];
      globalScene.ui.playSelect();
      this.rebuild();
      return;
    }
    if (row.kind === "rule") {
      const rule = this.rules[row.ruleIndex ?? 0];
      const changed = dir > 0 ? rule?.increaseValue() : rule?.decreaseValue();
      if (changed) {
        globalScene.ui.playSelect();
        this.rebuild();
      }
    }
  }

  private activateRow(row: FieldRow): void {
    switch (row.kind) {
      case "name":
        this.openTextEntry("name");
        break;
      case "subtitle":
        this.openTextEntry("subtitle");
        break;
      case "description":
        this.openTextEntry("description");
        break;
      case "species":
        this.view = "species";
        this.speciesCursor = 0;
        this.rebuild();
        break;
      case "publish":
        this.confirmPublish();
        break;
      default:
        break;
    }
  }

  /** Open the configurable text-input modal for a raw-string field (PATTERN 1: revert on callback). */
  private openTextEntry(field: "name" | "subtitle" | "description"): void {
    // A modal does NOT bringToTop and CREATE paints an opaque backdrop, so hide CREATE
    // while the input is up (restore on either button).
    this.container.setVisible(false);
    const titles: Record<typeof field, string> = {
      name: "Challenge Name",
      subtitle: "Subtitle",
      description: "Description",
    };
    globalScene.ui.setOverlayMode(
      UiMode.COMMUNITY_CHALLENGE_TEXT,
      {
        buttonActions: [
          (value: string) =>
            globalScene.ui.revertMode().then(() => {
              this.container.setVisible(true);
              this.draft[field] = value;
              this.errorMsg = null;
              this.rebuild();
            }),
          () => globalScene.ui.revertMode().then(() => this.container.setVisible(true)),
        ],
      },
      { title: titles[field], fieldLabel: titles[field], initial: this.draft[field] },
    );
  }

  // ---- Species sub-view input --------------------------------------------

  private processSpeciesInput(button: Button): boolean {
    const last = this.roots.length - 1;
    switch (button) {
      case Button.CANCEL:
        globalScene.ui.playSelect();
        this.draft.allowedSpecies = this.selected.size > 0 ? [...this.selected] : null;
        this.view = "form";
        this.rebuild();
        return true;
      case Button.LEFT:
        this.speciesCursor = Math.max(0, this.speciesCursor - 1);
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.RIGHT:
        this.speciesCursor = Math.min(last, this.speciesCursor + 1);
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.UP:
        this.speciesCursor = Math.max(0, this.speciesCursor - GRID_COLS);
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.DOWN:
        this.speciesCursor = Math.min(last, this.speciesCursor + GRID_COLS);
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.ACTION:
      case Button.SUBMIT:
        this.toggleFocusedSpecies();
        return true;
      default:
        return false;
    }
  }

  private toggleFocusedSpecies(): void {
    const id = this.roots[this.speciesCursor];
    if (id === undefined) {
      return;
    }
    if (this.selected.has(id)) {
      this.selected.delete(id);
    } else if (this.selected.size < MAX_ALLOWED_SPECIES) {
      this.selected.add(id);
    }
    globalScene.ui.playSelect();
    this.rebuild();
  }

  // ---- Publish ------------------------------------------------------------

  private isDirty(): boolean {
    return (
      this.draft.name.length > 0
      || this.draft.subtitle.length > 0
      || this.draft.description.length > 0
      || this.draft.difficulty !== "ace"
      || this.draft.allowedSpecies !== null
      || this.rules.some(r => r.value !== 0)
    );
  }

  /** CANCEL: confirm discard when there are unsaved edits, else revert straight to the browser. */
  private requestExit(): void {
    if (!this.isDirty()) {
      void globalScene.ui.revertMode();
      return;
    }
    globalScene.ui.setOverlayMode(
      UiMode.CONFIRM,
      () => globalScene.ui.revertMode().then(() => void globalScene.ui.revertMode()),
      () => globalScene.ui.revertMode(),
    );
  }

  private confirmPublish(): void {
    globalScene.ui.setOverlayMode(
      UiMode.CONFIRM,
      () => globalScene.ui.revertMode().then(() => void this.publish()),
      () => globalScene.ui.revertMode(),
    );
  }

  private buildConfig(): CommunityChallengeConfig {
    const baseChallenges: ReadonlyArray<readonly [Challenges, number, number?]> = this.rules
      .filter(c => c.value !== 0)
      .map(c => (c.severity ? ([c.id, c.value, c.severity] as const) : ([c.id, c.value] as const)));
    return {
      schemaVersion: COMMUNITY_CHALLENGE_SCHEMA_VERSION,
      // Server-owned fields (the worker overwrites id / author / authorId / createdAt).
      id: "",
      author: "",
      name: this.draft.name,
      subtitle: this.draft.subtitle,
      description: this.draft.description,
      gameModeId: this.draft.gameModeId,
      difficulty: this.draft.difficulty,
      difficultyTier: this.draft.difficultyTier,
      baseChallenges,
      allowedSpecies: this.draft.allowedSpecies,
      restrictions: {},
      targetWave: this.draft.targetWave,
      tags: this.draft.tags,
    };
  }

  private async publish(): Promise<void> {
    const config = this.buildConfig();
    const v = validateChallengeConfig(config);
    if (!v.ok) {
      // Surface up to two errors at once so the author can fix several in one pass.
      const shown = v.errors.slice(0, 2).join("  ");
      const more = v.errors.length > 2 ? ` (+${v.errors.length - 2} more)` : "";
      this.errorMsg = (shown || "Invalid challenge.") + more;
      this.rebuild();
      return;
    }
    this.errorMsg = null;
    const id = await createCommunityChallenge(config);
    // CREATE has an opaque backdrop and is the topmost z handler, so showText on the
    // (lower-z) message handler would render behind it. setMode(MESSAGE) clears CREATE
    // and makes the message visible; the callback reverts to the browser underneath.
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      id ? "Submitted as a draft. Clear it to publish." : "Could not publish - check your connection or sign-in.",
      null,
      () => void globalScene.ui.revertMode(),
      null,
      true,
    );
  }
}
