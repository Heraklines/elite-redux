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
// POKEMON / PUBLISH):
//   - NAME / SUBTITLE / DESCRIPTION  -> the configurable text-input modal
//     (UiMode.COMMUNITY_CHALLENGE_TEXT) with a per-field title (PATTERN 1 overlay,
//     revert on callback).
//   - DIFFICULTY                     -> LEFT/RIGHT cycles youngster|ace|elite|hell.
//   - RULES                          -> inline `copyChallenge` rows (NOT the real
//     gameMode.challenges); LEFT/RIGHT adjusts each row's value. Serialized to
//     baseChallenges on publish.
//   - ALLOWED POKEMON                -> ACTION opens the REAL starter-select in
//     "roster pick" mode (all its filters/search) to toggle the allowed set; the
//     chosen root ids return via onRosterConfirm (null = all species).
//   - PUBLISH                        -> CONFIRM -> validateChallengeConfig ->
//     createCommunityChallenge (a server DRAFT) -> success/failure text.
//
// Opened over the browser via PATTERN 1 (setOverlayMode keeps the browser alive
// underneath); CANCEL reverts straight back to it. Drive it headlessly via the
// render-harness recipes `community-challenge-create[-rules]`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allChallenges, type Challenge, copyChallenge } from "#data/challenge";
import {
  COMMUNITY_CHALLENGE_SCHEMA_VERSION,
  type CommunityChallengeConfig,
  createCommunityChallenge,
  saveLocalDraft,
  validateChallengeConfig,
} from "#data/elite-redux/er-community-challenges";
import { setFounderRunState } from "#data/elite-redux/er-community-run-state";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { Button } from "#enums/buttons";
import type { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";

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

export class CommunityChallengeCreateUiHandler extends UiHandler {
  private container!: Phaser.GameObjects.Container;
  private dynamic!: Phaser.GameObjects.Container;

  private draft: CreateDraft = defaultDraft();
  /** Standalone copies of every offered challenge (NOT gameMode.challenges). */
  private rules: Challenge[] = [];
  private rowCursor = 0;
  private scrollTop = 0;
  private errorMsg: string | null = null;
  // The opener's config-based launch callback (browser -> TitlePhase). After publishing
  // a draft, the founder is dropped straight into their qualifying run via this.
  private onLaunch: ((config: CommunityChallengeConfig) => void) | null = null;

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
    this.rowCursor = 0;
    this.scrollTop = 0;
    this.errorMsg = null;
    this.onLaunch = typeof args[1] === "function" ? (args[1] as (config: CommunityChallengeConfig) => void) : null;
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
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.dynamic.removeAll(true);
    this.rules = [];
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
    this.buildForm();
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

  // ---- Input --------------------------------------------------------------

  processInput(button: Button): boolean {
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
        this.openSpeciesPicker();
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
    // The modal raises itself above this screen (see ErChallengeTextInputUiHandler.show),
    // so CREATE stays visible underneath - the input appears OVER the FORGE screen.
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
              this.draft[field] = value;
              this.errorMsg = null;
              this.rebuild();
            }),
          () => globalScene.ui.revertMode(),
        ],
      },
      { title: titles[field], fieldLabel: titles[field], initial: this.draft[field] },
    );
  }

  /**
   * Open the REAL starter-select as a roster picker (all its type/gen/cost/caught/name
   * filters) to choose the allowed species. PATTERN 1 overlay so the CREATE draft stays
   * alive underneath; hide CREATE's opaque backdrop while the full-screen picker is up.
   * An empty selection = no whitelist (all eligible).
   */
  private openSpeciesPicker(): void {
    // starter-select raises itself to the top in roster mode (it is a low-z handler),
    // so CREATE can stay where it is - revertMode lands back on it.
    globalScene.ui.setOverlayMode(UiMode.STARTER_SELECT, () => {}, {
      rosterPickMode: true,
      initialSelected: this.draft.allowedSpecies ?? [],
      onRosterConfirm: (ids: number[]) => {
        globalScene.ui.revertMode().then(() => {
          this.draft.allowedSpecies = ids.length > 0 ? ids : null;
          this.errorMsg = null;
          this.rebuild();
        });
      },
    });
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
    const serverId = await createCommunityChallenge(config);
    if (this.onLaunch) {
      // Local-first persistence: ALWAYS remember the draft locally (so a loss can't lose
      // it + it lists in MY CHALLENGES), with the server id when we got one, else a local
      // id - the draft stays playable + finalizable from MY even before the worker route
      // ships. Saved as a draft (invisible to others until cleared). The FOUNDER must now
      // win it: tag this as the qualifying run (persisted on the session save so a mid-run
      // save/reload still auto-publishes), then drop straight into starter-select. A
      // genuine victory flips the draft live (game-over-phase tryPublishFounderClear).
      const draftId = serverId ?? `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const draftConfig = { ...config, id: draftId };
      saveLocalDraft(draftConfig);
      setFounderRunState({ draftId, config: draftConfig });
      const launch = this.onLaunch;
      // TEAR DOWN BOTH community overlays BEFORE the confirmation, not after. CREATE was
      // opened OVER the browser, so both containers are visible and the browser is high-z.
      // If we show the "Draft saved!" text with the browser still up, it renders BEHIND
      // the featured page - invisible - so the player never sees a prompt to dismiss, the
      // dismiss callback (which launches the run) never fires, and they sit on the featured
      // page reading it as a softlock. (Both prior fixes failed for exactly this reason: the
      // launch lived inside an unreachable callback.) setMode(MESSAGE) clears CREATE; the
      // direct clear() hides the browser; resetModeChain drops the stack. Now the message
      // shows on a clean screen and the launch is a plain card-play-style handoff.
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.handlers[UiMode.COMMUNITY_CHALLENGES]?.clear();
      globalScene.ui.resetModeChain();
      console.log("[community-launch] publish teardown done; awaiting confirm", {
        mode: UiMode[globalScene.ui.getMode()],
        chain: globalScene.ui.getModeChain().map(m => UiMode[m]),
      });
      globalScene.ui.showText(
        "Draft saved! Now clear it yourself to publish it.",
        null,
        () => {
          console.log("[community-launch] confirm dismissed; launching run");
          launch(draftConfig);
        },
        null,
        true,
      );
      return;
    }
    // Failure (offline / guest / server reject): show it INLINE on the Create screen the
    // player is still on. A MESSAGE prompt here would render behind the browser (same
    // invisible-prompt trap as the success path), so keep them on CREATE and surface the
    // error in the footer where they can read it and retry.
    this.errorMsg = "Could not save - check your connection or sign-in.";
    this.rebuild();
  }
}
