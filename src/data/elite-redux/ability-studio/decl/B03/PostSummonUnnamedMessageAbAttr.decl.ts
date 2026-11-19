/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, event-effect on entry, no condition slot.
//
//   canApply   none of its own (PostSummonAbAttr answers true)
//   apply      unless simulated: queue the fixed text `message`, exactly as written (no Pokemon name is added)
//
// One constructor argument, a plain string, so it is a free-text param. Air Lock's text is "The effects of the weather
// disappeared." (plain English, not translated; the class's own TODO wants it merged with the translated variant).
//
// Ability 20006 (Malicious Empathy, a saved studio ability) has an attr of this class at attr 8 that is NOT a plain use:
// it is a studio CARRIER, a clone of Air Lock's attr whose `apply`, `canApply`, `getCondition` and `getTriggerMessage` are
// assigned on the instance and run a composed rule (conditions, a chance, a list of effects), not this class's message.
// The L1 fingerprint walks prototypes only, so it cannot see those instance-level methods and reports a plain rebuild as
// "identical", which would silently drop the composed rule. The carrier is therefore left out of the user count and
// every claim below; the gap is reported in the notes and in the open issues of the batch report.
import { PostSummonUnnamedMessageAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonUnnamedMessageAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Show a fixed text message when I enter",
  summary: params =>
    `When I enter the battle, show the text "${params.message}" exactly as written. Example: Air Lock shows "The effects of the weather disappeared."`,
  synonyms: [
    "entry message",
    "announce on entry",
    "show text on entry",
    "air lock message",
    "custom entry text",
    "flavour text",
  ],
  examples: ['Show "The effects of the weather disappeared." when I enter'],
  params: [
    {
      id: "message",
      ctorIndex: 0,
      path: "message",
      control: "text",
      label: "Text to show (shown exactly as written, in English only)",
      editable: true,
      default: "The effects of the weather disappeared.",
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["It does nothing in a preview"],
  effect: { id: "effect.message", params: ["message"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, ONE real user: Air Lock (76 attr 1: 'The effects of the weather disappeared.'). The second site, Malicious Empathy (20006 attr 8), is a studio carrier with instance-level apply, canApply, getCondition and getTriggerMessage (a composed rule, see the top comment); it is NOT a use of this class and a plain rebuild would drop its rule, although the L1 fingerprint (prototype owners only) calls it identical. Reported to the harness owners as an open issue. The text is plain English, not translated (the class's own TODO wants it merged with the translated variant); that is why the label says English only. The free-text param is limited to 120 characters by the shared param validator. The effect block `effect.message` matches this class one to one.",
});
