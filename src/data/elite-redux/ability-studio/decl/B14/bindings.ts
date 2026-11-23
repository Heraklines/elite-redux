/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 instance bindings, chunk 1. Every Tier B gate of this chunk is a LEGACY closure: each one needs an atom the library
// does not have yet (requests/B14.md). A legacy binding keeps the attr reusable as a whole and counted as undecomposed;
// the rest of each class (trigger, guards, effect) is already declared.
//
// attrIndex is the position in `ability.attrs`, read from the live game, not from the .attr() line.
import { bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// Perpetual Motion (6022), attrs: 0 trigger, 1 end-of-turn launcher, 2 resolver, 3 progress, 4 power.
// Progress gate = [the move deals damage (inherited attackCondition, default `move.category !== STATUS`),
//                  the move carries ScriptedMoveMarkerAttr key "perpetual-motion"], in that order.
bindLegacyClosure(
  6022,
  3,
  "The second clause (the move is this ability's own scripted follow-up, a ScriptedMoveMarkerAttr with key perpetual-motion) has no library atom; move.scripted-marker is requested in requests/B14.md. The first clause maps to move.damaging.",
  "gate",
);
// Power gate = [the move carries ScriptedMoveMarkerAttr key "perpetual-motion"]; the armed-state clause is a guard in the class.
bindLegacyClosure(
  6022,
  4,
  "The gate is the scripted-move marker test (ScriptedMoveMarkerAttr key perpetual-motion) and no library atom reads that; move.scripted-marker is requested in requests/B14.md.",
  "gate",
);

// Southern Cross Punch (6016), attr 0. Gate = [move.hasFlag(PUNCHING_MOVE)].
bindLegacyClosure(
  6016,
  0,
  "The gate is move.hasFlag(PUNCHING_MOVE), the move's own flag. The library atom move.flag calls doesFlagEffectApply, which also counts flags that abilities inject, so it is not the same predicate; move.has-own-flag is requested in requests/B14.md.",
  "gate",
);

// Bitter Drill (6044), attr 0. Gate = [move.hasFlag(DRILL_BASED)].
bindLegacyClosure(
  6044,
  0,
  "The gate is move.hasFlag(DRILL_BASED), the move's own flag. The library atom move.flag calls doesFlagEffectApply, which also counts flags that abilities inject, so it is not the same predicate; move.has-own-flag is requested in requests/B14.md.",
  "gate",
);
