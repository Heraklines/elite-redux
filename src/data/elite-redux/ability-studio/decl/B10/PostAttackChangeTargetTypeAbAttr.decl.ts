/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B).
//
// Read by hand from archetypes/post-attack-change-target-type.ts. The class extends PostAttackAbAttr (WHEN "after my attack
// lands"), constructor `{ type, contactOnly?, requireFlag? }`, `super(undefined, false)` (the parent's damaging-move rule, no
// banner). Fields: newType (a type, or the string "moveType"), contactOnly (default true), requireFlag (default none).
//
// canApply in the ORIGINAL clause order, and what each clause is now:
//   1. parent rule: the move is a damaging move            gate      (library move.damaging)
//   2. there is a target                                   guards    (pure read; moved in front of clause 1, which cannot throw)
//   3. contactOnly: move.doesFlagEffectApply(MAKES_CONTACT, user: holder, target)   gate   (library move.flag)
//   4. requireFlag: move.hasFlag(flag)                     gate      (library move.flag; see notes about hasFlag)
//   no prepare, no residual, no random draw.
// apply: simulated or no target -> nothing; else target.summonData.types = [the type, or holder.getMoveType(move)] and the
// info box is refreshed.
//
// Clause classification: "the move makes contact", "the move has this property" and "the move deals damage" are rules staff
// would change, so they are the replaceable gate and each live user's binding spells them with library atoms. "There is a
// target" is a guard. The effect replaces ALL of the target's types with one type: the library has no effect that changes a
// Pokemon's type, so it is a package with a typed setting (request R-B10-c3-03). The two gate options (contact, flag) stay as
// non-editable settings: they only shape the class's own default gate, which a bound IF replaces.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostAttackChangeTargetTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-change-target-type";
import { changedTypeCodec, MOVE_TYPE, NOTHING, optionalFlagCodec } from "./c3-codecs";

export default defineDecl(PostAttackChangeTargetTypeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Turn the target into one type after my attack",
  summary: params =>
    `After my attack hits, the target becomes ${params.type === "Move type" ? "the type of the move I used" : `a pure ${params.type} type`} and loses its other types. Example: Water makes any target a pure Water type.`,
  synonyms: [
    "change the target's type",
    "make the foe a type",
    "type swap on hit",
    "retype the target",
    "damp",
    "magical dust",
    "paint shot",
  ],
  examples: [
    "When my contact move hits, the target becomes a Water type, like Damp",
    "My pulse moves turn the target into the type of the move, like Paint Shot",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "newType",
      control: "select",
      label: "Type the target becomes (Move type = the type of the move I used)",
      editable: true,
      gateIndependent: true,
      default: "WATER",
      options: [...TYPE_OPTIONS, MOVE_TYPE],
      codec: changedTypeCodec,
    },
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
    "There must be a target",
    "All of the target's types are replaced by the one type, so a dual-type target becomes a single type",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact and non-contact moves, damaging and status", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: a target; gate: damaging, contact, flag; no residual). Users (3 attrs): Damp attr 2 (Water, contact), Magical Dust attr 1 (Psychic, contact), Paint Shot attr 0 (the move's own type, no contact rule, pulse moves only). Gate bindings: all[move.damaging, move.flag MAKES_CONTACT] for the first two; all[move.damaging, move.flag PULSE_MOVE] for Paint Shot. Package justified: no library effect changes a Pokemon's type (R-B10-c3-03); the setting 'type' is typed (every type, or the move's type). `requireFlag` uses move.hasFlag in the class but move.flag uses doesFlagEffectApply: the two differ only for a flag that an ability injects (move-flag-injection users inject Dance, Sound and Kicking, never Pulse), so for Paint Shot they are the same today (checked in chunk3-gates.test.ts). Oddities, NOT fixed: Damp's offensive half is added by init-elite-redux-vanilla-rebalance (patchDamp) only when no such attr exists; Magical Dust gets it from the dispatcher; with `moveType` the type is the HOLDER's effective move type (pokemon.getMoveType), which may differ from move.type after an ability changes the type; a Terastallized target keeps its Tera type for type matchups (only summonData.types changes).",
});
