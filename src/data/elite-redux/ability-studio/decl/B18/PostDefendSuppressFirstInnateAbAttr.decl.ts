/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Mummy, Lingering Aroma and Lingering Musk (Tier B). "When I am hit, IF the move made contact AND the attacker does not
// have a Mummy-family ability, DO disable the attacker's first extra ability until it switches out".
//
// Source: ability-upgrades/attrs/mummy-family.ts, over PostDefendAbAttr. Dispatch: applyAbAttrs("PostDefendAbAttr", ...).
//
// canApply, in the ORIGINAL clause order (now gate && residual, no guards, no draw):
//   gate      move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })
//             &&  !(attacker has Mummy, Lingering Aroma or Wandering Spirit)     (hasMummyFamilyAbility)
//   residual  the attacker has an ACTIVE source that is a passive in slot 0      (feasibility: something to disable)
// apply: unless simulated, suppressInnateSlotUntilSwitch(attacker, 0). The trigger message names the attacker.
import { PostDefendSuppressFirstInnateAbAttr } from "#data/elite-redux/ability-upgrades/attrs/mummy-family";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendSuppressFirstInnateAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Disable the attacker's first extra ability on contact",
  summary: () =>
    "When a foe hits me with a move that makes contact, its first extra ability stops working until it switches out. Foes with a Mummy-style ability are spared.",
  synonyms: ["mummy", "lingering aroma", "lingering musk", "disable innate", "shut off passive", "contact curse"],
  examples: ["Turn off the first extra ability of anything that makes contact with me, like Mummy"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the slot it disables (the first extra ability) is fixed inside its effect, and the contact test and the Mummy-style exception are conditions, not numbers.",
  conditions: [
    // The gate is the group [move.flag MAKES_CONTACT, not any[has Mummy, has Lingering Aroma, has Wandering Spirit]], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The attacker must have an active first extra ability to disable; otherwise nothing happens",
    "Nothing is disabled while the game is only previewing",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a contact move and a non-contact move against the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'disable one extra-ability slot until the target switches out' writes the per-summon suppression list (summonData.erSuppressedInnateSlots) that the ability lookups read; the library has no effect for it (request R-B18-10), and 'the attacker has an active first extra ability' has no atom yet (request R-B18-4, so that clause stays the residual), and the slot number 0 is a literal inside the class, so the effect has no number to expose (a 'which slot' param would need the class to take it, which would change its constructor). The trigger (event.after-hit) and both conditions are separate blocks: contact is move.flag (it calls doesFlagEffectApply with the attacker as user and the holder as target, the same call as the original) and the exception is not(any of three mon.has-ability checks on the attacker), the same pokemon.hasAbility calls in the same order. The 'has an active first extra ability' clause is the residual (feasibility, shown as 'also requires'); it stays last, as in the original. State: the suppression lives in summon data and ends when the attacker is switched out. Users: Mummy (152, attr 0), Lingering Aroma (268, attr 0), Lingering Musk (6084, attr 0). ODDITIES (not fixed): (1) the Mummy-style list is Mummy, Lingering Aroma and Wandering Spirit, but Lingering Musk (which uses this class) is not in it, so two Lingering Musk holders disable each other while two Mummy holders do not; (2) Wandering Spirit is on the list but its live ability has no copy of this class (the unshift at init-elite-redux-vanilla-rebalance.ts:561 does not survive into the final ability, whose first attr is a different class), so it is spared yet never disables; (3) the trigger message is a hard-coded English string, not an i18n key.",
});
