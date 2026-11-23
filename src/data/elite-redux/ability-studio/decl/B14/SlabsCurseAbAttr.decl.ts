/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. Tier B, event-effect. "When a foe's damaging move knocks me out, that foe's moves start losing PP every turn."
//
// Source: fakemon-pitch-mechanics.ts SlabsCurseAbAttr (extends PostFaintAbAttr; dispatched as PostFaintAbAttr by the faint code).
// canApply, original clause order, now `guards && gate`:
//   guards  1. attacker !== undefined                  somebody made me faint (not a weather or poison faint)
//           2. attacker !== pokemon                     not myself
//   gate    3. attacker.isPlayer() !== pokemon.isPlayer()   the culprit is a foe
//           4. move !== undefined                       (part of 5 for the library: a move exists)
//           5. move.category !== STATUS                 the faint came from a damaging move
// Nothing is random. Clauses 1 and 2 are guards: without a culprit there is nobody to curse, and the holder cursing itself is a
// bug, not a design. Clauses 3 to 5 are the conditions staff may change ("any culprit", "only contact KOs", ...).
// Library form of the gate: all[ side.is { kind: foe }, move.damaging ], same order (side.is is false without an `other`, and
// move.damaging is false without a move, which is what clause 4 tests).
//
// apply (`simulated` returns first, like every effect here):
//   attacker.addTag(ER_SLAB_CURSE, ppLoss, CURSE, holder.id)                       the culprit's moves lose `ppLoss` PP every turn end
//   for each adjacent ally of the culprit that is not fainted: addTag(ER_SLAB_CURSE, allyPpLoss, CURSE, holder.id)
// The tag (SlabCurseTag in battler-tags.ts) lapses at the end of the turn: every move of the cursed Pokemon uses `ppLoss` PP, and
// the curse ends the first time one of those moves has no PP left. The PP number is the `turnCount` argument of addTag.
//
// Ability level: Slab's Curse also has `bypassFaint()` (the ability still runs although the holder fainted). That is a
// blueprint-level flag, not part of this class.
import { SlabsCurseAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SlabsCurseAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.faint",
  label: "Lay a PP-draining curse on the foe that knocked me out",
  summary: params =>
    `Each turn, every move of the foe that knocked me out loses ${params.ppLoss} PP, and each move of its neighbouring allies loses ${params.allyPpLoss} PP. It ends when one of those moves has no PP left.`,
  synonyms: ["slab's curse", "pp drain", "pp curse", "revenge curse", "spite", "last words", "drain pp"],
  examples: ["When a foe knocks me out, its moves lose 2 PP every turn"],
  params: [
    {
      id: "ppLoss",
      ctorIndex: 0,
      path: "ppLoss",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "PP lost by each of the foe's moves every turn",
      editable: true,
      default: 2,
      gateIndependent: true,
    },
    {
      id: "allyPpLoss",
      ctorIndex: 1,
      path: "allyPpLoss",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "PP lost every turn by each move of the foe's neighbouring allies",
      editable: true,
      default: 1,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [the culprit is a foe, the faint came from a damaging move], in that order. Removable.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A different Pokemon must have knocked me out (no culprit, or myself, means nothing happens)",
    "A foe that is already cursed this way is not cursed again",
    "Only the foe's neighbouring allies that are still standing are cursed too",
  ],
  effect: { id: "effect.apply-tag", params: ["ppLoss", "allyPpLoss"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe's damaging move knocks the holder out", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "The shared scenario for the faint moment (the holder faints to the enemy's attack, with no teammate) is listed as unreached. This declaration's probe uses the same scenario, and the twin shows the original evaluating the attr and the rebuild behaving the same. B14/chunk2-gate-split.test.ts also compares the split canApply with the original expression for every culprit and move, and runs a real battle (a teammate in reserve) in which a foe's Tackle knocks the holder out and the foe ends with the PP curse.",
  status: "decomposed",
  notes:
    "Tier B. The PP numbers (2 for the culprit, 1 for each neighbouring ally) were hard-coded; they are now constructor arguments 0 and 1 with the same defaults and editable params (1 to 10, because 0 would give a curse that never ends and never does anything). The curse tag itself (ER_SLAB_CURSE) is fixed: it is the whole point of the ability and the block is named after the effect, not the tag. Users (1): Slab's Curse (6066) attr 0; the ability also has the ability-level bypassFaint() flag. Gate bound to all[side.is foe, move.damaging]. Guards are not registered yet (requested: killed-by-another-pokemon). Oddities, not fixed: the faint must come from a damaging move (clause 5), so a knock-out that reports a status move does nothing, which matches the ability text; the curse is also laid on the culprit's neighbouring allies that are still standing, with the smaller PP number.",
});
