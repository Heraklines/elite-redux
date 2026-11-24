/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveFlags } from "#enums/move-flags";
// Juggernaut and Precise Fist (Tier B). "After my attack lands, IF it was a damaging move AND (when asked) it made contact AND
// (when asked) it carries a move property, DO remove Reflect, Light Screen and Aurora Veil from the target's side".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostAttackAbAttr (constructor `super(undefined, false)`: the
// default attack condition "the move is not a status move", showAbility false). Dispatch:
// applyAbAttrs("PostAttackAbAttr", { pokemon, opponent, move, simulated, ... }) after the holder's move hit.
//
// canApply, in the ORIGINAL clause order (now guards && gate; every clause is a pure read, so the safety rule runs first):
//   gate part 1   move.category !== STATUS                                       (the inherited default attackCondition)
//   guard         opponent exists and is not fainted
//   gate part 2   options.contactRequired -> move.doesFlagEffectApply({ MAKES_CONTACT, user: holder, target: opponent })
//   gate part 3   options.flag === undefined || move.hasFlag(options.flag)
// apply: unless simulated, arena.removeTagsOnSide(the screens list, default [REFLECT, LIGHT_SCREEN, AURORA_VEIL], the OPPONENT's side).
import { BreakScreensOnAttackAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";

/** Every move property a screen breaker can ask for. "NONE" = no property (any damaging hit); "MAKES_CONTACT" = the contact option. */
const PROPERTY_NAMES = [
  "NONE",
  "MAKES_CONTACT",
  ...enumOptions(MoveFlags).filter(name => name !== "NONE" && name !== "MAKES_CONTACT"),
];

const flagTable = MoveFlags as unknown as Record<string, unknown>;

/** The field effects a screen breaker can remove (ArenaTagType is a string enum, so the staff text is the constructor text). */
const SCREEN_NAMES = ["REFLECT", "LIGHT_SCREEN", "AURORA_VEIL", "MIST", "SAFEGUARD", "TAILWIND"].filter(
  name => name in ArenaTagType,
);

/** A comma separated list of field effect names <-> the array the constructor takes; an unknown name or an empty list is refused. */
const screensCodec: ParamCodec = {
  toCtor: value => {
    const names = String(value)
      .split(",")
      .map(part => part.trim())
      .filter(part => part.length > 0);
    if (names.length === 0) {
      throw new Error("pick at least one field effect to remove");
    }
    return names.map(name => {
      if (!SCREEN_NAMES.includes(name)) {
        throw new Error(`"${name}" is not a field effect staff can pick here`);
      }
      return ArenaTagType[name as keyof typeof ArenaTagType];
    });
  },
  fromInstance: raw =>
    Array.isArray(raw) && raw.every(item => typeof item === "string" && SCREEN_NAMES.includes(item))
      ? raw.join(",")
      : undefined,
};

/**
 * The class keeps one options object, `{ contactRequired?, flag? }`. Staff see ONE property list: None gives `{}`, Makes contact gives
 * `{ contactRequired: true }`, any other property gives `{ flag }`. The object keeps exactly the keys the original abilities use, so a
 * rebuild is identical. An options object that asks for both (no ability does) cannot be shown and reads back as undefined.
 */
const propertyCodec: ParamCodec = {
  toCtor: value => {
    const name = String(value);
    if (name === "NONE") {
      return {};
    }
    if (name === "MAKES_CONTACT") {
      return { contactRequired: true };
    }
    const resolved = flagTable[name];
    if (typeof resolved !== "number") {
      throw new Error(`"${name}" is not a known move property`);
    }
    return { flag: resolved };
  },
  fromInstance: raw => {
    if (typeof raw !== "object" || raw === null) {
      return;
    }
    const { contactRequired, flag } = raw as { contactRequired?: boolean; flag?: number };
    if (contactRequired === true && flag === undefined) {
      return "MAKES_CONTACT";
    }
    if (flag === undefined && contactRequired !== true) {
      return "NONE";
    }
    if (contactRequired !== true) {
      return PROPERTY_NAMES.find(name => flagTable[name] === flag);
    }
    return;
  },
};

export default defineDecl(BreakScreensOnAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Break the target's screens after my attack hits",
  summary: params =>
    `After my damaging attack hits, the target's side loses ${params.screens}. The conditions decide which hits count (move property required now: ${params.requiredProperty}).`,
  synonyms: [
    "brick break",
    "screen breaker",
    "shatter screens",
    "remove reflect",
    "juggernaut",
    "precise fist",
    "break light screen",
  ],
  examples: ["After a contact move hits, remove the foe's screens, like Juggernaut"],
  params: [
    {
      id: "requiredProperty",
      ctorIndex: 0,
      path: "options",
      control: "select",
      label: "Only moves with this property break screens (None = any damaging move)",
      // Not editable: the property test is one of the gate's atoms (move.flag), spelled out per user in bindings.ts, so a
      // changed value would be ignored by the compiled gate (and a different value changes the SHAPE of the gate);
      // staff add, drop or swap that atom instead.
      editable: false,
      default: "NONE",
      options: PROPERTY_NAMES,
      codec: propertyCodec,
    },
    {
      id: "screens",
      ctorIndex: 1,
      path: "screens",
      control: "text",
      label: "Field effects removed from the target's side (comma separated)",
      editable: true,
      gateIndependent: true,
      default: "REFLECT,LIGHT_SCREEN,AURORA_VEIL",
      options: SCREEN_NAMES,
      codec: screensCodec,
    },
  ],
  conditions: [
    // The gate is all[move.damaging, move.flag MAKES_CONTACT] for the contact user and all[move.damaging, move.flag
    // PUNCHING_MOVE] for the punching user, spelled out per user in bindings.ts, in the class's own order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  // The class keeps "the target must still be standing" in its own `guards` method; no registered guard id says it yet
  // (request R-B18-20), so it is listed as feasibility below and not as a guard id.
  guards: [],
  feasibility: [
    "The target must still be standing",
    "Nothing is removed while the game is only previewing",
    "Only the listed field effects are removed, and only from the target's side",
  ],
  effect: { id: "effect.package", params: ["screens"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a contact move and a move without contact", axes: {} }],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'remove these field effects from a side' has no library effect (effect.arena-tag only sets one); request R-B18-18 asks for 'Remove field effects' with a list and a side. The field effects that break (Reflect, Light Screen, Aurora Veil by default) are a typed setting: the constructor takes them as its second argument (default the three screens), added with this declaration without changing behaviour for the shipped abilities. The trigger (event.after-my-hit) and every condition are separate blocks: 'the move deals damage' is move.damaging (the same `category !== STATUS` the inherited default condition tests), contact is move.flag MAKES_CONTACT (the class calls doesFlagEffectApply with the holder as user and the opponent as target, as the atom does) and the property test is move.flag with the property name. The only clause kept in the class is 'the target is still standing' (class `guards`, request R-B18-20). The class keeps one options object ({ contactRequired } or { flag }); staff see it as ONE property list (None, Makes contact, or a move property), readable but not editable because it changes the SHAPE of the gate: staff add, drop or swap the matching atom instead. An options object asking for both at once (no ability does) has no value in that list. Users: Juggernaut (5059, attr 2, property Makes contact) and Precise Fist (5112, attr 2, property Punching move). KNOWN DIFFERENCE (not fixed, request R-B18-21): for the property test the class calls move.hasFlag(flag) (the raw flag) while the atom move.flag calls doesFlagEffectApply, which also counts flags that abilities inject (Dance, Sound, Horn, Slicing). For PUNCHING_MOVE nothing injects the flag, so Precise Fist is identical; a staff rule with an injected property would differ slightly from this class. Clause order: the old canApply tested the damaging default first, then the standing target; the split runs the standing-target guard first. All clauses are pure reads (no draw, no write), and B18/chunk2.test.ts proves the same answer over every combination.",
});
