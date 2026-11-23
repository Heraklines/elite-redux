/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. Tier B, event-effect. "The first foe that hurts me each time I enter gets cursed, and I feed on its pain."
//
// Source: fakemon-pitch-mechanics.ts BoobyTrapAbAttr (extends PostDefendAbAttr; dispatched as PostDefendAbAttr).
// canApply, original clause order, now `guards && gate && residual`:
//   guards    1. !simulated                                  not while the game only previews a hit
//             2. damage > 0                                   the hit dealt damage
//             3. hitResult < HitResult.NO_EFFECT              it was a real hit, not a block
//   gate      4. move.category !== STATUS                     a damaging move (clause 2 already implies it for real hits)
//             5. opponent !== pokemon                         not myself
//             6. opponent.isPlayer() !== pokemon.isPlayer()   the attacker is a foe
//   residual  7. opponent.canAddTag(tag)                      the attacker can take the effect (not already cursed, no immunity)
//             8. !hasSummonAbilityProvenance(holder, "booby-trap:entry")   this entry's one trap is not spent yet
// Nothing is random. Clauses 1 to 3 are guards (without them the curse would fire for a hit that did nothing). Clauses 4 to 6
// are the conditions. Clause 5 is implied by clause 6 (the same Pokemon has the same side), so the library form of the gate is
// all[ move.damaging, side.is { kind: foe } ]. Clauses 7 and 8 stay in the class (feasibility). Clause 8 is a memory ("once per
// entry") that lives in `summonData.erAbilityProvenance`; the library atom `time.once-per` keeps its own memory, so it cannot
// stand in for it (request: a once-per-entry atom that reads this provenance list).
//
// apply: claims the entry's trap (claimSummonAbilityProvenance; false means already claimed, so nothing happens), then
//   opponent.addTag(tag, 0, move.id, holder.id)                         the lingering effect, no turn limit
//   holder.summonData.erAbilityProvenance.push("booby-trap:<attackerId>")   marks the victim
// The mark is what the ENGINE reads: Pokemon.damage() calls applyBoobyTrapHealing(target, damage), which heals me for HALF of
// every damage the marked foe takes afterwards (from any source), as long as I still have this attr active. So the effect is
// "curse the foe" plus "feed on its damage"; the second half is built into the ability, not part of the block's settings.
import { BoobyTrapAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { LINGERING_EFFECT_WORDS, lingeringEffectCodec } from "./chunk2-codecs";

export default defineDecl(BoobyTrapAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Curse the first foe that hurts me and heal off its pain",
  summary: params =>
    `The first foe that damages me after I enter gets ${params.tag}. While it lasts, I heal half of any damage that foe takes. Only one foe per entry.`,
  synonyms: [
    "booby trap",
    "curse attacker",
    "trap the attacker",
    "revenge curse",
    "lifesteal curse",
    "heal from curse",
    "mine",
  ],
  examples: ["The first foe that hits me after I switch in is cursed, and I heal half of the damage it takes"],
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
    // Gate = [the move deals damage, the attacker is a foe], in that order. Removable: "any hit" is a valid design.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have hurt me (it dealt damage and was not blocked), and the game must not be only previewing",
    "The foe must be able to receive the effect (it is not already affected and nothing blocks it)",
    "Only one foe is trapped each time I enter the battle",
    "While I have this ability, I heal half of any damage the trapped foe takes (built in, not a setting)",
  ],
  effect: { id: "effect.apply-tag", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "a foe's damaging move hits the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B. The lingering effect is constructor argument 0 (default Curse, behaviour identical) and a param; only Curse is offered because the class applies it with no turn limit and only the Curse is known to behave that way. Users (1): Booby Trap (6067) attr 0; attr 1 is BoobyTrapItemLostAbAttr. Gate bound to all[move.damaging, side.is foe] (clause 5 is implied by clause 6). Guards (not-simulated, hit-dealt-damage) are listed as feasibility until the librarian registers them. The once-per-entry memory (clause 8 and the claim in apply) stays in the class. The healing half lives outside the class: Pokemon.damage() -> applyBoobyTrapHealing looks for an active BoobyTrapAbAttr (instanceof) and the provenance mark 'booby-trap:<foeId>'; a rule built only from library blocks does not heal. Oddity, not fixed: the engine looks the attr up by `instanceof BoobyTrapAbAttr`, so BoobyTrapItemLostAbAttr's marks only heal because the same ability also carries BoobyTrapAbAttr.",
});
