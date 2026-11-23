/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Superego (Tier C, engine-query). "When a foe raises a stat, I take that raise instead (once per stat per turn)."
//
// Source: abilities/newcomer-signature-mechanics.ts, SuperegoMarkerAbAttr (extends AbAttr directly; apply is empty; no constructor).
// The class is a MARKER that the engine looks for by name: applySuperegoAfterBoost(boosted, stat, canBeCopied) is called by
// StatStageChangePhase (phases/stat-stage-change-phase.ts:324) once per changed stat, right after a POSITIVE change was written to the
// boosted Pokemon. The rule, in order:
//   the change must be copyable (the Egoist/Opportunist copies are not, so the copy does not trigger Superego again)   (else: nothing)
//   for each opponent of the boosted Pokemon that carries this marker (the holder):
//     prior = the holder's own stage of that stat; raised = the boosted Pokemon's new stage
//     skip when raised <= prior (the boost does not put the foe above me)
//     skip when this holder already seized this stat this turn (a per-holder, per-stat memory keyed by wave:turn)
//     remember the turn; holder stage := raised; boosted stage := prior; queue "<name>'s Superego seized the boost!"
// No RNG, no constructor arguments, no number.
import { SuperegoMarkerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SuperegoMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Steal a foe's stat boost for myself, once per stat each turn",
  summary: () =>
    "While I have this, when a foe raises a stat above my own level of that stat, I take that level and the foe goes back to my old level. This works once per stat each turn.",
  synonyms: [
    "steal stat boosts",
    "take the boost",
    "stat theft",
    "boost thief",
    "opportunist",
    "superego",
    "swap boosts with the foe",
  ],
  examples: ["When a foe raises its Attack above mine I take the boost instead, like Superego"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments and no number: it always takes the full new level of the stat and leaves the foe at the level I had, once per stat per turn. There is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only a boost that is not a copy of another boost (boosts copied by Opportunist-style abilities do not trigger it)",
    "Only works when the foe ends above my own level of that stat",
    "Only once per stat each turn for me",
    "It only reacts to boosts of foes; my own boosts and my allies' boosts are left alone",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "turn", simulated: "ignores" },
  l2StaticReason:
    "The flag is consulted by name from the stat change phase, which is not a dispatched moment; B13/chunk6.test.ts proves the rule by calling applySuperegoAfterBoost with and without the marker, with a copy and for the second boost in a turn.",
  probes: [{ name: "a damaging hit that boosts nothing", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "ENGINE-QUERY, justified: the class is a flag; the rule (when a foe raises a stat, take the raise, once per stat per turn) lives in applySuperegoAfterBoost, called by name from StatStageChangePhase (phases/stat-stage-change-phase.ts:324), so a rebuilt attr cannot carry it. Its trigger ('a foe's stat was just raised') is not dispatched to abilities in the stat phase, so no WHEN block can wrap it: requested as R-B13-56 (a dispatched WHEN 'When a foe's stat goes up' with slots holder, other, stat and the new level, plus the effect 'Take the foe's stat level and put the foe back to mine' with a per-stat 'once each turn' memory); the dispatch key list of while.active needs this class (R-B13-19; the same minimal flag-key entry the earlier chunks made was added). There is no number to expose: the once-per-turn limit is part of the rule, not a count. Users: Superego (5994, attr 0); the ability passes no arguments and has no other attr, so it is fully covered. ODDITIES (not fixed): (1) the memory is keyed by wave:turn, so two boosts in different phases of the same turn count as one; (2) the foe goes back to MY old level of the stat, not to its own old level, so a foe that started below me and crossed my level ends at my old level, which is higher than where it started; (3) the check reads the stage after the change was written, so a boost capped at +6 compares with the capped value; (4) with two Superego holders among the foes the second one sees the first one's result; (5) only boosts that go through StatStageChangePhase with a positive value are seen, so other ways of writing a stage never trigger it.",
});
