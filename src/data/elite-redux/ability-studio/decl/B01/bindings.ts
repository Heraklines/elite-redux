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
