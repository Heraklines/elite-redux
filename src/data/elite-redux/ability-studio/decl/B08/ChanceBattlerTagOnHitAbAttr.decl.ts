/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  TAG_NAMES,
  tagNamesCodec,
  turnRangeCodec,
  zeroMeansDefaultCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
// B08 chunk 2 / event-effect, Tier B with RNG in the gate. Read from the source (archetypes/chance-status-on-hit.ts) and from
// the live instances of all 16 users. canApply is now `gate && residual`, in the original clause order:
//
//   gate     1. contactExcluded: the move INHERENTLY makes contact (move.hasFlag, ignoring Long Reach) or the hit is not a damaging
//               one (EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE, ONE_HIT_KO) -> false
//            2. contactRequired and !move.doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder) -> false
//            3. filter (flag, type, move id or category): no live user sets one, the clause stays in the class
//            4. the chance roll: effChance !== 100 && holder.randBattleSeedInt(100) >= effChance -> false   <- RANDOM DRAW 1
//               (effChance is firstTurnChance on the holder's first turn, when the user sets one: Talon Trap)
//   residual 5. pick one tag (randBattleSeedInt(n), only with several tags)                               <- RANDOM DRAW 2
//            6. attacker.canAddTag(tag)                                                                   (feasibility)
//   apply    re-picks (RANDOM DRAW 3, independent of draw 2), then addTag(tag, turns); the turns are rolled with
//            randBattleSeedIntRange for confusion (2 to 5) and for a turn range (Grip Pincer style); skipped when simulated.
//
// The class ignores `simulated` in canApply (it draws even for a simulated call), exactly like ChanceStatusOnHitAbAttr. The
// compiled gate differs there: the library atom rng.chance answers true without a draw when `simulated`, so a compiled rule
// does not roll on a simulated call. PostDefend is only dispatched with simulated false (move-effect-phase.ts), so no live
// difference exists.
//
// The two contact SETTINGS (contactRequired, contactExcluded) and firstTurnChance change the SHAPE of the gate, so they are
// not editable: each user's gate binding spells out its own shape (bindings.ts). The chance is repeated in the gate's
// `rng.chance` atom and is kept equal through gateParams. Which tag, the turns and the damage share are only read by the
// effect, so they are editable without touching the gate.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ChanceBattlerTagOnHitAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";

export default defineDecl(ChanceBattlerTagOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Sometimes put a lasting effect on who hits me",
  summary: params => {
    const how =
      params.contactExcluded === true
        ? "a move that does not make contact"
        : params.contactRequired === true
          ? "a move that makes contact"
          : "any move";
    const first =
      Number(params.firstTurnChance) > 0
        ? ` On my first turn after entering the chance is ${params.firstTurnChance}%.`
        : "";
    return `When ${how} hits me, there is a ${params.chance}% chance the attacker becomes ${params.tags}. If several are listed, one is picked at random.${first}`;
  },
  synonyms: [
    "freezing point",
    "spike armor",
    "cute charm",
    "talon trap",
    "bleed on contact",
    "frostbite on contact",
    "confuse on contact",
    "trap the attacker",
    "punish attackers",
    "lasting effect when hit",
  ],
  examples: [
    "30% chance to make an attacker bleed when it makes contact with me",
    "20% chance to frostbite attackers that make contact, 30% for moves that do not",
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
      id: "tags",
      ctorIndex: 0,
      ctorOption: "tags",
      path: "tags",
      control: "text",
      label: "What the attacker becomes (comma separated; one is picked at random when there are several)",
      editable: true,
      gateIndependent: true,
      default: "Confused",
      options: TAG_NAMES,
      codec: tagNamesCodec,
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
    {
      id: "turns",
      ctorIndex: 0,
      ctorOption: "turns",
      path: "turns",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of turns the effect lasts (0 = the game's usual length)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
    {
      id: "turnRange",
      ctorIndex: 0,
      ctorOption: "turnRange",
      path: "turnRange",
      control: "text",
      label: "Random number of turns, from-to (for example 4-5; leave empty when you set the number of turns)",
      editable: true,
      gateIndependent: true,
      default: "",
      codec: turnRangeCodec,
    },
    {
      id: "damageDenominator",
      ctorIndex: 0,
      ctorOption: "damageDenominator",
      path: "damageDenominator",
      control: "number",
      min: 0,
      max: 32,
      step: 1,
      integer: true,
      label: "Damage each turn as 1 divided by this number of max HP (0 = the effect's own amount)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
    {
      id: "firstTurnChance",
      ctorIndex: 0,
      ctorOption: "firstTurnChance",
      path: "firstTurnChance",
      control: "number",
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%) on my first turn after entering (0 = the same chance as always) (set by the conditions)",
      // Decides the SHAPE of the gate (an "on my first turn" alternative in front of the roll).
      editable: false,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is a group of atoms per user shape, in the original order (bindings.ts):
    //   contact tier:     [move.flag MAKES_CONTACT, rng.chance]
    //   non-contact tier: [not move.inherent-flag MAKES_CONTACT, hit.landed-damage, rng.chance]
    //   any move:         [rng.chance]
    //   first-turn boost: [move.flag MAKES_CONTACT, any[time.first-turn, rng.chance]]
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The attacker must be able to receive the effect (nothing blocks it and it does not already have it)"],
  effect: { id: "effect.apply-tag", params: ["tags", "turns", "turnRange", "damageDenominator"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply gate: the chance roll (skipped at 100%, or on my first turn when a first-turn chance is set to 100), after the contact and move checks passed",
      "canApply residual: pick one effect (only when there are several)",
      "apply: pick the effect that is applied (independent of the first pick), then roll the number of turns for confusion (2 to 5) or for a turn range",
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
    "Tier B split by hand: canApply = gate && residual (a pure move of the original clauses; the tag pick is a random draw that stays AFTER the chance roll, so it is in the residual). Users (16), every gate bound: contact tier Itchy Defense, Yuki Onna, Spike Armor, Fragrant Daze, Menacing Situation, Blood Stain, Decomposer, Freezing Point/Cryo Proficiency/Cryogenesis (the contact half); the non-contact tier (contactExcluded) is the second attr of Freezing Point, Cryo Proficiency and Cryogenesis; Voodoo Power and Snowy Wrath have neither setting (any move, the gate is only the roll); Talon Trap has firstTurnChance 100, spelled any[time.first-turn, rng.chance] so the roll is skipped on the first turn exactly like the class (waveTurnCount === 1). The filter option of the options type is never set by a live user and stays in the class. Unlike ChanceStatusOnHitAbAttr this class has no 'attacker already has a status' test (a lasting effect can land on a statused attacker). The class ignores `simulated` in canApply (draws and rolls even when simulated; the library atom rng.chance answers true without a draw when simulated). apply ignores a simulated call. Siblings (ChanceStatusOnHitAbAttr, ChanceBattlerTagOnAttackAbAttr) are separate classes.",
});
