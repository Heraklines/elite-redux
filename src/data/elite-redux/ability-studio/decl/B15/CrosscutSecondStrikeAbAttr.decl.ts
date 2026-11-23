/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Tier B, calc-modifier. "A single-hit slicing or pulse move strikes TWICE; the second strike uses the opposite category."
//
// Source: src/data/elite-redux/abilities/crosscut.ts, class CrosscutSecondStrikeAbAttr (extends AddSecondStrikeAbAttr; showAbility true).
// canApply is now `gate && residual` (gatedCanApply), in the ORIGINAL clause order, no guard:
//   1. gate       hitCount.value === 1                                              (condition: the move is still a single hit)
//   2. gate       move.category !== STATUS                                         (condition: the move deals damage)
//   3. gate       move.hasFlag(SLICING_MOVE) || move.hasFlag(PULSE_MOVE)            (condition: slicing OR pulse, the PRINTED flag)
//   4. residual   move.canBeMultiStrikeEnhanced(pokemon, true, opponent)            (feasibility: not OHKO, charge, multi-hit or spread: Parental Bond's own filter)
// apply: hitCount.value += 1.
// Second half, outside canApply: `resolveSecondStrikeCategory(move, source, target)` is found BY NAME in Pokemon.getAttackDamage (pokemon.ts, the
// constructor.name check) and flips the category of strike index 1 (the second) with the same four-part eligibility test; the first strike keeps
// its native category. It reads no state and draws nothing.
// Dispatch: Move.getHitCount / the multi-strike seam, applyAbAttrs("AddSecondStrikeAbAttr") (WHEN calc.hit-count). No random draw, no state.
// The gate is bound as a LEGACY closure: clause 3 is `move.hasFlag` (the move's own printed flags). The library atom move.flag asks
// Move.doesFlagEffectApply, which also counts flags injected by abilities (Rapier and other flag-injection attrs) and would differ for such a holder.
// A library atom for the printed flag is requested (R-B15-6).
import { CrosscutSecondStrikeAbAttr } from "#data/elite-redux/abilities/crosscut";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CrosscutSecondStrikeAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Strike a second time with slicing and pulse moves",
  summary: () =>
    "While the game decides how many times a move hits, a single-hit damaging slicing or pulse move strikes twice. The second strike uses the opposite category (physical or special).",
  synonyms: [
    "crosscut",
    "double strike",
    "hit twice",
    "second hit",
    "extra strike",
    "slicing moves hit twice",
    "parental bond",
  ],
  examples: ["My slicing and pulse moves hit twice, once physical and once special"],
  params: [],
  noParamsReason:
    "The class always adds exactly one extra strike and flips the category of that second strike; the number of strikes is not a setting (the 2-strike shape is what the category flip is built around). The power of each strike is the separate block for Crosscut's power rider, which has its own multiplier.",
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The move must be one that can be split into strikes: no one-hit KO moves, charge moves, spread moves or moves that already hit several times",
  ],
  effect: { id: "effect.hit-n-times", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table lists calc.hit-count as unreached because no scenario template drives a multi-strike moment; the single-hit slicing move of the holder is compared in the B15 chunk 2 probes instead.",
  probes: [{ name: "the holder attacks with a slicing move, a pulse move and a Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, gate LEGACY (pending request R-B15-6). 1 attr: Crosscut (5908 attr 0; attr 1 is the power rider CrosscutPowerAbAttr, same eligibility). The gate is split off and ready: once the librarian adds a printed-flag atom the legacy binding becomes all[ not move.multi-hit (hits.count is hitCount.value, equal to 1 for a single hit), move.damaging, any[ printed flag SLICING, printed flag PULSE ] ]. The second half (category flip of strike two) is a method the engine finds by constructor name, so a rebuilt instance keeps it as long as it is a CrosscutSecondStrikeAbAttr. Pair: CrosscutPowerAbAttr. Suspected oddity, NOT fixed: resolveSecondStrikeCategory repeats the full eligibility test on every hit instead of remembering the decision made when the hit count was raised, so a move whose eligibility changes between strike one and two could flip the category on a strike that was never added by this attr.",
});
