/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier (a cancel check), Tier C (nothing to configure). See ../PRECEDENTS.md.
//
// The class body is empty: it inherits `CancelInteractionAbAttr`: canApply `!cancelled.value`, apply `cancelled.value = true`.
// The ENGINE asks "does indirect damage hurt me?" at many places by dispatching this key with `{ pokemon, cancelled }`
// and skipping the damage when `cancelled` comes back true: poison and burn ticks (turn-end-phase.ts:89, :110,
// post-turn-status-effect-phase.ts:34), weather damage (weather-effect-phase.ts:102), entry hazards (arena-tag.ts:960),
// recoil and crash damage (move.ts:2554, :2701, :3015, :7688), curse and leech-seed style tags (battler-tags.ts:1378), drain
// and contact-damage abilities (ab-attrs.ts:760, :5691, :6263, :6302, archetypes lifesteal, on-faint-effect,
// type-damage-boost, post-turn-hurt-non-typed).
// Some other sites only PEEK at the flag with `hasAbilityWithAttr("BlockNonDirectDamageAbAttr")` (ab-attrs.ts:1274, :5209,
// :5670, contact-damage-on-hit.ts:157, init-elite-redux-vanilla-rebalance.ts:2469, er-tactical-items.ts:858). A rebuilt attr
// keeps the class, so those peeks keep working; a block built only from library pieces would NOT satisfy them (R-B05-15).
import { BlockNonDirectDamageAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BlockNonDirectDamageAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.indirect-damage",
  label: "Block all indirect damage",
  summary: () =>
    "I take no damage that does not come straight from a move: poison, burn, weather, hazards, recoil and Rough Skin style damage. Example: Magic Guard.",
  synonyms: [
    "magic guard",
    "no poison damage",
    "no recoil",
    "no weather damage",
    "immune to hazards",
    "passive damage immunity",
    "only direct damage",
  ],
  examples: ["Take no damage from poison, burn, sandstorm or recoil, like Magic Guard"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: every kind of indirect damage is blocked. The class has no constructor argument other than showAbility, which is never exposed.",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when the damage was already blocked by something earlier"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the holder is poisoned or burned at the end of the turn", axes: { status: ["POISON", "BURN"] } }],
  status: "decomposed",
  notes:
    "Tier C. 10 users, all with no closure and showAbility false: Magic Guard (98), Impenetrable (5064), Apple Enlightenment (5317), Conjurer Of Deceit (5464), Immovable Object (5490 attr 0), Cosmic Dust (5640), Chestnut Shield (5657), Titan (5934), Old Ocean Relic (20009), Mystic Fortification (20014). Nothing to bind. The shared WHEN `cancel.indirect-damage` also lists BlockRecoilDamageAttr and BlockStatusDamageAbAttr as dispatched at the same moment, which is only half true (R-B05-14). The shared L2 scenario reaches it through the status tick (a poisoned or burned holder); the other engine sites are the same one-line dispatch. The class never reads `simulated`.",
});
