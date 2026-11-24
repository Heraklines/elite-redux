/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Tier B, library effect (effect.apply-tag). "After my attack lands, the target is Commanded: its next move is hijacked. By default only after a Psychic-type hit on a poisoned target."
//
// Source: src/data/elite-redux/abilities/puppet-strings.ts, class PuppetStringsAbAttr (extends PostAttackAbAttr; constructor passes the DEFAULT attackCondition (move.category !== STATUS)
// and showAbility false; it has no constructor argument). canApply, now guards && gate && residual. ORIGINAL clause order, then where each one went:
//   A. super.canApply: attackCondition(holder, target, move) = move.category !== STATUS             -> gate    CONDITION (a damaging move)
//   B. holder === target || target.isFainted() || damage <= 0                                        -> guards  GUARD (another, still standing Pokemon that really took damage)
//   C. holder.getMoveType(move) !== PokemonType.PSYCHIC                                              -> gate    CONDITION (a Psychic move, after type-changing effects)
//   D. target.status?.effect is not POISON and not TOXIC                                             -> gate    CONDITION (a poisoned or badly poisoned target)
//   E. target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")  (Shield Dust and friends)               -> guards  GUARD (protection from added effects)
//   F. target.summonData.erCommandedUsedThisSwitchIn || target.getTag(ER_COMMANDED)                  -> residual feasibility (once per switch-in, and not while already Commanded)
// Clauses B and E were moved in front of A (guards run first). All six clauses are pure reads (no draw, no side effect; getMoveType is a simulated call), so the answer is the same for every input;
// the chunk test replays the original clause order against the new split over every combination.
// apply (effect), not when simulated: target.addTag(ER_COMMANDED, 0, MoveId.NONE, holder.id). The tag ignores the turn count and source move; its own onAdd sets the once-per-switch-in flag and shows the message.
// The Commanded effect itself (battler-tags.ts ErCommandedTag): at the target's next move, a status move fails; a damaging move goes to a random living ally of the target (one seeded draw in doubles) or, in singles,
// is cancelled and the target takes 40% of that move's own damage. It runs out at the end of the following turn.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); guards, gate and residual are the clauses above. `gateOverride` is declared for the compiler.
import { PuppetStringsAbAttr } from "#data/elite-redux/abilities/puppet-strings";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PuppetStringsAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Take over the target's next move",
  summary: () =>
    "After my attack lands, the target is taken over: its next move fails, goes to its ally, or hurts itself. Once per switch-in. By default only after a Psychic hit on a poisoned target.",
  synonyms: [
    "puppet strings",
    "mind control",
    "control the foe",
    "hijack the next move",
    "make the foe hit its ally",
    "make the foe hurt itself",
    "command the target",
  ],
  examples: [
    "After a Psychic move hits a poisoned foe, its next move is taken over, like Puppet Strings",
    "A hit on a statused foe turns its next attack on its own ally",
  ],
  params: [],
  noParamsReason:
    "The effect applies one fixed battle effect (Commanded) to the other Pokemon; the target and the battle effect are fixed by this class and the Commanded effect uses its own length and damage share. The move type and the status are conditions in the gate.",
  conditions: [
    // The gate is the three design conditions: a damaging move, a Psychic move, a poisoned or badly poisoned target.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The target must be another Pokemon that is still standing and that the move really damaged",
    "A target whose ability stops added effects (Shield Dust and friends) is left alone",
    "A target that is already Commanded, or was Commanded since it came in, is left alone (once per switch-in)",
    "It does nothing in a preview",
  ],
  // effect.apply-tag with target = the other Pokemon and tag = ER_COMMANDED (both fixed by this class, so no param is exposed).
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // The holder attacks with Normal moves in the harness, so the Psychic clause stays false: the true branch is driven in the chunk test.
      name: "an attack that is not a Psychic move",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B with the library effect effect.apply-tag (target = the other Pokemon, tag = ER_COMMANDED), NOT a package; the trigger and the three design conditions are separate blocks. 1 attr in 1 ability: Puppet Strings (5901 attr 0). The effect is exactly target.addTag(ER_COMMANDED, 0, MoveId.NONE, holder.id), which is effect.apply-tag (same state as effect.arena-tag: in the registry, implemented false); the Commanded tag has its own hook (fail, redirect to an ally with a seeded draw, or self-damage of 40%). R-B15-31 stays open: implement effect.apply-tag for the Commanded tag and add the 'not Commanded since it came in' memory atom. The effect has no exposed number or choice (see noParamsReason). The safety rules (the target is another, standing, damaged Pokemon; Shield Dust protection) are kept in the class as guards; the guard registry has no ids for them, so they are listed as feasibility and requested as R-B15-30. The gate is bound to the library atoms move.damaging, move.type PSYCHIC (effective: moveUser.getMoveType(move), the same call) and status.has POISON or TOXIC on the other Pokemon (target.status?.effect). Suspected oddities, NOT fixed: (1) the class comment says 'subject to the once-per-switch-in rule' but the flag is only set by the tag's onAdd, so a target that was Commanded and then switched out and back in can be Commanded again, which matches the text; (2) Shield Dust is tested with hasAbilityWithAttr (the IgnoreMoveEffects attr), so ANY ability with that attr protects, not only Shield Dust itself; (3) the tag expires at the end of the FOLLOWING turn, so a target that is Commanded late in a turn may be hijacked on the next one only, as documented; (4) in singles a damaging move is cancelled and the target takes 40% of its own damage: that happens inside the tag, not here.",
});
