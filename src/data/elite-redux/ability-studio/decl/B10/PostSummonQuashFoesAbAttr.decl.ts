/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 5 / event-effect (Tier A, no condition slot).
//
// Read by hand from archetypes/post-summon-quash-foes.ts. The class extends PostSummonAbAttr (WHEN "when I enter the battle"),
// constructor `{ stages = -6 }` kept in the private field `stages`, `super(true)`. canApply: some opponent (getOpponents) is alive
// (feasibility; no condition). apply: simulated -> nothing; else for every ADJACENT opponent (getAdjacentOpponents) that is not fainted,
// a StatStageChangePhase for Speed by `stages` is unshifted (not self-targeted). No closure, no random draw. The "Quash" of the
// description is modelled by the stage drop: the foe's Speed falls so far that it moves last.
//
// The number of stages is the one setting. The effect is the library's "change a stat" aimed at every foe next to me (the stat is fixed
// to Speed in the class; the library effect has a stat setting, so the declaration keeps it as a note, not a setting). The one clause in
// canApply is feasibility, so there is nothing to replace; extra IFs can be ANDed on top.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostSummonQuashFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-quash-foes";

export default defineDecl(PostSummonQuashFoesAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Slow down every foe's Speed when I enter",
  summary: params =>
    `When I enter the battle, the Speed of every foe next to me changes by ${params.stages} stages (-6 = as slow as possible, so they tend to move last). Example: -6 makes every foe act after me.`,
  synonyms: [
    "make foes move last",
    "quash on entry",
    "lower foe speed on entry",
    "speed drop on switch in",
    "slow the opposing side",
    "rejection",
    "suppress",
  ],
  examples: [
    "When I enter, every foe's Speed drops by 6 stages so they move last, like Rejection",
    "When I enter, every foe's Speed drops by 1 stage",
  ],
  params: [
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Speed stages added to every foe (-6 = as slow as possible, -1 = a little slower)",
      editable: true,
      default: -6,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must still be standing",
    "Only foes next to me are affected (every foe in a normal or double battle)",
    "Foes that already fainted are skipped",
    "It always changes Speed, never another stat",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.stat-stage", params: ["stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with a foe in front of me", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A. Users (2 attrs): Rejection attr 0 (default -6 stages) and Suppress attr 1 (added by the upgrade 'upgrade:suppress:quash', default -6; its attr 0 is a PostSummonScriptedMoveAbAttr that casts Torment); nothing to bind. The effect is the library's 'change a stat by some stages' aimed at every foe next to me; the library effect has no target 'every foe next to me' and the class always uses Speed, so the declaration lists only the stages (request R-B10-c5-02). Oddities, NOT fixed: canApply asks whether ANY opponent is alive (getOpponents) but apply only touches ADJACENT opponents (a living far foe in a triple battle lets it fire with nobody to affect); it is a plain Speed drop, not a real Quash, so a foe that already sits at -6 Speed is not made to move last, and a foe with Clear Body or Mist is protected from it; the stat phase is queued first, ahead of the other entry effects.",
});
