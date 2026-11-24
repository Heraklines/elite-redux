/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Package (Tier C). "When I act before my target this turn, my damaging moves use my Speed in place of Attack or Sp. Atk."
//
// Source: src/data/elite-redux/abilities/relativity.ts, class RelativityAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty, there is no canApply of its own).
// It is an offence marker plus a resolver. Nothing dispatches it: Pokemon.getBaseDamage (src/field/pokemon.ts:5636) scans the ATTACKER's attrs by constructor name and calls
// resolveOffenseStat(source, target), which returns:
//   1. pokemonActedBefore(source, target) ? Stat.SPD : null                                             -> condition (the order test) + effect (the stat to use)
//      pokemonActedBefore reads the authoritative per-turn move order, dynamicQueueManager.getLastTurnOrder(): the source must be in it; a target that is not in it has not acted yet (so the
//      source is first); both present -> compare their indices. It is the real order of the Trick Room aware queue, so Trick Room is respected for free.
// When the resolver answers a stat, getBaseDamage reads the SOURCE's own effective stat for it (getEffectiveStat(sub, target, ...)) in place of the move's attack stat. No random draw, no state of its own.
// Constructor change (behaviour-neutral): the substitute stat is a constructor argument (default Speed).
// The twin attr in the same ability, RelativityDefenseReductionAbAttr, is a separate class with its own declaration.
import { RelativityAbAttr } from "#data/elite-redux/abilities/relativity";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { Stat } from "#enums/stat";

const OFFENCE_STAT_OPTIONS = ["ATK", "DEF", "SPATK", "SPDEF", "SPD"] as const;

export default defineDecl(RelativityAbAttr, {
  tier: "C",
  kind: "package",
  when: "while.active",
  label: "Use another stat in place of Attack when I move first",
  summary: params =>
    `When I act before my target this turn, my damaging moves use my ${params.substituteStat} stat in place of Attack or Sp. Atk (whichever the move would read). Follows the real turn order, so Trick Room works.`,
  synonyms: [
    "speed as attack",
    "use speed to hit",
    "attack with speed",
    "go first and hit harder",
    "substitute the attack stat",
  ],
  examples: ["If I move before the target, my moves hit with my Speed instead of my Attack"],
  params: [
    {
      id: "substituteStat",
      ctorIndex: 0,
      path: "substituteStat",
      control: "select",
      label: "Stat used in place of the attack stat",
      editable: true,
      default: "SPD",
      options: [...OFFENCE_STAT_OPTIONS],
      codec: enumCodec(Stat, "stat"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only when I act before my target this turn, judged by the real move order of the turn (so Trick Room is respected); built into the game's damage handling today, requested as a separate condition (R-B15-36)",
    "It reads my own current stat after stages and other boosts (for Speed, after Borrowed Time's swap too)",
    "Only damaging moves read an attack stat, so a status move is not affected",
    "It is worked out in the damage calculation; the choice of stat is not a dispatched ability moment",
  ],
  effect: { id: "effect.package", params: ["substituteStat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The damage calculation finds the attr by constructor name in Pokemon.getBaseDamage; that is not a dispatched moment, so the twin compares whole battles of the one user instead.",
  probes: [{ name: "the holder and the foe trade attacks", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified. 1 attr in 1 ability: Relativity (5911 attr 0, Speed). The effect 'use another stat in place of the attack stat' cannot be split because the library has no such effect and no moment for it: the engine picks the attack stat inside getBaseDamage by scanning the attacker's attrs by name, and nothing dispatches it, so the order test (resolver) cannot be a separate condition block until that seam is a WHEN. Requested as R-B15-36: the moment 'While the game picks the stat my attack uses', the condition 'I act before the target this turn' (time.acted-before, by the real turn order list) and the effect 'Use {stat} in place of the attack stat'; the same condition atom is what the defence half (RelativityDefenseReductionAbAttr) needs. The only setting is the stat, typed (constructor argument, default Speed). WHEN is 'while active' and needs RelativityAbAttr in that WHEN's flagKeys (added locally with this chunk, request R-B15-35, keep the union on merge). Suspected oddities, NOT fixed: (1) the substitution runs after the move's own attack-stat change (VariableAtkAttr, the Foul Play style) and overwrites it, so Foul Play used by a Relativity holder that moved first hits with the holder's own Speed instead of the target's Attack; (2) it sits inside the same loop as the other attack-stat substitutes (Ancient Idol, Momentum), so a holder with two of them gets whichever attr comes LAST; (3) it is skipped while the attacker's ability is being ignored, and the order is compared per target, so one spread move can use Speed against one foe and Attack against the other.",
});
