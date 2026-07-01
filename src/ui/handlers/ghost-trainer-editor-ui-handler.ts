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
import {
  buildTrainerEntranceTween,
  clampTrainerFxIntensity,
  clampTrainerFxSpeed,
  getTrainerFxIntensity,
  getTrainerFxSpeed,
  isTrainerAuraOwned,
  isTrainerEntranceOwned,
  setEquippedTrainerAura,
  setEquippedTrainerEntrance,
  setTrainerAuraOwned,
  setTrainerEntranceOwned,
  setTrainerFxIntensity,
  setTrainerFxSpeed,
  TRAINER_AURA_EFFECTS,
  TRAINER_ENTRANCE_EFFECTS,
  TRAINER_FX_DEFAULT_TUNING,
  TRAINER_FX_TUNING_STEP,
} from "#data/elite-redux/er-trainer-fx";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { ErTrainerAuraFx } from "#sprites/er-trainer-aura-fx";
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
/** Text colour for an equipped / spendable-AP value (the cyan accent as a hex string). */
const ACCENT_TXT = "#7fd6ff";

// --- Field list geometry (left column) ---
const LIST_X = 6;
const LABEL_X = LIST_X + 4;
const VALUE_X = 184;
const LIST_Y = 26;
const ROW_H = 11;
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
  TrainerType.PRIVATE_EYE,
];

type TextField = "displayName" | "title" | "intro" | "defeatPlayer" | "defeated";
/** The two Ghost Trainer FX effect rows (entrance arrival effect + aura overlay). */
type FxKind = "entrance" | "aura";
/** The two Ghost Trainer FX tuning rows (playback speed + intensity multipliers). */
type FxTuningKind = "fxSpeed" | "fxIntensity";
type RowKind = "sprite" | "female" | TextField | FxKind | FxTuningKind | "publish";

interface FieldRow {
  readonly kind: RowKind;
}

/**
 * The mutable working draft (GhostTrainerProfile fields are all optional; this is the editor's
 * scratch). The Ghost Trainer FX picks use the save's 0-based encoding: `equipped*` is 0 for
 * "none" else the catalog registry index + 1; `*Browse` is the LEFT/RIGHT cursor over the
 * effect list (0 = the leading "None" entry, k = effect index k - 1).
 */
interface EditorDraft {
  spriteIndex: number;
  female: boolean;
  displayName: string;
  title: string;
  intro: string;
  defeatPlayer: string;
  defeated: string;
  entranceBrowse: number;
  equippedEntrance: number;
  auraBrowse: number;
  equippedAura: number;
  /** FX playback speed multiplier (0.25-3, default 1). Applies to entrance + aura. */
  fxSpeed: number;
  /** FX intensity multiplier (0.5-2, default 1). Applies to entrance + aura. */
  fxIntensity: number;
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
    entranceBrowse: 0,
    equippedEntrance: 0,
    auraBrowse: 0,
    equippedAura: 0,
    fxSpeed: TRAINER_FX_DEFAULT_TUNING,
    fxIntensity: TRAINER_FX_DEFAULT_TUNING,
  };
}

/** Clamp a stored equipped-FX index (0 = none, else registry index + 1) to its valid range. */
function clampEquipIndex(value: number | undefined, count: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= count ? value : 0;
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
    entranceBrowse: 0,
    equippedEntrance: 0,
    auraBrowse: 0,
    equippedAura: 0,
    fxSpeed: TRAINER_FX_DEFAULT_TUNING,
    fxIntensity: TRAINER_FX_DEFAULT_TUNING,
  };
  private rowCursor = 0;
  /** Trainer atlases we have already queued a load for (avoids re-queuing / mock re-entrancy). */
  private readonly requestedAtlases = new Set<string>();
  /** Re-entrancy guard: the headless mock loader fires COMPLETE synchronously. */
  private rebuilding = false;
  // ---- Live FX preview state (rebuilt with the dynamic container; torn down each rebuild) ----
  /** The current preview trainer sprite (the entrance tween + aura overlay target). */
  private previewSprite: Phaser.GameObjects.Sprite | null = null;
  /** The equipped aura overlay held around the preview sprite (null = no aura / failed load). */
  private previewAura: ErTrainerAuraFx | null = null;
  /** The ~3s loop that re-plays the equipped entrance tween in the preview. */
  private previewEntranceTimer: Phaser.Time.TimerEvent | null = null;
  /** Monotonic counter to keep each preview aura overlay's render-texture key unique. */
  private previewFxVersion = 0;
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
    // Seed the equipped Ghost Trainer FX from the system save (the canonical owned/equipped store).
    this.seedFxFromSave();
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

  /**
   * Seed the equipped entrance + aura from `gameData.trainerFx`. That store is already
   * sanitized on load (an equipped index only ever points at an OWNED effect), so the
   * values are trustworthy; the browse cursor starts on the equipped effect.
   */
  private seedFxFromSave(): void {
    const fx = globalScene.gameData.trainerFx;
    this.draft.equippedEntrance = clampEquipIndex(fx.le, TRAINER_ENTRANCE_EFFECTS.length);
    this.draft.entranceBrowse = this.draft.equippedEntrance;
    this.draft.equippedAura = clampEquipIndex(fx.la, TRAINER_AURA_EFFECTS.length);
    this.draft.auraBrowse = this.draft.equippedAura;
    this.draft.fxSpeed = clampTrainerFxSpeed(getTrainerFxSpeed(fx));
    this.draft.fxIntensity = clampTrainerFxIntensity(getTrainerFxIntensity(fx));
  }

  clear(): void {
    super.clear();
    this.teardownPreviewFx();
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
    rows.push(
      { kind: "intro" },
      { kind: "defeatPlayer" },
      { kind: "defeated" },
      { kind: "entrance" },
      { kind: "aura" },
      { kind: "fxSpeed" },
      { kind: "fxIntensity" },
      { kind: "publish" },
    );
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
    // The aura overlay + entrance-replay timer live OUTSIDE the dynamic container (their
    // Phaser.Time events aren't child game objects), so tear them down explicitly before
    // removeAll churns the preview sprite they target - otherwise they leak across rebuilds.
    this.teardownPreviewFx();
    this.dynamic.removeAll(true);
    this.buildForm();
    this.rebuilding = false;
  }

  private buildForm(): void {
    // Spendable AP balance (top-right of the header band). Lives in the dynamic container so it
    // refreshes after a purchase. This is the game's first achievement-point sink.
    const ap = addTextObject(SCREEN_W - 6, 3, `AP ${globalScene.gameData.getSpendableAchvPoints()}`, TextStyle.WINDOW, {
      fontSize: "30px",
      align: "right",
    });
    ap.setOrigin(1, 0).setColor(ACCENT_TXT);
    this.dynamic.add(ap);

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

    const adjustable =
      row.kind === "sprite"
      || row.kind === "female"
      || row.kind === "entrance"
      || row.kind === "aura"
      || row.kind === "fxSpeed"
      || row.kind === "fxIntensity";
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
      case "entrance":
        return "ENTRANCE EFFECT";
      case "aura":
        return "AURA EFFECT";
      case "fxSpeed":
        return "FX SPEED";
      case "fxIntensity":
        return "FX INTENSITY";
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
      case "entrance":
      case "aura":
        return this.fxRowValue(row.kind);
      case "fxSpeed":
        return this.fxTuningRowValue("fxSpeed");
      case "fxIntensity":
        return this.fxTuningRowValue("fxIntensity");
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
      case "entrance":
      case "aura":
        return this.fxRowValueColor(row.kind);
      case "fxSpeed":
        return this.draft.fxSpeed === TRAINER_FX_DEFAULT_TUNING ? DIM : INK;
      case "fxIntensity":
        return this.draft.fxIntensity === TRAINER_FX_DEFAULT_TUNING ? DIM : INK;
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
      case "entrance":
      case "aura":
        return this.fxRowHelp(row.kind);
      case "fxSpeed":
        return "Left / Right sets how fast the entrance + aura play. Press A to reset to 100%.";
      case "fxIntensity":
        return "Left / Right sets how strong the entrance + aura look. Press A to reset to 100%.";
      case "publish":
        return "Press A to publish this profile to your save.";
      default:
        return "";
    }
  }

  // ---- Ghost Trainer FX rows ----------------------------------------------

  /** The LEFT/RIGHT browse cursor for an FX row (0 = the "None" entry, k = effect k - 1). */
  private fxBrowse(kind: FxKind): number {
    return kind === "entrance" ? this.draft.entranceBrowse : this.draft.auraBrowse;
  }

  /** The equipped index for an FX row (0 = none, else registry index + 1). */
  private fxEquipped(kind: FxKind): number {
    return kind === "entrance" ? this.draft.equippedEntrance : this.draft.equippedAura;
  }

  /** True if the player owns the catalog effect at 0-based `effectIndex` in `kind`'s list. */
  private fxOwned(kind: FxKind, effectIndex: number): boolean {
    const fx = globalScene.gameData.trainerFx;
    if (kind === "entrance") {
      const id = TRAINER_ENTRANCE_EFFECTS[effectIndex]?.id;
      return id != null && isTrainerEntranceOwned(fx, id);
    }
    const id = TRAINER_AURA_EFFECTS[effectIndex]?.id;
    return id != null && isTrainerAuraOwned(fx, id);
  }

  /** The value text for an FX row: "None", the owned effect name, or "Name  COST AP" when locked. */
  private fxRowValue(kind: FxKind): string {
    const browse = this.fxBrowse(kind);
    if (browse <= 0) {
      return "None";
    }
    const list = kind === "entrance" ? TRAINER_ENTRANCE_EFFECTS : TRAINER_AURA_EFFECTS;
    const eff = list[browse - 1];
    if (!eff) {
      return "None";
    }
    if (this.fxOwned(kind, browse - 1)) {
      return this.truncate(eff.label, 18);
    }
    return `${this.truncate(eff.label, 11)}  ${eff.cost} AP`;
  }

  /** Equipped -> accent, owned -> ink, locked -> dim, none -> ink only when nothing is equipped. */
  private fxRowValueColor(kind: FxKind): string {
    const browse = this.fxBrowse(kind);
    const equipped = this.fxEquipped(kind);
    if (browse <= 0) {
      return equipped === 0 ? INK : DIM;
    }
    if (equipped === browse) {
      return ACCENT_TXT;
    }
    return this.fxOwned(kind, browse - 1) ? INK : DIM;
  }

  /** Context-sensitive footer help for an FX row (state + the live AP balance). */
  private fxRowHelp(kind: FxKind): string {
    const bal = globalScene.gameData.getSpendableAchvPoints();
    const noun = kind === "entrance" ? "entrance" : "aura";
    const browse = this.fxBrowse(kind);
    if (browse <= 0) {
      return `No ${noun} effect. Left / Right browses unlockable effects.  You have ${bal} AP.`;
    }
    const list = kind === "entrance" ? TRAINER_ENTRANCE_EFFECTS : TRAINER_AURA_EFFECTS;
    const eff = list[browse - 1];
    if (!eff) {
      return `Left / Right browses ${noun} effects.  You have ${bal} AP.`;
    }
    if (!this.fxOwned(kind, browse - 1)) {
      return `Locked. Press A to unlock for ${eff.cost} AP.  You have ${bal} AP.`;
    }
    if (this.fxEquipped(kind) === browse) {
      return `Equipped. Press A to remove it.  You have ${bal} AP.`;
    }
    return `Press A to equip this ${noun} (free).  You have ${bal} AP.`;
  }

  /** An FX tuning multiplier shown as a percentage (1.0 -> "100%"). */
  private fxTuningRowValue(kind: FxTuningKind): string {
    const value = kind === "fxSpeed" ? this.draft.fxSpeed : this.draft.fxIntensity;
    return `${Math.round(value * 100)}%`;
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
    this.previewSprite = sprite;
    // Looping demo: hold the BROWSED aura around the sprite and re-play the BROWSED entrance every
    // ~3s (so a locked effect previews before purchase). Only when the texture actually loaded
    // (fail-closed: a missing sprite shows the static panel).
    if (loaded) {
      this.attachPreviewFx(sprite);
    }

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

  /**
   * Attach the currently-BROWSED FX to the just-built preview sprite: the aura overlay (held
   * via the Shiny Lab pixel pipeline) and a ~3s entrance-replay loop. Driven by the highlighted
   * browse cursor (NOT ownership / equipped state), so a player can preview a LOCKED effect
   * before buying it. Both reflect the live speed + intensity tuning, are no-ops when the browse
   * cursor is on "None", and fail closed (the bare sprite stays visible on any error).
   */
  private attachPreviewFx(sprite: Phaser.GameObjects.Sprite): void {
    const tuning = { speed: this.draft.fxSpeed, intensity: this.draft.fxIntensity };
    if (this.draft.auraBrowse > 0) {
      const aura = TRAINER_AURA_EFFECTS[this.draft.auraBrowse - 1];
      if (aura) {
        try {
          this.previewAura = new ErTrainerAuraFx(
            this.dynamic,
            [sprite],
            aura.id,
            `er-ghost-editor-aura-${++this.previewFxVersion}`,
            tuning,
          );
          this.previewAura.start();
        } catch {
          this.previewAura = null;
        }
      }
    }
    if (this.draft.entranceBrowse > 0) {
      this.playPreviewEntrance();
      this.previewEntranceTimer = globalScene.time.addEvent({
        delay: 3000,
        loop: true,
        callback: () => this.playPreviewEntrance(),
      });
    }
  }

  /**
   * Re-play the currently-BROWSED entrance tween on the preview sprite with the live tuning
   * (no-op if the browse cursor is on "None" / the sprite was torn down). Browsing a locked
   * entrance still previews it.
   */
  private playPreviewEntrance(): void {
    const sprite = this.previewSprite;
    if (!sprite || this.draft.entranceBrowse <= 0) {
      return;
    }
    const eff = TRAINER_ENTRANCE_EFFECTS[this.draft.entranceBrowse - 1];
    if (!eff) {
      return;
    }
    const arrival = { x: PREVIEW_CX, y: PREVIEW_SPRITE_TOP, alpha: 1 };
    globalScene.tweens.add(
      buildTrainerEntranceTween(sprite, eff.approach, arrival, {
        speed: this.draft.fxSpeed,
        intensity: this.draft.fxIntensity,
      }),
    );
  }

  /** Tear down the preview aura overlay + entrance timer (idempotent; called each rebuild + on clear). */
  private teardownPreviewFx(): void {
    this.previewAura?.destroy();
    this.previewAura = null;
    this.previewEntranceTimer?.remove();
    this.previewEntranceTimer = null;
    this.previewSprite = null;
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
      return;
    }
    if (row.kind === "entrance" || row.kind === "aura") {
      const list = row.kind === "entrance" ? TRAINER_ENTRANCE_EFFECTS : TRAINER_AURA_EFFECTS;
      const span = list.length + 1; // +1 for the leading "None" entry.
      const next = (this.fxBrowse(row.kind) + dir + span) % span;
      if (row.kind === "entrance") {
        this.draft.entranceBrowse = next;
      } else {
        this.draft.auraBrowse = next;
      }
      globalScene.ui.playSelect();
      this.rebuild();
      return;
    }
    if (row.kind === "fxSpeed" || row.kind === "fxIntensity") {
      // Adjust in small steps, rounded to 2 decimals to avoid float drift, then clamped.
      const stepped = (current: number): number => Math.round((current + dir * TRAINER_FX_TUNING_STEP) * 100) / 100;
      if (row.kind === "fxSpeed") {
        this.draft.fxSpeed = clampTrainerFxSpeed(stepped(this.draft.fxSpeed));
      } else {
        this.draft.fxIntensity = clampTrainerFxIntensity(stepped(this.draft.fxIntensity));
      }
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
      case "entrance":
      case "aura":
        this.activateFx(row.kind);
        break;
      case "fxSpeed":
        this.draft.fxSpeed = TRAINER_FX_DEFAULT_TUNING;
        this.rebuild();
        break;
      case "fxIntensity":
        this.draft.fxIntensity = TRAINER_FX_DEFAULT_TUNING;
        this.rebuild();
        break;
      case "publish":
        this.confirmPublish();
        break;
      default:
        break;
    }
  }

  /** A on an FX row: equip/unequip an owned effect (free), or BUY a locked one with AP. */
  private activateFx(kind: FxKind): void {
    const browse = this.fxBrowse(kind);
    if (browse <= 0) {
      // The "None" entry: clear the equipped effect.
      this.setEquippedDraft(kind, 0);
      globalScene.ui.playSelect();
      this.rebuild();
      return;
    }
    const effectIndex = browse - 1;
    if (this.fxOwned(kind, effectIndex)) {
      // Owned: equip, or unequip if it is already the equipped pick (a free toggle).
      const next = this.fxEquipped(kind) === browse ? 0 : browse;
      this.setEquippedDraft(kind, next);
      globalScene.ui.playSelect();
      this.rebuild();
      return;
    }
    this.buyFx(kind, effectIndex);
  }

  private setEquippedDraft(kind: FxKind, value: number): void {
    if (kind === "entrance") {
      this.draft.equippedEntrance = value;
    } else {
      this.draft.equippedAura = value;
    }
  }

  /**
   * Spend AP to unlock the locked catalog effect at 0-based `effectIndex`. The owned bit is
   * set BEFORE `spendAchvPoints` (which persists the system save) so it is captured in the same
   * save; the affordability is checked first so the spend is guaranteed and the bit is never
   * granted for free. Mirrors the Shiny Lab buy flow (auto-equip + "se/buy").
   */
  private buyFx(kind: FxKind, effectIndex: number): void {
    const list = kind === "entrance" ? TRAINER_ENTRANCE_EFFECTS : TRAINER_AURA_EFFECTS;
    const eff = list[effectIndex];
    if (!eff) {
      return;
    }
    const fx = globalScene.gameData.trainerFx;
    if (globalScene.gameData.getSpendableAchvPoints() < eff.cost) {
      globalScene.ui.playError();
      return;
    }
    if (kind === "entrance") {
      setTrainerEntranceOwned(fx, eff.id);
    } else {
      setTrainerAuraOwned(fx, eff.id);
    }
    if (!globalScene.gameData.spendAchvPoints(eff.cost)) {
      globalScene.ui.playError();
      return;
    }
    // Auto-equip the freshly unlocked effect.
    this.setEquippedDraft(kind, effectIndex + 1);
    globalScene.playSound("se/buy");
    this.rebuild();
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
      || this.draft.equippedEntrance !== 0
      || this.draft.equippedAura !== 0
      || this.draft.fxSpeed !== TRAINER_FX_DEFAULT_TUNING
      || this.draft.fxIntensity !== TRAINER_FX_DEFAULT_TUNING
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
    // Ghost Trainer FX: fold the equipped entrance into `approach` and the equipped aura into
    // `aura` + `showAuraInBattle` so they serialize onto the published ghost and OTHER players
    // see them on encounter (er-ghost-teams.markTrainerAsGhost). sanitizeGhostProfile re-clamps.
    const entrance =
      this.draft.equippedEntrance > 0 ? TRAINER_ENTRANCE_EFFECTS[this.draft.equippedEntrance - 1] : undefined;
    const aura = this.draft.equippedAura > 0 ? TRAINER_AURA_EFFECTS[this.draft.equippedAura - 1] : undefined;
    // Tuning only affects the entrance + aura, so fold it only when one is equipped
    // (sanitizeGhostProfile re-clamps; an absent tuning applies the 1x default on encounter).
    const hasFx = entrance !== undefined || aura !== undefined;
    const raw: GhostTrainerProfile = {
      trainerType: this.currentType(),
      female: this.draft.female && this.currentHasGenders(),
      displayName: this.draft.displayName.trim() || undefined,
      title: this.draft.title.trim() || undefined,
      dialogue: Object.keys(dialogue).length > 0 ? dialogue : undefined,
      approach: entrance?.approach,
      aura: aura?.id,
      showAuraInBattle: aura ? true : undefined,
      fxSpeed: hasFx ? this.draft.fxSpeed : undefined,
      fxIntensity: hasFx ? this.draft.fxIntensity : undefined,
    };
    return sanitizeGhostProfile(raw);
  }

  private async publish(): Promise<void> {
    const profile = this.buildProfile();
    globalScene.gameData.ghostProfile = profile;
    // Persist the equipped Ghost Trainer FX picks to the system save (owned bits were already set
    // at purchase time; this records which owned effects are equipped so the editor re-seeds them).
    const fx = globalScene.gameData.trainerFx;
    const entranceId =
      this.draft.equippedEntrance > 0 ? (TRAINER_ENTRANCE_EFFECTS[this.draft.equippedEntrance - 1]?.id ?? null) : null;
    const auraId = this.draft.equippedAura > 0 ? (TRAINER_AURA_EFFECTS[this.draft.equippedAura - 1]?.id ?? null) : null;
    setEquippedTrainerEntrance(fx, entranceId);
    setEquippedTrainerAura(fx, auraId);
    setTrainerFxSpeed(fx, this.draft.fxSpeed);
    setTrainerFxIntensity(fx, this.draft.fxIntensity);
    // Tear the editor down BEFORE the confirmation so the message renders on a clean screen
    // (the editor paints an opaque backdrop; a MESSAGE under it would be invisible). setMode
    // clears the editor (the current handler) but does NOT touch the mode chain, so the
    // Profile hub overlay beneath it stays on the chain. Do NOT resetModeChain() here: that
    // orphaned the hub (its opaque container stayed visible with no chain entry left to clear
    // it, ghosting the Profile screen over the title / battle / starter-select). Leaving the
    // chain intact lets the exit path's ui.revertModes() (in TitlePhase.backToTitle) pop and
    // clear() the hub too. The message still renders over the hub's opaque backdrop, as before.
    globalScene.ui.setMode(UiMode.MESSAGE);
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
