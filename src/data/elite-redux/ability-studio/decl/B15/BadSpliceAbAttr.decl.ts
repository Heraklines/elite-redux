/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Package. "When I enter, every foe on the field gains extra types taken from one other living Pokemon of its own team."
//
// Source: src/data/elite-redux/abilities/bad-splice.ts, class BadSpliceAbAttr (extends PostSummonAbAttr; constructor passes showAbility
// = false, activateOnGain stays true). The class has NO canApply of its own (PostSummonAbAttr answers true), so there is no condition,
// no guard and no gate to extract. Clauses of `apply`, in order:
//   1. `if (simulated) return`                                              -> effect-side (the class respects simulated)
//   2. for every foe in pokemon.getOpponents() (field order): spliceFoe(holder, foe, sourceMemberCount)
//        a. candidates = the foe's OWN party members that are not the foe and are allowed in battle; none -> skip the foe
//        b. pick min(sourceMemberCount, candidates) donors, each with ONE globalScene.randBattleSeedInt(pool.length) draw, removed from the pool
//        c. the donors' types (not UNKNOWN) that the foe does not already have are grafted onto the foe (type-graft substrate)
//        d. the grafted types are written to the per-holder ledger (a WeakMap), and one "gained the type" message is queued per type
// RNG: one seeded draw per lending teammate per foe, inside apply, never when simulated. State: the module-level SPLICE_LEDGER (holder -> foe -> types).
// Two more halves live OUTSIDE the attr and find it by constructor name: PostSummonPhase calls erBadSpliceOnOpponentSummon for a foe that comes in
// while a holder is out (it splices that foe too, using the holder's own sourceMemberCount), and Pokemon.leaveField calls erBadSpliceOnLeaveField,
// which un-grafts exactly what this holder added. Neither half is a WHEN the vocabulary has.
//
// Why a package (honest limit): the mechanic is a seeded donor pick, a graft of types that the foe lacks, a ledger that remembers exactly what was
// added so it can be taken back when I leave, plus two engine hooks that read the same ledger. The vocabulary has no "give a Pokemon extra types"
// effect and no ledger memory, so splitting would re-implement the class. The trigger (on entry) is the separate, swappable WHEN; the class has no
// condition to separate. The only number (how many teammates lend their types) is a typed param.
import { BadSpliceAbAttr } from "#data/elite-redux/abilities/bad-splice";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BadSpliceAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Give each foe extra types from its own team (Bad Splice)",
  summary: params =>
    `When I enter, every foe gains the types of ${params.sourceMemberCount} other living teammate(s) of its own team, as extra types. Foes that come in later are changed too, and it is undone when I leave.`,
  synonyms: [
    "bad splice",
    "extra types",
    "add types to foes",
    "type mixing",
    "borrow teammate types",
    "dual type foes",
    "splice types",
  ],
  examples: ["When I enter, each foe gets extra types from a random teammate of its own, until I leave the field"],
  params: [
    {
      id: "sourceMemberCount",
      ctorIndex: 0,
      path: "sourceMemberCount",
      control: "number",
      label: "Teammates of each foe that lend their types (1 = one random teammate)",
      editable: true,
      default: 1,
      min: 1,
      max: 5,
      step: 1,
      integer: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A foe with no other living teammate is left alone",
    "Only types the foe does not already have are added; nothing is added in a preview",
    "Foes that switch in while I am out are changed too, and the added types are taken back exactly when I leave the field (both are built into the game, not part of this block)",
  ],
  effect: { id: "effect.package", params: ["sourceMemberCount"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: ["apply: for each foe in field order, one seeded draw per lending teammate (never when simulated)"],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "enter against a foe that has teammates", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified (see the header): seeded donor pick + type graft + a ledger shared with two engine hooks (opponent switch-in, leave field) that find the attr by constructor name. The trigger is a separate WHEN and there is no condition in the class. Constructor change (behaviour-neutral, spec 3.1 spirit): the ctor now takes sourceMemberCount (default BAD_SPLICE_CONFIG.sourceMemberCount = 1) and the opponent-summon half reads it from the holder's live attr, so a rebuilt rule with another count also changes the later splices. Users: Bad Splice (5932 attr 0) only. Suspected oddities, NOT fixed: (1) the ledger is only cleared when the holder leaves the field, so a holder whose ability is later suppressed keeps its grafts while it stays out (the later-switch-in half stops, because hasBadSplice-style lookup reads active attrs); (2) a foe that was spliced and then faints or leaves keeps a stale ledger entry until the holder leaves (harmless, WeakMap keyed by the holder). Requested nothing from the library for this class.",
});
