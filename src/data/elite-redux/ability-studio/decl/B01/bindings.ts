/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B01 (spec 2.1), keyed by (abilityId, attrIndex), "attr N" being the position in
// `ability.attrs`. Every line was read by hand from the live attr (closure source printed from the running game).
//
// Only one class of this chunk has a constructor closure at all:
//   - PostBattleInitFormChangeAbAttr takes `formFunc`, a function that returns a FORM NUMBER. The binding model holds
//     yes/no trees only, so each user is a legacy-closure with the exact function written in the reason, until the
//     librarian adds number-valued form pickers (requests/B01.md, R-B01-3).
// ReceivedTypeDamageMultiplierAbAttr builds its own closure from its `moveType` argument, which is a declared param,
// so it needs no binding. The other classes of the chunk have no closure.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// `() => 0`: always the base form.
const BASE_FORM =
  "The form function is `() => 0` (always the base form): it returns a form number, not a yes/no answer";

bindLegacyClosure(161, 0, `Zen Mode: ${BASE_FORM}. Needs the form picker 'fixed form' (R-B01-3).`);
bindLegacyClosure(208, 0, `Schooling: ${BASE_FORM}. Needs the form picker 'fixed form' (R-B01-3).`);
bindLegacyClosure(209, 3, `Disguise: ${BASE_FORM}. Needs the form picker 'fixed form' (R-B01-3).`);
bindLegacyClosure(248, 5, `Ice Face: ${BASE_FORM}. Needs the form picker 'fixed form' (R-B01-3).`);
bindLegacyClosure(278, 2, `Zero to Hero: ${BASE_FORM}. Needs the form picker 'fixed form' (R-B01-3).`);
bindLegacyClosure(5396, 3, `Patchwork: ${BASE_FORM}. Needs the form picker 'fixed form' (R-B01-3).`);

// `() => 1` with an attr-level condition (Greninja, not fused): the fixed form 1.
bindLegacyClosure(
  210,
  1,
  "Battle Bond: the form function is `() => 1` (always form 1) and the attr carries the attr-level condition 'Greninja and not fused'; it returns a form number. Needs the form picker 'fixed form' (R-B01-3).",
);

// `p => p.formIndex % 7`: keep the colour, drop the Core state.
bindLegacyClosure(
  197,
  0,
  "Shields Down: the form function is `p => p.formIndex % 7` (the colour of the current form, Meteor state); it returns a form number. Needs the form picker 'colour of my current form' (R-B01-3).",
);

// `p => p.formIndex - 2` with an attr-level condition (form 4 or 5): step back to the 10% or 50% form.
bindLegacyClosure(
  211,
  0,
  "Power Construct: the form function is `p => p.formIndex - 2` (the matching 10% or 50% form) and the attr carries the attr-level condition 'form 4 or 5'; it returns a form number. Needs the form picker 'step back by N forms' (R-B01-3).",
);

// HP based: the School form above 25% HP, the base form at or below it.
bindLegacyClosure(
  5586,
  0,
  "Revelation: the form function returns the Revelation form index while the HP ratio is above 25%, otherwise the base form (or the current index when it is not the Revelation form); it returns a form number. Needs a form picker driven by an HP line (R-B01-3).",
);

// PreDefendFullHpEndureAbAttr (Tier B). Slot "gate": clause 1 of the old canApply, `pokemon.isFullHp()` on the holder.
// The other three clauses (max HP above 1, a lethal hit, no STURDY tag yet) stay in the class as `residual`.
bindCondition(5, 0, { id: "hp.full", who: "holder" }, "gate");
bindCondition(5490, 1, { id: "hp.full", who: "holder" }, "gate");

// ---------------------------------------------------------------------------------------------------------------------
// Chunk 2 (the type immunity family). Every line below was read from the live attr (closure source printed from the
// running game), not from the source text.
//
// TypeImmunityAbAttr, TypeImmunityHealAbAttr, TypeImmunityStatStageChangeAbAttr and TypeImmunityAddBattlerTagAbAttr have
// NO user with a constructor closure (every `condition` field is null, an optional slot), so nothing is bound for them.

// FullHpResistTypeAbAttr (Tier B). Slot "gate": clause 3 of the old canApply, `pokemon.isFullHp()` on the holder.
// Clauses 1, 2 (guards) and 4 (residual) stay in the class.
bindCondition(308, 0, { id: "hp.full", who: "holder" }, "gate");
bindCondition(309, 2, { id: "hp.full", who: "holder" }, "gate");

// NonSuperEffectiveImmunityAbAttr (Tier B). Slot "gate": `move.is("AttackMove") && typeMultiplier.value < 2`.
bindLegacyClosure(
  25,
  0,
  "Wonder Guard gate: `move.is('AttackMove') && typeMultiplier.value < 2`. The frame has no typeMultiplier slot and no atom reads the matchup computed so far (move.effectiveness would recurse into this very check); `instanceof AttackMove` also has no exact atom (R-B01-14).",
  "gate",
);

// FieldPriorityMoveImmunityAbAttr (Tier B). Slot "gate": clause 2 of the old canApply, `move.getPriority(attacker) > 0`.
// The same function for every user; the six weather/terrain users also carry an attr-level condition that is carried
// over as it is. No atom calls `move.getPriority(user)` (R-B01-13).
const PRIORITY_GATE =
  "gate is `move.getPriority(attacker) > 0`, the priority AFTER the user's abilities and the move's own attrs (Prankster, Gale Wings); the atom move.priority reads the static field. Needs `move.effective-priority` (R-B01-13).";
bindLegacyClosure(214, 0, `Queenly Majesty: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(219, 0, `Dazzling: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(296, 0, `Armor Tail: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5194, 4, `Jungle's Guard (attr-level condition: Grassy Terrain): ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5213, 1, `Sand Guard (attr-level condition: weather helper): ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5293, 1, `Sun Basking (attr-level condition: weather helper): ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5506, 2, `Sepia Lens (attr-level condition: weather helper): ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5558, 0, `Royal Decree: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5601, 3, `Sand Fiend (attr-level condition: weather helper): ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5625, 0, `Empress: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5660, 1, `Rain Shroud (attr-level condition: Rain or Heavy rain): ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(5686, 0, `Lucha Libre: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(6074, 0, `Moonarch: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(20010, 1, `Duplicity: ${PRIORITY_GATE}`, "gate");
bindLegacyClosure(20019, 2, `Radiant Jewel: ${PRIORITY_GATE}`, "gate");

// MoveImmunityAbAttr (Tier A). Slot ctor:0, a `(pokemon, attacker, move)` closure.
// (c) `pokemon !== attacker && move.doesFlagEffectApply({ flag: SOUND_BASED, user: attacker })`, exact: the attacker is not
// me, and the move has the sound property by the same engine predicate the atom move.flag calls.
bindCondition(43, 0, {
  all: [{ not: { id: "side.is", kind: "self" } }, { id: "move.flag", flag: "SOUND_BASED" }],
});
bindCondition(5272, 1, {
  all: [{ not: { id: "side.is", kind: "self" } }, { id: "move.flag", flag: "SOUND_BASED" }],
});

// (a) `pokemon !== attacker && move.hasFlag(POWDER_MOVE)`: the plain flag, not doesFlagEffectApply (which also counts a flag
// that an ability injects). Needs `move.has-built-in-flag` (R-B01-10).
const POWDER =
  "closure is `pokemon !== attacker && move.hasFlag(POWDER_MOVE)` (the plain built-in flag); the atom move.flag calls doesFlagEffectApply, which also counts flags injected by abilities. Needs `move.has-built-in-flag` (R-B01-10).";
bindLegacyClosure(19, 1, `Shield Dust: ${POWDER}`);
bindLegacyClosure(142, 1, `Overcoat: ${POWDER}`);
bindLegacyClosure(5243, 1, `Powder Burst: ${POWDER}`);
bindLegacyClosure(5539, 2, `Guardian Coat: ${POWDER}`);

// (b) `pokemon !== attacker && move.hasFlag(BALLBOMB_MOVE)`, same reason.
const BALLBOMB =
  "closure is `pokemon !== attacker && move.hasFlag(BALLBOMB_MOVE)` (the plain built-in flag); the atom move.flag calls doesFlagEffectApply, which also counts flags injected by abilities. Needs `move.has-built-in-flag` (R-B01-10).";
bindLegacyClosure(171, 0, `Bulletproof: ${BALLBOMB}`);
bindLegacyClosure(5657, 1, `Chestnut Shield: ${BALLBOMB}`);

// (d) Telepathy.
bindLegacyClosure(
  140,
  0,
  "Telepathy: closure is `pokemon.getAlly() === attacker && move.is('AttackMove')`. getAlly() is the FIRST ally (the atom side.is ally accepts any teammate) and `instanceof AttackMove` has no exact atom. Needs `mon.is-first-ally` and `move.is-attack-move` (R-B01-12).",
);

// (e) Good as Gold.
bindLegacyClosure(
  283,
  0,
  "Good as Gold: closure is `pokemon !== attacker && move.category === STATUS && ![BOTH_SIDES, ENEMY_SIDE, USER_SIDE].includes(move.moveTarget)`. The not-self and status-category parts have atoms (side.is, move.category) but 'targets a whole side' has none exact (move.target-kind groups other targets as well). Needs `move.targets-whole-side` (R-B01-11).",
);

// ---------------------------------------------------------------------------------------------------------------------
// Chunk 3 (the after-hit and before-hit family). Every line below was read from the live attr (closure source printed
// from the running game; the ER rebalance patcher rewrites several vanilla closures after construction).
//
// MoveImmunityStatStageChangeAbAttr, PostDefendStatStageChangeAbAttr, PostDefendApplyArenaTrapTagAbAttr and
// PostDefendApplyBattlerTagAbAttr have a constructor closure (slot ctor:0, `(target, user, move)`; the holder of the frame
// is the target and `other` / the move user is the attacker). The Tier B classes PostDefendHpGatedStatStageChangeAbAttr,
// PreHitResistTypeChangeAbAttr and PostDefendTerrainChangeAbAttr have a gate. ReverseDrainAbAttr has neither.
//
// The plain contact flag `move.hasFlag(MAKES_CONTACT)` and `move.hasFlag(WIND_MOVE)` are NOT the library flag atom (that
// one asks doesFlagEffectApply, which also counts flags an ability injects, Long Reach, Punching Glove and substitutes), so
// those closures are legacy-closures until the librarian adds move.has-built-in-flag (R-B01-10).

const CONTACT = { id: "move.flag", flag: "MAKES_CONTACT" };
const DAMAGING = { id: "move.damaging" };
const OF_TYPE = (type: string): unknown => ({ id: "move.type", type });
const PLAIN_CONTACT =
  "the closure is `(_target, _user, move) => move.hasFlag(MAKES_CONTACT)` (the plain flag, no doesFlagEffectApply); the library flag atom is not the same predicate (R-B01-10)";

// PostDefendStatStageChangeAbAttr, slot ctor:0.
// `move.doesFlagEffectApply({ flag: MAKES_CONTACT, user, target })` -> move.flag (same call).
bindCondition(133, 0, CONTACT); // Weak Armor, Defense -1
bindCondition(133, 1, CONTACT); // Weak Armor, Speed +2
bindCondition(221, 0, CONTACT); // Tangling Hair
bindCondition(5602, 0, CONTACT); // Moustache, Speed -1
bindCondition(5647, 0, CONTACT); // Massive Pelt
// `move.category !== STATUS` -> move.damaging.
bindCondition(192, 0, DAMAGING); // Stamina
bindCondition(6002, 0, DAMAGING); // Stamina (second id)
bindCondition(238, 0, DAMAGING); // Cotton Down
bindCondition(5257, 2, DAMAGING); // Crowned Shield
bindCondition(5602, 2, DAMAGING); // Moustache, Defense +1
// `user.getMoveType(move) === T && move.category !== STATUS` (type first, then the category), move.type is effective.
bindCondition(195, 0, { all: [OF_TYPE("WATER"), DAMAGING] }); // Water Compaction
bindCondition(270, 0, { all: [OF_TYPE("FIRE"), DAMAGING] }); // Thermal Exchange
bindCondition(5711, 0, { all: [OF_TYPE("FIRE"), DAMAGING] }); // Thermal Entropy
// `move.category !== STATUS && (moveType === T1 || moveType === T2 ...)` (the category first).
bindCondition(155, 0, { all: [DAMAGING, { any: [OF_TYPE("DARK"), OF_TYPE("BUG"), OF_TYPE("GHOST")] }] }); // Rattled
bindCondition(243, 0, { all: [DAMAGING, { any: [OF_TYPE("FIRE"), OF_TYPE("WATER")] }] }); // Steam Engine
bindLegacyClosure(183, 0, `Gooey: ${PLAIN_CONTACT}.`);
bindLegacyClosure(5685, 0, `Mucus Membrane: ${PLAIN_CONTACT}.`);
bindLegacyClosure(5734, 1, `Slime Mold: ${PLAIN_CONTACT}.`);

// MoveImmunityStatStageChangeAbAttr, slot ctor:0: `pokemon !== attacker && move.hasFlag(WIND_MOVE) && move.category !== STATUS`.
bindLegacyClosure(
  274,
  0,
  "Wind Rider: the closure is `pokemon !== attacker && move.hasFlag(WIND_MOVE) && move.category !== STATUS`. It maps to all[ not side.is{self}, move.has-built-in-flag{WIND_MOVE}, move.damaging ], but the plain-flag atom does not exist yet and the library flag atom asks doesFlagEffectApply (R-B01-10).",
);

// PostDefendApplyArenaTrapTagAbAttr, slot ctor:0.
bindLegacyClosure(295, 0, `Toxic Debris: ${PLAIN_CONTACT}.`);

// PostDefendApplyBattlerTagAbAttr, slot ctor:0. `() => true` is the always-true group.
bindCondition(280, 0, { all: [] }); // Electromorphosis
bindCondition(5152, 0, { all: [] }); // Atomic Burst
bindLegacyClosure(
  277,
  0,
  "Wind Power: the closure is `(_target, _user, move) => move.hasFlag(WIND_MOVE)` (the plain flag, no doesFlagEffectApply); the library flag atom is not the same predicate (R-B01-10).",
);

// PostDefendHpGatedStatStageChangeAbAttr (Tier B). Slot "gate" is the WHOLE old canApply (damaging move, optional guard
// battle effect, HP line crossed with toDmgValue), see R-B01-21 for why the HP part cannot be bound yet.
const HP_LINE =
  "the gate is [move.damaging, (not tag.has guardTag), the HP line just crossed with `t = toDmgValue(maxHp * hpGate)`: hp <= t && hp + damage > t]; toDmgValue never goes below 1, which hp.crossed-below floor-half does, so a 1 max HP Pokemon differs (R-B01-21)";
bindLegacyClosure(271, 0, `Anger Shell (attr 0, +2 Attack, Sp. Atk, Speed): ${HP_LINE}.`, "gate");
bindLegacyClosure(271, 1, `Anger Shell (attr 1, -1 Defense, Sp. Def): ${HP_LINE}.`, "gate");
bindLegacyClosure(5372, 0, `No Turning Back (guard battle effect NO_RETREAT): ${HP_LINE}.`, "gate");

// PreHitResistTypeChangeAbAttr (Tier B). Slot "gate": `pokemon !== opponent && move.category !== STATUS`; the Terastallized,
// typeless and best-type clauses stay in the class as `residual`.
const NOT_MY_OWN_DAMAGING = { all: [{ not: { id: "side.is", kind: "self" } }, DAMAGING] };
bindCondition(16, 0, NOT_MY_OWN_DAMAGING, "gate"); // Color Change
bindCondition(5176, 0, NOT_MY_OWN_DAMAGING, "gate"); // Prismatic Fur

// PostDefendTerrainChangeAbAttr (Tier B). Slot "gate": `hitResult < HitResult.NO_EFFECT`.
bindLegacyClosure(
  269,
  0,
  "Seed Sower gate: `hitResult < HitResult.NO_EFFECT` (the hit dealt damage). The frame carries the hitResult slot but no atom reads it (R-B01-23).",
  "gate",
);
