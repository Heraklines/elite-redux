/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 4, Tier B event-effect. A subclass of PostDefendContactApplyStatusEffectAbAttr (the golden RNG precedent) with
// the constructor fixed to `super(10, POISON, PARALYSIS, SLEEP)` and ONE extra clause in front of everything:
//   canApply  `!(attacker.isOfType(GRASS) || abilityQuery(attacker, OVERCOAT_POWDER_IMMUNITY)) && super.canApply(params)`
//   in the real order:
//     0. powder immunity of the attacker (Grass type, or an ability that gives powder immunity such as Overcoat)
//                 = feasibility that stays in the class. It sits BEFORE the first random draw, so a powder-immune attacker
//                   never costs a random number (a test proves it).
//     1. prepare   draw 1: which of the three statuses canSetStatus is asked about (the parent picks one of 3 at random)
//     2. gate      contact (doesFlagEffectApply) && attacker has no status && draw 2: `randBattleSeedInt(100) < 10`
//     3. residual  `attacker.canSetStatus(thePickedStatus, true, false, holder)`
//   apply     draw 3: an independent pick of the status that is really given (so it can differ from draw 1, kept)
// The subclass adds no gate member: it inherits `gate`, `prepare`, `residual` and `gateOverride` from the parent, so the
// library gate (`move.flag` contact, `status.has` attacker none, `rng.chance` 10) replaces the parent's gate on a rebuilt
// instance and the powder clause stays in the class's own `canApply`.
// There are no settings: the 10 percent and the three statuses are baked into the constructor.
import { EffectSporeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EffectSporeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Sometimes poison, paralyze or sleep a contact attacker",
  summary: () =>
    "When a move that makes contact hits me, there is a 10% chance the attacker is poisoned, paralyzed or put to sleep (one at random). Grass types and powder-proof Pokemon are spared. Like Effect Spore.",
  synonyms: [
    "effect spore",
    "spore on contact",
    "random status on contact",
    "poison paralyze or sleep the attacker",
    "touch me and get a random status",
    "powder on touch",
  ],
  examples: ["10% chance to poison, paralyze or sleep attackers that touch me, like Effect Spore"],
  params: [],
  noParamsReason:
    "Nothing to set: the constructor takes no argument. The 10 percent chance and the three statuses (poison, paralysis, sleep) are fixed inside the class; the generic block 'Sometimes give the attacker a status when it touches me' has sliders for them.",
  conditions: [
    // The gate is the group [move.flag MAKES_CONTACT, status.has other NONE, rng.chance 10], in that order (inherited).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The attacker must not be a Grass type or have a powder-proof ability (Overcoat)",
    "The attacker must be able to receive the status (it is not immune and nothing blocks it)",
  ],
  effect: { id: "effect.inflict-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply powder check: no draw (a Grass or powder-proof attacker stops here)",
      "canApply prepare: pick one of the three statuses for the canSetStatus check",
      "canApply gate: the 10 percent roll, only after the contact and no-status checks passed",
      "apply: pick the status that is given (independent of the first pick)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      name: "a contact move and a non-contact move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (1 attr): Effect Spore (27 attr 0). The class ignores `simulated` like its parent (recorded, not fixed): it draws and rolls even for simulated calls, while the library atom rng.chance answers true without a draw there. No engine path calls PostDefend attrs simulated today. The powder clause is feasibility (the immunity is a rule of the game world, not a design choice of the ability) and it stays in the subclass `canApply`, in front of the parent call, so the order of random draws is the original. The status list and chance are not settings because the class takes none; the library gate carries rng.chance 10 as a literal and there is no editable setting that must follow it. Oddity (not fixed): `canApply` checks the status picked by draw 1 but `apply` picks again, so with three statuses the status that lands can differ from the one that was checked (inherited from the parent).",
});
