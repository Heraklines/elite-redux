/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Ghost Trainer Profile (presentation customization).
//
// A player authors how THEIR ghost appears to others: trainer sprite/class,
// display name, title, and battle dialogue (with placeholder tokens). The
// profile lives on the SYSTEM save (the player's working copy) and a snapshot
// rides along on every ghost their runs publish (er-ghost-teams.ts -> the
// `runs.presentation` blob), so the encountering client renders it.
//
// This module is a dependency-light LEAF: pure types + the placeholder resolver
// + sanitisation. The team itself is NOT authored here (presentation-only model)
// - the ghost's party still comes from the player's real run, so no new
// anti-cheat surface. FX fields (tintColor / aura / approach / music) are
// reserved here now and populated by later phases (P2/P4); defining the full
// shape up front keeps the serialization forward-compatible.
// =============================================================================

import {
  isKnownTrainerAuraId,
  TRAINER_FX_DEFAULT_TUNING,
  TRAINER_FX_INTENSITY_MAX,
  TRAINER_FX_INTENSITY_MIN,
  TRAINER_FX_SPEED_MAX,
  TRAINER_FX_SPEED_MIN,
} from "#data/elite-redux/er-trainer-fx";
import type { TrainerType } from "#enums/trainer-type";

/** Field length caps (mirror the editor's on-screen counters). */
export const GHOST_NAME_MAX = 24;
export const GHOST_TITLE_MAX = 32;
export const GHOST_DIALOGUE_MAX = 80;

/**
 * How the ghost trainer arrives on the field at encounter (the per-trainer
 * entrance tween in encounter-phase.ts). "default" = the vanilla +300 slide-in.
 * The Ghost Trainer FX catalog (er-trainer-fx.ts) maps each unlockable entrance
 * effect to one of these values; the legacy `appearsSuddenly`/`wandersIn`/
 * `blocksPath` members are kept for back-compat (older reserved saves).
 */
export type GhostApproachEffect =
  | "default"
  | "fromShadow"
  | "appearsSuddenly"
  | "wandersIn"
  | "blocksPath"
  | "fromAbove"
  | "riseFromGround"
  | "fogMaterialize"
  | "flashIn"
  | "reverseDissolve";

/** Every valid {@linkcode GhostApproachEffect} string (for untrusted-input clamping). */
const GHOST_APPROACH_VALUES: ReadonlySet<string> = new Set<GhostApproachEffect>([
  "default",
  "fromShadow",
  "appearsSuddenly",
  "wandersIn",
  "blocksPath",
  "fromAbove",
  "riseFromGround",
  "fogMaterialize",
  "flashIn",
  "reverseDissolve",
]);

/** True if `value` is a recognised {@linkcode GhostApproachEffect}. */
export function isGhostApproachEffect(value: unknown): value is GhostApproachEffect {
  return typeof value === "string" && GHOST_APPROACH_VALUES.has(value);
}

/**
 * Battle dialogue lines. Mapped onto the engine's three trainer message arrays
 * at instantiate time (er-ghost-teams apply step):
 *   intro        -> encounterMessages   (battle start)
 *   defeatPlayer -> defeatMessages      (trainer beats the player)
 *   defeated     -> victoryMessages     (player beats the trainer)
 *   afterWin     -> appended after defeatPlayer (reserved; an extra gloat line)
 * Any omitted line falls back to the cosmetic trainer class's canned lines.
 */
export interface GhostDialogue {
  intro?: string | undefined;
  defeatPlayer?: string | undefined;
  defeated?: string | undefined;
  afterWin?: string | undefined;
}

/**
 * The full authored presentation. EVERY field is optional: an absent field means
 * "use the existing default" (the random cosmetic class / username), so the whole
 * feature is purely additive and old ghosts (no profile) are unaffected.
 */
export interface GhostTrainerProfile {
  /** Chosen trainer sprite/class. Absent -> the legacy ghost.id-hashed random class. */
  trainerType?: TrainerType | undefined;
  /** Female sprite variant (only meaningful when the chosen class hasGenders). */
  female?: boolean | undefined;
  /** Custom display name. Absent -> the uploader's account username. */
  displayName?: string | undefined;
  /** Optional title prefix shown before the name. */
  title?: string | undefined;
  /** Battle dialogue overrides. */
  dialogue?: GhostDialogue | undefined;

  // ---- Ghost Trainer FX (populated by the editor; see er-trainer-fx.ts) ----
  /** P2: appearance tint (Trainer.tint colour). */
  tintColor?: number | undefined;
  /** Equipped aura effect: an AROUND shader id (one of TRAINER_AURA_IDS). */
  aura?: string | undefined;
  /** Show the aura during the encounter (not just the editor preview). */
  showAuraInBattle?: boolean | undefined;
  /** Equipped entrance effect (the on-field arrival tween). */
  approach?: GhostApproachEffect | undefined;
  /** FX playback speed multiplier for the entrance + aura (0.25-3, default 1). */
  fxSpeed?: number | undefined;
  /** FX intensity multiplier for the entrance + aura (0.5-2, default 1). */
  fxIntensity?: number | undefined;
  /** P4: forced battle music key (absent -> the ghost piano default). */
  music?: string | undefined;
}

/**
 * Clamp an untrusted FX tuning multiplier: an in-band number is kept, anything else
 * (out-of-range, NaN, non-number) collapses to the default 1x. So a tampered peer can
 * never smuggle an extreme speed / intensity into another player's encounter.
 */
function clampGhostFxTuning(value: unknown, min: number, max: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) {
    return value;
  }
  return TRAINER_FX_DEFAULT_TUNING;
}

/** Placeholder tokens, resolved on the ENCOUNTERING player's client at display time. */
export const GHOST_TOKENS = {
  /** The encountering player's name. */
  player: "{player}",
  /** The encountering player's lead Pokemon (party slot 0). */
  lead: "{lead}",
  /** The encountering player's strongest Pokemon (by level, tiebreak BST). */
  ace: "{ace}",
  /** The encountering player's Pokemon that KO'd the most of this ghost's team.
   *  Only known AFTER the battle, so it resolves on win/lose lines, not the intro. */
  slayer: "{slayer}",
} as const;

/** Ordered list for the editor's "insert token" helper. */
export const GHOST_TOKEN_LIST: { token: string; label: string; introSafe: boolean }[] = [
  { token: GHOST_TOKENS.player, label: "Player name", introSafe: true },
  { token: GHOST_TOKENS.lead, label: "Their lead Pokemon", introSafe: true },
  { token: GHOST_TOKENS.ace, label: "Their strongest Pokemon", introSafe: true },
  { token: GHOST_TOKENS.slayer, label: "The Pokemon that beat you (post-battle only)", introSafe: false },
];

/** Values the encountering client supplies to fill the tokens. Any missing value
 *  leaves a sensible literal fallback so a line never shows a raw `{token}`. */
export interface GhostDialogueContext {
  player?: string | undefined;
  lead?: string | undefined;
  ace?: string | undefined;
  slayer?: string | undefined;
}

/**
 * Substitute placeholder tokens in an authored line. Pure + total: unknown/missing
 * values fall back to a neutral word so the player never sees a literal `{lead}`.
 * Done BEFORE the line reaches the message UI so it can't collide with that layer's
 * own `@c{}` / `$` / `#POKEMON` syntax.
 */
export function resolveGhostDialogue(line: string, ctx: GhostDialogueContext): string {
  if (!line) {
    return line;
  }
  return line
    .replaceAll(GHOST_TOKENS.player, ctx.player || "Trainer")
    .replaceAll(GHOST_TOKENS.lead, ctx.lead || "your Pokemon")
    .replaceAll(GHOST_TOKENS.ace, ctx.ace || "your ace")
    .replaceAll(GHOST_TOKENS.slayer, ctx.slayer || "your Pokemon");
}

/** Clamp a single line to its cap, strip control chars, and trim. */
function clampLine(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  // Strip control characters (charCode < 0x20, or DEL 0x7f) without a control-char regex literal.
  const cleaned = [...value].filter(ch => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f).join("").trim();
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.slice(0, max);
}

/**
 * Normalise an untrusted profile (from a save blob or a sampled ghost row) into a
 * safe shape: enforce length caps, drop empty strings, and keep only known fields.
 * Returns null when nothing meaningful is set (so callers can skip cleanly).
 */
export function sanitizeGhostProfile(raw: unknown): GhostTrainerProfile | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const out: GhostTrainerProfile = {};

  if (typeof r.trainerType === "number" && Number.isInteger(r.trainerType) && r.trainerType >= 0) {
    out.trainerType = r.trainerType as TrainerType;
  }
  if (typeof r.female === "boolean") {
    out.female = r.female;
  }
  const name = clampLine(r.displayName as string | undefined, GHOST_NAME_MAX);
  if (name) {
    out.displayName = name;
  }
  const title = clampLine(r.title as string | undefined, GHOST_TITLE_MAX);
  if (title) {
    out.title = title;
  }

  if (typeof r.dialogue === "object" && r.dialogue !== null) {
    const d = r.dialogue as Record<string, unknown>;
    const dialogue: GhostDialogue = {};
    for (const key of ["intro", "defeatPlayer", "defeated", "afterWin"] as const) {
      const line = clampLine(d[key] as string | undefined, GHOST_DIALOGUE_MAX);
      if (line) {
        dialogue[key] = line;
      }
    }
    if (Object.keys(dialogue).length > 0) {
      out.dialogue = dialogue;
    }
  }

  // Reserved fields (passed through, lightly validated) so later phases work
  // end-to-end the moment they start populating them.
  if (typeof r.tintColor === "number" && Number.isInteger(r.tintColor)) {
    out.tintColor = r.tintColor;
  }
  if (typeof r.showAuraInBattle === "boolean") {
    out.showAuraInBattle = r.showAuraInBattle;
  }
  // Approach: clamp to the known enum (default/none if unrecognised) so an
  // untrusted peer can't smuggle an arbitrary string into the entrance tween.
  if (isGhostApproachEffect(r.approach) && r.approach !== "default") {
    out.approach = r.approach;
  }
  // Aura: clamp to the known AROUND id whitelist (drop to none if unknown).
  if (isKnownTrainerAuraId(r.aura)) {
    out.aura = r.aura;
  }
  // FX tuning: present-but-untrusted values are clamped to their band (garbage /
  // out-of-range -> 1x). An absent field stays undefined (old ghosts unaffected;
  // the encounter applies the 1x default).
  if (r.fxSpeed !== undefined) {
    out.fxSpeed = clampGhostFxTuning(r.fxSpeed, TRAINER_FX_SPEED_MIN, TRAINER_FX_SPEED_MAX);
  }
  if (r.fxIntensity !== undefined) {
    out.fxIntensity = clampGhostFxTuning(r.fxIntensity, TRAINER_FX_INTENSITY_MIN, TRAINER_FX_INTENSITY_MAX);
  }
  if (typeof r.music === "string") {
    out.music = clampLine(r.music, 64);
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** A fresh, empty profile for the editor to populate. */
export function defaultGhostProfile(): GhostTrainerProfile {
  return {};
}
