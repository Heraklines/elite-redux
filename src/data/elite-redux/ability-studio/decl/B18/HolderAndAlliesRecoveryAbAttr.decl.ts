/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
// Soothing Aroma and Butter Up (Tier C). "At the end of every turn, DO heal me and each adjacent ally that is hurt by a share
// of its max HP".
//
// Source: ability-upgrades/attrs/party-recovery.ts over PostTurnAbAttr (showAbility false). Dispatch:
// applyAbAttrs("PostTurnAbAttr", { pokemon, simulated }) at the end of the turn.
//
// canApply: `targets(pokemon).length > 0`, where targets = [holder, ...holder.getAdjacentAllies()] filtered by
//   `!fainted && hp > 0 && !isFullHp()`. That is "somebody to heal exists": effect-side feasibility, not a game rule staff
//   would move, so it stays in the class and is listed as "also requires". There is no other clause.
// apply: unless simulated, for each target (the same list, computed again) queue a PokemonHealPhase of
//   toDmgValue(target.getMaxHp() * healFraction).
import { HolderAndAlliesRecoveryAbAttr } from "#data/elite-redux/ability-upgrades/attrs/party-recovery";

/** healFraction (0 to 1) <-> percent, rounded so 0.0625 reads back as 6.25 and not 6.250000000000001. */
const percentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 10000) / 100 : undefined),
};

export default defineDecl(HolderAndAlliesRecoveryAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Heal me and my neighbouring allies every turn",
  summary: params =>
    `At the end of every turn, I and each ally next to me that is hurt heals ${params.healFraction}% of its max HP. Example: 6.25 is one sixteenth.`,
  synonyms: [
    "soothing aroma",
    "butter up",
    "end of turn heal",
    "heal allies each turn",
    "leftovers for the team",
    "regenerate partner",
  ],
  examples: ["Heal me and my partner by a sixteenth of max HP at the end of each turn"],
  params: [
    {
      id: "healFraction",
      ctorIndex: 0,
      path: "healFraction",
      control: "slider",
      min: 0.25,
      max: 100,
      step: 0.25,
      label: "Heal each hurt Pokemon by (% of its max HP, 6.25 = one sixteenth)",
      editable: true,
      default: 6.25,
      codec: percentCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one of me or an ally next to me must be alive and below full HP",
    "Only allies standing next to me are healed, never one further away or in the back",
    "Nothing is healed while the game is only previewing",
  ],
  effect: { id: "effect.package", params: ["healFraction"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    // The only clause is "somebody is hurt": full HP (nothing to heal) against one HP below.
    { name: "the holder at and just below full HP", axes: { hp: ["max", "max-1", "50%"] } },
  ],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'heal the holder and each adjacent ally' cannot be said with effect.heal-percent today. It heals only the holder, one foe, the whole holder side (holder plus every living ally, not just the adjacent ones) or the opposing side, as a WHOLE-number percent (this class needs 6.25), and it queues a heal for full-HP members too, while this class filters each target by 'alive and below full HP' and only then queues the heal; request R-B18-15 (a target 'me and the allies next to me', only hurt ones, decimal percent). The trigger (event.end-of-turn) is a separate block; there is no condition in the class: 'somebody is hurt' is feasibility (it only decides whether the class has anything to do), so staff can still AND any condition on top (if: true). The heal share is the only number and is typed. Users: Soothing Aroma (5215, attr 1) and Butter Up (5389, attr 2), both 1/16 = 6.25%. ODDITIES (not fixed): (1) the target list is built twice (canApply and apply) from live HP, so the answer can differ if HP changes between the two calls; nothing in the engine changes HP between them; (2) the heal queue uses PokemonHealPhase, so the heal happens after the turn-end phase order has moved on, not instantly; (3) getAdjacentAllies decides 'next to me', so in a triple battle the far ally is not healed.",
});
