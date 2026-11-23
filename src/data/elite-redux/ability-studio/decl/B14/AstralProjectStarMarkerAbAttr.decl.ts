/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. A presence marker (engine-query), like the FloatAbAttr precedent.
//
// The class does nothing when it is dispatched (its `apply` is empty and `canApply` is the inherited `true`). Its whole
// meaning is that other code asks "does this Pokemon have the marker?": `isStarMove` in fakemon-pitch-mechanics.ts
// reads `user.getAllActiveAbilityAttrs().some(attr => attr instanceof AstralProjectStarMarkerAbAttr)` inside the
// `canApply` of the two Star-move attrs of Starcrossed (the double hit and its 0.7 power). So the declaration is an
// engine-query: counted apart by the coverage report, the reader is not touched here.
//
// WHEN: the class extends PostSummonAbAttr, and `while.active` only lists its flag classes by name (a library file this
// batch may not edit), so the only trigger that passes the L0 ancestor check is `event.on-entry`. The honest trigger
// is "while I have it"; the request in requests/B14.md asks for it to be added to the while.active flag list.
import { AstralProjectStarMarkerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AstralProjectStarMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "event.on-entry",
  label: "Count all my moves as Starcrossed moves",
  summary: () =>
    "While I have this, every move I use counts as a Starcrossed move, so the Starcrossed ability makes it hit twice at reduced power. Example: all my moves hit twice.",
  synonyms: ["star move", "lunar move", "moon move", "every move counts as", "all moves are", "astral", "starcrossed"],
  examples: ["All my moves count as Starcrossed moves, so my Starcrossed double hit always works"],
  params: [],
  noParamsReason:
    "A presence marker: the Star-move abilities only check that it exists, and nothing about it can be tuned (every move counts, there is no number).",
  conditions: [],
  guards: [],
  feasibility: [
    "It changes nothing on its own: an ability that reacts to Starcrossed moves (the Starcrossed double hit) must also be present",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "enter the field", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query marker. Users (1): Astral Project (6018) attr 0; its attr 1 is a ReceivedMoveDamageMultiplierAbAttr (Psychic and Dark halved) that belongs to B01-B07. Read by isStarMove() inside StarHitMultiplierAbAttr and StarHitPowerAbAttr (Starcrossed, 6017), which check `move.hasFlag(LUNAR_MOVE) || user has this marker`; Starcrossed does not carry the marker itself, so it only sees it when Astral Project is on the same Pokemon (innate slot). The dispatch at entry is a no-op: nothing is evaluated that could differ. TRIGGER REQUEST: the honest WHEN is while.active; see requests/B14.md.",
});
