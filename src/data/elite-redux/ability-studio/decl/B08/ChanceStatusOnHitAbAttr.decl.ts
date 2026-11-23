/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / event-effect, Tier B with RNG in the gate. Read from the source (archetypes/chance-status-on-hit.ts) and from
// the live instances of all 10 users. canApply is now `gate && residual`, in the original clause order:
//
//   gate     1. contactExcluded: the move INHERENTLY makes contact (move.hasFlag, ignoring Long Reach) -> false; and the
//               hit result must be a damaging one (EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE, ONE_HIT_KO) -> else false
//            2. contactRequired and !move.doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder) -> false
//            3. filter (flag, type, move id or category): no live user sets one, the clause stays in the class
//            4. no tag outcome and attacker.status -> false (a status blocks a new status; a tag does not)
//            5. the chance roll: chance !== 100 && holder.randBattleSeedInt(100) >= chance -> false   <- RANDOM DRAW 1
//   residual 6. pick one outcome from [...statuses, ...tags] (randBattleSeedInt(n), only with several) <- RANDOM DRAW 2
//            7. a status: attacker.canSetStatus(...), a tag: !attacker.getTag(tag)                       (feasibility)
//   apply    re-picks (RANDOM DRAW 3, independent of draw 2) and calls trySetStatus / addTag; skipped when simulated.
//
// The class ignores `simulated` in canApply (it draws even for a simulated call), as the precedent for contact status.
//
// The two contact SETTINGS (contactRequired, contactExcluded) and the TAGS list change the SHAPE of the gate, so they
// are not editable: each user's gate binding spells out its own shape (bindings.ts). The chance is repeated in the
// gate's `rng.chance` atom and is kept equal through gateParams.
import {
  STATUS_NAMES,
  statusNamesCodec,
  TAG_NAMES,
  tagOutcomesCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ChanceStatusOnHitAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";

export default defineDecl(ChanceStatusOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Chance to give the attacker a status when it hits me",
  summary: params => {
    const how =
      params.contactExcluded === true
        ? "a move that does not make contact"
        : params.contactRequired === true
          ? "a move that makes contact"
          : "a move";
    const extra = String(params.tags ?? "") === "" ? "" : ` (or ${params.tags})`;
    return `When ${how} hits me, there is a ${params.chance}% chance the attacker becomes ${params.statuses}${extra}. If several are listed, one is picked at random.`;
  },
  synonyms: [
    "static",
    "flame body",
    "poison point",
    "paralyze on hit",
    "burn on hit",
    "status when hit",
    "counter status",
    "touch me and suffer",
  ],
  examples: [
    "30% chance to paralyze attackers that make contact",
    "20% chance to burn attackers that do not make contact",
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
      label: "Extra lasting effects in the same random pick (comma separated, may be empty) (set by the conditions)",
      // A tag outcome removes the "attacker has no status" check from the gate, so this changes the gate's SHAPE.
      editable: false,
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
      label: "Only moves that do not make contact (and only damaging hits) (set by the conditions)",
      editable: false,
      default: false,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is a group of atoms per user shape, in the original order (bindings.ts):
    //   contact tier:  [move.flag MAKES_CONTACT, status.has other NONE, rng.chance]  (a tag outcome drops status.has)
    //   non-contact tier: [not move.inherent-flag MAKES_CONTACT, hit.landed-damage, status.has other NONE, rng.chance]
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The attacker must be able to receive the status or lasting effect (it is not immune and nothing blocks it)",
  ],
  effect: { id: "effect.inflict-status", params: ["statuses", "tags"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply gate: the chance roll (skipped at 100%), only after the contact, move and no-status checks passed",
      "canApply residual: pick one outcome (only when there are several statuses and tags)",
      "apply: pick the outcome that is applied (independent of the first pick)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // A contact move, a non-contact move and a status move: the roll must only be drawn when the gate's cheap checks pass.
      name: "contact, non-contact and status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = gate && residual (a pure move of the original clauses; the outcome pick is a random draw that stays AFTER the chance roll, so it is in the residual). Users (10), all 10 gates bound: contact tier Poison Touch, Super Hot Goo, Arc Flash, Daybreak, Hypnotic Touch, Crispy Cream (a frostbite tag in the pick: no status.has), and the non-contact tier Static, Flame Body, White Noise, Smoldering Wood (atoms move.inherent-flag, which ignores Long Reach, and hit.landed-damage, which keeps Growl from proccing, added to the library). The filter, moveIds-style options and firstTurnChance of the options type are never set by a live user and stay in the class. The class ignores `simulated` in canApply (draws and rolls even when simulated; the library atom rng.chance answers true without a draw when simulated). Siblings (ChanceBattlerTagOnHitAbAttr, ChanceStatusOnAttackAbAttr) are separate classes.",
});
