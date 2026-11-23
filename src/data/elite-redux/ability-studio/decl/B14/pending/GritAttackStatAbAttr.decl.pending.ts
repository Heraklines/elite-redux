/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. PARKED until the librarian adds this class to the `alsoDispatchKeys` of the WHEN `calc.attack-stat` (B08 added that WHEN,
// R-B08-7, with dispatch key AttackStatSubstituteAbAttr; request R-B14-4.9 asks for this sibling by-name reader to join it); then rename
// this file to GritAttackStatAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "While I have a status condition, my physical moves attack with my Defense and my special moves with my Sp. Def" (Grit).
//
// Source: bernerd-roster-mechanics.ts GritAttackStatAbAttr (extends AbAttr, no dispatch key). Pokemon.getBaseDamage (field/pokemon.ts, about
// line 5612) scans the attacker's `getAllActiveAbilityAttrs()` (skipped when the attacker's abilities are ignored) for any attr with a
// `resolveStat` function and, when it answers a stat, replaces the attacker's offensive stat with `source.getEffectiveStat(answer, ...)`.
// resolveStat(move, isPhysical, source), original order, now `gate` then the effect:
//   gate    1. source.status exists, its effect is not NONE and not FAINT   -> a non-volatile status condition (burn, poison, sleep ...)
//   effect  2. isPhysical ? DEF : SPDEF                                      the stat to attack with
// The two stats were literals; they are now constructor arguments 0 and 1 (defaults Defense and Sp. Def). No random draw, no state, no `simulated`.
import { GritAttackStatAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { OFFENSE_STAT_WORDS, offenseStatCodec } from "#data/elite-redux/ability-studio/decl/B14/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(GritAttackStatAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.attack-stat",
  label: "Attack with my defenses while I have a status condition",
  summary: params =>
    `While I have a status condition (burn, poison, paralysis...), my physical moves attack with my ${params.physicalStat} and my special moves with my ${params.specialStat}, instead of Attack and Sp. Atk.`,
  synonyms: [
    "grit",
    "use defense to attack",
    "body press when statused",
    "status attack swap",
    "attack with defense",
    "burned attacker boost",
    "guts style",
  ],
  examples: ["While I am burned or poisoned, my moves hit with my Defense and Sp. Def"],
  params: [
    {
      id: "physicalStat",
      ctorIndex: 0,
      path: "physicalStat",
      control: "select",
      label: "Stat my physical moves attack with (instead of Attack)",
      editable: true,
      default: "Defense",
      options: Object.keys(OFFENSE_STAT_WORDS),
      codec: offenseStatCodec,
      gateIndependent: true,
    },
    {
      id: "specialStat",
      ctorIndex: 1,
      path: "specialStat",
      control: "select",
      label: "Stat my special moves attack with (instead of Sp. Atk)",
      editable: true,
      default: "Sp. Def",
      options: Object.keys(OFFENSE_STAT_WORDS),
      codec: offenseStatCodec,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = a non-volatile status (legacy until the atom status.has-major exists, bindings.chunk4.pending.ts). Removable.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing while the game ignores my ability (for example a move that ignores abilities)",
    "Uses the chosen stat as it is worked out for me, stat stages included",
  ],
  // Package, reason in notes: the library has no effect that swaps the stat the damage formula reads.
  effect: { id: "effect.package", params: ["physicalStat", "specialStat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The class is read by a duck-typed scan inside the damage formula (Pokemon.getBaseDamage), not dispatched, so no trace event shows it evaluated. test/tests/elite-redux/decomp/B14/chunk4.test.ts compares resolveStat of the original and the rebuild over every status, both categories and several moves.",
  probes: [
    {
      name: "no status and a status",
      axes: { status: ["NONE", "BURN", "PARALYSIS"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. Users (1): Grit (6110) attr 0 (its only attr). The gate is a LEGACY binding: the library atom status.has reads `pokemon.status != null` for ANY, which also counts a status whose effect is NONE and the FAINT marker, while the class refuses both; the exact atom `status.has-non-volatile` is requested (R-B14-4.10). Package (effect only), reason: no library effect swaps the offensive stat the damage formula reads (B08 packaged AttackStatSubstituteAbAttr for the same reason, the same effect is wanted there); the two stats are typed settings. Oddities, not fixed: (1) the answer is the attacker's OWN Defense or Sp. Def (getEffectiveStat on the source, not on the target), so it behaves like Body Press for every move; (2) a fainted attacker never reaches the damage formula, so the FAINT clause is only a safety net.",
});
