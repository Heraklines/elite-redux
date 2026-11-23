/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Skyhook (Tier B, package effect). "After I damage a foe I pivot out, once per turn, and my replacement may enter faster."
//
// Source: abilities/newcomer-signature-mechanics.ts, SkyhookAbAttr (PostAttackAbAttr; the base class's two arguments
// (attackCondition, showAbility) are constructor arguments 0 and 1, the Speed chance is now argument 2).
//   canApply, ORIGINAL order, now guards && gate && residual (all clauses pure, no RNG):
//     guards    1. super.canApply: the base attack condition, by default `move.category !== STATUS` -> constructor slot "ctor:0"
//               2. params.damage > 0                                    (R-B13-3)
//               3. holder.turnData.hitsLeft <= 1                         (the final hit of a multi-hit move, R-B13-42)
//     gate      4. SKYHOOK_TURN[holder] !== "wave:turn"                  (I did not pivot out yet this turn, R-B13-17)
//     residual  5. every opponent allows my switch: SKYHOOK_SWITCH.getSwitchOutCondition(holder, opponent)  (feasibility)
//   apply: SKYHOOK_TURN[holder] = "wave:turn"                           (even when simulated)
//          simulated: stop
//          SKYHOOK_BOOST_SIDE[my side] = holder.randBattleSeedInt(100) < speedBoostChancePercent   (the ONE random draw)
//          message "<me>'s Skyhook pulled it back!", then holder switches out (ForceSwitchOutHelper SWITCH)
//   The boost itself is given later by applyPendingSkyhookEntryBoost (called by name from phases/switch-summon-phase.ts:464):
//   the next Pokemon that enters on my side gets +1 Speed if the stored flag is true (the flag is consumed once).
import { SkyhookAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SkyhookAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Switch out after a hit and maybe speed up my replacement",
  summary: params =>
    `After my damaging move hurts the target I switch out, once per turn (on the last hit of a multi-hit move). My replacement has a ${params.speedBoostChancePercent}% chance to enter with +1 Speed.`,
  synonyms: [
    "hit and run",
    "pivot out",
    "u-turn style",
    "switch after attacking",
    "free switch",
    "baton pass speed",
    "skyhook",
  ],
  examples: ["After my attack lands I switch out, and my replacement may come in with a Speed boost"],
  params: [
    // Constructor arguments 0 (attack condition) and 1 (show ability) are the base class's: 0 is the ctor:0 condition
    // slot below, 1 stays undefined for every user (base default).
    {
      id: "speedBoostChancePercent",
      ctorIndex: 2,
      path: "speedBoostChancePercent",
      control: "number",
      label: "Chance my replacement enters with +1 Speed (%)",
      editable: true,
      gateIndependent: true,
      default: 20,
      min: 0,
      max: 100,
      step: 5,
      integer: true,
    },
  ],
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clause 4: I have not pivoted out yet this turn (a legacy-closure binding, see bindings.ts and R-B13-17).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really deal damage and must be the final hit of a multi-hit move (checked inside the class until the librarian adds those conditions, R-B13-3 and R-B13-42)",
    "A switch must be possible against every opponent: nothing traps me or blocks the switch (checked inside the class)",
    "The Speed boost is given when the next Pokemon enters on my side, once; it is spent even if nobody enters before the battle ends (fixed in the class)",
  ],
  effect: { id: "effect.package", params: ["speedBoostChancePercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: one 1-in-100 roll for the replacement's Speed boost, before the message and the switch (never when simulated)",
    ],
    state: "battle",
    simulated: "respects",
  },
  probes: [
    {
      // The switch needs a ready teammate and the memory starts empty, so the grid shows the gate open and the class's residual deciding.
      name: "damaging hit and the foe's HP",
      axes: { foeMove: ["TACKLE"], foeHp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger (after my hit) is a normal WHEN; the attack condition (ctor:0, move.damaging) is a library atom; the 'not yet this turn' memory is the editable gate (a legacy-closure binding until R-B13-17 `time.not-yet-this-turn` exists, the library's own once-per-turn atom keeps ITS OWN memory so it would drop the class's write). Why the effect cannot be split: it is 'switch out' (effect.force-switch-out) PLUS a per-side stored flag that a different engine call site (applyPendingSkyhookEntryBoost, switch-summon-phase.ts:464) turns into +1 Speed on the next Pokemon to enter; no library block holds a flag for 'the next Pokemon that enters my side' (requested as R-B13-45 `effect.boost-next-entrant`). The 20 in `randBattleSeedInt(100) < 20` was a literal, now constructor argument 2 (default 20, the very same draw and comparison); the +1 Speed lives in applyPendingSkyhookEntryBoost, which has no access to this attr, so it stays fixed. Users: Skyhook (5978, attr 0). ODDITIES (not fixed): (1) apply writes the once-per-turn memory BEFORE its simulated check, so a simulated call spends it; (2) the boost flag is stored per SIDE and per battle, so a second Skyhook activation on the same side before anyone enters overwrites the first roll, and a flag left over when the switch did not happen (the switch can still fail after canApply) boosts the next entrant of that side; (3) when the switch cannot complete the memory and the flag are already written.",
});
