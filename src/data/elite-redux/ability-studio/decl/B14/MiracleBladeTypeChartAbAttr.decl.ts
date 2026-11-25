/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. PARKED until the librarian adds a trigger whose dispatch keys include this class (request R-B14-2.1, the same
// by-name type-matchup scan that B08 added as `calc.my-attack-matchup` and B12 asked to extend, R-B12-40). Then rename this file to
// MiracleBladeTypeChartAbAttr.decl.ts, move the binding of `pending/bindings.chunk2.pending.ts` into `bindings.ts` and set `when`.
// The registry only collects `*.decl.ts`, so the class counts as undeclared (and is listed in the coverage report) until then.
//
// "Moves with the slicing property are super effective against Dark types" (Miracle Blade: Keen Edge moves vs Dark).
//
// Source: fakemon-pitch-mechanics.ts MiracleBladeTypeChartAbAttr (extends AbAttr directly, `super(false)`). It rides NO standard
// dispatch key: Pokemon.getAttackTypeEffectiveness (field/pokemon.ts:4398) scans the attacker's active attrs BY CONSTRUCTOR NAME and
// calls `fire(move, defenderTypes, multi, moveType, source)`; `canApply` and `apply` are never called.
// Clauses of `fire`, in the original order (Tier B, the gate is the first two):
//   gate    1. the move has the flag: with a user `move.doesFlagEffectApply({ flag, user })`, without a user `move.hasFlag(flag)`
//           2. defenderTypes.includes(defenderType)       the DEFENDING types handed in by the engine include the type
//   effect  3. moveType undefined (a preview with no move type)      multi = factor
//           4. natural = getTypeDamageMultiplier(moveType, defenderType)
//              natural 0 (the type is immune)    multi = (product over the OTHER defender types, the first Dark skipped) x factor
//              otherwise                          multi = multi / natural x factor      (that type's share is swapped for `factor`)
// No random draw, no state, no `simulated` test. Clause 2 reads the list the engine passes (it can differ from the target's own
// types, for example during the Tera or Forest's Curse rewrites), so `mon.has-type` is NOT the same predicate.
//
// Library form of the gate: all[ move.flag { flag }, matchup.defender-has-type { type } ]. The first atom exists (move.flag is
// doesFlagEffectApply; it differs from the class only when the engine passes no user, which it always does for a real attack).
// The second atom does not exist (request R-B14-2.2). The effect rewrites the type multiplier, which no library effect does
// (request R-B08-11 effect.set-matchup, shared with Bone Zone), so the effect is a package for that part only.
import { MiracleBladeTypeChartAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";

/** Move property name <-> MoveFlags member. */
const flagCodec: ParamCodec = {
  toCtor: value => (MoveFlags as unknown as Record<string, number>)[String(value)],
  fromInstance: raw => MOVE_FLAG_OPTIONS.find(name => (MoveFlags as unknown as Record<string, number>)[name] === raw),
};

export default defineDecl(MiracleBladeTypeChartAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.my-attack-matchup",
  label: "Make my slicing moves hit one type for set effectiveness",
  summary: params =>
    `My moves with the ${params.flag} property treat a ${params.defenderType} target as if its matchup were x${params.factor}, even when it is immune. Example: 2 = super effective.`,
  synonyms: [
    "miracle blade",
    "keen edge",
    "slicing moves",
    "super effective against dark",
    "ignore immunity",
    "force effectiveness",
    "type chart override",
  ],
  examples: ["My slicing moves are always super effective against Dark types"],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      path: "flag",
      control: "select",
      label: "Only for moves with this property",
      editable: true,
      default: "SLICING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: flagCodec,
    },
    {
      id: "defenderType",
      ctorIndex: 1,
      path: "defenderType",
      control: "select",
      label: "Defending type whose matchup is replaced",
      editable: true,
      default: "DARK",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType as unknown as Record<string, number>, "type"),
    },
    {
      id: "factor",
      ctorIndex: 2,
      path: "factor",
      control: "number",
      min: 0,
      max: 8,
      step: 0.25,
      label: "Effectiveness against that type (2 = super effective, 1 = neutral, 0 = no effect)",
      editable: true,
      default: 2,
      gateIndependent: true,
    },
  ],
  gateParams: [
    { param: "flag", block: "move.flag", field: "flag" },
    { param: "defenderType", block: "matchup.defender-has-type", field: "type" },
  ],
  conditions: [
    // Gate = [move has the property, the defending types include the type], in that order. Removable.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["When the game asks without knowing the move type, the answer is just the set effectiveness"],
  effect: { id: "effect.package", params: ["factor"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a slicing move and a normal move against a Dark, an immune and a mixed-type target", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan in the type-effectiveness calculation, not dispatched, so no trace event shows it evaluated; B14/chunk2-gate-split.test.ts calls fire() on the original source and the refactored class for slicing and other moves against Dark, immune and mixed targets.",
  status: "decomposed",
  notes:
    "Tier B, parked (see the header). The flag (Slicing), the defending type (Dark) and the effectiveness (2) were hard-coded; they are now constructor arguments 0 to 2 with the same defaults and params (`super(false)` is untouched, showAbility stays false). Users (1): Miracle Blade (6064) attr 0. The effect stays one piece: it swaps the share of the one defending type for the set factor, and for an immune type multiplies the OTHER types' matchups by the factor. Library has no effect that rewrites the type multiplier (R-B08-11 effect.set-matchup). Engine call site: Pokemon.getAttackTypeEffectiveness by class name, unchanged except it already passed the attacker. Oddity, not fixed: the call site passes `source` only when it is known, and the class then falls back to the move's own flag; the engine passes it for every real attack.",
});
