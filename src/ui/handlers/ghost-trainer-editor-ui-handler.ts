/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Ghost Trainer Editor (UiMode.GHOST_TRAINER_EDITOR).
//
// The player authors how THEIR published ghost looks to OTHERS: the cosmetic
// trainer sprite/class, a display name + title, and three battle dialogue lines
// (intro / defeat-player / defeated). The party itself still comes from the
// player's real run (presentation-only model, see er-ghost-profile.ts), so this
// screen only edits the cosmetic blob that rides along with each published ghost.
//
// Modeled on the Community Challenge designer (community-challenge-create-ui-handler):
// a vertical field list driven by a rowCursor, LEFT/RIGHT cycles the adjustable
// rows (trainer sprite / female toggle), ACTION opens the configurable text-input
// modal (UiMode.COMMUNITY_CHALLENGE_TEXT, REUSED verbatim) for a text field, and a
// PUBLISH row writes the profile to the system save. A live preview pane on the
// right shows the chosen trainer sprite (best-effort - see ensurePreviewAtlas) and
// the intro line.
//
// Opened over the title via the deferred-open pattern (TitlePhase.openProfileHub);
// the onExit callback returns cleanly to a fresh title. Drive it headlessly via the
// render-harness recipe `ghost-trainer-editor`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  GHOST_DIALOGUE_MAX,
  GHOST_NAME_MAX,
  GHOST_TITLE_MAX,
  GHOST_TOKEN_LIST,
  type GhostDialogue,
  type GhostTrainerProfile,
  sanitizeGhostProfile,
} from "#data/elite-redux/er-ghost-profile";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";

const SCREEN_W = 320;
const SCREEN_H = 180;

// --- Theme palette (shared with the community-challenge screens) ---
const VOID = 0x080912;
const BAND = 0x10131f;
const PANEL = 0x0d1020;
const GOLD = "#ffd27a";
const GOLD_DIM = "#b9924a";
const INK = "#d8c9a8";
const DIM = "#8a8470";
const ACTIVE_RED = 0xd8542a;
const ACCENT = 0x5ad1ff;

// --- Field list geometry (left column) ---
const LIST_X = 6;
const LABEL_X = LIST_X + 4;
const VALUE_X = 184;
const LIST_Y = 28;
const ROW_H = 12;
const FOOT_Y = SCREEN_H - 22;
const HINT_Y = SCREEN_H - 9;

// --- Preview pane geometry (right column) ---
const PREVIEW_X = 192;
const PREVIEW_Y = 26;
const PREVIEW_W = 122;
const PREVIEW_H = 124;
const PREVIEW_CX = PREVIEW_X + PREVIEW_W / 2;
const PREVIEW_SPRITE_TOP = PREVIEW_Y + 22;
const PREVIEW_SPRITE_H = 64;

/** Curated cosmetic trainer classes (generic, single-sprite). Doubles-only / evil-team
 *  classes are excluded; the list is runtime-filtered against the live configs. */
const CANDIDATE_CLASSES: TrainerType[] = [
  TrainerType.ACE_TRAINER,
  TrainerType.AROMA_LADY,
  TrainerType.ARTIST,
  TrainerType.BACKPACKER,
  TrainerType.BAKER,
  TrainerType.BEAUTY,
  TrainerType.BIKER,
  TrainerType.BIRD_KEEPER,
  TrainerType.BLACK_BELT,
  TrainerType.BREEDER,
  TrainerType.BUG_CATCHER,
  TrainerType.CAMPER,
  TrainerType.CLERK,
  TrainerType.COLLECTOR,
  TrainerType.CYCLIST,
  TrainerType.DANCER,
  TrainerType.DEPOT_AGENT,
  TrainerType.DOCTOR,
  TrainerType.DRAGON_TAMER,
  TrainerType.FAIRY_TALE_GIRL,
  TrainerType.FIREBREATHER,
  TrainerType.FISHERMAN,
  TrainerType.GUITARIST,
  TrainerType.HARLEQUIN,
  TrainerType.HEX_MANIAC,
  TrainerType.HIKER,
  TrainerType.JANITOR,
  TrainerType.MAID,
  TrainerType.MUSICIAN,
  TrainerType.NURSERY_AIDE,
  TrainerType.OFFICER,
  TrainerType.PARASOL_LADY,
  TrainerType.PILOT,
  TrainerType.POKEFAN,
  TrainerType.PRESCHOOLER,
  TrainerType.PSYCHIC,
  TrainerType.RANGER,
  TrainerType.RICH,
  TrainerType.RICH_KID,
  TrainerType.ROUGHNECK,
  TrainerType.RUIN_MANIAC,
  TrainerType.SAILOR,
  TrainerType.SCIENTIST,
  TrainerType.SCHOOL_KID,
  TrainerType.SWIMMER,
  TrainerType.VETERAN,
  TrainerType.WAITER,
  TrainerType.WORKER,
  TrainerType.YOUNGSTER,
];

type TextField = "displayName" | "title" | "intro" | "defeatPlayer" | "defeated";
type RowKind = "sprite" | "female" | TextField | "publish";

interface FieldRow {
  readonly kind: RowKind;
}

/** The mutable working draft (GhostTrainerProfile fields are all optional; this is the editor's scratch). */
interface EditorDraft {
  spriteIndex: number;
  female: boolean;
  displayName: string;
  title: string;
  intro: string;
  defeatPlayer: string;
  defeated: string;
}

/** A blank draft (the chosen sprite defaults to the canonical ghost class, Veteran). */
function defaultDraft(spriteTypes: TrainerType[]): EditorDraft {
  const veteran = spriteTypes.indexOf(TrainerType.VETERAN);
  return {
    spriteIndex: veteran >= 0 ? veteran : 0,
    female: false,
    displayName: "",
    title: "",
    intro: "",
    defeatPlayer: "",
    defeated: "",
  };
}

/** Humanize a trainer enum name ("ACE_TRAINER" -> "Ace Trainer") for the value/preview label. */
function className(type: TrainerType): string {
  return TrainerType[type]
    .toLowerCase()
    .split("_")
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export class GhostTrainerEditorUiHandler extends UiHandler {
  private container!: Phaser.GameObjects.Container;
  private dynamic!: Phaser.GameObjects.Container;

  /** The runtime-filtered cosmetic trainer classes (built in setup). */
  private spriteTypes: TrainerType[] = [];
  private draft: EditorDraft = {
    spriteIndex: 0,
    female: false,
    displayName: "",
    title: "",
    intro: "",
    defeatPlayer: "",
    defeated: "",
  };
  private rowCursor = 0;
  /** Trainer atlases we have already queued a load for (avoids re-queuing / mock re-entrancy). */
  private readonly requestedAtlases = new Set<string>();
  /** Re-entrancy guard: the headless mock loader fires COMPLETE synchronously. */
  private rebuilding = false;
  /** Caller's clean-return-to-title callback (TitlePhase.openProfileHub). */
  private onExit: (() => void) | null = null;

  constructor() {
    super(UiMode.GHOST_TRAINER_EDITOR);
  }

  setup(): void {
    const ui = this.getUi();
    const h = globalScene.scaledCanvas.height;
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    this.spriteTypes = CANDIDATE_CLASSES.filter(t => {
      const cfg = trainerConfigs[t];
      return !!cfg && !cfg.doubleOnly;
    });
    if (this.spriteTypes.length === 0) {
      this.spriteTypes = [TrainerType.VETERAN];
    }

    // Opaque void backdrop + header band.
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, VOID, 1).setOrigin(0));
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, 21, BAND, 1).setOrigin(0));

    const eyebrow = addTextObject(LIST_X, 3, "PROFILE", TextStyle.WINDOW, { fontSize: "30px" });
    eyebrow.setOrigin(0, 0).setColor(GOLD_DIM);
    this.container.add(eyebrow);
    const title = addTextObject(LIST_X, 9, "GHOST TRAINER EDITOR", TextStyle.WINDOW, { fontSize: "48px" });
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
    this.onExit = typeof args[0] === "function" ? (args[0] as () => void) : null;
    this.draft = defaultDraft(this.spriteTypes);
    this.rowCursor = 0;
    this.requestedAtlases.clear();
    // Load the player's current published profile (sanitized) into the draft, else start empty.
    this.seedFromProfile(sanitizeGhostProfile(globalScene.gameData.ghostProfile));
    this.rebuild();
    this.container.setVisible(true);
    // Opened OVER the Profile hub (another full-screen handler) - raise above it.
    this.getUi().bringToTop(this.container);
    return true;
  }

  /** Load an existing (sanitized) profile into the working draft. */
  private seedFromProfile(profile: GhostTrainerProfile | null): void {
    if (!profile) {
      return;
    }
    if (profile.trainerType != null) {
      const idx = this.spriteTypes.indexOf(profile.trainerType);
      if (idx >= 0) {
        this.draft.spriteIndex = idx;
      }
    }
    const hasGenders = this.currentHasGenders();
    this.draft.female = hasGenders && profile.female === true;
    this.draft.displayName = profile.displayName ?? "";
    this.draft.title = profile.title ?? "";
    this.draft.intro = profile.dialogue?.intro ?? "";
    this.draft.defeatPlayer = profile.dialogue?.defeatPlayer ?? "";
    this.draft.defeated = profile.dialogue?.defeated ?? "";
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.dynamic.removeAll(true);
  }

  // ---- Field model --------------------------------------------------------

  private currentType(): TrainerType {
    return this.spriteTypes[this.draft.spriteIndex] ?? TrainerType.VETERAN;
  }

  private currentHasGenders(): boolean {
    return !!trainerConfigs[this.currentType()]?.hasGenders;
  }

  private buildRows(): FieldRow[] {
    const rows: FieldRow[] = [{ kind: "displayName" }, { kind: "title" }, { kind: "sprite" }];
    if (this.currentHasGenders()) {
      rows.push({ kind: "female" });
    }
    rows.push({ kind: "intro" }, { kind: "defeatPlayer" }, { kind: "defeated" }, { kind: "publish" });
    return rows;
  }

  // ---- Rendering ----------------------------------------------------------

  private rebuild(): void {
    // Queue the preview atlas BEFORE the (re-entrant-safe) form build. The headless mock
    // loader fires COMPLETE synchronously, so this may recurse once - the requestedAtlases
    // set + the rebuilding guard keep that bounded to a single extra build.
    this.ensurePreviewAtlas();
    if (this.rowCursor >= this.buildRows().length) {
      this.rowCursor = this.buildRows().length - 1;
    }
    this.rebuilding = true;
    this.dynamic.removeAll(true);
    this.buildForm();
    this.rebuilding = false;
  }

  private buildForm(): void {
    const rows = this.buildRows();
    for (let i = 0; i < rows.length; i++) {
      this.buildRow(rows[i], LIST_Y + i * ROW_H, i === this.rowCursor);
    }

    this.buildPreview();

    // Footer: the focused row's help / token reference.
    const ft = addTextObject(LABEL_X, FOOT_Y, this.rowHelp(rows[this.rowCursor]), TextStyle.WINDOW, {
      fontSize: "26px",
      wordWrap: { width: (SCREEN_W - 12) * 6 },
    });
    ft.setOrigin(0, 0).setColor(DIM);
    this.dynamic.add(ft);
  }

  private buildRow(row: FieldRow, y: number, focused: boolean): void {
    if (focused) {
      const hl = globalScene.add.rectangle(LIST_X, y - 1, VALUE_X - LIST_X + 4, ROW_H, ACTIVE_RED, 0.18).setOrigin(0);
      hl.setStrokeStyle(1, ACTIVE_RED, 0.85);
      this.dynamic.add(hl);
    }

    if (row.kind === "publish") {
      const t = addTextObject((LIST_X + VALUE_X) / 2, y, "PUBLISH PROFILE", TextStyle.WINDOW, {
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

    const adjustable = row.kind === "sprite" || row.kind === "female";
    const value = this.rowValue(row);
    const text = focused && adjustable ? `< ${value} >` : value;
    const v = addTextObject(VALUE_X, y, text, TextStyle.WINDOW, { fontSize: "28px", align: "right" });
    v.setOrigin(1, 0).setColor(this.rowValueColor(row));
    this.dynamic.add(v);
  }

  private rowLabel(row: FieldRow): string {
    switch (row.kind) {
      case "displayName":
        return "TRAINER NAME";
      case "title":
        return "TITLE";
      case "sprite":
        return "TRAINER SPRITE";
      case "female":
        return "FEMALE";
      case "intro":
        return "INTRO LINE";
      case "defeatPlayer":
        return "DEFEAT LINE";
      case "defeated":
        return "VICTORY LINE";
      default:
        return "";
    }
  }

  private rowValue(row: FieldRow): string {
    switch (row.kind) {
      case "displayName":
        return this.draft.displayName ? this.truncate(this.draft.displayName, 16) : "(username)";
      case "title":
        return this.draft.title ? this.truncate(this.draft.title, 16) : "(none)";
      case "sprite":
        return this.truncate(className(this.currentType()), 16);
      case "female":
        return this.draft.female ? "ON" : "OFF";
      case "intro":
        return this.draft.intro ? this.truncate(this.draft.intro, 16) : "(default)";
      case "defeatPlayer":
        return this.draft.defeatPlayer ? this.truncate(this.draft.defeatPlayer, 16) : "(default)";
      case "defeated":
        return this.draft.defeated ? this.truncate(this.draft.defeated, 16) : "(default)";
      default:
        return "";
    }
  }

  private rowValueColor(row: FieldRow): string {
    switch (row.kind) {
      case "displayName":
        return this.draft.displayName ? INK : DIM;
      case "title":
        return this.draft.title ? INK : DIM;
      case "sprite":
        return INK;
      case "female":
        return this.draft.female ? INK : DIM;
      case "intro":
        return this.draft.intro ? INK : DIM;
      case "defeatPlayer":
        return this.draft.defeatPlayer ? INK : DIM;
      case "defeated":
        return this.draft.defeated ? INK : DIM;
      default:
        return INK;
    }
  }

  private rowHelp(row: FieldRow): string {
    const tokens = GHOST_TOKEN_LIST.map(t => t.token).join(" ");
    switch (row.kind) {
      case "displayName":
        return `Press A to set the name shown to others (max ${GHOST_NAME_MAX}).`;
      case "title":
        return `Press A to set a title shown before your name (max ${GHOST_TITLE_MAX}).`;
      case "sprite":
        return "Left / Right cycles the cosmetic trainer sprite.";
      case "female":
        return "Left / Right toggles the female sprite for this class.";
      case "intro":
        return `Press A. Battle-start line. Tokens: ${tokens}`;
      case "defeatPlayer":
        return `Press A. Said when the ghost beats you. Tokens: ${tokens}`;
      case "defeated":
        return `Press A. Said when you beat the ghost. Tokens: ${tokens}`;
      case "publish":
        return "Press A to publish this profile to your save.";
      default:
        return "";
    }
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  // ---- Live preview -------------------------------------------------------

  private buildPreview(): void {
    const panel = globalScene.add.rectangle(PREVIEW_X, PREVIEW_Y, PREVIEW_W, PREVIEW_H, PANEL, 1).setOrigin(0);
    panel.setStrokeStyle(1, ACCENT, 0.5);
    this.dynamic.add(panel);

    // Header: title + name (or the cosmetic class name when no custom name is set).
    const name = this.draft.displayName.trim() || className(this.currentType());
    const titlePrefix = this.draft.title.trim();
    const headerText = titlePrefix ? `${titlePrefix} ${name}` : name;
    const header = addTextObject(PREVIEW_CX, PREVIEW_Y + 4, this.truncate(headerText, 22), TextStyle.WINDOW, {
      fontSize: "30px",
      align: "center",
    });
    header.setOrigin(0.5, 0).setColor(GOLD);
    this.dynamic.add(header);

    const classLine = addTextObject(
      PREVIEW_CX,
      PREVIEW_Y + 11,
      `${className(this.currentType())}${this.currentHasGenders() ? (this.draft.female ? " (F)" : " (M)") : ""}`,
      TextStyle.WINDOW,
      { fontSize: "26px", align: "center" },
    );
    classLine.setOrigin(0.5, 0).setColor(DIM);
    this.dynamic.add(classLine);

    // Best-effort trainer sprite. Always add the sprite (so the render harness records +
    // injects the atlas), but only show it once the texture is actually loaded - otherwise
    // it stays invisible (no missing-texture box) until ensurePreviewAtlas resolves.
    const spriteKey = this.previewSpriteKey();
    const loaded = globalScene.textures.exists(spriteKey);
    const sprite = globalScene.add.sprite(PREVIEW_CX, PREVIEW_SPRITE_TOP, spriteKey);
    sprite.setFrame(0);
    sprite.setOrigin(0.5, 0);
    const fh = sprite.height || PREVIEW_SPRITE_H;
    sprite.setScale(PREVIEW_SPRITE_H / fh);
    sprite.setVisible(loaded);
    this.dynamic.add(sprite);

    // The intro line, the headline a player sees when the ghost appears.
    const intro = this.draft.intro.trim();
    const introText = intro ? `"${intro}"` : "(default class greeting)";
    const introObj = addTextObject(
      PREVIEW_X + 4,
      PREVIEW_SPRITE_TOP + PREVIEW_SPRITE_H + 6,
      introText,
      TextStyle.WINDOW,
      {
        fontSize: "26px",
        align: "center",
        wordWrap: { width: (PREVIEW_W - 8) * 6 },
      },
    );
    introObj.setOrigin(0, 0).setColor(intro ? INK : DIM);
    this.dynamic.add(introObj);
  }

  private previewSpriteKey(): string {
    const cfg = trainerConfigs[this.currentType()];
    return cfg?.getSpriteKey(this.draft.female && this.currentHasGenders(), false) ?? "veteran_m";
  }

  /** Queue the current preview trainer atlas if it isn't loaded yet, and re-render on completion. */
  private ensurePreviewAtlas(): void {
    const key = this.previewSpriteKey();
    if (globalScene.textures.exists(key) || this.requestedAtlases.has(key)) {
      return;
    }
    this.requestedAtlases.add(key);
    globalScene.loadAtlas(key, "trainer");
    globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      // Re-render once the atlas arrives so the preview sprite appears (guarded against the
      // synchronous mock loader re-entering an in-progress rebuild).
      if (this.active && !this.rebuilding) {
        this.rebuild();
      }
    });
    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
  }

  // ---- Input --------------------------------------------------------------

  processInput(button: Button): boolean {
    const rows = this.buildRows();
    switch (button) {
      case Button.CANCEL:
        globalScene.ui.playSelect();
        this.requestExit();
        return true;
      case Button.UP:
        this.rowCursor = (this.rowCursor + rows.length - 1) % rows.length;
        globalScene.ui.playSelect();
        this.rebuild();
        return true;
      case Button.DOWN:
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
    if (row.kind === "sprite") {
      const n = this.spriteTypes.length;
      this.draft.spriteIndex = (this.draft.spriteIndex + dir + n) % n;
      // A class without gendered sprites can't be female; clear it so the row hides cleanly.
      if (!this.currentHasGenders()) {
        this.draft.female = false;
      }
      globalScene.ui.playSelect();
      this.rebuild();
      return;
    }
    if (row.kind === "female" && this.currentHasGenders()) {
      this.draft.female = !this.draft.female;
      globalScene.ui.playSelect();
      this.rebuild();
    }
  }

  private activateRow(row: FieldRow): void {
    switch (row.kind) {
      case "displayName":
        this.openTextEntry("displayName");
        break;
      case "title":
        this.openTextEntry("title");
        break;
      case "intro":
        this.openTextEntry("intro");
        break;
      case "defeatPlayer":
        this.openTextEntry("defeatPlayer");
        break;
      case "defeated":
        this.openTextEntry("defeated");
        break;
      case "female":
        if (this.currentHasGenders()) {
          this.draft.female = !this.draft.female;
          this.rebuild();
        }
        break;
      case "publish":
        this.confirmPublish();
        break;
      default:
        break;
    }
  }

  /** Per-field title + cap for the reused configurable text-input modal. */
  private fieldMeta(field: TextField): { title: string; cap: number } {
    switch (field) {
      case "displayName":
        return { title: "Trainer Name", cap: GHOST_NAME_MAX };
      case "title":
        return { title: "Title", cap: GHOST_TITLE_MAX };
      case "intro":
        return { title: "Intro Line", cap: GHOST_DIALOGUE_MAX };
      case "defeatPlayer":
        return { title: "Defeat Line", cap: GHOST_DIALOGUE_MAX };
      case "defeated":
        return { title: "Victory Line", cap: GHOST_DIALOGUE_MAX };
    }
  }

  /** Open the configurable text-input modal (REUSED from Community Challenge) for a text field. */
  private openTextEntry(field: TextField): void {
    const { title, cap } = this.fieldMeta(field);
    globalScene.ui.setOverlayMode(
      UiMode.COMMUNITY_CHALLENGE_TEXT,
      {
        buttonActions: [
          (value: string) =>
            globalScene.ui.revertMode().then(() => {
              this.draft[field] = value.slice(0, cap);
              this.rebuild();
            }),
          () => globalScene.ui.revertMode(),
        ],
      },
      { title, fieldLabel: title, initial: this.draft[field] },
    );
  }

  // ---- Publish / exit -----------------------------------------------------

  private isDirty(): boolean {
    return (
      this.draft.displayName.length > 0
      || this.draft.title.length > 0
      || this.draft.intro.length > 0
      || this.draft.defeatPlayer.length > 0
      || this.draft.defeated.length > 0
      || this.currentType() !== TrainerType.VETERAN
      || this.draft.female
    );
  }

  /** CANCEL: confirm discard when there are unsaved edits, else revert to the Profile hub. */
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

  /** Build the authored profile from the draft, normalised through the shared sanitizer. */
  private buildProfile(): GhostTrainerProfile | null {
    const dialogue: GhostDialogue = {};
    if (this.draft.intro.trim()) {
      dialogue.intro = this.draft.intro.trim();
    }
    if (this.draft.defeatPlayer.trim()) {
      dialogue.defeatPlayer = this.draft.defeatPlayer.trim();
    }
    if (this.draft.defeated.trim()) {
      dialogue.defeated = this.draft.defeated.trim();
    }
    const raw: GhostTrainerProfile = {
      trainerType: this.currentType(),
      female: this.draft.female && this.currentHasGenders(),
      displayName: this.draft.displayName.trim() || undefined,
      title: this.draft.title.trim() || undefined,
      dialogue: Object.keys(dialogue).length > 0 ? dialogue : undefined,
    };
    return sanitizeGhostProfile(raw);
  }

  private async publish(): Promise<void> {
    const profile = this.buildProfile();
    globalScene.gameData.ghostProfile = profile;
    // Tear the editor down BEFORE the confirmation so the message renders on a clean screen
    // (the editor paints an opaque backdrop; a MESSAGE under it would be invisible).
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    const saved = await globalScene.gameData.saveSystem();
    const message = saved
      ? "Ghost profile published. Other trainers will see it on your ghost."
      : "Profile saved locally. Cloud sync failed and will retry later.";
    globalScene.ui.showText(message, null, () => this.exitToTitle(), null, true);
  }

  private exitToTitle(): void {
    if (this.onExit) {
      this.onExit();
    } else {
      void globalScene.ui.revertMode();
    }
  }
}
