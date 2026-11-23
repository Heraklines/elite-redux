/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Tier C, engine-query. "When a foe loses HP to Leech Seed, EVERY active Pokemon on my side heals the same amount, not just the seeder."
//
// Source: src/data/elite-redux/abilities/common-root.ts, class CommonRootAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty,
// there is no canApply of its own). It is a pure presence marker. The effect lives in SeedTag.lapse (src/data/battler-tags.ts, the block after the seeder's own heal):
//   1. skipped when Liquid Ooze reversed the drain into damage (reverseDrain)
//   2. allies = source.getAllies().filter(isActive(true)); sideHasCommonRoot = the seeder or one of those allies has an active CommonRootAbAttr (found by constructor name)
//   3. for every active ally that is not at full HP: unshift PokemonHealPhase(ally, the same drained amount, "seededLapse" message)
// Nothing is dispatched, so the L2 harness treats the declaration as presence-only (the whole battle is compared). No random draw, no state of its own.
import { CommonRootAbAttr } from "#data/elite-redux/abilities/common-root";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CommonRootAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Share Leech Seed healing with all my allies",
  summary: () =>
    "While I have this, when a foe loses HP to Leech Seed, every active Pokemon on the seeder's side heals the same amount the seeder heals, not just the seeder.",
  synonyms: [
    "common root",
    "leech seed",
    "share leech seed healing",
    "heal the whole team",
    "seed drain heals allies",
    "drain share",
  ],
  examples: ["When my ally's Leech Seed drains a foe, my whole side heals the same amount"],
  params: [],
  noParamsReason:
    "A presence marker read by the Leech Seed tag; there is nothing to configure. The healed amount is always the full drained amount that the seeder gets.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only Pokemon on the field heal, and one at full HP is skipped",
    "Nothing is shared when the drain was turned into damage (Liquid Ooze)",
    "Only the side of the Pokemon that planted the seed shares it, and one holder on that side is enough",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The marker is consulted by the Leech Seed tag when it drains, which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "a seeded foe loses HP at the end of the turn", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query (presence flag read by SeedTag.lapse by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Common Root (5904 attr 0). The declaration uses WHEN while.active, which needs CommonRootAbAttr in that WHEN's flagKeys: until the librarian adds it (request R-B15-1) the L0 lint reports it, exactly like Rapier and Chivalry of chunk 1. The 'when a foe loses HP to Leech Seed' moment and the 'heal every ally by the drained amount' effect are requested as library blocks (R-B15-11). Suspected oddity, NOT fixed: the sideHasCommonRoot test also counts a holder that is NOT the seeder (an ally), so Common Root on a partner shares the seeder's drain too; that matches the ability text ('every active Pokemon on the holder's side'), but the holder does not have to be the one who planted the seed.",
});
