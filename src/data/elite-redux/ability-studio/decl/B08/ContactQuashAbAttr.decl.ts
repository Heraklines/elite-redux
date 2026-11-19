/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2 / event-effect, Tier B. Read from the source (archetypes/contact-quash.ts) and from the 2 live users (Know Your
// Place 5437, Tangled Tails 5649, both attr 0, both with the default 5 turns). canApply is now `guards && gate`:
//
//   guards   1. there is an attacker and the move is an AttackMove (move.is("AttackMove"))             (a status move never counts)
//   gate     2. move.doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder)                (contact, Long Reach aware)
//   (no residual, no random draw)
//   apply    unless simulated: attacker.addTag(ER_QUASHED, turns): the attacker moves LAST within its priority bracket
//            for `turns` turns (the tag is read in Move.getPriorityModifier); no feasibility check before the tag is added
//
// The contact test is the only thing staff may want to change, so it is the gate; the attack-move test is a safety rule that
// stays in the class. `turns` is read only by apply, so it is editable without touching the gate.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ContactQuashAbAttr } from "#data/elite-redux/archetypes/contact-quash";

export default defineDecl(ContactQuashAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Make an attacker that touches me move last for some turns",
  summary: params =>
    `When a move that makes contact hits me, the attacker moves last in its priority bracket for ${params.turns} turns. Example: 5 means five turns.`,
  synonyms: [
    "know your place",
    "tangled tails",
    "quash",
    "move last",
    "slow the attacker",
    "contact slows the attacker",
  ],
  examples: ["Contact attacks make the foe move last for 5 turns"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      ctorOption: "turns",
      path: "turns",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of turns the attacker moves last",
      editable: true,
      gateIndependent: true,
      default: 5,
    },
  ],
  conditions: [
    // The gate is [move.flag MAKES_CONTACT] (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The move must be an attacking move (a status move never counts)", "There must be an attacker"],
  effect: { id: "effect.apply-tag", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A contact move, a non-contact move and a status move.
      name: "contact, non-contact and status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards (attacker exists, move is an AttackMove) && gate (contact). The two users are Know Your Place and Tangled Tails, both with the default 5 turns (no option given), both bound to move.flag MAKES_CONTACT. The guard uses move.is('AttackMove') (the move's class), which is not the same test as the atom move.damaging (category is not Status); it stays in the class as a safety rule. No random draw. `simulated`: canApply ignores it (there is nothing to roll) and apply returns early when simulated. showAbility is false (passed by the class). The tag is added with addTag(ER_QUASHED, turns) and no pre-check, so an attacker that already has the tag simply keeps whatever addTag does with a second copy.",
});
