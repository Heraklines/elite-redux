/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-3.1, same
// shape as R-B14-2.3 and R-B12-13); then rename this file to ReductionRuneAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "While I am in battle, every OTHER Pokemon's attack has its weakness bonus capped."
//
// Source: bernerd-roster-mechanics.ts `export class ReductionRuneAbAttr extends AbAttr {}`: an empty class, a presence marker. Nothing
// dispatches it. The only reader is Pokemon.getAttackDamage (src/field/pokemon.ts:6215, found by class NAME):
//   reductionRuneMultiplier = typeMultiplier > 1 && field(active).some(holder => holder !== source && holder has the marker)
//       ? (typeMultiplier >= 4 ? 2 / typeMultiplier : 1.5 / typeMultiplier) : 1
// so a 2x weakness counts as 1.5x and 4x or more counts as 2x. `source` is the ATTACKER and the check runs over EVERY active
// Pokemon, so the cap applies to every attacker except the holder itself, whoever is being hit (the holder's allies and
// foes are all affected). The 1.5 and 2 are literals in the engine reader, not in the class: they cannot be class params without
// editing the reader (outside this batch's remit), so they are requested (R-B14-3.4) and the declaration has no params.
// No constructor, no closure, no random draw, no state, no `simulated` test. The check is by class name: it must never be renamed.
import { ReductionRuneAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ReductionRuneAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Cap the weakness bonus of other Pokemon's attacks",
  summary: () =>
    "While I am in battle, every other attacker's weakness bonus is capped: 2x counts as 1.5x, and 4x or more counts as 2x. My own attacks are not capped.",
  synonyms: [
    "reduce weakness",
    "weakness cap",
    "super effective cap",
    "less super effective",
    "resist weaknesses",
    "damage reduction",
    "type chart softener",
  ],
  examples: ["Super effective hits from other Pokemon only do 1.5 times damage while I am in battle"],
  params: [],
  noParamsReason:
    "A presence marker read by the damage calculation (the 1.5 and 2 caps are numbers inside that engine code, not in the class), so nothing in the class can be tuned; the caps are requested as editable values.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only attacks that are super effective (a type multiplier above 1) are changed",
    "Every attacker except me is capped, including my allies and my foes",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: a super effective move hits and the battles must match.",
  probes: [{ name: "a super effective move hits", axes: { foeMove: ["MACH_PUNCH", "TACKLE"] } }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Reduction Rune (6082) attr 0 (its only attr; showAbility is the default true but nothing dispatches it). Oddities, not fixed: the reader skips only the attacker, so the cap also applies to the holder's own allies' attacks and to attacks aimed at the holder's allies and foes ('surrounding attackers' in the comment), and it applies even when the holder is the one being hit; it does not look at whether the holder is on the attacker's or the target's side.",
});
