/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Deadeye Draw, part 1 of 3 (Tier B, package effect). "After my arrow or pulse move damages a foe, that foe is my mark."
//
// Source: abilities/newcomer-signature-mechanics.ts, DeadeyeMarkAbAttr (PostAttackAbAttr; no constructor of its own, so
// the base class's two arguments (attackCondition, showAbility) are its constructor).
//   canApply, in the ORIGINAL order, now guards && gate (all clauses pure, no RNG):
//     guards  1. super.canApply: the base attack condition, by default `move.category !== STATUS`
//                -> constructor slot "ctor:0" (library atom move.damaging)
//             2. params.damage > 0                                (no library atom yet: R-B13-3)
//     gate    3. move.hasFlag(ARROW_BASED) || move.hasFlag(PULSE_MOVE)
//                -> library atoms any( move.flag ARROW_BASED, move.flag PULSE_MOVE )
//   apply: DEADEYE_MARK.set(holder, foe I hit)   (one mark per holder: a new mark replaces the old one; ignores `simulated`)
//          then the message "<me>'s Deadeye Draw marked <foe>!"
// The mark is read by DeadeyeCritAbAttr (always crit, pulse moves) and by shouldDeadeyeUseLowerDefense (pokemon.ts, the
// weaker defence), and wiped by clearDeadeyeMarksFor when either Pokemon leaves the field (Pokemon.leaveField).
import { DeadeyeMarkAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DeadeyeMarkAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Mark the foe I hit with an arrow or pulse move",
  summary: () =>
    "When my arrow or pulse move damages a foe, that foe becomes my mark. Only one foe is marked at a time, and the mark ends when either of us leaves the field.",
  synonyms: [
    "mark target",
    "tag the foe",
    "lock on",
    "sniper mark",
    "deadeye draw",
    "pick a target",
    "focus on one foe",
  ],
  examples: ["After my aura sphere or arrow hits, remember that foe so my next moves can focus on it"],
  params: [],
  noParamsReason:
    "Marking has no number or choice: the foe is either my mark or not. The two move properties (arrow-based, pulse) are part of the editable gate, not settings of the effect.",
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clause 3: the move is arrow-based or a pulse move (library atoms, see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really deal damage (checked inside the class until the librarian adds that condition, R-B13-3)",
    "Only one foe can be marked at a time: a new mark replaces the old one",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [
    {
      // The grid cannot make an arrow or pulse move; it shows that an ordinary damaging hit never marks.
      name: "damaging hit and the foe's HP",
      axes: { foeMove: ["TACKLE"], foeHp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger (after my hit) and every condition are separate: the attack condition is a real constructor slot bound to move.damaging, the arrow-or-pulse rule is the gate (library atoms). Why the effect cannot be split with today's blocks: it stores a REFERENCE to the foe I hit in a private one-slot memory that three other places read by name (DeadeyeCritAbAttr, shouldDeadeyeUseLowerDefense in pokemon.ts, clearDeadeyeMarksFor in Pokemon.leaveField); the library has no 'mark a target' effect or 'the target is my mark' condition (requested as R-B13-34). It is a single assignment plus a message. 'damage > 0' stays inside the class (guard position, as in HeavyweightDrop) until R-B13-3 exists. Users: Deadeye Draw (5984, attr 0). ODDITIES (not fixed): (1) apply ignores `simulated` (no engine path simulates PostAttack today); (2) the ability text says 'cannon or arrow damage marks' but only pulse moves (cannon) benefit from the mark: DeadeyeCritAbAttr and the defence rule test PULSE_MOVE only, so an arrow-based hit marks a foe for nothing; (3) the mark is also replaced when a second foe is hit in a double battle, as the text says 'one foe at a time'.",
});
