/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B).
//
// TWO CLASSES SHARE THIS NAME. The batch worklist points at archetypes/post-attack-remove-target-type.ts, but the class that
// the live `AbilityAttrs` map holds (and that 5 of the 6 live attrs are instances of) is the one in abilities/ab-attrs.ts
// (ER Illuminate's rewrite constructs it with a bare type). The registry is keyed by class name, so this declaration is for the
// ab-attrs class, and the archetype class of the same name (Refrigerator attr 3, built by the dispatcher with `{ type }`) is
// bound as a written legacy gate: a declaration cannot build both. See notes.
//
// Read by hand from abilities/ab-attrs.ts. The class extends PostAttackAbAttr (WHEN "after my attack lands"), constructor
// `(removedType)`, `super(undefined, false)`. canApply in the ORIGINAL clause order:
//   1. parent rule: the move is a damaging move                       gate      (library move.damaging)
//   2. pokemon !== opponent                                           guards    (pure read; moved in front of clause 1)
//   3. move.category !== STATUS (a duplicate of clause 1)             gate      (kept as written, it is the same test)
//   4. opponent.isOfType(removedType)                                 gate      (library mon.has-type, who other)
//   5. NOT (opponent is Terastallized AND its Tera type is the removed type)   residual  (feasibility)
// no prepare, no random draw. apply: simulated -> nothing; else target.summonData.types = its types without the removed one
// (UNKNOWN when none is left) and the info box is refreshed.
//
// Clause classification: "the target has the type" and "the move deals damage" are rules staff would change, so they are the
// replaceable gate (the type is the class's one setting and is repeated in the gate through `gateParams`). The Tera exception
// is feasibility. The effect has no library block (no "remove a type" effect), so it is a package with one typed setting.
import { PostAttackRemoveTargetTypeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(PostAttackRemoveTargetTypeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Strip one type from the target after my attack",
  summary: params =>
    `After my attack hits a target that has the ${params.type} type, it loses that type and keeps its others. A target with no type left becomes typeless. A Terastallized target keeps its Tera type.`,
  synonyms: [
    "remove a type from the target",
    "strip the ghost type",
    "lose a typing on hit",
    "type removal",
    "illuminate",
    "refrigerator",
    "foresight on hit",
  ],
  examples: [
    "When I hit a Ghost type, it loses the Ghost type so Normal and Fighting moves can hit it, like Illuminate",
    "My attacks remove the Ground type from the target",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "removedType",
      control: "select",
      label: "Type to remove from the target",
      editable: true,
      default: "GHOST",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  // The gate repeats the type in its mon.has-type atom; the slider moves both.
  gateParams: [{ param: "type", block: "mon.has-type", field: "type" }],
  conditions: [
    // The gate: all[ move.damaging, mon.has-type other <type> ] (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The target must be a different Pokemon from me",
    "A target that is Terastallized into that type keeps it",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a damaging and a status move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: not myself; gate: damaging, has the type; residual: Tera exception). Users (5 attrs of the ab-attrs class): Illuminate attr 1, Chandelier attr 1, Depth Explorer attr 2, Spectacle attr 3 and Refrigerator attr 2, all Ghost, all bound as all[move.damaging, mon.has-type other GHOST]. The sixth attr of this name, Refrigerator attr 3, is an instance of the ARCHETYPE class of the same name (fields stripType and contactOnly, default fallback NORMAL, no Tera exception, no self check): it is bound as a legacy gate because one declaration cannot build both classes (the build would make the ab-attrs class). Both attrs strip the same type, so the second one never finds the type left. Package justified: no library effect removes a type (R-B10-c3-05); its one setting is typed. Oddities, NOT fixed: two different classes share one name (the second is dead weight for Refrigerator and the dispatcher case 499 adds it on top of Illuminate's rewrite); the ab-attrs class would throw on a missing target (opponent.isOfType) where the library atom answers false, which no engine path produces; the archetype class falls back to NORMAL while this one falls back to UNKNOWN.",
});
