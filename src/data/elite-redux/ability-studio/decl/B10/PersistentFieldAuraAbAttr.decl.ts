/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / calc-modifier (Tier C, read by name).
//
// Read by hand from archetypes/persistent-field-aura.ts, pokemon.ts getStat (line ~2206) and the 3 live users. The class extends
// only AbAttr and is NOT dispatched through applyAbAttrs: Pokemon.getStat calls the static
// PersistentFieldAuraAbAttr.applyAuras(subject, stat, value), which walks every living Pokemon on the field (the "holders"), walks
// each holder's active attrs and keeps those whose `constructor.name` is "PersistentFieldAuraAbAttr". For each aura attr:
//     the stat is not in `stats`                                       -> skip
//     subject and holder are on different sides                        -> skip
//     subject === holder and not includeSelf                           -> skip
//     !predicate(subject, holder)                                      -> skip
//     else value *= multiplier   (every matching aura multiplies, so two holders compound)
// The new WHEN `calc.ally-stat-aura` carries the class name as dispatch key and provides the holder (the aura owner), the other
// Pokemon (the one whose stat is read) and the stat. The engine scan does NOT look at attr-level conditions, so extra IFs cannot
// be ANDed on top (reusableAlone.if is false). No random draw, no state.
//
// Constructor `{ stats, multiplier, predicate?, includeSelf? }` kept in the public fields of the same names (the predicate is a
// FUNCTION (ally, holder) => boolean; the default accepts everyone). Users:
//   Fire Aspect  stats [Speed], x2, everyone on my side, not me
//   Polarity     the five stats, x1.3, everyone on my side including me
//   Rat King     the five stats, x1.5, only allies with a base stat total below 400, not me
//
// Why Tier C: no library WHEN shape fits (it is a stat calculation of ANOTHER Pokemon), and the filter is a function inside an
// options object, which a constructor slot cannot hold. The filter is therefore the param `allies`, a sentence with the two shapes
// the game uses (see b10-codecs.ts); requests R-B10-25 (condition 'the other Pokemon's base stat total is below N') and R-B10-26
// (harness: a condition slot that lives under an options key) would turn it into a real IF.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PersistentFieldAuraAbAttr } from "#data/elite-redux/archetypes/persistent-field-aura";
import { AURA_ALL_ALLIES, auraAlliesCodec, auraStatsCodec } from "./b10-codecs";

export default defineDecl(PersistentFieldAuraAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.ally-stat-aura",
  label: "Boost the stats of my side the whole time I am on the field",
  summary: params =>
    `While I am on the field, the stats you pick (${params.stats}) of Pokemon on my side are multiplied by ${params.multiplier}: ${String(params.allies).toLowerCase()}. Example: 1.5 = 50% more.`,
  synonyms: [
    "team aura",
    "ally stat boost",
    "party stat aura",
    "boost my teammates",
    "field aura",
    "rat king",
    "polarity",
    "fire aspect",
  ],
  examples: [
    "Double the Speed of my allies while I am on the field, like Fire Aspect",
    "Raise all stats of allies with a base stat total below 400 by 50%, like Rat King",
  ],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: "Stats that are boosted (write them separated by commas: Attack, Sp. Atk, Speed)",
      editable: true,
      default: "Attack, Defense, Sp. Atk, Sp. Def, Speed",
      codec: auraStatsCodec,
    },
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Stat multiplier (1.5 = 50% more, 2 = double)",
      editable: true,
      default: 1.5,
    },
    {
      id: "includeSelf",
      ctorIndex: 0,
      ctorOption: "includeSelf",
      path: "includeSelf",
      control: "boolean",
      label: "Also boost myself",
      editable: true,
      default: false,
    },
    {
      id: "allies",
      ctorIndex: 0,
      ctorOption: "predicate",
      path: "predicate",
      control: "text",
      label: "Which Pokemon on my side get the boost (write like the example)",
      editable: true,
      default: AURA_ALL_ALLIES,
      codec: auraAlliesCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only Pokemon on the same side as me are boosted, and only while I am still on the field",
    "Every aura on the field multiplies, so two Pokemon with an aura boost the same ally twice",
    "Everything is worked out each time a stat is read, so allies that come in later are boosted too",
  ],
  effect: { id: "effect.package", params: ["stats", "multiplier", "includeSelf", "allies"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a stat is read on the holder and on its ally", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan inside Pokemon.getStat, not dispatched through applyAbAttrs, so the L2 trace cannot show the original evaluated. The B10 test (test/tests/elite-redux/decomp/B10/chunk2-aura.test.ts) calls the real engine function applyAuras for the original and the rebuild of each live user over a holder, an ally and a foe of different base stat totals.",
  status: "decomposed",
  notes:
    "Tier C, justified (see the header). Users: Fire Aspect (attr 5), Polarity, Rat King (attr 0). Nothing to bind: there is no constructor closure slot, the predicate is carried by the `allies` param (a codec that builds the closure for 'everyone' and 'base stat total below N' and reads a live closure back by asking it about stand-in allies). A predicate that is neither shape cannot be read back and its param stays out of the rebuild (none exists today). Oddities, NOT fixed: the scan ignores attr-level conditions; every call of getStat walks the whole field; Polarity's description says 'highest stat' but the class boosts all five stats (the dispatcher comment says so too); the aura holder must be alive and on the field, so a benched holder gives nothing.",
});
