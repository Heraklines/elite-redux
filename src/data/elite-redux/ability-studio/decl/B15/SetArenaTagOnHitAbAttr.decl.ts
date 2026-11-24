/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Tier B. "When a damaging move hits me (only a contact move, for most users), a hazard or field effect is set on the attacker's side."
//
// Source: src/data/elite-redux/abilities/set-arena-effect-on-hit.ts, class SetArenaTagOnHitAbAttr (extends PostDefendAbAttr; constructor takes ONE options object
// { tagType, turns = 0, side = "attacker", contactRequired = false }, showAbility stays true). canApply, now guards && gate && residual in the ORIGINAL clause order
// (no random draw in canApply):
//   1. guards    hitResult < HitResult.NO_EFFECT                                                        -> GUARD (the hit connected: not a miss, a block or an immunity)
//   2. gate      !contactRequired || move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })  -> CONDITION (the contact clause)
//   3. residual  none (the class always answers true after the gate)
// apply (effect), not when simulated: targetSide = "self" -> my side, "attacker" -> the side opposite me, "both" -> both sides;
//   globalScene.arena.addTag(tagType, turns, undefined, holder.id, targetSide). The arena refuses a tag that is already there or at its layer cap; that is arena
//   behaviour and is not checked here. No message of its own beyond the arena's, no random draw.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); guards and gate are the two clauses above verbatim. `gateOverride` is declared for the compiler.
// contactRequired changes the SHAPE of the gate (an always-true gate when false), so it is not an editable setting: staff add or remove the contact condition block instead.
import { SetArenaTagOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagType } from "#enums/arena-tag-type";

const SIDE_NAMES = ["MY_SIDE", "ATTACKER_SIDE", "BOTH_SIDES"] as const;
const SIDE_VALUES = ["self", "attacker", "both"] as const;

/** What staff see ("MY_SIDE") and what the constructor wants ("self"). */
const sideCodec: ParamCodec = {
  toCtor: value => {
    const index = SIDE_NAMES.indexOf(String(value) as (typeof SIDE_NAMES)[number]);
    if (index < 0) {
      throw new Error(`"${String(value)}" is not a side (my side, the attacker's side or both sides)`);
    }
    return SIDE_VALUES[index];
  },
  fromInstance: raw => {
    const index = SIDE_VALUES.indexOf(raw as (typeof SIDE_VALUES)[number]);
    return index < 0 ? undefined : SIDE_NAMES[index];
  },
};

const FIELD_EFFECT_OPTIONS = Object.values(ArenaTagType).filter(name => name !== ArenaTagType.NONE);

export default defineDecl(SetArenaTagOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Set a hazard or field effect when I am hit",
  summary: params =>
    `When a damaging move hits me${params.contactRequired === true ? " and makes contact" : ""}, ${params.tagType} is set on the ${String(params.side).toLowerCase()} for ${params.turns} turns (0 = until cleared). Example: Spikes on the attacker's side.`,
  synonyms: [
    "spikes when hit",
    "stealth rock when hit",
    "set a hazard on the attacker",
    "punish contact with hazards",
    "retaliate with a trap",
    "drop blocks",
    "loose rocks",
    "scrapyard",
  ],
  examples: [
    "When a contact move hits me, Spikes land on the attacker's side, like Scrapyard",
    "Any damaging hit sets Stealth Rock on the attacker's side",
  ],
  params: [
    {
      id: "tagType",
      ctorIndex: 0,
      ctorOption: "tagType",
      path: "tagType",
      control: "select",
      label: "Hazard or field effect to set",
      editable: true,
      gateIndependent: true,
      default: "SPIKES",
      options: FIELD_EFFECT_OPTIONS,
    },
    {
      id: "turns",
      ctorIndex: 0,
      ctorOption: "turns",
      path: "turns",
      control: "number",
      min: 0,
      max: 99,
      step: 1,
      integer: true,
      label: "Number of turns it lasts (0 = until cleared, for hazards)",
      editable: true,
      gateIndependent: true,
      default: 0,
    },
    {
      id: "side",
      ctorIndex: 0,
      ctorOption: "side",
      path: "side",
      control: "select",
      label: "Which side gets it",
      editable: true,
      gateIndependent: true,
      default: "ATTACKER_SIDE",
      options: [...SIDE_NAMES],
      codec: sideCodec,
    },
    {
      id: "contactRequired",
      ctorIndex: 0,
      ctorOption: "contactRequired",
      path: "contactRequired",
      control: "boolean",
      label: "Only when the move makes contact",
      // Changes the shape of the gate; staff add or remove the contact condition block instead.
      editable: false,
      default: false,
    },
  ],
  conditions: [
    // The gate is the contact clause (move.flag MAKES_CONTACT), always true when contact is not required.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must have connected: a miss, a block or an immunity does nothing",
    "A field effect that is already there, or a hazard at its layer limit, is not added again (the field handles that)",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.arena-tag", params: ["tagType", "side", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A contact move and a non-contact move: the contact clause decides.
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, event effect with a library effect (effect.arena-tag), not a package. 6 attrs in 6 abilities, each bound individually: Scrapyard (5137 attr 0, Spikes, contact), Loose Quills (5138 attr 0, Spikes, contact), Loose Rocks (5141 attr 0, Stealth Rock, contact), Drop Blocks (5607 attr 0, Spikes, any damaging hit), Loose Thorns (5611 attr 0, Creeping Thorns, contact) and Shattered Armor (5698 attr 2, Spikes, contact). All six use turns 0 and the attacker's side. The 'the hit connected' clause stays in the class as a safety rule (guards): the guard registry has no id for it, so it is listed as feasibility and requested as R-B15-26 (the same guard Spiteful needs). The contact clause is bound to the library atom move.flag MAKES_CONTACT (the same Move.doesFlagEffectApply with the attacker as user and me as target); a user without the contact requirement is bound to the always-true gate. effect.arena-tag is in the effect registry but not implemented yet (the same state as Swirlify's declaration): its side words are holder-side and opposing-side while this class takes my side, the attacker's side or both, so R-B15-38 asks for the effect to be implemented with a source Pokemon and a 'the side opposite the one that was hit' choice. Suspected oddities, NOT fixed: (1) the class docs say Loose Thorns uses SPIKES as a stand-in, but the live attr carries CREEPING_THORNS (the ER hazard), so the comment is stale; (2) the sibling comment for Drop Blocks says 'any contact hit' while the live attr has contactRequired false, so any damaging hit sets Spikes (which is what the ability text says); (3) the class never checks whether the hazard can be added: a layer beyond the cap is dropped by the arena.",
});
