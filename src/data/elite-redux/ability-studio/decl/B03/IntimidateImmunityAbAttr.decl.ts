/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, calc-modifier (a "cancel check").
//
//   canApply   !cancelled.value     inherited from CancelInteractionAbAttr: "nothing cancelled it yet"
//   apply      cancelled.value = true   inherited as well
//
// The class has no constructor argument, no closure and no clause of its own (`super(false)` hides the ability flyout; it
// still owns getTriggerMessage). `canApply` is not a rule staff would tune: it only keeps a second blocker from
// "blocking again", so it is effect-side feasibility. Nothing to bind, nothing to refactor.
//
// Dispatch: the Intimidate-family summon effect (PostSummonStatStageChangeAbAttr, ab-attrs.ts near line 3086) calls
// applyAbAttrs("IntimidateImmunityAbAttr", ...) on EACH foe it would hit, BEFORE it calls
// applyAbAttrs("PostIntimidateStatStageChangeAbAttr", ...), then cancels the drop when `cancelled` is true.
// The ER archetype subclass IntimidateImmunityAbAttrEr (status-immunity.ts) is a separate class with its own declaration.
import { IntimidateImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IntimidateImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.intimidate",
  label: "Block Intimidate and similar stat drops on me",
  summary: () =>
    "While the game checks whether Intimidate lands on me, it is blocked. Example: a foe's Intimidate does not lower my Attack.",
  synonyms: [
    "immune to intimidate",
    "inner focus",
    "own tempo",
    "oblivious",
    "scrappy",
    "block attack drop on entry",
    "ignore intimidate",
  ],
  examples: ["Intimidate and Scare no longer lower my stats", "Immune to Intimidate like Inner Focus"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: it is a plain 'Intimidate cannot land on me' switch, so there is no number, type or stat to set.",
  conditions: [],
  guards: [],
  feasibility: ["Nothing else has already blocked the same Intimidate"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe enters with Intimidate", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 15 attrs of 14 abilities, none with a closure: Oblivious (12), Own Tempo (20), Inner Focus (39), Scrappy (113), Fighting Spirit (5038), Enlightened (5219), Unlocked Potential (5365), Way of Precision (5383), Blind Rage (5397), Qigong (5463), Overrule (5516), Bird of Prey (5704), Monk (6083) and Heartless Style (20008, which carries it twice, at attrs 1 and 6). `apply` ignores `simulated` (it only flips a flag). The effect is a cancel check, so it uses the existing 'Block it' effect. showAbility is false, so no flyout shows; the trigger message ('X's Y prevented it from being Intimidated!') is only built, never queued by the dispatcher. Quirk recorded, not fixed: the dispatcher passes ONE shared `cancelled` holder, and PostIntimidateStatStageChangeAbAttr.apply then WRITES `cancelled.value = this.overwrites`, so a Pokemon that has both this block and a non-overwriting reaction (Rattled style) would have the block undone by the reaction. No shipped ability has both.",
});
