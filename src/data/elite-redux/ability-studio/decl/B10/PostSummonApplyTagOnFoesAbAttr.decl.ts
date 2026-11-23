/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / event-effect (Tier A, no condition slot).
//
// Read by hand from archetypes/post-summon-apply-tag-on-foes.ts. The class extends PostSummonAbAttr (WHEN "when I enter the battle"),
// constructor `{ tag, turns }` kept in the private field `opts`, `super(true)`. canApply: some opponent (getOpponents) is alive
// (feasibility; no condition). apply: simulated -> nothing; else for every ADJACENT opponent (getAdjacentOpponents) that is not
// fainted: opp.addTag(tag, turns, undefined, holder.id). No closure, no random draw.
//
// The tag and the number of turns are two settings. The effect is the library's "apply a lasting effect" (effect.apply-tag, planned,
// not compiled yet) aimed at the foes next to me. The one clause in canApply is feasibility, so there is nothing to replace; extra IFs
// can be ANDed on top.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostSummonApplyTagOnFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-apply-tag-on-foes";
import { optionNumber } from "./b10-codecs";
import { FOE_TAGS, optionText } from "./c4-codecs";

export default defineDecl(PostSummonApplyTagOnFoesAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Put a lasting effect on every foe when I enter",
  summary: params =>
    `When I enter the battle, every foe next to me gets "${params.tag}" for ${params.turns} turns. Example: Heal block for 5 turns stops them healing.`,
  synonyms: [
    "heal block on entry",
    "debuff the foes on entry",
    "permanence",
    "mashed potato",
    "syrup bomb on entry",
    "curse the foes when I arrive",
    "lasting effect on the opposing side",
  ],
  examples: [
    "When I enter, every foe cannot heal for 5 turns, like Permanence",
    "When I enter, every foe is covered in syrup for 3 turns, like Mashed Potato",
  ],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      ctorOption: "tag",
      path: "opts",
      control: "select",
      label: "Lasting effect the foes get (Heal block = cannot heal)",
      editable: true,
      default: "HEAL_BLOCK",
      options: [...FOE_TAGS],
      codec: optionText("tag"),
    },
    {
      id: "turns",
      ctorIndex: 0,
      ctorOption: "turns",
      path: "opts",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of turns the effect lasts (1-10)",
      editable: true,
      default: 3,
      codec: optionNumber("turns"),
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
  probes: [{ name: "entry with a foe in front of me", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A. Users (2 attrs): Permanence attr 0 (Heal block, 5 turns, refreshed every turn end by PostTurnApplyTagOnFoesAbAttr at attr 1) and Mashed Potato attr 0 (Syrup bomb, 3 turns); nothing to bind. The effect is the library's 'apply a lasting effect' (effect.apply-tag is planned and not compiled yet; it also needs the target choice 'every adjacent foe' and the holder as the source of the tag, request R-B10-c4-04). The lasting effects on the list are the ones that make sense on a foe; only Heal block and Syrup bomb are used by live abilities, the others were not tried in a battle. Oddity, NOT fixed: canApply asks whether ANY opponent is alive (getOpponents) but apply only touches ADJACENT opponents; in a triple battle a living far foe lets the ability fire with nobody to affect.",
});
