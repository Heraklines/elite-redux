/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1 (Tier B, calc-modifier). "While the game calculates my move's power, IF the move passes the condition AND I have the
// Stellar type, multiply the power by 1.5."
//
// Source: fakemon-pitch-mechanics.ts, StellarizePowerAbAttr (extends MovePowerBoostAbAttr; apply is `power.value *= powerMultiplier`;
// showAbility false). The class used to be `constructor() { super(closure, 1.5) }` with a canApply override; the constructor now takes
// (condition, powerMultiplier) with those two as defaults (behaviour-neutral). canApply, original clause order, now `guards && gate`:
//   guards  1. super.canApply = this.condition(holder, foe, move), the constructor closure (slot ctor:0, replaceable). The default is
//              `!!foe && move.type === NORMAL && (foe.isTerastallized || foe.isMega() || /gmax|gigantamax/i.test(foe.getFormKey()))`,
//              i.e. "my Normal move (by its printed type) against a Terastallized, Mega or Gigantamax foe". It sits in `guards()` only to
//              keep the original order.
//   gate    2. holder.getTypes(true, false).includes(STELLAR)   = holder.isOfType(STELLAR) with the default arguments
//                                                               -> library atom mon.has-type (who: holder, type: STELLAR)
// no residual, no random draw, no state. Dispatch: Move.calculateBattlePower, key VariableMovePowerAbAttr (WHEN calc.move-power).
import { StellarizePowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(StellarizePowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost my move power while I have the Stellar type",
  summary: params =>
    `While the game calculates my move's power, a move that passes the condition gets x${params.multiplier} power, but only while I am Stellar type. Default: Normal moves against Terastallized, Mega or Gigantamax foes.`,
  synonyms: [
    "stellarize",
    "stellar power boost",
    "power boost",
    "boost normal moves",
    "stronger against mega",
    "stronger against terastallized",
    "base power multiplier",
  ],
  examples: [
    "While I am Stellar type, my Normal moves hit Terastallized, Mega and Gigantamax foes 50% harder, like Stellarize",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "powerMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.05,
      label: "Power multiplier (1.5 = 50% more power)",
      editable: true,
      // The gate (I am Stellar type) never repeats the multiplier, only apply reads it.
      gateIndependent: true,
      default: 1.5,
    },
  ],
  conditions: [
    // Clause 1: the constructor condition (a library tree or the original closure).
    { slot: "ctor:0", ctx: "attack", path: "condition", removable: true, editable: true },
    // Clause 2: I am Stellar type.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table lists calc.move-power as unreached because the engine dispatches the moment under the key VariableMovePowerAbAttr; the twin still compares every trace of the battle where the holder attacks.",
  probes: [{ name: "the holder attacks with a Normal move and a non-Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B. 2 attrs: Stellarize (6053 attr 2) and Bejeweled (6111 attr 4). The gate (clause 2, I am Stellar type) is bound to mon.has-type STELLAR for both; mon.has-type calls isOfType(type) with the default arguments, the same call as `getTypes(true, false).includes`. The constructor condition (slot ctor:0, clause 1) is a LEGACY closure for both users: its second half (the foe is Terastallized, Mega or Gigantamax) has no library atom (requested as R-B16-8, R-B16-9, R-B16-10 in requests/B16.md); its first half (move.type NORMAL, the printed type) and the `!!foe` test would map to move.type (effective false) and 'the atom answers false when there is no foe'. Until then the attr is reusable as a whole but counted as undecomposed. The multiplier is a typed param. Suspected oddity, not fixed: the ability text says 'If already STAB, Stellar moves deal 1.5x'; the code tests the PRINTED Normal type, not Stellar, and has no STAB check. Because the same ability's StellarizeTypeAbAttr turns Normal moves into Stellar, the effect is equal for the shipped moves, but a Stellar move that was never Normal does not get the boost.",
});
