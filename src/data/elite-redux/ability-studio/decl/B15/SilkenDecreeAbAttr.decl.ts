/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Tier C, library effect (effect.apply-tag). "At the end of every turn, each foe on the field that has more than one usable move has some of its moves sealed for its next move selection (the Silken Decree effect keeps at least one move free)."
//
// Source: src/data/elite-redux/abilities/silken-decree.ts, class SilkenDecreeAbAttr (extends PostTurnAbAttr; constructor passes showAbility true; one constructor argument now, `turns`).
// canApply (the whole of it, no random draw): holder.getOpponents().some(foe => !!foe && !foe.isFainted() && usableMoveCount(foe) > 1), where usableMoveCount counts DISTINCT
// move ids in the moveset that are not MoveId.NONE and still have PP.
//   -> this is NOT a design condition of the holder: it is the same per-foe filter that apply uses below (so it only decides whether anything will happen, and so whether the ability flyout shows).
//      It is kept in the class as feasibility ("there is a foe that has more than one usable move").
// apply (effect), not when simulated: applySilkenDecreeToOpponents(holder, turns): for each foe from holder.getOpponents() that exists, is not fainted and has more than one usable move,
//   foe.addTag(ER_SILKEN_DECREE, turns, undefined, holder.id). The tag (ErSilkenDecreeTag in battler-tags.ts) seals random usable moves on add (its own seeded draws, in foe order), always leaving
//   at least one move; it refuses itself (canAdd) with fewer than two usable moves; it lasts `turns` turn ends. Nothing here draws a random number directly.
// Constructor change (behaviour-neutral): `turns` (default 1, the old literal) is a constructor argument passed to addTag.
import { SilkenDecreeAbAttr } from "#data/elite-redux/abilities/silken-decree";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SilkenDecreeAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Seal some moves of each foe at the end of the turn",
  summary: params =>
    `At the end of every turn, each foe that has more than one usable move gets some moves sealed for ${params.turns} turn(s); one move always stays free. Example: a foe with four moves can use only two.`,
  synonyms: [
    "silken decree",
    "seal moves",
    "disable moves",
    "restrict the foe's moves",
    "limit what the foe can use",
    "move lock",
    "encore style restriction",
    "torment the foe",
  ],
  examples: [
    "At the end of every turn the foe loses access to some of its moves for the next turn, like Silken Decree",
    "A weaker form of Disable that hits every foe every turn",
  ],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "turns",
      control: "number",
      min: 1,
      max: 5,
      step: 1,
      integer: true,
      label: "Number of turns the seal lasts (1 = the foe's next move selection only)",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe on the field must still be standing and have more than one usable move (distinct moves with PP left); foes with one move are left alone",
    "The seal always leaves at least one move free, and the choice of which moves are sealed is random",
    "A foe that cannot take the seal (the battle effect refuses it) is skipped",
    "It does nothing in a preview",
  ],
  // effect.apply-tag with target = every foe, tag = ER_SILKEN_DECREE (fixed by this class) and the typed turns.
  effect: { id: "effect.apply-tag", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: per foe in getOpponents order, the ER_SILKEN_DECREE tag's onAdd draws randBattleSeedInt to pick the sealed moves (the class itself draws nothing)",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [{ name: "end of turn with a foe that has several moves", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C, event effect with the library effect effect.apply-tag (which is in the registry but implemented false, the same state as Puppet Strings; R-B15-31 and R-B15-8 already ask for it), not a package. The trigger is a separate swappable WHEN (end of turn). 1 attr in 1 ability: Silken Decree (5900 attr 0). The class has no design condition: its only canApply clause is the 'some foe has more than one usable move' filter that apply repeats per foe, so it is feasibility (it only decides whether the ability flyout appears), and the library has no atom 'a foe has {cmp} {n} usable moves' (R-B15-40 asks for it so that staff can raise or remove the 'more than one' line; today the same number is also the Silken Decree tag's own canAdd rule). The effect has one typed number (turns). The tag (which moves get sealed, how many, the seeded draws) is the battle effect's own behaviour and fixed by it. Suspected oddities, NOT fixed: (1) usableMoveCount counts DISTINCT move ids, so a moveset with the same move twice counts once; (2) canApply and apply both skip fainted foes but use getOpponents() (on-field only), so a benched foe is never sealed, which is the intent; (3) the tag is added at end of turn with turnCount 1 and the doc says it expires at the next turn end, so the seal covers the foe's next move selection, as documented.",
});
