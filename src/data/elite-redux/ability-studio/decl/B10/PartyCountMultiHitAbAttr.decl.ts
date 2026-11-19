/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / calc-modifier (Tier C).
//
// Read by hand from archetypes/party-count-multi-hit.ts. The class extends AddSecondStrikeAbAttr (WHEN "while the game decides
// how many times a move hits"), constructor `(maxHits = 6)` kept in the private field `maxHits`, no closure.
//     canApply: the PARENT's, unchanged: move.canBeMultiStrikeEnhanced(holder, true, target)   (eligible single-strike moves)
//     apply:    party = the holder's own side party; healthy = the OTHER members that are not fainted and have no status
//               (the holder itself is skipped on purpose, see the comment in the class); hitCount = min(hitCount + healthy, maxHits)
// No random draw, no state, nothing written outside the frame's hit count.
//
// Why Tier C: the number of extra hits is read from the whole party and the library has no effect "hit once more per healthy party
// member" (the planned effect.hit-n-times is a fixed count and is not implemented yet), request R-B10-22. The eligibility test is
// the parent's own rule and stays in the class. Extra IFs can still be ANDed on top.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PartyCountMultiHitAbAttr } from "#data/elite-redux/archetypes/party-count-multi-hit";

export default defineDecl(PartyCountMultiHitAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Hit once more for every healthy Pokemon in my party",
  summary: params =>
    `My moves that can strike several times get one extra hit per other healthy party member, up to ${params.maxHits} hits in total. Example: 5 healthy partners = 6 hits.`,
  synonyms: [
    "minion control",
    "extra hits per party member",
    "hit more with a bigger team",
    "multi hit by party size",
    "summon strikes",
    "swarm hits",
  ],
  examples: ["My attacks hit one more time for each healthy teammate, up to six hits, like Minion Control"],
  params: [
    {
      id: "maxHits",
      ctorIndex: 0,
      path: "maxHits",
      control: "number",
      min: 2,
      max: 10,
      step: 1,
      integer: true,
      label: "Most hits in total (6 = never more than six hits)",
      editable: true,
      default: 6,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves that can be turned into several strikes are changed (the same rule as other extra-strike abilities)",
    "A healthy Pokemon is another member of my party that has not fainted and has no status condition; I do not count myself",
    "The total is also capped by the number you set, so a move that already hits more times than that is cut down to it",
  ],
  effect: { id: "effect.package", params: ["maxHits"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "I use a damaging move with a full party", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C, justified (see the header). Only user: Minion Control (attr 0; attr 1 is the studio capability carrier). Nothing to bind. `simulated` is not read: the class only changes the frame's hit count and has no side effect, so a preview gives the same answer. The cap is applied even when no partner is healthy, so a move that already hits more than the cap times would be shortened (no live move does at the cap 6). The enemy side uses the enemy party, so a wild or trainer Pokemon with this ability counts its own team. Own test (the shared L1 grid and L2 twin cannot see it all): test/tests/elite-redux/decomp/B10/chunk2-effects.test.ts.",
});
