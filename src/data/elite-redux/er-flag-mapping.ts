// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/v2.65beta.json
// Regenerate with: pnpm run er:build
// =============================================================================

// Phase C task C4: maps Elite Redux flag names to pokerogue `MoveFlags` bits.
//
// Two surfaces:
//
//   1. `ER_FLAG_TO_MOVE_FLAG` — keyed by the human-readable names from
//      `ER_FLAG_NAMES` (A7's fixture-side decoder table). The wire-up layer
//      uses this when consuming ER's raw move-flag arrays.
//   2. `ER_CLASSIFIER_FLAG_TO_MOVE_FLAG` — keyed by the CAPS names emitted by
//      C3's `classify-moves` script (e.g. `"STRONG_JAW"`, `"ARROW"`).
//      Mirrors `MOVE_FLAG_MAP` in scripts/elite-redux/classify-moves.mjs.
//      The wire-up layer uses this when consuming C3 archetype params.
//
// Both tables resolve to either a `MoveFlags` bit OR `null` — `null` indicates
// the ER concept is encoded as a `MoveAttr` in pokerogue (e.g. "High Crit Rate"
// → `HighCritAttr`) rather than a flag bit.
//
// Regenerate with: `pnpm run er:audit-flag-mapping`.

import { MoveFlags } from "#enums/move-flags";

/** Text-form ER flag names (from `ER_FLAG_NAMES`) → `MoveFlags` bit (or `null`). */
export const ER_FLAG_TO_MOVE_FLAG: Readonly<Record<string, MoveFlags | null>> = {
  "Makes Contact": MoveFlags.MAKES_CONTACT,
  "High Crit Rate": null,
  "Air/Wing Based": MoveFlags.AIR_BASED,
  "Dance Move": MoveFlags.DANCE_MOVE,
  "Always Crits": null,
  "Field Based": MoveFlags.FIELD_BASED,
  "Hammer Based": MoveFlags.HAMMER_BASED,
  "Kick Based": MoveFlags.KICKING_MOVE,
  "Causes Recoil": null,
  "Horn Based": MoveFlags.HORN_BASED,
  "Drill Based": MoveFlags.DRILL_BASED,
  "Sound Based": MoveFlags.SOUND_BASED,
  "Bullet Move": MoveFlags.BALLBOMB_MOVE,
  "Weather Based": MoveFlags.WEATHER_BASED,
  "Throw Based": MoveFlags.THROW_BASED,
  "Bone Based": MoveFlags.BONE_BASED,
  "Lunar Move": MoveFlags.LUNAR_MOVE,
  "Arrow Based": MoveFlags.ARROW_BASED,
};

/** Classifier-form (CAPS) flag names (from C3 archetype params) → `MoveFlags` bit (or `null`). */
export const ER_CLASSIFIER_FLAG_TO_MOVE_FLAG: Readonly<Record<string, MoveFlags | null>> = {
  AIR_BASED: MoveFlags.AIR_BASED,
  ARROW: MoveFlags.ARROW_BASED,
  BONE_BASED: MoveFlags.BONE_BASED,
  DANCE_MOVE: MoveFlags.DANCE_MOVE,
  HAMMER_BASED: MoveFlags.HAMMER_BASED,
  IRON_FIST: MoveFlags.PUNCHING_MOVE,
  KEEN_EDGE: MoveFlags.SLICING_MOVE,
  MEGA_LAUNCHER: MoveFlags.PULSE_MOVE,
  MIGHTY_HORN: MoveFlags.HORN_BASED,
  SOUND_BASED: MoveFlags.SOUND_BASED,
  STRIKER: MoveFlags.KICKING_MOVE,
  STRONG_JAW: MoveFlags.BITING_MOVE,
};

/** Ordered list of ER text flag names — preserves the A7 declaration order. */
export const ER_FLAG_NAMES_LIST: readonly string[] = Object.keys(ER_FLAG_TO_MOVE_FLAG);

/** Ordered list of classifier-emitted flag names (alpha-sorted). */
export const ER_CLASSIFIER_FLAG_NAMES_LIST: readonly string[] = Object.keys(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG);

/**
 * Resolve an ER flag identifier (text or CAPS form) to its `MoveFlags` bit.
 *
 * @param name  Either a text-form name from `ER_FLAG_NAMES` ("Hammer Based")
 *              or a classifier-form CAPS name from C3 archetype params ("HAMMER_BASED").
 * @returns     The matching `MoveFlags` bit, or `null` if the ER concept is
 *              expressed as a `MoveAttr` in pokerogue, or `undefined` if
 *              the name is unrecognised.
 */
export function resolveErFlag(name: string): MoveFlags | null | undefined {
  if (Object.hasOwn(ER_FLAG_TO_MOVE_FLAG, name)) {
    return ER_FLAG_TO_MOVE_FLAG[name];
  }
  if (Object.hasOwn(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG, name)) {
    return ER_CLASSIFIER_FLAG_TO_MOVE_FLAG[name];
  }
  return undefined;
}
