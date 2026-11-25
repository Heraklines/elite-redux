/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Power of Alchemy. Read by hand: init-elite-redux-vanilla-rebalance.ts `ErTransmuteOpposingBerriesAbAttr` (the one
// user pushes it onto the vanilla ability: `ab.attrs.push(new ErTransmuteOpposingBerriesAbAttr())`), its base PostSummonAbAttr
// (ab-attrs.ts, constructor (showAbility = true, activateOnGain = true); this class passes super(true)) and the dispatch of
// `PostSummonAbAttr` (entering the battle and gaining the ability mid-turn).
//
// canApply: `pokemon.getOpponents().length > 0` (feasibility, a foe exists). No guards, no condition, no residual; the class
// has no closure and no gate, so no Tier B split is needed.
// apply, unless simulated: for every ADJACENT foe that is not fainted: collect its BerryModifiers
// (`globalScene.findModifiers(BerryModifier && pokemonId === opp.id, opp.isPlayer())`); none: next foe; otherwise drain every
// berry stack with `opp.loseHeldItem(berry)` (at most 99 times per berry), refresh the modifier bar, and queue the message
// "erTransmutedBerries" for that foe. No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ErTransmuteOpposingBerriesAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";

export default defineDecl(ErTransmuteOpposingBerriesAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Destroy every berry the foes hold when I enter",
  summary: () =>
    "When I enter the battle, each adjacent foe loses every berry it holds, all copies of each. A message names each foe that lost berries.",
  synonyms: [
    "power of alchemy",
    "remove foe berries",
    "berry removal",
    "destroy berries",
    "transmute berries",
    "no berries for the enemy",
  ],
  examples: ["Remove all the berries the opposing Pokemon hold as I enter"],
  params: [],
  noParamsReason:
    "The rule has no number, type, stat or status to set: it always removes every berry (all copies) of every adjacent foe; which items count (berries only) and who is affected (adjacent foes) are fixed.",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must be on the field",
    "Only foes next to me are affected in a double or triple battle, and fainted foes are skipped",
    "It never removes anything for a preview (a simulated entry)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Entry against the grid's foe; the berry-holding foe is driven in alchemy-pressure.test.ts because the grid foe holds
      // no items.
      name: "enter against a foe",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, PACKAGE with a written reason: the library's effect.remove-item takes only a 'who' and removes an unspecified item; this rule removes ONLY berries, ALL stacked copies, from EVERY adjacent foe, refreshes the modifier bar and shows a message per foe. There is no item-kind filter, no 'every stack' mode and no 'all adjacent foes' scope in the library, so the effect would have to be re-implemented; request R20 asks for effect.remove-item to grow those three options (kind: berries, all copies, who: adjacent foes). No typed param exists: nothing numeric or typed is used (the 99 in the code is a safety cap on the drain loop, not a setting). The trigger (on entry) is a separate block and extra IFs can be ANDed on top. Users: Power of Alchemy (223, attr 0) only. Oddity, not a bug: the Elite Redux text says berries are replaced by Black Sludge and later Big Nugget; this game has neither item, so the berries are only destroyed (documented in the class comment). Another oddity: canApply counts all foes while apply only reaches adjacent ones, so with no adjacent foe the ability flyout shows and nothing happens. No game bug found.",
});
