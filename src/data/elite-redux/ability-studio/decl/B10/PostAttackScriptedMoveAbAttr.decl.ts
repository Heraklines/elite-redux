/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B).
//
// Read by hand from archetypes/post-attack-scripted-move.ts and from every place that builds it (the dispatcher, the ability
// upgrades). The class extends PostAttackAbAttr (WHEN "after my attack lands"), constructor `opts` (one options object, kept in
// the private field `opts`), `super(undefined, false)`; its canApply never calls the parent's damaging-move rule on purpose
// (status dances must trigger it). canApply in the ORIGINAL clause order:
//   1. there is a target                                       guards   (feasibility)
//   2. not every foe has fainted                               guards   (feasibility: the follow-up needs someone to hit)
//   3. follow-up guard: NOT (hitsLeft > 1 or the last move was a virtual use), unless this move is `allowVirtualTriggerMoveId`
//                                                              guards   (a safety rule: stops an endless chain of follow-ups)
//   4. triggerMoveIds: the move is on the list                 gate     (library move.is-move)
//   5. targetStatsDecreased: the target lost a stat stage this turn          gate   (no library atom, request R-B10-c3-06)
//   6. categoryFilter: the move has that category              gate     (library move.category)
//   7. typeFilter: the move's type, or a type another of my abilities lets it count as, is on the list
//                                                              gate     (no exact library atom, request R-B10-c3-07)
//   8. flagFilter: move.doesFlagEffectApply(flag, user: holder, target)      gate   (library move.flag)
// no prepare, no residual, no random draw. apply: simulated or no target -> nothing; the target is re-aimed at a living foe when
// it is the holder itself, an ally or fainted; a spread follow-up targets every valid target; then a MovePhase with the
// scripted move (power, Magnitude range and HP-scaled power as set) is queued first, as a free (INDIRECT) use.
//
// Clause classification: clauses 4 to 8 are rules staff would change (which moves trigger it), so they are the replaceable gate
// and each live user's binding spells them with library atoms. Clauses 1 to 3 are guards and feasibility. The effect is the
// library's "Use a move" effect, plus three settings the library effect does not have (Magnitude range, HP-scaled power, and the
// re-aiming rules, which stay in the class). The filters are non-editable settings: they only shape the class's own default
// gate, which a bound IF replaces.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import {
  buildScriptedMoveOptions,
  NOTHING,
  optionBooleanCodec,
  optionCategoryCodec,
  optionalFlagCodec,
  optionMagnitudeCodec,
  optionMoveCodec,
  optionMoveListCodec,
  optionNumberOrZero,
  optionOptionalMoveCodec,
  optionTypeListCodec,
} from "./c3-codecs";

/** Every setting lives inside the one `opts` argument; `ctorOption` only names the setting (the builder places it). */
const IN_OPTS = { ctorIndex: 0, path: "opts" } as const;

export default defineDecl(PostAttackScriptedMoveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Follow up my attack with a free extra move",
  summary: params =>
    `After my attack, I use ${params.moveId} on a foe for free${Number(params.power) > 0 ? ` with ${params.power} power` : " at its own power"}. It uses no PP and does not set off another follow-up. Example: 50 power Surf after a Water move.`,
  synonyms: [
    "follow up move",
    "extra attack after attacking",
    "free second move",
    "bonus move",
    "combo move",
    "after a move use another",
    "high tide",
    "thunder clouds",
    "volcano rage",
    "aftershock",
  ],
  examples: [
    "After I use a Water move, I also use a 50 power Surf, like High Tide",
    "After I use a special move, I launch a 35 power Thunderbolt, like Thunder Clouds",
    "After any damaging move I also use Magnitude, like Aftershock",
  ],
  params: [
    {
      id: "moveId",
      ...IN_OPTS,
      ctorOption: "moveId",
      control: "text",
      label: "Move to use (type its name, for example Ice Beam)",
      editable: true,
      gateIndependent: true,
      default: "THUNDERBOLT",
      codec: optionMoveCodec("moveId"),
    },
    {
      id: "power",
      ...IN_OPTS,
      ctorOption: "power",
      control: "number",
      min: 0,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the move (0 = the move's own power)",
      editable: true,
      gateIndependent: true,
      default: 50,
      codec: optionNumberOrZero("power"),
    },
    {
      id: "magnitudeLow",
      ...IN_OPTS,
      ctorOption: "magnitudeLow",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Lowest Magnitude level when the move is Magnitude (4 to 10; 0 = not used)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: optionMagnitudeCodec(0),
    },
    {
      id: "magnitudeHigh",
      ...IN_OPTS,
      ctorOption: "magnitudeHigh",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Highest Magnitude level when the move is Magnitude (4 to 10; 0 = not used)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: optionMagnitudeCodec(1),
    },
    {
      id: "hpScaledPower",
      ...IN_OPTS,
      ctorOption: "hpScaledPower",
      control: "number",
      min: 0,
      max: 250,
      step: 1,
      integer: true,
      label: "Base power that grows with my remaining HP, for Eruption (0 = not used)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: optionNumberOrZero("hpScaledBasePower"),
    },
    {
      id: "category",
      ...IN_OPTS,
      ctorOption: "category",
      control: "select",
      label: "Built-in rule: category of the move that sets it off (None = any; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      options: [NOTHING, "PHYSICAL", "SPECIAL", "STATUS"],
      codec: optionCategoryCodec,
    },
    {
      id: "type",
      ...IN_OPTS,
      ctorOption: "type",
      control: "select",
      label: "Built-in rule: type of the move that sets it off (None = any; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      options: [NOTHING, ...TYPE_OPTIONS],
      codec: optionTypeListCodec(0),
    },
    {
      id: "type2",
      ...IN_OPTS,
      ctorOption: "type2",
      control: "select",
      label: "Built-in rule: a second type that also sets it off (None = only the first; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      options: [NOTHING, ...TYPE_OPTIONS],
      codec: optionTypeListCodec(1),
    },
    {
      id: "flag",
      ...IN_OPTS,
      ctorOption: "flag",
      control: "select",
      label: "Built-in rule: property the move must have, like dance or sound (None = any; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      options: [NOTHING, ...MOVE_FLAG_OPTIONS],
      codec: optionalFlagCodec("flagFilter"),
    },
    {
      id: "triggerMove",
      ...IN_OPTS,
      ctorOption: "triggerMove",
      control: "text",
      label: "Built-in rule: the only move that sets it off (None = any; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      codec: optionMoveListCodec("triggerMoveIds", 0),
    },
    {
      id: "triggerMove2",
      ...IN_OPTS,
      ctorOption: "triggerMove2",
      control: "text",
      label: "Built-in rule: a second move that also sets it off (None = only the first; replaced by the condition block you set)",
      editable: false,
      default: NOTHING,
      codec: optionMoveListCodec("triggerMoveIds", 1),
    },
    {
      id: "targetStatsDecreased",
      ...IN_OPTS,
      ctorOption: "targetStatsDecreased",
      control: "boolean",
      label: "Built-in rule: the target must have lost a stat stage this turn (replaced by the condition block you set)",
      editable: false,
      default: false,
      codec: optionBooleanCodec("targetStatsDecreased"),
    },
    {
      id: "allowVirtualMove",
      ...IN_OPTS,
      ctorOption: "allowVirtualMove",
      control: "text",
      label: "Built-in rule: one free extra move that may set it off despite the follow-up safety rule (None = no such move)",
      editable: false,
      default: NOTHING,
      codec: optionOptionalMoveCodec("allowVirtualTriggerMoveId"),
    },
  ],
  assembleCtorArg: { index: 0, build: buildScriptedMoveOptions },
  conditions: [
    // The gate, per user (bindings.ts): the clauses 4 to 8 of the header as library atoms; Aftershock, Purple Haze, Sludge Spit and
    // Break it Down have no clause at all (an empty ALL group). The seven users with a type list stay legacy (R-B10-c3-07).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "There must be a target and at least one foe still standing",
    "Safety rule: a follow-up never sets off another follow-up (not while a multi-hit move still has hits left, and not after a free extra move)",
    "The move is aimed at a living foe; a move that hits several targets hits every valid one",
    "Nothing happens in a preview",
  ],
  effect: {
    id: "effect.scripted-move",
    params: ["moveId", "power", "magnitudeLow", "magnitudeHigh", "hpScaledPower"],
  },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a damaging move, a status move and a dance", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: target, a living foe, follow-up guard; gate: move list, stat-drop test, category, type, flag; no residual). Users (19 attrs of 19 abilities, bindings in bindings.ts): no clause at all (Aftershock, Purple Haze, Sludge Spit, Break it Down); category SPECIAL (Thunder Clouds); flag Dance (Two Step, Blade Dance, Backflip), Sound (Chunky Bass Line, Reverberate), Pulse (Pyro Shells); the only move Tickle (Monkey Business, which also lets the free Tickle through the safety rule); type list FIRE (Volcano Rage, Frost Burn), WATER (High Tide, Ebb and Flow), ICE (Glacial Rage, Frost Dragon), GHOST (Lunar Wrath). The seven type-list users stay legacy-closure-pending-request: the class counts a type the move has OR any type another of the holder's abilities lets it count as (Sea Specter's getTriggeredMoveTypes), and move.type reads only the move's own type, so the two differ when both abilities are on one Pokemon (R-B10-c3-07). Nobody uses targetStatsDecreased yet (R-B10-c3-06 asks for its atom). The effect maps to the library 'Use a move' effect but the class also takes a Magnitude range and an HP-scaled power (settings here) and aims by its own rules (feasibility). Oddities, NOT fixed: unlike the library effect the class does not check that the holder is still standing; the triggering move list, type list and flag rules are non-editable settings and the lists hold at most two entries here (the class takes any number; a longer list is refused when read back); the class's docs mention Sand Spear (999) but no such attr exists; a status dance targets the holder, so the target is re-aimed at the first living foe.",
});
