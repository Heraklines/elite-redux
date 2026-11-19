/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 4 / Tier C while-active flag, no setting, no closure (Sweet Dreams, Peaceful Slumber, Honk Shoo).
//
// Class (ab-attrs.ts:4361): `constructor() { super(false) }` and `apply(_params) {}` (an empty body). The attr is never dispatched; it
// is a PRESENCE marker. The only reader is the end-of-turn Bad Dreams class PostTurnHurtIfSleepingAbAttr (ab-attrs.ts:5683 in its
// canApply and 5697 in its apply loop): `!opp.hasAbilityWithAttr("BadDreamsImmunityAbAttr")` skips this Pokemon as a victim, so the clause
// order there is: asleep (or Comatose-like), no Magic Guard style block, THIS marker absent, not switching out. Magic Guard
// (BlockNonDirectDamageAbAttr) is a separate flag and also stops it; this marker stops ONLY Bad Dreams, so a sleeper with it still takes
// weather and status chip damage.
// Not a clause of the class itself: nothing to classify as condition, guard, RNG or effect. No RNG, no `simulated` read.
import { BadDreamsImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BadDreamsImmunityAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Be immune to Bad Dreams damage",
  summary: () =>
    "While I have this, a foe's Bad Dreams does not hurt me while I sleep. Weather and status damage still hurt a sleeper. Example: asleep next to a Bad Dreams foe, I lose no HP at end of turn.",
  synonyms: [
    "sweet dreams",
    "peaceful slumber",
    "honk shoo",
    "nightmare immunity",
    "no sleep damage",
    "sleep damage immune",
  ],
  examples: ["I take no Bad Dreams damage while asleep, like Sweet Dreams"],
  params: [],
  noParamsReason:
    "A pure presence flag: the game only checks that it exists when Bad Dreams picks its victims, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: ["Only stops the end-of-turn damage of Bad Dreams; other damage to a sleeper still happens"],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a sleeping holder next to a foe with Bad Dreams", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the shared twin only compares a whole generic battle that never puts the holder to sleep next to Bad Dreams. b04-chunk4.test.ts proves it with real battles: a sleeping holder next to a Bad Dreams foe, original ability against its rebuilt shadow, plus a control without the flag.",
  status: "decomposed",
  notes:
    "Flag, presence only (precedent IgnoreContactAbAttr). Extra IFs cannot be added (`if: false`) because nothing is evaluated. Users (live dump, 3 attrs): Sweet Dreams (id 5071, attr 1), Peaceful Slumber (5220, attr 1, built on Sweet Dreams), Honk Shoo (6057, attr 3). Read by PostTurnHurtIfSleepingAbAttr only. A staff recipe 'while asleep, take no damage from Bad Dreams' is exactly this block; the sleep condition lives in the reader, not here.",
});
