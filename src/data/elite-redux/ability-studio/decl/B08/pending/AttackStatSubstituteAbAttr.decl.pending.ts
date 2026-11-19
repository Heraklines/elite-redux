/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier (Tier C). PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick
// it up yet. Reason: the class extends only AbAttr and is never dispatched through applyAbAttrs. The engine finds it BY
// NAME-LESS DUCK TYPING inside Pokemon.getBaseDamage (pokemon.ts, around line 5612): it scans the attacker's
// `getAllActiveAbilityAttrs()` for any attr that has a `resolveStat` function and calls
// `attr.resolveStat(move, isPhysical, source)`. No WHEN of WHEN_REGISTRY has the class or an ancestor as its dispatch key
// (the chain is AttackStatSubstituteAbAttr, AbAttr), so the L0 rule "the WHEN's dispatch key is the class or an ancestor"
// cannot be met, and a batch may not edit the library (spec 6, step 3). The request is requests/B08.md R-B08-7.
//
// To finish: once the librarian has added the WHEN `calc.attack-stat` (dispatch key AttackStatSubstituteAbAttr), rename this
// file to AttackStatSubstituteAbAttr.decl.ts, make sure the id below matches, and run L0 / L1 for the class.
//
// What the class is (read from the source and from the 15 live users): one options object, no closure, no random draw.
//   resolveStat(move, isPhysical, source), in order:
//     1. moveIds set and move.id not in it                    -> no substitution
//     2. contactOnly and !move.hasFlag(MAKES_CONTACT)         -> no substitution (the move's OWN flag; Long Reach is ignored)
//     3. flag set and !move.hasFlag(flag)                     -> no substitution
//     4. useHigherOffense: ATK if source.getStat(ATK) >= getStat(SPATK) else SPATK   (raw stats, no stages)
//     5. useLowerOffense:  ATK if source.getStat(ATK) <= getStat(SPATK) else SPATK
//     6. otherwise (isPhysical ? physicalStat : specialStat), or no substitution when that stat is unset
//   The engine then replaces the attacker's offensive stat with that effective stat. The constructor throws when both the
//   higher and the lower mode are set.
// The filters of steps 1 to 3 are SETTINGS of the class (constructor fields), not closures, so there is no condition
// slot. The engine never calls canApply for this class, so extra IFs cannot be ANDed on top: reusableAlone.if is false.
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";

const STAT_CHOICES = ["NONE", "ATK", "DEF", "SPATK", "SPDEF", "SPD"] as const;

/** "NONE" <-> undefined (the stat is left alone), otherwise the Stat member. */
const optionalStatCodec: ParamCodec = {
  toCtor: value => (value === "NONE" ? undefined : (Stat as unknown as Record<string, number>)[String(value)]),
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "NONE";
    }
    return STAT_CHOICES.find(name => name !== "NONE" && (Stat as unknown as Record<string, number>)[name] === raw);
  },
};

/** "NONE" <-> undefined (no flag needed), otherwise the MoveFlags member. */
const optionalFlagCodec: ParamCodec = {
  toCtor: value => (value === "NONE" ? undefined : (MoveFlags as unknown as Record<string, number>)[String(value)]),
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "NONE";
    }
    return MOVE_FLAG_OPTIONS.find(name => (MoveFlags as unknown as Record<string, number>)[name] === raw);
  },
};

const moveListCodec: ParamCodec = {
  toCtor: value => (String(value).trim() === "" ? undefined : enumListCodec(MoveId, "move").toCtor(value)),
  fromInstance: raw => (raw === undefined || raw === null ? "" : enumListCodec(MoveId, "move").fromInstance(raw)),
};

export default defineDecl(AttackStatSubstituteAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.attack-stat",
  label: "Attack using a different stat",
  summary: params => {
    if (params.useHigherOffense === true) {
      return "My attacks use whichever is higher of my Attack and Sp. Atk, instead of the stat the move normally uses.";
    }
    if (params.useLowerOffense === true) {
      return "My attacks use whichever is lower of my Attack and Sp. Atk, instead of the stat the move normally uses.";
    }
    return `My physical attacks use my ${params.physicalStat} and my special attacks use my ${params.specialStat} instead of Attack and Sp. Atk. None means that kind is unchanged. Example: Body Press style.`;
  },
  synonyms: [
    "body press",
    "use defense to attack",
    "attack with another stat",
    "swap attack stat",
    "offensive stat swap",
    "higher attacking stat",
    "ancient idol",
    "momentum",
  ],
  examples: ["My physical moves use Defense and my special moves use Sp. Def", "Contact moves use my Speed to hit"],
  params: [
    {
      id: "physicalStat",
      ctorIndex: 0,
      ctorOption: "physicalStat",
      path: "physicalStat",
      control: "select",
      label: "Stat my physical moves use instead of Attack (None = unchanged)",
      editable: true,
      default: "NONE",
      options: STAT_CHOICES,
      codec: optionalStatCodec,
    },
    {
      id: "specialStat",
      ctorIndex: 0,
      ctorOption: "specialStat",
      path: "specialStat",
      control: "select",
      label: "Stat my special moves use instead of Sp. Atk (None = unchanged)",
      editable: true,
      default: "NONE",
      options: STAT_CHOICES,
      codec: optionalStatCodec,
    },
    {
      id: "contactOnly",
      ctorIndex: 0,
      ctorOption: "contactOnly",
      path: "contactOnly",
      control: "boolean",
      label: "Only for moves that make contact",
      editable: true,
      default: false,
    },
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Only for moves with this property (None = any move)",
      editable: true,
      default: "NONE",
      options: ["NONE", ...MOVE_FLAG_OPTIONS],
      codec: optionalFlagCodec,
    },
    {
      id: "useHigherOffense",
      ctorIndex: 0,
      ctorOption: "useHigherOffense",
      path: "useHigherOffense",
      control: "boolean",
      label: "Use the higher of my Attack and Sp. Atk for every attack",
      editable: true,
      default: false,
    },
    {
      id: "useLowerOffense",
      ctorIndex: 0,
      ctorOption: "useLowerOffense",
      path: "useLowerOffense",
      control: "boolean",
      label: "Use the lower of my Attack and Sp. Atk for every attack",
      editable: true,
      default: false,
    },
    {
      id: "moveIds",
      ctorIndex: 0,
      ctorOption: "moveIds",
      path: "moveIds",
      control: "text",
      label: "Only for these moves (comma separated, empty = every move)",
      editable: true,
      default: "",
      options: enumOptions(MoveId),
      codec: moveListCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The higher and the lower mode cannot both be on",
    "A stat that is None leaves that kind of move on its normal stat",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a contact move, a bite move and a special move",
      axes: { foeMove: ["TACKLE", "BITE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The class is read by a duck-typed scan inside the damage formula (Pokemon.getBaseDamage), not dispatched, so no trace event shows it evaluated. The B08 test (test/tests/elite-redux/decomp/B08/attack-stat-substitute.test.ts) compares resolveStat of the original and the rebuild over every grid move, both categories and several Attack / Sp. Atk orders.",
  status: "decomposed",
  notes:
    "Tier C, the whole decision lives in resolveStat. Parked until the WHEN `calc.attack-stat` exists (R-B08-7). 15 users: Ancient Idol (Def / Sp. Def), Momentum (Speed on contact), Equinox, Magistrate, Formless Fist (punch flag), Mimicry (terrain moves, higher), Subversion (lower), Mind Crunch, Megabite, Gnashing Cannon (biting, Sp. Atk), Magical Fists (punching), Mythical Arrows, Kagutsuchi (arrow), Energy Horns (horn), Magic Touch (Sp. Atk on contact for both kinds of move). Nothing to bind. showAbility is false for every user (the class passes false to AbAttr). Related by-name classes RelativityAbAttr and the subversion category half are separate classes.",
});
