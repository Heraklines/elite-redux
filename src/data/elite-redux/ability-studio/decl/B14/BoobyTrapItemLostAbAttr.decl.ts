/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. Tier B, event-effect. "A foe that takes or knocks off my held item gets cursed, and I feed on its pain."
//
// Source: fakemon-pitch-mechanics.ts BoobyTrapItemLostAbAttr (extends PostItemLostAbAttr; dispatched as PostItemLostAbAttr
// when the holder loses its item to somebody else, for example Thief, Knock Off or Trick).
// canApply, original clause order, now `guards && gate`:
//   guards  1. !simulated                                   not while the game only previews
//           2. opponent !== undefined                       somebody else caused the loss (an eaten or used-up item has no culprit)
//   gate    3. opponent !== pokemon                         not myself
//           4. opponent.isPlayer() !== pokemon.isPlayer()   the culprit is a foe
// Nothing is random. Clauses 1 and 2 are guards. Clauses 3 and 4 are the condition; clause 3 is implied by clause 4, so the
// library form of the gate is the single atom side.is { kind: foe }. There is no feasibility check and no once-per-entry claim.
//
// apply: `opponent.addTag(tag, 0, MoveId.NONE, holder.id)`, then `holder.summonData.erAbilityProvenance.push("booby-trap:<culpritId>")`.
// The mark is what the engine reads: Pokemon.damage() -> applyBoobyTrapHealing heals me for half of every damage the marked foe
// takes afterwards, while I have an active BoobyTrapAbAttr (the sibling attr of the same ability). See BoobyTrapAbAttr.
import { BoobyTrapItemLostAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { LINGERING_EFFECT_WORDS, lingeringEffectCodec } from "./chunk2-codecs";

export default defineDecl(BoobyTrapItemLostAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.item-lost",
  label: "Curse the foe that takes or knocks off my item",
  summary: params =>
    `When a foe takes or knocks off my held item, that foe gets ${params.tag}. While it lasts, I heal half of any damage that foe takes.`,
  synonyms: [
    "booby trap",
    "curse item thief",
    "knock off punishment",
    "thief revenge",
    "curse the thief",
    "trap the thief",
  ],
  examples: ["A foe that uses Thief or Knock Off on me is cursed"],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tag",
      control: "select",
      label: "Lingering effect laid on the foe",
      editable: true,
      default: "Curse",
      options: Object.keys(LINGERING_EFFECT_WORDS),
      codec: lingeringEffectCodec,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [the one who caused the loss is a foe]. Removable: "anybody who takes my item" is a valid design.
    { slot: "gate", ctx: "params", lib: "side.is", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Somebody else must have caused the loss (an item I used up or ate myself does nothing), and the game must not be only previewing",
    "While I have this ability, I heal half of any damage the cursed foe takes (built in, not a setting)",
  ],
  effect: { id: "effect.apply-tag", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "a foe steals the holder's item", axes: { foeMove: ["THIEF"] } }],
  l2StaticReason:
    "The shared scenario for this trigger (the enemy uses Knock Off on a holder with a berry) is listed as unreached because Knock Off does not remove the starting berry there. This declaration's probe steals the item with Thief instead, which does reach the moment: the twin shows the original evaluating the attr and the rebuild behaving the same. B14/chunk2-gate-split.test.ts also compares the split canApply with the original expression.",
  status: "decomposed",
  notes:
    "Tier B. The lingering effect is constructor argument 0 (default Curse) and a param. The original apply repeated clauses 1 to 4 a second time; apply now only keeps the simulated and culprit-present test (needed for types) because the engine always asks canApply first, so behaviour through the engine is identical, while a replaced gate is no longer silently re-checked. Users (1): Booby Trap (6067) attr 1. Gate bound to side.is foe. Oddities, not fixed: (1) unlike BoobyTrapAbAttr there is no can-add check and no once-per-entry claim, so each item loss curses its culprit (addTag itself refuses a second Curse) and the provenance mark is written even if the tag was refused, which makes the holder heal from a foe that is not cursed; (2) in the twin scenario with a starting Sitrus Berry, an enemy Knock Off hurt the holder but left the berry in place and did not reach this moment (observed with and without this ability; the scenario now steals the item with Thief, which does reach it; cause not investigated); (3) the heal link depends on the sibling attr BoobyTrapAbAttr being active, because applyBoobyTrapHealing looks for that class.",
});
