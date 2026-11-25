/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Third Eye. Read by hand: fakemon-pitch-mechanics.ts `ThirdEyeAbAttr`, its base PostSummonAbAttr (ab-attrs.ts: canApply
// always true), the dispatch `applyAbAttrs("PostSummonAbAttr", ...)` in post-summon-activate-ability-phase.ts, ExposedTag
// (data/battler-tags.ts: IGNORE_DARK lets Psychic moves ignore a Dark type's immunity) and `Pokemon.isOfType`.
//
// canApply: the inherited `true` (no guard, no condition, no feasibility, no residual, no closure).
// apply, unless simulated: for EACH of my opponents (`pokemon.getOpponents()`, fainted or not) that is Dark type
// (`opponent.isOfType(PokemonType.DARK)`), `opponent.addTag(IGNORE_DARK, 0, MoveId.MIRACLE_EYE, holder.id)`. No random draw.
// The per-foe Dark test sits inside the loop: it is part of the effect (which foes it reaches), not a gate on the whole attr.
import { ThirdEyeAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ThirdEyeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Expose the Dark-type foes when I enter",
  summary: () =>
    "When I enter the battle, every Dark-type foe on the field is exposed, so Psychic moves can hit it as if it were not Dark (like Miracle Eye).",
  synonyms: [
    "third eye",
    "miracle eye on entry",
    "psychic hits dark",
    "remove dark immunity",
    "expose dark types",
    "identify foe",
  ],
  examples: ["Let Psychic moves hit Dark-type foes when I switch in", "Cast Miracle Eye on every Dark foe on entry"],
  params: [],
  noParamsReason:
    "The Dark type and the exposed effect are one fixed pair (the Dark-immunity exposure only does something to a Dark type, and the foe filter is the same Dark type), the effect's duration and source move (Miracle Eye) are fixed; there is no number, other type, stat or status to choose.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only Dark-type foes are changed; every other foe is left alone",
    "It reaches the foes on the field at the moment I enter; a Dark foe that enters later is not exposed",
    "It never changes anything for a preview (a simulated entry)",
  ],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry against the grid's foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, no package: the effect is 'put a battle effect on a foe', the library's effect.apply-tag (not implemented yet, request R37: it needs a fixed effect name, a 'only foes of this type' filter, a duration of 0 turns passed to the engine, and the source move for the message). No closure, no gate, so nothing to bind. Zero settings with a written reason (see noParamsReason). Users: Third Eye (6048, attr 0) only. Oddity, not a bug: the dex text says 'when a Dark-type foe enters, identifies it with Miracle Eye', but the class only acts when the HOLDER enters; a Dark foe that comes in later is never exposed. Not changed.",
});
