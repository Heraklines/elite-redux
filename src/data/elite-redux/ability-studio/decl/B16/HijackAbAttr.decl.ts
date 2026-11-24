/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier B, event-effect). "When my Electric move hurts a paralyzed foe, I take command of the foe's next action."
//
// Source: fakemon-pitch-mechanics.ts, HijackAbAttr (extends PostAttackAbAttr; no constructor of its own, so the parent's
// `(attackCondition, showAbility)` is the constructor). canApply, original clause order, now `guards && gate && residual`:
//   guards    1. super.canApply: the inherited attack condition = constructor argument 0; the default (and the only value the one user
//                passes) is `move.category !== STATUS` -> replaceable library condition (slot ctor:0, bound to move.damaging); it sits
//                in `guards()` only to keep the clause order
//             2. damage > 0                                              the hit really dealt damage
//   gate      3. holder.getMoveType(move) === ELECTRIC                   my move is Electric AFTER ability type changes -> move.type (effective)
//             4. foe.status?.effect === PARALYSIS                        the foe is paralyzed                              -> status.has
//   residual  5. !foe.summonData.erCommandedUsedThisSwitchIn             the foe was not commanded since it came in        (feasibility)
//             6. !foe.getTag(ER_COMMANDED)                               the foe is not commanded right now                (feasibility)
// No random draw. apply: !simulated: foe.addTag(ER_COMMANDED, 0, MoveId.NONE, holder.id). ErCommandedTag lasts to the end of the foe's
// next turn: when the foe is about to move, its action is hijacked; its onAdd sets the once-per-switch-in flag of clause 5.
import { HijackAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(HijackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Take command of a paralyzed foe's next action",
  summary: () =>
    "After my Electric move hurts a paralyzed foe, I take command of the foe's next action. Works once per time the foe comes in.",
  synonyms: [
    "hijack",
    "control the foe",
    "mind control",
    "puppet the foe",
    "force the foe's move",
    "steal the foe's turn",
    "remote control",
  ],
  examples: ["When my Electric move hurts a paralyzed foe, I take control of its next move"],
  params: [],
  noParamsReason:
    "The effect is fixed: it puts one specific marker (Commanded) on the foe I hit, and that marker's own code takes over the foe's next action. The marker has no number, stat, type or status to tune; the Electric type and the paralysis are conditions (the two replaceable IF blocks), not settings of the effect.",
  conditions: [
    // Slot 0 of the constructor: the inherited attack condition (default: a damaging move). Staff may replace or drop it.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // The gate: my move is Electric type AND the foe is paralyzed. Staff may replace or drop it.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have dealt damage (more than 0)",
    "The foe must not have been commanded already since it came in (once per switch-in)",
    "The foe must not be commanded right now",
    "Nothing happens while the game only previews a hit",
  ],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the holder attacks with an Electric move and with a non-Electric move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, fully decomposed: trigger (after my attack lands), three IFs (the inherited damaging-move condition in slot ctor:0 bound to move.damaging; in the gate, 'my move is Electric type' bound to move.type ELECTRIC with the type after ability changes, and 'the foe is paralyzed' bound to status.has on the other Pokemon) and one effect (put a battle effect on the foe). The hit-dealt-damage clause stays in `guards` and is listed as feasibility until the librarian registers it (R-B16-4); the effect block effect.apply-tag is planned, not implemented (R-B16-7, with a player-facing choice list for the marker). The two foe memory tests are `residual` (feasibility): the once-per-switch-in flag has no atom, and 'not commanded right now' would be tag.has but belongs with the flag. Order check: the gate is read before the residual, as in the original, and nothing in clauses 1 to 6 draws a random number or has a side effect, so the order only matters for the pop-up. Same shape as ConfectiousAttackAbAttr and CyberkineticAbAttr. User: Hijack (6038, attr 0). The same marker is also used by Puppet Strings (another class, puppet-strings.ts), which shares the once-per-switch-in flag with this class. Oddity, not fixed: clause 3 asks for the move's type after abilities, so a Normal move turned Electric by an ability counts.",
});
