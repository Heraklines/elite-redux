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
// check). NOTE: this only affects consumers that route through
// `doesFlagEffectApply` — the DANCE-trigger does (after this change). Many
// SOUND consumers (Soundproof, Punk Rock) read the static `hasFlag` directly,
// so SOUND injection is intentionally NOT covered here.
//
// Wires:
//   - 733 Taekkyeon — "All attacks are dances." (inject DANCE_MOVE on all
//     non-status moves, so the holder's attacks trigger Dancer)
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { Move } from "#moves/move";

export type FlagInjectionScope = "all-attacks" | "all-moves" | "sound-moves" | "status-moves";

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
      case "status-moves":
        return move.category === MoveCategory.STATUS;
      default:
        return move.category !== MoveCategory.STATUS;
    }
  }
}
