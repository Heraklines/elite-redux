/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { optionalTagCodec, TAG_NAMES } from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
// B08 chunk 2 / calc-modifier (Tier C).
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
// Every setting is a SETTING of the class (a constructor field), not a closure, so there is no condition slot. The engine
// never calls canApply for this class, so extra IFs cannot be ANDed on top: reusableAlone.if is false (request R-B08-12).
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { WeatherType } from "#enums/weather-type";

/** The live instance keeps all its settings in one `opts` object; each param reads its own key from it. */
function fromOpts(key: string, codec: ParamCodec): Pick<ParamCodec, "fromInstance"> {
  return { fromInstance: raw => codec.fromInstance((raw as Record<string, unknown> | undefined)?.[key]) };
}

const moveIdList = enumListCodec(MoveId, "move");
const weatherList = enumListCodec(WeatherType, "weather");
const CATEGORY_CHOICES = ["Any", "Physical", "Special", "Status"] as const;

/** "None" <-> undefined, otherwise the MoveFlags member. */
const flagCodec: ParamCodec = {
  toCtor: value => (value === "None" ? undefined : (MoveFlags as unknown as Record<string, number>)[String(value)]),
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "None";
    }
    return MOVE_FLAG_OPTIONS.find(name => (MoveFlags as unknown as Record<string, number>)[name] === raw);
  },
};

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

const flagParam = { ...flagCodec, ...fromOpts("flag", flagCodec) };
const categoryParam = { ...categoryCodec, ...fromOpts("categories", categoryCodec) };
const moveIdsCodec = optionalListCodec(moveIdList);
const moveIdsParam = { ...moveIdsCodec, ...fromOpts("moveIds", moveIdsCodec) };
const weatherCodec = optionalListCodec(weatherList);
const weatherParam = { ...weatherCodec, ...fromOpts("weather", weatherCodec) };
const tagParam = { ...optionalTagCodec, ...fromOpts("targetHasTag", optionalTagCodec) };
const booleanFromOpts = (key: string): ParamCodec => ({
  // false is left out of the options object, as the live users do (only `true` is ever written).
  toCtor: value => (value === true ? true : undefined),
  fromInstance: raw => (raw as Record<string, unknown> | undefined)?.[key] === true,
});

export default defineDecl(ConditionalAlwaysHitAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.always-hit-check",
  label: "Never miss with the moves I choose",
  summary: params => {
    const rules: string[] = [];
    if (params.flag !== "None") {
      rules.push(`have the ${params.flag} property`);
    }
    if (params.category !== "Any") {
      rules.push(`are ${String(params.category).toLowerCase()} moves`);
    }
    if (String(params.moveIds) !== "") {
      rules.push(`are one of ${params.moveIds}`);
    }
    if (String(params.weather) !== "") {
      rules.push(`are used in ${params.weather}`);
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
      label: "Only moves with this property",
      editable: true,
      default: "None",
      options: ["None", ...MOVE_FLAG_OPTIONS],
      codec: flagParam,
    },
    {
      id: "category",
      ctorIndex: 0,
      ctorOption: "categories",
      path: "opts",
      control: "select",
      label: "Only moves of this kind",
      editable: true,
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
      label: "Only these moves (comma separated, empty = every move)",
      editable: true,
      default: "",
      options: enumOptions(MoveId),
      codec: moveIdsParam,
    },
    {
      id: "weather",
      ctorIndex: 0,
      ctorOption: "weather",
      path: "opts",
      control: "text",
      label: "Only while this weather is active (comma separated, empty = any weather)",
      editable: true,
      default: "",
      options: enumOptions(WeatherType),
      codec: weatherParam,
    },
    {
      id: "superEffective",
      ctorIndex: 0,
      ctorOption: "superEffective",
      path: "opts",
      control: "boolean",
      label: "Only when the move is super effective on the target",
      editable: true,
      default: false,
      codec: { ...booleanFromOpts("superEffective") },
    },
    {
      id: "targetHasTag",
      ctorIndex: 0,
      ctorOption: "targetHasTag",
      path: "opts",
      control: "select",
      label: "Only when the target already has this lasting effect",
      editable: true,
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
      label: "Only when the target is trapped (cannot switch out)",
      editable: true,
      default: false,
      codec: { ...booleanFromOpts("targetTrapped") },
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.always-hit", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a contact move, a slicing move, a status move and a super effective move",
      axes: { foeMove: ["TACKLE", "AIR_SLASH", "GROWL", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The class is read by a duck-typed scan inside the accuracy check (MoveEffectPhase.checkBypassAccAndInvuln), not dispatched, so no trace event shows it evaluated. The B08 test (test/tests/elite-redux/decomp/B08/conditional-always-hit.test.ts) compares matches(move, user, target) of the original and the rebuild over every grid move, both categories, several weathers and target states.",
  status: "decomposed",
  notes:
    "Tier C, the whole decision lives in matches(). WHEN `calc.always-hit-check` added to the library (R-B08-12). 38 live attrs: Inner Focus, Enlightened, Unlocked Potential, Way of Precision, Monk, Heartless Style (Focus Blast style moveIds [411]), Aurora Borealis (Blizzard), Shiny Lightning (Thunder), Angel's Wrath (a four-move list), Hypnotic Trance (Hypnosis), Fatal Precision (x2), Final Blow, Deadly Precision, Flawless Precision, Mach 3, Heartless Style (x2) (super effective), Grip Pincer and Venoblaze Pincers (target trapped), Deadeye, Hunter's Mark and Celestial Bow (arrow and ball-bomb moves), Artillery and Super Scope (pulse), Roundhouse and Kyokushin (kicking), Sweeping Edge, Blademaster, Pinnacle Blade, Puncture (slicing), Gifted Mind and Unintentional Genius (status category), Echolocation (fog and eerie fog), Poseidon's Dominion (no setting: every move). The class's own matchesMove tests the flag with doesFlagEffectApply({ flag, user }) (user-aware, no target); the matcher is kept exactly. superEffective uses effectiveness strictly above 1. The `categories` list holds one item for every live user, so the param is a single category. The second source of 'never misses' in the same engine scan, ER_USER_TYPE_ALWAYS_HIT and ER_WEATHER_ALWAYS_HIT (move-intrinsic maps, not abilities), is not an attr and is not part of this declaration.",
});
