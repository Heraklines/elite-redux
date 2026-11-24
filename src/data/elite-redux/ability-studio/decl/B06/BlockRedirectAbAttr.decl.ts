/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 4, Tier C while-active flag. See ../PRECEDENTS.md and the precedent IgnoreContactAbAttr.
//
// "While I have this, nothing can pull my moves away from the target I picked." The class is an empty marker. Nothing is dispatched: after
// the redirection checks, MovePhase (move-phase.ts) asks `this.pokemon.hasAbilityWithAttr("BlockRedirectAbAttr")` and, when the
// target changed, puts the original target back, then queues the ability pop-up for the holder's ability or passive (shown as the
// passive when the passive carries the class). Move-redirect abilities and Follow Me style tags are both undone by it, because the test
// runs after both and after the BypassRedirectAttr move attrs.
import { BlockRedirectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BlockRedirectAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My moves cannot be pulled to another target",
  summary: () =>
    "While I have this, other Pokemon cannot redirect my moves away from the target I picked. Example: Stalwart ignores Lightning Rod and Follow Me.",
  synonyms: [
    "stalwart",
    "propeller tail",
    "ignore redirection",
    "cannot be redirected",
    "ignore follow me",
    "ignore lightning rod",
    "keep my target",
  ],
  examples: ["My moves hit the target I chose even against Follow Me or Lightning Rod"],
  params: [],
  noParamsReason:
    "A pure presence flag: the move phase only checks that the attr exists (hasAbilityWithAttr), so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a move against a redirecting foe", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Presence flag (same shape as IgnoreContactAbAttr). The engine read in MovePhase is by class name, so the three users need no binding. Users (3 attrs): Propeller Tail (239, attr 0, with a Speed multiplier), Stalwart (242, attr 0, with BlockCritAbAttr), Old Ocean Relic (20009, attr 2). Oddity, not fixed: the pop-up is queued whenever the target changed, even when the holder's ability is not the one that did the redirecting, and it picks the passive icon when the passive carries the class.",
});
