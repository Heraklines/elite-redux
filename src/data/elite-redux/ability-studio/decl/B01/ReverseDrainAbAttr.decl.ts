/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier C package (core effect only). The trigger is the shared "After I am hit" WHEN.
//
// "After I am hit by a draining move, the attacker is hurt by the amount it would have healed." The class has no
// constructor argument, no closure and no gate that staff could change:
//   canApply  1. dispatch BlockNonDirectDamageAbAttr on the ATTACKER (Magic Guard) with the same `simulated` flag
//                = feasibility (the attacker must be able to take indirect damage); the dispatch is a side effect
//                (it can show the attacker's ability flyout), so it runs first, exactly as before
//             2. `move.hasAttr("HitHealAttr")` = feasibility (`apply` reads that attribute: without a drain effect there
//                is no amount to turn around, and the line would crash). It is NOT a design condition staff could drop.
//   apply     (skipped when `simulated`) the amount is `HitHealAttr.getHealAmount(attacker, holder)`;
//             `holder.turnData.damageTaken += amount` (the engine bookkeeping that Wimp Out style rules read), then a
//             PokemonHealPhase on the attacker with `-amount` (a negative heal = damage), with the ability message.
// No class edit was needed: there is nothing to extract, so nothing is bound.
//
// Why it is a package (justified): the amount comes out of the drain move's OWN effect object, and the same instance
// must (a) add it to the holder's damage ledger and (b) queue the negative heal; the engine also asks
// `target.hasAbilityWithAttr("ReverseDrainAbAttr")` in HitHealAttr.apply (move.ts), in Leech Seed (battler-tags.ts) and in the
// lifesteal archetype to cancel the heal in the first place, so the ability is more than this one effect. No library
// effect hurts a foe by an amount taken from another effect (effect.drain heals, effect.recoil hurts me), so it cannot be
// split further without inventing one (request R-B01-20).
import { ReverseDrainAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ReverseDrainAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.after-hit",
  label: "Hurt the attacker instead of healing it from a drain move",
  summary: () =>
    "A draining move does not heal the attacker. The attacker takes the amount it would have healed as damage instead. Example: a move that would heal 30 HP takes 30 HP away, like Liquid Ooze.",
  synonyms: [
    "liquid ooze",
    "reverse drain",
    "punish draining moves",
    "poison the drain",
    "damage instead of healing",
    "drain backfire",
  ],
  examples: ["Draining moves hurt the attacker instead of healing it, like Liquid Ooze"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the amount is whatever the draining move would have healed, so there is no number, type or stat to set.",
  conditions: [],
  guards: [],
  feasibility: [
    "The move must be a draining move (it has a heal-the-user-by-the-damage effect)",
    "The attacker must be able to take indirect damage (Magic Guard stops it)",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a draining move and a plain move",
      axes: { foeMove: ["ABSORB", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package, justified in the header. Users (1 attr): Liquid Ooze (64 attr 0). The class dispatches BlockNonDirectDamageAbAttr on the attacker BEFORE it looks at the move, even for moves with no drain effect (the dispatch can show the attacker's ability flyout, kept as it was). `simulated` is passed through to that dispatch and apply returns early when simulated. Engine identity checks by attr name (HitHealAttr.apply in move.ts, Leech Seed in battler-tags.ts, the lifesteal archetype, common-root) keep working because the rebuilt instance is the same class. Honest bucket: package-only for the effect; the trigger is the shared 'After I am hit' block and extra IFs can be ANDed on top.",
});
