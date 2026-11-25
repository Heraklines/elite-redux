/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B).
//
// Read by hand from archetypes/post-attack-contact-suppress-target-ability.ts. The class extends PostAttackAbAttr (WHEN "after my
// attack lands"), constructor `{ requireTargetStatus?, contactOnly? }` (defaults: no status wanted, contact required),
// `super(undefined, false)`; its canApply never calls the parent's rule. canApply in the ORIGINAL clause order:
//   1. there is a target and it is still standing           guards    (feasibility: a fainted target has no ability to suppress)
//   2. move.is("AttackMove")                                guards    (a class test, NOT the same as 'category is not STATUS'; request R-B10-c3-12)
//   3. contactOnly: move.doesFlagEffectApply(MAKES_CONTACT, user: holder, target)    gate    (library move.flag)
//   4. requireTargetStatus: the target's status is in the list                       gate    (library status.has, who other)
//   5. the target's ability is not already suppressed       residual  (feasibility, stays in the class)
// no prepare, no random draw. apply: simulated or no target -> nothing; else summonData.abilitySuppressed = true on the target
// (for the rest of the time it stays in) and the info box is refreshed.
//
// Clause classification: the contact and status tests are rules staff would change ("any move", "burned targets
// instead of poisoned ones") so they are the replaceable gate. The target tests and "already suppressed" are feasibility.
// The effect has no library block (no "suppress an ability" effect), so it is a package without numeric settings; the contact
// rule and the wanted statuses are two non-editable settings that only shape the class's own default gate.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STATUS_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostAttackContactSuppressTargetAbilityAbAttr } from "#data/elite-redux/archetypes/post-attack-contact-suppress-target-ability";
import { buildContactSuppressOptions, NOTHING, statusListCodec } from "./c3-codecs";

export default defineDecl(PostAttackContactSuppressTargetAbilityAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Switch off the target's ability after my attack",
  summary: () =>
    "After my attack hits, the target's ability stops working for as long as it stays in. It does nothing if the ability is already switched off.",
  synonyms: [
    "suppress the target's ability",
    "disable the foe's ability",
    "ability removal on hit",
    "gastro acid on hit",
    "neutralize the ability",
    "hemotoxin",
  ],
  examples: [
    "When my contact move hits a poisoned target, its ability is switched off, like Hemotoxin",
    "Every attack I land turns the target's ability off",
  ],
  params: [
    {
      id: "contactOnly",
      ctorIndex: 0,
      ctorOption: "contactOnly",
      path: "contactOnly",
      control: "boolean",
      label: "Built-in rule: only moves that make contact count (replaced by the condition block you set)",
      editable: false,
      default: true,
    },
    {
      id: "status",
      ctorIndex: 0,
      ctorOption: "status",
      path: "requireTargetStatus",
      control: "select",
      label: "Built-in rule: status the target must have (None = any; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      options: [NOTHING, ...STATUS_OPTIONS],
      codec: statusListCodec(0),
    },
    {
      id: "status2",
      ctorIndex: 0,
      ctorOption: "status2",
      path: "requireTargetStatus",
      control: "select",
      label: "Built-in rule: a second status that also counts (None = only the first; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      options: [NOTHING, ...STATUS_OPTIONS],
      codec: statusListCodec(1),
    },
  ],
  assembleCtorArg: { index: 0, build: buildContactSuppressOptions },
  conditions: [
    // The gate: all[ move.damaging, move.flag MAKES_CONTACT, any[ status.has other POISON, status.has other TOXIC ] ] (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "There must be a target and it must still be standing",
    "Nothing happens if the target's ability is already switched off",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact and non-contact hit", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: a standing target and an attack move; gate: contact, status list; residual: not already suppressed). Only user: Hemotoxin (attr 0, contact required, target poisoned or badly poisoned), bound as all[move.flag MAKES_CONTACT, any[status.has other POISON, status.has other TOXIC]]. Package justified: no library effect switches off an ability (R-B10-c3-04); the effect has no number, type or stat to set, so it has no editable setting. The class tests move.is('AttackMove') (a class check) and the library atom move.damaging tests category != STATUS: they DIFFER for nine moves (Whirlwind, Growl, Poison Gas, Flash, Splash, Nightmare, Captivate, Octolock and Decorate are status-class moves whose category is not STATUS), so the class test stays a guard and is not replaced by move.damaging (R-B10-c3-12 asks for an exact atom). The wanted-status list takes up to two statuses as settings (the class takes any list). Oddities, NOT fixed: the effect is permanent for the stay (summonData.abilitySuppressed has no end), the class does not check that the holder's own move actually damaged (a damaging move that missed never reaches this hook); the banner is not shown (showAbility false).",
});
