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
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

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

// =============================================================================================
// Chunk 3 of 4 (added). Three classes carry a closure or a gate; the other five (MoneyAbAttr, IllusionPreSummonAbAttr,
// PostDefendIllusionBreakAbAttr, IllusionPostBattleAbAttr and the parked IllusionBreakAbAttr) have none, so they need no binding.
// Each line below was read from the dump of the live attrs (closure source and fields), nothing is generated.
// =============================================================================================

// FormBlockDamageAbAttr, slot ctor:3, a PokemonDefendCondition `(target, user, move)`. The frame's holder is the target.
// Disguise (209, attr 2): the constructor default `() => true`, so an empty ALL group (always true).
bindCondition(209, 2, { all: [] }, "ctor:3"); // Disguise
// Ice Face (248, attr 4): `(_target, _user, move) => move.category === MoveCategory.PHYSICAL` (category 0).
bindCondition(248, 4, { id: "move.category", category: "PHYSICAL" }, "ctor:3"); // Ice Face

// PostSummonStatStageChangeOnArenaAbAttr (Tier B), slot gate: the original first clause of canApply,
// `arena.getTagOnSide(arenaTagType, holder's own side) ?? false`, with the tag TAILWIND. The tag is the `arenaTag` setting, which
// `gateParams` writes into the atom, so a moved setting moves this gate.
bindCondition(274, 1, { id: "field.arena-tag", tag: "TAILWIND", side: "holder-side" }, "gate"); // Wind Rider

// PreventBypassSpeedChanceAbAttr, slot ctor:0, `(_pokemon, move) => move.category === MoveCategory.STATUS` (category 2).
bindLegacyClosure(
  298,
  1,
  "Mycelium Might: `move.category === STATUS` on the move the holder chose this turn. Library form once a (pokemon, move) context exists (R-B07-1) and calc.speed-bypass provides the chosen move (R-B07-12): the atom move.category with category STATUS.",
); // Mycelium Might
