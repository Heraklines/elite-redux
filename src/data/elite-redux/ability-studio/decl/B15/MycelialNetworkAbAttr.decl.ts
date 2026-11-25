/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Tier C, engine-query (a presence marker). "When a foe loses HP to Infestation, I recover half of it; what I cannot use goes to my lowest-HP ally (doubles)."
//
// Source: src/data/elite-redux/abilities/mycelial-network.ts, class MycelialNetworkAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty, there is no canApply of its own).
// The effect is applyMycelialNetworkHeal(victim, dealt) in src/data/battler-tags.ts, called from DamagingTrapTag.lapse only for the INFESTATION tag after the tick dealt HP (`dealt > 0`, not cancelled by Magic Guard):
//   for each foe of the victim that is active and has an active MycelialNetworkAbAttr (by constructor name):
//     1. heal = floor(dealt * share) (share 0.5; the old code was floor(dealt / 2), the same number); heal <= 0 -> skip
//     2. toHolder = min(heal, maxHp - hp); if > 0, unshift PokemonHealPhase(holder, toHolder, "seededLapse" message)
//     3. overflow = heal - toHolder; if > 0, the holder's active ally that is not at full HP and has the LOWEST hp RATIO gets PokemonHealPhase(overflow) (none in singles: wasted)
// Constructor change (behaviour-neutral): the heal share (default 0.5) is a constructor argument; the seam reads it from each holder's live attr (src/data/battler-tags.ts, one function).
// No random draw.
import { MycelialNetworkAbAttr } from "#data/elite-redux/abilities/mycelial-network";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MycelialNetworkAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Heal from foes' Infestation damage and share the extra",
  summary: params =>
    `When a foe loses HP to Infestation, I recover ${Math.round(Number(params.healShare) * 100)}% of the HP it lost (rounded down). Healing I cannot use goes to my lowest-HP ally in doubles.`,
  synonyms: [
    "mycelial network",
    "infestation heal",
    "drain from infestation",
    "share healing with ally",
    "leech from bugs",
    "parasite heal",
    "mushroom network",
  ],
  examples: ["When a foe is hurt by Infestation I heal half of that damage, and any extra heals my partner"],
  params: [
    {
      id: "healShare",
      ctorIndex: 0,
      path: "healShare",
      control: "slider",
      min: 0.05,
      max: 1,
      step: 0.05,
      label: "Share of the lost HP I recover (0.5 = half)",
      editable: true,
      default: 0.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "It reacts only to HP lost to Infestation, not to other trapping effects or damage",
    "It does nothing when the Infestation damage is blocked (for example by Magic Guard)",
    "Healing beyond my missing HP goes to the living ally with the lowest HP percent; in singles it is wasted",
    "It is built into the game's Infestation damage and is not part of this block",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The marker is consulted by the Infestation damage of the trapping effect, which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "a foe loses HP to Infestation at the end of the turn", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by the Infestation tick by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Mycelial Network (5905 attr 0). The class has no condition of its own; the moment 'when a foe loses HP to Infestation' and the effect 'heal by a share of the lost HP, overflow to the lowest-HP ally' are requested as library blocks (R-B15-19, same family as R-B15-11 for Leech Seed). The share is a typed param; the overflow rule is fixed. Suspected oddities, NOT fixed: (1) both heal phases show the Leech Seed message text (battlerTags:seededLapse), so the player reads 'sapped by Leech Seed' for an Infestation heal; (2) with two holders on the same side each heals separately, from the same dealt amount; (3) the overflow ally is picked by lowest HP RATIO (getHpRatio), while the ability text says lowest HP.",
});
