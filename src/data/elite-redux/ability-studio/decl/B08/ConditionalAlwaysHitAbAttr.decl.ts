/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  MOVE_NAMES,
  moveNamesCodec,
  optionalTagCodec,
  PROPERTY_CHOICES,
  propertyCodec,
  TAG_NAMES,
  WEATHER_NAMES,
  weatherNamesCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
// B08 chunk 2 / calc-modifier (Tier B, after the review: the seven settings are conditions, not class settings).
//
// The class extends only AbAttr, its canApply is always true and its apply does nothing: nothing is dispatched through
// applyAbAttrs. MoveEffectPhase (phases/move-effect-phase.ts, erUserHasConditionalAlwaysHit, called from
// checkBypassAccAndInvuln) scans the attacker's attrs for an instance of the class and calls
// `attr.matches(move, user, target)`; a true answer skips the accuracy check. The library trigger `calc.always-hit-check`
// carries the class's own name as its dispatch key (vocabulary/when-registry.ts), so the L0 rule "the WHEN's dispatch key
// is the class or an ancestor" holds. L2 cannot reach it with a battle template (it is listed as unreached in
// decomp-l2-reach.json), so the declaration carries an `l2StaticReason` and the B08 test
// (test/tests/elite-redux/decomp/B08/conditional-always-hit.test.ts) compares `matches` of the original and the rebuild.
//
// What the class is (read from the source and from the 38 live attrs): one options object, no closure, no random draw.
//   matches(move, user, target) = matchesMove && matchesWeather && matchesTarget, each a pure read, in this order:
//     1. flag set and !move.doesFlagEffectApply(flag, user)                      -> false   (the user-aware flag test, no target)
//     2. categories set and the move's category is not in the list               -> false
//     3. moveIds set and the move's id is not in the list                        -> false
//     4. weather set and the current weather (NONE when there is none) is not in the list -> false
//     5. superEffective and target.getMoveEffectiveness(user, move) <= 1         -> false
//     6. targetHasTag set and the target does not carry it                       -> false
//     7. targetTrapped and the target does not carry a TrappedTag                -> false
// The seven answers above used to be settings of the class that staff could not split into separate IF blocks. The class is now
// Tier B: `matches(move, user, target)` is `gatedCanApply` over a replaceable `gate` (the same clauses in the same order, no
// guard, no residual, no random draw), and every live user's gate is bound to library atoms (bindings.ts): move.flag, move.category,
// move.is-move, field.weather, move.effectiveness, tag.has and the new tag.trapped. The engine still calls `matches`, which now
// honours a replaced gate, so an extra IF can be ANDed on top (reusableAlone.if is true) and a condition can be removed. The
// seven params only describe the live options (the rebuilt instance keeps the same `opts`); the gate carries them, so they are
// not editable.
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { MoveCategory } from "#enums/move-category";

/** The live instance keeps all its settings in one `opts` object; each param reads its own key from it. */
function fromOpts(key: string, codec: ParamCodec): Pick<ParamCodec, "fromInstance"> {
  return { fromInstance: raw => codec.fromInstance((raw as Record<string, unknown> | undefined)?.[key]) };
}

const CATEGORY_CHOICES = ["Any", "Physical", "Special", "Status"] as const;

/** "Any" <-> undefined, otherwise a one-item category list. A list of several categories is not representable. */
const categoryCodec: ParamCodec = {
  toCtor: value =>
    value === "Any" ? undefined : [(MoveCategory as unknown as Record<string, number>)[String(value).toUpperCase()]],
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "Any";
    }
    if (!Array.isArray(raw) || raw.length !== 1) {
      return;
    }
    const name = Object.keys(MoveCategory).find(
      key => Number.isNaN(Number(key)) && (MoveCategory as unknown as Record<string, number>)[key] === raw[0],
    );
    return name === undefined ? undefined : name.charAt(0) + name.slice(1).toLowerCase();
  },
};

/** "" <-> undefined (no list), otherwise the comma separated names. */
function optionalListCodec(list: ParamCodec): ParamCodec {
  return {
    toCtor: value => (String(value).trim() === "" ? undefined : list.toCtor(value)),
    fromInstance: raw => (raw === undefined || raw === null ? "" : list.fromInstance(raw)),
  };
}

const flagParam = { ...propertyCodec, ...fromOpts("flag", propertyCodec) };
const categoryParam = { ...categoryCodec, ...fromOpts("categories", categoryCodec) };
const moveIdsCodec = optionalListCodec(moveNamesCodec);
const moveIdsParam = { ...moveIdsCodec, ...fromOpts("moveIds", moveIdsCodec) };
const weatherCodec = optionalListCodec(weatherNamesCodec);
const weatherParam = { ...weatherCodec, ...fromOpts("weather", weatherCodec) };
const tagParam = { ...optionalTagCodec, ...fromOpts("targetHasTag", optionalTagCodec) };
const booleanFromOpts = (key: string): ParamCodec => ({
  // false is left out of the options object, as the live users do (only `true` is ever written).
  toCtor: value => (value === true ? true : undefined),
  fromInstance: raw => (raw as Record<string, unknown> | undefined)?.[key] === true,
});

export default defineDecl(ConditionalAlwaysHitAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.always-hit-check",
  label: "Make my moves never miss",
  summary: params => {
    const rules: string[] = [];
    if (params.flag !== "None") {
      rules.push(`are ${String(params.flag).toLowerCase()}`);
    }
    if (params.category !== "Any") {
      rules.push(`are ${String(params.category).toLowerCase()} moves`);
    }
    if (String(params.moveIds) !== "") {
      rules.push(`are ${params.moveIds}`);
    }
    if (String(params.weather) !== "") {
      rules.push(`are used in ${params.weather} weather`);
    }
    if (params.superEffective === true) {
      rules.push("are super effective");
    }
    if (params.targetHasTag !== "None") {
      rules.push(`hit a target that is ${String(params.targetHasTag).toLowerCase()}`);
    }
    if (params.targetTrapped === true) {
      rules.push("hit a trapped target");
    }
    return rules.length === 0
      ? "All of my moves never miss."
      : `My moves that ${rules.join(" and ")} never miss. Every setting you fill in must match.`;
  },
  synonyms: [
    "never miss",
    "sure hit",
    "perfect accuracy",
    "no guard",
    "cannot miss",
    "always hits",
    "super effective never misses",
    "sweeping edge",
    "fatal precision",
    "gifted mind",
  ],
  examples: [
    "Super effective moves never miss, like Fatal Precision",
    "My slicing moves never miss, like Sweeping Edge",
    "Status moves never miss, like Gifted Mind",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "opts",
      control: "select",
      label: "Only moves of this group (set by the conditions)",
      editable: false,
      default: "None",
      options: PROPERTY_CHOICES,
      codec: flagParam,
    },
    {
      id: "category",
      ctorIndex: 0,
      ctorOption: "categories",
      path: "opts",
      control: "select",
      label: "Only moves of this kind (set by the conditions)",
      editable: false,
      default: "Any",
      options: CATEGORY_CHOICES,
      codec: categoryParam,
    },
    {
      id: "moveIds",
      ctorIndex: 0,
      ctorOption: "moveIds",
      path: "opts",
      control: "text",
      label: "Only these moves (comma separated, empty = every move; set by the conditions)",
      editable: false,
      default: "",
      options: MOVE_NAMES,
      codec: moveIdsParam,
    },
    {
      id: "weather",
      ctorIndex: 0,
      ctorOption: "weather",
      path: "opts",
      control: "text",
      label: "Only while this weather is active (comma separated, empty = any; set by the conditions)",
      editable: false,
      default: "",
      options: WEATHER_NAMES,
      codec: weatherParam,
    },
    {
      id: "superEffective",
      ctorIndex: 0,
      ctorOption: "superEffective",
      path: "opts",
      control: "boolean",
      label: "Only when the move is super effective on the target (set by the conditions)",
      editable: false,
      default: false,
      codec: { ...booleanFromOpts("superEffective") },
    },
    {
      id: "targetHasTag",
      ctorIndex: 0,
      ctorOption: "targetHasTag",
      path: "opts",
      control: "select",
      label: "Only when the target already has this lasting effect (set by the conditions)",
      editable: false,
      default: "None",
      options: ["None", ...TAG_NAMES],
      codec: tagParam,
    },
    {
      id: "targetTrapped",
      ctorIndex: 0,
      ctorOption: "targetTrapped",
      path: "opts",
      control: "boolean",
      label: "Only when the target is trapped (set by the conditions)",
      editable: false,
      default: false,
      codec: { ...booleanFromOpts("targetTrapped") },
    },
  ],
  conditions: [
    // The gate is a group of atoms per user, in the original order (bindings.ts): [move.flag F] or [move.category C] or
    // [move.is-move M] (any[...] for a list), [field.weather W] (any[...] for a list), [move.effectiveness gt 1], [tag.has other T],
    // [tag.trapped other]. A user with no setting at all has the always-true group { all: [] }.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.always-hit", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a contact move, a slicing move, a status move and a super effective move",
      axes: { foeMove: ["TACKLE", "AIR_SLASH", "GROWL", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The class is read by a duck-typed scan inside the accuracy check (MoveEffectPhase.checkBypassAccAndInvuln), not dispatched, so no trace event shows it evaluated. The B08 test (test/tests/elite-redux/decomp/B08/conditional-always-hit.test.ts) compares matches(move, user, target) of the original and the rebuild (the library gate of every binding) over every grid move, both categories, several weathers and target states.",
  status: "decomposed",
  notes:
    "Tier B (review round 3): matches() is gatedCanApply over a replaceable gate, and the seven conditions are library atoms bound per user (bindings.ts), so they are separate IF blocks that staff can remove, change or extend (reusableAlone.if is true). New atom tag.trapped (the class test getTag(TrappedTag), which also counts Bind and Wrap). Differences between the atoms and the class that no live user reaches: move.flag also gives the target to doesFlagEffectApply while the class gives none (it matters only for the contact property against a Substitute, and no live user sets a flag other than kicking, pulse, slicing, arrow or ball-bomb). The engine call site still calls matches() directly (no dispatch); that is fine now because matches() itself honours the replaced gate. The settings stay on the instance (opts) only so a rebuild keeps the same options; they are not editable because the gate carries them. Earlier text: the whole decision lives in matches(). WHEN `calc.always-hit-check` added to the library (R-B08-12). 38 live attrs: Inner Focus, Enlightened, Unlocked Potential, Way of Precision, Monk, Heartless Style (Focus Blast style moveIds [411]), Aurora Borealis (Blizzard), Shiny Lightning (Thunder), Angel's Wrath (a four-move list), Hypnotic Trance (Hypnosis), Fatal Precision (x2), Final Blow, Deadly Precision, Flawless Precision, Mach 3, Heartless Style (x2) (super effective), Grip Pincer and Venoblaze Pincers (target trapped), Deadeye, Hunter's Mark and Celestial Bow (arrow and ball-bomb moves), Artillery and Super Scope (pulse), Roundhouse and Kyokushin (kicking), Sweeping Edge, Blademaster, Pinnacle Blade, Puncture (slicing), Gifted Mind and Unintentional Genius (status category), Echolocation (fog and eerie fog), Poseidon's Dominion (no setting: every move). The class's own matchesMove tests the flag with doesFlagEffectApply({ flag, user }) (user-aware, no target); the matcher is kept exactly. superEffective uses effectiveness strictly above 1. The `categories` list holds one item for every live user, so the param is a single category. The second source of 'never misses' in the same engine scan, ER_USER_TYPE_ALWAYS_HIT and ER_WEATHER_ALWAYS_HIT (move-intrinsic maps, not abilities), is not an attr and is not part of this declaration.",
});
