/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `move-flag-injection` archetype.
//
// Marker ability: makes the holder's matching moves count as carrying an extra
// move flag at runtime. Read by `Move.doesFlagEffectApply` (the user-aware flag
// check), which covers BOTH the DANCE trigger (Dancer) and the SOUND-based
// abilities (Soundproof / Punk Rock / Liquid Voice) once those consumers route
// through `doesFlagEffectApply` instead of the static `hasFlag` (#449 — they now
// do, so Festivities' "dance moves also count as sound" direction works).
//
// Wires:
//   - 733 Taekkyeon — "All attacks are dances." (inject DANCE_MOVE on all
//     non-status moves, so the holder's attacks trigger Dancer)
//   - 974 Backstreet Boy — "Kicking moves are Dance moves and vice-versa."
//     (inject DANCE_MOVE on the holder's KICKING moves, so kicks trigger Dancer)
//   - 842 Festivities — "Sound moves become dance moves and vice versa." (inject
//     DANCE_MOVE on sound moves AND SOUND_BASED on dance moves — both directions)
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { Move } from "#moves/move";

export type FlagInjectionScope =
  | "all-attacks"
  | "all-moves"
  | "sound-moves"
  | "dance-moves"
  | "status-moves"
  | "kicking-moves";

export class MoveFlagInjectionAbAttr extends AbAttr {
  public readonly injectFlag: MoveFlags;
  private readonly scope: FlagInjectionScope;

  constructor(injectFlag: MoveFlags, scope: FlagInjectionScope = "all-attacks") {
    super(false);
    this.injectFlag = injectFlag;
    this.scope = scope;
  }

  /** Whether this ability injects `flag` onto `move`. */
  public injects(flag: MoveFlags, move: Move): boolean {
    if (flag !== this.injectFlag) {
      return false;
    }
    switch (this.scope) {
      case "all-moves":
        return true;
      case "sound-moves":
        return move.hasFlag(MoveFlags.SOUND_BASED);
      case "dance-moves":
        return move.hasFlag(MoveFlags.DANCE_MOVE);
      case "kicking-moves":
        return move.hasFlag(MoveFlags.KICKING_MOVE);
      case "status-moves":
        return move.category === MoveCategory.STATUS;
      default:
        return move.category !== MoveCategory.STATUS;
    }
  }
}
