/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4, bindings of the PARKED declarations (see the .decl.pending.ts files next to this one). Not named bindings.ts, so the
// registry does not load them: a binding for a class without a registered declaration is an L0 error. Append these lines to
// decl/B14/bindings.ts when the requests in requests/B14.md (R-B14-4.x) are done and the declarations are renamed to `.decl.ts`.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// Subversion (6081), attr 1 (LowerOffenseMoveCategoryAbAttr; attr 0 is AttackStatSubstituteAbAttr, attr 2 a MovePowerBoostAbAttr).
// Gate = [the move deals damage] (move.category !== STATUS, the same expression as the library atom).
bindCondition(6081, 1, { id: "move.damaging" }, "gate");

// Mudball (6097), attr 1 (MudballReactiveAbAttr; attr 0 is PostSummonScriptedMoveAbAttr). Gate = [the foe that entered is a Flying type].
// The two "still standing" clauses stay in erMudballOnOpponentSummon.
bindCondition(6097, 1, { id: "mon.has-type", who: "other", type: "FLYING" }, "gate");

// Grit (6110), attr 0. Gate = [the holder has a non-volatile status: status exists, its effect is not NONE and not FAINT].
bindLegacyClosure(
  6110,
  0,
  "The gate is `!!status && status.effect !== NONE && status.effect !== FAINT`. The library atom status.has ANY reads only `status != null`, which also counts a status whose effect is NONE and the fainted marker, so it is not the same predicate; status.has-non-volatile is requested in requests/B14.md (R-B14-4.10).",
  "gate",
);
