/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 5 / event-effect (Tier A, no condition slot).
//
// Read by hand from archetypes/post-turn-apply-tag-on-foes.ts. The class extends PostTurnAbAttr (WHEN "at the end of every turn"),
// constructor `{ tag, turns }` kept in the private fields `tag` and `turns`, `super()`. canApply: some opponent (getOpponents) is alive
// (feasibility; no condition). apply: simulated -> nothing; else for every ADJACENT opponent (getAdjacentOpponents) that is not fainted:
// opp.addTag(tag, turns, undefined, holder.id). No closure, no random draw. It is the refresh half of Permanence: the entry half is
// PostSummonApplyTagOnFoesAbAttr, and a short duration (2 turns) keeps the effect fresh while the holder stays on the field.
//
// The tag and the number of turns are two settings. The effect is the library's "apply a lasting effect" (effect.apply-tag, planned,
// not compiled yet) aimed at the foes next to me.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostTurnApplyTagOnFoesAbAttr } from "#data/elite-redux/archetypes/post-turn-apply-tag-on-foes";
import { FOE_TAGS } from "./c4-codecs";

export default defineDecl(PostTurnApplyTagOnFoesAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Keep a lasting effect on every foe at the end of each turn",
  summary: params =>
    `At the end of every turn, every foe next to me gets "${params.tag}" again for ${params.turns} turns, so it lasts while I stay in battle. Example: Heal block for 2 turns keeps foes from healing.`,
  synonyms: [
    "refresh a debuff every turn",
    "keep heal block up",
    "permanence",
    "reapply an effect each turn",
    "constant debuff on the foes",
    "foes cannot heal while I am here",
    "turn end curse on the opposing side",
  ],
  examples: [
    "At the end of every turn, every foe cannot heal for 2 more turns, like Permanence",
    "At the end of every turn, every foe is tormented again for 2 turns",
  ],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      ctorOption: "tag",
      path: "tag",
      control: "select",
      label: "Lasting effect the foes get (Heal block = cannot heal)",
      editable: true,
      default: "HEAL_BLOCK",
      options: [...FOE_TAGS],
    },
    {
      id: "turns",
      ctorIndex: 0,
      ctorOption: "turns",
      path: "turns",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of turns the effect lasts each time it is renewed (1-10)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must still be standing",
    "Only foes next to me are affected (every foe in a normal or double battle)",
    "Foes that already fainted are skipped",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.apply-tag", params: ["tag", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "end of turn with a foe in front of me", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A. Users (1 attr): Permanence attr 1 (Heal block, 2 turns; its attr 0 is PostSummonApplyTagOnFoesAbAttr, Heal block for 5 turns); nothing to bind. The effect is the library's 'apply a lasting effect' (effect.apply-tag is planned and not compiled yet; it needs the target choice 'every adjacent foe' and the holder as the source of the tag, request R-B10-c4-04 from chunk 4, which this class shares). Oddities, NOT fixed: canApply asks whether ANY opponent is alive (getOpponents) but apply only touches ADJACENT opponents; the tag is stamped with the holder as its source, so it is not removed when the holder leaves, it just runs out.",
});
