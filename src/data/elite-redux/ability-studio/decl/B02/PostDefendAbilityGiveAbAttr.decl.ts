/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "Give attackers that touch me an ability" (Mummy, Lingering Aroma, Lingering Musk, Blood Stain).
//
// Tier B. canApply is now `gate && residual`, in the ORIGINAL clause order:
//   gate      the move makes contact (move.doesFlagEffectApply MAKES_CONTACT)
//   residual  attacker.getAbility().suppressable
//             && !attacker.getAbility().hasAttr("PostDefendAbilityGiveAbAttr")
//             && !mummyFamily   (only when the given ability is Mummy or Lingering Aroma: the attacker has Mummy,
//                                Lingering Aroma or the WANDERING_SPIRIT_SWAP capability)
// The original computed `mummyFamily` before the contact test; it is side-effect free, so evaluating it inside the
// residual changes no result. No random draw. `apply` (skipped when simulated) sets the attacker's temporary ability.
import { PostDefendAbilityGiveAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";

// Blood Stain is an ER ability with a fresh id (>= 5000) that the AbilityId enum does not name.
const BLOOD_STAIN_ID = ER_ID_MAP.abilities[673];

const abilityNames = [...enumOptions(AbilityId).filter(name => name !== "NONE"), "BLOOD_STAIN"];

const abilityCodec: ParamCodec = {
  toCtor: value => {
    if (value === "BLOOD_STAIN") {
      return BLOOD_STAIN_ID;
    }
    const resolved = (AbilityId as unknown as Record<string, string | number>)[String(value)];
    if (typeof resolved !== "number") {
      throw new Error(`"${String(value)}" is not a known ability`);
    }
    return resolved;
  },
  fromInstance: raw => {
    if (typeof raw !== "number") {
      return;
    }
    if (raw === BLOOD_STAIN_ID) {
      return "BLOOD_STAIN";
    }
    return enumOptions(AbilityId).find(name => (AbilityId as unknown as Record<string, string | number>)[name] === raw);
  },
};

export default defineDecl(PostDefendAbilityGiveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Give attackers an ability when they touch me",
  summary: params =>
    `When a contact move hits me, the attacker's ability becomes ${params.ability}. It does not overwrite abilities that cannot be suppressed.`,
  synonyms: [
    "mummy",
    "lingering aroma",
    "spread ability",
    "ability contagion",
    "overwrite ability on contact",
    "infect ability",
  ],
  examples: ["Turn the ability of attackers that touch me into Mummy"],
  params: [
    {
      id: "ability",
      ctorIndex: 0,
      path: "ability",
      control: "select",
      label: "Ability to give",
      editable: true,
      gateIndependent: true,
      default: "MUMMY",
      options: abilityNames,
      codec: abilityCodec,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The attacker's ability must be one that can be suppressed",
    "The attacker's ability must not already be one that gives abilities on contact",
    "Mummy and Lingering Aroma are never given to an attacker that already has Mummy, Lingering Aroma or the swapping capability",
  ],
  effect: { id: "effect.package", params: ["ability"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact and non-contact hit", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B. Four users: Mummy (152), Lingering Aroma (268), Lingering Musk (6084, gives Lingering Aroma) and Blood Stain (5377, gives itself; ER id 5377 has no AbilityId name, so the param codec maps BLOOD_STAIN to ER_ID_MAP.abilities[673]). The `ability` param is gateIndependent: the gate is only the contact test, while the given ability also decides whether the Mummy-family clause of the residual is evaluated at all (an existing coupling, kept). `apply` honours `simulated` and gives a TEMP ability. The DO (set the attacker's ability) has no library effect yet: effect.package, request B02-5. Oddity, not changed: the hasAttr clause blocks every attacker whose ability is itself a giver (so Mummy never replaces Lingering Aroma and the reverse), which makes the Mummy-family clause redundant for Mummy and Lingering Aroma; it only adds the swapping-capability case.",
});
