/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-3.1, same
// shape as R-B14-2.3 and R-B12-13); then rename this file to RagingFistAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "Rage Fist counts every hit I took twice."
//
// Source: bernerd-roster-mechanics.ts `export class RagingFistAbAttr extends AbAttr {}`: an empty class, a presence marker. Nothing
// dispatches it. The only reader is RageFistPowerAttr.apply (src/data/moves/move.ts:6129, by class NAME):
//   hitCount = user.battleData.hitCount * (marker ? 2 : 1);   power = 50 * (1 + min(hitCount, 6))
// so without the marker the power tops out at 350 after 6 hits taken, and with it after 3 hits (the counter is doubled BEFORE the
// cap of 6). The factor 2 is a literal in the move, not in the class, so there is no class param (requested R-B14-3.7).
// No constructor, no closure, no random draw, no state. The check is by class name: it must never be renamed.
import { RagingFistAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(RagingFistAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Count every hit I took twice for Rage Fist",
  summary: () =>
    "While I have this, Rage Fist grows twice as fast: each hit I took counts as two, up to 6 counts. Example: 3 hits taken give 50 x (1 + 6) = 350 power.",
  synonyms: [
    "rage fist",
    "double hit count",
    "hits taken count double",
    "angry punch",
    "anger power",
    "grow stronger when hit",
    "raging fist",
  ],
  examples: ["Rage Fist reaches full power after only three hits"],
  params: [],
  noParamsReason:
    "A presence marker read by the Rage Fist power calculation; the factor two and the cap of six hits are numbers inside that move code, so nothing in the class can be tuned; they are requested as editable values.",
  conditions: [],
  guards: [],
  feasibility: [
    "It only changes the power of Rage Fist; every other move ignores it",
    "Hits on a substitute and confusion damage do not count, as for any Rage Fist user",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder takes a hit and attacks, and the battles must match. The doubling is driven by B14/chunk3.test.ts.",
  probes: [{ name: "the holder takes a hit", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Raging Fist (6116) attr 0 (its only attr). The reader is Rage Fist's own variable-power attr, not the class. Oddity, not fixed: the ability is spelt Raging Fist and the move Rage Fist; harmless.",
});
