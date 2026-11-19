/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B05 (chunk 1 of 4), keyed by (abilityId, attrIndex). Written by hand from the live attrs.
//
// Only SetMoveAccuracyAbAttr has a gate. The seven other classes of this chunk are presence flags (no closure, no gate),
// so they need no binding.
import { bindCondition } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// SetMoveAccuracyAbAttr (Tier B). Slot "gate": the original first clause `moveIds.includes(move.id)`.
// All three users list exactly one move, so the gate is the single atom "the move is X". The other two clauses
// (`accuracy !== -1`, `accuracy < value`) are the residual and stay in the class.
// =============================================================================================
bindCondition(5065, 0, { id: "move.is-move", moveId: "HYPNOSIS" }, "gate"); // Hypnotist, [HYPNOSIS], 90
bindCondition(5103, 2, { id: "move.is-move", moveId: "HYPNOSIS" }, "gate"); // Lunar Eclipse, [HYPNOSIS], 90
bindCondition(5487, 0, { id: "move.is-move", moveId: "SING" }, "gate"); // Lullaby, [SING], 90
