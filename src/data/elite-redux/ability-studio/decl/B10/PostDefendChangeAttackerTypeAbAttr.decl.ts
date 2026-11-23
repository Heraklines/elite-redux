/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B).
//
// Read by hand from archetypes/post-defend-change-attacker-type.ts. The class extends PostDefendAbAttr (WHEN "after I am hit"),
// constructor `{ type, contactOnly?, requireFlag?, side }`, `super(false)` (no banner). Fields: type (a type, or "moveType"),
// contactOnly (default false), requireFlag (default none), side ("attacker" or "self"). canApply in the ORIGINAL clause order:
//   1. there is an attacker                                       guards  (feasibility)
//   2. move.is("AttackMove")                                      guards  (a class test, NOT the same as 'category is not STATUS'; R-B10-c3-12)
//   3. contactOnly: move.doesFlagEffectApply(MAKES_CONTACT, user: attacker, target: holder)   gate   (library move.flag)
//   4. requireFlag: move.doesFlagEffectApply(flag, user: attacker, target: holder)           gate   (library move.flag)
// no prepare, no residual, no random draw. apply: simulated or no attacker -> nothing; else the changed Pokemon (the attacker, or
// the holder when side is "self") gets summonData.types = [the type, or attacker.getMoveType(move)] and its info box refreshes.
//
// Clause classification: the contact and flag tests are rules staff would change, so they are the replaceable gate
// (bound per user in bindings.ts). The effect rewrites all of one Pokemon's types: the library has no effect that changes a type,
// so it is a package with two typed settings (the type, and whose type changes), request R-B10-c3-03. The two gate options stay
// as non-editable settings that shape only the class's own default gate.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostDefendChangeAttackerTypeAbAttr } from "#data/elite-redux/archetypes/post-defend-change-attacker-type";
import {
  changedTypeCodec,
  MOVE_TYPE,
  NOTHING,
  optionalFlagCodec,
  SIDE_ATTACKER,
  SIDE_SELF,
  sideCodec,
} from "./c3-codecs";

export default defineDecl(PostDefendChangeAttackerTypeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change a type when a foe's attack hits me",
  summary: params =>
    `When a foe's attack hits me, ${params.side === "Me" ? "I become" : "the attacker becomes"} ${params.type === "Move type" ? "the type of the foe's move" : `a pure ${params.type} type`} and ${params.side === "Me" ? "lose" : "loses"} the other types. Example: Water makes the attacker a pure Water type.`,
  synonyms: [
    "change the attacker's type",
    "retype the foe that hits me",
    "type swap when hit",
    "make the attacker a type on contact",
    "damp",
    "magical dust",
    "type change on defense",
  ],
  examples: [
    "When a foe's contact move hits me, the foe becomes a Psychic type, like Magical Dust",
    "When a foe's move hits me, I become the type of that move",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "type",
      control: "select",
      label: "Type to turn into (Move type = the type of the foe's move)",
      editable: true,
      gateIndependent: true,
      default: "WATER",
      options: [...TYPE_OPTIONS, MOVE_TYPE],
      codec: changedTypeCodec,
    },
    {
      id: "side",
      ctorIndex: 0,
      ctorOption: "side",
      path: "side",
      control: "select",
      label: "Who changes type (the attacker, or me)",
      editable: true,
      gateIndependent: true,
      default: SIDE_ATTACKER,
      options: [SIDE_ATTACKER, SIDE_SELF],
      codec: sideCodec,
    },
    {
      id: "contactOnly",
      ctorIndex: 0,
      ctorOption: "contactOnly",
      path: "contactOnly",
      control: "boolean",
      label: "Built-in rule: only moves that make contact count (replaced by the condition block you set)",
      editable: false,
      default: false,
    },
    {
      id: "requireFlag",
      ctorIndex: 0,
      ctorOption: "requireFlag",
      path: "requireFlag",
      control: "select",
      label: "Built-in rule: property the move must have (None = no requirement; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      options: [NOTHING, ...MOVE_FLAG_OPTIONS],
      codec: optionalFlagCodec(),
    },
  ],
  conditions: [
    // The gate: all[ move.damaging, move.flag MAKES_CONTACT (when contactOnly), move.flag <flag> (when requireFlag) ], per user (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "There must be an attacker",
    "All of that Pokemon's types are replaced by the one type, so a dual-type Pokemon becomes a single type",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["type", "side"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact and non-contact hits", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: an attacker and an attack move; gate: contact, flag; no residual). Users (2 attrs): Damp attr 0 (Water, attacker, contact required) and Magical Dust attr 0 (Psychic, attacker, contact required), both bound as the single atom move.flag MAKES_CONTACT. Package justified: no library effect changes a Pokemon's type (R-B10-c3-03); its settings are typed (every type or the foe's move type; the attacker or me). The class tests move.is('AttackMove') and the library atom move.damaging tests category != STATUS: they DIFFER for nine status-class moves with a damaging category (see the contact-suppress declaration), so the class test stays a guard (R-B10-c3-12). Oddities, NOT fixed: with `side` set to me the class changes the HOLDER's type to the ATTACKER's move type (a type-change-to-resist idea); the class comment about Paint Shot is a half-edited note (Paint Shot is wired through the offensive class instead); with `moveType` the type is the attacker's effective move type (attacker.getMoveType); no live user has requireFlag or side self, so those two paths are covered only by the B10 test.",
});
