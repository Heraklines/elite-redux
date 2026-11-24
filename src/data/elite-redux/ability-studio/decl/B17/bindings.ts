/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B17, chunk 1 (spec 2.1): the library form of every Tier B gate of these classes, keyed by
// (abilityId, attrIndex, "gate"). Every line was read by hand from the live class (the `gate` method) and mapped to the
// atom that calls the SAME engine predicate; the L1 differential evaluates the class's own gate and the library form over
// the state grid. A gate that no atom can express stays a written legacy-closure and an entry in requests/B17.md.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// Magician (170, attr 0): `!move.doesFlagEffectApply({ MAKES_CONTACT, user: holder, target: foe })`.
// move.flag calls doesFlagEffectApply with the frame's moveUser (the holder after my hit) and target (the foe).
bindCondition(170, 0, { not: { id: "move.flag", flag: "MAKES_CONTACT" } }, "gate");

// Moxibustion (6032, attr 0): `super.canApply(params) && opponent.status?.effect === BURN`.
// super.canApply is PostAttackAbAttr's default attackCondition, `move.category !== STATUS` = move.damaging.
bindCondition(6032, 0, { all: [{ id: "move.damaging" }, { id: "status.has", who: "other", status: "BURN" }] }, "gate");

// Mutual Destruction (6104, attr 0): `!attacker.getAllies().includes(holder)` = the knocker is not an ally of mine.
bindCondition(6104, 0, { not: { id: "side.is", kind: "ally" } }, "gate");

// Metallosis (6049, attr 1): `super.canApply(params) && !!opponent.turnData.attacksReceived[0]?.critical`.
// The first half is move.damaging, but there is no atom for "the hit was a critical hit" (request R5), and both halves
// share one gate slot, so the whole gate stays legacy.
bindLegacyClosure(
  6049,
  1,
  "No atom reads whether the hit was a critical hit (opponent.turnData.attacksReceived[0]?.critical); see request R5 in requests/B17.md",
  "gate",
);

// Lingering Musk (6084, attr 3): the gate is the marker tempSummonData.lingeringMuskFaint that attr 2 sets.
bindLegacyClosure(
  6084,
  3,
  "No atom reads the marker left by a survived knockout hit (tempSummonData.lingeringMuskFaint); see request R3 in requests/B17.md",
  "gate",
);

// Oracle (6047, attrs 1 and 2): the gates read string markers in the ER provenance memory ("oracle:first-entry" in
// battleData, "oracle:guard:N" in summonData). No atom reads that memory yet (request R3).
bindLegacyClosure(
  6047,
  1,
  "No atom reads the ER provenance marker memory (battleData 'oracle:first-entry'); see request R3 in requests/B17.md",
  "gate",
);
bindLegacyClosure(
  6047,
  2,
  "No atom reads the ER provenance marker memory (summonData 'oracle:guard:N'); see request R3 in requests/B17.md",
  "gate",
);
