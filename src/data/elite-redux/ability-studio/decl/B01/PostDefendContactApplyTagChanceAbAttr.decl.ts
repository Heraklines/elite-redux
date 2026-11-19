/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 4, Tier B event-effect with a random draw in `canApply`. "When a contact move hits me, there is a chance the
// attacker gets a battle effect (Infatuated, Trapped, Frostbite)."
//   canApply (now `gatedCanApply`): `gate` then `residual`, in the original clause order
//     gate      `move.doesFlagEffectApply({ MAKES_CONTACT, user: attacker, target: holder })`   = the move makes contact
//               `&& holder.randBattleSeedInt(100) < chance`                                     = the random draw, ONLY drawn
//                                                          for a contact move (short circuit); even for a simulated call
//     residual  `attacker.canAddTag(tagType)`            = feasibility (the attacker can get that battle effect now)
//   apply     (skipped when `simulated`) `attacker.addTag(tagType, turnCount, move.id, holder.id)`; no random draw
// Constructor: (chance 0-100, tagType, turnCount?). `turnCount` is undefined for every user (the tag's own length); addTag
// defaults it to 0. The chance is a real field the ER patcher rewrites after construction (Cute Charm 30 -> 50), so the
// declaration reads it back with `path: "chance"`.
// Library limit: the atom `rng.chance` skips the draw at 100 percent (the class always draws), so the slider stops at 99.
import { PostDefendContactApplyTagChanceAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { BattlerTagType } from "#enums/battler-tag-type";

/** Player words for the three battle effects the live abilities give, and the class constant behind each. */
const TAG_CHOICES: readonly (readonly [string, BattlerTagType])[] = [
  ["Infatuated", BattlerTagType.INFATUATED],
  ["Trapped", BattlerTagType.TRAPPED],
  ["Frostbite", BattlerTagType.ER_FROSTBITE],
];

const tagCodec: ParamCodec = {
  toCtor: value => {
    const found = TAG_CHOICES.find(([name]) => name.toLowerCase() === String(value).trim().toLowerCase());
    if (found === undefined) {
      throw new Error(`"${String(value)}" is not a known battle effect (use Infatuated, Trapped or Frostbite)`);
    }
    return found[1];
  },
  fromInstance: raw => TAG_CHOICES.find(([, tag]) => tag === raw)?.[0],
};

/** 0 means "the effect's own length" (constructor argument left out), a number is that many turns. */
const turnsCodec: ParamCodec = {
  toCtor: value => (Number(value) === 0 ? undefined : Number(value)),
  fromInstance: raw => (raw === undefined ? 0 : typeof raw === "number" ? raw : undefined),
};

export default defineDecl(PostDefendContactApplyTagChanceAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Chance to put a battle effect on attackers that touch me",
  summary: params =>
    `When a move that makes contact hits me, there is a ${params.chance}% chance the attacker gets the ${String(params.effect).toLowerCase()} effect. Example: 50% Infatuated, like Cute Charm.`,
  synonyms: [
    "cute charm",
    "infatuate on contact",
    "attract on touch",
    "trap on contact",
    "tangling hair",
    "frostbite on contact",
    "ice body",
    "contact effect chance",
    "charm the attacker",
  ],
  examples: [
    "50% chance to infatuate an attacker that touches me, like Cute Charm",
    "50% chance to trap an attacker that touches me, like Tangling Hair",
    "10% chance to give frostbite to an attacker that touches me",
  ],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      path: "chance",
      control: "slider",
      min: 1,
      max: 99,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 50,
    },
    {
      id: "effect",
      ctorIndex: 1,
      path: "tagType",
      control: "select",
      label:
        "Battle effect the attacker gets (Infatuated: may not attack; Trapped: cannot switch out; Frostbite: hurt each turn)",
      editable: true,
      gateIndependent: true,
      default: "Infatuated",
      options: TAG_CHOICES.map(([name]) => name),
      codec: tagCodec,
    },
    {
      id: "turns",
      ctorIndex: 2,
      path: "turnCount",
      control: "number",
      label: "How long it lasts (turns, 0 = the effect's normal length)",
      editable: true,
      gateIndependent: true,
      default: 0,
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      codec: turnsCodec,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the group [move.flag MAKES_CONTACT, rng.chance pct], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The attacker must be able to get that battle effect right now (for example Ice types cannot get Frostbite)",
    "Nothing is added when the game only previews the move",
  ],
  effect: { id: "effect.apply-tag", params: ["effect", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: the chance roll, only after the contact check passed (a non-contact move draws nothing)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // A contact move and a non-contact move: the chance roll must only be drawn for the contact one.
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (11 attrs): Cute Charm (56 attr 0, 50% Infatuated after the ER patch from 30), Ice Body (115 attr 2 and 5953 attr 2, 10% Frostbite), Tangling Hair (221 attr 1, 50% Trapped), Prim and Proper (5216 attr 1), Pure Love (5238 attr 0) and Tender Affection (5527 attr 0), all 50% Infatuated, Moustache (5602 attr 1) and Massive Pelt (5647 attr 1), 50% Trapped, Sundae (5632 attr 5, 10% Frostbite). No user passes a turn count and none has a closure, so the only binding is the gate. The class draws a random number even for a simulated call (`simulated` is only read in apply); the library atom rng.chance answers true without a draw there, so the two differ only for a simulated caller, which no engine path has today (recorded, not fixed). At 100 percent the atom skips the draw while the class still draws, so the slider stops at 99. The battle effect list holds the three effects the game gives; other effects are not offered until the librarian supplies a curated list (R-B01-17, R-B01-28). Oddity (not fixed): unlike the status block there is no 'attacker has no status' clause, so an attacker that already has the effect is asked again (addTag handles the overlap).",
});
