/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-3.1, same
// shape as R-B14-2.3 and R-B12-13); then rename this file to FreeAimAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "My single-target moves go to the foe I can knock out, or else hurt most."
//
// Source: bernerd-roster-mechanics.ts `export class FreeAimAbAttr extends AbAttr {}`: an empty class, a presence marker. Nothing
// dispatches it. Two readers, both by class NAME:
//   MovePhase.resolveRedirectTarget (phases/move-phase.ts:676)   only for a move with exactly one target. Candidates are my living,
//       redirectable foes, sorted by (would KO first, then more damage, then lower battler index); the first becomes the target and
//       the method returns BEFORE Follow Me, Rage Powder and redirecting abilities are asked, so they cannot override it.
//   MoveEffectPhase (phases/move-effect-phase.ts:1067)           after a hit, while hits are left (`turnData.hitsLeft > 1`): the
//       remaining strikes go to the best surviving foe, chosen by the same sort.
// The damage numbers come from `getAttackDamage({ simulated: true })`. No constructor, no closure, no random draw, no state.
// The check is by class name: it must never be renamed.
import { FreeAimAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FreeAimAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Aim my single-target moves at the foe I hurt most",
  summary: () =>
    "While I have this, my single-target moves pick the foe they would knock out, or else hurt most, ignoring Follow Me. Leftover strikes of a multi-hit move go to the best foe still standing.",
  synonyms: [
    "auto aim",
    "best target",
    "pick the target",
    "ignore redirection",
    "ignore follow me",
    "smart targeting",
    "target the weakest",
  ],
  examples: ["In a double battle my attack always goes to the foe it hurts most"],
  params: [],
  noParamsReason:
    "A presence marker read by the move-targeting code; the rule (knock-out first, then most damage, then lowest slot) is engine code, so there is nothing in the class to tune.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only single-target moves are re-aimed (a move that hits several targets is left alone)",
    "Only foes that are still standing and can be targeted are considered",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks in the default battle and the battles must match.",
  probes: [{ name: "the holder attacks a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Free Aim (6090) attr 0 (its only attr). Oddities, not fixed: the re-aim returns before the ordinary redirect pass, so Follow Me, Rage Powder and Lightning Rod style effects can never pull the move (as the code comment says); `canRedirectTo` filters the candidates only in MovePhase, while the multi-hit carry-over in MoveEffectPhase takes every living foe; the damage sort runs a simulated damage calculation for each candidate, which a move with a random effect can answer differently from the real hit.",
});
