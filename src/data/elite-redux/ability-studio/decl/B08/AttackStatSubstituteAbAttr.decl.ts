/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier (Tier B, review round 4).
//
// The class extends only AbAttr and is never dispatched through applyAbAttrs: Pokemon.getBaseDamage (field/pokemon.ts, around line 5612) scans
// the attacker's `getAllActiveAbilityAttrs()` for any attr that has a `resolveStat` function and calls
// `attr.resolveStat(move, isPhysical, source)`.
// The library trigger `calc.attack-stat` carries the class's own name as its dispatch key (vocabulary/when-registry.ts), so the L0 rule
// "the WHEN's dispatch key is the class or an ancestor" holds. L2 cannot reach it with a battle template (it is listed as
// unreached in decomp-l2-reach.json), so the declaration carries an `l2StaticReason` and its own B08 test drives the engine-side call.
//
// What the class is (read from the source and from the 15 live users): one options object, no closure, no random draw.
//   resolveStat(move, isPhysical, source), in order:
//     GATE (the three move filters, pure, replaceable through gateOverride, called at the top of resolveStat via gatedCanApply):
//       1. moveIds set and move.id not in it                    -> no substitution          atom move.is-move (any[...] for a list)
//       2. contactOnly and !move.hasFlag(MAKES_CONTACT)         -> no substitution          atom move.inherent-flag MAKES_CONTACT (the move's OWN flag; Long Reach is ignored)
//       3. flag set and !move.hasFlag(flag)                     -> no substitution          atom move.inherent-flag <flag>
//     EFFECT (stays in the class, one piece):
//       4. useHigherOffense: ATK if source.getStat(ATK) >= getStat(SPATK) else SPATK   (raw stats, no stages)
//       5. useLowerOffense:  ATK if source.getStat(ATK) <= getStat(SPATK) else SPATK
//       6. otherwise (isPhysical ? physicalStat : specialStat), or no substitution when that stat is unset
//   The engine then replaces the attacker's offensive stat with that effective stat. The constructor throws when both the
//   higher and the lower mode are set.
// "Only contact moves use Speed" (Momentum) and "only biting moves use Sp. Atk" (Mind Crunch, Megabite, Gnashing Cannon) are real IFs, so they are
// the replaceable gate of a Tier B class: staff can remove one, change it or AND another IF in. Every live user's gate is bound by hand
// in bindings.ts. The three settings stay on the instance (not editable) only so a rebuild keeps the same options; the gate carries them.
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import {
  MOVE_NAMES,
  moveNamesCodec,
  NO_PROPERTY,
  PROPERTY_CHOICES,
  propertyCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import { Stat } from "#enums/stat";

/** The stats a player can pick, in player words ("None" leaves that kind of move alone). */
const STAT_WORDS = ["None", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"] as const;
const STAT_BY_WORD: Readonly<Record<string, number>> = {
  Attack: Stat.ATK,
  Defense: Stat.DEF,
  "Sp. Atk": Stat.SPATK,
  "Sp. Def": Stat.SPDEF,
  Speed: Stat.SPD,
};

/** "None" <-> undefined (the stat is left alone), otherwise the Stat member. */
const optionalStatCodec: ParamCodec = {
  toCtor: value => (value === "None" ? undefined : STAT_BY_WORD[String(value)]),
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "None";
    }
    return STAT_WORDS.find(word => word !== "None" && STAT_BY_WORD[word] === raw);
  },
};

/** "" <-> undefined (every move), otherwise the listed moves by their names. */
const moveListCodec: ParamCodec = {
  toCtor: value => (String(value).trim() === "" ? undefined : moveNamesCodec.toCtor(value)),
  fromInstance: raw => (raw === undefined || raw === null ? "" : moveNamesCodec.fromInstance(raw)),
};

export default defineDecl(AttackStatSubstituteAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.attack-stat",
  label: "Attack using a different stat",
  summary: params => {
    const conditions: string[] = [];
    if (params.contactOnly === true) {
      conditions.push("make contact");
    }
    if (params.flag !== undefined && params.flag !== NO_PROPERTY) {
      conditions.push(`are ${String(params.flag).toLowerCase()}`);
    }
    if (params.moveIds !== undefined && String(params.moveIds) !== "") {
      conditions.push("are on a chosen list");
    }
    const scope = conditions.length === 0 ? "My attacks" : `My attacks that ${conditions.join(" and ")}`;
    if (params.useHigherOffense === true) {
      return `${scope} use whichever is higher of my Attack and Sp. Atk, instead of the stat they normally use.`;
    }
    if (params.useLowerOffense === true) {
      return `${scope} use whichever is lower of my Attack and Sp. Atk, instead of the stat they normally use.`;
    }
    const physical = String(params.physicalStat);
    const special = String(params.specialStat);
    if (physical !== "None" && special !== "None") {
      return `${scope}: physical ones use my ${physical} and special ones use my ${special}, instead of Attack and Sp. Atk.`;
    }
    if (physical !== "None") {
      return `${scope}: physical ones use my ${physical} instead of Attack. Special ones are unchanged.`;
    }
    if (special !== "None") {
      return `${scope}: special ones use my ${special} instead of Sp. Atk. Physical ones are unchanged.`;
    }
    return `${scope} keep their normal stat. Pick a stat for physical or special moves to change that. Example: Body Press style.`;
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
      gateIndependent: true,
      default: "None",
      options: STAT_WORDS,
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
      gateIndependent: true,
      default: "None",
      options: STAT_WORDS,
      codec: optionalStatCodec,
    },
    {
      id: "contactOnly",
      ctorIndex: 0,
      ctorOption: "contactOnly",
      path: "contactOnly",
      control: "boolean",
      label: "Only for moves that make contact (set by the conditions)",
      // A condition of the gate (move.inherent-flag MAKES_CONTACT), carried by each user's binding.
      editable: false,
      default: false,
    },
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Only for moves with this property (None = any move) (set by the conditions)",
      // A condition of the gate (move.inherent-flag <property>), carried by each user's binding.
      editable: false,
      default: NO_PROPERTY,
      options: PROPERTY_CHOICES,
      codec: propertyCodec,
    },
    {
      id: "useHigherOffense",
      ctorIndex: 0,
      ctorOption: "useHigherOffense",
      path: "useHigherOffense",
      control: "boolean",
      label: "Use the higher of my Attack and Sp. Atk for every attack",
      editable: true,
      gateIndependent: true,
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
      gateIndependent: true,
      default: false,
    },
    {
      id: "moveIds",
      ctorIndex: 0,
      ctorOption: "moveIds",
      path: "moveIds",
      control: "text",
      label: "Only for these moves (comma separated, empty = every move) (set by the conditions)",
      // A condition of the gate (move.is-move, any of the list), carried by each user's binding.
      editable: false,
      default: "",
      options: MOVE_NAMES,
      codec: moveListCodec,
    },
  ],
  conditions: [
    // The gate is a group of atoms per user, in the original order (bindings.ts): [move.is-move M] (any[...] for a list),
    // [move.inherent-flag MAKES_CONTACT], [move.inherent-flag F]. A user with no filter has the always-true group { all: [] }.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The higher and the lower mode cannot both be on",
    "A stat that is None leaves that kind of move on its normal stat",
  ],
  effect: {
    id: "effect.package",
    params: ["physicalStat", "specialStat", "useHigherOffense", "useLowerOffense"],
  },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a contact move, a bite move and a special move",
      axes: { foeMove: ["TACKLE", "BITE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The class is read by a duck-typed scan inside the damage formula (Pokemon.getBaseDamage), not dispatched, so no trace event shows it evaluated. The B08 test (test/tests/elite-redux/decomp/B08/attack-stat-substitute.test.ts) compares resolveStat of the original and the rebuild (the library gate of every binding) over every grid move, both categories and several Attack / Sp. Atk orders.",
  status: "decomposed",
  notes:
    "Tier B (review round 4): resolveStat is gatedCanApply over a replaceable `gate` (the same three clauses in the same order, no guard, no residual, no random draw) followed by the stat choice, which stays in the class as the one-piece effect (effect.package: there is no library effect that swaps the stat the damage formula reads; the choice of stats, higher or lower is its set of params). The three filters (move list, contact, move property) are library atoms bound per user (bindings.ts), so staff can remove one, change it or AND another IF in (reusableAlone.if is true). The engine call site still calls resolveStat directly (no dispatch); that is fine because resolveStat itself honours the replaced gate. The settings stay on the instance only so a rebuild keeps the same options; they are not editable because the gate carries them. WHEN `calc.attack-stat` added to the library (R-B08-7 done). 15 users, all bound: Ancient Idol (Defense / Sp. Def, no filter), Momentum (Speed, contact), Equinox (higher, no filter), Magistrate (higher, no filter), Formless Fist (higher, punching), Mimicry (higher, six terrain moves), Subversion (lower, no filter), Mind Crunch, Megabite, Gnashing Cannon (Sp. Atk for biting moves), Magical Fists (Sp. Atk for punching), Mythical Arrows and Kagutsuchi (Sp. Atk for arrow moves), Energy Horns (Sp. Atk for horn moves), Magic Touch (Sp. Atk on contact for both kinds of move). The contact test is the move's OWN flag (move.hasFlag), so the atom is move.inherent-flag (Long Reach does not change it), not move.flag. showAbility is false for every user (the class passes false to AbAttr). Related by-name classes RelativityAbAttr and the subversion category half are separate classes.",
});
