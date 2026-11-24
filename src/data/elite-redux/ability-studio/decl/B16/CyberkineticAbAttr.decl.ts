/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2 (Tier B, event-effect). "When my contact attack hurts a foe, the foe becomes a pure Electric type until it leaves the field."
//
// Source: fakemon-pitch-mechanics.ts, CyberkineticAbAttr (extends PostAttackAbAttr; no constructor of its own, so the parent's
// `(attackCondition, showAbility)` is the constructor). canApply, original clause order, now `guards && gate`:
//   guards  1. super.canApply: the inherited attack condition = constructor argument 0; the default (and the only value the one user
//              passes) is `move.category !== STATUS` -> a replaceable library condition (slot ctor:0, bound to move.damaging). It sits
//              in `guards()` in the class only to keep the clause order; staff replace it through the constructor slot.
//           2. damage > 0                            the hit really dealt damage
//   gate    3. appliesContact(holder, foe, move)     = move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: holder, target: foe })
//                                                    -> library atom move.flag (MAKES_CONTACT)
// no residual, no random draw. apply: !simulated: foe.addTag(ER_BREACHED, 0, MoveId.NONE, holder.id). ErBreachedTag.onAdd sets
// `foe.summonData.types = [ELECTRIC]` (the foe is a pure Electric type), and the marker lasts until the foe leaves the field.
import { CyberkineticAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CyberkineticAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Turn a foe pure Electric when my contact attack hurts it",
  summary: () =>
    "After my damaging move touches a foe and hurts it, that foe becomes a pure Electric type until it leaves the field.",
  synonyms: [
    "cyberkinetic",
    "make the foe electric",
    "change the foe's type",
    "electrify the target",
    "type swap on touch",
    "breach",
    "pure electric",
  ],
  examples: ["When my contact move hurts the foe, the foe turns into a pure Electric type"],
  params: [],
  noParamsReason:
    "The effect is fixed: it puts one specific marker (Breached) on the foe I hit, and that marker's own code turns the foe pure Electric. The marker has no number, stat, type or status to tune here; the type is part of the marker.",
  conditions: [
    // Slot 0 of the constructor: the inherited attack condition (default: a damaging move). Staff may replace or drop it.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // The gate: my move makes contact with the foe. Staff may replace or drop it.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have dealt damage (more than 0)",
    "Nothing happens while the game only previews a hit",
  ],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the holder attacks with a contact move and with a non-contact move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, fully decomposed: trigger (after my attack lands), two IFs (the inherited damaging-move condition in slot ctor:0 bound to move.damaging, and the contact test in the gate bound to move.flag MAKES_CONTACT) and the effect (put a battle effect on the foe). Both are replaceable. The hit-dealt-damage clause stays in the class as a guard and is listed as feasibility until the librarian registers it (R-B16-4 in requests/B16.md); the effect block effect.apply-tag is planned, not implemented (R-B16-7, with a player-facing choice list for the marker). Same shape as ConfectiousAttackAbAttr with a different marker. User: Cyberkinetic (6040, attr 0). The marker changes the foe's types only by overwriting `summonData.types`; whether that survives a later type change (Soak, Burn Up) is the engine's own business. Oddity, not fixed: the marker is also put on a foe that is already pure Electric (harmless).",
});
