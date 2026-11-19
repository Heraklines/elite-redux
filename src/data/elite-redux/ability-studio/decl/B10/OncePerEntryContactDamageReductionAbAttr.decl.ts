/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / calc-modifier (Tier B).
//
// Read by hand from archetypes/once-per-entry-contact-reduction.ts. The class extends ReceivedMoveDamageMultiplierAbAttr
// (WHEN "while the game calculates damage I take") and its constructor takes ONE number, the multiplier. The old closure it
// handed the parent was `charge unspent && move makes contact`; canApply is now guards && gate, in the original order:
//
//   guards   1. summonData.chuckusterReductionUsed !== true       the charge of THIS entry is unspent (resets at every send-out)
//   gate     2. move.doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder)    the parent's closure
//   (no residual, no random draw)
//   apply    spends the charge when not simulated, then the parent multiplies the damage (toDmgValue(damage * multiplier)).
//
// Clause classification: the charge test is the identity of "once per entry" (a rule inside the class: its memory is the
// per-entry field of the Pokemon, which the library's own once-per memory does not share, request R-B10-18), so it stays a
// guard in the class. "The move makes contact" is a rule staff would change (any move, only special moves, ...), so it is the
// replaceable gate and Chuckster's binding spells it with the library atom move.flag. The parent's `showAbility` is true.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OncePerEntryContactDamageReductionAbAttr } from "#data/elite-redux/archetypes/once-per-entry-contact-reduction";

export default defineDecl(OncePerEntryContactDamageReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage once each time I enter the battle",
  summary: params =>
    `Once after I enter the battle, the first hit that matches the condition (a contact move) does ${params.multiplier} times its damage. Example: 0.5 = half damage.`,
  synonyms: [
    "chuckster",
    "first contact hit reduced",
    "shield for one hit",
    "damage reduction on entry",
    "brace for the first touch",
    "one time guard",
  ],
  examples: ["The first contact move that hits me after I enter does only half damage, like Chuckster"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Damage multiplier for that one hit (0.5 = half damage)",
      editable: true,
      // The multiplier is read only by apply; the gate never repeats it.
      gateIndependent: true,
      default: 0.5,
    },
  ],
  conditions: [
    // The gate is the parent's closure: the incoming move makes contact (bindings.ts, one library atom).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Works for one hit each time this Pokemon enters the battle: the first hit that passes the condition uses the charge up and it comes back at the next send-out",
    "A damage preview shows the reduction but does not use the charge up",
  ],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [
    {
      name: "a contact hit, then a non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: the old closure `unspent && contact` became guards (unspent) then gate (contact), same order, no side effect in either, so nothing observable moved. The parent's closure is now only the contact half. Only user: Chuckster (attr 0; attr 1 is PostDamageForceAttackerOutAbAttr, another batch). Request R-B10-18: a memory atom that reads and writes the class's own per-entry charge so the library can express 'once per entry' without the class. Oddities, NOT fixed: the charge is spent by the first non-simulated apply that follows a passing canApply, whatever the damage turns out to be; the flag lives on summonData, so it is cleared whenever summonData is reset (each send-out); the parent's affectsFixedDamage stays false (the ctor passes only the multiplier), so fixed-damage hits are not reduced. Own test (the shared L1 grid and L2 twin cannot see it all): test/tests/elite-redux/decomp/B10/chunk2-gates.test.ts.",
});
