/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B07 (chunk 1 of 4), keyed by (abilityId, attrIndex[, slot]). Written by hand from the live
// attrs: the dump printed every closure source and field of every user (nothing here is generated).
//
// Only two classes of the chunk carry a closure or a gate:
//   MoveAbilityBypassAbAttr              slot ctor:0, `(pokemon, move) => boolean` (six users)
//   SuperEffectiveMoveAbilityBypassAbAttr slot ctor:0 (the inherited closure) and slot gate (three users)
// The other six classes are presence flags or number holders without a closure, so they need no binding.
//
// Why every line is a legacy closure for now: build-attr.ts has no condition context for the signature
// `(pokemon, move)` ("attack" is (user, target, move), "defend" is (target, user, move), "holder" is (pokemon)), and the
// WHEN `calc.ability-bypass` provides neither `other` nor `moveUser`, so the atoms `move.type`, `move.category` and
// `move.effectiveness` cannot be evaluated there. Request R-B07-1 (requests/B07.md) asks the librarian for both; each
// reason below carries the library form that replaces it.
import { bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

const ALWAYS_TRUE =
  "The constructor default `() => true`: no condition. Library form once a (pokemon, move) context exists (R-B07-1): an empty ALL group, which is always true.";

// =============================================================================================
// MoveAbilityBypassAbAttr, slot ctor:0, `(pokemon, move) => boolean`.
// =============================================================================================
bindLegacyClosure(104, 1, ALWAYS_TRUE); // Mold Breaker
bindLegacyClosure(163, 1, ALWAYS_TRUE); // Turboblaze
bindLegacyClosure(164, 1, ALWAYS_TRUE); // Teravolt
bindLegacyClosure(5397, 3, ALWAYS_TRUE); // Blind Rage

// `(_pokemon, move) => move.category === MoveCategory.STATUS` (category 2)
bindLegacyClosure(
  298,
  2,
  "Mycelium Might: `move.category === STATUS`. Library form once a (pokemon, move) context exists (R-B07-1): the atom move.category with category STATUS.",
); // Mycelium Might

// `(pokemon, move) => pokemon.getMoveType(move) === PokemonType.ROCK` (type 5)
bindLegacyClosure(
  5582,
  2,
  "Stonecutter: `pokemon.getMoveType(move) === ROCK`. Library form once a (pokemon, move) context exists (R-B07-1): the atom move.type with type ROCK and effective true (the type after ability changes), which needs the move user slot from this WHEN.",
); // Stonecutter

// =============================================================================================
// SuperEffectiveMoveAbilityBypassAbAttr (Tier B).
// Slot ctor:0: the inherited closure, `() => true` for all three users.
// Slot gate: the original second clause of canApply, `target != null && target.getMoveEffectiveness(pokemon, move) > 1`.
// =============================================================================================
const GATE_REASON =
  "Gate `target != null && target.getMoveEffectiveness(pokemon, move) > 1`. Library form once calc.ability-bypass provides `other` and `moveUser` (R-B07-1): the atom move.effectiveness with comparison above and 1x (a missing foe fails closed in the class today and must stay so).";

for (const [abilityId, attrIndex] of [
  [5495, 1], // Deadly Precision
  [5622, 1], // Flawless Precision
  [5635, 1], // Mach 3
] as const) {
  bindLegacyClosure(abilityId, attrIndex, ALWAYS_TRUE, "ctor:0");
  bindLegacyClosure(abilityId, attrIndex, GATE_REASON, "gate");
}
