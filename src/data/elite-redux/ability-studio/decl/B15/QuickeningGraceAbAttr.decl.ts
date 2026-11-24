/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Tier C, engine-query. "Once per turn, the first damaging two-turn move (Solar Beam, Fly, Dig) that my ALLY picks is used at once, skipping its charge turn."
//
// Source: src/data/elite-redux/abilities/quickening-grace.ts, class QuickeningGraceAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty, there is no canApply of its own).
// It is a pure presence marker. The effect lives in erTryQuickeningGrace(user, move), called from MoveChargePhase.end (src/phases/move-charge-phase.ts:110) only when the user's charge is not already skipped:
//   1. no user -> false                                                                                  -> effect-side
//   2. move.category === STATUS -> false (Geomancy and other status charge moves never qualify)         -> condition (a damaging move)
//   3. for each ally of the user (user.getAllies()), in order:
//        a. the ally is active (isActive(true)) and carries an active QuickeningGraceAbAttr (found by constructor name)   -> condition (an ally has the ability)
//        b. QUICKENING_GRACE_USED.get(ally) === "wave:turn"                                              -> memory: this holder already used it THIS turn (once per turn per holder)
//        c. otherwise record the key, queue "<ally>'s Quickening Grace hastened <user>'s move!" and return true (the caller skips the charge)
// Recharge moves (Hyper Beam) never reach MoveChargePhase, so they are excluded by construction. No random draw. State: a module WeakMap keyed by the holder, value the wave:turn key (never reset, only compared).
// Nothing is dispatched, so the L2 harness treats the declaration as presence-only (the whole battle is compared).
import { QuickeningGraceAbAttr } from "#data/elite-redux/abilities/quickening-grace";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(QuickeningGraceAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Let my ally's two-turn attack skip its charge turn",
  summary: () =>
    "While I have this, once per turn the first damaging two-turn move my ally picks (like Solar Beam or Fly) is used at once, with no charge turn. Status charge moves do not count.",
  synonyms: [
    "quickening grace",
    "skip the charge turn",
    "instant charge",
    "power herb for my ally",
    "no charge turn",
    "hasten my partner's move",
  ],
  examples: ["My partner's Solar Beam fires the same turn it is picked, once per turn, like Quickening Grace"],
  params: [],
  noParamsReason:
    "A presence marker read by the charge handling; there is nothing to configure. The count is fixed at one hasten per holder per turn and only damaging charge moves qualify. Both are conditions of the seam, requested as library blocks (R-B15-34).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only a damaging charge move qualifies; Geomancy and other status charge moves, and recharge moves like Hyper Beam, do not",
    "Only a move chosen by my ALLY is hastened, not my own",
    "I can hasten one move per turn (the first one my ally picks)",
    "The battle message is built into the game's charge handling",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The marker is consulted by the charge handling (MoveChargePhase) when a two-turn move starts, which is not a dispatched moment (and needs a doubles ally); the twin compares whole battles of the one user instead.",
  probes: [{ name: "a battle where nobody charges", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by erTryQuickeningGrace by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Quickening Grace (5913 attr 0). The declaration uses WHEN while.active, which needs QuickeningGraceAbAttr in that WHEN's flagKeys (added locally with this chunk, request R-B15-35, keep the union on merge). The class has no condition or effect of its own; the moment 'when my ally starts a two-turn move', the conditions (the move deals damage, once per turn per holder) and the effect 'skip the charge turn' are requested as library blocks: R-B15-34. Suspected oddities, NOT fixed: (1) the user can be on EITHER side: an enemy with an ally that carries Quickening Grace gets the same boost, as the code does not check the player's side; (2) the message is hard-coded English; (3) with two holders in triples the FIRST ally found with an unspent charge is used up, not the best one.",
});
