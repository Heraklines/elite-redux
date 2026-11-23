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
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

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

// ---------------------------------------------------------------------------------------------------------------------------
// Chunk 2. attrIndex read from the live game (a throwaway dump of ability.attrs).
// ---------------------------------------------------------------------------------------------------------------------------

// Bitter Drill (6044), attr 1 (BitterDrillDamageAbAttr). Gate = [move.hasFlag(DRILL_BASED), opponent has the ER_EMBEDDED tag].
bindLegacyClosure(
  6044,
  1,
  "Clause 1 of the gate is move.hasFlag(DRILL_BASED), the move's own flag. The library atom move.flag calls doesFlagEffectApply, which also counts flags that abilities inject, so it is not the same predicate; move.has-own-flag is requested in requests/B14.md. Clause 2 (target is Embedded) is tag.has, but a legacy binding covers the gate as a whole.",
  "gate",
);

// Slab's Curse (6066), attr 0. Gate = [the culprit is a foe, the faint came from a damaging move] (clauses 3 to 5; clause 4,
// `move !== undefined`, is what move.damaging answers false for). Guards 1 and 2 stay in the class.
bindCondition(6066, 0, { all: [{ id: "side.is", kind: "foe" }, { id: "move.damaging" }] }, "gate");

// Booby Trap (6067), attr 0 (BoobyTrapAbAttr). Gate = [damaging move, attacker is a foe] (clauses 4 to 6; clause 5,
// opponent !== pokemon, is implied by clause 6). Guards 1 to 3 and the residual (can add the tag, once per entry) stay in the class.
bindCondition(6067, 0, { all: [{ id: "move.damaging" }, { id: "side.is", kind: "foe" }] }, "gate");

// Booby Trap (6067), attr 1 (BoobyTrapItemLostAbAttr). Gate = [the culprit is a foe] (clauses 3 and 4; 3 is implied by 4).
bindCondition(6067, 1, { id: "side.is", kind: "foe" }, "gate");

// Ofuda (6070), attr 0. Gate = [30% chance]; the chance is repeated from the live `chance` param through gateParams.
bindCondition(6070, 0, { id: "rng.chance", pct: 30 }, "gate");
