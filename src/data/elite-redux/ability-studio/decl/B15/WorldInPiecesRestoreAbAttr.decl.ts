/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 6. Package. "When I win a fight (score a KO), I get one random lost type back."
//
// Source: src/data/elite-redux/abilities/world-in-pieces.ts, class WorldInPiecesRestoreAbAttr (extends PostVictoryAbAttr; no constructor of its own, showAbility is the base default). canApply, no draw:
//   1. worldInPiecesMissingCount(holder) > 0   -> feasibility (there is something to give back; with nothing lost the effect cannot happen). Not a design condition: staff do not decide
//      whether a lost type exists, so it stays in the class and is shown as "also requires".
// apply (not when simulated), in order:
//   a. state = WORLD_IN_PIECES_STATE.get(holder); none or an empty removed set -> return (a second check, same answer as canApply)
//   b. ONE seeded draw randBattleSeedInt(removedList.length) picks which removed type returns (removedList is the removed set in insertion order)
//   c. the type leaves the removed set, summonData.types is rebuilt from the original list minus the still-removed ones, and the message "<name> reclaimed its <type> form!" is queued
// RNG: exactly one draw per applied KO.
//
// Why a package (honest limit): "give back one random type that this ability took away" reads the same private ledger (original types, removed set) as the other three halves; the vocabulary has no
// effect that adds a type to a Pokemon and no memory of what was taken. The trigger (when I win) is the separate, swappable WHEN, and the only precondition is feasibility. The class has no number,
// type, stat or status to set: it gives back exactly one type per KO, which is structural (the picked type is a random draw, not a setting).
import { WorldInPiecesRestoreAbAttr } from "#data/elite-redux/abilities/world-in-pieces";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(WorldInPiecesRestoreAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-win",
  label: "Win back one lost type after a knockout (World in Pieces)",
  summary: () =>
    "When I knock out a foe, one random type I lost comes back. Example: with three types lost, a knockout leaves me with two missing.",
  synonyms: [
    "world in pieces",
    "regain a type",
    "restore a lost type",
    "get a type back on knockout",
    "heal my typing",
    "reclaim a type",
  ],
  examples: ["Every knockout gives back one of my lost types, like World in Pieces"],
  params: [],
  noParamsReason:
    "Exactly one type returns per KO and which one is a seeded random pick; there is no number, type, stat or status in the class to set. The count of types per KO is structural: changing it would mean re-implementing the ledger code.",
  conditions: [],
  guards: [],
  feasibility: [
    "I must have lost at least one type with this ability, otherwise nothing happens",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: one globalScene.randBattleSeedInt(removedList.length) picks the type that returns (never when simulated)",
    ],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "a battle where I score no KO", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified (see the header). 1 attr in 1 ability: World in Pieces (5917 attr 3). No closure, so no binding. Constructor and showAbility untouched. The only clause of canApply (a type is missing) is feasibility, not a replaceable condition; a library atom 'I have lost at least {n} types' would let it be shown as a condition and is requested as part of R-B15-46. Suspected oddities, NOT fixed: (1) apply repeats the 'nothing lost' test that canApply already made (harmless, same answer); (2) the message is hard-coded English with the lowercase enum name.",
});
