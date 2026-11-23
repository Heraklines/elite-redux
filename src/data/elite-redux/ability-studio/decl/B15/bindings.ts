/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1 bindings: the library form of every constructor closure of the classes in this chunk, keyed by (abilityId, attrIndex).
// "attr N" is the position in `ability.attrs`, so Bodhisattva (a composite of Hand Barnacles and Brain Over Brawn) has the two Brain Over Brawn attrs at 2 and 3.
//
// Every line was read by hand from the live attr (closure source dumped from the real instance) and mapped to the atom that calls the SAME predicate.
// BadSplice, Swirlify, Rapier, the two Borrowed Time halves and Chivalry have no closure, so they need no binding.
import { bindCondition } from "#data/elite-redux/ability-studio/bindings";

// BrainOverBrawnTypeAbAttr, ctor:1, the closure `(_pokemon, _target, move) => move.type === PokemonType.FIGHTING`.
// move.type with `effective: false` is the move's own printed type (`move.type`); the default `true` asks getMoveType, which would dispatch the type attr again.
const NATIVE_FIGHTING_MOVE = { id: "move.type", type: "FIGHTING", effective: false };
bindCondition(6076, 2, NATIVE_FIGHTING_MOVE, "ctor:1"); // Bodhisattva, type conversion
bindCondition(6080, 0, NATIVE_FIGHTING_MOVE, "ctor:1"); // Brain Over Brawn, type conversion

// BrainOverBrawnPowerAbAttr, ctor:0, the same closure (the x1.2 power rider).
bindCondition(6076, 3, NATIVE_FIGHTING_MOVE, "ctor:0"); // Bodhisattva, power rider
bindCondition(6080, 1, NATIVE_FIGHTING_MOVE, "ctor:0"); // Brain Over Brawn, power rider
