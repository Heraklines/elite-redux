/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  FILTER_CHOICES,
  moveFilterCodec,
  NO_FILTER,
  STATUS_NAMES,
  statusNamesCodec,
  TAG_NAMES,
  tagOutcomesCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
// B08 chunk 2 / event-effect, Tier B with RNG in the gate. Read from the source (archetypes/chance-status-on-hit.ts) and from
// the live instances of all 43 attrs. canApply is now, in the ORIGINAL order:
//
//   shortcut 0. a SIMULATED call asks the parent's question (the move is not a status move) and then returns true, with no
//               roll and no pick (the library gate is not used for a simulated call; PostAttack is never dispatched simulated)
//   guards   1. the target has IgnoreMoveEffectsAbAttr (Shield Dust) or is the holder itself                      -> false
//   gate     1b. the move is not a status move (the old parent check, PostAttackAbAttr.attackCondition: it ran FIRST and could
//                not be seen; it is now the first clause of the gate, the atom move.damaging, so staff can see and change it)
//            2. contactExcluded and the move INHERENTLY makes contact (move.hasFlag, Long Reach ignored)           -> false
//            3. contactRequired and !move.doesFlagEffectApply(MAKES_CONTACT, user: holder, target)                -> false
//            4. filter (a move flag via move.hasFlag, or the move's own type: move.type, no ability change)       -> false
//            5. critRequired and the target's first received attack is not critical                               -> false
//            6. the chance roll: chance !== 100 && holder.randBattleSeedInt(100) >= chance -> false              <- RANDOM DRAW 1
//   residual 7. pick one outcome from [...statuses, ...tags] (randBattleSeedInt(n), only with several)           <- RANDOM DRAW 2
//            8. a status: target.canSetStatus(...), a tag: !target.getTag(tag)                                    (feasibility)
//   apply    re-picks (RANDOM DRAW 3, independent of draw 2) and calls trySetStatus / addTag; skipped when simulated.
//
// Unlike the defensive sibling this class has no "the target has no status yet" test, so a tag in the pool changes nothing about
// the gate. The contact settings, the critical-hit setting and the move filter decide the SHAPE of the gate, so they are not
// editable: each user's gate binding spells out its own shape (bindings.ts). The chance is kept equal through gateParams.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ChanceStatusOnAttackAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";

export default defineDecl(ChanceStatusOnAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Sometimes inflict a status on the target of my attack",
  summary: params => {
    const which =
      params.filter === NO_FILTER
        ? params.contactExcluded === true
          ? "one of my moves that does not make contact"
          : params.contactRequired === true
            ? "one of my moves that makes contact"
            : "one of my moves"
        : `one of my ${String(params.filter).toLowerCase()}`;
    const crit = params.critRequired === true ? " as a critical hit" : "";
    const extra = String(params.tags ?? "") === "" ? "" : ` (or ${params.tags})`;
    return `When ${which} hits${crit}, there is a ${params.chance}% chance the target becomes ${params.statuses}${extra}. If several are listed, one is picked at random.`;
  },
  synonyms: [
    "static",
    "flame body",
    "shocking jaws",
    "envenom",
    "virus",
    "assassin's tools",
    "burn chance",
    "paralyze chance",
    "poison chance",
    "status chance on my attack",
    "secondary effect",
  ],
  examples: [
    "50% chance to paralyze the target when I hit with a biting move",
    "30% chance to burn the target when I hit with a Ghost-type move",
  ],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 30,
    },
    {
      id: "statuses",
      ctorIndex: 0,
      ctorOption: "effects",
      path: "effects",
      control: "text",
      label: "Statuses (comma separated; one is picked at random when there are several)",
      editable: true,
      gateIndependent: true,
      default: "Poisoned",
      options: STATUS_NAMES,
      codec: statusNamesCodec,
    },
    {
      id: "tags",
      ctorIndex: 0,
      ctorOption: "tags",
      path: "outcomes",
      control: "text",
      label: "Extra lasting effects in the same random pick (comma separated, may be empty)",
      editable: true,
      gateIndependent: true,
      default: "",
      options: TAG_NAMES,
      codec: tagOutcomesCodec,
    },
    {
      id: "contactRequired",
      ctorIndex: 0,
      ctorOption: "contactRequired",
      path: "contactRequired",
      control: "boolean",
      label: "The move must make contact (set by the conditions)",
      // Decides the SHAPE of the gate (each user's binding spells it out).
      editable: false,
      default: true,
    },
    {
      id: "contactExcluded",
      ctorIndex: 0,
      ctorOption: "contactExcluded",
      path: "contactExcluded",
      control: "boolean",
      label: "Only moves that do not make contact (set by the conditions)",
      editable: false,
      default: false,
    },
    {
      id: "critRequired",
      ctorIndex: 0,
      ctorOption: "critRequired",
      path: "critRequired",
      control: "boolean",
      label: "Only when my attack was a critical hit (set by the conditions)",
      editable: false,
      default: false,
    },
    {
      id: "filter",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "filter",
      control: "select",
      label: "Only for these moves (set by the conditions)",
      // One atom in the gate (a move property or the move's own type): the choice decides the SHAPE of the gate.
      editable: false,
      default: NO_FILTER,
      options: FILTER_CHOICES,
      codec: moveFilterCodec,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is a group of atoms per user shape, in the original order (bindings.ts):
    //   [move.damaging], [not move.inherent-flag MAKES_CONTACT] or [move.flag MAKES_CONTACT], then [move.inherent-flag F] or [move.type T],
    //   then [hit.critical], then rng.chance LAST.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The target must be another Pokemon and must not be protected from added effects (like Shield Dust)",
    "The target must be able to receive the status or lasting effect (nothing blocks it and it does not already have it)",
  ],
  effect: { id: "effect.inflict-status", params: ["statuses", "tags"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply gate: the chance roll (skipped at 100%), only after the contact, move and critical-hit checks passed",
      "canApply residual: pick one outcome (only when there are several statuses and lasting effects)",
      "apply: pick the outcome that is applied (independent of the first pick)",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      // A contact move, a non-contact move, a biting move and a status move: the roll must only be drawn when the gate's cheap checks pass.
      // The enemy is a pure Water type: the default enemy (a Normal-type Snorlax) is immune to a Normal move that an ability
      // turned into a Ghost move (Spectral Shroud), which would keep that ability from ever reaching its after-hit trigger.
      name: "contact, non-contact, biting and status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "BITE", "GROWL"], foeType: ["WATER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = (simulated: the parent's damaging-move question, then true) or guards && gate && residual (a pure move of the original clauses; the outcome pick is a random draw that stays AFTER the chance roll, so it is in the residual). The parent's damaging-move test used to run before everything and out of reach of staff; it is now the first clause of the gate (move.damaging, removable), with the same answer because the guards read nothing random. A simulated call returns true without any roll or pick (so `simulated` is 'respects' for this class, unlike its defensive sibling). Users: contact tier Spectral Shroud, Arc Flash, Venoblaze Pincers, Assassin's Tools (a bleed tag in the pick), Stun Shock, Daybreak, Blight Scale, Crispy Cream (a frostbite tag in the pick), Hypnotic Touch; non-contact tier Static, Flame Body, White Noise, Fire's Wrath, Smoldering Wood; any move Envenom, Chilling Pellets, Komodo; critical hits Fourth Degree, Kagutsuchi; the rest filter by a move property (biting: Shocking Jaws, Flaming Jaws, Flaming Maw, Shocking Maw, Solenoglyphs; slicing: Molten Blades, Lightsaber; horn: Laser Drill) or by the move's own type (Galvanize, Atomic Burst x2, Elemental Charge x2, Archmage x2, Cold Plasma, Sludgy Mix, Molten Coat, Virus, Ghost Pepper, Familiar x2, Thunder Gods Vessel, Malicious Empathy). Galvanize, Atomic Burst (attr 4 and 5), Sludgy Mix, Thunder Gods Vessel and Malicious Empathy also carry an ability-level condition (the holder is of the type) added with addCondition; it is not part of this class and recompose copies it. A filter on one move id or on a move category is supported by the class but used by nobody, and is not representable as a param. Filters by type use move.type (the move's own type) and NOT the type after ability changes, hence move.type with effective false. Siblings (ChanceStatusOnHitAbAttr, ChanceBattlerTagOnAttackAbAttr) are separate classes.",
});
