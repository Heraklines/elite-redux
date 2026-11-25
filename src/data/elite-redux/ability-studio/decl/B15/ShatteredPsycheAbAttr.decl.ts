/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Tier C, engine-query (a presence marker). "Once per battle, after everyone has chosen their move, I fuse two of my opponents into one with combined HP; the fused foe takes both foes' moves that turn."
//
// Source: src/data/elite-redux/abilities/shattered-psyche.ts, class ShatteredPsycheAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty, there is no canApply of its own,
// and no constructor argument). The whole mechanic is driven imperatively from erShatteredPsycheMaybeFuse (called from TurnStartPhase after the guest early-return, so host and solo only),
// which finds the marker by constructor name (carriesShatteredPsyche = an unsuppressed attr named "ShatteredPsycheAbAttr" in getAllActiveAbilityAttrs). In order, per field Pokemon:
//   1. holder.isActive(true) and its id is not in shatteredPsycheFiredHolders (once per battle; module state keyed to the current battle object, cleared when the battle changes)   -> once per battle
//   2. holder carries the marker                                                                                                                                              -> presence
//   3. tryFuseOpponents(holder): opponents = holder.getOpponents(true); two or more -> DOUBLES: opponents[0] absorbs opponents[1]; exactly one -> SINGLES: it absorbs ONE living benched foe
//      picked with holder.randBattleSeedInt(bench.length) (no bench -> nothing happens and the use is NOT consumed); none -> nothing; a foe that is already fused or absorbed -> nothing
//   4. effect: primary.setStat(HP, primaryMax + constituentMax), primary.hp += constituent hp (capped), the primary takes the constituent's fusion look, the constituent is retired
//      (doubles: its committed command is skipped, it is hidden; singles: it just stays on the bench) without a faint, and the constituent's move is queued as a second action
//      (doubles: its committed move; singles: a seeded pick from its usable moves, one more draw)
//   5. un-fuse (erShatteredPsycheOnLeaveField / erShatteredPsycheEndBattle): when the fused foe leaves the field or the battle ends, its HP is split back in proportion to each original max HP
//      (splitFusedHp, rounded so the two shares add up exactly) and both foes and the old fusion identity are restored.
// Nothing is dispatched, so the L2 harness treats the declaration as presence-only (the whole battle is compared). Random draws: singles only, seeded (bench pick, then the bonus move pick).
import { ShatteredPsycheAbAttr } from "#data/elite-redux/abilities/shattered-psyche";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ShatteredPsycheAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Fuse two foes into one with shared HP, once per battle",
  summary: () =>
    "Once per battle, after everyone chose a move, two foes fuse into one with their HP added together and it also uses the other foe's move. The HP is split back when it leaves.",
  synonyms: [
    "shattered psyche",
    "merge two foes",
    "fuse the enemies",
    "combine foe hp",
    "dna splice the opponents",
    "double the boss",
    "two foes act as one",
  ],
  examples: [
    "Once per battle, the two enemies in a double battle become one big foe that uses both of their moves, like Shattered Psyche",
    "In a single battle, the foe absorbs a random benched Pokemon for one turn",
  ],
  params: [],
  noParamsReason:
    "A presence marker; every figure of the mechanic is structural and has no setting in the class: it fuses exactly two foes, once per battle, the HP is the sum of the two max HPs, and the HP is handed back in proportion to the original max HPs. A setting would have to re-implement the fusion code, which this declaration does not do.",
  conditions: [],
  guards: [],
  feasibility: [
    "It only works for the host or in solo play (the turn-start hook is skipped for a guest)",
    "In doubles the two foes on the field fuse; in singles the foe on the field absorbs one living benched foe chosen with a seeded roll, and with nothing on the bench nothing happens and the use is not spent",
    "A foe that is already fused or absorbed is skipped",
    "The absorbed foe is hidden and cannot be targeted or chosen as a reserve until the fusion ends",
    "It is built into the turn start and the battle end and is not part of this block",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "turn start, singles only: (1) holder.randBattleSeedInt(bench.length) picks the absorbed benched foe, (2) holder.randBattleSeedInt(usable moves) picks its bonus move; doubles draw nothing",
    ],
    state: "battle",
    simulated: "ignores",
  },
  l2StaticReason:
    "The marker is consulted by the turn start (after the commands are locked in), which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "a normal turn with the holder on the field", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by erShatteredPsycheMaybeFuse by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Shattered Psyche (5968 attr 0, Primal Mew's innate). The class has no condition and no number of its own; the moment ('at the start of the turn, after everyone chose their move'), the memory ('once per battle', a module Set keyed to the current battle and read by the AI snapshot through erShatteredPsycheState) and the effect ('fuse two foes into one with combined HP and un-fuse later') all live in the module functions and are requested as library blocks: R-B15-44, with the once-per-battle memory scope question of R-B15-7. Declared as an engine query rather than a package because there is no apply to package: the marker's apply is empty and the effect is a whole state machine (ledger, absorbed set, fusion identity snapshot, HP split) driven from three engine seams, so it cannot be expressed with the existing effect blocks and cannot honestly be given typed params. The declaration uses WHEN while.active, which needs ShatteredPsycheAbAttr in that WHEN's flagKeys; it was added to that list locally (R-B15-45). Suspected oddities, NOT fixed: (1) the once-per-battle memory is module state with a string wave key and a battle object identity, not battle data, so it is per battle only as long as currentBattle is a new object each wave; (2) a singles use with no bench is not consumed and is retried EVERY turn, drawing nothing; (3) the split on un-fuse uses Math.round of the proportional share and gives the constituent the remainder, so a foe's HP can differ by one from a strict proportional split, by design ('always sum exactly'); (4) simulated is declared 'ignores' because the turn-start hook has no simulated flag at all.",
});
